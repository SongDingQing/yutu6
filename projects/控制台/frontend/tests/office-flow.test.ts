import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFlowLayout, nodesOverlap } from '../src/features/flow/layout.js';
import {
  buildAgentStations,
  deriveBuildingState,
  type AgentGroup,
  type AgentStation,
} from '../src/features/office/model.js';
import type { WorkspaceCoreSnapshot } from '../src/types.js';

test('flow layout keeps 25 stations separated and preserves the main chain', () => {
  const stations: AgentStation[] = [
    station('secretary', 'secretary', 'executive'),
    station('ceo', 'orchestrator', 'executive'),
    ...Array.from({ length: 4 }, (_, index) => station(`board_${index}`, `board_${index}`, 'board')),
    station('supervisor-a', 'supervisor', 'project', 'A'),
    station('supervisor-b', 'supervisor', 'project', 'B'),
    station('worker_code', 'worker_code', 'project', 'A'),
    station('worker_narrow', 'worker_narrow', 'project'),
    station('frontend_designer', 'frontend_designer', 'project'),
    station('repair-lead', 'repair-lead', 'repair'),
    station('repair', 'repair', 'repair'),
    ...Array.from({ length: 12 }, (_, index) => station(`support_${index}`, `support_${index}`, 'collaboration')),
  ];
  const layout = buildFlowLayout(stations);
  assert.equal(layout.nodes.length, 26);
  for (let left = 0; left < layout.nodes.length; left += 1) {
    for (let right = left + 1; right < layout.nodes.length; right += 1) {
      assert.equal(nodesOverlap(layout.nodes[left], layout.nodes[right]), false, `${layout.nodes[left].id} overlaps ${layout.nodes[right].id}`);
    }
  }
  assert(layout.edges.some(edge => edge.from === 'chairman' && edge.to === 'secretary'));
  assert(layout.edges.some(edge => edge.from === 'secretary' && edge.to === 'board_0'));
  assert(layout.edges.some(edge => edge.from === 'board_0' && edge.to === 'ceo'));
  assert(layout.edges.some(edge => edge.from === 'ceo' && edge.to === 'supervisor-a'));
  assert(layout.edges.some(edge => edge.from === 'supervisor-a' && edge.to === 'worker_code'));
});

test('office state uses current queue truth and suppresses idle duplicate agents', () => {
  const now = Date.parse('2026-07-17T08:00:00.000Z');
  const core = coreFixture();
  core.taskBoard.tasks = [{
    id: 'task-new',
    status: 'queued',
    enqueued_at: '2026-07-17T07:59:55.000Z',
  }];
  assert.equal(deriveBuildingState(core, now), 'handoff');
  core.taskBoard.tasks = [];
  core.queues.queues.ceo.running = [{ id: 'run-1', status: 'running', task: { goal: '真实运行任务' } }];
  assert.equal(deriveBuildingState(core, now), 'typing');
  const stations = buildAgentStations(core);
  assert.equal(stations.filter(item => item.role === 'memory_officer').length, 1);
  assert.equal(stations.find(item => item.id === 'ceo')?.state, 'working');
  core.queues.queues.ceo.running = [];
  assert.equal(deriveBuildingState(core, now), 'reading');
});

function station(
  id: string,
  role: string,
  group: AgentGroup,
  projectId?: string,
): AgentStation {
  return {
    id,
    role,
    label: id,
    group,
    projectId,
    state: 'idle',
    stateLabel: '空闲',
    task: '',
    avatar: '/avatar.png',
    sprite: '/sprite.png',
    accent: '#6ea8fe',
  };
}

function coreFixture(): WorkspaceCoreSnapshot {
  return {
    runners: {
      schemaVersion: 1,
      roles: {
        orchestrator: { label: 'CEO', status: 'active', runner: 'codex' },
        memory_officer: { label: '记忆官', status: 'active', runner: 'codex' },
      },
      runners: [],
      queueAgents: [
        { id: 'ceo', role: 'orchestrator', label: 'CEO' },
        { id: 'memory_officer', role: 'memory_officer', label: '记忆官' },
        { id: 'memory-officer', role: 'memory_officer', label: '记忆官副本' },
      ],
    },
    queues: {
      schemaVersion: 1,
      ok: true,
      queueAgents: [],
      queues: {
        ceo: { queued: [], running: [], paused: [], done: 0, failed: 0, canceled: 0 },
        memory_officer: { queued: [], running: [], paused: [], done: 0, failed: 0, canceled: 0 },
        'memory-officer': { queued: [], running: [], paused: [], done: 0, failed: 0, canceled: 0 },
      },
    },
    taskBoard: {
      schemaVersion: 1,
      ok: true,
      tasks: [],
      history: [],
    },
    version: {
      schemaVersion: 1,
      ok: true,
      version: '0.0.0',
    },
    issues: {},
  };
}
