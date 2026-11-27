import type { ListRow, TaskRow, TadaDb } from './schema';
import { todayIso } from '../lib/dates';

/**
 * 本地数据备份文件。
 *
 * 只包含列表与任务（含墓碑行），**不包含**配对 token、lastSeq 或 HLC 水位；
 * 拿到文件的人无法访问中继，恢复/导入也需要用户自己处理。这样即使把备份
 * 发到别处，也不会泄露同步凭证。
 */
export const BACKUP_FORMAT = 'tada-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  deviceName: string | null;
  lists: ListRow[];
  tasks: TaskRow[];
}

/** 导出当前本地库的快照。读事务保证 lists / tasks / meta 是同一时刻。 */
export async function createBackup(db: TadaDb, now: Date = new Date()): Promise<BackupFile> {
  return db.transaction('r', [db.lists, db.tasks, db.meta], async () => {
    const [lists, tasks, deviceName] = await Promise.all([
      db.lists.toArray(),
      db.tasks.toArray(),
      db.meta.get('deviceName'),
    ]);

    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now.toISOString(),
      deviceName: (deviceName?.value as string | undefined) ?? null,
      lists,
      tasks,
    };
  });
}

export function backupFilename(now: Date = new Date()): string {
  return `tada-backup-${todayIso(now)}.json`;
}
