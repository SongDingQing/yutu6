import { AppHeader } from './components/AppHeader';
import { OperationalOverview } from './components/OperationalOverview';
import { TaskBoard } from './components/TaskBoard';
import { TaskComposer } from './components/TaskComposer';
import { useWorkspaceData } from './hooks/useWorkspaceData';

export default function App() {
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
        version={core?.version.version}
        updatedAt={lastUpdated}
        refreshing={refreshing}
        onRefresh={() => void refreshAll()}
      />
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      {core ? (
        <main className="workspace-main">
          <OperationalOverview core={core} />
          <TaskBoard
            core={core}
            bulletin={bulletin}
            onRefresh={refreshCore}
            onRefreshBulletin={refreshBulletin}
          />
        </main>
      ) : <LoadingWorkspace />}
      <TaskComposer roles={core?.runners.roles || {}} onSent={() => refreshCore(true)} />
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
