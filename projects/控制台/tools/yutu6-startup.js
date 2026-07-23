#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const CONTROL_ROOT = path.resolve(__dirname, '..');
const MANIFEST_FILE = path.join(CONTROL_ROOT, 'config', 'startup-components.json');
const ARTIFACT_DIR = path.join(CONTROL_ROOT, 'artifacts', 'startup');
const STATUS_FILE = path.join(ARTIFACT_DIR, 'status.json');
const LOG_FILE = path.join(ARTIFACT_DIR, 'startup.log');
const LOCK_FILE = path.join(ARTIFACT_DIR, 'startup.lock.json');
const DOMAIN = `gui/${process.getuid()}`;
const HOME = process.env.HOME || '/Users/yutu6';
const LAUNCH_AGENTS_DIR = path.join(HOME, 'Library', 'LaunchAgents');
const COMMAND = process.argv[2] || 'start';

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function expandHome(value) {
  const text = String(value || '');
  if (text === '~') return HOME;
  if (text.startsWith('~/')) return path.join(HOME, text.slice(2));
  return text;
}

function sanitize(value) {
  return String(value || '')
    .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
    .replace(/\b(sk|ma_live)-[A-Za-z0-9._-]{10,}\b/gi, '<redacted>')
    .replace(/\b(key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=<redacted>')
    .slice(0, 400);
}

function rotateLog() {
  try {
    if (fs.statSync(LOG_FILE).size < 2 * 1024 * 1024) return;
    const previous = `${LOG_FILE}.1`;
    try { fs.unlinkSync(previous); } catch (_) {}
    fs.renameSync(LOG_FILE, previous);
  } catch (_) {}
}

function log(level, message) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  rotateLog();
  const line = `${nowIso()} [${level}] ${sanitize(message)}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    cwd: options.cwd || CONTROL_ROOT,
    env: Object.assign({}, process.env, options.env || {}),
    encoding: 'utf8',
    timeout: options.timeout || 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    signal: result.signal,
    error: result.error ? sanitize(result.error.message) : null,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function commandPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
  }
  const lookup = run('/usr/bin/which', [candidates[candidates.length - 1]], { timeout: 3000 });
  return lookup.ok ? lookup.stdout.trim() : null;
}

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  if (manifest.schema !== 'yutu6-startup-components@1') {
    throw new Error(`unsupported startup manifest: ${manifest.schema || 'missing'}`);
  }
  return manifest;
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function pidAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (_) {
    return false;
  }
}

function acquireLock() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  try {
    const fd = fs.openSync(LOCK_FILE, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, started_at: nowIso() })}\n`);
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  try {
    const current = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (pidAlive(current.pid)) return false;
  } catch (_) {}

  try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
  const fd = fs.openSync(LOCK_FILE, 'wx', 0o600);
  fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, started_at: nowIso(), recovered_stale: true })}\n`);
  fs.closeSync(fd);
  return true;
}

function releaseLock() {
  try {
    const current = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (Number(current.pid) === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch (_) {}
}

function plistSource(entry) {
  if (entry.source) return path.join(CONTROL_ROOT, entry.source);
  return expandHome(entry.external_plist);
}

function plistTarget(entry) {
  if (entry.external_plist) return expandHome(entry.external_plist);
  return path.join(LAUNCH_AGENTS_DIR, `${entry.label}.plist`);
}

function launchAgentInfo(label) {
  const result = run('/bin/launchctl', ['print', `${DOMAIN}/${label}`], { timeout: 5000 });
  if (!result.ok) return { loaded: false, state: 'not_loaded', pid: null };
  const stateMatch = result.stdout.match(/^\s*state = ([^\n]+)$/m);
  const pidMatch = result.stdout.match(/^\s*pid = (\d+)$/m);
  return {
    loaded: true,
    state: stateMatch ? stateMatch[1].trim() : 'loaded',
    pid: pidMatch ? Number(pidMatch[1]) : null,
  };
}

function copyPlistIfNeeded(entry, installSources) {
  const source = plistSource(entry);
  const target = plistTarget(entry);
  if (!fs.existsSync(source)) {
    return { ok: false, target, error: 'plist_missing' };
  }
  const lint = run('/usr/bin/plutil', ['-lint', source], { timeout: 5000 });
  if (!lint.ok) return { ok: false, target, error: 'plist_invalid' };
  if (entry.external_plist) return { ok: true, target, changed: false };

  fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  const sourceBody = fs.readFileSync(source);
  let changed = true;
  try { changed = !sourceBody.equals(fs.readFileSync(target)); } catch (_) {}
  if (!changed) return { ok: true, target, changed: false };
  if (!installSources && fs.existsSync(target)) {
    return { ok: true, target, changed: false, update_pending: true };
  }
  fs.writeFileSync(target, sourceBody, { mode: 0o644 });
  fs.chmodSync(target, 0o644);
  return { ok: true, target, changed: true };
}

async function ensureLaunchAgent(entry, installSources) {
  const copied = copyPlistIfNeeded(entry, installSources);
  if (!copied.ok) return Object.assign({ id: entry.id, label: entry.label }, copied);

  let info = launchAgentInfo(entry.label);
  if (!info.loaded) {
    const loaded = run('/bin/launchctl', ['bootstrap', DOMAIN, copied.target], { timeout: 15000 });
    if (!loaded.ok) {
      return {
        id: entry.id,
        label: entry.label,
        ok: false,
        state: 'bootstrap_failed',
        reason: `launchctl_exit_${loaded.status}`,
      };
    }
    run('/bin/launchctl', ['enable', `${DOMAIN}/${entry.label}`], { timeout: 5000 });
    await sleep(500);
    info = launchAgentInfo(entry.label);
  }

  if (entry.kind === 'service' && info.state !== 'running') {
    run('/bin/launchctl', ['kickstart', `${DOMAIN}/${entry.label}`], { timeout: 10000 });
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(500);
      info = launchAgentInfo(entry.label);
      if (info.state === 'running') break;
    }
  }

  const result = {
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    tier: entry.tier,
    ok: info.loaded && (entry.kind !== 'service' || info.state === 'running'),
    loaded: info.loaded,
    state: info.state,
    pid: info.pid,
  };
  if (copied.update_pending) result.plist_update_pending = true;
  return result;
}

function dockerPath() {
  return commandPath(['/usr/local/bin/docker', '/opt/homebrew/bin/docker', 'docker']);
}

function dockerReady(bin) {
  return !!bin && run(bin, ['info'], { timeout: 10000 }).ok;
}

async function waitForDocker(bin, waitSeconds, startApp) {
  if (dockerReady(bin)) return true;
  if (startApp) run('/usr/bin/open', ['-gj', '-a', startApp], { timeout: 10000 });
  const deadline = Date.now() + Math.max(1, Number(waitSeconds || 120)) * 1000;
  while (Date.now() < deadline) {
    await sleep(2000);
    if (dockerReady(bin)) return true;
  }
  return false;
}

function containerInfo(bin, name) {
  const result = run(bin, [
    'inspect',
    '-f',
    '{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project"}}|{{.HostConfig.RestartPolicy.Name}}',
    name,
  ], { timeout: 10000 });
  if (!result.ok) return { exists: false, running: false, composeProject: '', restart: '' };
  const [running, composeProject, restart] = result.stdout.trim().split('|');
  return {
    exists: true,
    running: running === 'true',
    composeProject: composeProject || '',
    restart: restart || '',
  };
}

function adoptUnmanagedContainers(bin, manifest) {
  const adopted = [];
  for (const entry of manifest.docker.containers || []) {
    if (!entry.adopt_unmanaged || !entry.ephemeral) continue;
    const info = containerInfo(bin, entry.name);
    if (!info.exists || info.composeProject) continue;
    const removed = run(bin, ['rm', '-f', entry.name], { timeout: 30000 });
    if (!removed.ok) throw new Error(`cannot adopt container ${entry.id}`);
    adopted.push(entry.id);
  }
  return adopted;
}

async function httpHealth(url, timeoutMs = 5000) {
  return new Promise(resolve => {
    const request = http.get(url, { timeout: timeoutMs }, response => {
      response.resume();
      resolve({ ok: response.statusCode >= 200 && response.statusCode < 400, status: response.statusCode });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', error => resolve({ ok: false, status: null, error: sanitize(error.message) }));
  });
}

async function waitForUrl(url, waitSeconds = 45) {
  const deadline = Date.now() + waitSeconds * 1000;
  let last = { ok: false, status: null, error: 'not_checked' };
  while (Date.now() < deadline) {
    last = await httpHealth(url);
    if (last.ok) return last;
    await sleep(1000);
  }
  return last;
}

async function ensureDocker(manifest, options = {}) {
  const bin = dockerPath();
  if (!bin) return { ok: false, state: 'docker_cli_missing', containers: [], health: [] };
  const ready = await waitForDocker(bin, manifest.docker.wait_seconds, options.startApp ? manifest.docker.app : null);
  if (!ready) return { ok: false, state: 'docker_engine_unavailable', containers: [], health: [] };

  const composeFile = path.join(CONTROL_ROOT, manifest.docker.compose_file);
  if (!fs.existsSync(composeFile)) {
    return { ok: false, state: 'compose_file_missing', containers: [], health: [] };
  }

  let adopted = [];
  if (options.adopt) adopted = adoptUnmanagedContainers(bin, manifest);

  if (options.start) {
    const compose = run(bin, ['compose', '-f', composeFile, 'up', '-d', '--remove-orphans'], {
      cwd: path.dirname(composeFile),
      timeout: 180000,
    });
    if (!compose.ok) {
      return {
        ok: false,
        state: 'compose_up_failed',
        reason: `docker_exit_${compose.status}`,
        adopted,
        containers: [],
        health: [],
      };
    }
  }

  const containers = (manifest.docker.containers || []).map(entry => {
    const info = containerInfo(bin, entry.name);
    return {
      id: entry.id,
      name: entry.name,
      ok: info.running && info.restart === 'unless-stopped',
      running: info.running,
      restart: info.restart,
      compose_managed: !!info.composeProject,
    };
  });
  const health = [];
  for (const url of manifest.docker.health_urls || []) {
    health.push(Object.assign({ url }, options.start ? await waitForUrl(url) : await httpHealth(url)));
  }
  return {
    ok: containers.every(item => item.ok) && health.every(item => item.ok),
    state: 'ready',
    adopted,
    containers,
    health,
  };
}

function validateManifest(manifest) {
  const errors = [];
  const ids = new Set();
  for (const entry of manifest.launch_agents || []) {
    if (!entry.id || ids.has(entry.id)) errors.push(`duplicate_or_missing_id:${entry.id || 'missing'}`);
    ids.add(entry.id);
    if (!entry.label) errors.push(`missing_label:${entry.id}`);
    const source = plistSource(entry);
    if (!source || !fs.existsSync(source)) errors.push(`missing_plist:${entry.id}`);
    else if (!run('/usr/bin/plutil', ['-lint', source], { timeout: 5000 }).ok) errors.push(`invalid_plist:${entry.id}`);
  }
  const activeIds = new Set((manifest.launch_agents || []).map(entry => entry.id));
  for (const excluded of manifest.excluded || []) {
    if (activeIds.has(excluded.id)) errors.push(`excluded_is_active:${excluded.id}`);
  }
  return { ok: errors.length === 0, errors };
}

async function collectHealth(manifest, launchAgents, docker) {
  for (const entry of manifest.launch_agents || []) {
    const result = launchAgents.find(item => item.id === entry.id);
    if (!result || !result.ok) continue;
    result.health = [];
    for (const url of entry.health_urls || []) {
      const health = await waitForUrl(url);
      result.health.push(Object.assign({ url }, health));
      if (!health.ok) result.ok = false;
    }
  }
  return {
    schema: 'yutu6-startup-status@1',
    checked_at: nowIso(),
    ok: docker.ok && launchAgents.every(item => item.ok),
    command: COMMAND,
    docker,
    launch_agents: launchAgents,
    exclusions: manifest.excluded || [],
  };
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const manifest = readManifest();
  const validation = validateManifest(manifest);
  if (!validation.ok) {
    process.stderr.write(`${JSON.stringify(validation, null, 2)}\n`);
    return 1;
  }
  if (COMMAND === 'validate') {
    process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
    return 0;
  }

  if (!['start', 'install', 'status'].includes(COMMAND)) {
    process.stderr.write('usage: start-all.sh [start|install|status|validate]\n');
    return 2;
  }

  const mutating = COMMAND !== 'status';
  if (mutating && !acquireLock()) {
    log('INFO', 'another startup reconciliation is already running; skipped');
    return 0;
  }

  try {
    log('INFO', `${COMMAND} reconciliation started`);
    const docker = await ensureDocker(manifest, {
      start: mutating,
      startApp: mutating,
      adopt: COMMAND === 'install',
    });
    const launchAgents = [];
    for (const entry of manifest.launch_agents || []) {
      if (mutating) {
        launchAgents.push(await ensureLaunchAgent(entry, COMMAND === 'install'));
      } else {
        const info = launchAgentInfo(entry.label);
        launchAgents.push({
          id: entry.id,
          label: entry.label,
          kind: entry.kind,
          tier: entry.tier,
          ok: info.loaded && (entry.kind !== 'service' || info.state === 'running'),
          loaded: info.loaded,
          state: info.state,
          pid: info.pid,
        });
      }
    }
    const status = await collectHealth(manifest, launchAgents, docker);
    writeJsonAtomic(STATUS_FILE, status);
    const passed = status.launch_agents.filter(item => item.ok).length;
    log(status.ok ? 'OK' : 'ERROR',
      `components=${passed}/${status.launch_agents.length} docker=${status.docker.ok ? 'ready' : status.docker.state}`);
    if (!process.argv.includes('--quiet')) {
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    }
    return status.ok ? 0 : 1;
  } finally {
    if (mutating) releaseLock();
  }
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    log('ERROR', error && error.message ? error.message : String(error));
    releaseLock();
    process.exitCode = 1;
  });
}

module.exports = {
  sanitize,
  validateManifest,
  launchAgentInfo,
  containerInfo,
};
