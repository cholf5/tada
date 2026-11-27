import { describe, expect, it } from 'vitest';
import { DatabaseOpenError, openWithTimeout } from './open';

describe('数据库打开超时', () => {
  it('正常打开时透传结果', async () => {
    await expect(openWithTimeout(async () => 'opened', 50)).resolves.toBeUndefined();
  });

  it('open 挂起时在超时后给出可读错误', async () => {
    const pending = new Promise<void>(() => {
      // 永不 resolve，模拟被其他标签页阻塞的 Dexie open
    });

    await expect(openWithTimeout(() => pending, 20)).rejects.toBeInstanceOf(DatabaseOpenError);
  });

  it('open 自己失败时原样抛出', async () => {
    await expect(
      openWithTimeout(async () => {
        throw new Error('version error');
      }, 50),
    ).rejects.toThrow('version error');
  });
});
