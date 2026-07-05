#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const Checker = require('../projects/控制台/tools/office-image-template-check');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function main() {
  const templates = readJson('projects/控制台/templates/office-image/image-granularity-templates.json');
  const refs = readJson('projects/控制台/templates/office-image/reference-manifest.json');
  const meowaSkill = fs.readFileSync(path.join(ROOT, 'shared/tools/meowa/SKILL.md'), 'utf8');
  const meowaContract = fs.readFileSync(path.join(ROOT, 'shared/capability_registry/modules/meowa-game-assets/io-contracts.md'), 'utf8');
  const result = Checker.validateTemplateLibrary(templates);
  assert.strictEqual(result.ok, true, result.errors.join('\n'));
  assert.strictEqual(templates.schema_version, '2026-06-23.office-image-template.v3');
  assert.strictEqual(templates.source_of_truth, 'memory/办公室生图设计规范.md');
  assert.strictEqual(templates.starlaid_excluded, true);
  assert(templates.shared_style.grid.minimum_visible_thickness_px >= 24, 'tile thickness contract must be explicit');
  assert.strictEqual(templates.shared_style.grid.integer_grid_required, true, 'V3 must require integer grid');
  assert.strictEqual(templates.shared_style.grid.complete_footprint_required, true, 'V3 must require complete footprints');
  assert.strictEqual(templates.shared_style.grid.no_missing_corners, true, 'V3 must reject missing corners');
  assert(templates.shared_style.animation.edge_cleanup_required.includes('No white halo') || templates.shared_style.animation.edge_cleanup_required.includes('halo'), 'V3 must require animation edge cleanup');
  assert(result.byId.has('office.reference.sheet.v3'), 'V3 reference sheet template is required');
  assert(result.byId.has('office.person.chairman.office.5x5.v3'), 'chairman 5x5 office template is required');
  assert(result.byId.has('office.person.seated.agent.v1'), 'agent seated template is required');
  assert(result.byId.has('office.tile.carpet.1x1.v1'), '1x1 carpet tile template is required');
  assert(result.byId.has('office.tile.workstation.2x2.v1'), '2x2 workstation template is required');
  assert(result.byId.has('office.animation.typing.v3'), 'typing animation template is required');
  assert(result.byId.has('office.animation.secretary.handoff.v1'), 'secretary handoff animation template is required');
  assert(meowaSkill.includes('office-image-template-check.js'), 'shared Meowa skill must mention the office template gate');
  assert(meowaContract.includes('Yutu6 Office Asset Gate'), 'capability registry must expose the office template gate');

  const pendingImageRef = refs.references.find(ref => ref.file && ref.ownerApproved === false);
  assert(pendingImageRef, 'there must be at least one pending image reference for owner review');
  const pendingRef = path.join(ROOT, pendingImageRef.file);
  assert(fs.existsSync(pendingRef), 'pending reference image must exist for owner review');
  assert.strictEqual(pendingImageRef.ownerApproved, false, 'new reference must not be silently approved');
  assert.strictEqual(refs.active_reference_id, null, 'no active baseline before owner approval');
  assert.strictEqual(refs.latest_reference_id, 'office-style-reference-v3-pending-spec', 'latest pending reference must track V3 spec-only draft');
  const v3Spec = refs.references.find(ref => ref.id === 'office-style-reference-v3-pending-spec');
  assert(v3Spec && v3Spec.file === null && v3Spec.generationAllowed === false, 'V3 spec must not masquerade as a generated reference image');

  const baseSpec = {
    taskId: 'unit-secretary-working',
    project: 'yutu6-control-console',
    templateId: 'office.person.seated.agent.v1',
    assetClass: 'person',
    role: 'secretary',
    meowaCommand: 'pixel-gen-run',
    referenceManifest: 'projects/控制台/templates/office-image/reference-manifest.json',
    referenceImage: pendingImageRef.file,
    outputDir: 'projects/控制台/artifacts/office-assets/unit',
    requirement: 'Generate a seated secretary working sprite with both hands visibly typing at a keyboard.'
  };

  const pendingResult = Checker.validateGenerationSpec(baseSpec, templates);
  assert.strictEqual(pendingResult.ok, false, 'pending owner reference must block real generation');
  assert(pendingResult.errors.some(e => e.includes('not ownerApproved')), 'pending reference error must be explicit');

  const noRefResult = Checker.validateGenerationSpec(Object.assign({}, baseSpec, { referenceImage: '' }), templates);
  assert.strictEqual(noRefResult.ok, false, 'missing reference must block generation');
  assert(noRefResult.errors.some(e => e.includes('referenceImage is required')), 'missing reference reason must be explicit');

  const starlaidResult = Checker.validateGenerationSpec(Object.assign({}, baseSpec, {
    taskId: 'Starlaid-leak',
    requirement: 'Generate a Starlaid office sprite from this template for a different project.'
  }), templates);
  assert.strictEqual(starlaidResult.ok, false, 'Starlaid must be rejected');
  assert(starlaidResult.errors.some(e => e.includes('excluded project')), 'excluded project reason must be explicit');

  const experimentalResult = Checker.validateGenerationSpec(Object.assign({}, baseSpec, {
    referenceImage: 'projects/控制台/artifacts/office-assets/style-reference/office-style-reference-v2-pending.png',
    experimentMode: 'animation-smoke',
    notForProduction: true,
    outputDir: 'projects/控制台/artifacts/office-assets/experiments/unit-secretary-animation'
  }), templates);
  assert.strictEqual(experimentalResult.ok, true, experimentalResult.errors.join('\n'));

  const unsafeExperimentResult = Checker.validateGenerationSpec(Object.assign({}, baseSpec, {
    referenceImage: 'projects/控制台/artifacts/office-assets/style-reference/office-style-reference-v2-pending.png',
    experimentMode: 'animation-smoke',
    notForProduction: true,
    outputDir: 'projects/控制台/public/office-demo-assets'
  }), templates);
  assert.strictEqual(unsafeExperimentResult.ok, false, 'experimental smoke must stay under artifacts/office-assets/experiments');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-image-template-'));
  const approvedReference = path.join(tmp, 'approved.png');
  fs.writeFileSync(approvedReference, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const manifestFile = path.join(tmp, 'reference-manifest.json');
  writeJson(manifestFile, {
    schema_version: 'test',
    active_reference_id: 'approved',
    references: [{ id: 'approved', file: approvedReference, ownerApproved: true }]
  });
  const approvedResult = Checker.validateGenerationSpec(Object.assign({}, baseSpec, {
    referenceManifest: manifestFile,
    referenceImage: approvedReference
  }), templates);
  assert.strictEqual(approvedResult.ok, true, approvedResult.errors.join('\n'));

  const workstationWithoutGrid = Checker.validateGenerationSpec(Object.assign({}, baseSpec, {
    templateId: 'office.tile.workstation.2x2.v1',
    assetClass: 'tile',
    referenceManifest: manifestFile,
    referenceImage: approvedReference,
    requirement: 'Generate a complete 2x2 workstation tile with desk, chair, monitor, and clean joinable boundaries.'
  }), templates);
  assert.strictEqual(workstationWithoutGrid.ok, false, '2x2 workstation generation must require V3 grid contract');
  assert(workstationWithoutGrid.errors.some(e => e.includes('gridContract.v3')), 'missing grid contract error must be explicit');

  const workstationWithGrid = Checker.validateGenerationSpec(Object.assign({}, baseSpec, {
    templateId: 'office.tile.workstation.2x2.v1',
    assetClass: 'tile',
    referenceManifest: manifestFile,
    referenceImage: approvedReference,
    requirement: 'Generate a complete 2x2 workstation tile with desk, chair, monitor, and clean joinable boundaries.',
    gridContract: {
      v3: true,
      gridSpan: '2x2',
      completeFootprint: true,
      noMissingCorners: true
    }
  }), templates);
  assert.strictEqual(workstationWithGrid.ok, true, workstationWithGrid.errors.join('\n'));

  const chairmanWithWrongGrid = Checker.validateGenerationSpec(Object.assign({}, baseSpec, {
    templateId: 'office.person.chairman.office.5x5.v3',
    assetClass: 'person_tile',
    referenceManifest: manifestFile,
    referenceImage: approvedReference,
    requirement: 'Generate the chairman office as a complete 5x5 integer grid with a clear 2x3 main zone.',
    gridContract: {
      v3: true,
      gridSpan: '5x5',
      completeFootprint: true,
      noMissingCorners: true
    }
  }), templates);
  assert.strictEqual(chairmanWithWrongGrid.ok, false, 'chairman office must require 2x3 main station span');
  assert(chairmanWithWrongGrid.errors.some(e => e.includes('mainStationSpan=2x3')), 'missing main station span error must be explicit');

  const typingWithoutAnimationContract = Checker.validateGenerationSpec(Object.assign({}, baseSpec, {
    templateId: 'office.animation.typing.v3',
    assetClass: 'animation',
    meowaCommand: 'animate-run',
    referenceManifest: manifestFile,
    referenceImage: approvedReference,
    requirement: 'Generate a secretary typing loop where only fingers move and the desk remains stable.'
  }), templates);
  assert.strictEqual(typingWithoutAnimationContract.ok, false, 'typing animation must require V3 animation contract');
  assert(typingWithoutAnimationContract.errors.some(e => e.includes('animationContract.v3')), 'missing animation contract error must be explicit');

  const typingWithAnimationContract = Checker.validateGenerationSpec(Object.assign({}, baseSpec, {
    templateId: 'office.animation.typing.v3',
    assetClass: 'animation',
    meowaCommand: 'animate-run',
    referenceManifest: manifestFile,
    referenceImage: approvedReference,
    requirement: 'Generate a secretary typing loop where only fingers move and the desk remains stable.',
    animationContract: {
      v3: true,
      maxInputPx: 256,
      motionPolicy: 'finger-only typing motion, hands and wrists anchored on keyboard',
      edgeCleanup: {
        noWhiteHalo: true
      }
    }
  }), templates);
  assert.strictEqual(typingWithAnimationContract.ok, true, typingWithAnimationContract.errors.join('\n'));

  const refDraftResult = Checker.validateGenerationSpec({
    taskId: 'unit-reference-draft',
    project: 'yutu6-control-console',
    templateId: 'office.reference.sheet.v3',
    assetClass: 'reference_sheet',
    referenceMode: 'create-baseline-for-owner-approval',
    meowaCommand: 'imagegen-or-pixel-gen-run',
    outputDir: 'projects/控制台/artifacts/office-assets/style-reference',
    requirement: 'Create a unified office style reference sheet for owner approval before any batch regeneration.'
  }, templates);
  assert.strictEqual(refDraftResult.ok, true, refDraftResult.errors.join('\n'));

  console.log(JSON.stringify({ pass: true, suite: 'office-image-template' }));
}

main();
