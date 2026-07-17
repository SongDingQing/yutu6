import { Activity, CircleCheck, Clock3, Layers3 } from 'lucide-react';
import { formatElapsed, shortId, taskPresentation } from '../lib/format';
import type { WorkspaceCoreSnapshot } from '../types';

interface OperationalOverviewProps {
  core: WorkspaceCoreSnapshot;
}

export function OperationalOverview({ core }: OperationalOverviewProps) {
  const queueRows = Object.entries(core.queues.queues || {});
  const running = queueRows.reduce((sum, [, state]) => sum + (state.running?.length || 0), 0);
  const queued = queueRows.reduce((sum, [, state]) => sum + (state.queued?.length || 0), 0);
  const paused = queueRows.reduce((sum, [, state]) => sum + (state.paused?.length || 0), 0);
  const completed = queueRows.reduce((sum, [, state]) => sum + Number(state.done || 0), 0);
  const activeAgents = queueRows
    .map(([id, state]) => ({
      id,
      label: core.runners.queueAgents.find((agent) => agent.id === id)?.label || id,
      running: state.running?.length || 0,
      queued: state.queued?.length || 0,
      paused: state.paused?.length || 0,
    }))
    .filter((row) => row.running || row.queued || row.paused)
    .sort((a, b) => b.running - a.running || b.queued - a.queued);
  const activeTasks = (core.taskBoard.tasks || []).filter((task) => task.status === 'running').slice(0, 4);

  return (
    <section className="overview" aria-labelledby="overview-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">实时运行</p>
          <h1 id="overview-title">团队概览</h1>
        </div>
        <span className="health-indicator"><span />本机在线</span>
      </div>

      <div className="metric-grid">
        <Metric icon={<Activity size={17} />} label="运行中" value={running} tone="blue" />
        <Metric icon={<Clock3 size={17} />} label="排队" value={queued + paused} tone="amber" />
        <Metric icon={<Layers3 size={17} />} label="活跃工位" value={activeAgents.length} tone="cyan" />
        <Metric icon={<CircleCheck size={17} />} label="已完成" value={completed} tone="green" />
      </div>

      <div className="overview-columns">
        <div className="overview-block">
          <div className="subheading"><h2>当前流转</h2><span>{activeTasks.length}</span></div>
          <div className="flow-list">
            {activeTasks.length ? activeTasks.map((task) => {
              const presentation = taskPresentation(task.brief || task.task, 72, 150);
              return (
                <article className="flow-row" key={task.id}>
                  <div className="flow-row-kicker">
                    <span>主任务</span>
                    <code>#{shortId(task.rootQueueId || task.id)}</code>
                  </div>
                  <h3>{presentation.title}</h3>
                  {presentation.purpose ? (
                    <p className="flow-purpose"><span>目的</span>{presentation.purpose}</p>
                  ) : null}
                  <div className="flow-meta">
                    <span className="flow-state">{task.statusText || task.progress?.text || '处理中'}</span>
                    <span>{task.downstream?.roleLabel || 'CEO'}</span>
                    <span>{formatElapsed(task.started_at)}</span>
                  </div>
                </article>
              );
            }) : <EmptyLine label="暂无运行中的主任务" />}
          </div>
        </div>

        <div className="overview-block">
          <div className="subheading"><h2>工位负载</h2><span>{activeAgents.length}</span></div>
          <div className="agent-load-list">
            {activeAgents.length ? activeAgents.map((agent) => (
              <div className="agent-load-row" key={agent.id}>
                <div><strong>{agent.label}</strong><small>{agent.id}</small></div>
                <div className="load-counts">
                  {agent.running ? <span className="run">运行 {agent.running}</span> : null}
                  {agent.queued ? <span>队列 {agent.queued}</span> : null}
                  {agent.paused ? <span>暂停 {agent.paused}</span> : null}
                </div>
              </div>
            )) : <EmptyLine label="所有工位空闲" />}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className={`metric metric-${tone}`}>
      <span className="metric-icon">{icon}</span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}

function EmptyLine({ label }: { label: string }) {
  return <div className="empty-line">{label}</div>;
}
