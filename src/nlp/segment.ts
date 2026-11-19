import type { TextSegment } from '../domain/types.js';

const SENTENCE_END = /[。！？!?；;\n]+/gu;
const CLAUSE_SPLIT = /[,，、]+/gu;

function trimBounds(text: string, start: number, end: number): TextSegment | null {
  let left = start;
  let right = end;
  while (left < right && /\s/u.test(text[left] ?? '')) left += 1;
  while (right > left && /\s/u.test(text[right - 1] ?? '')) right -= 1;
  if (left === right) return null;
  return { text: text.slice(left, right), start: left, end: right, ordinal: 0 };
}

export function splitSentences(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const index = match.index ?? cursor;
    const segment = trimBounds(text, cursor, index);
    if (segment) segments.push(segment);
    cursor = index + match[0].length;
  }
  const tail = trimBounds(text, cursor, text.length);
  if (tail) segments.push(tail);
  return segments.map((segment, ordinal) => ({ ...segment, ordinal }));
}

export function splitClauses(sentence: TextSegment): TextSegment[] {
  const parts: TextSegment[] = [];
  let cursor = 0;
  for (const match of sentence.text.matchAll(CLAUSE_SPLIT)) {
    const index = match.index ?? cursor;
    const part = trimBounds(sentence.text, cursor, index);
    if (part) {
      parts.push({ ...part, start: sentence.start + part.start, end: sentence.start + part.end });
    }
    cursor = index + match[0].length;
  }
  const tail = trimBounds(sentence.text, cursor, sentence.text.length);
  if (tail) parts.push({ ...tail, start: sentence.start + tail.start, end: sentence.start + tail.end });
  return parts.map((part, ordinal) => ({ ...part, ordinal }));
}

export function splitForExtraction(text: string): TextSegment[] {
  return splitSentences(text).flatMap(splitClauses).map((segment, ordinal) => ({ ...segment, ordinal }));
}

export function excerptAt(text: string, start: number, end: number, radius = 32): string {
  const left = Math.max(0, start - radius);
  const right = Math.min(text.length, end + radius);
  return text.slice(left, right).replace(/\s+/gu, ' ').trim();
}

export function isUsableSegment(segment: TextSegment, minimumHan = 4): boolean {
  const han = segment.text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const numeric = /\d/u.test(segment.text);
  return han >= minimumHan || (numeric && han >= 2);
}
