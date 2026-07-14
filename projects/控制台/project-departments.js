'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_NAME = 'department.json';

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
    staffTemplates: ['worker_code', 'worker_narrow', 'frontend_designer'],
    status: 'active',
    createdAt: new Date().toISOString(),
  };
}

function createProjectDepartment(input = {}, opts = {}) {
  const p = pathsFor(input.projectId || input.id, opts);
  const existing = readJson(p.manifest);
  if (existing) {
    if (existing.projectId !== p.id || existing.type !== 'project') throw new Error('project_manifest_conflict');
    return { ok: true, created: false, idempotent: true, project: existing, path: p.projectDir };
  }
  if (fs.existsSync(p.projectDir)) throw new Error('project_directory_exists_without_manifest');

  const manifest = departmentManifest(p.id, input);
  fs.mkdirSync(path.join(p.projectDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(p.projectDir, 'artifacts'), { recursive: true });
  try {
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
    try { fs.rmSync(p.projectDir, { recursive: true, force: true }); } catch (_) {}
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
};
