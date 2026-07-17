#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { redactMemoryCandidate } = require('./memory-redaction');

const EDGE_TYPE = 'lesson_root_cause_to_practice_v1';
const ENTITY_TYPE = 'lesson_concept_v1';
const SOURCE_RELATIVE = 'memory/experience.md';
const CANARY_ENV = 'CONSOLE_LESSON_GRAPH_CANARY';
const DEFAULT_BUSY_TIMEOUT_MS = 5000;

const PROVENANCE_COLUMNS = {
  relation_id: 'INTEGER REFERENCES relations(id) ON DELETE CASCADE',
  project_id: 'TEXT',
  source_path: 'TEXT',
  source_anchor: 'TEXT',
  source_hash: 'TEXT',
  task_id: 'TEXT',
  queue_id: 'TEXT',
  root_task_id: 'TEXT',
  root_queue_id: 'TEXT',
  idempotency_key: 'TEXT',
  evidence_excerpt: 'TEXT',
  review_status: "TEXT DEFAULT 'pending'",
  reviewed_at: 'TEXT',
  review_note: 'TEXT',
  created_at: 'TEXT',
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canaryEnabled(env = process.env) {
  return String(env[CANARY_ENV] == null ? '1' : env[CANARY_ENV]) !== '0';
}

function safeError(error) {
  return redactMemoryCandidate(error && error.message || error || 'unknown', 500)
    .replace(/\s+/g, ' ')
    .trim();
}

function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA busy_timeout=${DEFAULT_BUSY_TIMEOUT_MS}`);
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}

function tableExists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function createSnapshot(db, dbPath, snapshotDir) {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  const snapshotPath = path.join(snapshotDir, `kb.sqlite.pre-lesson-graph-${stamp}-${process.pid}.bak`);
  const escaped = snapshotPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return snapshotPath;
}

function migrateLessonGraph(options = {}) {
  const dbPath = path.resolve(options.dbPath || path.join(__dirname, '..', '..', 'knowledge', 'kb.sqlite'));
  if (!fs.existsSync(dbPath)) throw new Error(`kb.sqlite 不存在:${dbPath}`);
  const snapshotDir = path.resolve(options.snapshotDir || path.join(__dirname, 'artifacts', 'canary', 'lesson-graph-migration'));
  const db = openDatabase(dbPath);
  let snapshotPath = null;
  const addedColumns = [];
  let deduplicatedRelations = 0;
  try {
    if (options.snapshot !== false) snapshotPath = createSnapshot(db, dbPath, snapshotDir);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!tableExists(db, 'entities') || !tableExists(db, 'relations')) {
        throw new Error('现有 entities/relations 缺失;拒绝由增量迁移重复造基础表');
      }
      db.exec(`
        CREATE TABLE IF NOT EXISTS relation_provenance (
          id INTEGER PRIMARY KEY,
          relation_id INTEGER NOT NULL REFERENCES relations(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL,
          source_path TEXT NOT NULL,
          source_anchor TEXT,
          source_hash TEXT NOT NULL,
          task_id TEXT,
          queue_id TEXT,
          root_task_id TEXT,
          root_queue_id TEXT,
          idempotency_key TEXT NOT NULL,
          evidence_excerpt TEXT NOT NULL,
          review_status TEXT NOT NULL DEFAULT 'pending',
          reviewed_at TEXT,
          review_note TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        )
      `);
      const columns = tableColumns(db, 'relation_provenance');
      for (const [name, definition] of Object.entries(PROVENANCE_COLUMNS)) {
        if (columns.has(name)) continue;
        db.exec(`ALTER TABLE relation_provenance ADD COLUMN ${name} ${definition}`);
        addedColumns.push(name);
      }
      db.exec("UPDATE relation_provenance SET created_at=COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')), review_status=COALESCE(review_status, 'pending')");

      const duplicateGroups = db.prepare(`
        SELECT src, dst, type, MIN(id) AS keep_id, GROUP_CONCAT(id) AS ids, COUNT(*) AS count
        FROM relations
        WHERE type IS NOT NULL
        GROUP BY src, dst, type
        HAVING COUNT(*) > 1
      `).all();
      const evidenceFor = db.prepare('SELECT evidence FROM relations WHERE id=?');
      const updateEvidence = db.prepare('UPDATE relations SET evidence=COALESCE(evidence, ?) WHERE id=?');
      const reparentProvenance = db.prepare('UPDATE OR IGNORE relation_provenance SET relation_id=? WHERE relation_id=?');
      const deleteProvenance = db.prepare('DELETE FROM relation_provenance WHERE relation_id=?');
      const deleteRelation = db.prepare('DELETE FROM relations WHERE id=?');
      for (const group of duplicateGroups) {
        const ids = String(group.ids || '').split(',').map(Number).filter(Boolean);
        const keepId = Number(group.keep_id);
        let evidence = evidenceFor.get(keepId);
        evidence = evidence && evidence.evidence;
        for (const duplicateId of ids) {
          if (duplicateId === keepId) continue;
          const duplicate = evidenceFor.get(duplicateId);
          if (evidence == null && duplicate && duplicate.evidence != null) evidence = duplicate.evidence;
          reparentProvenance.run(keepId, duplicateId);
          deleteProvenance.run(duplicateId);
          deleteRelation.run(duplicateId);
          deduplicatedRelations += 1;
        }
        if (evidence != null) updateEvidence.run(evidence, keepId);
      }

      db.exec(`
        DELETE FROM relation_provenance
        WHERE idempotency_key IS NOT NULL
          AND id NOT IN (
            SELECT MIN(id) FROM relation_provenance
            WHERE idempotency_key IS NOT NULL
            GROUP BY idempotency_key
          )
      `);
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_relations_canonical ON relations(src,dst,type)');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_relation_provenance_idempotency ON relation_provenance(idempotency_key) WHERE idempotency_key IS NOT NULL');
      db.exec('CREATE INDEX IF NOT EXISTS idx_relation_provenance_relation ON relation_provenance(relation_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_relation_provenance_project_created ON relation_provenance(project_id,created_at)');
      const currentUserVersion = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
      if (currentUserVersion < 2) db.exec('PRAGMA user_version=2');
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  } finally {
    db.close();
  }
  return {
    ok: true,
    dbPath,
    snapshotPath,
    addedColumns,
    deduplicatedRelations,
  };
}

function assertCanarySchema(db) {
  if (!tableExists(db, 'entities') || !tableExists(db, 'relations') || !tableExists(db, 'relation_provenance')) {
    throw new Error('教训图谱增量迁移尚未执行');
  }
  const columns = tableColumns(db, 'relation_provenance');
  for (const name of Object.keys(PROVENANCE_COLUMNS)) {
    if (!columns.has(name)) throw new Error(`relation_provenance 缺列:${name}`);
  }
  const canonical = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='uq_relations_canonical'").get();
  const idempotency = db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='uq_relation_provenance_idempotency'").get();
  if (!canonical || !idempotency) throw new Error('教训图谱唯一索引缺失');
}

function cleanEntity(value) {
  return redactMemoryCandidate(value, 1200)
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：;；,.，。-]+|[\s:：;；,.，。-]+$/g, '')
    .slice(0, 700)
    .trim();
}

function fieldValue(block, labels) {
  const allLabels = ['现象', '问题模式', '根因', '原因', '做法', '解法', '处理', '预防', '自动化建议', '元洞察'];
  const labelPattern = labels.join('|');
  const stopPattern = allLabels.join('|');
  const regex = new RegExp(
    `(?:^|\\n|[;；])\\s*(?:[-*]\\s*)?(?:${labelPattern})(?:\\([^\\n:：]*\\))?\\s*[:：]\\s*([\\s\\S]*?)(?=(?:\\n|[;；])\\s*(?:[-*]\\s*)?(?:${stopPattern})(?:\\([^\\n:：]*\\))?\\s*[:：]|$)`,
    'i',
  );
  const match = String(block || '').match(regex);
  return cleanEntity(match && match[1] || '');
}

function splitLessonBlocks(delta) {
  const text = String(delta || '');
  const starts = [];
  const regex = /^-\s+\*\*/gm;
  let match;
  while ((match = regex.exec(text))) starts.push(match.index);
  if (!starts.length) return text.trim() ? [{ text, offset: 0 }] : [];
  return starts.map((start, index) => ({
    text: text.slice(start, starts[index + 1] == null ? text.length : starts[index + 1]),
    offset: start,
  }));
}

function extractLessonPairs(delta, baseLine = 1) {
  const lessons = [];
  for (const block of splitLessonBlocks(delta)) {
    const rootCause = fieldValue(block.text, ['根因', '原因']);
    const practice = fieldValue(block.text, ['做法', '解法', '处理', '预防', '自动化建议']);
    if (!rootCause || !practice) continue;
    const localLine = String(delta).slice(0, block.offset).split('\n').length - 1;
    const evidenceExcerpt = redactMemoryCandidate(block.text, 2000).trim();
    lessons.push({
      rootCause,
      practice,
      sourceAnchor: `${SOURCE_RELATIVE}:L${baseLine + localLine}`,
      sourceHash: sha256(evidenceExcerpt),
      evidenceExcerpt,
    });
  }
  return lessons;
}

function captureSourceState(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || path.join(__dirname, '..', '..'));
  const sourcePath = path.join(workspaceRoot, SOURCE_RELATIVE);
  const content = fs.readFileSync(sourcePath);
  return {
    sourcePath,
    sourceRelative: SOURCE_RELATIVE,
    size: content.length,
    sha256: sha256(content),
    text: content.toString('utf8'),
    lineCount: content.toString('utf8').split('\n').length,
  };
}

function appendedLessons(sourceState) {
  if (!sourceState || sourceState.sourceRelative !== SOURCE_RELATIVE) throw new Error('source-state-invalid');
  const after = fs.readFileSync(sourceState.sourcePath);
  if (after.length < sourceState.size) throw new Error('memory-source-not-append-only');
  const prefix = after.subarray(0, sourceState.size);
  let delta;
  let baseLine = sourceState.lineCount;
  if (sha256(prefix) === sourceState.sha256) {
    delta = after.subarray(sourceState.size).toString('utf8');
  } else {
    // 记忆官规范要求同步文件顶部“更新于”日期。只放行该行变化且其余旧行
    // 完整保持前缀的情形;任何既有教训改写/合并仍拒绝,避免误作新边。
    const beforeLines = String(sourceState.text || '').split('\n');
    const afterLines = after.toString('utf8').split('\n');
    if (!sourceState.text || afterLines.length < beforeLines.length) throw new Error('memory-source-not-append-only');
    for (let index = 0; index < beforeLines.length; index += 1) {
      if (beforeLines[index] === afterLines[index]) continue;
      if (/^\s*>?\s*更新于\s+/u.test(beforeLines[index])
          && /^\s*>?\s*更新于\s+/u.test(afterLines[index])) continue;
      throw new Error('memory-source-not-append-only');
    }
    delta = afterLines.slice(beforeLines.length).join('\n');
    baseLine = beforeLines.length + 1;
  }
  return {
    delta,
    lessons: extractLessonPairs(delta, baseLine),
  };
}

function validateWriteInput(input) {
  if (String(input.projectId || '') !== '控制台') throw new Error('project-scope-rejected');
  if (String(input.sourcePath || '') !== SOURCE_RELATIVE) throw new Error('source-path-rejected');
}

function writeLessons(input, options = {}) {
  validateWriteInput(input);
  const dbPath = path.resolve(options.dbPath || input.dbPath || path.join(__dirname, '..', '..', 'knowledge', 'kb.sqlite'));
  const lessons = (input.lessons || []).map(lesson => {
    const evidenceExcerpt = redactMemoryCandidate(lesson.evidenceExcerpt || '', 2000);
    const claimedSourceHash = String(lesson.sourceHash || '').trim();
    return {
      rootCause: cleanEntity(lesson.rootCause),
      practice: cleanEntity(lesson.practice),
      sourceAnchor: redactMemoryCandidate(lesson.sourceAnchor || SOURCE_RELATIVE, 500),
      // source_hash 只接受真正的 SHA-256;外部适配器输入若误把原文/凭据放进该字段,
      // 改为对已脱敏 evidence 取哈希,避免旁路泄露。
      sourceHash: /^[a-f0-9]{64}$/i.test(claimedSourceHash)
        ? claimedSourceHash.toLowerCase()
        : sha256(evidenceExcerpt),
      evidenceExcerpt,
    };
  }).filter(lesson => lesson.rootCause && lesson.practice);
  const db = openDatabase(dbPath);
  let insertedEdges = 0;
  let insertedProvenance = 0;
  let duplicateEdges = 0;
  let duplicateProvenance = 0;
  try {
    assertCanarySchema(db);
    db.exec('BEGIN IMMEDIATE');
    try {
      const upsertEntity = db.prepare(`
        INSERT INTO entities(name,type,summary) VALUES(?,?,?)
        ON CONFLICT(name,type) DO UPDATE SET summary=COALESCE(entities.summary,excluded.summary)
        RETURNING id
      `);
      const insertRelation = db.prepare("INSERT OR IGNORE INTO relations(src,dst,type,weight,status) VALUES(?,?,?,1.0,'active')");
      const selectRelation = db.prepare('SELECT id,status FROM relations WHERE src=? AND dst=? AND type=?');
      const insertProvenance = db.prepare(`
        INSERT OR IGNORE INTO relation_provenance(
          relation_id,project_id,source_path,source_anchor,source_hash,
          task_id,queue_id,root_task_id,root_queue_id,idempotency_key,
          evidence_excerpt,review_status,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      `);
      for (const lesson of lessons) {
        // 根因/做法的角色由有向边表达;实体统一成 concept,让“上一条做法=下一条根因”
        // 能复用同一节点形成真实 2-3 跳链。
        const src = Number(upsertEntity.get(lesson.rootCause, ENTITY_TYPE, lesson.rootCause).id);
        const dst = Number(upsertEntity.get(lesson.practice, ENTITY_TYPE, lesson.practice).id);
        const relationInsert = insertRelation.run(src, dst, EDGE_TYPE);
        if (Number(relationInsert.changes) > 0) insertedEdges += 1;
        else {
          duplicateEdges += 1;
        }
        const relation = selectRelation.get(src, dst, EDGE_TYPE);
        if (!relation) throw new Error('relation-upsert-failed');
        const idempotencyKey = sha256(JSON.stringify({
          projectId: '控制台',
          sourcePath: SOURCE_RELATIVE,
          sourceAnchor: lesson.sourceAnchor,
          sourceHash: lesson.sourceHash,
          taskId: input.taskId || null,
          queueId: input.queueId || null,
          rootTaskId: input.rootTaskId || null,
          rootQueueId: input.rootQueueId || null,
          rootCause: lesson.rootCause,
          practice: lesson.practice,
          type: EDGE_TYPE,
        }));
        const provenanceInsert = insertProvenance.run(
          Number(relation.id),
          '控制台',
          SOURCE_RELATIVE,
          lesson.sourceAnchor,
          lesson.sourceHash,
          input.taskId || null,
          input.queueId || null,
          input.rootTaskId || null,
          input.rootQueueId || null,
          idempotencyKey,
          lesson.evidenceExcerpt,
        );
        if (Number(provenanceInsert.changes) > 0) insertedProvenance += 1;
        else duplicateProvenance += 1;
      }
      if (options.failAfterEntities) throw new Error('test-transaction-rollback');
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  } finally {
    db.close();
  }
  return {
    ok: true,
    candidates: lessons.length,
    insertedEdges,
    duplicateEdges,
    insertedProvenance,
    duplicateProvenance,
  };
}

function appendAudit(auditFile, record) {
  if (!auditFile) return;
  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  fs.appendFileSync(auditFile, JSON.stringify(record) + '\n');
}

function eligibleSpec(spec, env = process.env) {
  if (!canaryEnabled(env)) return { ok: false, reason: 'disabled' };
  if (!spec || spec.flowId !== 'agent-once' || spec.role !== 'memory_officer') return { ok: false, reason: 'not-memory-officer' };
  if (String(spec.projectId || '') !== '控制台') return { ok: false, reason: 'project-scope-rejected' };
  if (String(spec.queueAgent || '') !== 'memory-officer') return { ok: false, reason: 'queue-scope-rejected' };
  return { ok: true };
}

function captureCanaryState(options = {}) {
  const eligibility = eligibleSpec(options.spec, options.env);
  if (!eligibility.ok) return null;
  return captureSourceState({ workspaceRoot: options.workspaceRoot });
}

function applyCanaryAfterMemory(options = {}) {
  const started = Date.now();
  const workspaceRoot = path.resolve(options.workspaceRoot || path.join(__dirname, '..', '..'));
  const auditFile = path.resolve(options.auditFile || path.join(__dirname, 'artifacts', 'canary', 'lesson-graph-audit.jsonl'));
  const spec = options.spec || {};
  const baseAudit = {
    at: new Date().toISOString(),
    projectId: spec.projectId || null,
    taskId: spec.taskId || null,
    queueId: spec.queueId || null,
    rootTaskId: spec.rootTaskId || null,
    rootQueueId: spec.rootQueueId || null,
    sourcePath: SOURCE_RELATIVE,
  };
  try {
    const eligibility = eligibleSpec(spec, options.env);
    if (!eligibility.ok) return { ok: true, skipped: true, reason: eligibility.reason };
    const appended = appendedLessons(options.sourceState);
    if (!appended.delta.trim()) {
      const result = { ok: true, skipped: true, reason: 'no-appended-memory', candidates: 0, durationMs: Date.now() - started };
      appendAudit(auditFile, Object.assign({}, baseAudit, { outcome: 'skipped', ...result }));
      return result;
    }
    if (!appended.lessons.length) {
      const result = { ok: true, skipped: true, reason: 'no-root-cause-practice-pair', candidates: 0, durationMs: Date.now() - started };
      appendAudit(auditFile, Object.assign({}, baseAudit, { outcome: 'skipped', ...result }));
      return result;
    }
    const result = writeLessons({
      projectId: '控制台',
      sourcePath: SOURCE_RELATIVE,
      taskId: spec.taskId || null,
      queueId: spec.queueId || null,
      rootTaskId: spec.rootTaskId || null,
      rootQueueId: spec.rootQueueId || null,
      lessons: appended.lessons,
    }, {
      dbPath: options.dbPath || path.join(workspaceRoot, 'knowledge', 'kb.sqlite'),
    });
    const complete = Object.assign({}, result, { durationMs: Date.now() - started });
    appendAudit(auditFile, Object.assign({}, baseAudit, { outcome: 'written', ...complete }));
    return complete;
  } catch (error) {
    const rejected = error && (error.code === 'EXCLUDED_PROJECT' || /rejected|not-append-only/.test(String(error.message || '')));
    const result = {
      ok: false,
      memoryPreserved: true,
      rejected,
      reason: safeError(error),
      durationMs: Date.now() - started,
    };
    appendAudit(auditFile, Object.assign({}, baseAudit, { outcome: rejected ? 'rejected' : 'failed', ...result }));
    return result;
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) out._.push(value);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[value.slice(2)] = argv[++i];
    else out[value.slice(2)] = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command === 'migrate') {
    const result = migrateLessonGraph({
      dbPath: args.db,
      snapshotDir: args['snapshot-dir'],
      snapshot: args['no-snapshot'] !== true,
    });
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  if (command === 'write-input') {
    if (!canaryEnabled(process.env)) throw new Error('canary-disabled');
    if (!args.input) throw new Error('write-input 需要 --input');
    const input = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
    const result = writeLessons(input, { dbPath: args.db || input.dbPath });
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  throw new Error('用法: lesson-graph-adapter.js migrate --db <kb.sqlite> [--snapshot-dir <dir>] [--no-snapshot]');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(safeError(error) + '\n');
    process.exit(1);
  }
}

module.exports = {
  CANARY_ENV,
  EDGE_TYPE,
  ENTITY_TYPE,
  SOURCE_RELATIVE,
  _test: {
    appendedLessons,
    assertCanarySchema,
    cleanEntity,
    extractLessonPairs,
    fieldValue,
    splitLessonBlocks,
  },
  applyCanaryAfterMemory,
  canaryEnabled,
  captureCanaryState,
  captureSourceState,
  eligibleSpec,
  migrateLessonGraph,
  writeLessons,
};
