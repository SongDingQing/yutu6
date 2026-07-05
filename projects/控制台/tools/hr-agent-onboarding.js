#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const AGENTS_DIR = path.join(ROOT, 'shared/agents');
const CONFIG_PATH = path.join(ROOT, 'projects/控制台/config.json');
const MODEL_ROUTING = path.join(ROOT, 'shared/routing/model-routing.yaml');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function listAgents() {
  const out = [];
  for (const id of fs.readdirSync(AGENTS_DIR)) {
    const file = path.join(AGENTS_DIR, id, 'agent.json');
    if (fs.existsSync(file)) {
      const agent = readJson(file);
      if (agent) out.push(agent);
    }
  }
  return out;
}

function normalizeSpec(raw) {
  const spec = Object.assign({}, raw || {});
  spec.id = String(spec.id || '').trim();
  spec.name = String(spec.name || spec.id || '').trim();
  spec.role = String(spec.role || '').trim();
  spec.ownership = String(spec.ownership || spec.owner || spec.department || spec.project_scope || '').trim();
  spec.capability = String(spec.capability || spec.responsibility || spec.description || '').trim();
  spec.runner = String(spec.runner || spec.model || spec.quota_model || '').trim();
  spec.read_paths = Array.isArray(spec.read_paths) ? spec.read_paths : [];
  spec.writes = Array.isArray(spec.writes) ? spec.writes : [];
  spec.triggers = Array.isArray(spec.triggers) ? spec.triggers : [];
  return spec;
}

function fourElementCheck(spec) {
  const missing = [];
  if (!spec.ownership) missing.push('归属');
  if (!spec.capability) missing.push('能力');
  if (!spec.runner) missing.push('额度/模型');
  if (!spec.read_paths.length && !spec.writes.length) missing.push('文件权限');
  return missing;
}

function duplicateCheck(spec) {
  const agents = listAgents();
  const config = readJson(CONFIG_PATH, { roleRouting: {} });
  const duplicates = [];
  for (const a of agents) {
    if (a.id === spec.id) duplicates.push(`agent id 已存在: ${a.id}`);
    if (a.role === spec.role) duplicates.push(`role 已存在: ${a.role}`);
    if (spec.name && a.name === spec.name) duplicates.push(`name 已存在: ${a.name}`);
  }
  if (config.roleRouting && config.roleRouting[spec.role]) duplicates.push(`config roleRouting 已存在: ${spec.role}`);
  return duplicates;
}

function pathRisk(p, spec) {
  const s = String(p || '');
  if (!s) return null;
  const ownAgentDir = `shared/agents/${spec.id}/`;
  if (s.startsWith(ownAgentDir) || s === ownAgentDir) return null;
  if (s.startsWith('projects/控制台/artifacts/hr/') || s.startsWith('shared/knowledge/')) return null;
  if (/[<*]/.test(s)) return `通配/占位路径: ${s}`;
  if (/^(shared\/engine|shared\/routing|projects\/控制台\/server\.js|projects\/控制台\/ceo-worker\.js|projects\/控制台\/engine-runner\.js|projects\/控制台\/config\.json|board\/|memory\/|knowledge\/|projects\/[^/]+\/)/.test(s)) return `核心或跨域写路径: ${s}`;
  return null;
}

function riskLevel(spec) {
  const reasons = [];
  if (/codex|claude|privileged|repair/i.test(spec.runner)) reasons.push(`付费/强权限 runner: ${spec.runner}`);
  for (const wp of spec.writes) {
    const risk = pathRisk(wp, spec);
    if (risk) reasons.push(risk);
  }
  return {
    level: reasons.length ? 'high' : 'low',
    reasons,
    approval_required: reasons.length > 0,
  };
}

function renderAgentJson(spec) {
  return {
    id: spec.id,
    name: spec.name,
    schema_version: 1,
    role: spec.role,
    runner: spec.runner,
    tier: spec.tier || (spec.runner === 'zhipu-glm' ? 'standard' : 'strong'),
    context_mode: spec.context_mode || 'explicit',
    queueAgent: spec.queueAgent !== false,
    persistent_worker: false,
    system_external: false,
    owner: spec.ownership,
    read_paths: spec.read_paths,
    writes: spec.writes,
    tools: spec.tools || [],
    triggers: spec.triggers,
    io: {
      inputs: spec.inputs || ['批准后的任务信封'],
      outputs: spec.outputs || ['执行结果与验证证据'],
    },
    boundary_statement: {
      does: spec.capability,
      does_not: spec.does_not || '不越过归属和文件权限;不处理密钥、登录、授权或 Starlaid。',
    },
    decoupling: spec.decoupling || '按归属和最小权限工作;超出边界时退回主管或 HR。',
    validation: spec.validation || '创建后必须通过 agents-check 与任务相关 smoke。',
    prompt: 'prompt.md',
  };
}

