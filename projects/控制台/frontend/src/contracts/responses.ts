import {
  CONTRACT_SCHEMA_VERSION,
  type BulletinCard,
  type BulletinResponse,
  type CeoTask,
  type CeoTaskBoardResponse,
  type EngineEvent,
  type EventsResponse,
  type JsonRecord,
  type QueueAgent,
  type QueueEntry,
  type QueueState,
  type QueuesOverviewResponse,
  type RoleConfig,
  type RunnerDefinition,
  type RunnersResponse,
  type TaskHistoryItem,
  type TaskNode,
  type TaskProgress,
  type VersionResponse,
  type WorkspaceSnapshotResponse,
} from '../types.js';
import {
  ContractError,
  assertOk,
  readArray,
  readNonEmptyString,
  readNumber,
  readOptionalBoolean,
  readOptionalNullableNumber,
  readOptionalNullableString,
  readOptionalNumber,
  readRecord,
  readSchemaVersion,
} from './runtime.js';
import {
  readBulletinStatus,
  readRunnerStatus,
  readTaskNodeStatus,
  readTaskProgressState,
  readTaskStatus,
} from './status.js';

export function decodeRunnersResponse(
  value: unknown,
  path = '/api/runners',
): RunnersResponse {
  const record = readRecord(value, path);
  const rawRoles = readRecord(record.roles, `${path}.roles`);
  const roles = Object.fromEntries(
    Object.entries(rawRoles).map(([id, role]) => [
      id,
      decodeRoleConfig(role, `${path}.roles.${id}`),
    ]),
  );
  const queueAgents = readArray(record.queueAgents, `${path}.queueAgents`)
    .map((agent, index) => decodeQueueAgent(agent, `${path}.queueAgents[${index}]`));
  const runners = record.runners === undefined
    ? []
    : readArray(record.runners, `${path}.runners`)
      .map((runner, index) => decodeRunnerDefinition(runner, `${path}.runners[${index}]`));

  return {
    ...record,
    schemaVersion: readSchemaVersion(record, path),
    roles,
    queueAgents,
    runners,
    workdir: readOptionalText(record.workdir, `${path}.workdir`),
  };
}

export function decodeQueuesOverviewResponse(
  value: unknown,
  path = '/api/queues/overview',
): QueuesOverviewResponse {
  const record = readRecord(value, path);
  const rawQueues = readRecord(record.queues, `${path}.queues`);
  const queues = Object.fromEntries(
    Object.entries(rawQueues).map(([agent, state]) => [
      agent,
      decodeQueueState(state, `${path}.queues.${agent}`),
    ]),
  );

  return {
    ...record,
    schemaVersion: readSchemaVersion(record, path),
    ok: assertOk(record, path),
    generated_at: readOptionalText(record.generated_at, `${path}.generated_at`),
    queueAgents: readArray(record.queueAgents, `${path}.queueAgents`)
      .map((agent, index) => decodeQueueAgent(agent, `${path}.queueAgents[${index}]`)),
    queues,
  };
}

export function decodeCeoTaskBoardResponse(
  value: unknown,
  path = '/api/task-board/ceo',
): CeoTaskBoardResponse {
  const record = readRecord(value, path);
  const counts = record.counts == null
    ? undefined
    : decodeTaskCounts(record.counts, `${path}.counts`);

  return {
    ...record,
    schemaVersion: readSchemaVersion(record, path),
    ok: assertOk(record, path),
    generated_at: readOptionalText(record.generated_at, `${path}.generated_at`),
    counts,
    tasks: readArray(record.tasks, `${path}.tasks`)
      .map((task, index) => decodeCeoTask(task, `${path}.tasks[${index}]`)),
    history: readArray(record.history, `${path}.history`)
      .map((item, index) => decodeTaskHistoryItem(item, `${path}.history[${index}]`)),
  };
}

export function decodeBulletinResponse(
  value: unknown,
  path = '/api/bulletin',
): BulletinResponse {
  const record = readRecord(value, path);
  return {
    ...record,
    schemaVersion: readSchemaVersion(record, path),
    ok: assertOk(record, path),
    cards: readArray(record.cards, `${path}.cards`)
      .map((card, index) => decodeBulletinCard(card, `${path}.cards[${index}]`)),
  };
}

export function decodeVersionResponse(
  value: unknown,
  path = '/api/version',
): VersionResponse {
  const record = readRecord(value, path);
  return {
    ...record,
    schemaVersion: readSchemaVersion(record, path),
    ok: assertOk(record, path),
    version: readNonEmptyString(record.version, `${path}.version`),
    updated_at: readOptionalText(record.updated_at, `${path}.updated_at`),
  };
}

