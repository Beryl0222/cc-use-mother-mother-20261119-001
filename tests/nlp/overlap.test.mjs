import test from 'node:test';
import assert from 'node:assert/strict';
import { lexicalOverlap, rankedPhrases, textTerms } from '../../dist/nlp/overlap.js';

test('Chinese adjacent character terms expose shared technical phrases', () => {
  const terms = textTerms('智能算力规模');
  assert.ok(terms.has('智能'));
  assert.ok(terms.has('算力'));
  assert.ok(terms.has('规模'));
});

test('normalization treats full-width Latin letters and digits consistently', () => {
  assert.equal(lexicalOverlap('Token调用量 １２３', 'token调用量 123'), 1);
});

test('empty text has no lexical similarity', () => {
  assert.equal(lexicalOverlap('', '湖北算力规模'), 0);
  assert.equal(lexicalOverlap('  ', ' '), 0);
});

test('completely unrelated technical phrases have zero overlap', () => {
  assert.equal(lexicalOverlap('智能算力规模', '候鸟迁徙路线'), 0);
});

test('ranking orders stronger wording matches before weaker ones', () => {
  const result = rankedPhrases('湖北智能算力规模达到120 EFLOPS', [
    '国际贸易与农业生产',
    '湖北的智能算力规模为128 EFLOPS',
    '智能算力规模统计口径',
  ]);
  assert.equal(result[0].phrase, '湖北的智能算力规模为128 EFLOPS');
  assert.ok(result[0].score > result[1].score);
});

test('ties retain input ordering for stable review screens', () => {
  const result = rankedPhrases('词元调用量', ['词元调用量甲', '词元调用量乙']);
  assert.equal(result[0].order, 0);
  assert.equal(result[1].order, 1);
});

test('single Chinese characters remain searchable without punctuation tokens', () => {
  const terms = textTerms('量？');
  assert.ok(terms.has('量'));
  assert.equal(terms.has('？'), false);
});

test('Latin technical identifiers remain whole tokens', () => {
  const terms = textTerms('EFLOPS 与 AI 算力');
  assert.ok(terms.has('eflops'));
  assert.ok(terms.has('ai'));
});
