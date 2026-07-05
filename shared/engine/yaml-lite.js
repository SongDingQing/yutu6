'use strict';
/*
 * yaml-lite:只为「声明式 flow 文件」设计的极小 YAML 子集解析器(零依赖)。
 * 支持:顶层 `key: 值` 标量;顶层 `key:` 后跟缩进块(内联 map 列表 或 扁平子 map);
 *       列表项 `- { k: v, ... }` 内联 map;`- 标量`;子 map `key: 值`。
 * 不支持多层嵌套块(flow 用不到)。其它复杂 YAML 请勿喂给它。
 */

function stripComment(line) {
  let out = '', q = null, depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { out += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; out += c; continue; }
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
    if (c === '#' && depth === 0 && (i === 0 || /\s/.test(line[i - 1]))) break;
    out += c;
  }
  return out.replace(/\s+$/, '');
}

function parseScalar(v) {
  if (v == null) return null;
  v = v.trim();
  if (v === '') return null;
  if ((v[0] === '"' && v.slice(-1) === '"') || (v[0] === "'" && v.slice(-1) === "'")) return v.slice(1, -1);
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  return v;
}

// 在顶层(花括号/引号外)按逗号切
function splitTop(s, sep) {
  const parts = []; let cur = '', q = null, depth = 0;
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
    if (c === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

function parseInlineMap(s) {
  s = s.trim().replace(/^\{/, '').replace(/\}$/, '');
  const obj = {};
  for (const kv of splitTop(s, ',')) {
    const idx = kv.indexOf(':');
    if (idx === -1) continue;
    const k = kv.slice(0, idx).trim();
    obj[k] = parseScalar(kv.slice(idx + 1));
  }
  return obj;
}

function indentOf(line) { return line.length - line.replace(/^ +/, '').length; }

function parse(text) {
  const raw = text.split('\n').map(stripComment).filter(l => l.trim() !== '');
  const root = {};
  let i = 0;
  while (i < raw.length) {
    const line = raw[i];
    if (indentOf(line) !== 0) { i++; continue; }
    const m = line.match(/^([\w-]+):(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1]; const rest = m[2].trim();
    if (rest !== '') { root[key] = parseScalar(rest); i++; continue; }
    // 收集缩进块
    const block = []; i++;
    while (i < raw.length && indentOf(raw[i]) > 0) { block.push(raw[i]); i++; }
    if (block.length && block[0].trim().startsWith('-')) {
      root[key] = block.map(b => {
        const item = b.trim().replace(/^-\s*/, '');
        return item.startsWith('{') ? parseInlineMap(item) : parseScalar(item);
      });
    } else {
      const obj = {};
      for (const b of block) {
        const mm = b.trim().match(/^([\w-]+):(.*)$/);
        if (mm) obj[mm[1]] = parseScalar(mm[2]);
      }
      root[key] = obj;
    }
  }
  return root;
}

module.exports = { parse, parseScalar, parseInlineMap };
