import type { RefObject } from 'react';
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
  return (
    <header className="topbar">
      <button type="button" className="icon-btn menu-btn" aria-label="打开菜单" onClick={onMenu}>
        <Icon name="menu" />
      </button>

      <div className="search-box">
        <Icon name="search" size={16} />
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索任务…"
          aria-label="搜索任务"
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
            aria-label="清空搜索"
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
