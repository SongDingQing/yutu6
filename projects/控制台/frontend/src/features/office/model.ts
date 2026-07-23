import { queueEntryTime, taskPresentation, taskText } from '../../lib/format.js';
import type { QueueAgent, QueueEntry, WorkspaceCoreSnapshot } from '../../types.js';

export type AgentVisualState = 'working' | 'queued' | 'idle';
export type AgentGroup = 'executive' | 'board' | 'project' | 'repair' | 'collaboration';
export type OfficeMode = 'office' | 'building' | 'desks';
export type BuildingState = 'handoff' | 'typing' | 'reading';

export interface AgentStation {
  id: string;
  role: string;
  label: string;
  projectId?: string | null;
  group: AgentGroup;
  state: AgentVisualState;
  stateLabel: string;
  task: string;
  since?: string;
  runner?: string;
  sprite: string;
  avatar: string;
  accent: string;
}

const ASSET_ROOT = '/public/office-demo-assets';
const AVATAR_ROOT = '/public/assets/avatars';

export function buildAgentStations(core: WorkspaceCoreSnapshot): AgentStation[] {
  const agents = canonicalQueueAgents(core);
  return agents.map(agent => {
    const queue = core.queues.queues[agent.id];
    const running = queue?.running?.[0];
    const queued = queue?.queued?.[0] || queue?.paused?.[0];
    const entry = running || queued;
    const state: AgentVisualState = running ? 'working' : queued ? 'queued' : 'idle';
    const roleConfig = core.runners.roles[agent.role] || core.runners.roles[agent.id];
    const task = entry ? taskPresentation(taskText(entry.task), 52, 100).title : '';
    return {
      id: agent.id,
      role: agent.role,
      label: cleanAgentLabel(agent.label || roleConfig?.label || agent.id),
      projectId: agent.projectId,
      group: classifyAgent(agent),
      state,
      stateLabel: state === 'working' ? '工作中' : state === 'queued' ? '等待中' : '空闲',
      task,
      since: entry ? queueEntryTime(entry) : undefined,
      runner: roleConfig?.runner,
      sprite: stationSprite(agent, state),
      avatar: stationAvatar(agent),
      accent: stationAccent(agent),
    };
  });
}

export function deriveBuildingState(core: WorkspaceCoreSnapshot, now = Date.now()): BuildingState {
  const recentDispatch = (core.taskBoard.tasks || []).some(task => {
    if (task.status !== 'queued' && task.status !== 'paused') return false;
    const timestamp = Date.parse(task.enqueued_at || '') || 0;
    return timestamp > 0 && now - timestamp <= 9_000;
  });
  if (recentDispatch) return 'handoff';
  const hasRunning = Object.values(core.queues.queues || {})
    .some(queue => (queue.running?.length || 0) > 0);
  return hasRunning ? 'typing' : 'reading';
}

export function buildingScene(state: BuildingState) {
  if (state === 'handoff') {
    return {
      image: `${ASSET_ROOT}/office-building-handoff.gif`,
      label: '交接文件',
      description: '新任务已发布，董事长与秘书正在交接文件',
    };
  }
  if (state === 'typing') {
    return {
      image: `${ASSET_ROOT}/office-building-typing.gif`,
      label: '打字办公',
      description: '团队有任务正在执行，董事长进入办公状态',
    };
  }
  return {
    image: `${ASSET_ROOT}/office-building-reading.gif`,
    label: '看书',
    description: '当前没有运行中的任务，董事长在办公室看书',
  };
}

function canonicalQueueAgents(core: WorkspaceCoreSnapshot): QueueAgent[] {
  const active = (id: string) => {
    const queue = core.queues.queues[id];
    return Boolean(queue && ((queue.running?.length || 0) + (queue.queued?.length || 0) + (queue.paused?.length || 0)));
  };
  const sorted = [...(core.runners.queueAgents || [])].sort((left, right) => {
    const leftCanonical = left.id === left.role ? 0 : 1;
    const rightCanonical = right.id === right.role ? 0 : 1;
    return leftCanonical - rightCanonical;
  });
  const seen = new Set<string>();
  return sorted.filter(agent => {
    const roleConfig = core.runners.roles[agent.role] || core.runners.roles[agent.id];
    if (!roleConfig && !agent.projectId && !active(agent.id)) return false;
    const key = `${agent.role}:${agent.projectId || ''}`;
    if (seen.has(key) && !active(agent.id)) return false;
    seen.add(key);
    return true;
  });
}

