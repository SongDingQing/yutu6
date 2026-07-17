'use strict';

// Board-only runner adapter. It keeps context_ref internals out of the shared
// engine and captures provider usage only for the two OpenAI-compatible Board
// transports. Command runners still use the shared CLI implementation.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { makeCliRunner, buildEnvelope, extractJson } = require('../../shared/engine/cli-runner');
const InteractionTrace = require('../../shared/engine/interaction-trace');

function sanitizeBoardContext(ctx) {
  const source = ctx && typeof ctx === 'object' ? ctx : {};
  const { boardLegacyGoal, boardContextRef, ...safe } = source;
  return safe;
}

function normalizeRunnerUsage(value) {
  const usage = value && typeof value === 'object' ? value : null;
  if (!usage) return null;
  const details = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
    ? usage.prompt_tokens_details
    : {};
  const numberOrNull = item => item != null && item !== '' && Number.isFinite(Number(item))
    ? Number(item)
    : null;
  const normalized = {
    prompt_tokens: numberOrNull(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens),
    completion_tokens: numberOrNull(usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens),
    total_tokens: numberOrNull(usage.total_tokens),
    cached_tokens: numberOrNull(details.cached_tokens != null ? details.cached_tokens : usage.cached_tokens),
    prompt_cache_hit_tokens: numberOrNull(usage.prompt_cache_hit_tokens),
    prompt_cache_miss_tokens: numberOrNull(usage.prompt_cache_miss_tokens),
  };
  return Object.values(normalized).some(item => item != null) ? normalized : null;
}

function resolveConfigPath(file, workdir) {
  if (!file) return null;
  const value = String(file);
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return path.isAbsolute(value) ? value : path.resolve(workdir || process.cwd(), value);
}

function readEnvFile(file) {
  const env = {};
  if (!file) return env;
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const index = line.indexOf('=');
      if (index <= 0) continue;
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch (_) {}
  return env;
}

function emit(eventlog, type, data) {
  try { if (eventlog) eventlog.emit(type, data); } catch (_) {}
}

function safeFailure(value, max = 500) {
  const clean = InteractionTrace.redact(String(value || ''))
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
}

function providerConfig(runner, opts) {
  const envFile = resolveConfigPath(runner.tokenFile || runner.envFile, opts.workdir);
  const fileEnv = readEnvFile(envFile);
  const baseUrl = String(runner.baseUrl || fileEnv.NEW_API_BASE_URL || '').replace(/\/+$/, '');
  const token = runner.tokenEnv && process.env[runner.tokenEnv]
    || fileEnv[runner.tokenKey || 'NEW_API_TOKEN']
    || runner.token
    || '';
  return {
    baseUrl,
    token,
    model: runner.model || fileEnv.NEW_API_MODEL || 'glm-5.2',
  };
}

