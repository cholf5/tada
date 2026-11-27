import { t } from '../lib/i18n';

/** 打开 IndexedDB 的超时上限。 */
export const DB_OPEN_TIMEOUT_MS = 15_000;

export class DatabaseOpenError extends Error {
  readonly reason = 'timeout' as const;

  constructor(message: string) {
    super(message);
    this.name = 'DatabaseOpenError';
  }
}

/**
 * 给 `db.open()` 加一个超时。
 *
 * 如果另一个标签页还持有旧版本数据库，Dexie 的升级会被阻塞，open 可能
 * 一直不 resolve，界面就永远停在「正在加载本地数据…」。超时后抛出可读错误，
 * 让用户知道要关闭其他标签页 / 刷新。
 */
export async function openWithTimeout(
  open: () => Promise<unknown>,
  timeoutMs: number = DB_OPEN_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DatabaseOpenError(t('errors.dbLocked')));
    }, timeoutMs);
  });

  try {
    await Promise.race([open(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
