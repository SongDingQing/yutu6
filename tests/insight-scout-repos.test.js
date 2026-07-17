#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const queueRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'console-insight-scout-queue-'));
process.env.CONSOLE_ARTIFACTS_DIR = queueRoot;
process.env.QUEUE_WORKER_DISABLED = '1';
process.env.INSIGHT_SCOUT_REPOS_ENABLED = '1';
process.env.INSIGHT_SCOUT_REPOS_INTERVAL_MS = String(4 * 60 * 60 * 1000);
process.env.INSIGHT_SCOUT_REPOS_CHECK_MS = '60000';

const Q = require('../shared/engine/queue');
const InsightScoutRepos = require('../projects/控制台/insight-scout-repos');
const ResourceLocks = require('../projects/控制台/resource-locks');
const Server = require('../projects/控制台/server');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  try {
    const nowMs = Date.parse('2026-06-23T02:10:00.000Z'); // 北京 10:10 -> 08 点窗口
    const first = Server.checkInsightScoutRepos({ nowMs });
    assert.strictEqual(first.action, 'enqueued');
    assert.strictEqual(first.agent, 'insight-scout');
    assert.strictEqual(first.slot.key, '20260623-08');
    assert(first.entry.id.startsWith('insight-scout-repos-20260623-08'));

    let listed = Q.list(queueRoot, 'insight-scout');
    assert.strictEqual(listed.queued.length, 1);
    assert.strictEqual(listed.queued[0].priority, InsightScoutRepos.DEFAULT_PRIORITY);
    assert.strictEqual(listed.queued[0].task.role, 'insight-scout');
    assert.strictEqual(listed.queued[0].task.flowId, 'agent-once');
    assert.strictEqual(listed.queued[0].task.structuredAcceptance, false);
    assert.match(listed.queued[0].task.goal, /insight_scout/);
    assert.match(listed.queued[0].task.goal, /最终只输出一个 `json` 代码块/);
    assert.match(listed.queued[0].task.bounds, /密钥不回显/);
    assert.deepStrictEqual(listed.queued[0].task.resourceDomains, {
      read: ['insights'],
      write: ['insights'],
    });
    const resourceRequest = ResourceLocks.normalizeResourceRequest(listed.queued[0].task);
    assert.strictEqual(resourceRequest.source, 'declared');
    assert.deepStrictEqual(resourceRequest.read, []);
    assert.deepStrictEqual(resourceRequest.write, ['insights']);
    assert(!resourceRequest.write.includes('engine'));
    assert(!resourceRequest.write.includes('queue-state'));
    assert(!resourceRequest.write.includes('config'));
    assert(!resourceRequest.write.includes('frontend-public'));
    assert(!resourceRequest.write.includes('board'));

    const duplicate = Server.checkInsightScoutRepos({ nowMs: nowMs + 1000 });
    assert.strictEqual(duplicate.action, 'skip');
    assert.strictEqual(duplicate.reason, 'already-queued');

    const nextWhileActive = Server.checkInsightScoutRepos({ nowMs: nowMs + 4 * 60 * 60 * 1000 + 1 });
    assert.strictEqual(nextWhileActive.action, 'skip');
    assert.strictEqual(nextWhileActive.reason, 'already-active');

    const claimed = Q.claim(queueRoot, 'insight-scout', { owner: 'test', pid: process.pid });
    assert.strictEqual(claimed.id, first.entry.id);
    Q.complete(queueRoot, 'insight-scout', claimed.id, true);

    const next = Server.checkInsightScoutRepos({ nowMs: nowMs + 4 * 60 * 60 * 1000 + 1 });
    assert.strictEqual(next.action, 'enqueued');
    assert.strictEqual(next.slot.key, '20260623-12');
    listed = Q.list(queueRoot, 'insight-scout');
    assert.strictEqual(listed.queued.length, 1);
    assert.strictEqual(listed.done, 1);

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'console-insight-scout-workspace-'));
    const artifactsRoot = path.join(workspace, 'artifacts');
    fs.mkdirSync(path.join(workspace, 'board', 'insights'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'board', 'insights', 'insights.md'), '# 洞察员 · 借鉴分析(insights)\n');
    fs.writeFileSync(path.join(workspace, 'board', 'insights', 'seen-repos.json'), JSON.stringify({ repos: [] }, null, 2) + '\n');

    const applied = InsightScoutRepos.applyInsightScoutOutput({
      workspaceRoot: workspace,
      artifactsRoot,
      taskId: 'cr-insight-test',
      queueAgent: 'insight-scout',
      queueId: 'q1',
      output: {
        insight_scout: {
          done: true,
          slot: '20260623-08',
          topic: 'queue-engine',
          network_status: 'limited',
          analysis_markdown: '### goqite 式死信语义\n- 是什么:测试分析。\n- 值得借鉴:给队列加毒丸隔离。\n- URL: https://github.com/maragudk/goqite',
          seen_repos: ['https://github.com/maragudk/goqite'],
          bulletin_cards: [{
            title: '队列毒丸隔离候选',
            desc: '洞察员建议 CEO 评估 max-receive -> dead-letter 语义。',
            target: 'ceo',
            project: '控制台',
            goal: '评估是否给控制台队列补 max-receive 与死信区,防止失败任务无限重投。',
          }],
        },
      },
    });
    assert.strictEqual(applied.ok, true);
    assert.strictEqual(applied.insights.appended, true);
    assert.strictEqual(applied.seenRepos.added.length, 1);
    assert.strictEqual(applied.bulletin.added.length, 1);

    const insightsText = fs.readFileSync(path.join(workspace, 'board', 'insights', 'insights.md'), 'utf8');
    assert.match(insightsText, /insight-scout-run:cr-insight-test/);
    assert.match(insightsText, /goqite 式死信语义/);
    const seen = readJson(path.join(workspace, 'board', 'insights', 'seen-repos.json'));
    assert(seen.repos.includes('https://github.com/maragudk/goqite'));
    const cards = readJson(path.join(artifactsRoot, 'bulletin', 'cards.json'));
    assert.strictEqual(cards.length, 1);
    assert.strictEqual(cards[0].source, '洞察员');
    assert.strictEqual(cards[0].target, 'ceo');
    assert.strictEqual(cards[0].payload.loopEngineering, false);
    assert.strictEqual(cards[0].payload.insightWorkload.mode, 'light');
    assert.strictEqual(cards[0].payload.insightWorkload.proposalOnly, true);
    assert.match(cards[0].insight_fingerprint, /^[0-9a-f]{64}$/);

    const repeated = InsightScoutRepos.applyInsightScoutOutput({
      workspaceRoot: workspace,
      artifactsRoot,
      taskId: 'cr-insight-test',
      queueAgent: 'insight-scout',
      queueId: 'q1',
      output: appliedOutputFixture(),
    });
    assert.strictEqual(repeated.ok, true);
    assert.strictEqual(repeated.insights.appended, false);
    assert.strictEqual(repeated.bulletin.added.length, 0);
    assert.strictEqual(repeated.seenRepos.added.length, 0);
    assert.strictEqual(readJson(path.join(artifactsRoot, 'bulletin', 'cards.json')).length, 1);

    const crossSlotOutput = appliedOutputFixture();
    crossSlotOutput.insight_scout.slot = '20260623-12';
    const crossSlot = InsightScoutRepos.applyInsightScoutOutput({
      workspaceRoot: workspace,
      artifactsRoot,
      taskId: 'cr-insight-test-next-slot',
      queueAgent: 'insight-scout',
      queueId: 'q2',
      output: crossSlotOutput,
    });
    assert.strictEqual(crossSlot.ok, true);
    assert.strictEqual(crossSlot.bulletin.added.length, 0);
    assert(crossSlot.bulletin.skipped.some(item => item.reason === 'duplicate-content'));
    assert.strictEqual(readJson(path.join(artifactsRoot, 'bulletin', 'cards.json')).length, 1);

    const rotatingWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'console-insight-rotate-'));
    const rotatingArtifacts = path.join(rotatingWorkspace, 'artifacts');
    const rotatingInsightsDir = path.join(rotatingWorkspace, 'board', 'insights');
    fs.mkdirSync(rotatingInsightsDir, { recursive: true });
    const oldBlocks = [];
    for (let i = 1; i <= 5; i++) {
      oldBlocks.push([
        `<!-- insight-scout-run:old-batch-${i} -->`,
        `## 2026-06-2${i} · 自动洞察(old-${i} · queue-engine)`,
        '',
        `### old repo ${i}`,
        `- URL: https://github.com/example/old-${i}`,
        '',
      ].join('\n'));
    }
    fs.writeFileSync(path.join(rotatingInsightsDir, 'insights.md'), '# 洞察员 · 借鉴分析(insights)\n\n' + oldBlocks.join('\n'));
    fs.writeFileSync(path.join(rotatingInsightsDir, 'seen-repos.json'), JSON.stringify({
      repos: ['https://github.com/example/old-1'],
      borrowed_libraries: [{ url: 'https://github.com/example/cold-metadata', analysis: 'should not stay hot' }],
      analysis: 'heavy field should be removed',
    }, null, 2) + '\n');
    for (let i = 1; i <= 4; i++) {
      const insightBackup = path.join(rotatingInsightsDir, `insights.md.bak-test-${i}`);
      const seenBackup = path.join(rotatingInsightsDir, `seen-repos.json.pre-test-${i}`);
      fs.writeFileSync(insightBackup, `backup ${i}`);
      fs.writeFileSync(seenBackup, `backup ${i}`);
      const t = new Date(Date.UTC(2026, 5, 20, i));
      fs.utimesSync(insightBackup, t, t);
      fs.utimesSync(seenBackup, t, t);
    }
    const rotatingApplied = InsightScoutRepos.applyInsightScoutOutput({
      workspaceRoot: rotatingWorkspace,
      artifactsRoot: rotatingArtifacts,
      taskId: 'cr-insight-rotate',
      queueAgent: 'insight-scout',
      queueId: 'q-rotate',
      output: appliedOutputFixture(),
    });
    assert.strictEqual(rotatingApplied.ok, true);
    assert(rotatingApplied.maintenance.insights.archived >= 2);
    const hotAfterRotate = fs.readFileSync(path.join(rotatingInsightsDir, 'insights.md'), 'utf8');
    assert.strictEqual((hotAfterRotate.match(/insight-scout-run:/g) || []).length, 4);
    assert(!hotAfterRotate.includes('old-batch-1'));
    assert(!hotAfterRotate.includes('old-batch-2'));
    const archiveText = fs.readFileSync(path.join(rotatingInsightsDir, 'references', 'archive-202606.md'), 'utf8');
    assert.match(archiveText, /old-batch-1/);
    assert.match(archiveText, /old-batch-2/);
    assert(fs.existsSync(path.join(rotatingInsightsDir, 'references', 'archive-index.md')));
    const slimSeen = readJson(path.join(rotatingInsightsDir, 'seen-repos.json'));
    assert.deepStrictEqual(Object.keys(slimSeen).sort(), ['_note', 'repos', 'updated_at']);
    assert(slimSeen.repos.includes('https://github.com/maragudk/goqite'));
    assert(!JSON.stringify(slimSeen).includes('heavy field'));
    assert.strictEqual(fs.readdirSync(rotatingInsightsDir).filter(f => f.startsWith('insights.md.bak') || f.startsWith('insights.md.pre')).length, 3);
    assert.strictEqual(fs.readdirSync(rotatingInsightsDir).filter(f => f.startsWith('seen-repos.json.bak') || f.startsWith('seen-repos.json.pre')).length, 3);
    fs.rmSync(rotatingWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    const emptyOutput = InsightScoutRepos.applyInsightScoutOutput({
      workspaceRoot: workspace,
      artifactsRoot,
      taskId: 'cr-empty-output',
      queueAgent: 'insight-scout',
      queueId: 'q-empty',
      output: {},
    });
    assert.strictEqual(emptyOutput.ok, false);
    assert.match(emptyOutput.reason, /missing insight_scout JSON/);

    const malformedJsonOutput = InsightScoutRepos.extractInsightScoutOutputFromText([
      '```json',
      '{',
      '  "insight_scout": {',
      '    "done": true,',
      '    "slot": "20260623-08",',
      '    "topic": "gui-grounding",',
      '    "network_status": "limited",',
      '    "analysis_markdown": "### a11y 借鉴\\n- 是什么: 评估 "控制台" 的 GUI grounding。\\n- 值得借鉴: 用 "最终状态可机器验证" 的断言。\\n- URL: https://github.com/microsoft/OmniParser",',
      '    "seen_repos": [',
      '      "https://github.com/microsoft/OmniParser"',
      '    ],',
      '    "bulletin_cards": [',
      '      {',
      '        "title": "可选:发起 "a11y tree" spike",',
      '        "desc": "验证视觉解析 + a11y tree 双通道。",',
      '        "target": "ceo",',
      '        "project": "控制台",',
      '        "goal": "请 CEO 决策是否立项。"',
      '      }',
      '    ]',
      '  }',
      '}',
      '```',
    ].join('\n'));
    assert.strictEqual(malformedJsonOutput.slot, '20260623-08');
    assert.strictEqual(malformedJsonOutput.topic, 'gui-grounding');
    assert.match(malformedJsonOutput.analysis_markdown, /"控制台"/);
    assert.deepStrictEqual(malformedJsonOutput.seen_repos, ['https://github.com/microsoft/OmniParser']);
    assert.strictEqual(malformedJsonOutput.bulletin_cards[0].target, 'ceo');
    assert.match(malformedJsonOutput.bulletin_cards[0].title, /a11y tree/);

    const truncatedJsonOutput = InsightScoutRepos.extractInsightScoutOutputFromText([
      '```json',
      '{',
      '  "insight_scout": {',
      '    "done": true,',
      '    "slot": "20260623-20",',
      '    "topic": "multi-agent-orchestration",',
      '    "network_status": "unavailable",',
      '    "analysis_markdown": "## DAG\\n- URL: https://github.com/langchain-ai/langgraph\\n- URL: https://github.com/crewAIInc/crewAI',
    ].join('\n'));
    assert.strictEqual(truncatedJsonOutput.slot, '20260623-20');
    assert.match(truncatedJsonOutput.analysis_markdown, /langgraph/);

    const truncatedWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'console-insight-truncated-'));
    const truncatedArtifacts = path.join(truncatedWorkspace, 'artifacts');
    fs.mkdirSync(path.join(truncatedWorkspace, 'board', 'insights'), { recursive: true });
    fs.writeFileSync(path.join(truncatedWorkspace, 'board', 'insights', 'insights.md'), '# 洞察员 · 借鉴分析(insights)\n');
    fs.writeFileSync(path.join(truncatedWorkspace, 'board', 'insights', 'seen-repos.json'), JSON.stringify({ repos: [] }, null, 2) + '\n');
    const truncatedApplied = InsightScoutRepos.applyInsightScoutOutput({
      workspaceRoot: truncatedWorkspace,
      artifactsRoot: truncatedArtifacts,
      taskId: 'cr-insight-truncated',
      queueAgent: 'insight-scout',
      queueId: 'q-truncated',
      output: truncatedJsonOutput,
    });
    assert.strictEqual(truncatedApplied.ok, true);
    // N4:network=unavailable 的纯 stub 不落盘 insights.md / 不写 seen-repos(本用例兼测 JSON 截断容错 + 该门控)
    assert.strictEqual(truncatedApplied.insights.appended, false);
    assert.deepStrictEqual(truncatedApplied.seenRepos.added, []);
    fs.rmSync(truncatedWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    // 带点 repo 名完整保留(socket.io/next.js),句末/尾随标点仍剥离,字面量 \n 仍不吞
    const extractedUrls = InsightScoutRepos._test.githubUrlsFromText([
      '推荐 https://github.com/socketio/socket.io。',
      '其次 https://github.com/vercel/next.js, 和 https://github.com/foo/bar.git.',
      '脏条目 https://github.com/a/b\\n后续文本',
    ].join('\n'));
    assert.deepStrictEqual(extractedUrls, [
      'https://github.com/socketio/socket.io',
      'https://github.com/vercel/next.js',
      'https://github.com/foo/bar',
      'https://github.com/a/b',
    ]);

    // 损坏 JSON 自愈前先备份 .corrupt-<ts>,防 seen-repos/cards 历史被静默清空
    const corruptWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'console-insight-corrupt-'));
    const corruptArtifacts = path.join(corruptWorkspace, 'artifacts');
    const corruptInsightsDir = path.join(corruptWorkspace, 'board', 'insights');
    fs.mkdirSync(corruptInsightsDir, { recursive: true });
    fs.mkdirSync(path.join(corruptArtifacts, 'bulletin'), { recursive: true });
    fs.writeFileSync(path.join(corruptInsightsDir, 'insights.md'), '# 洞察员 · 借鉴分析(insights)\n');
    fs.writeFileSync(path.join(corruptInsightsDir, 'seen-repos.json'), '{ "repos": [ broken');
    fs.writeFileSync(path.join(corruptArtifacts, 'bulletin', 'cards.json'), 'not json at all');
    const corruptApplied = InsightScoutRepos.applyInsightScoutOutput({
      workspaceRoot: corruptWorkspace,
      artifactsRoot: corruptArtifacts,
      taskId: 'cr-insight-corrupt',
      queueAgent: 'insight-scout',
      queueId: 'q-corrupt',
      output: appliedOutputFixture(),
    });
    assert.strictEqual(corruptApplied.ok, true);
    assert.strictEqual(corruptApplied.seenRepos.added.length, 1);
    assert.strictEqual(corruptApplied.bulletin.added.length, 1);
    assert(fs.readdirSync(corruptInsightsDir).some(f => f.startsWith('seen-repos.json.corrupt-')));
    assert(fs.readdirSync(path.join(corruptArtifacts, 'bulletin')).some(f => f.startsWith('cards.json.corrupt-')));
    assert(readJson(path.join(corruptInsightsDir, 'seen-repos.json')).repos.includes('https://github.com/maragudk/goqite'));
    assert.strictEqual(readJson(path.join(corruptArtifacts, 'bulletin', 'cards.json')).length, 1);
    fs.rmSync(corruptWorkspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    console.log(JSON.stringify({ pass: true, suite: 'insight-scout-repos' }));
  } finally {
    fs.rmSync(queueRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function appliedOutputFixture() {
  return {
    insight_scout: {
      done: true,
      slot: '20260623-08',
      topic: 'queue-engine',
      network_status: 'limited',
      analysis_markdown: '### goqite 式死信语义\n- 是什么:测试分析。\n- 值得借鉴:给队列加毒丸隔离。\n- URL: https://github.com/maragudk/goqite',
      seen_repos: ['https://github.com/maragudk/goqite'],
      bulletin_cards: [{
        title: '队列毒丸隔离候选',
        desc: '洞察员建议 CEO 评估 max-receive -> dead-letter 语义。',
        target: 'ceo',
        project: '控制台',
        goal: '评估是否给控制台队列补 max-receive 与死信区,防止失败任务无限重投。',
      }],
    },
  };
}

main();
