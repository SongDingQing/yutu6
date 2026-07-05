'use strict';
/*
 * demo:用 mock runner 在沙箱里真跑 shared/routing/flows/review-loop.yaml,
 * 验证声明式编排 + 护栏(max_loops) + human gate + 事件日志 + 验收证据,全程零网络。
 * 跑:node shared/engine/demo.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const EventLog = require('./eventlog');
const { TaskStore } = require('./taskstore');
const { loadFlow, runFlow } = require('./engine');

const FLOW = path.resolve(__dirname, '../routing/flows/review-loop.yaml');

function makeRunner(reviewScript) {
  let ri = 0;
  return (node, ctx) => {
    if (node.id === 'implement') return {
      vars: {
        implementation: {
          done: true,
          summary: 'mock implementation done',
          changed_files: [],
          receipt: {
            taskId: ctx.taskId || 'T1',
            specFingerprint: ctx.spec_fingerprint,
            changedFiles: [],
            tests: ['mock implement exit 0'],
            artifacts: ['artifacts/demo.png'],
            verdict: 'done',
            blocked_required_specs: [],
          },
          logic_chain: {
            summary: 'mock demo implementation completed',
            current_status: 'done',
            actions: ['ran mock implement node'],
            evidence: [{ kind: 'test', command: 'mock implement', exit_code: 0, summary: 'PASS mock implement' }],
            tests: [{ command: 'mock implement', exit_code: 0, summary: 'PASS' }],
            conclusion: 'mock implement satisfies demo gate',
          },
        },
      },
      evidence: { type: 'screenshot', path: 'artifacts/demo.png' },
    };
    if (node.id === 'review') {
      const review = Object.assign({}, reviewScript[Math.min(ri++, reviewScript.length - 1)]);
      review.verification = {
        verdict: review.pass ? 'true' : 'false',
        checked: ['mock implementation result'],
        evidence: [{ kind: 'test', command: 'mock review', exit_code: 0, summary: 'PASS mock review' }],
      };
      return { vars: { review } };
    }
    return {};
  };
}

function scenario(name, reviewScript, humanGate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-'));
  const log = new EventLog(path.join(dir, 'events.jsonl'));
  const store = new TaskStore(path.join(dir, 'tasks'));
  const flow = loadFlow(FLOW);
  const r = runFlow({ flow, runner: makeRunner(reviewScript), humanGate, eventlog: log, taskstore: store, taskId: 'T1', vars: {} });
  console.log(`\n===== 场景:${name} =====`);
  console.log('结果:', r.ok ? 'OK' : 'STOP(' + r.reason + ')', '| 最终状态:', r.task.state, '| loop:', r.task.loop, '| 证据:', r.task.evidence.length);
  console.log('事件流:');
  for (const ev of log.since(0)) {
    const extra = ev.to ? `→${ev.to}` : ev.decision ? `(${ev.decision})` : ev.reason ? `(${ev.reason})` : ev.node ? `@${ev.node}` : '';
    console.log(`  #${ev.seq} ${ev.type} ${extra}`);
  }
  return r;
}

// 场景 A:评审第 2 轮通过 → done
const A = scenario('评审循环→通过→done', [{ pass: false, severity: 'low' }, { pass: true }], null);
// 场景 B:评审一直不过 → 撞 max_loops → human gate → approve → done
const B = scenario('一直不过→护栏触发→human gate→approve→done',
  [{ pass: false, severity: 'low' }], () => ({
    human: { decision: 'approve' },
    review: {
      pass: true,
      severity: 'low',
      verification: {
        verdict: 'true',
        checked: ['human approved mock review-loop completion'],
        evidence: [{ kind: 'test', command: 'mock human approval', exit_code: 0, summary: 'PASS mock human approval' }],
      },
    },
  }));
// 场景 C:坏流程图(指向不存在节点)→ dry-run 拦截
const { validateFlow } = require('./validate');
const bad = { id: 'bad', guards: { validate_before_run: true }, nodes: [{ id: 'a', agent_role: 'x' }], edges: [{ from: 'a', to: 'ghost' }] };
const v = validateFlow(bad);
console.log('\n===== 场景:坏流程图 dry-run =====');
console.log('校验:', v.ok ? 'OK' : 'BLOCKED', '| 错误:', v.errors.join(' / '));

const pass = A.ok && A.task.state === 'done' && B.ok && B.task.state === 'done' && !v.ok;
console.log('\n>>> 自测', pass ? 'PASS ✅' : 'FAIL ❌');
process.exit(pass ? 0 : 1);
