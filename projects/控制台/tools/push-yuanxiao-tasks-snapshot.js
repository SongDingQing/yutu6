#!/usr/bin/env node
'use strict';
/*
 * 玉兔6 → 嫦娥 任务快照推送(元宵任务中枢数据源,2026-07-04)。
 * 背景:嫦娥自包含模式下 /api/v1/tasks 无桥可转发;改为本机每 5 分钟推一份
 * 任务板快照到嫦娥 /opt/yuanxiao/data/tasks-snapshot.json,服务端以 snapshot 模式服务。
 * 快照契约(与 yuanxiao_server.py 消费端一致):
 *   { generated_at, source:"yutu6-console",
 *     tasks:[{id,title,agent,status,project,updated_at,detail?}](≤60条),
 *     counts:{queued,running,done_24h,failed_24h} }
 * 只读扫描 queues/,不动任何队列文件。SSH 走 ~/.ssh/change.pem(YUANXIAO_SSH_KEY 可覆盖),
 * 服务器落点经 /tmp 暂存 + sudo install 原子替换。--dry-run 只打印不上传。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const QUEUES = process.env.CONSOLE_QUEUES_DIR
  ? path.resolve(process.env.CONSOLE_QUEUES_DIR)
  : path.join(ROOT, 'artifacts', 'queues');
const SSH_KEY = process.env.YUANXIAO_SSH_KEY || path.join(os.homedir(), '.ssh', 'change.pem');
const SSH_DEST = process.env.YUANXIAO_SSH_DEST || 'ubuntu@49.235.187.125';
const REMOTE_PATH = process.env.YUANXIAO_TASKS_SNAPSHOT_REMOTE || '/opt/yuanxiao/data/tasks-snapshot.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TASKS = 60;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

// goal 里可能带秘书背景包/多段结构;取"目标:"行优先,否则首个非空行。
function titleFromTask(entry) {
  const goal = String((entry.task && entry.task.goal) || entry.goal || '').trim();
  if (!goal) return entry.id || '未命名任务';
  const goalLine = goal.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const target = goalLine.find(l => l.startsWith('目标:') || l.startsWith('目标：'));
  const line = (target ? target.replace(/^目标[:：]\s*/, '') : goalLine.find(l => !l.startsWith('秘书补全稿') && !l.startsWith('[秘书后台背景包]'))) || goalLine[0];
  return line.slice(0, 80);
}

function entryTime(entry) {
  return entry.finished_at || entry.updated_at || entry.progress_at || entry.started_at || entry.enqueued_at || null;
}

function isQueueAgentDir(name) {
  return !name.startsWith('.') && !name.startsWith('_') && name !== 'queues';
}

function collect() {
  const buckets = { running: [], queued: [], failed: [], done: [] };
  const counts = { queued: 0, running: 0, done_24h: 0, failed_24h: 0 };
  const cutoff = Date.now() - DAY_MS;
  let agents = [];
  try { agents = fs.readdirSync(QUEUES).filter(isQueueAgentDir); } catch (_) { return { buckets, counts }; }
  for (const agent of agents) {
    const base = path.join(QUEUES, agent);
    let stat;
    try { stat = fs.statSync(base); } catch (_) { continue; }
    if (!stat.isDirectory()) continue;
    const scan = (sub, status) => {
      const dir = sub ? path.join(base, sub) : base;
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (_) { return; }
      for (const f of files) {
        const entry = readJson(path.join(dir, f));
        if (!entry || !entry.id) continue;
        const at = entryTime(entry);
        const atMs = at ? Date.parse(at) : 0;
        if ((status === 'done' || status === 'failed') && (!atMs || atMs < cutoff)) continue;
        if (status === 'queued') counts.queued++;
        else if (status === 'running') counts.running++;
        else if (status === 'done') counts.done_24h++;
        else if (status === 'failed') counts.failed_24h++;
        buckets[status].push({
          id: String(entry.id),
          title: titleFromTask(entry),
          agent,
          status,
          project: (entry.task && entry.task.projectId) || entry.projectId || '控制台',
          updated_at: at,
        });
      }
    };
    scan(null, 'queued');
    scan('running', 'running');
    scan('failed', 'failed');
    scan('done', 'done');
  }
  return { buckets, counts };
}

function buildSnapshot() {
  const { buckets, counts } = collect();
  const byTimeDesc = (a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  for (const k of Object.keys(buckets)) buckets[k].sort(byTimeDesc);
  const tasks = [
    ...buckets.running,
    ...buckets.queued,
    ...buckets.failed,
    ...buckets.done,
  ].slice(0, MAX_TASKS);
  return {
    generated_at: new Date().toISOString(),
    source: 'yutu6-console',
    tasks,
    counts,
  };
}

function push(snapshot) {
  const local = path.join(os.tmpdir(), `yuanxiao-tasks-snapshot-${process.pid}.json`);
  fs.writeFileSync(local, JSON.stringify(snapshot, null, 1));
  const remoteTmp = `/tmp/tasks-snapshot-${Date.now()}.json`;
  const sshBase = ['-i', SSH_KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  try {
    execFileSync('scp', [...sshBase, local, `${SSH_DEST}:${remoteTmp}`], { stdio: 'pipe', timeout: 30000 });
    execFileSync('ssh', [...sshBase, SSH_DEST,
      `sudo install -o yuanxiao -g yuanxiao -m 644 ${remoteTmp} ${REMOTE_PATH} && rm -f ${remoteTmp}`,
    ], { stdio: 'pipe', timeout: 30000 });
  } finally {
    try { fs.unlinkSync(local); } catch (_) {}
  }
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const snapshot = buildSnapshot();
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, counts: snapshot.counts, taskCount: snapshot.tasks.length, sample: snapshot.tasks.slice(0, 3) }, null, 1));
    return;
  }
  push(snapshot);
  console.log(JSON.stringify({ ok: true, pushed: REMOTE_PATH, counts: snapshot.counts, taskCount: snapshot.tasks.length, generated_at: snapshot.generated_at }));
}

if (require.main === module) main();
module.exports = { buildSnapshot, titleFromTask, _test: { collect, QUEUES } };
