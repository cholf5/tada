import { LIMITS } from '@tada/shared';
import { useEffect, useRef } from 'react';
import type { ListRow, TaskRow } from '../db/schema';
import type { AppActions } from '../state/actions';
import { Icon } from './icons';

export function TaskDetail({
  task,
  lists,
  actions,
  onClose,
}: {
  task: TaskRow;
  lists: ListRow[];
  actions: AppActions;
  onClose: () => void;
}) {
  const titleRef = useRef<HTMLInputElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  // 用户真正改过内容才标记 dirty；只聚焦不算，远端同步仍然可以刷新
  const titleDirty = useRef(false);
  const notesDirty = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  // 弹窗打开期间远端更新了标题：用户没编辑标题时同步成新值
  useEffect(() => {
    const input = titleRef.current;
    if (input && !titleDirty.current && input.value !== task.title) {
      input.value = task.title;
    }
  }, [task.title]);

  // 备注同理，正在编辑的字段不覆盖
  useEffect(() => {
    const textarea = notesRef.current;
    const next = task.notes ?? '';
    if (textarea && !notesDirty.current && textarea.value !== next) {
      textarea.value = next;
    }
  }, [task.notes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const saveTitle = (input: HTMLInputElement) => {
    const value = input.value.trim();
    titleDirty.current = false;
    if (!value) {
      input.value = task.title;
      return;
    }
    if (value !== task.title) void actions.updateTask(task.id, { title: value });
  };

  const saveNotes = (textarea: HTMLTextAreaElement) => {
    const value = textarea.value;
    const next = value.trim() === '' ? null : value;
    notesDirty.current = false;
    if (next !== task.notes) void actions.updateTask(task.id, { notes: next });
  };

  const handleDelete = () => {
    if (window.confirm('删除这项任务？')) {
      void actions.deleteTask(task.id);
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="任务详情"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <span className="modal-title">任务详情</span>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <input
          ref={titleRef}
          className="detail-title"
          defaultValue={task.title}
          maxLength={LIMITS.taskTitle}
          aria-label="任务标题"
          onChange={() => {
            titleDirty.current = true;
          }}
          onBlur={(event) => saveTitle(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />

        <textarea
          ref={notesRef}
          className="detail-notes"
          defaultValue={task.notes ?? ''}
          placeholder="备注…"
          maxLength={LIMITS.taskNotes}
          aria-label="备注"
          rows={4}
          onChange={() => {
            notesDirty.current = true;
          }}
          onBlur={(event) => saveNotes(event.currentTarget)}
        />

        <div className="detail-grid">
          <label className="detail-field">
            <span>截止日期</span>
            <input
              type="date"
              value={task.dueAt ?? ''}
              onChange={(event) => {
                void actions.updateTask(task.id, { dueAt: event.target.value || null });
              }}
            />
          </label>

          <label className="detail-field">
            <span>所属列表</span>
            <select
              value={task.listId}
              onChange={(event) => {
                void actions.moveTask(task.id, event.target.value);
              }}
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn danger" onClick={handleDelete}>
            删除
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void actions.setTaskDone(task.id, task.done === 0);
            }}
          >
            {task.done === 1 ? '标记为未完成' : '标记为完成'}
          </button>
        </footer>
      </div>
    </div>
  );
}
