import { randomUUID } from 'node:crypto';
import type { BriefItem, BriefSnapshot, ConflictGroup, Observation } from '../domain/types.js';
import { metricById } from '../semantics/catalog.js';
import { distinctValues, groupByIdentity } from '../semantics/identity.js';
import { DocumentLedger } from '../library/document-ledger.js';
import { IntelligenceDatabase } from '../library/database.js';

interface BriefRow {
  id: string;
  topic: string;
  since: string | null;
  workspace_revision: number;
  snapshot_json: string;
  created_at: string;
}

export interface BriefQuery {
  topic?: string;
  since?: string;
}

function topicMatches(observation: Observation, topic: string): boolean {
  if (!topic) return true;
  const normalized = topic.normalize('NFKC').toLowerCase();
  const metric = metricById(observation.candidate.metric)?.label ?? observation.candidate.metric;
  return [metric, observation.candidate.subject ?? '', observation.candidate.quote]
    .some((value) => value.normalize('NFKC').toLowerCase().includes(normalized));
}

function conflictsFrom(groups: Map<string, Observation[]>): ConflictGroup[] {
  return [...groups].map(([identityKey, observations]) => ({
    identityKey,
    metric: observations[0]?.candidate.metric ?? 'unknown',
    subject: observations[0]?.candidate.subject ?? null,
    period: observations[0]?.candidate.period ?? null,
    scope: observations[0]?.candidate.scope ?? null,
    observations,
    values: distinctValues(observations),
  })).filter((group) => group.values.length > 1);
}

function itemFrom(
  identityKey: string,
  accepted: Observation[],
  documents: DocumentLedger,
  reviewerFor: (observationId: string) => string,
): BriefItem | null {
  const representative = accepted[0];
  if (!representative) return null;
  const evidence = accepted.flatMap((observation) => {
    const document = documents.get(observation.documentId, observation.documentRevision);
    const reviewer = reviewerFor(observation.id);
    if (!document) return [];
    return [{
      documentId: document.id,
      revision: document.revision,
      title: document.title,
      sourceUrl: document.sourceUrl,
      publishedAt: document.publishedAt,
      decisionBy: reviewer,
    }];
  });
  return { identityKey, candidate: representative.candidate, evidence };
}

export class BriefingService {
  constructor(
    private readonly database: IntelligenceDatabase,
    private readonly documents: DocumentLedger,
  ) {}

  private reviewerFor(observationId: string): string {
    const row = this.database.connection.prepare(
      `SELECT reviewer FROM review_events WHERE observation_id = ? AND decision = 'accepted'
       ORDER BY revision DESC LIMIT 1`,
    ).get(observationId) as { reviewer: string } | undefined;
    return row?.reviewer ?? '复核人未知';
  }

  generate(query: BriefQuery = {}): BriefSnapshot {
    const topic = query.topic?.trim() ?? '';
    const since = query.since ? new Date(query.since).toISOString() : null;
    const selected = this.documents.allCurrentObservations().filter((observation) => {
      if (!topicMatches(observation, topic)) return false;
      if (!since) return true;
      const document = this.documents.get(observation.documentId, observation.documentRevision);
      return document !== null && document.publishedAt >= since;
    });
    const groups = groupByIdentity(selected.filter((item) => item.decision !== 'rejected'));
    const conflicts = conflictsFrom(groups);
    const conflictKeys = new Set(conflicts.map((group) => group.identityKey));
    const items = [...groups].flatMap(([identityKey, observations]) => {
      if (conflictKeys.has(identityKey)) return [];
      const accepted = observations.filter((item) => item.decision === 'accepted');
      const item = itemFrom(identityKey, accepted, this.documents, (id) => this.reviewerFor(id));
      return item ? [item] : [];
    });
    items.sort((left, right) => left.candidate.metric.localeCompare(right.candidate.metric)
      || (left.candidate.subject ?? '').localeCompare(right.candidate.subject ?? ''));
    const createdAt = new Date().toISOString();
    const id = randomUUID();
    const revision = this.database.workspaceRevision();
    const snapshot: BriefSnapshot = {
      id,
      topic,
      since,
      workspaceRevision: revision,
      createdAt,
      stale: false,
      items,
      unresolved: conflicts,
    };
    this.database.transaction(() => {
      this.database.connection.prepare(
        `INSERT INTO brief_snapshots(id, topic, since, workspace_revision, snapshot_json, created_at)
         VALUES(?, ?, ?, ?, ?, ?)`,
      ).run(id, topic, since, revision, JSON.stringify(snapshot), createdAt);
    });
    return snapshot;
  }

  get(id: string): BriefSnapshot | null {
    const row = this.database.connection.prepare(
      'SELECT * FROM brief_snapshots WHERE id = ?',
    ).get(id) as BriefRow | undefined;
    if (!row) return null;
    const snapshot = JSON.parse(row.snapshot_json) as BriefSnapshot;
    return { ...snapshot, stale: row.workspace_revision !== this.database.workspaceRevision() };
  }

  renderMarkdown(snapshot: BriefSnapshot): string {
    const lines = [
      `# ${snapshot.topic || '中文算力与人工智能情报'}`,
      '',
      `生成时间：${snapshot.createdAt}`,
      `工作区修订：${snapshot.workspaceRevision}${snapshot.stale ? '（已过期）' : ''}`,
      '',
      '## 已复核事实',
    ];
    for (const item of snapshot.items) {
      const candidate = item.candidate;
      const value = typeof candidate.value === 'number'
        ? `${candidate.value.toLocaleString('zh-CN')}${candidate.unit ?? ''}`
        : candidate.value;
      lines.push(`- ${metricById(candidate.metric)?.label ?? candidate.metric}：${candidate.subject ?? '主体未明'}为 ${value}。`);
      for (const source of item.evidence) {
        lines.push(`  - 来源：[${source.title}](${source.sourceUrl})，文章 ${source.documentId} 第 ${source.revision} 版，复核状态${source.decisionBy}。`);
        const sourceDocument = this.documents.get(source.documentId, source.revision);
        if (sourceDocument) lines.push(`  - 原文位置：字符 ${candidate.start}–${candidate.end}，“${candidate.quote}”`);
      }
    }
    if (snapshot.items.length === 0) lines.push('- 当前筛选条件下没有可发布的已复核事实。');
    lines.push('', '## 待处理口径冲突');
    if (snapshot.unresolved.length === 0) lines.push('- 无');
    for (const conflict of snapshot.unresolved) {
      lines.push(`- ${metricById(conflict.metric)?.label ?? conflict.metric}：${conflict.subject ?? '主体未明'}存在 ${conflict.values.join(' / ')} 等不同值，暂不作为确定结论发布。`);
      for (const observation of conflict.observations) {
        lines.push(`  - ${observation.documentId} 第 ${observation.documentRevision} 版，${observation.candidate.quote}`);
      }
    }
    return lines.join('\n');
  }
}
