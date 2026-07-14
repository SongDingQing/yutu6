#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BoardReview = require('../projects/控制台/board-review');
const EventLog = require('../shared/engine/eventlog');

function readEvents(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'console-board-review-test-'));
  const configFile = path.join(root, 'config.json');
  const previousConfigFile = process.env.CONSOLE_CONFIG_FILE;
  const previousTiered = process.env.YUTU6_BOARD_TIERED;
  delete process.env.YUTU6_BOARD_TIERED; // 分级评审默认开
  try {
    const artifactsRoot = path.join(root, 'artifacts');
    const memoryFile = path.join(root, 'memory', 'decisions.md');
    const okEventsFile = path.join(root, 'ok-events.jsonl');
    const advisoryEventsFile = path.join(root, 'advisory-events.jsonl');
    const riskEventsFile = path.join(root, 'risk-events.jsonl');

    process.env.CONSOLE_CONFIG_FILE = configFile;
    fs.writeFileSync(configFile, JSON.stringify({ boardReviewControl: { enabled: true, maxRounds: 1, reason: 'test-enabled' } }, null, 2));
    assert.strictEqual(BoardReview.MAX_ROUNDS, 1);
    assert.strictEqual(BoardReview._test.boardReviewMaxRounds(), 1);
    assert.deepStrictEqual(BoardReview.DIRECTORS.map(d => d.id), ['board_deepseek', 'board_glm52', 'board_claude', 'board_opus48']);
    assert(BoardReview.DIRECTORS.find(d => d.id === 'board_claude' && d.runner === 'claude-fable-5' && !d.final), '可选 Claude Fable 5 董事须在席且不占最终裁决位');
    assert.strictEqual(BoardReview.DIRECTORS.filter(d => d.runner === 'codex').length, 1, '董事会不能同时有两个 Codex/GPT-5.5 席位');
    assert(BoardReview.DIRECTORS.find(d => d.id === 'board_opus48' && d.final), 'Codex/GPT-5.5 必须保留最终裁决席位');
    // 2026-07-03 架构审视 A-5:董事会修订压缩前必须剥离秘书背景包,保住老板任务正文。
    const packOldFormat = '秘书补全稿:\n\n[秘书后台背景包]\n' + '背景行\n'.repeat(800) + '\n目标:修复任务板启用按钮\n项目:控制台';
    const strippedOld = BoardReview._test.stripSecretaryContextPack(packOldFormat);
    assert(strippedOld.includes('目标:修复任务板启用按钮'), '旧格式(包前置):剥包后必须保留老板正文');
    assert(!strippedOld.includes('背景行'), '旧格式:背景包本体必须被剥离');
    const packNewFormat = '秘书补全稿:\n\n目标:修复任务板启用按钮\n项目:控制台\n\n[秘书后台背景包]\n' + '背景行\n'.repeat(800);
    const strippedNew = BoardReview._test.stripSecretaryContextPack(packNewFormat);
    assert(strippedNew.includes('目标:修复任务板启用按钮'), '新格式(包后置):正文保留');
    assert(!strippedNew.includes('背景行'), '新格式:尾部背景包剥离');
    assert.strictEqual(BoardReview._test.stripSecretaryContextPack('无背景包的普通目标'), '无背景包的普通目标');
    const revised = BoardReview._test.buildRevisedInstruction(packOldFormat, [], 1);
    assert(revised.includes('目标:修复任务板启用按钮'), 'compact(5000) 截断后老板正文不得丢失');

    const glmDirector = BoardReview.DIRECTORS.find(d => d.id === 'board_glm52');
    const absentOpinion = BoardReview._test.parseOpinion({ fail: 'Invalid Authentication' }, glmDirector, 1);
    assert.strictEqual(absentOpinion.absent, true, 'runner failure must be represented as director absence');
    assert.strictEqual(absentOpinion.failed, false, 'runner absence must not be counted as board rejection');
    assert.strictEqual(absentOpinion.can_execute, true, 'runner absence must not block execution by itself');
    assert.strictEqual(BoardReview._test.opinionNeedsMoreRounds(absentOpinion), false, 'runner absence must not request another board round');
    assert.strictEqual(BoardReview._test.classifyRunnerHealthFailure('Invalid Authentication').kind, 'auth');
    assert.strictEqual(BoardReview._test.classifyRunnerHealthFailure('预扣费额度失败, 用户剩余额度不足').kind, 'quota');
    assert.strictEqual(BoardReview._test.classifyRunnerHealthFailure('该模型当前访问量过大，请您稍后再试').kind, 'busy');
    const healthArtifactsRoot = path.join(root, 'health-artifacts');
    BoardReview._test.markDirectorCooldown(glmDirector, 'Invalid Authentication', healthArtifactsRoot, new EventLog(path.join(root, 'health-events.jsonl')));
    assert(/health cooldown\(auth/.test(BoardReview._test.directorCooldownReason(glmDirector, healthArtifactsRoot)), 'director auth failure should open board cooldown');

    const assessment = BoardReview.assessTask('落地董事会: 改引擎/队列机制/路由/agent体系/数据架构/版本发布/并发锁');
    assert.strictEqual(assessment.important, true);
    assert(assessment.matches.includes('engine'));
    assert(assessment.matches.includes('queue'));
    assert(assessment.matches.includes('routing'));
    assert(assessment.matches.includes('agent'));
    assert(assessment.matches.includes('data'));
    assert(assessment.matches.includes('release'));
    assert(assessment.matches.includes('concurrency'));
    assert.strictEqual(BoardReview.assessTask('优化 engine-runner 性能瓶颈并降低资源占用').important, true);
    assert(BoardReview.assessTask('优化 engine-runner 性能瓶颈并降低资源占用').matches.includes('performance'));
    assert.strictEqual(BoardReview.assessTask('优化任务板渲染性能,降低轮询 CPU 消耗').important, true);
    assert(BoardReview.assessTask('优化任务板渲染性能,降低轮询 CPU 消耗').matches.includes('performance'));
    assert.strictEqual(BoardReview.assessTask('把按钮文案改短一点').important, false);
    assert.strictEqual(BoardReview.assessTask('修运行时长显示,纯 UI 小改').important, false);
    assert.strictEqual(BoardReview.assessTask('调样式:任务卡运行时长显示更紧凑').reason, 'ui-small-change-excluded');
    assert.strictEqual(BoardReview.assessTask('办公室视图新增董事会区,显示评议中第 X/1 轮,纯 UI 展示').important, false);
    assert.strictEqual(BoardReview.assessTask('任务板 UI 调整 review-loop 运行时长显示,不改流程').important, false);
    assert.strictEqual(BoardReview.assessTask('整理 CEO 队列,合并几个排队任务,不改 queue.js').important, false);
    assert.strictEqual(BoardReview.assessTask('重构队列引擎并顺手调运行时长显示').important, true);
    assert.strictEqual(BoardReview.assessTask('给写盘加 mutex 串行锁').important, true);
    assert.strictEqual(BoardReview.assessTask('诊断文本: buildSecretaryEnvelope() 提到 queue.js,但不改 queue.js').important, false);
    assert.strictEqual(BoardReview.assessTask('Builder UI copy tweak: make the card title shorter').important, false);
    assert.strictEqual(BoardReview.assessTask('Implement queue lease heartbeat in shared/engine/queue.js').important, true);
    assert.strictEqual(BoardReview.assessTask('改队列引擎的 claim/lease 机制').important, true);
    assert.strictEqual(BoardReview.assessTask('重构路由引擎,调整 project-route 分流规则').important, true);
    assert.strictEqual(BoardReview.assessTask('新增资源域读写锁并修复并发竞态').important, true);
    assert.strictEqual(BoardReview.shouldRunBoardReview({
      originalGoal: 'd6e748c5: 修运行时长显示,纯 UI 小改',
      goal: '改 projects/控制台/public/workspace.html 的运行时长显示',
      queueAgent: 'supervisor-控制台',
    }, '验收:在控制台 scope 内跑 review-loop; CEO brief 已转交主管。').important, false);
    const structuredUi = BoardReview.shouldRunBoardReview({
      goal: '结构化字段说明: 只显示董事会状态。',
      changeScope: { areas: ['ui', 'display'], action: 'show' },
      uiOnly: true,
    }, 'plan mentions 董事会评议状态');
    assert.strictEqual(structuredUi.important, false);
    assert.strictEqual(structuredUi.reason, 'structured-ui-small-change');
    const structuredMention = BoardReview.shouldRunBoardReview({
      goal: '结构化字段说明: 只是复述队列锁风险。',
      impactAreas: ['queue', 'lock'],
      changeAction: 'reference',
    }, 'plan mentions queue lease only');
    assert.strictEqual(structuredMention.important, false);
    assert.strictEqual(structuredMention.reason, 'structured-mention-only');
    const structuredArchitecture = BoardReview.shouldRunBoardReview({
      goal: '结构化字段说明: 修改队列 lease。',
      impactAreas: ['queue', 'concurrency'],
      changeAction: 'implement',
    }, '');
    assert.strictEqual(structuredArchitecture.important, true);
    assert.strictEqual(structuredArchitecture.reason, 'structured-architecture-signal');
    assert(structuredArchitecture.matches.includes('queue'));
    assert(structuredArchitecture.matches.includes('concurrency'));
    fs.writeFileSync(configFile, JSON.stringify({ boardReviewControl: { enabled: false, reason: 'runtime-test-disabled' } }, null, 2));
    const disabled = BoardReview.shouldRunBoardReview({
      originalGoal: '重构控制台路由引擎和队列状态机。',
      goal: '重构控制台路由引擎和队列状态机。',
      boardReview: { required: true, reason: 'secretary-required', matches: ['engine'] },
    }, 'CEO brief: 改 project-route 和 review-loop。');
    assert.strictEqual(disabled.important, false);
    assert.strictEqual(disabled.disabled, true);
    assert.strictEqual(disabled.reason, 'runtime-test-disabled');
    fs.writeFileSync(configFile, JSON.stringify({ boardReviewControl: { enabled: true, maxRounds: 1, reason: 'runtime-test-enabled' } }, null, 2));
    const reenabled = BoardReview.shouldRunBoardReview({
      originalGoal: '重构控制台路由引擎和队列状态机。',
      goal: '重构控制台路由引擎和队列状态机。',
    }, 'CEO brief: 改 project-route 和 review-loop。');
    assert.strictEqual(reenabled.important, true);
    assert(reenabled.matches.includes('engine') || reenabled.matches.includes('routing'));

    // ── 拍板 Q11 分级评审:tier 判定单元测试 ──
    assert.strictEqual(BoardReview._test.boardTieredEnabled(), true, '分级评审默认开');
    const NON_FINAL_IDS = ['board_deepseek', 'board_glm52', 'board_claude'];
    const tierQueue = BoardReview._test.reviewTierFor({
      spec: {},
      assessment: BoardReview.assessTask('改队列引擎的 claim/lease 机制'),
      taskId: 'tier-queue',
    });
    assert.strictEqual(tierQueue.tier, 'full', 'queue 类任务必须全体 4 席');
    assert.strictEqual(tierQueue.directors.length, 4);
    const tierEngine = BoardReview._test.reviewTierFor({
      spec: {},
      assessment: BoardReview.assessTask('重构核心引擎 review-loop'),
      taskId: 'tier-engine',
    });
    assert.strictEqual(tierEngine.tier, 'full', 'engine 类任务必须全体 4 席');
    const ordinaryAssessment = BoardReview.assessTask('重构数据架构,调整 schema 存储');
    assert.strictEqual(ordinaryAssessment.important, true);
    assert.deepStrictEqual(ordinaryAssessment.matches, ['data'], '普通架构样例不得命中高危域');
    const tierLight = BoardReview._test.reviewTierFor({ spec: {}, assessment: ordinaryAssessment, taskId: 'tier-light' });
    assert.strictEqual(tierLight.tier, 'light', '普通架构任务走轻量席');
    assert.strictEqual(tierLight.directors.length, 2, '轻量=轮值+终审 2 席');
    assert(tierLight.directors.some(d => d.id === 'board_opus48' && d.final), '终审席必须保留');
    assert(NON_FINAL_IDS.includes(tierLight.directors.find(d => !d.final).id), '轮值席必须来自非终审三席');
    // 同一任务 id 轮值确定性
    const rotA = BoardReview._test.rotatingDirectorFor('tier-light');
    const rotB = BoardReview._test.rotatingDirectorFor('tier-light');
    assert.strictEqual(rotA.id, rotB.id, '同一任务 id 的轮值董事必须确定');
    assert.strictEqual(tierLight.directors.find(d => !d.final).id, rotA.id, 'reviewTierFor 与 rotatingDirectorFor 必须一致');
    const tierLightAgain = BoardReview._test.reviewTierFor({ spec: {}, assessment: ordinaryAssessment, taskId: 'tier-light' });
    assert.deepStrictEqual(tierLightAgain.directors.map(d => d.id), tierLight.directors.map(d => d.id), '同一任务 id 派席名单确定');
    const rotationSpread = new Set();
    for (let i = 0; i < 24; i++) rotationSpread.add(BoardReview._test.rotatingDirectorFor(`tier-rotation-${i}`).id);
    assert(rotationSpread.size >= 2, '不同任务 id 应在非终审席间轮值');
    for (const id of rotationSpread) assert(NON_FINAL_IDS.includes(id), '轮值只能落在非终审席');
    // 显式点名董事会/跨项目 → 全体
    const explicitAssessment = BoardReview.assessTask('落地重要架构决策:重构数据架构');
    assert.strictEqual(explicitAssessment.reason, 'explicit-important-architecture');
    assert.strictEqual(BoardReview._test.reviewTierFor({ spec: {}, assessment: explicitAssessment, taskId: 'tier-explicit' }).tier, 'full');
    assert.strictEqual(BoardReview._test.reviewTierFor({ spec: { crossProject: true }, assessment: ordinaryAssessment, taskId: 'tier-cross' }).tier, 'full', '跨项目改动必须全体');
    // matches 为空(无法分类)保守全体
    assert.strictEqual(BoardReview._test.reviewTierFor({ spec: {}, assessment: { important: true, reason: 'secretary-required', matches: [] }, taskId: 'tier-unknown' }).tier, 'full');
    // 开关退回全体
    process.env.YUTU6_BOARD_TIERED = '0';
    assert.strictEqual(BoardReview._test.boardTieredEnabled(), false);
    const tierDisabled = BoardReview._test.reviewTierFor({ spec: {}, assessment: ordinaryAssessment, taskId: 'tier-light' });
    assert.strictEqual(tierDisabled.tier, 'full', 'YUTU6_BOARD_TIERED=0 必须退回全体评审');
    assert.strictEqual(tierDisabled.directors.length, 4);
    delete process.env.YUTU6_BOARD_TIERED;

    const approveCalls = [];
    const approved = await BoardReview.runBoardReview({
      spec: {
        taskId: 'board-ok',
        projectId: '控制台',
        goal: '落地董事会: 改引擎/队列/路由/agent体系。',
        originalGoal: '落地董事会设计方案。',
      },
      projectId: '控制台',
      planText: 'CEO brief: 建4个活跃董事agent并接入秘书钩子。',
      assessment,
      artifactsRoot,
      memoryFile,
      eventlog: new EventLog(okEventsFile),
      cliRunner(node, ctx, round) {
        approveCalls.push({ node: node.id, role: node.agent_role, round, goal: ctx.goal });
        return {
          vars: {
            board_review: {
              risk_level: 'low',
              can_execute: true,
              misjudgment_risk: false,
              issues: [`${node.agent_role} 挑刺: 补验收证据`],
              suggestions: ['把评议记录写入 memory/decisions.md'],
              summary: '可默认执行',
            },
          },
        };
      },
    });

    assert.strictEqual(approved.ok, true);
    assert.strictEqual(approved.approved, true);
    assert.strictEqual(approved.paused, false);
    assert.strictEqual(approved.maxRounds, 1);
    assert.strictEqual(approved.tier, 'full', '引擎/队列/路由高危任务分级=full');
    assert.strictEqual(approveCalls.length, 4, '高危任务(engine/queue/routing)必须 4 席全体出动');
    assert(approveCalls.some(call => call.role === 'board_opus48'));
    assert(fs.readFileSync(memoryFile, 'utf8').includes('董事会评议'));
    const okEvents = readEvents(okEventsFile);
    assert(okEvents.some(ev => ev.type === 'board.review.round.start' && ev.round === 1 && ev.maxRounds === 1));
    assert(okEvents.some(ev => ev.type === 'board.review.approved' && ev.maxRounds === 1));
    const okRequired = okEvents.find(ev => ev.type === 'board.review.required');
    assert.strictEqual(okRequired.tier, 'full', 'required 事件必须带 tier');
    assert.deepStrictEqual(okRequired.directors, ['board_deepseek', 'board_glm52', 'board_claude', 'board_opus48'], 'required 事件必须带派席名单');
    assert(okEvents.some(ev => ev.type === 'board.review.round.start' && ev.tier === 'full' && ev.directorCount === 4));
    assert(okEvents.some(ev => ev.type === 'board.review.approved' && ev.tier === 'full' && Array.isArray(ev.directors) && ev.directors.length === 4));

    const advisoryCalls = [];
    const advisory = await BoardReview.runBoardReview({
      spec: {
        taskId: 'board-advisory',
        projectId: '控制台',
        goal: '优化 engine-runner 性能瓶颈并降低资源占用。',
        originalGoal: '补齐事前评审合理放行。',
      },
      projectId: '控制台',
      planText: 'CEO brief: 改性能与并发评审。',
      assessment: BoardReview.assessTask('优化 engine-runner 性能瓶颈并降低资源占用。'),
      artifactsRoot,
      memoryFile,
      eventlog: new EventLog(advisoryEventsFile),
      cliRunner(node, ctx, round) {
        advisoryCalls.push({ node: node.id, role: node.agent_role, round, goal: ctx.goal });
        return {
          vars: {
            board_review: {
              risk_level: 'high',
              can_execute: false,
              hard_block: false,
              misjudgment_risk: false,
              issues: [`${node.agent_role} 要补性能压测`],
              suggestions: ['补资源占用基线后默认执行'],
              summary: '有建议但非硬阻断',
            },
          },
        };
      },
    });
    assert.strictEqual(advisory.ok, true);
    assert.strictEqual(advisory.approved, true);
    assert.strictEqual(advisory.paused, false);
    assert.strictEqual(advisoryCalls.length, 4);
    const advisoryEvents = readEvents(advisoryEventsFile);
    assert(advisoryEvents.some(ev => ev.type === 'board.review.approved' && ev.decision === 'default_execute_after_preflight'));

    const riskCalls = [];
    let notifyCalled = false;
    const risk = await BoardReview.runBoardReview({
      spec: {
        taskId: 'board-risk',
        projectId: '控制台',
        queueAgent: 'ceo',
        queueId: 'board-risk-q',
        goal: '重构控制台路由引擎和队列状态机。',
        originalGoal: '重构控制台路由引擎和队列状态机。',
      },
      projectId: '控制台',
      planText: 'CEO brief: 改 project-route 和 review-loop。',
      assessment: BoardReview.assessTask('重构控制台路由引擎和队列状态机。'),
      artifactsRoot,
      memoryFile,
      eventlog: new EventLog(riskEventsFile),
      notify(title, body, extra) {
        notifyCalled = true;
        assert(title.includes('需拍板'));
        // 拍板 Q12:两个选项直接是两个按钮,点按钮=拍板(指向 /api/decision 回调)
        assert(body.includes('批准继续'));
        assert(extra && extra.type === 'decision');
        assert.strictEqual(extra.buttons.length, 3);
        assert.strictEqual(extra.buttons[0].label, '批准继续');
        assert(extra.buttons[0].url.includes('/api/decision/board-decision-'));
        assert(extra.buttons[0].url.includes('/approve?t='));
        assert.strictEqual(extra.buttons[1].label, '驳回取消');
        assert(extra.buttons[1].url.includes('/reject?t='));
        assert(extra.buttons[2].url.includes('/workspace?view=task-board&bulletin=board-decision-'));
        return { sent: true };
      },
      cliRunner(node, ctx, round) {
        riskCalls.push({ node: node.id, role: node.agent_role, round, goal: ctx.goal });
        const isFinalDirector = node.agent_role === 'board_opus48';
        return {
          vars: {
            board_review: {
              risk_level: 'high',
              can_execute: false,
              hard_block: isFinalDirector,
              misjudgment_risk: isFinalDirector,
              issues: [`${node.agent_role} 第${round}轮仍存在误判风险`],
              suggestions: ['需要主人拍板后继续'],
              summary: isFinalDirector ? 'Codex 最终董事判仍有误判风险' : '仍需修订',
            },
          },
        };
      },
    });

    assert.strictEqual(risk.ok, false);
    assert.strictEqual(risk.paused, true);
    assert.strictEqual(risk.maxRounds, 1);
    assert.strictEqual(riskCalls.length, 4);
    assert.strictEqual(notifyCalled, true);
    assert(risk.card && risk.card.card && risk.card.card.id.startsWith('board-decision-'));
    assert(fs.existsSync(risk.card.file), 'decision artifact should be written');
    const cards = JSON.parse(fs.readFileSync(path.join(artifactsRoot, 'bulletin', 'cards.json'), 'utf8'));
    assert(cards.some(card => card.id === risk.card.card.id && card.target === 'ceo'));
    // 拍板 Q12:决策卡记录里保存每卡随机 secret,供 /api/decision 回调校验(不回显日志)
    assert(cards.find(card => card.id === risk.card.card.id).decisionSecret);
    const riskEvents = readEvents(riskEventsFile);
    assert(riskEvents.some(ev => ev.type === 'board.review.round.start' && ev.round === 1 && ev.maxRounds === 1));
    assert(riskEvents.some(ev => ev.type === 'board.review.await_owner' && ev.bulletinId === risk.card.card.id));

    const settleEventsFile = path.join(root, 'settle-events.jsonl');
    const settleFile = path.join(root, 'settle-state.json');
    const baseOpinion = {
      director: 'board_deepseek',
      risk_level: 'low',
      can_execute: true,
      hard_block: false,
      misjudgment_risk: false,
      issues: [],
      suggestions: [],
      summary: 'ok',
    };
    let settle = BoardReview.settleDirectorOpinion({
      file: settleFile,
      taskId: 'settle-unit',
      round: 1,
      directorCount: 3,
      opinion: baseOpinion,
      eventlog: new EventLog(settleEventsFile),
    });
    assert.strictEqual(settle.allSubmitted, false);
    assert.strictEqual(settle.submittedCount, 1);
    settle = BoardReview.settleDirectorOpinion({
      file: settleFile,
      taskId: 'settle-unit',
      round: 1,
      directorCount: 3,
      opinion: Object.assign({}, baseOpinion, { summary: 'duplicate still one' }),
      eventlog: new EventLog(settleEventsFile),
    });
    assert.strictEqual(settle.duplicate, true);
    assert.strictEqual(settle.allSubmitted, false);
    assert.strictEqual(settle.submittedCount, 1);
    settle = BoardReview.settleDirectorOpinion({
      file: settleFile,
      taskId: 'settle-unit',
      round: 1,
      directorCount: 3,
      opinion: Object.assign({}, baseOpinion, { director: 'board_glm52' }),
      eventlog: new EventLog(settleEventsFile),
    });
    assert.strictEqual(settle.allSubmitted, false);
    assert.strictEqual(settle.submittedCount, 2);
    settle = BoardReview.settleDirectorOpinion({
      file: settleFile,
      taskId: 'settle-unit',
      round: 1,
      directorCount: 3,
      opinion: Object.assign({}, baseOpinion, { director: 'board_opus48' }),
      eventlog: new EventLog(settleEventsFile),
    });
    assert.strictEqual(settle.allSubmitted, true);
    assert.strictEqual(settle.justSettled, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(settleFile, 'utf8')).status, 'all_submitted');
    const settleEvents = readEvents(settleEventsFile);
    assert.strictEqual(settleEvents.filter(ev => ev.type === 'board.review.settled').length, 1);

    const legacySettleFile = path.join(root, 'legacy-settle-state.json');
    let legacySettle = BoardReview.settleDirectorOpinion({
      file: legacySettleFile,
      taskId: 'legacy-settle-unit',
      round: 1,
      directorCount: 3,
      opinion: baseOpinion,
      eventlog: new EventLog(path.join(root, 'legacy-settle-events.jsonl')),
    });
    for (const director of ['board_glm52', 'board_gpt55']) {
      settle = BoardReview.settleDirectorOpinion({
        file: legacySettleFile,
        taskId: 'legacy-settle-unit',
        round: 1,
        directorCount: 3,
        opinion: Object.assign({}, baseOpinion, { director }),
        eventlog: new EventLog(path.join(root, 'legacy-settle-events.jsonl')),
      });
      legacySettle = settle;
    }
    assert.strictEqual(legacySettle.allSubmitted, true, '旧 board_gpt55 回报按兼容别名仍可结算旧任务');

    const parallelEventsFile = path.join(root, 'parallel-events.jsonl');
    const starts = [];
    const finishes = [];
    const parallelStarted = Date.now();
    const parallel = await BoardReview.runBoardReview({
      spec: {
        taskId: 'board-parallel',
        projectId: '控制台',
        goal: '重构队列引擎并修复并发竞态。',
        originalGoal: '董事会并行评审测试。',
      },
      projectId: '控制台',
      planText: 'CEO brief: 验证三董事并行。',
      assessment: BoardReview.assessTask('重构队列引擎并修复并发竞态。'),
      artifactsRoot,
      memoryFile,
      eventlog: new EventLog(parallelEventsFile),
      cliRunner: {
        async runNodeAsync(node) {
          starts.push({ role: node.agent_role, at: Date.now() });
          await new Promise(resolve => setTimeout(resolve, 150));
          finishes.push({ role: node.agent_role, at: Date.now() });
          return {
            vars: {
              board_review: {
                risk_level: 'low',
                can_execute: true,
                hard_block: false,
                misjudgment_risk: false,
                issues: [],
                suggestions: [],
                summary: 'parallel ok',
              },
            },
          };
        },
      },
    });
    const parallelElapsed = Date.now() - parallelStarted;
    assert.strictEqual(parallel.ok, true);
    assert.strictEqual(starts.length, 4);
    assert.strictEqual(finishes.length, 4);
    assert(parallelElapsed < 500, `board directors should overlap; elapsed=${parallelElapsed}ms`);
    assert(Math.max(...starts.map(x => x.at)) - Math.min(...starts.map(x => x.at)) < 80, 'director starts should be close together');
    const parallelEvents = readEvents(parallelEventsFile);
    const firstDoneSeq = Math.min(...parallelEvents.filter(ev => ev.type === 'board.review.director.done').map(ev => ev.seq));
    assert.strictEqual(parallelEvents.filter(ev => ev.type === 'node.start' && ev.seq < firstDoneSeq && String(ev.node || '').startsWith('board-')).length, 4);
    assert.strictEqual(parallelEvents.filter(ev => ev.type === 'board.review.settlement.check').length, 4);
    assert.strictEqual(parallelEvents.filter(ev => ev.type === 'board.review.settled').length, 1);
    const settlementPath = BoardReview._test.settlementFileFor(artifactsRoot, 'board-parallel', 1);
    const parallelSettlementState = JSON.parse(fs.readFileSync(settlementPath, 'utf8'));
    assert.strictEqual(parallelSettlementState.submittedCount, 4);
    assert.strictEqual(parallelSettlementState.expectedDirectors, 4, 'full 分级 settle 期望席数=4');

    const partialFailure = await BoardReview.runBoardReview({
      spec: {
        taskId: 'board-partial-failure',
        projectId: '控制台',
        goal: '优化 queue lease 并发锁。',
        originalGoal: '董事会部分失败兜底测试。',
      },
      projectId: '控制台',
      planText: 'CEO brief: 验证非最终董事失败不死锁。',
      assessment: BoardReview.assessTask('优化 queue lease 并发锁。'),
      artifactsRoot,
      memoryFile,
      eventlog: new EventLog(path.join(root, 'partial-failure-events.jsonl')),
      cliRunner: {
        async runNodeAsync(node) {
          if (node.agent_role === 'board_deepseek') return { fail: 'mock timeout' };
          return {
            vars: {
              board_review: {
                risk_level: 'low',
                can_execute: true,
                hard_block: false,
                misjudgment_risk: false,
                issues: [],
                suggestions: [],
                summary: 'other directors ok',
              },
            },
          };
        },
      },
    });
    assert.strictEqual(partialFailure.ok, true);
    assert.strictEqual(partialFailure.approved, true);
    const partialFailureEvents = readEvents(path.join(root, 'partial-failure-events.jsonl'));
    assert(partialFailureEvents.some(ev => ev.type === 'node.absent' && ev.role === 'board_deepseek'), 'runner failure must emit node.absent');
    assert(!partialFailureEvents.some(ev => ev.type === 'node.fail' && ev.role === 'board_deepseek'), 'runner failure must not emit node.fail for board directors');
    const partialSettlement = JSON.parse(fs.readFileSync(BoardReview._test.settlementFileFor(artifactsRoot, 'board-partial-failure', 1), 'utf8'));
    assert.strictEqual(partialSettlement.opinions.board_deepseek.absent, true, 'settlement must persist director absence');
    assert.match(partialFailure.rounds[0].summary, /缺席/, 'round summary must report director absence separately');

    // ── 拍板 Q11 分级评审:普通架构任务端到端只派 2 席(轮值+终审) ──
    const lightOkOpinion = role => ({
      vars: {
        board_review: {
          risk_level: 'low',
          can_execute: true,
          hard_block: false,
          misjudgment_risk: false,
          issues: [],
          suggestions: [],
          summary: `${role} light ok`,
        },
      },
    });
    const lightCalls = [];
    const lightEventsFile = path.join(root, 'light-events.jsonl');
    const lightAssessment = BoardReview.assessTask('重构数据架构,调整 schema 存储。');
    assert.strictEqual(lightAssessment.important, true);
    const light = await BoardReview.runBoardReview({
      spec: {
        taskId: 'board-light',
        projectId: '控制台',
        goal: '重构数据架构,调整 schema 存储。',
        originalGoal: '普通架构任务分级评审测试。',
      },
      projectId: '控制台',
      planText: 'CEO brief: 普通架构任务走轻量席位。',
      assessment: lightAssessment,
      artifactsRoot,
      memoryFile,
      eventlog: new EventLog(lightEventsFile),
      cliRunner(node, ctx, round) {
        lightCalls.push({ node: node.id, role: node.agent_role, round });
        return lightOkOpinion(node.agent_role);
      },
    });
    assert.strictEqual(light.ok, true);
    assert.strictEqual(light.approved, true);
    assert.strictEqual(light.tier, 'light', '普通架构任务结果必须标 light');
    assert.strictEqual(lightCalls.length, 2, '普通架构任务只派 2 席(轮值+终审)');
    assert(lightCalls.some(call => call.role === 'board_opus48'), '终审席必须在场');
    const lightRotatingRole = lightCalls.find(call => call.role !== 'board_opus48').role;
    assert(['board_deepseek', 'board_glm52', 'board_claude'].includes(lightRotatingRole), '轮值席必须来自非终审三席');
    assert.strictEqual(lightRotatingRole, BoardReview._test.rotatingDirectorFor('board-light').id, '轮值席按任务 id 哈希确定');
    assert.deepStrictEqual(light.directors, [lightRotatingRole, 'board_opus48'], '结果必须带派席名单');
    const lightSettlement = JSON.parse(fs.readFileSync(BoardReview._test.settlementFileFor(artifactsRoot, 'board-light', 1), 'utf8'));
    assert.strictEqual(lightSettlement.expectedDirectors, 2, 'settle 期望席数必须按实际派席=2');
    assert.strictEqual(lightSettlement.submittedCount, 2);
    assert.strictEqual(lightSettlement.status, 'all_submitted', '2 席交齐即结算,不得等 4 席死锁');
    const lightEvents = readEvents(lightEventsFile);
    const lightRequired = lightEvents.find(ev => ev.type === 'board.review.required');
    assert.strictEqual(lightRequired.tier, 'light');
    assert.deepStrictEqual(lightRequired.directors, [lightRotatingRole, 'board_opus48']);
    assert(lightEvents.some(ev => ev.type === 'board.review.round.start' && ev.tier === 'light' && ev.directorCount === 2));
    assert(lightEvents.some(ev => ev.type === 'board.review.settled' && ev.expectedDirectors === 2));
    assert(lightEvents.some(ev => ev.type === 'board.review.approved' && ev.tier === 'light'));

    // 轻量席终审仍保留终审判断:board_opus48 判硬阻断必须走拍板卡
    const lightRiskCalls = [];
    const lightRisk = await BoardReview.runBoardReview({
      spec: {
        taskId: 'board-light-risk',
        projectId: '控制台',
        goal: '重构数据架构,调整 schema 存储。',
        originalGoal: '轻量席终审硬阻断测试。',
      },
      projectId: '控制台',
      planText: 'CEO brief: 轻量席终审硬阻断。',
      assessment: BoardReview.assessTask('重构数据架构,调整 schema 存储。'),
      artifactsRoot,
      memoryFile,
      eventlog: new EventLog(path.join(root, 'light-risk-events.jsonl')),
      notify() { return { sent: true }; },
      cliRunner(node) {
        lightRiskCalls.push(node.agent_role);
        const isFinalDirector = node.agent_role === 'board_opus48';
        return {
          vars: {
            board_review: {
              risk_level: 'high',
              can_execute: false,
              hard_block: isFinalDirector,
              misjudgment_risk: isFinalDirector,
              issues: ['轻量席仍判风险'],
              suggestions: ['需要主人拍板'],
              summary: isFinalDirector ? '终审判仍有误判风险' : '仍需修订',
            },
          },
        };
      },
    });
    assert.strictEqual(lightRisk.ok, false);
    assert.strictEqual(lightRisk.paused, true, '轻量席终审硬阻断仍必须暂停等拍板');
    assert.strictEqual(lightRisk.tier, 'light');
    assert.strictEqual(lightRiskCalls.length, 2);
    assert(lightRiskCalls.includes('board_opus48'));

    // 开关退回全体:YUTU6_BOARD_TIERED=0 时普通架构任务也 4 席全体
    process.env.YUTU6_BOARD_TIERED = '0';
    const fallbackCalls = [];
    const fallbackEventsFile = path.join(root, 'tier-fallback-events.jsonl');
    const fallback = await BoardReview.runBoardReview({
      spec: {
        taskId: 'board-light-fallback',
        projectId: '控制台',
        goal: '重构数据架构,调整 schema 存储。',
        originalGoal: '分级开关退回全体测试。',
      },
      projectId: '控制台',
      planText: 'CEO brief: 开关关闭退回全体评审。',
      assessment: BoardReview.assessTask('重构数据架构,调整 schema 存储。'),
      artifactsRoot,
      memoryFile,
      eventlog: new EventLog(fallbackEventsFile),
      cliRunner(node) {
        fallbackCalls.push(node.agent_role);
        return lightOkOpinion(node.agent_role);
      },
    });
    delete process.env.YUTU6_BOARD_TIERED;
    assert.strictEqual(fallback.ok, true);
    assert.strictEqual(fallback.tier, 'full', '开关关闭必须退回 full');
    assert.strictEqual(fallbackCalls.length, 4, 'YUTU6_BOARD_TIERED=0 必须 4 席全体');
    const fallbackEvents = readEvents(fallbackEventsFile);
    assert(fallbackEvents.some(ev => ev.type === 'board.review.required' && ev.tier === 'full' && ev.directors.length === 4));
    const fallbackSettlement = JSON.parse(fs.readFileSync(BoardReview._test.settlementFileFor(artifactsRoot, 'board-light-fallback', 1), 'utf8'));
    assert.strictEqual(fallbackSettlement.expectedDirectors, 4);

    console.log(JSON.stringify({ pass: true, suite: 'board-review' }));
  } finally {
    if (previousConfigFile == null) delete process.env.CONSOLE_CONFIG_FILE;
    else process.env.CONSOLE_CONFIG_FILE = previousConfigFile;
    if (previousTiered == null) delete process.env.YUTU6_BOARD_TIERED;
    else process.env.YUTU6_BOARD_TIERED = previousTiered;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
