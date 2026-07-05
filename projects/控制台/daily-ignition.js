'use strict';

const DEFAULT_DAILY_IGNITION = {
  timeZone: 'Asia/Shanghai',
  hour: 5,
  minute: 0,
  windowMinutes: 10,
  agents: ['governance', 'quality_ops', 'insight-scout'],
};

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function beijingParts(input) {
  const at = input instanceof Date ? input : new Date(input == null ? Date.now() : input);
  const shifted = new Date(at.getTime() + BEIJING_OFFSET_MS);
  return {
    at,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

function beijingIsoLike(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

function minuteDistance(a, b) {
  const direct = Math.abs(a - b);
  return Math.min(direct, 24 * 60 - direct);
}

function dailyIgnitionAttribution(input, opts = {}) {
  const cfg = Object.assign({}, DEFAULT_DAILY_IGNITION, opts || {});
  const parts = beijingParts(input);
  const currentMinute = parts.hour * 60 + parts.minute + parts.second / 60;
  const targetMinute = Number(cfg.hour || 0) * 60 + Number(cfg.minute || 0);
  const deltaMinutes = minuteDistance(currentMinute, targetMinute);
  const windowMinutes = Number(cfg.windowMinutes || DEFAULT_DAILY_IGNITION.windowMinutes);
  const inWindow = deltaMinutes <= windowMinutes;
  return {
    inWindow,
    reason: inWindow ? 'daily-same-ignition-window' : 'outside-daily-same-ignition-window',
    timeZone: cfg.timeZone || DEFAULT_DAILY_IGNITION.timeZone,
    beijingTime: beijingIsoLike(parts),
    target: `${pad2(Number(cfg.hour || 0))}:${pad2(Number(cfg.minute || 0))}`,
    windowMinutes,
    deltaMinutes: Math.round(deltaMinutes * 100) / 100,
    agents: Array.isArray(cfg.agents) ? cfg.agents.slice() : DEFAULT_DAILY_IGNITION.agents.slice(),
  };
}

function dailyIgnitionEventFields(input, opts = {}) {
  const attribution = dailyIgnitionAttribution(input, opts);
  return {
    dailyIgnitionWindow: attribution.inWindow,
    dailyIgnitionAttribution: attribution,
  };
}

module.exports = {
  DEFAULT_DAILY_IGNITION,
  dailyIgnitionAttribution,
  dailyIgnitionEventFields,
};
