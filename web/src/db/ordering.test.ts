import { describe, expect, it } from 'vitest';
import { keyAtEnd, keyAtStart, keyBetween } from '../db/ordering';

describe('fractional order key', () => {
  it('空列表生成第一个键', () => {
    expect(keyAtStart(null)).toBe('a0');
    expect(keyAtEnd(null)).toBe('a0');
  });

  it('头部插入的键比起始键小', () => {
    const first = keyAtStart(null);
    const head = keyAtStart(first);
    expect(head < first).toBe(true);
  });

  it('尾部插入的键比末尾键大', () => {
    const first = keyAtEnd(null);
    const last = keyAtEnd(first);
    expect(last > first).toBe(true);
  });

  it('中间插入的键严格落在两者之间', () => {
    const low = 'a0';
    const high = 'a1';
    const middle = keyBetween(low, high);
    expect(middle > low).toBe(true);
    expect(middle < high).toBe(true);
  });

  it('连续在头部插入始终按倒序排列', () => {
    let cursor: string | null = null;
    const inserted: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      cursor = keyAtStart(cursor);
      inserted.push(cursor);
    }

    expect([...inserted].sort()).toEqual([...inserted].reverse());
    expect(new Set(inserted).size).toBe(inserted.length);
  });

  it('连续在尾部追加始终按正序排列', () => {
    let cursor: string | null = null;
    const appended: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      cursor = keyAtEnd(cursor);
      appended.push(cursor);
    }

    expect([...appended].sort()).toEqual(appended);
  });
});
