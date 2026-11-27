import type { ListData } from '@tada/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearQuarantine } from '../db/outbox';
import {
  createList,
  createTask,
  deleteList,
  deleteTask,
  updateTask,
  type RepoDeps,
} from '../db/repo';
import type { TadaDb } from '../db/schema';
import { applyPushAccepted, collectPushBatch, type SentEntry } from '../sync/push';
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

async function seedList(name = '收件箱'): Promise<string> {
  const id = await createList(deps, name);
  if (!id) throw new Error('list not created');
  return id;
}

async function seedTask(listId: string, title = '写代码'): Promise<string> {
  const id = await createTask(deps, listId, title);
  if (!id) throw new Error('task not created');
  return id;
}

function taskEntries(rows: { entity: string }[]): { entity: string }[] {
  return rows.filter((row) => row.entity === 'tasks');
}

describe('outbox 折叠', () => {
  it('同一行多次改动只留最新一条', async () => {
    const listId = await seedList();
    const taskId = await seedTask(listId, '写代码');

    await updateTask(deps, taskId, { title: '写代码 v2' });
    await updateTask(deps, taskId, { title: '写代码 v3', notes: '补个备注' });

    const entries = taskEntries(await db.outbox.toArray());
    expect(entries).toHaveLength(1);

    const row = await db.tasks.get(taskId);
    expect(row?.title).toBe('写代码 v3');
    const entry = await db.outbox.get(`tasks:${taskId}`);
    expect(entry?.hlc).toBe(row?.hlc);
  });

  it('折叠时保留首次入队的 queuedAt', async () => {
    const listId = await seedList();
    const taskId = await seedTask(listId);

    const before = await db.outbox.get(`tasks:${taskId}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateTask(deps, taskId, { title: '改一下' });
    const after = await db.outbox.get(`tasks:${taskId}`);

    expect(after?.queuedAt).toBe(before?.queuedAt);
    expect(after?.hlc).not.toBe(before?.hlc);
  });

  it('create + delete 在本地抵消，不推任何任务', async () => {
    const listId = await seedList();
    const taskId = await seedTask(listId);

    await deleteTask(deps, taskId);

    expect(await db.tasks.get(taskId)).toBeUndefined();
    expect(await db.outbox.get(`tasks:${taskId}`)).toBeUndefined();

    const batch = await collectPushBatch({ db, clock: deps.clock });
    expect(batch.changes.some((change) => change.entity === 'tasks')).toBe(false);
  });

  it('推送过的行删除时写墓碑，而不是物理删除', async () => {
    const listId = await seedList();
    const taskId = await seedTask(listId);

    const first = await collectPushBatch({ db, clock: deps.clock });
    await applyPushAccepted({ db, clock: deps.clock }, first.sent);
    expect(await db.outbox.count()).toBe(0);

    await deleteTask(deps, taskId);

    const row = await db.tasks.get(taskId);
    expect(row?.deleted).toBe(1);
    expect(await db.outbox.get(`tasks:${taskId}`)).toBeDefined();

    const second = await collectPushBatch({ db, clock: deps.clock });
    const tombstone = second.changes.find((change) => change.id === taskId);
    expect(tombstone?.deleted).toBe(true);
    expect(tombstone?.data).toBeUndefined();
  });
});

describe('push 负载', () => {
  it('data 不含 id，含 createdAt/updatedAt；tombstone 不带 data', async () => {
    const listId = await seedList('工作');
    await seedTask(listId);

    const batch = await collectPushBatch({ db, clock: deps.clock });
    expect(batch.changes).toHaveLength(2);

    const listChange = batch.changes.find((change) => change.entity === 'lists');
    expect(listChange?.deleted).toBe(false);
    const data = listChange?.data as ListData;
    expect(data).toBeDefined();
    expect('id' in data).toBe(false);
    expect(data.name).toBe('工作');
    expect(data.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(data.updatedAt).toBe('2026-01-01T00:00:00.000Z');

    const taskChange = batch.changes.find((change) => change.entity === 'tasks');
    expect(taskChange?.id).toBeDefined();
    expect(taskChange?.hlc).toMatch(/^\d{13}-\d{5}-testdev$/);
  });

  it('推送成功后清空 outbox 并标记为服务端已知', async () => {
    const listId = await seedList();
    const taskId = await seedTask(listId);

    const batch = await collectPushBatch({ db, clock: deps.clock });
    await applyPushAccepted({ db, clock: deps.clock }, batch.sent);

    expect(await db.outbox.count()).toBe(0);
    expect((await db.lists.get(listId))?.remote).toBe(1);
    expect((await db.tasks.get(taskId))?.remote).toBe(1);
  });

  it('请求在途时的新改动不会被误删', async () => {
    const listId = await seedList();
    const taskId = await seedTask(listId);

    const batch = await collectPushBatch({ db, clock: deps.clock });
    const sentTask = batch.sent.find((entry) => entry.key === `tasks:${taskId}`);
    expect(sentTask).toBeDefined();

    await updateTask(deps, taskId, { title: '在途改动' });
    await applyPushAccepted({ db, clock: deps.clock }, [sentTask as SentEntry]);

    const entry = await db.outbox.get(`tasks:${taskId}`);
    expect(entry).toBeDefined();
    expect(entry && sentTask && entry.hlc > sentTask.hlc).toBe(true);
    expect((await db.tasks.get(taskId))?.title).toBe('在途改动');
  });
});

describe('quarantine 生命周期（P17）', () => {
  it('修正后同一行推送成功，清掉该行的隔离记录', async () => {
    const listId = await seedList();
    const taskId = await seedTask(listId);

    // 先正常推送一次：这一行确实进过服务端，之后才可能被判为毒丸
    const first = await collectPushBatch({ db, clock: deps.clock });
    await applyPushAccepted({ db, clock: deps.clock }, first.sent);

    const rejectedHlc = (await db.tasks.get(taskId))!.hlc;
    await db.quarantine.put({
      key: `tasks:${taskId}`,
      entity: 'tasks',
      rowId: taskId,
      hlc: rejectedHlc,
      reason: 'HTTP 400: invalid payload',
      quarantinedAt: 1,
    });

    // 用户修正后重新入队并推送成功
    await updateTask(deps, taskId, { title: '修正后的标题' });
    const batch = await collectPushBatch({ db, clock: deps.clock });
    expect(batch.changes).toHaveLength(1);
    await applyPushAccepted({ db, clock: deps.clock }, batch.sent);

    expect(await db.quarantine.get(`tasks:${taskId}`)).toBeUndefined();
    expect(await db.quarantine.count()).toBe(0);
  });

  it('设置页「清除提示」清空所有隔离记录', async () => {
    const listId = await seedList();
    const taskId = await seedTask(listId);

    await db.quarantine.bulkPut([
      {
        key: `lists:${listId}`,
        entity: 'lists',
        rowId: listId,
        hlc: '1000-00000-testdev',
        reason: 'HTTP 400',
        quarantinedAt: 1,
      },
      {
        key: `tasks:${taskId}`,
        entity: 'tasks',
        rowId: taskId,
        hlc: '1001-00000-testdev',
        reason: 'HTTP 400',
        quarantinedAt: 2,
      },
    ]);
    expect(await db.quarantine.count()).toBe(2);

    expect(await clearQuarantine(db)).toBe(2);
    expect(await db.quarantine.count()).toBe(0);

    // 只清提示，不动本地行
    expect(await db.tasks.get(taskId)).toBeDefined();
    expect(await db.lists.get(listId)).toBeDefined();
  });
});

describe('删除列表的墓碑级联（P19）', () => {
  it('已推送列表删除时，列表下未删除任务一起进 outbox 推墓碑', async () => {
    const listId = await seedList('工作');
    const taskA = await seedTask(listId, 'A');
    const taskB = await seedTask(listId, 'B');

    const first = await collectPushBatch({ db, clock: deps.clock });
    await applyPushAccepted({ db, clock: deps.clock }, first.sent);
    expect(await db.outbox.count()).toBe(0);

    await deleteList(deps, listId);

    expect((await db.lists.get(listId))?.deleted).toBe(1);
    expect((await db.tasks.get(taskA))?.deleted).toBe(1);
    expect((await db.tasks.get(taskB))?.deleted).toBe(1);
    expect(await db.outbox.get(`lists:${listId}`)).toBeDefined();
    expect(await db.outbox.get(`tasks:${taskA}`)).toBeDefined();
    expect(await db.outbox.get(`tasks:${taskB}`)).toBeDefined();

    const batch = await collectPushBatch({ db, clock: deps.clock });
    const tombstones = batch.changes
      .filter((change) => change.deleted)
      .map((change) => change.id)
      .sort();
    expect(tombstones).toEqual([listId, taskA, taskB].sort());
    expect(batch.changes.every((change) => change.data === undefined)).toBe(true);
  });

  it('列表内从未上传过的任务仍物理删除，不产生多余墓碑', async () => {
    const listId = await seedList();
    const pushedTask = await seedTask(listId, '已上传');

    const first = await collectPushBatch({ db, clock: deps.clock });
    await applyPushAccepted({ db, clock: deps.clock }, first.sent);
    const localOnlyTask = await seedTask(listId, '从未上传');

    await deleteList(deps, listId);

    expect(await db.tasks.get(localOnlyTask)).toBeUndefined();
    expect(await db.outbox.get(`tasks:${localOnlyTask}`)).toBeUndefined();
    expect((await db.tasks.get(pushedTask))?.deleted).toBe(1);
    expect(await db.outbox.get(`tasks:${pushedTask}`)).toBeDefined();
  });
});
