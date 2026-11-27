import { HEX_COLOR_RE } from '@tada/shared';
import type { MessageKey } from './i18n';

/** 列表颜色候选：null 表示跟随主题的中性色；名称按界面语言翻译 */
export const LIST_COLORS: { value: string | null; labelKey: MessageKey }[] = [
  { value: null, labelKey: 'colors.default' },
  { value: '#e5484d', labelKey: 'colors.red' },
  { value: '#f76b15', labelKey: 'colors.orange' },
  { value: '#f5b400', labelKey: 'colors.yellow' },
  { value: '#2f9e44', labelKey: 'colors.green' },
  { value: '#0ea5e9', labelKey: 'colors.blue' },
  { value: '#3b5bdb', labelKey: 'colors.indigo' },
  { value: '#9c36b5', labelKey: 'colors.purple' },
  { value: '#868e96', labelKey: 'colors.gray' },
];

/** 默认色点：跟随主题的中性色 */
export const DEFAULT_DOT_COLOR = 'var(--dot-default)';

/**
 * 渲染前先做白名单校验：只有 `#RRGGBB` 才允许进入 style。
 *
 * 颜色来自同步数据，理论上可能被任意客户端写入；直接拼进 CSS 会让
 * 非法值（`url(...)`、`expression(...)`）变成样式注入或渲染异常。
 */
export function sanitizeColor(color: string | null | undefined): string | null {
  if (typeof color !== 'string') return null;
  return HEX_COLOR_RE.test(color) ? color : null;
}

export function listColor(color: string | null | undefined): string {
  return sanitizeColor(color) ?? DEFAULT_DOT_COLOR;
}
