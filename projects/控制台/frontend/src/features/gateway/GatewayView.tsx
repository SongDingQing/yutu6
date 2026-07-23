import {
  Bot,
  Boxes,
  Cable,
  ExternalLink,
  Gauge,
  RefreshCw,
  ScrollText,
  Waypoints,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceRenderContext } from '../../app/WorkspaceShell';
import {
  fetchModelFabricOverview,
  fetchModelFabricUsage,
  fetchNewApiOverview,
} from '../../lib/api';

type Row = Record<string, unknown>;
const CACHE_KEY = 'yutu6-react-model-fabric-cache-v1';
const CACHE_MS = 60_000;

export default function GatewayView({ workspace }: { workspace: WorkspaceRenderContext }) {
  const [days, setDays] = useState(7);
  const [fabric, setFabric] = useState<Row | null>(null);
  const [usage, setUsage] = useState<Row | null>(null);
  const [compat, setCompat] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      if (!force) {
        const cached = readCache(days);
        if (cached) {
          setFabric(cached.fabric);
          setUsage(cached.usage);
          setCompat(cached.compat);
          setError('');
          setLoading(false);
          return;
        }
      }
      const [fabricResult, usageResult, compatResult] = await Promise.allSettled([
        fetchModelFabricOverview(),
        fetchModelFabricUsage(days),
        fetchNewApiOverview(),
      ]);
      const nextFabric = fabricResult.status === 'fulfilled' ? fabricResult.value : null;
      const nextUsage = usageResult.status === 'fulfilled' ? usageResult.value : null;
      const nextCompat = compatResult.status === 'fulfilled' ? compatResult.value : null;
      if (!nextFabric) throw fabricResult.status === 'rejected' ? fabricResult.reason : new Error('中枢未返回概览');
      setFabric(nextFabric);
      setUsage(nextUsage);
      setCompat(nextCompat);
      writeCache(days, nextFabric, nextUsage || {}, nextCompat || {});
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '模型与智能体中枢读取失败');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = record(fabric?.metrics);
  const migration = record(fabric?.migration);
  const providers = rows(fabric?.providers);
  const models = rows(fabric?.models);
  const agents = rows(fabric?.agents);
  const capabilities = rows(fabric?.capabilities);
  const usageData = record(usage?.usage);
  const totals = record(usageData.totals);
  const byModel = rows(usageData.by_model);
  const recent = rows(usageData.recent).slice(0, 20);
  const compatRoutes = record(compat?.routes);
  const compatBase = String(compat?.baseUrl || 'http://localhost:3000');
  const fabricBase = String(fabric?.base_url || 'http://127.0.0.1:3020');

  return (
    <main className="gateway-view" aria-labelledby="gateway-title" aria-busy={loading}>
      <header className="route-heading">
        <div>
          <p className="eyebrow">Model Fabric · 模型、智能体与能力的统一控制面</p>
          <h1 id="gateway-title">模型与智能体中枢</h1>
        </div>
        <div className="gateway-controls">
          <span className={fabric?.ok === true ? 'status-pill done' : 'status-pill failed'}>
            {fabric?.ok === true ? '中枢在线' : '中枢离线'}
          </span>
          <select value={days} onChange={event => setDays(Number(event.target.value))} aria-label="中枢统计时间">
            <option value={1}>今天</option><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option>
          </select>
          <button className="icon-button" type="button" onClick={() => void load(true)} disabled={loading} aria-label="刷新中枢"><RefreshCw size={17} className={loading ? 'spin' : ''} /></button>
        </div>
      </header>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}

      <section className="gateway-resource-grid">
        <GatewayLink icon={<Waypoints size={18} />} title="模型目录" text="逻辑模型、能力和具体 deployment" href="#fabric-models" />
        <GatewayLink icon={<Gauge size={18} />} title="路由与健康" text="provider 状态、熔断和故障转移" href="#fabric-providers" />
        <GatewayLink icon={<Bot size={18} />} title="智能体目录" text="真实角色、runner 与 A2A 入口" href="#fabric-agents" />
        <GatewayLink icon={<Cable size={18} />} title="OpenAI 兼容入口" text={fabricBase.replace(/^https?:\/\//, '') + '/v1'} href={`${fabricBase}/v1/models`} external />
      </section>

      <section className="route-metrics gateway-metrics">
        <Metric label="Provider" value={metrics.providers} note={`健康 ${formatValue(metrics.healthy_providers)}`} />
        <Metric label="模型" value={metrics.models} note="逻辑模型目录" />
        <Metric label="智能体" value={metrics.agents} note={`${formatValue(metrics.capabilities)} 项共享能力`} />
        <Metric label={`${days} 天调用`} value={totals.calls} note={`${formatValue(totals.total_tokens)} tokens`} />
        <Metric label="故障转移" value={totals.failovers} note={`失败 ${formatValue(totals.failed_calls)}`} />
      </section>

      <section className="gateway-data-grid" id="fabric-providers">
        <div className="route-panel">
          <header><h2>上游健康</h2><span>{providers.length}</span></header>
          <div className="compact-list">
            {providers.map(provider => {
              const health = record(provider.health);
              return (
                <article key={String(provider.id)}>
                  <span className={health.state === 'healthy' ? 'ok-dot' : 'neutral-dot'} />
                  <div><strong>{String(provider.label || provider.id)}</strong><p>{String(provider.role || 'provider')} · {String(health.state || 'unknown')}</p></div>
                  <time>{formatMs(health.latency_ms)}</time>
                </article>
              );
            })}
          </div>
        </div>
        <div className="route-panel">
          <header><h2>迁移状态</h2><span>{String(fabric?.mode || 'unknown')}</span></header>
          <div className="gateway-migration-copy">
            <strong>{String(migration.phase || '未读取')}</strong>
            <p>当前前门：{String(migration.front_door || fabricBase)}</p>
            <p>直连覆盖 {formatValue(migration.direct_model_coverage)} / 兼容层覆盖 {formatValue(migration.compatibility_model_coverage)}</p>
            <p>{migration.ready_to_retire_new_api === true ? '已具备退役旧网关条件' : 'new-api 仍作为兼容上游与回滚点'}</p>
          </div>
        </div>
      </section>

      <section className="gateway-data-grid" id="fabric-models">
        <div className="route-panel">
          <header><h2>模型目录</h2><span>{models.length}</span></header>
          <div className="gateway-table-wrap"><table><thead><tr><th>模型</th><th>模态</th><th>能力</th><th>Deployment</th></tr></thead><tbody>
            {models.map(model => <tr key={String(model.id)}>
              <td>{String(model.label || model.id)}</td>
              <td>{textList(model.modalities)}</td>
              <td>{textList(model.capabilities, 3)}</td>
              <td>{deploymentText(model.deployments)}</td>
            </tr>)}
          </tbody></table></div>
        </div>
        <div className="route-panel" id="fabric-agents">
          <header><h2>智能体与能力</h2><span>{agents.length} + {capabilities.length}</span></header>
          <div className="compact-list gateway-recent">
            {agents.slice(0, 18).map(agent => (
              <article key={String(agent.id)}><span className="neutral-dot" /><div><strong>{String(agent.name || agent.id)}</strong><p>{String(agent.runner || 'runner 未声明')} · {agent.queue_agent === true ? '队列 Agent' : '流程 Agent'}</p></div><time>A2A</time></article>
            ))}
          </div>
        </div>
      </section>

      <section className="gateway-data-grid">
        <div className="route-panel">
          <header><h2>按模型用量</h2><span>{byModel.length}</span></header>
          <div className="gateway-table-wrap"><table><thead><tr><th>模型</th><th>调用</th><th>失败</th><th>Tokens</th></tr></thead><tbody>
            {byModel.length ? byModel.map(row => <tr key={String(row.id)}><td>{String(row.id)}</td><td>{formatValue(row.calls)}</td><td>{formatValue(row.failures)}</td><td>{formatValue(row.total_tokens)}</td></tr>) : <tr><td colSpan={4}>中枢启用后的调用将在这里累计</td></tr>}
          </tbody></table></div>
        </div>
        <div className="route-panel">
          <header><h2>最近调用</h2><span>{recent.length}</span></header>
          <div className="compact-list gateway-recent">{recent.length ? recent.map((row, index) => (
            <article key={`${String(row.event_id || index)}`}><span className={row.status === 'ok' ? 'ok-dot' : 'neutral-dot'} /><div><strong>{String(row.requested_model || 'unknown')}</strong><p>{String(row.provider || 'provider 未记录')} · {formatValue(record(row.usage).total_tokens)} tokens</p></div><time>{formatDate(row.ts)}</time></article>
          )) : <div className="route-empty"><ScrollText size={17} />暂无中枢调用明细</div>}</div>
        </div>
      </section>

      <section className="gateway-admin">
        <header>
          <div>
            <h2>兼容网关维护</h2>
            <p>本机已启用自用模式。玉兔6只使用渠道、健康、路由、用量与日志；用户、租户、充值和分销功能不参与运行。</p>
          </div>
          <div className="gateway-admin-actions">
            <a href={routeValue(compatRoutes, 'console', `${compatBase}/console`)} target="_blank" rel="noreferrer">高级后台 <ExternalLink size={14} /></a>
          </div>
        </header>
        <div className="gateway-admin-links">
          <GatewayLink icon={<Waypoints size={17} />} title="渠道与资源池" text="接入上游、配置模型、检查渠道状态" href={routeValue(compatRoutes, 'channels', `${compatBase}/console/channel`)} external />
          <GatewayLink icon={<Gauge size={17} />} title="调用与用量" text="查看调用结果、延迟、错误和 token 用量" href={routeValue(compatRoutes, 'logs', `${compatBase}/console/log`)} external />
          <GatewayLink icon={<ScrollText size={17} />} title="数据看板" text="查看本机网关的汇总统计" href={routeValue(compatRoutes, 'dashboard', `${compatBase}/detail`)} external />
        </div>
      </section>
      <footer className="usage-footer"><span>共享角色目录 {workspace.core.runners.queueAgents.length}</span><span>健康探测每 {formatInterval(fabric?.health_interval_ms)}；切换页面不会额外调用模型。</span></footer>
    </main>
  );
}

