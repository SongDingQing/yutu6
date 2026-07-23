'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'projects/控制台/frontend/src/features/tasks/TaskBoard.tsx');
const source = fs.readFileSync(file, 'utf8');

assert(source.includes("type BoardMode = 'running' | 'queue' | 'decision' | 'past'"));
assert(source.includes('label="待拍板" count={rows.decision.length}'));
assert(source.includes('queue: [...rootQueued, ...waitingQueue]'));
assert(source.includes('decision: candidates'));
assert(!source.includes('queue: [...rootQueued, ...waitingQueue, ...candidates]'));

console.log(JSON.stringify({ pass: true, suite: 'react-taskboard-candidate-separation' }));
