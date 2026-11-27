import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { applyLangToDocument, getLang } from './lib/i18n';
import { applyThemeMode, readStoredThemeMode } from './lib/theme';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';

// index.html 的内联脚本已在首屏前套用一次；这里再兜一次，
// 防止内联脚本被禁用或缓存到旧版 HTML 时手动主题 / 语言失效。
applyThemeMode(readStoredThemeMode());
applyLangToDocument(getLang());

// autoUpdate：新版本在后台装好，下次打开即是新版。
// 本机开发/预览不注册 Service Worker：旧缓存会盖住新构建，刷新也看不到改动。
const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
if (!isLocalHost) registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
