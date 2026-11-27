import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PULL_LIMIT,
  InvalidJsonError,
  MAX_BODY_BYTES,
  MAX_PULL_LIMIT,
  PayloadTooLargeError,
  UnknownEntityError,
  assertKnownEntities,
  parseEntityData,
  parsePullWindow,
  readJson,
} from './http';

const UUID = '11111111-1111-4111-8111-111111111111';
const TS = '2026-11-27T10:00:00.000Z';

function post(body: string): Request {
  return new Request('http://localhost/api/v1/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('readJson', () => {
  it('正常 JSON 返回解析后的对象', async () => {
    await expect(readJson(post('{"code":"A1B2C3D4E5"}'))).resolves.toEqual({
      code: 'A1B2C3D4E5',
    });
  });

  it('空 body / 纯空白返回 invalid json', async () => {
    await expect(readJson(post(''))).rejects.toBeInstanceOf(InvalidJsonError);
    await expect(readJson(post('   \n\t '))).rejects.toBeInstanceOf(InvalidJsonError);
  });

  it('非法 JSON 返回 invalid json，而不是抛 SyntaxError', async () => {
    await expect(readJson(post('{not json'))).rejects.toBeInstanceOf(InvalidJsonError);
    await expect(readJson(post('{"a":'))).rejects.toBeInstanceOf(InvalidJsonError);
  });

  it('超过 2MB 的 body 抛 payload too large（先于 JSON 解析）', async () => {
    const huge = 'x'.repeat(MAX_BODY_BYTES + 1);
    await expect(readJson(post(huge))).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('未超限的 body 正常解析', async () => {
    const body = JSON.stringify({ text: 'x'.repeat(MAX_BODY_BYTES - 100) });
    await expect(readJson(post(body))).resolves.toHaveProperty('text');
  });

  it('content-length 超限时直接 413，完全不读 body（P4）', async () => {
    const { request, reads } = fakeRequest({
      contentLength: String(MAX_BODY_BYTES + 1),
      chunks: [new TextEncoder().encode('{"code":"A1B2C3D4E5"}')],
    });

    await expect(readJson(request)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(reads()).toBe(0);
  });

  it('没有 content-length 时按流累计字节，超限立即中止（P4）', async () => {
    const chunk = new Uint8Array(50_000).fill(0x61);
    const total = 80; // 4MB：远超 2MB 上限
    const { request, reads } = fakeRequest({
      chunks: Array.from({ length: total }, () => chunk),
    });

    await expect(readJson(request)).rejects.toBeInstanceOf(PayloadTooLargeError);
    // 不应把整个 body 读完才判断
    expect(reads()).toBeLessThan(total);
  });

  it('流式 body 未超限时能正确解码并解析', async () => {
    const encoded = new TextEncoder().encode('{"code":"A1B2C3D4E5"}');
    const { request } = fakeRequest({ chunks: [encoded.slice(0, 5), encoded.slice(5)] });

    await expect(readJson(request)).resolves.toEqual({ code: 'A1B2C3D4E5' });
  });
});

/**
 * 只实现 readJson 用到的 headers / body，避免 Node Request 对流式 body 的
 * 额外缓冲干扰「有没有读 body」的断言。
 */
function fakeRequest(options: {
  contentLength?: string;
  chunks: Uint8Array[];
}): { request: Request; reads: () => number } {
  let reads = 0;
  let index = 0;

  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads += 1;
        if (index >= options.chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(options.chunks[index]!);
        index += 1;
      },
    },
    // 关闭预读：只有在真的 getReader().read() 时才会触发 pull
    { highWaterMark: 0 },
  );

  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.contentLength !== undefined) {
    headers.set('content-length', options.contentLength);
  }

  return { request: { headers, body } as unknown as Request, reads: () => reads };
}

describe('parsePullWindow', () => {
  const parse = (query: string) => parsePullWindow(new URLSearchParams(query));

  it('缺省值', () => {
    expect(parse('')).toEqual({ since: 0, limit: DEFAULT_PULL_LIMIT });
  });

  it('limit=0 被夹到 1，而不是退回 500', () => {
    expect(parse('limit=0').limit).toBe(1);
    expect(parse('limit=0').limit).not.toBe(DEFAULT_PULL_LIMIT);
  });

  it('since / limit 非有限数字时回退', () => {
    expect(parse('since=abc&limit=xyz')).toEqual({ since: 0, limit: DEFAULT_PULL_LIMIT });
    expect(parse('since=Infinity').since).toBe(0);
  });

  it('负数与小数被夹取整', () => {
    expect(parse('since=-5&limit=-3')).toEqual({ since: 0, limit: 1 });
    expect(parse('since=12.9&limit=7.9')).toEqual({ since: 12, limit: 7 });
  });

  it('上限 clamp 到 1000', () => {
    expect(parse(`limit=${MAX_PULL_LIMIT + 500}`).limit).toBe(MAX_PULL_LIMIT);
  });
});

describe('assertKnownEntities', () => {
  it('已知实体通过', () => {
    expect(() =>
      assertKnownEntities({ changes: [{ entity: 'lists' }, { entity: 'tasks' }] }),
    ).not.toThrow();
  });

  it('未知实体抛出 UnknownEntityError 并带出实体名', () => {
    try {
      assertKnownEntities({ changes: [{ entity: 'notes' }] });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownEntityError);
      expect((err as UnknownEntityError).entity).toBe('notes');
    }
  });

  it('原型链上的名字不算已知实体', () => {
    expect(() => assertKnownEntities({ changes: [{ entity: 'constructor' }] })).toThrow(
      UnknownEntityError,
    );
  });

  it('结构不对的 body 交给后面的 schema 处理', () => {
    expect(() => assertKnownEntities(null)).not.toThrow();
    expect(() => assertKnownEntities({})).not.toThrow();
    expect(() => assertKnownEntities({ changes: 'nope' })).not.toThrow();
  });
});

describe('parseEntityData', () => {
  const list = {
    name: '工作',
    color: '#e5484d',
    orderKey: 'a0',
    createdAt: TS,
    updatedAt: TS,
  };

  it('按实体映射选择 schema', () => {
    expect(parseEntityData('lists', list)).toMatchObject({ name: '工作' });
    expect(() => parseEntityData('lists', { ...list, color: 'red' })).toThrow(z.ZodError);
  });

  it('未知实体显式报错', () => {
    expect(() => parseEntityData('notes', {})).toThrow(UnknownEntityError);
    expect(() => parseEntityData('', {})).toThrow(UnknownEntityError);
    expect(() => parseEntityData('toString', {})).toThrow(UnknownEntityError);
  });

  it('任务实体校验 dueAt 格式', () => {
    const task = {
      listId: UUID,
      parentId: null,
      title: '写代码',
      notes: null,
      done: false,
      doneAt: null,
      dueAt: '2026-11-27',
      orderKey: 'a0',
      createdAt: TS,
      updatedAt: TS,
    };
    expect(parseEntityData('tasks', task)).toMatchObject({ title: '写代码' });
    expect(() => parseEntityData('tasks', { ...task, dueAt: '2026/11/27' })).toThrow(z.ZodError);
  });
});
