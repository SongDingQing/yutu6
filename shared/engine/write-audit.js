'use strict';
/*
 * write-audit(拍板⑤:特权 runner 写路径白名单-告警模式)。
 * 现状:codex-privileged / claude-code 特权 runner 没有机器可核边界(runners.yaml safeguard 是散文)。
 * 首版 = 告警模式:特权 runner 完成的任务在 done-gate 收口处用 git status --porcelain 实际比对
 * (不信自报 changed_files):落在 execution.allowedWritePaths 允许区之外 → 事件
 * privileged.write.outside {runner,files} + 完成回执附 write_audit 告警字段,但不打回不阻断。
 * Starlaid/星桥路径命中 = 仍然硬失败(既有红线不放宽)。
 *
 * 基线脏问题:任务前工作树可能本就脏(其他任务/主人手改),不能把 git status 全量当本任务写入。
 * 实现为【只核 changed_files 声明的文件 ∩ git status 实际有改动/新增文件】,基线脏但未声明的文件不误报。
 * 已知局限(告警模式一期接受,观察后再升硬门):
 *   - 特权 runner 实际写了但拒不声明的文件,不在交集内 → 本审计看不见(由 gitVerify/回执协议约束);
 *   - git status 不可用(非 git 目录/超时)时降级为只核声明文件,结果里 mode='declared_only' 标明。
 * 开关:env YUTU6_WRITE_AUDIT=0 关闭(默认开)。
 */

const path = require('path');
const { spawnSync } = require('child_process');

const WRITE_AUDIT_ENV = 'YUTU6_WRITE_AUDIT';
const STARLAID_RE = /Starlaid|星桥/i;
const GIT_STATUS_TIMEOUT_MS = 15000;

function writeAuditEnabledFromEnv(env) {
  return (env || process.env)[WRITE_AUDIT_ENV] !== '0';
}

// 归一成相对工作区的 posix 路径;工作区外的绝对路径返回 { outsideWorkspace: true }
function normalizeRelPath(file, workspaceRoot) {
  const raw = String(file == null ? '' : file).trim();
  if (!raw) return null;
  const root = workspaceRoot || process.cwd();
  let rel = raw;
  if (path.isAbsolute(raw)) {
    rel = path.relative(root, raw);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep)) {
      return { raw, rel: null, outsideWorkspace: true };
    }
  }
  rel = rel.split(path.sep).join('/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!rel || rel === '.' || /(^|\/)\.\.(\/|$)/.test(rel)) return { raw, rel: null, outsideWorkspace: true };
  return { raw, rel, outsideWorkspace: false };
}

// 解析 git status --porcelain 一行的路径(rename 取新路径;去掉包裹引号)
function porcelainPath(line) {
  let p = String(line || '').slice(3);
  const arrow = p.indexOf(' -> ');
  if (arrow >= 0) p = p.slice(arrow + 4);
  p = p.trim();
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    p = p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return p;
}

function parseGitStatus(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || line.length < 4) continue;
    const p = porcelainPath(line);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

// 一次 porcelain,限制在工作区内、耗时可控;失败返回 null(降级只核声明文件)
function gitStatusFiles(opts = {}) {
  if (typeof opts.gitStatus === 'string') return parseGitStatus(opts.gitStatus);
  const root = opts.workspaceRoot || process.cwd();
  const res = spawnSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.gitTimeoutMs || GIT_STATUS_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) return null;
  return parseGitStatus(res.stdout);
}

