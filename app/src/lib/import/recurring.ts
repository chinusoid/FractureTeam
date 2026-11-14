import { type Cents, formatUSD } from "../finance/money";
import { type ISODate, addDays, addMonths, dayOfMonth, diffDays, formatDate, makeISODate } from "../finance/dates";
import type { Transaction } from "../finance/types";
import { looksLikeTransfer } from "./normalize";

export type BillCadence = "monthly" | "biweekly" | "weekly";
export type PayCadence = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface RecurringCandidate {
  id: string;
  key: string;
  displayName: string;
  amountCents: Cents;
  minCents: Cents;
  maxCents: Cents;
  cadence: BillCadence;
  occurrences: number;
  lastDate: ISODate;
  nextDueDate: ISODate;
  assumedPaidDate: ISODate | null;
  sourceTransactionIds: string[];
  sampleDescriptions: string[];
  possibleTransfer: boolean;
  confidence: "high" | "medium";
  notes: string[];
}

export interface IncomeInfo {
  key: string;
  displayName: string;
  cadence: PayCadence;
  typicalCents: Cents;
  lastDate: ISODate;
  nextPayday: ISODate;
  occurrences: number;
}

export interface EssentialsEstimate {
  cents: Cents;
  dailyCents: Cents;
  windowDays: number;
  periodDays: number;
  excludedLarge: number;
}

const STOP = new Set([
  "POS", "DEBIT", "CREDIT", "CARD", "PURCHASE", "ACH", "ONLINE", "PMT", "PAYMENT", "PYMT", "AUTOPAY", "AUTO", "PAY",
  "RECURRING", "WEB", "ID", "PPD", "CCD", "TEL", "CHECKCARD", "DES", "INDN", "CO", "WWW", "COM", "INC", "LLC", "THE",
  "TO", "FROM", "BILL", "ELECTRONIC", "WITHDRAWAL", "DEPOSIT", "DIRECT", "DEP", "VISA", "MASTERCARD", "PREAUTHORIZED",
]);
// "AUTO" is common in insurer names; keep it when it is not the leading word.
const KEEP_IF_NOT_FIRST = new Set(["AUTO", "PAY"]);

export function merchantKey(description: string): string {
  const tokens = description
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b\d+\b/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !/\d{3,}/.test(t));
  const kept: string[] = [];
  for (const t of tokens) {
    if (STOP.has(t) && !(KEEP_IF_NOT_FIRST.has(t) && kept.length > 0)) continue;
    kept.push(t);
    if (kept.length === 3) break;
  }
  return kept.join(" ") || description.toUpperCase().trim().slice(0, 24);
}

export function titleCase(key: string): string {
  return key
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return map;
}

function uniqueByDate(txs: Transaction[]): Transaction[] {
  const byDate = new Map<string, Transaction>();
  for (const t of [...txs].sort((a, b) => (a.postedDate < b.postedDate ? -1 : 1))) {
    if (!byDate.has(t.postedDate)) byDate.set(t.postedDate, t);
  }
  return [...byDate.values()];
}

function monthlyAnchor(dates: ISODate[]): number {
  const days = dates.slice(-3).map(dayOfMonth);
  const max = Math.max(...days);
  const min = Math.min(...days);
  return max - min <= 3 ? max : days[days.length - 1];
}

function advance(date: ISODate, cadence: BillCadence | "semimonthly", anchor: number): ISODate {
  if (cadence === "monthly") return addMonths(date, 1, anchor);
  if (cadence === "biweekly") return addDays(date, 14);
  return addDays(date, 7);
}

function classifyBill(intervals: number[]): BillCadence | null {
  if (intervals.length === 0) return null;
  const m = median(intervals);
  if (m >= 26 && m <= 35 && intervals.every((i) => i >= 24 && i <= 38)) return "monthly";
  if (intervals.every((i) => i >= 12 && i <= 16)) return "biweekly";
  if (intervals.every((i) => i >= 6 && i <= 8)) return "weekly";
  return null;
}

