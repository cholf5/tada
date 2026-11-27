import { formatHlc, type WireChange } from '@tada/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import worker, { type Env } from './index';
import { makeDb, type SqliteD1 } from './test/sqlite';

/**
 * HTTP 层 + 真实 SQL 的端到端测试。
 *
 * 和 worker.test.ts 的区别：这里不再用 `DB: {}`，而是把 worker.fetch 接到
 * node:sqlite 上，配对、push、pull、LWW、墓碑、401 都走真实的 SQL 与事务。
 * 两台客户端共用同一个「服务器」，验证的是完整同步闭环，而不是单层函数。
 */

const ORIGIN = 'http://localhost';
const TS = '2026-01-01T00:00:00.000Z';
const LIST_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const TASK2_ID = '33333333-3333-4333-8333-333333333333';
const CODE_A = 'AAAAA00001';
const CODE_B = 'BBBBB00002';

function h(ms: number): string {
  return formatHlc({ ms, counter: 0, device: 'e2e01' });
}

function listChange(options: { hlc: string; name: string; deleted?: boolean }): WireChange {
  return {
    entity: 'lists',
    id: LIST_ID,
    hlc: options.hlc,
    deleted: options.deleted ?? false,
    data: options.deleted
      ? undefined
      : {
          name: options.name,
          color: null,
          orderKey: 'a0',
          createdAt: TS,
          updatedAt: TS,
        },
  };
}

function taskChange(options: {
  id?: string;
  hlc: string;
  title: string;
  done?: boolean;
  deleted?: boolean;
}): WireChange {
  return {
    entity: 'tasks',
    id: options.id ?? TASK_ID,
    hlc: options.hlc,
    deleted: options.deleted ?? false,
    data: options.deleted
      ? undefined
      : {
          listId: LIST_ID,
          parentId: null,
          title: options.title,
          notes: null,
          done: options.done ?? false,
          doneAt: options.done ? TS : null,
          dueAt: null,
          orderKey: 'a0',
          createdAt: TS,
          updatedAt: TS,
        },
  };
}

