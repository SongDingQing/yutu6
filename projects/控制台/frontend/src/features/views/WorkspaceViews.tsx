import { lazy } from 'react';
import { ModuleBoundary } from '../../app/ModuleBoundary';
import type { WorkspaceRenderContext } from '../../app/WorkspaceShell';

const OfficeView = lazy(() => import('../office/OfficeView'));
const FlowView = lazy(() => import('../flow/FlowView'));
const UsageView = lazy(() => import('../usage/UsageView'));

export interface WorkspaceViewsProps {
  view: string;
  workspace: WorkspaceRenderContext;
}

export default function WorkspaceViews({ view, workspace }: WorkspaceViewsProps) {
  const officeMode = view === 'building' ? 'building' : view === 'desks' ? 'desks' : 'office';
  return (
    <main className="heavy-view-shell">
      <ModuleBoundary name={view === 'flow' ? '链路图' : view === 'usage' ? '模型用量' : '办公室视图'}>
        {view === 'flow' ? <FlowView workspace={workspace} /> : null}
        {view === 'usage' ? <UsageView workspace={workspace} /> : null}
        {!['flow', 'usage'].includes(view) ? <OfficeView mode={officeMode} workspace={workspace} /> : null}
      </ModuleBoundary>
    </main>
  );
}
