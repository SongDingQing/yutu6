#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

function count(haystack, needle) {
  return (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

function projectPath(projectPathName) {
  return path.resolve(ROOT, projectPathName);
}

function assertAssetExists(publicPath) {
  const rel = publicPath.replace(/^\/public\//, 'projects/控制台/public/');
  assert(fs.existsSync(projectPath(rel)), `asset missing: ${rel}`);
}

function assertProjectFileExists(projectPathName) {
  assert(fs.existsSync(projectPath(projectPathName)), `file missing: ${projectPathName}`);
}

function readProjectJson(projectPathName) {
  assertProjectFileExists(projectPathName);
  return JSON.parse(fs.readFileSync(projectPath(projectPathName), 'utf8'));
}

function crc32(buf) {
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crc32.table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crc32.table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function sha256(projectPathName) {
  return crypto.createHash('sha256').update(fs.readFileSync(projectPath(projectPathName))).digest('hex');
}

function decodePng(projectPathName) {
  const buf = fs.readFileSync(projectPath(projectPathName));
  assert(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `not png: ${projectPathName}`);
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const idats = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset); offset += 4;
    const type = buf.subarray(offset, offset + 4).toString('ascii'); offset += 4;
    const data = buf.subarray(offset, offset + length); offset += length;
    const expectedCrc = buf.readUInt32BE(offset); offset += 4;
    assert.strictEqual(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), expectedCrc, `png crc mismatch: ${projectPathName} ${type}`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  assert.strictEqual(bitDepth, 8, `unsupported png bit depth: ${projectPathName}`);
  const channelsByType = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  assert(channels, `unsupported png color type ${colorType}: ${projectPathName}`);
  const inflated = zlib.inflateSync(Buffer.concat(idats));
  const stride = width * channels;
  const recon = Buffer.alloc(stride * height);
  let cursor = 0;
  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
  }
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor]; cursor += 1;
    const row = y * stride;
    const prev = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[cursor]; cursor += 1;
      const left = x >= channels ? recon[row + x - channels] : 0;
      const up = y > 0 ? recon[prev + x] : 0;
      const upLeft = y > 0 && x >= channels ? recon[prev + x - channels] : 0;
      if (filter === 0) recon[row + x] = raw;
      else if (filter === 1) recon[row + x] = (raw + left) & 255;
      else if (filter === 2) recon[row + x] = (raw + up) & 255;
      else if (filter === 3) recon[row + x] = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) recon[row + x] = (raw + paeth(left, up, upLeft)) & 255;
      else assert.fail(`bad png row filter ${filter}: ${projectPathName}`);
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < recon.length; i += channels, j += 4) {
    if (colorType === 6) {
      rgba[j] = recon[i]; rgba[j + 1] = recon[i + 1]; rgba[j + 2] = recon[i + 2]; rgba[j + 3] = recon[i + 3];
    } else if (colorType === 2) {
      rgba[j] = recon[i]; rgba[j + 1] = recon[i + 1]; rgba[j + 2] = recon[i + 2]; rgba[j + 3] = 255;
    } else if (colorType === 0) {
      rgba[j] = recon[i]; rgba[j + 1] = recon[i]; rgba[j + 2] = recon[i]; rgba[j + 3] = 255;
    } else if (colorType === 4) {
      rgba[j] = recon[i]; rgba[j + 1] = recon[i]; rgba[j + 2] = recon[i]; rgba[j + 3] = recon[i + 1];
    }
  }
  return { width, height, rgba };
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function topFaceRatio(image, poly, targetRgb) {
  let topOpaque = 0;
  let topExact = 0;
  let sideOpaque = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      if (image.rgba[i + 3] < 16) continue;
      if (pointInPoly(x + 0.5, y + 0.5, poly)) {
        topOpaque += 1;
        if (image.rgba[i] === targetRgb[0] && image.rgba[i + 1] === targetRgb[1] && image.rgba[i + 2] === targetRgb[2]) topExact += 1;
      } else {
        sideOpaque += 1;
      }
    }
  }
  return { topOpaque, topExact, ratio: topExact / topOpaque, sideOpaque };
}

