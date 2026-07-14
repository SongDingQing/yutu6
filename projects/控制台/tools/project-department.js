#!/usr/bin/env node
'use strict';

const Departments = require('../project-departments');

function value(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function usage() {
  process.stdout.write([
    '用法:',
    '  node projects/控制台/tools/project-department.js list',
    '  node projects/控制台/tools/project-department.js create --id <projectId> [--name 名称] [--description 说明]',
    '',
  ].join('\n'));
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === 'list') {
    process.stdout.write(`${JSON.stringify({ ok: true, projects: Departments.listProjectDepartments() }, null, 2)}\n`);
    return;
  }
  if (command === 'create') {
    const result = Departments.createProjectDepartment({
      projectId: value(args, '--id'),
      name: value(args, '--name'),
      description: value(args, '--description'),
    });
    process.stdout.write(`${JSON.stringify({ ok: true, created: result.created, project: result.project }, null, 2)}\n`);
    return;
  }
  usage();
  process.exitCode = command ? 2 : 0;
}

try { main(); }
catch (err) {
  process.stderr.write(`创建项目部门失败: ${String(err && err.message || err).slice(0, 120)}\n`);
  process.exitCode = 1;
}
