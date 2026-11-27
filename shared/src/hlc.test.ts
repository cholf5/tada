import { describe, expect, it } from 'vitest';
import { HLC_RE, createHlcClock, formatHlc, parseHlc } from './hlc';

describe('HLC 编码', () => {
  it('毫秒补足 13 位、计数器补足 5 位，字典序即时间序', () => {
    expect(formatHlc({ ms: 0, counter: 0, device: 'dev1' })).toBe('0000000000000-00000-dev1');
    expect(formatHlc({ ms: 1760000000000, counter: 7, device: 'dev1' })).toBe(
      '1760000000000-00007-dev1',
    );
    expect(formatHlc({ ms: 1000, counter: 0, device: 'dev1' }).slice(0, 13)).toBe('0000000001000');
  });

  it('编码结果匹配 HLC_RE', () => {
    expect(formatHlc({ ms: 123, counter: 45, device: 'a-b_c' })).toMatch(HLC_RE);
  });

  it('非法的毫秒 / 计数器 / 设备段会抛错', () => {
    expect(() => formatHlc({ ms: -1, counter: 0, device: 'dev1' })).toThrow(RangeError);
    expect(() => formatHlc({ ms: 1.5, counter: 0, device: 'dev1' })).toThrow(RangeError);
    expect(() => formatHlc({ ms: 0, counter: -1, device: 'dev1' })).toThrow(RangeError);
    expect(() => formatHlc({ ms: 0, counter: 100_000, device: 'dev1' })).toThrow(RangeError);
    expect(() => formatHlc({ ms: 0, counter: 0, device: 'ab' })).toThrow(RangeError);
    expect(() => formatHlc({ ms: 0, counter: 0, device: 'bad!' })).toThrow(RangeError);
  });
});

describe('HLC 解析', () => {
  it('解析与编码可往返', () => {
    const parts = { ms: 1760000001234, counter: 99, device: 'dev1' };
    expect(parseHlc(formatHlc(parts))).toEqual(parts);
  });

  it('拒绝格式不对的字符串', () => {
    expect(() => parseHlc('not-a-hlc')).toThrow(SyntaxError);
    expect(() => parseHlc('0000000001000-00000')).toThrow(SyntaxError);
    expect(() => parseHlc('1000-0-dev1')).toThrow(SyntaxError);
  });
});

describe('HLC 比较', () => {
  it('毫秒优先，其次计数器', () => {
    const values = [
      formatHlc({ ms: 999, counter: 99_999, device: 'dev1' }),
      formatHlc({ ms: 1000, counter: 0, device: 'dev1' }),
      formatHlc({ ms: 1000, counter: 1, device: 'dev1' }),
      formatHlc({ ms: 2000, counter: 0, device: 'dev1' }),
    ];
    expect([...values].sort()).toEqual(values);
  });

  it('设备段只作为最后的区分，不影响更早的字段', () => {
    expect(
      formatHlc({ ms: 1000, counter: 1, device: 'aaaa' }) >
        formatHlc({ ms: 1000, counter: 0, device: 'zzzz' }),
    ).toBe(true);
  });
});

describe('createHlcClock', () => {
  it('同一毫秒内严格递增，计数器递增', () => {
    const clock = createHlcClock('dev1');
    const first = clock.next(1000);
    const second = clock.next(1000);
    expect(second > first).toBe(true);
    expect(parseHlc(first).counter).toBe(0);
    expect(parseHlc(second).counter).toBe(1);
  });

  it('跨毫秒计数器归零', () => {
    const clock = createHlcClock('dev1');
    clock.next(1000);
    const next = clock.next(2000);
    expect(parseHlc(next)).toEqual({ ms: 2000, counter: 0, device: 'dev1' });
  });

  it('系统时间回拨时仍然严格递增', () => {
    const clock = createHlcClock('dev1');
    const first = clock.next(5000);
    const second = clock.next(4000);
    expect(second > first).toBe(true);
    expect(parseHlc(second)).toEqual({ ms: 5000, counter: 1, device: 'dev1' });
  });

  it('每次产出都是合法 HLC', () => {
    const clock = createHlcClock('dev1');
    for (let i = 0; i < 20; i += 1) expect(clock.next(1000)).toMatch(HLC_RE);
  });
});
