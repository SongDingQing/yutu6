#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_ROOT = path.resolve(__dirname, '../../..');
const VERSION_FILE_NAME = 'VERSION.json';
const DEFAULT_REMOTE_NAME = 'gitee';
const GITEE_WEB_URL = 'https://gitee.com/songdingqing/yutu6';
const GITEE_SSH_URL = 'git@gitee.com:songdingqing/yutu6.git';
const VERSION_SCHEMA = 1;
const PARTS = ['manual', 'major', 'minor', 'fix'];
const PART_LABELS = {
  manual: '手动',
  major: '大功能模块变动',
  minor: '小功能增加/改动',
  fix: 'UI及bug修复',
};
const SENSITIVE_NAME_TOKENS = new Set(['secret', 'secrets', 'token', 'tokens', 'password', 'passwords']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) {
      out._.push(raw);
      continue;
    }
    const key = raw.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    const value = next && !next.startsWith('--') ? next : true;
    if (value !== true) i++;
    if (out[key] == null) out[key] = value;
    else if (Array.isArray(out[key])) out[key].push(value);
    else out[key] = [out[key], value];
  }
  return out;
}

function redact(text) {
  return String(text || '')
    .replace(/(https?:\/\/)[^@\s/]+@/g, '$1[redacted]@')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)[A-Za-z0-9_ -]*[=:]\s*)[^\s,'"}]+/ig, '$1[redacted]');
}

function rootFromArgs(args = {}) {
  return path.resolve(args.root || process.env.YUTU6_WORKDIR || DEFAULT_ROOT);
}

function versionFile(root) {
  return path.join(root, VERSION_FILE_NAME);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function parseVersion(version) {
  const m = String(version || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/);
  if (!m) throw new Error(`bad four-part version: ${version || '(empty)'}`);
  return m.slice(1).map(n => Number(n));
}

function formatVersion(parts) {
  if (!Array.isArray(parts) || parts.length !== 4) throw new Error('version requires four parts');
  for (const n of parts) {
    if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`version part out of range: ${n}`);
  }
  return parts.join('.');
}

function normalizePart(part) {
  const key = String(part || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const aliases = {
    0: 'manual',
    1: 'major',
    2: 'minor',
    3: 'fix',
    manual: 'manual',
    hand: 'manual',
    major: 'major',
    module: 'major',
    feature: 'major',
    big: 'major',
    minor: 'minor',
    change: 'minor',
    small: 'minor',
    fix: 'fix',
    bug: 'fix',
    ui: 'fix',
    ui_bug: 'fix',
    bugfix: 'fix',
  };
  const out = aliases[key];
  if (!out) throw new Error(`unknown version part: ${part}`);
  return out;
}

function bumpVersion(version, part) {
  const parts = parseVersion(version);
  const idx = PARTS.indexOf(normalizePart(part));
  if (idx < 0) throw new Error(`unknown version part: ${part}`);
  parts[idx] += 1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] <= 99) continue;
    if (i === 0) throw new Error('four-part version overflow');
    parts[i] = 0;
    parts[i - 1] += 1;
  }
  return formatVersion(parts);
}

function readVersionState(root) {
  const file = versionFile(root);
  const state = readJson(file, null);
  if (!state) {
    return {
      schema_version: VERSION_SCHEMA,
      version: '0.0.0.0',
      updated_at: null,
      owner_agent: 'it-engineer',
      last_change: null,
    };
  }
  return Object.assign({
    schema_version: VERSION_SCHEMA,
    owner_agent: 'it-engineer',
  }, state);
}

