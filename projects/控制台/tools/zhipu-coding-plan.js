#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ZhipuCodingPlan = require('../../../shared/model-fabric/zhipu-coding-plan');

const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(ROOT, '..', '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const RUNNERS_FILE = path.join(WORKSPACE, 'shared', 'routing', 'runners.yaml');
const ROUTING_FILE = path.join(WORKSPACE, 'shared', 'routing', 'model-routing.yaml');
const FABRIC_FILE = path.join(ROOT, 'config', 'model-fabric.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function staticChecks() {
  const config = readJson(CONFIG_FILE);
  const errors = [];
  for (const id of ['zhipu-glm', 'zhipu-board-direct']) {
    const runner = config.runners && config.runners[id];
    if (!runner) errors.push(`missing runner ${id}`);
    else errors.push(...ZhipuCodingPlan.validateRunner(runner).map(item => `${id}: ${item}`));
  }
  const runnersText = fs.readFileSync(RUNNERS_FILE, 'utf8');
  const routingText = fs.readFileSync(ROUTING_FILE, 'utf8');
  if (!runnersText.includes(`base_url: "${ZhipuCodingPlan.BASE_URL}"`)) errors.push('runners.yaml lacks fixed Coding Plan base_url');
  if (/id:\s*zhipu-glm[\s\S]{0,600}new_api:/m.test(runnersText)) errors.push('zhipu-glm still routes through new-api');
  if (!/zhipu:\s*\{\s*via:\s*coding-plan-direct\b/m.test(routingText)) errors.push('model-routing zhipu provider is not coding-plan-direct');
  const fabric = readJson(FABRIC_FILE);
  const provider = (fabric.providers || []).find(item => item.id === 'zhipu-coding-plan');
  if (!provider || provider.base_url !== ZhipuCodingPlan.BASE_URL) errors.push('model-fabric direct provider missing or drifted');
  return errors;
}

async function smoke() {
  const result = await ZhipuCodingPlan.requestChatCompletion({
    prompt: '只回复 OK',
    temperature: 0,
    maxTokens: 16,
    maxAttempts: 4,
  });
  if (!result.ok) {
    const error = new Error('GLM Coding Plan smoke failed');
    error.code = result.errorClass;
    error.status = result.status;
    error.providerCode = result.providerCode;
    error.attempts = result.attempts;
    throw error;
  }
  const body = result.body;
  const usage = body && body.usage || {};
  return {
    ok: true,
    contract: ZhipuCodingPlan.CONTRACT_ID,
    endpoint: ZhipuCodingPlan.BASE_URL,
    model: body.model || ZhipuCodingPlan.MODEL,
    http_status: result.status,
    attempts: result.attempts,
    usage_fields: Object.keys(usage).sort(),
  };
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'check';
  const errors = staticChecks();
  if (errors.length) {
    process.stdout.write(`${JSON.stringify({ ok: false, command, errors }, null, 2)}\n`);
    return 1;
  }
  if (command === 'check') {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      command,
      contract: ZhipuCodingPlan.CONTRACT_ID,
      endpoint: ZhipuCodingPlan.BASE_URL,
      model: ZhipuCodingPlan.MODEL,
      token_key: ZhipuCodingPlan.TOKEN_KEY,
    }, null, 2)}\n`);
    return 0;
  }
  if (command === 'smoke') {
    try {
      process.stdout.write(`${JSON.stringify(await smoke(), null, 2)}\n`);
      return 0;
    } catch (error) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        command,
        error_class: error.code || 'unknown',
        http_status: error.status || null,
        provider_code: error.providerCode || null,
        attempts: error.attempts || 0,
      }, null, 2)}\n`);
      return 1;
    }
  }
  process.stderr.write('usage: zhipu-coding-plan.js [check|smoke]\n');
  return 2;
}

if (require.main === module) main().then(code => { process.exitCode = code; });

module.exports = { staticChecks, smoke, main };
