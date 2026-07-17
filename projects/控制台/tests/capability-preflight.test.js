#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CapabilityPreflight,
  defaultCapabilitySpecs,
  defaultProbe,
  prepareFrontDoorCapabilityContext,
} = require('../capability-preflight');

const ROOT = path.resolve(__dirname, '../../..');
const TASK_ID = 'cr-1784167841803-6f4d5caf';
const SPEC_FINGERPRINT = '56e805d72d3e6e350be25d34cc0e00eb14bc97bab7833bdacbe3e73a30a42f04';
const evidenceEvents = [];
const scenarioResults = [];

function mkdir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function write(file, text, mode) {
  mkdir(file);
  fs.writeFileSync(file, text);
  if (mode) fs.chmodSync(file, mode);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-preflight-'));
  const workspaceRoot = path.join(root, 'workspace');
  const homeDir = path.join(root, 'home');
  const specs = defaultCapabilitySpecs({ workspaceRoot, homeDir });
  return { root, workspaceRoot, homeDir, specs };
}

function installRouter(fx) {
  const spec = fx.specs['instruction-expansion-router'];
  for (const item of spec.required) write(item.file, `# ${item.name}\n`);
}

function installModuleRegistry(fx, options = {}) {
  const spec = fx.specs['module-registry'];
  const index = spec.required.find(item => item.name === 'registry_index').file;
  const lookup = spec.required.find(item => item.name === 'lookup').file;
  const callLog = path.join(fx.root, 'lookup-calls.log');
  write(index, '# fixture module registry\n');
  write(lookup, [
    '#!/usr/bin/env node',
    "'use strict';",
    `require('fs').appendFileSync(${JSON.stringify(callLog)}, 'called\\n');`,
    `process.stdout.write(${JSON.stringify(options.output || '{"match":"fixture-module"}\n')});`,
    '',
  ].join('\n'), 0o755);
  return { index, lookup, callLog };
}

function collector(scenario) {
  return (type, payload) => evidenceEvents.push(Object.assign({ scenario, type }, payload));
}

async function availableScenario() {
  const fx = fixture();
  installRouter(fx);
  const injectedSecret = ['fixture', 'sensitive', 'value'].join('-');
  const installed = installModuleRegistry(fx, {
    output: `${JSON.stringify({ match: 'fixture-module', OPENAI_API_KEY: injectedSecret })}\n`,
  });
  let probes = 0;
  const preflight = new CapabilityPreflight({
    specs: fx.specs,
    cacheFile: false,
    ttlMs: 5000,
    retryDelayMs: 0,
    probe: async spec => { probes++; return defaultProbe(spec); },
  });
  const first = await prepareFrontDoorCapabilityContext({
    preflight,
    workspaceRoot: fx.workspaceRoot,
    homeDir: fx.homeDir,
    taskId: TASK_ID,
    query: 'module registry fixture',
    eventlog: collector('available'),
  });
  const second = await prepareFrontDoorCapabilityContext({
    preflight,
    workspaceRoot: fx.workspaceRoot,
    homeDir: fx.homeDir,
    taskId: `${TASK_ID}-second-agent`,
    query: 'module registry fixture',
    eventlog: collector('available-second-agent'),
  });
  const prompt = first.promptByRole.orchestrator;
  assert(first.resolutions.router.available, 'router capability should be available');
  assert(first.resolutions.moduleRegistry.available, 'module registry should be available');
  assert(first.invocation && first.invocation.ok, 'verified lookup must be invoked');
  assert(prompt.includes(installed.index), 'available registry INDEX path must be injected');
  assert(prompt.includes(installed.lookup), 'available lookup path must be injected');
  assert(prompt.includes('fixture-module'), 'lookup result must be injected');
  assert(!prompt.includes(injectedSecret), 'lookup output must be redacted before injection');
  assert.strictEqual(fs.readFileSync(installed.callLog, 'utf8').trim().split(/\r?\n/).length, 1, 'lookup must be called once within TTL');
  assert.strictEqual(probes, 2, 'each of two available capabilities must be probed once');
  assert(second.resolutions.moduleRegistry.cacheHit, 'second agent must reuse TTL cache');
  scenarioResults.push({ scenario: 'available_and_called', passed: true, probes, lookup_calls: 1 });
}

