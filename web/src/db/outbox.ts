import type { EntityName } from '@tada/shared';
import type { TadaDb, OutboxRow } from './schema';

/** outbox 按行折叠：同一行无论改多少次，都只有一个待推送条目。 */
export function outboxKey(entity: EntityName, rowId: string): string {
  return `${entity}:${rowId}`;
}

/** `lists:xxx`（含 id 里的冒号也无所谓，只按第一个冒号切） */
export function splitOutboxKey(key: string): { entity: EntityName; rowId: string } {
  const index = key.indexOf(':');
  return {
    entity: key.slice(0, index) as EntityName,
    rowId: key.slice(index + 1),
  };
}

/**
 * 写入 / 覆盖一行的 outbox 条目。
 *
 * `queuedAt` 只在首次入队时设置：频繁编辑的行不会因此一直沉到队尾，
 * 最早没同步的行永远先被推送。
 */
export async function enqueueOutbox(
  db: TadaDb,
  entity: EntityName,
  rowId: string,
  hlc: string,
  queuedAt: number = Date.now(),
): Promise<void> {
  const key = outboxKey(entity, rowId);
  const existing = await db.outbox.get(key);
  const row: OutboxRow = {
    key,
    entity,
    rowId,
    hlc,
    queuedAt: existing?.queuedAt ?? queuedAt,
  };
  await db.outbox.put(row);
}

/** 某一行从待推送队列里移除（推送成功，或被远端更新版本淘汰） */
export async function dropOutbox(
  db: TadaDb,
  entity: EntityName,
  rowId: string,
): Promise<void> {
  await db.outbox.delete(outboxKey(entity, rowId));
}

/**
 * 远端版本覆盖本地后，只有确实「不新于 incoming」的 outbox 条目才能删。
 *
 * 正常不变式下 outbox.hlc 等于本地行 hlc，所以 pulled-in 更新必然更大；
 * 但请求在途时可能已经写入更新的本地版本，这里显式比较而不是依赖不变式，
 * 避免把还没推上去的新改动误删（W23）。
 */
export async function dropOutboxIfOlder(
  db: TadaDb,
  entity: EntityName,
  rowId: string,
  incomingHlc: string,
): Promise<boolean> {
  const key = outboxKey(entity, rowId);
  const entry = await db.outbox.get(key);
  if (!entry) return false;
  if (entry.hlc > incomingHlc) return false;
  await db.outbox.delete(key);
  return true;
}

export interface QuarantineInput {
  key: string;
  hlc: string;
  reason: string;
}

/**
 * 隔离一条被服务端 4xx 永久拒绝的 outbox 条目。
 *
 * 只有 outbox 里的版本仍然 <= 被拒版本时才移除；如果推送在途时用户已经改成
 * 一个更新的版本，保留 outbox 让新版本继续尝试，避免把用户刚修好的数据丢掉。
 */
export async function quarantineOutboxEntry(
  db: TadaDb,
  input: QuarantineInput,
  quarantinedAt: number = Date.now(),
): Promise<boolean> {
  const { entity, rowId } = splitOutboxKey(input.key);

  return db.transaction('rw', [db.outbox, db.quarantine, db.meta], async () => {
    const current = await db.outbox.get(input.key);
    if (current && current.hlc > input.hlc) return false;

    if (current) await db.outbox.delete(input.key);
    await db.quarantine.put({
      key: input.key,
      entity,
      rowId,
      hlc: input.hlc,
      reason: input.reason,
      quarantinedAt,
    });
    return true;
  });
}

/**
 * 清空所有隔离记录（设置页「清除提示」）。
 *
 * 只删提示，不动本地行，也不重新入队：这是用户确认「知道了」的动作。
 * 之后再次编辑该行仍会重新入队，若数据依旧不合法会重新被隔离。
 */
export async function clearQuarantine(db: TadaDb): Promise<number> {
  return db.transaction('rw', db.quarantine, async () => {
    const count = await db.quarantine.count();
    await db.quarantine.clear();
    return count;
  });
}
