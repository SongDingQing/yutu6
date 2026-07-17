#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Budget = require('../shared/engine/context-budget');

function main() {
  assert.strictEqual(Budget.policyForNode({ id: 'implement', agent_role: 'worker_code' }, {}).enabled, true);
  assert.strictEqual(Budget.policyForNode({ id: 'review', agent_role: 'supervisor' }, {}).enabled, false);
  assert.strictEqual(Budget.policyForNode({ id: 'orchestrator-plan', agent_role: 'orchestrator' }, {}).enabled, false);
  assert.strictEqual(Budget.policyForNode({ id: 'board-opinion', agent_role: 'board_glm52' }, {}).enabled, false);

  const compact = Budget.policyForNode({ id: 'implement', agent_role: 'worker_code' }, {});
  assert.deepStrictEqual(
    {
      kbHits: compact.kbHits,
      kbChars: compact.kbChars,
      lessonHits: compact.lessonHits,
      lessonChars: compact.lessonChars,
    },
    Budget.DEFAULTS,
  );

  const overridden = Budget.policyForNode({ id: 'implement' }, {
    YUTU6_KB_INJECT_MAX_HITS: '3',
    YUTU6_KB_INJECT_MAX_CHARS: '520',
    YUTU6_LESSON_MAX_HITS: '4',
    YUTU6_LESSON_MAX_CHARS: '1400',
  });
  assert.strictEqual(overridden.kbHits, 3);
  assert.strictEqual(overridden.kbChars, 520);
  assert.strictEqual(overridden.lessonHits, 4);
  assert.strictEqual(overridden.lessonChars, 1400);
  assert.strictEqual(
    Budget.policyForNode({ id: 'implement' }, { YUTU6_KB_INJECT_MAX_HITS: '0' }).kbHits,
    0,
  );

  assert.strictEqual(
    Budget.policyForNode({ id: 'implement' }, { YUTU6_CONTEXT_INJECT: '0' }).enabled,
    false,
  );
  console.log(JSON.stringify({ pass: true, suite: 'context-budget' }));
}

main();
