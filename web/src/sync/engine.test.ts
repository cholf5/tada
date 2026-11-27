import { formatHlc, type PullResponse } from '@tada/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../lib/ids';
import { enqueueOutbox } from '../db/outbox';
import { createList, type RepoDeps } from '../db/repo';
import { getMeta, setMeta, type ListRow, type TaskRow, type TadaDb } from '../db/schema';
import { ApiError, RequestTimeoutError, UnauthorizedError, type SyncTransport } from '../sync/api';
import { SyncEngine, retryDelay, type SyncStatus } from '../sync/engine';
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

function emptyPull(): PullResponse {
  return { changes: [], nextSince: 0, hasMore: false };
}

async function seedTaskRow(
  listId: string,
  options: { title: string; hlc: string; id?: string },
): Promise<string> {
  const id = options.id ?? newId();
  const row: TaskRow = {
    id,
    listId,
    parentId: null,
    title: options.title,
    notes: null,
    done: 0,
    doneAt: null,
    dueAt: null,
    orderKey: 'a0',
    hlc: options.hlc,
    createdAt: TS,
    updatedAt: TS,
    deleted: 0,
    remote: 0,
  };
  await db.tasks.put(row);
  await enqueueOutbox(db, 'tasks', id, options.hlc);
  return id;
}

function listRow(id: string, hlc: string, name = '新增'): ListRow {
  return {
    id,
    name,
    color: null,
    orderKey: 'z0',
    hlc,
    createdAt: TS,
    updatedAt: TS,
    deleted: 0,
    remote: 0,
  };
}

