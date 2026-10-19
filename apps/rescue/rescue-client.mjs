import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Owner-managed connection file. The agent sends JSON operations over stdin,
// never arbitrary SSH commands or host/program selections in a tool payload.
const name = process.argv[process.argv.indexOf('--connection') + 1];
if (!process.argv.includes('--connection') || !name) throw new Error('使用 --connection 指定独立维修连接配置');
const c = JSON.parse(fs.readFileSync(name, 'utf8'));
const token = process.env[c.tokenEnv];
if (!token || token.length < 24) throw new Error('独立维修令牌未配置');
const port = c.port || 48950;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口无效');
let tunnel;
try {
  if (c.kind === 'ssh') {
    if (!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]+$/.test(c.target) || !path.isAbsolute(c.identityFile)) throw new Error('SSH目标/密钥路径无效');
    tunnel = spawn('ssh', ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=8', '-i', c.identityFile, '-L', `127.0.0.1:${port}:127.0.0.1:${port}`, c.target], { windowsHide: true, stdio: 'ignore' });
    let failed = false; tunnel.on('error', () => { failed = true; }); tunnel.on('exit', () => { failed = true; });
    let ready = false;
    for (let i = 0; i < 30 && !failed; i++) { await new Promise(r => setTimeout(r, 300)); if (failed) break; try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) }); ready = (await r.json()).service === 'yutu-independent-rescue'; if (ready) break; } catch {} }
    if (!ready || failed) throw new Error('固定SSH隧道未就绪；请核对设备网络和主机指纹');
  } else if (c.kind !== 'local') throw new Error('只支持local或固定SSH回环隧道');
  let source = ''; for await (const b of process.stdin) { source += b; if (Buffer.byteLength(source) > 1200000) throw new Error('请求过大'); }
  const body = source ? JSON.parse(source) : null;
  const r = await fetch(`http://127.0.0.1:${port}${body ? '/api/repair' : '/api/state'}`, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(240000) });
  const value = await r.json(); console.log(JSON.stringify(value)); if (!r.ok) process.exitCode = 1;
} finally { tunnel?.kill(); }
