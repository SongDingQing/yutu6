import { Armchair, Building2, ChartNoAxesCombined, Gauge, LayoutGrid, RefreshCw, Settings2 } from 'lucide-react';
import { formatClock } from '../../lib/format';

interface AppHeaderProps {
  activeView?: string;
  version?: string;
  updatedAt: Date | null;
  refreshing: boolean;
  onRefresh: () => void;
}

export function AppHeader({ activeView = '', version, updatedAt, refreshing, onRefresh }: AppHeaderProps) {
  const workspaceBase = window.location.pathname.includes('workspace-next') ? '/workspace-next' : '/workspace';
  return (
    <header className="app-header">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">
          <span className="brand-fallback">玉</span>
          <img
            src="/app/assets/brand/yutu6-rabbit-icon-64.png"
            alt=""
            onError={(event) => { event.currentTarget.hidden = true; }}
          />
        </span>
        <div className="brand-copy">
          <strong>玉兔6</strong>
          <span>工作区</span>
        </div>
      </div>

      <nav className="primary-nav" aria-label="主要页面">
        <a className={!activeView ? 'active' : ''} href={workspaceBase}>概览</a>
        <a className={activeView === 'office' ? 'active' : ''} href={`${workspaceBase}?view=office`}><LayoutGrid size={16} />办公室</a>
        <a className={activeView === 'building' ? 'active' : ''} href={`${workspaceBase}?view=building`}><Building2 size={16} />办公楼</a>
        <a className={activeView === 'desks' ? 'active' : ''} href={`${workspaceBase}?view=desks`}><Armchair size={16} />工位</a>
        <a className={activeView === 'flow' ? 'active' : ''} href={`${workspaceBase}?view=flow`}>链路图</a>
        <a className={activeView === 'usage' ? 'active' : ''} href={`${workspaceBase}?view=usage`}><ChartNoAxesCombined size={16} />模型用量</a>
        <a className={activeView === 'control-room' ? 'active' : ''} href="/control-room"><Gauge size={16} />控制室</a>
        <a className={activeView === 'gateway' ? 'active' : ''} href="/api-gateway">模型池</a>
      </nav>

      <div className="header-actions">
        {version ? <span className="version-badge">v{version}</span> : null}
        <span className="updated-at">更新 {updatedAt ? formatClock(updatedAt.toISOString()) : '--:--:--'}</span>
        <button className="icon-button" type="button" onClick={onRefresh} disabled={refreshing} title="刷新工作区" aria-label="刷新工作区">
          <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
        </button>
        <a className={`icon-button ${activeView === 'settings' ? 'active' : ''}`} href={`${workspaceBase}?view=settings`} title="打开设置中心" aria-label="打开设置中心">
          <Settings2 size={17} />
        </a>
      </div>
    </header>
  );
}
