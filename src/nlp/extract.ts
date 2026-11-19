import type { MetricCandidate, TextSegment } from '../domain/types.js';
import { findMetric, METRICS } from '../semantics/catalog.js';
import { candidateQualityFlags } from './quality.js';
import { splitClauses, splitSentences } from './segment.js';

const NUMBER = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const VALUE = new RegExp(`(${NUMBER})\\s*(EFLOPS|EFlops|万条|亿条|千条|条|%|％|G|家|次)?`, 'iu');
const ATTRIBUTION = /([^，。；;]{2,28}?)(?:表示|介绍|称|指出|透露|认为|说)/u;
const SCOPE = /(全国|全省|全市|湖北省?|中部地区|东部地区|西部地区|长三角|京津冀|粤港澳大湾区|全球|世界范围)/u;
const PERIOD = /(截至\s*(?:今年|\d{4}年)?\s*(?:\d{1,2}月(?:底)?|第[一二三四]季度)|\d{4}年(?:第[一二三四]季度|\d{1,2}月(?:底)?)|今年(?:上半年|前三季度|以来)?|去年(?:同期)?)/u;
const RANK = /(位居全国第一方阵|全国第一方阵|稳居世界第[一二三四五六七八九十]+|位居全国第[一二三四五六七八九十]+|全国第二|全国第一|世界第二)/u;

function cleanNumber(raw: string): number {
  return Number(raw.replaceAll(',', ''));
}

function periodOf(text: string, publishedAt: string): string | null {
  const found = text.match(PERIOD)?.[0];
  if (!found) return null;
  const year = publishedAt.match(/\d{4}/u)?.[0] ?? null;
  let normalized = found.replace(/\s+/gu, '');
  if (/截至/u.test(normalized) && year && /今年/u.test(normalized)) normalized = normalized.replace('今年', `${year}年`);
  else if (/^今年/u.test(normalized) && year) normalized = normalized.replace('今年', `${year}年`);
  else if (/^去年/u.test(normalized) && year) normalized = normalized.replace('去年', `${Number(year) - 1}年`);
  return normalized.replace(/^截至/u, '');
}

function attributionOf(text: string): string | null {
  const match = text.match(ATTRIBUTION);
  return match?.[1]?.trim() ?? null;
}

function subjectOf(text: string, metricId: string): string | null {
  const definition = METRICS.find((metric) => metric.id === metricId);
  const positions = definition?.aliases.map((alias) => text.indexOf(alias)).filter((position) => position >= 0) ?? [];
  const firstPosition = positions.length ? Math.min(...positions) : text.length;
  const beforeMetric = text.slice(0, firstPosition);
  const scope = beforeMetric.match(SCOPE)?.[0];
  if (scope) return scope;
  const subject = beforeMetric
    .replace(/^(?:数据显示|数据显示，截至[^，]+，|截至[^，]+，)?/u, '')
    .replace(/(?:规模|资源|数量|调用量|申领情况|已建成|新增|达到|达)$/u, '')
    .trim();
  return subject.length >= 2 ? subject.slice(-24) : null;
}

function normalizeMeasure(value: number | string, unit: string | null): string {
  if (typeof value === 'string') return value.normalize('NFKC').toLowerCase();
  const multiplier = unit === '万条' ? 10_000 : unit === '亿条' ? 100_000_000 : unit === '千条' ? 1_000 : 1;
  const precision = unit === '%' ? 4 : 6;
  return Number((value * multiplier).toFixed(precision)).toString();
}

function extractValue(text: string, metricId: string): { value: number | string; unit: string | null; normalizedValue: string } | null {
  if (metricId === 'national_rank') {
    const rank = text.match(RANK)?.[0];
    return rank ? { value: rank, unit: '位次', normalizedValue: normalizeMeasure(rank, '位次') } : null;
  }
  if (metricId === 'growth_rate') {
    const match = text.match(/(?:同比)?(?:增长|上升|下降|减少)\s*([\d,.]+)\s*[%％]/u);
    const value = cleanNumber(match?.[1] ?? '0');
    return match ? { value, unit: '%', normalizedValue: normalizeMeasure(value, '%') } : null;
  }
  const match = text.match(VALUE);
  if (!match?.[1]) return null;
  const rawUnit = match[2]?.replace('％', '%') ?? null;
  const numeric = cleanNumber(match[1]);
  return { value: numeric, unit: rawUnit, normalizedValue: normalizeMeasure(numeric, rawUnit) };
}

function comparisonOf(text: string): string | null {
  if (/同比/u.test(text)) return '同比';
  if (/环比/u.test(text)) return '环比';
  if (/较上年/u.test(text)) return '较上年';
  return null;
}

export function extractCandidates(body: string, publishedAt: string): MetricCandidate[] {
  const candidates: MetricCandidate[] = [];
  for (const sentence of splitSentences(body)) {
    for (const segment of splitClauses(sentence)) {
    const metric = findMetric(segment.text);
    if (!metric) continue;
    const extracted = extractValue(segment.text, metric.id);
    if (!extracted) continue;
    const metricPosition = segment.text.indexOf(metric.label);
    const candidate: MetricCandidate = {
      metric: metric.id,
      subject: subjectOf(segment.text, metric.id) ?? subjectOf(sentence.text, metric.id),
      value: extracted.value,
      unit: extracted.unit ?? metric.defaultUnit,
      normalizedValue: extracted.normalizedValue,
      comparison: comparisonOf(segment.text),
      period: periodOf(sentence.text, publishedAt),
      scope: segment.text.match(SCOPE)?.[0] ?? sentence.text.match(SCOPE)?.[0] ?? null,
      attribution: attributionOf(segment.text) ?? attributionOf(sentence.text),
      confidence: confidenceOf(segment, metricPosition, extracted.unit),
      qualityFlags: [],
      quote: sentence.text,
      start: sentence.start,
      end: sentence.end,
    };
    candidate.qualityFlags = candidateQualityFlags(candidate);
    candidates.push(candidate);
    }
  }
  return candidates;
}

function confidenceOf(segment: TextSegment, metricPosition: number, unit: string | null): number {
  let score = 0.54;
  if (metricPosition >= 0) score += 0.12;
  if (unit) score += 0.13;
  if (/[\d]/u.test(segment.text)) score += 0.1;
  if (/(表示|介绍|称|指出|数据显示)/u.test(segment.text)) score += 0.06;
  return Math.min(0.95, Number(score.toFixed(2)));
}

export function validateCandidate(candidate: MetricCandidate, body: string): string[] {
  const issues: string[] = [];
  if (candidate.start < 0 || candidate.end > body.length || candidate.end <= candidate.start) {
    issues.push('原文位置超出文章正文');
  } else if (body.slice(candidate.start, candidate.end) !== candidate.quote) {
    issues.push('候选原句与保存的字符位置不一致');
  }
  if (!candidate.metric) issues.push('缺少指标类型');
  if (!candidate.normalizedValue) issues.push('缺少归一化值');
  if (candidate.confidence < 0 || candidate.confidence > 1) issues.push('置信度不在有效范围');
  return issues;
}

export function candidateSummary(candidate: MetricCandidate): string {
  const value = typeof candidate.value === 'number' ? candidate.value.toLocaleString('zh-CN') : candidate.value;
  return `${candidate.metric}：${candidate.subject ?? '主体未明'} ${value}${candidate.unit ?? ''}`;
}

export function normalizedCandidateValue(value: number | string, unit: string | null): string {
  return normalizeMeasure(value, unit);
}
