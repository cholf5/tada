import { describe, expect, it } from 'vitest';
import {
  mergePullPage,
  type ListDbRow,
  type SeqWireChange,
  type TaskDbRow,
} from './pull';

const TS = '2026-11-27T10:00:00.000Z';

function listRow(seq: number, deleted = 0): ListDbRow {
  return {
    id: `list-${seq}`,
    name: `L${seq}`,
    color: null,
    order_key: 'a0',
    hlc: '1760000000000-00000-dev1',
    seq,
    deleted,
    created_at: TS,
    updated_at: TS,
  };
}

function taskRow(seq: number, deleted = 0): TaskDbRow {
  return {
    id: `task-${seq}`,
    list_id: 'list-1',
    parent_id: null,
    title: `T${seq}`,
    notes: null,
    done: 0,
    done_at: null,
    due_at: null,
    order_key: 'a0',
    hlc: '1760000000000-00000-dev1',
    seq,
    deleted,
    created_at: TS,
    updated_at: TS,
  };
}

describe('mergePullPage 分页', () => {
  it('单表剩余行数 > limit 时 hasMore 必须为 true', () => {
    const lists = Array.from({ length: 6 }, (_, i) => listRow(i + 1));

    const page = mergePullPage(lists, [], 0, 5);

    expect(page.changes).toHaveLength(5);
    expect(page.nextSince).toBe(5);
    // 若只从单表取 limit 条，这里会被误判为 false
    expect(page.hasMore).toBe(true);
  });

  it('恰好 limit 行时 hasMore 为 false', () => {
    const lists = Array.from({ length: 5 }, (_, i) => listRow(i + 1));
    const page = mergePullPage(lists, [], 0, 5);
    expect(page.changes).toHaveLength(5);
    expect(page.hasMore).toBe(false);
  });

  it('跨表按 seq 合并，游标停在整页最后一行', () => {
    const lists = [listRow(1), listRow(4)];
    const tasks = [taskRow(2), taskRow(3), taskRow(5)];

    const page = mergePullPage(lists, tasks, 0, 10);

    expect(page.changes.map((change) => change.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(page.changes.map((change) => change.entity)).toEqual([
      'lists',
      'tasks',
      'tasks',
      'lists',
      'tasks',
    ]);
    expect(page.nextSince).toBe(5);
    expect(page.hasMore).toBe(false);
  });

  it('seq <= since 的行被过滤', () => {
    const lists = [listRow(1), listRow(3)];
    const tasks = [taskRow(2), taskRow(4)];

    const page = mergePullPage(lists, tasks, 2, 10);

    expect(page.changes.map((change) => change.seq)).toEqual([3, 4]);
    expect(page.nextSince).toBe(4);
  });

  it('空页保持游标不变', () => {
    const page = mergePullPage([], [], 42, 10);
    expect(page.changes).toEqual([]);
    expect(page.nextSince).toBe(42);
    expect(page.hasMore).toBe(false);
  });

  it('墓碑行也带着 deleted 标记返回', () => {
    const page = mergePullPage([listRow(1, 1)], [], 0, 10);
    expect(page.changes[0]?.deleted).toBe(true);
  });
});

describe('随机对拍：分页 drain', () => {
  /** 固定种子的 LCG，避免随机测试不可复现 */
  function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };
  }

  function buildRows(seed: number, total: number) {
    const random = rng(seed);
    const lists: ListDbRow[] = [];
    const tasks: TaskDbRow[] = [];
    const all: { seq: number; entity: 'lists' | 'tasks' }[] = [];

    for (let seq = 1; seq <= total; seq += 1) {
      const isList = random() < 0.4;
      if (isList) {
        lists.push(listRow(seq, random() < 0.15 ? 1 : 0));
        all.push({ seq, entity: 'lists' });
      } else {
        tasks.push(taskRow(seq, random() < 0.15 ? 1 : 0));
        all.push({ seq, entity: 'tasks' });
      }
    }

    return { lists, tasks, all };
  }

  it('drain 后不丢行、hasMore 正确、游标单调', () => {
    for (const seed of [1, 7, 42, 2026]) {
      for (const limit of [1, 2, 3, 7, 13]) {
        const total = 60;
        const { lists, tasks, all } = buildRows(seed, total);

        let since = 0;
        const seen: SeqWireChange[] = [];

        for (let guard = 0; guard < 500; guard += 1) {
          const page = mergePullPage(lists, tasks, since, limit);
          const remaining = all.filter((row) => row.seq > since).length;

          // hasMore 必须精确等于「是否还有下一行」
          expect(page.hasMore).toBe(remaining > limit);

          if (page.changes.length === 0) {
            expect(page.nextSince).toBe(since);
            expect(page.hasMore).toBe(false);
            break;
          }

          // 游标严格前进，且不超过本页最后一条
          expect(page.nextSince).toBeGreaterThan(since);
          expect(page.nextSince).toBe(page.changes[page.changes.length - 1]!.seq);
          expect(page.changes.length).toBeLessThanOrEqual(limit);

          seen.push(...page.changes);
          since = page.nextSince;

          if (!page.hasMore) break;
        }

        // 一行不少、一行不重，且整体按 seq 升序
        expect(seen).toHaveLength(total);
        expect(new Set(seen.map((change) => change.seq)).size).toBe(total);
        const seqs = seen.map((change) => change.seq);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

        // 实体归属与构造数据一致
        for (const row of all) {
          const found = seen.find((change) => change.seq === row.seq);
          expect(found?.entity).toBe(row.entity);
        }
      }
    }
  });
});
