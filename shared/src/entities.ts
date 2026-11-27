/**
 * 服务端与客户端共用的实体结构。
 *
 * `id` 只出现在「一行」或「一次 change」上，`data` 里不含 id —— 这样
 * 客户端本地行和推送负载可以同一份类型往返。
 */

export interface List {
  id: string;
  name: string;
  color: string | null;
  orderKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  listId: string;
  parentId: string | null;
  title: string;
  notes: string | null;
  done: boolean;
  doneAt: string | null;
  dueAt: string | null;
  orderKey: string;
  createdAt: string;
  updatedAt: string;
}

export type ListData = Omit<List, 'id'>;
export type TaskData = Omit<Task, 'id'>;

export const ENTITIES = ['lists', 'tasks'] as const;
export type EntityName = (typeof ENTITIES)[number];

/** entity 名 → data 类型，供泛型工具使用 */
export interface EntityMap {
  lists: ListData;
  tasks: TaskData;
}
