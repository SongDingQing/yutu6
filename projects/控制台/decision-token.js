'use strict';
/*
 * 玉兔6 · 飞书决策卡回调 token(拍板 Q12,老板 6/29 遗留指令)。
 * 老板原话:"飞书卡片拍板的意思是直接把两个选项作为两个按钮,这样我按了就相当于决策"。
 * token = HMAC-SHA256(secret, `${cardId}:${action}`) 的 hex;
 * secret 每卡随机生成,存进卡片记录(bulletin cards.json / 决策留痕文件),不回显日志、不写事件。
 * 已知边界:控制台只绑 127.0.0.1,手机点飞书按钮暂时不可达(LAN/桥接排后),不要擅自改绑定。
 */
const crypto = require('crypto');

function newSecret() {
  return crypto.randomBytes(16).toString('hex');
}

function sign(secret, cardId, action) {
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(`${String(cardId || '')}:${String(action || '')}`)
    .digest('hex');
}

function verify(secret, cardId, action, token) {
  if (!secret || !token) return false;
  const expected = Buffer.from(sign(secret, cardId, action), 'utf8');
  const given = Buffer.from(String(token), 'utf8');
  if (expected.length !== given.length) return false;
  try {
    return crypto.timingSafeEqual(expected, given);
  } catch (_) {
    return false;
  }
}

function buttonUrl(baseUrl, cardId, action, secret) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base}/api/decision/${encodeURIComponent(String(cardId || ''))}/${action}?t=${sign(secret, cardId, action)}`;
}

module.exports = { newSecret, sign, verify, buttonUrl };
