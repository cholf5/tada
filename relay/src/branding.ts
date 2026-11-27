import type { D1Like } from './store';

/* ------------------------------------------------------------------ *
 * 实例品牌：单行表，对所有设备生效
 *
 * 品牌不是关键路径：读失败时调用方可以退回默认值，不能因此让 SPA 打不开。
 * 图标只存一张 512×512 PNG，缩放由浏览器在保存前完成。
 * ------------------------------------------------------------------ */

export const DEFAULT_APP_NAME = 'Tada';
export const DEFAULT_DESCRIPTION = '单用户、多端同步、本地优先的待办应用';
export const MAX_APP_NAME_LENGTH = 40;
export const MAX_ICON_BYTES = 512 * 1024;

/** 对外暴露的品牌状态（不含图标字节） */
export interface Branding {
  appName: string;
  iconVersion: string | null;
  hasCustomIcon: boolean;
}

export interface BrandingRow {
  appName: string;
  iconMime: string | null;
  iconVersion: string | null;
  updatedAt: string;
}

export interface BrandIcon {
  bytes: Uint8Array;
  mime: string;
  version: string;
}

/** resolveBranding 只需要读取 APP_NAME，不依赖完整的 Worker Env */
export interface BrandingEnv {
  APP_NAME?: string;
}

interface RawBrandingRow {
  app_name: string;
  icon_mime: string | null;
  icon_version: string | null;
  updated_at: string;
}

interface RawIconRow {
  icon_mime: string | null;
  icon_version: string | null;
  icon_blob: Uint8Array | ArrayBuffer | number[] | null;
}

export interface ManifestOptions {
  description?: string;
}

/* ------------------------------------------------------------------ *
 * 读取
 * ------------------------------------------------------------------ */

/** 查 id=1 的品牌行；没有行返回 null，由调用方决定默认值。 */
export async function readBranding(db: D1Like): Promise<BrandingRow | null> {
  // 不读 icon_blob：品牌元数据在每次页面 / manifest 请求里都会用到，
  // 不应该顺带把几百 KB 的图标也搬过来。图标字节走 readBrandIcon。
  const row = await db
    .prepare(
      `SELECT app_name, icon_mime, icon_version, updated_at
         FROM branding
        WHERE id = 1`,
    )
    .first<RawBrandingRow>();
  if (!row) return null;

  return {
    appName: row.app_name,
    iconMime: row.icon_mime,
    iconVersion: row.icon_version,
    updatedAt: row.updated_at,
  };
}

/** 有行用行，没有用环境变量 APP_NAME，再缺省 Tada。 */
export async function resolveBranding(db: D1Like, env: BrandingEnv): Promise<Branding> {
  const row = await readBranding(db);
  if (row) {
    return {
      appName: row.appName,
      iconVersion: row.iconVersion,
      hasCustomIcon: row.iconMime !== null && row.iconVersion !== null,
    };
  }

  return {
    appName: env.APP_NAME?.trim() || DEFAULT_APP_NAME,
    iconVersion: null,
    hasCustomIcon: false,
  };
}

/** 图标字节与版本号；没有自定义图标时返回 null。 */
export async function readBrandIcon(db: D1Like): Promise<BrandIcon | null> {
  const row = await db
    .prepare(
      `SELECT icon_mime, icon_version, icon_blob
         FROM branding
        WHERE id = 1`,
    )
    .first<RawIconRow>();
  if (!row || row.icon_mime === null) return null;

  const bytes = normalizeBlob(row.icon_blob);
  if (!bytes) return null;

  return {
    bytes,
    mime: row.icon_mime,
    version: row.icon_version ?? '',
  };
}

/* ------------------------------------------------------------------ *
 * 写入（单行 upsert）
 * ------------------------------------------------------------------ */

