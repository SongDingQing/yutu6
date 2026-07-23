#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { Readable } = require('stream');
const {
  expandPath,
  loadConfig,
  resolveCredential,
  sanitize,
  workspaceRootFrom,
} = require('./config');
const { HealthStore } = require('./health-store');
const { FabricLedger } = require('./ledger');
const ZhipuCodingPlan = require('./zhipu-coding-plan');
const { routePlan, publicPlan } = require('./router');
const {
  agentCatalog,
  capabilityCatalog,
  platformCatalog,
  publicProviders,
  publicModels,
} = require('./catalog');

const DEFAULT_CONFIG = path.join(workspaceRootFrom(), 'projects', '控制台', 'config', 'model-fabric.json');
const ALLOWED_PROXY_PATHS = new Set([
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/embeddings',
  '/v1/images/generations',
  '/v1/audio/speech',
  '/v1/audio/transcriptions',
]);
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function nowIso() {
  return new Date().toISOString();
}

function safeError(error) {
  return String(error && error.message || error || 'unknown error')
    .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
    .replace(/\b(sk|ma_live)[-_][A-Za-z0-9._-]{8,}\b/gi, '<redacted>')
    .replace(/\b(token|secret|password|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=<redacted>')
    .slice(0, 300);
}

function json(response, status, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(text);
}

function readBody(request, maxBytes = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function readJsonBody(request, maxBytes = 2 * 1024 * 1024) {
  const raw = await readBody(request, maxBytes);
  if (!raw.length) return {};
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('request body must be a JSON object');
    }
    return value;
  } catch (error) {
    throw Object.assign(new Error('invalid JSON request body'), { statusCode: 400 });
  }
}

function corsHeaders(request) {
  const origin = String(request.headers.origin || '');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type,authorization,x-yutu-task-id,x-yutu-root-task-id,x-yutu-agent-id,x-yutu-project-id,x-yutu-trace-id',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  };
}

function responseHeaders(upstream, route, cors = {}) {
  const headers = { ...cors };
  for (const key of ['content-type', 'cache-control', 'x-request-id']) {
    const value = upstream.headers.get(key);
    if (value) headers[key] = value;
  }
  headers['x-yutu-fabric-provider'] = route.provider.id;
  headers['x-yutu-fabric-model'] = route.deployment.model || '';
  return headers;
}

function providerUrl(provider, requestPath) {
  if (ZhipuCodingPlan.isFabricProvider(provider)) ZhipuCodingPlan.assertFabricProvider(provider);
  const base = ZhipuCodingPlan.isFabricProvider(provider)
    ? ZhipuCodingPlan.BASE_URL
    : String(provider && provider.base_url || '').replace(/\/+$/, '');
  let suffix = String(requestPath || '');
  if (!suffix.startsWith('/')) suffix = `/${suffix}`;
  if ((base.endsWith('/v1') || provider && provider.strip_v1_prefix === true)
    && (suffix === '/v1' || suffix.startsWith('/v1/'))) {
    suffix = suffix.slice(3) || '/';
  }
  return `${base}${suffix}`;
}

function endpointBodyModel(body) {
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    return typeof parsed.model === 'string' ? parsed.model : '';
  } catch (_) {
    return '';
  }
}

function rewriteModel(body, upstreamModel) {
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    parsed.model = upstreamModel;
    return Buffer.from(JSON.stringify(parsed));
  } catch (_) {
    return body;
  }
}

function usageFromResponseBody(buffer) {
  try {
    const body = JSON.parse(buffer.toString('utf8'));
    return body && body.usage && typeof body.usage === 'object' ? body.usage : {};
  } catch (_) {
    return {};
  }
}

function requestHeaders(request) {
  return {
    'x-yutu-task-id': request.headers['x-yutu-task-id'],
    'x-yutu-root-task-id': request.headers['x-yutu-root-task-id'],
    'x-yutu-agent-id': request.headers['x-yutu-agent-id'],
    'x-yutu-project-id': request.headers['x-yutu-project-id'],
    'x-yutu-trace-id': request.headers['x-yutu-trace-id'],
  };
}

function a2aText(body) {
  const message = body && (body.message || body.params && body.params.message) || {};
  if (typeof message.content === 'string') return message.content;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts.map(part => part && (part.text || part.content)).filter(Boolean).join('\n');
}

