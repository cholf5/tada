import { describe, expect, it } from 'vitest';
import { DEFAULT_DOT_COLOR, listColor, sanitizeColor } from './colors';

/** P8：颜色来自同步数据，进入 style 前必须过 hex 白名单。 */
describe('颜色白名单', () => {
  it('只放行 #RRGGBB', () => {
    expect(sanitizeColor('#e5484d')).toBe('#e5484d');
    expect(sanitizeColor('#ABCDEF')).toBe('#ABCDEF');
  });

  it('非法值一律回退为 null', () => {
    for (const value of [
      '#fff',
      'red',
      'rgb(0,0,0)',
      'url(https://evil.example/x)',
      'expression(alert(1))',
      'var(--dot-default)',
      '#12345g',
      '',
      null,
      undefined,
    ]) {
      expect(sanitizeColor(value)).toBeNull();
    }
  });

  it('渲染 helper 对非法值使用默认色', () => {
    expect(listColor(null)).toBe(DEFAULT_DOT_COLOR);
    expect(listColor('#e5484d')).toBe('#e5484d');
    expect(listColor('url(https://evil.example/x)')).toBe(DEFAULT_DOT_COLOR);
  });
});
