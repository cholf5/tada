import { LIMITS } from '@tada/shared';
import { useRef, useState, type FormEvent } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ListRow } from '../db/schema';
import { useBranding } from '../hooks/useBranding';
import { useI18n } from '../hooks/useI18n';
import { brandIconUrl } from '../lib/branding';
import { listColor } from '../lib/colors';
import type { MessageKey } from '../lib/i18n';
import type { View } from '../state/view';
import { Icon, type IconName } from './icons';
import { useSortableSensors } from './useSortableSensors';

const NAV: { view: View; labelKey: MessageKey; icon: IconName }[] = [
  { view: { kind: 'today' }, labelKey: 'nav.today', icon: 'sun' },
  { view: { kind: 'all' }, labelKey: 'nav.all', icon: 'inbox' },
  { view: { kind: 'completed' }, labelKey: 'nav.completed', icon: 'check' },
];

/** 侧栏里的单个列表：整行可拖拽，点击仍然是导航。 */
function SortableListButton({
  list,
  active,
  count,
  onNavigate,
  draggedRef,
}: {
  list: ListRow;
  active: boolean;
  count: number;
  onNavigate: (view: View) => void;
  draggedRef: { current: boolean };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
  });

  return (
    <li
      ref={setNodeRef}
      className={`sidebar-list-item${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        type="button"
        className={`sidebar-item list-item${active ? ' is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          // 拖拽结束后的那次 click 不应该顺带导航
          if (draggedRef.current) return;
          onNavigate({ kind: 'list', id: list.id });
        }}
        {...attributes}
        {...listeners}
      >
        <span className="list-dot" style={{ background: listColor(list.color) }} />
        <span className="list-name">{list.name}</span>
        {count > 0 ? <span className="list-count">{count}</span> : null}
      </button>
    </li>
  );
}

export function Sidebar({
  lists,
  counts,
  view,
  open,
  onNavigate,
  onNewList,
  onReorderList,
}: {
  lists: ListRow[];
  counts: Record<string, number>;
  view: View;
  open: boolean;
  onNavigate: (view: View) => void;
  onNewList: (name: string) => void;
  onReorderList: (id: string, previousKey: string | null, nextKey: string | null) => void;
}) {
  const { t } = useI18n();
  const [newListName, setNewListName] = useState('');
  const sensors = useSortableSensors();
  const draggedRef = useRef(false);
  const branding = useBranding();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = newListName.trim();
    if (!name) return;
    setNewListName('');
    onNewList(name);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = lists.findIndex((list) => list.id === active.id);
    const newIndex = lists.findIndex((list) => list.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(lists, oldIndex, newIndex);
    const moved = reordered[newIndex]!;
    const previousKey = newIndex > 0 ? reordered[newIndex - 1]!.orderKey : null;
    const nextKey = newIndex < reordered.length - 1 ? reordered[newIndex + 1]!.orderKey : null;
    onReorderList(moved.id, previousKey, nextKey);
  };

  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label={t('sidebar.nav')}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <img
            className="brand-mark-img"
            src={
              branding.hasCustomIcon && branding.iconVersion !== null
                ? brandIconUrl(192, branding.iconVersion)
                : '/icons/icon-192.png'
            }
            alt=""
          />
        </span>
        {branding.appName}
      </div>

      <nav className="sidebar-nav">
        {NAV.map((item) => {
          const active = view.kind === item.view.kind;
          return (
            <button
              key={item.labelKey}
              type="button"
              className={`sidebar-item${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(item.view)}
            >
              <Icon name={item.icon} size={18} />
              <span className="list-name">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      <div className="divider" />
      <div className="section-label">{t('sidebar.lists')}</div>

      <DndContext
        id="sidebar-lists"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => {
          draggedRef.current = true;
        }}
        onDragEnd={(event) => {
          handleDragEnd(event);
          // click 在 dragend 之后触发；延后一拍再允许点击导航
          setTimeout(() => {
            draggedRef.current = false;
          }, 0);
        }}
        onDragCancel={() => {
          draggedRef.current = false;
        }}
      >
        <SortableContext items={lists.map((list) => list.id)} strategy={verticalListSortingStrategy}>
          <ul className="sidebar-lists">
            {lists.map((list) => (
              <SortableListButton
                key={list.id}
                list={list}
                active={view.kind === 'list' && view.id === list.id}
                count={counts[list.id] ?? 0}
                onNavigate={onNavigate}
                draggedRef={draggedRef}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <form className="new-list" onSubmit={submit}>
        <Icon name="plus" size={16} />
        <input
          value={newListName}
          maxLength={LIMITS.listName}
          onChange={(event) => setNewListName(event.target.value)}
          placeholder={t('sidebar.newList')}
          aria-label={t('sidebar.newList')}
          autoComplete="off"
        />
      </form>

      <div className="sidebar-foot">
        <button
          type="button"
          className={`sidebar-item${view.kind === 'settings' ? ' is-active' : ''}`}
          aria-current={view.kind === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate({ kind: 'settings' })}
        >
          <Icon name="settings" size={18} />
          <span className="list-name">{t('nav.settings')}</span>
        </button>
      </div>
    </aside>
  );
}