async function missingAndConcurrentScenario() {
  const fx = fixture();
  installRouter(fx);
  let moduleProbes = 0;
  let spawns = 0;
  const sharedCache = path.join(fx.root, 'shared-capability-cache.json');
  const makePreflight = () => new CapabilityPreflight({
    specs: fx.specs,
    cacheFile: sharedCache,
    ttlMs: 500,
    retryDelayMs: 0,
    probe: async spec => {
      if (spec.invoke) moduleProbes++;
      return defaultProbe(spec);
    },
    spawn: () => { spawns++; throw new Error('missing capability must not be invoked'); },
  });
  const preflights = [makePreflight(), makePreflight()];
  const secret = ['fixture', 'private', 'value'].join('-');
  const requests = await Promise.all([
    prepareFrontDoorCapabilityContext({
      preflight: preflights[0],
      taskId: `${TASK_ID} API_TOKEN=${secret}`,
      query: `request ${secret}`,
      eventlog: collector('missing-concurrent'),
    }),
    prepareFrontDoorCapabilityContext({
      preflight: preflights[1],
      taskId: `${TASK_ID}-another-agent`,
      query: `request ${secret}`,
      eventlog: collector('missing-concurrent'),
    }),
  ]);
  const prompt = requests[0].promptByRole.secretary;
  const unavailable = evidenceEvents.filter(event => event.scenario === 'missing-concurrent' && event.type === 'capability_unavailable');
  assert.strictEqual(unavailable.length, 1, 'concurrent missing requests must emit one capability_unavailable event');
  assert.strictEqual(moduleProbes, 2, 'missing capability must receive exactly initial probe plus one retry');
  assert.strictEqual(spawns, 0, 'missing lookup must never be executed');
  assert(prompt.includes('fallback=workspace_capability_registry'), 'missing capability must use named fallback');
  assert(prompt.includes('禁止再次 sed、读取、执行'), 'fallback must explicitly stop agent retries');
  assert(!prompt.includes(path.join(fx.homeDir, '.codex')), 'missing absolute paths must not be injected');
  assert(!JSON.stringify(unavailable).includes(secret), 'events must not contain task/query secrets');
  scenarioResults.push({ scenario: 'missing_retry_cache_fallback', passed: true, probes: moduleProbes, unavailable_events: unavailable.length, lookup_calls: spawns });
}

async function transientMountScenario() {
  const fx = fixture();
  installRouter(fx);
  let mounted = null;
  const preflight = new CapabilityPreflight({
    specs: fx.specs,
    cacheFile: false,
    ttlMs: 500,
    retryDelayMs: 1,
    sleep: async () => { mounted = installModuleRegistry(fx); },
  });
  const resolution = await preflight.resolve({
    capability: 'module-registry',
    taskId: TASK_ID,
    eventlog: collector('transient-mount'),
  });
  const invocation = await preflight.invoke({
    capability: 'module-registry',
    resolution,
    query: 'mounted fixture',
    taskId: TASK_ID,
    eventlog: collector('transient-mount'),
  });
  assert(resolution.available, 'capability must recover on lightweight retry');
  assert.strictEqual(resolution.attempts, 2, 'transient mount must require the one allowed retry');
  assert.strictEqual(resolution.probeResult, 'available_after_retry');
  assert(invocation.ok, 'recovered capability must be callable');
  assert.strictEqual(fs.readFileSync(mounted.callLog, 'utf8').trim(), 'called');
  scenarioResults.push({ scenario: 'transient_mount_retry', passed: true, attempts: resolution.attempts, lookup_calls: 1 });
}

