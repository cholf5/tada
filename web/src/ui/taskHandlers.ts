import type { TaskRow } from '../db/schema';
import type { AppActions } from '../state/actions';

export interface TaskHandlers {
  onToggle(task: TaskRow): void;
  onOpen(task: TaskRow): void;
  onMove(task: TaskRow, listId: string): void;
  onDelete(task: TaskRow): void;
}

export function makeTaskHandlers(
  actions: AppActions,
  onOpen: (task: TaskRow) => void,
): TaskHandlers {
  return {
    onToggle: (task) => {
      void actions.setTaskDone(task.id, task.done === 0);
    },
    onOpen,
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
