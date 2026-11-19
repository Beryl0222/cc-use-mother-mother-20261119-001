import { randomUUID } from 'node:crypto';
import { DomainError, type MetricCandidate, type Observation } from '../domain/types.js';
import { normalizedCandidateValue, validateCandidate } from '../nlp/extract.js';
import { candidateQualityFlags } from '../nlp/quality.js';
import { metricById } from '../semantics/catalog.js';
import { normalizeCandidate } from '../semantics/normalize.js';
import { DocumentLedger } from '../library/document-ledger.js';
import { IntelligenceDatabase } from '../library/database.js';

export interface CandidateCorrection {
  expectedRevision: number;
  editor: string;
  note: string;
  changes: Partial<Pick<MetricCandidate,
    'metric' | 'subject' | 'value' | 'unit' | 'comparison' | 'period' | 'scope' | 'attribution'>>;
}

interface CandidateEventRow {
  id: string;
  observation_id: string;
  revision: number;
  before_json: string;
  after_json: string;
  editor: string;
  note: string;
  created_at: string;
}

function validateChanges(changes: CandidateCorrection['changes']): void {
  const allowed = new Set(['metric', 'subject', 'value', 'unit', 'comparison', 'period', 'scope', 'attribution']);
  for (const key of Object.keys(changes)) {
    if (!allowed.has(key)) throw new DomainError('invalid_candidate_field', `不支持修改字段 ${key}`);
  }
  if (changes.metric !== undefined && (typeof changes.metric !== 'string' || !metricById(changes.metric))) {
    throw new DomainError('invalid_metric', 'metric 必须是已登记的指标类型');
  }
  if (changes.value !== undefined && typeof changes.value !== 'string' && !Number.isFinite(changes.value)) {
    throw new DomainError('invalid_value', 'value 必须是有限数字或文本');
  }
  for (const key of ['subject', 'unit', 'comparison', 'period', 'scope', 'attribution'] as const) {
    const value = changes[key];
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 300)) {
      throw new DomainError('invalid_candidate_field', `${key} 必须是 300 字以内文本或 null`);
    }
  }
}

function patchCandidate(current: MetricCandidate, changes: CandidateCorrection['changes']): MetricCandidate {
  const next = { ...current, ...changes };
  next.normalizedValue = normalizedCandidateValue(next.value, next.unit);
  next.qualityFlags = candidateQualityFlags(next);
  return next;
}

export class CandidateCurationService {
  constructor(
    private readonly database: IntelligenceDatabase,
    private readonly documents: DocumentLedger,
  ) {}

  correct(id: string, command: CandidateCorrection): Observation {
    if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 0) {
      throw new DomainError('invalid_revision', 'expectedRevision 必须是非负整数');
    }
    const editor = command.editor.trim();
    const note = command.note.trim();
    if (!editor || editor.length > 120) throw new DomainError('invalid_editor', 'editor 必须为 1 至 120 个字符');
    if (!note || note.length > 2_000) throw new DomainError('invalid_note', '校订说明必须为 1 至 2000 个字符');
    validateChanges(command.changes);
    if (Object.keys(command.changes).length === 0) throw new DomainError('empty_correction', '至少需要提供一个校订字段');

    let result: Observation | null = null;
    this.database.transaction(() => {
      const current = this.documents.findObservation(id);
      if (!current) throw new DomainError('observation_not_found', '当前版本中不存在该候选项', 404);
      if (current.reviewRevision !== command.expectedRevision) {
        throw new DomainError('stale_candidate', '候选项已发生变化，请重新读取后再校订', 409);
      }
      const document = this.documents.get(current.documentId, current.documentRevision);
      if (!document) throw new DomainError('document_version_not_found', '候选项引用的文章版本不存在', 409);
      const candidate = patchCandidate(current.candidate, command.changes);
      const issues = validateCandidate(candidate, document.body);
      if (issues.length) throw new DomainError('invalid_candidate', issues.join('；'));
      const metric = metricById(candidate.metric);
      if (!metric?.aliases.some((alias) => candidate.quote.includes(alias))) {
        throw new DomainError('unsupported_evidence', '校订后的指标名称无法在保留的原句中找到依据');
      }
      if (typeof candidate.value === 'number' && !new RegExp(`(?:^|\\D)${candidate.value}(?:\\D|$)`, 'u').test(candidate.quote.replaceAll(',', ''))) {
        throw new DomainError('unsupported_evidence', '校订后的数值无法在保留的原句中找到依据');
      }
      const nextReviewRevision = current.reviewRevision + 1;
      const nextCandidateRevision = current.candidateRevision + 1;
      const identityKey = normalizeCandidate(candidate).identityKey;
      const update = this.database.connection.prepare(
        `UPDATE observations SET candidate_json = ?, identity_key = ?, decision = 'pending',
         review_revision = ?, candidate_revision = ? WHERE id = ? AND review_revision = ?`,
      ).run(JSON.stringify(candidate), identityKey, nextReviewRevision, nextCandidateRevision, id, command.expectedRevision);
      if (Number(update.changes) !== 1) throw new DomainError('stale_candidate', '候选项已发生变化，请重新读取后再校订', 409);
      this.database.connection.prepare(
        `INSERT INTO candidate_events(id, observation_id, revision, before_json, after_json, editor, note, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), id, nextCandidateRevision, JSON.stringify(current.candidate), JSON.stringify(candidate),
        editor, note, new Date().toISOString());
      this.database.advanceWorkspaceRevision();
      result = this.documents.findObservation(id);
    });
    if (!result) throw new Error('候选校订事务未返回记录');
    return result;
  }

  history(id: string): Array<CandidateEventRow & { before: MetricCandidate; after: MetricCandidate }> {
    const rows = this.database.connection.prepare(
      'SELECT * FROM candidate_events WHERE observation_id = ? ORDER BY revision',
    ).all(id) as unknown as CandidateEventRow[];
    return rows.map((row) => ({
      ...row,
      before: JSON.parse(row.before_json) as MetricCandidate,
      after: JSON.parse(row.after_json) as MetricCandidate,
    }));
  }
}