/** Rule-based first pass (plan section 9): finds repeating outflows. The assistant only explains them. */
export function detectRecurringBills(transactions: Transaction[], today: ISODate): RecurringCandidate[] {
  const usable = transactions.filter((t) => t.amountCents < 0 && t.reviewStatus !== "excluded");
  const fileEnd = transactions.reduce<ISODate | null>((max, t) => (!max || t.postedDate > max ? t.postedDate : max), null);
  const groups = groupBy(usable, (t) => merchantKey(t.description));
  const out: RecurringCandidate[] = [];
  for (const [key, all] of groups) {
    const txs = uniqueByDate(all);
    if (txs.length < 2) continue;
    const dates = txs.map((t) => t.postedDate);
    const intervals = dates.slice(1).map((d, i) => diffDays(d, dates[i]));
    const cadence = classifyBill(intervals);
    if (!cadence) continue;
    const amounts = txs.map((t) => Math.abs(t.amountCents));
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    const latest = amounts[amounts.length - 1];
    const tolerance = cadence === "monthly" ? 1.6 : 1.1;
    if (max > min * tolerance) continue;
    const lastDate = dates[dates.length - 1];
    const typicalInterval = cadence === "monthly" ? 31 : cadence === "biweekly" ? 14 : 7;
    if (diffDays(today, lastDate) > typicalInterval * 2 + 7) continue; // looks stopped
    const anchor = cadence === "monthly" ? monthlyAnchor(dates) : 0;
    let next = advance(lastDate, cadence, anchor);
    let assumedPaidDate: ISODate | null = null;
    while (next < today) {
      assumedPaidDate = next;
      next = advance(next, cadence, anchor);
    }
    const possibleTransfer = all.some((t) => t.possibleTransfer || looksLikeTransfer(t.description));
    const notes: string[] = [];
    if (max !== min) {
      notes.push(`Amount varies from ${formatUSD(min)} to ${formatUSD(max)}. The latest amount is used.`);
    }
    if (assumedPaidDate && fileEnd && assumedPaidDate > fileEnd) {
      notes.push(`A payment was expected on ${formatDate(assumedPaidDate)}, after your file ends. It is assumed paid.`);
    }
    if (possibleTransfer) notes.push("Looks like a transfer. Keep it only if it is a bill you must pay.");
    if (txs.length === 2) notes.push("Seen only twice so far.");
    out.push({
      id: `cand_${key.replace(/\s+/g, "_").toLowerCase()}`,
      key,
      displayName: titleCase(key),
      amountCents: latest,
      minCents: min,
      maxCents: max,
      cadence,
      occurrences: txs.length,
      lastDate,
      nextDueDate: next,
      assumedPaidDate,
      sourceTransactionIds: all.map((t) => t.id),
      sampleDescriptions: [...new Set(all.map((t) => t.description))].slice(0, 3),
      possibleTransfer,
      confidence: txs.length >= 3 && max === min ? "high" : "medium",
      notes,
    });
  }
  return out.sort((a, b) => (a.nextDueDate < b.nextDueDate ? -1 : a.nextDueDate > b.nextDueDate ? 1 : 0));
}

