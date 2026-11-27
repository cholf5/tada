import { formatHlc, parseHlc } from '@tada/shared';
import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from './bootstrap';
import { createList } from './repo';
import { createDb, getMeta } from './schema';
import { applyPullPage } from '../sync/pull';
import { collectPushBatch } from '../sync/push';
import { disposeDb, makeDb } from '../test/helpers';

const LIST_ID = '11111111-1111-4111-8111-111111111111';
const TS = '2026-01-01T00:00:00.000Z';

/**
 * P1 回归：HLC 水位必须真的写进 Dexie 的 meta 表。
 *
 * 之前 `ALL_TABLES` 不含 db.meta，persist() 在事务里写 meta 抛 NotFoundError
 * 又被空 catch 吞掉，导致 lastHlc 从未落盘。这里用真实 Dexie + fake-indexeddb
 * 验证落盘结果，而不是只测内存里的 clock。
 */
describe('HLC 水位持久化（真实 Dexie + fake-indexeddb）', () => {
  it('bootstrap → 创建一条 → meta.lastHlc 等于该行 hlc', async () => {
    const db = makeDb();
    try {
      const { clock } = await bootstrap(db);
      const id = await createList({ db, clock }, '工作');
      expect(id).toBeTruthy();

      const row = await db.lists.get(id!);
      expect(row).toBeDefined();
      expect(await getMeta(db, 'lastHlc')).toBe(row!.hlc);
    } finally {
      await disposeDb(db);
    }
  });

  it('重新 bootstrap 后 clock.next() 严格大于历史水位', async () => {
    const name = `tada-persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const first = createDb(name);
    const boot1 = await bootstrap(first);
    const id = await createList({ db: first, clock: boot1.clock }, '工作');
    const historical = (await first.lists.get(id!))!.hlc;
    expect(await getMeta(first, 'lastHlc')).toBe(historical);
    first.close();

    const second = createDb(name);
    try {
      const boot2 = await bootstrap(second);
      const next = boot2.clock.next(Date.now());

      expect(historical).toBeTruthy();
      expect(next > historical).toBe(true);
      // persist 是异步串行队列：等它真正落盘再断言，避免读到旧水位
      await vi.waitFor(async () => {
        expect(await getMeta(second, 'lastHlc')).toBe(next);
      });
    } finally {
      await second.delete();
    }
  });

  it('pull 回灌时钟（observe）后水位也落盘', async () => {
    const db = makeDb();
    try {
      const { clock } = await bootstrap(db);
      const remote = formatHlc({ ms: 9_000_000_000_000, counter: 7, device: 'remote' });

      // observe 发生在 applyPullPage 的 Dexie 事务里；meta 必须在事务 scope 中
      await applyPullPage(
        db,
        [
          {
            entity: 'lists',
            id: LIST_ID,
            hlc: remote,
            deleted: false,
            data: { name: '远端', color: null, orderKey: 'a0', createdAt: TS, updatedAt: TS },
          },
        ],
        clock,
      );

      await vi.waitFor(async () => {
        expect(await getMeta(db, 'lastHlc')).toBeTruthy();
      });
      const stored = parseHlc((await getMeta(db, 'lastHlc'))!);
      expect(stored.ms).toBe(9_000_000_000_000);
      expect(stored.counter).toBe(7);
    } finally {
      await disposeDb(db);
    }
  });

  it('push 为已物理删除的行补墓碑时，水位同样落盘', async () => {
    const db = makeDb();
    try {
      const { clock } = await bootstrap(db);
      const missingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const oldHlc = formatHlc({ ms: 1000, counter: 0, device: 'gone' });
      await db.outbox.put({
        key: `lists:${missingId}`,
        entity: 'lists',
        rowId: missingId,
        hlc: oldHlc,
        queuedAt: 1,
      });

      const batch = await collectPushBatch({ db, clock });
      expect(batch.changes).toHaveLength(1);
      expect(batch.changes[0]?.deleted).toBe(true);

      const stored = await getMeta(db, 'lastHlc');
      expect(stored).toBeTruthy();
      expect(parseHlc(stored!).ms).toBeGreaterThan(1000);
    } finally {
      await disposeDb(db);
    }
  });
});