async function fetchBoardProvider(runner, prompt, opts) {
  const config = providerConfig(runner, opts);
  if (!config.baseUrl || !config.token) {
    return { fail: 'openai_http 缺 baseUrl 或 token', stdout: '', stderr: '', usage: null, status: null };
  }
  const timeoutMs = Math.max(1000, Number(opts.nodeTimeoutSec || 900) * 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: runner.systemPrompt
          ? [{ role: 'system', content: runner.systemPrompt }, { role: 'user', content: prompt }]
          : [{ role: 'user', content: prompt }],
        temperature: runner.temperature == null ? 0.3 : runner.temperature,
        max_tokens: runner.maxTokens || 2048,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
    if (!response.ok || body && body.error) {
      const detail = body && body.error && body.error.message
        || body && body.message
        || body && body.raw
        || `HTTP ${response.status}`;
      return {
        fail: safeFailure(`HTTP ${response.status}: ${detail}`),
        stdout: '',
        stderr: safeFailure(detail),
        usage: null,
        status: response.status,
      };
    }
    const message = body && body.choices && body.choices[0] && body.choices[0].message || {};
    return {
      fail: '',
      stdout: String(message.content || message.reasoning_content || ''),
      stderr: '',
      usage: normalizeRunnerUsage(body && body.usage),
      status: response.status,
    };
  } catch (error) {
    const timeout = error && error.name === 'AbortError';
    return {
      fail: timeout
        ? `openai_http timeout after ${timeoutMs}ms`
        : safeFailure(`openai_http transport: ${error && error.message || error}`),
      stdout: '',
      stderr: '',
      usage: null,
      status: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function makeBoardOpenAiRunner(opts, runner) {
  return {
    async runNodeAsync(node, ctx, attempt) {
      const safeCtx = sanitizeBoardContext(ctx);
      const dir = path.join(opts.runsDir, `${node.id}-${attempt}`);
      fs.mkdirSync(dir, { recursive: true });
      const prompt = buildEnvelope(node, safeCtx, {
        runner,
        runnerId: opts.runnerId,
        runsDir: opts.runsDir,
        eventlog: opts.eventlog || null,
        taskId: opts.taskId || null,
        projectId: opts.projectId || null,
      });
      const taskFile = path.join(dir, 'task.md');
      fs.writeFileSync(taskFile, prompt);
      const trace = InteractionTrace.recordPrompt({
        ctx: safeCtx,
        node,
        attempt,
        runnerId: opts.runnerId,
        runner,
        dir,
        prompt,
        workdir: opts.workdir,
        runsDir: opts.runsDir,
        queueRoot: opts.queueRoot,
        queueAgent: opts.queueAgent,
        queueId: opts.queueId,
        taskId: opts.taskId,
        projectId: opts.projectId,
        eventlog: opts.eventlog,
      });
      const startedAt = Date.now();
      const response = await fetchBoardProvider(runner, prompt, opts);
      const latencyMs = Date.now() - startedAt;
      fs.writeFileSync(path.join(dir, 'result.md'), response.stdout || '');
      if (response.stderr) fs.writeFileSync(path.join(dir, 'process.log'), safeFailure(response.stderr, 1000));
      const result = response.fail
        ? { fail: safeFailure(response.fail) }
        : {
          vars: extractJson(response.stdout) || {},
          evidence: { type: 'result', runner: opts.runnerId, path: path.join(dir, 'result.md') },
          runner_usage: response.usage,
          runner_request: {
            final_request: true,
            runner: opts.runnerId,
            model: runner.model || null,
            prompt_sha256: crypto.createHash('sha256').update(prompt, 'utf8').digest('hex'),
            prompt_chars: prompt.length,
          },
        };
      InteractionTrace.recordResult(trace, {
        stdout: response.stdout,
        stderr: response.stderr,
        result,
        exitCode: response.fail ? 1 : 0,
        latencyMs,
        eventlog: opts.eventlog,
      });
      if (response.stdout) emit(opts.eventlog, 'node.output', {
        task: opts.taskId || null,
        node: node && node.id || null,
        attempt,
        role: node && node.agent_role || null,
        stream: 'stdout',
        text: safeFailure(response.stdout, 2000),
        projectId: opts.projectId || null,
      });
      emit(opts.eventlog, 'runner.call', {
        task: opts.taskId || null,
        node: node && node.id || null,
        role: node && node.agent_role || null,
        attempt,
        runner: opts.runnerId,
        candidate_index: opts.candidateIndex || 0,
        failover: Number(opts.candidateIndex) > 0,
        ok: !result.fail,
        fail: result.fail ? (/(?:\b429\b|rate.?limit)/i.test(result.fail) ? 'http_429' : 'runner_error') : null,
        status: response.status,
        latency_ms: latencyMs,
        span: `${node && node.id}-${attempt}`,
        trace_id: process.env.YUTU6_TRACE_ID || opts.taskId || null,
        projectId: opts.projectId || null,
        queueId: opts.queueId || null,
        usage: response.usage,
      });
      return result;
    },
  };
}

function makeBoardCandidateRunner(opts = {}) {
  const runner = opts.runners && opts.runners[opts.runnerId];
  if (!runner) return { async runNodeAsync() { return { fail: `board runner unavailable: ${opts.runnerId || 'unknown'}` }; } };
  if (runner.kind === 'openai_http') return makeBoardOpenAiRunner(opts, runner);
  const sharedRunner = makeCliRunner({
    runners: opts.runners,
    roleMap: Object.assign({}, opts.roleMap || {}, { [opts.role]: opts.runnerId }),
    roleExecMeta: opts.roleExecMeta || {},
    workdir: opts.workdir,
    runsDir: opts.runsDir,
    nodeTimeoutSec: opts.nodeTimeoutSec,
    eventlog: opts.eventlog,
    queueRoot: opts.queueRoot,
    queueAgent: opts.queueAgent,
    queueId: opts.queueId,
    taskId: opts.taskId,
    projectId: opts.projectId,
    failover: false,
  });
  return {
    runNodeAsync(node, ctx, attempt) {
      return sharedRunner.runNodeAsync(node, sanitizeBoardContext(ctx), attempt);
    },
  };
}

module.exports = {
  sanitizeBoardContext,
  normalizeRunnerUsage,
  makeBoardCandidateRunner,
};
