/**
 * Browser side of the setup interview (POST /api/intake) and the step from its answers to a plan draft.
 * The questions and their order live in src/lib/schemas/intake.ts; nothing here asks the model anything
 * except to read one typed answer.
 */
import { AssistantErrorSchema } from "../schemas/assistant";
import {
  INTAKE_STEPS,
  IntakeResponseSchema,
  type IntakeBill,
  type IntakeRequest,
  type IntakeResponse,
  type IntakeStep,
} from "../schemas/intake";
import { CONTRACT_CODE, ERROR_MESSAGES, assistantClientId } from "./assistant";
import { emptyState, newId, today, type AppState, type Bill } from "./model";

export interface InterviewDraft {
  balanceCents: number | null;
  endDate: string | null;
  bills: IntakeBill[];
  billsDone: boolean;
  everydayCents: number | null;
  reserveCents: number | null;
}

export const emptyDraft = (): InterviewDraft => ({
  balanceCents: null,
  endDate: null,
  bills: [],
  billsDone: false,
  everydayCents: null,
  reserveCents: null,
});

/** The note on a bill that came from the interview; setup uses it to ask for a check. */
export const INTERVIEW_NOTE = "From your answers. Check the amount and the due date.";

/** The first question that still has no answer, or null when the interview is complete. */
export function nextStep(d: InterviewDraft): IntakeStep | null {
  if (d.balanceCents === null) return "balance";
  if (d.endDate === null) return "payday";
  if (!d.billsDone) return "bills";
  if (d.everydayCents === null) return "everyday";
  if (d.reserveCents === null) return "reserve";
  return null;
}

export const stepNumber = (step: IntakeStep) => INTAKE_STEPS.indexOf(step) + 1;

/** Adds what one checked answer gave. Values the answer did not carry stay as they were. */
export function applyAnswer(d: InterviewDraft, r: IntakeResponse): InterviewDraft {
  const next = { ...d, bills: [...d.bills] };
  if (r.step === "balance" && r.understood && r.balanceCents !== undefined) next.balanceCents = r.balanceCents;
  if (r.step === "payday" && r.understood && r.endDate !== undefined) next.endDate = r.endDate;
  if (r.step === "everyday" && r.understood && r.everydayCents !== undefined) next.everydayCents = r.everydayCents;
  if (r.step === "reserve" && r.understood && r.reserveCents !== undefined) next.reserveCents = r.reserveCents;
  if (r.step === "bills") {
    for (const b of r.bills ?? []) {
      if (!next.bills.some((x) => x.name.toLowerCase() === b.name.toLowerCase())) next.bills.push(b);
    }
    if (r.done) next.billsDone = true;
  }
  return next;
}

/**
 * Answers -> a plan that is NOT confirmed: every bill is a suggestion and every number can still be edited.
 * The person checks it on the setup screen and only "Build my plan" makes it the plan.
 */
export function draftToState(current: AppState, d: InterviewDraft): AppState {
  const base = emptyState();
  const bills: Bill[] = d.bills.map((b) => ({
    id: newId(),
    name: b.name,
    amountCents: b.amountCents,
    dueDate: b.dueDate,
    frequency: "Monthly",
    status: "candidate",
    evidence: [],
    note: INTERVIEW_NOTE,
  }));
  return {
    ...base,
    stateVersion: current.stateVersion + 1,
    aiConsent: current.aiConsent,
    // The interview replaces the plan with one that was not built from a file.
    importHashes: [],
    bills,
    plan: {
      ...base.plan,
      balanceCents: d.balanceCents ?? 0,
      balanceDate: today(),
      horizonEndDate: d.endDate && d.endDate >= today() ? d.endDate : base.plan.horizonEndDate,
      essentialsCents: d.everydayCents ?? 0,
      reserveCents: d.reserveCents ?? base.plan.reserveCents,
      confirmed: false,
    },
  };
}

export async function sendAnswer(step: IntakeStep, answer: string, d: InterviewDraft): Promise<IntakeResponse> {
  const request: IntakeRequest = {
    consent: { aiEnabled: true, policyVersion: 1 },
    today: today(),
    step,
    answer: answer.slice(0, 500),
    endDate: d.endDate,
    knownBills: d.bills.map((b) => b.name),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28000);
  try {
    const response = await fetch("/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": assistantClientId() },
      signal: controller.signal,
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      let code = response.status === 404 || response.status === 405 ? "AI_UNAVAILABLE" : response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR";
      try {
        const parsed = AssistantErrorSchema.safeParse(await response.json());
        if (parsed.success) code = CONTRACT_CODE[parsed.data.error.code] ?? code;
      } catch {
        /* Non-JSON proxy response. */
      }
      throw new Error(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UPSTREAM_ERROR);
    }
    const parsed = IntakeResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || parsed.data.step !== step) throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    return parsed.data;
  } catch (e) {
    if (controller.signal.aborted) throw new Error(ERROR_MESSAGES.TIMEOUT);
    if (e instanceof TypeError) throw new Error(ERROR_MESSAGES.AI_UNAVAILABLE);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
