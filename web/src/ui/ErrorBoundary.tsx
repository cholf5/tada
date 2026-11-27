import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getCachedBranding } from '../lib/branding';
import { subscribeLang, t } from '../lib/i18n';

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 渲染错误的最后一道兜底。
 *
 * React 在渲染阶段抛错会卸载整棵树；没有边界时用户只会看到白屏。
 * 这里保留一个可读页面和「重新加载」入口。本地数据在 IndexedDB 里，
 * 不会因为界面崩溃而丢失。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  private unsubscribeLang: (() => void) | null = null;

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidMount(): void {
    // class 组件用不了 hook：语言切换时手动重渲染兜底页
    this.unsubscribeLang = subscribeLang(() => this.forceUpdate());
  }

  componentWillUnmount(): void {
    this.unsubscribeLang?.();
    this.unsubscribeLang = null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[tada] 界面渲染失败', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    // class 组件不能用 hook；缓存读取是同步且安全的
    return (
      <div className="splash">
        <div className="brand">{getCachedBranding().appName}</div>
        <p className="splash-title">{t('errors.boundaryTitle')}</p>
        <p className="splash-hint">{t('errors.boundaryHint')}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          {t('common.reload')}
        </button>
      </div>
    );
  }
}
