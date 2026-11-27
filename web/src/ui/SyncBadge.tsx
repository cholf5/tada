import { useI18n } from '../hooks/useI18n';
import { t as translateNow, type MessageKey } from '../lib/i18n';
import type { SyncSnapshot, SyncStatus } from '../sync/engine';

const LABEL_KEYS: Record<SyncStatus, MessageKey> = {
  unpaired: 'sync.unpaired',
  offline: 'sync.offline',
  syncing: 'sync.syncing',
  synced: 'sync.synced',
  error: 'sync.error',
};

/** 非组件代码取同步状态文案；组件内请用 useI18n。 */
export function splitSyncLabel(status: SyncStatus): string {
  return translateNow(LABEL_KEYS[status]);
}

export function SyncBadge({
  sync,
  onClick,
}: {
  sync: SyncSnapshot;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const label = t(LABEL_KEYS[sync.status]);
  const title = sync.lastError
    ? t('sync.tooltip', { label, error: sync.lastError })
    : label;

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
