/**
 * 输入长度上限：`@tada/shared` 的 zod schema、web 的 `<input maxLength>` 与
 * repo 层防御共用同一组数字。
 *
 * 任何一侧单独放宽都会让另一侧产生「本地能写、推送被 400 拒绝」的毒丸数据，
 * 所以这里只允许改这一个地方。
 */
export const LIMITS = {
  listName: 200,
  taskTitle: 2000,
  taskNotes: 20_000,
} as const;
