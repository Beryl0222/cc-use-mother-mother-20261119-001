import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates } from '../../dist/nlp/extract.js';
import { candidateQualityFlags, contextCompleteness, hasBlockingContext, mergeQualityFlags, qualityLabel } from '../../dist/nlp/quality.js';

test('quality hints identify unstated time and scope without filling either value', () => {
  const candidate = extractCandidates('智能算力规模为85 EFLOPS。', '2026-11-19T00:00:00Z')[0];
  assert.equal(candidate.period, null);
  assert.equal(candidate.scope, null);
  assert.ok(candidate.qualityFlags.includes('原文未明确统计时间'));
  assert.ok(candidate.qualityFlags.includes('原文未明确适用范围'));
});

test('a percentage without a comparison basis is marked for blocking review', () => {
  const candidate = extractCandidates('词元调用量增长18%。', '2026-11-19T00:00:00Z')[0];
  assert.ok(candidate.qualityFlags.includes('百分比缺少比较口径'));
  assert.equal(hasBlockingContext(candidate), true);
});

test('a stated comparison with no matching period receives a separate warning', () => {
  const candidate = extractCandidates('智能算力规模同比增长18%。', '2026-11-19T00:00:00Z')[0];
  assert.equal(candidate.comparison, '同比');
  assert.equal(candidate.period, null);
  assert.ok(candidate.qualityFlags.includes('比较口径缺少对应时间范围'));
});

test('quality classification reflects whether any source context is missing', () => {
  assert.equal(qualityLabel([]), 'complete-context');
  assert.equal(qualityLabel(['原文未明确统计时间']), 'review-context');
});

test('context completeness counts known dimensions and stays in a stable range', () => {
  const candidate = extractCandidates('湖北智能算力规模为85 EFLOPS。', '2026-11-19T00:00:00Z')[0];
  const score = contextCompleteness(candidate);
  assert.ok(score >= 0 && score <= 1);
  assert.equal(score, 0.6);
});

test('quality flags merge without introducing duplicate warnings', () => {
  const candidate = extractCandidates('智能算力规模为85 EFLOPS。', '2026-11-19T00:00:00Z')[0];
  const first = candidate.qualityFlags[0];
  const merged = mergeQualityFlags(candidate, [first, '人工复核备注']);
  assert.equal(merged.filter((flag) => flag === first).length, 1);
  assert.ok(merged.includes('人工复核备注'));
});

test('each extracted candidate quotes the full sentence containing its date context', () => {
  const body = '截至2026年9月底，中国智能算力规模达2592 EFLOPS，同比增长146%。';
  const candidates = extractCandidates(body, '2026-11-19T00:00:00Z');
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((candidate) => body.slice(candidate.start, candidate.end) === candidate.quote));
  assert.ok(candidates.every((candidate) => candidate.quote.startsWith('截至2026年9月底')));
});
