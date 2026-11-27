import Dexie, { type Table } from 'dexie';

/** SQLite 风格的布尔值：本地库里统一用 0/1，协议层再转 boolean */
export type Flag = 0 | 1;

/**
 * 本地行结构。
 *
 * 和 `@tada/shared` 的实体相比多了两处客户端专属字段：
 * - `deleted`：墓碑标记，0/1
 * - `remote`：这一行是否曾经进入过推送负载、或从服务端拉取过。
 *   它只用于删除策略：从未尝试上传过的行可以直接物理删除，不需要推墓碑；
 *   进过一次推负载的行一律按「可能在服务端」处理，避免请求在途时删除导致对端复活。
 */
export interface ListRow {
  id: string;
  name: string;
  color: string | null;
  orderKey: string;
  hlc: string;
  createdAt: string;
  updatedAt: string;
  deleted: Flag;
  remote: Flag;
}

export interface TaskRow {
  id: string;
  listId: string;
  parentId: string | null;
  title: string;
  notes: string | null;
  done: Flag;
  doneAt: string | null;
  dueAt: string | null;
  orderKey: string;
  hlc: string;
  createdAt: string;
  updatedAt: string;
  deleted: Flag;
  remote: Flag;
}

export interface MetaValues {
  deviceId: string;
  deviceName: string;
  token: string | null;
  lastSeq: number;
  lastSyncedAt: string | null;
  /** 本地 HLC 水位：启动时用来初始化时钟，防止时间回拨 / 重载后写出更旧的 HLC */
  lastHlc: string | null;
  /** 1 = 刚配对完：首次全量 pull 后把「服务端没有的本地行」重新入队补推 */
  pairReseed: Flag;
}

export type MetaKey = keyof MetaValues;

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface OutboxRow {
  /** `${entity}:${rowId}` */
  key: string;
  entity: 'lists' | 'tasks';
  rowId: string;
  hlc: string;
  queuedAt: number;
}

/**
 * 被服务端 4xx 拒绝、且重试也无法通过的「毒丸」条目。
 *
 * 记录后从 outbox 移除，避免整条同步被一条坏数据永久卡死；本地行保留，
 * 用户下次编辑会重新入队（若数据仍不合法会再次被隔离）。
 */
export interface QuarantineRow {
  /** 与 outbox 相同的 `${entity}:${rowId}` */
  key: string;
  entity: 'lists' | 'tasks';
  rowId: string;
  hlc: string;
  reason: string;
  quarantinedAt: number;
}

export class TadaDb extends Dexie {
  lists!: Table<ListRow, string>;
  tasks!: Table<TaskRow, string>;
  meta!: Table<MetaRow, string>;
  outbox!: Table<OutboxRow, string>;
  quarantine!: Table<QuarantineRow, string>;

  constructor(name = 'tada') {
    super(name);
    this.version(1).stores({
      // 索引是协议约定的一部分：listId / done / orderKey / queuedAt
      lists: 'id, orderKey',
      tasks: 'id, listId, done, orderKey',
      meta: 'key',
      outbox: 'key, queuedAt',
    });
    // v2：新增 quarantine 表，用于隔离被 4xx 拒绝的毒丸条目
    this.version(2).stores({
      lists: 'id, orderKey',
      tasks: 'id, listId, done, orderKey',
      meta: 'key',
      outbox: 'key, queuedAt',
      quarantine: 'key, quarantinedAt',
    });
    // v3：子任务按 parentId 建索引（顶层任务 parentId 为 null，不进索引）
    this.version(3).stores({
      lists: 'id, orderKey',
      tasks: 'id, listId, parentId, done, orderKey',
      meta: 'key',
      outbox: 'key, queuedAt',
      quarantine: 'key, quarantinedAt',
    });
  }
}

export function createDb(name?: string): TadaDb {
  return new TadaDb(name);
}

export async function getMeta<K extends MetaKey>(
  db: TadaDb,
  key: K,
): Promise<MetaValues[K] | undefined> {
  const row = await db.meta.get(key);
  return row?.value as MetaValues[K] | undefined;
}

export async function setMeta<K extends MetaKey>(
  db: TadaDb,
  key: K,
  value: MetaValues[K],
): Promise<void> {
  await db.meta.put({ key, value });
}
