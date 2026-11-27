import { describe, expect, it } from 'vitest';
import { pendingSubtasks } from './taskHandlers';

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
