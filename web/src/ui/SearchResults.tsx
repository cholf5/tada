import type { ListRow, TaskRow } from '../db/schema';
import { EmptyState } from './EmptyState';
import { TaskRow as TaskItem } from './TaskRow';
import type { TaskHandlers } from './taskHandlers';

export function SearchResults({
  query,
  tasks,
  lists,
  handlers,
}: {
  query: string;
  tasks: TaskRow[];
  lists: ListRow[];
  handlers: TaskHandlers;
}) {
  const names = new Map(lists.map((list) => [list.id, list.name] as const));

  return (
    <section className="view">
      <header className="view-header">
        <h1 className="view-title">搜索 “{query}”</h1>
        <span className="view-count">{tasks.length} 个结果</span>
      </header>

      {tasks.length === 0 ? (
        <EmptyState title="没有匹配的任务" hint="换个关键词试试，标题和备注都会被搜索。" />
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              lists={lists}
              showList
              listName={names.get(task.listId) ?? '未知列表'}
              onToggle={handlers.onToggle}
              onOpen={handlers.onOpen}
              onMove={handlers.onMove}
              onDelete={handlers.onDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
