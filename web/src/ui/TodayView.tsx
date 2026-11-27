import { useLive } from '../hooks/useLive';
import { useI18n } from '../hooks/useI18n';
import type { SubtaskCounts } from '../hooks/useSubtaskCounts';
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
  subtaskCounts,
}: {
  db: TadaDb;
  lists: ListRow[];
  handlers: TaskHandlers;
  subtaskCounts?: SubtaskCounts;
}) {
  const { t } = useI18n();
  const today = useToday();
  const tasks =
    useLive(async () => {
      const rows = await db.tasks
        .filter(
          (task) =>
            task.deleted === 0 &&
            task.done === 0 &&
            task.parentId === null &&
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
        <h1 className="view-title">{t('nav.today')}</h1>
        <span className="view-count">{t('today.count', { count: tasks.length })}</span>
      </header>

      {tasks.length === 0 ? (
        <EmptyState title={t('today.emptyTitle')} hint={t('today.emptyHint')} />
      ) : (
        <div className="groups">
          {overdue.length > 0 ? (
            <TaskGroup
              title={t('today.overdue')}
              tone="overdue"
              tasks={overdue}
              lists={lists}
              names={names}
              handlers={handlers}
              subtaskCounts={subtaskCounts}
            />
          ) : null}
          {dueToday.length > 0 ? (
            <TaskGroup
              title={t('nav.today')}
              tasks={dueToday}
              lists={lists}
              names={names}
              handlers={handlers}
              subtaskCounts={subtaskCounts}
            />
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
  subtaskCounts,
  tone,
}: {
  title: string;
  tasks: TaskRow[];
  lists: ListRow[];
  names: Map<string, string>;
  handlers: TaskHandlers;
  subtaskCounts?: SubtaskCounts;
  tone?: 'overdue';
}) {
  const { t } = useI18n();
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
            listName={names.get(task.listId) ?? t('common.unknownList')}
            subtaskCounts={subtaskCounts}
            onToggle={handlers.onToggle}
            onOpen={handlers.onOpen}
            onRename={handlers.onRename}
            onMove={handlers.onMove}
            onDelete={handlers.onDelete}
          />
        ))}
      </ul>
    </div>
  );
}
