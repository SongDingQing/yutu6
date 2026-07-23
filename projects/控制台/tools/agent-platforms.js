#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');

const CONTROL_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(CONTROL_ROOT, '..', '..');
const CATALOG_FILE = path.join(CONTROL_ROOT, 'config', 'agent-platforms.json');
const RUNNER_FILE = path.join(CONTROL_ROOT, 'config.json');
const HOME = process.env.HOME || os.homedir();
const SECRET_FIELD = /(token|secret|password|api[_-]?key|cookie)/i;

function expandPath(value) {
  const text = String(value || '');
  if (text === '.') return WORKSPACE_ROOT;
  if (text === '~') return HOME;
  if (text.startsWith('~/')) return path.join(HOME, text.slice(2));
  return path.isAbsolute(text) ? text : path.join(WORKSPACE_ROOT, text);
}

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd || WORKSPACE_ROOT,
    env: Object.assign({}, process.env, options.env || {}),
    encoding: 'utf8',
    timeout: options.timeout || 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function commandPath(name, candidates = []) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  const result = run('/usr/bin/which', [name], { timeout: 3000 });
  return result.ok ? result.stdout : null;
}

function readCatalog() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  if (catalog.schema !== 'yutu6-agent-platforms@1') {
    throw new Error(`unsupported agent platform catalog: ${catalog.schema || 'missing'}`);
  }
  return catalog;
}

function platformById(catalog, id) {
  const platform = catalog.platforms.find(entry => entry.id === id);
  if (!platform) throw new Error(`unknown platform: ${id}`);
  return platform;
}

function safeObject(value) {
  if (Array.isArray(value)) return value.map(safeObject);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) continue;
    result[key] = safeObject(entry);
  }
  return result;
}

function runnerInventory() {
  const config = JSON.parse(fs.readFileSync(RUNNER_FILE, 'utf8'));
  return Object.entries(config.runners || {}).map(([id, runner]) => {
    const execution = runner.execution || {};
    let source = 'cli';
    if (runner.kind === 'openai_http_tool_harness') source = 'tool-harness';
    else if (runner.kind === 'openai_http') {
      source = String(runner.baseUrl || '').includes('127.0.0.1:3000')
        ? 'yutu6-model-pool'
        : 'provider-direct';
    } else if (id === 'mock') source = 'local-mock';

    return {
      id,
      label: runner.label || id,
      kind: runner.kind || 'cli',
      model: runner.model || null,
      source,
      can_write_files: execution.canWriteFiles === true,
      can_run_commands: execution.canRunCommands === true,
      privileged: execution.privileged === true,
      tool_harness: execution.toolHarnessRunner || runner.executorRunner || null,
      credential_mode: runner.tokenFile ? 'local_file' : (runner.kind === 'openai_http' ? 'environment_or_gateway' : 'cli_session'),
    };
  });
}

function portOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port: Number(port) });
    const finish = value => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function httpCheck(url, timeoutMs = 2500) {
  return new Promise(resolve => {
    const request = http.get(url, { timeout: timeoutMs }, response => {
      response.resume();
      resolve({
        url,
        ok: response.statusCode >= 200 && response.statusCode < 500,
        status: response.statusCode,
      });
    });
    request.once('timeout', () => {
      request.destroy();
      resolve({ url, ok: false, reason: 'timeout' });
    });
    request.once('error', error => {
      resolve({ url, ok: false, reason: error.code || 'connection_failed' });
    });
  });
}

function diskFreeGiB(target) {
  const result = run('/bin/df', ['-Pk', target], { timeout: 5000 });
  if (!result.ok) return null;
  const lines = result.stdout.split(/\r?\n/);
  const fields = (lines[lines.length - 1] || '').trim().split(/\s+/);
  const availableKiB = Number(fields[3]);
  return Number.isFinite(availableKiB)
    ? Math.round((availableKiB / 1024 / 1024) * 10) / 10
    : null;
}

