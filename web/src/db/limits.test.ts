import { LIMITS, listDataSchema, taskDataSchema } from '@tada/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createList,
  createTask,
  renameList,
  updateTask,
  type RepoDeps,
} from '../db/repo';
import type { TadaDb } from '../db/schema';
import { collectPushBatch } from '../sync/push';
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

/**
 * P2 输入侧：UI 的 maxLength 只是第一道防线，repo 层必须把越界文本截断，
 * 保证进入 outbox 的数据一定通过 @tada/shared 的 schema，不会成为毒丸。
 */
describe('输入限长（repo 层防御）', () => {
  it('超长列表名 / 任务标题 / 备注都被截断到 shared 上限', async () => {
    const listId = await createList(deps, 'x'.repeat(LIMITS.listName + 50));
    expect(listId).toBeTruthy();
    const list = await db.lists.get(listId!);
    expect(list?.name).toHaveLength(LIMITS.listName);

    const taskId = await createTask(deps, listId!, 't'.repeat(LIMITS.taskTitle + 500), {
      notes: 'n'.repeat(LIMITS.taskNotes + 500),
    });
    expect(taskId).toBeTruthy();
    const task = await db.tasks.get(taskId!);
    expect(task?.title).toHaveLength(LIMITS.taskTitle);
    expect(task?.notes).toHaveLength(LIMITS.taskNotes);
  });

  it('重命名与更新走同一条截断路径', async () => {
    const listId = (await createList(deps, '工作'))!;
    const taskId = (await createTask(deps, listId, '任务'))!;

    await renameList(deps, listId, 'y'.repeat(LIMITS.listName + 1));
    expect((await db.lists.get(listId))?.name).toHaveLength(LIMITS.listName);

    await updateTask(deps, taskId, {
      title: 'z'.repeat(LIMITS.taskTitle + 1),
      notes: 'w'.repeat(LIMITS.taskNotes + 1),
    });
    const task = await db.tasks.get(taskId);
    expect(task?.title).toHaveLength(LIMITS.taskTitle);
    expect(task?.notes).toHaveLength(LIMITS.taskNotes);
  });

  it('截断后的推送负载能通过 shared schema（不再是 400 毒丸）', async () => {
    const listId = (await createList(deps, 'x'.repeat(LIMITS.listName + 10)))!;
    await createTask(deps, listId, 't'.repeat(LIMITS.taskTitle + 10), {
      notes: 'n'.repeat(LIMITS.taskNotes + 10),
    });

    const batch = await collectPushBatch({ db, clock: deps.clock });
    expect(batch.changes).toHaveLength(2);

    for (const change of batch.changes) {
      const schema = change.entity === 'lists' ? listDataSchema : taskDataSchema;
      const parsed = schema.safeParse(change.data);
      expect(parsed.success).toBe(true);
    }
  });
});
