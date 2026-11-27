import { useLive } from '../hooks/useLive';
import type { SubtaskCounts } from '../hooks/useSubtaskCounts';
import type { TadaDb, ListRow } from '../db/schema';
import { EmptyState } from './EmptyState';
import { TaskRow } from './TaskRow';
import type { TaskHandlers } from './taskHandlers';

export function CompletedView({
  db,
  lists,
  handlers,
  subtaskCounts,
}: {
  db: TadaDb;
  lists: ListRow[];
  handlers: TaskHandlers;
  subtaskCounts?: SubtaskCounts;
}) {
  const tasks =
    useLive(async () => {
      const rows = await db.tasks
        .filter(
          (task) => task.deleted === 0 && task.done === 1 && task.parentId === null,
        )
        .toArray();
      const known = new Set(lists.map((list) => list.id));
      return rows
        .filter((task) => known.has(task.listId))
        .sort((a, b) => (b.doneAt ?? b.updatedAt).localeCompare(a.doneAt ?? a.updatedAt));
    }, [db, lists]) ?? [];

  const names = new Map(lists.map((list) => [list.id, list.name] as const));

  return (
    <section className="view">
      <header className="view-header">
        <h1 className="view-title">已完成</h1>
        <span className="view-count">{tasks.length} 个</span>
      </header>

      {tasks.length === 0 ? (
        <EmptyState title="还没有已完成的任务" hint="完成的任务会归档到这里，可以随时恢复。" />
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              lists={lists}
              showList
              listName={names.get(task.listId) ?? '未知列表'}
              subtaskCounts={subtaskCounts}
              onToggle={handlers.onToggle}
              onOpen={handlers.onOpen}
              onRename={handlers.onRename}
              onMove={handlers.onMove}
              onDelete={handlers.onDelete}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
