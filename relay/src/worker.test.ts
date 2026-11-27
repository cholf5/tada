import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';
import { MAX_BODY_BYTES } from './http';

function makeEnv() {
  const assetsFetch = vi.fn(async () => {
    return new Response('<html>spa</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  });

  const env = {
    DB: {} as unknown as D1Database,
    ASSETS: { fetch: assetsFetch } as unknown as Fetcher,
  } as Env;

  return { env, assetsFetch };
}

const ORIGIN = 'http://localhost';

describe('Worker 路由与错误处理', () => {
  it('健康检查返回 200 JSON，且不缓存', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(new Request(`${ORIGIN}/api/health`), env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('未知 /api 路径返回 404 JSON，不会落到 SPA', async () => {
    const { env, assetsFetch } = makeEnv();
    const res = await worker.fetch(new Request(`${ORIGIN}/api/v1/unknown`), env);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it('非 API 路径交给静态资源', async () => {
    const { env, assetsFetch } = makeEnv();
    const res = await worker.fetch(new Request(`${ORIGIN}/some/page`), env);

    expect(res.status).toBe(200);
    expect(assetsFetch).toHaveBeenCalledTimes(1);
  });

  it('空 body 的 pair 请求返回 400 invalid json', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/v1/pair`, { method: 'POST', body: '' }),
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid json' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('非法 JSON 的 pair 请求返回 400 invalid json', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/v1/pair`, { method: 'POST', body: '{oops' }),
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid json' });
  });

  it('超过 2MB 的 pair 请求返回 413 且不解析', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/v1/pair`, {
        method: 'POST',
        body: 'x'.repeat(MAX_BODY_BYTES + 1),
      }),
      env,
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload too large' });
  });

  it('OPTIONS 预检返回 204，带 no-store', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/v1/sync/push`, {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173' },
      }),
      env,
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});
