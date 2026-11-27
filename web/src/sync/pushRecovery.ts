import type { WireChange } from '@tada/shared';
import { ApiError, UnauthorizedError } from './api';
import type { PushBatch, SentEntry } from './push';

/** 413 时把批次拆到多大再重试（与 SPEC 的 500 上限解耦，留出体积余量） */
export const PUSH_SPLIT_SIZE = 50;

export interface RejectedEntry {
  /** outbox key：`${entity}:${rowId}` */
  key: string;
  hlc: string;
  reason: string;
}

export interface PushOutcome {
  accepted: SentEntry[];
  /** 被 4xx 永久拒绝、需要隔离的条目 */
  quarantined: RejectedEntry[];
}

export type PushFn = (changes: WireChange[]) => Promise<unknown>;

/**
 * 带 4xx 恢复的 push。
 *
 * 服务端的 push 是整批事务：一条数据不合法（400）会让整批失败。以前客户端只会
 * 按退避无限重试同一个坏批次，outbox 永远清不空。这里把失败拆开：
 *
 * - 400：逐条重试定位毒丸，能过的正常确认，过不了的进 quarantine；
 * - 413：先按 50 条拆批；拆到最小仍失败则逐条隔离；
 * - 401 / 5xx / 网络错误：原样抛出，交给引擎的退避与配对流程。
 *
 * 成功过的条目即使后续某条重试抛错，也会留在 outbox 等下一轮重推（幂等）。
 */
export async function pushWithRecovery(push: PushFn, batch: PushBatch): Promise<PushOutcome> {
  const outcome: PushOutcome = { accepted: [], quarantined: [] };
  await run(push, batch.changes, batch.sent, outcome);
  return outcome;
}

async function run(
  push: PushFn,
  changes: WireChange[],
  sent: SentEntry[],
  out: PushOutcome,
): Promise<void> {
  if (changes.length === 0) return;

  try {
    await push(changes);
    out.accepted.push(...sent);
    return;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    if (!(error instanceof ApiError)) throw error;

    if (error.status === 400) {
      await retryOneByOne(push, changes, sent, out);
      return;
    }

    if (error.status === 413) {
      // 已经拆到最小粒度：只能逐条判定，避免重试永远 413
      if (changes.length <= PUSH_SPLIT_SIZE) {
        await retryOneByOne(push, changes, sent, out);
        return;
      }

      for (let index = 0; index < changes.length; index += PUSH_SPLIT_SIZE) {
        await run(
          push,
          changes.slice(index, index + PUSH_SPLIT_SIZE),
          sent.slice(index, index + PUSH_SPLIT_SIZE),
          out,
        );
      }
      return;
    }

    // 5xx / 网络错误：整批失败不是数据问题，交回引擎退避重试
    throw error;
  }
}

async function retryOneByOne(
  push: PushFn,
  changes: WireChange[],
  sent: SentEntry[],
  out: PushOutcome,
): Promise<void> {
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]!;
    const entry = sent[index];
    if (!entry) continue;

    try {
      await push([change]);
      out.accepted.push(entry);
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      if (error instanceof ApiError && (error.status === 400 || error.status === 413)) {
        out.quarantined.push({
          key: entry.key,
          hlc: entry.hlc,
          reason: error.message || `HTTP ${error.status}`,
        });
        continue;
      }
      throw error;
    }
  }
}
