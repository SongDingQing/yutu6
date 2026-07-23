'use strict';

const fs = require('fs');
const path = require('path');
const { expandPath, sanitize } = require('./config');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function agentCatalog(config, workspaceRoot) {
  const root = expandPath(config.control_plane.agent_root, workspaceRoot);
  let names = [];
  try { names = fs.readdirSync(root); } catch (_) {}
  return names.map(name => {
    const file = path.join(root, name, 'agent.json');
    const agent = readJson(file, null);
    if (!agent || !agent.id) return null;
    return {
      id: agent.id,
      name: agent.name || agent.id,
      role: agent.role || agent.id,
      runner: agent.runner || null,
      tier: agent.tier || null,
      queue_agent: agent.queueAgent === true,
      front_door: agent.front_door === true,
      tools: Array.isArray(agent.tools) ? agent.tools : [],
      binds: Array.isArray(agent.binds) ? agent.binds : [],
      triggers: Array.isArray(agent.triggers) ? agent.triggers : [],
      boundary: agent.boundary_statement || null,
      a2a_url: `/a2a/agents/${encodeURIComponent(agent.id)}`,
    };
  }).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}

function capabilityCatalog(config, workspaceRoot) {
  const file = expandPath(config.control_plane.capability_registry, workspaceRoot);
  const registry = readJson(file, {});
  return (registry.modules || []).map(module => ({
    id: module.id,
    status: module.status || 'unknown',
    summary: module.summary || '',
    keywords: module.keywords || [],
    path: module.path || null,
  }));
}

function platformCatalog(config, workspaceRoot) {
  const file = expandPath(config.control_plane.platform_catalog, workspaceRoot);
  const catalog = readJson(file, {});
  return (catalog.platforms || []).map(platform => sanitize(platform));
}

function publicProviders(config, healthStore) {
  return (config.providers || []).map(provider => ({
    ...sanitize(provider),
    health: healthStore.provider(provider.id),
  }));
}

function publicModels(config) {
  return (config.models || []).map(model => ({
    id: model.id,
    label: model.label || model.id,
    aliases: model.aliases || [],
    modalities: model.modalities || ['text'],
    capabilities: model.capabilities || [],
    deployments: (model.deployments || []).map(deployment => ({
      provider: deployment.provider,
      model: deployment.model || model.id,
      priority: deployment.priority || 100,
    })),
  }));
}

module.exports = {
  readJson,
  agentCatalog,
  capabilityCatalog,
  platformCatalog,
  publicProviders,
  publicModels,
};
