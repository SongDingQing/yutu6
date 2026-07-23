import { Check, ChevronRight, CircleHelp, Clock3, Copy, ExternalLink, History, LoaderCircle, Pause, Play, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNow } from '../../hooks/useNow';
import { cancelQueueItem, enableBulletin, fetchTaskDetail, removeBulletin, retryQueueItem } from '../../lib/api';
import { formatElapsed, queueEntryTime, shortId, taskPresentation, taskText } from '../../lib/format';
import { calculateVirtualWindow } from '../../lib/virtualWindow';
import type {
  BulletinCard,
  CeoTask,
  QueueEntry,
  TaskDetailResponse,
  TaskHistoryItem,
  TaskNode,
  WorkspaceCoreSnapshot,
} from '../../types';
import { BulletinSourceBadge } from '../bulletin/BulletinSourceBadge';

type BoardMode = 'running' | 'queue' | 'decision' | 'past';
type RowKind = 'root' | 'queue' | 'bulletin' | 'history';
const VIRTUALIZE_AFTER = 60;
const VIRTUAL_ROW_HEIGHT = 248;

interface BoardRow {
  key: string;
  kind: RowKind;
  id: string;
  taskId?: string;
  agent: string;
  agentLabel: string;
  title: string;
  purpose?: string;
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
    return stored === 'queue' || stored === 'decision' || stored === 'past' ? stored : 'running';
  });
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [selectedRow, setSelectedRow] = useState<BoardRow | null>(null);
  const rows = useMemo(() => buildRows(core, bulletin), [bulletin, core]);
  const visibleRows = useMemo(() => {
    const source = rows[mode];
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((row) => [row.title, row.fullText, row.agentLabel, row.source, row.project, row.id]
      .some((value) => String(value || '').toLowerCase().includes(needle)));
  }, [mode, query, rows]);

  const switchMode = (next: BoardMode) => {
    setMode(next);
    localStorage.setItem('yt6-react-task-board-mode', next);
  };

  const runAction = useCallback(async (row: BoardRow, action: 'cancel' | 'enable' | 'remove') => {
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
  }, [onRefresh, onRefreshBulletin]);

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
        <BoardTab icon={<CircleHelp size={14} />} label="待拍板" count={rows.decision.length} selected={mode === 'decision'} onClick={() => switchMode('decision')} />
        <BoardTab icon={<History size={14} />} label="过往" count={rows.past.length} selected={mode === 'past'} onClick={() => switchMode('past')} />
      </div>

      <TaskList
        rows={visibleRows}
        mode={mode}
        query={query}
        busyKey={busyKey}
        onAction={runAction}
        onOpen={setSelectedRow}
      />
      <div className={`board-feedback ${/失败|错误/.test(feedback) ? 'error' : ''}`} role="status" aria-live="polite">{feedback}</div>
      {selectedRow ? (
        <TaskDetailPanel
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
          onRefresh={async () => {
            await onRefresh();
            setSelectedRow(null);
          }}
        />
      ) : null}
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

const TaskCard = memo(function TaskCard({ row, busyKey, onAction, onOpen }: {
  row: BoardRow;
  busyKey: string;
  onAction: (row: BoardRow, action: 'cancel' | 'enable' | 'remove') => Promise<void>;
  onOpen: (row: BoardRow) => void;
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
        <BulletinSourceBadge source={row.source} />
      </div>
      <h3>{row.title}</h3>
      {row.purpose ? <p className="task-purpose"><span>目的</span>{row.purpose}</p> : null}
      <div className="task-status-row">
        <span className={`status-pill ${statusTone}`}>{row.statusText}</span>
        {row.project ? <span>{row.project}</span> : null}
        {row.time ? <ElapsedTime value={row.time} /> : null}
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
      {row.fullText || row.progress || row.nodes?.length ? (
        <button className="task-detail-trigger" type="button" onClick={() => onOpen(row)}>查看详情</button>
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
});

function TaskList({ rows, mode, query, busyKey, onAction, onOpen }: {
  rows: BoardRow[];
  mode: BoardMode;
  query: string;
  busyKey: string;
  onAction: (row: BoardRow, action: 'cancel' | 'enable' | 'remove') => Promise<void>;
  onOpen: (row: BoardRow) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });
  const virtualized = rows.length > VIRTUALIZE_AFTER;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setViewport({
      scrollTop: element.scrollTop,
      height: element.clientHeight || 600,
    });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode]);

  const window = calculateVirtualWindow({
    count: rows.length,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    rowHeight: VIRTUAL_ROW_HEIGHT,
  });
  const rendered = virtualized ? rows.slice(window.start, window.end) : rows;

  return (
    <div
      ref={containerRef}
      className={`task-list ${virtualized ? 'is-virtualized' : ''}`}
      role="tabpanel"
      aria-label={`${modeLabel(mode)}任务`}
      onScroll={(event) => {
        if (!virtualized) return;
        const element = event.currentTarget;
        setViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
      }}
    >
      {rows.length ? (
        virtualized ? (
          <div className="virtual-task-space" style={{ height: window.totalHeight }}>
            <div className="virtual-task-window" style={{ transform: `translateY(${window.offsetTop}px)` }}>
              {rendered.map(row => (
                <div className="virtual-task-row" key={row.key}>
                  <TaskCard row={row} busyKey={busyKey} onAction={onAction} onOpen={onOpen} />
                </div>
              ))}
            </div>
          </div>
        ) : rendered.map(row => (
          <TaskCard key={row.key} row={row} busyKey={busyKey} onAction={onAction} onOpen={onOpen} />
        ))
      ) : <div className="task-empty">{query ? '没有匹配的任务' : `暂无${modeLabel(mode)}任务`}</div>}
    </div>
  );
}

