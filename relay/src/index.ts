import { z } from 'zod';
import {
  pushBodySchema,
  type PairResponse,
  type PullResponse,
  type PushResponse,
  type WireChange,
} from '@tada/shared';
import {
  DEFAULT_APP_NAME,
  applyBrandingToHtml,
  buildManifest,
  clearBrandIcon,
  readBrandIcon,
  readBranding,
  resolveBranding,
  saveBrandIcon,
  saveBrandName,
  validateAppName,
  validateIcon,
  type Branding,
} from './branding';
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
  DEVICE_TOUCH_INTERVAL_MS,
  applyPush,
  consumePairingCode,
  findDeviceByTokenHash,
  pullPage,
  sha256Hex,
  touchDeviceIfStale,
} from './store';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN?: string;
  /** 自托管实例的默认应用名；设置页保存过之后以 D1 里的为准 */
  APP_NAME?: string;
}

/* ------------------------------------------------------------------ *
 * 只属于鉴权层的校验；实体相关的 schema 全部来自 @tada/shared
 * ------------------------------------------------------------------ */

const pairBodySchema = z.object({
  code: z.string().min(6).max(32),
  deviceName: z.string().min(1).max(64),
});

// 键缺省 = 不修改；icon: null = 删除自定义图标
const brandingBodySchema = z.object({
  appName: z.string().optional(),
  icon: z
    .object({
      mime: z.string(),
      data: z.string(),
    })
    .nullable()
    .optional(),
});

type BrandingBody = z.infer<typeof brandingBodySchema>;

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req.headers.get('origin') ?? '', env, url.hostname);

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

      if (url.pathname === '/api/branding' && req.method === 'GET') {
        return json(await resolveBranding(env.DB, env), 200, cors);
      }

      if (url.pathname === '/api/branding' && req.method === 'POST') {
        const device = await authenticate(req, env);
        if (!device) return json({ error: 'unauthorized' }, 401, cors);
        return await handleBrandingUpdate(req, env, cors);
      }

      // 动态 manifest 与品牌图标必须在静态资源之前处理，
      // 否则会被构建时那份静态 manifest / 404 盖住。
      if (url.pathname === '/manifest.webmanifest' && req.method === 'GET') {
        const branding = await resolveBranding(env.DB, env);
        return new Response(JSON.stringify(buildManifest(branding)), {
          status: 200,
          headers: {
            ...cors,
            'content-type': 'application/manifest+json',
            'cache-control': 'no-cache',
          },
        });
      }

      if (
        (url.pathname === '/branding/icon-192.png' ||
          url.pathname === '/branding/icon-512.png') &&
        req.method === 'GET'
      ) {
        return await handleBrandIcon(url, env, cors);
      }

      // 未知 API 路径不能落到 SPA 的 index.html，否则客户端会拿到 200 + HTML
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return json({ error: 'not found' }, 404, cors);
      }

      // 其余交给静态资源（SPA 的 index.html 与资源文件）
      return await serveAsset(req, env);
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
 * 实例品牌：读取公开，写入需要 Bearer token
 * ------------------------------------------------------------------ */

async function handleBrandingUpdate(
  req: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  let body: BrandingBody;
  try {
    body = brandingBodySchema.parse(await readJson(req));
  } catch (err) {
    // 结构不对（包括空 body / 非法 JSON）统一回 400，不落成 500
    if (err instanceof z.ZodError || err instanceof InvalidJsonError) {
      return json({ error: 'invalid branding' }, 400, cors);
    }
    throw err;
  }

  const existing = await readBranding(env.DB);
  const currentName = existing?.appName ?? defaultAppName(env);

  // 先完成全部校验，再写库：校验失败不会留下半套品牌数据
  let nextName: string | undefined;
  let nextIcon: Uint8Array | null | undefined;
  try {
    if (body.appName !== undefined) nextName = validateAppName(body.appName);
    if (body.icon !== undefined) {
      if (body.icon === null) {
        nextIcon = null;
      } else {
        nextIcon = decodeBase64(body.icon.data);
        validateIcon(body.icon.mime, nextIcon);
      }
    }
  } catch {
    return json({ error: 'invalid branding' }, 400, cors);
  }

  const now = new Date().toISOString();

  if (nextName !== undefined) {
    await saveBrandName(env.DB, nextName, now);
  }

  if (nextIcon !== undefined) {
    // 首次写入时表里还没有行，先把当前应用名（含 APP_NAME 默认值）落库
    if (!existing && nextName === undefined) {
      await saveBrandName(env.DB, currentName, now);
    }
    if (nextIcon === null) {
      await clearBrandIcon(env.DB, now);
    } else {
      await saveBrandIcon(env.DB, nextIcon, now);
    }
  }

  return json(await resolveBranding(env.DB, env), 200, cors);
}

