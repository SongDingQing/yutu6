#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Trace = require('../shared/engine/interaction-trace');
const Audit = require('../shared/engine/quality-ops-audit');

const PROCESS_TAIL_MAX = 32 * 1024;

function runMergeProcess(moduleFile, manifestFile, code) {
  return new Promise((resolve, reject) => {
    const script = [
      "const [mod, manifest, code] = process.argv.slice(1);",
      "require(mod).mergeObservabilityWarnings(manifest, [{ code, artifact: 'concurrency', detail: '并发告警 ' + code }]);",
    ].join('\n');
    const child = spawn(process.execPath, ['-e', script, moduleFile, manifestFile, code], {
      cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => status === 0 ? resolve() : reject(new Error(stderr || `merge child exit ${status}`)));
  });
}

async function main() {
  const processSummarySchema = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../projects/控制台/quality-ops/schemas/process-summary.redacted.schema.json'),
    'utf8',
  ));
  assert.strictEqual(processSummarySchema.$id, Trace.PROCESS_SUMMARY_SCHEMA);
  assert(processSummarySchema.required.includes('command'));
  assert(processSummarySchema.required.includes('exit_code'));
  assert(processSummarySchema.required.includes('target_summary'));
  assert(processSummarySchema.required.includes('final_state'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yutu-trace-test-'));
  try {
    const workdir = path.join(root, 'workspace');
    const artifacts = path.join(workdir, 'projects', '控制台', 'artifacts');
    const runsDir = path.join(artifacts, 'engine-runs', 'child-task');
    const nodeDir = path.join(runsDir, 'implement-1');
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'meta.json'), JSON.stringify({
      from: 'secretary', to: 'supervisor-控制台', spec_fingerprint: 'spec-123',
    }));
    const secret = `sk-${'A'.repeat(32)}`;
    const basicCredential = Buffer.from('ci-user:basic-secret-value').toString('base64');
    const shortBasicCredential = Buffer.from('t:').toString('base64');
    const githubToken = `ghp_${'B'.repeat(36)}`;
    const gitlabToken = `glpat-${'C'.repeat(24)}`;
    const credentialUrl = `https://ci-user:${githubToken}@github.com/example/private.git`;
    const prompt = [
      '主人 prompt',
      `OPENAI_API_KEY=${secret}`,
      `Authorization: Basic ${basicCredential}`,
      `Authorization: Basic ${shortBasicCredential}`,
      `remote=${credentialUrl}`,
      '交给程序员执行',
    ].join('\n');
    fs.writeFileSync(path.join(nodeDir, 'task.md'), prompt);
    const events = [];
    const eventlog = { emit(type, data) { events.push({ type, ...data }); } };
    const common = {
      ctx: {
        rootTaskId: 'root-task', rootQueueAgent: 'secretary', rootQueueId: 'root-q', projectId: '控制台',
        goal: '更新声明文件并验证 trace 完整性',
        spec_fingerprint: 'spec-123',
      },
      node: { id: 'implement', agent_role: 'worker_code' },
      attempt: 1,
      runnerId: 'zhipu-glm-tools',
      runner: { kind: 'openai_http_tool_harness', plannerRunner: 'zhipu-glm', executorRunner: 'codex' },
      dir: nodeDir,
      prompt,
      workdir,
      runsDir,
      queueRoot: artifacts,
      queueAgent: 'supervisor-控制台',
      queueId: 'child-q',
      taskId: 'child-task',
      projectId: '控制台',
      eventlog,
    };
    const started = Trace.recordPrompt(common);
    assert(started && started.record, 'prompt trace should be created');
    const redactedPrompt = fs.readFileSync(path.join(nodeDir, 'task.redacted.md'), 'utf8');
    assert(!redactedPrompt.includes(secret));
    assert(!redactedPrompt.includes(basicCredential));
    assert(!redactedPrompt.includes(shortBasicCredential));
    assert(!redactedPrompt.includes(githubToken));
    assert(redactedPrompt.includes('[REDACTED]'));
    assert.strictEqual(started.record.hidden_chain_of_thought_saved, false);
    assert.deepStrictEqual(started.record.interaction_agents, ['zhipu-glm-tools', 'zhipu-glm', 'codex']);
    assert.strictEqual(started.record.from_agent, 'secretary');
    assert.strictEqual(started.record.to_agent, 'worker_code');

    const stdout = [
      `已落盘。Bearer ${secret}`,
      `Authorization: Basic ${basicCredential}`,
      `Authorization: Basic ${shortBasicCredential}`,
      `source ${credentialUrl}`,
      '{"implementation":{"done":true}}',
    ].join('\n');
    const stderr = [
      'tool read/write',
      `TOKEN=${secret}`,
      `Authorization: Basic ${basicCredential}`,
      `Authorization: Basic ${shortBasicCredential}`,
      `clone ${credentialUrl}`,
      `fallback token ${gitlabToken}`,
    ].join('\n');
    fs.writeFileSync(path.join(nodeDir, 'result.md'), stdout);
    fs.writeFileSync(path.join(nodeDir, 'process.log'), stderr);
    const finished = Trace.recordResult(started, {
      stdout, stderr, latencyMs: 1234, exitCode: 0,
      result: {
        vars: { implementation: { done: true, changed_files: ['projects/控制台/status.md'] } },
        evidence: { path: path.join(nodeDir, 'result.md') },
      },
      eventlog,
    });
    assert.strictEqual(finished.status, 'completed');
    assert.strictEqual(finished.latency_ms, 1234);
    const redactedResult = fs.readFileSync(path.join(nodeDir, 'result.redacted.md'), 'utf8');
    assert(!redactedResult.includes(secret));
    assert(!redactedResult.includes(basicCredential));
    assert(!redactedResult.includes(shortBasicCredential));
    assert(!redactedResult.includes(githubToken));
    const summaryText = fs.readFileSync(path.join(nodeDir, 'process-summary.redacted.log'), 'utf8');
    assert(!summaryText.includes(secret));
    assert(!summaryText.includes(basicCredential));
    assert(!summaryText.includes(shortBasicCredential));
    assert(!summaryText.includes(githubToken));
    assert(!summaryText.includes(gitlabToken));
    const summary = JSON.parse(summaryText);
    assert.strictEqual(summary.schema, Trace.PROCESS_SUMMARY_SCHEMA);
    assert.strictEqual(summary.classification.kind, 'write');
    assert.strictEqual(summary.classification.label_factor.matched, true);
    assert.strictEqual(summary.classification.command_or_path_factor.matched, true);
    assert.strictEqual(summary.command.arguments_recorded, false);
    assert.strictEqual(summary.exit_code, 0);
    assert.match(summary.target_summary, /projects\/控制台\/status\.md/);
    assert.strictEqual(summary.final_state, 'completed');
    assert(summary.safe_output_summary.length <= 2400);
    const manifest = JSON.parse(fs.readFileSync(path.join(nodeDir, 'interaction-trace.json'), 'utf8'));
    assert.strictEqual(manifest.hidden_chain_of_thought_saved, false);
    assert.strictEqual(manifest.chain_id, started.record.chain_id);
    assert.strictEqual(manifest.agent_id, 'worker_code');
    assert.strictEqual(manifest.spec_fingerprint, common.ctx.spec_fingerprint);
    assert.strictEqual(
      manifest.spec_fingerprint,
      JSON.parse(fs.readFileSync(path.join(runsDir, 'meta.json'), 'utf8')).spec_fingerprint,
      'task envelope, handoff meta, and trace manifest must share one protocol fingerprint',
    );
    assert.strictEqual(manifest.observability_status, 'ok');
    assert.deepStrictEqual(manifest.observability_warning, []);
    assert.strictEqual(manifest.integrity_check.complete, true);
    assert(manifest.evidence_refs.length >= 2);

    assert.strictEqual(Trace.meaningfulText('声明'), false, 'bare placeholder must fail');
    assert.strictEqual(Trace.meaningfulText('声明。'), false, 'punctuated placeholder must fail');
    assert.strictEqual(Trace.meaningfulText('n/a.'), false, 'punctuated latin placeholder must fail');
    assert.strictEqual(Trace.meaningfulText('声明文件已更新'), true, 'placeholder word inside useful text must not be rejected');
    assert.strictEqual(Trace.taskClassification({
      ctx: { tags: ['write'] }, node: { id: 'analysis', agent_role: 'reasoning_architect' },
      runnerId: 'text-only', runner: { kind: 'openai_http' },
    }).requires_structured_process_summary, false, 'label alone must not classify a write task');
    assert.strictEqual(Trace.taskClassification({
      ctx: {}, node: { id: 'analysis', agent_role: 'reasoning_architect' },
      runnerId: 'codex', runner: { cmd: ['codex', 'exec'] },
    }).requires_structured_process_summary, false, 'write-capable runner alone must not classify a write task');
    assert.strictEqual(Trace.taskClassification({
      ctx: { tags: ['release'] }, node: { id: 'release', agent_role: 'it_engineer' },
      runnerId: 'codex', runner: { cmd: ['codex', 'exec'] },
    }).kind, 'publish');

    const index = fs.readFileSync(path.join(artifacts, 'quality-ops', 'traces', 'index.jsonl'), 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.deepStrictEqual(index.map(x => x.event), ['interaction.started', 'interaction.finished']);
    assert(index.every(x => x.chain_id === manifest.chain_id));
    assert(events.some(x => x.type === 'interaction.trace.started'));
    assert(events.some(x => x.type === 'interaction.trace.finished'));

    const mediumOutputDir = path.join(runsDir, 'implement-medium-complete-lines-1');
    fs.mkdirSync(mediumOutputDir, { recursive: true });
    const mediumStderr = Array.from(
      { length: 96 },
      (_, index) => `complete log line ${String(index).padStart(2, '0')} ${'m'.repeat(36)}`,
    ).join('\n') + '\n';
    assert(mediumStderr.length > 2400 && mediumStderr.length < PROCESS_TAIL_MAX);
    const mediumOutputTrace = Trace.recordPrompt({
      ...common,
      dir: mediumOutputDir,
      prompt: '验证中长完整日志的安全摘要严格遵守长度上限',
    });
    Trace.recordResult(mediumOutputTrace, {
      stdout: '{"implementation":{"done":true}}',
      stderr: mediumStderr,
      latencyMs: 3,
      exitCode: 0,
      result: { vars: { implementation: { done: true, changed_files: ['projects/控制台/status.md'] } } },
      eventlog,
    });
    const mediumOutputSummary = JSON.parse(fs.readFileSync(
      path.join(mediumOutputDir, 'process-summary.redacted.log'),
      'utf8',
    ));
    assert(
      mediumOutputSummary.safe_output_summary.length <= 2400,
      'truncation marker must be included in the 2400 character budget',
    );
    const mediumOutputManifest = JSON.parse(fs.readFileSync(
      path.join(mediumOutputDir, 'interaction-trace.json'),
      'utf8',
    ));
    assert.strictEqual(mediumOutputManifest.observability_status, 'ok');
    assert(!mediumOutputManifest.observability_warning.some(item => (
      item.code === 'process_summary_schema_max_length'
    )));

    const boundaryDir = path.join(runsDir, 'implement-redaction-boundary-1');
    fs.mkdirSync(boundaryDir, { recursive: true });
    const boundaryCredential = Buffer.from('boundary-user:boundary-secret-value').toString('base64');
    const boundaryLine = `Authorization: Basic ${boundaryCredential}`;
    const credentialOffset = boundaryLine.indexOf(boundaryCredential);
    const cutOffset = credentialOffset + 8;
    const leakedFragment = boundaryLine.slice(cutOffset);
    const safeTailPrefix = '\nsafe boundary line\n';
    const safeTail = `${safeTailPrefix}${'z'.repeat(PROCESS_TAIL_MAX - leakedFragment.length - safeTailPrefix.length)}`;
    const boundaryStderr = `earlier output\n${boundaryLine}${safeTail}`;
    assert.strictEqual(boundaryStderr.slice(-PROCESS_TAIL_MAX), `${leakedFragment}${safeTail}`);
    const boundaryTrace = Trace.recordPrompt({
      ...common,
      dir: boundaryDir,
      prompt: '验证 stderr 截断边界不泄露凭据片段',
    });
    Trace.recordResult(boundaryTrace, {
      stdout: '{"implementation":{"done":true}}',
      stderr: boundaryStderr,
      latencyMs: 4,
      exitCode: 0,
      result: { vars: { implementation: { done: true, changed_files: ['projects/控制台/status.md'] } } },
      eventlog,
    });
    const boundarySummary = JSON.parse(fs.readFileSync(
      path.join(boundaryDir, 'process-summary.redacted.log'),
      'utf8',
    ));
    assert(!boundarySummary.safe_output_summary.includes(leakedFragment), 'truncated credential fragments must not survive');
    assert(boundarySummary.safe_output_summary.includes('safe boundary line'));
    assert(
      boundarySummary.safe_output_summary.length <= 2400,
      'boundary-safe summary must still obey the final length limit',
    );

    const missingDir = path.join(runsDir, 'implement-missing-1');
    fs.mkdirSync(missingDir, { recursive: true });
    const missingTrace = Trace.recordPrompt({ ...common, dir: missingDir, prompt: '执行写任务并保留证据' });
    fs.unlinkSync(path.join(missingDir, 'task.redacted.md'));
    const missingFinished = Trace.recordResult(missingTrace, {
      stdout: '{"implementation":{"done":true}}', stderr: '', latencyMs: 5, exitCode: 0,
      result: { vars: { implementation: { done: true, changed_files: ['projects/控制台/status.md'] } } },
      eventlog,
    });
    assert.strictEqual(missingFinished.status, 'completed', 'integrity warning must not block business completion');
    assert.strictEqual(missingFinished.observability_status, 'warning');
    assert(missingFinished.observability_warning.some(item => item.code === 'task_redacted_missing'));
    assert(fs.existsSync(path.join(missingDir, 'process-summary.redacted.log')), 'summary must exist even when stderr is empty');

    const schemaMissingDir = path.join(runsDir, 'implement-schema-missing-1');
    fs.mkdirSync(schemaMissingDir, { recursive: true });
    const schemaMissingTrace = Trace.recordPrompt({ ...common, dir: schemaMissingDir, prompt: '验证 schema 必填缺失非阻断降级' });
    const schemaMissingFinished = Trace.recordResult(schemaMissingTrace, {
      stdout: '{"implementation":{"done":true}}', stderr: '', latencyMs: 6, exitCode: 0,
      result: { vars: { implementation: { done: true, changed_files: ['projects/控制台/status.md'] } } },
      eventlog,
      integrityCheck(manifestFile) {
        const processSummaryFile = path.join(path.dirname(manifestFile), 'process-summary.redacted.log');
        const value = JSON.parse(fs.readFileSync(processSummaryFile, 'utf8'));
        delete value.limits;
        fs.writeFileSync(processSummaryFile, JSON.stringify(value));
        return Trace.inspectTraceIntegrity(manifestFile);
      },
    });
    assert.strictEqual(schemaMissingFinished.status, 'completed');
    assert.strictEqual(schemaMissingFinished.observability_status, 'warning');
    assert(schemaMissingFinished.observability_warning.some(item => (
      item.code === 'process_summary_schema_required' && item.detail.includes('limits')
    )));

    const placeholderDir = path.join(runsDir, 'implement-placeholder-1');
    fs.mkdirSync(placeholderDir, { recursive: true });
    const placeholderTrace = Trace.recordPrompt({
      ...common,
      dir: placeholderDir,
      prompt: '执行写任务并验证目标摘要占位防绕过',
      ctx: { ...common.ctx, goal: 'n/a.' },
    });
    const placeholderFinished = Trace.recordResult(placeholderTrace, {
      stdout: '{"implementation":{"done":true}}', stderr: '', latencyMs: 5, exitCode: 0,
      result: { vars: { implementation: { done: true, changed_files: ['声明。'] } } },
      eventlog,
    });
    assert(placeholderFinished.observability_warning.some(item => item.code === 'process_summary_target_summary_invalid'));

    const readPlaceholderDir = path.join(runsDir, 'analysis-placeholder-1');
    fs.mkdirSync(readPlaceholderDir, { recursive: true });
    const readPlaceholderTrace = Trace.recordPrompt({
      ...common,
      dir: readPlaceholderDir,
      prompt: '分析任务的目标摘要不得使用占位词',
      ctx: { ...common.ctx, goal: '声明' },
      node: { id: 'analysis', agent_role: 'reasoning_architect' },
      runnerId: 'text-only',
      runner: { kind: 'openai_http' },
    });
    const readPlaceholderFinished = Trace.recordResult(readPlaceholderTrace, {
      stdout: '有效分析结果', stderr: '', latencyMs: 5, exitCode: 0,
      result: { vars: {} }, eventlog,
    });
    assert.strictEqual(readPlaceholderFinished.task_classification.kind, 'read_or_analysis');
    assert(readPlaceholderFinished.observability_warning.some(item => (
      item.code === 'process_summary_target_summary_invalid'
    )), 'read_or_analysis placeholder target summary must degrade observability');
    assert(readPlaceholderFinished.observability_warning.some(item => (
      item.code === 'process_summary_schema_not'
    )), 'shared schema must reject placeholder target summaries for every classification');

    const readValidDir = path.join(runsDir, 'analysis-valid-summary-1');
    fs.mkdirSync(readValidDir, { recursive: true });
    const readValidTrace = Trace.recordPrompt({
      ...common,
      dir: readValidDir,
      prompt: '分析任务保留有效的目标摘要',
      ctx: { ...common.ctx, goal: '声明文件已更新' },
      node: { id: 'analysis', agent_role: 'reasoning_architect' },
      runnerId: 'text-only',
      runner: { kind: 'openai_http' },
    });
    const readValidFinished = Trace.recordResult(readValidTrace, {
      stdout: '有效分析结果', stderr: '', latencyMs: 5, exitCode: 0,
      result: { vars: {} }, eventlog,
    });
    assert.strictEqual(readValidFinished.observability_status, 'ok');
    assert(!readValidFinished.observability_warning.some(item => (
      item.code === 'process_summary_target_summary_invalid' || item.code === 'process_summary_schema_not'
    )), 'useful text containing the placeholder word must not be rejected');

    const readWarningEvents = [
      {
        event: 'interaction.started', chain_id: 'chain-read-placeholder', trace_id: 'trace-read-placeholder',
        root_task_id: 'read-placeholder', task_id: 'read-placeholder', node_id: 'analysis',
        agent_role: 'reasoning_architect', runner_id: 'text-only', route_key: 'queue>reasoning_architect>text-only',
        project_id: '控制台', at: '2026-07-16T00:00:00.000Z',
      },
      {
        event: 'interaction.finished', chain_id: 'chain-read-placeholder', trace_id: 'trace-read-placeholder',
        root_task_id: 'read-placeholder', task_id: 'read-placeholder', node_id: 'analysis',
        agent_role: 'reasoning_architect', runner_id: 'text-only', route_key: 'queue>reasoning_architect>text-only',
        project_id: '控制台', at: '2026-07-16T00:00:01.000Z', status: 'completed', content_hash: 'read-placeholder-hash',
        evidence_refs: ['trace/process-summary.redacted.log'],
        observability_status: readPlaceholderFinished.observability_status,
        observability_warning: readPlaceholderFinished.observability_warning,
      },
    ];
    const readWarningChain = Audit.buildChains(readWarningEvents)[0];
    const readWarningPlan = Audit.makePlan({ strategy: 'first_week_full', candidates: 1, selected: [readWarningChain] }, {
      now: new Date('2026-07-16T00:00:02.000Z'), auditId: 'audit-read-placeholder', batchSize: 1,
    });
    const readWarningBatch = readWarningPlan.batches[0];
    assert.throws(() => Audit.validateFindings(readWarningBatch, {
      schema: Audit.FINDINGS_SCHEMA,
      audit_id: readWarningPlan.audit_id,
      batch_id: readWarningBatch.batch_id,
      chain_reviews: [{
        chain_id: readWarningChain.chain_id,
        chain_summary: '只读任务业务完成但目标摘要是占位词',
        verdict: 'pass', evidence_refs: ['trace/process-summary.redacted.log'], findings: [],
      }],
      proposals: [],
    }), /process_summary_(?:schema_not|target_summary_invalid)/,
    'read_or_analysis placeholder warning must forbid audit pass');

    const fingerprintRunsDir = path.join(artifacts, 'engine-runs', 'fingerprint-task');
    const fingerprintDir = path.join(fingerprintRunsDir, 'analysis-1');
    fs.mkdirSync(fingerprintDir, { recursive: true });
    fs.writeFileSync(path.join(fingerprintRunsDir, 'meta.json'), JSON.stringify({
      from: 'supervisor-控制台', to: 'reasoning_architect', spec_fingerprint: 'stale-task-spec',
      task_document_fingerprint: 'document-hash',
    }));
    const fingerprintTrace = Trace.recordPrompt({
      ...common,
      runsDir: fingerprintRunsDir,
      dir: fingerprintDir,
      taskId: 'fingerprint-task',
      ctx: { ...common.ctx, spec_fingerprint: 'current-task-spec', goal: '验证任务指纹一致性' },
      node: { id: 'analysis', agent_role: 'reasoning_architect' },
      runnerId: 'text-only',
      runner: { kind: 'openai_http' },
    });
    const fingerprintFinished = Trace.recordResult(fingerprintTrace, {
      stdout: '指纹检查完成', stderr: '', latencyMs: 5, exitCode: 0,
      result: { vars: {} }, eventlog,
    });
    assert.strictEqual(fingerprintFinished.spec_fingerprint, 'current-task-spec');
    assert(fingerprintFinished.observability_warning.some(item => (
      item.code === 'manifest_spec_fingerprint_mismatch'
    )), 'stale handoff meta must not silently replace the task envelope fingerprint');

    const hookDir = path.join(runsDir, 'implement-hook-error-1');
    fs.mkdirSync(hookDir, { recursive: true });
    const hookTrace = Trace.recordPrompt({ ...common, dir: hookDir, prompt: '验证 hook 异常降级' });
    const hookFinished = Trace.recordResult(hookTrace, {
      stdout: '{"implementation":{"done":true}}', stderr: '', latencyMs: 7, exitCode: 0,
      result: { vars: { implementation: { done: true, changed_files: ['projects/控制台/status.md'] } } },
      eventlog,
      integrityCheck() { throw new Error('forced integrity hook error'); },
    });
    assert.strictEqual(hookFinished.status, 'completed', 'hook error must not block business completion');
    assert(fs.existsSync(path.join(hookDir, 'trace-hook-errors.jsonl')));
    const hookManifest = JSON.parse(fs.readFileSync(path.join(hookDir, 'interaction-trace.json'), 'utf8'));
    assert.strictEqual(hookManifest.observability_status, 'warning');
    assert.strictEqual(hookManifest.hook_error.length, 1);
    assert(hookManifest.observability_warning.some(item => item.code === 'trace_integrity_hook_error'));
    assert(events.some(x => x.type === 'interaction.trace.hook_error'));

    const malformedDir = path.join(runsDir, 'malformed-four-piece');
    fs.mkdirSync(malformedDir, { recursive: true });
    fs.writeFileSync(path.join(malformedDir, 'task.redacted.md'), '有效任务');
    fs.writeFileSync(path.join(malformedDir, 'result.redacted.md'), '有效结果');
    fs.writeFileSync(path.join(malformedDir, 'process-summary.redacted.log'), '{}');
    fs.writeFileSync(path.join(malformedDir, 'interaction-trace.json'), '{}');
    const malformedWarnings = Trace.inspectTraceIntegrity(path.join(malformedDir, 'interaction-trace.json'));
    assert(malformedWarnings.some(item => item.code === 'manifest_task_id_missing'));
    assert(malformedWarnings.some(item => item.code === 'process_summary_schema_invalid'));

    function inspectSchemaCase(name, mutateSummary, mutateManifest) {
      const dir = path.join(runsDir, `schema-counterexample-${name}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'task.redacted.md'), '有效任务');
      fs.writeFileSync(path.join(dir, 'result.redacted.md'), '有效结果');
      const caseSummary = JSON.parse(JSON.stringify(summary));
      const caseManifest = JSON.parse(JSON.stringify(manifest));
      if (mutateSummary) mutateSummary(caseSummary);
      if (mutateManifest) mutateManifest(caseManifest);
      fs.writeFileSync(path.join(dir, 'process-summary.redacted.log'), JSON.stringify(caseSummary));
      fs.writeFileSync(path.join(dir, 'interaction-trace.json'), JSON.stringify(caseManifest));
      return Trace.inspectTraceIntegrity(path.join(dir, 'interaction-trace.json'));
    }

    const badManifestWarnings = inspectSchemaCase('bad-manifest-schema', null, value => {
      value.schema = 'wrong-interaction-schema@1';
    });
    assert(badManifestWarnings.some(item => item.code === 'manifest_schema_invalid'));

    for (const field of ['schema_ref', 'generated_at', 'exit_code', 'target_summary', 'limits']) {
      const warnings = inspectSchemaCase(`missing-${field}`, value => { delete value[field]; });
      assert(
        warnings.some(item => item.code === 'process_summary_schema_required' && item.detail.includes(field)),
        `missing schema-required field ${field} must produce a warning`,
      );
    }

    const extraPropertyWarnings = inspectSchemaCase('additional-property', value => {
      value.raw_command = ['git', 'push'];
    });
    assert(extraPropertyWarnings.some(item => item.code === 'process_summary_schema_additional_properties'));

    const constWarnings = inspectSchemaCase('wrong-const', value => {
      value.command.arguments_recorded = true;
    });
    assert(constWarnings.some(item => item.code === 'process_summary_schema_const'));

    const conditionalWarnings = inspectSchemaCase('conditional-write-fields', value => {
      value.exit_code = null;
      value.target_summary = '声明';
    });
    assert(conditionalWarnings.some(item => item.code === 'process_summary_schema_type'));
    assert(conditionalWarnings.some(item => item.code === 'process_summary_schema_not'));

    for (const [name, generatedAt] of [
      ['february-30', '2026-02-30T00:00:00Z'],
      ['non-leap-february-29', '2025-02-29T00:00:00Z'],
      ['invalid-timezone-hour', '2026-02-28T00:00:00+24:00'],
    ]) {
      const warnings = inspectSchemaCase(`invalid-date-time-${name}`, value => {
        value.generated_at = generatedAt;
      });
      assert(
        warnings.some(item => item.code === 'process_summary_schema_format'),
        `${name} must fail the schema date-time format`,
      );
    }
    const validLeapDayWarnings = inspectSchemaCase('valid-leap-day', value => {
      value.generated_at = '2024-02-29T23:59:59.123+08:00';
    });
    assert(!validLeapDayWarnings.some(item => item.code === 'process_summary_schema_format'));

    const moduleFile = require.resolve('../shared/engine/interaction-trace');
    const warningCodes = Array.from({ length: 8 }, (_, index) => `concurrent_warning_${index}`);
    await Promise.all(warningCodes.map(code => runMergeProcess(moduleFile, path.join(nodeDir, 'interaction-trace.json'), code)));
    const mergedManifest = JSON.parse(fs.readFileSync(path.join(nodeDir, 'interaction-trace.json'), 'utf8'));
    const mergedCodes = new Set(mergedManifest.observability_warning.map(item => item.code));
    assert(warningCodes.every(code => mergedCodes.has(code)), 'concurrent warning merge must not lose records');
    const warningLedger = fs.readFileSync(path.join(nodeDir, 'observability-warnings.jsonl'), 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert(warningLedger.length >= warningCodes.length);
    console.log(JSON.stringify({ pass: true, suite: 'interaction-trace', chain: manifest.chain_id }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
