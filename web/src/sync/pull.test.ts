import {
  formatHlc,
  type ListData,
  type PullResponse,
  type TaskData,
  type WireChange,
} from '@tada/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createList, type RepoDeps } from '../db/repo';
import { getMeta, type TadaDb } from '../db/schema';
import { applyPullPage, pullAll, type PullTransport } from '../sync/pull';
import { disposeDb, makeDb, makeDeps } from '../test/helpers';

let db: TadaDb;
let deps: RepoDeps;

beforeEach(() => {
  db = makeDb();
  deps = makeDeps(db);
});

afterEach(async () => {
  await disposeDb(db);
});

const TS = '2026-01-01T00:00:00.000Z';
const LIST_A = '11111111-1111-4111-8111-111111111111';
const LIST_B = '22222222-2222-4222-8222-222222222222';
const TASK_A = '33333333-3333-4333-8333-333333333333';

function h(ms: number, counter = 0): string {
  return formatHlc({ ms, counter, device: 'pulltest' });
}

function listChange(options: {
  hlc: string;
  name: string;
  id?: string;
  deleted?: boolean;
  orderKey?: string;
}): WireChange {
  const data: ListData = {
    name: options.name,
    color: null,
    orderKey: options.orderKey ?? 'a0',
    createdAt: TS,
    updatedAt: TS,
  };
  return {
    entity: 'lists',
    id: options.id ?? LIST_A,
    hlc: options.hlc,
    deleted: options.deleted ?? false,
    data: options.deleted ? undefined : data,
  };
}

function taskChange(options: {
  hlc: string;
  listId: string;
  title: string;
  id?: string;
  deleted?: boolean;
}): WireChange {
  const data: TaskData = {
    listId: options.listId,
    parentId: null,
    title: options.title,
    notes: null,
    done: false,
    doneAt: null,
    dueAt: null,
    orderKey: 'a0',
    createdAt: TS,
    updatedAt: TS,
  };
  return {
    entity: 'tasks',
    id: options.id ?? TASK_A,
    hlc: options.hlc,
    deleted: options.deleted ?? false,
    data: options.deleted ? undefined : data,
  };
}

describe('pull 合并', () => {
  it('本地无则写入；新覆盖旧；相等与更旧都忽略', async () => {
    const newer = h(2000);
    const older = h(1000);

    await applyPullPage(db, [listChange({ hlc: newer, name: '新', orderKey: 'a2' })]);
    expect((await db.lists.get(LIST_A))?.name).toBe('新');

    // 相等 HLC 不写
    await applyPullPage(db, [listChange({ hlc: newer, name: '相等', orderKey: 'a2' })]);
    expect((await db.lists.get(LIST_A))?.name).toBe('新');

    // 更旧 HLC 不写
    await applyPullPage(db, [listChange({ hlc: older, name: '旧', orderKey: 'a1' })]);
    expect((await db.lists.get(LIST_A))?.name).toBe('新');

    expect(await db.lists.count()).toBe(1);
  });

  it('同一页里跨表合并', async () => {
    const applied = await applyPullPage(db, [
      listChange({ hlc: h(1000), name: '工作' }),
      taskChange({ hlc: h(1000), listId: LIST_A, title: '写代码' }),
    ]);

    expect(applied).toBe(2);
    expect((await db.lists.get(LIST_A))?.name).toBe('工作');
    expect((await db.tasks.get(TASK_A))?.title).toBe('写代码');
    expect((await db.tasks.get(TASK_A))?.listId).toBe(LIST_A);
    expect((await db.tasks.get(TASK_A))?.remote).toBe(1);
  });

  it('墓碑把本地行标删', async () => {
    await applyPullPage(db, [listChange({ hlc: h(1000), name: '工作' })]);
    await applyPullPage(db, [listChange({ hlc: h(2000), name: '工作', deleted: true })]);

    const row = await db.lists.get(LIST_A);
    expect(row?.deleted).toBe(1);
    expect(row?.hlc).toBe(h(2000));
  });

  it('从没见过的墓碑被忽略', async () => {
    const applied = await applyPullPage(db, [
      listChange({ hlc: h(1000), name: '幽灵', deleted: true }),
    ]);

    expect(applied).toBe(0);
    expect(await db.lists.count()).toBe(0);
  });

  it('远端更新覆盖本地时，删掉该行的 outbox 条目', async () => {
    const listId = await createList(deps, '本地');
    if (!listId) throw new Error('list not created');
    const local = await db.lists.get(listId);
    expect(local).toBeDefined();
    expect(await db.outbox.get(`lists:${listId}`)).toBeDefined();

    const remoteHlc = h(Date.now() + 60_000);
    await applyPullPage(db, [
      listChange({ id: listId, hlc: remoteHlc, name: '远端', orderKey: 'a0' }),
    ]);

    expect((await db.lists.get(listId))?.name).toBe('远端');
    expect(await db.outbox.get(`lists:${listId}`)).toBeUndefined();
  });

  it('outbox 里的版本比 incoming 更新时不能误删（P9）', async () => {
    const listId = await createList(deps, '本地');
    if (!listId) throw new Error('list not created');
    const local = (await db.lists.get(listId))!;

    // 人为构造「请求在途」：本地行比 incoming 旧，但 outbox 里已有更新的待推版本
    const incoming = h(Date.now() + 30_000);
    const newerLocal = h(Date.now() + 60_000);
    await db.lists.put({ ...local, hlc: h(1000) });
    await db.outbox.put({
      key: `lists:${listId}`,
      entity: 'lists',
      rowId: listId,
      hlc: newerLocal,
      queuedAt: 1,
    });

    await applyPullPage(db, [
      listChange({ id: listId, hlc: incoming, name: '远端', orderKey: 'a0' }),
    ]);

    expect((await db.lists.get(listId))?.name).toBe('远端');
    // 不能依赖「outbox.hlc == 本地行 hlc」的不变式，必须显式比较
    expect(await db.outbox.get(`lists:${listId}`)).toBeDefined();
  });

  it('远端更旧时不覆盖本地，并保留 outbox', async () => {
    const listId = await createList(deps, '本地更新');
    if (!listId) throw new Error('list not created');

    await applyPullPage(db, [
      listChange({ id: listId, hlc: h(1000), name: '远古', orderKey: 'a0' }),
    ]);

    expect((await db.lists.get(listId))?.name).toBe('本地更新');
    expect(await db.outbox.get(`lists:${listId}`)).toBeDefined();
  });
});

