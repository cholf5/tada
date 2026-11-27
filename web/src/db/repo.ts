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
  // 只参考顶层任务的排序键：子任务自己有一套顺序，不应影响新任务插到列表顶部
  return keyAtStart(minKey(rows.filter((r) => r.parentId === null).map((r) => r.orderKey)));
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

/**
 * 在某个顶层任务下创建子任务（只支持一层）。
 *
 * - 子任务继承父任务的 listId，追加到现有子任务末尾；
 * - 父任务已完成时先把它重新打开，否则会出现「父任务已完成、子任务未完成」；
 * - 父任务不存在、已删除或本身就是子任务时不创建。
 */
export async function createSubtask(
  deps: RepoDeps,
  parentId: string,
  title: string,
): Promise<string | null> {
  const trimmed = clip(title.trim(), LIMITS.taskTitle);
  if (trimmed === '') return null;

  const { db, clock } = deps;
  const id = newId();
  const ts = timestamp(deps);

  const parent = await db.tasks.get(parentId);
  if (!parent || parent.deleted === 1 || parent.parentId !== null) return null;

  const created = await db.transaction('rw', ALL_TABLES(db), async () => {
    // 事务内重读父任务：上面的查询之后它可能已被删除或被同步覆盖
    const current = await db.tasks.get(parentId);
    if (!current || current.deleted === 1 || current.parentId !== null) return false;

    const siblings = await db.tasks.where('parentId').equals(parentId).toArray();
    const orderKey = keyAtEnd(maxKey(siblings.map((row) => row.orderKey)));

    if (current.done === 1) {
      const reopenHlc = clock.next();
      await db.tasks.put({ ...current, done: 0, doneAt: null, hlc: reopenHlc, updatedAt: ts });
      await enqueueOutbox(db, 'tasks', parentId, reopenHlc);
    }

    const hlc = clock.next();
    const row: TaskRow = {
      id,
      listId: current.listId,
      parentId,
      title: trimmed,
      notes: null,
      done: 0,
      doneAt: null,
      dueAt: null,
      orderKey,
      hlc,
      createdAt: ts,
      updatedAt: ts,
      deleted: 0,
      remote: 0,
    };
    await db.tasks.put(row);
    await enqueueOutbox(db, 'tasks', id, hlc);
    return true;
  });

  return created ? id : null;
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
    if (patch.parentId !== undefined) {
      if (patch.parentId === null) {
        next.parentId = null;
      } else {
        // 只允许挂在同列表的顶层任务下：禁止自引用、多层嵌套、跨列表挂载，
        // 也禁止把「自己已有子任务」的任务变成子任务（会变成多层）
        if (patch.parentId === id) return;
        const parent = await db.tasks.get(patch.parentId);
        if (
          !parent ||
          parent.deleted === 1 ||
          parent.parentId !== null ||
          parent.listId !== row.listId
        ) {
          return;
        }
        const children = await db.tasks.where('parentId').equals(id).toArray();
        if (children.some((child) => child.deleted === 0)) return;
        next.parentId = patch.parentId;
      }
    }

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
    const ts = timestamp(deps);

    if (row.done !== target) {
      const hlc = clock.next();
      await db.tasks.put({
        ...row,
        done: target,
        doneAt: done ? ts : null,
        hlc,
        updatedAt: ts,
      });
      await enqueueOutbox(db, 'tasks', id, hlc);
    }

    // 完成顶层任务时把未完成的子任务一起完成（UI 会在调用前提示确认）；
    // 取消完成不反向恢复子任务，否则用户单独勾掉的子任务会被父任务重置。
    if (!done || row.parentId !== null) return;

    const children = await db.tasks.where('parentId').equals(id).toArray();
    for (const child of children) {
      if (child.deleted === 1 || child.done === 1) continue;
      const childHlc = clock.next();
      await db.tasks.put({ ...child, done: 1, doneAt: ts, hlc: childHlc, updatedAt: ts });
      await enqueueOutbox(db, 'tasks', child.id, childHlc);
    }
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
    // 子任务跟随父任务移动，不允许单独换列表
    if (!row || row.deleted === 1 || row.listId === listId || row.parentId !== null) return;
    const ts = timestamp(deps);
    const hlc = clock.next();
    await db.tasks.put({ ...row, listId, orderKey, hlc, updatedAt: ts });
    await enqueueOutbox(db, 'tasks', id, hlc);

    // 子任务必须和父任务在同一个列表里，否则 UI 里会找不到它们
    const children = await db.tasks.where('parentId').equals(id).toArray();
    for (const child of children) {
      if (child.deleted === 1) continue;
      const childHlc = clock.next();
      await db.tasks.put({ ...child, listId, hlc: childHlc, updatedAt: ts });
      await enqueueOutbox(db, 'tasks', child.id, childHlc);
    }
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

/** 调用方必须已经处在 lists/tasks/outbox 事务里。顶层任务会级联删除子任务。 */
async function deleteTaskInTransaction(
  deps: RepoDeps,
  row: TaskRow,
  depth = 0,
): Promise<void> {
  const { db, clock } = deps;

  // 事务内重读：级联或批量删除时，传进来的 row 可能已经被前面的调用删掉了
  const current = await db.tasks.get(row.id);
  if (!current || current.deleted === 1) return;

  if (depth === 0) {
    const children = await db.tasks.where('parentId').equals(current.id).toArray();
    for (const child of children) {
      if (child.deleted === 1) continue;
      await deleteTaskInTransaction(deps, child, 1);
    }
  }

  if (current.remote === 0) {
    await db.tasks.delete(current.id);
    await dropOutbox(db, 'tasks', current.id);
    return;
  }
  const hlc = clock.next();
  await db.tasks.put({ ...current, deleted: 1, hlc, updatedAt: timestamp(deps) });
  await enqueueOutbox(db, 'tasks', current.id, hlc);
}

/* ------------------------------------------------------------------ *
 * 通用辅助
 * ------------------------------------------------------------------ */

/** 未删除列表，按 orderKey 排序 */
export async function liveLists(db: TadaDb): Promise<ListRow[]> {
  const rows = await db.lists.orderBy('orderKey').toArray();
  return rows.filter((row) => row.deleted === 0);
}

/** 某列表内某状态的未删除顶层任务，按 orderKey 排序（子任务只在详情里展示） */
export async function tasksInList(
  db: TadaDb,
  listId: string,
  done: boolean,
): Promise<TaskRow[]> {
  const rows = await db.tasks.where('listId').equals(listId).toArray();
  const target: Flag = done ? 1 : 0;
  return rows
    .filter((row) => row.deleted === 0 && row.done === target && row.parentId === null)
    .sort(byOrderKey);
}

/** 某个任务的未删除子任务，按 orderKey 排序（只支持一层） */
export async function subtasksOf(db: TadaDb, parentId: string): Promise<TaskRow[]> {
  const rows = await db.tasks.where('parentId').equals(parentId).toArray();
  return rows.filter((row) => row.deleted === 0).sort(byOrderKey);
}

export function byOrderKey(a: { orderKey: string }, b: { orderKey: string }): number {
  return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0;
}

export { outboxKey, splitOutboxKey, maxKey };
