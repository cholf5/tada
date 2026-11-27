import { useSyncExternalStore } from 'react';
import {
  getBrandingSnapshot,
  subscribeBranding,
  type BrandingState,
} from '../lib/branding';

/** 订阅中继下发的实例品牌；初始化由 App 启动时调用 initBranding。 */
export function useBranding(): BrandingState {
  return useSyncExternalStore(
    subscribeBranding,
    getBrandingSnapshot,
    getBrandingSnapshot,
  );
}
