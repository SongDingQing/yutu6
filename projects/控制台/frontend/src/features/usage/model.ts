import type { LlmUsageModel } from '../../types';

export interface UsageMetric {
  value: string;
  note: string;
  measured: boolean;
}

export function usageMetric(
  model: LlmUsageModel,
  field: 'calls' | 'input_tokens' | 'output_tokens' | 'total_tokens',
): UsageMetric {
  const raw = model.currentUsage?.[field];
  if (model.sourceStatus !== 'ok' || typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { value: '未计量', note: sourceNote(model), measured: false };
  }
  return {
    value: formatCompactNumber(raw),
    note: model.billingMode === 'subscription_quota' ? '本机日志观测，不代表官方额度' : '网关计量记录',
    measured: true,
  };
}

export function sourceNote(model: LlmUsageModel): string {
  if (model.sourceStatus === 'ok') return model.source || '本机观测';
  if (model.sourceStatus) return `数据源 ${model.sourceStatus}`;
  return '数据源未接入';
}

export function officialQuotaLabel(model: LlmUsageModel): string {
  if (model.billingMode === 'subscription_quota') return '官方剩余额度未计量';
  if (model.billingMode === 'paid_buyout') return model.chargingLabel || '已付费额度';
  return '计费口径未提供';
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 10000 ? 2 : 0,
  }).format(value);
}
