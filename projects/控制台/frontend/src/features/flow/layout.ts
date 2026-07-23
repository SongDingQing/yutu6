import type { AgentStation } from '../office/model.js';

export const FLOW_NODE_WIDTH = 180;
export const FLOW_NODE_HEIGHT = 92;

export type FlowLane = 'entry' | 'board' | 'core' | 'project' | 'worker' | 'repair' | 'support';
export type FlowEdgeKind = 'primary' | 'support' | 'return';

export interface FlowNode {
  id: string;
  label: string;
  lane: FlowLane;
  x: number;
  y: number;
  state: AgentStation['state'];
  stateLabel: string;
  task: string;
  avatar: string;
  accent: string;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  kind: FlowEdgeKind;
}

export interface FlowLayout {
  width: number;
  height: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export function buildFlowLayout(stations: AgentStation[]): FlowLayout {
  const nodes: FlowNode[] = [];
  const byId = new Map<string, AgentStation>(stations.map(station => [station.id, station]));
  const secretary = stations.find(station => station.role === 'secretary');
  const ceo = stations.find(station => station.id === 'ceo');
  nodes.push({
    id: 'chairman',
    label: '董事长',
    lane: 'entry',
    x: 70,
    y: 54,
    state: stations.some(station => station.state === 'working') ? 'working' : 'idle',
    stateLabel: stations.some(station => station.state === 'working') ? '关注执行' : '待命',
    task: '发布目标与最终拍板',
    avatar: '/public/assets/avatars/chairman.png',
    accent: '#d6b56d',
  });
  if (secretary) nodes.push(toNode(secretary, 'entry', 330, 54));

  const board = stations.filter(station => station.group === 'board');
  placeRow(nodes, board, 'board', 66, 205, 206);
  if (ceo) nodes.push(toNode(ceo, 'core', 490, 370));

  const isSupervisor = (station: AgentStation) =>
    station.role === 'supervisor' || station.role.endsWith('_supervisor');
  const supervisors = stations.filter(station => station.group === 'project' && isSupervisor(station));
  const workers = stations.filter(station => station.group === 'project' && !isSupervisor(station));
  placeRow(nodes, supervisors, 'project', 110, 530, 260);
  placeRow(nodes, workers, 'worker', 110, 700, 260);

  const repair = stations.filter(station => station.group === 'repair');
  repair.forEach((station, index) => nodes.push(toNode(station, 'repair', 1220, 54 + index * 122)));

  const support = stations.filter(station => station.group === 'collaboration');
  support.forEach((station, index) => {
    nodes.push(toNode(station, 'support', 1190 + (index % 2) * 216, 346 + Math.floor(index / 2) * 118));
  });

  const edges: FlowEdge[] = [];
  const ids = new Set(nodes.map(node => node.id));
  const add = (from: string, to: string, kind: FlowEdgeKind) => {
    if (!ids.has(from) || !ids.has(to) || from === to) return;
    const id = `${from}->${to}:${kind}`;
    if (!edges.some(edge => edge.id === id)) edges.push({ id, from, to, kind });
  };

  if (secretary) add('chairman', secretary.id, 'primary');
  for (const director of board) {
    if (secretary) add(secretary.id, director.id, 'primary');
    if (ceo) add(director.id, ceo.id, 'primary');
  }
  if (secretary && ceo) add(secretary.id, ceo.id, board.length ? 'support' : 'primary');
  for (const supervisor of supervisors) {
    if (ceo) add(ceo.id, supervisor.id, 'primary');
    const projectWorkers = workers.filter(worker =>
      supervisor.projectId ? worker.projectId === supervisor.projectId : !worker.projectId,
    );
    for (const worker of projectWorkers) add(supervisor.id, worker.id, 'primary');
  }
  if (!supervisors.length && ceo) for (const worker of workers) add(ceo.id, worker.id, 'primary');

  const repairLead = repair.find(station => station.id === 'repair-lead');
  const repairWorker = repair.find(station => station.id === 'repair');
  if (secretary && repairLead) add(secretary.id, repairLead.id, 'support');
  if (repairLead && repairWorker) {
    add(repairLead.id, repairWorker.id, 'primary');
    add(repairWorker.id, repairLead.id, 'return');
  }

  const supportPairs = [
    ['hr_manager', 'hr_specialist'],
    ['ui_optimizer', 'gui_desktop_control'],
    ['quality_ops', 'governance'],
  ];
  const pairedTargets = new Set(supportPairs.map(([, target]) => target));
  for (const [from, to] of supportPairs) add(from, to, 'support');
  for (const station of support) {
    if (pairedTargets.has(station.id)) continue;
    if (station.id === 'insight-scout' && secretary) add(secretary.id, station.id, 'support');
    else if (ceo) add(ceo.id, station.id, 'support');
  }
  for (const id of ['governance', 'reasoning_architect', 'quality_ops']) if (ceo && byId.has(id)) add(id, ceo.id, 'return');

  const supportRows = Math.ceil(support.length / 2);
  return {
    width: 1600,
    height: Math.max(860, 386 + supportRows * 118),
    nodes,
    edges,
  };
}

export function nodesOverlap(left: FlowNode, right: FlowNode): boolean {
  return !(
    left.x + FLOW_NODE_WIDTH <= right.x
    || right.x + FLOW_NODE_WIDTH <= left.x
    || left.y + FLOW_NODE_HEIGHT <= right.y
    || right.y + FLOW_NODE_HEIGHT <= left.y
  );
}

function placeRow(
  output: FlowNode[],
  stations: AgentStation[],
  lane: FlowLane,
  startX: number,
  y: number,
  gap: number,
) {
  stations.forEach((station, index) => output.push(toNode(station, lane, startX + index * gap, y)));
}

function toNode(station: AgentStation, lane: FlowLane, x: number, y: number): FlowNode {
  return {
    id: station.id,
    label: station.label,
    lane,
    x,
    y,
    state: station.state,
    stateLabel: station.stateLabel,
    task: station.task,
    avatar: station.avatar,
    accent: station.accent,
  };
}
