import { Component, type ErrorInfo, type ReactNode } from 'react';

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

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[tada] 界面渲染失败', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="splash">
        <div className="brand">Tada</div>
        <p className="splash-title">界面遇到了一点问题</p>
        <p className="splash-hint">
          本地数据仍然保存在这台设备上。重新加载通常就能恢复；如果反复出现，请重新加载后到设置导出一份备份再反馈。
        </p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    );
  }
}
