import { describe, expect, it } from 'vitest';
import {
  createList,
  createSubtask,
  createTask,
  deleteList,
  deleteTask,
  moveTaskToList,
  setTaskDone,
  subtasksOf,
  tasksInList,
  updateTask,
} from './repo';
import { disposeDb, makeDb, makeDeps } from '../test/helpers';

const TS = '2026-01-01T00:00:00.000Z';

async function setup() {
  const db = makeDb();
  const deps = makeDeps(db);
  const listId = (await createList(deps, '工作'))!;
  return { db, deps, listId };
}

describe('子任务', () => {
  it('创建子任务：继承列表、追加到末尾，且不算列表顶层任务', async () => {
    const { db, deps, listId } = await setup();
    try {
      const parentId = (await createTask(deps, listId, '父任务'))!;
      const first = (await createSubtask(deps, parentId, '第一步'))!;
      const second = (await createSubtask(deps, parentId, '第二步'))!;

      const firstRow = (await db.tasks.get(first))!;
      const secondRow = (await db.tasks.get(second))!;
      expect(firstRow.parentId).toBe(parentId);
      expect(secondRow.parentId).toBe(parentId);
      expect(firstRow.listId).toBe(listId);
      expect(firstRow.orderKey < secondRow.orderKey).toBe(true);
      expect(firstRow.deleted).toBe(0);
      expect(firstRow.remote).toBe(0);

      expect((await subtasksOf(db, parentId)).map((row) => row.title)).toEqual([
        '第一步',
        '第二步',
      ]);
      // 列表视图只看到顶层任务，子任务只在详情里出现
      expect((await tasksInList(db, listId, false)).map((row) => row.id)).toEqual([
        parentId,
      ]);

      const queued = (await db.outbox.toArray()).map((row) => row.key);
      expect(queued).toContain(`tasks:${first}`);
      expect(queued).toContain(`tasks:${second}`);
    } finally {
      await disposeDb(db);
    }
  });

  it('空标题、不存在的父任务、二级嵌套、已删除父任务都会被拒绝', async () => {
    const { db, deps, listId } = await setup();
    try {
      const parentId = (await createTask(deps, listId, '父任务'))!;
      const childId = (await createSubtask(deps, parentId, '子任务'))!;

      expect(await createSubtask(deps, parentId, '   ')).toBeNull();
      expect(await createSubtask(deps, 'missing-parent', '孤立')).toBeNull();
      expect(await createSubtask(deps, childId, '孙任务')).toBeNull();

      await deleteTask(deps, parentId);
      expect(await createSubtask(deps, parentId, '之后')).toBeNull();
    } finally {
      await disposeDb(db);
    }
  });

  it('给已完成的父任务加子任务会重新打开父任务', async () => {
    const { db, deps, listId } = await setup();
    try {
      const parentId = (await createTask(deps, listId, '父任务'))!;
      await setTaskDone(deps, parentId, true);
      expect((await db.tasks.get(parentId))!.done).toBe(1);

      const childId = await createSubtask(deps, parentId, '新子任务');
      expect(childId).toBeTruthy();

      const parent = (await db.tasks.get(parentId))!;
      expect(parent.done).toBe(0);
      expect(parent.doneAt).toBeNull();
      expect((await db.tasks.get(childId!))!.done).toBe(0);
    } finally {
      await disposeDb(db);
    }
  });

  it('完成父任务会级联完成子任务；取消完成不反向恢复子任务', async () => {
    const { db, deps, listId } = await setup();
    try {
      const parentId = (await createTask(deps, listId, '父任务'))!;
      const doneChild = (await createSubtask(deps, parentId, '已做'))!;
      const openChild = (await createSubtask(deps, parentId, '未做'))!;
      const otherParent = (await createTask(deps, listId, '别的任务'))!;
      const otherChild = (await createSubtask(deps, otherParent, '别人的子任务'))!;

      await setTaskDone(deps, doneChild, true);
      await setTaskDone(deps, parentId, true);

      for (const id of [parentId, doneChild, openChild]) {
        const row = (await db.tasks.get(id))!;
        expect(row.done).toBe(1);
        expect(row.doneAt).toBe(TS);
      }
      expect((await db.tasks.get(otherChild))!.done).toBe(0);
      expect((await db.tasks.get(otherParent))!.done).toBe(0);

      await setTaskDone(deps, parentId, false);
      expect((await db.tasks.get(parentId))!.done).toBe(0);
      expect((await db.tasks.get(parentId))!.doneAt).toBeNull();
      expect((await db.tasks.get(doneChild))!.done).toBe(1);
      expect((await db.tasks.get(openChild))!.done).toBe(1);
    } finally {
      await disposeDb(db);
    }
  });

  it('删除父任务会级联删除子任务：从未推送的物理删除，推送过的写墓碑', async () => {
    const { db, deps, listId } = await setup();
    try {
      // 从未推送：本地直接消失
      const localParent = (await createTask(deps, listId, '本地父任务'))!;
      const localChild = (await createSubtask(deps, localParent, '本地子任务'))!;
      await deleteTask(deps, localParent);
      expect(await db.tasks.get(localParent)).toBeUndefined();
      expect(await db.tasks.get(localChild)).toBeUndefined();

      // 推送过的行：父任务和子任务都留下墓碑
      const remoteParent = (await createTask(deps, listId, '远端父任务'))!;
      const remoteChild = (await createSubtask(deps, remoteParent, '远端子任务'))!;
      for (const id of [remoteParent, remoteChild]) {
        const row = (await db.tasks.get(id))!;
        await db.tasks.put({ ...row, remote: 1 });
      }

      await deleteTask(deps, remoteParent);
      for (const id of [remoteParent, remoteChild]) {
        const row = (await db.tasks.get(id))!;
        expect(row.deleted).toBe(1);
      }
      const queued = (await db.outbox.toArray()).map((row) => row.key);
      expect(queued).toContain(`tasks:${remoteParent}`);
      expect(queued).toContain(`tasks:${remoteChild}`);
    } finally {
      await disposeDb(db);
    }
  });

  it('移动父任务到其他列表会带上子任务；子任务不能单独移动', async () => {
    const { db, deps, listId } = await setup();
    try {
      const personal = (await createList(deps, '个人'))!;
      const archive = (await createList(deps, '归档'))!;
      const parentId = (await createTask(deps, listId, '父任务'))!;
      const childId = (await createSubtask(deps, parentId, '子任务'))!;

      await moveTaskToList(deps, parentId, personal);
      expect((await db.tasks.get(parentId))!.listId).toBe(personal);
      expect((await db.tasks.get(childId))!.listId).toBe(personal);
      expect(await tasksInList(db, personal, false)).toHaveLength(1);
      expect(await tasksInList(db, listId, false)).toHaveLength(0);

      await moveTaskToList(deps, childId, archive);
      expect((await db.tasks.get(childId))!.listId).toBe(personal);
    } finally {
      await disposeDb(db);
    }
  });

  it('updateTask 拒绝自引用、跨列表挂载和把已有子任务的任务变成子任务', async () => {
    const { db, deps, listId } = await setup();
    try {
      const otherList = (await createList(deps, '个人'))!;
      const parentId = (await createTask(deps, listId, '父任务'))!;
      const childId = (await createSubtask(deps, parentId, '子任务'))!;
      const siblingParent = (await createTask(deps, listId, '同列表父任务'))!;
      const foreignParent = (await createTask(deps, otherList, '别的列表任务'))!;

      await updateTask(deps, parentId, { parentId: childId });
      expect((await db.tasks.get(parentId))!.parentId).toBeNull();

      await updateTask(deps, childId, { parentId: foreignParent });
      expect((await db.tasks.get(childId))!.parentId).toBe(parentId);

      // 自身已有未删除子任务时不能再挂到别人下面
      await updateTask(deps, parentId, { parentId: siblingParent });
      expect((await db.tasks.get(parentId))!.parentId).toBeNull();

      // 提升为顶层任务是允许的
      await updateTask(deps, childId, { parentId: null });
      expect((await db.tasks.get(childId))!.parentId).toBeNull();
    } finally {
      await disposeDb(db);
    }
  });

  it('删除列表时子任务一起删除', async () => {
    const { db, deps, listId } = await setup();
    try {
      const parentId = (await createTask(deps, listId, '父任务'))!;
      const childId = (await createSubtask(deps, parentId, '子任务'))!;

      await deleteList(deps, listId);

      expect(await db.lists.get(listId)).toBeUndefined();
      expect(await db.tasks.get(parentId)).toBeUndefined();
      expect(await db.tasks.get(childId)).toBeUndefined();
    } finally {
      await disposeDb(db);
    }
  });
});
