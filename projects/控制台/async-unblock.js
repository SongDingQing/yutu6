#!/usr/bin/env node
/*
 * B-1 去同步阻塞辅助模块(老板拍板:稳定性最高优先)。
 *
 * 背景:server.js 单进程同时承担 HTTP + worker 监督 + 调度器,事件循环上任何
 * >50ms 的同步重操作都会让 /api/health 超时(watchdog 2.5s 超时 → 整机重启;
 * 357 条重启记录中 202 条源于此)。本模块提供三类异步化/缓存原语:
 *
 *  1) sqliteJsonAsync + createTtlCache
 *     sqlite3 子进程查询从 spawnSync(单次最长阻塞 2.5s)改为异步 spawn,
 *     配 TTL 内存缓存(用量数据不需要每请求实时),并发同 key 共享同一 Promise。
 *  2) createJsonlTailCursor
 *     JSONL 事件文件按 byte offset 增量读取缓存:请求只消费缓存 + 新增字节,
 *     不再每次同步读整个尾部窗口并全量 JSON.parse。
 *  3) directorySignature / directorySignatureAsync
 *     目录内容签名(SHA256)。async 版逐文件 await fs.promises,让出事件循环,
 *     供定时器使用;sync 版保留给直接调用方(行为兼容)。两版输出必须一致,
 *     由 tests/server-async-unblock.test.js 回归保障。
 *
 * 零外部依赖,仅 Node 内建模块。
 */
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// ---------------------------------------------------------------------------
// 1) 异步 sqlite3 查询 + TTL 缓存
// ---------------------------------------------------------------------------

/**
 * 异步执行 `sqlite3 -json <db> <sql>`,返回 Promise<rows>。
 * 与旧 spawnSync 版语义对齐:超时/非零退出码 reject,空输出 resolve([])。
 * 关键差异:等待期间事件循环完全空闲,HTTP handler 不再被卡死。
 */
