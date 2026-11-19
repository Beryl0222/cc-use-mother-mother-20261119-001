import { DomainError, type MetricCandidate } from '../domain/types.js';
import { metricById } from '../semantics/catalog.js';
import { lexicalOverlap } from '../nlp/overlap.js';
import { contextCompleteness, hasBlockingContext, qualityLabel } from '../nlp/quality.js';
import { DocumentLedger } from '../library/document-ledger.js';

export interface EvidenceContext {
  observationId: string;
  documentId: string;
  documentRevision: number;
  title: string;
  sourceUrl: string;
  publishedAt: string;
  quote: string;
  start: number;
  end: number;
  context: string;
  contextCompleteness: number;
  contextLabel: 'complete-context' | 'review-context';
  blockingContext: boolean;
  qualityFlags: string[];
  candidate: MetricCandidate;
  related: Array<{
    observationId: string;
    documentId: string;
    documentRevision: number;
    title: string;
    sourceUrl: string;
    candidate: MetricCandidate;
    similarity: number;
    relation: string[];
  }>;
}

function relationTo(left: MetricCandidate, right: MetricCandidate): string[] {
  const differences: string[] = [];
  if (left.metric !== right.metric) differences.push('指标不同');
  if (left.subject !== right.subject) differences.push('主体不同或未明');
  if (left.unit !== right.unit) differences.push('单位不同或未明');
  if (left.comparison !== right.comparison) differences.push('比较口径不同或未明');
  if (left.period !== right.period) differences.push('时间范围不同或未明');
  if (left.scope !== right.scope) differences.push('适用范围不同或未明');
  if (left.normalizedValue !== right.normalizedValue) differences.push('报告数值不同');
  return differences;
}

function contextSlice(body: string, candidate: MetricCandidate, radius: number): string {
  const start = Math.max(0, candidate.start - radius);
  const end = Math.min(body.length, candidate.end + radius);
  return body.slice(start, end);
}

export class EvidenceContextService {
  constructor(private readonly documents: DocumentLedger) {}

  inspect(id: string, radius = 120): EvidenceContext {
    if (!Number.isInteger(radius) || radius < 0 || radius > 2_000) {
      throw new DomainError('invalid_radius', 'radius 必须是 0 至 2000 的整数');
    }
    const observation = this.documents.findObservation(id);
    if (!observation) throw new DomainError('observation_not_found', '当前版本中不存在该候选项', 404);
    const document = this.documents.get(observation.documentId, observation.documentRevision);
    if (!document) throw new DomainError('document_version_not_found', '候选项引用的文章版本不存在', 409);
    const related = this.documents.allCurrentObservations()
      .filter((item) => item.id !== id && item.candidate.metric === observation.candidate.metric)
      .map((item) => {
        const source = this.documents.get(item.documentId, item.documentRevision);
        return source ? {
          observationId: item.id,
          documentId: source.id,
          documentRevision: source.revision,
          title: source.title,
          sourceUrl: source.sourceUrl,
          candidate: item.candidate,
          relation: relationTo(observation.candidate, item.candidate),
          similarity: lexicalOverlap(observation.candidate.quote, item.candidate.quote),
        } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((left, right) => right.similarity - left.similarity || left.documentId.localeCompare(right.documentId));
    return {
      observationId: observation.id,
      documentId: document.id,
      documentRevision: document.revision,
      title: document.title,
      sourceUrl: document.sourceUrl,
      publishedAt: document.publishedAt,
      quote: observation.candidate.quote,
      start: observation.candidate.start,
      end: observation.candidate.end,
      context: contextSlice(document.body, observation.candidate, radius),
      contextCompleteness: contextCompleteness(observation.candidate),
      contextLabel: qualityLabel(observation.candidate.qualityFlags),
      blockingContext: hasBlockingContext(observation.candidate),
      qualityFlags: observation.candidate.qualityFlags,
      candidate: observation.candidate,
      related,
    };
  }

  metricLabel(id: string): string {
    return metricById(id)?.label ?? id;
  }
}
