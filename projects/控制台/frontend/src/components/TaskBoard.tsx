import { Check, ChevronRight, Clock3, History, Pause, Play, Search, Trash2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cancelQueueItem, enableBulletin, removeBulletin } from '../lib/api';
import { formatElapsed, queueEntryTime, shortId, taskText, taskTitle } from '../lib/format';
import type {
  BulletinCard,
  CeoTask,
  QueueEntry,
  TaskHistoryItem,
  TaskNode,
  WorkspaceCoreSnapshot,
} from '../types';

type BoardMode = 'running' | 'queue' | 'past';
type RowKind = 'root' | 'queue' | 'bulletin' | 'history';

interface BoardRow {
  key: string;
  kind: RowKind;
  id: string;
  agent: string;
  agentLabel: string;
  title: string;
  fullText: string;
  status: string;
  statusText: string;
  time?: string;
  progress?: string;
  nodes?: TaskNode[];
  source?: string;
  project?: string;
  canCancel?: boolean;
  canEnable?: boolean;
  canRemove?: boolean;
}

interface TaskBoardProps {
  core: WorkspaceCoreSnapshot;
  bulletin: BulletinCard[];
  onRefresh: () => Promise<void> | void;
  onRefreshBulletin: () => Promise<void> | void;
}

export function TaskBoard({ core, bulletin, onRefresh, onRefreshBulletin }: TaskBoardProps) {
  const [mode, setMode] = useState<BoardMode>(() => {
    const stored = localStorage.getItem('yt6-react-task-board-mode');
    return stored === 'queue' || stored === 'past' ? stored : 'running';
  });
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [now, setNow] = useState(Date.now());
  const rows = useMemo(() => buildRows(core, bulletin), [bulletin, core]);
  const visibleRows = useMemo(() => {
    const source = rows[mode];
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((row) => [row.title, row.fullText, row.agentLabel, row.source, row.project, row.id]
      .some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [mode, query, rows]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const switchMode = (next: BoardMode) => {
    setMode(next);
    localStorage.setItem('yt6-react-task-board-mode', next);
  };

  const runAction = async (row: BoardRow, action: 'cancel' | 'enable' | 'remove') => {
    setBusyKey(`${row.key}:${action}`);
    setFeedback('正在处理');
    try {
      if (action === 'cancel') await cancelQueueItem(row.agent, row.id);
      if (action === 'enable') await enableBulletin(row.id);
      if (action === 'remove') await removeBulletin(row.id);
      setFeedback(action === 'cancel' ? '取消请求已提交' : action === 'enable' ? '任务已启用' : '待拍板已删除');
      await Promise.all([onRefresh(), onRefreshBulletin()]);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <aside className="task-board-panel" aria-labelledby="task-board-title">
      <div className="task-board-heading">
        <div>
          <p className="eyebrow">队列视图</p>
          <h2 id="task-board-title">任务板</h2>
        </div>
        <label className="board-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选任务" aria-label="筛选任务" />
        </label>
      </div>

      <div className="board-tabs" role="tablist" aria-label="任务状态">
        <BoardTab icon={<Play size={14} />} label="进行中" count={rows.running.length} selected={mode === 'running'} onClick={() => switchMode('running')} />
        <BoardTab icon={<Clock3 size={14} />} label="队列" count={rows.queue.length} selected={mode === 'queue'} onClick={() => switchMode('queue')} />
        <BoardTab icon={<History size={14} />} label="过往" count={rows.past.length} selected={mode === 'past'} onClick={() => switchMode('past')} />
      </div>

      <div className="task-list" role="tabpanel" aria-label={`${modeLabel(mode)}任务`}>
        {visibleRows.length ? visibleRows.map((row) => (
          <TaskCard
            key={row.key}
            row={row}
            now={now}
            busyKey={busyKey}
            onAction={runAction}
          />
        )) : <div className="task-empty">{query ? '没有匹配的任务' : `暂无${modeLabel(mode)}任务`}</div>}
      </div>
      <div className={`board-feedback ${/失败|错误/.test(feedback) ? 'error' : ''}`} role="status" aria-live="polite">{feedback}</div>
    </aside>
  );
}

function BoardTab({ icon, label, count, selected, onClick }: {
  icon: React.ReactNode;
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" role="tab" aria-selected={selected} className={selected ? 'selected' : ''} onClick={onClick}>
      {icon}<span>{label}</span><b>{count}</b>
    </button>
  );
}

function TaskCard({ row, now, busyKey, onAction }: {
  row: BoardRow;
  now: number;
  busyKey: string;
  onAction: (row: BoardRow, action: 'cancel' | 'enable' | 'remove') => Promise<void>;
}) {
  const statusTone = row.status === 'running'
    ? 'running'
    : row.status === 'failed'
      ? 'failed'
      : row.status === 'done'
        ? 'done'
        : row.status === 'paused'
          ? 'paused'
          : 'queued';
  return (
    <article className={`task-card task-${statusTone}`}>
      <div className="task-card-topline">
        <span className={`status-dot ${statusTone}`} />
        <span className="task-agent">{row.agentLabel}</span>
        <code>#{shortId(row.id)}</code>
        {row.source ? <span className="source-badge">{row.source}</span> : null}
      </div>
      <h3>{row.title}</h3>
      <div className="task-status-row">
        <span className={`status-pill ${statusTone}`}>{row.statusText}</span>
        {row.project ? <span>{row.project}</span> : null}
        {row.time ? <span>{formatElapsed(row.time, now)}</span> : null}
      </div>
      {row.progress ? <p className="task-progress"><ChevronRight size={14} />{row.progress}</p> : null}
      {row.nodes?.length ? (
        <div className="node-chain" aria-label="任务执行链路">
          {row.nodes.map((node, index) => (
            <span className={`node-${node.status || 'pending'}`} key={`${node.id || node.label}-${index}`} title={node.statusText || node.status}>
              {node.label || node.role || '节点'}
            </span>
          ))}
        </div>
      ) : null}
      {row.fullText && row.fullText !== row.title ? (
        <details className="task-details">
          <summary>完整内容</summary>
          <div>{row.fullText}</div>
        </details>
      ) : null}
      {row.canCancel || row.canEnable || row.canRemove ? (
        <div className="task-actions">
          {row.canEnable ? (
            <button type="button" onClick={() => void onAction(row, 'enable')} disabled={Boolean(busyKey)}>
              <Check size={15} />启用
            </button>
          ) : null}
          {row.canCancel ? (
            <button type="button" className="secondary" onClick={() => void onAction(row, 'cancel')} disabled={Boolean(busyKey)}>
              <Pause size={15} />取消
            </button>
          ) : null}
          {row.canRemove ? (
            <button type="button" className="danger-icon" onClick={() => void onAction(row, 'remove')} disabled={Boolean(busyKey)} title="删除待拍板" aria-label="删除待拍板">
              <Trash2 size={15} />
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function buildRows(core: WorkspaceCoreSnapshot, bulletin: BulletinCard[]) {
  const agentLabels = new Map(core.runners.queueAgents.map((agent) => [agent.id, agent.label]));
  const rootRunning = (core.taskBoard.tasks || [])
    .filter((task) => task.status === 'running')
    .map((task) => rootTaskRow(task));
  const rootQueued = (core.taskBoard.tasks || [])
    .filter((task) => task.status === 'queued' || task.status === 'paused')
    .map((task) => rootTaskRow(task));
  const runningQueue: BoardRow[] = [];
  const waitingQueue: BoardRow[] = [];

  for (const [agent, state] of Object.entries(core.queues.queues || {})) {
    if (agent === 'ceo') continue;
    const label = agentLabels.get(agent) || agent;
    for (const entry of state.running || []) runningQueue.push(queueTaskRow(agent, label, entry, 'running'));
    for (const entry of state.queued || []) waitingQueue.push(queueTaskRow(agent, label, entry, 'queued'));
    for (const entry of state.paused || []) waitingQueue.push(queueTaskRow(agent, label, entry, 'paused'));
  }

  const candidates = bulletin
    .filter((card) => card.status === 'todo' || card.status === '待拍板')
    .map(bulletinRow);
  const history = (core.taskBoard.history || []).map(historyRow);
  return {
    running: [...rootRunning, ...runningQueue],
    queue: [...rootQueued, ...waitingQueue, ...candidates],
    past: history,
  };
}

function rootTaskRow(task: CeoTask): BoardRow {
  const status = task.status || 'queued';
  return {
    key: `root:${task.id}`,
    kind: 'root',
    id: task.rootQueueId || task.action?.id || task.id,
    agent: task.action?.agent || task.rootQueueAgent || 'ceo',
    agentLabel: status === 'running' ? '主任务' : 'CEO 队列',
    title: taskTitle(task.brief || task.task),
    fullText: task.task || task.brief || '',
    status,
    statusText: task.statusText || statusLabel(status),
    time: task.started_at || task.enqueued_at,
    progress: task.progress?.text || task.downstream?.text,
    nodes: task.nodes || [],
    canCancel: status === 'queued' || status === 'paused',
  };
}

function queueTaskRow(agent: string, label: string, entry: QueueEntry, status: string): BoardRow {
  const fullText = taskText(entry.task);
  return {
    key: `queue:${agent}:${entry.id}:${status}`,
    kind: 'queue',
    id: entry.id,
    agent,
    agentLabel: label,
    title: taskTitle(fullText),
    fullText,
    status,
    statusText: statusLabel(status),
    time: queueEntryTime(entry),
    progress: String(entry.reason || entry.error || ''),
    canCancel: status === 'queued' || status === 'paused',
  };
}

function bulletinRow(card: BulletinCard): BoardRow {
  const fullText = [card.title, card.desc].filter(Boolean).join('\n\n');
  return {
    key: `bulletin:${card.id}`,
    kind: 'bulletin',
    id: card.id,
    agent: card.target || 'ceo',
    agentLabel: '待拍板',
    title: card.title,
    fullText,
    status: 'queued',
    statusText: '候选',
    time: card.created_at,
    source: card.source || '公告板',
    project: card.project,
    canEnable: true,
    canRemove: true,
  };
}

function historyRow(item: TaskHistoryItem): BoardRow {
  const status = item.status === 'done' || item.ok ? 'done' : 'failed';
  const fullText = item.task || '';
  return {
    key: `history:${item.key || `${item.agent}:${item.id}`}`,
    kind: 'history',
    id: item.id || item.taskId || item.key || '-',
    agent: item.agent || 'history',
    agentLabel: item.agent || '历史',
    title: taskTitle(fullText || item.reason || item.error),
    fullText,
    status,
    statusText: status === 'done' ? '完成' : '失败',
    time: item.finished_at || item.started_at || item.enqueued_at,
    progress: item.reason || item.error,
  };
}

function statusLabel(status: string): string {
  if (status === 'running') return '运行中';
  if (status === 'paused') return '暂停';
  if (status === 'done') return '完成';
  if (status === 'failed') return '失败';
  return '排队中';
}

function modeLabel(mode: BoardMode): string {
  if (mode === 'running') return '进行中';
  if (mode === 'queue') return '队列';
  return '过往';
}
