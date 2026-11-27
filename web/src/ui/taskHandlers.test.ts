import { describe, expect, it, vi } from 'vitest';
import type { TaskRow } from '../db/schema';
import type { AppActions } from '../state/actions';
import { makeTaskHandlers, pendingSubtasks } from './taskHandlers';

describe('完成父任务前的子任务确认', () => {
  it('还有未完成子任务时返回需要确认的数量', () => {
    expect(pendingSubtasks({ done: 0 }, { total: 3, done: 1 })).toBe(2);
  });

  it('子任务全部完成或没有子任务时不需要确认', () => {
    expect(pendingSubtasks({ done: 0 }, { total: 3, done: 3 })).toBe(0);
    expect(pendingSubtasks({ done: 0 }, undefined)).toBe(0);
  });

  it('取消完成父任务时不需要确认', () => {
    expect(pendingSubtasks({ done: 1 }, { total: 3, done: 0 })).toBe(0);
  });
});

describe('行内重命名', () => {
  it('去空白后调用 updateTask；空标题或未改动不写库', () => {
    const updateTask = vi.fn(async () => undefined);
    const actions = { updateTask } as unknown as AppActions;
    const handlers = makeTaskHandlers(actions, () => undefined);
    const task = { id: 'task-1', title: '旧标题' } as TaskRow;

    handlers.onRename(task, '  新标题  ');
    expect(updateTask).toHaveBeenCalledWith('task-1', { title: '新标题' });

    updateTask.mockClear();
    handlers.onRename(task, '   ');
    handlers.onRename(task, '旧标题');
    expect(updateTask).not.toHaveBeenCalled();
  });
});
