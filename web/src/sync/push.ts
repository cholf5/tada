import type { ListData, TaskData, WireChange } from '@tada/shared';
import type { Clock } from '../db/repo';
import { splitOutboxKey } from '../db/repo';
import type { TadaDb, ListRow, TaskRow } from '../db/schema';

/** 本次实际发出的内容：key 用来回删 outbox，hlc 用来避免误删请求期间的新改动 */
export interface SentEntry {
  key: string;
  hlc: string;
}

export interface PushBatch {
  changes: WireChange[];
  sent: SentEntry[];
}

/**
 * 单次从 outbox 取的条数上限。
 *
 * 每条改动最多产生 2 条 batch statement（seq 自增 + 写入），500 条就是 1000 条，
 * 超出 D1 的保守上限时整批失败。压到 200（最多 400 条 statement）留出余量；
 * 未推完的条目由引擎的 `again` 续轮继续推送。
 */
export const PUSH_BATCH_LIMIT = 200;

export interface PushDeps {
  db: TadaDb;
  clock: Clock;
  limit?: number;
}

/** meta 也必须进事务：行已被物理删除时会在事务里 clock.next() 并落盘水位 */
function tables(db: TadaDb) {
  return [db.lists, db.tasks, db.outbox, db.quarantine, db.meta];
}

export function listData(row: ListRow): ListData {
  return {
    name: row.name,
    color: row.color,
    orderKey: row.orderKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function taskData(row: TaskRow): TaskData {
  return {
    listId: row.listId,
    parentId: row.parentId,
    title: row.title,
    notes: row.notes,
    done: row.done === 1,
    doneAt: row.doneAt,
    dueAt: row.dueAt,
    orderKey: row.orderKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 从 outbox 取最早的一批，组装成 push 负载。
 *
 * 正常情况下 outbox 里的行一定还在本地；如果行已被物理删除（推送请求
 * 在途时用户又删了它），这里补一个墓碑，避免服务端把它留下、下次 pull
 * 又复活。
 */
export async function collectPushBatch(deps: PushDeps): Promise<PushBatch> {
  const { db, clock } = deps;
  const limit = deps.limit ?? PUSH_BATCH_LIMIT;

  const changes: WireChange[] = [];
  const sent: SentEntry[] = [];

  await db.transaction('rw', tables(db), async () => {
    const entries = await db.outbox.orderBy('queuedAt').limit(limit).toArray();

    for (const entry of entries) {
      if (entry.entity === 'lists') {
        const row = await db.lists.get(entry.rowId);
        if (!row) {
          const hlc = clock.next();
          changes.push({ entity: 'lists', id: entry.rowId, hlc, deleted: true });
          sent.push({ key: entry.key, hlc });
          continue;
        }
        // 只要进入过一次推送负载，就按「可能已在服务端」对待：
        // 请求在途时被删除也必须发墓碑，否则对端会把它复活。
        if (row.remote === 0) await db.lists.put({ ...row, remote: 1 });
        const hlc = row.hlc;
        if (row.deleted === 1) {
          changes.push({ entity: 'lists', id: row.id, hlc, deleted: true });
        } else {
          changes.push({ entity: 'lists', id: row.id, hlc, deleted: false, data: listData(row) });
        }
        sent.push({ key: entry.key, hlc });
        continue;
      }

      const row = await db.tasks.get(entry.rowId);
      if (!row) {
        const hlc = clock.next();
        changes.push({ entity: 'tasks', id: entry.rowId, hlc, deleted: true });
        sent.push({ key: entry.key, hlc });
        continue;
      }
      if (row.remote === 0) await db.tasks.put({ ...row, remote: 1 });
      const hlc = row.hlc;
      if (row.deleted === 1) {
        changes.push({ entity: 'tasks', id: row.id, hlc, deleted: true });
      } else {
        changes.push({ entity: 'tasks', id: row.id, hlc, deleted: false, data: taskData(row) });
      }
      sent.push({ key: entry.key, hlc });
    }
  });

  return { changes, sent };
}

/**
 * push 成功后清理 outbox：只删掉 hlc <= 本次发出的 hlc 的条目。
 *
 * 请求在途时用户又改了同一行，outbox 里的 hlc 会更大，必须保留继续推。
 * 同时把该行标记为「服务端已知」，之后删除时才会推墓碑而不是物理删除。
 *
 * 成功推送也意味着该行不再是毒丸：同一 key 上「版本不新于本次推送」的
 * quarantine 记录一并删除，设置页的跳过提示随之消失。
 */
export async function applyPushAccepted(deps: PushDeps, sent: SentEntry[]): Promise<void> {
  const { db } = deps;

  await db.transaction('rw', tables(db), async () => {
    for (const { key, hlc } of sent) {
      const current = await db.outbox.get(key);
      if (current && current.hlc <= hlc) {
        await db.outbox.delete(key);
      }

      const quarantined = await db.quarantine.get(key);
      if (quarantined && quarantined.hlc <= hlc) {
        await db.quarantine.delete(key);
      }

      const { entity, rowId } = splitOutboxKey(key);
      if (entity === 'lists') {
        const row = await db.lists.get(rowId);
        if (row && row.remote === 0) await db.lists.put({ ...row, remote: 1 });
      } else if (entity === 'tasks') {
        const row = await db.tasks.get(rowId);
        if (row && row.remote === 0) await db.tasks.put({ ...row, remote: 1 });
      }
    }
  });
}
