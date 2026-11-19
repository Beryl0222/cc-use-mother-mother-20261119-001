import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntelligence } from '../../dist/workflow/intelligence-service.js';

export async function withService(operation) {
  const directory = await mkdtemp(join(tmpdir(), 'cn-intelligence-test-'));
  const service = createIntelligence(join(directory, 'test.sqlite'));
  try {
    return await operation(service);
  } finally {
    service.close();
    await rm(directory, { recursive: true, force: true });
  }
}

export function documentInput(id, body, overrides = {}) {
  return {
    id,
    title: `合成报道 ${id}`,
    sourceUrl: `https://example.invalid/reports/${id}`,
    publishedAt: '2026-11-19T02:00:00.000Z',
    body,
    ...overrides,
  };
}

export function computeBody(value, prefix = '湖北') {
  return `截至2026年9月底，${prefix}智能算力规模为${value} EFLOPS。`;
}

export function accept(service, observation, reviewer = '研究员甲') {
  return service.review(observation.id, {
    expectedRevision: observation.reviewRevision,
    decision: 'accepted',
    reviewer,
    note: '来源原句与指标口径已核对',
  });
}

export function reject(service, observation, reviewer = '研究员乙') {
  return service.review(observation.id, {
    expectedRevision: observation.reviewRevision,
    decision: 'rejected',
    reviewer,
    note: '来源范围与本次筛选不符',
  });
}
