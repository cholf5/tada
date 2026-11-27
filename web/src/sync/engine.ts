import type { Clock } from '../db/repo';
import { quarantineOutboxEntry } from '../db/outbox';
import { getMeta, setMeta, type TadaDb } from '../db/schema';
import { UnauthorizedError, type SyncTransport } from './api';
import { applyPushAccepted, collectPushBatch } from './push';
import { pushWithRecovery } from './pushRecovery';
import { pullAll } from './pull';
import { requeueAllLocalRows, requeueMissingLocalRows } from './reseed';

export type SyncStatus = 'unpaired' | 'offline' | 'syncing' | 'synced' | 'error';

export interface SyncSnapshot {
  status: SyncStatus;
  lastError: string | null;
}

export interface SyncEngineDeps {
  db: TadaDb;
  transport: SyncTransport;
  clock: Clock;
  isOnline?: () => boolean;
  now?: () => number;
  /** token 失效时的回调：App 用来切回配对页 */
  onUnauthorized?: () => void;
}

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 60_000;
const LOCAL_CHANGE_DEBOUNCE_MS = 1000;
const PERIODIC_MS = 30_000;

/**
 * 第 `attempt` 次连续失败后的等待时间：1s → 2s → 4s …，上限 60s。
 * `attempt <= 0` 视为还没失败过，按首档 1s。
 */
export function retryDelay(attempt: number): number {
  const step = Math.max(1, Math.floor(attempt));
  return Math.min(RETRY_BASE_MS * 2 ** (step - 1), RETRY_MAX_MS);
}

/**
 * 同步引擎：本地写入之后的后台行为，不阻塞交互。
 *
 * 触发点：本地改动 1s 防抖、窗口聚焦、页面重新可见、可见时每 30s、
 * online 事件、手动「立即同步」。
 * 失败：指数退避 1s → 2s → 4s … 上限 60s；离线不排定时器，等 online。
 * 401：清 token，停止同步，交给 App 跳配对页。
 */
export class SyncEngine {
  private readonly deps: SyncEngineDeps;
  private readonly listeners = new Set<(snapshot: SyncSnapshot) => void>();
  private snapshot: SyncSnapshot = { status: 'unpaired', lastError: null };

  private started = false;
  private inflight: Promise<void> | null = null;
  private again = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;

  constructor(deps: SyncEngineDeps) {
    this.deps = deps;
  }

  subscribe(listener: (snapshot: SyncSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): SyncSnapshot {
    return this.snapshot;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.handleFocus);
      window.addEventListener('online', this.handleOnline);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibility);
    }
    this.periodicTimer = setInterval(this.handlePeriodic, PERIODIC_MS);

    void this.syncNow();
  }

  stop(): void {
    this.started = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.handleFocus);
      window.removeEventListener('online', this.handleOnline);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.periodicTimer = null;
    this.clearRetry();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  /** 本地写入后调用：1s 防抖触发 push */
  notifyLocalChange(): void {
    if (!this.started) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncNow();
    }, LOCAL_CHANGE_DEBOUNCE_MS);
  }

  /** 手动「立即同步」或配对完成后调用 */
  async syncNow(): Promise<void> {
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }

    const run = this.runOnce().finally(() => {
      this.inflight = null;
      if (this.again) {
        this.again = false;
        void this.syncNow();
      }
    });
    this.inflight = run;
    return run;
  }

  /**
   * 手动兜底：把所有未删除的本地行重新排进 outbox，然后立刻同步一次。
   * 换到一台空服务器、或怀疑本机数据没传上去时使用。
   */
  async reseedLocalData(): Promise<number> {
    const count = await requeueAllLocalRows(this.deps.db);
    await this.syncNow();
    return count;
  }

  private async runOnce(): Promise<void> {
    const { db, clock, transport } = this.deps;

    let token: string | null;
    try {
      token = (await getMeta(db, 'token')) ?? null;
    } catch {
      token = null;
    }

    if (!token) {
      this.publish('unpaired');
      return;
    }

    if (!this.isOnline()) {
      this.publish('offline');
      return;
    }

    this.publish('syncing');

    try {
      const batch = await collectPushBatch({ db, clock });
      if (batch.changes.length > 0) {
        const outcome = await pushWithRecovery(
          (changes) => transport.push(token, changes),
          batch,
        );
        await applyPushAccepted({ db, clock }, outcome.accepted);

        // 4xx 毒丸：记入 quarantine 并从 outbox 移除，其余条目已经正常确认。
        // 这样一条坏数据不会让整条同步永远卡在 error。
        for (const rejected of outcome.quarantined) {
          await quarantineOutboxEntry(db, rejected);
        }
      }

      // 刚配对时 lastSeq 已归零；若首次全量 pull 中途失败，重试必须从 0
      // 重新收集 seenIds，否则前几页的行会被误判为「服务端没有」而重复补推。
      const pairReseed = ((await getMeta(db, 'pairReseed')) ?? 0) === 1;
      const summary = await pullAll(
        db,
        transport,
        token,
        { fromStart: pairReseed },
        clock,
      );
      await setMeta(db, 'lastSyncedAt', new Date(this.now()).toISOString());

      // 首次全量 pull 已经带回服务端仍存在的行 id。
      // 把「本地有、服务端没有」的未删除行补进 outbox，下一轮 push 上传。
      // 服务器完全为空只是这个集合为空的特例，非空服务器同样成立。
      if (pairReseed) {
        if ((await requeueMissingLocalRows(db, summary.seenIds)) > 0) this.again = true;
        await setMeta(db, 'pairReseed', 0);
      }

      this.attempt = 0;

      // 推送期间又有本地改动 / 还有补推行：立刻再走一轮，不等 1s 防抖。
      // 只有 outbox 真的清空、且没有待续轮次时才宣布「已同步」（W36）。
      if ((await db.outbox.count()) > 0) this.again = true;
      if (!this.again) this.publish('synced');
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        this.attempt = 0;
        this.clearRetry();
        try {
          await setMeta(db, 'token', null);
        } catch {
          // 清 token 失败也不影响切回配对页
        }
        this.publish('unpaired', '凭证失效，请重新配对');
        this.deps.onUnauthorized?.();
        return;
      }

      // 连续失败才递增；下一次触发用递增后的档位计算退避（P3）
      this.attempt += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.publish(this.isOnline() ? 'error' : 'offline', message);
      this.scheduleRetry();
    }
  }

  private publish(status: SyncStatus, lastError: string | null = null): void {
    if (this.snapshot.status === status && this.snapshot.lastError === lastError) return;
    this.snapshot = { status, lastError };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private scheduleRetry(): void {
    if (!this.isOnline()) return;
    const delay = retryDelay(this.attempt);
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private isOnline(): boolean {
    if (this.deps.isOnline) return this.deps.isOnline();
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private readonly handleFocus = (): void => {
    void this.syncNow();
  };

  private readonly handleOnline = (): void => {
    this.attempt = 0;
    this.clearRetry();
    void this.syncNow();
  };

  private readonly handleVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void this.syncNow();
    }
  };

  private readonly handlePeriodic = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!this.isOnline()) {
      this.publish('offline');
      return;
    }
    void this.syncNow();
  };
}
