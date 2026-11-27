import { LIMITS } from '@tada/shared';
import { useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { AppActions } from '../state/actions';
import { Icon } from './icons';

/** 单列表页的快速添加：回车创建、清空、保持焦点 */
export function QuickAdd({
  listId,
  actions,
}: {
  listId: string;
  actions: AppActions;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    setTitle('');
    await actions.createTask(listId, value);
    inputRef.current?.focus();
  };

  return (
    <form className="quick-add" onSubmit={submit}>
      <span className="quick-add-icon" aria-hidden="true">
        <Icon name="plus" size={18} />
      </span>
      <input
        ref={inputRef}
        value={title}
        maxLength={LIMITS.taskTitle}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={t('quickAdd.placeholder')}
        aria-label={t('quickAdd.aria')}
        autoComplete="off"
      />
    </form>
  );
}
