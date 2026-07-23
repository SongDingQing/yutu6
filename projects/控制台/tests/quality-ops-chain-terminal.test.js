#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const SharedAudit = require('../../../shared/engine/quality-ops-audit');
const ChainTerminal = require('../quality-ops-chain-terminal');
const QualityOpsTool = require('../tools/quality-ops-audit');

const WORKDIR = path.resolve(__dirname, '../../..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'quality-ops-chain-terminal');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fixture(name) {
  return readJson(path.join(FIXTURE_DIR, `${name}.json`));
}

function assertFixture(name) {
  const data = fixture(name);
  const chain = ChainTerminal.buildChains(data.index_events, data.terminal_events)
    .find(item => item.chain_id === data.chain_id);
  assert(chain, `${name}: chain missing`);
  assert.strictEqual(chain.root_task_id, data.root_task_id);
  assert.strictEqual(chain.status, data.expected.status);
  assert.strictEqual(chain.terminal.final_state, data.expected.final_state);
  assert.deepStrictEqual(chain.span_failures, data.expected.span_failures);
  assert.deepStrictEqual(
    chain.terminal.final_state_source.map(item => item.type),
    data.expected.source_types,
  );
  if (data.expected.node_terminal_event_count != null) {
    assert.strictEqual(chain.terminal.node_terminal_events.length, data.expected.node_terminal_event_count);
  }
  if (data.expected.node_terminal_tasks) {
    assert.deepStrictEqual(
      chain.terminal.node_terminal_events.map(item => item.task),
      data.expected.node_terminal_tasks,
    );
  }
  if (data.expected.terminal_history_outcomes) {
    assert.deepStrictEqual(
      chain.terminal.terminal_history.map(item => item.outcome),
      data.expected.terminal_history_outcomes,
    );
  }
  if (data.expected.final_state_source_seqs) {
    assert.deepStrictEqual(
      chain.terminal.final_state_source.map(item => item.seq),
      data.expected.final_state_source_seqs,
    );
  }
  return chain;
}

function simpleChain(overrides = {}) {
  return Object.assign({
    root_task_id: 'simple-root',
    traces: [{
      trace_id: 'simple-trace',
      root_task_id: 'simple-root',
      root_queue_agent: 'repair-lead',
      root_queue_id: 'simple-queue',
      task_id: 'simple-root',
      status: 'completed',
    }],
  }, overrides);
}

function taskDone(seq, ts = '2026-07-17T02:00:00.000Z') {
  return { seq, ts, type: 'task.done', task: 'simple-root' };
}

function queueDone(seq, ts = '2026-07-17T02:00:01.000Z') {
  return {
    seq,
    ts,
    type: 'queue.completed',
    task: 'simple-root',
    queueAgent: 'repair-lead',
    queueId: 'simple-queue',
    ok: true,
    status: 'done',
  };
}

