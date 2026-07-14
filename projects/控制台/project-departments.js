'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = 'department.json';
const DEFAULT_MAX_PROJECTS = 32;
const DEFAULT_RATE_LIMIT = 5;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const creationAttempts = new Map();

function normalizeProjectId(value) {
  const id = String(value == null ? '' : value).normalize('NFKC').trim();
  if (!id || id.length > 64) throw new Error('project_id_invalid_length');
  if (id === '.' || id === '..' || id.startsWith('.') || id.startsWith('_')) throw new Error('project_id_reserved');
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(id)) throw new Error('project_id_invalid_characters');
  return id;
}

function cleanText(value, fallback, max) {
  const text = String(value == null ? '' : value).trim() || fallback;
  if (text.length > max || /[\0]/.test(text)) throw new Error('project_text_invalid');
  return text;
}

function workspaceRoot(opts = {}) {
  return path.resolve(opts.workspaceRoot || path.join(__dirname, '../..'));
}

function pathsFor(projectId, opts = {}) {
  const root = workspaceRoot(opts);
  const projectsDir = path.join(root, 'projects');
  const id = normalizeProjectId(projectId);
  const projectDir = path.join(projectsDir, id);
  if (!projectDir.startsWith(`${projectsDir}${path.sep}`)) throw new Error('project_path_escape');
  return { root, projectsDir, projectDir, manifest: path.join(projectDir, MANIFEST_NAME), id };
}

function writeExclusive(file, content) {
  fs.writeFileSync(file, content, { flag: 'wx', mode: 0o644 });
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function departmentManifest(id, input = {}) {
  const name = cleanText(input.name, id, 100);
  const description = cleanText(input.description, '新项目部门', 500);
  return {
    schemaVersion: 1,
    projectId: id,
    name,
    description,
    type: 'project',
    supervisor: { role: 'supervisor', queueAgent: `supervisor-${id}`, scopedToProject: true },
    queueInitialization: 'lazy-on-first-task',
    capabilityRegistry: {
      path: 'shared/capability_registry/registry.json',
      capabilities: ['multi-agent-collaboration-contract'],
    },
    staffTemplates: ['worker_code', 'worker_narrow', 'frontend_designer'],
    status: 'active',
    createdAt: new Date().toISOString(),
  };
}

function positiveLimit(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function enforceCreationPolicy(p, opts = {}) {
  const maxProjects = positiveLimit(opts.maxProjects || process.env.YUTU6_MAX_PROJECTS, DEFAULT_MAX_PROJECTS, 1000);
  if (listProjectDepartments(opts).length >= maxProjects) throw new Error('project_limit_reached');

  const rateLimit = positiveLimit(opts.rateLimit || process.env.YUTU6_PROJECT_CREATE_RATE_LIMIT, DEFAULT_RATE_LIMIT, 100);
  const windowMs = positiveLimit(opts.rateWindowMs || process.env.YUTU6_PROJECT_CREATE_RATE_WINDOW_MS, DEFAULT_RATE_WINDOW_MS, 60 * 60 * 1000);
  const now = Number(opts.now == null ? Date.now() : opts.now);
  const attempts = (creationAttempts.get(p.root) || []).filter(timestamp => now - timestamp < windowMs);
  if (attempts.length >= rateLimit) {
    creationAttempts.set(p.root, attempts);
    throw new Error('project_create_rate_limited');
  }
  attempts.push(now);
  creationAttempts.set(p.root, attempts);
}

function createProjectDepartment(input = {}, opts = {}) {
  const p = pathsFor(input.projectId || input.id, opts);
  const existing = readJson(p.manifest);
  if (existing) {
    if (existing.projectId !== p.id || existing.type !== 'project') throw new Error('project_manifest_conflict');
    return { ok: true, created: false, idempotent: true, project: existing, path: p.projectDir };
  }
  if (fs.existsSync(p.projectDir)) throw new Error('project_directory_exists_without_manifest');
  enforceCreationPolicy(p, opts);

  const manifest = departmentManifest(p.id, input);
  fs.mkdirSync(p.projectsDir, { recursive: true });
  let ownsProjectDir = false;
  try {
    try {
      fs.mkdirSync(p.projectDir);
      ownsProjectDir = true;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      const raced = readJson(p.manifest);
      if (raced && raced.projectId === p.id && raced.type === 'project') {
        return { ok: true, created: false, idempotent: true, project: raced, path: p.projectDir };
      }
      throw new Error('project_creation_in_progress');
    }
    fs.mkdirSync(path.join(p.projectDir, 'tasks'));
    fs.mkdirSync(path.join(p.projectDir, 'artifacts'));
    writeExclusive(p.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    writeExclusive(path.join(p.projectDir, 'brief.md'), [
      `# ${manifest.name} · 项目简报`, '',
      '## 目标', manifest.description, '',
      '## 范围', '- 待 CEO 与项目主管补充。', '',
      '## 验收标准', '- 每个交付物必须附文件或测试证据。', '',
      '## 边界', '- 不跨项目读取或修改未授权内容。', '',
    ].join('\n'));
    writeExclusive(path.join(p.projectDir, 'status.md'), [
      `# ${manifest.name} · 状态`, '',
      '- 状态: 已创建',
      `- 项目主管队列: supervisor-${p.id}`,
      '- 下一步: 由 CEO 写入首个项目 brief。', '',
    ].join('\n'));
    writeExclusive(path.join(p.projectDir, 'tasks', '.gitkeep'), '');
    writeExclusive(path.join(p.projectDir, 'artifacts', '.gitkeep'), '');
  } catch (err) {
    if (ownsProjectDir) {
      try { fs.rmSync(p.projectDir, { recursive: true, force: true }); } catch (_) {}
    }
    throw err;
  }
  return { ok: true, created: true, idempotent: false, project: manifest, path: p.projectDir };
}

function listProjectDepartments(opts = {}) {
  const root = workspaceRoot(opts);
  const projectsDir = path.join(root, 'projects');
  let entries = [];
  try { entries = fs.readdirSync(projectsDir, { withFileTypes: true }); } catch (_) { return []; }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && entry.name !== '控制台')
    .map((entry) => readJson(path.join(projectsDir, entry.name, MANIFEST_NAME)))
    .filter((item) => item && item.type === 'project' && item.projectId)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
}

function readSystemDepartments(opts = {}) {
  const file = path.join(workspaceRoot(opts), 'shared', 'organization', 'system-departments.json');
  const body = readJson(file, { schemaVersion: 1, departments: [] });
  return body && Array.isArray(body.departments) ? body : { schemaVersion: 1, departments: [] };
}

module.exports = {
  MANIFEST_NAME,
  normalizeProjectId,
  pathsFor,
  createProjectDepartment,
  listProjectDepartments,
  readSystemDepartments,
  enforceCreationPolicy,
};
