import { formatHlc } from '@tada/shared';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_TOUCH_INTERVAL_MS,
  applyPush,
  consumePairingCode,
  findDeviceByTokenHash,
  pullPage,
  sha256Hex,
  touchDeviceIfStale,
  type D1Like,
  type IncomingChange,
} from './store';
import { makeDb } from './test/sqlite';

/* ------------------------------------------------------------------ *
 * 工具与测试数据
 * ------------------------------------------------------------------ */

const TS = '2026-01-01T00:00:00.000Z';

function h(ms: number, counter = 0): string {
  return formatHlc({ ms, counter, device: 'test' });
}

interface RawListRow {
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

interface RawDeviceRow {
  id: string;
  name: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

interface RawCodeRow {
  code: string;
  expires_at: string;
  used_at: string | null;
}

async function insertList(db: D1Like, id: string, seq: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO lists (id, name, color, order_key, hlc, seq, deleted, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)`,
    )
    .bind(id, `L${seq}`, null, 'a0', h(seq), seq, TS, TS)
    .run();
}

async function insertTask(db: D1Like, id: string, seq: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tasks (id, list_id, parent_id, title, notes, done, done_at, due_at,
                          order_key, hlc, seq, deleted, created_at, updated_at)
       VALUES (?1, ?2, NULL, ?3, NULL, 0, NULL, NULL, ?4, ?5, ?6, 0, ?7, ?8)`,
    )
    .bind(id, 'list-shared', `T${seq}`, 'a0', h(seq), seq, TS, TS)
    .run();
}

async function getList(db: D1Like, id: string): Promise<RawListRow | null> {
  return db.prepare(`SELECT * FROM lists WHERE id = ?1`).bind(id).first<RawListRow>();
}

async function getDevice(db: D1Like, id: string): Promise<RawDeviceRow | null> {
  return db.prepare(`SELECT * FROM devices WHERE id = ?1`).bind(id).first<RawDeviceRow>();
}

async function getCode(db: D1Like, code: string): Promise<RawCodeRow | null> {
  return db.prepare(`SELECT * FROM pairing_codes WHERE code = ?1`).bind(code).first<RawCodeRow>();
}

async function count(db: D1Like, table: 'lists' | 'tasks' | 'devices'): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

function listChange(id: string, hlc: string, name: string): IncomingChange {
  return {
    entity: 'lists',
    id,
    hlc,
    deleted: false,
    data: { name, color: null, orderKey: 'a0', createdAt: TS, updatedAt: TS },
  };
}

function tombstone(id: string, hlc: string): IncomingChange {
  return { entity: 'lists', id, hlc, deleted: true };
}

/* ------------------------------------------------------------------ *
 * pullPage：真实分页 SQL
 * ------------------------------------------------------------------ */

describe('pullPage（真实 SQL）', () => {
  it('单表剩余行数 > limit 时 hasMore 为 true', async () => {
    const db = makeDb();
    for (let seq = 1; seq <= 6; seq += 1) await insertList(db, `list-${seq}`, seq);

    const page = await pullPage(db, 0, 5);

    expect(page.changes).toHaveLength(5);
    expect(page.changes.map((change) => change.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(page.nextSince).toBe(5);
    // 若 SQL 只取 limit 条而不是 limit + 1，这里会被误判为 false
    expect(page.hasMore).toBe(true);
  });

  it('恰好 limit 行时 hasMore 为 false', async () => {
    const db = makeDb();
    for (let seq = 1; seq <= 5; seq += 1) await insertList(db, `list-${seq}`, seq);

    const page = await pullPage(db, 0, 5);

    expect(page.changes).toHaveLength(5);
    expect(page.nextSince).toBe(5);
    expect(page.hasMore).toBe(false);
  });

  it('跨表按 seq 合并，nextSince 停在整页最后一行', async () => {
    const db = makeDb();
    await insertList(db, 'list-1', 1);
    await insertList(db, 'list-4', 4);
    await insertTask(db, 'task-2', 2);
    await insertTask(db, 'task-3', 3);
    await insertTask(db, 'task-5', 5);

    const page = await pullPage(db, 0, 10);

    expect(page.changes.map((change) => change.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(page.changes.map((change) => change.entity)).toEqual([
      'lists',
      'tasks',
      'tasks',
      'lists',
      'tasks',
    ]);
    expect(page.nextSince).toBe(5);
    expect(page.hasMore).toBe(false);
  });

  it('分页后下一轮从 nextSince 继续，不丢不重', async () => {
    const db = makeDb();
    for (let seq = 1; seq <= 5; seq += 1) await insertList(db, `list-${seq}`, seq);

    const first = await pullPage(db, 0, 3);
    expect(first.changes.map((change) => change.seq)).toEqual([1, 2, 3]);
    expect(first.nextSince).toBe(3);
    expect(first.hasMore).toBe(true);

    const second = await pullPage(db, first.nextSince, 3);
    expect(second.changes.map((change) => change.seq)).toEqual([4, 5]);
    expect(second.nextSince).toBe(5);
    expect(second.hasMore).toBe(false);
  });

  it('seq <= since 的行被过滤', async () => {
    const db = makeDb();
    for (let seq = 1; seq <= 4; seq += 1) await insertList(db, `list-${seq}`, seq);

    const page = await pullPage(db, 2, 10);

    expect(page.changes.map((change) => change.seq)).toEqual([3, 4]);
    expect(page.nextSince).toBe(4);
  });
});

/* ------------------------------------------------------------------ *
 * applyPush：LWW
 * ------------------------------------------------------------------ */

describe('applyPush：LWW（真实 SQL）', () => {
  it('新行写入，重复 id 只有 hlc 严格更大才覆盖', async () => {
    const db = makeDb();

    expect(await applyPush(db, [listChange('list-1', h(2000), '第一版')], TS)).toBe(1);

    // 更新的 hlc：覆盖，len 推进到 2
    expect(await applyPush(db, [listChange('list-1', h(3000), '第二版')], TS)).toBe(2);
    let row = await getList(db, 'list-1');
    expect(row?.name).toBe('第二版');
    expect(row?.seq).toBe(2);

    // 更旧的 hlc：忽略，行保持第二版与 seq=2；但全局 seq 仍然推进
    expect(await applyPush(db, [listChange('list-1', h(1000), '远古版')], TS)).toBe(3);
    row = await getList(db, 'list-1');
    expect(row?.name).toBe('第二版');
    expect(row?.seq).toBe(2);

    // 相等的 hlc：也忽略（严格大于才覆盖）
    expect(await applyPush(db, [listChange('list-1', h(3000), '相等版')], TS)).toBe(4);
    row = await getList(db, 'list-1');
    expect(row?.name).toBe('第二版');
    expect(row?.seq).toBe(2);
  });

  it('一批多条改动按顺序各拿一个 seq', async () => {
    const db = makeDb();

    const lastSeq = await applyPush(
      db,
      [listChange('list-1', h(1000), 'A'), listChange('list-2', h(1001), 'B')],
      TS,
    );

    expect(lastSeq).toBe(2);
    expect((await getList(db, 'list-1'))?.seq).toBe(1);
    expect((await getList(db, 'list-2'))?.seq).toBe(2);
  });

  it('任务实体写进 tasks 表，布尔值转 0/1', async () => {
    const db = makeDb();
    await applyPush(
      db,
      [
        {
          entity: 'tasks',
          id: 'task-1',
          hlc: h(1000),
          deleted: false,
          data: {
            listId: '11111111-1111-4111-8111-111111111111',
            parentId: null,
            title: '写代码',
            notes: null,
            done: true,
            doneAt: TS,
            dueAt: '2026-12-01',
            orderKey: 'a0',
            createdAt: TS,
            updatedAt: TS,
          },
        },
      ],
      TS,
    );

    const row = await db
      .prepare(`SELECT * FROM tasks WHERE id = ?1`)
      .bind('task-1')
      .first<{ title: string; done: number; due_at: string }>();
    expect(row?.title).toBe('写代码');
    expect(row?.done).toBe(1);
    expect(row?.due_at).toBe('2026-12-01');
  });

  it('任务更新同样遵循 LWW：新覆盖、旧忽略、相等忽略', async () => {
    const db = makeDb();
    const task = (hlc: string, title: string): IncomingChange => ({
      entity: 'tasks',
      id: 'task-1',
      hlc,
      deleted: false,
      data: {
        listId: '11111111-1111-4111-8111-111111111111',
        parentId: null,
        title,
        notes: null,
        done: false,
        doneAt: null,
        dueAt: null,
        orderKey: 'a0',
        createdAt: TS,
        updatedAt: TS,
      },
    });
    const readTitle = async () =>
      (
        await db
          .prepare(`SELECT * FROM tasks WHERE id = ?1`)
          .bind('task-1')
          .first<{ title: string; seq: number }>()
      )!;

    await applyPush(db, [task(h(1000), '第一版')], TS);

    // 更新的 hlc：走 ON CONFLICT DO UPDATE 覆盖分支
    expect(await applyPush(db, [task(h(3000), '第二版')], TS)).toBe(2);
    expect((await readTitle()).title).toBe('第二版');
    expect((await readTitle()).seq).toBe(2);

    // 更旧 / 相等的 hlc：DO UPDATE 的 WHERE 不成立，忽略
    expect(await applyPush(db, [task(h(2000), '旧版')], TS)).toBe(3);
    expect(await applyPush(db, [task(h(3000), '相等版')], TS)).toBe(4);
    expect((await readTitle()).title).toBe('第二版');
    expect((await readTitle()).seq).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * applyPush：墓碑
 * ------------------------------------------------------------------ */

describe('applyPush：墓碑（真实 SQL）', () => {
  it('墓碑写 deleted=1、更新 updated_at，并推进 seq', async () => {
    const db = makeDb();
    await applyPush(db, [listChange('list-1', h(2000), '存')], TS);

    const tombstoneNow = '2026-05-01T00:00:00.000Z';
    expect(await applyPush(db, [tombstone('list-1', h(3000))], tombstoneNow)).toBe(2);

    const row = await getList(db, 'list-1');
    expect(row?.deleted).toBe(1);
    expect(row?.hlc).toBe(h(3000));
    expect(row?.updated_at).toBe(tombstoneNow);
    expect(row?.seq).toBe(2);
  });

  it('旧 hlc 的墓碑无效，但全局 seq 仍然推进', async () => {
    const db = makeDb();
    await applyPush(db, [listChange('list-1', h(2000), '存')], TS);

    expect(await applyPush(db, [tombstone('list-1', h(1000))], TS)).toBe(2);

    const row = await getList(db, 'list-1');
    expect(row?.deleted).toBe(0);
    expect(row?.hlc).toBe(h(2000));
    expect(row?.seq).toBe(1);
  });

  it('对不存在的行墓碑是 no-op，不报错', async () => {
    const db = makeDb();

    expect(await applyPush(db, [tombstone('ghost', h(1000))], TS)).toBe(1);
    expect(await count(db, 'lists')).toBe(0);
  });

  it('tasks 墓碑与 lists 走同一条 UPDATE，同样标删并更新 updated_at', async () => {
    const db = makeDb();
    await applyPush(
      db,
      [
        {
          entity: 'tasks',
          id: 'task-1',
          hlc: h(2000),
          deleted: false,
          data: {
            listId: '11111111-1111-4111-8111-111111111111',
            parentId: null,
            title: '任务',
            notes: null,
            done: false,
            doneAt: null,
            dueAt: null,
            orderKey: 'a0',
            createdAt: TS,
            updatedAt: TS,
          },
        },
      ],
      TS,
    );

    const tombstoneNow = '2026-06-01T00:00:00.000Z';
    expect(
      await applyPush(db, [{ entity: 'tasks', id: 'task-1', hlc: h(3000), deleted: true }], tombstoneNow),
    ).toBe(2);

    const row = await db
      .prepare(`SELECT * FROM tasks WHERE id = ?1`)
      .bind('task-1')
      .first<{ deleted: number; hlc: string; updated_at: string; seq: number }>();
    expect(row?.deleted).toBe(1);
    expect(row?.hlc).toBe(h(3000));
    expect(row?.updated_at).toBe(tombstoneNow);
    expect(row?.seq).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * consumePairingCode / findDeviceByTokenHash：配对与鉴权
 * ------------------------------------------------------------------ */

describe('配对与鉴权（真实 SQL）', () => {
  const NOW = '2026-11-27T00:00:00.000Z';
  const NOW_LATER = '2026-11-27T00:00:01.000Z';
  const FUTURE = '2026-11-27T00:10:00.000Z';
  const PAST = '2026-11-26T23:59:59.000Z';

  async function insertCode(db: D1Like, code: string, expiresAt: string): Promise<void> {
    await db
      .prepare(`INSERT INTO pairing_codes (code, expires_at) VALUES (?1, ?2)`)
      .bind(code, expiresAt)
      .run();
  }

  it('一次性码成功一次：返 token、登记设备、标记已用', async () => {
    const db = makeDb();
    await insertCode(db, 'ABCDEF0123', FUTURE);

    const outcome = await consumePairingCode(db, 'ABCDEF0123', '我的 Mac', NOW);

    expect(outcome).not.toBeNull();
    expect(outcome!.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    expect(await count(db, 'devices')).toBe(1);
    const code = await getCode(db, 'ABCDEF0123');
    expect(code?.used_at).toBe(NOW);

    // 设备存的是 hash，不是 token 原文
    const devices = await db
      .prepare(`SELECT * FROM devices`)
      .all<RawDeviceRow>();
    const device = devices.results?.[0];
    expect(device?.name).toBe('我的 Mac');
    expect(device?.token_hash).toBe(await sha256Hex(outcome!.token));
    expect(device?.token_hash).not.toBe(outcome!.token);
  });

  it('重放同一个码失败，且不会多插设备', async () => {
    const db = makeDb();
    await insertCode(db, 'ABCDEF0123', FUTURE);

    expect(await consumePairingCode(db, 'ABCDEF0123', '第一台', NOW)).not.toBeNull();
    // 每次 HTTP 请求都会重新取 now；重放时时间已经前进
    expect(await consumePairingCode(db, 'ABCDEF0123', '第二台', NOW_LATER)).toBeNull();

    expect(await count(db, 'devices')).toBe(1);
    expect((await getCode(db, 'ABCDEF0123'))?.used_at).toBe(NOW);
  });

  it('相同 now 连续消费两次：第二次返回 null，且只登记一台设备', async () => {
    const db = makeDb();
    await insertCode(db, 'ABCDEF0123', FUTURE);

    expect(await consumePairingCode(db, 'ABCDEF0123', '第一台', NOW)).not.toBeNull();
    // 用与第一次完全相同的 now 重放：UPDATE 影响 0 行，但旧实现的 INSERT 仍会
    // 命中 used_at = now，从而多插一台设备。claim_id 条件让这条 INSERT 不命中。
    expect(await consumePairingCode(db, 'ABCDEF0123', '第二台', NOW)).toBeNull();

    expect(await count(db, 'devices')).toBe(1);
    const devices = await db.prepare(`SELECT * FROM devices`).all<RawDeviceRow>();
    expect(devices.results?.map((device) => device.name)).toEqual(['第一台']);
    expect((await getCode(db, 'ABCDEF0123'))?.used_at).toBe(NOW);
  });

  it('过期的码失败，不会登记设备', async () => {
    const db = makeDb();
    await insertCode(db, 'ABCDEF0123', PAST);

    expect(await consumePairingCode(db, 'ABCDEF0123', '过期设备', NOW)).toBeNull();
    expect(await count(db, 'devices')).toBe(0);

    const code = await getCode(db, 'ABCDEF0123');
    expect(code?.used_at).toBeNull();
  });

  it('未知的码失败', async () => {
    const db = makeDb();
    expect(await consumePairingCode(db, 'FFFFFFFF', '设备', NOW)).toBeNull();
    expect(await count(db, 'devices')).toBe(0);
  });

  it('hash 能查到未撤销设备；撤销或未知 hash 查不到', async () => {
    const db = makeDb();
    await insertCode(db, 'ABCDEF0123', FUTURE);
    const outcome = await consumePairingCode(db, 'ABCDEF0123', '我的 iPhone', NOW);
    if (!outcome) throw new Error('pairing should succeed');

    const found = await findDeviceByTokenHash(db, await sha256Hex(outcome.token));
    expect(found?.name).toBe('我的 iPhone');

    // 撤销后同一个 hash 查不到
    await db
      .prepare(`UPDATE devices SET revoked_at = ?1 WHERE id = ?2`)
      .bind(NOW, found!.id)
      .run();
    expect(await findDeviceByTokenHash(db, await sha256Hex(outcome.token))).toBeNull();

    // 未知 hash 也查不到
    expect(await findDeviceByTokenHash(db, await sha256Hex('nope'))).toBeNull();
  });

  it('消费配对码时清理过期超过一天的旧码，不影响当前码', async () => {
    const db = makeDb();
    // 两天前就过期的旧码
    await insertCode(db, 'OLDC0DE123', '2026-11-25T00:00:00.000Z');
    await insertCode(db, 'ABCDEF0123', FUTURE);

    expect(await consumePairingCode(db, 'ABCDEF0123', '设备', NOW)).not.toBeNull();

    expect(await getCode(db, 'OLDC0DE123')).toBeNull();
    expect((await getCode(db, 'ABCDEF0123'))?.used_at).toBe(NOW);
  });

  it('last_seen_at 只在超过刷新间隔时更新', async () => {
    const db = makeDb();
    await insertCode(db, 'ABCDEF0123', FUTURE);
    const outcome = await consumePairingCode(db, 'ABCDEF0123', '设备', NOW);
    if (!outcome) throw new Error('pairing should succeed');
    const found = await findDeviceByTokenHash(db, await sha256Hex(outcome.token));
    if (!found) throw new Error('device should exist');

    expect(found.lastSeenAt).toBeNull();
    expect(await touchDeviceIfStale(db, found.id, NOW)).toBe(true);
    expect((await getDevice(db, found.id))?.last_seen_at).toBe(NOW);

    // 一分钟后仍在间隔内：不写
    const soon = new Date(Date.parse(NOW) + 60_000).toISOString();
    expect(await touchDeviceIfStale(db, found.id, soon)).toBe(false);

    // 超过一小时：刷新
    const later = new Date(Date.parse(NOW) + DEVICE_TOUCH_INTERVAL_MS + 1).toISOString();
    expect(await touchDeviceIfStale(db, found.id, later)).toBe(true);
    expect((await getDevice(db, found.id))?.last_seen_at).toBe(later);
  });
});
