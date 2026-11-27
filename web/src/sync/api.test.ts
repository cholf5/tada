import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  UnauthorizedError,
  createHttpTransport,
} from './api';

const TOKEN = 'a'.repeat(24);

describe('请求超时（P18）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('所有请求带 AbortSignal，超时时间为 30s', async () => {
    const seen: RequestInit[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init);
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = createHttpTransport();

    await expect(transport.pull(TOKEN, 0, 500)).rejects.toBeInstanceOf(RequestTimeoutError);
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('超时是临时错误（status 0），不会被当成 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted', 'AbortError');
      }),
    );

    const transport = createHttpTransport();
    const error = await transport.push(TOKEN, []).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(UnauthorizedError);
    expect((error as ApiError).status).toBe(0);
  });

  it('真正的 401 仍然映射为 UnauthorizedError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    );

    const transport = createHttpTransport();
    await expect(transport.pull(TOKEN, 0, 500)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
