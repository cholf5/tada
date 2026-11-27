import type { RefObject } from 'react';
import { useI18n } from '../hooks/useI18n';
import type { SyncSnapshot } from '../sync/engine';
import { Icon } from './icons';
import { SyncBadge } from './SyncBadge';

export function TopBar({
  onMenu,
  search,
  onSearchChange,
  searchRef,
  sync,
  onSyncNow,
}: {
  onMenu: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  sync: SyncSnapshot;
  onSyncNow: () => void;
}) {
  const { t } = useI18n();
  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-btn menu-btn"
        aria-label={t('topbar.openMenu')}
        onClick={onMenu}
      >
        <Icon name="menu" />
      </button>

      <div className="search-box">
        <Icon name="search" size={16} />
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('topbar.searchPlaceholder')}
          aria-label={t('topbar.search')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onSearchChange('');
              event.currentTarget.blur();
            }
          }}
        />
        {search ? (
          <button
            type="button"
            className="icon-btn tiny"
            aria-label={t('topbar.clearSearch')}
            onClick={() => onSearchChange('')}
          >
            <Icon name="close" size={14} />
          </button>
        ) : null}
      </div>

      <SyncBadge sync={sync} onClick={onSyncNow} />
    </header>
  );
}
