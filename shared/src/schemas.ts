import { z } from 'zod';
import { ENTITIES } from './entities';
import { HLC_RE } from './hlc';
import { LIMITS } from './limits';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 客户端写出的时间戳：`new Date().toISOString()` */
export const ISO_DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** 客户端写出的截止日期：`<input type="date">` 的 YYYY-MM-DD */
export const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** web 的列表色板只写 #RRGGBB；颜色是可选字段，null 表示跟随主题 */
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const isoDateTime = z.string().regex(ISO_DATE_TIME_RE, 'must be an ISO-8601 date-time');
const isoDay = z.string().regex(ISO_DAY_RE, 'must be YYYY-MM-DD');

/**
 * 校验原则：只增不减。
 * 未声明字段会被 strip 而不是报错，所以加字段不会打死旧客户端。
 */

export const listDataSchema = z.object({
  name: z.string().min(1).max(LIMITS.listName),
  color: z.string().regex(HEX_COLOR_RE, 'color must be #RRGGBB').nullish(),
  orderKey: z.string().min(1).max(500),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const taskDataSchema = z.object({
  listId: z.string().regex(UUID_RE, 'listId must be a uuid'),
  parentId: z.string().regex(UUID_RE, 'parentId must be a uuid').nullish(),
  title: z.string().min(1).max(LIMITS.taskTitle),
  notes: z.string().max(LIMITS.taskNotes).nullish(),
  done: z.boolean(),
  doneAt: isoDateTime.nullish(),
  dueAt: isoDay.nullish(),
  orderKey: z.string().min(1).max(500),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const entityDataSchemas = {
  lists: listDataSchema,
  tasks: taskDataSchema,
} as const;

export const changeSchema = z.object({
  entity: z.enum(ENTITIES),
  id: z.string().regex(UUID_RE, 'id must be a uuid'),
  hlc: z.string().regex(HLC_RE, 'invalid hlc'),
  deleted: z.boolean(),
  data: z.unknown().optional(),
});

export const pushBodySchema = z.object({
  changes: z.array(changeSchema).max(500),
});
