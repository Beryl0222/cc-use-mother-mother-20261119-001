import test from 'node:test';
import assert from 'node:assert/strict';
import { withService, documentInput, computeBody, accept } from '../support/harness.mjs';

test('exact re-import is idempotent and preserves the existing review decision', async () => {
  await withService((service) => {
    const input = documentInput('stable', computeBody(120));
    const first = service.importDocument(input);
    const observation = service.listObservations('pending')[0];
    accept(service, observation);
    const beforeRevision = service.database.workspaceRevision();
    const repeated = service.importDocument(input);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.document.revision, 1);
    assert.equal(service.database.workspaceRevision(), beforeRevision);
    assert.equal(service.listObservations('accepted').length, 1);
    assert.equal(first.candidates, 1);
  });
});

test('a changed title is a new document version even when the body is unchanged', async () => {
  await withService((service) => {
    service.importDocument(documentInput('title-change', computeBody(120)));
    const updated = service.importDocument(documentInput('title-change', computeBody(120), { title: '更正后的标题' }));
    assert.equal(updated.document.revision, 2);
    assert.equal(updated.changed, true);
    assert.deepEqual(service.documents.versions('title-change').map((item) => item.current), [false, true]);
    assert.equal(service.listObservations('pending').length, 1);
  });
});

test('a source correction replaces current evidence but retains the earlier article text', async () => {
  await withService((service) => {
    service.importDocument(documentInput('correction', computeBody(120)));
    const original = service.listObservations('pending')[0];
    accept(service, original);
    const firstBrief = service.createBrief({ topic: '算力' });
    service.importDocument(documentInput('correction', computeBody(128), { title: '更正后的规模数字' }));
    const document = service.document('correction');
    assert.equal(document.current.revision, 2);
    assert.equal(document.versions.length, 2);
    assert.match(document.versions[0].body, /120 EFLOPS/u);
    assert.equal(service.documents.observationsFor('correction')[0].candidate.value, 128);
    assert.equal(service.documents.findObservation(original.id), null);
    assert.equal(service.briefings.get(firstBrief.id).stale, true);
  });
});

test('old article versions remain addressable by revision for citation audit', async () => {
  await withService((service) => {
    service.importDocument(documentInput('history', computeBody(120)));
    service.importDocument(documentInput('history', computeBody(128)));
    const archived = service.documents.get('history', 1);
    assert.equal(archived.current, false);
    assert.match(archived.body, /120 EFLOPS/u);
    assert.equal(service.documents.get('history').body.includes('128 EFLOPS'), true);
  });
});

test('a revision without recognized metrics is stored and clears old current candidates', async () => {
  await withService((service) => {
    service.importDocument(documentInput('no-metric-after-edit', computeBody(120)));
    service.importDocument(documentInput('no-metric-after-edit', '更正说明：原稿中的算力数字已撤回。'));
    assert.equal(service.documents.observationsFor('no-metric-after-edit').length, 0);
    assert.equal(service.documents.versions('no-metric-after-edit').length, 2);
  });
});

test('different source URL for one stable document id is retained as a new revision', async () => {
  await withService((service) => {
    service.importDocument(documentInput('canonical-source', computeBody(120)));
    const changed = service.importDocument(documentInput('canonical-source', computeBody(120), {
      sourceUrl: 'https://example.invalid/reports/canonical-source?edition=2',
    }));
    assert.equal(changed.document.revision, 2);
    assert.match(changed.document.sourceUrl, /edition=2/u);
  });
});

test('article ids are isolated even when their text and claims are identical', async () => {
  await withService((service) => {
    service.importDocument(documentInput('copy-a', computeBody(120)));
    service.importDocument(documentInput('copy-b', computeBody(120)));
    const observations = service.listObservations('pending');
    assert.equal(observations.length, 2);
    assert.equal(observations[0].identityKey, observations[1].identityKey);
    assert.notEqual(observations[0].documentId, observations[1].documentId);
  });
});

test('workspace revision advances for a changed import but not an identical replay', async () => {
  await withService((service) => {
    const start = service.database.workspaceRevision();
    const input = documentInput('watermark', computeBody(120));
    service.importDocument(input);
    const afterWrite = service.database.workspaceRevision();
    service.importDocument(input);
    assert.equal(afterWrite, start + 1);
    assert.equal(service.database.workspaceRevision(), afterWrite);
  });
});

test('document lookup returns a not-found domain response for unknown ids', async () => {
  await withService((service) => {
    assert.throws(() => service.document('absent'), (error) => error.status === 404);
  });
});

test('listing documents is bounded and returns current versions in publication order', async () => {
  await withService((service) => {
    service.importDocument(documentInput('older', computeBody(120), { publishedAt: '2026-11-17T00:00:00Z' }));
    service.importDocument(documentInput('newer', computeBody(128), { publishedAt: '2026-11-18T00:00:00Z' }));
    const list = service.documents.listDocuments(1);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'newer');
  });
});

test('document summary pagination reports candidate counts for the current revision only', async () => {
  await withService((service) => {
    service.importDocument(documentInput('summary-revision', computeBody(120)));
    service.importDocument(documentInput('summary-revision', '更正说明：旧版数字撤回。'));
    const page = service.documents.listSummaries(10, 0);
    assert.equal(page.total, 1);
    assert.equal(page.items[0].revision, 2);
    assert.equal(page.items[0].candidateCount, 0);
    assert.equal(page.items[0].pendingCount, 0);
  });
});