// rel 是否命中 git status 结果(含未跟踪目录 `dir/` 前缀 → 目录下新增文件也算命中)
function gitStatusHit(rel, gitFiles) {
  for (const g of gitFiles) {
    const gg = g.replace(/^\.\//, '');
    if (gg === rel) return true;
    if (gg.endsWith('/') && rel.startsWith(gg)) return true;
  }
  return false;
}

function isUnderAllowed(rel, allowedPaths) {
  for (const entry of allowedPaths || []) {
    const a = String(entry || '').trim().split(path.sep).join('/').replace(/^\.\//, '');
    if (!a) continue;
    if (a.endsWith('/')) {
      if (rel === a.slice(0, -1) || rel.startsWith(a)) return true;
    } else if (rel === a || rel.startsWith(a + '/')) {
      return true;
    }
  }
  return false;
}

/*
 * 核心:auditChangedFiles(changedFiles, allowedPaths, { workspaceRoot, gitStatus, runner, enabled })
 * 返回:
 *   { ok:false, reason, blocked:[...] }                      → Starlaid/星桥 命中(硬失败,红线)
 *   { ok:true, enabled:false, skipped:'disabled' }           → 开关关闭,无动作
 *   { ok:true, enabled:true, mode, audited, outside, warn }  → 告警模式结果(outside 非空只告警不打回)
 * mode: 'intersect'(声明 ∩ git status)| 'declared_only'(git 不可用降级,只核声明文件)
 */
function auditChangedFiles(changedFiles, allowedPaths, opts = {}) {
  const enabled = opts.enabled !== undefined ? !!opts.enabled : writeAuditEnabledFromEnv();
  if (!enabled) {
    return { ok: true, enabled: false, skipped: 'disabled', outside: [], audited: [], blocked: [], warn: false };
  }
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const declared = [];
  const blocked = [];
  const outsideWorkspace = [];
  for (const file of Array.isArray(changedFiles) ? changedFiles : []) {
    const norm = normalizeRelPath(file, workspaceRoot);
    if (!norm) continue;
    if (STARLAID_RE.test(norm.raw)) { blocked.push(norm.raw); continue; }
    if (norm.outsideWorkspace) { outsideWorkspace.push(norm.raw); continue; }
    if (!declared.includes(norm.rel)) declared.push(norm.rel);
  }
  if (blocked.length) {
    return {
      ok: false,
      enabled: true,
      reason: `特权写审计: changed_files 命中排除范围(Starlaid/星桥): ${blocked.slice(0, 3).join(', ')}`,
      blocked,
      outside: [],
      audited: [],
      warn: false,
    };
  }
  const gitFiles = gitStatusFiles(Object.assign({ workspaceRoot }, opts));
  const mode = gitFiles === null ? 'declared_only' : 'intersect';
  // 只核【声明 ∩ git 实际改动/新增】:任务前就脏但未声明的基线文件不误报;git 不可用时降级只核声明文件
  const audited = gitFiles === null ? declared : declared.filter(rel => gitStatusHit(rel, gitFiles));
  const outside = audited.filter(rel => !isUnderAllowed(rel, allowedPaths))
    .concat(outsideWorkspace); // 声明的工作区外绝对路径:定义上就在允许区外,直接告警
  return {
    ok: true,
    enabled: true,
    mode,
    runner: opts.runner || null,
    audited,
    outside,
    blocked: [],
    warn: outside.length > 0,
    limitation: mode === 'declared_only' ? 'git status 不可用,降级为只核声明文件' : null,
  };
}

// 从 runners 配置里取"特权且声明了 allowedWritePaths"的 runner(声明式消费点:config.json execution.allowedWritePaths)
function privilegedRunnersWithAllowedPaths(runnersConfig) {
  const out = {};
  for (const [id, r] of Object.entries(runnersConfig && typeof runnersConfig === 'object' ? runnersConfig : {})) {
    const exec = r && r.execution && typeof r.execution === 'object' ? r.execution : {};
    if (exec.privileged === true && Array.isArray(exec.allowedWritePaths) && exec.allowedWritePaths.length) {
      out[id] = exec.allowedWritePaths;
    }
  }
  return out;
}

// 任务实际用过哪些 runner:evidence[]{type:'result',runner} + steps[*].evidence.runner(不信自报,取执行记录)
function runnersUsedByTask(task) {
  const out = [];
  const add = id => {
    const v = String(id || '').trim();
    if (v && !out.includes(v)) out.push(v);
  };
  for (const e of Array.isArray(task && task.evidence) ? task.evidence : []) {
    if (e && typeof e === 'object' && e.runner) add(e.runner);
  }
  const steps = task && task.steps && typeof task.steps === 'object' ? task.steps : {};
  for (const step of Object.values(steps)) {
    if (step && step.evidence && typeof step.evidence === 'object' && step.evidence.runner) add(step.evidence.runner);
  }
  return out;
}

/*
 * done-gate 收口用:auditPrivilegedTaskWrites(task, { workspaceRoot, runnersConfig, gitStatus, enabled })
 * 非特权任务/无 runnersConfig/开关关闭 → { ok:true, skipped:... } 零行为变化(保守默认)。
 */
function auditPrivilegedTaskWrites(task, opts = {}) {
  const enabled = opts.enabled !== undefined ? !!opts.enabled : writeAuditEnabledFromEnv();
  if (!enabled) return { ok: true, enabled: false, skipped: 'disabled' };
  const privileged = privilegedRunnersWithAllowedPaths(opts.runnersConfig);
  if (!Object.keys(privileged).length) return { ok: true, enabled: true, skipped: 'no_runner_config' };
  const used = runnersUsedByTask(task).filter(id => privileged[id]);
  if (!used.length) return { ok: true, enabled: true, skipped: 'no_privileged_runner' };
  const allowed = [];
  for (const id of used) {
    for (const p of privileged[id]) if (!allowed.includes(p)) allowed.push(p);
  }
  const vars = task && task.vars || {};
  const implementation = vars.implementation && typeof vars.implementation === 'object' ? vars.implementation : {};
  const changed = Array.isArray(implementation.changed_files) ? implementation.changed_files : [];
  const res = auditChangedFiles(changed, allowed, Object.assign({}, opts, { enabled: true, runner: used[0] }));
  res.runners = used;
  res.allowed_paths = allowed;
  return res;
}

module.exports = {
  WRITE_AUDIT_ENV,
  writeAuditEnabledFromEnv,
  auditChangedFiles,
  auditPrivilegedTaskWrites,
  privilegedRunnersWithAllowedPaths,
  runnersUsedByTask,
};
