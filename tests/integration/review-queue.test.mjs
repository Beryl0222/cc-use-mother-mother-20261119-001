import test from 'node:test';
import assert from 'node:assert/strict';
import { withService, documentInput, computeBody, accept } from '../support/harness.mjs';

test('queue prioritizes unresolved conflicts over a single unambiguous observation', async () => {
  await withService((service) => {
    service.importDocument(documentInput('queue-single', '湖北已建成18条算力传输通道。'));
    service.importDocument(documentInput('queue-conflict-a', computeBody(120)));
    service.importDocument(documentInput('queue-conflict-b', computeBody(128)));
    const queue = service.reviewQueue().items;
    assert.equal(queue[0].disputed, true);
    assert.equal(queue[1].disputed, true);
    assert.equal(queue[2].disputed, false);
    assert.ok(queue[0].priority >= queue[2].priority);
  });
});

test('blocking comparison context raises priority above ordinary missing context', async () => {
  await withService((service) => {
    service.importDocument(documentInput('queue-low', '湖北已建成18条算力传输通道。'));
    service.importDocument(documentInput('queue-high', '词元调用量增长18%。'));
    const queue = service.reviewQueue().items;
    assert.equal(queue[0].blockingContext, true);
    assert.ok(queue[0].priority > queue[1].priority);
  });
});

test('queue items expose reasons and do not silently accept low confidence facts', async () => {
  await withService((service) => {
    service.importDocument(documentInput('queue-reasons', '词元调用量增长18%。'));
    const item = service.reviewQueue().items[0];
    assert.equal(item.observation.decision, 'pending');
    assert.ok(item.missingContextCount > 0);
    assert.ok(item.observation.candidate.qualityFlags.includes('百分比缺少比较口径'));
  });
});

test('reviewed observations leave the pending queue without changing their audit record', async () => {
  await withService((service) => {
    service.importDocument(documentInput('queue-reviewed', computeBody(120)));
    const observation = service.listObservations()[0];
    accept(service, observation);
    assert.equal(service.reviewQueue().total, 0);
    assert.equal(service.reviews.history(observation.id).length, 1);
  });
});

test('queue ordering is stable when priority and creation timestamp are equal', async () => {
  await withService((service) => {
    service.importDocument(documentInput('queue-z', computeBody(120)));
    service.importDocument(documentInput('queue-a', computeBody(128)));
    const first = service.reviewQueue().items.map((item) => item.observation.id);
    const second = service.reviewQueue().items.map((item) => item.observation.id);
    assert.deepEqual(first, second);
  });
});

test('review queue pagination keeps total priority ordering and reports the next position', async () => {
  await withService((service) => {
    service.importDocument(documentInput('page-1', '湖北已建成18条算力传输通道。'));
    service.importDocument(documentInput('page-2', computeBody(120)));
    service.importDocument(documentInput('page-3', computeBody(128)));
    const first = service.reviewQueue(1, 0);
    const second = service.reviewQueue(1, first.nextOffset);
    assert.equal(first.total, 3);
    assert.equal(first.items.length, 1);
    assert.equal(second.items.length, 1);
    assert.notEqual(first.items[0].observation.id, second.items[0].observation.id);
    assert.equal(first.nextOffset, 1);
    assert.equal(second.offset, 1);
  });
});

test('review queue rejects invalid page bounds', async () => {
  await withService((service) => {
    assert.throws(() => service.reviewQueue(0, 0), (error) => error.code === 'invalid_limit');
    assert.throws(() => service.reviewQueue(501, 0), (error) => error.code === 'invalid_limit');
    assert.throws(() => service.reviewQueue(10, -1), (error) => error.code === 'invalid_offset');
  });
});
