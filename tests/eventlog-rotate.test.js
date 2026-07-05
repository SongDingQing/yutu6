'use strict';

// 守卫:eventlog 按大小轮转(止住无限增长)、保留 N 份归档、since 对坏行容错。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventlog-rot-'));
  const file = path.join(dir, 'engine-events.jsonl');
  const prevMax = process.env.EVENTLOG_MAX_BYTES;
  const prevKeep = process.env.EVENTLOG_KEEP_ARCHIVES;
  process.env.EVENTLOG_MAX_BYTES = '2000';
  process.env.EVENTLOG_KEEP_ARCHIVES = '2';
  try {
    const EventLog = require('../shared/engine/eventlog');
    const log = new EventLog(file);
    for (let i = 0; i < 300; i++) log.emit('test', { i, pad: 'x'.repeat(60) });

    const archives = fs.readdirSync(dir).filter(f => f !== 'engine-events.jsonl' && /^engine-events\.[0-9-]+\.jsonl$/.test(f));
    assert(archives.length >= 1, '超过阈值应产生归档文件');
    assert(archives.length <= 2, `归档保留数应 ≤ keepArchives(2),实际 ${archives.length}`);
    assert(fs.statSync(file).size < 2000 + 200, `当前文件应被轮转、不无限涨(实际 ${fs.statSync(file).size}B)`);

    // since 坏行容错:写一条坏 JSON,不应抛
    fs.appendFileSync(file, '{bad json line\n');
    const evs = log.since(0);
    assert(Array.isArray(evs), 'since 不应因坏行抛错');

    console.log(JSON.stringify({ pass: true, suite: 'eventlog-rotate' }));
  } finally {
    if (prevMax === undefined) delete process.env.EVENTLOG_MAX_BYTES; else process.env.EVENTLOG_MAX_BYTES = prevMax;
    if (prevKeep === undefined) delete process.env.EVENTLOG_KEEP_ARCHIVES; else process.env.EVENTLOG_KEEP_ARCHIVES = prevKeep;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
