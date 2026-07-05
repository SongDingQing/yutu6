#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.resolve(ROOT, '../..');
const DGH = require('./daily-governance-hardening');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function patchQueuedTime(queueRoot, agent, id, iso) {
  const dir = path.join(queueRoot, 'queues', agent);
  const file = fs.readdirSync(dir).find(name => name.endsWith(`-${id}.json`));
  assert(file, `missing queued file for ${agent}/${id}`);
  const full = path.join(dir, file);
  const entry = JSON.parse(fs.readFileSync(full, 'utf8'));
  entry.enqueued_at = iso;
  fs.writeFileSync(full, JSON.stringify(entry, null, 2) + '\n');
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-governance-hardening-'));
  const archiveDir = path.join(root, 'knowledge', '归档');
  const memoryDir = path.join(root, 'memory');
  const queueRoot = path.join(root, 'artifacts');
    const date = '20990101';
    const pretty = '2099-01-01';

  try {
    DGH.enqueueDailyJobs(date, { queueRoot, dryRun: false });
    const qopsQueued = fs.readdirSync(path.join(queueRoot, 'queues', 'quality_ops')).find(name => name.endsWith(`-qops-harden-${date}.json`));
    assert(qopsQueued, 'qops queued file must exist');
    const qopsEntry = JSON.parse(fs.readFileSync(path.join(queueRoot, 'queues', 'quality_ops', qopsQueued), 'utf8'));
    assert.strictEqual(qopsEntry.task.dailySchedule.staggerMinutes, 6);
    assert.strictEqual(qopsEntry.task.dailySchedule.reason, 'daily-same-ignition-stagger');
    patchQueuedTime(queueRoot, 'governance', `gov-review-${date}`, '2098-12-31T21:00:05.000Z');
    patchQueuedTime(queueRoot, 'quality_ops', `qops-harden-${date}`, '2098-12-31T21:00:05.000Z');
    write(path.join(archiveDir, `复盘-${date}.md`), [
      `# 每日复盘 · ${pretty}`,
      '',
      '## 防复发规则',
      '- 改进:把硬化产物存在性作为每日收口硬门。',
      '- 根因:只看队列 done 会把方案骨架误判成交付。',
      '',
      'x'.repeat(900),
    ].join('\n'));
    write(path.join(archiveDir, `硬化建议-${date}.md`), [
      `# 硬化建议归档 · ${pretty}`,
      '',
      '## 1. Smoke / 自测结果',
      '| 用例 | pass |',
      '| mechanisms-smoke | true |',
      '',
      '### H-1 每日硬化产物审计',
      '- 改进:复盘后自动生成具体汇报。',
      '- 回退方式:--no-notify。',
      '',
      'x'.repeat(900),
    ].join('\n'));
    write(path.join(memoryDir, 'experience.md'), `# 经验\n- ${pretty}: 每日复盘经验沉淀。\n`);

    const audit = DGH.auditDailyArtifacts(date, { archiveDir, memoryDir, queueRoot });
    assert.strictEqual(audit.ok, true);
    assert.strictEqual(audit.effective, true);
    assert(audit.trigger.punctual === false || typeof audit.trigger.punctual === 'boolean');
    assert(audit.improvements.some(x => /硬化产物|具体汇报/.test(x)));
    assert(/今天具体改进了什么/.test(audit.body));

    const staggerDry = await DGH.enqueueDailyJobsStaggered('20990103', {
      queueRoot: path.join(root, 'stagger-artifacts'),
      dryRun: true,
      staggerScaleMs: 0,
    });
    assert.strictEqual(staggerDry.length, 2);
    assert.strictEqual(staggerDry[1].schedule.staggerMinutes, 6);
    assert.strictEqual(staggerDry[1].action, 'would-enqueue');

    const eventsFile = path.join(root, 'events.jsonl');
    write(eventsFile, [
      JSON.stringify({ seq: 1, ts: '2098-12-31T21:00:30.000Z', type: 'resource.scheduler.all_blocked', queueAgent: 'governance', queueId: 'gov-review-20990101' }),
      JSON.stringify({ seq: 2, ts: '2098-12-31T21:06:00.000Z', type: 'worker-heartbeat-stale', queueAgent: 'quality_ops' }),
      JSON.stringify({ seq: 3, ts: '2098-12-31T20:40:00.000Z', type: 'worker-heartbeat-stale', queueAgent: 'repair' }),
    ].join('\n') + '\n');
    const eventSummary = DGH.eventSummarySince(eventsFile, Date.parse('2098-12-31T20:00:00.000Z'));
    assert.strictEqual(eventSummary.counts['resource.scheduler.all_blocked'], 1);
    assert.strictEqual(eventSummary.counts['worker-heartbeat-stale'], 2);
    assert.strictEqual(eventSummary.dailyIgnition.length, 2);

    const repairDir = path.join(root, 'repair-tickets');
    write(path.join(repairDir, 'auto-old-residual.md'), [
      '# old',
      '- status: done',
      '',
      'mechanisms-smoke checkAutoOptimizer 当前失败与本次无关,作为残余测试债。',
    ].join('\n'));
    const smokeFailure = {
      name: 'mechanisms-smoke',
      command: 'node projects/控制台/tools/mechanisms-smoke-test.js',
      code: 1,
      stderrTail: 'AssertionError checkAutoOptimizer 期望 disabled 得 enqueued',
    };
    const residualOnly = DGH.auditSmokeFailureRepairTickets(date, [smokeFailure], {
      repairDir,
      dryRun: true,
      noAutoRepair: true,
    });
    assert.strictEqual(residualOnly.ok, false);
    assert.strictEqual(residualOnly.failures[0].effectiveTickets.length, 0);
    assert.strictEqual(residualOnly.failures[0].ignoredTickets.length, 1);

    write(path.join(repairDir, 'repair-current-todo.md'), [
      '# current',
      '- status: todo',
      '',
      'mechanisms-smoke checkAutoOptimizer 专项定位中。',
    ].join('\n'));
    const withEffective = DGH.auditSmokeFailureRepairTickets(date, [smokeFailure], {
      repairDir,
      dryRun: true,
      noAutoRepair: true,
    });
    assert.strictEqual(withEffective.ok, true);
    assert.strictEqual(withEffective.failures[0].effectiveTickets.length, 1);

    write(path.join(archiveDir, `硬化建议-${date}.md`), [
      `# 硬化建议归档 · ${pretty}`,
      'TBD',
      '待执行',
      'skeleton_only',
      'x'.repeat(900),
    ].join('\n'));
    const bad = DGH.auditDailyArtifacts(date, { archiveDir, memoryDir, queueRoot });
    assert.strictEqual(bad.ok, false);
    assert(bad.missing.some(x => /硬化归档无效/.test(x)));

    const dry = spawnSync(process.execPath, [
      path.join(ROOT, 'tools', 'daily-governance-hardening.js'),
      '--date', '20990102',
      '--dry-run',
      '--json',
      '--no-audit',
      '--skip-local-hardening',
      '--no-notify',
    ], {
      cwd: WORKDIR,
      env: Object.assign({}, process.env, { CONSOLE_ARTIFACTS_DIR: path.join(root, 'dry-artifacts') }),
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.strictEqual(dry.status, 0, dry.stderr);
    const parsed = JSON.parse(dry.stdout);
    assert.strictEqual(parsed.dryRun, true);
    assert.strictEqual(parsed.results.length, 2);
    assert(parsed.results.every(r => r.action === 'would-enqueue'));

    console.log(JSON.stringify({ pass: true, suite: 'daily-governance-hardening' }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
