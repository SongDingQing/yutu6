#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const LessonGraph = require('../projects/控制台/lesson-graph-adapter');

const ROOT = path.resolve(__dirname, '..');
const ADAPTER = path.join(ROOT, 'projects', '控制台', 'lesson-graph-adapter.js');
const QUERY = path.join(ROOT, 'knowledge', 'query.py');

function createLegacyDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE documents(id INTEGER PRIMARY KEY,path TEXT UNIQUE NOT NULL,title TEXT,hash TEXT,mtime REAL);
    CREATE TABLE chunks(id INTEGER PRIMARY KEY,doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,ord INTEGER,text TEXT NOT NULL);
    CREATE VIRTUAL TABLE chunks_fts USING fts5(text,content='chunks',content_rowid='id',tokenize='unicode61');
    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN INSERT INTO chunks_fts(rowid,text) VALUES(new.id,new.text); END;
    CREATE TABLE entities(id INTEGER PRIMARY KEY,name TEXT NOT NULL,type TEXT,summary TEXT,UNIQUE(name,type));
    CREATE TABLE relations(
      id INTEGER PRIMARY KEY,
      src INTEGER NOT NULL REFERENCES entities(id),
      dst INTEGER NOT NULL REFERENCES entities(id),
      type TEXT,weight REAL DEFAULT 1.0,status TEXT DEFAULT 'active',
      evidence INTEGER REFERENCES chunks(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_rel_src ON relations(src);
    CREATE INDEX idx_rel_dst ON relations(dst);
    CREATE TABLE mentions(
      entity_id INTEGER REFERENCES entities(id),
      chunk_id INTEGER REFERENCES chunks(id) ON DELETE CASCADE,
      PRIMARY KEY(entity_id,chunk_id)
    );
    CREATE TABLE relation_provenance(
      id INTEGER PRIMARY KEY,
      relation_id INTEGER REFERENCES relations(id) ON DELETE CASCADE
    );
    PRAGMA user_version=7;
  `);
  db.close();
}

function queryOne(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath);
  try { return db.prepare(sql).get(...params); } finally { db.close(); }
}

function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: Object.assign({}, process.env, options.env || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function addGraphFixture(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  try {
    const entity = db.prepare('INSERT INTO entities(name,type) VALUES(?,?) RETURNING id');
    const ids = {};
    for (const name of [
      'graph-a', 'graph-b', 'graph-c', 'graph-d', 'graph-x', 'graph-z',
      'cycle-a', 'cycle-b', 'cycle-c', 'missing-a', 'missing-b',
    ]) {
      ids[name] = Number(entity.get(name, 'graph_fixture').id);
    }
    const relation = db.prepare('INSERT INTO relations(src,dst,type,status) VALUES(?,?,?,?) RETURNING id');
    const provenance = db.prepare(`
      INSERT INTO relation_provenance(
        relation_id,project_id,source_path,source_anchor,source_hash,
        task_id,queue_id,root_task_id,root_queue_id,idempotency_key,
        evidence_excerpt,review_status,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const edges = [
      ['graph-a', 'graph-b', 'active'],
      ['graph-b', 'graph-c', 'active'],
      ['graph-c', 'graph-d', 'active'],
      ['graph-x', 'graph-a', 'active'],
      ['graph-a', 'graph-z', 'deprecated'],
      ['cycle-a', 'cycle-b', 'active'],
      ['cycle-b', 'cycle-c', 'active'],
      ['cycle-c', 'cycle-a', 'active'],
    ];
    edges.forEach(([src, dst, status], index) => {
      const rel = relation.get(ids[src], ids[dst], 'fixture_edge', status);
      provenance.run(
        Number(rel.id), '控制台', 'memory/experience.md', `memory/experience.md:L${900 + index}`,
        `source-hash-${index}`, 'task-graph', 'queue-graph', 'root-task-graph', 'root-queue-graph',
        `fixture-idem-${index}`, `evidence ${src} to ${dst}`, 'pending', '2026-07-10T00:00:00.000Z',
      );
    });
    relation.get(ids['missing-a'], ids['missing-b'], 'fixture_missing_evidence', 'active');
    const docId = Number(db.prepare('INSERT INTO documents(path,title) VALUES(?,?) RETURNING id').get('fixture.md', 'fixture').id);
    db.prepare('INSERT INTO chunks(doc_id,ord,text) VALUES(?,?,?)').run(docId, 0, 'default sentinel retrieval text');
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    db.close();
  }
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-graph-canary-'));
  const dbPath = path.join(temp, 'kb.sqlite');
  const snapshotDir = path.join(temp, 'snapshots');
  const auditFile = path.join(temp, 'artifacts', 'lesson-graph-audit.jsonl');
  const memoryDir = path.join(temp, 'memory');
  const memoryFile = path.join(memoryDir, 'experience.md');
  fs.mkdirSync(memoryDir, { recursive: true });
  const initialMemory = '# 经验库 · 成功模式 + 失败教训\n\n> 更新于 2026-07-09\n\n已有历史,不得回填。\n';
  fs.writeFileSync(memoryFile, initialMemory);
  createLegacyDb(dbPath);

  try {
    const firstMigration = LessonGraph.migrateLessonGraph({ dbPath, snapshotDir });
    assert(firstMigration.snapshotPath && fs.existsSync(firstMigration.snapshotPath), '迁移前快照应存在');
    assert(firstMigration.addedColumns.includes('project_id'), '部分旧表应通过 PRAGMA table_info 增量补列');
    const secondMigration = LessonGraph.migrateLessonGraph({ dbPath, snapshot: false });
    assert.deepStrictEqual(secondMigration.addedColumns, [], '重复迁移不得重复加列');
    assert.strictEqual(queryOne(dbPath, 'PRAGMA user_version').user_version, 7, '增量迁移不得降低既有 user_version');
    const provenanceColumns = queryOne(dbPath, "SELECT COUNT(*) AS count FROM pragma_table_info('relation_provenance')");
    assert(provenanceColumns.count >= 16, 'relation_provenance 字段应完整');

    const rewrittenSourceState = LessonGraph.captureSourceState({ workspaceRoot: temp });
    fs.writeFileSync(memoryFile, `${initialMemory.replace('已有历史,不得回填。', '已有历史,已被改写。')}\n- **伪追加教训**\n  - 根因:根因伪\n  - 做法:做法伪\n`);
    assert.throws(
      () => LessonGraph._test.appendedLessons(rewrittenSourceState),
      /memory-source-not-append-only/,
      '真实引用式日期以外的既有正文改写仍必须拒绝,不得伪装为追加教训',
    );
    fs.writeFileSync(memoryFile, initialMemory);

    const sourceState = LessonGraph.captureSourceState({ workspaceRoot: temp });
    const fakeCredential = 'fixture-' + 'credential-value';
    fs.writeFileSync(memoryFile, fs.readFileSync(memoryFile, 'utf8').replace('更新于 2026-07-09', '更新于 2026-07-10'));
    fs.appendFileSync(memoryFile, [
      '',
      '- **灰度教训一**',
      `  - 根因:根因A token=${fakeCredential}`,
      '  - 做法(可验证):做法B',
      '',
      '- **灰度教训二**',
      `  - 根因:根因A token=${fakeCredential}`,
      '  - 做法:做法B',
      '',
    ].join('\n'));
    const spec = {
      flowId: 'agent-once', role: 'memory_officer', projectId: '控制台', queueAgent: 'memory-officer',
      taskId: 'task-canary', queueId: 'queue-canary', rootTaskId: 'root-task', rootQueueId: 'root-queue',
    };
    assert.strictEqual(
      LessonGraph.captureCanaryState({ workspaceRoot: temp, spec, env: { CONSOLE_LESSON_GRAPH_CANARY: '0' } }),
      null,
      '关闭开关后不得捕获或新增灰度教训',
    );
    const applied = LessonGraph.applyCanaryAfterMemory({
      workspaceRoot: temp, dbPath, auditFile, sourceState, spec,
    });
    assert.strictEqual(applied.ok, true, `真实“> 更新于 …”日期更新后追加教训应成功入图: ${JSON.stringify(applied)}`);
    assert.strictEqual(applied.candidates, 2);
    assert.strictEqual(applied.insertedEdges, 1, '重复规范边只应插入一次');
    assert.strictEqual(applied.insertedProvenance, 2, '同一边应允许两条来源');
    assert.strictEqual(queryOne(dbPath, 'SELECT COUNT(*) AS count FROM relations').count, 1);

    assert.strictEqual(queryOne(dbPath, 'SELECT COUNT(*) AS count FROM relation_provenance').count, 2);

    const storedNames = queryOne(dbPath, "SELECT group_concat(name,' ') AS names FROM entities").names;
    assert(!storedNames.includes(fakeCredential), '图谱实体不得保存脱敏前凭据');
    assert(storedNames.includes('[REDACTED]'), '图谱实体应复用 memory 脱敏结果');
    const storedEvidence = queryOne(dbPath, "SELECT group_concat(evidence_excerpt,' ') AS evidence FROM relation_provenance").evidence;
    assert(!storedEvidence.includes(fakeCredential), 'provenance evidence 不得保存脱敏前凭据');
    assert(storedEvidence.includes('[REDACTED]'), 'provenance evidence 应复用 memory 脱敏结果');
    const sourceHashes = queryOne(dbPath, "SELECT MIN(length(source_hash)) AS min_len,MAX(length(source_hash)) AS max_len FROM relation_provenance");
    assert.strictEqual(sourceHashes.min_len, 64, 'source_hash 最短值必须为 SHA-256');
    assert.strictEqual(sourceHashes.max_len, 64, 'source_hash 最长值必须为 SHA-256,不得成为原文旁路');

    const retried = LessonGraph.applyCanaryAfterMemory({
      workspaceRoot: temp, dbPath, auditFile, sourceState, spec,
    });
    assert.strictEqual(retried.ok, true);
    assert.strictEqual(retried.insertedEdges, 0);
    assert.strictEqual(retried.insertedProvenance, 0, '同一提交安全重试不得新增 provenance');
    assert.strictEqual(queryOne(dbPath, 'SELECT COUNT(*) AS count FROM relations').count, 1);
    assert.strictEqual(queryOne(dbPath, 'SELECT COUNT(*) AS count FROM relation_provenance').count, 2);

    const rejectedEdgeInput = {
      projectId: '控制台', sourcePath: 'memory/experience.md', taskId: 'manual-reject-1',
      lessons: [{
        rootCause: 'manual-reject-root', practice: 'manual-reject-action',
        sourceAnchor: 'memory/experience.md:L750', sourceHash: 'manual-reject-source-1', evidenceExcerpt: 'manual reject evidence one',
      }],
    };
    LessonGraph.writeLessons(rejectedEdgeInput, { dbPath });
    const rejectDb = new DatabaseSync(dbPath);
    rejectDb.prepare(`
      UPDATE relations SET status='deprecated'
      WHERE id=(
        SELECT r.id FROM relations r JOIN entities e ON e.id=r.src
        WHERE e.name='manual-reject-root'
      )
    `).run();
    rejectDb.close();
    rejectedEdgeInput.taskId = 'manual-reject-2';
    rejectedEdgeInput.lessons[0].sourceAnchor = 'memory/experience.md:L751';
    rejectedEdgeInput.lessons[0].sourceHash = 'manual-reject-source-2';
    rejectedEdgeInput.lessons[0].evidenceExcerpt = 'manual reject evidence two';
    LessonGraph.writeLessons(rejectedEdgeInput, { dbPath });
    assert.strictEqual(
      queryOne(dbPath, `
        SELECT r.status FROM relations r JOIN entities e ON e.id=r.src
        WHERE e.name='manual-reject-root'
      `).status,
      'deprecated',
      '重复来源不得自动复活已被人工否决的边',
    );

    assert.throws(() => LessonGraph.writeLessons({
      projectId: '控制台', sourcePath: 'memory/experience.md', taskId: 'rollback-task',
      lessons: [{ rootCause: 'rollback-root', practice: 'rollback-action', sourceAnchor: 'memory/experience.md:L700', evidenceExcerpt: 'rollback fixture' }],
    }, { dbPath, failAfterEntities: true }), /test-transaction-rollback/);
    assert.strictEqual(queryOne(dbPath, "SELECT COUNT(*) AS count FROM entities WHERE name='rollback-root'").count, 0, '事务失败应回滚图谱写入');
    assert(fs.readFileSync(memoryFile, 'utf8').includes('灰度教训一'), '图谱失败不得覆盖已完成 memory 提炼');

    const concurrentInput = path.join(temp, 'concurrent-input.json');
    fs.writeFileSync(concurrentInput, JSON.stringify({
      projectId: '控制台', sourcePath: 'memory/experience.md', taskId: 'concurrent-task', queueId: 'concurrent-queue',
      lessons: [{
        rootCause: 'concurrent-root', practice: 'concurrent-action',
        sourceAnchor: 'memory/experience.md:L800', sourceHash: 'concurrent-source', evidenceExcerpt: 'concurrent evidence',
      }],
    }));
    const beforeDisabledCli = queryOne(dbPath, "SELECT COUNT(*) AS count FROM relations r JOIN entities e ON e.id=r.src WHERE e.name='concurrent-root'").count;
    const disabledCli = await run(process.execPath, [ADAPTER, 'write-input', '--input', concurrentInput, '--db', dbPath], {
      env: { CONSOLE_LESSON_GRAPH_CANARY: '0' },
    });
    assert.strictEqual(disabledCli.code, 1, '关闭开关时 CLI 维护入口也必须硬拒绝');
    assert(disabledCli.stderr.includes('canary-disabled'));
    assert.strictEqual(
      queryOne(dbPath, "SELECT COUNT(*) AS count FROM relations r JOIN entities e ON e.id=r.src WHERE e.name='concurrent-root'").count,
      beforeDisabledCli,
      '被关闭开关拦截的 CLI 调用不得产生任何边',
    );
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => (
      run(process.execPath, [ADAPTER, 'write-input', '--input', concurrentInput, '--db', dbPath], {
        env: { CONSOLE_LESSON_GRAPH_CANARY: '1' },
      })
    )));
    assert(concurrent.every(item => item.code === 0), '并发适配器进程都应成功或命中幂等');
    assert.strictEqual(queryOne(dbPath, "SELECT COUNT(*) AS count FROM relations r JOIN entities e ON e.id=r.src WHERE e.name='concurrent-root'").count, 1);
    assert.strictEqual(queryOne(dbPath, "SELECT COUNT(*) AS count FROM relation_provenance WHERE task_id='concurrent-task'").count, 1);

    const adapterChain = LessonGraph.writeLessons({
      projectId: '控制台', sourcePath: 'memory/experience.md', taskId: 'adapter-chain-task', queueId: 'adapter-chain-queue',
      lessons: [
        { rootCause: 'adapter-chain-a', practice: 'adapter-chain-b', sourceAnchor: 'memory/experience.md:L850', sourceHash: 'adapter-chain-1', evidenceExcerpt: 'adapter chain one' },
        { rootCause: 'adapter-chain-b', practice: 'adapter-chain-c', sourceAnchor: 'memory/experience.md:L851', sourceHash: 'adapter-chain-2', evidenceExcerpt: 'adapter chain two' },
      ],
    }, { dbPath });
    assert.strictEqual(adapterChain.insertedEdges, 2);
    assert.strictEqual(queryOne(dbPath, "SELECT COUNT(*) AS count FROM entities WHERE name LIKE 'adapter-chain-%'").count, 3, '根因/做法应复用 concept 节点形成多跳链');
    const adapterChainQuery = await run('python3', [QUERY, 'adapter-chain-a', '--graph', '--hops', '2', '--json'], { env: { XJ_KB_PATH: dbPath } });
    const adapterChainJson = JSON.parse(adapterChainQuery.stdout.trim().split('\n').pop());
    assert.strictEqual(adapterChainJson.graph.edges.length, 2, '适配器写入应可形成真实 2 跳链');

    addGraphFixture(dbPath);
    const graph2 = await run('python3', [QUERY, 'graph-a', '--graph', '--hops', '2', '--json'], { env: { XJ_KB_PATH: dbPath } });
    assert.strictEqual(graph2.code, 0, graph2.stderr);
    const graph2Json = JSON.parse(graph2.stdout.trim().split('\n').pop());
    assert.strictEqual(graph2Json.graph.hops, 2);
    assert.strictEqual(graph2Json.graph.edges.length, 2, '2 跳只沿 src→dst active 边');
    assert(!graph2Json.graph.nodes.some(node => node.name === 'graph-x' || node.name === 'graph-z'));
    assert(graph2Json.graph.edges.every(edge => edge.evidence.length > 0), '图边应带 provenance 证据');

    const graph3 = await run('python3', [QUERY, 'graph-a', '--graph', '--hops', '9', '--json'], { env: { XJ_KB_PATH: dbPath } });
    const graph3Json = JSON.parse(graph3.stdout.trim().split('\n').pop());
    assert.strictEqual(graph3Json.graph.hops, 3, 'hops 应夹取到 2/3');
    assert.strictEqual(graph3Json.graph.edges.length, 3);
    const cyclic = await run('python3', [QUERY, 'cycle-a', '--graph', '--hops', '3', '--json'], { env: { XJ_KB_PATH: dbPath } });
    const cyclicJson = JSON.parse(cyclic.stdout.trim().split('\n').pop());
    assert.strictEqual(cyclicJson.graph.edges.length, 3, '环路边只输出一次且遍历应终止');
    assert.strictEqual(cyclicJson.graph.nodes.length, 3, '访问集不得在环路中重复造节点');
    const missingEvidence = await run('python3', [QUERY, 'missing-a', '--graph', '--hops', '2', '--json'], { env: { XJ_KB_PATH: dbPath } });
    const missingEvidenceJson = JSON.parse(missingEvidence.stdout.trim().split('\n').pop());
    assert.strictEqual(missingEvidenceJson.graph.edges.length, 1);
    assert.deepStrictEqual(missingEvidenceJson.graph.edges[0].evidence, [], '缺失证据应明确返回空数组而非伪造来源');
    const capped = await run('python3', [QUERY, 'graph-a', '--graph', '--hops', '3', '--max-edges', '1', '--json'], { env: { XJ_KB_PATH: dbPath } });
    const cappedJson = JSON.parse(capped.stdout.trim().split('\n').pop());
    assert.strictEqual(cappedJson.graph.edges.length, 1);
    assert.strictEqual(cappedJson.graph.truncated, true);
    const human = await run('python3', [QUERY, 'graph-a', '--graph', '--hops', '2'], { env: { XJ_KB_PATH: dbPath } });
    assert.strictEqual(human.code, 0, human.stderr);
    assert(human.stdout.includes('--[fixture_edge]→') && human.stdout.includes('证据:memory/experience.md:L900'));

    const defaultQuery = await run('python3', [QUERY, 'default sentinel', '--json'], { env: { XJ_KB_PATH: dbPath } });
    assert.strictEqual(defaultQuery.code, 0, defaultQuery.stderr);
    const defaultJson = JSON.parse(defaultQuery.stdout.trim().split('\n').pop());
    assert.strictEqual(defaultJson.mode, 'fts');
    assert(defaultJson.hits.length > 0, '默认 FTS 查询应继续命中');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(defaultJson, 'graph'), false, '默认查询输出不得切换为 --graph 结构');

    const audits = fs.readFileSync(auditFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert(audits.some(item => item.outcome === 'written' && item.insertedEdges === 1));
    assert(!audits.some(item => item.outcome === 'failed'), 'canary audit must not contain unexpected failures');
    console.log('lesson graph canary tests passed');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
