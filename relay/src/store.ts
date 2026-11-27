import type { ListData, TaskData } from '@tada/shared';
import { parseEntityData } from './http';
import {
  mergePullPage,
  type ListDbRow,
  type PullPage,
  type TaskDbRow,
} from './pull';

/* ------------------------------------------------------------------ *
 * 最小 D1 接口
 *
 * 只声明 store 真正用到的部分，真实 D1 与测试里的 node:sqlite 适配器
 * 都能满足。业务 SQL 全部走这里，index.ts 只负责路由与 HTTP 语义。
 * ------------------------------------------------------------------ */

export interface D1RunResult {
  meta?: { changes?: number };
}

export interface D1AllResult<T> {
  results?: T[];
  meta?: { changes?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = unknown>(): Promise<D1AllResult<T>>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface D1Like {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1RunResult[]>;
}

/* ------------------------------------------------------------------ *
 * pull：按 seq 游标增量拉取
 * ------------------------------------------------------------------ */

/**
 * 每张表多取一条：只要任一表还有剩余行，merged 就会超过 limit，hasMore 才准确。
 * 纯合并逻辑在 pull.ts，这里只负责真正执行两条 SQL。
 */
export async function pullPage(db: D1Like, since: number, limit: number): Promise<PullPage> {
  const [lists, tasks] = await Promise.all([
    db.prepare(`SELECT * FROM lists WHERE seq > ?1 ORDER BY seq LIMIT ?2`)
      .bind(since, limit + 1)
      .all<ListDbRow>(),
    db.prepare(`SELECT * FROM tasks WHERE seq > ?1 ORDER BY seq LIMIT ?2`)
      .bind(since, limit + 1)
      .all<TaskDbRow>(),
  ]);

  return mergePullPage(lists.results ?? [], tasks.results ?? [], since, limit);
}

/* ------------------------------------------------------------------ *
 * push：客户端上传本地改动
 * 唯一的业务规则：hlc 旧的写入直接丢弃（LWW）
 * ------------------------------------------------------------------ */

/**
 * push 请求里一条已通过 wire schema（实体名 / id / hlc）的改动。
 * data 仍是 unknown：具体实体 schema 在这一层解析，未知实体抛 UnknownEntityError。
 */
export interface IncomingChange {
  entity: 'lists' | 'tasks';
  id: string;
  hlc: string;
  deleted: boolean;
  data?: unknown;
}

/**
 * 组装并执行一个 push batch，返回执行后的全局 seq。
 *
 * 一个 batch 是一个事务：seq 自增与写入要么全成，要么全不成。
 * 即使某条被 LWW 丢弃，它也已经抢走一个 seq；留下空洞无害。
 */
export async function applyPush(
  db: D1Like,
  changes: readonly IncomingChange[],
  now: string,
): Promise<number> {
  const stmts: D1PreparedStatementLike[] = [];

  for (const change of changes) {
    // 每个改动先抢一个 seq
    stmts.push(db.prepare(`UPDATE sync_seq SET value = value + 1 WHERE id = 1`));

    if (change.deleted) {
      // 墓碑：把已有行标删。行不存在说明对端本来就没有，忽略即可
      stmts.push(
        db
          .prepare(
            `UPDATE ${change.entity}
                SET deleted = 1,
                    hlc = ?2,
                    updated_at = ?3,
                    seq = (SELECT value FROM sync_seq WHERE id = 1)
              WHERE id = ?1 AND ?2 > hlc`,
          )
          .bind(change.id, change.hlc, now),
      );
      continue;
    }

    if (change.entity === 'lists') {
      const d = parseEntityData(change.entity, change.data) as ListData;
      stmts.push(
        db
          .prepare(
            `INSERT INTO lists (id, name, color, order_key, hlc, seq, deleted, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, (SELECT value FROM sync_seq WHERE id = 1), 0, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               color = excluded.color,
               order_key = excluded.order_key,
               hlc = excluded.hlc,
               seq = excluded.seq,
               deleted = 0,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at
             WHERE excluded.hlc > lists.hlc`,
          )
          .bind(change.id, d.name, d.color ?? null, d.orderKey, change.hlc, d.createdAt, d.updatedAt),
      );
    } else {
      const d = parseEntityData(change.entity, change.data) as TaskData;
      stmts.push(
        db
          .prepare(
            `INSERT INTO tasks (id, list_id, parent_id, title, notes, done, done_at, due_at,
                                order_key, hlc, seq, deleted, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                     (SELECT value FROM sync_seq WHERE id = 1), 0, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
               list_id = excluded.list_id,
               parent_id = excluded.parent_id,
               title = excluded.title,
               notes = excluded.notes,
               done = excluded.done,
               done_at = excluded.done_at,
               due_at = excluded.due_at,
               order_key = excluded.order_key,
               hlc = excluded.hlc,
               seq = excluded.seq,
               deleted = 0,
               created_at = excluded.created_at,
               updated_at = excluded.updated_at
             WHERE excluded.hlc > tasks.hlc`,
          )
          .bind(
            change.id,
            d.listId,
            d.parentId ?? null,
            d.title,
            d.notes ?? null,
            d.done ? 1 : 0,
            d.doneAt ?? null,
            d.dueAt ?? null,
            d.orderKey,
            change.hlc,
            d.createdAt,
            d.updatedAt,
          ),
      );
    }
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  const row = await db
    .prepare(`SELECT value AS v FROM sync_seq WHERE id = 1`)
    .first<{ v: number }>();
  return row?.v ?? 0;
}

/* ------------------------------------------------------------------ *
 * 配对：一次性码 → 长期 token
 * ------------------------------------------------------------------ */

export interface PairingOutcome {
  token: string;
}

/** 过期超过一天的配对码在下次配对时顺手清理，避免表无限增长。 */
const PAIRING_CODE_RETENTION_MS = 24 * 60 * 60 * 1000;

/** 同一设备最多每小时刷新一次 last_seen_at，避免每次同步都产生一次 D1 写入。 */
export const DEVICE_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 消费一次性配对码并登记设备。
 *
 * UPDATE 与 INSERT 在同一个 batch（事务）里：要么都成立，要么整体回滚。
 * 每次请求生成唯一的 claim_id，INSERT 只认「本次刚写入的那个 claim」；
 * 因此即使两次请求拿到完全相同的 now，第二次 UPDATE 影响 0 行、INSERT 也
 * 查不到对应 claim，不会多插一台设备（同毫秒重放）。
 * 返回 null 表示码无效、已用或已过期。
 */
export async function consumePairingCode(
  db: D1Like,
  code: string,
  deviceName: string,
  now: string,
): Promise<PairingOutcome | null> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const deviceId = crypto.randomUUID();
  const claimId = crypto.randomUUID();
  const cleanupCutoff = new Date(
    Date.parse(now) - PAIRING_CODE_RETENTION_MS,
  ).toISOString();

  const [consumed, inserted] = await db.batch([
    db
      .prepare(
        `UPDATE pairing_codes
            SET used_at = ?1, claim_id = ?2
          WHERE code = ?3 AND used_at IS NULL AND expires_at > ?1`,
      )
      .bind(now, claimId, code),
    db
      .prepare(
        `INSERT INTO devices (id, name, token_hash, created_at)
         SELECT ?1, ?2, ?3, ?4
           FROM pairing_codes
          WHERE code = ?5 AND claim_id = ?6`,
      )
      .bind(deviceId, deviceName, tokenHash, now, code, claimId),
    // 顺手清理过期一天的码；正在消费的码要么有效，要么刚被上面的 UPDATE 标记，
    // 不会落进这个删除条件。
    db
      .prepare(`DELETE FROM pairing_codes WHERE expires_at < ?1`)
      .bind(cleanupCutoff),
  ]);

  if ((consumed?.meta?.changes ?? 0) !== 1 || (inserted?.meta?.changes ?? 0) !== 1) {
    return null;
  }

  return { token };
}

/* ------------------------------------------------------------------ *
 * 鉴权
 * ------------------------------------------------------------------ */

export interface DeviceIdentity {
  id: string;
  name: string;
  /** 最近一次通过鉴权的时间；null 表示从未刷新 */
  lastSeenAt: string | null;
}

/** 未撤销的设备才能通过 token 查到；revoked_at 非空一律视为不存在。 */
export async function findDeviceByTokenHash(
  db: D1Like,
  tokenHash: string,
): Promise<DeviceIdentity | null> {
  const row = await db
    .prepare(
      `SELECT id, name, last_seen_at
         FROM devices
        WHERE token_hash = ?1 AND revoked_at IS NULL`,
    )
    .bind(tokenHash)
    .first<{ id: string; name: string; last_seen_at: string | null }>();
  if (!row) return null;
  return { id: row.id, name: row.name, lastSeenAt: row.last_seen_at };
}

/**
 * 刷新设备最近活跃时间。
 *
 * 只在 lastSeenAt 为空或超过 intervalMs 时写库；返回是否真的更新。
 * 这是纯信息字段，调用方不应因为更新失败而拒绝请求。
 */
export async function touchDeviceIfStale(
  db: D1Like,
  id: string,
  now: string,
  intervalMs: number = DEVICE_TOUCH_INTERVAL_MS,
): Promise<boolean> {
  const threshold = new Date(Date.parse(now) - intervalMs).toISOString();
  const result = await db
    .prepare(
      `UPDATE devices
          SET last_seen_at = ?1
        WHERE id = ?2
          AND (last_seen_at IS NULL OR last_seen_at < ?3)`,
    )
    .bind(now, id, threshold)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
