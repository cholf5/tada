import { createHlcClock } from '@tada/shared';
import type { RepoDeps } from '../db/repo';
import { createDb, type TadaDb } from '../db/schema';

let counter = 0;

/** 每个用例一个独立的 Dexie 库，避免互相污染 */
export function makeDb(): TadaDb {
  counter += 1;
  return createDb(
    `tada-test-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

export function makeDeps(db: TadaDb): RepoDeps {
  const clock = createHlcClock('testdev');
  return {
    db,
    clock,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  };
}

export async function disposeDb(db: TadaDb): Promise<void> {
  db.close();
  await db.delete();
}
