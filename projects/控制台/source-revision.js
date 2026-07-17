'use strict';

// P0-B(热重载):计算一组目录下顶层 *.js 的修订指纹(mtime+size 哈希)。
// 常驻 worker 启动时记一份,运行中持续复算;指纹变了 = 磁盘代码已更新、当前进程跑的是缓存旧码,
// 应立即停止 claim、等待在途归零后优雅退出,让 server 用新代码重启(治"补丁落盘≠运行态生效")。
// 只看顶层 .js、不递归 artifacts/,避免运行时产物噪声。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function computeSourceRevision(dirs) {
  const h = crypto.createHash('sha256');
  for (const dir of dirs || []) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
    } catch (_) {
      continue; // 目录不存在 → 跳过,不抛
    }
    for (const name of names) {
      try {
        const st = fs.statSync(path.join(dir, name));
        h.update(`${path.basename(dir)}/${name}:${Math.round(st.mtimeMs)}:${st.size}\n`);
      } catch (_) {}
    }
  }
  return h.digest('hex');
}

// 控制台 worker 的核心代码目录:shared/engine + 控制台顶层
function defaultReloadDirs(consoleDir) {
  return [
    path.join(consoleDir, '..', '..', 'shared', 'engine'),
    consoleDir,
  ];
}

function codeReloadDecision({ bootRevision, currentRevision, pending = false, activeCount = 0 } = {}) {
  const changed = !!bootRevision && !!currentRevision && currentRevision !== bootRevision;
  const reloadPending = pending === true || changed;
  return {
    changed,
    newlyPending: pending !== true && changed,
    pending: reloadPending,
    allowClaim: !reloadPending,
    shouldExit: reloadPending && Number(activeCount || 0) === 0,
    shouldDrain: reloadPending && Number(activeCount || 0) > 0,
  };
}

module.exports = { computeSourceRevision, defaultReloadDirs, codeReloadDecision };
