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
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // 任何 /api 请求都直连网络，不读缓存也不写缓存
        runtimeCaching: [{ urlPattern: /\/api\//, handler: 'NetworkOnly' }],
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
