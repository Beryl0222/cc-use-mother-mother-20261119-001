const STOPWORDS = new Set(['的', '了', '和', '在', '对', '与', '为', '是', '将', '已', '其', '及', '并', '中']);

function compact(text: string): string {
  return text.normalize('NFKC').toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
}

export function textTerms(text: string): Set<string> {
  const normalized = compact(text);
  const terms = new Set<string>();
  for (const token of normalized.match(/[\p{Script=Han}]+|[a-z0-9]+(?:\.[a-z0-9]+)*/gu) ?? []) {
    if (/^\p{Script=Han}+$/u.test(token)) {
      if (token.length === 1 && !STOPWORDS.has(token)) terms.add(token);
      for (let index = 0; index < token.length - 1; index += 1) {
        const term = token.slice(index, index + 2);
        if (![...term].every((character) => STOPWORDS.has(character))) terms.add(term);
      }
    } else if (!STOPWORDS.has(token)) {
      terms.add(token);
    }
  }
  return terms;
}

export function lexicalOverlap(left: string, right: string): number {
  const a = textTerms(left);
  const b = textTerms(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  return Number((2 * shared / (a.size + b.size)).toFixed(4));
}

export function rankedPhrases(query: string, phrases: string[]): Array<{ phrase: string; score: number; order: number }> {
  return phrases.map((phrase, order) => ({ phrase, score: lexicalOverlap(query, phrase), order }))
    .sort((left, right) => right.score - left.score || left.order - right.order);
}
