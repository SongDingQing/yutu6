#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_KEEP = 10;

function usage() {
  return [
    'Usage:',
    '  node projects/控制台/tools/backup-snapshot.js --once [--keep 10]',
    '  node projects/控制台/tools/backup-snapshot.js --daemon --interval-minutes 60 [--keep 24]',
    '',
    'Options:',
    '  --root <dir>              Workspace root. Default: current 玉兔6 workspace',
    '  --backups-dir <dir>       Backup output dir. Default: <root>/backups',
    '  --keep <n>                Retain newest n archives. Default: 10',
    '  --interval-minutes <n>    Daemon interval in minutes. Default: 60',
    '  --interval-ms <n>         Test-friendly daemon interval override',
    '  --help                   Show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    mode: 'once',
    root: DEFAULT_ROOT,
    backupsDir: null,
    keep: DEFAULT_KEEP,
    intervalMinutes: 60,
    intervalMs: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--once') {
      opts.mode = 'once';
    } else if (arg === '--daemon' || arg === '--schedule') {
      opts.mode = 'daemon';
    } else if (arg === '--root') {
      opts.root = path.resolve(argv[++i] || '');
    } else if (arg === '--backups-dir') {
      opts.backupsDir = path.resolve(argv[++i] || '');
    } else if (arg === '--keep') {
      opts.keep = Math.max(1, parseInt(argv[++i], 10) || DEFAULT_KEEP);
    } else if (arg === '--interval-minutes') {
      opts.intervalMinutes = Math.max(1, parseFloat(argv[++i]) || 60);
    } else if (arg === '--interval-ms') {
      opts.intervalMs = Math.max(100, parseInt(argv[++i], 10) || 0);
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  opts.root = path.resolve(opts.root);
  opts.backupsDir = opts.backupsDir || path.join(opts.root, 'backups');
  return opts;
}

function stamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch (_) { return false; }
}

function rel(root, p) {
  return path.relative(root, p) || path.basename(p);
}

function pickSource(root, name, archivePath, candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const full = path.resolve(candidate);
    if (!exists(full)) continue;
    return {
      name,
      archivePath,
      sourcePath: full,
      originalPath: rel(root, full),
      status: 'included',
    };
  }
  return {
    name,
    archivePath,
    candidates: candidates.map(p => rel(root, path.resolve(p))),
    status: 'missing',
  };
}

function plannedSources(root) {
  const consoleRoot = path.join(root, 'projects', '控制台');
  return [
    pickSource(root, 'queues', 'queues', [
      path.join(root, 'queues'),
      path.join(consoleRoot, 'artifacts', 'queues'),
    ]),
    pickSource(root, 'memory', 'memory', [path.join(root, 'memory')]),
    pickSource(root, 'board', 'board', [path.join(root, 'board')]),
    pickSource(root, 'config.json', 'config.json', [
      path.join(root, 'config.json'),
      path.join(consoleRoot, 'config.json'),
    ]),
    pickSource(root, 'shared/agents', path.join('shared', 'agents'), [
      path.join(root, 'shared', 'agents'),
    ]),
  ];
}

function copyRecursive(src, dst) {
  const st = fs.lstatSync(src);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (st.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(src), dst);
    return;
  }
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
    return;
  }
  if (st.isFile()) {
    fs.copyFileSync(src, dst);
  }
}

function measure(p) {
  const st = fs.lstatSync(p);
  if (st.isDirectory()) {
    let files = 0;
    let bytes = 0;
    for (const name of fs.readdirSync(p)) {
      const child = measure(path.join(p, name));
      files += child.files;
      bytes += child.bytes;
    }
    return { files, bytes };
  }
  if (st.isFile()) return { files: 1, bytes: st.size };
  return { files: 0, bytes: 0 };
}

