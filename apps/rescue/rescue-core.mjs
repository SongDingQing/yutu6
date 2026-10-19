import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const atomic = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(tmp, text, { mode: 0o600 }); fs.renameSync(tmp, file); };
const forbidden = /(^|\/)(data|credentials|secrets|memory|sessions|chat-assets|ops|rescue|\.git|node_modules)(\/|$)|(^|\/)(config\.json|.*\.env|.*\.token)$/i;

export function createRescueCore(config, { command, health } = {}) {
  fs.mkdirSync(path.resolve(config.rescueHome), { recursive: true, mode: 0o700 });
  const root = fs.realpathSync(config.appRoot), home = fs.realpathSync(config.rescueHome);
  if (root === home) throw new Error('救援目录不能等于主程序目录');
  const allowed = new Set(config.editableFiles || []);
  for (const name of allowed) {
    if (typeof name !== 'string' || !name || path.posix.normalize(name) !== name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || forbidden.test(name)) throw new Error('可修改清单包含受保护或无效路径');
  }
  if (!allowed.size || allowed.size > 1000) throw new Error('请由主人配置1至1000个可修改的程序文件');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const journal = path.join(home, 'progress.json');
  let data = { schema: 1, phase: 'idle', revision: 0, inputs: [], events: [], staged: {}, baseline: {}, backup: {}, verifiedHash: null };
  if (fs.existsSync(journal)) {
    data = JSON.parse(fs.readFileSync(journal, 'utf8'));
    if (data.schema !== 1) throw new Error('救援进度版本不兼容');
    if (['checking', 'applying', 'restarting'].includes(data.phase)) data.phase = 'recovery-required';
  }
  const persist = () => { data.revision++; atomic(journal, JSON.stringify(data)); };
  const event = (phase, message) => { data.phase = phase; data.events.push({ id: crypto.randomUUID(), time: new Date().toISOString(), phase, message }); data.events = data.events.slice(-200); persist(); };
  const authorize = (actor, capability) => {
    const row = (config.actors || []).find(a => a.id === actor);
    if (!row || row[capability] !== true) throw new Error('此维修身份没有该操作权限');
    return row;
  };
  const safe = (base, name) => {
    if (!allowed.has(name)) throw new Error('文件不在主人允许的程序清单内');
    const file = path.resolve(base, name);
    if (path.resolve(base) === root && (file === home || file.startsWith(home + path.sep)) || !file.startsWith(path.resolve(base) + path.sep)) throw new Error('不能修改救援宿主或目录外文件');
    let current = path.resolve(base);
    for (const part of name.split('/')) {
      current = path.join(current, part);
      try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('维修路径不能经过符号链接'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return file;
  };
  const bytes = file => fs.existsSync(file) ? fs.readFileSync(file) : null;
  const digest = file => { const b = bytes(file); return b === null ? null : sha256(b); };
  const candidateHash = () => sha256(JSON.stringify(Object.entries(data.staged).sort()));
  const stageRoot = path.join(home, 'candidate');
  let busy = false;
  const exclusive = async run => { if (busy) throw new Error('已有维修操作进行中'); busy = true; try { return await run(); } finally { busy = false; } };
  const run = command || (async (name, cwd) => {
    const args = config.commands?.[name];
    if (!Array.isArray(args) || !args.length || !path.isAbsolute(args[0]) || !args.every(s => typeof s === 'string')) throw new Error('主人尚未配置固定的核验/重启命令');
    // Commands are owner configuration, never model text. Do not forward API/token environment variables.
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    return new Promise((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), { cwd, env, windowsHide: true, shell: false, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error('固定维修命令超时，需核对是否仍有子进程'), { uncertain: true })); }, Math.min(120000, config.commandTimeoutMs || 30000));
      child.once('error', e => { clearTimeout(timer); reject(new Error('固定维修命令无法启动')); });
      child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`固定维修命令退出码 ${code}`)); });
    });
  });
  const healthy = health || (async () => {
    if (!config.healthExpected || !Object.keys(config.healthExpected).length) throw new Error('主人尚未配置主程序健康身份，不能把任意HTTP成功当作修复');
    const url = new URL(config.healthUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('健康检查必须指向固定本机接口');
    for (let i = 0; i < 10; i++) {
      try { const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1000) }); const b = await r.json(); if (r.ok && b.ok === true && Object.entries(config.healthExpected).every(([k,v]) => b[k] === v)) return true; } catch { /* bounded restart grace period */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  });
  const restore = async () => {
    for (const [name, item] of Object.entries(data.backup)) {
      const to = safe(root, name);
      if (item.exists) { const from = path.join(home, 'backup', name); if (digest(from) !== item.sha256) throw new Error('程序备份已变化，停止回滚'); atomic(to, fs.readFileSync(from)); }
      else if (fs.existsSync(to)) fs.rmSync(to);
    }
    await run('start', root);
    const ok = await healthy(); event(ok ? 'rolled-back' : 'recovery-required', ok ? '已恢复上一份程序并核验健康' : '已恢复程序文件，但服务健康未确认');
    return { ok, phase: data.phase };
  };
  return {
    status() { return structuredClone({ phase: data.phase, revision: data.revision, busy, editableFiles: [...allowed], stagedFiles: Object.keys(data.staged), inputs: data.inputs.slice(-100), events: data.events }); },
    input(text) { if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw new Error('请输入1至8000字的补充要求'); data.inputs.push({ id: crypto.randomUUID(), time: new Date().toISOString(), text: text.trim() }); data.inputs = data.inputs.slice(-100); persist(); return { accepted: true, revision: data.revision }; },
    note(actor, text) { authorize(actor, 'read'); if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('进展说明过长或为空'); event(data.phase, text); return { accepted: true }; },
    read(actor, name) { authorize(actor, 'read'); const file = safe(root, name), b = bytes(file); if (b?.length > 1024 * 1024) throw new Error('程序文件超过1MiB，请拆分核查'); return { file: name, sha256: b === null ? null : sha256(b), text: b?.toString('utf8') || '' }; },
    stage(actor, name, text, expectedHash) {
      authorize(actor, 'write'); if (busy || data.phase === 'recovery-required') throw new Error('维修忙碌或中断状态待核验');
      if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) throw new Error('暂存文件超过1MiB或格式无效');
      const file = safe(root, name);
      if (digest(file) !== expectedHash) throw new Error('原程序已变化，请重新读取；不会覆盖其他修改');
      if (['completed', 'rolled-back'].includes(data.phase)) { fs.rmSync(stageRoot, { recursive: true, force: true }); data.staged = {}; data.baseline = {}; }
      if (!fs.existsSync(stageRoot)) {
        for (const item of allowed) { const from = safe(root, item), b = bytes(from); if (b !== null) atomic(safe(stageRoot, item), b); }
      }
      data.baseline[name] = expectedHash; atomic(safe(stageRoot, name), text); data.staged[name] = sha256(text); data.verifiedHash = null;
      event('staged', `已暂存 ${name}，尚未改动运行程序`); return { staged: true, sha256: data.staged[name] };
    },
    check(actor) { authorize(actor, 'write'); return exclusive(async () => {
      if (!Object.keys(data.staged).length || data.phase === 'recovery-required') throw new Error('没有候选或上次操作未确认');
      data.checkedBaseline = Object.fromEntries([...allowed].map(name => [name, digest(safe(root, name))]));
      event('checking', '正在用固定命令核验候选');
      try { await run('check', stageRoot); for (const [name, hash] of Object.entries(data.staged)) if (digest(safe(stageRoot, name)) !== hash) throw new Error('核验期间候选文件变化'); data.verifiedHash = candidateHash(); event('checked', '候选核验通过；尚未重启主程序'); return { checked: true }; }
      catch { data.verifiedHash = null; event('staged', '候选核验失败，运行程序未改动'); throw new Error('候选核验失败，运行程序未改动'); }
    }); },
    apply(actor) { authorize(actor, 'activate'); return exclusive(async () => {
      if (config.activationEnabled !== true) throw new Error('生产激活默认关闭；需主人完成独立宿主安装与权限验收');
      if (data.phase !== 'checked' || data.verifiedHash !== candidateHash()) throw new Error('候选未核验或已变化');
      for (const [name, hash] of Object.entries(data.checkedBaseline || {})) if (digest(safe(root, name)) !== hash) throw new Error('核验依赖的程序已变化，请重新核验');
      for (const [name, hash] of Object.entries(data.staged)) {
        if (digest(safe(root, name)) !== data.baseline[name] || digest(safe(stageRoot, name)) !== hash) throw new Error('候选或运行程序已变化，未开始重启');
      }
      data.backup = {};
      for (const name of Object.keys(data.staged)) { const b = bytes(safe(root, name)); data.backup[name] = { exists: b !== null, sha256: b === null ? null : sha256(b) }; if (b !== null) atomic(path.join(home, 'backup', name), b); }
      event('applying', '备份已落盘，正在停止固定主程序');
      try {
        await run('stop', root);
        for (const name of Object.keys(data.staged)) atomic(safe(root, name), fs.readFileSync(safe(stageRoot, name)));
        event('restarting', '候选已安装，正在重启并检查健康'); await run('start', root);
        if (!await healthy()) throw new Error('新程序健康检查失败');
        event('completed', '新程序健康检查通过；对话与记忆未参与替换'); return { ok: true, phase: data.phase };
      } catch (error) {
        event('recovery-required', '重启或健康检查失败，正在恢复程序');
        if (error.uncertain) throw new Error('重启命令超时，进程状态未确认；不会盲目叠加重启或回滚');
        try { await run('stop', root); return await restore(); } catch { event('recovery-required', '回滚未确认，请用独立远程维修通道核查'); throw new Error('回滚未确认，主程序状态未知'); }
      }
    }); },
    rollback(actor) { authorize(actor, 'activate'); return exclusive(async () => {
      if (!Object.keys(data.backup).length) throw new Error('没有本次受管程序备份'); await run('stop', root); return restore();
    }); },
  };
}
