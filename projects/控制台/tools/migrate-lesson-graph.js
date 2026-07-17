#!/usr/bin/env node
'use strict';

const path = require('path');
const LessonGraph = require('../lesson-graph-adapter');

const workspaceRoot = path.resolve(__dirname, '../../..');
const result = LessonGraph.migrateLessonGraph({
  dbPath: process.env.XJ_KB_PATH || path.join(workspaceRoot, 'knowledge', 'kb.sqlite'),
  snapshotDir: process.env.LESSON_GRAPH_SNAPSHOT_DIR || path.join(workspaceRoot, 'projects', '控制台', 'artifacts', 'canary', 'lesson-graph-migration'),
  snapshot: process.env.LESSON_GRAPH_SKIP_SNAPSHOT !== '1',
});

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
