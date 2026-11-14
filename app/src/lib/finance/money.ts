/** Money is always stored as integer cents (USD only in the MVP). */
export type Cents = number;

/** Upper bound for any single money value: $10,000,000. */
export const MAX_ABS_CENTS = 1_000_000_000;

export function isValidCents(value: unknown): value is Cents {
  return typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= MAX_ABS_CENTS;
}

export function assertCents(value: unknown, field = "amount"): Cents {
  if (!isValidCents(value)) {
    throw new Error(`${field} must be an integer number of cents within range`);
  }
  return value;
}

/**
 * Converts a dollar number (e.g. from a model tool call) to cents.
 * Uses string formatting to avoid binary floating point surprises (1.005 -> 101).
 */
export function dollarsToCents(dollars: number): Cents | null {
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) return null;
  const parsed = parseMoneyString(dollars.toFixed(6));
  return parsed;
}

/**
 * Parses US-formatted money strings: "$1,234.56", "-12.3", "(45.00)", "45.00-", "1234".
 * Returns null when the string is not a money value.
 */
export function parseMoneyString(raw: string): Cents | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(/^USD\s*/i, "").replace(/\s*USD$/i, "");
  if (s.startsWith("$")) s = s.slice(1).trim();
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  // Thousands separators must be well-formed if present.
  if (s.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(s)) return null;
  const [intPartRaw, fracRaw = ""] = s.split(".");
  const intPart = intPartRaw === "" ? "0" : intPartRaw;
  const frac = (fracRaw + "000").slice(0, 3);
  let cents = Number(intPart) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1; // round half up on the third decimal
  if (!Number.isSafeInteger(cents)) return null;
  const result = negative ? -cents : cents;
  return Math.abs(result) <= MAX_ABS_CENTS ? (result === 0 ? 0 : result) : null;
}

const formatterWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const formatterCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$1,300", "$15.49", "-$100". */
export function formatUSD(cents: Cents): string {
  const whole = cents % 100 === 0;
  const abs = Math.abs(cents) / 100;
  const text = (whole ? formatterWhole : formatterCents).format(abs);
  return cents < 0 ? `-${text}` : text;
}

/** "+$30" / "-$30" / "$0" for differences. */
export function formatDelta(cents: Cents): string {
  if (cents === 0) return "$0";
  return cents > 0 ? `+${formatUSD(cents)}` : formatUSD(cents);
}

/** Plain number for input fields: 1300 / 15.49 */
export function centsToInput(cents: Cents): string {
  const whole = cents % 100 === 0;
  return whole ? String(cents / 100) : (cents / 100).toFixed(2);
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}
