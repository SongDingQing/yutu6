import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ContractError,
  decodeBulletinResponse,
  decodeCeoTaskBoardResponse,
  decodeEventsResponse,
  decodeQueuesOverviewResponse,
  decodeRunnersResponse,
  decodeVersionResponse,
  decodeWorkspaceSnapshotResponse,
} from '../src/contracts/index.js';
import { fetchWorkspaceBootstrap, fetchWorkspaceCore } from '../src/lib/api.js';
import type { WorkspaceCoreSnapshot } from '../src/types.js';

test('legacy responses decode as schema v1 and preserve unknown fields', () => {
  const runners = decodeRunnersResponse(runnersPayload());
  const queues = decodeQueuesOverviewResponse(queuesPayload());
  const taskBoard = decodeCeoTaskBoardResponse(taskBoardPayload());
  const bulletin = decodeBulletinResponse(bulletinPayload());
  const version = decodeVersionResponse(versionPayload());
  const events = decodeEventsResponse(eventsPayload());

  assert.equal(runners.schemaVersion, 1);
  assert.equal(runners.roles.secretary.status, 'active');
  assert.equal(runners.extraTopLevel, 'kept');
  assert.equal(runners.roles.secretary.extraRoleField, 'kept');
  assert.equal(queues.schemaVersion, 1);
  assert.equal(queues.queues.ceo.queued[0].status, 'queued');
  assert.equal(queues.queues.ceo.queued[0].error, undefined);
  assert.equal(taskBoard.schemaVersion, 1);
  assert.equal(taskBoard.tasks[0].downstream, undefined);
  assert.equal(taskBoard.tasks[0].nodes?.[0].status, 'running');
  assert.equal(bulletin.schemaVersion, 1);
  assert.equal(bulletin.cards[0].status, 'todo');
  assert.equal(version.version, '0.0.1');
  assert.equal(events.lastSeq, 3);
});

test('missing required fields produce a path-aware contract error', () => {
  assert.throws(
    () => decodeRunnersResponse({ roles: {} }),
    (error: unknown) => {
      assert(error instanceof ContractError);
      assert.equal(error.code, 'missing_field');
      assert.equal(error.path, '/api/runners.queueAgents');
      return true;
    },
  );
});

test('invalid task status is rejected without echoing its value', () => {
  const payload = taskBoardPayload();
  payload.tasks[0].status = 'do-not-echo-this-value';
  assert.throws(
    () => decodeCeoTaskBoardResponse(payload),
    (error: unknown) => {
      assert(error instanceof ContractError);
      assert.equal(error.code, 'invalid_enum');
      assert.equal(error.path, '/api/task-board/ceo.tasks[0].status');
      assert(!error.message.includes('do-not-echo-this-value'));
      return true;
    },
  );
});

test('unsupported explicit schema version is rejected', () => {
  assert.throws(
    () => decodeVersionResponse({ ...versionPayload(), schemaVersion: 2 }),
    (error: unknown) => {
      assert(error instanceof ContractError);
      assert.equal(error.code, 'unsupported_version');
      assert.equal(error.path, '/api/version.schemaVersion');
      return true;
    },
  );
});

test('workspace snapshot decodes all modules with revision metadata', () => {
  const snapshot = decodeWorkspaceSnapshotResponse(snapshotPayload());
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.revision, 'revision-1');
  assert.equal(snapshot.lastSeq, 42);
  assert.equal(snapshot.runners.roles.secretary.label, '秘书');
  assert.equal(snapshot.queues.queues.ceo.queued[0].id, 'queue-1');
  assert.equal(snapshot.taskBoard.tasks[0].id, 'task-1');
  assert.equal(snapshot.bulletin.cards[0].id, 'card-1');
  assert.equal(snapshot.version.version, '0.0.1');
});