export function decodeEventsResponse(
  value: unknown,
  path = '/api/events',
): EventsResponse {
  const record = readRecord(value, path);
  return {
    ...record,
    schemaVersion: readSchemaVersion(record, path),
    source: readNonEmptyString(record.source, `${path}.source`),
    lastSeq: readNumber(record.lastSeq, `${path}.lastSeq`),
    events: readArray(record.events, `${path}.events`)
      .map((event, index) => decodeEngineEvent(event, `${path}.events[${index}]`)),
  };
}

export function decodeWorkspaceSnapshotResponse(
  value: unknown,
  path = '/api/workspace/snapshot',
): WorkspaceSnapshotResponse {
  const record = readRecord(value, path);
  return {
    schemaVersion: readSchemaVersion(record, path),
    revision: readNonEmptyString(record.revision, `${path}.revision`),
    lastSeq: readNumber(record.lastSeq, `${path}.lastSeq`),
    generatedAt: readNonEmptyString(record.generatedAt, `${path}.generatedAt`),
    runners: decodeRunnersResponse(record.runners, `${path}.runners`),
    queues: decodeQueuesOverviewResponse(record.queues, `${path}.queues`),
    taskBoard: decodeCeoTaskBoardResponse(record.taskBoard, `${path}.taskBoard`),
    bulletin: decodeBulletinResponse(record.bulletin, `${path}.bulletin`),
    version: decodeVersionResponse(record.version, `${path}.version`),
  };
}

export function fallbackRunnersResponse(): RunnersResponse {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    roles: {
      secretary: {
        label: '秘书',
        runner: 'unknown',
        status: 'unknown',
      },
      orchestrator: {
        label: 'CEO(总指挥)',
        runner: 'unknown',
        status: 'unknown',
      },
    },
    queueAgents: [
      { id: 'secretary', role: 'secretary', projectId: null, label: '秘书' },
      { id: 'ceo', role: 'orchestrator', projectId: null, label: 'CEO(总指挥)' },
    ],
    runners: [],
  };
}

export function fallbackQueuesOverviewResponse(): QueuesOverviewResponse {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    ok: true,
    queueAgents: [],
    queues: {},
  };
}

export function fallbackCeoTaskBoardResponse(): CeoTaskBoardResponse {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    ok: true,
    counts: {
      active: 0,
      queued: 0,
      total: 0,
      history: 0,
    },
    tasks: [],
    history: [],
  };
}

export function fallbackVersionResponse(): VersionResponse {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    ok: true,
    version: '',
  };
}

function decodeRoleConfig(value: unknown, path: string): RoleConfig {
  const record = readRecord(value, path);
  const archived = readOptionalBoolean(record.archived, `${path}.archived`);
  const status = record.status === undefined
    ? archived
      ? 'archived'
      : 'active'
    : readRunnerStatus(record.status, `${path}.status`);
  const execution = record.execution === undefined
    ? undefined
    : readRecord(record.execution, `${path}.execution`);

  return {
    ...record,
    label: readNonEmptyString(record.label, `${path}.label`),
    runner: readOptionalText(record.runner, `${path}.runner`),
    archived,
    status,
    model: readOptionalText(record.model, `${path}.model`),
    execution,
  };
}

function decodeRunnerDefinition(value: unknown, path: string): RunnerDefinition {
  const record = readRecord(value, path);
  const deprecated = readOptionalBoolean(record.deprecated, `${path}.deprecated`);
  const status = record.status === undefined
    ? deprecated
      ? 'deprecated'
      : 'active'
    : readRunnerStatus(record.status, `${path}.status`);

  return {
    ...record,
    id: readNonEmptyString(record.id, `${path}.id`),
    label: readNonEmptyString(record.label, `${path}.label`),
    note: readOptionalText(record.note, `${path}.note`),
    deprecated,
    status,
  };
}

function decodeQueueAgent(value: unknown, path: string): QueueAgent {
  const record = readRecord(value, path);
  return {
    ...record,
    id: readNonEmptyString(record.id, `${path}.id`),
    role: readNonEmptyString(record.role, `${path}.role`),
    projectId: readOptionalNullableString(record.projectId, `${path}.projectId`),
    label: readNonEmptyString(record.label, `${path}.label`),
  };
}

