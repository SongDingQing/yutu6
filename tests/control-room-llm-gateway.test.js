#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'projects/控制台/public/control-room.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
assert(scriptMatch, 'control-room inline script must exist');
new Function(scriptMatch[1]);

assert(html.includes('LLM 网关可观测'), 'control room must expose the LLM gateway observability panel');
assert(html.includes("fetchJson('/api/newapi/usage?days=7&limit=80')"), 'panel must read existing new-api usage source');
assert(html.includes("fetchJson('/api/llm-usage/overview?days=7')"), 'panel must read existing llm-usage overview source');
assert(html.includes("fetchJson('/api/newapi/logs/'+encodeURIComponent(id))"), 'details must be lazy-loaded per row');
assert(html.includes('data-gateway-detail'), 'recent call rows must use explicit lazy detail controls');
assert(html.includes('unknown/unmapped'), 'missing role/session fields must degrade to unknown/unmapped');
assert(html.includes('estimated 为 quota 折算估算'), 'cost display must label estimated quota-derived cost');
assert(html.includes('买断额度显示买断/$0'), 'cost display must call out buyout quota treatment');
assert(html.includes("return 'unknown';"), 'missing cost/latency fields must degrade to unknown');
assert(html.includes('role="region" aria-label="控制室主区" aria-live="polite" aria-busy="true"'), 'main region must have live/busy semantics');
assert(html.includes('role="list" aria-label="按模型聚合的 LLM 网关用量"'), 'model aggregation must expose list semantics');
assert(html.includes('role="list" aria-label="按角色或员工聚合的 LLM 网关用量"'), 'role aggregation must expose list semantics');
assert(html.includes('role="list" aria-label="LLM 网关最近调用列表"'), 'recent calls must expose list semantics');
assert(html.includes('role="listitem" title="${esc(label)}" aria-label="${esc(label)}"'), 'rows must expose full labels');
assert(html.includes('调用详情白名单字段'), 'detail panel must state whitelist-field scope');

for (const forbidden of ['token_name', 'request_id', 'upstream_request_id']) {
  assert(!html.includes(forbidden), `control room must not reference backend metadata field ${forbidden}`);
}
assert(!/\bAuthorization\b/i.test(html), 'control room must not mention Authorization');
assert(!/\bcookie\b/i.test(html), 'control room must not mention cookies');
assert(!/raw key/i.test(html), 'control room must not mention raw keys');
assert(!/prompt\/response|prompt body|response body/i.test(html), 'control room must not mention prompt/response bodies');
assert(!/\bip\b/i.test(html), 'control room must not mention IP metadata');

console.log(JSON.stringify({ pass: true, suite: 'control-room-llm-gateway' }));
