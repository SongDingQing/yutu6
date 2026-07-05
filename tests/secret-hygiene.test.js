'use strict';
// 测试硬约束(L2.5):每次 `node tests/run.js` 都执行密钥卫生检查。
// 三件事:
//  1. HEAD 全部已跟踪文件不含 error 级密钥暴露(与功能正确性同级的回归红线)。
//  2. 扫描器"防空转"自检:一张覆盖各检测器家族的夹具表,任一检测器被改坏成放行即变红
//     (红队指出旧版只 1 个向量,防护面 1/52;这里扩成多向量)。
//  3. .gitignore 的密钥禁区与扫描器 forbidden-path 规则对齐(防二者漂移)。
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCANNER = path.join(REPO_ROOT, 'security', 'secret-scan.js');

function scanPaths(files) {
  let out;
  try {
    out = execFileSync('node', [SCANNER, '--paths', ...files, '--json', '--quiet'], {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) { out = (e.stdout || '').toString(); if (!out.trim()) throw e; }
  return JSON.parse(out);
}
function scanTracked() {
  let out;
  try {
    out = execFileSync('node', [SCANNER, '--tracked', '--json', '--quiet'], {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) { out = (e.stdout || '').toString(); if (!out.trim()) throw e; }
  return JSON.parse(out);
}

// 夹具:合成的假密钥(格式真实,值不是真密钥)。拼接构造,避免本文件自身被扫描器命中。
const A = (n) => 'A'.repeat(n);
const H = (n) => 'a1b2c3d4e5f6'.repeat(Math.ceil(n / 12)).slice(0, n);
const SHOULD_HIT = {
  'sk-': 'api' + '_key = "sk-' + A(32) + '"',
  'stripe': 'STRIPE = sk_live_' + A(26),
  'github': 'tok=ghp_' + A(36),
  'aws-id': 'k = AKIA' + 'ABCDEFGHIJKLMNOP',
  'gcp-key': 'g = AIza' + A(35),
  'slack-webhook': 'https://hooks.slack.com/services/T00000000/B00000000/' + A(24),
  'jwt': 'eyJ' + A(20) + '.eyJ' + A(20) + '.' + A(20),
  'pem': '-----BEGIN RSA PRIVATE KEY-----',
  'conn-string': 'DB = postgres://user:S3cretP4ss@db.host:5432/app',
  'url-cred': 'U = https://admin:Sup3rS3cret@example.com/x',
  'keyname-hex': 'password = ' + H(24),
  'otp-base32': 'otp' + '_secret = JBSWY3DPEHPK3PXP',
  'xml-pass': '<pass' + 'word>S3cretValue1</pass' + 'word>',
  'npmrc-auth': '//reg.example/:_' + 'auth=' + A(24),
};
const SHOULD_PASS = {
  'env-ref': 'api' + '_key = process.env.API_KEY',
  'attr-ref': 'api' + '_key = args.api_key',
  'placeholder': 'api' + '_key = your_key_here',
  'template-var': 'token = ${GITHUB_TOKEN}',
  'short-num': 'timeout = 3000',
  'task-id': 'task = 6d6c1a2b3c4d5e6f7a8b9c0d1e2f3a4b',
};

function writeTmp(name, content) {
  const p = path.join(os.tmpdir(), `sechyg-${process.pid}-${name}.txt`);
  fs.writeFileSync(p, content + '\n');
  return p;
}

const tests = {
  '密钥卫生:HEAD 已跟踪文件不含 error 级密钥暴露'() {
    const res = scanTracked();
    if (res.errors.length > 0) {
      const lines = res.errors.slice(0, 30).map((e) => `  [${e.rule}] ${e.file}:${e.line} ${e.detail}`);
      assert.fail(`发现 ${res.errors.length} 处密钥级暴露(应为 0):\n${lines.join('\n')}\n处理:从 git 移除;确证误报登记 security/scan-allowlist.json。`);
    }
    assert.ok(res.scanned > 0);
  },

  '密钥卫生:扫描器识别各检测器家族的构造密钥(防空转)'() {
    const paths = [];
    const map = {};
    for (const [k, v] of Object.entries(SHOULD_HIT)) { const p = writeTmp('hit-' + k, v); paths.push(p); map[p] = k; }
    try {
      const res = scanPaths(paths);
      const errFiles = new Set(res.errors.map((e) => e.file));
      const missed = paths.filter((p) => ![...errFiles].some((f) => f.endsWith(path.basename(p)))).map((p) => map[p]);
      assert.strictEqual(missed.length, 0, `扫描器漏检构造密钥(检测器可能被削弱): ${missed.join(', ')}`);
    } finally { paths.forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} }); }
  },

  '密钥卫生:构造的非密钥(引用/占位/task-id)不误报'() {
    const paths = [];
    for (const [k, v] of Object.entries(SHOULD_PASS)) paths.push(writeTmp('pass-' + k, v));
    try {
      const res = scanPaths(paths);
      assert.strictEqual(res.errors.length, 0, `误报(应放行): ${res.errors.map((e) => e.detail).join(' | ')}`);
    } finally { paths.forEach((p) => { try { fs.unlinkSync(p); } catch (_) {} }); }
  },

  '密钥卫生:扫描器 forbidden-path 覆盖 .gitignore 的关键禁区(防漂移)'() {
    // 端到端:创建 basename 承载禁区形态的临时文件,断言扫描器判为 forbidden-path。
    // (目录前缀类禁区如 backups/、new-api/ 需完整路径,不在此 basename 级用例内。)
    const forbiddenBasenames = [
      'zhipu.env', '.env.local', 'app.env',
      '.git-credentials', '.netrc', '.pgpass', '.npmrc', '.pypirc',
      'service-account-prod.json', 'kubeconfig',
      'id_ed25519_gitee', 'server.pem', 'private.key', 'store.keystore',
    ];
    // 关键:basename 必须是干净的路径段(前面是 /),否则 (^|/) 锚点匹配不到 —— 用临时子目录承载。
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `drift-${process.pid}-`));
    const missed = [];
    for (const base of forbiddenBasenames) {
      const p = path.join(dir, base);
      fs.writeFileSync(p, 'placeholder\n');
      const res = scanPaths([p]);
      if (!res.errors.some((e) => e.rule === 'forbidden-path')) missed.push(base);
      try { fs.unlinkSync(p); } catch (_) {}
    }
    try { fs.rmdirSync(dir); } catch (_) {}
    assert.strictEqual(missed.length, 0, `扫描器 forbidden-path 未覆盖: ${missed.join(', ')}`);
  },
};

module.exports = { tests };

if (require.main === module) {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try { fn(); console.log('  ✓', name); }
    catch (e) { failed++; console.error('  ✗', name, '\n    ', e.message); }
  }
  process.exit(failed ? 1 : 0);
}
