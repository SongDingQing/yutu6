#!/usr/bin/env node
'use strict';

/*
 * Local LocateAnything-3B service wrapper.
 *
 * This file intentionally does not download model weights and refuses to run
 * inference unless the NVIDIA non-commercial license gate is explicitly set.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SERVICE = 'locate-anything-3b';
const MODEL_ID = 'nvidia/LocateAnything-3B';
const ACCEPT_TOKEN = 'noncommercial-research-evaluation';
const DEFAULT_PORT = 41219;

function boolEnv(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || ''));
}

function envText(name) {
  return String(process.env[name] || '').trim();
}

function parseJsonArrayEnv(name) {
  const raw = envText(name);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_) {
    return raw.split(/\s+/).filter(Boolean);
  }
}

function redact(text) {
  return String(text || '')
    .replace(/(hf_[A-Za-z0-9_-]{8,})/g, '[REDACTED_HF_TOKEN]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
}

function clipped01k(v) {
  const n = Math.max(0, Math.min(1000, Number(v)));
  return Number.isFinite(n) ? n : 0;
}

function toPixel(n, size) {
  const s = Number(size);
  if (!Number.isFinite(s) || s <= 0) return null;
  return clipped01k(n) / 1000 * s;
}

function parseLocateAnythingAnswer(answer, imageWidth, imageHeight) {
  const text = String(answer || '');
  const boxes = [];
  const points = [];
  const tokenRe = /(?:<ref>(.*?)<\/ref>\s*)?<box>((?:<\d+>){2,4})<\/box>/g;
  let match;
  while ((match = tokenRe.exec(text))) {
    const label = match[1] ? match[1].trim() : null;
    const nums = [...String(match[2]).matchAll(/<(\d+)>/g)].map(m => clipped01k(m[1]));
    if (nums.length === 4) {
      const [x1, y1, x2, y2] = nums;
      const item = {
        label,
        normalized: { x1: x1 / 1000, y1: y1 / 1000, x2: x2 / 1000, y2: y2 / 1000 },
        raw_1000: { x1, y1, x2, y2 },
      };
      const px = {
        x1: toPixel(x1, imageWidth),
        y1: toPixel(y1, imageHeight),
        x2: toPixel(x2, imageWidth),
        y2: toPixel(y2, imageHeight),
      };
      if (Object.values(px).every(v => v != null)) item.pixel = px;
      boxes.push(item);
    } else if (nums.length === 2) {
      const [x, y] = nums;
      const item = {
        label,
        normalized: { x: x / 1000, y: y / 1000 },
        raw_1000: { x, y },
      };
      const px = { x: toPixel(x, imageWidth), y: toPixel(y, imageHeight) };
      if (px.x != null && px.y != null) item.pixel = px;
      points.push(item);
    }
  }
  return {
    no_object: /<box>\s*none\s*<\/box>/i.test(text),
    boxes,
    points,
  };
}

function serviceState() {
  const modelDir = envText('LOCATE_ANYTHING_MODEL_DIR');
  const model = envText('LOCATE_ANYTHING_MODEL') || modelDir || MODEL_ID;
  const backendCmd = envText('LOCATE_ANYTHING_BACKEND_CMD');
  const backendArgs = parseJsonArrayEnv('LOCATE_ANYTHING_BACKEND_ARGS');
  const accepted = envText('LOCATE_ANYTHING_ACCEPT_LICENSE') === ACCEPT_TOKEN;
  const production = boolEnv('LOCATE_ANYTHING_PRODUCTION') || /^production$/i.test(envText('LOCATE_ANYTHING_ENV'));
  return {
    service: SERVICE,
    model,
    model_dir: modelDir || null,
    model_dir_exists: modelDir ? fs.existsSync(modelDir) : null,
    license: {
      accepted,
      required_value: ACCEPT_TOKEN,
      scope: 'non-commercial research/evaluation only',
    },
    production: {
      requested: production,
      allowed: false,
    },
    backend: {
      configured: !!backendCmd,
      cmd: backendCmd || null,
      args_count: backendArgs.length,
      timeout_ms: Math.max(1000, parseInt(envText('LOCATE_ANYTHING_TIMEOUT_MS') || '120000', 10) || 120000),
    },
    endpoints: {
      health: '/api/vision/locate/health',
      locate: '/api/vision/locate',
      standalone_health: '/health',
      standalone_locate: '/v1/locate',
    },
  };
}

function guard(state) {
  if (state.production.requested) {
    return {
      status: 403,
      error: 'LocateAnything-3B is blocked for production by local policy',
      action_required: 'Remove production mode and obtain explicit owner/legal approval before any production use.',
    };
  }
  if (!state.license.accepted) {
    return {
      status: 451,
      error: 'NVIDIA non-commercial license gate has not been accepted',
      action_required: `Set LOCATE_ANYTHING_ACCEPT_LICENSE=${ACCEPT_TOKEN} only for local non-commercial research/evaluation.`,
    };
  }
  if (state.model_dir && state.model_dir_exists === false) {
    return {
      status: 503,
      error: 'Configured LocateAnything model directory does not exist',
      action_required: 'Download/prepare the model after manual authorization, then set LOCATE_ANYTHING_MODEL_DIR.',
    };
  }
  if (!state.backend.configured) {
    return {
      status: 503,
      error: 'LocateAnything backend command is not configured',
      action_required: 'Set LOCATE_ANYTHING_BACKEND_CMD and LOCATE_ANYTHING_BACKEND_ARGS after installing the model runtime.',
    };
  }
  return null;
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be a JSON object';
  const query = String(body.query || body.text || '').trim();
  if (!query) return 'query is required';
  if (!body.image_path && !body.image_base64) return 'image_path or image_base64 is required';
  if (body.image_path && /:\/\//.test(String(body.image_path))) return 'image_path must be a local path, not a remote URL';
  return null;
}

function backendPayload(body, state) {
  return {
    task: String(body.task || 'ground_gui'),
    query: String(body.query || body.text || ''),
    output_type: String(body.output_type || 'point'),
    image_path: body.image_path || null,
    image_base64: body.image_base64 || null,
    image_width: body.image_width || body.imageWidth || null,
    image_height: body.image_height || body.imageHeight || null,
    model: state.model,
    model_dir: state.model_dir,
  };
}

function runBackend(payload, state) {
  return new Promise((resolve, reject) => {
    const args = parseJsonArrayEnv('LOCATE_ANYTHING_BACKEND_ARGS');
    const started = Date.now();
    let child;
    try {
      child = spawn(state.backend.cmd, args, {
        cwd: process.cwd(),
        env: Object.assign({}, process.env, {
          LOCATE_ANYTHING_MODEL: state.model,
          LOCATE_ANYTHING_MODEL_DIR: state.model_dir || '',
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      reject(e);
      return;
    }

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (_) {}
      reject(new Error(`backend timed out after ${state.backend.timeout_ms}ms`));
    }, state.backend.timeout_ms);
    if (timer.unref) timer.unref();

    child.stdout.on('data', d => { stdout += d.toString(); if (stdout.length > 5e6) child.kill('SIGTERM'); });
    child.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 1e6) child.kill('SIGTERM'); });
    child.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`backend exited ${code}: ${redact(stderr || stdout).slice(0, 4000)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout || '{}');
        parsed.duration_ms = Date.now() - started;
        resolve(parsed);
      } catch (e) {
        reject(new Error(`backend returned non-JSON output: ${redact(stdout).slice(0, 1000)}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function locate(body) {
  const state = serviceState();
  const blocked = guard(state);
  if (blocked) {
    return {
      status: blocked.status,
      body: { ok: false, service: SERVICE, ...blocked, state },
    };
  }

  const invalid = validateRequest(body);
  if (invalid) return { status: 400, body: { ok: false, service: SERVICE, error: invalid } };

  const payload = backendPayload(body, state);
  try {
    const raw = await runBackend(payload, state);
    const answer = raw.answer || raw.raw_answer || (raw.result && raw.result.answer) || '';
    const parsed = answer
      ? parseLocateAnythingAnswer(answer, payload.image_width, payload.image_height)
      : { no_object: false, boxes: raw.boxes || [], points: raw.points || [] };
    return {
      status: 200,
      body: {
        ok: true,
        service: SERVICE,
        model: state.model,
        task: payload.task,
        query: payload.query,
        boxes: raw.boxes || parsed.boxes,
        points: raw.points || parsed.points,
        no_object: raw.no_object != null ? !!raw.no_object : parsed.no_object,
        raw_answer: answer || null,
        backend_duration_ms: raw.duration_ms,
        license_scope: state.license.scope,
      },
    };
  } catch (e) {
    return {
      status: 502,
      body: { ok: false, service: SERVICE, error: redact(e.message), state },
    };
  }
}

function readJson(req, cb) {
  let data = '';
  req.on('data', c => { data += c; if (data.length > 1e7) req.destroy(); });
  req.on('end', () => {
    try { cb(null, JSON.parse(data || '{}')); }
    catch (e) { cb(e); }
  });
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

function handler(req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && u.pathname === '/health') return sendJson(res, 200, { ok: true, state: serviceState() });
  if (req.method === 'POST' && u.pathname === '/v1/locate') {
    return readJson(req, async (err, body) => {
      if (err) return sendJson(res, 400, { ok: false, error: 'bad JSON' });
      const result = await locate(body);
      sendJson(res, result.status, result.body);
    });
  }
  res.writeHead(404).end('not found');
}

function selfTest() {
  const sample = '<ref>search button</ref><box><100><200><300><400></box><box><500><600></box>';
  const parsed = parseLocateAnythingAnswer(sample, 1440, 900);
  if (parsed.boxes.length !== 1 || parsed.points.length !== 1) throw new Error('parse count mismatch');
  if (Math.round(parsed.boxes[0].pixel.x2) !== 432) throw new Error('box pixel parse mismatch');
  if (Math.round(parsed.points[0].pixel.y) !== 540) throw new Error('point pixel parse mismatch');
  console.log(JSON.stringify({ ok: true, service: SERVICE, parsed }, null, 2));
}

function start() {
  const port = parseInt(envText('LOCATE_ANYTHING_PORT') || String(DEFAULT_PORT), 10) || DEFAULT_PORT;
  http.createServer(handler).listen(port, '127.0.0.1', () => {
    console.log(`${SERVICE} listening on http://127.0.0.1:${port}`);
  });
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else start();
}

module.exports = {
  ACCEPT_TOKEN,
  MODEL_ID,
  health: serviceState,
  locate,
  parseLocateAnythingAnswer,
};