function sqliteJsonAsync(dbPath, sql, opts = {}) {
  const bin = opts.bin || 'sqlite3';
  const timeoutMs = Math.max(100, Number(opts.timeoutMs || 2500) || 2500);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, ['-json', dbPath, sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(e);
    }
    // 用 Buffer 收集再统一解码:避免多字节 UTF-8 字符跨 chunk 边界被截断
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`sqlite3 timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
    child.stdout.on('data', d => { stdoutChunks.push(d); });
    child.stderr.on('data', d => { stderrChunks.push(d); });
    child.on('error', e => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return reject(new Error((Buffer.concat(stderrChunks).toString('utf8') || 'sqlite3 failed').trim()));
      const text = Buffer.concat(stdoutChunks).toString('utf8').trim();
      if (!text) return resolve([]);
      try { resolve(JSON.parse(text)); }
      catch (e) { reject(new Error(`sqlite3 output parse failed: ${e.message}`)); }
    });
  });
}

/**
 * TTL 内存缓存(Promise 级):
 * - TTL 内同 key 直接复用同一 Promise(并发去重,首个请求在途时后续请求共享);
 * - producer reject 时立刻清掉该项,失败不缓存;
 * - ttlMs <= 0 时旁路缓存(每次都跑 producer)。
 */
function createTtlCache() {
  const entries = new Map();
  return {
    get(key, ttlMs, producer) {
      const ttl = Number(ttlMs) || 0;
      if (ttl <= 0) return Promise.resolve().then(producer);
      const cur = entries.get(key);
      const now = Date.now();
      if (cur && now - cur.at < ttl) return cur.promise;
      const promise = Promise.resolve().then(producer);
      const entry = { at: now, promise };
      entries.set(key, entry);
      promise.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return promise;
    },
    clear() { entries.clear(); },
    size() { return entries.size; },
  };
}

// ---------------------------------------------------------------------------
// 2) JSONL 尾部增量游标缓存
// ---------------------------------------------------------------------------

function readFileRangeUtf8(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, length));
    const read = fs.readSync(fd, buf, 0, buf.length, start);
    return buf.slice(0, read).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * JSONL 尾部增量游标:
 * - 首次(或文件轮转/截断/单次增量过大)时,读尾部 tailBytes 窗口全量重建,
 *   语义与旧的"每请求读 768KB 尾部"一致,但之后只在必要时发生;
 * - 常态请求:stat 一次;文件未变 → 直接返回缓存;文件增长 → 只读新增字节,
 *   解析新行追加进缓存(残缺尾行留待下次拼接);
 * - 缓存最多保留 maxItems 条已接受事件,read(n) 返回末尾 n 条的浅拷贝数组。
 *
 * acceptLine(line) 返回 false 的行被跳过(如 node.output 大行),
 * 与旧 readTaskBoardEvents 的过滤逻辑保持一致由调用方传入。
 */
function createJsonlTailCursor(config) {
  const file = config.file;
  const maxItems = Math.max(1, Number(config.maxItems) || 1200);
  const tailBytes = Math.max(64 * 1024, Number(config.tailBytes) || 768 * 1024);
  const maxIncrementBytes = Math.max(tailBytes, Number(config.maxIncrementBytes) || 4 * 1024 * 1024);
  const acceptLine = typeof config.acceptLine === 'function' ? config.acceptLine : () => true;
  const parseLine = typeof config.parseLine === 'function' ? config.parseLine : (line => JSON.parse(line));

  let state = null; // { ino, offset, remainder, events, rebuilds, increments }
  let rebuilds = 0;
  let increments = 0;

  function tryParse(line) {
    if (!line || !line.trim()) return null;
    if (!acceptLine(line)) return null;
    try { return parseLine(line); } catch (_) { return null; }
  }

  function rebuild(st) {
    rebuilds++;
    const bytes = Math.min(st.size, tailBytes);
    const start = st.size - bytes;
    const text = readFileRangeUtf8(file, start, bytes);
    const lines = text.split(/\r?\n/);
    if (start > 0) lines.shift(); // 窗口起点大概率落在半行中间,丢弃首个残行
    let remainder = '';
    if (!/\r?\n$/.test(text) && lines.length) {
      // 尾部无换行:写入方可能正写到一半。若还不是合法 JSON,留作 remainder
      // 等后续字节拼接(旧全量读会直接丢弃并在下次读补上;增量游标必须自己留住)。
      const last = lines[lines.length - 1];
      let parsedOk = false;
      try { JSON.parse(last); parsedOk = true; } catch (_) {}
      if (!parsedOk) { lines.pop(); remainder = last; }
    }
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < maxItems; i--) {
      const ev = tryParse(lines[i]);
      if (ev != null) out.push(ev);
    }
    out.reverse();
    state = { ino: st.ino, offset: st.size, remainder, events: out };
    return out;
  }

  function appendIncrement(st) {
    increments++;
    const text = state.remainder + readFileRangeUtf8(file, state.offset, st.size - state.offset);
    state.offset = st.size;
    const lines = text.split(/\r?\n/);
    // 末尾若不是完整行(写入方正在追加),留作 remainder 下次拼接
    state.remainder = /\r?\n$/.test(text) ? '' : (lines.pop() || '');
    for (const line of lines) {
      const ev = tryParse(line);
      if (ev != null) state.events.push(ev);
    }
    if (state.events.length > maxItems) state.events = state.events.slice(-maxItems);
  }

  return {
    read(n) {
      const want = Math.max(1, Math.min(Number(n) || maxItems, maxItems));
      let st;
      try { st = fs.statSync(file); } catch (_) { state = null; return []; }
      if (!st.size) { state = null; return []; }
      try {
        const rotated = !state || state.ino !== st.ino || st.size < state.offset;
        const tooBig = state && (st.size - state.offset) > maxIncrementBytes;
        if (rotated || tooBig) rebuild(st);
        else if (st.size > state.offset) appendIncrement(st);
        return state.events.slice(-want);
      } catch (_) {
        // 读失败(文件正被轮转等):废弃缓存,与旧实现一样返回空,下次请求重建
        state = null;
        return [];
      }
    },
    reset() { state = null; },
    stats() {
      return {
        rebuilds,
        increments,
        cachedEvents: state ? state.events.length : 0,
        offset: state ? state.offset : 0,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 3) 目录内容签名(sync / async 双实现,输出必须一致)
// ---------------------------------------------------------------------------

function hashFileItem(relKey, size, mtimeMs, content) {
  const h = crypto.createHash('sha256');
  h.update(relKey);
  h.update('\0');
  h.update(String(size));
  h.update('\0');
  h.update(String(Math.floor(mtimeMs)));
  if (content != null) {
    h.update('\0');
    h.update(content);
  }
  return h.digest('hex');
}

function combineSignature(items, algorithm) {
  const h = crypto.createHash('sha256');
  for (const item of items) {
    h.update(item.path);
    h.update('\0');
    h.update(item.sha256);
    h.update('\0');
  }
  return {
    algorithm,
    value: h.digest('hex'),
    fileCount: items.length,
    sample: items.slice(0, 12),
  };
}

function defaultAcceptEntry(name) {
  return /\.(html|css|js|json|png|jpe?g|webp|gif|svg)$/i.test(name);
}

function walkFilesSync(dir, accept, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFilesSync(file, accept, out);
    else if (accept(entry.name)) out.push(file);
  }
  return out;
}

async function walkFilesAsync(dir, accept, out = []) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFilesAsync(file, accept, out);
    else if (accept(entry.name)) out.push(file);
  }
  return out;
}

function relKey(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/**
 * 同步版目录签名(与 server.js 原 computePageReviewSignature 行为逐字节一致)。
 * 仅供直接调用方(测试/手动触发)兼容使用;定时器一律走 async 版。
 */
function directorySignature(opts) {
  const { dir, hashRelRoot, itemRelRoot } = opts;
  const accept = opts.accept || defaultAcceptEntry;
  const algorithm = opts.algorithm || 'sha256-public-page-assets-v1';
  const maxContentBytes = Number(opts.maxContentBytes) || 2 * 1024 * 1024;
  const files = walkFilesSync(dir, accept).sort((a, b) => a.localeCompare(b));
  const items = [];
  for (const file of files) {
    let digest;
    try {
      const st = fs.statSync(file);
      const content = st.size <= maxContentBytes ? fs.readFileSync(file) : null;
      digest = hashFileItem(relKey(hashRelRoot, file), st.size, st.mtimeMs, content);
    } catch (_) { continue; }
    items.push({ path: relKey(itemRelRoot, file), sha256: digest });
  }
  return combineSignature(items, algorithm);
}

/**
 * 异步版目录签名:逐文件 await fs.promises(stat/readFile 在线程池执行),
 * 每个文件之间让出事件循环。同参数下输出与 directorySignature 完全一致。
 */
async function directorySignatureAsync(opts) {
  const { dir, hashRelRoot, itemRelRoot } = opts;
  const accept = opts.accept || defaultAcceptEntry;
  const algorithm = opts.algorithm || 'sha256-public-page-assets-v1';
  const maxContentBytes = Number(opts.maxContentBytes) || 2 * 1024 * 1024;
  const files = (await walkFilesAsync(dir, accept)).sort((a, b) => a.localeCompare(b));
  const items = [];
  for (const file of files) {
    let digest;
    try {
      const st = await fsp.stat(file);
      const content = st.size <= maxContentBytes ? await fsp.readFile(file) : null;
      digest = hashFileItem(relKey(hashRelRoot, file), st.size, st.mtimeMs, content);
    } catch (_) { continue; }
    items.push({ path: relKey(itemRelRoot, file), sha256: digest });
  }
  return combineSignature(items, algorithm);
}

module.exports = {
  sqliteJsonAsync,
  createTtlCache,
  createJsonlTailCursor,
  directorySignature,
  directorySignatureAsync,
  _test: { hashFileItem, combineSignature, walkFilesSync, walkFilesAsync },
};