describe('pullAll 游标与分页', () => {
  it('按游标推进，跨表合并，hasMore 后立即再拉', async () => {
    const calls: { since: number; limit: number }[] = [];
    const pages: PullResponse[] = [
      {
        changes: [
          listChange({ id: LIST_A, hlc: h(1000), name: 'L1' }),
          taskChange({ id: TASK_A, hlc: h(1000), listId: LIST_A, title: 'T1' }),
        ],
        nextSince: 2,
        hasMore: true,
      },
      {
        changes: [listChange({ id: LIST_B, hlc: h(2000), name: 'L2' })],
        nextSince: 7,
        hasMore: false,
      },
    ];

    const transport: PullTransport = {
      async pull(_token, since, limit) {
        calls.push({ since, limit });
        const page = pages.shift();
        if (!page) throw new Error('unexpected extra pull');
        return page;
      },
    };

    const summary = await pullAll(db, transport, 'token', { limit: 2 });

    expect(calls).toEqual([
      { since: 0, limit: 2 },
      { since: 2, limit: 2 },
    ]);
    expect(summary).toEqual({
      pages: 2,
      applied: 3,
      received: 3,
      since: 7,
      seenIds: new Set([LIST_A, TASK_A, LIST_B]),
    });
    expect(await getMeta(db, 'lastSeq')).toBe(7);
    expect(await db.lists.count()).toBe(2);
    expect(await db.tasks.count()).toBe(1);
  });

  it('从已保存的 lastSeq 继续拉取', async () => {
    await db.meta.put({ key: 'lastSeq', value: 12 });
    const calls: number[] = [];
    const transport: PullTransport = {
      async pull(_token, since) {
        calls.push(since);
        return { changes: [], nextSince: since, hasMore: false };
      },
    };

    const summary = await pullAll(db, transport, 'token');
    expect(calls).toEqual([12]);
    expect(summary.since).toBe(12);
  });

  it('hasMore 为真但游标不前进时终止，避免死循环', async () => {
    const transport: PullTransport = {
      async pull() {
        return { changes: [], nextSince: 0, hasMore: true };
      },
    };

    const summary = await pullAll(db, transport, 'token');
    expect(summary.pages).toBe(1);
    expect(summary.since).toBe(0);
  });

  it('relay 分页缺陷兜底：整页返回且 hasMore=false 时继续拉', async () => {
    const calls: number[] = [];
    const pages: PullResponse[] = [
      {
        changes: [
          listChange({ id: LIST_A, hlc: h(1000), name: 'A' }),
          listChange({ id: LIST_B, hlc: h(1000), name: 'B' }),
        ],
        nextSince: 2,
        hasMore: false,
      },
      { changes: [], nextSince: 2, hasMore: false },
    ];

    const transport: PullTransport = {
      async pull(_token, since) {
        calls.push(since);
        const page = pages.shift();
        if (!page) throw new Error('unexpected extra pull');
        return page;
      },
    };

    const summary = await pullAll(db, transport, 'token', { limit: 2 });

    expect(calls).toEqual([0, 2]);
    expect(summary.pages).toBe(2);
    expect(await db.lists.count()).toBe(2);
  });

  it('把拉到的 HLC 回灌给时钟', async () => {
    const observed: string[] = [];
    await applyPullPage(db, [listChange({ hlc: h(5000), name: '回灌' })], {
      observe: (hlc) => observed.push(hlc),
    });

    expect(observed).toEqual([h(5000)]);
  });
});
