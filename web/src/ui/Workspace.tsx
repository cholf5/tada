import { LIMITS } from '@tada/shared';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { liveLists, type RepoDeps } from '../db/repo';
import type { TadaDb, TaskRow } from '../db/schema';
import { useLive } from '../hooks/useLive';
import { useSubtaskCounts } from '../hooks/useSubtaskCounts';
import type { SyncEngine, SyncSnapshot } from '../sync/engine';
import { useActions, type AppActions } from '../state/actions';
import type { View } from '../state/view';
import { AllView } from './AllView';
import { CompletedView } from './CompletedView';
import { EmptyState } from './EmptyState';
import { ListView } from './ListView';
import { SearchResults } from './SearchResults';
import { SettingsView } from './SettingsView';
import { Sidebar } from './Sidebar';
import { makeTaskHandlers } from './taskHandlers';
import { TaskDetail } from './TaskDetail';
import { TodayView } from './TodayView';
import { TopBar } from './TopBar';

export function Workspace({
  db,
  deps,
  engine,
  sync,
  connected,
  notice,
  onPair,
  onUnpair,
}: {
  db: TadaDb;
  deps: RepoDeps;
  engine: SyncEngine;
  sync: SyncSnapshot;
  connected: boolean;
  notice: string | null;
  onPair: (code: string, deviceName: string) => Promise<void>;
  onUnpair: () => void;
}) {
  const actions = useActions(deps, engine);

  const lists = useLive(() => liveLists(db), [db]) ?? [];
  const subtaskCounts = useSubtaskCounts(db);
  const counts =
    useLive(async () => {
      const rows = await db.tasks
        .filter(
          (task) => task.deleted === 0 && task.done === 0 && task.parentId === null,
        )
        .toArray();
      const result: Record<string, number> = {};
      for (const row of rows) result[row.listId] = (result[row.listId] ?? 0) + 1;
      return result;
    }, [db]) ?? {};

  const [view, setView] = useState<View>({ kind: 'today' });
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const query = search.trim();

  const searchData =
    useLive(async () => {
      if (!query) return { tasks: [] as TaskRow[], parents: {} as Record<string, string> };
      const needle = query.toLowerCase();
      const [rows, currentLists] = await Promise.all([
        db.tasks
          .filter(
            (task) =>
              task.deleted === 0 &&
              (task.title.toLowerCase().includes(needle) ||
                (task.notes?.toLowerCase().includes(needle) ?? false)),
          )
          .toArray(),
        liveLists(db),
      ]);
      const known = new Set(currentLists.map((list) => list.id));
      const matched = rows
        .filter((task) => known.has(task.listId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      // 子任务没有列表视图作为上下文，搜索命中时补上父任务标题
      const parentIds = [
        ...new Set(
          matched.map((task) => task.parentId).filter((id): id is string => id !== null),
        ),
      ];
      const parentRows = parentIds.length > 0 ? await db.tasks.bulkGet(parentIds) : [];
      const parents: Record<string, string> = {};
      for (const parent of parentRows) {
        if (parent && parent.deleted === 0) parents[parent.id] = parent.title;
      }

      return { tasks: matched, parents };
    }, [db, query]) ?? { tasks: [], parents: {} };

  const selectedTask =
    useLive(async () => {
      if (!selectedTaskId) return null;
      return (await db.tasks.get(selectedTaskId)) ?? null;
    }, [db, selectedTaskId]) ?? null;

  const handlers = useMemo(
    () =>
      makeTaskHandlers(
        actions,
        (task) => setSelectedTaskId(task.id),
        (taskId) => subtaskCounts.get(taskId),
      ),
    [actions, subtaskCounts],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === 'Escape' && drawerOpen) {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const navigate = (next: View) => {
    setSearch('');
    setView(next);
    setDrawerOpen(false);
  };

  const handleNewList = (name: string) => {
    void actions.createList(name).then((id) => {
      if (id) {
        setView({ kind: 'list', id });
        setDrawerOpen(false);
      }
    });
  };

  const handleReorderList = (
    id: string,
    previousKey: string | null,
    nextKey: string | null,
  ) => {
    void actions.reorderList(id, previousKey, nextKey);
  };

  const renderView = () => {
    if (query) {
      return (
        <SearchResults
          query={query}
          tasks={searchData.tasks}
          lists={lists}
          parents={searchData.parents}
          handlers={handlers}
          subtaskCounts={subtaskCounts}
        />
      );
    }

    if (view.kind === 'settings') {
      return (
        <SettingsView
          db={db}
          engine={engine}
          sync={sync}
          connected={connected}
          notice={notice}
          onPair={onPair}
          onUnpair={onUnpair}
        />
      );
    }

    if (lists.length === 0) {
      return (
        <NoListsView
          actions={actions}
          onCreated={(id) => setView({ kind: 'list', id })}
        />
      );
    }

    if (view.kind === 'list') {
      const list = lists.find((item) => item.id === view.id);
      if (!list) {
        return (
          <EmptyState
            title="列表不存在"
            hint="它可能已在其他设备上删除。"
            action={
              <button type="button" className="btn" onClick={() => navigate({ kind: 'today' })}>
                回到今天
              </button>
            }
          />
        );
      }
      return (
        <ListView
          key={list.id}
          db={db}
          list={list}
          lists={lists}
          actions={actions}
          handlers={handlers}
          subtaskCounts={subtaskCounts}
          onDeleted={() => navigate({ kind: 'today' })}
        />
      );
    }

    if (view.kind === 'all') {
      return (
        <AllView
          db={db}
          lists={lists}
          handlers={handlers}
          subtaskCounts={subtaskCounts}
        />
      );
    }

    if (view.kind === 'completed') {
      return (
        <CompletedView
          db={db}
          lists={lists}
          handlers={handlers}
          subtaskCounts={subtaskCounts}
        />
      );
    }

    return (
      <TodayView
        db={db}
        lists={lists}
        handlers={handlers}
        subtaskCounts={subtaskCounts}
      />
    );
  };

  return (
    <div className="app">
      <Sidebar
        lists={lists}
        counts={counts}
        view={view}
        open={drawerOpen}
        onNavigate={navigate}
        onNewList={handleNewList}
        onReorderList={handleReorderList}
      />

      <button
        type="button"
        className={`drawer-backdrop${drawerOpen ? ' is-open' : ''}`}
        aria-label="关闭菜单"
        onClick={() => setDrawerOpen(false)}
      />

      <div className="main">
        <TopBar
          onMenu={() => setDrawerOpen(true)}
          search={search}
          onSearchChange={setSearch}
          searchRef={searchRef}
          sync={sync}
          onSyncNow={() => {
            if (!connected) {
              navigate({ kind: 'settings' });
              return;
            }
            void engine.syncNow();
          }}
        />
        <main className="content">{renderView()}</main>
      </div>

      {selectedTask && selectedTask.deleted === 0 ? (
        <TaskDetail
          key={selectedTask.id}
          db={db}
          task={selectedTask}
          lists={lists}
          actions={actions}
          subtaskCounts={subtaskCounts}
          onOpenTask={(id) => setSelectedTaskId(id)}
          onClose={() => setSelectedTaskId(null)}
        />
      ) : null}
    </div>
  );
}

function NoListsView({
  actions,
  onCreated,
}: {
  actions: AppActions;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    const id = await actions.createList(value);
    setName('');
    if (id) onCreated(id);
  };

  return (
    <EmptyState
      title="还没有列表"
      hint="列表用来收纳任务，先创建一个吧。"
      action={
        <form className="empty-form" onSubmit={submit}>
          <input
            value={name}
            maxLength={LIMITS.listName}
            onChange={(event) => setName(event.target.value)}
            placeholder="列表名称"
            aria-label="列表名称"
          />
          <button type="submit" className="btn primary">
            新建列表
          </button>
        </form>
      }
    />
  );
}
