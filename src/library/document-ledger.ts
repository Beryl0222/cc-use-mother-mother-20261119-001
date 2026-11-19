import { randomUUID } from 'node:crypto';
import type { DocumentInput, MetricCandidate, StoredDocument } from '../domain/types.js';
import { extractCandidates } from '../nlp/extract.js';
import { fingerprintDocument, validateDocument } from '../semantics/normalize.js';
import { normalizeCandidate } from '../semantics/normalize.js';
import { IntelligenceDatabase } from './database.js';

interface DocumentRow {
  id: string;
  revision: number;
  title: string;
  source_url: string;
  published_at: string;
  body: string;
  fingerprint: string;
  current: number;
}

interface ObservationRow {
  id: string;
  document_id: string;
  document_revision: number;
  candidate_json: string;
  identity_key: string;
  decision: 'pending' | 'accepted' | 'rejected';
  review_revision: number;
  candidate_revision: number;
  created_at: string;
}

interface DocumentSummaryRow {
  id: string;
  revision: number;
  title: string;
  source_url: string;
  published_at: string;
  candidate_count: number;
  pending_count: number;
}

function documentFrom(row: DocumentRow): StoredDocument {
  return {
    id: row.id,
    revision: row.revision,
    title: row.title,
    sourceUrl: row.source_url,
    publishedAt: row.published_at,
    body: row.body,
    fingerprint: row.fingerprint,
    current: row.current === 1,
  };
}

export function observationFrom(row: ObservationRow) {
  return {
    id: row.id,
    documentId: row.document_id,
    documentRevision: row.document_revision,
    candidate: JSON.parse(row.candidate_json) as MetricCandidate,
    identityKey: row.identity_key,
    decision: row.decision,
    reviewRevision: row.review_revision,
    candidateRevision: row.candidate_revision,
    createdAt: row.created_at,
  } as const;
}

export class DocumentLedger {
  constructor(private readonly database: IntelligenceDatabase) {}

