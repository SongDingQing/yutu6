#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

    for (const invalid of ['', '..', '../escape', '_private', '.hidden', 'a/b', 'a\\b', '%2e%2e', '．．']) {
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
    assert.strictEqual(result.project.queueInitialization, 'lazy-on-first-task');
    assert.deepStrictEqual(result.project.capabilityRegistry.capabilities, ['multi-agent-collaboration-contract']);
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

    assert.throws(
      () => Departments.createProjectDepartment({ projectId: 'over-limit' }, { workspaceRoot: root, maxProjects: 1 }),
      /project_limit_reached/,
    );

    const rateRoot = path.join(root, 'rate-limited-workspace');
    fs.mkdirSync(path.join(rateRoot, 'projects'), { recursive: true });
    Departments.createProjectDepartment({ projectId: 'first' }, {
      workspaceRoot: rateRoot, maxProjects: 10, rateLimit: 1, rateWindowMs: 60000, now: 1000,
    });
    assert(!fs.existsSync(path.join(rateRoot, 'artifacts', 'queues', 'supervisor-first')), 'queue must be lazily initialized');
    assert.throws(
      () => Departments.createProjectDepartment({ projectId: 'second' }, {
        workspaceRoot: rateRoot, maxProjects: 10, rateLimit: 1, rateWindowMs: 60000, now: 1001,
      }),
      /project_create_rate_limited/,
    );

    const cliRoot = path.join(root, 'cli-workspace');
    fs.mkdirSync(path.join(cliRoot, 'projects'), { recursive: true });
    const cli = path.resolve(__dirname, '../projects/控制台/tools/project-department.js');
    const cliEnv = { ...process.env, YUTU6_WORKSPACE_ROOT: cliRoot, YUTU6_MAX_PROJECTS: '10' };
    const cliCreate = spawnSync(process.execPath, [cli, 'create', '--id', 'cli-project', '--name', 'CLI 项目'], {
      env: cliEnv, encoding: 'utf8',
    });
    assert.strictEqual(cliCreate.status, 0, cliCreate.stderr);
    assert.strictEqual(JSON.parse(cliCreate.stdout).created, true);
    const cliRepeated = spawnSync(process.execPath, [cli, 'create', '--id', 'cli-project'], {
      env: cliEnv, encoding: 'utf8',
    });
    assert.strictEqual(cliRepeated.status, 0, cliRepeated.stderr);
    assert.strictEqual(JSON.parse(cliRepeated.stdout).created, false);
    const cliEscape = spawnSync(process.execPath, [cli, 'create', '--id', '../escape'], {
      env: cliEnv, encoding: 'utf8',
    });
    assert.strictEqual(cliEscape.status, 1);
    assert.match(cliEscape.stderr, /project_id_(?:reserved|invalid_characters)/);
    console.log(JSON.stringify({ pass: true, suite: 'project-departments' }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main();
