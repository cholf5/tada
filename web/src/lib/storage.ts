/** 浏览器是否愿意为本站点保留持久化存储。 */
export type PersistStatus = 'granted' | 'denied' | 'unsupported';

/** 只依赖真正用到的两个方法，便于测试注入。 */
export interface StorageManagerLike {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

/**
 * 尽量为本站点申请持久化存储。
 *
 * 本地优先应用只有 IndexedDB 一份数据：空间紧张或用户清理站点数据时，
 * 浏览器可能直接回收。`navigator.storage.persist()` 能显著降低被回收的
 * 概率（尤其 Android Chrome），但浏览器可以拒绝，所以设置页仍要提示导出备份。
 */
export async function requestPersistentStorage(
  manager?: StorageManagerLike | null,
): Promise<PersistStatus> {
  const storage =
    manager ??
    (typeof navigator !== 'undefined'
      ? (navigator.storage as StorageManagerLike | undefined)
      : undefined);

  if (!storage?.persist || !storage.persisted) return 'unsupported';

  try {
    if (await storage.persisted()) return 'granted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
