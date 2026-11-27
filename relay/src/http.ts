import { z } from 'zod';
import { entityDataSchemas, type ListData, type TaskData } from '@tada/shared';

/** 请求体上限（字节）。超过直接 413，不做 JSON 解析。 */
export const MAX_BODY_BYTES = 2_000_000;

export const DEFAULT_PULL_LIMIT = 500;
export const MAX_PULL_LIMIT = 1000;

export class InvalidJsonError extends Error {
  constructor() {
    super('invalid json');
    this.name = 'InvalidJsonError';
  }
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super('payload too large');
    this.name = 'PayloadTooLargeError';
  }
}

export class UnknownEntityError extends Error {
  readonly entity: string;

  constructor(entity: string) {
    super(`unknown entity: ${entity}`);
    this.name = 'UnknownEntityError';
    this.entity = entity;
  }
}

const ENTITY_SCHEMAS: Record<string, z.ZodTypeAny> = entityDataSchemas;

/** 只认 @tada/shared 声明过的实体；未知实体由调用方转成 400。 */
export function getEntitySchema(entity: string): z.ZodTypeAny | undefined {
  return Object.prototype.hasOwnProperty.call(ENTITY_SCHEMAS, entity)
    ? ENTITY_SCHEMAS[entity]
    : undefined;
}

/** 按实体映射校验 data；未知实体显式抛错，而不是落进 else 分支。 */
export function parseEntityData(entity: string, data: unknown): ListData | TaskData {
  const schema = getEntitySchema(entity);
  if (!schema) throw new UnknownEntityError(entity);
  return schema.parse(data) as ListData | TaskData;
}

/**
 * 先读文本再解析，让空 body / 非法 JSON 稳定返回 400，
 * 而不是让 `req.json()` 抛 SyntaxError 变成 500。
 *
 * 体积检查发生在读入内存之前：
 * 1. 有 `content-length` 且超限 → 直接 413，body 完全不读；
 * 2. 没有该头（chunked / 流式）→ 边读边累计字节，一超限就 cancel 并 413。
 */
export async function readJson(req: Request): Promise<unknown> {
  const declared = declaredLength(req);
  if (declared !== null && declared > MAX_BODY_BYTES) throw new PayloadTooLargeError();

  const text = await readTextWithLimit(req);

  if (text.trim() === '') throw new InvalidJsonError();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidJsonError();
  }
}

/** `content-length` 只在是合法非负数字时才可信；非法值退回流式检查。 */
function declaredLength(req: Request): number | null {
  const raw = req.headers.get('content-length');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * 按块读取 body，累计真实字节数。超过上限立刻取消流，不把整个 body 读进内存。
 * `TextDecoder` 的 stream 模式保证多字节字符被拆到两个 chunk 时也能正确解码。
 */
async function readTextWithLimit(req: Request): Promise<string> {
  if (!req.body) return '';

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

/** 在完整 schema 校验前先挑出未知实体，返回明确的 400 而不是泛化的 invalid payload。 */
export function assertKnownEntities(body: unknown): void {
  if (typeof body !== 'object' || body === null) return;

  const changes = (body as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return;

  for (const change of changes) {
    if (typeof change !== 'object' || change === null) continue;
    const entity = (change as { entity?: unknown }).entity;
    if (typeof entity === 'string' && !getEntitySchema(entity)) {
      throw new UnknownEntityError(entity);
    }
  }
}

export interface PullWindow {
  since: number;
  limit: number;
}

/**
 * since / limit 只接受有限数字。
 * 注意 limit=0 必须夹到 1，不能被 `|| 500` 吃掉。
 */
export function parsePullWindow(params: URLSearchParams): PullWindow {
  const rawSince = Number(params.get('since') ?? 0);
  const since = Number.isFinite(rawSince) ? Math.max(0, Math.floor(rawSince)) : 0;

  const rawLimitParam = params.get('limit');
  const rawLimit = rawLimitParam === null ? DEFAULT_PULL_LIMIT : Number(rawLimitParam);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_PULL_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_PULL_LIMIT;

  return { since, limit };
}