  import(raw: unknown): { document: StoredDocument; candidates: number; changed: boolean } {
    const input = validateDocument(raw);
    const fingerprint = fingerprintDocument(input);
    const previous = this.currentVersion(input.id);
    if (previous?.fingerprint === fingerprint) {
      return { document: documentFrom(previous), candidates: this.observationsFor(input.id).length, changed: false };
    }

    const now = new Date().toISOString();
    const revision = (previous?.revision ?? 0) + 1;
    const candidates = extractCandidates(input.body, input.publishedAt);
    this.database.transaction(() => {
      this.database.connection.prepare(
        `INSERT INTO documents(id, current_revision, created_at, updated_at)
         VALUES(?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET current_revision = excluded.current_revision, updated_at = excluded.updated_at`,
      ).run(input.id, revision, now, now);
      this.database.connection.prepare(
        'UPDATE document_versions SET current = 0 WHERE document_id = ? AND current = 1',
      ).run(input.id);
      this.database.connection.prepare(
        `INSERT INTO document_versions(document_id, revision, title, source_url, published_at, body, fingerprint, current, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(input.id, revision, input.title, input.sourceUrl, input.publishedAt, input.body, fingerprint, now);
      const insert = this.database.connection.prepare(
        `INSERT INTO observations(id, document_id, document_revision, candidate_index, candidate_json, identity_key, decision, created_at)
         VALUES(?, ?, ?, ?, ?, ?, 'pending', ?)`,
      );
      candidates.forEach((candidate, index) => insert.run(
        randomUUID(), input.id, revision, index, JSON.stringify(candidate),
        normalizeCandidate(candidate).identityKey, now,
      ));
      this.database.advanceWorkspaceRevision();
    });
    const document = this.currentVersion(input.id);
    if (!document) throw new Error('文章版本事务提交后无法读取当前记录');
    return { document: documentFrom(document), candidates: candidates.length, changed: true };
  }

  currentVersion(id: string): DocumentRow | null {
    const row = this.database.connection.prepare(
      `SELECT d.id, v.revision, v.title, v.source_url, v.published_at, v.body, v.fingerprint, v.current
       FROM documents d JOIN document_versions v ON v.document_id = d.id AND v.revision = d.current_revision
       WHERE d.id = ?`,
    ).get(id) as DocumentRow | undefined;
    return row ?? null;
  }

  get(id: string, revision?: number): StoredDocument | null {
    const row = revision === undefined
      ? this.currentVersion(id)
      : this.database.connection.prepare(
        `SELECT document_id AS id, revision, title, source_url, published_at, body, fingerprint, current
         FROM document_versions WHERE document_id = ? AND revision = ?`,
      ).get(id, revision) as DocumentRow | undefined;
    return row ? documentFrom(row) : null;
  }

  versions(id: string): StoredDocument[] {
    const rows = this.database.connection.prepare(
      `SELECT document_id AS id, revision, title, source_url, published_at, body, fingerprint, current
       FROM document_versions WHERE document_id = ? ORDER BY revision`,
      ).all(id) as unknown as DocumentRow[];
    return rows.map(documentFrom);
  }

  observationsFor(id: string): ReturnType<typeof observationFrom>[] {
    const rows = this.database.connection.prepare(
      `SELECT o.* FROM observations o JOIN document_versions v
       ON v.document_id = o.document_id AND v.revision = o.document_revision
       WHERE o.document_id = ? AND v.current = 1 ORDER BY o.created_at, o.id`,
      ).all(id) as unknown as ObservationRow[];
    return rows.map(observationFrom);
  }

  allCurrentObservations(): ReturnType<typeof observationFrom>[] {
    const rows = this.database.connection.prepare(
      `SELECT o.* FROM observations o JOIN document_versions v
       ON v.document_id = o.document_id AND v.revision = o.document_revision
       WHERE v.current = 1 ORDER BY v.published_at, o.created_at, o.id`,
      ).all() as unknown as ObservationRow[];
    return rows.map(observationFrom);
  }

  findObservation(id: string): ReturnType<typeof observationFrom> | null {
    const row = this.database.connection.prepare(
      `SELECT o.* FROM observations o JOIN document_versions v
       ON v.document_id = o.document_id AND v.revision = o.document_revision
       WHERE o.id = ? AND v.current = 1`,
    ).get(id) as ObservationRow | undefined;
    return row ? observationFrom(row) : null;
  }

  listDocuments(limit = 100): StoredDocument[] {
    const bounded = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = this.database.connection.prepare(
      `SELECT d.id, v.revision, v.title, v.source_url, v.published_at, v.body, v.fingerprint, v.current
       FROM documents d JOIN document_versions v ON v.document_id = d.id AND v.revision = d.current_revision
       ORDER BY v.published_at DESC, d.id LIMIT ?`,
      ).all(bounded) as unknown as DocumentRow[];
    return rows.map(documentFrom);
  }

  listSummaries(limit = 50, offset = 0) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError('limit 必须是 1 至 500 的整数');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new RangeError('offset 必须是非负整数');
    }
    const totalRow = this.database.connection.prepare('SELECT COUNT(*) AS total FROM documents').get() as { total: number };
    const rows = this.database.connection.prepare(
      `SELECT d.id, v.revision, v.title, v.source_url, v.published_at,
        COUNT(o.id) AS candidate_count,
        SUM(CASE WHEN o.decision = 'pending' THEN 1 ELSE 0 END) AS pending_count
       FROM documents d JOIN document_versions v
         ON v.document_id = d.id AND v.revision = d.current_revision
       LEFT JOIN observations o ON o.document_id = v.document_id AND o.document_revision = v.revision
       GROUP BY d.id, v.revision
       ORDER BY v.published_at DESC, d.id LIMIT ? OFFSET ?`,
    ).all(limit, offset) as unknown as DocumentSummaryRow[];
    return {
      items: rows.map((row) => ({
        id: row.id,
        revision: row.revision,
        title: row.title,
        sourceUrl: row.source_url,
        publishedAt: row.published_at,
        candidateCount: row.candidate_count,
        pendingCount: row.pending_count,
      })),
      total: totalRow.total,
      limit,
      offset,
      nextOffset: offset + rows.length < totalRow.total ? offset + rows.length : null,
    };
  }

  inputFromStored(document: StoredDocument): DocumentInput {
    return {
      id: document.id,
      title: document.title,
      sourceUrl: document.sourceUrl,
      publishedAt: document.publishedAt,
      body: document.body,
    };
  }
}
