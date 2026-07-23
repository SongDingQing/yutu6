import { lazy } from 'react';
import { ModuleBoundary } from './app/ModuleBoundary';
import { WorkspaceShell } from './app/WorkspaceShell';
import { WorkspaceHome } from './features/workspace/WorkspaceHome';

const WorkspaceViews = lazy(() => import('./features/views/WorkspaceViews'));
const ControlRoomView = lazy(() => import('./features/control-room/ControlRoomView'));
const GatewayView = lazy(() => import('./features/gateway/GatewayView'));
const SettingsRoute = lazy(() => import('./features/settings/SettingsRoute'));

const HEAVY_VIEWS = new Set(['office', 'building', 'desks', 'flow', 'usage', 'settings']);

export default function App() {
  const pathView = window.location.pathname === '/control-room'
    ? 'control-room'
    : window.location.pathname === '/api-gateway'
      ? 'gateway'
      : '';
  const requestedView = new URLSearchParams(window.location.search).get('view') || '';
  const view = pathView || (HEAVY_VIEWS.has(requestedView) ? requestedView : '');

  return (
    <WorkspaceShell activeView={view}>
      {(workspace) => view === 'control-room' ? (
        <ModuleBoundary name="控制室">
          <ControlRoomView workspace={workspace} />
        </ModuleBoundary>
      ) : view === 'gateway' ? (
        <ModuleBoundary name="模型池">
          <GatewayView workspace={workspace} />
        </ModuleBoundary>
      ) : view === 'settings' ? (
        <ModuleBoundary name="设置中心">
          <SettingsRoute />
        </ModuleBoundary>
      ) : view ? (
        <ModuleBoundary name={`${view} 视图`}>
          <WorkspaceViews view={view} workspace={workspace} />
        </ModuleBoundary>
      ) : (
        <WorkspaceHome workspace={workspace} />
      )}
    </WorkspaceShell>
  );
}
