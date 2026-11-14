import type { AppState, ISODate } from "../finance";
import type { RecurringCandidate } from "../import/recurring";
import { scrubDescription } from "../ai/scrub";
import {
  type AssistantErrorCode,
  type AssistantRequest,
  type AssistantResponse,
  AssistantErrorSchema,
  AssistantResponseSchema,
} from "../schemas/assistant";

export interface HistoryItem {
  role: "user" | "assistant";
  text: string;
}

export function buildAssistantRequest(
  state: AppState,
  today: ISODate,
  mode: "setup" | "chat",
  message: string,
  history: HistoryItem[],
  candidates?: RecurringCandidate[],
): AssistantRequest {
  const plan =
    state.account && state.plan
      ? {
          balanceCents: state.account.balanceCents,
          balanceAsOf: state.account.balanceAsOf,
          startDate: state.plan.startDate,
          endDate: state.plan.endDate,
          essentialRemainingCents: Math.max(0, state.plan.essentialRemainingCents),
          reserveTargetCents: Math.max(0, state.plan.reserveTargetCents),
        }
      : null;
  const obligations = state.obligations
    .filter((o) => o.paymentStatus === "unpaid" && o.amountCents > 0)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
    .slice(0, 60)
    .map((o) => ({
      id: o.id,
      name: o.name.slice(0, 60) || "Bill",
      amountCents: o.amountCents,
      dueDate: o.dueDate,
      paymentStatus: o.paymentStatus,
      confirmationStatus: o.confirmationStatus,
    }));
  const req: AssistantRequest = {
    mode,
    message: message.slice(0, 500),
    baseVersion: state.stateVersion,
    consent: { aiEnabled: true, policyVersion: state.consent.policyVersion || 1 },
    context: {
      today,
      plan,
      obligations,
      history: history.slice(-6).map((h) => ({ role: h.role, text: h.text.slice(0, 600) })),
    },
  };
  if (mode === "setup" && candidates) {
    req.context.candidates = candidates.slice(0, 30).map((c) => ({
      id: c.id,
      displayName: c.displayName.slice(0, 60),
      amountCents: c.amountCents,
      minCents: c.minCents,
      maxCents: c.maxCents,
      cadence: c.cadence,
      occurrences: Math.min(500, c.occurrences),
      nextDueDate: c.nextDueDate,
      sampleDescriptions: c.sampleDescriptions.slice(0, 3).map(scrubDescription),
      possibleTransfer: c.possibleTransfer,
    }));
  }
  return req;
}

export type ClientErrorCode = AssistantErrorCode | "network" | "bad_response";

export type AssistantCallResult =
  | { ok: true; data: AssistantResponse }
  | { ok: false; code: ClientErrorCode; message: string; retryAfterSeconds?: number };

export const ERROR_TEXT: Record<ClientErrorCode, { title: string; action: string }> = {
  bad_request: { title: "The assistant could not read this request.", action: "Try rephrasing, or use the forms on the page." },
  too_large: { title: "That message is too long.", action: "Shorten it, or use the forms on the page." },
  forbidden_origin: { title: "The assistant only works from this site.", action: "Reload the page and try again." },
  no_consent: { title: "AI processing is turned off.", action: "Turn it on in Settings, or use the forms on the page." },
  ai_disabled: { title: "The assistant is not available right now.", action: "Everything else works: use the forms on the page." },
  rate_limited: { title: "Too many assistant requests in a short time.", action: "Wait a minute, or use the forms on the page." },
  budget_exhausted: { title: "The assistant's daily limit has been reached.", action: "Use the forms on the page; the assistant comes back tomorrow." },
  quota_unavailable: { title: "The assistant is paused because usage limits cannot be checked.", action: "Use the forms on the page." },
  upstream_error: { title: "The AI service returned an error.", action: "Try again, or use the forms on the page." },
  timeout: { title: "The assistant took too long to answer.", action: "Try again, or use the forms on the page." },
  network: { title: "Could not reach the assistant.", action: "Check your connection, or use the forms on the page." },
  bad_response: { title: "The assistant sent an answer we could not check, so it was not shown.", action: "Try again, or use the forms on the page." },
};

export async function callAssistant(req: AssistantRequest, clientId: string, timeoutMs = 35000): Promise<AssistantCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": clientId },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = AssistantErrorSchema.safeParse(body);
      if (err.success) {
        return {
          ok: false,
          code: err.data.error.code,
          message: err.data.error.message,
          retryAfterSeconds: err.data.error.retryAfterSeconds,
        };
      }
      return { ok: false, code: res.status === 404 || res.status === 503 ? "ai_disabled" : "upstream_error", message: `HTTP ${res.status}` };
    }
    const parsed = AssistantResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: "bad_response", message: "Response failed validation" };
    return { ok: true, data: parsed.data };
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return { ok: false, code: "timeout", message: "Timed out" };
    return { ok: false, code: "network", message: "Network error" };
  } finally {
    clearTimeout(timer);
  }
}
