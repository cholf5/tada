import { getLang, translate, type Lang } from './i18n';

/** 本地日期（YYYY-MM-DD），dueAt 统一用这个格式 */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function isOverdue(dueAt: string | null, today: string = todayIso()): boolean {
  return dueAt !== null && dueAt < today;
}

function parts(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * 截止日期 chip 的文案：
 * 中文 今天 / 明天 / 昨天 / 3月8日 / 2027年1月1日
 * 英文 Today / Tomorrow / Yesterday / Mar 8 / Jan 1, 2027
 */
export function formatDue(
  dueAt: string,
  today: string = todayIso(),
  lang: Lang = getLang(),
): string {
  if (dueAt === today) return translate(lang, 'dates.today');
  if (dueAt === shiftIsoDate(today, 1)) return translate(lang, 'dates.tomorrow');
  if (dueAt === shiftIsoDate(today, -1)) return translate(lang, 'dates.yesterday');

  const p = parts(dueAt);
  if (!p) return dueAt;
  const currentYear = Number(today.slice(0, 4));

  if (lang === 'en') {
    return formatEnDate(p.year, p.month, p.day, p.year !== currentYear);
  }
  if (p.year !== currentYear) return `${p.year}年${p.month}月${p.day}日`;
  return `${p.month}月${p.day}日`;
}

/** 英文日期：同年省略年份，保持 chip 紧凑。 */
function formatEnDate(year: number, month: number, day: number, withYear: boolean): string {
  const date = new Date(year, month - 1, day);
  return withYear
    ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatLastSync(iso: string | null, lang: Lang = getLang()): string {
  if (!iso) return translate(lang, 'dates.neverSynced');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return translate(lang, 'dates.neverSynced');
  return date.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
