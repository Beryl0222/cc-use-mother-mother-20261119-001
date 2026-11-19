import type { MetricCandidate } from '../domain/types.js';

export function candidateQualityFlags(candidate: MetricCandidate): string[] {
  const flags: string[] = [];
  if (!candidate.subject) flags.push('原文未明确指标主体');
  if (!candidate.scope) flags.push('原文未明确适用范围');
  if (!candidate.period) flags.push('原文未明确统计时间');
  if (candidate.unit === null) flags.push('原文未明确计量单位');
  if (candidate.unit === '%' && !candidate.comparison) flags.push('百分比缺少比较口径');
  if (candidate.comparison && !candidate.period) flags.push('比较口径缺少对应时间范围');
  if (candidate.confidence < 0.7) flags.push('抽取置信度较低');
  if (candidate.attribution === null) flags.push('原句未识别到明确陈述主体');
  return flags;
}

export function qualityLabel(flags: string[]): 'complete-context' | 'review-context' {
  return flags.length === 0 ? 'complete-context' : 'review-context';
}

export function contextCompleteness(candidate: MetricCandidate): number {
  const dimensions = [candidate.subject, candidate.scope, candidate.period, candidate.unit, candidate.attribution];
  const known = dimensions.filter((value) => value !== null).length;
  return Number((known / dimensions.length).toFixed(2));
}

export function hasBlockingContext(candidate: MetricCandidate): boolean {
  return candidate.qualityFlags.includes('百分比缺少比较口径')
    || candidate.qualityFlags.includes('比较口径缺少对应时间范围');
}

export function mergeQualityFlags(candidate: MetricCandidate, additional: string[]): string[] {
  return [...new Set([...candidate.qualityFlags, ...additional])];
}
