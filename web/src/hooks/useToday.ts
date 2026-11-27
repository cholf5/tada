import { useSyncExternalStore } from 'react';
import { todayIso } from '../lib/dates';

/**
 * 全局共享的「今天」。
 *
 * 只维护一份订阅：第一个组件挂载时启动每分钟一次的刷新，
 * 页面重新可见时也立刻重算；跨过午夜后所有订阅者一起拿到新日期，
 * 不会出现「今天」视图和日期 chip 各自停在昨天的情况。
 */
let current = todayIso();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function refresh(): void {
  const next = todayIso();
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (listeners.size === 1) {
    current = todayIso();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', refresh);
    }
    timer = setInterval(refresh, 60_000);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', refresh);
      }
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

/** 本地日期 YYYY-MM-DD，跨午夜 / 页面重新可见时自动更新 */
export function useToday(): string {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
