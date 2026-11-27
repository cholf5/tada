import { useLive } from '../hooks/useLive';
import { useToday } from '../hooks/useToday';
import type { TadaDb, ListRow, TaskRow } from '../db/schema';
import { EmptyState } from './EmptyState';
import { TaskRow as TaskItem } from './TaskRow';
import type { TaskHandlers } from './taskHandlers';
import { sortTasksByDue } from './ListView';

export function TodayView({
  db,
  lists,
  handlers,
}: {
  db: TadaDb;
  lists: ListRow[];
  handlers: TaskHandlers;
}) {
  const today = useToday();
  const tasks =
    useLive(async () => {
      const rows = await db.tasks
        .filter(
          (task) =>
            task.deleted === 0 &&
            task.done === 0 &&
            task.dueAt !== null &&
            task.dueAt <= today,
        )
        .toArray();
      const known = new Set(lists.map((list) => list.id));
      return sortTasksByDue(rows.filter((task) => known.has(task.listId)));
    }, [db, today, lists]) ?? [];

  const names = new Map(lists.map((list) => [list.id, list.name] as const));
  const overdue = tasks.filter((task) => (task.dueAt ?? '') < today);
  const dueToday = tasks.filter((task) => (task.dueAt ?? '') >= today);

  return (
    <section className="view">
      <header className="view-header">
        <h1 className="view-title">今天</h1>
        <span className="view-count">{tasks.length} 个到期</span>
      </header>

      {tasks.length === 0 ? (
        <EmptyState
          title="今天没有到期的任务"
          hint="给任务设置截止日期，它就会出现在这里。"
        />
      ) : (
        <div className="groups">
          {overdue.length > 0 ? (
            <TaskGroup title="逾期" tone="overdue" tasks={overdue} lists={lists} names={names} handlers={handlers} />
          ) : null}
          {dueToday.length > 0 ? (
            <TaskGroup title="今天" tasks={dueToday} lists={lists} names={names} handlers={handlers} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function TaskGroup({
  title,
  tasks,
  lists,
  names,
  handlers,
  tone,
}: {
  title: string;
  tasks: TaskRow[];
  lists: ListRow[];
  names: Map<string, string>;
  handlers: TaskHandlers;
  tone?: 'overdue';
}) {
  return (
    <div className="group">
      <h2 className={`group-title${tone === 'overdue' ? ' is-overdue' : ''}`}>
        {title}
        <span className="badge-count">{tasks.length}</span>
      </h2>
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
    </div>
  );
}
