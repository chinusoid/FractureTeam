import { parseMoneyString } from "../finance/money";
import { type ISODate, makeISODate } from "../finance/dates";
import type { Transaction } from "../finance/types";

export type DateFormat = "YMD" | "MDY" | "DMY";
export type SignConvention = "negative_is_out" | "positive_is_out";

export interface ColumnMapping {
  date: number | null;
  description: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
}

export interface NormalizeOptions {
  mapping: ColumnMapping;
  dateFormat: DateFormat;
  sign: SignConvention;
}

export interface RowError {
  row: number;
  message: string;
}

export interface NormalizedTransaction extends Omit<Transaction, "importBatchId"> {
  row: number;
  possibleTransfer: boolean;
}

export interface NormalizeResult {
  transactions: NormalizedTransaction[];
  errors: RowError[];
  duplicates: number;
  transfers: number;
  firstDate: ISODate | null;
  lastDate: ISODate | null;
}

const DATE_HEADERS = ["date", "posting date", "posted date", "transaction date", "trans date", "post date", "posted"];
const DESC_HEADERS = ["description", "payee", "merchant", "name", "memo", "details", "transaction", "narrative"];
const AMOUNT_HEADERS = ["amount", "transaction amount", "amount (usd)", "value"];
const DEBIT_HEADERS = ["debit", "withdrawal", "withdrawals", "money out", "debit amount", "outflow", "charges"];
const CREDIT_HEADERS = ["credit", "deposit", "deposits", "money in", "credit amount", "inflow", "payments"];

function findHeader(headers: string[], names: string[]): number | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const name of names) {
    const idx = lower.indexOf(name);
    if (idx >= 0) return idx;
  }
  for (const name of names) {
    const idx = lower.findIndex((h) => h.includes(name));
    if (idx >= 0) return idx;
  }
  return null;
}

export function guessMapping(headers: string[]): ColumnMapping {
  const date = findHeader(headers, DATE_HEADERS);
  const description = findHeader(headers, DESC_HEADERS);
  const amount = findHeader(headers, AMOUNT_HEADERS);
  const debit = findHeader(headers, DEBIT_HEADERS);
  const credit = findHeader(headers, CREDIT_HEADERS);
  // Prefer a single amount column; use debit/credit only when there is no amount column.
  if (amount !== null) return { date, description, amount, debit: null, credit: null };
  return { date, description, amount: null, debit, credit };
}

export function mappingProblems(m: ColumnMapping): string[] {
  const problems: string[] = [];
  if (m.date === null) problems.push("Choose the date column.");
  if (m.description === null) problems.push("Choose the description column.");
  if (m.amount === null && (m.debit === null || m.credit === null)) {
    problems.push("Choose an amount column, or both a debit and a credit column.");
  }
  return problems;
}

const SLASH_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/;
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/;

function fourDigitYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

export function parseDate(raw: string, format: DateFormat): ISODate | null {
  const s = raw.trim();
  const iso = ISO_RE.exec(s);
  if (iso) return makeISODate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const m = SLASH_RE.exec(s);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const y = fourDigitYear(m[3]);
  if (format === "DMY") return makeISODate(y, b, a);
  return makeISODate(y, a, b);
}

/**
 * Looks at the date column and decides which formats fit.
 * If both month-first and day-first fit every row, the user has to choose (plan section 10).
 */
export function detectDateFormats(values: string[]): { fits: DateFormat[]; ambiguous: boolean } {
  const sample = values.filter((v) => v.trim()).slice(0, 500);
  const formats: DateFormat[] = ["YMD", "MDY", "DMY"];
  const fits = formats.filter((f) => {
    if (sample.length === 0) return false;
    return sample.every((v) => {
      if (f === "YMD") return ISO_RE.test(v.trim()) && parseDate(v, f) !== null;
      return !ISO_RE.test(v.trim()) && parseDate(v, f) !== null;
    });
  });
  return { fits, ambiguous: fits.includes("MDY") && fits.includes("DMY") };
}

const TRANSFER_RE = /\b(TRANSFER|XFER|ZELLE|VENMO|PAYPAL|CASH APP|ONLINE BANKING TRANSFER|CREDIT CARD PAYMENT|CARD PAYMENT|TO SAVINGS|FROM SAVINGS)\b/i;

export function looksLikeTransfer(description: string): boolean {
  return TRANSFER_RE.test(description);
}

export function normalizeRows(rows: string[][], options: NormalizeOptions): NormalizeResult {
  const { mapping, dateFormat, sign } = options;
  const errors: RowError[] = [];
  const out: NormalizedTransaction[] = [];
  rows.forEach((cells, idx) => {
    const rowNumber = idx + 2;
    const get = (col: number | null) => (col === null ? "" : (cells[col] ?? "").trim());
    const dateRaw = get(mapping.date);
    const description = get(mapping.description).replace(/\s+/g, " ").slice(0, 140);
    const date = parseDate(dateRaw, dateFormat);
    if (!date) {
      errors.push({ row: rowNumber, message: dateRaw ? `Unrecognized date "${dateRaw.slice(0, 20)}"` : "Missing date" });
      return;
    }
    if (!description) {
      errors.push({ row: rowNumber, message: "Missing description" });
      return;
    }
    let amountCents: number | null = null;
    if (mapping.amount !== null) {
      const raw = get(mapping.amount);
      const parsed = parseMoneyString(raw);
      if (parsed === null) {
        errors.push({ row: rowNumber, message: raw ? `Unrecognized amount "${raw.slice(0, 20)}"` : "Missing amount" });
        return;
      }
      amountCents = sign === "negative_is_out" ? parsed : -parsed;
    } else {
      const dRaw = get(mapping.debit);
      const cRaw = get(mapping.credit);
      const d = dRaw ? parseMoneyString(dRaw) : 0;
      const c = cRaw ? parseMoneyString(cRaw) : 0;
      if (d === null || c === null) {
        errors.push({ row: rowNumber, message: "Unrecognized debit or credit amount" });
        return;
      }
      if (!dRaw && !cRaw) {
        errors.push({ row: rowNumber, message: "Missing amount" });
        return;
      }
      amountCents = Math.abs(c ?? 0) - Math.abs(d ?? 0);
    }
    if (amountCents === 0) {
      errors.push({ row: rowNumber, message: "Zero amount skipped" });
      return;
    }
    out.push({
      id: `tx_${rowNumber}`,
      row: rowNumber,
      postedDate: date,
      description,
      amountCents,
      reviewStatus: "ok",
      possibleTransfer: looksLikeTransfer(description),
    });
  });

  // Same date + amount + description: possible duplicate. Both stay; the user decides (plan section 11).
  const seen = new Map<string, number>();
  let duplicates = 0;
  for (const t of out) {
    const key = `${t.postedDate}|${t.amountCents}|${t.description.toUpperCase()}`;
    const count = seen.get(key) ?? 0;
    if (count > 0) {
      t.reviewStatus = "possible_duplicate";
      duplicates++;
    }
    seen.set(key, count + 1);
  }
  const dates = out.map((t) => t.postedDate).sort();
  return {
    transactions: out,
    errors,
    duplicates,
    transfers: out.filter((t) => t.possibleTransfer).length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}
