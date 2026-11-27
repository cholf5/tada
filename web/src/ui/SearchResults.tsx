import type { ListRow, TaskRow } from '../db/schema';
import { useI18n } from '../hooks/useI18n';
import type { SubtaskCounts } from '../hooks/useSubtaskCounts';
import { EmptyState } from './EmptyState';
import { TaskRow as TaskItem } from './TaskRow';
import type { TaskHandlers } from './taskHandlers';

export function SearchResults({
  query,
  tasks,
  lists,
  parents,
  handlers,
  subtaskCounts,
}: {
  query: string;
  tasks: TaskRow[];
  lists: ListRow[];
  /** 匹配到子任务时用来补上父任务标题 */
  parents: Record<string, string>;
  handlers: TaskHandlers;
  subtaskCounts?: SubtaskCounts;
}) {
  const { t } = useI18n();
  const names = new Map(lists.map((list) => [list.id, list.name] as const));

  return (
    <section className="view">
      <header className="view-header">
        <h1 className="view-title">{t('search.title', { query })}</h1>
        <span className="view-count">{t('search.count', { count: tasks.length })}</span>
      </header>

      {tasks.length === 0 ? (
        <EmptyState title={t('search.emptyTitle')} hint={t('search.emptyHint')} />
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              lists={lists}
              showList
              listName={names.get(task.listId) ?? t('common.unknownList')}
              parentName={task.parentId ? parents[task.parentId] : undefined}
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
