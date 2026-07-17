export type JsonRecord = Record<string, unknown>;

export interface RoleConfig {
  label: string;
  runner?: string;
  archived?: boolean;
}

export interface QueueAgent {
  id: string;
  role: string;
  projectId?: string | null;
  label: string;
}

export interface QueueEntry {
  id: string;
  task?: unknown;
  taskId?: string;
  status?: string;
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
  status?: string;
  statusText?: string;
  role?: string;
  taskId?: string;
  node?: string;
  rework?: boolean;
  reworkCount?: number;
}

export interface TaskProgress {
  text?: string;
  state?: string;
  seq?: number;
  ts?: string;
  taskId?: string;
  node?: string;
  stepText?: string;
}

export interface CeoTask {
  id: string;
  rootTaskId?: string;
  rootQueueAgent?: string;
  rootQueueId?: string;
  status?: string;
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
  state?: string;
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
  key?: string;
  agent?: string;
  id?: string;
  task?: string;
  taskId?: string;
  status?: string;
  ok?: boolean;
  reason?: string;
  error?: string;
  enqueued_at?: string;
  started_at?: string;
  finished_at?: string;
}

export interface CeoTaskBoardResponse {
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
  roles: Record<string, RoleConfig>;
  queueAgents: QueueAgent[];
  workdir?: string;
}

export interface QueuesOverviewResponse {
  ok: boolean;
  generated_at?: string;
  queueAgents: QueueAgent[];
  queues: Record<string, QueueState>;
}

export interface BulletinCard {
  id: string;
  title: string;
  desc?: string;
  target?: string;
  project?: string;
  source?: string;
  status?: string;
  created_at?: string;
  enabled_at?: string | null;
  queueId?: string | null;
  kind?: string;
}

export interface BulletinResponse {
  ok: boolean;
  cards: BulletinCard[];
}

export interface VersionResponse {
  ok: boolean;
  version?: string;
  updated_at?: string;
}

export interface ImageAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

export interface WorkspaceCoreSnapshot {
  runners: RunnersResponse;
  queues: QueuesOverviewResponse;
  taskBoard: CeoTaskBoardResponse;
  version: VersionResponse;
}
