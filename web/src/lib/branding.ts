import { fetchBranding as fetchRemoteBranding } from '../sync/api';

/**
 * 实例品牌：应用名与图标由中继下发，对所有设备生效。
 *
 * 品牌不是关键路径：网络失败时退回 localStorage 缓存，再退回 Tada；
 * 任何函数都不应该因为品牌问题把界面打挂。
 */

export const DEFAULT_APP_NAME = 'Tada';
const DEFAULT_BRANDING: BrandingState = {
  appName: DEFAULT_APP_NAME,
  iconVersion: null,
  hasCustomIcon: false,
};
const CACHE_KEY = 'tada.branding';

export interface BrandingState {
  appName: string;
  iconVersion: string | null;
  hasCustomIcon: boolean;
}

/* ------------------------------------------------------------------ *
 * 缓存：离线启动时兜底
 * ------------------------------------------------------------------ */

export function getCachedBranding(): BrandingState {
  try {
    const raw = readStorage(CACHE_KEY);
    if (!raw) return DEFAULT_BRANDING;
    return normalizeBranding(JSON.parse(raw) as unknown, DEFAULT_BRANDING);
  } catch {
    // 隐私模式 / 损坏的 JSON：静默退回默认值
    return DEFAULT_BRANDING;
  }
}

export function setCachedBranding(branding: BrandingState): void {
  current = branding;
  writeStorage(CACHE_KEY, JSON.stringify(branding));
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------------ *
 * 拉取与应用
 * ------------------------------------------------------------------ */

/**
 * 读取远端品牌；失败返回缓存值或默认值，绝不抛错。
 * 真正的 HTTP 调用在 sync/api.ts，这里只负责缓存与降级。
 */
export async function fetchBranding(): Promise<BrandingState> {
  const fallback = getCachedBranding();
  try {
    return normalizeBranding(await fetchRemoteBranding(), fallback);
  } catch (error) {
    console.warn('读取实例品牌失败，使用本地缓存', error);
    return fallback;
  }
}

/** 把品牌应用到当前文档：标题、两个 meta、apple-touch-icon 与 favicon。 */
export function applyBrandingToDocument(branding: BrandingState): void {
  if (typeof document === 'undefined') return;

  document.title = branding.appName;
  upsertMeta('apple-mobile-web-app-title', branding.appName);
  upsertMeta('application-name', branding.appName);

  const hasCustom = branding.hasCustomIcon && branding.iconVersion !== null;
  const touchIcon = hasCustom
    ? brandIconUrl(192, branding.iconVersion ?? '')
    : '/apple-touch-icon.png';
  upsertLink('apple-touch-icon', touchIcon, hasCustom ? 'image/png' : undefined);

  if (hasCustom) {
    upsertLink('icon', touchIcon, 'image/png');
  } else {
    upsertLink('icon', '/favicon.svg', 'image/svg+xml');
  }
}

export function brandIconUrl(size: 192 | 512, version: string): string {
  return `/branding/icon-${size}.png?v=${encodeURIComponent(version)}`;
}

/* ------------------------------------------------------------------ *
 * React 订阅：useSyncExternalStore
 * ------------------------------------------------------------------ */

let current: BrandingState = getCachedBranding();
const listeners = new Set<() => void>();
let initPromise: Promise<void> | null = null;

export function getBrandingSnapshot(): BrandingState {
  return current;
}

export function subscribeBranding(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 幂等：多个组件同时调用也只发一次请求。 */
export function initBranding(): Promise<void> {
  if (!initPromise) {
    initPromise = fetchBranding().then((branding) => {
      setCachedBranding(branding);
      applyBrandingToDocument(branding);
    });
  }
  return initPromise;
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

function normalizeBranding(value: unknown, fallback: BrandingState): BrandingState {
  if (typeof value !== 'object' || value === null) return fallback;

  const candidate = value as Partial<BrandingState>;
  const appName =
    typeof candidate.appName === 'string' && candidate.appName.trim() !== ''
      ? candidate.appName
      : fallback.appName;
  const iconVersion =
    typeof candidate.iconVersion === 'string' && candidate.iconVersion !== ''
      ? candidate.iconVersion
      : null;

  return {
    appName,
    iconVersion,
    hasCustomIcon: candidate.hasCustomIcon === true && iconVersion !== null,
  };
}

function upsertMeta(name: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('name', name);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function upsertLink(rel: string, href: string, type?: string): void {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
  if (type) {
    element.setAttribute('type', type);
  } else {
    element.removeAttribute('type');
  }
}

function readStorage(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    // 隐私模式可能禁止写入；缓存只是兜底，写失败不影响使用
  }
}