function endOfMonthDay(date: ISODate): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Finds the main regular income to suggest the end of the planning period (next payday). */
export function detectIncome(transactions: Transaction[], today: ISODate): IncomeInfo | null {
  const inflows = transactions.filter((t) => t.amountCents >= 10000 && t.reviewStatus !== "excluded" && !t.possibleTransfer);
  const groups = groupBy(inflows, (t) => merchantKey(t.description));
  let best: IncomeInfo | null = null;
  let bestTotal = 0;
  for (const [key, all] of groups) {
    const txs = uniqueByDate(all);
    if (txs.length < 2) continue;
    const dates = txs.map((t) => t.postedDate);
    const intervals = dates.slice(1).map((d, i) => diffDays(d, dates[i]));
    const m = median(intervals);
    let cadence: PayCadence | null = null;
    if (intervals.every((i) => i >= 6 && i <= 8)) cadence = "weekly";
    else if (intervals.every((i) => i >= 13 && i <= 15)) cadence = "biweekly";
    else if (m >= 12 && m <= 18 && intervals.every((i) => i >= 10 && i <= 20)) cadence = "semimonthly";
    else if (m >= 26 && m <= 35 && intervals.every((i) => i >= 24 && i <= 38)) cadence = "monthly";
    if (!cadence) continue;
    const lastDate = dates[dates.length - 1];
    let next: ISODate;
    if (cadence === "weekly" || cadence === "biweekly") {
      const step = cadence === "weekly" ? 7 : 14;
      next = addDays(lastDate, step);
      while (next <= today) next = addDays(next, step);
    } else if (cadence === "monthly") {
      const anchor = monthlyAnchor(dates);
      next = addMonths(lastDate, 1, anchor);
      while (next <= today) next = addMonths(next, 1, anchor);
    } else {
      // Semi-monthly: two anchor days per month, month-end days collapse to "last day".
      const isEnd = (d: ISODate) => dayOfMonth(d) >= endOfMonthDay(d) - 1;
      const firstHalf = dates.filter((d) => !isEnd(d) && dayOfMonth(d) <= 20).map(dayOfMonth);
      const early = firstHalf.length ? Math.round(median(firstHalf)) : 15;
      const usesEnd = dates.some(isEnd);
      next = "";
      let cursor = lastDate.slice(0, 8) + "01";
      for (let k = 0; k < 4 && !next; k++) {
        const [y, mo] = cursor.split("-").map(Number);
        const options = [makeISODate(y, mo, early)];
        if (usesEnd) options.push(makeISODate(y, mo, endOfMonthDay(cursor)));
        for (const o of options) {
          if (o && o > today && o > lastDate) {
            next = o;
            break;
          }
        }
        cursor = addMonths(cursor, 1);
      }
      if (!next) continue;
    }
    const total = txs.reduce((s, t) => s + t.amountCents, 0);
    if (total > bestTotal) {
      bestTotal = total;
      best = {
        key,
        displayName: titleCase(key),
        cadence,
        typicalCents: Math.round(median(txs.map((t) => t.amountCents))),
        lastDate,
        nextPayday: next,
        occurrences: txs.length,
      };
    }
  }
  return best;
}

/**
 * Everyday spending estimate for the period: last 28 days of the file, without detected bills,
 * transfers and one-off purchases of $400 or more, scaled to the period length and rounded to $10.
 */
export function estimateEssentials(
  transactions: Transaction[],
  billTransactionIds: Set<string>,
  periodDays: number,
): EssentialsEstimate | null {
  if (transactions.length === 0 || periodDays <= 0) return null;
  const dates = transactions.map((t) => t.postedDate).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const windowDays = Math.min(28, diffDays(last, first) + 1);
  if (windowDays < 7) return null;
  const windowStart = addDays(last, -(windowDays - 1));
  let sum = 0;
  let excludedLarge = 0;
  for (const t of transactions) {
    if (t.amountCents >= 0 || t.reviewStatus === "excluded") continue;
    if (t.postedDate < windowStart || t.postedDate > last) continue;
    if (billTransactionIds.has(t.id) || t.possibleTransfer || looksLikeTransfer(t.description)) continue;
    if (-t.amountCents >= 40000) {
      excludedLarge++;
      continue;
    }
    sum += -t.amountCents;
  }
  const daily = sum / windowDays;
  return {
    cents: Math.round((daily * periodDays) / 1000) * 1000,
    dailyCents: Math.round(daily),
    windowDays,
    periodDays,
    excludedLarge,
  };
}
