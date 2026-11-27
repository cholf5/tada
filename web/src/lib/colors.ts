import { HEX_COLOR_RE } from '@tada/shared';

/** 列表颜色候选：null 表示跟随主题的中性色 */
export const LIST_COLORS: { value: string | null; label: string }[] = [
  { value: null, label: '默认' },
  { value: '#e5484d', label: '红色' },
  { value: '#f76b15', label: '橙色' },
  { value: '#f5b400', label: '黄色' },
  { value: '#2f9e44', label: '绿色' },
  { value: '#0ea5e9', label: '蓝色' },
  { value: '#3b5bdb', label: '靛蓝' },
  { value: '#9c36b5', label: '紫色' },
  { value: '#868e96', label: '灰色' },
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
