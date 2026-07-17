import { Gauge, LayoutGrid, RefreshCw, Settings2 } from 'lucide-react';
import { formatClock } from '../lib/format';

interface AppHeaderProps {
  version?: string;
  updatedAt: Date | null;
  refreshing: boolean;
  onRefresh: () => void;
}

export function AppHeader({ version, updatedAt, refreshing, onRefresh }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">玉</span>
        <div>
          <strong>玉兔6</strong>
          <span>工作区</span>
        </div>
      </div>

      <nav className="primary-nav" aria-label="主要页面">
        <a href="/control-room"><Gauge size={16} />控制室</a>
        <a href="/api-gateway">API 网关</a>
        <a href="/workspace-legacy" title="打开经典工作区"><LayoutGrid size={16} />经典页</a>
      </nav>

      <div className="header-actions">
        {version ? <span className="version-badge">v{version}</span> : null}
        <span className="updated-at">更新 {updatedAt ? formatClock(updatedAt.toISOString()) : '--:--:--'}</span>
        <button className="icon-button" type="button" onClick={onRefresh} disabled={refreshing} title="刷新工作区" aria-label="刷新工作区">
          <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
        </button>
        <a className="icon-button" href="/workspace-legacy" title="在经典页打开设置中心" aria-label="在经典页打开设置中心">
          <Settings2 size={17} />
        </a>
      </div>
    </header>
  );
}
