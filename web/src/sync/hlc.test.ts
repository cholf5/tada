import { describe, expect, it } from 'vitest';
import { HLC_RE, createHlcClock, parseHlc } from '@tada/shared';

describe('HLC', () => {
  it('同一毫秒内严格递增', () => {
    const clock = createHlcClock('dev1');
    const first = clock.next(1000);
    const second = clock.next(1000);

    expect(second > first).toBe(true);
    expect(parseHlc(first).counter).toBe(0);
    expect(parseHlc(second).counter).toBe(1);
    expect(parseHlc(second).ms).toBe(1000);
  });

  it('跨毫秒单调递增，计数器归零', () => {
    const clock = createHlcClock('dev1');
    const first = clock.next(1000);
    const second = clock.next(2000);

    expect(second > first).toBe(true);
    expect(parseHlc(second).ms).toBe(2000);
    expect(parseHlc(second).counter).toBe(0);
  });

  it('时间回拨时仍严格递增', () => {
    const clock = createHlcClock('dev1');
    const first = clock.next(5000);
    const second = clock.next(4000);

    expect(second > first).toBe(true);
    expect(parseHlc(second).ms).toBe(5000);
    expect(parseHlc(second).counter).toBe(1);
  });

  it('编码格式符合 HLC_RE', () => {
    const clock = createHlcClock('dev1');
    expect(clock.next(0)).toMatch(HLC_RE);
    expect(clock.next(Date.now())).toMatch(HLC_RE);
  });
});
