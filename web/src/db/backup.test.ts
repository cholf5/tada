import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupFilename, BACKUP_FORMAT, BACKUP_VERSION, createBackup } from './backup';
import { createList, createTask } from './repo';
import { setMeta, type TadaDb } from './schema';
import { disposeDb, makeDb, makeDeps } from '../test/helpers';

let db: TadaDb;

beforeEach(() => {
  db = makeDb();
});

afterEach(async () => {
  await disposeDb(db);
});

describe('本地数据导出', () => {
  it('导出列表、任务（含墓碑）和设备名，不包含 token', async () => {
    const deps = makeDeps(db);
    const listId = await createList(deps, '工作');
    if (!listId) throw new Error('list not created');
    const aliveId = await createTask(deps, listId, '买牛奶');
    const deletedId = await createTask(deps, listId, '已删除');
    if (!aliveId || !deletedId) throw new Error('task not created');

    const deleted = await db.tasks.get(deletedId);
    if (!deleted) throw new Error('task missing');
    await db.tasks.put({ ...deleted, deleted: 1 });
    await setMeta(db, 'deviceName', '我的 Mac');
    await setMeta(db, 'token', 'super-secret-token');

    const backup = await createBackup(db, new Date('2026-11-27T00:00:00.000Z'));

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.exportedAt).toBe('2026-11-27T00:00:00.000Z');
    expect(backup.deviceName).toBe('我的 Mac');
    expect(backup.lists.map((list) => list.name)).toEqual(['工作']);
    expect(backup.tasks.map((task) => task.title).sort()).toEqual(['买牛奶', '已删除'].sort());
    // 墓碑也保留，方便未来恢复时不会把已删数据复活
    expect(backup.tasks.find((task) => task.id === deletedId)?.deleted).toBe(1);

    // token 绝对不能进备份文件
    expect(JSON.stringify(backup)).not.toContain('super-secret-token');
    expect(JSON.stringify(backup)).not.toContain('"token"');
  });

  it('文件名使用本地日期', () => {
    expect(backupFilename(new Date(2026, 10, 27, 23, 30))).toBe('tada-backup-2026-11-27.json');
  });
});
