'use strict';

// 处理清单第2项(worker 孤儿回收):根治被旁路 spawn / 老 console 遗留的"无主孤儿"
// (ppid==1 且没有有效 .worker.pid 跟踪)堆积。它们不被 supersede 回收、还会抢任务跑旧码。
//
// 安全设计(踩过坑):① 默认 dry-run,只报告不杀,必须显式 opts.kill===true 才发信号;
// ② 必须传真实 queuesDir 自己算 validPids(合法 worker 受保护),不传则不动;
// ③ 只挑 ppid==1 且不在 validPids 的 ceo-worker——刚被 server spawn 的 ppid=server 非1,不会误杀;
// ④ 绝不放进 server 热路径(会跑全系统 ps+kill 污染并存 ROOT/测试),只供受控维护服务(ram-watchdog)调。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// 纯函数:挑出"无主孤儿" worker pid = ppid===1 且 pid 不在 validPids(有效 pidfile 记录)里。
function selectOrphanWorkerPids(procs, validPids) {
  const valid = validPids instanceof Set ? validPids : new Set((validPids || []).map(Number));
  return (procs || [])
    .filter(p => p && Number(p.ppid) === 1 && !valid.has(Number(p.pid)))
    .map(p => Number(p.pid));
}

// 列出所有 ceo-worker.js 进程 {pid, ppid, agent, command}
function listWorkerProcs() {
  const res = spawnSync('ps', ['-eo', 'pid,ppid,command'], { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  if (res.error || res.status !== 0) return [];
  const out = [];
  for (const line of String(res.stdout || '').split('\n')) {
    if (!line.includes('ceo-worker.js') || line.includes(' grep ')) continue;
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const am = m[3].match(/--agent\s+([A-Za-z0-9_-]+)/);
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), agent: am ? am[1] : null, command: m[3] });
  }
  return out;
}

// 扫 queuesDir/<agent>/.worker.pid,收集合法常驻 worker 的 pid(受保护、绝不回收)
function collectValidWorkerPids(queuesDir) {
  const valid = new Set();
  let agents = [];
  try { agents = fs.readdirSync(queuesDir); } catch (_) { return valid; }
  for (const a of agents) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(queuesDir, a, '.worker.pid'), 'utf8'));
      if (rec && rec.pid) valid.add(Number(rec.pid));
    } catch (_) {}
  }
  return valid;
}

// 回收无主孤儿 worker。必须传 opts.queuesDir(真实队列目录)。默认 dry-run;opts.kill===true 才 SIGTERM。
function reapOrphanWorkers(opts = {}) {
  const queuesDir = opts.queuesDir;
  if (!queuesDir) return { reaped: [], orphanPids: [], skipped: 'no-queues-dir' };
  const validPids = collectValidWorkerPids(queuesDir);
  const procs = listWorkerProcs();
  const orphanPids = selectOrphanWorkerPids(procs, validPids);
  // 安全闸:读不到任何有效 pidfile(validCount=0)很可能是异常 / worker 重启窗口,此时盲杀风险高 → 只报告不杀
  if (validPids.size === 0 && opts.force !== true) {
    return { reaped: [], orphanPids, dryRun: true, validCount: 0, guard: 'no-valid-pids', scanned: procs.length };
  }
  if (opts.kill !== true) {
    return { reaped: [], orphanPids, dryRun: true, validCount: validPids.size, scanned: procs.length };
  }
  // 先 SIGTERM 给优雅退出机会;实测卡死的 idle 孤儿不响应 TERM,等 1.5s 后对仍存活的 SIGKILL 保底
  const termed = [];
  for (const pid of orphanPids) {
    try { process.kill(pid, 'SIGTERM'); termed.push(pid); } catch (_) {}
  }
  if (termed.length) {
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); } catch (_) {}
  }
  const killed = [];
  for (const pid of termed) {
    try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); killed.push(pid); } catch (_) {}
  }
  return { reaped: termed, killed, orphanPids, validCount: validPids.size, scanned: procs.length };
}

module.exports = { selectOrphanWorkerPids, listWorkerProcs, collectValidWorkerPids, reapOrphanWorkers };

// CLI 入口(供 launchd 定时调):默认 dry-run 只报告;WORKER_REAPER_APPLY=1 才真 SIGTERM 孤儿。
if (require.main === module) {
  const queuesDir = process.env.WORKER_REAPER_QUEUES_DIR || path.join(__dirname, 'artifacts', 'queues');
  const apply = process.env.WORKER_REAPER_APPLY === '1';
  const r = reapOrphanWorkers({ queuesDir, kill: apply });
  process.stdout.write(JSON.stringify(Object.assign({ ts: new Date().toISOString(), queuesDir, applied: apply }, r)) + '\n');
}