function git(root, args, opts = {}) {
  const res = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    maxBuffer: opts.maxBuffer || (16 * 1024 * 1024),
  });
  if (!opts.allowFailure && res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${redact((res.stderr || res.stdout || '').trim())}`);
  }
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function ensureGitRepo(root) {
  const top = git(root, ['rev-parse', '--show-toplevel']).stdout.trim();
  const actual = fs.realpathSync(top);
  const expected = fs.realpathSync(root);
  if (path.resolve(actual) !== path.resolve(expected)) {
    throw new Error(`version-manager must run at repo root; got ${top}`);
  }
  return top;
}

function currentBranch(root) {
  return git(root, ['branch', '--show-current']).stdout.trim() || 'HEAD';
}

function currentCommit(root) {
  return git(root, ['rev-parse', '--short=12', 'HEAD']).stdout.trim();
}

function getRemoteUrl(root, remote) {
  const res = git(root, ['remote', 'get-url', remote], { allowFailure: true });
  return res.ok ? res.stdout.trim() : '';
}

function inspectGiteeRemote(root, remoteName = DEFAULT_REMOTE_NAME) {
  const existing = getRemoteUrl(root, remoteName);
  if (existing) {
    return { name: remoteName, action: 'kept', url: redact(existing), webUrl: GITEE_WEB_URL };
  }
  return { name: remoteName, action: 'would-add', url: GITEE_SSH_URL, webUrl: GITEE_WEB_URL };
}

function ensureGiteeRemote(root, remoteName = DEFAULT_REMOTE_NAME) {
  const existing = getRemoteUrl(root, remoteName);
  if (existing) {
    return { name: remoteName, action: 'kept', url: redact(existing), webUrl: GITEE_WEB_URL };
  }
  git(root, ['remote', 'add', remoteName, GITEE_SSH_URL]);
  return { name: remoteName, action: 'added', url: GITEE_SSH_URL, webUrl: GITEE_WEB_URL };
}

function flattenValues(...values) {
  const out = [];
  for (const value of values) {
    if (Array.isArray(value)) out.push(...value);
    else if (value != null && value !== false) out.push(value);
  }
  return out;
}

function parsePathList(args = {}) {
  const raw = flattenValues(args.path, args.paths)
    .flatMap(v => String(v).split(','))
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set(raw)];
}

function toRepoRel(root, file) {
  const abs = path.isAbsolute(file) ? path.resolve(file) : path.resolve(root, file);
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path outside repo: ${file}`);
  if (isSensitivePath(rel)) throw new Error(`refuse to stage sensitive path: ${rel}`);
  return rel;
}

function isSensitivePath(rel) {
  return String(rel || '').split('/').some(segment => {
    const lower = segment.toLowerCase();
    if (!lower) return false;
    if (lower === '.git') return true;
    if (/\.(?:env|pem|key)$/.test(lower)) return true;
    if (/_key(?:\.[^.]+)?$/.test(lower)) return true;
    if (/^(?:auth|cookies?)\.json$/.test(lower)) return true;
    const stem = lower.replace(/\.[^.]+$/, '');
    return stem.split(/[._-]+/).some(token => SENSITIVE_NAME_TOKENS.has(token));
  });
}

function dirtyFilePaths(root) {
  const out = git(root, ['status', '--porcelain', '--untracked-files=all']).stdout.trim();
  if (!out) return [];
  return out.split(/\r?\n/)
    .flatMap(line => {
      const p = line.slice(3).trim();
      if (!p) return [];
      if (/^[RC]/.test(line)) return p.split(/\s+->\s+/).filter(Boolean);
      return [p];
    })
    .filter(Boolean);
}

