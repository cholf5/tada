import { describe, expect, it } from 'vitest';
import { compareHlc, isNewer } from './lww';

describe('LWW', () => {
  it('新 HLC 覆盖旧 HLC', () => {
    expect(isNewer('0000000001000-00000-dev1', '0000000000999-00000-dev1')).toBe(true);
  });

  it('旧 HLC 被忽略', () => {
    expect(isNewer('0000000000999-00000-dev1', '0000000001000-00000-dev1')).toBe(false);
  });

  it('相等不写', () => {
    const hlc = '0000000001000-00003-dev1';
    expect(isNewer(hlc, hlc)).toBe(false);
    expect(compareHlc(hlc, hlc)).toBe(0);
  });

  it('字典序即时间序', () => {
    const values = [
      '0000000001000-00000-dev1',
      '0000000001000-00001-dev1',
      '0000000001001-00000-dev1',
      '0000000010000-00000-dev1',
    ];
    const sorted = [...values].sort();
    expect(sorted).toEqual(values);
  });
});
