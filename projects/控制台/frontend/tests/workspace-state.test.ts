import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkspaceBootstrap } from '../src/lib/api.js';
import {
  initialWorkspaceState,
  reduceWorkspaceState,
} from '../src/store/workspaceState.js';

test('snapshot normalizes workspace entities and adopts the server cursor', () => {
  const state = reduceWorkspaceState(initialWorkspaceState, {
    type: 'snapshot.loaded',
    result: bootstrap(),
  });
  assert.equal(state.cursor, 10);
  assert.equal(state.revision, 'revision-10');
  assert.equal(state.entities.tasks['task-1'].status, 'running');
  assert.equal(state.entities.queues.ceo.queued[0].id, 'queue-1');
  assert.equal(state.entities.runners.secretary.label, '秘书');
  assert.equal(state.entities.bulletin['card-1'].status, 'todo');
  assert.equal(state.connection, 'live');
});

test('duplicate and out-of-order structured events are applied once in sequence', () => {
  const base = reduceWorkspaceState(initialWorkspaceState, {
    type: 'snapshot.loaded',
    result: bootstrap(),
  });
  const state = reduceWorkspaceState(base, {
    type: 'events.received',
    lastSeq: 12,
    events: [
      {
        seq: 12,
        type: 'task.remove',
        taskId: 'task-2',
      },
      {
        seq: 11,
        type: 'task.upsert',
        task: { id: 'task-2', status: 'queued', task: 'second task' },
      },
      {
        seq: 11,
        type: 'task.upsert',
        task: { id: 'task-2', status: 'queued', task: 'duplicate' },
      },
    ],
  });
  assert.equal(state.cursor, 12);
  assert.equal(state.entities.tasks['task-2'], undefined);
  assert.equal(state.needsResync, false);
});

test('an event sequence gap requests a snapshot without advancing the cursor', () => {
  const base = reduceWorkspaceState(initialWorkspaceState, {
    type: 'snapshot.loaded',
    result: bootstrap(),
  });
  const state = reduceWorkspaceState(base, {
    type: 'events.received',
    lastSeq: 14,
    events: [{ seq: 14, type: 'task.remove', taskId: 'task-1' }],
  });
  assert.equal(state.cursor, 10);
  assert.equal(state.needsResync, true);
  assert.equal(state.connection, 'resyncing');
  assert.match(state.warning, /事件序号出现缺口/);
});

test('legacy engine events trigger a revision resync instead of guessing fields', () => {
  const base = reduceWorkspaceState(initialWorkspaceState, {
    type: 'snapshot.loaded',
    result: bootstrap(),
  });
  const state = reduceWorkspaceState(base, {
    type: 'events.received',
    lastSeq: 11,
    events: [{ seq: 11, type: 'node.end', task: 'task-1', node: 'implement' }],
  });
  assert.equal(state.cursor, 11);
  assert.equal(state.needsResync, true);
  assert.deepEqual(state.dirtyDomains, ['tasks', 'queues']);
});

function bootstrap(): WorkspaceBootstrap {
  return {
    source: 'snapshot',
    unchanged: false,
    core: {
      revision: 'revision-10',
      lastSeq: 10,
      generatedAt: '2026-07-17T00:00:00.000Z',
      issues: {},
      runners: {
        schemaVersion: 1,
        roles: {
          secretary: { label: '秘书', runner: 'codex', status: 'active' },
        },
        queueAgents: [{ id: 'ceo', role: 'orchestrator', label: 'CEO', projectId: null }],
        runners: [{ id: 'codex', label: 'Codex', status: 'active' }],
      },
      queues: {
        schemaVersion: 1,
        ok: true,
        queueAgents: [{ id: 'ceo', role: 'orchestrator', label: 'CEO', projectId: null }],
        queues: {
          ceo: {
            agent: 'ceo',
            queued: [{ id: 'queue-1', status: 'queued', task: { goal: 'test' } }],
            running: [],
            paused: [],
            done: 0,
            failed: 0,
            canceled: 0,
          },
        },
      },
      taskBoard: {
        schemaVersion: 1,
        ok: true,
        tasks: [{ id: 'task-1', status: 'running', task: 'test' }],
        history: [],
      },
      version: {
        schemaVersion: 1,
        ok: true,
        version: '0.0.1',
      },
    },
    bulletin: {
      schemaVersion: 1,
      ok: true,
      cards: [{ id: 'card-1', title: 'todo', status: 'todo' }],
    },
  };
}