function main() {
  const htmlPath = projectPath('projects/控制台/public/office-experiment.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const animationPreviewPath = projectPath('projects/控制台/public/office-animation-preview.html');
  const animationContentPath = projectPath('projects/控制台/public/office-animation-preview-content.html');
  assert(fs.existsSync(animationPreviewPath), 'standalone animation preview page must exist');
  assert(fs.existsSync(animationContentPath), 'preserved three-GIF animation content must exist');
  const animationPreview = fs.readFileSync(animationPreviewPath, 'utf8');
  const animationContent = fs.readFileSync(animationContentPath, 'utf8');

  assert(html.includes('href="/public/office-animation-preview.html"'), '40-tile page must link to the standalone animation preview');
  assert(html.includes('办公室·40 地块实验版'), '40-tile page purpose must be explicit');
  assert(!html.includes('data:image/gif;base64,'), '40-tile page must not load the three embedded GIFs');
  assert(animationPreview.includes('<h1>总裁动画预览</h1>'), 'animation preview purpose must be explicit');
  assert(animationPreview.includes('href="/public/office-experiment.html"'), 'animation preview must link back to the 40-tile scene');
  assert(animationPreview.includes('src="/public/office-animation-preview-content.html"'), 'animation preview must load the preserved content only on demand');
  assert.strictEqual(count(animationContent, 'data:image/gif;base64,'), 3, 'animation preview must preserve all three embedded GIFs');
  assert.strictEqual(count(animationContent, '<img'), 3, 'animation preview must preserve the three animation panels');
  assert(animationContent.includes('状态:打字 idle · 引擎跑任务时播放'), 'typing preview caption must remain');
  assert(animationContent.includes('状态:看书 idle · 空闲时播放'), 'reading preview caption must remain');
  assert(animationContent.includes('状态:递交文件 · 秘书交接触发'), 'handoff preview caption must remain');

  [
    'chairman-office-experimental.png',
    '/public/office-demo-assets/office-floor-seamless-isometric.png',
    '/public/office-demo-assets/chairman/experimental/tile-floor-meowa.png',
    '/public/office-demo-assets/chairman/experimental/tile-partition-meowa.png',
    '/public/office-demo-assets/chairman/chairman-idle.webp',
    '/public/office-demo-assets/chairman-handoff/secretary-walk-v2.png',
    '/public/office-demo-assets/chairman-handoff/chairman-handoff.png',
  ].forEach(forbidden => assert(!html.includes(forbidden), `old failed asset must not be referenced: ${forbidden}`));
  assert(!html.includes('data-tile-role="meowa-floor"'), 'old failed meowa floor role must not be referenced');
  assert(!html.includes('data-tile-role="meowa-partition"'), 'old failed meowa partition role must not be referenced');

  assert.strictEqual(count(html, 'data-tile-role="floor"'), 40, 'office experiment must render the planned 40-tile floor grid');
  assert.strictEqual(count(html, 'src="/public/office-demo-assets/office-tile-library/thick-solid-carpet-isometric-v3.png"'), 40, 'all floor tiles must use v3 thick tile');
  assert(html.includes('data-tile-role="platform-shadow"'), 'flat carpet underlay must be replaced by a shadow under the tile stack');
  assert(html.includes('data-tile-role="chairman-animated"'), 'chairman animated tile must be explicit in DOM');
  assert(html.includes('data-grid-anchor="i:3,j:1,span:2x2"'), 'chairman tile must have a fixed 2x2 grid anchor');
  assert(html.includes('data-render-order="tile-first-actors-after"'), 'render order must be documented in DOM');
  assert(html.includes('data-z-order="floor:10-21,chairman-tile:130,desk:4,chairman:3,secretary:6,mail:9"'), 'z-order contract must be explicit');

  [
    '/public/office-demo-assets/office-tile-library/thick-solid-carpet-isometric-v3.png',
    '/public/office-demo-assets/office-tile-library/thick-carpet-meowa-raw-9a65.png',
    '/public/office-demo-assets/chairman/kdrama-chairman-ceo-v1.png',
    '/public/office-demo-assets/chairman/executive-desk-v1.png',
    '/public/office-demo-assets/chairman-handoff/secretary-arrival-v1.webp',
  ].forEach(publicPath => {
    assert(html.includes(publicPath), `page must reference ${publicPath}`);
    assertAssetExists(publicPath);
  });

  const metricsPath = 'projects/控制台/public/office-demo-assets/office-tile-library/thick-solid-carpet-isometric-v3.metrics.json';
  const metrics = readProjectJson(metricsPath);
  const tilePath = 'projects/控制台/public/office-demo-assets/office-tile-library/thick-solid-carpet-isometric-v3.png';
  const tile = decodePng(tilePath);
  assert.strictEqual(tile.width, 192, 'thick carpet source tile width must follow design contract');
  assert.strictEqual(tile.height, 126, 'thick carpet source tile height must include visible thickness');
  assert.strictEqual(metrics.source_meowa_job_id, 'workflow-hd_isometric_gen-9a65b38886fc4b299aa55513');
  assert.strictEqual(metrics.visible_thickness_px, 32);
  assert.strictEqual(metrics.side_faces_visible, true);
  assert.strictEqual(metrics.isometric_angle.ratio, 2);
  const ratio = topFaceRatio(tile, metrics.top_face_polygon, [135, 146, 155]);
  assert(ratio.topOpaque > 0, 'top face must contain visible pixels');
  assert.strictEqual(ratio.ratio, 1, 'top face carpet must be exact pure solid color');
  assert(ratio.sideOpaque >= 1000, `side faces must be visible, got ${ratio.sideOpaque}`);
  assert.strictEqual(metrics.top_face_exact_main_color_ratio, ratio.ratio);
  [
    'projects/控制台/public/office-demo-assets/office-floor-seamless-isometric.png',
    'projects/控制台/public/office-demo-assets/chairman/experimental/tile-floor-meowa.png',
    'projects/控制台/public/office-demo-assets/office-floor-carpet-tile-120x64.png',
    'projects/控制台/public/office-demo-assets/office-tile-library/solid-carpet-isometric-v2.png',
  ].forEach(oldPath => {
    assert.notStrictEqual(sha256(tilePath), sha256(oldPath), `new tile must not match old failed asset: ${oldPath}`);
  });

  [
    '@keyframes chairmanBreathe',
    '@keyframes secretaryArrival',
    '@keyframes mailFlight',
    '@keyframes bubbleCall',
    '@keyframes bubbleBrief',
    '@keyframes bubbleAck',
  ].forEach(rule => assert(html.includes(rule), `missing animation rule: ${rule}`));
  [
    'animation: chairmanBreathe var(--loop) ease-in-out infinite',
    'animation: secretaryArrival var(--loop) ease-in-out infinite',
    'animation: mailFlight var(--loop) ease-in-out infinite',
    'animation: bubbleCall var(--loop) ease-in-out infinite',
    'animation: bubbleBrief var(--loop) ease-in-out infinite',
    'animation: bubbleAck var(--loop) ease-in-out infinite',
  ].forEach(rule => assert(html.includes(rule), `animation rule is not bound: ${rule}`));
  assert(html.includes('.chairman-tile.phase-call .handoff-chairman-idle'), 'forced call phase must keep chairman explicitly visible');
  assert(html.includes('opacity: .98;\n      transform: translateY(-3px) scale(.96);'), 'call phase must not fade the chairman below visual-review readability');
  assert(!html.includes('49%, 69% { opacity: 0; transform: translateY(-2px) scale(.94); }'), 'chairman animation must not hide the chairman during the handoff sequence');

  const match = html.match(/<script\s+type="application\/json"\s+id="office-quality-ledger">\s*([\s\S]*?)\s*<\/script>/);
  assert(match, 'office quality ledger JSON must be embedded for review evidence');
  const ledger = JSON.parse(match[1]);
  assert.strictEqual(ledger.task_id, 'cr-1782212223017-78f70089');
  assert.strictEqual(ledger.previous_implementation_task_id, 'cr-1782210015770-7774ef7e');
  assert.strictEqual(ledger.root_task_id, 'cr-1782212098137-2225ada3');
  assert.strictEqual(ledger.tile_library.length, 1, 'ledger must not list old failed floor/partition assets as active tiles');
  assert.strictEqual(ledger.tile_library[0].name, 'thick-solid-carpet-isometric-v3');
  assert.strictEqual(ledger.tile_library[0].actual_top_face_exact_main_color_ratio, 1);
  assert(ledger.tile_library[0].visible_thickness_px > 0, 'ledger must record tile thickness');
  assert.strictEqual(ledger.meowa_new_assets.length, 3, 'chairman, desk, and secretary animation must be new Meowa assets');
  assert.deepStrictEqual(Object.values(ledger.meowa_attempts), [1, 1, 1, 1], 'each Meowa element must stay within retry limit');
  assert(ledger.meowa_retry_limit <= 3, 'retry limit must be explicit and bounded');
  assert.strictEqual(ledger.secretary_animation_sequence.length, 4, 'secretary sequence must cover all four beats');
  assert.strictEqual(ledger.render_layers.length, 3, 'ledger must define render layer contract');
  assertProjectFileExists(ledger.quality_gate.designer_self_check);
  ledger.quality_gate.animation_evidence.forEach(assertProjectFileExists);
  ledger.quality_gate.visual_evidence.forEach(assertProjectFileExists);

  assert(!/MEOWART_API_KEY|ma_live_|token|cookie|private key/i.test(html), 'experiment page must not contain secrets');
  console.log(JSON.stringify({ pass: true, suite: 'office-experiment' }));
}

main();