function currentStagedFiles(root) {
  const out = git(root, ['diff', '--cached', '--name-only']).stdout.trim();
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

function dirtyFiles(root) {
  const out = git(root, ['status', '--porcelain']).stdout.trim();
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

function stageSelected(root, paths, opts = {}) {
  const rels = opts.all
    ? ['.']
    : [...new Set([...paths.map(p => toRepoRel(root, p)), VERSION_FILE_NAME])];
  git(root, ['add', '--', ...rels]);
  return rels;
}

function validateSelectedPaths(root, paths, opts = {}) {
  if (opts.all) {
    const dirty = dirtyFilePaths(root);
    const sensitive = dirty.filter(rel => isSensitivePath(rel));
    if (sensitive.length) throw new Error(`refuse --all with sensitive path: ${sensitive.slice(0, 10).join(', ')}`);
    return ['.'];
  }
  return [...new Set(paths.map(p => toRepoRel(root, p)))];
}

function commitMessage(version, summary, part, extraLines = []) {
  const title = `v${version} ${String(summary || '').trim()}`.trim();
  const lines = [
    title,
    '',
    `版本: ${version}`,
    `四段: ${PART_LABELS.manual} - ${PART_LABELS.major} - ${PART_LABELS.minor} - ${PART_LABELS.fix}`,
    `本次更新类型: ${PART_LABELS[part] || part}`,
    `本次更新内容: ${String(summary || '').trim()}`,
    ...extraLines.filter(Boolean),
  ];
  return lines.join('\n');
}

function writeVersionState(root, patch) {
  const prev = readVersionState(root);
  const next = Object.assign({}, prev, patch, {
    schema_version: VERSION_SCHEMA,
    owner_agent: 'it-engineer',
    updated_at: new Date().toISOString(),
    remote: {
      name: DEFAULT_REMOTE_NAME,
      web_url: GITEE_WEB_URL,
      push_url: GITEE_SSH_URL,
    },
    parts: {
      manual: PART_LABELS.manual,
      major: PART_LABELS.major,
      minor: PART_LABELS.minor,
      fix: PART_LABELS.fix,
    },
  });
  writeJsonAtomic(versionFile(root), next);
  return next;
}

function release(args = {}) {
  const root = rootFromArgs(args);
  ensureGitRepo(root);
  const remoteName = String(args.remote || DEFAULT_REMOTE_NAME);
  let remote = args.noRemote ? { name: remoteName, action: 'skipped', url: '', webUrl: GITEE_WEB_URL } : inspectGiteeRemote(root, remoteName);
  const part = normalizePart(args.part || args.bump || args.kind || 'fix');
  const summary = String(args.message || args.summary || args.update || '').trim();
  if (!summary) throw new Error('release requires --message');
  const explicitPaths = parsePathList(args);
  const all = args.all === true || args.all === 'true';
  if (!all && !explicitPaths.length) throw new Error('release requires --path/--paths, or explicit --all');
  const current = readVersionState(root);
  const nextVersion = args.version ? formatVersion(parseVersion(args.version)) : bumpVersion(current.version, part);
  const planned = {
    ok: true,
    action: 'release',
    dryRun: !!args.dryRun,
    root,
    previousVersion: current.version,
    nextVersion,
    part,
    partLabel: PART_LABELS[part],
    summary,
    remote,
    branch: currentBranch(root),
    paths: all ? ['.'] : explicitPaths,
  };
  if (args.dryRun) return planned;

  const stagedBefore = currentStagedFiles(root);
  if (stagedBefore.length && args.allowStaged !== true && args.allowStaged !== 'true') {
    throw new Error(`refuse to release with pre-staged files: ${stagedBefore.join(', ')}`);
  }
  validateSelectedPaths(root, explicitPaths, { all });
  if (!args.noRemote) {
    remote = ensureGiteeRemote(root, remoteName);
    planned.remote = remote;
  }
  const state = writeVersionState(root, {
    version: nextVersion,
    last_change: {
      part,
      part_label: PART_LABELS[part],
      summary,
      at: new Date().toISOString(),
    },
  });
  const staged = stageSelected(root, explicitPaths, { all });
  const stagedAfter = currentStagedFiles(root);
  if (!stagedAfter.length) throw new Error('nothing staged for release');
  const msg = commitMessage(nextVersion, summary, part);
  git(root, ['commit', '-m', msg], { timeout: 120000 });
  const commit = currentCommit(root);
  let push = { attempted: false, ok: false };
  if (args.push === true || args.push === 'true') {
    const branch = currentBranch(root);
    git(root, ['push', '-u', remoteName, branch], { timeout: 180000 });
    push = { attempted: true, ok: true, remote: remoteName, branch };
  }
  return Object.assign(planned, {
    dryRun: false,
    versionState: state,
    staged,
    committed: true,
    commit,
    push,
  });
}

function resolveTargetCommit(root, target) {
  const raw = String(target || '').trim();
  if (!raw) throw new Error('rollback requires --target');
  if (/^\d{1,2}\.\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(raw)) {
    const lines = git(root, ['log', '--format=%H%x09%s']).stdout.split(/\r?\n/).filter(Boolean);
    const found = lines.find(line => {
      const subject = line.split('\t').slice(1).join('\t');
      return subject === `v${raw}` || subject.startsWith(`v${raw} `) || subject.startsWith(`[${raw}]`);
    });
    if (!found) throw new Error(`version not found in git log: ${raw}`);
    return { input: raw, kind: 'version', commit: found.split('\t')[0] };
  }
  const res = git(root, ['rev-parse', '--verify', `${raw}^{commit}`]);
  return { input: raw, kind: 'commit', commit: res.stdout.trim() };
}

function commitsAfter(root, commit) {
  const out = git(root, ['rev-list', '--reverse', `${commit}..HEAD`]).stdout.trim();
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

function rollback(args = {}) {
  const root = rootFromArgs(args);
  ensureGitRepo(root);
  const remoteName = String(args.remote || DEFAULT_REMOTE_NAME);
  const target = resolveTargetCommit(root, args.target);
  const commits = commitsAfter(root, target.commit);
  const current = readVersionState(root);
  const part = normalizePart(args.part || args.bump || 'manual');
  const nextVersion = bumpVersion(current.version, part);
  const dirty = dirtyFiles(root);
  const plan = {
    ok: true,
    action: 'rollback',
    dryRun: !(args.confirm === true || args.confirm === 'true'),
    root,
    target,
    commitsToRevert: commits.length,
    currentHead: currentCommit(root),
    currentVersion: current.version,
    nextVersion,
    part,
    partLabel: PART_LABELS[part],
    clean: dirty.length === 0,
    dirty: dirty.slice(0, 50),
  };
  if (plan.dryRun) return plan;
  const reason = String(args.reason || '').trim();
  if (!reason) throw new Error('confirmed rollback requires --reason');
  if (dirty.length) throw new Error(`refuse rollback with dirty worktree: ${dirty.slice(0, 10).join(', ')}`);
  if (!commits.length) throw new Error('target is already HEAD; nothing to rollback');

  const revert = git(root, ['revert', '--no-commit', ...commits], { allowFailure: true, timeout: 180000 });
  if (!revert.ok) {
    git(root, ['revert', '--abort'], { allowFailure: true });
    throw new Error(`git revert failed and was aborted: ${redact((revert.stderr || revert.stdout || '').trim())}`);
  }
  const shortTarget = target.commit.slice(0, 12);
  const state = writeVersionState(root, {
    version: nextVersion,
    last_change: {
      part,
      part_label: PART_LABELS[part],
      summary: `rollback to ${target.input}`,
      reason,
      target: target.input,
      target_commit: target.commit,
      at: new Date().toISOString(),
    },
  });
  git(root, ['add', '--', VERSION_FILE_NAME]);
  const msg = commitMessage(nextVersion, `回滚到 ${target.input}`, part, [
    `回滚原因: ${reason}`,
    `目标提交: ${shortTarget}`,
    `回滚策略: git revert --no-commit + single versioned commit`,
  ]);
  git(root, ['commit', '-m', msg], { timeout: 120000 });
  const commit = currentCommit(root);
  let push = { attempted: false, ok: false };
  if (args.push === true || args.push === 'true') {
    const branch = currentBranch(root);
    ensureGiteeRemote(root, remoteName);
    git(root, ['push', '-u', remoteName, branch], { timeout: 180000 });
    push = { attempted: true, ok: true, remote: remoteName, branch };
  }
  return Object.assign(plan, {
    dryRun: false,
    versionState: state,
    committed: true,
    commit,
    push,
  });
}

function status(args = {}) {
  const root = rootFromArgs(args);
  ensureGitRepo(root);
  const state = readVersionState(root);
  const remoteName = String(args.remote || DEFAULT_REMOTE_NAME);
  return {
    ok: true,
    version: state.version,
    updated_at: state.updated_at || null,
    owner_agent: state.owner_agent || 'it-engineer',
    last_change: state.last_change || null,
    file: path.relative(root, versionFile(root)).split(path.sep).join('/'),
    branch: currentBranch(root),
    head: currentCommit(root),
    remote: {
      name: remoteName,
      url: redact(getRemoteUrl(root, remoteName)) || null,
      web_url: GITEE_WEB_URL,
    },
    dirtyCount: dirtyFiles(root).length,
  };
}

// 版本历史:从 VERSION.json 的 git 提交历史构建(权威、含手动 bump,优于只记自动 bump 的审计日志)。
// 返回 [{version, at, hash, desc, commitUrl, group}],时间倒序;按前两段(manual.major)分组留给前端折叠。
function cleanVersionDesc(subject) {
  let s = String(subject || '').trim();
  s = s.replace(/\s*[→=]*[->]*\s*v?\d+\.\d+\.\d+\.\d+\s*$/i, '');            // 去尾部 "→ 0.0.4.5"
  s = s.replace(/^v?\d+\.\d+\.\d+\.\d+\s*[（(][^)）]*[)）]\s*[:：]?\s*/i, '');      // 去开头 "v0.0.2.3(minor): "
  s = s.replace(/^v?\d+\.\d+\.\d+\.\d+\s*[:：]\s*/i, '');                         // 去开头 "0.0.4.5: "
  return s.trim().slice(0, 200);
}

function versionHistory(root, opts = {}) {
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 80, 1), 300);
  const res = git(root, ['log', '-n', String(limit), '--no-merges', '--format=%cI%x09%H%x09%s', '--', VERSION_FILE_NAME], { allowFailure: true });
  if (!res.ok) return [];
  const out = [];
  const seen = new Set();
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab = line.split('\t');
    const at = tab[0] || null;
    const hash = (tab[1] || '').slice(0, 10);
    const subject = tab.slice(2).join('\t');
    const vm = subject.match(/(\d+\.\d+\.\d+\.\d+)/);
    const version = vm ? vm[1] : null;
    if (version && seen.has(version)) continue;   // 同一版本多次提交只取最新一条
    if (version) seen.add(version);
    out.push({
      version,
      at,
      hash,
      desc: cleanVersionDesc(subject),
      commitUrl: hash ? `${GITEE_WEB_URL}/commit/${hash}` : null,
      group: version ? version.split('.').slice(0, 2).join('.') : null,
    });
  }
  return out;
}