async function doctor(platform) {
  const localPath = expandPath(platform.local_path);
  const docker = commandPath('docker', ['/usr/local/bin/docker', '/opt/homebrew/bin/docker']);
  const git = commandPath('git', ['/usr/bin/git']);
  const checks = {
    platform: platform.id,
    enabled: platform.enabled,
    autostart: platform.autostart,
    local_path: localPath,
    local_path_exists: fs.existsSync(localPath),
    machine: {
      cpu_cores: os.cpus().length,
      memory_gib: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
      disk_free_gib: diskFreeGiB(fs.existsSync(localPath) ? localPath : HOME),
    },
    commands: {
      node: process.execPath,
      git,
      docker,
      docker_ready: docker ? run(docker, ['info'], { timeout: 10000 }).ok : false,
    },
    health: await Promise.all((platform.health_urls || []).map(url => httpCheck(url))),
    ports: {},
    blockers: [],
  };

  for (const [name, port] of Object.entries(platform.ports || {})) {
    checks.ports[name] = { port, listening: await portOpen(port) };
  }

  if (platform.resources) {
    const required = platform.resources;
    if (checks.machine.cpu_cores < required.minimum_cpu_cores) checks.blockers.push('cpu_below_minimum');
    if (checks.machine.memory_gib < required.minimum_memory_gib) checks.blockers.push('memory_below_minimum');
    if (checks.machine.disk_free_gib !== null && checks.machine.disk_free_gib < required.minimum_disk_gib) {
      checks.blockers.push('disk_below_minimum');
    }
  }
  if (platform.id === 'nexent') {
    if (!checks.commands.docker_ready) checks.blockers.push('docker_not_ready');
    if (checks.ports.yutu6_web && checks.ports.yutu6_web.listening && !checks.health[0]?.ok) {
      checks.blockers.push('adapted_web_port_in_use');
    }
    if (checks.ports.northbound_a2a && checks.ports.northbound_a2a.listening && !checks.health[1]?.ok) {
      checks.blockers.push('a2a_port_in_use');
    }
  }
  checks.ready = checks.blockers.length === 0;
  return checks;
}

function platformSummary(platform) {
  return {
    id: platform.id,
    label: platform.label,
    kind: platform.kind,
    enabled: platform.enabled,
    autostart: platform.autostart,
    heavy: platform.heavy,
    local_path: expandPath(platform.local_path),
    summary: platform.summary,
  };
}

function plan(platform, catalog) {
  if (platform.id === 'yutu6-native') {
    return {
      platform: platform.id,
      recommendation: 'keep_as_primary_control_plane',
      commands: {
        status: ['bash', 'start-all.sh', 'status'],
        start: ['bash', 'start-all.sh', 'start'],
        models: ['bash', 'agent-platforms.sh', 'models', '--json'],
      },
    };
  }
  if (platform.id === 'yutu6-fabric') {
    return {
      platform: platform.id,
      recommendation: 'primary_model_and_agent_plane',
      autostart: true,
      commands: {
        status: ['bash', 'start-all.sh', 'status'],
        start: ['bash', 'start-all.sh', 'start'],
      },
      model_pool: platform.model_pool,
      a2a: platform.a2a,
      completion_boundary: catalog.policy.external_completion_policy,
    };
  }
  return {
    platform: platform.id,
    recommendation: 'optional_a2a_sidecar',
    autostart: false,
    resource_floor: platform.resources,
    prepare: ['bash', 'agent-platforms.sh', 'prepare', platform.id],
    preflight: ['bash', 'agent-platforms.sh', 'doctor', platform.id, '--json'],
    start: [
      'bash',
      'agent-platforms.sh',
      'start',
      platform.id,
      catalog.policy.heavy_start_confirmation,
    ],
    ui: `http://127.0.0.1:${platform.ports.yutu6_web}`,
    a2a: platform.a2a,
    model_pool: {
      base_url: platform.model_pool.base_url_from_container,
      credential_policy: platform.model_pool.credential_policy,
    },
    completion_boundary: catalog.policy.external_completion_policy,
  };
}

function verifyNexentRepo(localPath, platform) {
  if (!fs.existsSync(path.join(localPath, '.git'))) {
    throw new Error(`not a git repository: ${localPath}`);
  }
  const remote = run('/usr/bin/git', ['remote', 'get-url', 'origin'], { cwd: localPath });
  if (!remote.ok || !remote.stdout.includes('ModelEngine-Group/nexent')) {
    throw new Error('existing directory is not the configured Nexent repository');
  }
  const status = run('/usr/bin/git', ['status', '--porcelain'], { cwd: localPath });
  return {
    local_path: localPath,
    remote: platform.upstream.repository,
    dirty: Boolean(status.stdout),
  };
}

function prepare(platform) {
  if (!platform.upstream) throw new Error(`${platform.id} does not require preparation`);
  const localPath = expandPath(platform.local_path);
  if (fs.existsSync(localPath)) {
    return Object.assign({ prepared: true, cloned: false }, verifyNexentRepo(localPath, platform));
  }
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const clone = run('/usr/bin/git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    platform.upstream.branch,
    platform.upstream.repository,
    localPath,
  ], { timeout: 10 * 60 * 1000 });
  if (!clone.ok) throw new Error(`clone failed: git exit ${clone.status}`);
  return Object.assign({ prepared: true, cloned: true }, verifyNexentRepo(localPath, platform));
}

function withTemporaryNexentPortRewrite(platform, callback) {
  const localPath = expandPath(platform.local_path);
  const rewrite = platform.launch.temporary_port_rewrite;
  const originals = new Map();
  try {
    for (const relative of rewrite.files) {
      const file = path.join(localPath, relative);
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes(rewrite.from)) throw new Error(`expected upstream port mapping missing: ${relative}`);
      originals.set(file, source);
      fs.writeFileSync(file, source.split(rewrite.from).join(rewrite.to));
    }
    return callback(localPath);
  } finally {
    for (const [file, source] of originals) fs.writeFileSync(file, source);
  }
}

