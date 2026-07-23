import { Activity, Bot, CircleCheck, History, Network, Play, RefreshCw, Square, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceRenderContext } from '../../app/WorkspaceShell';
import { fetchControlRoomOverview, fetchHistory, probeRunner, streamRunnerChat } from '../../lib/api';

type Row = Record<string, unknown>;

export default function ControlRoomView({ workspace }: { workspace: WorkspaceRenderContext }) {
  const [overview, setOverview] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [runner, setRunner] = useState(() => workspace.core.runners.runners[0]?.id || 'mock');
  const [message, setMessage] = useState('只回复“控制室 runner 正常”。');
  const [output, setOutput] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [probeState, setProbeState] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOverview, nextHistory] = await Promise.all([
        fetchControlRoomOverview(),
        fetchHistory(16),
      ]);
      setOverview(nextOverview);
      setHistory(nextHistory);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '控制室读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const runProbe = async () => {
    setProbeState('探测中');
    try {
      const result = await probeRunner(runner);
      setProbeState(result.ok === true ? `正常 · ${String(result.version || 'ready')}` : `异常 · ${String(result.error || 'unknown')}`);
    } catch (probeError) {
      setProbeState(probeError instanceof Error ? probeError.message : '探测失败');
    }
  };

  const runChat = async () => {
    if (!message.trim() || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setOutput('');
    setLogs([]);
    setRunning(true);
    try {
      await streamRunnerChat(runner, message.trim(), controller.signal, item => {
        if (item.type === 'delta' && item.text) setOutput(value => value + item.text);
        else if (item.type === 'log' && item.text) setLogs(value => [...value.slice(-39), item.text || '']);
        else if (item.type === 'error' && item.text) setLogs(value => [...value.slice(-39), `错误：${item.text}`]);
      });
      await load();
    } catch (chatError) {
      if ((chatError as Error).name !== 'AbortError') setLogs(value => [...value, chatError instanceof Error ? chatError.message : '运行失败']);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const agents = arrayRows(overview?.agents);
  const runners = arrayRows(overview?.runners);
  const flows = arrayRows(overview?.flows);
  const events = arrayRows(isRecord(overview?.events) ? overview?.events.events : []).slice(-80);
  const metrics = useMemo(() => [
    { label: '系统智能体', value: agents.length, icon: <Bot size={16} /> },
    { label: 'Runner', value: runners.length, icon: <Network size={16} /> },
    { label: '流程', value: flows.length, icon: <Workflow size={16} /> },
    { label: '近期事件', value: events.length, icon: <Activity size={16} /> },
  ], [agents.length, events.length, flows.length, runners.length]);

  return (
    <main className="control-room-view" aria-labelledby="control-room-title" aria-busy={loading}>
      <header className="route-heading">
        <div><p className="eyebrow">系统只读监控 + Runner 冒烟</p><h1 id="control-room-title">控制室</h1></div>
        <button className="icon-button" type="button" onClick={() => void load()} disabled={loading} aria-label="刷新控制室"><RefreshCw size={17} className={loading ? 'spin' : ''} /></button>
      </header>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      <section className="route-metrics">{metrics.map(item => <div key={item.label}><span>{item.icon}</span><strong>{item.value}</strong><small>{item.label}</small></div>)}</section>

      <section className="control-grid">
        <div className="route-panel">
          <header><h2>Runner 冒烟</h2><span>{probeState || '未探测'}</span></header>
          <div className="runner-console">
            <div className="runner-toolbar">
              <select value={runner} onChange={event => setRunner(event.target.value)} aria-label="选择 runner">
                {workspace.core.runners.runners.map(item => <option value={item.id} key={item.id}>{item.label || item.id}</option>)}
              </select>
              <button type="button" onClick={() => void runProbe()}><CircleCheck size={15} />探测</button>
            </div>
            <textarea value={message} onChange={event => setMessage(event.target.value)} rows={3} aria-label="Runner 测试消息" />
            <div className="runner-actions">
              <button type="button" onClick={() => void runChat()} disabled={running}><Play size={15} />运行</button>
              <button type="button" onClick={() => abortRef.current?.abort()} disabled={!running}><Square size={14} />停止</button>
            </div>
            <div className="runner-output"><strong>回答</strong><pre>{output || '尚未运行'}</pre></div>
            {logs.length ? <details><summary>过程日志 ({logs.length})</summary><pre>{logs.join('\n')}</pre></details> : null}
          </div>
        </div>
        <div className="route-panel">
          <header><h2>最近运行</h2><span>{history.length}</span></header>
          <div className="compact-list">{history.length ? history.map((item, index) => (
            <article key={`${String(item.ts)}:${index}`}>
              <span className={item.ok === true ? 'ok-dot' : 'bad-dot'} />
              <div><strong>{String(item.runner || 'runner')}</strong><p>{String(item.task || '')}</p></div>
              <time>{formatTime(item.ts)}</time>
            </article>
          )) : <div className="route-empty"><History size={17} />暂无历史</div>}</div>
        </div>
        <div className="route-panel">
          <header><h2>系统智能体</h2><span>{agents.length}</span></header>
          <div className="compact-list">{agents.map((item, index) => (
            <article key={String(item.id || index)}><span className="ok-dot" /><div><strong>{String(item.name || item.id || '智能体')}</strong><p>{String(item.role || '')} · {String(item.runner || '')}</p></div></article>
          ))}</div>
        </div>
        <div className="route-panel">
          <header><h2>Runner 与流程</h2><span>{runners.length + flows.length}</span></header>
          <div className="compact-list">
            {runners.map((item, index) => <article key={`r:${String(item.id || index)}`}><span className="neutral-dot" /><div><strong>{String(item.id || 'runner')}</strong><p>{String(item.kind || '')} · {String(item.role || '')}</p></div></article>)}
            {flows.map((item, index) => <article key={`f:${String(item.id || index)}`}><span className="flow-dot" /><div><strong>{String(item.id || 'flow')}</strong><p>{String(item.nodes || 0)} 节点 · {String(item.file || '')}</p></div></article>)}
          </div>
        </div>
        <div className="route-panel control-events">
          <header><h2>引擎事件流</h2><span>最多 80 条</span></header>
          <div className="event-ledger">{events.map((event, index) => (
            <article key={`${String(event.seq)}:${index}`}><code>#{String(event.seq || '-')}</code><strong>{String(event.type || 'event')}</strong><span>{String(event.node || event.to || event.task || '')}</span></article>
          ))}</div>
        </div>
      </section>
    </main>
  );
}

function isRecord(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function arrayRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function formatTime(value: unknown): string {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('zh-CN', { hour12: false });
}
