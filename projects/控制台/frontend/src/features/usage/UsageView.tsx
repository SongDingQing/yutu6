import { Activity, Database, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fetchLlmUsageOverview } from '../../lib/api';
import type { LlmUsageModel, LlmUsageOverview } from '../../types';
import type { WorkspaceRenderContext } from '../../app/WorkspaceShell';
import { officialQuotaLabel, sourceNote, usageMetric } from './model';

const CACHE_MS = 60_000;
let usageCache: { days: number; at: number; value: LlmUsageOverview } | null = null;

export default function UsageView({ workspace }: { workspace: WorkspaceRenderContext }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<LlmUsageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      if (!force && usageCache && usageCache.days === days && Date.now() - usageCache.at < CACHE_MS) {
        setData(usageCache.value);
      } else {
        const next = await fetchLlmUsageOverview(days);
        usageCache = { days, at: Date.now(), value: next };
        setData(next);
      }
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '模型用量读取失败');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="usage-view" aria-labelledby="usage-title">
      <header className="usage-heading">
        <div>
          <p className="eyebrow">AI-FE-10 · 可核对口径</p>
          <h1 id="usage-title">模型用量</h1>
          <p>订阅、本地日志和 new-api 分开呈现；没有可靠数据时明确标为“未计量”。</p>
        </div>
        <div className="usage-controls">
          <div className="segmented-control" role="group" aria-label="统计窗口">
            {[1, 7, 30].map(value => (
              <button type="button" className={days === value ? 'active' : ''} onClick={() => setDays(value)} key={value}>
                {value === 1 ? '24 小时' : `${value} 天`}
              </button>
            ))}
          </div>
          <button className="icon-button" type="button" onClick={() => void load(true)} disabled={loading} aria-label="刷新模型用量" title="刷新模型用量">
            <RefreshCw className={loading ? 'spin' : ''} size={17} />
          </button>
        </div>
      </header>

      {error ? <div className="error-banner" role="alert">{error}</div> : null}
      <section className="usage-source-strip" aria-label="数据说明">
        <span><Database size={15} />服务端读取本机观测数据</span>
        <span><ShieldCheck size={15} />页面不接触 API key 或 token</span>
        <span><Activity size={15} />不新增模型健康探测</span>
      </section>

      <section className="usage-card-grid" aria-live="polite" aria-busy={loading}>
        {data?.models.length ? data.models.map(model => <ModelUsageCard model={model} key={model.id} />) : (
          <div className="usage-empty">{loading ? '正在读取用量数据' : '暂无模型观测数据'}</div>
        )}
      </section>

      <section className="usage-notes">
        <div>
          <h2>调度建议</h2>
          <ul>{(data?.strategy || []).map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
        <div>
          <h2>口径限制</h2>
          <ul>{(data?.caveats || []).map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      </section>

      <footer className="usage-footer">
        <span>单任务 token、耗时与重试请在任务板的结构化详情中核对。</span>
        <span>活跃工位 {Object.values(workspace.core.queues.queues).filter(queue => queue.running.length).length}</span>
      </footer>
    </main>
  );
}

function ModelUsageCard({ model }: { model: LlmUsageModel }) {
  const calls = usageMetric(model, 'calls');
  const input = usageMetric(model, 'input_tokens');
  const output = usageMetric(model, 'output_tokens');
  const total = usageMetric(model, 'total_tokens');
  const agents = (model.agents || []).slice(0, 5);
  return (
    <article className="usage-card">
      <header>
        <div>
          <span className={`source-state ${model.sourceStatus === 'ok' ? 'ok' : 'warn'}`} />
          <div><h2>{model.label || model.id}</h2><p>{model.provider || 'Provider 未记录'}</p></div>
        </div>
        <span className="billing-badge">{model.billingLabel || model.billingMode || '计费未知'}</span>
      </header>
      <div className="usage-metrics">
        <UsageValue label="调用" metric={calls} />
        <UsageValue label="输入 token" metric={input} />
        <UsageValue label="输出 token" metric={output} />
        <UsageValue label="总 token" metric={total} />
      </div>
      <div className="usage-accounting">
        <span><strong>统计窗口</strong>{model.currentUsage?.windowLabel || '未记录'}</span>
        <span><strong>官方口径</strong>{officialQuotaLabel(model)}</span>
        <span><strong>数据源</strong>{sourceNote(model)}</span>
      </div>
      {agents.length ? (
        <div className="usage-agent-list">
          {agents.map((agent, index) => {
            const record = typeof agent === 'string' ? null : agent;
            const label = typeof agent === 'string'
              ? agent
              : String(record?.label || record?.id || `智能体 ${index + 1}`);
            return <span key={`${label}:${index}`}>{label}</span>;
          })}
        </div>
      ) : null}
      {model.sourceStatus !== 'ok' ? (
        <p className="usage-warning"><TriangleAlert size={15} />当前数据源不可用，数值没有按 0 处理。</p>
      ) : null}
    </article>
  );
}

function UsageValue({ label, metric }: { label: string; metric: ReturnType<typeof usageMetric> }) {
  return (
    <div className={metric.measured ? '' : 'unmeasured'}>
      <span>{label}</span>
      <strong>{metric.value}</strong>
      <small>{metric.note}</small>
    </div>
  );
}
