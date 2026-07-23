export type JsonRecord = Record<string, unknown>;

export const CONTRACT_SCHEMA_VERSION = 1 as const;
export type ContractSchemaVersion = typeof CONTRACT_SCHEMA_VERSION;

export const TASK_STATUSES = [
  'queued',
  'running',
  'paused',
  'waiting',
  'blocked',
  'retrying',
  'done',
  'failed',
  'canceled',
  'unknown',
] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const TASK_NODE_STATUSES = [
  'pending',
  'waiting',
  'running',
  'done',
  'failed',
  'skipped',
  'blocked',
  'paused',
  'canceled',
  'absent',
  'unknown',
] as const;
export type TaskNodeStatus = typeof TASK_NODE_STATUSES[number];

export const RUNNER_STATUSES = [
  'active',
  'archived',
  'deprecated',
  'unavailable',
  'unknown',
] as const;
export type RunnerStatus = typeof RUNNER_STATUSES[number];

export const BULLETIN_STATUSES = [
  'todo',
  '待拍板',
  'enabled',
  'approved',
  'rejected',
  'voided',
  'removed',
  'unknown',
] as const;
export type BulletinStatus = typeof BULLETIN_STATUSES[number];

export const TASK_PROGRESS_STATES = [
  'idle',
  'queued',
  'run',
  'wait',
  'done',
  'fail',
  'paused',
  'blocked',
  'unknown',
] as const;
export type TaskProgressState = typeof TASK_PROGRESS_STATES[number];

export interface RoleConfig {
  label: string;
  runner?: string;
  archived?: boolean;
  status: RunnerStatus;
  model?: string;
  execution?: JsonRecord;
  [key: string]: unknown;
}

export interface RunnerDefinition {
  id: string;
  label: string;
  note?: string;
  deprecated?: boolean;
  status: RunnerStatus;
  [key: string]: unknown;
}

export interface QueueAgent {
  id: string;
  role: string;
  projectId?: string | null;
  label: string;
  [key: string]: unknown;
}

