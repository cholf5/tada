import {
  createHlcClock,
  formatHlc,
  type ListData,
  type PullResponse,
  type WireChange,
} from '@tada/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createList, createTask } from '../db/repo';
import { getMeta, setMeta, type TadaDb } from '../db/schema';
import { collectPushBatch, applyPushAccepted } from '../sync/push';
import { SyncEngine } from '../sync/engine';
import { requeueAllLocalRows } from '../sync/reseed';
import { disposeDb, makeDb, makeDeps } from '../test/helpers';

let db: TadaDb;

beforeEach(() => {
  db = makeDb();
});

afterEach(async () => {
  await disposeDb(db);
});

const TS = '2026-01-01T00:00:00.000Z';
const OTHER_LIST = '99999999-9999-4999-8999-999999999999';

function h(ms: number): string {
  return formatHlc({ ms, counter: 0, device: 'reseed' });
}

function remoteListChange(): WireChange<'lists'> {
  const data: ListData = {
    name: '远端',
    color: null,
    orderKey: 'a0',
    createdAt: TS,
    updatedAt: TS,
  };
  return { entity: 'lists', id: OTHER_LIST, hlc: h(1000), deleted: false, data };
}

describe('requeueAllLocalRows', () => {
  it('把所有未删除行重新入队，跳过墓碑，保留原 hlc', async () => {
    const deps = makeDeps(db);
    const listId = await createList(deps, '本地');
    if (!listId) throw new Error('list not created');
    const aliveId = await createTask(deps, listId, '保留');
    const goneId = await createTask(deps, listId, '已删');
    if (!aliveId || !goneId) throw new Error('task not created');

    // 模拟已经同步过一轮
    const batch = await collectPushBatch({ db, clock: deps.clock });
    await applyPushAccepted({ db, clock: deps.clock }, batch.sent);
    expect(await db.outbox.count()).toBe(0);

    // 一个已删除的墓碑行不应被重新上传
    const gone = await db.tasks.get(goneId);
    if (!gone) throw new Error('task missing');
    await db.tasks.put({ ...gone, deleted: 1 });

    const count = await requeueAllLocalRows(db, 1000);

    expect(count).toBe(2);
    const listEntry = await db.outbox.get(`lists:${listId}`);
    const taskEntry = await db.outbox.get(`tasks:${aliveId}`);
    expect(listEntry?.hlc).toBe((await db.lists.get(listId))?.hlc);
    expect(taskEntry?.hlc).toBe((await db.tasks.get(aliveId))?.hlc);
    expect(await db.outbox.get(`tasks:${goneId}`)).toBeUndefined();
  });

  it('重复调用按行折叠，不会产生重复条目', async () => {
    const deps = makeDeps(db);
    const listId = await createList(deps, '本地');
    if (!listId) throw new Error('list not created');
    // 模拟已经同步过、outbox 已清空
    await db.outbox.clear();

    await requeueAllLocalRows(db, 1000);
    await requeueAllLocalRows(db, 2000);

    expect(await db.outbox.count()).toBe(1);
    // 首次入队的 queuedAt 被保留
    expect((await db.outbox.get(`lists:${listId}`))?.queuedAt).toBe(1000);
  });
});