test('workspace snapshot reuses the prior state on an ETag 304', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify(snapshotPayload()), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ETag: '"revision-1"',
        },
      });
    }
    assert.equal(new Headers(init?.headers).get('If-None-Match'), '"revision-1"');
    return new Response(null, { status: 304, headers: { ETag: '"revision-1"' } });
  }) as typeof fetch;
  try {
    const first = await fetchWorkspaceBootstrap();
    const second = await fetchWorkspaceBootstrap({
      core: first.core,
      bulletin: first.bulletin,
    });
    assert.equal(first.source, 'snapshot');
    assert.equal(second.unchanged, true);
    assert.strictEqual(second.core, first.core);
    assert.strictEqual(second.bulletin, first.bulletin);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('one broken core module degrades locally and keeps the dispatch roles usable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockWorkspaceFetch({ breakQueues: true });
  try {
    const snapshot = await fetchWorkspaceCore();
    assert.equal(snapshot.runners.roles.secretary.label, '秘书');
    assert.equal(snapshot.taskBoard.tasks[0].id, 'task-1');
    assert.equal(snapshot.version.version, '0.0.1');
    assert.deepEqual(snapshot.queues.queues, {});
    assert.equal(snapshot.issues.queues?.code, 'invalid_enum');
    assert.equal(snapshot.issues.queues?.stale, false);
    assert.equal(snapshot.issues.runners, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a broken refresh retains the previous valid module and marks it stale', async () => {
  const previous = validSnapshot();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockWorkspaceFetch({ breakQueues: true });
  try {
    const snapshot = await fetchWorkspaceCore(previous);
    assert.strictEqual(snapshot.queues, previous.queues);
    assert.equal(snapshot.issues.queues?.stale, true);
    assert.match(snapshot.issues.queues?.message || '', /上次有效数据/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function validSnapshot(): WorkspaceCoreSnapshot {
  return {
    runners: decodeRunnersResponse(runnersPayload()),
    queues: decodeQueuesOverviewResponse(queuesPayload()),
    taskBoard: decodeCeoTaskBoardResponse(taskBoardPayload()),
    version: decodeVersionResponse(versionPayload()),
    issues: {},
  };
}

function mockWorkspaceFetch(options: { breakQueues: boolean }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/runners') return jsonResponse(runnersPayload());
    if (path === '/api/queues/overview') {
      const payload = queuesPayload();
      if (options.breakQueues) payload.queues.ceo.queued[0].status = 'broken-state';
      return jsonResponse(payload);
    }
    if (path === '/api/task-board/ceo') return jsonResponse(taskBoardPayload());
    if (path === '/api/version') return jsonResponse(versionPayload());
    return jsonResponse({ ok: false, error: 'unexpected test path' }, 404);
  }) as typeof fetch;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function runnersPayload() {
  return {
    extraTopLevel: 'kept',
    roles: {
      secretary: {
        label: '秘书',
        runner: 'codex',
        extraRoleField: 'kept',
      },
    },
    queueAgents: [
      {
        id: 'ceo',
        role: 'orchestrator',
        projectId: null,
        label: 'CEO(总指挥)',
      },
    ],
    runners: [
      {
        id: 'codex',
        label: 'Codex',
      },
    ],
  };
}

function queuesPayload() {
  return {
    ok: true,
    queueAgents: [
      {
        id: 'ceo',
        role: 'orchestrator',
        projectId: null,
        label: 'CEO(总指挥)',
      },
    ],
    queues: {
      ceo: {
        agent: 'ceo',
        queued: [
          {
            id: 'queue-1',
            status: 'queued',
            task: { goal: 'test task' },
            error: null,
          },
        ],
        running: [],
        paused: [],
        done: 1,
        failed: 0,
        canceled: 0,
      },
    },
  };
}

function taskBoardPayload() {
  return {
    ok: true,
    counts: {
      active: 1,
      queued: 0,
      total: 1,
      history: 1,
    },
    tasks: [
      {
        id: 'task-1',
        status: 'running',
        state: 'running',
        task: 'contract test',
        downstream: null,
        nodes: [
          {
            id: 'node-1',
            label: '后端程序员',
            status: 'running',
          },
        ],
        progress: {
          state: 'run',
          seq: 2,
          text: '正在验证',
        },
      },
    ],
    history: [
      {
        id: 'history-1',
        status: 'done',
        ok: true,
      },
    ],
  };
}

function bulletinPayload() {
  return {
    ok: true,
    cards: [
      {
        id: 'card-1',
        title: '待办',
        status: 'todo',
      },
    ],
  };
}

function versionPayload() {
  return {
    ok: true,
    version: '0.0.1',
    updated_at: '2026-07-17T00:00:00.000Z',
  };
}

function eventsPayload() {
  return {
    source: 'artifacts/engine-events.jsonl',
    lastSeq: 3,
    events: [
      {
        seq: 3,
        type: 'task.done',
        ts: '2026-07-17T00:00:00.000Z',
      },
    ],
  };
}

function snapshotPayload() {
  return {
    schemaVersion: 1,
    revision: 'revision-1',
    lastSeq: 42,
    generatedAt: '2026-07-17T00:00:00.000Z',
    runners: runnersPayload(),
    queues: queuesPayload(),
    taskBoard: taskBoardPayload(),
    bulletin: bulletinPayload(),
    version: versionPayload(),
  };
}
