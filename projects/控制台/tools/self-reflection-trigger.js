#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = process.env.YUTU6_WORKSPACE
  ? path.resolve(process.env.YUTU6_WORKSPACE)
  : path.resolve(__dirname, '../../..');
const TOOL = path.join(ROOT, 'projects', '控制台', 'secretary-tools.js');
const ARTIFACT_DIR = path.join(ROOT, 'projects', '控制台', 'artifacts', 'self-reflection-optimizer');
const STATE_FILE = path.join(ARTIFACT_DIR, 'trigger-state.json');
const EVENTS_FILE = path.join(ROOT, 'projects', '控制台', 'artifacts', 'engine-events.jsonl');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (!cur.startsWith('--')) {
      args._.push(cur);
      continue;
    }
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function appendEvent(type, payload) {
  fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(Object.assign({
    ts: new Date().toISOString(),
    type,
  }, payload || {})) + '\n');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function extractCaseEntry(content, requestedTitle) {
  const text = normalizeNewlines(content);
  const headings = [];
  const re = /^##\s+(.+?)\s*$/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    headings.push({
      title: match[1].trim(),
      start: match.index,
      bodyStart: re.lastIndex,
    });
  }
  if (!headings.length) {
    return {
      title: 'whole-file',
      index: 1,
      total: 1,
      content: text.trim(),
    };
  }
  const needle = String(requestedTitle || '').trim();
  let selectedIndex = headings.length - 1;
  if (needle) {
    const found = headings.findIndex(h => h.title === needle || h.title.includes(needle));
    if (found === -1) throw new Error(`case title not found: ${needle}`);
    selectedIndex = found;
  }
  const selected = headings[selectedIndex];
  const end = selectedIndex + 1 < headings.length ? headings[selectedIndex + 1].start : text.length;
  return {
    title: selected.title,
    index: selectedIndex + 1,
    total: headings.length,
    content: text.slice(selected.start, end).trim(),
  };
}

