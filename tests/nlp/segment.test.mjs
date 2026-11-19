import test from 'node:test';
import assert from 'node:assert/strict';
import { excerptAt, isUsableSegment, splitClauses, splitSentences, splitForExtraction } from '../../dist/nlp/segment.js';

test('sentence segmentation keeps offsets into the original string', () => {
  const text = '  湖北算力规模达120 EFLOPS。通道数量为18条！ ';
  const segments = splitSentences(text);
  assert.equal(segments.length, 2);
  assert.equal(text.slice(segments[0].start, segments[0].end), segments[0].text);
  assert.equal(text.slice(segments[1].start, segments[1].end), segments[1].text);
  assert.equal(segments[0].ordinal, 0);
  assert.equal(segments[1].ordinal, 1);
});

test('line breaks and semicolons delimit Chinese passages without empty segments', () => {
  const segments = splitSentences('第一项事实\n\n第二项事实；第三项事实。');
  assert.deepEqual(segments.map((segment) => segment.text), ['第一项事实', '第二项事实', '第三项事实']);
  assert.deepEqual(segments.map((segment) => segment.ordinal), [0, 1, 2]);
});

test('clause offsets account for separators removed from the emitted text', () => {
  const sentence = splitSentences('截至2026年9月底，湖北智能算力规模达120 EFLOPS。')[0];
  const clauses = splitClauses(sentence);
  assert.deepEqual(clauses.map((part) => part.text), ['截至2026年9月底', '湖北智能算力规模达120 EFLOPS']);
  for (const part of clauses) {
    assert.equal('截至2026年9月底，湖北智能算力规模达120 EFLOPS。'.slice(part.start, part.end), part.text);
  }
});

test('extraction segments carry stable reading order across clauses', () => {
  const segments = splitForExtraction('湖北规模达120。通道达到18条。');
  assert.deepEqual(segments.map((part) => part.ordinal), [0, 1]);
  assert.equal(segments.at(-1).text, '通道达到18条');
});

test('short decorative fragments are not considered useful text units', () => {
  assert.equal(isUsableSegment({ text: '！', start: 0, end: 1, ordinal: 0 }), false);
  assert.equal(isUsableSegment({ text: '算力', start: 0, end: 2, ordinal: 0 }), false);
  assert.equal(isUsableSegment({ text: '规模达18', start: 0, end: 4, ordinal: 0 }), true);
  assert.equal(isUsableSegment({ text: 'EFLOPS 120', start: 0, end: 10, ordinal: 0 }), false);
});

test('excerpt expands around a match and normalizes whitespace', () => {
  const excerpt = excerptAt('前置内容\n 湖北智能算力规模达到120 EFLOPS，数据来源见说明。后续内容', 7, 21, 6);
  assert.match(excerpt, /湖北智能算力规模/);
  assert.doesNotMatch(excerpt, /\n/);
});

test('sentence splitter handles punctuation adjacent to closing quotes', () => {
  const segments = splitSentences('报道称“智能算力规模达120 EFLOPS”。随后还会补充。');
  assert.equal(segments.length, 2);
  assert.match(segments[0].text, /120 EFLOPS/u);
  assert.equal(segments[1].text, '随后还会补充');
});

test('sentence splitter retains a final passage without terminal punctuation', () => {
  const segments = splitSentences('第一句。末尾无标点');
  assert.deepEqual(segments.map((segment) => segment.text), ['第一句', '末尾无标点']);
});

test('empty input yields no text segments', () => {
  assert.deepEqual(splitSentences(' \n\t。  '), []);
  assert.deepEqual(splitForExtraction(''), []);
});
