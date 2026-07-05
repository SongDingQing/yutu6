#!/usr/bin/env node
// 玉兔6 密钥扫描器 —— 钩子(pre-commit/pre-push)、测试(secret-hygiene)、CI 三层共用的同一引擎。
// 设计原则:
//  1. 零依赖:只用 node 内置模块,任何环境(本地钩子/CI/裸 node)可跑。
//  2. 永不回显密钥原文:命中片段一律掩码(保留首尾各4字符)。
//  3. 已知密钥用 SHA256 指纹匹配(security/secret-inventory.json 只存哈希前缀,不存原文),
//     即使密钥换了文件名、换了字段名出现也能抓到。
//  4. 分级:error(阻断) / warn(报告不阻断)。熵检测单独出现只算 warn,
//     叠加敏感键名上下文或指纹命中才升级 error,控制误报。
// 用法:
//   node security/secret-scan.js --staged            # 扫 git 暂存区(pre-commit)
//   node security/secret-scan.js --range A..B        # 扫提交范围内全部 blob(pre-push)
//   node security/secret-scan.js --tracked           # 扫 HEAD 全部跟踪文件(测试/CI)
//   node security/secret-scan.js --history           # 扫全历史全部 blob(迁移前全量核查)
//   node security/secret-scan.js --paths f1 f2 ...   # 扫指定工作树文件
//   附加: --json 输出机器可读结果; --quiet 只输出汇总
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 指纹/白名单绑定扫描器自身目录(随规则走,跨仓库一致);
// git 操作与工作树路径解析绑定"调用时所在的仓库"(process.cwd()),
// 这样钩子/测试/引擎委托从任意仓库调用时都扫的是那个仓库,而非扫描器所在仓库。
const INVENTORY_PATH = path.join(__dirname, 'secret-inventory.json');
const ALLOWLIST_PATH = path.join(__dirname, 'scan-allowlist.json');
const GIT_CWD = process.cwd();

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

const inventory = loadJson(INVENTORY_PATH, { forbidden_paths: [], fingerprints: [] });
const allowlist = loadJson(ALLOWLIST_PATH, { entries: [] });

// ===== 检测器 1:禁区路径(清单 + 内置) =====
// 与根 .gitignore 的密钥禁区逐条对齐(有 gitignore/drift 断言测试守护,防二者漂移)。
const BUILTIN_FORBIDDEN_PATH_RES = [
  /\.meow_art\//i,
  /secrets?-consolidate/i,
  /[^/]*\.env$/i,                       // 任意 *.env(含 zhipu.env,不止 .env 开头)
  /(^|\/)\.env(\.[^/]*)?$/i,            // .env / .env.local / .env.<x>
  /new-api\/.*\.env$/i,                 // 对齐 gitignore: new-api/*.env
  /(^|\/)backups\//i,                   // 备份快照(打包了 config.json/memory/queues)
  /id_(rsa|ed25519|ecdsa|dsa)(_|$|\.)/i,
  /\.ssh-stage\//i,
  /MacMini-Secrets/i,
  /(^|\/)(\.aws|\.gnupg)\//i,
  /\.(pem|key|p12|pfx|keystore|jks|ovpn)$/i,
  /(^|\/)kb\.sqlite/i,
  /(^|\/)\.git-credentials$/i,
  /(^|[/._-])netrc$/i,
  /(^|[/._-])pgpass$/i,
  /(^|[/._-])npmrc$/i,
  /(^|[/._-])pypirc$/i,
  /(^|\/)\.dockercfg$/i,
  /service[_-]?account.*\.json$/i,
  /(^|\/)(kubeconfig|\.kube\/config)$/i,
  /\.claude\/worktrees\//i,            // worktree 产物(含代码副本/会话产物)不入库
];
const inventoryPathRes = (inventory.forbidden_paths || []).map((s) => new RegExp(s, 'i'));

function pathForbidden(file) {
  for (const re of BUILTIN_FORBIDDEN_PATH_RES) if (re.test(file)) return re.source;
  for (const re of inventoryPathRes) if (re.test(file)) return re.source;
  return null;
}

