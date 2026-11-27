import type { TadaDb } from '../db/schema';
import { useLive } from './useLive';

export interface SubtaskSummary {
  total: number;
  done: number;
}

export type SubtaskCounts = ReadonlyMap<string, SubtaskSummary>;

const EMPTY: SubtaskCounts = new Map();

/**
 * 每个顶层任务的子任务进度，供任务行显示 `2/5`。
 *
 * 只统计未删除的子任务；视图里一次聚合、逐行查表，避免每个 TaskRow
 * 各自开一个 liveQuery。
 */
export function useSubtaskCounts(db: TadaDb): SubtaskCounts {
  return (
    useLive(async () => {
      const rows = await db.tasks
        .filter((task) => task.deleted === 0 && task.parentId !== null)
        .toArray();

      const counts = new Map<string, SubtaskSummary>();
      for (const row of rows) {
        if (!row.parentId) continue;
        const current = counts.get(row.parentId);
        if (current) {
          current.total += 1;
          if (row.done === 1) current.done += 1;
        } else {
          counts.set(row.parentId, { total: 1, done: row.done === 1 ? 1 : 0 });
        }
      }
      return counts;
    }, [db]) ?? EMPTY
  );
}
