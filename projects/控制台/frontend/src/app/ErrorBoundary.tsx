import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  name: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] render failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="module-state module-state-error" role="alert">
        <strong>{this.props.name}暂时不可用</strong>
        <p>其他模块仍可继续使用。可以重试本模块，或回到经典页核对。</p>
        <div>
          <button type="button" onClick={() => this.setState({ error: null })}>重试模块</button>
          <a href="/workspace-legacy">打开经典页</a>
        </div>
      </section>
    );
  }
}
