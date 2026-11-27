import { HEX_COLOR_RE } from '@tada/shared';
import enamelPng from '../assets/brand-icons/enamel.png';
import notebookPng from '../assets/brand-icons/notebook.png';
import ribbonPng from '../assets/brand-icons/ribbon.png';
import sealPng from '../assets/brand-icons/seal.png';

/**
 * 内置图标：材质类图标在构建时已经烘焙成 512 PNG，选择后走与上传图标
 * 完全相同的 `/api/branding` 接口；这样不需要改中继、D1 或 API 契约。
 *
 * 「经典对勾」是唯一的可调色形状：浏览器本地生成 SVG 再栅格化成 PNG。
 */

export type BuiltinIconId =
  | 'signet'
  | 'seal'
  | 'notebook'
  | 'ribbon'
  | 'enamel'
  | 'classic';

export interface BuiltinIcon {
  id: BuiltinIconId;
  label: string;
  hint?: string;
  kind: 'default' | 'asset' | 'classic';
  /** 预览图；classic 由 UI 用当前颜色生成 */
  preview: string;
  /** kind=asset 时的 512 PNG URL */
  pngUrl?: string;
}

export const BUILTIN_ICONS: BuiltinIcon[] = [
  {
    id: 'signet',
    label: '签名火漆',
    hint: '默认',
    kind: 'default',
    preview: '/icons/icon-192.png',
  },
  {
    id: 'seal',
    label: '火漆印',
    kind: 'asset',
    preview: sealPng,
    pngUrl: sealPng,
  },
  {
    id: 'notebook',
    label: '笔记本',
    kind: 'asset',
    preview: notebookPng,
    pngUrl: notebookPng,
  },
  {
    id: 'ribbon',
    label: '纸与丝带',
    kind: 'asset',
    preview: ribbonPng,
    pngUrl: ribbonPng,
  },
  {
    id: 'enamel',
    label: '珐琅勾',
    kind: 'asset',
    preview: enamelPng,
    pngUrl: enamelPng,
  },
  {
    id: 'classic',
    label: '经典对勾',
    hint: '可改色',
    kind: 'classic',
    preview: '',
  },
];

export interface ClassicColors {
  plate: string;
  mark: string;
}

export const CLASSIC_DEFAULT: ClassicColors = {
  plate: '#2563EB',
  mark: '#FFFFFF',
};

/** 第一版里那四个同形状、不同配色的版本，合并成色板。 */
export const CLASSIC_PRESETS: { label: string; colors: ClassicColors }[] = [
  { label: '金底墨勾', colors: { plate: '#F5B400', mark: '#17181C' } },
  { label: '深蓝金勾', colors: { plate: '#16213E', mark: '#F5B400' } },
  { label: '品牌蓝金勾', colors: { plate: '#2563EB', mark: '#F5B400' } },
  { label: '品牌蓝白勾', colors: { plate: '#2563EB', mark: '#FFFFFF' } },
];

/** 与第一版 A 相同的对勾，按墨迹包围盒居中到 1024 画布。 */
const CLASSIC_CHECK_PATH = 'M 296 527 L 431 662 L 729 362';

export function isHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

function safeColor(value: string, fallback: string): string {
  return isHexColor(value) ? value : fallback;
}

export function classicIconSvg(plate: string, mark: string): string {
  const plateColor = safeColor(plate, CLASSIC_DEFAULT.plate);
  const markColor = safeColor(mark, CLASSIC_DEFAULT.mark);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">` +
    `<rect width="1024" height="1024" fill="${plateColor}"/>` +
    `<path d="${CLASSIC_CHECK_PATH}" fill="none" stroke="${markColor}" stroke-width="158" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

/** SVG 转 data URL；只用于 <img> 预览，SVG 内容来自本地模板或打包资源。 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function classicPreview(plate: string, mark: string): string {
  return svgDataUrl(classicIconSvg(plate, mark));
}

/* ------------------------------------------------------------------ *
 * 可读性：颜色对比度太低时提示，但不阻止保存
 * ------------------------------------------------------------------ */

function channelToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = channelToLinear(parseInt(hex.slice(1, 3), 16));
  const g = channelToLinear(parseInt(hex.slice(3, 5), 16));
  const b = channelToLinear(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度；非法颜色按 1 处理（等于没有对比）。 */
export function contrastRatio(a: string, b: string): number {
  if (!isHexColor(a) || !isHexColor(b)) return 1;
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}
