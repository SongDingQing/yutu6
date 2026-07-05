#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function fakeFeishuScript() {
  return `#!/usr/bin/env bash
set -euo pipefail
title=""
body=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) title="$2"; shift 2 ;;
    --body) body="$2"; shift 2 ;;
    --image) shift 2 ;;
    --button-label) shift 2 ;;
    --button-url) shift 2 ;;
    *) shift ;;
  esac
done
python3 - "$FAKE_FEISHU_LOG" "$title" "$body" <<'PY'
import json
import sys
with open(sys.argv[1], "a", encoding="utf-8") as f:
    print(json.dumps({"title": sys.argv[2], "body": sys.argv[3]}, ensure_ascii=False), file=f)
PY
echo ok
`;
}

function readCalls(file) {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-rate-test-'));
try {
  const fakeLog = path.join(root, 'fake-feishu.jsonl');
  const fakeNotify = path.join(root, 'shared', 'agents', 'ui-optimizer', 'notify-feishu.sh');
  fs.mkdirSync(path.dirname(fakeNotify), { recursive: true });
  fs.writeFileSync(fakeNotify, fakeFeishuScript());
  fs.chmodSync(fakeNotify, 0o755);

  process.env.CONSOLE_WORKDIR = root;
  process.env.CONSOLE_ARTIFACTS_DIR = path.join(root, 'artifacts');
  process.env.CONSOLE_EVENTS_FILE = path.join(root, 'artifacts', 'engine-events.jsonl');
  process.env.FEISHU_NOTIFY_RATE_WINDOW_MS = String(60 * 1000);
  process.env.FEISHU_NOTIFY_RATE_MAX = '2';
  process.env.FEISHU_NOTIFY_PENDING_LIMIT = '10';
  process.env.FAKE_FEISHU_LOG = fakeLog;

  const Tools = require('../projects/控制台/secretary-tools');
  const first = Tools.notify({ title: '【自动:】任务A', body: '第一条', source: 'test', log: false });
  const second = Tools.notify({ title: '任务B', body: '第二条', source: 'test', log: false });
  const third = Tools.notify({ title: '任务C', body: '第三条', source: 'test', log: false });
  assert.strictEqual(first.sent, true);
  assert.strictEqual(second.sent, true);
  assert.strictEqual(third.skipped, true);
  assert.strictEqual(third.reason, 'rate-limited');
  let calls = readCalls(fakeLog);
  assert.strictEqual(calls.length, 2, 'only first two messages should pass in the rate window');
  assert.strictEqual(calls[0].title, '任务A', 'automatic prefix must be stripped');

  const stateFile = path.join(root, 'artifacts', 'owner-auto-notify-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.feishuRate.windowStartMs = Date.now() - 120 * 1000;
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');

  const fourth = Tools.notify({ title: '任务D', body: '第四条', source: 'test', log: false });
  assert.strictEqual(fourth.sent, true);
  assert.strictEqual(fourth.rateSummary, true);
  calls = readCalls(fakeLog);
  assert.strictEqual(calls.length, 3, 'next window should send one merged summary');
  assert.strictEqual(calls[2].title, '飞书通知合并摘要');
  assert(calls[2].body.includes('合并条数: 2'), calls[2].body);
  assert(calls[2].body.includes('任务C'));
  assert(calls[2].body.includes('任务D'));

  console.log(JSON.stringify({ pass: true, suite: 'feishu-notify-rate' }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