export async function saveBrandName(db: D1Like, name: string, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO branding (id, app_name, updated_at)
       VALUES (1, ?1, ?2)
       ON CONFLICT(id) DO UPDATE SET
         app_name = excluded.app_name,
         updated_at = excluded.updated_at`,
    )
    .bind(name, now)
    .run();
}

/** 写入图标并生成新的防缓存版本号；返回版本号。 */
export async function saveBrandIcon(
  db: D1Like,
  png: Uint8Array,
  now: string,
): Promise<string> {
  const version = crypto.randomUUID().slice(0, 8);

  // 首次写入时表里还没有行：路由层会先 saveBrandName 把当前应用名落库，
  // 这里的 Tada 只作为直接调用该函数的兜底。
  await db
    .prepare(
      `INSERT INTO branding (id, app_name, icon_mime, icon_version, icon_blob, updated_at)
       VALUES (1, ?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(id) DO UPDATE SET
         icon_mime = excluded.icon_mime,
         icon_version = excluded.icon_version,
         icon_blob = excluded.icon_blob,
         updated_at = excluded.updated_at`,
    )
    .bind(DEFAULT_APP_NAME, 'image/png', version, png, now)
    .run();

  return version;
}

/** 删除自定义图标，保留应用名。 */
export async function clearBrandIcon(db: D1Like, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO branding (id, app_name, updated_at)
       VALUES (1, ?1, ?2)
       ON CONFLICT(id) DO UPDATE SET
         icon_mime = NULL,
         icon_version = NULL,
         icon_blob = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(DEFAULT_APP_NAME, now)
    .run();
}

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

export function validateAppName(raw: string): string {
  const name = raw.trim();
  const length = Array.from(name).length;

  if (length === 0) throw new Error('应用名称不能为空');
  if (length > MAX_APP_NAME_LENGTH) {
    throw new Error(`应用名称不能超过 ${MAX_APP_NAME_LENGTH} 个字符`);
  }
  // 控制字符（含换行、制表符）会破坏 title / meta，直接拒绝
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    throw new Error('应用名称包含控制字符');
  }

  return name;
}

/** 只接受 PNG；解码后的字节数不能超过 512 KiB。 */
export function validateIcon(mime: string, bytes: Uint8Array): void {
  if (mime !== 'image/png') throw new Error('图标只支持 PNG');
  if (bytes.byteLength === 0) throw new Error('图标内容为空');
  if (bytes.byteLength > MAX_ICON_BYTES) throw new Error('图标不能超过 512 KiB');
}

/* ------------------------------------------------------------------ *
 * PWA manifest
 * ------------------------------------------------------------------ */

export function buildManifest(branding: Branding, opts: ManifestOptions = {}): object {
  const version = branding.iconVersion ?? '';
  const suffix = version ? `?v=${encodeURIComponent(version)}` : '';

  const icons = branding.hasCustomIcon
    ? [
        {
          src: `/branding/icon-192.png${suffix}`,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: `/branding/icon-512.png${suffix}`,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
      ]
    : [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        {
          src: '/icons/maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      ];

  return {
    name: branding.appName,
    // short_name 按 code point 截断，避免把中文（代理对之外的 BMP 字符）
    // 或 emoji 截成半个
    short_name: Array.from(branding.appName).slice(0, 12).join(''),
    description: opts.description ?? DEFAULT_DESCRIPTION,
    lang: 'zh-CN',
    start_url: '/',
    scope: '/',
    // 身份层：必须在首次公开前定死，之后加/改会被浏览器当成另一个应用
    id: '/',
    display: 'standalone',
    theme_color: '#2563eb',
    background_color: '#ffffff',
    icons,
  };
}

/* ------------------------------------------------------------------ *
 * HTML 改写
 *
 * 纯字符串替换：index.html 是我们自己的模板，锚点稳定。
 * 只改 title / 两个 meta / apple-touch-icon，其余字节一律不动。
 * ------------------------------------------------------------------ */

export function applyBrandingToHtml(html: string, branding: Branding): string {
  const name = escapeHtml(branding.appName);
  let result = html;

  result = result.replace(/<title>[\s\S]*?<\/title>/i, `<title>${name}</title>`);
  result = replaceMetaContent(result, 'apple-mobile-web-app-title', branding.appName);
  result = replaceMetaContent(result, 'application-name', branding.appName);

  const iconHref = branding.hasCustomIcon
    ? `/branding/icon-192.png?v=${encodeURIComponent(branding.iconVersion ?? '')}`
    : '/apple-touch-icon.png';
  result = replaceAppleTouchIcon(result, iconHref);

  // 有自定义图标时浏览器标签页也跟着换，避免首屏先闪一下默认图标
  if (branding.hasCustomIcon) {
    result = result.replace(
      /<link\s+rel="icon"[^>]*>/i,
      `<link rel="icon" type="image/png" href="${escapeHtml(iconHref)}" />`,
    );
  }

  return result;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function replaceMetaContent(html: string, name: string, content: string): string {
  const pattern = new RegExp(
    `(<meta\\s+name="${escapeRegExp(name)}"\\s+content=")[^"]*(")`,
    'i',
  );
  return html.replace(
    pattern,
    (_match, prefix: string, suffix: string) =>
      `${prefix}${escapeHtml(content)}${suffix}`,
  );
}

function replaceAppleTouchIcon(html: string, href: string): string {
  const pattern = /(<link\s+rel="apple-touch-icon"\s+href=")[^"]*(")/i;
  return html.replace(
    pattern,
    (_match, prefix: string, suffix: string) => `${prefix}${escapeHtml(href)}${suffix}`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** D1 / node:sqlite 返回 BLOB 的形式并不统一，统一成 Uint8Array。 */
function normalizeBlob(
  value: Uint8Array | ArrayBuffer | number[] | null,
): Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}
