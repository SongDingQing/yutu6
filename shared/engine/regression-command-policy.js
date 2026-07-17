'use strict';

const UNSAFE_SHELL_RE = /[;&|`$><]|\n/;
const TARGETED_NODE_TEST_RE = /^node\s+tests\/(?!run\.js(?:\s|$))[^\s]+\.js(?:\s|$)/i;
const PROFILED_RUNNER_RE = /^node\s+tests\/run\.js\s+--profile\s+(?:smoke|lean|gate|runtime|routing|full)(?:\s|$)/i;
const TARGETED_PYTEST_RE = /^(?:pytest|python3?\s+-m\s+pytest)\s+\S+/i;

function autoExecutionDecision(command) {
  const cmd = String(command || '').trim();
  if (!cmd) return { allowed: false, reason: 'empty' };
  if (UNSAFE_SHELL_RE.test(cmd)) return { allowed: false, reason: 'unsafe_shell_syntax' };
  if (/^node\s+tests\/run\.js\s*$/i.test(cmd)) {
    return { allowed: false, reason: 'unscoped_full_suite' };
  }
  if (/^(?:npm|pnpm|yarn)\s+(?:run\s+)?test(?:\s|$)/i.test(cmd)) {
    return { allowed: false, reason: 'unscoped_project_suite' };
  }
  if (PROFILED_RUNNER_RE.test(cmd)) return { allowed: true, reason: 'explicit_profile' };
  if (TARGETED_NODE_TEST_RE.test(cmd)) return { allowed: true, reason: 'targeted_node_test' };
  if (TARGETED_PYTEST_RE.test(cmd)) return { allowed: true, reason: 'targeted_pytest' };
  return { allowed: false, reason: 'not_whitelisted' };
}

module.exports = {
  UNSAFE_SHELL_RE,
  TARGETED_NODE_TEST_RE,
  PROFILED_RUNNER_RE,
  TARGETED_PYTEST_RE,
  autoExecutionDecision,
};