function GatewayLink({ icon, title, text, href, external = false }: { icon: React.ReactNode; title: string; text: string; href: string; external?: boolean }) {
  return <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}><span>{icon}</span><div><strong>{title}</strong><p>{text}</p></div>{external ? <ExternalLink size={14} /> : <Boxes size={14} />}</a>;
}

function Metric({ label, value, note }: { label: string; value: unknown; note: string }) {
  return <div><strong>{formatValue(value)}</strong><small>{label}</small><p>{note}</p></div>;
}

function record(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Row[] : []; }
function routeValue(routes: Row, key: string, fallback: string): string { return typeof routes[key] === 'string' ? String(routes[key]) : fallback; }
function formatValue(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('zh-CN', { notation: number >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(number) : '未计量';
}
function formatMs(value: unknown): string { const number = Number(value); return Number.isFinite(number) && number > 0 ? `${Math.round(number)}ms` : '--'; }
function formatDate(value: unknown): string { const date = new Date(String(value || '')); return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('zh-CN', { hour12: false }) : '--:--'; }
function formatInterval(value: unknown): string {
  const minutes = Math.round(Number(value || 0) / 60000);
  return minutes > 0 ? `${minutes} 分钟` : '配置周期';
}
function textList(value: unknown, limit = 4): string { return Array.isArray(value) ? value.slice(0, limit).map(String).join(' / ') : '未声明'; }
function deploymentText(value: unknown): string {
  const deployments = rows(value);
  return deployments.map(item => `${String(item.provider)}:${String(item.model)}`).join(' → ') || '未配置';
}

function readCache(days: number): { fabric: Row; usage: Row; compat: Row } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}') as Row;
    if (Number(value.days) !== days || Date.now() - Number(value.at || 0) > CACHE_MS) return null;
    if (!record(value.fabric).ok) return null;
    return { fabric: record(value.fabric), usage: record(value.usage), compat: record(value.compat) };
  } catch (_) { return null; }
}

function writeCache(days: number, fabric: Row, usage: Row, compat: Row) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ days, at: Date.now(), fabric, usage, compat })); } catch (_) {}
}