describe('配对到空服务器的自动补推', () => {
  async function seedSyncedList(
    deps: ReturnType<typeof makeDeps>,
    name = '本地',
  ): Promise<string> {
    const listId = await createList(deps, name);
    if (!listId) throw new Error('list not created');
    const batch = await collectPushBatch({ db, clock: deps.clock });
    await applyPushAccepted({ db, clock: deps.clock }, batch.sent);
    expect(await db.outbox.count()).toBe(0);
    return listId;
  }

  it('首次 pull 返回 0 条且 nextSince=0 时，把本地行重新入队并推送', async () => {
    const deps = makeDeps(db);
    const listId = await seedSyncedList(deps);

    const pushed: WireChange[][] = [];
    const transport = {
      async push(_token: string, changes: WireChange[]) {
        pushed.push(changes);
        return { lastSeq: 100 };
      },
      async pull(): Promise<PullResponse> {
        return { changes: [], nextSince: 0, hasMore: false };
      },
    };

    await setMeta(db, 'token', 'test-token');
    await setMeta(db, 'pairReseed', 1);

    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });
    await engine.syncNow();
    // 第一轮结束后引擎会自己再跑一轮；这里再 await 一次确保它跑完
    await engine.syncNow();

    expect(pushed.length).toBeGreaterThan(0);
    expect(pushed.flat().some((change) => change.id === listId)).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    expect(await getMeta(db, 'pairReseed')).toBe(0);
    expect((await db.lists.get(listId))?.remote).toBe(1);
  });

  it('服务器已有全部本地行时不补推', async () => {
    const deps = makeDeps(db);
    const listId = await seedSyncedList(deps, '服务端也有');

    const pushed: WireChange[][] = [];
    const transport = {
      async push(_token: string, changes: WireChange[]) {
        pushed.push(changes);
        return { lastSeq: 100 };
      },
      async pull(): Promise<PullResponse> {
        return {
          changes: [
            {
              ...remoteListChange(),
              id: listId,
              hlc: h(1000),
              data: {
                name: '服务端也有',
                color: null,
                orderKey: 'a0',
                createdAt: TS,
                updatedAt: TS,
              },
            },
          ],
          nextSince: 5,
          hasMore: false,
        };
      },
    };

    await setMeta(db, 'token', 'test-token');
    await setMeta(db, 'pairReseed', 1);

    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });
    await engine.syncNow();
    await engine.syncNow();

    expect(pushed).toEqual([]);
    expect(await db.outbox.count()).toBe(0);
    expect(await getMeta(db, 'pairReseed')).toBe(0);
  });

  it('配对到非空服务器时，只补推服务端没有的本地行（P13）', async () => {
    const deps = makeDeps(db);
    const keptId = await seedSyncedList(deps, '服务端已有');
    const missingId = await seedSyncedList(deps, '仅本地有');

    // 服务端只返回 keptId；missingId 是本地独有行
    const pushed: WireChange[][] = [];
    const transport = {
      async push(_token: string, changes: WireChange[]) {
        pushed.push(changes);
        return { lastSeq: 100 };
      },
      async pull(): Promise<PullResponse> {
        return {
          changes: [
            {
              entity: 'lists',
              id: keptId,
              hlc: h(1000),
              deleted: false,
              data: {
                name: '服务端已有',
                color: null,
                orderKey: 'a0',
                createdAt: TS,
                updatedAt: TS,
              },
            },
          ],
          nextSince: 5,
          hasMore: false,
        };
      },
    };

    await setMeta(db, 'token', 'test-token');
    await setMeta(db, 'pairReseed', 1);

    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });
    await engine.syncNow();
    await vi.waitFor(async () => {
      expect(await db.outbox.count()).toBe(0);
    });

    const pushedIds = new Set(pushed.flat().map((change) => change.id));
    expect(pushedIds.has(missingId)).toBe(true);
    expect(pushedIds.has(keptId)).toBe(false);
    expect(await getMeta(db, 'pairReseed')).toBe(0);
  });

  it('reseedLocalData 手动兜底会重新上传所有行', async () => {
    const deps = makeDeps(db);
    const listId = await seedSyncedList(deps);

    const pushed: WireChange[][] = [];
    const transport = {
      async push(_token: string, changes: WireChange[]) {
        pushed.push(changes);
        return { lastSeq: 100 };
      },
      async pull(): Promise<PullResponse> {
        return { changes: [], nextSince: 0, hasMore: false };
      },
    };

    await setMeta(db, 'token', 'test-token');
    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });

    const count = await engine.reseedLocalData();
    await engine.syncNow();

    expect(count).toBe(1);
    expect(pushed.flat().some((change) => change.id === listId)).toBe(true);
  });
});