async function handleBrandIcon(
  url: URL,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const icon = await readBrandIcon(env.DB);
  if (!icon) return json({ error: 'not found' }, 404, cors);

  // 带 ?v= 的 URL 内容不会变；不带版本号时仍然允许重新验证
  const cacheControl = url.searchParams.has('v')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';

  return new Response(icon.bytes, {
    status: 200,
    headers: {
      ...cors,
      'content-type': icon.mime,
      'cache-control': cacheControl,
    },
  });
}

/**
 * 静态资源 + 品牌化 HTML。
 *
 * 只有 index.html / SPA fallback（text/html）需要改写；资源文件原样返回。
 * 品牌读取失败不能影响页面打开，退回 APP_NAME / Tada。
 */
async function serveAsset(req: Request, env: Env): Promise<Response> {
  const res = await env.ASSETS.fetch(req);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/html')) return res;

  let branding: Branding;
  try {
    branding = await resolveBranding(env.DB, env);
  } catch (error) {
    console.warn('读取实例品牌失败，HTML 使用默认品牌', error);
    branding = { appName: defaultAppName(env), iconVersion: null, hasCustomIcon: false };
  }

  const html = await res.text();
  const headers = new Headers(res.headers);
  // 改写后长度变了，交给运行时重新计算
  headers.delete('content-length');
  headers.set('cache-control', 'no-cache');

  return new Response(applyBrandingToHtml(html, branding), {
    status: res.status,
    headers,
  });
}

function defaultAppName(env: Env): string {
  return env.APP_NAME?.trim() || DEFAULT_APP_NAME;
}

/** Workers 与 Node 24 都有 atob；非 base64 输入会抛错，由调用方转成 400。 */
function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* ------------------------------------------------------------------ *
 * 鉴权与工具
 * ------------------------------------------------------------------ */

async function authenticate(req: Request, env: Env): Promise<{ id: string; name: string } | null> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,})$/i.exec(header);
  if (!match) return null;

  const tokenHash = await sha256Hex(match[1]!);
  const device = await findDeviceByTokenHash(env.DB, tokenHash);
  if (!device) return null;

  // last_seen_at 只是运维信息：最多每小时刷新一次；刷新失败不影响本次请求。
  const nowMs = Date.now();
  const lastSeenMs = device.lastSeenAt ? Date.parse(device.lastSeenAt) : Number.NaN;
  if (!Number.isFinite(lastSeenMs) || nowMs - lastSeenMs >= DEVICE_TOUCH_INTERVAL_MS) {
    try {
      await touchDeviceIfStale(env.DB, device.id, new Date(nowMs).toISOString());
    } catch (error) {
      console.warn('刷新设备活跃时间失败', error);
    }
  }

  return { id: device.id, name: device.name };
}

function corsHeaders(
  origin: string,
  env: Env,
  selfHost: string,
): Record<string, string> {
  // localhost 来源只在 Worker 自己也跑在 localhost 时放行（wrangler dev）。
  // 线上 Worker 即使收到来自 localhost 的 Origin 也不回 CORS 头，避免把开发
  // 便利带进生产。
  const localWorker =
    selfHost === 'localhost' ||
    selfHost === '127.0.0.1' ||
    selfHost === '::1' ||
    selfHost === '[::1]';
  const localOrigin = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
  const allowed = origin !== '' && (origin === env.APP_ORIGIN || (localWorker && localOrigin));

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
