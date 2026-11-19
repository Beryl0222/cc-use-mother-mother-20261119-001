import { randomUUID } from 'node:crypto';
import { DomainError, type Decision, type Observation } from '../domain/types.js';
import { distinctValues, groupByIdentity } from '../semantics/identity.js';
import { hasBlockingContext } from '../nlp/quality.js';
import { DocumentLedger } from '../library/document-ledger.js';
import { IntelligenceDatabase } from '../library/database.js';

interface ReviewEventRow {
  id: string;
  observation_id: string;
  revision: number;
  previous_decision: Decision;
  decision: Decision;
  reviewer: string;
  note: string;
  created_at: string;
}

export interface ReviewCommand {
  expectedRevision: number;
  decision: Exclude<Decision, 'pending'>;
  reviewer: string;
  note?: string;
}

export class ReviewService {
  constructor(
    private readonly database: IntelligenceDatabase,
    private readonly documents: DocumentLedger,
  ) {}

  review(id: string, command: ReviewCommand): Observation {
    if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 0) {
      throw new DomainError('invalid_revision', 'expectedRevision 必须是非负整数');
    }
    const reviewer = command.reviewer.trim();
    if (!reviewer || reviewer.length > 120) throw new DomainError('invalid_reviewer', 'reviewer 必须为 1 至 120 个字符');
    if (command.decision !== 'accepted' && command.decision !== 'rejected') {
      throw new DomainError('invalid_decision', '复核决定必须是 accepted 或 rejected');
    }
    const note = command.note?.trim() ?? '';
    if (note.length > 2_000) throw new DomainError('invalid_note', '复核说明最多 2000 个字符');

    let result: Observation | null = null;
    this.database.transaction(() => {
      const current = this.documents.findObservation(id);
      if (!current) throw new DomainError('observation_not_found', '当前版本中不存在该候选项', 404);
      if (current.reviewRevision !== command.expectedRevision) {
        throw new DomainError('stale_review', '候选项已被其他复核更新，请重新读取后再提交', 409);
      }
      const revision = current.reviewRevision + 1;
      const update = this.database.connection.prepare(
        `UPDATE observations SET decision = ?, review_revision = ?
         WHERE id = ? AND review_revision = ?`,
      ).run(command.decision, revision, id, command.expectedRevision);
      if (Number(update.changes) !== 1) throw new DomainError('stale_review', '候选项已被其他复核更新', 409);
      this.database.connection.prepare(
        `INSERT INTO review_events(id, observation_id, revision, previous_decision, decision, reviewer, note, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), id, revision, current.decision, command.decision, reviewer, note, new Date().toISOString());
      this.database.advanceWorkspaceRevision();
      result = this.documents.findObservation(id);
    });
    if (!result) throw new Error('复核事务未返回候选项');
    return result;
  }

  history(id: string): ReviewEventRow[] {
    return this.database.connection.prepare(
      `SELECT e.* FROM review_events e JOIN observations o ON o.id = e.observation_id
       WHERE e.observation_id = ? ORDER BY e.revision`,
    ).all(id) as unknown as ReviewEventRow[];
  }

  list(decision: Decision | null = null): Observation[] {
    const observations = this.documents.allCurrentObservations();
    return decision ? observations.filter((item) => item.decision === decision) : observations;
  }

  queue(limit = 100, offset = 0) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new DomainError('invalid_limit', 'limit 必须是 1 至 500 的整数');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new DomainError('invalid_offset', 'offset 必须是非负整数');
    }
    const conflicts = new Set(this.conflicts().map((group) => group.identityKey));
    const items = this.list('pending').map((observation) => {
      const disputed = conflicts.has(observation.identityKey);
      const blockingContext = hasBlockingContext(observation.candidate);
      const missingContextCount = observation.candidate.qualityFlags.length;
      const priority = (disputed ? 100 : 0) + (blockingContext ? 50 : 0)
        + missingContextCount * 10 + Math.round((1 - observation.candidate.confidence) * 10);
      return { observation, disputed, blockingContext, missingContextCount, priority };
    }).sort((left, right) => right.priority - left.priority
      || left.observation.createdAt.localeCompare(right.observation.createdAt)
      || left.observation.id.localeCompare(right.observation.id));
    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + page.length < items.length ? offset + page.length : null;
    return { items: page, total: items.length, limit, offset, nextOffset };
  }

  conflicts() {
    return [...groupByIdentity(this.documents.allCurrentObservations())]
      .map(([identityKey, observations]) => ({ identityKey, observations, values: distinctValues(observations) }))
      .filter((group) => group.values.length > 1)
      .map((group) => ({
        ...group,
        metric: group.observations[0]?.candidate.metric ?? 'unknown',
        subject: group.observations[0]?.candidate.subject ?? null,
        period: group.observations[0]?.candidate.period ?? null,
        scope: group.observations[0]?.candidate.scope ?? null,
      }));
  }
}