function main() {
  const [cmd = 'status', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  let result;
  if (cmd === 'status') result = status(args);
  else if (cmd === 'ensure-remote') {
    const root = rootFromArgs(args);
    ensureGitRepo(root);
    result = { ok: true, remote: ensureGiteeRemote(root, String(args.remote || DEFAULT_REMOTE_NAME)) };
  } else if (cmd === 'release') result = release(args);
  else if (cmd === 'rollback') result = rollback(args);
  else if (cmd === 'bump-preview') {
    const part = normalizePart(args.part || args.bump || 'fix');
    const version = args.version || readVersionState(rootFromArgs(args)).version;
    result = { ok: true, previousVersion: version, nextVersion: bumpVersion(version, part), part, partLabel: PART_LABELS[part] };
  } else {
    throw new Error(`unknown command: ${cmd}`);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) {
  try { main(); }
  catch (e) {
    process.stderr.write(redact(e && e.message || e) + '\n');
    process.exit(1);
  }
}

module.exports = {
  PARTS,
  PART_LABELS,
  GITEE_WEB_URL,
  GITEE_SSH_URL,
  parseArgs,
  parseVersion,
  formatVersion,
  normalizePart,
  bumpVersion,
  readVersionState,
  release,
  rollback,
  status,
  resolveTargetCommit,
  commitsAfter,
  versionHistory,
  cleanVersionDesc,
};