function writeRestoreReadme(file, manifest) {
  const lines = [
    '# Console Snapshot Restore',
    '',
    'This archive was created by projects/控制台/tools/backup-snapshot.js.',
    '',
    'To inspect:',
    '',
    '```bash',
    `tar -tzf ${path.basename(manifest.archiveFile || 'console-snapshot.tar.gz')}`,
    '```',
    '',
    'To restore manually, extract the archive, read MANIFEST.json, then copy each archivePath back to its originalPath.',
    '',
    '| archivePath | originalPath |',
    '|---|---|',
  ];
  for (const s of manifest.sources) {
    lines.push(`| ${s.archivePath} | ${s.originalPath} |`);
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

function makeArchive(stagingParent, snapshotName, archiveFile) {
  const result = spawnSync('tar', ['-czf', archiveFile, '-C', stagingParent, snapshotName], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`tar failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
}

function verifyArchive(archiveFile) {
  const result = spawnSync('tar', ['-tzf', archiveFile], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`tar verify failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  const lines = (result.stdout || '').split(/\r?\n/).filter(Boolean);
  if (!lines.some(line => /\/MANIFEST\.json$/.test(line))) {
    throw new Error('archive verify failed: MANIFEST.json missing');
  }
  return lines;
}

function pruneBackups(backupsDir, keep) {
  const files = fs.readdirSync(backupsDir)
    .filter(name => /^console-snapshot-\d{14}\.tar\.gz$/.test(name))
    .map(name => {
      const file = path.join(backupsDir, name);
      return { file, name, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.name.localeCompare(a.name) || b.mtimeMs - a.mtimeMs);
  const pruned = [];
  for (const entry of files.slice(keep)) {
    fs.unlinkSync(entry.file);
    pruned.push(entry.file);
  }
  return pruned;
}

function runOnce(opts) {
  const root = path.resolve(opts.root);
  const backupsDir = path.resolve(opts.backupsDir);
  fs.mkdirSync(backupsDir, { recursive: true });

  const snapshotName = `console-snapshot-${stamp()}`;
  const stagingParent = fs.mkdtempSync(path.join(os.tmpdir(), 'console-backup-'));
  const stagingDir = path.join(stagingParent, snapshotName);
  const archiveFile = path.join(backupsDir, `${snapshotName}.tar.gz`);
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    const planned = plannedSources(root);
    const included = planned.filter(s => s.status === 'included');
    const missing = planned.filter(s => s.status === 'missing');
    if (!included.length) throw new Error('no snapshot sources exist');

    const sources = [];
    for (const source of included) {
      const target = path.join(stagingDir, source.archivePath);
      copyRecursive(source.sourcePath, target);
      const stats = measure(target);
      sources.push(Object.assign({}, source, stats));
    }

    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      workspaceRoot: root,
      archiveFile,
      retentionKeep: opts.keep,
      sources: sources.map(s => ({
        name: s.name,
        archivePath: s.archivePath,
        originalPath: s.originalPath,
        files: s.files,
        bytes: s.bytes,
      })),
      missing: missing.map(s => ({
        name: s.name,
        archivePath: s.archivePath,
        candidates: s.candidates,
      })),
    };

    fs.writeFileSync(path.join(stagingDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeRestoreReadme(path.join(stagingDir, 'RESTORE.md'), manifest);

    makeArchive(stagingParent, snapshotName, archiveFile);
    const entries = verifyArchive(archiveFile);
    const pruned = pruneBackups(backupsDir, opts.keep);

    return {
      ok: true,
      archive: archiveFile,
      entries: entries.length,
      sources: manifest.sources,
      missing: manifest.missing,
      pruned,
    };
  } finally {
    fs.rmSync(stagingParent, { recursive: true, force: true });
  }
}

async function runDaemon(opts) {
  const intervalMs = opts.intervalMs || Math.round(opts.intervalMinutes * 60 * 1000);
  const execute = () => {
    try {
      const result = runOnce(opts);
      console.log(JSON.stringify(result));
    } catch (err) {
      console.error(JSON.stringify({ ok: false, error: err.message }));
    }
  };
  execute();
  console.log(JSON.stringify({ ok: true, mode: 'daemon', intervalMs, backupsDir: opts.backupsDir }));
  setInterval(execute, intervalMs);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }
  if (opts.mode === 'daemon') {
    await runDaemon(opts);
    return;
  }
  console.log(JSON.stringify(runOnce(opts), null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error(err && err.stack || err);
    process.exit(1);
  });
}

module.exports = {
  _test: {
    parseArgs,
    plannedSources,
    runOnce,
  },
};
