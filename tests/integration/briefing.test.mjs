import test from 'node:test';
import assert from 'node:assert/strict';
import { withService, documentInput, computeBody, accept, reject } from '../support/harness.mjs';

test('brief contains only accepted, current facts with their source versions', async () => {
  await withService((service) => {
    service.importDocument(documentInput('brief-source', computeBody(120)));
    const observation = service.listObservations('pending')[0];
    accept(service, observation);
    const brief = service.createBrief({ topic: '算力' });
    assert.equal(brief.items.length, 1);
    assert.equal(brief.items[0].evidence[0].documentId, 'brief-source');
    assert.equal(brief.items[0].evidence[0].revision, 1);
    assert.equal(brief.items[0].evidence[0].decisionBy, '研究员甲');
    assert.equal(brief.stale, false);
  });
});

test('pending evidence does not appear as a confirmed statement', async () => {
  await withService((service) => {
    service.importDocument(documentInput('pending-source', computeBody(120)));
    const brief = service.createBrief({ topic: '算力' });
    assert.equal(brief.items.length, 0);
    assert.equal(service.briefings.renderMarkdown(brief).includes('没有可发布'), true);
  });
});

test('an unresolved conflict is reported and excluded from confirmed brief items', async () => {
  await withService((service) => {
    service.importDocument(documentInput('brief-a', computeBody(120)));
    service.importDocument(documentInput('brief-b', computeBody(128)));
    const [first, second] = service.listObservations();
    accept(service, first);
    accept(service, second);
    const brief = service.createBrief({ topic: '算力' });
    assert.equal(brief.items.length, 0);
    assert.equal(brief.unresolved.length, 1);
    assert.match(service.briefings.renderMarkdown(brief), /暂不作为确定结论发布/u);
  });
});

test('rejecting one disputed observation allows the accepted fact into the brief', async () => {
  await withService((service) => {
    service.importDocument(documentInput('brief-good', computeBody(120)));
    service.importDocument(documentInput('brief-bad', computeBody(128)));
    const observations = service.listObservations();
    const good = observations.find((item) => item.candidate.value === 120);
    const bad = observations.find((item) => item.candidate.value === 128);
    accept(service, good);
    reject(service, bad);
    const brief = service.createBrief({ topic: '算力' });
    assert.equal(brief.items.length, 1);
    assert.equal(brief.unresolved.length, 0);
    assert.equal(brief.items[0].candidate.value, 120);
  });
});

test('a subsequent review marks the saved brief stale without rewriting its snapshot', async () => {
  await withService((service) => {
    service.importDocument(documentInput('stale-review', computeBody(120)));
    const observation = service.listObservations()[0];
    accept(service, observation);
    const brief = service.createBrief({ topic: '算力' });
    const before = service.briefings.get(brief.id);
    service.review(observation.id, {
      expectedRevision: 1,
      decision: 'rejected',
      reviewer: '复核员乙',
      note: '补充核查后撤回接收',
    });
    const after = service.briefings.get(brief.id);
    assert.equal(before.stale, false);
    assert.equal(after.stale, true);
    assert.equal(after.items.length, before.items.length);
  });
});

test('a newer article correction marks the brief stale and removes prior evidence from the next version', async () => {
  await withService((service) => {
    service.importDocument(documentInput('stale-correction', computeBody(120)));
    accept(service, service.listObservations()[0]);
    const prior = service.createBrief({ topic: '算力' });
    service.importDocument(documentInput('stale-correction', computeBody(128), { title: '修订稿' }));
    assert.equal(service.briefings.get(prior.id).stale, true);
    const current = service.createBrief({ topic: '算力' });
    assert.equal(current.items.length, 0);
    assert.equal(current.unresolved.length, 0);
  });
});

test('topic filtering does not mix a neighboring metric into the requested brief', async () => {
  await withService((service) => {
    service.importDocument(documentInput('topic-filter', '湖北智能算力规模为120 EFLOPS。湖北已建成18条算力传输通道。'));
    for (const observation of service.listObservations()) accept(service, observation);
    const brief = service.createBrief({ topic: '通道' });
    assert.equal(brief.items.length, 1);
    assert.equal(brief.items[0].candidate.metric, 'compute_network_channels');
  });
});

test('date filtering uses article publication time and leaves the matching source traceable', async () => {
  await withService((service) => {
    service.importDocument(documentInput('before-date', computeBody(120), { publishedAt: '2026-11-17T00:00:00Z' }));
    service.importDocument(documentInput('after-date', computeBody(128), { publishedAt: '2026-11-19T00:00:00Z' }));
    const observations = service.listObservations();
    observations.forEach((observation) => accept(service, observation));
    const brief = service.createBrief({ topic: '算力', since: '2026-11-18T00:00:00Z' });
    assert.equal(brief.items.length, 1);
    assert.equal(brief.items[0].evidence[0].documentId, 'after-date');
  });
});

test('brief rendering includes source links, revision, exact quote and source offset', async () => {
  await withService((service) => {
    service.importDocument(documentInput('render-source', computeBody(120)));
    accept(service, service.listObservations()[0]);
    const brief = service.createBrief({ topic: '算力' });
    const markdown = service.briefings.renderMarkdown(brief);
    assert.match(markdown, /https:\/\/example\.invalid\/reports\/render-source/u);
    assert.match(markdown, /第 1 版/u);
    assert.match(markdown, /原文位置：字符/u);
    assert.match(markdown, /智能算力规模为120 EFLOPS/u);
  });
});

test('brief snapshots remain readable after a new workspace revision', async () => {
  await withService((service) => {
    service.importDocument(documentInput('snapshot-a', computeBody(120)));
    accept(service, service.listObservations()[0]);
    const brief = service.createBrief({ topic: '算力' });
    service.importDocument(documentInput('snapshot-b', computeBody(128)));
    const stored = service.brief(brief.id);
    assert.equal(stored.snapshot.stale, true);
    assert.equal(stored.snapshot.items.length, 1);
    assert.match(stored.markdown, /已过期/u);
  });
});

test('invalid since dates fail instead of silently broadening the report', async () => {
  await withService((service) => {
    assert.throws(() => service.createBrief({ since: 'not-a-date' }));
  });
});

test('an unknown saved brief returns a domain 404', async () => {
  await withService((service) => {
    assert.throws(() => service.brief('missing'), (error) => error.status === 404);
  });
});
