import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, type URL as NodeURL } from 'node:url';
import type { D1Like, D1PreparedStatementLike, D1RunResult } from '../store';

/**
 * D1Like 的 node:sqlite 适配器。
 *
 * 用 Node 内置的 DatabaseSync（不是 better-sqlite3），并加载真实的
 * schema.sql —— 测试与线上 D1 执行的是同一份 SQL。
 */

type BindValue = string | number | bigint | null | Uint8Array;

class SqliteStatement implements D1PreparedStatementLike {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: BindValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatementLike {
    return new SqliteStatement(this.db, this.sql, values as BindValue[]);
  }

  async all<T = unknown>(): Promise<{ results: T[]; meta: Record<string, never> }> {
    const results = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results, meta: {} };
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as T | undefined;
    return row ?? null;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(info.changes) } };
  }
}

/** 模拟 D1 batch：整批在一个事务里，任一语句失败则整体回滚。 */
export class SqliteD1 implements D1Like {
  constructor(readonly db: DatabaseSync) {}

  prepare(query: string): D1PreparedStatementLike {
    return new SqliteStatement(this.db, query);
  }

  async batch(statements: D1PreparedStatementLike[]): Promise<D1RunResult[]> {
    this.db.exec('BEGIN');
    try {
      const results: D1RunResult[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

export const SCHEMA_PATH = fileURLToPath(
  new URL('../../schema.sql', import.meta.url) as unknown as NodeURL,
);

/** 每个用例一个内存库，加载真实 schema。 */
export function makeDb(): SqliteD1 {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return new SqliteD1(raw);
}
