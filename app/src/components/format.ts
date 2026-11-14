import { type Evaluation, type ISODate, type PlanStatus, daysInclusive, formatDate, formatUSD, parseMoneyString } from "../lib/finance";

/** One sentence that explains which layer is (not) covered — never blames bills for a reserve problem. */
export function describeEvaluation(e: Evaluation): string {
  const reserve = formatUSD(e.reserveTargetCents);
  switch (e.status) {
    case "ok":
      return e.reserveTargetCents > 0
        ? `Bills, everyday spending and your ${reserve} reserve are covered.`
        : "Bills and everyday spending are covered.";
    case "reserve_short":
      return `${formatUSD(e.shortfallCents)} below your ${reserve} reserve; bills and everyday spending still covered.`;
    case "essentials_short":
      return `Bills are covered, but everyday spending is ${formatUSD(e.shortfallCents)} short.`;
    case "bills_short":
      return `${formatUSD(e.shortfallCents)} short for bills in this period.`;
  }
}

export function statusTone(status: PlanStatus): "ok" | "warn" | "danger" {
  if (status === "ok") return "ok";
  if (status === "reserve_short") return "warn";
  return "danger";
}

export function periodLabel(start: ISODate, end: ISODate): string {
  const days = daysInclusive(start, end);
  return `${formatDate(start)} – ${formatDate(end)} (${days} day${days === 1 ? "" : "s"})`;
}

/** Parses a user-typed dollar amount. Returns null for empty/invalid or negative values. */
export function parseAmountInput(raw: string, allowNegative = false): number | null {
  const v = parseMoneyString(raw);
  if (v === null) return null;
  if (!allowNegative && v < 0) return null;
  return v;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function downloadText(fileName: string, text: string, type = "text/csv"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
