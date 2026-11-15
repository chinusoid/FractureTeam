/**
 * Contract between the browser app and POST /api/assistant.
 * Owned jointly: change only together with both sides (plan section 15, "общие контракты").
 */
import { z } from "zod";
import { isISODate } from "../finance/dates";
import { MAX_ABS_CENTS } from "../finance/money";

export const isoDate = z.string().refine(isISODate, "Expected a YYYY-MM-DD date");
export const cents = z.number().int().min(-MAX_ABS_CENTS).max(MAX_ABS_CENTS);
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_\-]+$/);
const shortText = (max: number) => z.string().max(max);

export const PlanContextSchema = z.object({
  balanceCents: cents,
  balanceAsOf: isoDate,
  startDate: isoDate,
  endDate: isoDate,
  essentialRemainingCents: cents.min(0),
  reserveTargetCents: cents.min(0),
});

export const ObligationContextSchema = z.object({
  id,
  name: shortText(60).min(1),
  amountCents: cents.min(1),
  dueDate: isoDate,
  paymentStatus: z.enum(["unpaid", "paid"]),
  confirmationStatus: z.enum(["suggested", "confirmed"]),
  /** How the bill repeats, so a bill due twice before payday is counted twice. Absent for a one-time bill. */
  repeat: z.enum(["weekly", "biweekly", "monthly"]).optional(),
  anchorDay: z.number().int().min(1).max(31).optional(),
});

/** Rule-based recurring candidates sent for the setup review (descriptions already scrubbed by the client). */
export const CandidateContextSchema = z.object({
  id,
  displayName: shortText(60),
  amountCents: cents.min(1),
  minCents: cents.min(0),
  maxCents: cents.min(0),
  cadence: z.enum(["monthly", "biweekly", "weekly"]),
  occurrences: z.number().int().min(1).max(500),
  nextDueDate: isoDate,
  sampleDescriptions: z.array(shortText(140)).max(3),
  possibleTransfer: z.boolean(),
});

export const HistoryItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: shortText(600),
});

export const AssistantRequestSchema = z.object({
  /** setup: review import candidates. chat: purchase checks, bill changes, explanations. */
  mode: z.enum(["setup", "chat"]),
  message: shortText(500),
  baseVersion: z.number().int().min(0),
  consent: z.object({ aiEnabled: z.literal(true), policyVersion: z.number().int().min(1) }),
  context: z.object({
    today: isoDate,
    plan: PlanContextSchema.nullable(),
    obligations: z.array(ObligationContextSchema).max(60),
    candidates: z.array(CandidateContextSchema).max(30).optional(),
    history: z.array(HistoryItemSchema).max(6).optional(),
  }),
});
export type AssistantRequest = z.infer<typeof AssistantRequestSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

const EvaluationSchema = z.object({
  availableCents: cents,
  billsCents: cents,
  essentialsCents: cents,
  reserveTargetCents: cents,
  remainderCents: cents,
  status: z.enum(["ok", "reserve_short", "essentials_short", "bills_short"]),
  shortfallCents: cents,
  billsCovered: z.boolean(),
  essentialsCovered: z.boolean(),
  reserveLeftCents: cents,
});

export const SimulationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ok"),
    amountCents: cents,
    purchaseDate: isoDate,
    before: EvaluationSchema.passthrough(),
    after: EvaluationSchema,
  }),
  z.object({
    kind: z.literal("outside_period"),
    amountCents: cents,
    purchaseDate: isoDate,
    periodStart: isoDate,
    periodEnd: isoDate,
  }),
  z.object({ kind: z.literal("invalid"), reason: z.string() }),
]);

export const ProposalPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("update_obligation"),
    targetId: id,
    changes: z
      .object({ name: shortText(60).min(1).optional(), amountCents: cents.min(1).optional(), dueDate: isoDate.optional() })
      .strict(),
  }),
  z.object({
    type: z.literal("add_obligation"),
    obligation: z.object({ name: shortText(60).min(1), amountCents: cents.min(1), dueDate: isoDate }).strict(),
  }),
]);

export const ChangeProposalSchema = z.object({
  id,
  baseVersion: z.number().int().min(0),
  payload: ProposalPayloadSchema,
  factRefs: z.array(z.string().max(64)).max(20),
});

export const SetupReviewItemSchema = z.object({
  candidateId: id,
  displayName: shortText(60),
  isLikelyBill: z.boolean(),
  reason: shortText(200),
  question: shortText(200).nullable(),
});

export const AssistantResponseSchema = z.object({
  kind: z.enum(["answer", "question", "simulation", "change_proposal", "setup_review"]),
  baseVersion: z.number().int().min(0),
  /** Short text for the user. Any dollar amount in it was checked against tool results. */
  message: shortText(1200),
  factRefs: z.array(z.string().max(64)).max(20),
  simulation: SimulationSchema.optional(),
  proposal: ChangeProposalSchema.optional(),
  setupReview: z.object({ items: z.array(SetupReviewItemSchema).max(30) }).optional(),
  requiresConfirmation: z.boolean(),
});
export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;

export const ERROR_CODES = [
  "bad_request",
  "too_large",
  "forbidden_origin",
  "no_consent",
  "ai_disabled",
  "rate_limited",
  "free_limit",
  "budget_exhausted",
  "quota_unavailable",
  "upstream_error",
  "timeout",
] as const;
export type AssistantErrorCode = (typeof ERROR_CODES)[number];

export const AssistantErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    retryAfterSeconds: z.number().int().optional(),
  }),
});
export type AssistantError = z.infer<typeof AssistantErrorSchema>;
