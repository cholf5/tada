import type { SyncSnapshot, SyncStatus } from '../sync/engine';

const LABELS: Record<SyncStatus, string> = {
  unpaired: '仅本机',
  offline: '离线',
  syncing: '同步中',
  synced: '已同步',
  error: '同步失败',
};

export function splitSyncLabel(status: SyncStatus): string {
  return LABELS[status];
}

export function SyncBadge({
  sync,
  onClick,
}: {
  sync: SyncSnapshot;
  onClick?: () => void;
}) {
  const label = LABELS[sync.status];
  const title = sync.lastError ? `${label}：${sync.lastError}` : label;

  const content = (
    <>
      <span className={`sync-dot is-${sync.status}`} aria-hidden="true" />
      <span className="sync-label">{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="sync-badge" title={title} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <span className="sync-badge" title={title}>
      {content}
    </span>
  );
}
