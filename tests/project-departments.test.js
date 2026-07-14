#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Departments = require('../projects/控制台/project-departments');

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu6-project-departments-'));
  try {
    fs.mkdirSync(path.join(root, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(root, 'shared', 'organization'), { recursive: true });
    fs.writeFileSync(path.join(root, 'shared', 'organization', 'system-departments.json'), JSON.stringify({
      schemaVersion: 1,
      departments: [{ id: 'repair', roles: ['repair-lead', 'repair'] }],
    }));

    for (const invalid of ['', '..', '../escape', '_private', '.hidden', 'a/b', 'a\\b']) {
      assert.throws(() => Departments.normalizeProjectId(invalid), /project_id_/, 'must reject ' + invalid);
    }
    assert.strictEqual(Departments.normalizeProjectId('官网_2026'), '官网_2026');

    const result = Departments.createProjectDepartment({
      projectId: 'website',
      name: '官网部门',
      description: '建设通用官网',
    }, { workspaceRoot: root });
    assert.strictEqual(result.created, true);
    assert.strictEqual(result.project.supervisor.queueAgent, 'supervisor-website');
    assert.deepStrictEqual(result.project.staffTemplates, ['worker_code', 'worker_narrow', 'frontend_designer']);

    const projectDir = path.join(root, 'projects', 'website');
    for (const rel of ['department.json', 'brief.md', 'status.md', 'tasks/.gitkeep', 'artifacts/.gitkeep']) {
      assert(fs.existsSync(path.join(projectDir, rel)), 'missing ' + rel);
    }
    assert(fs.readFileSync(path.join(projectDir, 'status.md'), 'utf8').includes('supervisor-website'));

    const repeated = Departments.createProjectDepartment({ projectId: 'website' }, { workspaceRoot: root });
    assert.strictEqual(repeated.created, false);
    assert.strictEqual(repeated.idempotent, true);
    assert.strictEqual(Departments.listProjectDepartments({ workspaceRoot: root }).length, 1);

    fs.mkdirSync(path.join(root, 'projects', 'unmanaged'));
    assert.throws(
      () => Departments.createProjectDepartment({ projectId: 'unmanaged' }, { workspaceRoot: root }),
      /project_directory_exists_without_manifest/,
    );
    assert.strictEqual(Departments.readSystemDepartments({ workspaceRoot: root }).departments[0].id, 'repair');
    console.log(JSON.stringify({ pass: true, suite: 'project-departments' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