function renderPrompt(spec) {
  return [
    `# ${spec.name}`,
    '',
    '## 职责边界声明',
    '',
    `我做什么: ${spec.capability}`,
    `我不做什么: ${spec.does_not || '不越过归属和文件权限;不处理密钥、登录、授权或 Starlaid。'}`,
    '',
    '## 知识定位',
    '',
    '- 先读自己的任务信封和 `agent.json.read_paths`。',
    '- 不知道数据在哪时查 `shared/DATA-MAP.md`。',
    '- 部门共享知识区按归属读取;深度检索用 `python knowledge/query.py "<问题>"`。',
    '- 长期记忆由记忆官维护,不要把流水账直接写进 `memory/`。',
    '',
    '## 红线',
    '',
    '- Starlaid 排除。',
    '- 密钥/token/cookie/验证码不回显、不写入文件。',
    '- 登录、扫码、OAuth、2FA、系统授权交给主人手动。',
    '- 超出权限或审批缺失时停下说明。',
    '',
  ].join('\n');
}

function validateSpec(raw) {
  const spec = normalizeSpec(raw);
  const missing = fourElementCheck(spec);
  const duplicates = duplicateCheck(spec);
  const risk = riskLevel(spec);
  return {
    pass: missing.length === 0 && duplicates.length === 0,
    spec,
    four_elements: {
      pass: missing.length === 0,
      missing,
    },
    duplicate_check: {
      pass: duplicates.length === 0,
      duplicates,
    },
    risk,
    rendered: {
      agent_json: renderAgentJson(spec),
      prompt_md: renderPrompt(spec),
    },
  };
}

function smoke() {
  const required = ['hr-manager', 'hr-specialist'];
  const agents = listAgents();
  const ids = new Set(agents.map(a => a.id));
  const config = readJson(CONFIG_PATH, { roleRouting: {} });
  const routingText = fs.readFileSync(MODEL_ROUTING, 'utf8');
  const sample = {
    id: `hr-smoke-agent-${Date.now()}`,
    name: 'HR Smoke Agent',
    role: `hr_smoke_agent_${Math.random().toString(16).slice(2, 8)}`,
    ownership: 'HR',
    capability: '只用于验证 HR 入职流程模板渲染。',
    runner: 'zhipu-glm',
    read_paths: ['shared/DATA-MAP.md', 'shared/knowledge/hr/'],
    writes: [`shared/agents/hr-smoke-agent/`],
    triggers: ['HR smoke'],
  };
  const validation = validateSpec(sample);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-onboarding-smoke-'));
  fs.writeFileSync(path.join(tmp, 'agent.json'), JSON.stringify(validation.rendered.agent_json, null, 2) + '\n');
  fs.writeFileSync(path.join(tmp, 'prompt.md'), validation.rendered.prompt_md);
  return {
    pass: required.every(id => ids.has(id))
      && Boolean(config.roleRouting && config.roleRouting.hr_manager && config.roleRouting.hr_specialist)
      && /hr_manager:/.test(routingText)
      && /hr_specialist:/.test(routingText)
      && validation.pass,
    required_agents: required.map(id => ({ id, present: ids.has(id) })),
    routing: {
      config_hr_manager: Boolean(config.roleRouting && config.roleRouting.hr_manager),
      config_hr_specialist: Boolean(config.roleRouting && config.roleRouting.hr_specialist),
      model_hr_manager: /hr_manager:/.test(routingText),
      model_hr_specialist: /hr_specialist:/.test(routingText),
    },
    flow: ['四要素校验', '查重', '分级审批', '填模板', '注册校验', 'smoke校验', '花名册'],
    sample_validation: validation,
    rendered_tmp: tmp,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const cmd = args._[0] || 'help';
  if (cmd === 'validate') {
    if (!args.spec) throw new Error('validate requires --spec <file>');
    const result = validateSpec(readJson(path.resolve(args.spec), {}));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 2);
  }
  if (cmd === 'smoke') {
    const result = smoke();
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
  }
  console.log('Usage: node projects/控制台/tools/hr-agent-onboarding.js validate --spec <spec.json>');
  console.log('       node projects/控制台/tools/hr-agent-onboarding.js smoke');
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    console.error(e && e.stack || e);
    process.exit(1);
  }
}

module.exports = { normalizeSpec, fourElementCheck, duplicateCheck, riskLevel, validateSpec, smoke };
