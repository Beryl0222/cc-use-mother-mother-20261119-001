export type Decision = 'pending' | 'accepted' | 'rejected';

export interface DocumentInput {
  id: string;
  title: string;
  sourceUrl: string;
  publishedAt: string;
  body: string;
}

export interface TextSegment {
  text: string;
  start: number;
  end: number;
  ordinal: number;
}

export interface MetricCandidate {
  metric: string;
  subject: string | null;
  value: number | string;
  unit: string | null;
  normalizedValue: string;
  comparison: string | null;
  period: string | null;
  scope: string | null;
  attribution: string | null;
  confidence: number;
  qualityFlags: string[];
  quote: string;
  start: number;
  end: number;
}

export interface Observation {
  id: string;
  documentId: string;
  documentRevision: number;
  decision: Decision;
  reviewRevision: number;
  candidateRevision: number;
  candidate: MetricCandidate;
  identityKey: string;
  createdAt: string;
}

export interface StoredDocument {
  id: string;
  revision: number;
  title: string;
  sourceUrl: string;
  publishedAt: string;
  body: string;
  fingerprint: string;
  current: boolean;
}

export interface ConflictGroup {
  identityKey: string;
  metric: string;
  subject: string | null;
  period: string | null;
  scope: string | null;
  observations: Observation[];
  values: Array<number | string>;
}

export interface BriefItem {
  identityKey: string;
  candidate: MetricCandidate;
  evidence: Array<{
    documentId: string;
    revision: number;
    title: string;
    sourceUrl: string;
    publishedAt: string;
    decisionBy: string;
  }>;
}

export interface BriefSnapshot {
  id: string;
  topic: string;
  since: string | null;
  workspaceRevision: number;
  createdAt: string;
  stale: boolean;
  items: BriefItem[];
  unresolved: ConflictGroup[];
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