export interface QueueEntry {
  id: string;
  status: TaskStatus;
  task?: unknown;
  taskId?: string;
  priority?: number;
  enqueued_at?: string;
  started_at?: string;
  paused_at?: string;
  updated_at?: string;
  finished_at?: string;
  engine_started_at?: string;
  claimed_at?: string;
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface QueueState {
  agent?: string;
  queued: QueueEntry[];
  running: QueueEntry[];
  paused: QueueEntry[];
  done: number;
  failed: number;
  canceled: number;
}

export interface TaskNode {
  id?: string;
  label?: string;
  status: TaskNodeStatus;
  statusText?: string;
  role?: string;
  taskId?: string;
  node?: string;
  rework?: boolean;
  reworkCount?: number;
}

export interface TaskProgress {
  text?: string;
  state?: TaskProgressState;
  seq?: number;
  ts?: string;
  taskId?: string;
  node?: string;
  stepText?: string;
}

export interface CeoTask {
  id: string;
  status: TaskStatus;
  rootTaskId?: string;
  rootQueueAgent?: string;
  rootQueueId?: string;
  statusText?: string;
  rework?: boolean;
  reworkCount?: number;
  waitingDownstream?: boolean;
  downstream?: {
    agent?: string;
    queueId?: string;
    roleLabel?: string;
    text?: string;
  };
  task?: string;
  brief?: string;
  enqueued_at?: string;
  started_at?: string;
  flow?: string;
  state?: TaskStatus;
  action?: {
    agent?: string;
    id?: string;
    taskId?: string;
  };
  queueOrder?: number | null;
  nodes?: TaskNode[];
  progress?: TaskProgress;
  runDir?: string;
}

export interface TaskHistoryItem {
  status: TaskStatus;
  key?: string;
  agent?: string;
  id?: string;
  task?: string;
  taskId?: string;
  ok?: boolean;
  reason?: string;
  error?: string;
  enqueued_at?: string;
  started_at?: string;
  finished_at?: string;
}

export interface CeoTaskBoardResponse {
  schemaVersion: ContractSchemaVersion;
  ok: boolean;
  generated_at?: string;
  counts?: {
    active?: number;
    queued?: number;
    total?: number;
    history?: number;
  };
  tasks: CeoTask[];
  history: TaskHistoryItem[];
}

export interface RunnersResponse {
  schemaVersion: ContractSchemaVersion;
  roles: Record<string, RoleConfig>;
  queueAgents: QueueAgent[];
  runners: RunnerDefinition[];
  workdir?: string;
  [key: string]: unknown;
}

export interface QueuesOverviewResponse {
  schemaVersion: ContractSchemaVersion;
  ok: boolean;
  generated_at?: string;
  queueAgents: QueueAgent[];
  queues: Record<string, QueueState>;
}

export interface BulletinCard {
  id: string;
  title: string;
  status: BulletinStatus;
  desc?: string;
  target?: string;
  project?: string;
  source?: string;
  created_at?: string;
  enabled_at?: string | null;
  queueId?: string | null;
  kind?: string;
  [key: string]: unknown;
}

export interface BulletinResponse {
  schemaVersion: ContractSchemaVersion;
  ok: boolean;
  cards: BulletinCard[];
  summary?: {
    total: number;
    pending: number;
    archived: number;
  };
}

export interface VersionResponse {
  schemaVersion: ContractSchemaVersion;
  ok: boolean;
  version: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface EngineEvent extends JsonRecord {
  seq: number;
  type: string;
  ts?: string;
}

export interface EventsResponse {
  schemaVersion: ContractSchemaVersion;
  source: string;
  lastSeq: number;
  events: EngineEvent[];
}

export interface ImageAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  hash?: string;
  path?: string;
  previewUrl?: string;
  staged?: boolean;
  dataUrl?: string;
}

export interface TaskDetailEvent {
  seq: number;
  ts: string;
  type: string;
  taskId: string;
  node: string;
  role: string;
  runner: string;
  model: string;
  provider: string;
  status: string;
  reason: string;
  summary: string;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface TaskArtifact {
  name: string;
  path: string;
  kind: 'image' | 'text';
  size: number;
  updatedAt: string;
  url: string;
}

export interface TaskDetailResponse {
  schemaVersion: ContractSchemaVersion;
  ok: boolean;
  task: {
    id: string;
    taskId: string;
    relatedTaskIds: string[];
    agent: string;
    role: string;
    status: string;
    goal: string;
    acceptance: string;
    runner: string;
    model: string;
    provider: string;
    retryCount: number;
    reason: string;
    timestamps: {
      enqueuedAt: string;
      startedAt: string;
      updatedAt: string;
      finishedAt: string;
    };
    currentStep: TaskDetailEvent | null;
    events: TaskDetailEvent[];
    attachments: Array<{
      id: string;
      name: string;
      mime: string;
      size: number | null;
    }>;
  };
  artifacts: TaskArtifact[];
}

export interface LlmUsageWindow {
  windowLabel?: string;
  calls?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  quota?: number | null;
  estimated_cost_usd?: number | null;
  gateway_quota?: number | null;
  last_at?: number | string | null;
  costTreatment?: string;
  [key: string]: unknown;
}

export interface LlmUsageModel {
  id: string;
  label?: string;
  provider?: string;
  billingMode?: string;
  billingLabel?: string;
  chargingLabel?: string;
  source?: string;
  sourceStatus?: string;
  currentUsage?: LlmUsageWindow;
  quotaWindows?: Array<Record<string, unknown>>;
  agents?: Array<Record<string, unknown> | string>;
  strategy?: string | string[];
}

export interface LlmUsageOverview {
  ok: boolean;
  generated_at?: string;
  cached?: boolean;
  models: LlmUsageModel[];
  strategy?: string[];
  caveats?: string[];
  error?: string;
}

export interface RuntimeSettingsState {
  ok: true;
  current: number;
  pending: number;
  min: number;
  max: number;
  restartRequired: boolean;
}

export type FrontendUiTarget = 'react' | 'legacy';

export interface FrontendRouteState {
  ok: true;
  target: FrontendUiTarget;
  workspace: string;
  react: string;
  legacy: string;
  saved?: boolean;
  options?: Array<{
    target: FrontendUiTarget;
    label: string;
  }>;
}

export interface WorkspaceCoreSnapshot {
  runners: RunnersResponse;
  queues: QueuesOverviewResponse;
  taskBoard: CeoTaskBoardResponse;
  version: VersionResponse;
  issues: Partial<Record<WorkspaceCoreModule, WorkspaceModuleIssue>>;
  revision?: string;
  lastSeq?: number;
  generatedAt?: string;
}

export type WorkspaceCoreModule = 'runners' | 'queues' | 'taskBoard' | 'version';

export interface WorkspaceModuleIssue {
  module: WorkspaceCoreModule;
  code: string;
  message: string;
  stale: boolean;
}

export interface WorkspaceSnapshotResponse {
  schemaVersion: ContractSchemaVersion;
  revision: string;
  lastSeq: number;
  generatedAt: string;
  runners: RunnersResponse;
  queues: QueuesOverviewResponse;
  taskBoard: CeoTaskBoardResponse;
  bulletin: BulletinResponse;
  version: VersionResponse;
}
