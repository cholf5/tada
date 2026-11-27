/**
 * 外观模式：跟随系统 / 日间 / 夜间。
 *
 * 选择只保存在本机（localStorage），不参与同步：同一个人的不同设备
 * 可能处在不同光线环境，没必要互相覆盖。
 *
 * 「跟随系统」不写 data-theme，交给 styles.css 的 prefers-color-scheme；
 * 手动选择时写入 data-theme="light|dark"，优先级高于系统。
 */

export type ThemeMode = 'system' | 'light' | 'dark';

/** 实际生效的配色 */
export type ResolvedTheme = 'light' | 'dark';

/** 与 index.html 内联脚本里的键保持一致；改这里记得同步改那边。 */
const STORAGE_KEY = 'tada.theme';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function defaultStorage(): (ReadableStorage & WritableStorage) | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // 部分浏览器的隐私模式会直接在访问 localStorage 时抛错
    return null;
  }
}

/** 读取本机保存的模式；没有、读不到或值不合法时回退到跟随系统。 */
export function readStoredThemeMode(
  storage: ReadableStorage | null = defaultStorage(),
): ThemeMode {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return isThemeMode(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** 记住选择；写失败（隐私模式、配额满）不影响本次生效。 */
export function writeStoredThemeMode(
  mode: ThemeMode,
  storage: WritableStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    // 忽略：选择记不住只是下次回到默认，不应该打断当前操作
  }
}

/** 跟随系统时返回 null，表示不写 data-theme。 */
export function themeAttribute(mode: ThemeMode): ResolvedTheme | null {
  return mode === 'system' ? null : mode;
}

/** 把模式套到 <html> 上；跟随系统时移除属性，由 CSS 媒体查询接管。 */
export function applyThemeMode(
  mode: ThemeMode,
  root: ThemeRoot | null = typeof document === 'undefined'
    ? null
    : document.documentElement,
): void {
  if (!root) return;
  const attribute = themeAttribute(mode);
  if (attribute) {
    root.setAttribute('data-theme', attribute);
  } else {
    root.removeAttribute('data-theme');
  }
}

/** 当前实际生效的明暗；手动模式优先于系统偏好。 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

/** 保存到本机并立即生效。 */
export function setThemeMode(mode: ThemeMode): void {
  writeStoredThemeMode(mode);
  applyThemeMode(mode);
}
