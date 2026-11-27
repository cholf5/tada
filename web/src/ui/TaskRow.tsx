import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { LIMITS } from '@tada/shared';
import type { ListRow, TaskRow as Row } from '../db/schema';
import { useToday } from '../hooks/useToday';
import type { SubtaskCounts } from '../hooks/useSubtaskCounts';
import { listColor } from '../lib/colors';
import { formatDue, isOverdue } from '../lib/dates';
import { Icon } from './icons';

export interface TaskDragHandleProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
}

export interface TaskRowProps {
  task: Row;
  lists: ListRow[];
  listName?: string;
  showList?: boolean;
  /** 搜索命中的子任务：显示所属父任务，补上脱离父任务后缺失的上下文 */
  parentName?: string;
  /** 父任务 → 子任务进度映射，用于在任务行显示 `2/5` */
  subtaskCounts?: SubtaskCounts;
  /** 是否参与拖拽排序（只有未完成列表在主视图里可以拖） */
  draggable?: boolean;
  dragging?: boolean;
  /** dnd-kit 的 listeners / attributes，挂在拖拽手柄上 */
  dragHandleProps?: TaskDragHandleProps;
  /** 桌面端也可以直接按住行主体拖拽（沿用旧版整行拖拽的手感） */
  onRowPointerDown?: (event: SyntheticEvent) => void;
  /** 排序容器需要拿到根节点 */
  rowRef?: (node: HTMLLIElement | null) => void;
  style?: CSSProperties;
  onToggle: (task: Row) => void;
  onOpen: (task: Row) => void;
  onRename: (task: Row, title: string) => void;
  onMove: (task: Row, listId: string) => void;
  onDelete: (task: Row) => void;
}

export function TaskRow({
  task,
  lists,
  listName,
  showList = false,
  parentName,
  subtaskCounts,
  draggable = false,
  dragging = false,
  dragHandleProps,
  onRowPointerDown,
  rowRef,
  style,
  onToggle,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: TaskRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const cancelTitleRef = useRef(false);
  const finishTitleRef = useRef(false);
  const rootRef = useRef<HTMLLIElement | null>(null);
  const today = useToday();

  // 外部同步更新标题时，如果用户没在编辑就同步草稿
  useEffect(() => {
    if (!editingTitle) setDraftTitle(task.title);
  }, [task.title, editingTitle]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  const finishTitle = (save: boolean) => {
    if (!editingTitle || finishTitleRef.current) return;
    finishTitleRef.current = true;
    setEditingTitle(false);
    if (!save) {
      setDraftTitle(task.title);
      return;
    }
    const value = draftTitle.trim();
    if (!value) {
      setDraftTitle(task.title);
      return;
    }
    if (value !== task.title) onRename(task, value);
  };

  const overdue = isOverdue(task.dueAt, today);
  // 子任务跟随父任务换列表，不提供单独移动入口
  const moveTargets =
    task.parentId === null ? lists.filter((list) => list.id !== task.listId) : [];
  const subtaskSummary = subtaskCounts?.get(task.id);
  const subtasksComplete =
    subtaskSummary !== undefined && subtaskSummary.done === subtaskSummary.total;

  const setRootRef = (node: HTMLLIElement | null) => {
    rootRef.current = node;
    rowRef?.(node);
  };

  return (
    <li
      ref={setRootRef}
      style={style}
      className={`task-row${task.done === 1 ? ' is-done' : ''}${dragging ? ' is-dragging' : ''}`}
    >
      {draggable ? (
        <button
          type="button"
          className="drag-handle"
          title="拖拽排序"
          aria-label="拖拽排序"
          {...dragHandleProps?.attributes}
          {...dragHandleProps?.listeners}
        >
          <Icon name="grip" size={16} />
        </button>
      ) : null}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={task.done === 1}
          onChange={() => onToggle(task)}
          aria-label={task.done === 1 ? '标记为未完成' : '标记为完成'}
        />
        <span className="checkmark" aria-hidden="true">
          <Icon name="check" size={12} />
        </span>
      </label>

      <div className="task-body" onPointerDown={onRowPointerDown}>
        {editingTitle ? (
          <input
            className="task-title-input"
            value={draftTitle}
            autoFocus
            maxLength={LIMITS.taskTitle}
            aria-label="任务标题"
            onChange={(event) => setDraftTitle(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={() => {
              if (cancelTitleRef.current) {
                cancelTitleRef.current = false;
                return;
              }
              finishTitle(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                finishTitle(true);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelTitleRef.current = true;
                finishTitleRef.current = true;
                setDraftTitle(task.title);
                setEditingTitle(false);
              }
            }}
          />
        ) : (
          <button type="button" className="task-title" onClick={() => onOpen(task)}>
            {task.title}
          </button>
        )}
        <div className="task-meta">
          {parentName ? (
            <span className="parent-tag" title={`所属父任务：${parentName}`}>
              ↳ {parentName}
            </span>
          ) : null}
          {showList && listName ? <span className="list-tag">{listName}</span> : null}
          {subtaskSummary && subtaskSummary.total > 0 ? (
            <span
              className={`subtask-chip${subtasksComplete ? ' is-complete' : ''}`}
              title={`子任务 ${subtaskSummary.done}/${subtaskSummary.total} 已完成`}
            >
              <Icon name="list" size={12} />
              {subtaskSummary.done}/{subtaskSummary.total}
            </span>
          ) : null}
          {task.dueAt ? (
            <span className={`due-chip${overdue ? ' is-overdue' : ''}`}>
              <Icon name="calendar" size={12} />
              {formatDue(task.dueAt, today)}
            </span>
          ) : null}
          {task.notes ? (
            <span className="note-mark" title={task.notes}>
              <Icon name="note" size={13} />
            </span>
          ) : null}
        </div>
      </div>

      <div className="task-actions">
        <button
          type="button"
          className="icon-btn small"
          aria-label="更多操作"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="more" size={18} />
        </button>

        {menuOpen ? (
          <div className="task-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                cancelTitleRef.current = false;
                finishTitleRef.current = false;
                setDraftTitle(task.title);
                setEditingTitle(true);
              }}
            >
              重命名
            </button>
            <div className="menu-divider" />
            {moveTargets.length > 0 ? (
              <>
                <div className="menu-label">移动到</div>
                {moveTargets.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onMove(task, list.id);
                    }}
                  >
                    <span className="menu-dot" style={{ background: listColor(list.color) }} />
                    {list.name}
                  </button>
                ))}
                <div className="menu-divider" />
              </>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setMenuOpen(false);
                onDelete(task);
              }}
            >
              删除任务
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
