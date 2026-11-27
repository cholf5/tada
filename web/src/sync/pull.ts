import {
  listDataSchema,
  taskDataSchema,
  type PullResponse,
  type WireChange,
} from '@tada/shared';
import { dropOutboxIfOlder } from '../db/outbox';
import { getMeta, setMeta, type TadaDb, type ListRow, type TaskRow } from '../db/schema';
import { isNewer } from './lww';

export interface PullTransport {
  pull(token: string, since: number, limit: number): Promise<PullResponse>;
}

export interface PullOptions {
  limit?: number;
  maxPages?: number;
}

export interface PullSummary {
  pages: number;
  /** 真正应用到本地的行数 */
  applied: number;
  /** 服务端返回的行数（含被 LWW 忽略的） */
  received: number;
  since: number;
  /** 本次全量 range 内服务端「仍存在（非墓碑）」的行 id，配对补推用 */
  seenIds: Set<string>;
}

/** meta 也必须进事务：applyPullPage 里的 clock.observe 会把 lastHlc 水位落盘 */
function tables(db: TadaDb) {
  return [db.lists, db.tasks, db.outbox, db.meta];
}

/**
 * 把一页远端改动合并进本地库。
 *
 * 规则（SPEC）：本地没有 → 写入；本地有 → 只有 hlc 严格更大才覆盖；
 * 覆盖时该行若在 outbox 里，说明本地版本已被淘汰，删掉待推送条目。
 * 同一页里的顺序即服务端的 seq 顺序，逐条应用。
 *
 * 每条 change 都会回灌时钟：之后本地 next() 产出严格大于 incoming.hlc，
 * 避免本机时间慢时编辑被对端按 LWW 静默丢弃。
 */
export async function applyPullPage(
  db: TadaDb,
  changes: readonly WireChange[],
  clock?: { observe?(hlc: string): void },
): Promise<number> {
  let applied = 0;

  await db.transaction('rw', tables(db), async () => {
    for (const change of changes) {
      if (change.entity === 'lists') {
        if (await applyListChange(db, change as WireChange<'lists'>)) applied += 1;
      } else if (change.entity === 'tasks') {
        if (await applyTaskChange(db, change as WireChange<'tasks'>)) applied += 1;
      }
      clock?.observe?.(change.hlc);
    }
  });

  return applied;
}

async function applyListChange(
  db: TadaDb,
  change: WireChange<'lists'>,
): Promise<boolean> {
  const local = await db.lists.get(change.id);

  if (!local) {
    // 从没见过的墓碑：没有可删的东西，忽略
    if (change.deleted) return false;
    const parsed = listDataSchema.safeParse(change.data);
    if (!parsed.success) return false;
    const row: ListRow = {
      id: change.id,
      name: parsed.data.name,
      color: parsed.data.color ?? null,
      orderKey: parsed.data.orderKey,
      createdAt: parsed.data.createdAt,
      updatedAt: parsed.data.updatedAt,
      hlc: change.hlc,
      deleted: 0,
      remote: 1,
    };
    await db.lists.put(row);
    return true;
  }

  if (!isNewer(change.hlc, local.hlc)) return false;

  if (change.deleted) {
    await db.lists.put({ ...local, deleted: 1, hlc: change.hlc, remote: 1 });
  } else {
    const parsed = listDataSchema.safeParse(change.data);
    if (!parsed.success) return false;
    const row: ListRow = {
      id: local.id,
      name: parsed.data.name,
      color: parsed.data.color ?? null,
      orderKey: parsed.data.orderKey,
      createdAt: parsed.data.createdAt,
      updatedAt: parsed.data.updatedAt,
      hlc: change.hlc,
      deleted: 0,
      remote: 1,
    };
    await db.lists.put(row);
  }

  await dropOutboxIfOlder(db, 'lists', change.id, change.hlc);
  return true;
}

async function applyTaskChange(
  db: TadaDb,
  change: WireChange<'tasks'>,
): Promise<boolean> {
  const local = await db.tasks.get(change.id);

  if (!local) {
    if (change.deleted) return false;
    const parsed = taskDataSchema.safeParse(change.data);
    if (!parsed.success) return false;
    const row: TaskRow = {
      id: change.id,
      listId: parsed.data.listId,
      parentId: parsed.data.parentId ?? null,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      done: parsed.data.done ? 1 : 0,
      doneAt: parsed.data.doneAt ?? null,
      dueAt: parsed.data.dueAt ?? null,
      orderKey: parsed.data.orderKey,
      createdAt: parsed.data.createdAt,
      updatedAt: parsed.data.updatedAt,
      hlc: change.hlc,
      deleted: 0,
      remote: 1,
    };
    await db.tasks.put(row);
    return true;
  }

  if (!isNewer(change.hlc, local.hlc)) return false;

  if (change.deleted) {
    await db.tasks.put({ ...local, deleted: 1, hlc: change.hlc, remote: 1 });
  } else {
    const parsed = taskDataSchema.safeParse(change.data);
    if (!parsed.success) return false;
    const row: TaskRow = {
      id: local.id,
      listId: parsed.data.listId,
      parentId: parsed.data.parentId ?? null,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      done: parsed.data.done ? 1 : 0,
      doneAt: parsed.data.doneAt ?? null,
      dueAt: parsed.data.dueAt ?? null,
      orderKey: parsed.data.orderKey,
      createdAt: parsed.data.createdAt,
      updatedAt: parsed.data.updatedAt,
      hlc: change.hlc,
      deleted: 0,
      remote: 1,
    };
    await db.tasks.put(row);
  }

  await dropOutboxIfOlder(db, 'tasks', change.id, change.hlc);
  return true;
}

/**
 * 从 lastSeq 开始一直拉到没有更多页。
 * 每拉完一页就落盘游标，中途断网重来不会重复拉取。
 */
export async function pullAll(
  db: TadaDb,
  transport: PullTransport,
  token: string,
  options: PullOptions = {},
  clock?: { observe?(hlc: string): void },
): Promise<PullSummary> {
  const limit = options.limit ?? 500;
  const maxPages = options.maxPages ?? 1000;

  let since = (await getMeta(db, 'lastSeq')) ?? 0;
  let pages = 0;
  let applied = 0;
  let received = 0;
  const seenIds = new Set<string>();

  while (pages < maxPages) {
    const page = await transport.pull(token, since, limit);
    received += page.changes.length;
    applied += await applyPullPage(db, page.changes, clock);

    // 只记「服务端仍有实体」的 id；墓碑说明服务端没有这行了，
    // 本地若还是未删除状态（本地版本更新），配对补推时应当上传。
    for (const change of page.changes) {
      if (!change.deleted) seenIds.add(change.id);
    }

    const previous = since;
    since = Math.max(since, page.nextSince);
    await setMeta(db, 'lastSeq', since);
    pages += 1;

    const fullPage = page.changes.length >= limit;

    // 防御旧版服务端：早期 relay 在单表剩余行数超过 limit 时可能把 hasMore
    // 误报为 false（该缺陷已修复并有 store 测试覆盖）。这里仍按「整页返回就再拉
    // 一页」兜底，兼容尚未升级的部署；普通部署会多一次空页请求。
    const shouldContinue = page.hasMore || fullPage;
    if (!shouldContinue) break;

    // 游标没前进就不可能拉到新内容，终止避免死循环
    if (since === previous) break;
  }

  return { pages, applied, received, since, seenIds };
}