// ===== 检测器 2:敏感键名赋值(JSON/YAML/env/代码/CLI/中文) =====
// 键名同时覆盖 snake_case、camelCase(SecretKey/accessKeySecret)、裸键(_auth)、中文与 CLI 参数。
// 窄键名(高置信,任意非占位值即 error)——与旧版一致,零误报基线。
const KEYNAME_RE = /(api[_-]?key|apikey|api[_-]?secret|secret[_-]?access[_-]?key|access[_-]?key[_-]?secret|accesskeysecret|secret[_-]?key|secretkey|client[_-]?secret|clientsecret|access[_-]?key|access[_-]?token|accesstoken|auth[_-]?token|_auth|refresh[_-]?token|private[_-]?key|privatekey|passwd|password|passphrase|dev[_-]?key|app[_-]?secret|appsecret|signing[_-]?key|aws[_-]?secret|sas[_-]?token|otp[_-]?secret|totp[_-]?seed|mfa[_-]?seed|hmac[_-]?key|webhook[_-]?secret|signing[_-]?secret|mailgun[_-]?key|[a-z0-9]+[_-]sk)["']?\s*[:=]\s*["']?([^\s"',;}{]{8,})/gi;
// 宽泛键名子集(以 secret/token/seed/sk/hmac 等收尾的复合键):值必须"像密钥"且不像代码标识符,才升 error。
const BROAD_KEY_RE = /(_secret|_seed|[_-]sk|hmac|webhook|mailgun|otp|totp|mfa)$/i;
function looksCodeIdentifier(v) {
  return /[a-z][A-Z]/.test(v)            // camelCase 变量
      || /[.(){}\[\]`]/.test(v)          // 代码标点(调用/成员/模板)
      || /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(v); // CONSTANT_NAME
}
function looksSecretLike(v) {
  if (v.length < 12) return false;
  if (/^[a-z][a-z0-9]*$/.test(v)) return false;         // 纯小写单词
  if (/^[A-Z2-7]{16,}$/.test(v)) return true;           // base32(TOTP 种子)
  if (/^[0-9a-f]{24,}$/i.test(v)) return true;          // 长 hex
  if (/^[A-Za-z0-9+/]{16,}={0,2}$/.test(v)) return true; // base64
  if (v.length >= 20) return true;
  return false;
}
// 中文键名(本仓库中文智能体环境高发):密码/密钥/口令/凭据/访问令牌
const CN_KEYNAME_RE = /(密码|密钥|口令|接口令牌|凭据|访问令牌|密匙)\s*[:=：]\s*["']?([^\s"',;}{，；]{6,})/g;
// CLI 参数形态:--password xxx / -p xxx / --token xxx
const CLI_KEYNAME_RE = /(--password|--passwd|--token|--secret|--api-key|--apikey)[\s=]+["']?([^\s"']{8,})/gi;
const PLACEHOLDER_RE = /^(x{3,}|\*{3,}|<[^>]*>|\$\{[^}]*\}|%[sdv]|your[_-]?|example|changeme|placeholder|redacted|dummy|test[_-]?key|null|undefined|true|false|\.{3}|-{3,}|sk-xxx|\{\{|__)/i;
const PLACEHOLDER_TAIL_RE = /x{3,}["']?\)?[,;]?$/i; // ma_live_xxxxxxxx 之类文档占位
// 引用而非字面值:process.env.X / args.api_key / ${VAR} 等属性访问、模板变量。
// 注:SG.xxx.yyy 这类点分密钥由 token-shape(SG. 前缀)独立捕获,不依赖 keyname,故这里放宽成员访问不漏它。
const REFERENCE_VALUE_RE = /^(process\.env|os\.environ|env\.|env\[|config\.|ctx\.|this\.|self\.|settings\.|args\.|opts\.|require\(|import\b|getenv|lookup|from_env|\$\{|\$[A-Za-z_]|[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_])/;
// 代码表达式:值含括号/反引号/前导 ( 即视为代码(恢复旧版宽度,保零误报基线;
// 真口令极少含字面括号,这类高值捕获由 token-shape/连接串/指纹负责,不靠 keyname)。
const CODE_EXPR_RE = /[()`]|^[[{]/;
// GCP service_account 凭据文件特征:type 字段 或 iam.gserviceaccount.com 邮箱 或 private_key_id
const GCP_SA_RE = /"type"\s*:\s*"service_account"|[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com|"private_key_id"\s*:/;

// ===== 检测器 3:已知 token 形态前缀(红队实测扩充,覆盖主流云/SaaS 生产密钥) =====
const PREFIX_RES = [
  { name: 'openai/anthropic 风格 sk-', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'Stripe live/test key', re: /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{20,}\b/g },
  { name: 'SendGrid API key', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
  { name: 'github token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { name: 'github fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: 'gitlab token(多前缀)', re: /\bgl(pat|dt|ptt|rt|soat|cbt|ft|rrt|agent)-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'slack incoming webhook', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,}/g },
  { name: 'discord webhook', re: /https:\/\/(discord|discordapp)\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]{40,}/g },
  { name: 'discord bot token', re: /\b[MNO][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g },
  { name: 'huggingface token', re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'DockerHub PAT', re: /\bdckr_pat_[A-Za-z0-9_-]{20,}\b/g },
  { name: 'PyPI token', re: /\bpypi-AgEI[A-Za-z0-9_-]{40,}\b/g },
  { name: 'telegram bot token', re: /\b[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}\b/g },
  { name: 'AWS access key', re: /\b(AKIA|ASIA|AGPA|AROA|AIDA|ANPA|ANVA)[0-9A-Z]{16}\b/g },
  { name: '阿里云 AccessKey Id', re: /\bLTAI[0-9A-Za-z]{12,22}\b/g },
  { name: '腾讯云 SecretId', re: /\bAKID[0-9A-Za-z]{28,40}\b/g },
  { name: 'Twilio SID/API key', re: /\b(AC|SK|AP|PN|CA|IS|RE|MG|WA)[0-9a-fA-F]{32}\b/g },
  { name: 'Mailgun key', re: /\bkey-[0-9a-f]{32}\b/g },
  { name: 'google api key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'google oauth', re: /\bya29\.[0-9A-Za-z_-]{20,}\b/g },
  { name: 'Azure Storage AccountKey', re: /AccountKey=[A-Za-z0-9+/]{60,}={0,2}/gi },
  { name: 'Azure SAS sig', re: /[?&](sig|SharedAccessSignature)=[A-Za-z0-9%+/]{40,}/g },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'PEM 私钥块', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'ssh 公私钥体', re: /\b(ssh-(rsa|ed25519|dss)|ecdsa-sha2-[a-z0-9-]+) AAAA[A-Za-z0-9+/=]{30,}/g },
  { name: '智谱/通用 32+hex.秘串', re: /\b[0-9a-f]{32}\.[A-Za-z0-9]{6,}\b/g },
  { name: 'wechat/dingtalk webhook', re: /https:\/\/(qyapi\.weixin\.qq\.com|oapi\.dingtalk\.com)\/[^\s"']*(key|access_token)=[A-Za-z0-9-]{16,}/g },
];

// ===== 检测器 3b:连接串/凭据文件内容结构(不依赖 key=value 键名) =====
// 这些是 CI/部署环节最常见的凭据落盘形态,承载方式各异(URL userinfo、空格分隔、五段式、XML、base64)。
const CONTENT_STRUCT_RES = [
  { name: '连接串内嵌口令(DSN userinfo)', re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|rediss|amqps?|jdbc:[a-z0-9]+):\/\/[^:/\s@]+:[^@/\s]{4,}@/gi },
  { name: 'HTTP(S) URL 内嵌口令', re: /\bhttps?:\/\/[^:/\s@]+:[^@/\s]{6,}@[^\s"']+/g },
  { name: '.npmrc 裸 _auth', re: /(^|\/):_auth(Token)?=[A-Za-z0-9+/=_-]{16,}/gm },
  { name: 'docker config auth', re: /"auth"\s*:\s*"[A-Za-z0-9+/]{16,}={0,2}"/g },
  { name: 'kubeconfig client-key-data', re: /client-key-data\s*:\s*[A-Za-z0-9+/=]{40,}/g },
  { name: 'XML <password>', re: /<password>\s*[^<\s]{6,}\s*<\/password>/gi },
  { name: 'HTTP Basic/Bearer 头', re: /\b(Authorization|Proxy-Authorization)\s*:\s*(Basic|Bearer)\s+[A-Za-z0-9+/=._-]{16,}/gi },
];
// .pgpass 五段式 / .netrc 空格分隔口令:仅在对应文件名下才作为内容规则(否则误伤 CSS/JSON/散文)。
// 注:.pgpass/.netrc 本身已是 forbidden-path,这里是二次内容佐证,路径门控降误报。

// ===== 检测器 4:高熵候选(单独出现=warn,叠加上下文=error) =====
const ENTROPY_TOKEN_RE = /\b[A-Za-z0-9+/=_-]{24,}\b/g;
function shannon(s) {
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  let h = 0;
  for (const k in freq) { const p = freq[k] / s.length; h -= p * Math.log2(p); }
  return h;
}
const HEXHASH_RE = /^[0-9a-f]{40,64}$/i; // 纯 hex 长串多为哈希(git sha/sha256),单独出现不告警
const BASE64_PAD_RE = /^[A-Za-z0-9+/]+=*$/;

// ===== 检测器 5:指纹匹配(已知密钥的 SHA256 前缀) =====
const FINGERPRINTS = new Map();
for (const fp of inventory.fingerprints || []) {
  if (fp && fp.sha256_12) FINGERPRINTS.set(fp.sha256_12, fp.label || 'known-secret');
}
function fingerprintOf(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

// ===== 掩码与白名单 =====
function asciiSafe(s) {
  // 只保留可打印 ASCII,避免掩码切断多字节/代理对导致 JSON 序列化出非法孤代理
  return s.replace(/[^\x20-\x7e]/g, '·');
}
function mask(s) {
  const a = asciiSafe(s);
  if (a.length <= 8) return '*'.repeat(a.length);
  return a.slice(0, 4) + '*'.repeat(Math.min(a.length - 8, 24)) + a.slice(-4);
}
function lineAllowed(file, lineText) {
  const h = crypto.createHash('sha256').update(lineText.trim(), 'utf8').digest('hex').slice(0, 12);
  return (allowlist.entries || []).some((e) => e.path === file && e.line_sha12 === h);
}
const DOC_PLACEHOLDER_FILE_RE = /\.(example|sample|template)(\.|$)/i;

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// 指纹比对:原文 + 常见编码变体(base64/hex 解码),抓"换个编码就泄露"。
function fingerprintHits(token) {
  const cands = [token];
  try { if (BASE64_PAD_RE.test(token) && token.length >= 12 && token.length % 4 === 0) cands.push(Buffer.from(token, 'base64').toString('utf8')); } catch (_) {}
  try { if (/^[0-9a-f]{16,}$/i.test(token) && token.length % 2 === 0) cands.push(Buffer.from(token, 'hex').toString('utf8')); } catch (_) {}
  for (const c of cands) {
    if (!c) continue;
    const hit = FINGERPRINTS.get(fingerprintOf(c));
    if (hit) return hit;
  }
  return null;
}

// 单行内的【精确检测器】(指纹/token形态/连接串结构):这些永远该跑,
// 包括模板文件、二进制、超长行——成形密钥无论出现在哪都不该存在。
function scanLineExact(file, line, i, findings, seenTokens) {
  const tokens = line.match(/[A-Za-z0-9+/=_.-]{8,}/g) || [];
  for (const t of tokens) {
    if (seenTokens.has(t)) continue;
    seenTokens.add(t);
    const hit = fingerprintHits(t);
    if (hit) findings.push({ level: 'error', rule: 'fingerprint', file, line: i + 1, detail: `已知密钥指纹命中(${hit}): ${mask(t)}` });
  }
  for (const p of PREFIX_RES) {
    p.re.lastIndex = 0;
    let pm;
    while ((pm = p.re.exec(line)) !== null) {
      findings.push({ level: 'error', rule: 'token-shape', file, line: i + 1, detail: `${p.name}: ${mask(pm[0])}` });
    }
  }
  for (const p of CONTENT_STRUCT_RES) {
    p.re.lastIndex = 0;
    let cm;
    while ((cm = p.re.exec(line)) !== null) {
      if (/x{3,}["']?$|<[^/][^>]*>$|\.\.\.$|\$\{/.test(cm[0])) continue; // 占位:xxxx结尾/<占位>/省略号/${模板}(不误跳 XML 闭合标签,不误跳 example.com 主机)
      findings.push({ level: 'error', rule: 'content-struct', file, line: i + 1, detail: `${p.name}: ${mask(cm[0])}` });
    }
  }
}

// 键名赋值检测(含中文/CLI),模板文件放宽(易误报),但精确检测器不放宽。
function scanLineKeyname(file, line, i, findings, relaxed) {
  const runners = [
    { re: KEYNAME_RE, kidx: 1, vidx: 2 },
    { re: CN_KEYNAME_RE, kidx: 1, vidx: 2 },
    { re: CLI_KEYNAME_RE, kidx: 1, vidx: 2 },
  ];
  for (const r of runners) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(line)) !== null) {
      const key = m[r.kidx];
      const val = m[r.vidx];
      if (!val) continue;
      if (PLACEHOLDER_RE.test(val) || PLACEHOLDER_TAIL_RE.test(val) || REFERENCE_VALUE_RE.test(val)) continue;
      if (CODE_EXPR_RE.test(val)) continue;
      if (val.toLowerCase() === key.toLowerCase()) continue;
      if (/^[a-z_][a-z0-9_]*,?$/.test(val) && val.length < 20) continue; // 短 snake_case 标识符(引用);长的可能是 hex 密钥,保留
      if (/^(0x)?[0-9]{1,6}$/.test(val)) continue; // 纯短数字(≤6 位:端口/超时/短码);≥7 位数字在敏感键名下保留
      if (relaxed) continue; // 模板文件:键名层放宽(值多为占位)
      findings.push({ level: 'error', rule: 'keyname-assignment', file, line: i + 1, detail: `敏感键 ${key} 携带疑似实值: ${mask(val)}` });
    }
  }
}

// ===== 单文件内容扫描 =====
function scanContent(file, content, findings) {
  const pf = pathForbidden(file);
  if (pf) findings.push({ level: 'error', rule: 'forbidden-path', file, line: 0, detail: `路径命中禁区规则 ${pf}` });
  // 模板/示例文件:仍跑指纹+token形态+连接串(成形密钥不该在,指纹命中更是强信号),只放宽键名/熵。
  const relaxed = DOC_PLACEHOLDER_FILE_RE.test(file);
  // GCP service_account 文件:内容特征即凭据文件
  if (GCP_SA_RE.test(content)) {
    findings.push({ level: 'error', rule: 'content-struct', file, line: 0, detail: 'GCP service_account 凭据文件特征命中' });
  }
  const lines = content.split(/\r?\n/);
  const seenTokens = new Set();
  // YAML/多行块标量:key: | 或 key: > 后,下一非空缩进行是值
  const BLOCK_SCALAR_KEY = /\b(password|passwd|secret|api[_-]?key|apikey|token|credential|private[_-]?key)\s*:\s*[|>][+-]?\s*$/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (lineAllowed(file, line)) continue;
    if (BLOCK_SCALAR_KEY.test(line)) {
      // 找下一非空行作为块标量值
      for (let j = i + 1; j < lines.length && j < i + 4; j++) {
        const v = lines[j].trim();
        if (!v) continue;
        if (v.length >= 8 && !PLACEHOLDER_RE.test(v) && !/^[#-]/.test(v)) {
          findings.push({ level: 'error', rule: 'keyname-assignment', file, line: j + 1, detail: `多行块标量密钥值: ${mask(v)}` });
        }
        break;
      }
    }
    if (line.length > 4000) {
      // 超长行:仍跑精确检测器(线性正则,不卡死),只跳过 O(n²) 熵检测
      scanLineExact(file, line, i, findings, seenTokens);
      continue;
    }
    scanLineExact(file, line, i, findings, seenTokens);
    scanLineKeyname(file, line, i, findings, relaxed);

    // 高熵候选:一律 warn(咨询级,不阻断)。阻断由精确检测器负责。
    if (relaxed) continue;
    ENTROPY_TOKEN_RE.lastIndex = 0;
    let em;
    while ((em = ENTROPY_TOKEN_RE.exec(line)) !== null) {
      const t = em[0];
      if (HEXHASH_RE.test(t)) continue;                                   // 纯 hex 哈希
      if (/^([^/]*\/){2,}[^/]*$/.test(t) && !BASE64_PAD_RE.test(t)) continue; // 真路径(分段无高熵),但 base64-with-slash 不排除
      if (/^[a-z0-9]+([-_][a-z0-9]+){2,}$/.test(t)) continue;             // kebab/snake 标识符
      if (/^[A-Z0-9]+([-_][A-Za-z0-9]+){2,}$/.test(t)) continue;          // 常量名/环境变量名
      if (t.length >= 28 && shannon(t) >= 4.3 && (BASE64_PAD_RE.test(t) || (/[A-Z]/.test(t) && /[a-z]/.test(t) && /[0-9]/.test(t)))) {
        findings.push({ level: 'warn', rule: 'high-entropy', file, line: i + 1, detail: `高熵串: ${mask(t)}` });
      }
    }
  }
}

// ===== git 数据源 =====
function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: GIT_CWD, maxBuffer: 256 * 1024 * 1024, ...opts });
}
function gitText(args) { return git(args, { encoding: 'utf8' }); }

// 二进制文件:不整体跳过。用 latin1 解码保留每个字节为一个字符,
// 跑精确检测器(指纹/token形态/连接串);只有 O(n²) 的熵检测才真正需要文本假设。
function scanBinaryExact(file, buf, findings) {
  const pf = pathForbidden(file);
  if (pf) findings.push({ level: 'error', rule: 'forbidden-path', file, line: 0, detail: `二进制文件路径命中禁区 ${pf}` });
  const text = buf.toString('latin1');
  const seen = new Set();
  const chunks = text.split(/[\x00-\x08\x0e-\x1f]+/); // 按控制字节切成"可打印段",逐段当一行跑精确检测
  for (let i = 0; i < chunks.length; i++) {
    const seg = chunks[i];
    if (!seg || seg.length < 8) continue;
    // 段可能很长,scanLineExact 内部正则线性,安全
    scanLineExact(file, seg.slice(0, 200000), i, findings, seen);
  }
}

const MAX_FULL = 2 * 1024 * 1024;
function scanBlob(file, blobRef, findings) {
  let full;
  try { full = git(['cat-file', 'blob', blobRef]); } catch (e) { return; }
  const buf = full.length > MAX_FULL ? full.slice(0, MAX_FULL) : full;
  if (isBinary(buf)) { scanBinaryExact(file, full, findings); return; } // 二进制:latin1 精确扫全量
  scanContent(file, buf.toString('utf8'), findings);
  if (full.length > MAX_FULL) scanRemainderExact(file, full, findings); // 前 2MB 全套 + 剩余精确粗扫
}

// 超大文件 2MB 之后的剩余部分:只跑精确检测器(线性),防"把密钥放到扫描器放弃区"。
function scanRemainderExact(file, full, findings) {
  const seen = new Set();
  const rest = full.slice(MAX_FULL - 4096).toString('latin1'); // 回退 4KB 防跨界截断
  const lines = rest.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) scanLineExact(file, lines[i].slice(0, 200000), i, findings, seen);
}

function scanStaged(findings) {
  const out = gitText(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  const files = out.split('\0').filter(Boolean);
  for (const f of files) scanBlob(f, `:${f}`, findings); // 暂存区版本(index stage 0)
  return files.length;
}

function scanTracked(findings, treeish = 'HEAD') {
  const out = gitText(['ls-tree', '-r', '--name-only', '-z', treeish]);
  const files = out.split('\0').filter(Boolean);
  for (const f of files) scanBlob(f, `${treeish}:${f}`, findings);
  return files.length;
}

function scanRange(findings, range) {
  // 扫范围内每个提交触碰过的文件的"该提交版本"(新增内容全覆盖)
  const commits = gitText(['rev-list', range]).split('\n').filter(Boolean);
  const seen = new Set();
  let count = 0;
  for (const c of commits) {
    const out = gitText(['diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMR', '-z', c]);
    for (const f of out.split('\0').filter(Boolean)) {
      const key = `${c}:${f}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scanBlob(f, key, findings);
      count++;
    }
  }
  return count;
}

function scanHistory(findings) {
  // 全历史每个 blob 只扫一次;路径取该 blob 首次出现的路径
  const out = gitText(['rev-list', '--objects', '--all']);
  const seen = new Set();
  let count = 0;
  for (const lineRaw of out.split('\n')) {
    if (!lineRaw) continue;
    const sp = lineRaw.indexOf(' ');
    if (sp < 0) continue; // 无路径的对象(commit/tag)
    const oid = lineRaw.slice(0, sp);
    const p = lineRaw.slice(sp + 1);
    if (!p || seen.has(oid)) continue;
    seen.add(oid);
    let type;
    try { type = gitText(['cat-file', '-t', oid]).trim(); } catch (e) { continue; }
    if (type !== 'blob') continue;
    scanBlob(p, oid, findings);
    count++;
  }
  return count;
}

function scanWorkingPaths(findings, paths) {
  for (const f of paths) {
    const abs = path.resolve(GIT_CWD, f);
    let buf;
    try { buf = fs.readFileSync(abs); } catch (e) { continue; }
    const truncated = buf.length > 2 * 1024 * 1024;
    if (truncated) buf = buf.slice(0, 2 * 1024 * 1024);
    if (isBinary(buf)) { scanBinaryExact(f, fs.readFileSync(abs), findings); continue; }
    scanContent(f, buf.toString('utf8'), findings);
    if (truncated) scanRemainderExact(f, fs.readFileSync(abs), findings);
  }
  return paths.length;
}

// ===== main =====
function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const findings = [];
  let scanned = 0;
  let mode = 'staged';

  if (has('--staged')) { mode = 'staged'; scanned = scanStaged(findings); }
  else if (has('--tracked')) { mode = 'tracked'; scanned = scanTracked(findings); }
  else if (has('--history')) { mode = 'history'; scanned = scanHistory(findings); }
  else if (has('--range')) {
    mode = 'range';
    const r = argv[argv.indexOf('--range') + 1];
    if (!r) { console.error('缺少 --range 参数值'); process.exit(2); }
    scanned = scanRange(findings, r);
  } else if (has('--paths')) {
    mode = 'paths';
    const ps = argv.slice(argv.indexOf('--paths') + 1).filter((a) => !a.startsWith('--'));
    scanned = scanWorkingPaths(findings, ps);
  } else { scanned = scanStaged(findings); }

  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');

  if (has('--json')) {
    console.log(JSON.stringify({ mode, scanned, errors, warns }, null, 1));
  } else {
    if (!has('--quiet')) {
      for (const f of errors) console.error(`[ERROR] ${f.rule} ${f.file}:${f.line} ${f.detail}`);
      const warnShow = warns.slice(0, 50);
      for (const f of warnShow) console.error(`[warn ] ${f.rule} ${f.file}:${f.line} ${f.detail}`);
      if (warns.length > warnShow.length) console.error(`[warn ] ...另有 ${warns.length - warnShow.length} 条 warn 未展开`);
    }
    console.error(`密钥扫描(${mode}): 扫描对象 ${scanned} 个,error ${errors.length},warn ${warns.length}`);
  }
  if (errors.length > 0) {
    console.error('❌ 发现密钥级问题,操作被阻断。处理方式:');
    console.error('   1. 从提交中移除该内容(git restore --staged <file>)');
    console.error('   2. 确认误报则在 security/scan-allowlist.json 登记(路径+行哈希),并在提交说明写明理由');
    // 用 exitCode 而非 process.exit():当 stdout 是管道且 JSON 较大时,
    // process.exit() 会在缓冲区排空前终止进程、截断输出。设 exitCode 让 Node 自然排空后退出。
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

main();
