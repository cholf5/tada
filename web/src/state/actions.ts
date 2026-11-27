import { useMemo } from 'react';
import * as repo from '../db/repo';
import type { RepoDeps, TaskPatch } from '../db/repo';
import type { SyncEngine } from '../sync/engine';
import type { View } from '../state/view';

export interface AppActions {
  createList(name: string, color?: string | null): Promise<string | null>;
  renameList(id: string, name: string): Promise<void>;
  setListColor(id: string, color: string | null): Promise<void>;
  deleteList(id: string): Promise<void>;
  reorderList(id: string, previousKey: string | null, nextKey: string | null): Promise<void>;

  createTask(listId: string, title: string, dueAt?: string | null): Promise<string | null>;
  createSubtask(parentId: string, title: string): Promise<string | null>;
  updateTask(id: string, patch: TaskPatch): Promise<void>;
  setTaskDone(id: string, done: boolean): Promise<void>;
  deleteTask(id: string): Promise<void>;
  moveTask(id: string, listId: string): Promise<void>;
  reorderTask(id: string, previousKey: string | null, nextKey: string | null): Promise<void>;
}

/** 所有写操作走这里：先落本地库，再通知同步引擎 1s 后推送 */
export function useActions(deps: RepoDeps, engine: SyncEngine): AppActions {
  return useMemo(() => {
    const notify = <T,>(promise: Promise<T>): Promise<T> =>
      promise.then((value) => {
        engine.notifyLocalChange();
        return value;
      });

    return {
      createList: (name, color) => notify(repo.createList(deps, name, color ?? null)),
      renameList: (id, name) => notify(repo.renameList(deps, id, name)),
      setListColor: (id, color) => notify(repo.setListColor(deps, id, color)),
      deleteList: (id) => notify(repo.deleteList(deps, id)),
      reorderList: (id, previousKey, nextKey) =>
        notify(repo.reorderList(deps, id, previousKey, nextKey)),
      createTask: (listId, title, dueAt) =>
        notify(repo.createTask(deps, listId, title, { dueAt: dueAt ?? null })),
      createSubtask: (parentId, title) => notify(repo.createSubtask(deps, parentId, title)),
      updateTask: (id, patch) => notify(repo.updateTask(deps, id, patch)),
      setTaskDone: (id, done) => notify(repo.setTaskDone(deps, id, done)),
      deleteTask: (id) => notify(repo.deleteTask(deps, id)),
      moveTask: (id, listId) => notify(repo.moveTaskToList(deps, id, listId)),
      reorderTask: (id, previousKey, nextKey) =>
        notify(repo.reorderTask(deps, id, previousKey, nextKey)),
    };
  }, [deps, engine]);
}

export type { View };
