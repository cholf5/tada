import { LIMITS } from '@tada/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { subtasksOf } from '../db/repo';
import type { ListRow, TaskRow, TadaDb } from '../db/schema';
import { useLive } from '../hooks/useLive';
import { useI18n } from '../hooks/useI18n';
import type { SubtaskCounts } from '../hooks/useSubtaskCounts';
import type { AppActions } from '../state/actions';
import { confirmPendingSubtasks } from './taskHandlers';
import { Icon } from './icons';

export function TaskDetail({
  db,
  task,
  lists,
  actions,
  subtaskCounts,
  onOpenTask,
  onClose,
}: {
  db: TadaDb;
  task: TaskRow;
  lists: ListRow[];
  actions: AppActions;
  /** 全局聚合的子任务进度，用于完成前的确认（比详情内的实时查询更早就绪） */
  subtaskCounts?: SubtaskCounts;
  /** 在父任务 / 子任务之间切换详情 */
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const subtaskInputRef = useRef<HTMLInputElement | null>(null);
  // 用户真正改过内容才标记 dirty；只聚焦不算，远端同步仍然可以刷新
  const titleDirty = useRef(false);
  const notesDirty = useRef(false);

  const [subtaskTitle, setSubtaskTitle] = useState('');
  const isSubtask = task.parentId !== null;

  // 只有顶层任务才有子任务；子任务本身不再嵌套
  const subtasks =
    useLive(
      async () => (isSubtask ? [] : subtasksOf(db, task.id)),
      [db, task.id, isSubtask],
    ) ?? [];

  const parent =
    useLive(
      async () => (task.parentId ? ((await db.tasks.get(task.parentId)) ?? null) : null),
      [db, task.parentId],
    ) ?? null;

  const doneCount = subtasks.filter((row) => row.done === 1).length;

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

  const addSubtask = async (event: FormEvent) => {
    event.preventDefault();
    const value = subtaskTitle.trim();
    if (!value) return;
    setSubtaskTitle('');
    await actions.createSubtask(task.id, value);
    subtaskInputRef.current?.focus();
  };

  const handleDelete = () => {
    if (
      window.confirm(
        isSubtask ? t('detail.deleteSubtaskConfirm') : t('detail.deleteTaskConfirm'),
      )
    ) {
      void actions.deleteTask(task.id);
      onClose();
    }
  };

  const handleToggleDone = () => {
    // 有未完成子任务时先确认，取消则父任务保持未完成
    if (!confirmPendingSubtasks(task, subtaskCounts?.get(task.id))) return;
    void actions.setTaskDone(task.id, task.done === 0);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('detail.dialogLabel')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <span className="modal-title">
            {isSubtask ? t('detail.subtaskTitle') : t('detail.title')}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        {isSubtask ? (
          <div className="detail-parent">
            <span>{t('detail.parent')}</span>
            {parent && parent.deleted === 0 ? (
              <button
                type="button"
                className="link-btn"
                onClick={() => onOpenTask(parent.id)}
              >
                {parent.title}
              </button>
            ) : (
              <span className="detail-parent-missing">{t('detail.parentDeleted')}</span>
            )}
          </div>
        ) : null}

        <input
          ref={titleRef}
          className="detail-title"
          defaultValue={task.title}
          maxLength={LIMITS.taskTitle}
          aria-label={t('task.titleLabel')}
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
          placeholder={t('detail.notesPlaceholder')}
          maxLength={LIMITS.taskNotes}
          aria-label={t('detail.notes')}
          rows={4}
          onChange={() => {
            notesDirty.current = true;
          }}
          onBlur={(event) => saveNotes(event.currentTarget)}
        />

        {isSubtask ? null : (
          <section className="detail-subtasks">
            <div className="subtasks-header">
              <span>{t('detail.subtasks')}</span>
              {subtasks.length > 0 ? (
                <span className="badge-count">
                  {doneCount}/{subtasks.length}
                </span>
              ) : null}
            </div>

            {subtasks.length > 0 ? (
              <ul className="subtask-list">
                {subtasks.map((subtask) => (
                  <li
                    key={subtask.id}
                    className={`subtask-row${subtask.done === 1 ? ' is-done' : ''}`}
                  >
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={subtask.done === 1}
                        onChange={() => {
                          void actions.setTaskDone(subtask.id, subtask.done === 0);
                        }}
                        aria-label={
                          subtask.done === 1
                            ? t('detail.markSubtaskUndone')
                            : t('detail.markSubtaskDone')
                        }
                      />
                      <span className="checkmark" aria-hidden="true">
                        <Icon name="check" size={12} />
                      </span>
                    </label>

                    <button
                      type="button"
                      className="subtask-title"
                      onClick={() => onOpenTask(subtask.id)}
                    >
                      {subtask.title}
                    </button>

                    <button
                      type="button"
                      className="icon-btn tiny subtask-remove"
                      aria-label={t('detail.deleteSubtask')}
                      onClick={() => {
                        if (
                          window.confirm(
                            t('detail.deleteSubtaskConfirmNamed', { title: subtask.title }),
                          )
                        ) {
                          void actions.deleteTask(subtask.id);
                        }
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <form className="subtask-add" onSubmit={addSubtask}>
              <input
                ref={subtaskInputRef}
                value={subtaskTitle}
                maxLength={LIMITS.taskTitle}
                onChange={(event) => setSubtaskTitle(event.target.value)}
                placeholder={t('detail.addSubtaskPlaceholder')}
                aria-label={t('detail.addSubtask')}
                autoComplete="off"
              />
              <button type="submit" className="btn">
                {t('common.add')}
              </button>
            </form>
          </section>
        )}

        {isSubtask ? null : (
          <div className="detail-grid">
            <label className="detail-field">
              <span>{t('detail.dueDate')}</span>
              <input
                type="date"
                value={task.dueAt ?? ''}
                onChange={(event) => {
                  void actions.updateTask(task.id, { dueAt: event.target.value || null });
                }}
              />
            </label>

            <label className="detail-field">
              <span>{t('detail.list')}</span>
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
        )}

        <footer className="modal-footer">
          <button type="button" className="btn danger" onClick={handleDelete}>
            {t('common.delete')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleToggleDone}
          >
            {task.done === 1 ? t('task.markUndone') : t('task.markDone')}
          </button>
        </footer>
      </div>
    </div>
  );
}
