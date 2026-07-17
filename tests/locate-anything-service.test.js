#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { PassThrough } = require('stream');

const envKeys = [
  'LOCATE_ANYTHING_ACCEPT_LICENSE',
  'LOCATE_ANYTHING_BACKEND_ARGS',
  'LOCATE_ANYTHING_BACKEND_CMD',
  'LOCATE_ANYTHING_ENV',
  'LOCATE_ANYTHING_MODEL',
  'LOCATE_ANYTHING_MODEL_DIR',
  'LOCATE_ANYTHING_PRODUCTION',
  'LOCATE_ANYTHING_TIMEOUT_MS',
];

const savedEnv = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));

function restoreEnv() {
  for (const key of envKeys) {
    if (savedEnv[key] == null) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}

function clearEnv() {
  for (const key of envKeys) delete process.env[key];
}

function requestHandler(handler, { method, url, body }) {
  return new Promise(resolve => {
    const req = new PassThrough();
    req.method = method;
    req.url = url;
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(code, headers) {
        this.statusCode = code;
        this.headers = headers || {};
        return this;
      },
      end(data) {
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: data ? JSON.parse(String(data)) : null,
        });
      },
    };
    handler(req, res);
    if (body != null) req.end(JSON.stringify(body));
    else req.end();
  });
}

async function main() {
  try {
    clearEnv();
    const LocateAnything = require('../projects/控制台/locate-anything-service');

    const parsed = LocateAnything.parseLocateAnythingAnswer(
      '<ref>search</ref><box><100><200><300><400></box><box><500><600></box><box>none</box>',
      1440,
      900
    );
    assert.strictEqual(parsed.boxes.length, 1);
    assert.strictEqual(parsed.points.length, 1);
    assert.strictEqual(Math.round(parsed.boxes[0].pixel.x2), 432);
    assert.strictEqual(Math.round(parsed.points[0].pixel.y), 540);
    assert.strictEqual(parsed.no_object, true);

    let result = await LocateAnything.locate({
      image_path: '/tmp/peekaboo.png',
      query: 'search button',
      image_width: 1440,
      image_height: 900,
    });
    assert.strictEqual(result.status, 451);
    assert.strictEqual(result.body.ok, false);
    assert.match(result.body.error, /license/i);

    process.env.LOCATE_ANYTHING_PRODUCTION = '1';
    result = await LocateAnything.locate({
      image_path: '/tmp/peekaboo.png',
      query: 'search button',
    });
    assert.strictEqual(result.status, 403);
    assert.match(result.body.error, /production/i);

    delete process.env.LOCATE_ANYTHING_PRODUCTION;
    process.env.LOCATE_ANYTHING_ACCEPT_LICENSE = LocateAnything.ACCEPT_TOKEN;
    result = await LocateAnything.locate({
      image_path: '/tmp/peekaboo.png',
      query: 'search button',
    });
    assert.strictEqual(result.status, 503);
    assert.match(result.body.error, /backend command/i);

    clearEnv();
    const server = require('../projects/控制台/server');
    const health = await requestHandler(server.handler, {
      method: 'GET',
      url: '/api/vision/locate/health',
    });
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.body.ok, true);
    assert.strictEqual(health.body.state.service, 'locate-anything-3b');

    const apiLocate = await requestHandler(server.handler, {
      method: 'POST',
      url: '/api/vision/locate',
      body: {
        image_path: '/tmp/peekaboo.png',
        query: 'search button',
      },
    });
    assert.strictEqual(apiLocate.status, 451);
    assert.match(apiLocate.body.error, /license/i);

    console.log(JSON.stringify({ pass: true, suite: 'locate-anything-service' }));
  } finally {
    restoreEnv();
  }
}

main().catch(err => {
  restoreEnv();
  console.error(err && err.stack || err);
  process.exit(1);
});
