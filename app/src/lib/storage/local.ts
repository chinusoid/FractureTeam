/**
 * Local persistence (MVP): one versioned JSON document in localStorage.
 * Every read is validated; a corrupted document is backed up and the app starts fresh with a notice.
 */
import { z } from "zod";
import { emptyState, type AppState } from "../finance";
import { cents, isoDate } from "../schemas/assistant";

export const STORAGE_KEY = "covered:v1";
export const BACKUP_KEY = "covered:v1:unreadable-backup";

const ObligationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  amountCents: cents,
  dueDate: isoDate,
  paymentStatus: z.enum(["unpaid", "paid"]),
  confirmationStatus: z.enum(["suggested", "confirmed"]),
  source: z.enum(["import", "manual", "assistant"]),
  sourceTransactionIds: z.array(z.string()),
  recurrence: z.enum(["monthly", "biweekly", "weekly"]).nullable(),
  paidOn: isoDate.nullable(),
});

const TransactionSchema = z.object({
  id: z.string(),
  importBatchId: z.string(),
  postedDate: isoDate,
  description: z.string(),
  amountCents: cents,
  reviewStatus: z.enum(["ok", "possible_duplicate", "excluded"]),
  possibleTransfer: z.boolean().optional(),
});

const UpdateSummarySchema = z.object({
  at: z.string(),
  fromDate: isoDate,
  toDate: isoDate,
  balanceBeforeCents: cents,
  balanceAfterCents: cents,
  closedBills: z.array(z.object({ id: z.string(), name: z.string(), amountCents: cents })),
  essentialsBeforeCents: cents,
  essentialsAfterCents: cents,
  unassignedDecreaseCents: cents,
  unexplainedIncreaseCents: cents,
  remainderBeforeCents: cents,
  remainderAfterCents: cents,
});

export const AppStateSchema = z.object({
  schemaVersion: z.literal(1),
  stateVersion: z.number().int().min(0),
  clientId: z.string().min(1),
  isSample: z.boolean(),
  account: z.object({ currency: z.literal("USD"), balanceCents: cents, balanceAsOf: isoDate }).nullable(),
  plan: z
    .object({
      startDate: isoDate,
      endDate: isoDate,
      essentialRemainingCents: cents,
      reserveTargetCents: cents,
      confirmed: z.boolean(),
    })
    .nullable(),
  obligations: z.array(ObligationSchema),
  transactions: z.array(TransactionSchema),
  importBatches: z.array(
    z.object({
      id: z.string(),
      fileName: z.string(),
      fileHash: z.string(),
      importedAt: z.string(),
      rowCount: z.number().int(),
      columnMapping: z.record(z.string(), z.string().nullable()),
    }),
  ),
  snapshots: z.array(
    z.object({ id: z.string(), balanceCents: cents, asOf: isoDate, stateVersion: z.number().int(), createdAt: z.string() }),
  ),
  scenarios: z.array(
    z.object({
      id: z.string(),
      baseVersion: z.number().int(),
      label: z.string(),
      purchaseDate: isoDate,
      amountCents: cents,
      createdAt: z.string(),
    }),
  ),
  appliedProposalIds: z.array(z.string()),
  changeLog: z.array(
    z.object({
      proposalId: z.string(),
      entityId: z.string(),
      appliedAt: z.string(),
      before: z.record(z.string(), z.unknown()).nullable(),
      after: z.record(z.string(), z.unknown()),
    }),
  ),
  lastUpdate: UpdateSummarySchema.nullable(),
  consent: z.object({ aiEnabled: z.boolean(), acceptedAt: z.string().nullable(), policyVersion: z.number().int() }),
});

export interface LoadResult {
  state: AppState;
  notice: string | null;
  available: boolean;
}

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function loadState(): LoadResult {
  const s = storage();
  if (!s) {
    return {
      state: emptyState(),
      notice: "This browser blocks local storage, so your plan will not be kept after you close the page.",
      available: false,
    };
  }
  let raw: string | null = null;
  try {
    raw = s.getItem(STORAGE_KEY);
  } catch {
    return {
      state: emptyState(),
      notice: "This browser blocks local storage, so your plan will not be kept after you close the page.",
      available: false,
    };
  }
  if (!raw) return { state: emptyState(), notice: null, available: true };
  try {
    const parsed = AppStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { state: parsed.data as AppState, notice: null, available: true };
  } catch {
    // fall through to backup
  }
  try {
    s.setItem(BACKUP_KEY, raw);
    s.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return {
    state: emptyState(),
    notice: "Saved data in this browser could not be read, so we started fresh. A backup copy was kept.",
    available: true,
  };
}

/** Returns false when the browser refused to save (quota, private mode). */
export function saveState(state: AppState): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEY);
    s.removeItem(BACKUP_KEY);
  } catch {
    // ignore
  }
}
