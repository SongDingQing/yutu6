import {
  BULLETIN_STATUSES,
  TASK_STATUSES,
  type BulletinCard,
  type BulletinResponse,
  type CeoTask,
  type EngineEvent,
  type QueueState,
  type RoleConfig,
  type WorkspaceCoreSnapshot,
} from '../types.js';
import type { WorkspaceBootstrap } from '../lib/api.js';

export type WorkspaceConnectionState = 'idle' | 'connecting' | 'live' | 'retrying' | 'resyncing';
export type WorkspaceDomain = 'tasks' | 'queues' | 'runners' | 'bulletin' | 'version';

export interface WorkspaceEntities {
  tasks: Record<string, CeoTask>;
  queues: Record<string, QueueState>;
  runners: Record<string, RoleConfig>;
  bulletin: Record<string, BulletinCard>;
}

export interface WorkspaceState {
  core: WorkspaceCoreSnapshot | null;
  bulletinResponse: BulletinResponse | null;
  bulletin: BulletinCard[];
  entities: WorkspaceEntities;
  revision: string;
  cursor: number;
  connection: WorkspaceConnectionState;
  needsResync: boolean;
  dirtyDomains: WorkspaceDomain[];
  error: string;
  warning: string;
  lastUpdated: Date | null;
}

export type WorkspaceAction =
  | { type: 'snapshot.loaded'; result: WorkspaceBootstrap }
  | { type: 'events.received'; events: EngineEvent[]; lastSeq: number }
  | { type: 'bulletin.loaded'; bulletin: BulletinResponse }
  | { type: 'connection.changed'; connection: WorkspaceConnectionState; error?: string }
  | { type: 'resync.requested'; reason: string };

export const initialWorkspaceState: WorkspaceState = {
  core: null,
  bulletinResponse: null,
  bulletin: [],
  entities: {
    tasks: {},
    queues: {},
    runners: {},
    bulletin: {},
  },
  revision: '',
  cursor: 0,
  connection: 'idle',
  needsResync: false,
  dirtyDomains: [],
  error: '',
  warning: '',
  lastUpdated: null,
};

export function reduceWorkspaceState(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  if (action.type === 'snapshot.loaded') {
    if (action.result.unchanged) {
      return {
        ...state,
        connection: 'live',
        error: '',
        warning: action.result.warning || '',
      };
    }
    const { core, bulletin } = action.result;
    return {
      ...state,
      core,
      bulletinResponse: bulletin,
      bulletin: bulletin.cards,
      entities: normalizeEntities(core, bulletin.cards),
      revision: core.revision || '',
      cursor: Math.max(0, core.lastSeq || 0),
      connection: 'live',
      needsResync: false,
      dirtyDomains: [],
      error: '',
      warning: action.result.warning || '',
      lastUpdated: new Date(),
    };
  }

  if (action.type === 'bulletin.loaded') {
    return {
      ...state,
      bulletinResponse: action.bulletin,
      bulletin: action.bulletin.cards,
      entities: {
        ...state.entities,
        bulletin: indexById(action.bulletin.cards),
      },
      lastUpdated: new Date(),
    };
  }

  if (action.type === 'connection.changed') {
    return {
      ...state,
      connection: action.connection,
      error: action.error || '',
    };
  }

  if (action.type === 'resync.requested') {
    return {
      ...state,
      connection: 'resyncing',
      needsResync: true,
      warning: action.reason,
    };
  }

  const ordered = [...action.events]
    .filter(event => Number.isFinite(event.seq))
    .sort((left, right) => left.seq - right.seq)
    .filter((event, index, events) => index === 0 || event.seq !== events[index - 1].seq);
  const fresh = ordered.filter(event => event.seq > state.cursor);
  if (!fresh.length) {
    return {
      ...state,
      connection: 'live',
      error: '',
    };
  }
  if (fresh[0].seq > state.cursor + 1) {
    return {
      ...state,
      connection: 'resyncing',
      needsResync: true,
      warning: `事件序号出现缺口：期望 ${state.cursor + 1}，收到 ${fresh[0].seq}`,
    };
  }

  let entities = state.entities;
  let needsResync = false;
  const dirty = new Set<WorkspaceDomain>();
  let cursor = state.cursor;

  for (const event of fresh) {
    if (event.seq !== cursor + 1) {
      needsResync = true;
      break;
    }
    cursor = event.seq;
    const projected = projectStructuredEvent(entities, event);
    entities = projected.entities;
    for (const domain of projected.dirtyDomains) dirty.add(domain);
    if (!projected.direct) needsResync = true;
    if (event.type === 'workspace.resync_required') needsResync = true;
  }

  return {
    ...state,
    core: materializeCore(state.core, entities),
    bulletin: Object.values(entities.bulletin),
    entities,
    cursor,
    connection: needsResync ? 'resyncing' : 'live',
    needsResync,
    dirtyDomains: [...dirty],
    error: '',
  };
}

