import { byOrderKey, liveLists } from '../db/repo';
import type { TadaDb, ListRow, TaskRow } from '../db/schema';
import { useLive } from '../hooks/useLive';
import { listColor } from '../lib/colors';
import { EmptyState } from './EmptyState';
import { TaskRow as TaskItem } from './TaskRow';
import type { TaskHandlers } from './taskHandlers';

export function AllView({
  db,
  lists,
  handlers,
}: {
  db: TadaDb;
  lists: ListRow[];
  handlers: TaskHandlers;
}) {
  const tasks =
    useLive(async () => {
      const [currentLists, rows] = await Promise.all([
        liveLists(db),
        db.tasks.filter((task) => task.deleted === 0 && task.done === 0).toArray(),
      ]);
      const known = new Set(currentLists.map((list) => list.id));
      return rows.filter((task) => known.has(task.listId)).sort(byOrderKey);
    }, [db]) ?? [];

  const byList = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    const bucket = byList.get(task.listId);
    if (bucket) bucket.push(task);
    else byList.set(task.listId, [task]);
  }

  return (
    <section className="view">
      <header className="view-header">
        <h1 className="view-title">全部</h1>
        <span className="view-count">{tasks.length} 个未完成</span>
      </header>

      {tasks.length === 0 ? (
        <EmptyState title="没有未完成的任务" hint="所有事情都处理完了，或者还没有开始。" />
      ) : (
        <div className="groups">
          {lists.map((list) => {
            const groupTasks = byList.get(list.id);
            if (!groupTasks || groupTasks.length === 0) return null;
            return (
              <div className="group" key={list.id}>
                <h2 className="group-title">
                  <span className="list-dot" style={{ background: listColor(list.color) }} />
                  {list.name}
                  <span className="badge-count">{groupTasks.length}</span>
                </h2>
                <ul className="task-list">
                  {groupTasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      lists={lists}
                      onToggle={handlers.onToggle}
                      onOpen={handlers.onOpen}
                      onMove={handlers.onMove}
                      onDelete={handlers.onDelete}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
