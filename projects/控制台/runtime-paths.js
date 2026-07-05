'use strict';

const fs = require('fs');

const DEFAULT_NODE_BIN = '/Users/yutu6/.local/node-v24.16.0-darwin-arm64/bin/node';
const DEFAULT_PEEKABOO_BIN = '/Users/yutu6/.local/node-v24.16.0-darwin-arm64/bin/peekaboo';

function existing(candidates) {
  for (const file of candidates) {
    if (!file) continue;
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch (_) {}
  }
  return '';
}

function nodeBin() {
  return existing([
    process.env.YUTU6_NODE_BIN,
    process.env.CONSOLE_NODE_BIN,
    DEFAULT_NODE_BIN,
    '/Users/yutu6/.local/bin/node',
    process.execPath,
  ]) || process.execPath;
}

function peekabooBin() {
  return existing([
    process.env.YUTU6_PEEKABOO_BIN,
    process.env.CONSOLE_PEEKABOO_BIN,
    process.env.CONSOLE_PEEKABOO_IMAGE_BIN,
    DEFAULT_PEEKABOO_BIN,
    '/Users/yutu6/.local/bin/peekaboo',
  ]) || 'peekaboo';
}

function applyRuntimeEnv(env) {
  const out = Object.assign({}, env || process.env);
  out.YUTU6_NODE_BIN = out.YUTU6_NODE_BIN || nodeBin();
  out.CONSOLE_NODE_BIN = out.CONSOLE_NODE_BIN || out.YUTU6_NODE_BIN;
  out.YUTU6_PEEKABOO_BIN = out.YUTU6_PEEKABOO_BIN || peekabooBin();
  out.CONSOLE_PEEKABOO_BIN = out.CONSOLE_PEEKABOO_BIN || out.YUTU6_PEEKABOO_BIN;
  out.CONSOLE_PEEKABOO_IMAGE_BIN = out.CONSOLE_PEEKABOO_IMAGE_BIN || out.YUTU6_PEEKABOO_BIN;
  return out;
}

module.exports = {
  DEFAULT_NODE_BIN,
  DEFAULT_PEEKABOO_BIN,
  nodeBin,
  peekabooBin,
  applyRuntimeEnv,
};
