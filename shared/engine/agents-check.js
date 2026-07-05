'use strict';
/*
 * agents-check:dry-run 校验系统级 agent 定义(阶段3)。沙箱即可,零网络。
 * 跑:node shared/engine/agents-check.js
 */
const fs = require('fs');
const path = require('path');
const { loadAgents, extractRoles, extractRunnerIds, validateAgent } = require('./agents');

const ROOT = path.resolve(__dirname, '../..');                 // 工作区根
const agents = loadAgents(path.join(ROOT, 'shared/agents'));
const roles = extractRoles(fs.readFileSync(path.join(ROOT, 'shared/routing/model-routing.yaml'), 'utf8'));
const runners = extractRunnerIds(fs.readFileSync(path.join(ROOT, 'shared/routing/runners.yaml'), 'utf8'));
const ctx = { root: ROOT, roles, runners };

console.log('model-routing roles:', [...roles].join(', '));
console.log('runners:', [...runners].join(', '));
console.log('已加载 agent:', agents.map(a => a.id).join(', '), '\n');

let allOk = true;
for (const a of agents) {
  const errs = validateAgent(a, ctx);
  if (errs.length) { allOk = false; console.log(`  ✗ ${a.id}:`); errs.forEach(e => console.log('     -', e)); }
  else console.log(`  ✓ ${a.id}  (role=${a.role}, runner=${a.runner}, ctx=${a.context_mode})`);
}
console.log('\n>>> agents dry-run', allOk ? 'PASS ✅' : 'FAIL ❌');
process.exit(allOk ? 0 : 1);
