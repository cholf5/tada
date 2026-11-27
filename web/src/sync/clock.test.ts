import { HLC_RE, formatHlc } from '@tada/shared';
import { describe, expect, it } from 'vitest';
import { hlcDeviceId, hlcDeviceTag } from '../lib/ids';
import { createPersistentClock } from './clock';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('持久化 HLC 时钟', () => {
  it('设备段从 uuid 派生且不超过 32 字符', () => {
    const device = hlcDeviceId(UUID);
    expect(device.length).toBeGreaterThanOrEqual(4);
    expect(device.length).toBeLessThanOrEqual(32);
    expect(device).toMatch(/^[A-Za-z0-9_-]{4,32}$/);

    const clock = createPersistentClock({ device });
    expect(clock.next(1)).toMatch(HLC_RE);
    expect(formatHlc({ ms: 1, counter: 0, device })).toMatch(HLC_RE);
  });

  it('每个页面（标签页）的设备后缀不同', () => {
    expect(hlcDeviceId(UUID)).not.toBe(hlcDeviceId(UUID));
    expect(hlcDeviceTag(UUID)).toMatch(/^[A-Za-z0-9_-]{4,32}$/);
  });

  it('设备段 = 安装级 12 位前缀 + 每页 5 位随机后缀（P12）', () => {
    const prefix = hlcDeviceTag(UUID);
    const device = hlcDeviceId(UUID);

    expect(prefix).toHaveLength(12);
    expect(device.startsWith(`${prefix}-`)).toBe(true);
    expect(device.slice(prefix.length + 1)).toHaveLength(5);
    expect(device).toMatch(/^[A-Za-z0-9_-]{4,32}$/);
  });

  it('observe 远端 HLC 后，本地 next 严格大于它', () => {
    const clock = createPersistentClock({ device: 'tab1' });
    const remote = '0000000009000-00042-other';
    clock.observe(remote);

    // 模拟本机系统时间比远端慢很多
    const local = clock.next(1000);
    expect(local > remote).toBe(true);
    expect(clock.current().ms).toBe(9000);
  });

  it('用 initialHlc 起步，系统时间回拨也不倒退', () => {
    const initial = '0000000050000-00007-tab1';
    const clock = createPersistentClock({ device: 'tab1', initialHlc: initial });
    const next = clock.next(1000);
    expect(next > initial).toBe(true);
  });

  it('损坏的 initialHlc 不会让时钟崩溃', () => {
    const clock = createPersistentClock({ device: 'tab1', initialHlc: 'not-a-hlc' });
    expect(clock.next(5)).toMatch(HLC_RE);
  });

  it('每次产出都会持久化水位', () => {
    const persisted: string[] = [];
    const clock = createPersistentClock({
      device: 'tab1',
      persist: (hlc) => persisted.push(hlc),
    });

    const hlc = clock.next(1234);
    expect(persisted).toContain(hlc);

    clock.observe('0000000099999-00003-other');
    expect(persisted.length).toBeGreaterThanOrEqual(2);
  });
});