async function waitForStatus(engine: SyncEngine, target: SyncStatus, timeoutMs = 2000) {
  const started = Date.now();
  while (engine.getSnapshot().status !== target) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${target}, got ${engine.getSnapshot().status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** 从 setTimeout 探针里取出引擎排定的退避延迟（过滤掉 0ms 的框架内部计时器） */
function scheduledDelays(spy: { mock: { calls: readonly (readonly unknown[])[] } }): number[] {
  return spy.mock.calls
    .map((call) => call[1])
    .filter((ms): ms is number => typeof ms === 'number' && ms >= 1000);
}

describe('失败退避（P3）', () => {
  it('retryDelay 1s → 2s → 4s … 上限 60s', () => {
    expect(retryDelay(0)).toBe(1000);
    expect(retryDelay(1)).toBe(1000);
    expect(retryDelay(2)).toBe(2000);
    expect(retryDelay(3)).toBe(4000);
    expect(retryDelay(4)).toBe(8000);
    expect(retryDelay(5)).toBe(16_000);
    expect(retryDelay(6)).toBe(32_000);
    expect(retryDelay(7)).toBe(60_000);
    expect(retryDelay(30)).toBe(60_000);
  });

  it('连续失败时实际退避为 1s → 2s（attempt 真的自增）', async () => {
    await createList(deps, 'L');
    await setMeta(db, 'token', 'test-token');

    let pushCalls = 0;
    const transport: SyncTransport = {
      async push() {
        pushCalls += 1;
        throw new ApiError('boom', 500);
      },
      async pull() {
        return emptyPull();
      },
    };

    // 记录引擎排定的重试延迟；透传真实实现，不改变时序
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const engine = new SyncEngine({
      db,
      clock: deps.clock,
      transport,
      isOnline: () => true,
    });

    try {
      await engine.syncNow();
      expect(pushCalls).toBe(1);
      expect(scheduledDelays(spy)).toEqual([1000]);

      // 1s 后自动重试；第二次失败后应排 2s，而不是仍为 1s
      await vi.waitFor(() => expect(pushCalls).toBe(2), { timeout: 3000 });
      await vi.waitFor(() => expect(scheduledDelays(spy)).toContain(2000), { timeout: 1000 });

      engine.stop();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('请求超时（P18）', () => {
  it('超时按临时错误退避，不清 token，也不会永久停在同步中', async () => {
    await createList(deps, 'L');
    await setMeta(db, 'token', 'test-token');

    const transport: SyncTransport = {
      async push() {
        throw new RequestTimeoutError();
      },
      async pull() {
        return emptyPull();
      },
    };

    const spy = vi.spyOn(globalThis, 'setTimeout');
    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });
    try {
      await engine.syncNow();

      expect(engine.getSnapshot().status).toBe('error');
      expect(engine.getSnapshot().lastError).toContain('超时');
      // 不是 401：token 与待推条目都保留
      expect(await getMeta(db, 'token')).toBe('test-token');
      expect(await db.outbox.count()).toBe(1);
      // 走既有退避首档 1s，后续触发点会继续重试
      expect(scheduledDelays(spy)).toEqual([1000]);
    } finally {
      engine.stop();
      spy.mockRestore();
    }
  });
});

describe('4xx 毒丸隔离（P2）', () => {
  it('400 只隔离坏条目，其余继续，outbox 清空且状态回到已同步', async () => {
    const listId = (await createList(deps, '工作'))!;
    const goodTaskId = newId();
    await seedTaskRow(listId, {
      id: goodTaskId,
      title: '好任务',
      hlc: formatHlc({ ms: Date.now(), counter: 1, device: 'good' }),
    });

    const poisonId = await seedTaskRow(listId, {
      title: 'x'.repeat(2500),
      hlc: formatHlc({ ms: Date.now(), counter: 2, device: 'poison' }),
    });

    await setMeta(db, 'token', 'test-token');

    const calls: string[][] = [];
    const transport: SyncTransport = {
      async push(_token, changes) {
        calls.push(changes.map((change) => change.id));
        // 模拟 relay 的整批事务：任何一条 schema 不通过，整批 400
        const invalid = changes.some(
          (change) =>
            change.entity === 'tasks' &&
            typeof (change.data as { title?: unknown } | undefined)?.title === 'string' &&
            (change.data as { title: string }).title.length > 2000,
        );
        if (invalid) throw new ApiError('HTTP 400: invalid payload', 400);
        return { lastSeq: 1 };
      },
      async pull() {
        return emptyPull();
      },
    };

    const statuses: SyncStatus[] = [];
    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });
    engine.subscribe((snapshot) => statuses.push(snapshot.status));

    await engine.syncNow();

    // 同批的其他条目都发出去了
    const pushedIds = new Set(calls.flat());
    expect(pushedIds.has(listId)).toBe(true);
    expect(pushedIds.has(goodTaskId)).toBe(true);

    // 毒丸被隔离，outbox 清空，不再卡在 error
    expect(await db.outbox.count()).toBe(0);
    expect(await db.quarantine.get(`tasks:${poisonId}`)).toBeDefined();
    expect(engine.getSnapshot().status).toBe('synced');
    expect(statuses).not.toContain('error');

    // 本地行保留，用户修正后可重新入队
    expect(await db.tasks.get(poisonId)).toBeDefined();
    engine.stop();
  });

  it('413 时把批次拆成 50 条重试，全部上传成功', async () => {
    const listId = (await createList(deps, 'L'))!;

    await db.transaction('rw', [db.tasks, db.outbox], async () => {
      for (let index = 0; index < 120; index += 1) {
        const id = newId();
        const hlc = formatHlc({ ms: 1_790_000_000_000, counter: index, device: 'bulk' });
        const row: TaskRow = {
          id,
          listId,
          parentId: null,
          title: `T${index}`,
          notes: null,
          done: 0,
          doneAt: null,
          dueAt: null,
          orderKey: 'a0',
          hlc,
          createdAt: TS,
          updatedAt: TS,
          deleted: 0,
          remote: 0,
        };
        await db.tasks.put(row);
        await enqueueOutbox(db, 'tasks', id, hlc);
      }
    });

    await setMeta(db, 'token', 'test-token');

    const sizes: number[] = [];
    const transport: SyncTransport = {
      async push(_token, changes) {
        sizes.push(changes.length);
        if (changes.length > 50) throw new ApiError('HTTP 413: payload too large', 413);
        return { lastSeq: 1 };
      },
      async pull() {
        return emptyPull();
      },
    };

    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });
    await engine.syncNow();

    // 列表本身也在 outbox 里，所以首批是 121 条，拆成 50/50/21
    expect(sizes).toEqual([121, 50, 50, 21]);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.quarantine.count()).toBe(0);
    expect(engine.getSnapshot().status).toBe('synced');
    engine.stop();
  });

  it('拆到最小仍然 413 时逐条隔离，不会无限重试', async () => {
    const listId = (await createList(deps, 'L'))!;
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push(
        await seedTaskRow(listId, {
          title: `T${index}`,
          hlc: formatHlc({ ms: 1_790_000_000_000, counter: index, device: 'bulk' }),
        }),
      );
    }
    await setMeta(db, 'token', 'test-token');

    const sizes: number[] = [];
    const transport: SyncTransport = {
      async push(_token, changes) {
        sizes.push(changes.length);
        throw new ApiError('HTTP 413: payload too large', 413);
      },
      async pull() {
        return emptyPull();
      },
    };

    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });
    await engine.syncNow();

    expect(sizes).toEqual([4, 1, 1, 1, 1]); // 列表 + 3 个任务
    expect(await db.outbox.count()).toBe(0);
    expect(await db.quarantine.count()).toBe(4);
    expect(engine.getSnapshot().status).toBe('synced');
    engine.stop();
  });

  it('修正毒丸后推送成功，隔离记录与设置页提示一起消失（P17）', async () => {
    const listId = (await createList(deps, 'L'))!;
    const poisonId = await seedTaskRow(listId, {
      title: 'x'.repeat(2500),
      // 用固定的偏低毫秒，保证修正时 clock.next() 产出的 hlc 一定更大
      hlc: formatHlc({ ms: 1_700_000_000_000, counter: 1, device: 'poison' }),
    });
    await setMeta(db, 'token', 'test-token');

    const transport: SyncTransport = {
      async push(_token, changes) {
        const invalid = changes.some(
          (change) =>
            change.entity === 'tasks' &&
            typeof (change.data as { title?: unknown } | undefined)?.title === 'string' &&
            (change.data as { title: string }).title.length > 2000,
        );
        if (invalid) throw new ApiError('HTTP 400: invalid payload', 400);
        return { lastSeq: 1 };
      },
      async pull() {
        return emptyPull();
      },
    };

    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });

    await engine.syncNow();
    expect(await db.quarantine.count()).toBe(1);
    expect((await db.quarantine.get(`tasks:${poisonId}`))?.reason).toContain('400');

    // 用户修正数据：新 hlc 入队，下一轮推送同一行
    const row = (await db.tasks.get(poisonId))!;
    const hlc = deps.clock.next();
    await db.tasks.put({ ...row, title: '修好了', hlc });
    await enqueueOutbox(db, 'tasks', poisonId, hlc);

    await engine.syncNow();

    expect(await db.quarantine.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(engine.getSnapshot().status).toBe('synced');

    engine.stop();
  });

  it('401 保持原逻辑：清 token、保留 outbox、不进 quarantine', async () => {
    const listId = (await createList(deps, 'L'))!;
    void listId;
    await setMeta(db, 'token', 'test-token');

    const transport: SyncTransport = {
      async push() {
        throw new UnauthorizedError();
      },
      async pull() {
        return emptyPull();
      },
    };

    let unauthorized = 0;
    const engine = new SyncEngine({
      db,
      clock: deps.clock,
      transport,
      isOnline: () => true,
      onUnauthorized: () => {
        unauthorized += 1;
      },
    });

    await engine.syncNow();

    expect(engine.getSnapshot().status).toBe('unpaired');
    expect(await getMeta(db, 'token')).toBeNull();
    expect(await db.outbox.count()).toBe(1);
    expect(await db.quarantine.count()).toBe(0);
    expect(unauthorized).toBe(1);
  });
});