function resolveWorkspacePath(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

function rel(file) {
  return path.relative(ROOT, file);
}

function compact(text, max = 900) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function triggerKey(moduleName, source, caseHash) {
  return `${moduleName}:${rel(source)}:${caseHash.slice(0, 16)}`;
}

function findExistingTrigger(state, moduleName, source, caseHash) {
  const sourceRel = rel(source);
  for (const [key, value] of Object.entries(state.triggers || {})) {
    if (!value || typeof value !== 'object') continue;
    if (value.module === moduleName && value.source === sourceRel && value.hash === caseHash) {
      return { key, value };
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = resolveWorkspacePath(args.source || args.case || args._[0]);
  if (!source) throw new Error('missing --source');
  if (!fs.existsSync(source)) throw new Error(`source not found: ${source}`);

  const moduleName = String(args.module || args.target || path.basename(source, path.extname(source))).trim() || 'unknown-module';
  const reason = String(args.reason || 'learning case updated').trim();
  const priority = String(args.priority || '35');
  const dryRun = args['dry-run'] === true || args.dryRun === true;
  const content = fs.readFileSync(source, 'utf8');
  const selectedCase = extractCaseEntry(content, args['case-title'] || args.caseTitle || args.heading);
  const sourceHash = sha256(`${moduleName}\n${rel(source)}\n${content}`);
  const caseHash = sha256(`${moduleName}\n${rel(source)}\n${selectedCase.title}\n${selectedCase.content}`);
  const state = readJson(STATE_FILE, { version: 1, triggers: {} });
  state.version = Math.max(Number(state.version) || 1, 2);
  state.triggers = state.triggers && typeof state.triggers === 'object' ? state.triggers : {};
  const key = triggerKey(moduleName, source, caseHash);
  const legacyKey = `${moduleName}:${rel(source)}`;
  const prev = state.triggers[key] || (findExistingTrigger(state, moduleName, source, caseHash) || {}).value;
  const legacyPrev = state.triggers[legacyKey];
  const queueId = `self-reflect-${caseHash.slice(0, 12)}`;

  if ((prev && prev.hash === caseHash) || (legacyPrev && (legacyPrev.hash === caseHash || legacyPrev.hash === sourceHash))) {
    const matchedPrev = prev || legacyPrev || {};
    const result = {
      ok: true,
      skipped: true,
      reason: 'unchanged',
      module: moduleName,
      source: rel(source),
      queueId: matchedPrev.queueId || queueId,
      hash: caseHash,
      sourceHash,
      case: {
        title: selectedCase.title,
        index: selectedCase.index,
        total: selectedCase.total,
      },
      dryRun,
    };
    if (!dryRun && !prev) {
      state.triggers[key] = Object.assign({}, legacyPrev || {}, {
        hash: caseHash,
        source_hash: sourceHash,
        module: moduleName,
        source: rel(source),
        queueId: result.queueId,
        case: result.case,
        migrated_from: legacyKey,
      });
      writeJsonAtomic(STATE_FILE, state);
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const goal = [
    `触发自省优化: 读取优秀案例 ${rel(source)}#${selectedCase.title}, 对模块 ${moduleName} 做一次自省优化。`,
    `原因: ${reason}`,
    '要求: 先强力挑刺并列证据; 每个缺点给优化建议; 明确低风险高收益项可自动执行并验证;',
    '有争议、不确定利弊、影响现有功能/接口/队列/权限/成本的改动必须形成主人拍板项, 未批准不得执行;',
    '把可复用结果补入 board/learning-cases/self-reflection-optimizer-cases.md; 未登记或未授权项目不处理; 密钥不回显。',
  ].join('\n');

  const acceptance = [
    '产出 critique ledger;',
    'auto_execute 项有 diff/测试或检查证据;',
    'owner_decision 项写清选项/风险/推荐默认;',
    '新增优秀案例会继续触发自省优化但必须按案例条目哈希去重;',
    '事件日志可追踪。',
  ].join(' ');

  const payload = {
    ok: true,
    dryRun,
    skipped: false,
    module: moduleName,
    source: rel(source),
    hash: caseHash,
    sourceHash,
    case: {
      title: selectedCase.title,
      index: selectedCase.index,
      total: selectedCase.total,
    },
    queueId,
    goal: compact(goal, 1200),
  };

  if (dryRun) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  const res = spawnSync(process.execPath, [
    TOOL,
    'queue-enqueue',
    '--agent', 'secretary',
    '--id', queueId,
    '--idem', `self-reflection:${caseHash}`,
    '--priority', priority,
    '--goal', goal,
    '--reason', reason,
    '--acceptance', acceptance,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });

  let queueResult = null;
  try { queueResult = JSON.parse(res.stdout || '{}'); }
  catch (_) { queueResult = { raw: compact(res.stdout || '', 1000) }; }

  payload.queue = queueResult;
  payload.code = res.status;
  payload.stderr = compact(res.stderr || '', 1200);
  payload.ok = res.status === 0 && (!queueResult || queueResult.ok !== false);

  if (!payload.ok) {
    appendEvent('self_reflection.trigger_failed', {
      module: moduleName,
      source: rel(source),
      queueId,
      reason,
      code: res.status,
      stderr: payload.stderr,
    });
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    process.exit(res.status || 1);
  }

  state.triggers[key] = {
    hash: caseHash,
    source_hash: sourceHash,
    module: moduleName,
    source: rel(source),
    case: payload.case,
    queueId,
    reason,
    queued_at: new Date().toISOString(),
  };
  writeJsonAtomic(STATE_FILE, state);
  appendEvent('self_reflection.triggered', {
    module: moduleName,
    source: rel(source),
    queueId,
    reason,
    hash: caseHash,
    sourceHash,
    case: payload.case,
  });
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
}
