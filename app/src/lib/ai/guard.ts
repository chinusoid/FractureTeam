/**
 * Money guard: every dollar amount the model writes must be a number the app actually has
 * (tool results, the plan context, or what the user typed). Otherwise the text is replaced by a template.
 */
import { parseMoneyString } from "../finance/money";

const MONEY_RE = /-?\$\s?-?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K)\b)?/g;

export function extractAmounts(text: string): number[] {
  const out: number[] = [];
  for (const match of text.match(MONEY_RE) ?? []) {
    let raw = match.replace(/\s/g, "");
    let multiplier = 1;
    if (/k$/i.test(raw)) {
      multiplier = 1000;
      raw = raw.slice(0, -1);
    }
    raw = raw.replace(/\.$/, "");
    const cents = parseMoneyString(raw.replace("$", ""));
    if (cents !== null) out.push(Math.abs(cents) * multiplier);
    else out.push(-1); // unparseable money mention: never allowed
  }
  return out;
}

/** Amounts the user typed without a dollar sign are also allowed ("went up by 30"). */
export function extractUserAmounts(text: string): number[] {
  const out = extractAmounts(text);
  for (const m of text.match(/\b\d[\d,]*(?:\.\d{1,2})?\b/g) ?? []) {
    const c = parseMoneyString(m);
    if (c !== null) out.push(Math.abs(c));
  }
  return out.filter((v) => v >= 0);
}

/** Collects every number stored under a key ending in "Cents" (absolute values). */
export function collectCents(value: unknown, into: Set<number>, depth = 0): Set<number> {
  if (depth > 8 || value === null || value === undefined) return into;
  if (Array.isArray(value)) {
    for (const v of value) collectCents(v, into, depth + 1);
    return into;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "number" && /cents$/i.test(k) && Number.isFinite(v)) into.add(Math.abs(Math.round(v)));
      else if (typeof v === "object") collectCents(v, into, depth + 1);
    }
  }
  return into;
}

export function moneyIsVerified(text: string, allowed: Set<number>): boolean {
  return extractAmounts(text).every((c) => c >= 0 && allowed.has(c));
}