describe('W17 红线：push 的 lastSeq 不能污染 pull 游标', () => {
  it('push 返回很大的 lastSeq（999）时，下一次 pull 的 since 仍是 push 前的 meta.lastSeq', async () => {
    await createList(deps, 'L');
    await setMeta(db, 'token', 'test-token');
    await setMeta(db, 'lastSeq', 5);

    let pushCalls = 0;
    const pullSince: number[] = [];

    const transport: SyncTransport = {
      async push() {
        pushCalls += 1;
        // 服务端返回一个远大于本地游标的 seq
        return { lastSeq: 999 };
      },
      async pull(_token, since) {
        pullSince.push(since);
        return { changes: [], nextSince: since, hasMore: false };
      },
    };

    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });
    await engine.syncNow();

    // 确认真的走了 push 成功分支
    expect(pushCalls).toBe(1);
    // 游标只能由 pull 返回的 nextSince 推进，不能被 push 的 lastSeq 覆盖
    expect(pullSince).toEqual([5]);
    expect(await getMeta(db, 'lastSeq')).toBe(5);

    engine.stop();
  });
});

describe('单批上限（P5）', () => {
  it('outbox 450 条时首轮只取 200，续轮结束后全部清空', async () => {
    await db.transaction('rw', [db.tasks, db.outbox], async () => {
      for (let index = 0; index < 450; index += 1) {
        const id = newId();
        const hlc = formatHlc({ ms: 1_790_000_000_000, counter: index, device: 'bulk' });
        const row: TaskRow = {
          id,
          listId: '11111111-1111-4111-8111-111111111111',
          parentId: null,
          title: `T${index}`,
          notes: null,
          done: 0,
          doneAt: null,
          dueAt: null,
          orderKey: 'a0',
          hlc,
          createdAt: TS,
          updatedAt: TS,
          deleted: 0,
          remote: 0,
        };
        await db.tasks.put(row);
        await enqueueOutbox(db, 'tasks', id, hlc);
      }
    });
    expect(await db.outbox.count()).toBe(450);

    await setMeta(db, 'token', 'test-token');

    const sizes: number[] = [];
    const transport: SyncTransport = {
      async push(_token, changes) {
        sizes.push(changes.length);
        return { lastSeq: 1 };
      },
      async pull() {
        return emptyPull();
      },
    };

    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });
    await engine.syncNow();
    await waitForStatus(engine, 'synced');

    // 首轮被 200 的上限截断
    expect(sizes[0]).toBe(200);
    expect(sizes.every((size) => size <= 200)).toBe(true);
    // 引擎自动续轮，剩下的 250 条也被推完
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(450);
    expect(await db.outbox.count()).toBe(0);
    expect(engine.getSnapshot().status).toBe('synced');

    engine.stop();
  });
});

