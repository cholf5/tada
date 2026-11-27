import type { CSSProperties, SyntheticEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ListRow, TaskRow as Row } from '../db/schema';
import type { SubtaskCounts } from '../hooks/useSubtaskCounts';
import { TaskRow } from './TaskRow';
import type { TaskHandlers } from './taskHandlers';

/** 列表内未完成任务的可拖拽外壳：把 dnd-kit 的节点/手柄接到 TaskRow 上。 */
export function SortableTaskRow({
  task,
  lists,
  handlers,
  subtaskCounts,
}: {
  task: Row;
  lists: ListRow[];
  handlers: TaskHandlers;
  subtaskCounts?: SubtaskCounts;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
  };

  return (
    <TaskRow
      task={task}
      lists={lists}
      subtaskCounts={subtaskCounts}
      rowRef={setNodeRef}
      style={style}
      draggable
      dragging={isDragging}
      dragHandleProps={{ attributes, listeners }}
      onRowPointerDown={listeners?.onPointerDown as ((event: SyntheticEvent) => void) | undefined}
      onToggle={handlers.onToggle}
      onOpen={handlers.onOpen}
      onMove={handlers.onMove}
      onDelete={handlers.onDelete}
    />
  );
}
