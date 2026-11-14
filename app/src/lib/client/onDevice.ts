// The Covered model answering inside this browser. The request is built exactly as for the server, but it
// never leaves the device: no network, no quota, no cost. It also keeps the assistant working offline.
// The model code and weights (about 340 KB) load only the first time this path is used.
import { AssistantRequestSchema, AssistantResponseSchema as ContractResponseSchema } from "../schemas/assistant";
import {
  AssistantResponseSchema,
  buildAssistantRequest,
  ERROR_MESSAGES,
  toUiResponse,
  type AssistantResponse,
  type HistoryItem,
} from "./assistant";
import type { AppState } from "./model";

export type AiWhere = "cloud" | "device";

const KEY = "covered:ai-where";
const EVENT = "covered:ai-where";
let memoryWhere: AiWhere = "cloud";

/** Where the assistant runs for this browser. Cloud is the default; "device" is the private mode. */
export function aiWhere(): AiWhere {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "device" || v === "cloud") return v;
  } catch {
    /* Storage unavailable: use the in-memory choice. */
  }
  return memoryWhere;
}

export function setAiWhere(where: AiWhere): void {
  memoryWhere = where;
  try {
    localStorage.setItem(KEY, where);
  } catch {
    /* Kept in memory until the page closes. */
  }
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* No window (tests). */
  }
}

/** Calls `fn` when the choice changes in another part of the app. Returns the unsubscribe function. */
export function onAiWhereChange(fn: (where: AiWhere) => void): () => void {
  const handler = () => fn(aiWhere());
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Why an answer came from the device: the user chose it, the server was out of reach, or the free cloud limit was used. */
export type DeviceReason = "chosen" | "offline" | "limit";

const DEVICE_TIMEOUT_MS = 10000;

export async function answerOnDevice(
  state: AppState,
  message: string,
  mode: "setup" | "plan",
  history: HistoryItem[] = [],
): Promise<AssistantResponse> {
  const parsed = AssistantRequestSchema.safeParse(buildAssistantRequest(state, message, mode, history));
  if (!parsed.success) throw new Error(ERROR_MESSAGES.INVALID_REQUEST);
  const req = parsed.data;
  const [{ deterministicResponse, runAssistant }, { ownProvider }, { readEnv }, { AssistantFailure }] = await Promise.all([
    import("../ai/assistant"),
    import("../ai/own/provider"),
    import("../ai/env"),
    import("../ai/errors"),
  ]);
  let body = deterministicResponse(req);
  if (!body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEVICE_TIMEOUT_MS);
    try {
      // No fallback: when the model is unsure it asks a clarifying question instead of calling anyone.
      const result = await runAssistant(req, readEnv({ AI_PROVIDER: "own" }), ownProvider({ lowConfidence: "ask" }), controller.signal);
      body = result.response;
    } catch (e) {
      throw new Error(e instanceof AssistantFailure ? e.message : ERROR_MESSAGES.INTERNAL_ERROR);
    } finally {
      clearTimeout(timer);
    }
  }
  const contract = ContractResponseSchema.safeParse(body);
  if (!contract.success) throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
  const ui = AssistantResponseSchema.safeParse({ ...toUiResponse(contract.data), servedBy: "device" });
  if (!ui.success) throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
  return ui.data;
}
