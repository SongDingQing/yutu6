import { ErrorBoundary } from '../../app/ErrorBoundary';
import type { WorkspaceRenderContext } from '../../app/WorkspaceShell';
import { TaskBoard } from '../tasks/TaskBoard';
import { OperationalOverview } from './OperationalOverview';

export function WorkspaceHome({ workspace }: { workspace: WorkspaceRenderContext }) {
  return (
    <main className="workspace-main">
      <ErrorBoundary name="团队概览">
        <OperationalOverview core={workspace.core} />
      </ErrorBoundary>
      <ErrorBoundary name="任务板">
        <TaskBoard
          core={workspace.core}
          bulletin={workspace.bulletin}
          onRefresh={workspace.refreshCore}
          onRefreshBulletin={workspace.refreshBulletin}
        />
      </ErrorBoundary>
    </main>
  );
}
