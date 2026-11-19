import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateSummary, extractCandidates, validateCandidate } from '../../dist/nlp/extract.js';

test('extracts a metric, time period, region, unit and exact original quote', () => {
  const body = '截至2026年9月底，湖北智能算力规模达到120 EFLOPS。';
  const candidates = extractCandidates(body, '2026-11-19T02:00:00Z');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].metric, 'intelligent_compute_scale');
  assert.equal(candidates[0].subject, '湖北');
  assert.equal(candidates[0].value, 120);
  assert.equal(candidates[0].unit, 'EFLOPS');
  assert.equal(candidates[0].period, '2026年9月底');
  assert.equal(body.slice(candidates[0].start, candidates[0].end), candidates[0].quote);
  assert.deepEqual(validateCandidate(candidates[0], body), []);
});

test('separates two metrics stated in one sentence and retains sentence context', () => {
  const body = '截至2026年9月底，中国智能算力规模达2592 EFLOPS，同比增长146%。';
  const candidates = extractCandidates(body, '2026-11-19T02:00:00Z');
  assert.deepEqual(candidates.map((candidate) => candidate.metric), ['intelligent_compute_scale', 'growth_rate']);
  assert.deepEqual(candidates.map((candidate) => candidate.value), [2592, 146]);
  assert.ok(candidates.every((candidate) => candidate.period === '2026年9月底'));
  assert.equal(candidates[1].unit, '%');
});

test('extracts a count where the numeric expression precedes the metric name', () => {
  const body = '湖北已建成18条算力传输通道。';
  const candidate = extractCandidates(body, '2026-11-19T00:00:00Z')[0];
  assert.equal(candidate.metric, 'compute_network_channels');
  assert.equal(candidate.value, 18);
  assert.equal(candidate.unit, '条');
  assert.equal(candidate.scope, '湖北');
});

test('normalizes Chinese count multipliers while preserving the reported unit', () => {
  const candidate = extractCandidates('平台分配算力标识1198万条。', '2026-11-19T00:00:00Z')[0];
  assert.equal(candidate.metric, 'compute_identifiers');
  assert.equal(candidate.value, 1198);
  assert.equal(candidate.unit, '万条');
  assert.equal(candidate.normalizedValue, '11980000');
});

test('captures a rank phrase without inventing a numeric rank', () => {
  const candidate = extractCandidates('湖北词元调用量位居全国第一方阵。', '2026-11-19T00:00:00Z')[0];
  assert.equal(candidate.metric, 'national_rank');
  assert.equal(candidate.value, '位居全国第一方阵');
  assert.equal(candidate.unit, '位次');
});

test('keeps unknown time and scope unknown when the source does not state them', () => {
  const candidate = extractCandidates('智能算力规模为85 EFLOPS。', '2026-11-19T00:00:00Z')[0];
  assert.equal(candidate.period, null);
  assert.equal(candidate.scope, null);
});

test('resolves relative current-year period against the article publication date', () => {
  const candidate = extractCandidates('截至今年9月底，湖北智能算力规模达到120 EFLOPS。', '2026-11-19T00:00:00Z')[0];
  assert.equal(candidate.period, '2026年9月底');
});

test('resolves relative prior-year comparison period without conflating different vintages', () => {
  const candidate = extractCandidates('去年同期智能算力规模为95 EFLOPS。', '2026-11-19T00:00:00Z')[0];
  assert.equal(candidate.period, '2025年同期');
});

test('does not create metric candidates from text with no recognized value', () => {
  assert.deepEqual(extractCandidates('湖北智能算力规模持续提升。', '2026-11-19T00:00:00Z'), []);
  assert.deepEqual(extractCandidates('产业发展值得关注。', '2026-11-19T00:00:00Z'), []);
});

test('reports invalid source offsets rather than silently accepting a changed quote', () => {
  const candidate = extractCandidates('湖北智能算力规模为85 EFLOPS。', '2026-11-19T00:00:00Z')[0];
  assert.ok(validateCandidate({ ...candidate, start: -1 }, '湖北智能算力规模为85 EFLOPS。').length > 0);
  const changedBody = '湖北智能算力规模为86 EFLOPS。';
  assert.ok(validateCandidate(candidate, changedBody).includes('候选原句与保存的字符位置不一致'));
});

test('candidate summary is readable for numeric and categorical values', () => {
  const [numeric] = extractCandidates('湖北智能算力规模为120 EFLOPS。', '2026-11-19T00:00:00Z');
  const [rank] = extractCandidates('湖北词元调用量位居全国第一方阵。', '2026-11-19T00:00:00Z');
  assert.match(candidateSummary(numeric), /120/);
  assert.match(candidateSummary(rank), /位居全国第一方阵/);
});

test('extraction retains a source attribution marker when present', () => {
  const candidate = extractCandidates('韩夏表示，湖北智能算力规模为120 EFLOPS。', '2026-11-19T00:00:00Z')[0];
  assert.equal(candidate.attribution, '韩夏');
  assert.ok(candidate.confidence >= 0.8);
});

test('Unicode offsets slice back to the candidate quote after supplementary characters', () => {
  const body = '🚀 观察：湖北智能算力规模为120 EFLOPS。';
  const candidate = extractCandidates(body, '2026-11-19T00:00:00Z')[0];
  assert.equal(body.slice(candidate.start, candidate.end), candidate.quote);
});
