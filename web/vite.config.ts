import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // 由 src/main.tsx 显式调用 registerSW，避免插件再注入一份注册脚本
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        // 身份层：公开后再加/改会被浏览器当成另一个应用
        id: '/',
        name: 'Tada',
        short_name: 'Tada',
        description: '单用户、多端同步、本地优先的待办应用',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // 构建时的静态 manifest 不能进预缓存，否则会盖住 Worker 的动态版本
        globIgnores: ['**/manifest.webmanifest'],
        // vite-plugin-pwa 还会把 manifest 追加到 additionalManifestEntries，
        // 而这一步发生在所有 manifestTransforms 之后；globIgnores 管不到它。
        // 这里给最终数组的 push 加一道过滤，确保静态 manifest 不进预缓存。
        manifestTransforms: [
          (entries) => {
            const manifest = entries.filter(
              (entry) => !entry.url.endsWith('manifest.webmanifest'),
            );
            const push = manifest.push.bind(manifest);
            manifest.push = (...items: typeof manifest) =>
              push(
                ...items.filter(
                  (item) => !item.url.endsWith('manifest.webmanifest'),
                ),
              );
            return { manifest, warnings: [] };
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          // 品牌 manifest 走网络优先，离线时退回最近一次
          {
            urlPattern: /\/manifest\.webmanifest$/,
            handler: 'NetworkFirst',
            options: { cacheName: 'manifest', networkTimeoutSeconds: 3 },
          },
          // 动态图标 URL 带 ?v=，内容不会变，可以放心长期缓存
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/branding/'),
            handler: 'CacheFirst',
            options: { cacheName: 'branding-icons' },
          },
          // 任何 /api 请求都直连网络，不读缓存也不写缓存
          { urlPattern: /\/api\//, handler: 'NetworkOnly' },
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // 把稳定的第三方依赖拆成独立 chunk，避免主 bundle 超过 500 kB 告警
        manualChunks: {
          react: ['react', 'react-dom', 'react/jsx-runtime'],
          dexie: ['dexie'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          zod: ['zod'],
        },
      },
    },
  },
  // 开发时 Vite 跑在 5173，/api 转发给 wrangler dev（默认 8787）
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
