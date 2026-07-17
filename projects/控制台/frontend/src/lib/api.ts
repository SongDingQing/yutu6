import type {
  BulletinResponse,
  ImageAttachment,
  QueuesOverviewResponse,
  RunnersResponse,
  VersionResponse,
  WorkspaceCoreSnapshot,
  CeoTaskBoardResponse,
} from '../types';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({})) as T & { ok?: boolean; error?: string };
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `请求失败 (${response.status})`);
  }
  return data;
}

export async function fetchWorkspaceCore(): Promise<WorkspaceCoreSnapshot> {
  const [runners, queues, taskBoard, version] = await Promise.all([
    requestJson<RunnersResponse>('/api/runners'),
    requestJson<QueuesOverviewResponse>('/api/queues/overview'),
    requestJson<CeoTaskBoardResponse>('/api/task-board/ceo'),
    requestJson<VersionResponse>('/api/version'),
  ]);
  return { runners, queues, taskBoard, version };
}

export function fetchBulletin(): Promise<BulletinResponse> {
  return requestJson<BulletinResponse>('/api/bulletin');
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
    attachments: input.attachments.map(({ name, type, size, dataUrl }) => ({ name, type, size, dataUrl })),
    autoApproveHuman: true,
    useOrchestrator: input.role === 'orchestrator',
    bounds: '只处理本任务; 密钥不回显; 登录/授权交主人手动; 不确定就停下说明',
    acceptance: '任务执行过程写入事件日志; 产物路径清楚; 声称完成必须附真实验证证据',
  };
  return requestJson(`/api/queue/${encodeURIComponent(queueAgent)}`, {
    method: 'POST',
    body: JSON.stringify({ task: payload }),
  });
}

export function cancelQueueItem(agent: string, id: string): Promise<{ ok: boolean }> {
  return requestJson(`/api/queue/${encodeURIComponent(agent)}/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: '{}',
  });
}

export function enableBulletin(id: string): Promise<{ ok: boolean }> {
  return requestJson(`/api/bulletin/${encodeURIComponent(id)}/enable`, {
    method: 'POST',
    body: '{}',
  });
}

export function removeBulletin(id: string): Promise<{ ok: boolean }> {
  return requestJson(`/api/bulletin/${encodeURIComponent(id)}/remove`, {
    method: 'POST',
    body: '{}',
  });
}
