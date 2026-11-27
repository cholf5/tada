/**
 * 行级 LWW 的唯一判据：严格大于才覆盖。
 * HLC 是定宽字符串，字典序即时间序，直接比较即可。
 */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 远端 / 新写入是否比本地版本更新（相等视为不写） */
export function isNewer(incomingHlc: string, localHlc: string): boolean {
  return compareHlc(incomingHlc, localHlc) > 0;
}
