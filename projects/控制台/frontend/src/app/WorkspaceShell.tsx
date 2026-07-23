import type { ReactNode } from 'react';
import { AppHeader } from '../features/workspace/AppHeader';
import { TaskComposer } from '../features/tasks/TaskComposer';
import { useWorkspaceData } from '../hooks/useWorkspaceData';
import type { BulletinCard, WorkspaceCoreSnapshot } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

export interface WorkspaceRenderContext {
  core: WorkspaceCoreSnapshot;
  bulletin: BulletinCard[];
  refreshCore: () => Promise<void>;
  refreshBulletin: () => Promise<void>;
}

interface WorkspaceShellProps {
  activeView?: string;
  children: (workspace: WorkspaceRenderContext) => ReactNode;
}

export function WorkspaceShell({ activeView = '', children }: WorkspaceShellProps) {
  const {
    core,
    bulletin,
    error,
    refreshing,
    lastUpdated,
    refreshAll,
    refreshCore,
    refreshBulletin,
  } = useWorkspaceData();

  return (
    <div className="workspace-app">
      <AppHeader
        activeView={activeView}
        version={core?.version.version}
        updatedAt={lastUpdated}
        refreshing={refreshing}
        onRefresh={() => void refreshAll()}
      />
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {core ? (
        <ErrorBoundary name="工作区内容">
          {children({ core, bulletin, refreshCore, refreshBulletin })}
        </ErrorBoundary>
      ) : <LoadingWorkspace />}
      <ErrorBoundary name="派单框">
        <TaskComposer roles={core?.runners.roles || {}} onSent={() => refreshCore()} />
      </ErrorBoundary>
    </div>
  );
}

function LoadingWorkspace() {
  return (
    <main className="loading-shell" aria-label="正在载入工作区">
      <div className="loading-pane"><div className="loading-line" /><div className="loading-line" /><div className="loading-line" /></div>
      <div className="loading-pane"><div className="loading-line" /><div className="loading-line" /></div>
    </main>
  );
}