function classifyAgent(agent: QueueAgent): AgentGroup {
  const id = agent.id;
  if (id === 'secretary' || id === 'ceo') return 'executive';
  if (id.startsWith('board_') || agent.role.startsWith('board_')) return 'board';
  if (id === 'repair' || id === 'repair-lead' || agent.role === 'repair') return 'repair';
  if (agent.projectId) return 'project';
  if (id.startsWith('supervisor-')
    || agent.role === 'supervisor'
    || ['worker_code', 'worker_narrow', 'frontend_designer'].includes(agent.role)) return 'project';
  return 'collaboration';
}

function stationSprite(agent: QueueAgent, state: AgentVisualState): string {
  const working = state === 'working';
  const role = agent.role;
  if (role === 'secretary') return `${ASSET_ROOT}/sprite-seated-secretary-${working ? 'working.webp' : 'idle.png'}`;
  if (agent.id === 'ceo' || role === 'orchestrator') return `${ASSET_ROOT}/sprite-seated-ceo-${working ? 'working.webp' : 'idle.png'}`;
  if (role === 'supervisor' || role.endsWith('_supervisor')) return `${ASSET_ROOT}/sprite-seated-supervisor-${working ? 'working.webp' : 'idle.png'}`;
  if (role === 'worker_code' || role === 'frontend_designer' || role.endsWith('_programmer')) return `${ASSET_ROOT}/sprite-seated-worker-${working ? 'working-clean.webp' : 'idle-clean.png'}`;
  if (role === 'worker_narrow') return `${ASSET_ROOT}/sprite-seated-outsourcer-${working ? 'working-clean.webp' : 'idle-clean.png'}`;
  return `${ASSET_ROOT}/sprite-seated-edge-${working ? 'working-clean.webp' : 'idle-clean.png'}`;
}

function stationAvatar(agent: QueueAgent): string {
  const known = new Set([
    'secretary', 'reasoning_architect', 'quality_ops', 'governance',
    'gui_desktop_control', 'ui_optimizer', 'hermes',
  ]);
  let id = agent.role;
  if (agent.id === 'ceo') id = 'ceo';
  else if (agent.role === 'supervisor' || agent.role.endsWith('_supervisor')) id = 'supervisor';
  else if (agent.role === 'frontend_designer' || agent.role.endsWith('_programmer')) id = 'worker_code';
  else if (agent.role.startsWith('board_')) id = 'governance';
  else if (agent.role === 'repair' || agent.id === 'repair-lead') id = 'reasoning_architect';
  else if (!known.has(id) && !['worker_code', 'worker_narrow'].includes(id)) id = 'dev_worker';
  return `${AVATAR_ROOT}/${id}.png`;
}

function stationAccent(agent: QueueAgent): string {
  if (agent.id === 'secretary') return '#7dd3fc';
  if (agent.id === 'ceo') return '#9c8cff';
  if (agent.id.startsWith('board_')) return '#d6b56d';
  if (agent.id.startsWith('repair')) return '#fb923c';
  if (agent.role === 'worker_code' || agent.role === 'frontend_designer' || agent.role.endsWith('_programmer')) return '#52d49c';
  if (agent.role.endsWith('_supervisor')) return '#6ea8fe';
  if (agent.role === 'worker_narrow') return '#59c7c0';
  if (agent.role === 'quality_ops') return '#e3b65f';
  return '#6ea8fe';
}

function cleanAgentLabel(label: string) {
  return label
    .replace(/\s*\/\s*(Codex|GLM-5\.2|GLM|Codex 特权).*$/i, '')
    .replace(/\s*\((Codex|GLM)\)\s*$/i, '')
    .trim();
}

export function activeEntry(core: WorkspaceCoreSnapshot, id: string): QueueEntry | undefined {
  const queue = core.queues.queues[id];
  return queue?.running?.[0] || queue?.queued?.[0] || queue?.paused?.[0];
}
