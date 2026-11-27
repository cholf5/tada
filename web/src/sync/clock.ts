import { formatHlc, parseHlc } from '@tada/shared';

export interface PersistentClock {
  /** 生成一个严格大于本设备此前所有值、且大于任何已 observe 的远端值的 HLC */
  next(now?: number): string;
  /** 把远端拉到的 HLC 回灌进本地时钟 */
  observe(hlc: string): void;
  /** 当前水位（不含设备后缀），调试用 */
  current(): { ms: number; counter: number };
}

/**
 * 可持久化的 HLC 时钟。
 *
 * 相比 `createHlcClock` 多了两件事：
 * 1. `observe()`：pull 到远端 change 后把水位抬到不低于 incoming.hlc，
 *    否则本机系统时间慢时，编辑会用更旧的 HLC 被对端静默丢弃。
 * 2. 每次产出都通过 `persist` 落盘；启动时用 `initialHlc` 初始化水位，
 *    这样页面重载 / 系统时间回拨也不会写出更旧的值。
 */
export function createPersistentClock(options: {
  device: string;
  initialHlc?: string | null;
  persist?: (hlc: string) => void;
}): PersistentClock {
  let ms = 0;
  let counter = 0;

  if (options.initialHlc) {
    try {
      const parts = parseHlc(options.initialHlc);
      ms = parts.ms;
      counter = parts.counter;
    } catch {
      // 损坏的 meta 值直接忽略，从 0 开始
    }
  }

  const emit = (): string => {
    const value = formatHlc({ ms, counter, device: options.device });
    options.persist?.(value);
    return value;
  };

  return {
    next(now: number = Date.now()): string {
      if (now > ms) {
        ms = now;
        counter = 0;
      } else {
        counter += 1;
        if (counter > 99_999) {
          ms += 1;
          counter = 0;
        }
      }
      return emit();
    },

    observe(value: string): void {
      let parts: { ms: number; counter: number };
      try {
        parts = parseHlc(value);
      } catch {
        return;
      }
      if (parts.ms > ms || (parts.ms === ms && parts.counter > counter)) {
        ms = parts.ms;
        counter = parts.counter;
        // 把抬高后的水位也落盘，重载后仍然有效
        options.persist?.(formatHlc({ ms, counter, device: options.device }));
      }
    },

    current(): { ms: number; counter: number } {
      return { ms, counter };
    },
  };
}