async function start(platform, argv, catalog) {
  if (platform.id === 'yutu6-native') {
    const result = run('/bin/bash', [
      path.join(WORKSPACE_ROOT, platform.launch.manager),
      ...platform.launch.start_args,
    ], { timeout: 5 * 60 * 1000 });
    if (!result.ok) throw new Error(`native startup failed: exit ${result.status}`);
    return { platform: platform.id, started: true, output: result.stdout };
  }

  if (platform.heavy && !argv.includes(catalog.policy.heavy_start_confirmation)) {
    throw new Error(`heavy platform requires ${catalog.policy.heavy_start_confirmation}`);
  }
  prepare(platform);
  const preflight = await doctor(platform);
  if (!preflight.ready) throw new Error(`preflight blocked: ${preflight.blockers.join(', ')}`);

  return withTemporaryNexentPortRewrite(platform, localPath => {
    const [bin, ...args] = platform.launch.command;
    const result = run(bin === 'bash' ? '/bin/bash' : bin, args, {
      cwd: localPath,
      timeout: 30 * 60 * 1000,
    });
    if (!result.ok) throw new Error(`Nexent startup failed: exit ${result.status}`);
    return {
      platform: platform.id,
      started: true,
      ui: `http://127.0.0.1:${platform.ports.yutu6_web}`,
      a2a: platform.a2a.base_url,
    };
  });
}

function stop(platform) {
  if (platform.id === 'yutu6-native') {
    throw new Error('native control plane stop is intentionally not exposed by this optional-platform manager');
  }
  const localPath = expandPath(platform.local_path);
  verifyNexentRepo(localPath, platform);
  const docker = commandPath('docker', ['/usr/local/bin/docker', '/opt/homebrew/bin/docker']);
  if (!docker) throw new Error('docker not found');
  const composeFile = path.join(localPath, 'deploy', 'docker', 'compose', 'docker-compose.prod.yml');
  const envFile = path.join(localPath, 'deploy', 'env', '.env');
  const args = ['compose'];
  if (fs.existsSync(envFile)) args.push('--env-file', envFile);
  args.push('-p', 'nexent', '-f', composeFile, 'stop');
  const result = run(docker, args, { cwd: localPath, timeout: 5 * 60 * 1000 });
  if (!result.ok) throw new Error(`Nexent stop failed: exit ${result.status}`);
  return { platform: platform.id, stopped: true, data_preserved: true };
}

function usage() {
  return [
    'Usage: bash agent-platforms.sh <command> [platform] [options]',
    '',
    'Commands:',
    '  list [--json]                 List native and optional platforms',
    '  models [--json]               Show the current Yutu6 model/runner inventory',
    '  doctor [platform] [--json]    Check resources, ports, Docker and health',
    '  plan <platform> [--json]      Show a no-side-effect adoption/launch plan',
    '  prepare <platform> [--json]   Clone an optional platform without starting it',
    '  start <platform>              Start; heavy platforms require --confirm-heavy',
    '  stop <platform>               Stop optional containers and preserve data',
  ].join('\n');
}

function print(value, json) {
  if (json || typeof value !== 'string') {
    process.stdout.write(`${JSON.stringify(safeObject(value), null, 2)}\n`);
  } else {
    process.stdout.write(`${value}\n`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'list';
  const json = argv.includes('--json');
  const catalog = readCatalog();

  if (command === 'help' || command === '--help' || command === '-h') {
    print(usage(), false);
    return 0;
  }
  if (command === 'list') {
    const value = catalog.platforms.map(platformSummary);
    print(value, true);
    return 0;
  }
  if (command === 'models') {
    print({ model_pool: catalog.platforms[0].model_pool, runners: runnerInventory() }, true);
    return 0;
  }

  const platform = platformById(catalog, argv[1] || catalog.policy.default_platform);
  if (command === 'doctor') print(await doctor(platform), true);
  else if (command === 'plan') print(plan(platform, catalog), true);
  else if (command === 'prepare') print(prepare(platform), true);
  else if (command === 'start') print(await start(platform, argv.slice(2), catalog), true);
  else if (command === 'stop') print(stop(platform), true);
  else throw new Error(`unknown command: ${command}\n${usage()}`);
  return 0;
}

if (require.main === module) {
  main().then(
    code => { process.exitCode = code; },
    error => {
      process.stderr.write(`[agent-platforms] ${String(error.message || error)}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  readCatalog,
  platformById,
  platformSummary,
  runnerInventory,
  doctor,
  plan,
  prepare,
  safeObject,
  expandPath,
  main,
};
