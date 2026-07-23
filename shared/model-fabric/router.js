'use strict';

function modelById(config, requested) {
  const exact = (config.models || []).find(model => model.id === requested);
  if (exact) return exact;
  return (config.models || []).find(model => Array.isArray(model.aliases) && model.aliases.includes(requested)) || null;
}

function providerById(config, id) {
  return (config.providers || []).find(provider => provider.id === id) || null;
}

function candidateScore(provider, deployment, health) {
  const healthPenalty = health.state === 'healthy' ? 0 : (health.state === 'unknown' ? 5 : 20);
  const latencyPenalty = Math.min(20, Number(health.latency_ms || 0) / 1000);
  return Number(deployment.priority || provider.priority || 100) + healthPenalty + latencyPenalty;
}

function routePlan(config, healthStore, requestedModel, options = {}) {
  const model = modelById(config, requestedModel);
  const deployments = model
    ? model.deployments
    : (config.providers || [])
      .filter(provider => provider.accepts_unlisted_models === true)
      .map(provider => ({ provider: provider.id, model: requestedModel, priority: provider.priority || 100 }));
  const required = new Set(options.required_capabilities || []);
  const candidates = [];

  for (const deployment of deployments || []) {
    const provider = providerById(config, deployment.provider);
    if (!provider || provider.enabled === false) continue;
    const capabilities = new Set([...(model && model.capabilities || []), ...(deployment.capabilities || [])]);
    if ([...required].some(capability => !capabilities.has(capability))) continue;
    const health = healthStore.provider(provider.id);
    candidates.push({
      provider,
      deployment,
      health,
      available: healthStore.isAvailable(provider.id),
      score: candidateScore(provider, deployment, health),
    });
  }

  candidates.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.score - b.score;
  });
  const available = candidates.filter(candidate => candidate.available);
  const ordered = available.length ? available : candidates;
  return {
    requested_model: requestedModel,
    logical_model: model ? model.id : requestedModel,
    capabilities: model && model.capabilities || [],
    candidates: ordered,
    selected: ordered[0] || null,
  };
}

function publicPlan(plan) {
  return {
    requested_model: plan.requested_model,
    logical_model: plan.logical_model,
    capabilities: plan.capabilities,
    selected: plan.selected ? {
      provider: plan.selected.provider.id,
      upstream_model: plan.selected.deployment.model || plan.logical_model,
      score: plan.selected.score,
      health: plan.selected.health.state,
    } : null,
    candidates: plan.candidates.map(candidate => ({
      provider: candidate.provider.id,
      upstream_model: candidate.deployment.model || plan.logical_model,
      priority: candidate.deployment.priority || candidate.provider.priority || 100,
      score: candidate.score,
      available: candidate.available,
      health: candidate.health.state,
    })),
  };
}

module.exports = { modelById, providerById, routePlan, publicPlan };
