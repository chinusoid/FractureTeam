import { z } from "zod";
import { newId, type AppState } from "./model";
// Provisional browser-side contract until the team's shared schema is supplied.
// There is intentionally no mock AI endpoint or API key in this client project.
const proposal = z.object({
  id: z.string().min(1),
  stateVersion: z.number().int(),
  billId: z.string().min(1),
  amountCents: z.number().int().positive().max(1e12),
});
export const AssistantResponseSchema = z
  .object({
    kind: z.enum([
      "simulation",
      "change_proposal",
      "question",
      "answer",
      "setup",
    ]),
    message: z.string().max(6000),
    proposal: proposal.optional(),
    simulation: z
      .object({
        amountCents: z.number().int().positive().max(1e12),
        purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .optional(),
    setupReview: z
      .object({
        items: z.array(
          z.object({
            candidateId: z.string(),
            name: z.string(),
            reason: z.string(),
            question: z.string().optional(),
          }),
        ),
      })
      .optional(),
  })
  .refine((r) => r.kind !== "change_proposal" || !!r.proposal)
  .refine((r) => r.kind !== "simulation" || !!r.simulation);
export type AssistantResponse = z.infer<typeof AssistantResponseSchema>;
export const ERROR_MESSAGES: Record<string, string> = {
  AI_UNAVAILABLE:
    "The assistant isn’t connected yet. Use the purchase checker or bill forms to keep going.",
  AI_DISABLED:
    "The assistant is turned off. Your plan and manual forms are still available.",
  CONSENT_REQUIRED:
    "Review the data-sharing notice and enable the assistant before sending a message.",
  INVALID_REQUEST:
    "This request couldn’t be read. Rephrase it or use the form instead.",
  RATE_LIMITED:
    "Too many requests right now. Wait a minute or use the form instead.",
  QUOTA_EXCEEDED:
    "The assistant’s quota has been reached. Use the manual forms and try again later.",
  BUDGET_EXCEEDED:
    "Today’s assistant budget has been reached. Your plan and forms still work.",
  DAILY_BUDGET_EXCEEDED:
    "Today’s assistant budget has been reached. Use the form instead.",
  UPSTREAM_ERROR:
    "The assistant service couldn’t reply. Try again or use the form instead.",
  MODEL_UNAVAILABLE:
    "The assistant model is unavailable. Use the manual forms while the connection is restored.",
  TIMEOUT: "The assistant took too long. Try again or use the form instead.",
  INVALID_RESPONSE:
    "The assistant returned an incomplete reply. Nothing was changed. Try again or use the form.",
  INTERNAL_ERROR:
    "The assistant couldn’t finish this request. Your data is unchanged. Use the form instead.",
};
function scrubDescription(s: string) {
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{4,}\b/g, "[number]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .slice(0, 100);
}
let memoryId = "";
function clientId() {
  try {
    const existing = localStorage.getItem("covered:client-id");
    if (existing) return existing;
    const id = newId();
    localStorage.setItem("covered:client-id", id);
    return id;
  } catch {
    memoryId ||= newId();
    return memoryId;
  }
}
export async function requestAssistant(
  state: AppState,
  message: string,
  mode: "setup" | "plan",
): Promise<AssistantResponse> {
  if (!state.aiConsent) throw new Error(ERROR_MESSAGES.CONSENT_REQUIRED);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch("/api/assistant", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-client-id": clientId(),
      },
      signal: controller.signal,
      body: JSON.stringify({
        mode,
        message,
        consent: true,
        stateVersion: state.stateVersion,
        context: {
          plan: state.plan,
          bills: state.bills
            .filter((b) => b.status === "confirmed" || b.status === "candidate")
            .slice(0, 50)
            .map((b) => ({
              ...b,
              name: scrubDescription(b.name),
              note: "",
              evidence: b.evidence.slice(0, 3),
            })),
          transactions:
            mode === "setup"
              ? state.transactions
                  .filter((t) =>
                    state.bills.some((b) => b.evidence.includes(t.id)),
                  )
                  .slice(0, 30)
                  .map((t) => ({
                    id: t.id,
                    date: t.date,
                    amountCents: t.amountCents,
                    description: scrubDescription(t.description),
                  }))
              : [],
        },
      }),
    });
    if (!response.ok) {
      let code =
        response.status === 404 || response.status === 405
          ? "AI_UNAVAILABLE"
          : response.status === 429
            ? "RATE_LIMITED"
            : "UPSTREAM_ERROR";
      try {
        const body = await response.json();
        code = body.error?.code ?? body.code ?? code;
      } catch {
        /* Non-JSON proxy response. */
      }
      throw new Error(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UPSTREAM_ERROR);
    }
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error(ERROR_MESSAGES.AI_UNAVAILABLE);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    }
    const result = AssistantResponseSchema.safeParse(body);
    if (!result.success) throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    return result.data;
  } catch (e) {
    if (controller.signal.aborted) throw new Error(ERROR_MESSAGES.TIMEOUT);
    if (e instanceof TypeError) throw new Error(ERROR_MESSAGES.AI_UNAVAILABLE);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
