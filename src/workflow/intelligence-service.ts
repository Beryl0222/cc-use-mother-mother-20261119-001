import { DomainError, type Decision } from '../domain/types.js';
import { CandidateCurationService, type CandidateCorrection } from './candidate-curation-service.js';
import { EvidenceContextService } from './evidence-context-service.js';
import { BriefingService, type BriefQuery } from '../briefing/briefing-service.js';
import { DocumentLedger } from '../library/document-ledger.js';
import { IntelligenceDatabase } from '../library/database.js';
import { ReviewService, type ReviewCommand } from './review-service.js';

export class IntelligenceService {
  readonly documents: DocumentLedger;
  readonly reviews: ReviewService;
  readonly curation: CandidateCurationService;
  readonly evidence: EvidenceContextService;
  readonly briefings: BriefingService;

  constructor(readonly database: IntelligenceDatabase) {
    this.documents = new DocumentLedger(database);
    this.reviews = new ReviewService(database, this.documents);
    this.curation = new CandidateCurationService(database, this.documents);
    this.evidence = new EvidenceContextService(this.documents);
    this.briefings = new BriefingService(database, this.documents);
  }

  importDocument(input: unknown) {
    return this.documents.import(input);
  }

  document(id: string) {
    const document = this.documents.get(id);
    if (!document) throw new DomainError('document_not_found', '未找到该文章', 404);
    return {
      current: document,
      versions: this.documents.versions(id),
      observations: this.documents.observationsFor(id),
    };
  }

  documentSummaries(limit = 50, offset = 0) {
    try {
      return this.documents.listSummaries(limit, offset);
    } catch (error) {
      throw new DomainError('invalid_page', error instanceof Error ? error.message : '分页参数无效');
    }
  }

  listObservations(decision: string | null) {
    if (decision && !['pending', 'accepted', 'rejected'].includes(decision)) {
      throw new DomainError('invalid_decision_filter', 'decision 只支持 pending、accepted 或 rejected');
    }
    return this.reviews.list(decision as Decision | null);
  }

  reviewQueue(limit = 100, offset = 0) {
    return this.reviews.queue(limit, offset);
  }

  review(id: string, command: ReviewCommand) {
    return this.reviews.review(id, command);
  }

  correctCandidate(id: string, command: CandidateCorrection) {
    return this.curation.correct(id, command);
  }

  evidenceContext(id: string, radius?: number) {
    return this.evidence.inspect(id, radius);
  }

  conflicts() {
    return this.reviews.conflicts();
  }

  createBrief(query: BriefQuery) {
    return this.briefings.generate(query);
  }

  brief(id: string) {
    const snapshot = this.briefings.get(id);
    if (!snapshot) throw new DomainError('brief_not_found', '未找到该简报', 404);
    return { snapshot, markdown: this.briefings.renderMarkdown(snapshot) };
  }

  health() {
    return {
      status: 'ok',
      workspaceRevision: this.database.workspaceRevision(),
      documents: this.documents.listDocuments(500).length,
      pendingObservations: this.reviews.list('pending').length,
      unresolvedConflicts: this.conflicts().length,
    };
  }

  close(): void {
    this.database.close();
  }
}

export function createIntelligence(databasePath: string): IntelligenceService {
  return new IntelligenceService(new IntelligenceDatabase(databasePath));
}
