#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { HookRegistry } = require('../../../shared/engine/hook-registry');
const Contract = require('../quality-ops/ahr-26-30/compat-contract');

const root = path.resolve(__dirname, '../../..');
const packageRoot = path.join(root, 'projects/控制台/quality-ops/ahr-26-30');

function busyWait(ms) {
  const started = Date.now();
  while (Date.now() - started < ms) {}
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const evidence = { suite: 'ahr-26-30-contract', checks: [], timeoutInjection: null };
  const checked = (id, fn) => {
    fn();
    evidence.checks.push(id);
  };

  checked('current_defaults_warn_timeout_100_priority_100', () => {
    const registry = new HookRegistry();
    registry.register('characterize', { id: 'default', handler: () => ({ ok: true }) });
    const hook = registry.list('characterize')[0];
    assert.strictEqual(hook.failureMode, 'warn');
    assert.strictEqual(hook.timeoutMs, 100);
    assert.strictEqual(hook.priority, 100);
  });

  checked('current_default_warn_is_fail_open', () => {
    const registry = new HookRegistry();
    registry.register('characterize', { id: 'throws', handler: () => { throw new Error('injected'); } });
    const result = registry.runSync('characterize');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.results[0].ok, false);
    assert.strictEqual(result.results[0].failureMode, 'warn');
  });

  checked('current_priority_then_id_order', () => {
    const registry = new HookRegistry();
    registry.register('order', { id: 'z', priority: 20, handler: () => ({ ok: true }) });
    registry.register('order', { id: 'b', priority: 10, handler: () => ({ ok: true }) });
    registry.register('order', { id: 'a', priority: 10, handler: () => ({ ok: true }) });
    assert.deepStrictEqual(registry.list('order').map(hook => hook.id), ['a', 'b', 'z']);
  });

  checked('current_duplicate_id_throws', () => {
    const registry = new HookRegistry();
    registry.register('duplicate', { id: 'same', handler: () => ({ ok: true }) });
    assert.throws(
      () => registry.register('duplicate', { id: 'same', handler: () => ({ ok: true }) }),
      /duplicate hook id/
    );
  });

  checked('current_sync_registry_rejects_promise', () => {
    const registry = new HookRegistry();
    registry.register('promise', {
      id: 'promise',
      failureMode: 'block',
      handler: () => Promise.resolve({ ok: true }),
    });
    const result = registry.runSync('promise');
    assert.strictEqual(result.ok, false);
    assert.match(result.results[0].reason, /returned a Promise in sync registry/);
  });

  checked('ahr_30_timeout_is_post_facto_not_interrupting', () => {
    const registry = new HookRegistry();
    registry.register('timeout', {
      id: 'slow',
      timeoutMs: 5,
      failureMode: 'block',
      handler: () => {
        busyWait(40);
        return { ok: true };
      },
    });
    const started = Date.now();
    const result = registry.runSync('timeout');
    const actualBlockingMs = Date.now() - started;
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.results[0].timeout, true);
    assert(actualBlockingMs >= 25, `expected handler to block before timeout verdict, got ${actualBlockingMs}ms`);
    evidence.timeoutInjection = {
      budgetMs: 5,
      injectedHandlerMs: 40,
      actualBlockingMs,
      result: 'blocked_after_handler_returned',
      interruptCapability: false,
    };
  });

  checked('ahr_26_aliases_resolve_to_one_preferred_entry', () => {
    assert.strictEqual(Contract.canonicalToolName('apply_patch'), 'file.mutate');
    assert.strictEqual(Contract.canonicalToolName('edit_file'), 'file.mutate');
    assert.strictEqual(Contract.canonicalToolName('exec_command'), 'command.run');
    assert.strictEqual(Contract.canonicalToolName('shell-command'), 'command.run');
    assert.strictEqual(Contract.canonicalToolName('readFile'), 'file.read');
    assert.strictEqual(Contract.canonicalToolName('web_fetch'), 'web.fetch');
    assert.strictEqual(Contract.canonicalToolName('search_query'), 'web.search');
    assert.deepStrictEqual(Contract.resolveToolAlias('apply_patch'), {
      originalName: 'apply_patch',
      canonicalName: 'file.mutate',
      matched: true,
    });
    assert.deepStrictEqual(Contract.resolveToolAlias('vendor.custom_tool'), {
      originalName: 'vendor.custom_tool',
      canonicalName: 'vendor.custom_tool',
      matched: false,
    });
    assert.throws(() => Contract.canonicalToolName('vendor.custom_tool'), /unknown tool alias/);
  });

  checked('ahr_27_absolute_path_and_stable_artifact_id', () => {
    const first = Contract.normalizeArtifactRef('projects/控制台/brief.md', root);
    const second = Contract.normalizeArtifactRef(first.absolutePath, root);
    assert(path.isAbsolute(first.absolutePath));
    assert.strictEqual(first.absolutePath, second.absolutePath);
    assert.strictEqual(first.artifactId, second.artifactId);
    assert.match(first.artifactId, /^artifact:path-sha256:[a-f0-9]{64}$/);
    assert.throws(() => Contract.normalizeArtifactRef('../outside', root), /escapes workspace/);
  });

  checked('ahr_28_pre_post_responsibilities_are_separate', () => {
    const pre = Contract.normalizeHookEvent({
      schema_version: Contract.HOOK_EVENT_SCHEMA,
      event_type: 'pre_tool_use',
      request_id: 'req-1',
      task_id: 'task-1',
      tool_call_id: 'call-1',
      tool_name: 'apply_patch',
      policy_decision: 'allow',
    });
    assert.strictEqual(pre.phase, 'pre');
    assert.strictEqual(pre.toolName, 'file.mutate');
    const post = Contract.normalizeHookEvent({
      schemaVersion: Contract.HOOK_EVENT_SCHEMA,
      phase: 'post',
      requestId: 'req-1',
      taskId: 'task-1',
      toolCallId: 'call-1',
      toolName: 'file.mutate',
      outcome: { status: 'success' },
      evidenceRefs: ['artifact:path-sha256:example'],
    });
    assert.strictEqual(post.phase, 'post');
    assert.throws(() => Contract.normalizeHookEvent({ ...pre, outcome: { status: 'success' } }), /pre hook may/);
    assert.throws(() => Contract.normalizeHookEvent({ ...post, policyDecision: 'deny' }), /post hook may/);
  });

  checked('ahr_29_canonical_schema_and_correlation_fields', () => {
    const event = Contract.normalizeHookEvent({
      schema_version: Contract.HOOK_EVENT_SCHEMA,
      event_type: 'post_tool_use',
      request_id: 'req-29',
      task_id: 'task-29',
      tool_call_id: 'call-29',
      tool_name: 'exec_command',
      outcome: { status: 'failed', reason: 'fixture' },
    });
    assert.deepStrictEqual(
      [event.schemaVersion, event.requestId, event.taskId, event.toolCallId, event.toolName],
      [Contract.HOOK_EVENT_SCHEMA, 'req-29', 'task-29', 'call-29', 'command.run']
    );
    assert.strictEqual('schema_version' in event, false);
    assert.throws(() => Contract.normalizeHookEvent({ ...event, requestId: '' }), /requestId is required/);
  });

  checked('ahr_30_policy_must_declare_mode_timeout_and_degradation', () => {
    assert.deepStrictEqual(
      Contract.validateHookPolicy({ failureMode: 'warn', timeoutMs: 100, degradationMode: 'continue_with_warning' }),
      { failureMode: 'warn', timeoutMs: 100, degradationMode: 'continue_with_warning' }
    );
    assert.throws(() => Contract.validateHookPolicy({ failureMode: 'warn', timeoutMs: 100 }), /degradationMode/);
  });

  checked('owner_approval_authorizes_only_the_gate_slimming_scope', () => {
    const approval = JSON.parse(fs.readFileSync(path.join(packageRoot, 'approval-state.json'), 'utf8'));
    assert.strictEqual(approval.status, 'approved');
    assert(approval.approvedScope.includes('active-shadow-dormant hook modes'));
    assert.strictEqual(
      Contract.approvalAllowsGlobalSwitch(approval, 'owner-gate-slimming-20260716'),
      true,
    );
  });

  checked('production_global_blocking_hook_files_match_preimplementation_baseline', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(packageRoot, 'production-hook-baseline.json'), 'utf8'));
    for (const [relative, expected] of Object.entries(baseline.files)) {
      assert.strictEqual(sha256File(path.join(root, relative)), expected, `${relative} changed after baseline capture`);
    }
  });

  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

main();