function decodeQueueState(value: unknown, path: string): QueueState {
  const record = readRecord(value, path);
  return {
    ...record,
    agent: readOptionalText(record.agent, `${path}.agent`),
    queued: readArray(record.queued, `${path}.queued`)
      .map((entry, index) => decodeQueueEntry(entry, `${path}.queued[${index}]`)),
    running: readArray(record.running, `${path}.running`)
      .map((entry, index) => decodeQueueEntry(entry, `${path}.running[${index}]`)),
    paused: readArray(record.paused, `${path}.paused`)
      .map((entry, index) => decodeQueueEntry(entry, `${path}.paused[${index}]`)),
    done: readNumber(record.done, `${path}.done`),
    failed: readNumber(record.failed, `${path}.failed`),
    canceled: readNumber(record.canceled, `${path}.canceled`),
  };
}

function decodeQueueEntry(value: unknown, path: string): QueueEntry {
  const record = readRecord(value, path);
  return {
    ...record,
    id: readNonEmptyString(record.id, `${path}.id`),
    status: readTaskStatus(record.status, `${path}.status`),
    task: record.task,
    taskId: readOptionalText(record.taskId, `${path}.taskId`),
    priority: readOptionalNumber(record.priority, `${path}.priority`),
    enqueued_at: readOptionalText(record.enqueued_at, `${path}.enqueued_at`),
    started_at: readOptionalText(record.started_at, `${path}.started_at`),
    paused_at: readOptionalText(record.paused_at, `${path}.paused_at`),
    updated_at: readOptionalText(record.updated_at, `${path}.updated_at`),
    finished_at: readOptionalText(record.finished_at, `${path}.finished_at`),
    engine_started_at: readOptionalText(record.engine_started_at, `${path}.engine_started_at`),
    claimed_at: readOptionalText(record.claimed_at, `${path}.claimed_at`),
    error: readOptionalText(record.error, `${path}.error`),
    reason: readOptionalText(record.reason, `${path}.reason`),
  };
}

function decodeCeoTask(value: unknown, path: string): CeoTask {
  const record = readRecord(value, path);
  return {
    ...record,
    id: readNonEmptyString(record.id, `${path}.id`),
    status: readTaskStatus(record.status, `${path}.status`),
    rootTaskId: readOptionalText(record.rootTaskId, `${path}.rootTaskId`),
    rootQueueAgent: readOptionalText(record.rootQueueAgent, `${path}.rootQueueAgent`),
    rootQueueId: readOptionalText(record.rootQueueId, `${path}.rootQueueId`),
    statusText: readOptionalText(record.statusText, `${path}.statusText`),
    rework: readOptionalBoolean(record.rework, `${path}.rework`),
    reworkCount: readOptionalNumber(record.reworkCount, `${path}.reworkCount`),
    waitingDownstream: readOptionalBoolean(record.waitingDownstream, `${path}.waitingDownstream`),
    downstream: record.downstream == null
      ? undefined
      : decodeDownstream(record.downstream, `${path}.downstream`),
    task: readOptionalText(record.task, `${path}.task`),
    brief: readOptionalText(record.brief, `${path}.brief`),
    enqueued_at: readOptionalText(record.enqueued_at, `${path}.enqueued_at`),
    started_at: readOptionalText(record.started_at, `${path}.started_at`),
    flow: readOptionalText(record.flow, `${path}.flow`),
    state: record.state === undefined
      ? undefined
      : readTaskStatus(record.state, `${path}.state`),
    action: record.action == null
      ? undefined
      : decodeTaskAction(record.action, `${path}.action`),
    queueOrder: readOptionalNullableNumber(record.queueOrder, `${path}.queueOrder`),
    nodes: record.nodes == null
      ? undefined
      : readArray(record.nodes, `${path}.nodes`)
        .map((node, index) => decodeTaskNode(node, `${path}.nodes[${index}]`)),
    progress: record.progress == null
      ? undefined
      : decodeTaskProgress(record.progress, `${path}.progress`),
    runDir: readOptionalText(record.runDir, `${path}.runDir`),
  };
}

function decodeTaskNode(value: unknown, path: string): TaskNode {
  const record = readRecord(value, path);
  const label = readOptionalText(record.label, `${path}.label`);
  const role = readOptionalText(record.role, `${path}.role`);
  if (!label && !role) {
    throw new ContractError({
      code: 'missing_field',
      path,
      expected: 'label 或 role',
      received: undefined,
    });
  }
  return {
    ...record,
    id: readOptionalText(record.id, `${path}.id`),
    label,
    status: readTaskNodeStatus(record.status, `${path}.status`),
    statusText: readOptionalText(record.statusText, `${path}.statusText`),
    role,
    taskId: readOptionalText(record.taskId, `${path}.taskId`),
    node: readOptionalText(record.node, `${path}.node`),
    rework: readOptionalBoolean(record.rework, `${path}.rework`),
    reworkCount: readOptionalNumber(record.reworkCount, `${path}.reworkCount`),
  };
}

