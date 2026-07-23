import {
  ContractError,
  decodeBulletinResponse,
  decodeCeoTaskBoardResponse,
  decodeEventsResponse,
  decodeQueuesOverviewResponse,
  decodeRunnersResponse,
  decodeVersionResponse,
  decodeWorkspaceSnapshotResponse,
  fallbackCeoTaskBoardResponse,
  fallbackQueuesOverviewResponse,
  fallbackRunnersResponse,
  fallbackVersionResponse,
} from '../contracts/index.js';
import type {
  BulletinResponse,
  EventsResponse,
  FrontendRouteState,
  FrontendUiTarget,
  ImageAttachment,
  LlmUsageOverview,
  RuntimeSettingsState,
  TaskDetailResponse,
  WorkspaceCoreSnapshot,
  WorkspaceCoreModule,
  WorkspaceModuleIssue,
  WorkspaceSnapshotResponse,
} from '../types';

type ContractDecoder<T> = (value: unknown, path?: string) => T;

interface ModuleLoad<T> {
  value: T;
  issue?: WorkspaceModuleIssue;
}

export interface WorkspaceBootstrap {
  core: WorkspaceCoreSnapshot;
  bulletin: BulletinResponse;
  unchanged: boolean;
  source: 'snapshot' | 'legacy';
  warning?: string;
}

let workspaceSnapshotEtag = '';

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const data: unknown = await response.json().catch(() => null);
  const record = isRecord(data) ? data : null;
  if (!response.ok || record?.ok === false) {
    throw new Error(typeof record?.error === 'string' ? record.error : `请求失败 (${response.status})`);
  }
  return data;
}

async function requestContract<T>(
  path: string,
  decoder: ContractDecoder<T>,
  init?: RequestInit,
): Promise<T> {
  return decoder(await requestJson(path, init), path);
}

export async function fetchWorkspaceCore(
  previous?: WorkspaceCoreSnapshot | null,
): Promise<WorkspaceCoreSnapshot> {
  const [runners, queues, taskBoard, version] = await Promise.all([
    loadModule(
      'runners',
      '/api/runners',
      decodeRunnersResponse,
      previous?.runners || fallbackRunnersResponse(),
      Boolean(previous?.runners),
    ),
    loadModule(
      'queues',
      '/api/queues/overview',
      decodeQueuesOverviewResponse,
      previous?.queues || fallbackQueuesOverviewResponse(),
      Boolean(previous?.queues),
    ),
    loadModule(
      'taskBoard',
      '/api/task-board/ceo',
      decodeCeoTaskBoardResponse,
      previous?.taskBoard || fallbackCeoTaskBoardResponse(),
      Boolean(previous?.taskBoard),
    ),
    loadModule(
      'version',
      '/api/version',
      decodeVersionResponse,
      previous?.version || fallbackVersionResponse(),
      Boolean(previous?.version),
    ),
  ]);
  const issues: WorkspaceCoreSnapshot['issues'] = {};
  for (const result of [runners, queues, taskBoard, version]) {
    if (result.issue) issues[result.issue.module] = result.issue;
  }
  return {
    runners: runners.value,
    queues: queues.value,
    taskBoard: taskBoard.value,
    version: version.value,
    issues,
  };
}

export async function fetchWorkspaceBootstrap(previous?: {
  core: WorkspaceCoreSnapshot | null;
  bulletin: BulletinResponse | null;
}): Promise<WorkspaceBootstrap> {
  try {
    const headers: HeadersInit = {};
    if (workspaceSnapshotEtag && previous?.core && previous.bulletin) {
      headers['If-None-Match'] = workspaceSnapshotEtag;
    }
    const response = await fetch('/api/workspace/snapshot', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers,
    });
    if (response.status === 304 && previous?.core && previous.bulletin) {
      return {
        core: previous.core,
        bulletin: previous.bulletin,
        unchanged: true,
        source: 'snapshot',
      };
    }
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const record = isRecord(data) ? data : null;
      throw new Error(typeof record?.error === 'string' ? record.error : `请求失败 (${response.status})`);
    }
    const snapshot = decodeWorkspaceSnapshotResponse(data);
    workspaceSnapshotEtag = response.headers.get('etag') || `"${snapshot.revision}"`;
    return workspaceBootstrapFromSnapshot(snapshot);
  } catch (error) {
    const core = await fetchWorkspaceCore(previous?.core);
    let bulletin = previous?.bulletin || null;
    try {
      bulletin = await fetchBulletin();
    } catch (bulletinError) {
      if (!bulletin) {
        bulletin = {
          schemaVersion: 1,
          ok: true,
          cards: [],
        };
      }
    }
    return {
      core,
      bulletin,
      unchanged: false,
      source: 'legacy',
      warning: error instanceof Error ? `工作区快照不可用，已回退兼容接口：${error.message}` : '工作区快照不可用，已回退兼容接口',
    };
  }
}

