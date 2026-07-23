#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const GatePolicy = require('../shared/engine/gate-policy');
const { HookRegistry } = require('../shared/engine/hook-registry');
const LoopEngineering = require('../shared/engine/loop-engineering');
const HardeningHooks = require('../projects/控制台/hardening-hooks');
const VersionProgressHook = require('../projects/控制台/version-progress-hook');
const EngineRunner = require('../projects/控制台/engine-runner');

const root = path.resolve(__dirname, '..');

function testPolicyIsValidAndIncidentBacked() {
  const policy = GatePolicy.loadPolicy(root);
  const result = GatePolicy.validatePolicy(policy, {
    workspaceRoot: root,
    requireExistingRefs: true,
  });
  assert.strictEqual(result.ok, true, result.errors.join('; '));
  assert.strictEqual(policy.gates['console.protocol_gate'].mode, 'dormant');
  assert.strictEqual(policy.gates['console.hard_regression_coverage'].mode, 'dormant');
  assert.strictEqual(policy.gates['engine.loop_engineering_convergence'].mode, 'dormant');
  assert.strictEqual(policy.gates['engine.done_gate'].mode, 'active');
  assert.strictEqual(policy.gates['engine.direct_completion_conflict'].mode, 'shadow');
  for (const [id, gate] of Object.entries(policy.gates)) {
    if (gate.mode !== 'active' || gate.blocking !== true) continue;
    assert(Array.isArray(gate.incident_refs) && gate.incident_refs.length, `${id} lacks incident_refs`);
    assert(Array.isArray(gate.regression_tests) && gate.regression_tests.length, `${id} lacks regression_tests`);
  }
}

function testActiveBlockingGateNeedsRegressionTest() {
  const result = GatePolicy.validatePolicy({
    schema: GatePolicy.SCHEMA,
    default_mode: 'dormant',
    gates: {
      'fixture.unmapped': {
        mode: 'active',
        blocking: true,
        reason: 'fixture',
        incident_refs: ['tests/gate-policy.test.js'],
        activation: 'fixture only',
      },
    },
  }, { workspaceRoot: root });
  assert.strictEqual(result.ok, false);
  assert(result.errors.some(error => error.includes('requires regression_tests')));
}

function testBlockingHookNeedsIncidentProvenance() {
  const registry = new HookRegistry({ requireBlockingProvenance: true });
  assert.throws(() => registry.register('task.true_done', {
    id: 'fixture.no_provenance',
    failureMode: 'block',
    handler() { return { ok: true }; },
  }), /lacks incidentRefs/);
}

function testBlockingHookNeedsRegressionProvenance() {
  const registry = new HookRegistry({ requireBlockingProvenance: true });
  assert.throws(() => registry.register('task.true_done', {
    id: 'fixture.no_regression',
    failureMode: 'block',
    incidentRefs: ['tests/gate-policy.test.js'],
    handler() { return { ok: true }; },
  }), /lacks regressionTests/);
}

function testDormantHookDoesNotExecute() {
  let called = 0;
  const events = [];
  const registry = new HookRegistry({
    eventlog: { emit(type, data) { events.push(Object.assign({ type }, data)); } },
    emitDormantEvents: true,
    policy: {
      gates: {
        'fixture.dormant': {
          mode: 'dormant',
          reason: 'no incident evidence',
          incident_refs: ['tests/gate-policy.test.js'],
        },
      },
    },
  });
  registry.register('x', {
    id: 'fixture.dormant',
    failureMode: 'block',
    handler() { called++; return { ok: false }; },
  });
  const result = registry.runSync('x');
  assert.strictEqual(called, 0);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.results[0].skipped, true);
  assert.strictEqual(result.results[0].mode, 'dormant');
  assert(events.some(event => event.type === 'hook.skipped' && event.hookId === 'fixture.dormant'));
}