export function normalizeEntities(
  core: WorkspaceCoreSnapshot,
  bulletin: BulletinCard[],
): WorkspaceEntities {
  return {
    tasks: indexById(core.taskBoard.tasks || []),
    queues: { ...(core.queues.queues || {}) },
    runners: { ...(core.runners.roles || {}) },
    bulletin: indexById(bulletin),
  };
}

function projectStructuredEvent(
  current: WorkspaceEntities,
  event: EngineEvent,
): { entities: WorkspaceEntities; direct: boolean; dirtyDomains: WorkspaceDomain[] } {
  if (event.type === 'task.upsert' && isRecord(event.task)) {
    const id = text(event.task.id);
    const status = text(event.task.status);
    if (id && TASK_STATUSES.includes(status as never)) {
      return {
        entities: {
          ...current,
          tasks: {
            ...current.tasks,
            [id]: { ...(current.tasks[id] || {}), ...event.task, id, status } as CeoTask,
          },
        },
        direct: true,
        dirtyDomains: ['tasks'],
      };
    }
  }
  if (event.type === 'task.remove') {
    const id = text(event.taskId);
    if (id) {
      const tasks = { ...current.tasks };
      delete tasks[id];
      return {
        entities: { ...current, tasks },
        direct: true,
        dirtyDomains: ['tasks'],
      };
    }
  }
  if (event.type === 'queue.upsert' && isRecord(event.queue)) {
    const agent = text(event.queue.agent);
    if (agent && Array.isArray(event.queue.queued) && Array.isArray(event.queue.running)) {
      return {
        entities: {
          ...current,
          queues: {
            ...current.queues,
            [agent]: event.queue as unknown as QueueState,
          },
        },
        direct: true,
        dirtyDomains: ['queues'],
      };
    }
  }
  if (event.type === 'runner.upsert' && isRecord(event.runner)) {
    const id = text(event.runner.id);
    const label = text(event.runner.label);
    if (id && label) {
      return {
        entities: {
          ...current,
          runners: {
            ...current.runners,
            [id]: {
              ...(current.runners[id] || {}),
              ...event.runner,
              label,
              status: current.runners[id]?.status || 'active',
            } as RoleConfig,
          },
        },
        direct: true,
        dirtyDomains: ['runners'],
      };
    }
  }
  if (event.type === 'bulletin.upsert' && isRecord(event.card)) {
    const id = text(event.card.id);
    const title = text(event.card.title);
    const status = text(event.card.status);
    if (id && title && BULLETIN_STATUSES.includes(status as never)) {
      return {
        entities: {
          ...current,
          bulletin: {
            ...current.bulletin,
            [id]: { ...(current.bulletin[id] || {}), ...event.card, id, title, status } as BulletinCard,
          },
        },
        direct: true,
        dirtyDomains: ['bulletin'],
      };
    }
  }
  if (event.type === 'bulletin.remove') {
    const id = text(event.cardId);
    if (id) {
      const bulletin = { ...current.bulletin };
      delete bulletin[id];
      return {
        entities: { ...current, bulletin },
        direct: true,
        dirtyDomains: ['bulletin'],
      };
    }
  }

  return {
    entities: current,
    direct: false,
    dirtyDomains: legacyEventDomains(event.type),
  };
}

function legacyEventDomains(type: string): WorkspaceDomain[] {
  if (type.startsWith('queue.')) return ['queues', 'tasks'];
  if (type.startsWith('task.') || type.startsWith('node.') || type.startsWith('engine.')) return ['tasks', 'queues'];
  if (type.startsWith('bulletin.')) return ['bulletin'];
  if (type.startsWith('runner.')) return ['runners'];
  if (type.startsWith('version.')) return ['version'];
  return [];
}

function materializeCore(
  core: WorkspaceCoreSnapshot | null,
  entities: WorkspaceEntities,
): WorkspaceCoreSnapshot | null {
  if (!core) return null;
  return {
    ...core,
    runners: {
      ...core.runners,
      roles: entities.runners,
    },
    queues: {
      ...core.queues,
      queues: entities.queues,
    },
    taskBoard: {
      ...core.taskBoard,
      tasks: Object.values(entities.tasks),
    },
  };
}

function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map(item => [item.id, item]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
