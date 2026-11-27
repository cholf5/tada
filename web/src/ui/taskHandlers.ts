import type { TaskRow } from '../db/schema';
import type { SubtaskSummary } from '../hooks/useSubtaskCounts';
import type { AppActions } from '../state/actions';

export interface TaskHandlers {
  onToggle(task: TaskRow): void;
  onOpen(task: TaskRow): void;
  onRename(task: TaskRow, title: string): void;
  onMove(task: TaskRow, listId: string): void;
  onDelete(task: TaskRow): void;
}

/**
 * 完成任务前需要确认的未完成子任务数。
 * 0 表示没有子任务（或本来就是在取消完成），可以直接执行。
 */
export function pendingSubtasks(
  task: Pick<TaskRow, 'done'>,
  summary: SubtaskSummary | undefined,
): number {
  if (task.done === 1 || !summary) return 0;
  return Math.max(0, summary.total - summary.done);
}

/**
 * 有未完成子任务时先让用户确认再级联完成。
 * 取消（返回 false）时整次完成操作都不执行，父任务保持未完成。
 */
export function confirmPendingSubtasks(
  task: Pick<TaskRow, 'done'>,
  summary: SubtaskSummary | undefined,
): boolean {
  const remaining = pendingSubtasks(task, summary);
  if (remaining === 0) return true;
  return window.confirm(`还有 ${remaining} 个未完成的子任务，一并标记为完成？`);
}

export function makeTaskHandlers(
  actions: AppActions,
  onOpen: (task: TaskRow) => void,
  getSubtaskSummary?: (taskId: string) => SubtaskSummary | undefined,
): TaskHandlers {
  return {
    onToggle: (task) => {
      if (!confirmPendingSubtasks(task, getSubtaskSummary?.(task.id))) return;
      void actions.setTaskDone(task.id, task.done === 0);
    },
    onOpen,
    onRename: (task, title) => {
      const value = title.trim();
      if (!value || value === task.title) return;
      void actions.updateTask(task.id, { title: value });
    },
    onMove: (task, listId) => {
      void actions.moveTask(task.id, listId);
    },
    onDelete: (task) => {
      if (window.confirm(`删除任务「${task.title}」？`)) {
        void actions.deleteTask(task.id);
      }
    },
  };
}
