'use strict';

// 处理清单第2项守卫:孤儿 worker 回收只杀 ppid==1 且无有效 pidfile 的进程,合法/新生 worker 受保护。

const assert = require('assert');
const { selectOrphanWorkerPids } = require('../projects/控制台/worker-reaper');

function main() {
  const procs = [
    { pid: 100, ppid: 1, agent: 'worker_code' },   // 孤儿、无 pidfile → 回收
    { pid: 101, ppid: 1, agent: 'repair' },         // 孤儿但有有效 pidfile(在 validPids)→ 保护
    { pid: 102, ppid: 555, agent: 'worker_code' },  // ppid!=1(server 刚 spawn 的子)→ 不回收
    { pid: 103, ppid: 1, agent: 'ui_optimizer' },   // 孤儿、无 pidfile → 回收
  ];
  const validPids = new Set([101]);
  assert.deepStrictEqual(
    selectOrphanWorkerPids(procs, validPids).sort((a, b) => a - b),
    [100, 103],
    '只回收 ppid==1 且无有效 pidfile 的孤儿,合法/新生 worker 不动',
  );
  assert.deepStrictEqual(selectOrphanWorkerPids([], validPids), [], '空进程列表安全');
  assert.deepStrictEqual(selectOrphanWorkerPids(procs, [101]), [100, 103], 'validPids 接受数组');
  assert.deepStrictEqual(
    selectOrphanWorkerPids(procs, new Set([100, 101, 103])),
    [],
    '全部进 validPids → 一个都不杀',
  );
  console.log(JSON.stringify({ pass: true, suite: 'worker-reaper' }));
}

main();
