import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRescueCore } from './rescue-core.mjs';
import { readProviders, providerRequest } from '../../packages/model-providers/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const equal = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && crypto.timingSafeEqual(x, y); };
export function createRescueServer(config, { env = process.env, core = createRescueCore(config), fetchImpl = fetch } = {}) {
  const owner = env[config.ownerTokenEnv];
  if (!owner || owner.length < 24) throw new Error('请在独立环境中配置至少24字节的救援主人令牌');
  const sessions = new Map(); let running = false, stopped = false, abort;
  const budgetFile = path.join(config.rescueHome, 'api-budget.json');
  const budget = fs.existsSync(budgetFile) ? JSON.parse(fs.readFileSync(budgetFile, 'utf8')) : { calls: 0 };
  const maxCalls = Math.max(1, Math.min(16, config.apiMaxCalls || 8));
  const maxTokens = Math.max(128, Math.min(2048, config.apiMaxOutputTokens || 1024));
  const persistBudget = () => { const temp = budgetFile + '.tmp'; fs.writeFileSync(temp, JSON.stringify(budget), { mode: 0o600 }); fs.renameSync(temp, budgetFile); };
  const act = async (actor, body) => {
    switch (body.action) {
      case 'read': return core.read(actor, body.file);
      case 'stage': return core.stage(actor, body.file, body.text, body.expectedHash);
      case 'check': return core.check(actor);
      case 'apply': return core.apply(actor);
      case 'rollback': return core.rollback(actor);
      case 'note': return core.note(actor, body.text);
      default: throw new Error('未知维修操作');
    }
  };
  const preflight = () => {
    if (!config.apiActor || !config.providersFile || !config.apiModelId) throw new Error('尚未配置独立API维修身份和提供商，不会调用主程序兜底');
    if (!config.actors?.some(a => a.id === config.apiActor && a.read === true)) throw new Error('API维修身份尚未获主人授权');
    if (budget.calls >= maxCalls) throw new Error('本次独立救援的API预算已耗尽，请主人核查后调整独立配置');
    return readProviders(config.providersFile);
  };
  const apiRun = async () => {
    if (running) throw new Error('独立模型已在处理');
    const providers = preflight();
    const c = new AbortController(); abort = c; running = true; stopped = false;
    core.note(config.apiActor, '独立API模型开始处理；不依赖玉兔主服务');
    const seen = new Set(core.status().inputs.map(item => item.id));
    const messages = [{ role: 'system', content: '你是独立维修助手。仅依据本次明确输入与维修工具回执处理程序文件。未核验不能宣称完成。无法确认的操作先说明问题。' },
      { role: 'user', content: JSON.stringify({ inputs: core.status().inputs.slice(-8), editableFiles: core.status().editableFiles, phase: core.status().phase }).slice(0, 24000) }];
    try {
      for (let step = 0; step < 4 && !stopped; step++) {
        const added = core.status().inputs.filter(item => !seen.has(item.id));
        if (added.length) { messages.push({ role: 'user', content: JSON.stringify({ owner_followups: added }).slice(0, 16000) }); for (const item of added) seen.add(item.id); }
        if (budget.calls >= maxCalls) throw new Error('本次独立救援的API预算已耗尽，请主人核查后调整独立配置');
        budget.calls++; persistBudget();
        const response = await providerRequest(providers, config.apiModelId, { messages, stream: false, max_tokens: maxTokens,
          tools: [{ type: 'function', function: { name: 'repair_action', description: '读允许程序文件、暂存候选、核验或按独立权限激活。先read取得sha256，stage必须带expectedHash。', parameters: { type: 'object', required: ['action'], properties: {
            action: { type: 'string', enum: ['read', 'stage', 'check', 'apply', 'rollback', 'note'] }, file: { type: 'string' }, text: { type: 'string' }, expectedHash: { type: ['string', 'null'] },
          } } } }], tool_choice: 'auto',
        }, { env, fetchImpl, signal: c.signal, timeoutMs: 90000 });
        const result = await response.json(); if (stopped) return;
        const m = result.choices?.[0]?.message; if (!m) throw new Error('独立模型未返回有效消息');
        if (m.content) core.note(config.apiActor, String(m.content).slice(0, 2000));
        if (!m.tool_calls?.length) { if (core.status().inputs.some(item => !seen.has(item.id))) { messages.push({ role: 'assistant', content: String(m.content || '') }); continue; } return; }
        if (m.tool_calls.length > 4) throw new Error('独立模型单轮工具过多，已暂停');
        messages.push({ role: 'assistant', content: String(m.content || ''), tool_calls: m.tool_calls });
        for (const call of m.tool_calls) {
          if (stopped) return;
          let receipt;
          try {
            if (call.function?.name !== 'repair_action') throw new Error('未知工具');
            receipt = await act(config.apiActor, JSON.parse(call.function.arguments));
          } catch (error) { receipt = { ok: false, error: error.message }; }
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(receipt).slice(0, 12000) });
        }
      }
      if (!stopped) core.note(config.apiActor, '本次独立模型达到4轮上限；进度已保留，没有自动追加任务。');
    } finally { running = false; abort = null; }
  };
  const server = http.createServer(async (req, res) => {
    const send = (code, value) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      const expectedHost = `127.0.0.1:${server.address()?.port}`;
      if (req.headers.host !== expectedHost || req.headers.origin && req.headers.origin !== `http://${expectedHost}`) return send(403, { error: '来源不受信任，请使用固定回环地址或SSH本地隧道' });
      const url = new URL(req.url, `http://${expectedHost}`);
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'x-frame-options': 'DENY' });
        return res.end(fs.readFileSync(path.join(here, 'rescue-ui.html')));
      }
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true, service: 'yutu-independent-rescue', schema: 1 });
      let text = ''; for await (const part of req) { text += part; if (Buffer.byteLength(text) > 1200000) throw new Error('请求过大'); }
      const body = text ? JSON.parse(text) : {};
      if (req.method === 'POST' && url.pathname === '/api/session') {
        if (!equal(body.token, owner)) return send(401, { error: '救援令牌无效' });
        const id = crypto.randomBytes(32).toString('hex'); sessions.set(id, Date.now() + 3600000);
        for (const [key, until] of sessions) if (until <= Date.now()) sessions.delete(key);
        if (sessions.size > 16) sessions.delete(sessions.keys().next().value);
        res.setHeader('set-cookie', `yutu_rescue=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
        return send(200, { ok: true });
      }
      const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const cookie = req.headers.cookie?.match(/(?:^|;\s*)yutu_rescue=([a-f0-9]{64})(?:;|$)/)?.[1];
      const isOwner = equal(bearer, owner) || (sessions.get(cookie) || 0) > Date.now();
      const actor = isOwner ? config.ownerActor : config.actors?.find(a => a.tokenEnv && env[a.tokenEnv]?.length >= 24 && equal(bearer, env[a.tokenEnv]))?.id;
      if (!actor && !isOwner) return send(401, { error: '需要独立救援授权' });
      if (!isOwner && !config.actors.some(a => a.id === actor && a.read === true)) return send(403, { error: '维修身份的读取授权未启用' });
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, { ...core.status(), api: { running, calls: budget.calls, maxCalls, outputTokenLimit: maxTokens }, mainAppRequired: false });
      if (req.method !== 'POST') return send(404, { error: '接口不存在' });
      if (url.pathname === '/api/input' && isOwner) return send(200, core.input(body.text));
      if (url.pathname === '/api/run' && isOwner) { if (running) return send(409, { error: '模型正在处理，可继续补充输入' });
        preflight();
        const pending = apiRun(); pending.catch(error => { try { core.note(config.apiActor, error.message); } catch {} }); return send(202, { accepted: true }); }
      if (url.pathname === '/api/stop' && isOwner) { stopped = true; abort?.abort(); return send(200, { ok: true, note: '已请求停止独立推理；原子激活/回滚会继续收尾' }); }
      if (url.pathname === '/api/repair' && actor) return send(200, await act(actor, body));
      return send(403, { error: '此身份无权使用该接口' });
    } catch (error) { send(400, { error: error.message }); }
  });
  server.on('close', () => { stopped = true; abort?.abort(); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configFile = process.argv[process.argv.indexOf('--config') + 1];
  if (!process.argv.includes('--config') || !configFile) throw new Error('使用 --config 指定仓库之外的独立救援配置');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const server = createRescueServer(config);
  server.listen(config.port || 48950, '127.0.0.1', () => console.log(`Rescue ready: http://127.0.0.1:${server.address().port}`));
}
