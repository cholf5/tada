import { describe, expect, it } from 'vitest';
import {
  changeSchema,
  entityDataSchemas,
  listDataSchema,
  pushBodySchema,
  taskDataSchema,
} from './schemas';

const UUID = '11111111-1111-4111-8111-111111111111';
const TS = '2026-11-27T10:00:00.000Z';

const LIST = {
  name: '工作',
  color: '#e5484d',
  orderKey: 'a0',
  createdAt: TS,
  updatedAt: TS,
};

const TASK = {
  listId: UUID,
  parentId: null,
  title: '写代码',
  notes: null,
  done: false,
  doneAt: null,
  dueAt: '2026-11-27',
  orderKey: 'a0',
  createdAt: TS,
  updatedAt: TS,
};

const HLC = '1760000000000-00000-dev1';

describe('listDataSchema', () => {
  it('接受合法数据，color 允许 null / 省略', () => {
    expect(listDataSchema.parse(LIST).name).toBe('工作');
    expect(listDataSchema.parse({ ...LIST, color: null }).color).toBeNull();
    expect(listDataSchema.parse({ ...LIST, color: undefined }).color).toBeUndefined();
  });

  it('color 只接受 #RRGGBB', () => {
    for (const color of ['#e5484d', '#ABCDEF', '#000000']) {
      expect(listDataSchema.safeParse({ ...LIST, color }).success).toBe(true);
    }
    for (const color of ['#fff', 'red', 'rgb(0,0,0)', '#gggggg', 'e5484d']) {
      expect(listDataSchema.safeParse({ ...LIST, color }).success).toBe(false);
    }
  });

  it('createdAt / updatedAt 必须是 ISO-8601', () => {
    expect(listDataSchema.safeParse({ ...LIST, createdAt: '2026-11-27' }).success).toBe(false);
    expect(listDataSchema.safeParse({ ...LIST, createdAt: 'not-a-date' }).success).toBe(false);
    expect(listDataSchema.safeParse({ ...LIST, updatedAt: '' }).success).toBe(false);
    expect(
      listDataSchema.safeParse({ ...LIST, createdAt: '2026-11-27T10:00:00+08:00' }).success,
    ).toBe(true);
    expect(listDataSchema.safeParse({ ...LIST, createdAt: '2026-11-27T10:00:00Z' }).success).toBe(
      true,
    );
  });

  it('name 长度上界', () => {
    expect(listDataSchema.safeParse({ ...LIST, name: 'x'.repeat(200) }).success).toBe(true);
    expect(listDataSchema.safeParse({ ...LIST, name: 'x'.repeat(201) }).success).toBe(false);
    expect(listDataSchema.safeParse({ ...LIST, name: '' }).success).toBe(false);
  });
});

describe('taskDataSchema', () => {
  it('接受合法数据', () => {
    const parsed = taskDataSchema.parse(TASK);
    expect(parsed).toEqual(TASK);
  });

  it('dueAt 只接受 YYYY-MM-DD 或 null', () => {
    expect(taskDataSchema.safeParse({ ...TASK, dueAt: null }).success).toBe(true);
    expect(taskDataSchema.safeParse({ ...TASK, dueAt: undefined }).success).toBe(true);
    expect(taskDataSchema.safeParse({ ...TASK, dueAt: '2026-01-01' }).success).toBe(true);
    for (const dueAt of ['2026-1-1', '2026-01-01T00:00:00.000Z', '20260101', '', 'tomorrow']) {
      expect(taskDataSchema.safeParse({ ...TASK, dueAt }).success).toBe(false);
    }
  });

  it('doneAt 只接受 ISO-8601 或 null', () => {
    expect(taskDataSchema.safeParse({ ...TASK, doneAt: null }).success).toBe(true);
    expect(taskDataSchema.safeParse({ ...TASK, doneAt: TS }).success).toBe(true);
    expect(taskDataSchema.safeParse({ ...TASK, doneAt: '2026-01-01' }).success).toBe(false);
    expect(taskDataSchema.safeParse({ ...TASK, doneAt: 'done' }).success).toBe(false);
  });

  it('title / notes 的长度上界', () => {
    expect(taskDataSchema.safeParse({ ...TASK, title: 'x'.repeat(2000) }).success).toBe(true);
    expect(taskDataSchema.safeParse({ ...TASK, title: 'x'.repeat(2001) }).success).toBe(false);
    expect(taskDataSchema.safeParse({ ...TASK, notes: 'x'.repeat(20_000) }).success).toBe(true);
    expect(taskDataSchema.safeParse({ ...TASK, notes: 'x'.repeat(20_001) }).success).toBe(false);
  });

  it('listId / parentId 必须是 uuid', () => {
    expect(taskDataSchema.safeParse({ ...TASK, listId: 'not-a-uuid' }).success).toBe(false);
    expect(taskDataSchema.safeParse({ ...TASK, parentId: 'nope' }).success).toBe(false);
    expect(taskDataSchema.safeParse({ ...TASK, parentId: UUID }).success).toBe(true);
  });

  it('未知字段被 strip 而不是报错', () => {
    const parsed = taskDataSchema.parse({ ...TASK, futureField: 'ignored', another: 1 });
    expect(parsed).not.toHaveProperty('futureField');
    expect(parsed).not.toHaveProperty('another');
  });
});

describe('实体映射与同步负载', () => {
  it('entityDataSchemas 覆盖全部实体', () => {
    expect(Object.keys(entityDataSchemas).sort()).toEqual(['lists', 'tasks']);
    expect(entityDataSchemas.lists).toBe(listDataSchema);
    expect(entityDataSchemas.tasks).toBe(taskDataSchema);
  });

  it('changeSchema 校验 id / hlc / entity', () => {
    const base = { entity: 'tasks', id: UUID, hlc: HLC, deleted: false };
    expect(changeSchema.safeParse(base).success).toBe(true);
    expect(changeSchema.safeParse({ ...base, id: 'x' }).success).toBe(false);
    expect(changeSchema.safeParse({ ...base, hlc: 'bad' }).success).toBe(false);
    expect(changeSchema.safeParse({ ...base, entity: 'notes' }).success).toBe(false);
  });

  it('pushBodySchema 最多 500 条改动', () => {
    const change = { entity: 'lists', id: UUID, hlc: HLC, deleted: true };
    expect(pushBodySchema.safeParse({ changes: Array(500).fill(change) }).success).toBe(true);
    expect(pushBodySchema.safeParse({ changes: Array(501).fill(change) }).success).toBe(false);
  });
});
