#!/usr/bin/env node
'use strict';
/*
 * B-1 server.js 去同步阻塞 回归测试(补丁 server-async-unblock)
 * 覆盖三个热点:
 *  1) sqlite3 改异步 spawn + TTL 缓存:慢 sqlite(sleep 2s)下事件循环不被阻塞,
 *     真实 server 的 /api/health 在并发慢查询期间 <500ms 响应;
 *  2) /api/task-board 事件 byte-offset 增量缓存:与全量尾读结果一致(含追加、
 *     半行、轮转场景);
 *  3) public/ 目录签名 sync / async 双实现输出一致。
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-async-unblock-'));

// ---- 慢 sqlite3 假脚本(sleep 2s 后输出空 JSON 数组) ----
const fakeBinDir = path.join(tmpRoot, 'bin');
fs.mkdirSync(fakeBinDir, { recursive: true });
const fakeSqlite = path.join(fakeBinDir, 'sqlite3');
fs.writeFileSync(fakeSqlite, '#!/bin/sh\nsleep 2\necho "[]"\n');
fs.chmodSync(fakeSqlite, 0o755);
const fakeDb = path.join(tmpRoot, 'fake-one-api.db');
fs.writeFileSync(fakeDb, 'not-a-real-db');

// ---- 服务器模块环境(在 require 之前设置) ----
const artifactsRoot = path.join(tmpRoot, 'artifacts');
fs.mkdirSync(artifactsRoot, { recursive: true });
process.env.CONSOLE_ARTIFACTS_DIR = artifactsRoot;
process.env.QUEUE_WORKER_DISABLED = '1';
process.env.NEW_API_DB = fakeDb;
process.env.NEW_API_SQLITE_CACHE_MS = '30000';

const AsyncUnblock = require('../projects/控制台/async-unblock');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testTtlCache() {
  const cache = AsyncUnblock.createTtlCache();
  let calls = 0;
  const producer = () => { calls++; return Promise.resolve(calls); };
  const a = await cache.get('k', 30000, producer);
  const b = await cache.get('k', 30000, producer);
  assert.strictEqual(a, 1);
  assert.strictEqual(b, 1, 'TTL 内同 key 必须复用缓存');
  assert.strictEqual(calls, 1);
  // ttl<=0 旁路缓存
  await cache.get('k0', 0, producer);
  await cache.get('k0', 0, producer);
  assert.strictEqual(calls, 3, 'ttl=0 时每次都应执行 producer');
  // 失败不缓存
  let failCalls = 0;
  const failing = () => { failCalls++; return Promise.reject(new Error('boom')); };
  await assert.rejects(() => cache.get('bad', 30000, failing));
  await sleep(10); // 让 rejection 清理回调跑完
  await assert.rejects(() => cache.get('bad', 30000, failing));
  assert.strictEqual(failCalls, 2, '失败结果不得缓存');
  // 并发去重:同 key 在途时共享同一 Promise
  let slowCalls = 0;
  const slow = () => { slowCalls++; return sleep(50).then(() => 'v'); };
  const [x, y] = await Promise.all([cache.get('slow', 30000, slow), cache.get('slow', 30000, slow)]);
  assert.strictEqual(x, 'v');
  assert.strictEqual(y, 'v');
  assert.strictEqual(slowCalls, 1, '并发同 key 必须共享在途 Promise');
  console.log('  [ok] createTtlCache');
}

async function testSqliteAsyncNonBlocking() {
  // 慢 sqlite 查询在途时,事件循环上的定时器必须照常触发(而 spawnSync 会卡死)
  const pending = AsyncUnblock.sqliteJsonAsync(fakeDb, 'select 1', { bin: fakeSqlite, timeoutMs: 5000 });
  const t0 = Date.now();
  await sleep(50); // 若事件循环被阻塞,这个 50ms 定时器会等 2s 才触发
  const elapsed = Date.now() - t0;
  assert(elapsed < 500, `慢 sqlite 在途时事件循环被阻塞:50ms 定时器实际等了 ${elapsed}ms`);
  const rows = await pending;
  assert.deepStrictEqual(rows, [], '假 sqlite 输出 [] 应解析为空数组');
  // 超时路径:timeoutMs 到点 reject,不悬挂
  const t1 = Date.now();
  await assert.rejects(
    () => AsyncUnblock.sqliteJsonAsync(fakeDb, 'select 1', { bin: fakeSqlite, timeoutMs: 300 }),
    /timeout/
  );
  assert(Date.now() - t1 < 1500, 'sqlite 超时必须及时 reject');
  console.log('  [ok] sqliteJsonAsync 不阻塞事件循环 + 超时');
}

// ---- 热点2:JSONL 增量游标与全量读一致 ----
function refTailRead(file, maxItems, tailBytes, accept) {
  // 参照实现 = 旧版全量尾读语义
  let st; try { st = fs.statSync(file); } catch (_) { return []; }
  if (!st.size) return [];
  const bytes = Math.min(st.size, tailBytes);
  const start = st.size - bytes;
  const fd = fs.openSync(file, 'r');
  let text;
  try {
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, start);
    text = buf.slice(0, read).toString('utf8');
  } finally { fs.closeSync(fd); }
  const lines = text.split(/\r?\n/);
  if (start > 0) lines.shift();
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < maxItems; i--) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    if (!accept(line)) continue;
    let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
    out.push(ev);
  }
  return out.reverse();
}

async function testJsonlTailCursor() {
  const file = path.join(tmpRoot, 'events.jsonl');
  const accept = line => !line.includes('"type":"node.output"');
  const append = ev => fs.appendFileSync(file, JSON.stringify(ev) + '\n');
  let seq = 0;
  const mkev = type => ({ seq: ++seq, type, task: `t${seq % 5}` });

  for (let i = 0; i < 60; i++) append(mkev(i % 4 === 0 ? 'node.output' : 'task.queued'));

  const cursor = AsyncUnblock.createJsonlTailCursor({
    file, maxItems: 200, tailBytes: 768 * 1024, maxIncrementBytes: 4 * 1024 * 1024, acceptLine: accept,
  });

  const first = cursor.read(200);
  assert.deepStrictEqual(first, refTailRead(file, 200, 768 * 1024, accept), '首次读必须与全量尾读一致');
  assert.strictEqual(cursor.stats().rebuilds, 1);

  // 文件不变:纯缓存命中,不重建不增量
  const again = cursor.read(200);
  assert.deepStrictEqual(again, first);
  assert.strictEqual(cursor.stats().rebuilds, 1);
  assert.strictEqual(cursor.stats().increments, 0, '文件未变化时不得触发增量读');

  // 追加新事件 → 增量路径结果仍与全量一致
  for (let i = 0; i < 25; i++) append(mkev(i % 3 === 0 ? 'node.output' : 'node.done'));
  const incremental = cursor.read(200);
  assert.deepStrictEqual(incremental, refTailRead(file, 200, 768 * 1024, accept), '增量追加后必须与全量尾读一致');
  assert.strictEqual(cursor.stats().rebuilds, 1, '追加只应走增量,不应全量重建');
  assert(cursor.stats().increments >= 1);

  // 半行写入(写入方尚未写完换行):半行不产出,补完后产出
  const half = JSON.stringify({ seq: ++seq, type: 'task.done', task: 'half' });
  fs.appendFileSync(file, half.slice(0, 20));
  const withHalf = cursor.read(200);
  assert(!withHalf.some(ev => ev.task === 'half'), '未换行的半行不得被解析');
  fs.appendFileSync(file, half.slice(20) + '\n');
  const completed = cursor.read(200);
  assert(completed.some(ev => ev.task === 'half'), '半行补完后必须出现');
  assert.deepStrictEqual(completed, refTailRead(file, 200, 768 * 1024, accept), '半行拼接后必须与全量尾读一致');

  // 轮转/截断:缓存作废并重建
  fs.writeFileSync(file, '');
  append({ seq: 1, type: 'task.queued', task: 'fresh' });
  const rotated = cursor.read(200);
  assert.deepStrictEqual(rotated, refTailRead(file, 200, 768 * 1024, accept), '截断后必须重建并与全量一致');
  assert.strictEqual(cursor.stats().rebuilds, 2);

  // 全量重建时尾部恰是半行:不得永久丢失,补完后必须出现
  const file2 = path.join(tmpRoot, 'events2.jsonl');
  fs.writeFileSync(file2, JSON.stringify({ seq: 1, type: 'task.queued', task: 'x' }) + '\n');
  const half2 = JSON.stringify({ seq: 2, type: 'task.done', task: 'rebuild-half' });
  fs.appendFileSync(file2, half2.slice(0, 15));
  const cursor2 = AsyncUnblock.createJsonlTailCursor({
    file: file2, maxItems: 50, tailBytes: 768 * 1024, maxIncrementBytes: 4 * 1024 * 1024, acceptLine: accept,
  });
  assert(!cursor2.read(50).some(ev => ev.task === 'rebuild-half'), '重建时的半行不得被提前解析');
  fs.appendFileSync(file2, half2.slice(15) + '\n');
  assert(cursor2.read(50).some(ev => ev.task === 'rebuild-half'), '重建时留下的半行补完后不得丢失');
  console.log('  [ok] createJsonlTailCursor 增量一致性(追加/半行/轮转/重建半行)');
}

// ---- 热点2(集成):server.readTaskBoardEvents 增量 vs 全量 ----
async function testServerTaskBoardEvents() {
  const Server = require('../projects/控制台/server');
  const eventsFile = path.join(artifactsRoot, 'engine-events.jsonl');
  const append = ev => fs.appendFileSync(eventsFile, JSON.stringify(ev) + '\n');
  let seq = 0;
  for (let i = 0; i < 40; i++) {
    append({ seq: ++seq, type: i % 5 === 0 ? 'node.output' : 'queue.enqueued', task: `task-${i}`, stream: i % 5 === 0 ? 'stdout' : undefined });
  }
  const inc1 = Server._test.readTaskBoardEvents();
  assert.deepStrictEqual(inc1, Server._test.readTaskBoardEventsFull(), '增量读必须与全量读一致(首次)');
  for (let i = 0; i < 15; i++) append({ seq: ++seq, type: 'task.done', task: `late-${i}` });
  const inc2 = Server._test.readTaskBoardEvents();
  assert.deepStrictEqual(inc2, Server._test.readTaskBoardEventsFull(), '增量读必须与全量读一致(追加后)');
  assert(inc2.some(ev => ev.task === 'late-14'));
  assert(!inc2.some(ev => ev.type === 'node.output'), 'node.output 不得进任务板事件');
  console.log('  [ok] server.readTaskBoardEvents 增量与全量一致');
}

// ---- 热点3:目录签名 sync/async 输出一致 ----
async function testDirectorySignatureParity() {
  const dir = path.join(tmpRoot, 'public');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.html'), '<h1>hi</h1>');
  fs.writeFileSync(path.join(dir, 'sub', 'b.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'sub', 'skip.txt'), 'ignored ext');
  fs.writeFileSync(path.join(dir, '.hidden.js'), 'ignored dotfile');
  // >2MB 的文件只哈希元数据不读内容
  fs.writeFileSync(path.join(dir, 'big.png'), Buffer.alloc(2 * 1024 * 1024 + 1, 7));
  const opts = { dir, hashRelRoot: tmpRoot, itemRelRoot: tmpRoot };
  const syncSig = AsyncUnblock.directorySignature(opts);
  const asyncSig = await AsyncUnblock.directorySignatureAsync(opts);
  assert.deepStrictEqual(asyncSig, syncSig, 'sync/async 目录签名必须完全一致');
  assert.strictEqual(syncSig.fileCount, 3, 'txt/点文件不参与;html+js+png 共 3 个');
  assert.strictEqual(syncSig.algorithm, 'sha256-public-page-assets-v1');
  // 内容变化 → 签名变化
  fs.writeFileSync(path.join(dir, 'a.html'), '<h1>changed</h1>');
  const changed = AsyncUnblock.directorySignature(opts);
  assert.notStrictEqual(changed.value, syncSig.value);
  console.log('  [ok] directorySignature sync/async 一致');
}

// ---- 热点1(端到端):慢 sqlite 下真实 server 的 /api/health <500ms ----
function httpGet(port, pathname, timeoutMs) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, { signal: AbortSignal.timeout(timeoutMs) });
}

async function waitForHealth(port, child, deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (child.exitCode != null) throw new Error(`server exited early: ${child.exitCode}`);
    try {
      const r = await httpGet(port, '/api/health', 1000);
      if (r.ok) return;
    } catch (_) {}
    await sleep(100);
  }
  throw new Error('server did not become healthy in time');
}

async function testRealServerHealthUnderSlowSqlite() {
  const port = 18000 + Math.floor(Math.random() * 10000);
  const serverArtifacts = path.join(tmpRoot, 'server-artifacts');
  fs.mkdirSync(serverArtifacts, { recursive: true });
  const env = Object.assign({}, process.env, {
    PORT: String(port),
    CONSOLE_ARTIFACTS_DIR: serverArtifacts,
    QUEUE_WORKER_DISABLED: '1',
    BACKGROUND_STARTUP_DELAY_MS: '600000', // 测试期间不启动后台调度器
    NEW_API_DB: fakeDb,
    NEW_API_SQLITE_CACHE_MS: '0', // 关缓存,强制每次真的 spawn 慢 sqlite
    PATH: `${fakeBinDir}:${process.env.PATH || ''}`, // 假 sqlite3(sleep 2s)优先命中
  });
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'projects/控制台/server.js')], {
    cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', d => { serverLog += d; });
  child.stderr.on('data', d => { serverLog += d; });
  try {
    await waitForHealth(port, child, 10000);

    // 触发多路慢 sqlite(usage=5 条查询,overview 也走 db fallback),不等待完成
    const usagePromise = httpGet(port, '/api/newapi/usage?days=7', 15000);
    const overviewPromise = httpGet(port, '/api/llm-usage/overview?days=7', 15000).catch(() => null);
    await sleep(150); // 确保慢 sqlite 子进程已经 spawn 并在 sleep 中

    // 关键断言:慢 sqlite 在途时 /api/health 必须 <500ms(watchdog 阈值 2.5s)
    const t0 = Date.now();
    const health = await httpGet(port, '/api/health', 5000);
    const healthMs = Date.now() - t0;
    assert(health.ok, '/api/health 必须 200');
    const healthBody = await health.json();
    assert.strictEqual(healthBody.ok, true);
    assert(healthMs < 500, `慢 sqlite 在途时 /api/health 用了 ${healthMs}ms(要求 <500ms)`);

    // 慢查询最终也要正常返回(JSON 形状不变:ok/source/usage)
    const usage = await usagePromise;
    const usageBody = await usage.json();
    assert.strictEqual(usageBody.ok, true, `usage 响应异常: ${JSON.stringify(usageBody).slice(0, 200)}`);
    assert.strictEqual(usageBody.source, 'local-db');
    assert(usageBody.usage && Array.isArray(usageBody.usage.byModel), 'usage.byModel 形状不变');
    await overviewPromise;
    console.log(`  [ok] 真实 server:慢 sqlite 在途 /api/health ${healthMs}ms (<500ms)`);
  } catch (e) {
    e.message += `\n---- server log ----\n${serverLog.slice(-2000)}`;
    throw e;
  } finally {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
}

async function main() {
  try {
    await testTtlCache();
    await testSqliteAsyncNonBlocking();
    await testJsonlTailCursor();
    await testServerTaskBoardEvents();
    await testDirectorySignatureParity();
    await testRealServerHealthUnderSlowSqlite();
    console.log(JSON.stringify({ pass: true, suite: 'server-async-unblock' }));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