const ElapsedTime = memo(function ElapsedTime({ value }: { value: string }) {
  const now = useNow();
  return <span>{formatElapsed(value, now)}</span>;
});

function TaskDetailPanel({ row, onClose, onRefresh }: {
  row: BoardRow;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<TaskDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(row.status === 'running');
  const [actionState, setActionState] = useState('');
  const eventListRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      const next = await fetchTaskDetail(row.agent, row.id, row.taskId);
      setDetail(next);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '任务详情读取失败');
    }
  }, [row.agent, row.id, row.taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [live, load]);

  useEffect(() => {
    if (!live || !eventListRef.current || !detail) return;
    eventListRef.current.scrollTop = eventListRef.current.scrollHeight;
  }, [detail, live]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const copySummary = async () => {
    const task = detail?.task;
    const text = task
      ? [
        `任务：${task.goal || row.title}`,
        `状态：${task.status}`,
        task.acceptance ? `验收：${task.acceptance}` : '',
        task.currentStep ? `当前：${task.currentStep.summary}` : '',
        task.reason ? `原因：${task.reason}` : '',
        detail.artifacts.length ? `产物：\n${detail.artifacts.map(item => item.path).join('\n')}` : '',
      ].filter(Boolean).join('\n\n')
      : row.fullText;
    await navigator.clipboard.writeText(text);
    setActionState('摘要已复制');
  };

  const retry = async () => {
    setActionState('正在重试');
    try {
      await retryQueueItem(row.agent, row.id);
      setActionState('已重新入队');
      await onRefresh();
    } catch (retryError) {
      setActionState(retryError instanceof Error ? retryError.message : '重试失败');
    }
  };

  const task = detail?.task;
  const events = task?.events.slice(-120) || [];

  return (
    <div className="task-detail-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="task-detail-panel" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
        <header>
          <div>
            <p className="eyebrow">{row.agentLabel} · #{shortId(row.id)}</p>
            <h2 id="task-detail-title">{row.title}</h2>
          </div>
          <div className="task-detail-header-actions">
            <button className="icon-button" type="button" onClick={() => void copySummary()} aria-label="复制任务摘要" title="复制任务摘要"><Copy size={17} /></button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="关闭任务详情"><X size={18} /></button>
          </div>
        </header>
        <div className="task-detail-body">
          {!detail && !error ? <div className="detail-loading"><LoaderCircle className="spin" size={18} />读取结构化任务轨迹</div> : null}
          {error ? <div className="detail-error" role="alert">{error}<button type="button" onClick={() => void load()}>重试读取</button></div> : null}
          {task ? (
            <>
              <section className="task-detail-summary">
                <div><span>状态</span><strong>{statusLabel(task.status)}</strong></div>
                <div><span>执行者</span><strong>{task.role || row.agentLabel}</strong></div>
                <div><span>Runner</span><strong>{task.runner || '未记录'}</strong></div>
                <div><span>模型</span><strong>{task.model || '未记录'}</strong></div>
                <div><span>Provider</span><strong>{task.provider || '未记录'}</strong></div>
                <div><span>重试</span><strong>{task.retryCount}</strong></div>
              </section>
              <section><h3>任务目的</h3><p>{task.goal || row.purpose || row.title}</p></section>
              {task.acceptance ? <section><h3>验收标准</h3><p>{task.acceptance}</p></section> : null}
              {task.currentStep ? <section className="current-step"><h3>当前步骤</h3><p>{task.currentStep.summary}</p></section> : null}
              {task.reason ? <section className="failure-reason"><h3>失败原因</h3><p>{task.reason}</p></section> : null}
            </>
          ) : null}
          {row.nodes?.length ? (
            <section>
              <h3>执行链路</h3>
              <div className="detail-node-list">{row.nodes.map((node, index) => (
                <span className={`node-${node.status}`} key={`${node.id || node.label}-${index}`}>
                  {node.label || node.role || '节点'} · {node.statusText || node.status}
                </span>
              ))}</div>
            </section>
          ) : null}
          {task ? (
            <details open={task.status === 'failed' || task.status === 'running'}>
              <summary>结构化执行轨迹 <span>{events.length}</span></summary>
              <div className="detail-stream-controls">
                <button type="button" onClick={() => setLive(value => !value)}>
                  {live ? <><Pause size={14} />暂停跟随</> : <><Play size={14} />继续跟随</>}
                </button>
                <button type="button" onClick={() => void load()}><RotateCcw size={14} />刷新</button>
              </div>
              <div className="detail-event-list" ref={eventListRef}>
                {events.length ? events.map((event, index) => (
                  <article key={`${event.seq}:${event.type}:${index}`}>
                    <time>{event.ts ? new Date(event.ts).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--'}</time>
                    <div><strong>{event.type}</strong><p>{event.summary}</p></div>
                  </article>
                )) : <p className="detail-empty">暂无结构化事件</p>}
              </div>
            </details>
          ) : null}
          {detail?.artifacts.length ? (
            <section>
              <h3>证据与产物</h3>
              <div className="artifact-list">{detail.artifacts.map(artifact => (
                <a href={artifact.url} target="_blank" rel="noreferrer" key={artifact.path}>
                  <span>{artifact.name}</span>
                  <small>{artifact.path}</small>
                  <ExternalLink size={14} />
                </a>
              ))}</div>
            </section>
          ) : null}
          {!detail && row.fullText ? <section><h3>任务摘要</h3><pre>{row.fullText}</pre></section> : null}
          {task?.status === 'failed' || task?.status === 'canceled' ? (
            <div className="task-detail-footer">
              <button type="button" onClick={() => void retry()} disabled={actionState === '正在重试'}><RotateCcw size={15} />重新入队</button>
            </div>
          ) : null}
          {actionState ? <div className="detail-action-state" role="status">{actionState}</div> : null}
        </div>
      </section>
    </div>
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
    queue: [...rootQueued, ...waitingQueue],
    decision: candidates,
    past: history,
  };
}

function rootTaskRow(task: CeoTask): BoardRow {
  const status = task.status || 'queued';
  const fullText = task.task || task.brief || '';
  const presentation = taskPresentation(task.brief || task.task);
  return {
    key: `root:${task.id}`,
    kind: 'root',
    id: task.rootQueueId || task.action?.id || task.id,
    taskId: task.rootTaskId || task.action?.taskId,
    agent: task.action?.agent || task.rootQueueAgent || 'ceo',
    agentLabel: status === 'running' ? '主任务' : 'CEO 队列',
    title: presentation.title,
    purpose: presentation.purpose,
    fullText,
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
  const presentation = taskPresentation(fullText);
  return {
    key: `queue:${agent}:${entry.id}:${status}`,
    kind: 'queue',
    id: entry.id,
    taskId: entry.taskId,
    agent,
    agentLabel: label,
    title: presentation.title,
    purpose: presentation.purpose,
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
  const presentation = taskPresentation(fullText);
  return {
    key: `bulletin:${card.id}`,
    kind: 'bulletin',
    id: card.id,
    agent: card.target || 'ceo',
    agentLabel: '待拍板',
    title: presentation.title,
    purpose: presentation.purpose,
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
  const presentation = taskPresentation(fullText || item.reason || item.error);
  return {
    key: `history:${item.key || `${item.agent}:${item.id}`}`,
    kind: 'history',
    id: item.id || item.taskId || item.key || '-',
    taskId: item.taskId,
    agent: item.agent || 'history',
    agentLabel: item.agent || '历史',
    title: presentation.title,
    purpose: presentation.purpose,
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
  if (mode === 'decision') return '待拍板';
  return '过往';
}
