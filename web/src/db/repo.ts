import { LIMITS } from '@tada/shared';
import { keyAtEnd, keyAtStart, keyBetween, maxKey, minKey } from './ordering';
import { dropOutbox, enqueueOutbox, outboxKey, splitOutboxKey } from './outbox';
import type { TadaDb, Flag, ListRow, TaskRow } from './schema';
import { newId } from '../lib/ids';

export interface Clock {
  next(now?: number): string;
  /** 拉取到远端 HLC 后回灌，保证之后的本地写入严格大于它 */
  observe?(hlc: string): void;
}

export interface RepoDeps {
  db: TadaDb;
  clock: Clock;
  /** 便于测试注入固定时间 */
  now?: () => Date;
}

function timestamp(deps: RepoDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

/**
 * repo 层输入防御：把超出协议上限的文本截断。
 *
 * UI 的 maxLength 只是第一道防线（脚本、粘贴、旧数据都可能绕开），
 * 这里保证进入 outbox 的每一行都能通过 `@tada/shared` 的 schema，
 * 不会变成让整批 push 被 400 拒绝的毒丸。
 */
function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function clipNotes(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return clip(value, LIMITS.taskNotes);
}

/**
 * 墓碑或物理删除都要碰的表，统一声明避免 Dexie 事务表遗漏。
 *
 * `meta` 也必须在列：`clock.next()` 会把 lastHlc 水位落盘，而这一步发生在
 * 上面的事务里；漏掉 meta 会让 Dexie 抛 NotFoundError（曾被空 catch 吞掉，
 * 导致 lastHlc 从未真正写入）。
 */
const ALL_TABLES = (db: TadaDb) => [db.lists, db.tasks, db.outbox, db.meta] as const;

/* ------------------------------------------------------------------ *
 * 列表
 * ------------------------------------------------------------------ */

export async function createList(
  deps: RepoDeps,
  name: string,
  color: string | null = null,
): Promise<string | null> {
  const trimmed = clip(name.trim(), LIMITS.listName);
  if (trimmed === '') return null;

  const { db, clock } = deps;
  const id = newId();
  const last = await db.lists.orderBy('orderKey').last();
  const orderKey = keyAtEnd(last?.orderKey ?? null);
  const ts = timestamp(deps);

  await db.transaction('rw', ALL_TABLES(db), async () => {
    const hlc = clock.next();
    const row: ListRow = {
      id,
      name: trimmed,
      color,
      orderKey,
      hlc,
      createdAt: ts,
      updatedAt: ts,
      deleted: 0,
      remote: 0,
    };
    await db.lists.put(row);
    await enqueueOutbox(db, 'lists', id, hlc);
  });

  return id;
}

export async function renameList(deps: RepoDeps, id: string, name: string): Promise<void> {
  const trimmed = clip(name.trim(), LIMITS.listName);
  if (trimmed === '') return;

  const { db, clock } = deps;
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const row = await db.lists.get(id);
    if (!row || row.deleted === 1 || row.name === trimmed) return;
    const hlc = clock.next();
    await db.lists.put({ ...row, name: trimmed, hlc, updatedAt: timestamp(deps) });
    await enqueueOutbox(db, 'lists', id, hlc);
  });
}

export async function setListColor(
  deps: RepoDeps,
  id: string,
  color: string | null,
): Promise<void> {
  const { db, clock } = deps;
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const row = await db.lists.get(id);
    if (!row || row.deleted === 1 || row.color === color) return;
    const hlc = clock.next();
    await db.lists.put({ ...row, color, hlc, updatedAt: timestamp(deps) });
    await enqueueOutbox(db, 'lists', id, hlc);
  });
}

export async function reorderList(
  deps: RepoDeps,
  id: string,
  previousKey: string | null,
  nextKey: string | null,
): Promise<void> {
  const { db, clock } = deps;
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const row = await db.lists.get(id);
    if (!row || row.deleted === 1) return;
    const orderKey = keyBetween(previousKey, nextKey);
    if (orderKey === row.orderKey) return;
    const hlc = clock.next();
    await db.lists.put({ ...row, orderKey, hlc, updatedAt: timestamp(deps) });
    await enqueueOutbox(db, 'lists', id, hlc);
  });
}

/**
 * 删除列表。
 *
 * - 从未上传过的列表：本地物理删除（连同列表内的任务），不产生网络流量。
 * - 已上传过的列表：写墓碑，并把列表下所有未删除任务一起写墓碑、入 outbox；
 *   否则这些任务在服务端永久残留，其他设备也永远拉不到它们的删除。
 *   全部在同一个 Dexie 事务里完成。
 */
export async function deleteList(deps: RepoDeps, id: string): Promise<void> {
  const { db, clock } = deps;
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const row = await db.lists.get(id);
    if (!row) return;

    if (row.remote === 0) {
      await db.lists.delete(id);
      await dropOutbox(db, 'lists', id);
      const tasks = await db.tasks.where('listId').equals(id).toArray();
      for (const task of tasks) {
        await deleteTaskInTransaction(deps, task);
      }
      return;
    }

    const hlc = clock.next();
    await db.lists.put({ ...row, deleted: 1, hlc, updatedAt: timestamp(deps) });
    await enqueueOutbox(db, 'lists', id, hlc);

    // 列表删掉后其任务在 UI 里不可见，但服务端不会自动级联；逐条标记删除。
    // 从未上传过的任务仍走物理删除，避免为服务端根本不知道的行推墓碑。
    const tasks = await db.tasks.where('listId').equals(id).toArray();
    for (const task of tasks) {
      if (task.deleted === 1) continue;
      await deleteTaskInTransaction(deps, task);
    }
  });
}

/* ------------------------------------------------------------------ *
 * 任务
 * ------------------------------------------------------------------ */

