import { createHash } from 'node:crypto';
import { DomainError, type DocumentInput, type MetricCandidate } from '../domain/types.js';
import { canonicalUnit } from './catalog.js';

export interface NormalizedCandidate {
  candidate: MetricCandidate;
  identityKey: string;
  comparisonUnit: string | null;
  normalizedPeriod: string | null;
  normalizedScope: string | null;
  normalizedSubject: string | null;
}

function normalizeLabel(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.normalize('NFKC').toLowerCase()
    .replace(/[“”"'‘’]/gu, '')
    .replace(/[\s，,。；;：:()（）]/gu, '');
  return normalized || null;
}

function normalizePeriod(value: string | null): string | null {
  if (!value) return null;
  return value.normalize('NFKC').replace(/\s+/gu, '').replace(/截至/u, '');
}

export function normalizeCandidate(candidate: MetricCandidate): NormalizedCandidate {
  const comparisonUnit = canonicalUnit(candidate.unit);
  const normalizedSubject = normalizeLabel(candidate.subject);
  const normalizedScope = normalizeLabel(candidate.scope);
  const normalizedPeriod = normalizePeriod(candidate.period);
  const components = [
    candidate.metric,
    normalizedSubject ?? '主体未知',
    comparisonUnit ?? '单位未知',
    candidate.comparison ?? '比较口径未知',
    normalizedPeriod ?? '时间未知',
    normalizedScope ?? '范围未知',
  ];
  return {
    candidate,
    identityKey: components.map(encodeURIComponent).join('|'),
    comparisonUnit,
    normalizedPeriod,
    normalizedScope,
    normalizedSubject,
  };
}

export function fingerprintDocument(document: DocumentInput): string {
  const stable = [document.title.trim(), document.sourceUrl.trim(), document.publishedAt.trim(), document.body].join('\u001f');
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}

export function validateDocument(value: unknown): DocumentInput {
  if (!value || typeof value !== 'object') throw new DomainError('invalid_document', '文章必须是 JSON 对象');
  const input = value as Record<string, unknown>;
  const fields = ['id', 'title', 'sourceUrl', 'publishedAt', 'body'] as const;
  for (const field of fields) {
    if (typeof input[field] !== 'string' || !input[field].trim()) throw new DomainError('invalid_document', `文章字段 ${field} 必须是非空文本`);
  }
  const date = new Date(input.publishedAt as string);
  if (!Number.isFinite(date.valueOf())) throw new DomainError('invalid_document', 'publishedAt 必须是有效日期');
  let url: URL;
  try {
    url = new URL(input.sourceUrl as string);
  } catch {
    throw new DomainError('invalid_document', 'sourceUrl 必须是有效 HTTP(S) 地址');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new DomainError('invalid_document', 'sourceUrl 只支持 HTTP(S)');
  if ((input.id as string).length > 160 || (input.title as string).length > 500) throw new DomainError('invalid_document', '文章标识或标题过长');
  if ((input.body as string).length > 500_000) throw new DomainError('invalid_document', '文章正文超过 500000 字符上限');
  return {
    id: (input.id as string).trim(),
    title: (input.title as string).trim(),
    sourceUrl: url.toString(),
    publishedAt: date.toISOString(),
    body: input.body as string,
  };
}

export function sameObservation(left: MetricCandidate, right: MetricCandidate): boolean {
  const a = normalizeCandidate(left);
  const b = normalizeCandidate(right);
  return a.identityKey === b.identityKey && left.normalizedValue === right.normalizedValue;
}