function decodeTaskProgress(value: unknown, path: string): TaskProgress {
  const record = readRecord(value, path);
  return {
    ...record,
    text: readOptionalText(record.text, `${path}.text`),
    state: record.state === undefined
      ? undefined
      : readTaskProgressState(record.state, `${path}.state`),
    seq: readOptionalNumber(record.seq, `${path}.seq`),
    ts: readOptionalText(record.ts, `${path}.ts`),
    taskId: readOptionalText(record.taskId, `${path}.taskId`),
    node: readOptionalText(record.node, `${path}.node`),
    stepText: readOptionalText(record.stepText, `${path}.stepText`),
  };
}

function decodeTaskHistoryItem(value: unknown, path: string): TaskHistoryItem {
  const record = readRecord(value, path);
  return {
    ...record,
    status: readTaskStatus(record.status, `${path}.status`),
    key: readOptionalText(record.key, `${path}.key`),
    agent: readOptionalText(record.agent, `${path}.agent`),
    id: readOptionalText(record.id, `${path}.id`),
    task: readOptionalText(record.task, `${path}.task`),
    taskId: readOptionalText(record.taskId, `${path}.taskId`),
    ok: readOptionalBoolean(record.ok, `${path}.ok`),
    reason: readOptionalText(record.reason, `${path}.reason`),
    error: readOptionalText(record.error, `${path}.error`),
    enqueued_at: readOptionalText(record.enqueued_at, `${path}.enqueued_at`),
    started_at: readOptionalText(record.started_at, `${path}.started_at`),
    finished_at: readOptionalText(record.finished_at, `${path}.finished_at`),
  };
}

function decodeTaskCounts(value: unknown, path: string) {
  const record = readRecord(value, path);
  return {
    active: readOptionalNumber(record.active, `${path}.active`),
    queued: readOptionalNumber(record.queued, `${path}.queued`),
    total: readOptionalNumber(record.total, `${path}.total`),
    history: readOptionalNumber(record.history, `${path}.history`),
  };
}

function decodeDownstream(value: unknown, path: string) {
  const record = readRecord(value, path);
  return {
    agent: readOptionalText(record.agent, `${path}.agent`),
    queueId: readOptionalText(record.queueId, `${path}.queueId`),
    roleLabel: readOptionalText(record.roleLabel, `${path}.roleLabel`),
    text: readOptionalText(record.text, `${path}.text`),
  };
}

function decodeTaskAction(value: unknown, path: string) {
  const record = readRecord(value, path);
  return {
    agent: readOptionalText(record.agent, `${path}.agent`),
    id: readOptionalText(record.id, `${path}.id`),
    taskId: readOptionalText(record.taskId, `${path}.taskId`),
  };
}

function decodeBulletinCard(value: unknown, path: string): BulletinCard {
  const record = readRecord(value, path);
  return {
    ...record,
    id: readNonEmptyString(record.id, `${path}.id`),
    title: readNonEmptyString(record.title, `${path}.title`),
    status: readBulletinStatus(record.status, `${path}.status`),
    desc: readOptionalText(record.desc, `${path}.desc`),
    target: readOptionalText(record.target, `${path}.target`),
    project: readOptionalText(record.project, `${path}.project`),
    source: readOptionalText(record.source, `${path}.source`),
    created_at: readOptionalText(record.created_at, `${path}.created_at`),
    enabled_at: readOptionalNullableString(record.enabled_at, `${path}.enabled_at`),
    queueId: readOptionalNullableString(record.queueId, `${path}.queueId`),
    kind: readOptionalText(record.kind, `${path}.kind`),
  };
}

function decodeEngineEvent(value: unknown, path: string): EngineEvent {
  const record = readRecord(value, path);
  return {
    ...record,
    seq: readNumber(record.seq, `${path}.seq`),
    type: readNonEmptyString(record.type, `${path}.type`),
    ts: readOptionalText(record.ts, `${path}.ts`),
  };
}

function readOptionalText(value: unknown, path: string): string | undefined {
  return readOptionalNullableString(value, path) ?? undefined;
}
