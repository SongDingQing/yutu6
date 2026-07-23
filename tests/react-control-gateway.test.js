#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'projects', '控制台', 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'projects', '控制台', 'frontend', 'src', 'App.tsx'), 'utf8');
const control = fs.readFileSync(path.join(root, 'projects', '控制台', 'frontend', 'src', 'features', 'control-room', 'ControlRoomView.tsx'), 'utf8');
const gateway = fs.readFileSync(path.join(root, 'projects', '控制台', 'frontend', 'src', 'features', 'gateway', 'GatewayView.tsx'), 'utf8');

assert(server.includes("u.pathname === '/control-room') return serveStatic(res, 'app/index.html')"));
assert(server.includes("u.pathname === '/control-room-legacy') return serveStatic(res, 'control-room.html')"));
assert(server.includes("u.pathname === '/api-gateway') return serveStatic(res, 'app/index.html')"));
assert(server.includes("u.pathname === '/api-gateway-legacy') return serveStatic(res, 'newapi.html')"));
assert(app.includes("lazy(() => import('./features/control-room/ControlRoomView'))"));
assert(app.includes("lazy(() => import('./features/gateway/GatewayView'))"));
assert(control.includes("fetchControlRoomOverview"));
assert(control.includes("probeRunner"));
assert(control.includes("streamRunnerChat"));
assert(control.includes("abortRef.current?.abort()"));
assert(!control.includes('setInterval('));
assert(gateway.includes("fetchModelFabricOverview"));
assert(gateway.includes("fetchModelFabricUsage"));
assert(gateway.includes("fetchNewApiOverview"));
assert(gateway.includes('new-api'));
assert(gateway.includes('sessionStorage'));
assert(gateway.includes('兼容网关维护'));
assert(gateway.includes('用户、租户、充值和分销功能不参与运行'));
assert(!gateway.includes('setInterval('));

console.log(JSON.stringify({ pass: true, suite: 'react-control-gateway' }));
