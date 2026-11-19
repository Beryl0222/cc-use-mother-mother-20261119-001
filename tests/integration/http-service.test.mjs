import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpServer, closeServer } from '../../dist/http/server.js';
import { withService, documentInput, computeBody } from '../support/harness.mjs';

async function withHttp(operation) {
  await withService(async (service) => {
    const server = createHttpServer(service);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    try {
      await operation(base, server);
    } finally {
      await closeServer(server);
    }
  });
}

async function postJson(base, path, body) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('document import and lookup expose candidate provenance through HTTP', async () => {
  await withHttp(async (base) => {
    const input = documentInput('http-document', computeBody(120));
    const created = await postJson(base, '/v1/documents', input);
    assert.equal(created.status, 201);
    assert.equal((await created.json()).candidates, 1);
    const lookup = await fetch(`${base}/v1/documents/http-document`);
    const result = await lookup.json();
    assert.equal(result.current.revision, 1);
    assert.equal(result.observations[0].candidate.value, 120);
  });
});

test('document index returns a bounded summary without article bodies', async () => {
  await withHttp(async (base) => {
    await postJson(base, '/v1/documents', documentInput('index-a', computeBody(120)));
    await postJson(base, '/v1/documents', documentInput('index-b', computeBody(128)));
    const response = await fetch(`${base}/v1/documents?limit=1&offset=0`);
    const page = await response.json();
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].candidateCount, 1);
    assert.equal(page.items[0].pendingCount, 1);
    assert.equal('body' in page.items[0], false);
    assert.equal(page.nextOffset, 1);
  });
});

test('invalid JSON returns a client error and the service remains available', async () => {
  await withHttp(async (base) => {
    const response = await fetch(`${base}/v1/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken',
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'invalid_json');
    assert.equal((await fetch(`${base}/health`)).status, 200);
  });
});

test('oversized requests are rejected before attempting document validation', async () => {
  await withHttp(async (base) => {
    const response = await fetch(`${base}/v1/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x'.repeat(1_000_010) }),
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, 'request_too_large');
  });
});

test('HTTP review uses compare-and-set and reports a stale editor distinctly', async () => {
  await withHttp(async (base) => {
    await postJson(base, '/v1/documents', documentInput('http-review', computeBody(120)));
    const pending = await (await fetch(`${base}/v1/observations?decision=pending`)).json();
    const id = pending[0].id;
    const first = await postJson(base, `/v1/observations/${id}/review`, {
      expectedRevision: 0,
      decision: 'accepted',
      reviewer: 'HTTP核验员',
    });
    assert.equal(first.status, 200);
    const stale = await postJson(base, `/v1/observations/${id}/review`, {
      expectedRevision: 0,
      decision: 'rejected',
      reviewer: '旧页面用户',
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, 'stale_review');
  });
});

test('candidate correction is audited and requires the current review revision', async () => {
  await withHttp(async (base) => {
    await postJson(base, '/v1/documents', documentInput('http-candidate', computeBody(120)));
    const pending = await (await fetch(`${base}/v1/observations?decision=pending`)).json();
    const response = await fetch(`${base}/v1/observations/${pending[0].id}/candidate`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: 0,
        editor: '接口编辑员',
        note: '校订地区主体',
        changes: { subject: '湖北省' },
      }),
    });
    assert.equal(response.status, 200);
    const corrected = await response.json();
    assert.equal(corrected.candidate.subject, '湖北省');
    assert.equal(corrected.decision, 'pending');
  });
});

test('evidence context endpoint returns source offsets and related current claims', async () => {
  await withHttp(async (base) => {
    await postJson(base, '/v1/documents', documentInput('context-a', computeBody(120)));
    await postJson(base, '/v1/documents', documentInput('context-b', computeBody(128)));
    const pending = await (await fetch(`${base}/v1/observations`)).json();
    const response = await fetch(`${base}/v1/observations/${pending[0].id}/context?radius=30`);
    assert.equal(response.status, 200);
    const context = await response.json();
    assert.equal(context.documentRevision, 1);
    assert.ok(context.start < context.end);
    assert.equal(context.related.length, 1);
    assert.equal(context.related[0].candidate.metric, context.candidate.metric);
    assert.ok(context.related[0].relation.includes('报告数值不同'));
  });
});

test('HTTP brief creation returns a saved snapshot and its rendered source note', async () => {
  await withHttp(async (base) => {
    await postJson(base, '/v1/documents', documentInput('http-brief', computeBody(120)));
    const pending = await (await fetch(`${base}/v1/observations`)).json();
    await postJson(base, `/v1/observations/${pending[0].id}/review`, {
      expectedRevision: 0,
      decision: 'accepted',
      reviewer: '接口核验员',
    });
    const created = await postJson(base, '/v1/briefs', { topic: '算力' });
    assert.equal(created.status, 201);
    const payload = await created.json();
    assert.equal(payload.snapshot.items.length, 1);
    assert.match(payload.markdown, /原文位置/u);
    const saved = await fetch(`${base}/v1/briefs/${payload.snapshot.id}`);
    assert.equal((await saved.json()).snapshot.stale, false);
  });
});

test('unknown API routes return a structured 404 response', async () => {
  await withHttp(async (base) => {
    const response = await fetch(`${base}/v1/no-such-route`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'not_found');
  });
});

test('invalid document fields are rejected with a structured client error', async () => {
  await withHttp(async (base) => {
    const response = await postJson(base, '/v1/documents', {
      id: 'no-body',
      title: '缺少正文的文章',
      sourceUrl: 'https://example.invalid/no-body',
      publishedAt: '2026-11-19T00:00:00Z',
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /body/u);
  });
});