function testDormantHookIsQuietByDefault() {
  const events = [];
  const registry = new HookRegistry({
    eventlog: { emit(type, data) { events.push(Object.assign({ type }, data)); } },
    policy: {
      gates: {
        'fixture.quiet': {
          mode: 'dormant',
          reason: 'quiet routine dormancy',
          incident_refs: ['tests/gate-policy.test.js'],
        },
      },
    },
  });
  registry.register('x', {
    id: 'fixture.quiet',
    handler() { throw new Error('must not run'); },
  });
  const result = registry.runSync('x');
  assert.strictEqual(result.results[0].mode, 'dormant');
  assert.strictEqual(events.length, 0);
}

function testShadowFailureIsObservedWithoutBlocking() {
  const events = [];
  const registry = new HookRegistry({
    eventlog: { emit(type, data) { events.push(Object.assign({ type }, data)); } },
    policy: {
      gates: {
        'fixture.shadow': {
          mode: 'shadow',
          reason: 'observe before activation',
          incident_refs: ['tests/gate-policy.test.js'],
        },
      },
    },
  });
  registry.register('x', {
    id: 'fixture.shadow',
    failureMode: 'block',
    handler() { return { ok: false, reason: 'shadow mismatch' }; },
  });
  const result = registry.runSync('x');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.results[0].ok, true);
  assert.strictEqual(result.results[0].observedOk, false);
  assert.strictEqual(result.results[0].shadowFailure, true);
  assert(events.some(event => event.type === 'hook.executed'
    && event.hookId === 'fixture.shadow'
    && event.mode === 'shadow'
    && event.observedOk === false));
}

function testProductionPolicySleepsDuplicateHooks() {
  const policy = GatePolicy.loadPolicy(root);
  const registry = new HookRegistry({
    policy,
    requireBlockingProvenance: true,
  });
  HardeningHooks.registerHardeningHooks(registry, { workspaceRoot: root });
  LoopEngineering.registerLoopEngineeringHooks(registry);
  VersionProgressHook.registerVersionProgressHook(registry, {
    root,
    workspaceRoot: root,
  });
  const hooks = Object.fromEntries(registry.list('task.true_done').map(hook => [hook.id, hook]));
  assert.strictEqual(hooks[HardeningHooks.DONE_GATE_META_HOOK_ID].mode, 'active');
  assert.deepStrictEqual(
    hooks[HardeningHooks.DONE_GATE_META_HOOK_ID].regressionTests,
    ['tests/hardening-hooks.test.js'],
  );
  assert.strictEqual(hooks[HardeningHooks.PROTOCOL_GATE_HOOK_ID].mode, 'dormant');
  assert.strictEqual(hooks[HardeningHooks.HARD_REGRESSION_HOOK_ID].mode, 'dormant');
  assert.strictEqual(hooks[LoopEngineering.LOOP_TRUE_DONE_HOOK_ID].mode, 'dormant');
  assert.strictEqual(hooks[VersionProgressHook.HOOK_ID].mode, 'active');
}

function testEngineRunnerUsesProductionPolicy() {
  const registry = EngineRunner._test.makeHookRegistry(null);
  const hooks = Object.fromEntries(registry.list('task.true_done').map(hook => [hook.id, hook]));
  assert.strictEqual(hooks[HardeningHooks.DONE_GATE_META_HOOK_ID].mode, 'active');
  assert.strictEqual(hooks[HardeningHooks.PROTOCOL_GATE_HOOK_ID].mode, 'dormant');
  assert.strictEqual(hooks[HardeningHooks.HARD_REGRESSION_HOOK_ID].mode, 'dormant');
  assert.strictEqual(hooks[LoopEngineering.LOOP_TRUE_DONE_HOOK_ID].mode, 'dormant');
}

testPolicyIsValidAndIncidentBacked();
testActiveBlockingGateNeedsRegressionTest();
testBlockingHookNeedsIncidentProvenance();
testBlockingHookNeedsRegressionProvenance();
testDormantHookDoesNotExecute();
testDormantHookIsQuietByDefault();
testShadowFailureIsObservedWithoutBlocking();
testProductionPolicySleepsDuplicateHooks();
testEngineRunnerUsesProductionPolicy();

console.log(JSON.stringify({ pass: true, suite: 'gate-policy' }));