function assertUnknownAndWarningCases() {
  const missing = ChainTerminal.reduceChainTerminal(simpleChain(), [taskDone(1)]);
  assert.strictEqual(missing.status, 'unknown');
  assert.strictEqual(missing.final_state, 'unknown');
  assert.match(missing.unknown_reason, /^terminal_channels_missing:queue$/);

  const unsequenced = ChainTerminal.reduceChainTerminal(simpleChain(), [
    taskDone(undefined),
    queueDone(2),
  ]);
  assert.strictEqual(unsequenced.status, 'unknown');
  assert.strictEqual(unsequenced.unknown_reason, 'terminal_order_missing_sequence');

  const conflict = ChainTerminal.reduceChainTerminal(simpleChain(), [
    taskDone(3),
    { ...queueDone(4), ok: false, status: 'failed' },
  ]);
  assert.strictEqual(conflict.status, 'unknown');
  assert.strictEqual(conflict.unknown_reason, 'terminal_outcome_conflict');

  const malformedOutcome = ChainTerminal.reduceChainTerminal(simpleChain(), [
    taskDone(4),
    { ...queueDone(5), ok: true, status: 'failed' },
  ]);
  assert.strictEqual(malformedOutcome.status, 'unknown');
  assert.strictEqual(malformedOutcome.rejected_terminal_events[0].reason, 'terminal_outcome_invalid');

  const brokenLineage = ChainTerminal.reduceChainTerminal(simpleChain(), [
    taskDone(5),
    { ...queueDone(6), queueId: 'not-the-root-queue' },
  ]);
  assert.strictEqual(brokenLineage.status, 'unknown');
  assert.match(brokenLineage.unknown_reason, /^terminal_channels_missing:queue$/);
  assert.strictEqual(brokenLineage.rejected_terminal_events[0].reason, 'root_queue_lineage_mismatch');

  const sameSequenceConflict = ChainTerminal.reduceChainTerminal(simpleChain(), [
    taskDone(7),
    { ...queueDone(7), ok: false, status: 'failed' },
  ]);
  assert.strictEqual(sameSequenceConflict.status, 'unknown');
  assert.strictEqual(sameSequenceConflict.unknown_reason, 'terminal_sequence_conflict');

  const laterInvalid = ChainTerminal.reduceChainTerminal(simpleChain(), [
    taskDone(8),
    queueDone(9),
    { ...queueDone(10), queueId: 'late-wrong-queue' },
  ]);
  assert.strictEqual(laterInvalid.status, 'unknown');
  assert.strictEqual(laterInvalid.unknown_reason, 'later_terminal_lineage_invalid');

  const timestampInversion = ChainTerminal.reduceChainTerminal(simpleChain(), [
    taskDone(11, '2026-07-17T02:00:05.000Z'),
    queueDone(12, '2026-07-17T02:00:04.000Z'),
  ]);
  assert.strictEqual(timestampInversion.status, 'completed');
  assert.strictEqual(timestampInversion.final_state, 'done');
  assert.strictEqual(timestampInversion.confidence, 'warning');
  assert(timestampInversion.warnings.some(item => item.code === 'terminal_timestamp_order_inversion'));

  const duplicate = ChainTerminal.reduceChainTerminal(simpleChain(), [
    taskDone(13),
    taskDone(13),
    queueDone(14),
  ]);
  assert.strictEqual(duplicate.status, 'completed');
  assert.strictEqual(duplicate.final_state, 'done');

  const missingTraceRootQueue = ChainTerminal.reduceChainTerminal(simpleChain({
    traces: [{
      trace_id: 'missing-root-queue-trace',
      root_task_id: 'simple-root',
      task_id: 'simple-root',
      status: 'completed',
    }],
  }), [taskDone(15), queueDone(16)]);
  assert.strictEqual(missingTraceRootQueue.status, 'unknown');
  assert.match(missingTraceRootQueue.unknown_reason, /^terminal_channels_missing:queue$/);
  assert.strictEqual(
    missingTraceRootQueue.rejected_terminal_events[0].reason,
    'root_queue_lineage_mismatch',
  );

  const routeData = fixture('route-fail-then-success');
  const forgedDownstreamEvents = routeData.terminal_events.map(event => {
    if (event.type !== 'project.route.done' && event.type !== 'project.route.failed') return event;
    return {
      ...event,
      downstreamQueueAgent: 'forged-supervisor',
      downstreamQueueId: 'forged-queue',
    };
  });
  const forgedDownstream = ChainTerminal.buildChains(
    routeData.index_events,
    forgedDownstreamEvents,
  )[0].terminal;
  assert.strictEqual(forgedDownstream.status, 'unknown');
  assert.match(forgedDownstream.unknown_reason, /^terminal_channels_missing:project_route$/);
  assert(forgedDownstream.rejected_terminal_events.every(item => {
    return item.reason === 'project_route_downstream_queue_unverified';
  }));
}

function assertStableContentHashAndPlanFields() {
  const data = fixture('repair-lead-fallback-success');
  const firstEvents = data.terminal_events.map((event, index) => ({
    ...event,
    _evidence_ref: `first-log.jsonl:${index + 1}`,
  }));
  const rotatedEvents = data.terminal_events.map((event, index) => ({
    ...event,
    _evidence_ref: `rotated-log.jsonl:${index + 100}`,
  }));
  const first = ChainTerminal.buildChains(data.index_events, firstEvents)[0];
  const rotated = ChainTerminal.buildChains(data.index_events, rotatedEvents)[0];
  assert.strictEqual(first.content_hash, rotated.content_hash, 'event-log rotation must not change semantic content hash');

  const plan = SharedAudit.makePlan({ strategy: 'first_week_full', candidates: 1, selected: [first] }, {
    now: new Date('2026-07-17T03:00:00.000Z'),
    auditId: 'terminal-plan-fixture',
    batchSize: 1,
  });
  QualityOpsTool.decoratePlanTerminalFields(plan);
  const planned = plan.batches[0].chains[0];
  assert.strictEqual(planned.final_state, 'done');
  assert.strictEqual(planned.unknown_reason, null);
  assert.deepStrictEqual(planned.final_state_source.map(item => item.type), ['task.done', 'queue.completed']);
}