class ModelFabric {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || workspaceRootFrom();
    this.configFile = options.configFile || process.env.YUTU6_MODEL_FABRIC_CONFIG || DEFAULT_CONFIG;
    this.config = loadConfig(this.configFile, this.workspaceRoot);
    for (const provider of this.config.providers || []) {
      if (ZhipuCodingPlan.isFabricProvider(provider)) ZhipuCodingPlan.assertFabricProvider(provider);
    }
    if (options.port != null) this.config.server.port = Number(options.port);
    const artifactRoot = expandPath(this.config.storage.root, this.workspaceRoot);
    this.health = new HealthStore(path.join(artifactRoot, 'health-state.json'), this.config.routing);
    this.ledger = new FabricLedger(path.join(artifactRoot, 'ledger'));
    this.agents = agentCatalog(this.config, this.workspaceRoot);
    this.capabilities = capabilityCatalog(this.config, this.workspaceRoot);
    this.platforms = platformCatalog(this.config, this.workspaceRoot);
    this.server = null;
    this.healthTimer = null;
    this.startedAt = null;
  }

  provider(id) {
    return (this.config.providers || []).find(provider => provider.id === id) || null;
  }

  async probeProvider(provider) {
    const started = Date.now();
    const token = resolveCredential(provider, this.workspaceRoot);
    if (provider.credential && !token) {
      this.health.failure(provider.id, 'credential_missing', Date.now() - started);
      return { id: provider.id, ok: false, reason: 'credential_missing' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(this.config.routing.health_timeout_ms || 8000));
    try {
      if (ZhipuCodingPlan.isFabricProvider(provider)) {
        const result = await ZhipuCodingPlan.requestChatCompletion({
          token,
          prompt: '只回复 OK',
          temperature: 0,
          maxTokens: ZhipuCodingPlan.PROBE_MAX_TOKENS,
          maxAttempts: 3,
          signal: controller.signal,
        });
        const latencyMs = Date.now() - started;
        if (!result.ok) {
          this.health.failure(provider.id, result.errorClass, latencyMs);
          return { id: provider.id, ok: false, status: result.status, reason: result.errorClass, latency_ms: latencyMs };
        }
        this.health.success(provider.id, latencyMs);
        return { id: provider.id, ok: true, status: result.status, latency_ms: latencyMs };
      }
      const chatProbe = provider.health_mode === 'chat_completion';
      const response = await fetch(providerUrl(provider, chatProbe ? '/v1/chat/completions' : (provider.health_path || '/models')), {
        method: chatProbe ? 'POST' : 'GET',
        headers: token ? {
          authorization: `Bearer ${token}`,
          ...(chatProbe ? { 'content-type': 'application/json' } : {}),
        } : {},
        body: chatProbe ? JSON.stringify({
          model: provider.health_model || ZhipuCodingPlan.MODEL,
          messages: [{ role: 'user', content: '只回复 OK' }],
          temperature: 0,
          max_tokens: ZhipuCodingPlan.PROBE_MAX_TOKENS,
        }) : undefined,
        signal: controller.signal,
      });
      response.body && await response.body.cancel().catch(() => {});
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        this.health.failure(provider.id, `http_${response.status}`, latencyMs);
        return { id: provider.id, ok: false, status: response.status, latency_ms: latencyMs };
      }
      this.health.success(provider.id, latencyMs);
      return { id: provider.id, ok: true, status: response.status, latency_ms: latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - started;
      const reason = error && error.name === 'AbortError' ? 'timeout' : 'connection_failed';
      this.health.failure(provider.id, reason, latencyMs);
      return { id: provider.id, ok: false, reason, latency_ms: latencyMs };
    } finally {
      clearTimeout(timer);
    }
  }

  async probeAll() {
    const providers = (this.config.providers || []).filter(provider => provider.enabled !== false);
    return Promise.all(providers.map(provider => this.probeProvider(provider)));
  }

  readiness() {
    const providers = publicProviders(this.config, this.health);
    const enabled = providers.filter(provider => provider.enabled !== false);
    const healthy = enabled.filter(provider => provider.health.state === 'healthy');
    return {
      ok: healthy.length > 0,
      state: healthy.length === enabled.length && enabled.length > 0 ? 'ready' : (healthy.length ? 'degraded' : 'unavailable'),
      checked_at: enabled.map(provider => provider.health.last_checked_at).filter(Boolean).sort().at(-1) || null,
      providers: { enabled: enabled.length, healthy: healthy.length },
      rollback_safe: true,
    };
  }

  diagnostics() {
    const summary = this.ledger.summary(1);
    const readiness = this.readiness();
    const models = publicModels(this.config);
    return {
      schema: 'yutu6-model-fabric-diagnostics@1',
      ok: true,
      readiness,
      routing: {
        front_door: `http://${this.config.server.host}:${this.config.server.port}/v1`,
        compatibility_upstream: this.config.migration.compatibility_upstream,
        max_attempts: Number(this.config.routing.max_attempts || 2),
        health_interval_ms: Number(this.config.routing.health_interval_ms || 0),
        fallback_enabled: true,
      },
      coverage: {
        logical_models: models.length,
        directly_routable_models: models.filter(model => model.deployments.some(deployment => deployment.provider !== 'new-api-compat')).length,
        compatibility_models: models.filter(model => model.deployments.some(deployment => deployment.provider === 'new-api-compat')).length,
      },
      usage_24h: summary.totals,
      privacy: { prompt_logging: false, response_logging: false, secret_values_exposed: false },
      migration_advice: readiness.state === 'ready'
        ? '可继续保持 Fabric 作为旁路入口；逐个为模型补直连 deployment，验证稳定后再提高优先级。'
        : '先修复或恢复至少一个上游，再考虑切换默认入口。',
    };
  }

  overview() {
    const models = publicModels(this.config);
    const providers = publicProviders(this.config, this.health);
    const healthy = providers.filter(provider => provider.health.state === 'healthy').length;
    const directCoverage = models.filter(model => model.deployments.some(deployment => deployment.provider !== 'new-api-compat')).length;
    const compatibilityCoverage = models.filter(model => model.deployments.some(deployment => deployment.provider === 'new-api-compat')).length;
    return {
      schema: 'yutu6-model-fabric-overview@1',
      ok: true,
      name: this.config.name,
      mode: this.config.mode,
      base_url: `http://${this.config.server.host}:${this.config.server.port}`,
      started_at: this.startedAt,
      uptime_sec: Math.round(process.uptime()),
      health_interval_ms: Number(this.config.routing.health_interval_ms),
      last_health_check_at: providers.map(provider => provider.health.last_checked_at).filter(Boolean).sort().at(-1) || null,
      metrics: {
        providers: providers.length,
        healthy_providers: healthy,
        models: models.length,
        agents: this.agents.length,
        capabilities: this.capabilities.length,
        platforms: this.platforms.length,
      },
      migration: {
        phase: this.config.migration.phase,
        front_door: this.config.migration.front_door,
        compatibility_upstream: this.config.migration.compatibility_upstream,
        direct_model_coverage: directCoverage,
        compatibility_model_coverage: compatibilityCoverage,
        ready_to_retire_new_api: compatibilityCoverage === 0 && healthy > 0,
        rollback: this.config.migration.rollback,
      },
      providers,
      models,
      agents: this.agents,
      capabilities: this.capabilities,
      platforms: this.platforms,
      privacy: {
        prompt_logging: false,
        response_logging: false,
        secret_values_exposed: false,
      },
    };
  }

  async dispatchAgent(agentId, body) {
    const agent = this.agents.find(entry => entry.id === agentId);
    if (!agent) return { status: 404, body: { ok: false, error: 'unknown agent' } };
    const goal = String(body && (body.goal || body.message) || '').trim();
    if (!goal) return { status: 400, body: { ok: false, error: 'empty goal' } };
    const privileged = new Set(this.config.control_plane.privileged_agents || []);
    if (privileged.has(agentId) && this.config.control_plane.allow_privileged_dispatch !== true) {
      return { status: 403, body: { ok: false, error: 'privileged agent dispatch requires owner-approved local route' } };
    }
    const consoleBase = String(this.config.control_plane.console_base_url).replace(/\/+$/, '');
    const endpoint = agent.queue_agent
      ? `${consoleBase}/api/queue/${encodeURIComponent(agentId)}`
      : `${consoleBase}/api/engine/run`;
    const payload = agent.queue_agent ? {
      task: {
        goal,
        acceptance: body.acceptance || '产物和验证证据可追踪; 不得只声明完成',
        projectId: body.projectId || '控制台',
        role: agent.role,
        source: 'model-fabric',
      },
      priority: body.priority == null ? 50 : body.priority,
      idem: body.idempotency_key || undefined,
    } : {
      goal,
      acceptance: body.acceptance || '产物和验证证据可追踪; 不得只声明完成',
      role: agent.role,
      flowId: body.flowId || 'review-loop',
      useOrchestrator: agentId === 'secretary' || agentId === 'orchestrator',
    };
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      return { status: response.ok ? 202 : response.status, body: { ...result, agent: agentId, via: 'yutu6-native' } };
    } catch (error) {
      return { status: 503, body: { ok: false, error: 'console control plane unavailable', agent: agentId } };
    }
  }

  async proxy(request, response, url) {
    const cors = corsHeaders(request);
    const body = await readBody(request);
    const requestedModel = endpointBodyModel(body);
    if (!requestedModel) return json(response, 400, { ok: false, error: 'model is required' }, cors);
    const plan = routePlan(this.config, this.health, requestedModel);
    if (!plan.candidates.length) {
      this.ledger.policy({
        decision: 'deny',
        endpoint: url.pathname,
        requested_model: requestedModel,
        logical_model: plan.logical_model,
        reason: 'no_eligible_deployment',
        headers: requestHeaders(request),
      });
      return json(response, 503, { error: { message: 'no eligible model deployment', type: 'routing_error' } }, cors);
    }

    const maxAttempts = Math.min(plan.candidates.length, Math.max(1, Number(this.config.routing.max_attempts || 2)));
    const policy = this.ledger.policy({
      decision: 'allow',
      endpoint: url.pathname,
      requested_model: requestedModel,
      logical_model: plan.logical_model,
      selected_provider: plan.candidates[0].provider.id,
      selected_model: plan.candidates[0].deployment.model || requestedModel,
      fallback_candidates: plan.candidates.slice(1, maxAttempts).map(candidate => candidate.provider.id),
      headers: requestHeaders(request),
    });
    let lastFailure = null;

    for (let index = 0; index < maxAttempts; index++) {
      const route = plan.candidates[index];
      const provider = route.provider;
      const upstreamModel = route.deployment.model || requestedModel;
      const token = resolveCredential(provider, this.workspaceRoot);
      if (provider.credential && !token) {
        this.health.failure(provider.id, 'credential_missing');
        lastFailure = { error: 'credential_missing', provider: provider.id };
        continue;
      }
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(this.config.routing.request_timeout_ms || 180000));
      let upstream;
      try {
        const fetchImpl = ZhipuCodingPlan.isFabricProvider(provider)
          ? ZhipuCodingPlan.httpsFetch
          : fetch;
        upstream = await fetchImpl(providerUrl(provider, url.pathname), {
          method: request.method,
          headers: {
            accept: request.headers.accept || 'application/json',
            'content-type': request.headers['content-type'] || 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: rewriteModel(body, upstreamModel),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeout);
        const reason = error && error.name === 'AbortError' ? 'timeout' : 'connection_failed';
        this.health.failure(provider.id, reason, Date.now() - started);
        this.ledger.usage({
          policy_event_id: policy.event_id,
          endpoint: url.pathname,
          provider: provider.id,
          requested_model: requestedModel,
          upstream_model: upstreamModel,
          status: 'error',
          duration_ms: Date.now() - started,
          failover_count: index,
          error_class: reason,
          headers: requestHeaders(request),
        });
        lastFailure = { error: reason, provider: provider.id };
        continue;
      }

      const durationMs = Date.now() - started;
      if (RETRYABLE_STATUS.has(upstream.status) && index + 1 < maxAttempts) {
        clearTimeout(timeout);
        upstream.body && await upstream.body.cancel().catch(() => {});
        this.health.failure(provider.id, `http_${upstream.status}`, durationMs);
        this.ledger.usage({
          policy_event_id: policy.event_id,
          endpoint: url.pathname,
          provider: provider.id,
          requested_model: requestedModel,
          upstream_model: upstreamModel,
          status: 'error',
          http_status: upstream.status,
          duration_ms: durationMs,
          failover_count: index,
          error_class: 'retryable_upstream',
          headers: requestHeaders(request),
        });
        lastFailure = { error: `http_${upstream.status}`, provider: provider.id };
        continue;
      }

      if (upstream.ok) this.health.success(provider.id, durationMs);
      else this.health.failure(provider.id, `http_${upstream.status}`, durationMs);
      const contentType = upstream.headers.get('content-type') || '';
      const headers = responseHeaders(upstream, route, cors);
      if (contentType.includes('application/json')) {
        const buffer = Buffer.from(await upstream.arrayBuffer());
        clearTimeout(timeout);
        this.ledger.usage({
          policy_event_id: policy.event_id,
          endpoint: url.pathname,
          provider: provider.id,
          requested_model: requestedModel,
          upstream_model: upstreamModel,
          status: upstream.ok ? 'ok' : 'error',
          http_status: upstream.status,
          duration_ms: Date.now() - started,
          failover_count: index,
          usage: usageFromResponseBody(buffer),
          error_class: upstream.ok ? null : 'upstream_http',
          headers: requestHeaders(request),
        });
        response.writeHead(upstream.status, { ...headers, 'Content-Length': buffer.length });
        return response.end(buffer);
      }

      response.writeHead(upstream.status, headers);
      if (!upstream.body) {
        clearTimeout(timeout);
        this.ledger.usage({
          policy_event_id: policy.event_id,
          endpoint: url.pathname,
          provider: provider.id,
          requested_model: requestedModel,
          upstream_model: upstreamModel,
          status: upstream.ok ? 'ok' : 'error',
          http_status: upstream.status,
          duration_ms: Date.now() - started,
          failover_count: index,
          headers: requestHeaders(request),
        });
        return response.end();
      }
      const stream = Readable.fromWeb(upstream.body);
      stream.on('end', () => {
        clearTimeout(timeout);
        this.ledger.usage({
          policy_event_id: policy.event_id,
          endpoint: url.pathname,
          provider: provider.id,
          requested_model: requestedModel,
          upstream_model: upstreamModel,
          status: upstream.ok ? 'ok' : 'error',
          http_status: upstream.status,
          duration_ms: Date.now() - started,
          failover_count: index,
          headers: requestHeaders(request),
        });
      });
      stream.on('error', () => {
        clearTimeout(timeout);
        try { response.end(); } catch (_) {}
      });
      return stream.pipe(response);
    }
    return json(response, 503, {
      error: {
        message: 'all eligible deployments failed',
        type: 'upstream_unavailable',
        last_provider: lastFailure && lastFailure.provider || null,
      },
    }, cors);
  }

  async handle(request, response) {
    const url = new URL(request.url, `http://${this.config.server.host}`);
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors);
      return response.end();
    }
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/fabric/health')) {
      const providers = publicProviders(this.config, this.health);
      return json(response, 200, {
        ok: true,
        state: providers.some(provider => provider.health.state === 'healthy') ? 'ready' : 'degraded',
        mode: this.config.mode,
        pid: process.pid,
        ts: nowIso(),
        providers: providers.map(provider => ({ id: provider.id, enabled: provider.enabled !== false, health: provider.health })),
      }, cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/ready') {
      const ready = this.readiness();
      return json(response, ready.ok ? 200 : 503, ready, cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/diagnostics') {
      return json(response, 200, this.diagnostics(), cors);
    }
    if (request.method === 'POST' && url.pathname === '/api/fabric/health/run') {
      const results = await this.probeAll();
      return json(response, 200, { ok: results.every(result => result.ok), results }, cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/overview') {
      return json(response, 200, this.overview(), cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/providers') {
      return json(response, 200, { ok: true, providers: publicProviders(this.config, this.health) }, cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/models') {
      return json(response, 200, { ok: true, models: publicModels(this.config) }, cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/agents') {
      return json(response, 200, { ok: true, agents: this.agents }, cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/capabilities') {
      return json(response, 200, { ok: true, capabilities: this.capabilities }, cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/platforms') {
      return json(response, 200, { ok: true, platforms: this.platforms }, cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/routes/plan') {
      const model = String(url.searchParams.get('model') || '');
      if (!model) return json(response, 400, { ok: false, error: 'model is required' }, cors);
      const required = String(url.searchParams.get('capabilities') || '')
        .split(',').map(value => value.trim()).filter(Boolean);
      return json(response, 200, { ok: true, plan: publicPlan(routePlan(this.config, this.health, model, { required_capabilities: required })) }, cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/usage') {
      return json(response, 200, { ok: true, usage: this.ledger.summary(url.searchParams.get('days')) }, cors);
    }
    if (request.method === 'GET' && url.pathname === '/api/fabric/config') {
      return json(response, 200, { ok: true, config: sanitize(this.config) }, cors);
    }
    if (request.method === 'GET' && url.pathname === '/v1/models') {
      const data = publicModels(this.config).map(model => ({
        id: model.id,
        object: 'model',
        owned_by: 'yutu6-model-fabric',
        capabilities: model.capabilities,
        modalities: model.modalities,
      }));
      return json(response, 200, { object: 'list', data }, cors);
    }

    const agentRunMatch = url.pathname.match(/^\/api\/fabric\/agents\/([^/]+)\/run$/);
    if (request.method === 'POST' && agentRunMatch) {
      const body = await readJsonBody(request);
      const result = await this.dispatchAgent(decodeURIComponent(agentRunMatch[1]), body);
      return json(response, result.status, result.body, cors);
    }
    const agentCardMatch = url.pathname.match(/^\/a2a\/agents\/([^/]+)\/\.well-known\/agent-card\.json$/);
    if (request.method === 'GET' && agentCardMatch) {
      const agent = this.agents.find(entry => entry.id === decodeURIComponent(agentCardMatch[1]));
      if (!agent) return json(response, 404, { error: 'unknown agent' }, cors);
      return json(response, 200, {
        name: agent.name,
        description: agent.boundary && agent.boundary.does || agent.name,
        url: `http://${this.config.server.host}:${this.config.server.port}/a2a/agents/${encodeURIComponent(agent.id)}`,
        protocolVersion: '1.0',
        capabilities: { streaming: false, pushNotifications: false },
        skills: [{ id: agent.role, name: agent.name, description: agent.boundary && agent.boundary.does || '' }],
      }, cors);
    }
    const a2aSendMatch = url.pathname.match(/^\/a2a\/agents\/([^/]+)\/message:send$/);
    if (request.method === 'POST' && a2aSendMatch) {
      const body = await readJsonBody(request);
      const result = await this.dispatchAgent(decodeURIComponent(a2aSendMatch[1]), {
        goal: a2aText(body),
        acceptance: body.acceptance,
        projectId: body.projectId,
        idempotency_key: body.idempotency_key,
      });
      return json(response, result.status, {
        task: {
          id: result.body.taskId || result.body.entry && result.body.entry.id || null,
          status: { state: result.status < 300 ? 'TASK_STATE_SUBMITTED' : 'TASK_STATE_FAILED' },
          metadata: { agent: result.body.agent, via: result.body.via },
        },
      }, cors);
    }
    if (request.method === 'POST' && ALLOWED_PROXY_PATHS.has(url.pathname)) {
      return this.proxy(request, response, url);
    }
    return json(response, 404, { ok: false, error: 'not found' }, cors);
  }

  async start() {
    if (this.server) return this;
    this.startedAt = nowIso();
    this.server = http.createServer((request, response) => {
      this.handle(request, response).catch(error => {
        if (!response.headersSent) {
          json(response, error.statusCode || 500, { ok: false, error: safeError(error) }, corsHeaders(request));
        } else {
          try { response.end(); } catch (_) {}
        }
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.server.port, this.config.server.host, resolve);
    });
    const interval = Math.max(60000, Number(this.config.routing.health_interval_ms || 1800000));
    this.healthTimer = setInterval(() => {
      this.probeAll().catch(() => {});
    }, interval);
    this.healthTimer.unref?.();
    setTimeout(() => this.probeAll().catch(() => {}), 250).unref?.();
    return this;
  }

  async close() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    if (!this.server) return;
    const current = this.server;
    this.server = null;
    await new Promise(resolve => current.close(resolve));
  }
}

async function main() {
  const fabric = new ModelFabric();
  await fabric.start();
  process.stdout.write(`[model-fabric] listening on http://${fabric.config.server.host}:${fabric.config.server.port}\n`);
  const shutdown = async () => {
    await fabric.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[model-fabric] ${safeError(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ModelFabric,
  ALLOWED_PROXY_PATHS,
  RETRYABLE_STATUS,
  safeError,
  a2aText,
  readJsonBody,
  providerUrl,
};
