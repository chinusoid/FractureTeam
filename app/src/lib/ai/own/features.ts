/**
 * Feature hashing for the Covered model. Must stay identical to tools/ml/train.py
 * (same normalisation, FNV-1a hash, bucket count); tests/unit/ai-own.test.ts checks parity.
 */
const encoder = new TextEncoder();

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const b of encoder.encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function normalize(text: string): string[] {
  let t = text.toLowerCase().replace(/’/g, "'");
  t = t.replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, " zmoney ");
  t = t.replace(/\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd|bucks)\b/g, " zmoney ");
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " zdate ");
  t = t.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " zdate ");
  t = t.replace(/\b\d+(?:st|nd|rd|th)\b/g, " zord ");
  t = t.replace(/\d+(?:\.\d+)?/g, " znum ");
  t = t.replace(/'/g, "");
  t = t.replace(/[^a-z ]+/g, " ");
  return t.split(" ").filter(Boolean);
}

/** Sorted unique bucket indices of the hashed word, bigram and character-trigram features. */
export function features(text: string, dim: number): number[] {
  const toks = normalize(text);
  const names = new Set<string>();
  toks.forEach((tok, i) => {
    names.add(`w:${tok}`);
    if (i + 1 < toks.length) names.add(`b:${tok} ${toks[i + 1]}`);
    const padded = `#${tok}#`;
    for (let j = 0; j + 3 <= padded.length; j++) names.add(`c:${padded.slice(j, j + 3)}`);
  });
  const idx = new Set<number>();
  for (const n of names) idx.add(fnv1a(n) % dim);
  return [...idx].sort((a, b) => a - b);
}
