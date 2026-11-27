import type { WireChange } from '@tada/shared';

/**
 * 一行在数据库里的样子（D1 返回 snake_case）。
 * 只声明拉取用到的列。
 */
export interface ListDbRow {
  id: string;
  name: string;
  color: string | null;
  order_key: string;
  hlc: string;
  seq: number;
  deleted: number;
  created_at: string;
  updated_at: string;
}

export interface TaskDbRow {
  id: string;
  list_id: string;
  parent_id: string | null;
  title: string;
  notes: string | null;
  done: number;
  done_at: string | null;
  due_at: string | null;
  order_key: string;
  hlc: string;
  seq: number;
  deleted: number;
  created_at: string;
  updated_at: string;
}

export type SeqListChange = WireChange<'lists'> & { seq: number };
export type SeqTaskChange = WireChange<'tasks'> & { seq: number };
export type SeqWireChange = SeqListChange | SeqTaskChange;

export interface PullPage {
  changes: SeqWireChange[];
  nextSince: number;
  hasMore: boolean;
}

export function toListChange(row: ListDbRow): SeqListChange {
  return {
    entity: 'lists',
    id: row.id,
    hlc: row.hlc,
    deleted: row.deleted !== 0,
    seq: row.seq,
    data: {
      name: row.name,
      color: row.color,
      orderKey: row.order_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

export function toTaskChange(row: TaskDbRow): SeqTaskChange {
  return {
    entity: 'tasks',
    id: row.id,
    hlc: row.hlc,
    deleted: row.deleted !== 0,
    seq: row.seq,
    data: {
      listId: row.list_id,
      parentId: row.parent_id,
      title: row.title,
      notes: row.notes,
      done: row.done !== 0,
      doneAt: row.done_at,
      dueAt: row.due_at,
      orderKey: row.order_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

/**
 * 每张表只取 limit + 1 条，然后合并。
 *
 * 多取一条是 hasMore 正确性的关键：单表剩余行数超过 limit 时，
 * 若只取 limit 条，合并后最多恰好 limit 条，会被误判为「已追平」。
 */
function rowsAfter<T extends { seq: number }>(
  rows: readonly T[],
  since: number,
  limit: number,
): T[] {
  return [...rows]
    .filter((row) => row.seq > since)
    .sort((a, b) => a.seq - b.seq)
    .slice(0, limit + 1);
}

/** 纯函数：合并两张表的增量行，游标与 hasMore 只依赖这里的输入。 */
export function mergePullPage(
  lists: readonly ListDbRow[],
  tasks: readonly TaskDbRow[],
  since: number,
  limit: number,
): PullPage {
  const bounded = Math.max(1, Math.floor(limit));

  const merged: SeqWireChange[] = [
    ...rowsAfter(lists, since, bounded).map(toListChange),
    ...rowsAfter(tasks, since, bounded).map(toTaskChange),
  ].sort((a, b) => a.seq - b.seq);

  const page = merged.slice(0, bounded);
  const nextSince = page.length > 0 ? page[page.length - 1]!.seq : since;

  return {
    changes: page,
    nextSince,
    hasMore: merged.length > bounded,
  };
}
