import fs from 'node:fs';

const idPattern = /^[a-z][a-z0-9_-]{0,63}$/;
export function validateProviders(input) {
  if (input?.schema !== 1 || !Array.isArray(input.providers) || !Array.isArray(input.models)) throw new Error('模型提供配置需要 schema=1、providers 和 models');
  const ids = new Set();
  const providers = input.providers.map(p => {
    if (!idPattern.test(p.id || '') || ids.has(p.id)) throw new Error('模型提供商ID无效或重复');
    ids.add(p.id);
    if (Object.keys(p).some(k => /^(api_?key|token|password|secret)$/i.test(k))) throw new Error('配置不能内嵌密钥，请使用 apiKeyEnv');
    const url = new URL(p.baseUrl);
    if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)) throw new Error('模型地址不能携带凭据或查询参数');
    if (url.protocol === 'http:' && !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) throw new Error('非本机模型接口必须使用HTTPS或受控SSH隧道');
    if (p.apiKeyEnv && !/^[A-Z_][A-Z0-9_]{0,127}$/.test(p.apiKeyEnv)) throw new Error('apiKeyEnv 必须是环境变量名称');
    if (!p.apiKeyEnv && p.auth !== 'none') throw new Error('请声明 apiKeyEnv；无认证本地接口需显式 auth=none');
    return { id: p.id, baseUrl: url.href.replace(/\/$/, ''), apiKeyEnv: p.apiKeyEnv || '', auth: p.auth === 'none' ? 'none' : 'bearer' };
  });
  const modelIds = new Set();
  const models = input.models.map(m => {
    if (!idPattern.test(m.id || '') || modelIds.has(m.id) || !ids.has(m.provider)) throw new Error('模型ID重复或提供商未登记');
    modelIds.add(m.id);
    if (typeof m.model !== 'string' || !m.model.trim() || m.model.length > 160) throw new Error('请提供真实上游模型名称');
    return { id: m.id, provider: m.provider, model: m.model, label: String(m.label || m.id).slice(0, 100),
      capabilities: { text: true, vision: m.capabilities?.vision === true, tools: m.capabilities?.tools === true } };
  });
  return { schema: 1, standalone: input.standalone === true, providers, models };
}
export function readProviders(file) {
  return file ? validateProviders(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
}
export function providerTargets(config) {
  return (config?.models || []).map(m => ({ id: `pool:api-${m.id}`, group: '独立模型接口', label: m.label,
    summary: '独立提供商 · 凭据仅由宿主读取', mode: 'pool', model: m.model, providerModelId: m.id,
    capabilities: { ...m.capabilities, textFiles: true, browserOpen: true, speechOutput: true } }));
}
export async function providerRequest(config, modelId, payload, { env = process.env, fetchImpl = fetch, signal, timeoutMs = 240000 } = {}) {
  const m = config.models.find(m => m.id === modelId), p = config.providers.find(p => p.id === m?.provider);
  if (!m || !p) throw new Error('所选独立模型未登记');
  const key = p.apiKeyEnv ? env[p.apiKeyEnv] : '';
  if (p.auth !== 'none' && !key) throw new Error(`模型凭据尚未配置：${p.apiKeyEnv}`);
  if (key && /[\r\n]/.test(key)) throw new Error('模型凭据格式无效');
  const body = { ...payload, model: m.model };
  if (!m.capabilities.tools && body.tools?.length) throw new Error('此提供商模型未声明工具调用能力');
  if (!m.capabilities.vision && body.messages?.some(msg => Array.isArray(msg.content) && msg.content.some(c => c.type === 'image_url'))) throw new Error('此提供商模型未声明视觉输入能力');
  try {
    const response = await fetchImpl(`${p.baseUrl}/chat/completions`, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`模型接口返回HTTP ${response.status}；未记录响应正文`); }
    return response;
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new Error('模型调用已取消或超时');
    if (/^模型接口返回HTTP/.test(error.message)) throw error;
    throw new Error('无法连接独立模型接口，请检查网络和提供商配置');
  }
}