describe('HTTP + 真实 SQLite 的同步闭环', () => {
  let d1: SqliteD1;
  let env: Env;

  beforeEach(() => {
    d1 = makeDb();
    env = {
      DB: d1 as unknown as D1Database,
      ASSETS: {
        fetch: async () => new Response('<html>spa</html>'),
      } as unknown as Fetcher,
    };
  });

  async function insertCode(code: string, expiresAt = '2099-01-01T00:00:00.000Z') {
    await d1
      .prepare(`INSERT INTO pairing_codes (code, expires_at) VALUES (?1, ?2)`)
      .bind(code, expiresAt)
      .run();
  }

  async function http(path: string, init: RequestInit = {}): Promise<Response> {
    return worker.fetch(new Request(`${ORIGIN}${path}`, init), env);
  }

  async function pair(code: string, deviceName: string): Promise<string> {
    const res = await http('/api/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceName }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    return body.token;
  }

  async function push(token: string, changes: WireChange[]): Promise<Response> {
    return http('/api/v1/sync/push', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ changes }),
    });
  }

  async function pull(token: string, since: number, limit = 500) {
    const res = await http(`/api/v1/sync/pull?since=${since}&limit=${limit}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      changes: Array<WireChange & { seq?: number }>;
      nextSince: number;
      hasMore: boolean;
    };
  }

  it('两台客户端：配对、推送、拉取、LWW、墓碑、401 全链路', async () => {
    await insertCode(CODE_A);
    await insertCode(CODE_B);

    const tokenA = await pair(CODE_A, '设备 A');
    const tokenB = await pair(CODE_B, '设备 B');
    expect(tokenA).not.toBe(tokenB);

    // A 推送列表 + 两个任务
    const firstPush = await push(tokenA, [
      listChange({ hlc: h(1000), name: '工作' }),
      taskChange({ hlc: h(1001), title: '买牛奶' }),
      taskChange({ id: TASK2_ID, hlc: h(1002), title: '写周报' }),
    ]);
    expect(firstPush.status).toBe(200);
    expect(await firstPush.json()).toEqual({ lastSeq: 3 });

    // B 从 0 全量拉取，字段完整且不带服务端内部 seq
    const bFirst = await pull(tokenB, 0);
    expect(bFirst.changes).toHaveLength(3);
    expect(bFirst.nextSince).toBe(3);
    expect(bFirst.hasMore).toBe(false);
    expect(bFirst.changes[0]?.entity).toBe('lists');
    expect(bFirst.changes[0]?.data).toMatchObject({ name: '工作', color: null });
    expect(bFirst.changes[1]?.data).toMatchObject({ title: '买牛奶', done: false });
    expect('seq' in (bFirst.changes[0] as object)).toBe(false);

    // B 更新任务，A 从游标 3 拉到新版本
    expect(
      (
        await push(tokenB, [
          taskChange({ hlc: h(2000), title: '买牛奶（两盒）', done: true }),
        ])
      ).status,
    ).toBe(200);

    const aSecond = await pull(tokenA, 3);
    expect(aSecond.changes).toHaveLength(1);
    expect(aSecond.changes[0]?.hlc).toBe(h(2000));
    expect(aSecond.changes[0]?.data).toMatchObject({ title: '买牛奶（两盒）', done: true });
    expect(aSecond.nextSince).toBe(4);

    // A 用更旧的 hlc 推送：服务端忽略，但 seq 仍然推进；游标之后拉不到旧版本
    expect(
      (await push(tokenA, [taskChange({ hlc: h(1500), title: '旧版本' })])).status,
    ).toBe(200);

    const bSecond = await pull(tokenB, 4);
    expect(bSecond.changes).toHaveLength(0);
    expect(bSecond.nextSince).toBe(4);

    // B 删除任务：A 拉到墓碑，data 被忽略
    expect(
      (await push(tokenB, [{ entity: 'tasks', id: TASK_ID, hlc: h(3000), deleted: true }]))
        .status,
    ).toBe(200);

    const aThird = await pull(tokenA, 4);
    expect(aThird.changes).toHaveLength(1);
    expect(aThird.changes[0]).toMatchObject({
      entity: 'tasks',
      id: TASK_ID,
      deleted: true,
      hlc: h(3000),
    });

    // 撤销 B 后：push/pull 都是 401，A 不受影响
    await d1
      .prepare(`UPDATE devices SET revoked_at = ?1 WHERE name = ?2`)
      .bind('2026-01-01T00:30:00.000Z', '设备 B')
      .run();

    expect((await push(tokenB, [taskChange({ hlc: h(4000), title: '撤销后' })])).status).toBe(401);
    expect(
      (
        await http('/api/v1/sync/pull?since=0', {
          headers: { authorization: `Bearer ${tokenB}` },
        })
      ).status,
    ).toBe(401);

    const aAfterRevoke = await pull(tokenA, aThird.nextSince);
    expect(aAfterRevoke.changes).toHaveLength(0);
  });

  it('配对码重放走 HTTP + SQL：只登记一台设备', async () => {
    await insertCode(CODE_A);

    const first = await http('/api/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: CODE_A, deviceName: '第一台' }),
    });
    expect(first.status).toBe(200);

    const second = await http('/api/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: CODE_A, deviceName: '第二台' }),
    });
    expect(second.status).toBe(401);

    const devices = await d1.prepare(`SELECT name FROM devices`).all<{ name: string }>();
    expect(devices.results?.map((device) => device.name)).toEqual(['第一台']);
  });

  it('分页通过 HTTP 正确返回 hasMore / nextSince', async () => {
    await insertCode(CODE_A);
    const token = await pair(CODE_A, '分页设备');

    await push(token, [
      listChange({ hlc: h(1000), name: 'L' }),
      taskChange({ hlc: h(1001), title: 'T1' }),
      taskChange({ id: TASK2_ID, hlc: h(1002), title: 'T2' }),
    ]);

    const first = await pull(token, 0, 2);
    expect(first.changes.map((change) => change.hlc)).toEqual([h(1000), h(1001)]);
    expect(first.nextSince).toBe(2);
    expect(first.hasMore).toBe(true);

    const second = await pull(token, first.nextSince, 2);
    expect(second.changes.map((change) => change.hlc)).toEqual([h(1002)]);
    expect(second.nextSince).toBe(3);
    expect(second.hasMore).toBe(false);
  });

  it('鉴权头与非法请求的 HTTP 语义', async () => {
    // 无 token / 错 token
    expect((await push('', [])).status).toBe(401);
    expect(
      (
        await http('/api/v1/sync/pull?since=0', {
          headers: { authorization: 'Bearer not-a-valid-token' },
        })
      ).status,
    ).toBe(401);

    // 健康检查与未知 API
    const health = await http('/api/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    expect(health.headers.get('cache-control')).toBe('no-store');

    const missing = await http('/api/v1/unknown');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not found' });

    // 非法 JSON
    const bad = await http('/api/v1/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid json' });

    // 超出 2MB
    const huge = await http('/api/v1/pair', {
      method: 'POST',
      body: 'x'.repeat(2_000_001),
    });
    expect(huge.status).toBe(413);
  });
});
