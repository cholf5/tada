import { describe, expect, it } from 'vitest';
import {
  applyThemeMode,
  readStoredThemeMode,
  resolveTheme,
  themeAttribute,
  writeStoredThemeMode,
  type ThemeRoot,
} from './theme';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function fakeRoot() {
  const attributes = new Map<string, string>();
  const root: ThemeRoot = {
    setAttribute: (name, value) => {
      attributes.set(name, value);
    },
    removeAttribute: (name) => {
      attributes.delete(name);
    },
  };
  return { root, attributes };
}

describe('外观模式', () => {
  it('没有保存时默认跟随系统', () => {
    expect(readStoredThemeMode(fakeStorage())).toBe('system');
  });

  it('读取合法的三档值', () => {
    for (const mode of ['system', 'light', 'dark'] as const) {
      expect(readStoredThemeMode(fakeStorage({ 'tada.theme': mode }))).toBe(mode);
    }
  });

  it('非法值回退到跟随系统', () => {
    expect(readStoredThemeMode(fakeStorage({ 'tada.theme': 'blue' }))).toBe('system');
    expect(readStoredThemeMode(fakeStorage({ 'tada.theme': '' }))).toBe('system');
  });

  it('存储不可用或读取出错时回退到跟随系统', () => {
    expect(readStoredThemeMode(null)).toBe('system');
    expect(
      readStoredThemeMode({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toBe('system');
  });

  it('跟随系统不写 data-theme，手动模式写对应值', () => {
    expect(themeAttribute('system')).toBeNull();
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });

  it('手动模式优先于系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('applyThemeMode 设置属性，切回跟随系统时移除', () => {
    const { root, attributes } = fakeRoot();
    applyThemeMode('dark', root);
    expect(attributes.get('data-theme')).toBe('dark');
    applyThemeMode('light', root);
    expect(attributes.get('data-theme')).toBe('light');
    applyThemeMode('system', root);
    expect(attributes.has('data-theme')).toBe(false);
  });

  it('写入模式会覆盖旧值', () => {
    const storage = fakeStorage({ 'tada.theme': 'system' });
    writeStoredThemeMode('dark', storage);
    expect(readStoredThemeMode(storage)).toBe('dark');
  });

  it('写入失败不抛错', () => {
    expect(() =>
      writeStoredThemeMode('dark', {
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).not.toThrow();
  });
});
