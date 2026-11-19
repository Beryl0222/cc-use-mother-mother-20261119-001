import test from 'node:test';
import assert from 'node:assert/strict';
import { withService, documentInput, computeBody, accept, reject } from '../support/harness.mjs';

test('same metric and same stated period with different values form a conflict', async () => {
  await withService((service) => {
    service.importDocument(documentInput('source-a', computeBody(120)));
    service.importDocument(documentInput('source-b', computeBody(128)));
    const conflicts = service.conflicts();
    assert.equal(conflicts.length, 1);
    assert.deepEqual(new Set(conflicts[0].values), new Set([120, 128]));
    assert.equal(conflicts[0].observations.length, 2);
  });
});

test('different reporting periods do not conflict even if the values differ', async () => {
  await withService((service) => {
    service.importDocument(documentInput('period-a', computeBody(120), { publishedAt: '2026-11-19T00:00:00Z' }));
    service.importDocument(documentInput('period-b', '截至2026年10月底，湖北智能算力规模为128 EFLOPS。'));
    assert.equal(service.conflicts().length, 0);
    assert.notEqual(service.listObservations()[0].identityKey, service.listObservations()[1].identityKey);
  });
});

test('different geographic scopes remain separate evidence groups', async () => {
  await withService((service) => {
    service.importDocument(documentInput('hubei', computeBody(120, '湖北')));
    service.importDocument(documentInput('national', computeBody(2_592, '全国')));
    assert.equal(service.conflicts().length, 0);
    assert.equal(new Set(service.listObservations().map((item) => item.identityKey)).size, 2);
  });
});

test('rejecting the incorrect source resolves a factual conflict without deleting its history', async () => {
  await withService((service) => {
    service.importDocument(documentInput('correct', computeBody(120)));
    service.importDocument(documentInput('incorrect', computeBody(128)));
    const [first, second] = service.listObservations('pending');
    accept(service, first);
    reject(service, second);
    assert.equal(service.conflicts().length, 0);
    assert.equal(service.reviews.history(second.id).length, 1);
    assert.equal(service.reviews.history(second.id)[0].decision, 'rejected');
  });
});

test('stale review revision is rejected and cannot overwrite the winning decision', async () => {
  await withService((service) => {
    service.importDocument(documentInput('cas', computeBody(120)));
    const observation = service.listObservations('pending')[0];
    const accepted = accept(service, observation, '研究员甲');
    assert.throws(() => service.review(observation.id, {
      expectedRevision: 0,
      decision: 'rejected',
      reviewer: '研究员乙',
    }), (error) => error.status === 409);
    assert.equal(service.documents.findObservation(observation.id).decision, 'accepted');
    assert.equal(accepted.reviewRevision, 1);
    assert.equal(service.reviews.history(observation.id).length, 1);
  });
});

test('every successful decision records the previous and new state plus reviewer', async () => {
  await withService((service) => {
    service.importDocument(documentInput('event-log', computeBody(120)));
    const observation = service.listObservations('pending')[0];
    service.review(observation.id, { expectedRevision: 0, decision: 'accepted', reviewer: '甲', note: '首次核验' });
    service.review(observation.id, { expectedRevision: 1, decision: 'rejected', reviewer: '乙', note: '发现口径错配' });
    const history = service.reviews.history(observation.id);
    assert.deepEqual(history.map((event) => event.revision), [1, 2]);
    assert.deepEqual(history.map((event) => event.previous_decision), ['pending', 'accepted']);
    assert.deepEqual(history.map((event) => event.decision), ['accepted', 'rejected']);
    assert.deepEqual(history.map((event) => event.reviewer), ['甲', '乙']);
    assert.equal(history[1].note, '发现口径错配');
  });
});

test('unknown and superseded observations cannot receive a current review', async () => {
  await withService((service) => {
    service.importDocument(documentInput('superseded', computeBody(120)));
    const old = service.listObservations()[0];
    service.importDocument(documentInput('superseded', computeBody(128)));
    assert.throws(() => accept(service, old), (error) => error.status === 404);
    assert.throws(() => service.review('missing', { expectedRevision: 0, decision: 'accepted', reviewer: '甲' }),
      (error) => error.status === 404);
  });
});

test('review validation rejects invalid revision, reviewer, decision and oversized note', async () => {
  await withService((service) => {
    service.importDocument(documentInput('validation', computeBody(120)));
    const observation = service.listObservations()[0];
    assert.throws(() => service.review(observation.id, { expectedRevision: -1, decision: 'accepted', reviewer: '甲' }));
    assert.throws(() => service.review(observation.id, { expectedRevision: 0, decision: 'pending', reviewer: '甲' }));
    assert.throws(() => service.review(observation.id, { expectedRevision: 0, decision: 'accepted', reviewer: ' ' }));
    assert.throws(() => service.review(observation.id, { expectedRevision: 0, decision: 'accepted', reviewer: '甲', note: 'x'.repeat(2001) }));
  });
});

test('conflict query excludes rejected values but keeps non-rejected pending evidence', async () => {
  await withService((service) => {
    service.importDocument(documentInput('kept', computeBody(120)));
    service.importDocument(documentInput('dismissed', computeBody(128)));
    const [kept, dismissed] = service.listObservations();
    accept(service, kept);
    reject(service, dismissed);
    assert.equal(service.conflicts().length, 0);
  });
});

test('decision filters return only the requested current workflow state', async () => {
  await withService((service) => {
    service.importDocument(documentInput('filters', `${computeBody(120)} 湖北已建成18条算力传输通道。`));
    const [first, second] = service.listObservations();
    accept(service, first);
    reject(service, second);
    assert.deepEqual(service.listObservations('accepted').map((item) => item.id), [first.id]);
    assert.deepEqual(service.listObservations('rejected').map((item) => item.id), [second.id]);
    assert.deepEqual(service.listObservations('pending'), []);
  });
});
