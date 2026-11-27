import { LIMITS } from '@tada/shared';
import { useEffect, useRef, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { byOrderKey, tasksInList } from '../db/repo';
import type { ListRow, TaskRow } from '../db/schema';
import { useLive } from '../hooks/useLive';
import { useI18n } from '../hooks/useI18n';
import type { SubtaskCounts } from '../hooks/useSubtaskCounts';
import { LIST_COLORS, listColor } from '../lib/colors';
import type { AppActions } from '../state/actions';
import type { TadaDb } from '../db/schema';
import { EmptyState } from './EmptyState';
import { Icon } from './icons';
import { QuickAdd } from './QuickAdd';
import { SortableTaskRow } from './SortableTaskRow';
import { TaskRow as TaskItem } from './TaskRow';
import type { TaskHandlers } from './taskHandlers';
import { useSortableSensors } from './useSortableSensors';

export function ListView({
  db,
  list,
  lists,
  actions,
  handlers,
  subtaskCounts,
  onDeleted,
}: {
  db: TadaDb;
  list: ListRow;
  lists: ListRow[];
  actions: AppActions;
  handlers: TaskHandlers;
  subtaskCounts?: SubtaskCounts;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const tasks = useLive(() => tasksInList(db, list.id, false), [db, list.id]) ?? [];
  const doneTasks = useLive(() => tasksInList(db, list.id, true), [db, list.id]) ?? [];

  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteRef = useRef<HTMLDivElement | null>(null);
  const sensors = useSortableSensors();

  useEffect(() => {
    if (!paletteOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = paletteRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setPaletteOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [paletteOpen]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = tasks.findIndex((task) => task.id === active.id);
    const newIndex = tasks.findIndex((task) => task.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(tasks, oldIndex, newIndex);
    const previousKey = newIndex > 0 ? reordered[newIndex - 1]!.orderKey : null;
    const nextKey = newIndex < reordered.length - 1 ? reordered[newIndex + 1]!.orderKey : null;
    void actions.reorderTask(String(active.id), previousKey, nextKey);
  };

  const handleDeleteList = () => {
    if (!window.confirm(t('list.deleteConfirm', { name: list.name }))) return;
    void actions.deleteList(list.id).then(() => onDeleted());
  };

  const sortedDone = [...doneTasks].sort((a, b) =>
    (b.doneAt ?? b.updatedAt).localeCompare(a.doneAt ?? a.updatedAt),
  );

  return (
    <section className="view">
      <header className="view-header list-header">
        <div className="list-title-wrap">
          <span className="list-dot large" style={{ background: listColor(list.color) }} />
          <input
            key={list.name}
            className="list-title-input"
            defaultValue={list.name}
            maxLength={LIMITS.listName}
            aria-label={t('common.listName')}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (!value) {
                event.currentTarget.value = list.name;
                return;
              }
              if (value !== list.name) void actions.renameList(list.id, value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                event.currentTarget.value = list.name;
                event.currentTarget.blur();
              }
            }}
          />
          <span className="view-count">{t('all.count', { count: tasks.length })}</span>
        </div>

        <div className="header-actions" ref={paletteRef}>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('list.changeColor')}
            aria-expanded={paletteOpen}
            onClick={() => setPaletteOpen((open) => !open)}
          >
            <span className="color-swatch" style={{ background: listColor(list.color) }} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('list.delete')}
            onClick={handleDeleteList}
          >
            <Icon name="trash" size={18} />
          </button>

          {paletteOpen ? (
            <div className="palette" role="group" aria-label={t('list.colorGroup')}>
              {LIST_COLORS.map((color) => (
                <button
                  key={color.labelKey}
                  type="button"
                  className={`palette-swatch${color.value === list.color ? ' is-active' : ''}`}
                  style={{ background: color.value ?? 'var(--dot-default)' }}
                  aria-label={t(color.labelKey)}
                  title={t(color.labelKey)}
                  onClick={() => {
                    setPaletteOpen(false);
                    void actions.setListColor(list.id, color.value);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <QuickAdd listId={list.id} actions={actions} />

      {tasks.length === 0 && doneTasks.length === 0 ? (
        <EmptyState title={t('list.emptyTitle')} hint={t('list.emptyHint')} />
      ) : (
        <DndContext
          id="tasks-in-list"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tasks.map((task) => task.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="task-list">
              {tasks.map((task) => (
                <SortableTaskRow
                  key={task.id}
                  task={task}
                  lists={lists}
                  handlers={handlers}
                  subtaskCounts={subtaskCounts}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {sortedDone.length > 0 ? (
        <details className="completed-section">
          <summary>
            {t('nav.completed')}
            <span className="badge-count">{sortedDone.length}</span>
          </summary>
          <ul className="task-list">
            {sortedDone.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                lists={lists}
                subtaskCounts={subtaskCounts}
                onToggle={handlers.onToggle}
                onOpen={handlers.onOpen}
                onRename={handlers.onRename}
                onMove={handlers.onMove}
                onDelete={handlers.onDelete}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function sortTasksByDue(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort((a, b) => {
    const left = a.dueAt ?? '';
    const right = b.dueAt ?? '';
    if (left !== right) return left < right ? -1 : 1;
    return byOrderKey(a, b);
  });
}
