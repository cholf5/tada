import { z } from 'zod';
import {
  pushBodySchema,
  type PairResponse,
  type PullResponse,
  type PushResponse,
  type WireChange,
} from '@tada/shared';
import {
  InvalidJsonError,
  PayloadTooLargeError,
  UnknownEntityError,
  assertKnownEntities,
  parsePullWindow,
  readJson,
} from './http';
import type { SeqWireChange } from './pull';
import {
  applyPush,
  consumePairingCode,
  findDeviceByTokenHash,
  pullPage,
  sha256Hex,
} from './store';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN?: string;
}

/* ------------------------------------------------------------------ *
 * 只属于鉴权层的校验；实体相关的 schema 全部来自 @tada/shared
 * ------------------------------------------------------------------ */

const pairBodySchema = z.object({
  code: z.string().min(6).max(32),
  deviceName: z.string().min(1).max(64),
});

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req.headers.get('origin') ?? '', env);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'cache-control': 'no-store' } });
    }

    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === '/api/v1/pair' && req.method === 'POST') {
        return await handlePair(req, env, cors);
      }

      if (url.pathname === '/api/v1/sync/push' && req.method === 'POST') {
        const device = await authenticate(req, env);
        if (!device) return json({ error: 'unauthorized' }, 401, cors);
        return await handlePush(req, env, cors);
      }

      if (url.pathname === '/api/v1/sync/pull' && req.method === 'GET') {
        const device = await authenticate(req, env);
        if (!device) return json({ error: 'unauthorized' }, 401, cors);
        return await handlePull(url, env, cors);
      }

      // 未知 API 路径不能落到 SPA 的 index.html，否则客户端会拿到 200 + HTML
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return json({ error: 'not found' }, 404, cors);
      }

      // 其余交给静态资源（SPA 的 index.html 与资源文件）
      return env.ASSETS.fetch(req);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        return json({ error: 'payload too large' }, 413, cors);
      }
      if (err instanceof InvalidJsonError) {
        return json({ error: 'invalid json' }, 400, cors);
      }
      if (err instanceof UnknownEntityError) {
        return json({ error: 'unknown entity', entity: err.entity }, 400, cors);
      }
      if (err instanceof z.ZodError) {
        return json({ error: 'invalid payload', issues: err.issues }, 400, cors);
      }
      console.error('unhandled', err);
      return json({ error: 'internal error' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;

/* ------------------------------------------------------------------ *
 * 配对：一次性码 → 长期 token
 * ------------------------------------------------------------------ */

async function handlePair(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const { code, deviceName } = pairBodySchema.parse(await readJson(req));
  const now = new Date().toISOString();

  const outcome = await consumePairingCode(env.DB, code, deviceName, now);
  if (!outcome) {
    return json({ error: 'invalid or expired code' }, 401, cors);
  }

  const body: PairResponse = { token: outcome.token };
  return json(body, 200, cors);
}

/* ------------------------------------------------------------------ *
 * push：客户端上传本地改动
 * 唯一的业务规则：hlc 旧的写入直接丢弃（LWW）
 * ------------------------------------------------------------------ */

async function handlePush(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const raw = await readJson(req);
  // 未知实体先给出明确错误，而不是落进 Zod 的泛化 invalid payload
  assertKnownEntities(raw);
  const { changes } = pushBodySchema.parse(raw);

  const lastSeq = await applyPush(env.DB, changes, new Date().toISOString());

  const body: PushResponse = { lastSeq };
  return json(body, 200, cors);
}

/* ------------------------------------------------------------------ *
 * pull：按 seq 游标增量拉取
 * ------------------------------------------------------------------ */

async function handlePull(url: URL, env: Env, cors: Record<string, string>): Promise<Response> {
  const { since, limit } = parsePullWindow(url.searchParams);
  const page = await pullPage(env.DB, since, limit);

  const body: PullResponse = {
    changes: page.changes.map(stripSeq),
    nextSince: page.nextSince,
    hasMore: page.hasMore,
  };
  return json(body, 200, cors);
}

function stripSeq(change: SeqWireChange): WireChange {
  const { seq: _seq, ...rest } = change;
  return rest;
}

/* ------------------------------------------------------------------ *
 * 鉴权与工具
 * ------------------------------------------------------------------ */

async function authenticate(req: Request, env: Env): Promise<{ id: string; name: string } | null> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,})$/i.exec(header);
  if (!match) return null;

  const tokenHash = await sha256Hex(match[1]!);
  return findDeviceByTokenHash(env.DB, tokenHash);
}

function corsHeaders(origin: string, env: Env): Record<string, string> {
  const allowed =
    origin !== '' && (origin === env.APP_ORIGIN || /^http:\/\/localhost:\d+$/.test(origin));

  return {
    ...(allowed ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(body: unknown, status: number, extra: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...extra,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