function actualEventLogReplay() {
  const eventFile = path.join(
    WORKDIR,
    'projects/控制台/artifacts/engine-events.2026-07-16-0926-50889.jsonl',
  );
  const traceIndex = path.join(
    WORKDIR,
    'projects/控制台/artifacts/quality-ops/traces/index.jsonl',
  );
  assert(fs.existsSync(eventFile), 'frozen engine event log must exist');
  assert(fs.existsSync(traceIndex), 'quality-ops trace index must exist');
  const events = ChainTerminal.readTerminalEvents([eventFile], { baseDir: WORKDIR });
  const chains = ChainTerminal.buildChains(SharedAudit.readJsonLines(traceIndex), events);

  const route = chains.find(item => item.chain_id === 'chain-311dce6a127a16d2ed09');
  assert(route, 'actual fail-then-success route chain missing');
  assert.strictEqual(route.status, 'completed');
  assert.strictEqual(route.terminal.final_state, 'done');
  assert.deepStrictEqual(
    route.terminal.final_state_source.map(item => item.seq),
    [260627, 260628, 260629],
  );
  assert(route.span_failures.includes('trace-9fe05d0ee78a7833b6b1c251'));
  assert(route.terminal.final_state_source.every(item => /engine-events\..+\.jsonl:\d+$/.test(item.evidence_ref)));

  const repair = chains.find(item => item.chain_id === 'chain-af9680db461693a9cb38');
  assert(repair, 'actual repair-lead fallback chain missing');
  assert.strictEqual(repair.status, 'completed');
  assert.strictEqual(repair.terminal.final_state, 'done');
  assert.deepStrictEqual(
    repair.terminal.final_state_source.map(item => item.seq),
    [260928, 260930],
  );
  assert.deepStrictEqual(repair.span_failures, ['trace-eab8e08bd0bdd87db3627073']);

  return {
    event_file: path.relative(WORKDIR, eventFile).split(path.sep).join('/'),
    route_chain: {
      chain_id: route.chain_id,
      root_task_id: route.root_task_id,
      status: route.status,
      final_state: route.terminal.final_state,
      span_failures: route.span_failures,
      final_state_source: route.terminal.final_state_source,
    },
    repair_lead_chain: {
      chain_id: repair.chain_id,
      root_task_id: repair.root_task_id,
      status: repair.status,
      final_state: repair.terminal.final_state,
      span_failures: repair.span_failures,
      final_state_source: repair.terminal.final_state_source,
    },
  };
}

function productionWiringReplay() {
  const chains = QualityOpsTool.interactionChains();
  const route = chains.find(item => item.chain_id === 'chain-311dce6a127a16d2ed09');
  const repair = chains.find(item => item.chain_id === 'chain-af9680db461693a9cb38');
  assert(route && repair, 'production quality-ops wiring must expose both replay chains');
  assert.strictEqual(route.terminal.final_state, 'done');
  assert.strictEqual(repair.terminal.final_state, 'done');
  return {
    chain_count: chains.length,
    route_final_state: route.terminal.final_state,
    repair_lead_final_state: repair.terminal.final_state,
  };
}

function main() {
  const routeFixture = assertFixture('route-fail-then-success');
  const repairFixture = assertFixture('repair-lead-fallback-success');
  assertUnknownAndWarningCases();
  assertStableContentHashAndPlanFields();
  const actual = actualEventLogReplay();
  const productionWiring = productionWiringReplay();
  const report = {
    ok: true,
    scenarios: 16,
    fixtures: {
      route_fail_then_success: {
        status: routeFixture.status,
        final_state: routeFixture.terminal.final_state,
        span_failures: routeFixture.span_failures,
        node_terminal_events: routeFixture.terminal.node_terminal_events,
        terminal_history_outcomes: routeFixture.terminal.terminal_history.map(item => item.outcome),
        final_state_source_seqs: routeFixture.terminal.final_state_source.map(item => item.seq),
      },
      repair_lead_fallback_success: {
        status: repairFixture.status,
        final_state: repairFixture.terminal.final_state,
        span_failures: repairFixture.span_failures,
        terminal_history_outcomes: repairFixture.terminal.terminal_history.map(item => item.outcome),
        final_state_source_seqs: repairFixture.terminal.final_state_source.map(item => item.seq),
      },
    },
    unknown_warning_cases: [
      'missing-terminal-channel',
      'missing-sequence',
      'terminal-outcome-conflict',
      'malformed-terminal-outcome',
      'broken-queue-lineage',
      'duplicate-sequence-conflict',
      'later-invalid-lineage',
      'timestamp-order-warning',
      'exact-duplicate-idempotency',
      'missing-trace-root-queue',
      'forged-downstream-queue',
    ],
    actual_event_log_replay: actual,
    production_wiring_replay: productionWiring,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