describe('已同步状态（P6）', () => {
  it('outbox 仍有待推条目（again 待续）时不宣布已同步', async () => {
    const listId = (await createList(deps, 'L'))!;
    void listId;
    await setMeta(db, 'token', 'test-token');

    const extraId = newId();
    let pullCalls = 0;
    let pushCalls = 0;

    const transport: SyncTransport = {
      async push() {
        pushCalls += 1;
        // 第二轮（补推新行）故意失败，确保最终状态是 error；这样能区分
        // 「第一轮错误地宣布 synced」与「修好后从未宣布 synced」
        if (pushCalls === 2) throw new ApiError('HTTP 500: boom', 500);
        return { lastSeq: 1 };
      },
      async pull() {
        pullCalls += 1;
        if (pullCalls === 1) {
          // 模拟推送在途时又产生了一条本地改动
          const hlc = deps.clock.next();
          await db.lists.put(listRow(extraId, hlc));
          await enqueueOutbox(db, 'lists', extraId, hlc);
        }
        return emptyPull();
      },
    };

    const statuses: SyncStatus[] = [];
    const engine = new SyncEngine({ db, clock: deps.clock, transport, isOnline: () => true });
    engine.subscribe((snapshot) => statuses.push(snapshot.status));

    await engine.syncNow();
    await waitForStatus(engine, 'error');

    expect(await db.outbox.count()).toBe(1);
    expect(statuses).not.toContain('synced');
    engine.stop();
  });
});
