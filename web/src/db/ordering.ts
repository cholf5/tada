import { generateKeyBetween } from 'fractional-indexing';

/**
 * 排序键统一走 fractional-indexing：任意两行之间都能再生一个键，
 * 拖拽只需要改被移动的那一行。
 */

/** 插到最前面（比现有最小键还小；没有行时生成首个键） */
export function keyAtStart(firstKey: string | null | undefined): string {
  return generateKeyBetween(null, firstKey ?? null);
}

/** 追加到最后（比现有最大键还大；没有行时生成首个键） */
export function keyAtEnd(lastKey: string | null | undefined): string {
  return generateKeyBetween(lastKey ?? null, null);
}

/** 插到两个相邻行之间 */
export function keyBetween(
  previousKey: string | null | undefined,
  nextKey: string | null | undefined,
): string {
  return generateKeyBetween(previousKey ?? null, nextKey ?? null);
}

/** 一组 orderKey 里的最小 / 最大值 */
export function minKey(keys: readonly string[]): string | null {
  let min: string | null = null;
  for (const key of keys) {
    if (min === null || key < min) min = key;
  }
  return min;
}

export function maxKey(keys: readonly string[]): string | null {
  let max: string | null = null;
  for (const key of keys) {
    if (max === null || key > max) max = key;
  }
  return max;
}