async function firstTaskKey(db: TadaDb, listId: string): Promise<string> {
  const rows = await db.tasks.where('listId').equals(listId).toArray();
  return keyAtStart(minKey(rows.map((r) => r.orderKey)));
}

export async function createTask(
  deps: RepoDeps,
  listId: string,
  title: string,
  options: { notes?: string | null; dueAt?: string | null } = {},
): Promise<string | null> {
  const trimmed = clip(title.trim(), LIMITS.taskTitle);
  if (trimmed === '') return null;

  const { db, clock } = deps;
  const orderKey = await firstTaskKey(db, listId);
  const id = newId();
  const ts = timestamp(deps);

  await db.transaction('rw', ALL_TABLES(db), async () => {
    const hlc = clock.next();
    const row: TaskRow = {
      id,
      listId,
      parentId: null,
      title: trimmed,
      notes: clipNotes(options.notes),
      done: 0,
      doneAt: null,
      dueAt: options.dueAt ?? null,
      orderKey,
      hlc,
      createdAt: ts,
      updatedAt: ts,
      deleted: 0,
      remote: 0,
    };
    await db.tasks.put(row);
    await enqueueOutbox(db, 'tasks', id, hlc);
  });

  return id;
}

export type TaskPatch = Partial<Pick<TaskRow, 'title' | 'notes' | 'dueAt' | 'parentId'>>;

export async function updateTask(
  deps: RepoDeps,
  id: string,
  patch: TaskPatch,
): Promise<void> {
  const { db, clock } = deps;
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const row = await db.tasks.get(id);
    if (!row || row.deleted === 1) return;

    const next: TaskRow = { ...row };
    if (patch.title !== undefined) {
      const title = clip(patch.title.trim(), LIMITS.taskTitle);
      if (title === '') return;
      next.title = title;
    }
    if (patch.notes !== undefined) next.notes = clipNotes(patch.notes);
    if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
    if (patch.parentId !== undefined) next.parentId = patch.parentId;

    const unchanged =
      next.title === row.title &&
      next.notes === row.notes &&
      next.dueAt === row.dueAt &&
      next.parentId === row.parentId;
    if (unchanged) return;

    const hlc = clock.next();
    await db.tasks.put({ ...next, hlc, updatedAt: timestamp(deps) });
    await enqueueOutbox(db, 'tasks', id, hlc);
  });
}

export async function setTaskDone(deps: RepoDeps, id: string, done: boolean): Promise<void> {
  const { db, clock } = deps;
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const row = await db.tasks.get(id);
    if (!row || row.deleted === 1) return;
    const target: Flag = done ? 1 : 0;
    if (row.done === target) return;

    const ts = timestamp(deps);
    const hlc = clock.next();
    await db.tasks.put({
      ...row,
      done: target,
      doneAt: done ? ts : null,
      hlc,
      updatedAt: ts,
    });
    await enqueueOutbox(db, 'tasks', id, hlc);
  });
}

export async function moveTaskToList(
  deps: RepoDeps,
  id: string,
  listId: string,
): Promise<void> {
  const { db, clock } = deps;
  const orderKey = await firstTaskKey(db, listId);
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const row = await db.tasks.get(id);
    if (!row || row.deleted === 1 || row.listId === listId) return;
    const hlc = clock.next();
    await db.tasks.put({ ...row, listId, orderKey, hlc, updatedAt: timestamp(deps) });
    await enqueueOutbox(db, 'tasks', id, hlc);
  });
}

export async function reorderTask(
  deps: RepoDeps,
  id: string,
  previousKey: string | null,
  nextKey: string | null,
): Promise<void> {
  const { db, clock } = deps;
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const row = await db.tasks.get(id);
    if (!row || row.deleted === 1) return;
    const orderKey = keyBetween(previousKey, nextKey);
    if (orderKey === row.orderKey) return;
    const hlc = clock.next();
    await db.tasks.put({ ...row, orderKey, hlc, updatedAt: timestamp(deps) });
    await enqueueOutbox(db, 'tasks', id, hlc);
  });
}

export async function deleteTask(deps: RepoDeps, id: string): Promise<void> {
  const { db } = deps;
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const row = await db.tasks.get(id);
    if (!row) return;
    await deleteTaskInTransaction(deps, row);
  });
}

/** 调用方必须已经处在 lists/tasks/outbox 事务里。 */
async function deleteTaskInTransaction(deps: RepoDeps, row: TaskRow): Promise<void> {
  const { db, clock } = deps;
  if (row.remote === 0) {
    await db.tasks.delete(row.id);
    await dropOutbox(db, 'tasks', row.id);
    return;
  }
  const hlc = clock.next();
  await db.tasks.put({ ...row, deleted: 1, hlc, updatedAt: timestamp(deps) });
  await enqueueOutbox(db, 'tasks', row.id, hlc);
}

/* ------------------------------------------------------------------ *
 * 通用辅助
 * ------------------------------------------------------------------ */

/** 未删除列表，按 orderKey 排序 */
export async function liveLists(db: TadaDb): Promise<ListRow[]> {
  const rows = await db.lists.orderBy('orderKey').toArray();
  return rows.filter((row) => row.deleted === 0);
}

/** 某列表内某状态的未删除任务，按 orderKey 排序 */
export async function tasksInList(
  db: TadaDb,
  listId: string,
  done: boolean,
): Promise<TaskRow[]> {
  const rows = await db.tasks.where('listId').equals(listId).toArray();
  const target: Flag = done ? 1 : 0;
  return rows.filter((row) => row.deleted === 0 && row.done === target).sort(byOrderKey);
}

export function byOrderKey(a: { orderKey: string }, b: { orderKey: string }): number {
  return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0;
}

export { outboxKey, splitOutboxKey, maxKey };
