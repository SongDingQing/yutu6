#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_TEMPLATE_FILE = path.join(REPO_ROOT, 'projects/控制台/templates/office-image/image-granularity-templates.json');
const DEFAULT_REFERENCE_MANIFEST = path.join(REPO_ROOT, 'projects/控制台/templates/office-image/reference-manifest.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function resolveWorkspacePath(value) {
  if (!value) return '';
  if (path.isAbsolute(value)) return value;
  if (value.startsWith('/public/')) {
    return path.join(REPO_ROOT, 'projects/控制台/public', value.replace(/^\/public\//, ''));
  }
  return path.join(REPO_ROOT, value);
}

function flattenValues(input, out = []) {
  if (input == null) return out;
  if (Array.isArray(input)) {
    input.forEach(v => flattenValues(v, out));
  } else if (typeof input === 'object') {
    Object.values(input).forEach(v => flattenValues(v, out));
  } else {
    out.push(String(input));
  }
  return out;
}

function validateTemplateLibrary(library) {
  const errors = [];
  if (!library || typeof library !== 'object') errors.push('template library must be an object');
  if (!library.schema_version) errors.push('schema_version is required');
  if (!library.source_of_truth || library.source_of_truth !== 'memory/办公室生图设计规范.md') {
    errors.push('source_of_truth must point to memory/办公室生图设计规范.md');
  }
  if (library.project_scope_policy !== 'system-office-only') {
    errors.push('project_scope_policy must be system-office-only');
  }
  if (!library.shared_style || !library.shared_style.camera || !library.shared_style.palette) {
    errors.push('shared_style.camera and shared_style.palette are required');
  }
  if (!library.shared_style.grid || library.shared_style.grid.integer_grid_required !== true) {
    errors.push('shared_style.grid.integer_grid_required must be true');
  }
  if (!library.shared_style.grid || library.shared_style.grid.complete_footprint_required !== true) {
    errors.push('shared_style.grid.complete_footprint_required must be true');
  }
  if (!library.shared_style.grid || library.shared_style.grid.no_missing_corners !== true) {
    errors.push('shared_style.grid.no_missing_corners must be true');
  }
  if (!library.shared_style.animation || !library.shared_style.animation.edge_cleanup_required) {
    errors.push('shared_style.animation.edge_cleanup_required is required');
  }
  if (!Array.isArray(library.templates) || library.templates.length < 6) {
    errors.push('templates must contain the office asset classes');
  }

  const byId = new Map();
  for (const tpl of library.templates || []) {
    if (!tpl.id) errors.push('template id is required');
    if (tpl.id && byId.has(tpl.id)) errors.push(`duplicate template id: ${tpl.id}`);
    if (tpl.id) byId.set(tpl.id, tpl);
    ['asset_class', 'dimensions', 'projection', 'alignment', 'style_notes'].forEach(field => {
      if (!tpl[field]) errors.push(`${tpl.id || '<unknown>'} missing ${field}`);
    });
  }

  [
    'office.reference.sheet.v3',
    'office.person.seated.agent.v1',
    'office.person.chairman.office.5x5.v3',
    'office.tile.carpet.1x1.v1',
    'office.tile.workstation.2x2.v1',
    'office.tile.wall.partition.v1',
    'office.animation.typing.v3',
    'office.animation.secretary.handoff.v1'
  ].forEach(id => {
    if (!byId.has(id)) errors.push(`required template missing: ${id}`);
  });

  return { ok: errors.length === 0, errors, byId };
}

function loadReferenceManifest(spec) {
  const file = resolveWorkspacePath(spec.referenceManifest || DEFAULT_REFERENCE_MANIFEST);
  return { file, manifest: readJson(file) };
}

function referenceApproved(manifest, referenceImage) {
  const abs = resolveWorkspacePath(referenceImage);
  const normalized = path.relative(REPO_ROOT, abs);
  return (manifest.references || []).filter(ref => ref && ref.file).some(ref => {
    const refAbs = resolveWorkspacePath(ref.file);
    return ref.ownerApproved === true && path.relative(REPO_ROOT, refAbs) === normalized;
  });
}

function referenceKnown(manifest, referenceImage) {
  const abs = resolveWorkspacePath(referenceImage);
  const normalized = path.relative(REPO_ROOT, abs);
  return (manifest.references || []).filter(ref => ref && ref.file).some(ref => {
    const refAbs = resolveWorkspacePath(ref.file);
    return path.relative(REPO_ROOT, refAbs) === normalized;
  });
}

function isExperimentalSmoke(spec) {
  if (spec.experimentMode !== 'animation-smoke') return false;
  if (spec.notForProduction !== true) return false;
  const outputDir = resolveWorkspacePath(spec.outputDir || '');
  const experimentsRoot = path.join(REPO_ROOT, 'projects/控制台/artifacts/office-assets/experiments');
  const rel = path.relative(experimentsRoot, outputDir);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function validateGridContract(spec, template, errors) {
  const id = template && template.id || '';
  const requiresGrid = id === 'office.tile.workstation.2x2.v1' || id === 'office.person.chairman.office.5x5.v3';
  if (!requiresGrid) return;
  const contract = spec.gridContract || {};
  if (contract.v3 !== true) errors.push(`${id} generation requires gridContract.v3=true`);
  if (contract.completeFootprint !== true) errors.push(`${id} generation requires gridContract.completeFootprint=true`);
  if (contract.noMissingCorners !== true) errors.push(`${id} generation requires gridContract.noMissingCorners=true`);
  const expectedSpan = id === 'office.tile.workstation.2x2.v1' ? '2x2' : '5x5';
  if (contract.gridSpan !== expectedSpan) errors.push(`${id} generation requires gridContract.gridSpan=${expectedSpan}`);
  if (id === 'office.person.chairman.office.5x5.v3' && contract.mainStationSpan !== '2x3') {
    errors.push(`${id} generation requires gridContract.mainStationSpan=2x3`);
  }
}

function validateAnimationContract(spec, template, errors) {
  const isAnimation = template && template.asset_class === 'animation';
  const usesAnimate = spec.meowaCommand === 'animate-run';
  if (!isAnimation && !usesAnimate) return;
  const contract = spec.animationContract || {};
  if (contract.v3 !== true) errors.push('animation generation requires animationContract.v3=true');
  if (Number(contract.maxInputPx || 0) > 256 || Number(contract.maxInputPx || 0) <= 0) {
    errors.push('animationContract.maxInputPx must be between 1 and 256 for Meowa pixel animation');
  }
  if (!contract.edgeCleanup || contract.edgeCleanup.noWhiteHalo !== true) {
    errors.push('animationContract.edgeCleanup.noWhiteHalo=true is required');
  }
  const motion = String(contract.motionPolicy || '').toLowerCase();
  if (!motion.includes('finger')) {
    errors.push('animationContract.motionPolicy must explicitly say finger-only typing motion');
  }
}

function validateGenerationSpec(spec, library) {
  const errors = [];
  const templateResult = validateTemplateLibrary(library);
  errors.push(...templateResult.errors);

  if (!spec || typeof spec !== 'object') errors.push('generation spec must be an object');
  if (!spec.taskId) errors.push('taskId is required');
  if (!spec.project || spec.project !== 'yutu6-control-console') errors.push('project must be yutu6-control-console');
  if (!spec.templateId) errors.push('templateId is required');
  const template = templateResult.byId.get(spec.templateId);
  if (!template) errors.push(`unknown templateId: ${spec.templateId || '<missing>'}`);
  if (template && spec.assetClass && spec.assetClass !== template.asset_class) {
    errors.push(`assetClass ${spec.assetClass} does not match template asset_class ${template.asset_class}`);
  }
  if (!spec.meowaCommand) errors.push('meowaCommand is required');
  if (!spec.outputDir) errors.push('outputDir is required');
  if (!spec.requirement || String(spec.requirement).trim().length < 24) errors.push('requirement must be specific enough');

  const creatingReference = /^office\.reference\.sheet\./.test(spec.templateId || '') && spec.referenceMode === 'create-baseline-for-owner-approval';
  if (!creatingReference) {
    if (!spec.referenceImage) {
      errors.push('referenceImage is required for office asset generation');
    } else {
      const referencePath = resolveWorkspacePath(spec.referenceImage);
      if (!fs.existsSync(referencePath)) errors.push(`referenceImage does not exist: ${spec.referenceImage}`);
      try {
        const { manifest } = loadReferenceManifest(spec);
        if (isExperimentalSmoke(spec)) {
          if (!referenceKnown(manifest, spec.referenceImage)) {
            errors.push('experimental referenceImage must still be listed in reference-manifest.json');
          }
        } else if (!referenceApproved(manifest, spec.referenceImage)) {
          errors.push('referenceImage is not ownerApproved in reference-manifest.json');
        }
      } catch (e) {
        errors.push(`reference manifest cannot be read: ${e.message}`);
      }
    }
  }
  if (template && !creatingReference) {
    validateGridContract(spec, template, errors);
    validateAnimationContract(spec, template, errors);
  }

  return { ok: errors.length === 0, errors, template };
}

function main() {
  const templateFile = path.resolve(arg('--templates', DEFAULT_TEMPLATE_FILE));
  const library = readJson(templateFile);
  const specFile = arg('--spec', '');
  let result;
  if (specFile) {
    result = validateGenerationSpec(readJson(path.resolve(specFile)), library);
  } else {
    result = validateTemplateLibrary(library);
  }

  process.stdout.write(JSON.stringify({ ok: result.ok, errors: result.errors }, null, 2) + '\n');
  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e && e.message || String(e) }));
    process.exit(1);
  }
}

module.exports = {
  REPO_ROOT,
  DEFAULT_TEMPLATE_FILE,
  DEFAULT_REFERENCE_MANIFEST,
  resolveWorkspacePath,
  validateTemplateLibrary,
  validateGenerationSpec
};
