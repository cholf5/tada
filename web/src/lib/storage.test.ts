import { describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from './storage';

describe('持久化存储申请', () => {
  it('浏览器不支持时返回 unsupported', async () => {
    expect(await requestPersistentStorage(null)).toBe('unsupported');
    expect(await requestPersistentStorage({})).toBe('unsupported');
  });

  it('已经持久化时直接返回 granted，不再调用 persist', async () => {
    const persist = vi.fn(async () => false);
    const status = await requestPersistentStorage({
      persisted: async () => true,
      persist,
    });
    expect(status).toBe('granted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('未持久化时调用 persist，并返回结果', async () => {
    expect(
      await requestPersistentStorage({
        persisted: async () => false,
        persist: async () => true,
      }),
    ).toBe('granted');

    expect(
      await requestPersistentStorage({
        persisted: async () => false,
        persist: async () => false,
      }),
    ).toBe('denied');
  });

  it('API 抛错时按 rejected 处理，不影响启动', async () => {
    const status = await requestPersistentStorage({
      persisted: async () => false,
      persist: async () => {
        throw new Error('denied by browser');
      },
    });
    expect(status).toBe('denied');
  });
});
