import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';

/**
 * Dexie liveQuery 的轻量 React 封装：任何影响查询结果的本地写入
 * 都会立即触发重新渲染，这就是「乐观更新」的来源。
 */
export function useLive<T>(
  query: () => Promise<T>,
  deps: readonly unknown[],
): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (result) => setValue(result),
      error: (error) => console.error('liveQuery failed', error),
    });
    return () => subscription.unsubscribe();
    // query 由 deps 决定身份
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}
