import { enqueueOutbox } from '../db/outbox';
import type { TadaDb } from '../db/schema';

/**
 * 把所有未删除的本地行重新放回 outbox（按行折叠）。
 *
 * 换到一台空服务器时，本地数据虽然还在，但服务端什么都不知道；
 * 重新入队后，下一次 push 会把这些行整体补上去。hlc 保持不变，
 * 所以对端已有的更新版本仍然按 LWW 胜出，不会覆盖较新的数据。
 */
export async function requeueAllLocalRows(
  db: TadaDb,
  queuedAt: number = Date.now(),
): Promise<number> {
  let count = 0;

  await db.transaction('rw', [db.lists, db.tasks, db.outbox, db.meta], async () => {
    // 用递增的 queuedAt 保持稳定的上传顺序
    let offset = 0;

    for (const row of await db.lists.toArray()) {
      if (row.deleted === 1) continue;
      await enqueueOutbox(db, 'lists', row.id, row.hlc, queuedAt + offset);
      offset += 1;
      count += 1;
    }

    for (const row of await db.tasks.toArray()) {
      if (row.deleted === 1) continue;
      await enqueueOutbox(db, 'tasks', row.id, row.hlc, queuedAt + offset);
      offset += 1;
      count += 1;
    }
  });

  return count;
}

/**
 * 配对到「非空服务器」时，只补推服务端没有的本地行。
 *
 * 首次全量 pull 会带回服务端仍然存在的行 id；本地存在、但不在这个集合里的
 * 行（且未删除）重新入队。hlc 保持不变，服务端已有更新版本时仍按 LWW 胜出。
 *
 * 这修掉了「只有服务器完全为空才自动补推」的缺口；设置页的手动按钮继续作为兜底。
 */
export async function requeueMissingLocalRows(
  db: TadaDb,
  remoteIds: ReadonlySet<string>,
  queuedAt: number = Date.now(),
): Promise<number> {
  let count = 0;

  await db.transaction('rw', [db.lists, db.tasks, db.outbox, db.meta], async () => {
    // 用递增的 queuedAt 保持稳定的上传顺序
    let offset = 0;

    for (const row of await db.lists.toArray()) {
      if (row.deleted === 1 || remoteIds.has(row.id)) continue;
      await enqueueOutbox(db, 'lists', row.id, row.hlc, queuedAt + offset);
      offset += 1;
      count += 1;
    }

    for (const row of await db.tasks.toArray()) {
      if (row.deleted === 1 || remoteIds.has(row.id)) continue;
      await enqueueOutbox(db, 'tasks', row.id, row.hlc, queuedAt + offset);
      offset += 1;
      count += 1;
    }
  });

  return count;
}