export function fetchBulletin(): Promise<BulletinResponse> {
  return requestContract('/api/bulletin', decodeBulletinResponse);
}

function workspaceBootstrapFromSnapshot(snapshot: WorkspaceSnapshotResponse): WorkspaceBootstrap {
  return {
    core: {
      runners: snapshot.runners,
      queues: snapshot.queues,
      taskBoard: snapshot.taskBoard,
      version: snapshot.version,
      issues: {},
      revision: snapshot.revision,
      lastSeq: snapshot.lastSeq,
      generatedAt: snapshot.generatedAt,
    },
    bulletin: snapshot.bulletin,
    unchanged: false,
    source: 'snapshot',
  };
}

export function fetchEvents(after = 0, count = 120): Promise<EventsResponse> {
  const safeAfter = Math.max(0, Math.floor(after));
  const safeCount = Math.min(500, Math.max(1, Math.floor(count)));
  return requestContract(
    `/api/events?after=${safeAfter}&n=${safeCount}`,
    decodeEventsResponse,
  );
}

export class AttachmentApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AttachmentApiError';
    this.status = status;
    this.code = code;
  }
}

export async function stageAttachment(file: File): Promise<ImageAttachment> {
  const response = await fetch('/api/attachments', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name || 'pasted-image'),
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new AttachmentApiError(
      typeof payload.error === 'string' ? payload.error : `附件暂存失败 (${response.status})`,
      response.status,
      typeof payload.code === 'string' ? payload.code : undefined,
    );
  }
  const attachment = isRecord(payload.attachment) ? payload.attachment : null;
  if (!attachment
    || typeof attachment.id !== 'string'
    || typeof attachment.name !== 'string'
    || typeof attachment.mime !== 'string'
    || typeof attachment.size !== 'number') {
    throw new AttachmentApiError('附件暂存响应不完整', 502);
  }
  return {
    id: attachment.id,
    name: attachment.name,
    type: attachment.mime,
    size: attachment.size,
    hash: typeof attachment.hash === 'string' ? attachment.hash : undefined,
    path: typeof attachment.path === 'string' ? attachment.path : undefined,
    previewUrl: typeof attachment.previewUrl === 'string'
      ? attachment.previewUrl
      : `/api/attachments/${encodeURIComponent(attachment.id)}`,
    staged: true,
  };
}

