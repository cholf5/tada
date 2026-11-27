import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ICONS,
  CLASSIC_DEFAULT,
  CLASSIC_PRESETS,
  classicIconSvg,
  contrastRatio,
  isHexColor,
} from './builtinIcons';

describe('内置图标', () => {
  it('包含第二版全部图标和经典对勾', () => {
    expect(BUILTIN_ICONS.map((icon) => icon.id)).toEqual([
      'signet',
      'seal',
      'notebook',
      'ribbon',
      'enamel',
      'classic',
    ]);
    expect(new Set(BUILTIN_ICONS.map((icon) => icon.id)).size).toBe(BUILTIN_ICONS.length);
  });

  it('默认图标是签名火漆，材质图标都带 512 PNG', () => {
    expect(BUILTIN_ICONS[0]?.kind).toBe('default');
    for (const icon of BUILTIN_ICONS) {
      if (icon.kind === 'asset') {
        expect(icon.pngUrl).toBeTruthy();
        expect(icon.preview).toBeTruthy();
      }
    }
  });

  it('经典对勾按传入颜色生成 SVG', () => {
    const svg = classicIconSvg('#F5B400', '#17181C');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('fill="#F5B400"');
    expect(svg).toContain('stroke="#17181C"');
    expect(svg).toContain('stroke-width="158"');
    expect(svg).not.toContain('<text');
  });

  it('非法颜色回退到默认值，避免拼进 SVG', () => {
    const svg = classicIconSvg('url(https://evil.example)', 'red');
    expect(svg).toContain(`fill="${CLASSIC_DEFAULT.plate}"`);
    expect(svg).toContain(`stroke="${CLASSIC_DEFAULT.mark}"`);
    expect(svg).not.toContain('evil.example');
  });

  it('第一版的四个配色收敛成色板', () => {
    expect(CLASSIC_PRESETS).toHaveLength(4);
    expect(CLASSIC_PRESETS.map((item) => item.labelKey)).toEqual([
      'branding.preset.goldInk',
      'branding.preset.navyGold',
      'branding.preset.blueGold',
      'branding.preset.blueWhite',
    ]);
  });

  it('只接受 #RRGGBB', () => {
    expect(isHexColor('#ABCDEF')).toBe(true);
    for (const value of ['#fff', 'red', 'url(x)', '#12345g', '']) {
      expect(isHexColor(value)).toBe(false);
    }
  });

  it('对比度：黑白 21，同色 1，非法颜色 1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#2563EB', '#2563EB')).toBeCloseTo(1, 5);
    expect(contrastRatio('red', '#FFFFFF')).toBe(1);
  });
});
