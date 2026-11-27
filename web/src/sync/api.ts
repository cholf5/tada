import type {
  PairRequest,
  PairResponse,
  PullResponse,
  PushResponse,
  WireChange,
} from '@tada/shared';
import type { BrandingState } from '../lib/branding';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * 单次请求的超时时间。
 *
 * 挂起的 fetch 会让同步引擎一直停在「同步中」，inflight 不释放、后续触发全部
 * 被合并掉；30s 足够慢网完成一次 push/pull，又不会无限等待。
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * 请求超时（AbortSignal.timeout 触发的中断）。
 *
 * 按临时网络错误处理（status 0）：引擎走既有退避重试，绝不能被当成 401
 * 清 token 回配对页。
 */
export class RequestTimeoutError extends ApiError {
  constructor(message = '请求超时，请检查网络后重试') {
    super(message, 0);
    this.name = 'RequestTimeoutError';
  }
}

/** 任何接口返回 401：token 失效，调用方应清 token 回配对页 */
export class UnauthorizedError extends ApiError {
  constructor(message = 'unauthorized') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

export interface SyncTransport {
  push(token: string, changes: WireChange[]): Promise<PushResponse>;
  pull(token: string, since: number, limit: number): Promise<PullResponse>;
}

/** 生产环境与 relay 同源，base 保持空；开发时由 Vite 代理 /api */
export function createHttpTransport(baseUrl = ''): SyncTransport {
  return {
    async push(token, changes) {
      return call<PushResponse>(`${baseUrl}/api/v1/sync/push`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ changes }),
      });
    },

    async pull(token, since, limit) {
      const query = new URLSearchParams({ since: String(since), limit: String(limit) });
      return call<PullResponse>(`${baseUrl}/api/v1/sync/pull?${query.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    },
  };
}

/** 配对码换 token。401 表示配对码无效或过期，而不是凭证失效。 */
export async function pairDevice(
  code: string,
  deviceName: string,
  baseUrl = '',
): Promise<string> {
  const body: PairRequest = { code: code.trim(), deviceName: deviceName.trim() };
  const res = await call<PairResponse>(`${baseUrl}/api/v1/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.token;
}

/* ------------------------------------------------------------------ *
 * 实例品牌
 * ------------------------------------------------------------------ */

export interface BrandingPayload {
  appName?: string;
  icon?: { mime: string; data: string } | null;
}

/** 读接口不需要鉴权；品牌不是关键路径，只等 5 秒。 */
export async function fetchBranding(baseUrl = ''): Promise<BrandingState> {
  return call<BrandingState>(`${baseUrl}/api/branding`, {}, 5_000);
}

/** 写接口必须带配对 token；成功返回最新的品牌状态。 */
export async function postBranding(
  token: string,
  body: BrandingPayload,
  baseUrl = '',
): Promise<BrandingState> {
  return call<BrandingState>(`${baseUrl}/api/branding`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function call<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let res: Response;
  try {
    // 所有请求统一超时，避免挂起的连接把同步引擎卡在「同步中」
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (isAbort(error)) throw new RequestTimeoutError();
    throw new ApiError('无法连接服务器，请检查网络', 0);
  }

  if (res.status === 401) throw new UnauthorizedError();

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // 忽略读取失败
    }
    throw new ApiError(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }

  return (await res.json()) as T;
}

/**
 * 是否是超时/主动中断。
 *
 * 这里的 signal 只可能来自 `AbortSignal.timeout`，所以中断与超时等价：
 * Node 抛 `TimeoutError`，部分实现抛 `AbortError`，两者都按超时处理。
 */
function isAbort(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}