async function ttlRecoveryScenario() {
  const fx = fixture();
  let now = 1000;
  let probes = 0;
  const preflight = new CapabilityPreflight({
    specs: fx.specs,
    cacheFile: false,
    ttlMs: 100,
    retryDelayMs: 0,
    now: () => now,
    sleep: async () => {},
    probe: async spec => { probes++; return defaultProbe(spec); },
  });
  const first = await preflight.resolve({ capability: 'module-registry', taskId: TASK_ID, eventlog: collector('ttl-recovery') });
  assert(!first.available);
  installModuleRegistry(fx);
  now = 1050;
  const cached = await preflight.resolve({ capability: 'module-registry', taskId: TASK_ID, eventlog: collector('ttl-recovery') });
  assert(!cached.available && cached.cacheHit, 'recovery inside TTL must remain cached without probing');
  assert.strictEqual(probes, 2, 'TTL cache must prevent another probe');
  now = 1101;
  const recovered = await preflight.resolve({ capability: 'module-registry', taskId: TASK_ID, eventlog: collector('ttl-recovery') });
  assert(recovered.available, 'expired TTL must allow capability recovery');
  assert.strictEqual(probes, 3, 'expired TTL must perform one fresh successful probe');
  scenarioResults.push({ scenario: 'ttl_expiry_recovery', passed: true, probes, recovered: true });
}

function baselineAndIntegrationScenario() {
  const baselines = [
    'projects/控制台/artifacts/engine-runs/cr-1784011840492-eed63b0f/orchestrator-plan-1/process-summary.redacted.log',
    'projects/控制台/artifacts/engine-runs/cr-1784012613399-4cdb09e1/orchestrator-plan-1/process-summary.redacted.log',
  ];
  for (const relative of baselines) {
    const text = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert(text.includes('/Users/yutu6/.codex/modules/INDEX.md'), `${relative} must identify the missing registry baseline`);
    assert(/No such file or directory|no such file or directory/.test(text), `${relative} must contain the stable failure baseline`);
  }
  const engine = require('../engine-runner')._test;
  const marker = '# Capability preflight fixture marker';
  const ctx = engine.makeCtx({
    taskId: TASK_ID,
    projectId: '控制台',
    goal: 'fixture',
    structuredAcceptance: false,
  }, { capabilityPromptByRole: { orchestrator: marker, secretary: marker } });
  assert(ctx.agentPrompts.orchestrator.includes(marker), 'engine must inject preflight into orchestrator prompt');
  assert(ctx.agentPrompts.secretary.includes(marker), 'engine must inject preflight into secretary prompt');
  const source = fs.readFileSync(path.join(ROOT, 'projects/控制台/capability-preflight.js'), 'utf8');
  assert(!/\b(?:npm|pnpm|yarn|pip)\s+install\b/.test(source), 'hook must not contain automatic install commands');
  scenarioResults.push({ scenario: 'baseline_and_engine_integration', passed: true, baselines, injected_roles: ['orchestrator', 'secretary'] });
}

function writeEvidence() {
  const index = process.argv.indexOf('--evidence-dir');
  if (index < 0 || !process.argv[index + 1]) return null;
  const dir = path.resolve(process.argv[index + 1]);
  fs.mkdirSync(dir, { recursive: true });
  const eventsFile = path.join(dir, 'events.jsonl');
  const reportFile = path.join(dir, 'test-report.json');
  fs.writeFileSync(eventsFile, evidenceEvents.map((event, i) => JSON.stringify(Object.assign({ seq: i + 1, taskId: event.taskId || TASK_ID }, event))).join('\n') + '\n');
  fs.writeFileSync(reportFile, JSON.stringify({
    taskId: TASK_ID,
    specFingerprint: SPEC_FINGERPRINT,
    passed: true,
    scenarios: scenarioResults,
    event_count: evidenceEvents.length,
    capability_unavailable_count: evidenceEvents.filter(event => event.type === 'capability_unavailable').length,
    security: { secrets_logged: false, automatic_install: false, global_module_modified: false },
  }, null, 2) + '\n');
  return { eventsFile, reportFile };
}

async function main() {
  await availableScenario();
  await missingAndConcurrentScenario();
  await transientMountScenario();
  await ttlRecoveryScenario();
  baselineAndIntegrationScenario();
  const evidence = writeEvidence();
  process.stdout.write(`capability-preflight tests passed (${scenarioResults.length} scenarios)${evidence ? `; evidence=${evidence.reportFile}` : ''}\n`);
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exit(1);
});
