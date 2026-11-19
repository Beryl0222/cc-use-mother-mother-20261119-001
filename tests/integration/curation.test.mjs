import test from 'node:test';
import assert from 'node:assert/strict';
import { withService, documentInput, computeBody, accept } from '../support/harness.mjs';

test('manual candidate correction preserves the quote and returns to pending review', async () => {
  await withService((service) => {
    service.importDocument(documentInput('curation-state', computeBody(120)));
    const original = service.listObservations('pending')[0];
    accept(service, original);
    const corrected = service.correctCandidate(original.id, {
      expectedRevision: 1,
      editor: '编辑员甲',
      note: '补录原文明确的地区主体',
      changes: { subject: '湖北省' },
    });
    assert.equal(corrected.decision, 'pending');
    assert.equal(corrected.reviewRevision, 2);
    assert.equal(corrected.candidateRevision, 1);
    assert.equal(corrected.candidate.quote, original.candidate.quote);
    assert.equal(corrected.candidate.subject, '湖北省');
  });
});

test('candidate correction changes the semantic group and recomputes conflict membership', async () => {
  await withService((service) => {
    service.importDocument(documentInput('curation-a', computeBody(120)));
    service.importDocument(documentInput('curation-b', computeBody(128)));
    const observations = service.listObservations();
    const moved = observations.find((item) => item.candidate.value === 128);
    const original = observations.find((item) => item.candidate.value === 120);
    service.correctCandidate(moved.id, {
      expectedRevision: 0,
      editor: '编辑员乙',
      note: '原文核对后修正抽取值',
      changes: { subject: '武汉' },
    });
    assert.equal(service.conflicts().length, 0);
    assert.equal(service.reviews.list('pending').some((item) => item.id === moved.id), true);
    assert.equal(service.documents.findObservation(original.id).candidate.value, 120);
    assert.notEqual(service.documents.findObservation(moved.id).identityKey, original.identityKey);
  });
});

test('an unsupported replacement value cannot be attached to the old source quote', async () => {
  await withService((service) => {
    service.importDocument(documentInput('curation-anchor', computeBody(120)));
    const observation = service.listObservations()[0];
    assert.throws(() => service.correctCandidate(observation.id, {
      expectedRevision: 0,
      editor: '编辑员甲',
      note: '尝试写入其他来源的数值',
      changes: { value: 888 },
    }), (error) => error.code === 'unsupported_evidence');
    assert.equal(service.documents.findObservation(observation.id).candidate.value, 120);
  });
});

test('a correction requires a fresh revision and stale editors cannot overwrite it', async () => {
  await withService((service) => {
    service.importDocument(documentInput('curation-cas', computeBody(120)));
    const observation = service.listObservations()[0];
    service.correctCandidate(observation.id, {
      expectedRevision: 0,
      editor: '编辑员甲',
      note: '确认主体表述',
      changes: { subject: '湖北' },
    });
    assert.throws(() => service.correctCandidate(observation.id, {
      expectedRevision: 0,
      editor: '编辑员乙',
      note: '过期页面修改',
      changes: { subject: '全国' },
    }), (error) => error.status === 409);
    assert.equal(service.documents.findObservation(observation.id).candidate.subject, '湖北');
  });
});

test('candidate amendment history stores full before and after values and attribution', async () => {
  await withService((service) => {
    service.importDocument(documentInput('curation-history', computeBody(120)));
    const observation = service.listObservations()[0];
    service.correctCandidate(observation.id, {
      expectedRevision: 0,
      editor: '编辑员丙',
      note: '将主体规范为省级范围',
      changes: { subject: '湖北省', scope: '湖北省' },
    });
    const history = service.curation.history(observation.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].editor, '编辑员丙');
    assert.equal(history[0].note, '将主体规范为省级范围');
    assert.equal(history[0].before.subject, '湖北');
    assert.equal(history[0].after.subject, '湖北省');
    assert.equal(history[0].revision, 1);
  });
});

test('manual numeric correction recomputes its canonical comparison value', async () => {
  await withService((service) => {
    service.importDocument(documentInput('curation-normalize', '平台分配算力标识1198万条。'));
    const observation = service.listObservations()[0];
    const corrected = service.correctCandidate(observation.id, {
      expectedRevision: 0,
      editor: '编辑员丁',
      note: '复核录入值',
      changes: { value: 1198 },
    });
    assert.equal(corrected.candidate.value, 1198);
    assert.equal(corrected.candidate.normalizedValue, '11980000');
  });
});

test('empty and malformed correction commands leave evidence unchanged', async () => {
  await withService((service) => {
    service.importDocument(documentInput('curation-invalid', computeBody(120)));
    const observation = service.listObservations()[0];
    for (const changes of [{}, { metric: 'unlisted_metric' }, { value: Number.NaN }]) {
      assert.throws(() => service.correctCandidate(observation.id, {
        expectedRevision: 0,
        editor: '编辑员甲',
        note: '无效输入检查',
        changes,
      }));
    }
    assert.equal(service.documents.findObservation(observation.id).candidateRevision, 0);
    assert.equal(service.curation.history(observation.id).length, 0);
  });
});

test('candidate correction invalidates a brief generated from the earlier review', async () => {
  await withService((service) => {
    service.importDocument(documentInput('curation-stale', computeBody(120)));
    const observation = service.listObservations()[0];
    accept(service, observation);
    const brief = service.createBrief({ topic: '算力' });
    service.correctCandidate(observation.id, {
      expectedRevision: 1,
      editor: '编辑员甲',
      note: '更新主体规范化',
      changes: { subject: '湖北省' },
    });
    assert.equal(service.briefings.get(brief.id).stale, true);
    assert.equal(service.createBrief({ topic: '算力' }).items.length, 0);
  });
});
