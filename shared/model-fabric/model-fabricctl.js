#!/usr/bin/env node
'use strict';

const base = String(process.env.YUTU6_FABRIC_URL || 'http://127.0.0.1:3020').replace(/\/$/, '');
const command = process.argv[2] || 'diagnostics';
const routes = {
  status: '/api/fabric/ready',
  overview: '/api/fabric/overview',
  diagnostics: '/api/fabric/diagnostics',
  health: '/api/fabric/health/run',
};

async function main() {
  const path = routes[command];
  if (!path) throw new Error(`unknown command: ${command}`);
  const response = await fetch(`${base}${path}`, { method: command === 'health' ? 'POST' : 'GET' });
  const body = await response.json();
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  if (!response.ok) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`[model-fabricctl] ${error.message}\n`);
  process.exitCode = 1;
});
