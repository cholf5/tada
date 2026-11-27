import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_NAME,
  applyBrandingToHtml,
  buildManifest,
  clearBrandIcon,
  escapeHtml,
  readBrandIcon,
  readBranding,
  resolveBranding,
  saveBrandIcon,
  saveBrandName,
  validateAppName,
  validateIcon,
  type Branding,
} from './branding';
import { makeDb, type SqliteD1 } from './test/sqlite';

const TS = '2026-01-01T00:00:00.000Z';

const HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta name="application-name" content="Tada" />
    <meta name="apple-mobile-web-app-title" content="Tada" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>Tada</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

function samplePng(): Uint8Array {
  return new Uint8Array(Array.from({ length: 256 }, (_, index) => index));
}

describe('实例品牌', () => {
  let db: SqliteD1;

  beforeEach(() => {
    db = makeDb();
  });

  it('没有品牌行时使用 APP_NAME，再缺省 Tada', async () => {
    expect(await readBranding(db)).toBeNull();
    expect(await resolveBranding(db, {})).toEqual({
      appName: DEFAULT_APP_NAME,
      iconVersion: null,
      hasCustomIcon: false,
    });
    expect((await resolveBranding(db, { APP_NAME: '我的待办' })).appName).toBe('我的待办');
  });

  it('改名后对所有读取生效，并保留默认值语义', async () => {
    await saveBrandName(db, '工作台', TS);

    expect((await resolveBranding(db, { APP_NAME: '环境默认' })).appName).toBe('工作台');
    const row = await readBranding(db);
    expect(row).toMatchObject({ appName: '工作台', iconMime: null, updatedAt: TS });
  });

  it('图标 BLOB 往返：写入、读取、保留名字', async () => {
    const png = samplePng();
    const version = await saveBrandIcon(db, png, TS);

    expect(version).toHaveLength(8);
    const icon = await readBrandIcon(db);
    expect(icon?.mime).toBe('image/png');
    expect(icon?.version).toBe(version);
    expect(icon?.bytes).toEqual(png);

    const branding = await resolveBranding(db, {});
    expect(branding).toEqual({
      appName: DEFAULT_APP_NAME,
      iconVersion: version,
      hasCustomIcon: true,
    });

    // 再改名字不会动图标
    await saveBrandName(db, '改名之后', TS);
    expect((await readBrandIcon(db))?.bytes).toEqual(png);
    expect((await resolveBranding(db, {})).appName).toBe('改名之后');
  });

  it('再次上传图标只替换图标，保留已有名字', async () => {
    await saveBrandName(db, '已有名字', TS);
    await saveBrandIcon(db, samplePng(), TS);

    const nextPng = new Uint8Array([1, 2, 3, 4]);
    const nextVersion = await saveBrandIcon(db, nextPng, TS);

    const branding = await resolveBranding(db, {});
    expect(branding.appName).toBe('已有名字');
    expect(branding.iconVersion).toBe(nextVersion);
    expect((await readBrandIcon(db))?.bytes).toEqual(nextPng);
  });

  it('清除图标后回到内置图标分支，名字保持不变', async () => {
    await saveBrandName(db, '保留名字', TS);
    await saveBrandIcon(db, samplePng(), TS);
    await clearBrandIcon(db, TS);

    expect(await readBrandIcon(db)).toBeNull();
    expect(await resolveBranding(db, {})).toEqual({
      appName: '保留名字',
      iconVersion: null,
      hasCustomIcon: false,
    });
  });

  it('manifest 带固定的身份字段，short_name 按 code point 截断', () => {
    const name = '这是一个非常长的中文应用名称超过十二个字';
    const branding: Branding = { appName: name, iconVersion: null, hasCustomIcon: false };
    const manifest = buildManifest(branding) as {
      id: string;
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      icons: Array<{ src: string; purpose?: string }>;
    };

    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.name).toBe(name);
    expect(Array.from(manifest.short_name)).toHaveLength(12);
    expect(manifest.short_name).toBe(Array.from(name).slice(0, 12).join(''));

    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/maskable-512.png',
      '/favicon.svg',
    ]);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('自定义图标的 manifest 两个尺寸指向同一张 PNG', () => {
    const branding: Branding = {
      appName: '我的待办',
      iconVersion: 'abcd1234',
      hasCustomIcon: true,
    };
    const manifest = buildManifest(branding) as {
      icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
    };

    expect(manifest.icons).toEqual([
      {
        src: '/branding/icon-192.png?v=abcd1234',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/branding/icon-512.png?v=abcd1234',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ]);
  });

  it('HTML 只改 title / meta / apple-touch-icon，且转义应用名', () => {
    const branding: Branding = {
      appName: `A & B <C> "D" 'E'`,
      iconVersion: null,
      hasCustomIcon: false,
    };
    const html = applyBrandingToHtml(HTML, branding);

    expect(html).toContain(`<title>A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;</title>`);
    expect(html).toContain(
      `<meta name="application-name" content="A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;" />`,
    );
    expect(html).toContain(
      `<meta name="apple-mobile-web-app-title" content="A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;" />`,
    );
    // 没有自定义图标时保持内置 apple-touch-icon
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    // 其余字节不动
    expect(html).toContain('<body><div id="root"></div></body>');
    expect(html).toContain('<html lang="zh-CN">');
  });

  it('有自定义图标时 apple-touch-icon 指向带版本号的动态图标', () => {
    const branding: Branding = {
      appName: '我的待办',
      iconVersion: 'v1',
      hasCustomIcon: true,
    };
    const html = applyBrandingToHtml(HTML, branding);

    expect(html).toContain(
      '<link rel="apple-touch-icon" href="/branding/icon-192.png?v=v1" />',
    );
    expect(html).toContain(
      '<link rel="icon" type="image/png" href="/branding/icon-192.png?v=v1" />',
    );
  });

  it('escapeHtml 覆盖五个特殊字符', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('应用名校验：trim、长度 1..40 个 code point、拒绝控制字符', () => {
    expect(validateAppName('  工作台  ')).toBe('工作台');
    expect(validateAppName('字'.repeat(40))).toHaveLength(40);

    expect(() => validateAppName('   ')).toThrow();
    expect(() => validateAppName('字'.repeat(41))).toThrow();
    expect(() => validateAppName('换\n行')).toThrow();
    expect(() => validateAppName('制表\t符')).toThrow();
  });

  it('图标校验：只接受 PNG，且解码后不超过 512 KiB', () => {
    expect(() => validateIcon('image/png', new Uint8Array([1]))).not.toThrow();
    expect(() => validateIcon('image/jpeg', new Uint8Array([1]))).toThrow();
    expect(() => validateIcon('image/png', new Uint8Array(0))).toThrow();
    expect(() => validateIcon('image/png', new Uint8Array(512 * 1024))).not.toThrow();
    expect(() => validateIcon('image/png', new Uint8Array(512 * 1024 + 1))).toThrow();
  });
});
