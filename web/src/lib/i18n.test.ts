import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MESSAGES,
  applyLangToDocument,
  detectSystemLang,
  getLang,
  getLangMode,
  readStoredLangMode,
  resolveLang,
  setLangMode,
  subscribeLang,
  t,
  translate,
  writeStoredLangMode,
  type MessageKey,
} from './i18n';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    dump: () => map,
  };
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

afterEach(() => {
  // 模块级语言状态在同一个测试文件内共享，跑完恢复默认中文，
  // 避免影响后续用例（尤其是惰性读取当前语言的 t()）。
  setLangMode('system');
  vi.unstubAllGlobals();
});

describe('词表', () => {
  it('中英文词条一一对应，占位符完全一致，且没有空文案', () => {
    const keys = Object.keys(MESSAGES.zh) as MessageKey[];
    expect(Object.keys(MESSAGES.en).sort()).toEqual(keys.sort());
    for (const key of keys) {
      expect(MESSAGES.zh[key].trim(), `空文案：${key}`).not.toBe('');
      expect(MESSAGES.en[key].trim(), `空文案：${key}`).not.toBe('');
      expect(placeholders(MESSAGES.en[key]), `占位符不一致：${key}`).toEqual(
        placeholders(MESSAGES.zh[key]),
      );
    }
  });

  it('插值替换 {name}，缺省占位符原样保留', () => {
    expect(translate('zh', 'today.count', { count: 3 })).toBe('3 个到期');
    expect(translate('en', 'today.count', { count: 3 })).toBe('3 due');
    expect(translate('en', 'search.title', { query: 'milk' })).toBe('Search “milk”');
    expect(translate('en', 'today.count')).toBe('{count} due');
  });
});

describe('语言解析', () => {
  it('显式选择直接生效', () => {
    expect(resolveLang('zh')).toBe('zh');
    expect(resolveLang('en')).toBe('en');
  });

  it('没有 window（测试 / SSR）时跟随系统固定中文', () => {
    expect(detectSystemLang()).toBe('zh');
  });

  it('跟随系统按浏览器首选语言：zh 开头中文，其余英文', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { languages: ['zh-Hant'], language: 'zh-Hant' });
    expect(detectSystemLang()).toBe('zh');

    vi.stubGlobal('navigator', { languages: ['en-GB'], language: 'en-GB' });
    expect(detectSystemLang()).toBe('en');
  });

  it('把语言写到 <html lang>', () => {
    const root = { lang: '' };
    applyLangToDocument('zh', root);
    expect(root.lang).toBe('zh-CN');
    applyLangToDocument('en', root);
    expect(root.lang).toBe('en');
    applyLangToDocument('en', null);
  });
});

describe('本机存储', () => {
  it('读取合法值，非法或缺失回退跟随系统', () => {
    expect(readStoredLangMode(memoryStorage({ 'tada.lang': 'en' }))).toBe('en');
    expect(readStoredLangMode(memoryStorage({ 'tada.lang': 'zh' }))).toBe('zh');
    expect(readStoredLangMode(memoryStorage({ 'tada.lang': 'system' }))).toBe('system');
    expect(readStoredLangMode(memoryStorage({ 'tada.lang': 'fr' }))).toBe('system');
    expect(readStoredLangMode(memoryStorage())).toBe('system');
    expect(readStoredLangMode(null)).toBe('system');
  });

  it('写入失败不抛错', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => writeStoredLangMode('en', storage)).not.toThrow();
  });

  it('写入后再读回同一个模式', () => {
    const storage = memoryStorage();
    writeStoredLangMode('en', storage);
    expect(readStoredLangMode(storage)).toBe('en');
  });
});

describe('切换语言', () => {
  it('setLangMode 更新当前语言并通知订阅者', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeLang(() => seen.push(getLang()));

    setLangMode('en');
    expect(getLangMode()).toBe('en');
    expect(getLang()).toBe('en');
    expect(t('nav.today')).toBe('Today');
    expect(seen).toEqual(['en']);

    // 解析结果没变时不重复通知
    setLangMode('en');
    expect(seen).toEqual(['en']);

    unsubscribe();
    setLangMode('zh');
    expect(seen).toEqual(['en']);
  });
});
