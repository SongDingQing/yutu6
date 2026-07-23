'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA = 'yutu6-gate-policy@1';
const VALID_MODES = new Set(['active', 'shadow', 'dormant']);
const DEFAULT_RELATIVE_PATH = 'projects/控制台/config/gate-policy.json';

function policyPath(workspaceRoot, opts = {}) {
  return path.resolve(
    opts.policyFile
      || process.env.YUTU6_GATE_POLICY_FILE
      || path.join(workspaceRoot || process.cwd(), DEFAULT_RELATIVE_PATH),
  );
}

function loadPolicy(workspaceRoot, opts = {}) {
  const file = policyPath(workspaceRoot, opts);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const validation = validatePolicy(raw, { workspaceRoot: workspaceRoot || process.cwd() });
  if (!validation.ok) {
    throw new Error(`invalid gate policy: ${validation.errors.join('; ')}`);
  }
  return Object.assign({}, raw, { _file: file });
}

function validatePolicy(policy, opts = {}) {
  const errors = [];
  if (!policy || policy.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  if (!policy || !VALID_MODES.has(policy.default_mode)) {
    errors.push(`default_mode must be one of ${[...VALID_MODES].join(', ')}`);
  }
  if (!policy || !policy.gates || typeof policy.gates !== 'object') {
    errors.push('gates object is required');
    return { ok: false, errors };
  }
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  for (const [id, gate] of Object.entries(policy.gates)) {
    if (!gate || typeof gate !== 'object') {
      errors.push(`${id}: policy entry must be an object`);
      continue;
    }
    if (!VALID_MODES.has(gate.mode)) errors.push(`${id}: invalid mode ${gate.mode}`);
    const incidentRefs = normalizeRefs(gate.incident_refs);
    const regressionTests = normalizeRefs(gate.regression_tests);
    if (gate.mode === 'active' && gate.blocking === true && incidentRefs.length === 0) {
      errors.push(`${id}: active blocking gate requires incident_refs`);
    }
    if (gate.mode === 'active' && gate.blocking === true && regressionTests.length === 0) {
      errors.push(`${id}: active blocking gate requires regression_tests`);
    }
    if (!String(gate.reason || '').trim()) errors.push(`${id}: reason is required`);
    if (!String(gate.activation || '').trim()) errors.push(`${id}: activation is required`);
    if (opts.requireExistingRefs === true) {
      for (const ref of incidentRefs) {
        const file = ref.split(':')[0];
        if (!fs.existsSync(path.resolve(workspaceRoot, file))) {
          errors.push(`${id}: incident_ref does not exist: ${ref}`);
        }
      }
      for (const test of regressionTests) {
        const file = test.split(':')[0];
        if (!fs.existsSync(path.resolve(workspaceRoot, file))) {
          errors.push(`${id}: regression_test does not exist: ${test}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function normalizeRefs(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

module.exports = {
  SCHEMA,
  VALID_MODES,
  DEFAULT_RELATIVE_PATH,
  policyPath,
  loadPolicy,
  validatePolicy,
};
