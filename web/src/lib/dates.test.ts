import { describe, expect, it } from 'vitest';
import { formatDue, formatLastSync, isOverdue, shiftIsoDate } from './dates';

const TODAY = '2026-03-08';

describe('截止日期文案', () => {
  it('中文：今天 / 明天 / 昨天 / 月日 / 年月日', () => {
    expect(formatDue(TODAY, TODAY, 'zh')).toBe('今天');
    expect(formatDue(shiftIsoDate(TODAY, 1), TODAY, 'zh')).toBe('明天');
    expect(formatDue(shiftIsoDate(TODAY, -1), TODAY, 'zh')).toBe('昨天');
    expect(formatDue('2026-03-10', TODAY, 'zh')).toBe('3月10日');
    expect(formatDue('2027-01-01', TODAY, 'zh')).toBe('2027年1月1日');
  });

  it('英文：Today / Tomorrow / Yesterday / Mar 10 / Jan 1, 2027', () => {
    expect(formatDue(TODAY, TODAY, 'en')).toBe('Today');
    expect(formatDue(shiftIsoDate(TODAY, 1), TODAY, 'en')).toBe('Tomorrow');
    expect(formatDue(shiftIsoDate(TODAY, -1), TODAY, 'en')).toBe('Yesterday');
    expect(formatDue('2026-03-10', TODAY, 'en')).toBe('Mar 10');
    expect(formatDue('2027-01-01', TODAY, 'en')).toBe('Jan 1, 2027');
  });

  it('无法解析的日期原样返回', () => {
    expect(formatDue('not-a-date', TODAY, 'en')).toBe('not-a-date');
  });

  it('逾期判断不受语言影响', () => {
    expect(isOverdue('2026-03-07', TODAY)).toBe(true);
    expect(isOverdue(TODAY, TODAY)).toBe(false);
    expect(isOverdue(null, TODAY)).toBe(false);
  });
});

describe('上次同步文案', () => {
  it('没有记录时按语言显示', () => {
    expect(formatLastSync(null, 'zh')).toBe('尚未同步');
    expect(formatLastSync(null, 'en')).toBe('Not synced yet');
    expect(formatLastSync('not-a-date', 'en')).toBe('Not synced yet');
  });
});
