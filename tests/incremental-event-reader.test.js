'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { IncrementalEventReader } = require('../shared/engine/incremental-event-reader');

function line(event) {
  return `${JSON.stringify(event)}\n`;
}

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-reader-'));
  const file = path.join(dir, 'events.jsonl');
  try {
    const initial = [];
    for (let seq = 1; seq <= 5000; seq++) initial.push(line({ seq, type: 'noise' }));
    initial.push(line({ seq: 5001, type: 'queue.completed', queueId: 'first' }));
    fs.writeFileSync(file, initial.join(''));

    const reader = new IncrementalEventReader(file, {
      include: event => event.type === 'queue.completed',
      retain: 100,
      chunkBytes: 4096,
    });
    assert.strictEqual(reader.currentSeq(), 5001);
    assert.deepStrictEqual(reader.matching(() => true).map(event => event.queueId), ['first']);
    const initialBytes = reader.snapshot().metrics.bytesRead;
    assert.strictEqual(initialBytes, fs.statSync(file).size, 'initial load should read the file once');

    const appended = line({ seq: 5002, type: 'noise' })
      + line({ seq: 5003, type: 'queue.completed', queueId: 'second' });
    fs.appendFileSync(file, appended);
    const delta = reader.since(5001);
    assert.deepStrictEqual(delta.events.map(event => event.queueId), ['second']);
    assert.strictEqual(reader.snapshot().metrics.bytesRead, initialBytes + Buffer.byteLength(appended),
      'subsequent reads must consume only appended bytes');

    const unchangedBytes = reader.snapshot().metrics.bytesRead;
    reader.since(5003);
    assert.strictEqual(reader.snapshot().metrics.bytesRead, unchangedBytes,
      'an unchanged event file must not be reparsed');

    const partial = JSON.stringify({ seq: 5004, type: 'queue.completed', queueId: '分片' });
    const cut = Math.floor(Buffer.byteLength(partial) / 2);
    const partialBuffer = Buffer.from(partial);
    fs.appendFileSync(file, partialBuffer.subarray(0, cut));
    assert.deepStrictEqual(reader.since(5003).events, [], 'partial JSONL records must wait for completion');
    fs.appendFileSync(file, Buffer.concat([partialBuffer.subarray(cut), Buffer.from('\n')]));
    assert.deepStrictEqual(reader.since(5003).events.map(event => event.queueId), ['分片']);

    fs.renameSync(file, `${file}.old`);
    fs.writeFileSync(file, line({ seq: 6000, type: 'queue.completed', queueId: 'rotated' }));
    const rotated = reader.since(5004);
    assert.deepStrictEqual(rotated.events.map(event => event.queueId), ['rotated']);
    assert(reader.snapshot().metrics.resets >= 2, 'rotation should reset the byte cursor safely');

    console.log(JSON.stringify({ pass: true, suite: 'incremental-event-reader' }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
