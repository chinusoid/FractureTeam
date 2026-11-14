import { type Cents, isValidCents } from "./money";
import { type ISODate, isISODate } from "./dates";
import { computePlan, type PlanResult } from "./calc";
import type { AppState, Obligation, PlanInput } from "./types";
import { bumpVersion, newId } from "./state";

export interface ObligationChanges {
  name?: string;
  amountCents?: Cents;
  dueDate?: ISODate;
}

export interface NewObligationInput {
  name: string;
  amountCents: Cents;
  dueDate: ISODate;
}

export type ProposalPayload =
  | { type: "update_obligation"; targetId: string; changes: ObligationChanges }
  | { type: "add_obligation"; obligation: NewObligationInput };

export interface ChangeProposal {
  id: string;
  baseVersion: number;
  payload: ProposalPayload;
  factRefs: string[];
}

export interface ProposalPreview {
  before: PlanResult;
  after: PlanResult;
  target: { id: string; name: string; amountCents: Cents; dueDate: ISODate } | null;
  updated: { name: string; amountCents: Cents; dueDate: ISODate };
}

export const MAX_NAME_LENGTH = 60;

export function validatePayload(input: Pick<PlanInput, "obligations">, payload: ProposalPayload): string[] {
  const errors: string[] = [];
  const checkName = (name: unknown) => {
    if (typeof name !== "string" || !name.trim()) errors.push("Name is required.");
    else if (name.trim().length > MAX_NAME_LENGTH) errors.push("Name is too long.");
  };
  const checkAmount = (amount: unknown) => {
    if (!isValidCents(amount) || (amount as number) <= 0) errors.push("Amount must be greater than $0.");
    else if ((amount as number) > 100_000_000) errors.push("Amount is too large.");
  };
  const checkDate = (date: unknown) => {
    if (!isISODate(date)) errors.push("Due date must be a valid date.");
  };
  if (payload.type === "update_obligation") {
    const target = input.obligations.find((o) => o.id === payload.targetId);
    if (!target) errors.push("The bill to change no longer exists.");
    const { changes } = payload;
    if (!changes || (changes.name === undefined && changes.amountCents === undefined && changes.dueDate === undefined)) {
      errors.push("Nothing to change.");
    }
    if (changes?.name !== undefined) checkName(changes.name);
    if (changes?.amountCents !== undefined) checkAmount(changes.amountCents);
    if (changes?.dueDate !== undefined) checkDate(changes.dueDate);
  } else if (payload.type === "add_obligation") {
    checkName(payload.obligation?.name);
    checkAmount(payload.obligation?.amountCents);
    checkDate(payload.obligation?.dueDate);
  } else {
    errors.push("Unknown change type.");
  }
  return errors;
}

/** Shows the effect of a change without saving anything. */
export function previewProposal(input: PlanInput, payload: ProposalPayload): ProposalPreview | { errors: string[] } {
  const errors = validatePayload(input, payload);
  if (errors.length) return { errors };
  const before = computePlan(input);
  if (payload.type === "update_obligation") {
    const target = input.obligations.find((o) => o.id === payload.targetId)!;
    const updated = {
      name: payload.changes.name?.trim() ?? target.name,
      amountCents: payload.changes.amountCents ?? target.amountCents,
      dueDate: payload.changes.dueDate ?? target.dueDate,
    };
    const after = computePlan({
      ...input,
      obligations: input.obligations.map((o) => (o.id === target.id ? { ...o, ...updated } : o)),
    });
    return {
      before,
      after,
      target: { id: target.id, name: target.name, amountCents: target.amountCents, dueDate: target.dueDate },
      updated,
    };
  }
  const updated = {
    name: payload.obligation.name.trim(),
    amountCents: payload.obligation.amountCents,
    dueDate: payload.obligation.dueDate,
  };
  const after = computePlan({
    ...input,
    obligations: [
      ...input.obligations,
      { id: "__preview__", ...updated, paymentStatus: "unpaid", confirmationStatus: "confirmed" },
    ],
  });
  return { before, after, target: null, updated };
}

export type ApplyResult =
  | { kind: "applied"; state: AppState; entityId: string }
  | { kind: "already_applied"; state: AppState }
  | { kind: "stale"; state: AppState; message: string }
  | { kind: "invalid"; state: AppState; errors: string[] };

/**
 * The only way a proposal reaches stored data. Called from the confirm button, never by the model.
 * Re-checks version, fields and existence; applying the same proposal twice is a no-op.
 */
export function applyConfirmedProposal(state: AppState, proposal: ChangeProposal, nowIso: string): ApplyResult {
  if (state.appliedProposalIds.includes(proposal.id)) {
    return { kind: "already_applied", state };
  }
  if (proposal.baseVersion !== state.stateVersion) {
    return {
      kind: "stale",
      state,
      message: "Your plan changed after this suggestion was made. Ask again to get an up-to-date suggestion.",
    };
  }
  const errors = validatePayload({ obligations: state.obligations }, proposal.payload);
  if (errors.length) return { kind: "invalid", state, errors };

  const payload = proposal.payload;
  if (payload.type === "update_obligation") {
    const target = state.obligations.find((o) => o.id === payload.targetId)!;
    const after: Obligation = {
      ...target,
      name: payload.changes.name?.trim() ?? target.name,
      amountCents: payload.changes.amountCents ?? target.amountCents,
      dueDate: payload.changes.dueDate ?? target.dueDate,
      confirmationStatus: "confirmed",
    };
    const next: AppState = bumpVersion({
      ...state,
      obligations: state.obligations.map((o) => (o.id === target.id ? after : o)),
      appliedProposalIds: [...state.appliedProposalIds, proposal.id],
      changeLog: [
        ...state.changeLog,
        {
          proposalId: proposal.id,
          entityId: target.id,
          appliedAt: nowIso,
          before: { name: target.name, amountCents: target.amountCents, dueDate: target.dueDate },
          after: { name: after.name, amountCents: after.amountCents, dueDate: after.dueDate },
        },
      ].slice(-50),
    });
    return { kind: "applied", state: next, entityId: target.id };
  }

  const created: Obligation = {
    id: newId("bill"),
    name: payload.obligation.name.trim(),
    amountCents: payload.obligation.amountCents,
    dueDate: payload.obligation.dueDate,
    paymentStatus: "unpaid",
    confirmationStatus: "confirmed",
    source: "assistant",
    sourceTransactionIds: [],
    recurrence: null,
    paidOn: null,
  };
  const next: AppState = bumpVersion({
    ...state,
    obligations: [...state.obligations, created],
    appliedProposalIds: [...state.appliedProposalIds, proposal.id],
    changeLog: [
      ...state.changeLog,
      {
        proposalId: proposal.id,
        entityId: created.id,
        appliedAt: nowIso,
        before: null,
        after: { name: created.name, amountCents: created.amountCents, dueDate: created.dueDate },
      },
    ].slice(-50),
  });
  return { kind: "applied", state: next, entityId: created.id };
}

