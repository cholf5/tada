/**
 * Hybrid Logical Clock
 *
 * 编码成固定宽度字符串，字典序 == 时间序，服务端不需要解析，直接比较。
 *
 *   1760000000000-00001-dev1
 *   └─ 13 位毫秒 ─┘ └计数器┘ └设备号┘
 */

export const HLC_RE = /^\d{13}-\d{5}-[A-Za-z0-9_-]{4,32}$/;

export interface HlcParts {
  ms: number;
  counter: number;
  device: string;
}

export function formatHlc({ ms, counter, device }: HlcParts): string {
  if (!Number.isInteger(ms) || ms < 0) throw new RangeError('hlc.ms must be a non-negative integer');
  if (!Number.isInteger(counter) || counter < 0 || counter > 99_999) {
    throw new RangeError('hlc.counter must be within 0..99999');
  }
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(device)) throw new RangeError('hlc.device has invalid characters');

  return `${String(ms).padStart(13, '0')}-${String(counter).padStart(5, '0')}-${device}`;
}

export function parseHlc(value: string): HlcParts {
  const match = /^(\d{13})-(\d{5})-(.+)$/.exec(value);
  if (!match) throw new SyntaxError(`invalid hlc: ${value}`);
  return { ms: Number(match[1]), counter: Number(match[2]), device: match[3]! };
}

/**
 * 单调递增的本地时钟。
 *
 * 同一毫秒内多次改动靠 counter 递增，保证后写的一定大于先写的；
 * 系统时间被回拨时也不会产出更小的值。
 */
export function createHlcClock(device: string) {
  let lastMs = 0;
  let counter = 0;

  return {
    /** 生成一个严格大于本设备此前所有值的 HLC */
    next(now: number = Date.now()): string {
      if (now > lastMs) {
        lastMs = now;
        counter = 0;
      } else {
        counter += 1;
        // 同一毫秒内超过 10 万个改动是极不正常的，退化为推进毫秒
        if (counter > 99_999) {
          lastMs += 1;
          counter = 0;
        }
      }
      return formatHlc({ ms: lastMs, counter, device });
    },
  };
}
