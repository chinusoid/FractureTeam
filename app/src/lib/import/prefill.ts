import { type ISODate, addDays, daysInclusive } from "../finance/dates";
import type { Transaction } from "../finance/types";
import {
  type EssentialsEstimate,
  type IncomeInfo,
  type RecurringCandidate,
  detectIncome,
  detectRecurringBills,
  estimateEssentials,
} from "./recurring";

export interface SetupSuggestion {
  candidates: RecurringCandidate[];
  income: IncomeInfo | null;
  endDate: ISODate;
  endDateSource: "payday" | "default";
  periodDays: number;
  essentials: EssentialsEstimate | null;
}

export const RESERVE_OPTIONS_CENTS = [0, 10000, 25000, 50000];

/** Pre-fills the plan from imported history (plan section 5, step 3). Every value is an estimate until confirmed. */
export function buildSetupSuggestion(transactions: Transaction[], today: ISODate): SetupSuggestion {
  const candidates = detectRecurringBills(transactions, today);
  const income = detectIncome(transactions, today);
  let endDate = income?.nextPayday ?? addDays(today, 13);
  let endDateSource: SetupSuggestion["endDateSource"] = income ? "payday" : "default";
  if (endDate > addDays(today, 45)) {
    endDate = addDays(today, 30);
    endDateSource = "default";
  }
  const periodDays = daysInclusive(today, endDate);
  const billTxIds = new Set(candidates.flatMap((c) => c.sourceTransactionIds));
  const essentials = estimateEssentials(transactions, billTxIds, periodDays);
  return { candidates, income, endDate, endDateSource, periodDays, essentials };
}

export function essentialsForPeriod(estimate: EssentialsEstimate | null, periodDays: number): number | null {
  if (!estimate) return null;
  return Math.round((estimate.dailyCents * periodDays) / 1000) * 1000;
}