export async function deleteAttachment(id: string): Promise<void> {
  const response = await fetch(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (response.ok || response.status === 404) return;
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  throw new AttachmentApiError(
    typeof payload.error === 'string' ? payload.error : `附件删除失败 (${response.status})`,
    response.status,
  );
}

export async function enqueueTask(input: {
  role: string;
  goal: string;
  attachments: ImageAttachment[];
}): Promise<{ ok: boolean; entry: { id: string }; queueAgent?: string }> {
  const queueAgent = input.role === 'orchestrator' ? 'ceo' : input.role;
  const payload = {
    role: input.role,
    flowId: input.role === 'orchestrator' ? 'review-loop' : 'agent-once',
    goal: input.goal,
    attachments: input.attachments.map(({ id, name, type, size, hash, path, dataUrl }) => (
      dataUrl
        ? { id, name, type, size, dataUrl }
        : { id, name, type, mime: type, size, hash, path }
    )),
    autoApproveHuman: true,
    useOrchestrator: input.role === 'orchestrator',
    bounds: '只处理本任务; 密钥不回显; 登录/授权交主人手动; 不确定就停下说明',
    acceptance: '任务执行过程写入事件日志; 产物路径清楚; 声称完成必须附真实验证证据',
  };
  const path = `/api/queue/${encodeURIComponent(queueAgent)}`;
  const data = await requestJson(path, {
    method: 'POST',
    body: JSON.stringify({ task: payload }),
  });
  const record = requireOkRecord(data, path);
  const entry = isRecord(record.entry) ? record.entry : null;
  if (!entry || typeof entry.id !== 'string' || !entry.id) {
    throw new Error(`${path}: 响应缺少 entry.id`);
  }
  return {
    ok: true,
    entry: { id: entry.id },
    queueAgent: typeof record.queueAgent === 'string' ? record.queueAgent : undefined,
  };
}

export async function cancelQueueItem(agent: string, id: string): Promise<{ ok: boolean }> {
  const path = `/api/queue/${encodeURIComponent(agent)}/${encodeURIComponent(id)}/cancel`;
  const data = await requestJson(path, {
    method: 'POST',
    body: '{}',
  });
  requireOkRecord(data, path);
  return { ok: true };
}

export async function fetchTaskDetail(agent: string, id: string, taskId = ''): Promise<TaskDetailResponse> {
  const query = new URLSearchParams({ agent, id });
  if (taskId) query.set('taskId', taskId);
  const path = `/api/task-detail?${query.toString()}`;
  const data = await requestJson(path);
  const record = requireOkRecord(data, path);
  if (!isRecord(record.task) || !Array.isArray(record.artifacts)) {
    throw new Error(`${path}: 任务详情响应不完整`);
  }
  return record as unknown as TaskDetailResponse;
}

export async function retryQueueItem(agent: string, id: string): Promise<{ ok: boolean; entry?: { id?: string } }> {
  const path = '/api/task-detail/retry';
  const data = await requestJson(path, {
    method: 'POST',
    body: JSON.stringify({ agent, id }),
  });
  const record = requireOkRecord(data, path);
  return {
    ok: true,
    entry: isRecord(record.entry) ? { id: typeof record.entry.id === 'string' ? record.entry.id : undefined } : undefined,
  };
}

export async function fetchLlmUsageOverview(days = 7): Promise<LlmUsageOverview> {
  const safeDays = Math.min(90, Math.max(1, Math.floor(days)));
  const path = `/api/llm-usage/overview?days=${safeDays}`;
  const data = await requestJson(path);
  if (!isRecord(data) || !Array.isArray(data.models)) {
    throw new Error(`${path}: 用量响应不完整`);
  }
  return data as unknown as LlmUsageOverview;
}

export async function fetchControlRoomOverview(): Promise<Record<string, unknown>> {
  const path = '/api/cr/overview';
  const data = await requestJson(path);
  if (!isRecord(data)) throw new Error(`${path}: 控制室响应不完整`);
  return data;
}

export async function fetchHistory(limit = 20): Promise<Array<Record<string, unknown>>> {
  const path = `/api/history?n=${Math.min(100, Math.max(1, Math.floor(limit)))}`;
  const data = await requestJson(path);
  if (!isRecord(data) || !Array.isArray(data.history)) throw new Error(`${path}: 历史响应不完整`);
  return data.history.filter(isRecord);
}

export async function probeRunner(runner: string): Promise<Record<string, unknown>> {
  const path = `/api/probe?runner=${encodeURIComponent(runner)}`;
  const data = await requestJson(path);
  if (!isRecord(data)) throw new Error(`${path}: 探测响应不完整`);
  return data;
}

export interface ChatStreamItem {
  type: string;
  text?: string;
  code?: number;
  [key: string]: unknown;
}

export async function streamRunnerChat(
  runner: string,
  message: string,
  signal: AbortSignal,
  onItem: (item: ChatStreamItem) => void,
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runner, message, history: [] }),
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(typeof payload.error === 'string' ? payload.error : `聊天请求失败 (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as ChatStreamItem;
        if (item && typeof item.type === 'string') onItem(item);
      } catch (_) {}
    }
    if (done) break;
  }
}

export async function fetchNewApiOverview(): Promise<Record<string, unknown>> {
  const path = '/api/newapi/overview';
  const data = await requestJson(path);
  if (!isRecord(data)) throw new Error(`${path}: 网关概览响应不完整`);
  return data;
}

export async function fetchNewApiUsage(days = 7, limit = 80): Promise<Record<string, unknown>> {
  const safeDays = Math.min(90, Math.max(1, Math.floor(days)));
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const path = `/api/newapi/usage?days=${safeDays}&limit=${safeLimit}`;
  const data = await requestJson(path);
  if (!isRecord(data)) throw new Error(`${path}: 网关用量响应不完整`);
  return data;
}

export async function fetchModelFabricOverview(): Promise<Record<string, unknown>> {
  const path = '/api/model-fabric/overview';
  const data = await requestJson(path);
  if (!isRecord(data)) throw new Error(`${path}: 中枢概览响应不完整`);
  return data;
}

export async function fetchModelFabricUsage(days = 7): Promise<Record<string, unknown>> {
  const safeDays = Math.min(90, Math.max(1, Math.floor(days)));
  const path = `/api/model-fabric/usage?days=${safeDays}`;
  const data = await requestJson(path);
  if (!isRecord(data)) throw new Error(`${path}: 中枢用量响应不完整`);
  return data;
}

export async function fetchRuntimeSettings(): Promise<RuntimeSettingsState> {
  return decodeRuntimeSettings(await requestJson('/api/settings/runtime'), '/api/settings/runtime');
}

export async function fetchFrontendRoute(): Promise<FrontendRouteState> {
  return decodeFrontendRoute(await requestJson('/api/frontend/route'), '/api/frontend/route');
}

export async function saveFrontendRoute(target: FrontendUiTarget): Promise<FrontendRouteState> {
  return decodeFrontendRoute(await runtimeSettingsPost(
    '/api/frontend/route',
    { target },
  ), '/api/frontend/route');
}

export async function saveRuntimeSettings(engineMaxConcurrency: number): Promise<RuntimeSettingsState> {
  return decodeRuntimeSettings(await runtimeSettingsPost(
    '/api/settings/runtime',
    { engineMaxConcurrency },
  ), '/api/settings/runtime');
}

export async function restartConsole(): Promise<{ ok: true; scheduled: boolean; cooldownSec?: number }> {
  const value = await runtimeSettingsPost('/api/console/restart', {});
  const record = requireOkRecord(value, '/api/console/restart');
  return {
    ok: true,
    scheduled: record.scheduled === true,
    cooldownSec: typeof record.cooldownSec === 'number' ? record.cooldownSec : undefined,
  };
}

export async function enableBulletin(id: string): Promise<{ ok: boolean }> {
  const path = `/api/bulletin/${encodeURIComponent(id)}/enable`;
  const data = await requestJson(path, {
    method: 'POST',
    body: '{}',
  });
  requireOkRecord(data, path);
  return { ok: true };
}

export async function removeBulletin(id: string): Promise<{ ok: boolean }> {
  const path = `/api/bulletin/${encodeURIComponent(id)}/remove`;
  const data = await requestJson(path, {
    method: 'POST',
    body: '{}',
  });
  requireOkRecord(data, path);
  return { ok: true };
}

async function runtimeSettingsPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  let token = cookieValue('yutu6_console_csrf');
  if (!token) {
    await fetchRuntimeSettings();
    token = cookieValue('yutu6_console_csrf');
  }
  if (!token) throw new Error('未取得本机设置会话');
  return requestJson(path, {
    method: 'POST',
    headers: { 'X-Console-CSRF': token },
    body: JSON.stringify(body),
  });
}

function decodeRuntimeSettings(value: unknown, path: string): RuntimeSettingsState {
  const record = requireOkRecord(value, path);
  for (const key of ['current', 'pending', 'min', 'max'] as const) {
    if (!Number.isInteger(record[key])) throw new Error(`${path}: ${key} 不是整数`);
  }
  if (typeof record.restartRequired !== 'boolean') {
    throw new Error(`${path}: restartRequired 不是布尔值`);
  }
  return record as unknown as RuntimeSettingsState;
}

function decodeFrontendRoute(value: unknown, path: string): FrontendRouteState {
  const record = requireOkRecord(value, path);
  if (record.target !== 'react' && record.target !== 'legacy') {
    throw new Error(`${path}: target 不是支持的界面类型`);
  }
  for (const key of ['workspace', 'react', 'legacy'] as const) {
    if (typeof record[key] !== 'string' || !record[key]) {
      throw new Error(`${path}: ${key} 路由无效`);
    }
  }
  return record as unknown as FrontendRouteState;
}

function cookieValue(name: string): string {
  const prefix = `${name}=`;
  for (const part of String(document.cookie || '').split(';')) {
    const item = part.trim();
    if (item.startsWith(prefix)) return decodeURIComponent(item.slice(prefix.length));
  }
  return '';
}

async function loadModule<T>(
  module: WorkspaceCoreModule,
  path: string,
  decoder: ContractDecoder<T>,
  fallback: T,
  stale: boolean,
): Promise<ModuleLoad<T>> {
  try {
    return { value: await requestContract(path, decoder) };
  } catch (error) {
    return {
      value: fallback,
      issue: {
        module,
        code: error instanceof ContractError ? error.code : 'request_failed',
        message: moduleErrorMessage(module, error, stale),
        stale,
      },
    };
  }
}

function moduleErrorMessage(
  module: WorkspaceCoreModule,
  error: unknown,
  stale: boolean,
): string {
  const labels: Record<WorkspaceCoreModule, string> = {
    runners: '角色目录',
    queues: '队列',
    taskBoard: '任务板',
    version: '版本信息',
  };
  const detail = error instanceof Error ? error.message : '未知错误';
  return `${labels[module]}不可用，${stale ? '继续显示上次有效数据' : '已使用安全空数据'}：${detail}`;
}

function requireOkRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(`${path}: 响应缺少 ok=true`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
