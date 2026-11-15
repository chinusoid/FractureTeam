import type { Cents } from "./money";
import type { ISODate } from "./dates";

export type PaymentStatus = "unpaid" | "paid";
export type ConfirmationStatus = "suggested" | "confirmed";
export type ObligationSource = "import" | "manual" | "assistant";
export type Recurrence = "monthly" | "biweekly" | "weekly" | null;

/** A concrete occurrence of a required payment. */
export interface Obligation {
  id: string;
  name: string;
  amountCents: Cents;
  dueDate: ISODate;
  paymentStatus: PaymentStatus;
  confirmationStatus: ConfirmationStatus;
  source: ObligationSource;
  sourceTransactionIds: string[];
  recurrence: Recurrence;
  paidOn: ISODate | null;
}

export interface Account {
  currency: "USD";
  balanceCents: Cents;
  balanceAsOf: ISODate;
}

export interface PlanSettings {
  startDate: ISODate;
  endDate: ISODate;
  essentialRemainingCents: Cents;
  reserveTargetCents: Cents;
  /** False while any value is still a pre-filled estimate the user has not confirmed. */
  confirmed: boolean;
}

export type TransactionReview = "ok" | "possible_duplicate" | "excluded";

export interface Transaction {
  id: string;
  importBatchId: string;
  postedDate: ISODate;
  description: string;
  /** Negative = money out, positive = money in. */
  amountCents: Cents;
  reviewStatus: TransactionReview;
  possibleTransfer?: boolean;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  fileHash: string;
  importedAt: string;
  rowCount: number;
  columnMapping: Record<string, string | null>;
}

export interface UpdateSummary {
  at: string;
  fromDate: ISODate;
  toDate: ISODate;
  balanceBeforeCents: Cents;
  balanceAfterCents: Cents;
  closedBills: { id: string; name: string; amountCents: Cents }[];
  essentialsBeforeCents: Cents;
  essentialsAfterCents: Cents;
  unassignedDecreaseCents: Cents;
  unexplainedIncreaseCents: Cents;
  remainderBeforeCents: Cents;
  remainderAfterCents: Cents;
}

export interface BalanceSnapshot {
  id: string;
  balanceCents: Cents;
  asOf: ISODate;
  stateVersion: number;
  createdAt: string;
}

export interface SavedScenario {
  id: string;
  baseVersion: number;
  label: string;
  purchaseDate: ISODate;
  amountCents: Cents;
  createdAt: string;
}

export interface ChangeEventRecord {
  proposalId: string;
  entityId: string;
  appliedAt: string;
  before: Partial<Obligation> | null;
  after: Partial<Obligation>;
}

export interface ConsentSettings {
  aiEnabled: boolean;
  acceptedAt: string | null;
  policyVersion: number;
}

export interface AppState {
  schemaVersion: 1;
  stateVersion: number;
  clientId: string;
  isSample: boolean;
  account: Account | null;
  plan: PlanSettings | null;
  obligations: Obligation[];
  transactions: Transaction[];
  importBatches: ImportBatch[];
  snapshots: BalanceSnapshot[];
  scenarios: SavedScenario[];
  appliedProposalIds: string[];
  changeLog: ChangeEventRecord[];
  lastUpdate: UpdateSummary | null;
  consent: ConsentSettings;
}

/** The minimal data the calculation needs. The server receives exactly this shape. */
export interface PlanInput {
  today: ISODate;
  balanceCents: Cents;
  balanceAsOf: ISODate;
  startDate: ISODate;
  endDate: ISODate;
  essentialRemainingCents: Cents;
  reserveTargetCents: Cents;
  obligations: (Pick<Obligation, "id" | "name" | "amountCents" | "dueDate" | "paymentStatus" | "confirmationStatus"> & {
    /** How the bill repeats; absent for a one-time bill. A bill that repeats inside the period is counted each time. */
    repeat?: "weekly" | "biweekly" | "monthly";
    anchorDay?: number;
  })[];
}
