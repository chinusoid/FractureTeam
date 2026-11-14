/**
 * POST /api/assistant. Check order: method, size, origin, JSON + schema, consent, AI switch, quotas, model.
 * Logs contain only codes, durations and token counts — never messages, balances or descriptions.
 */
import { AssistantRequestSchema, AssistantResponseSchema, type AssistantResponse } from "../schemas/assistant";
import { checkAndReserve, costMicros, settle, storeForEnv } from "../limits/quota";
import type { CounterStore } from "../limits/store";
import { type ServerEnv, isProduction, mockActive, readEnv } from "./env";
import { AssistantFailure, errorResponse } from "./errors";
import { mockProvider } from "./mock";
import { type ModelProvider, openAIProvider } from "./openai";
import { deterministicResponse, runAssistant, type RunStats } from "./assistant";

export const MAX_BODY_BYTES = 64 * 1024;

export interface HandlerDeps {
  provider?: ModelProvider;
  /** null = quota storage not configured. Omit to use the one from env. */
  store?: CounterStore | null;
  now?: () => Date;
}

function log(event: Record<string, unknown>) {
  try {
    console.info(JSON.stringify({ evt: "assistant", ...event }));
  } catch {
    /* ignore */
  }
}

export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : request.headers.get("x-real-ip")) ?? "unknown";
  return ip.trim().replace(/[^0-9a-fA-F:.]/g, "").slice(0, 45) || "unknown";
}

export function clientIdOf(request: Request): string {
  const id = request.headers.get("x-client-id") ?? "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : "anon";
}

export function originAllowed(request: Request, env: ServerEnv): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return !isProduction(env);
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const normalized = `${url.protocol}//${url.host}`;
  if (env.allowedOrigins.includes(normalized)) return true;
  let host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) {
    try {
      host = new URL(request.url).host;
    } catch {
      host = null;
    }
  }
  return Boolean(host) && host!.split(",")[0].trim().toLowerCase() === url.host.toLowerCase();
}

function json(body: AssistantResponse, stats: RunStats | null): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (stats) {
    headers["x-ai-input-tokens"] = String(stats.inputTokens);
    headers["x-ai-output-tokens"] = String(stats.outputTokens);
    headers["x-ai-model-calls"] = String(stats.modelCalls);
    headers["x-ai-tools"] = stats.toolNames.join(",").slice(0, 200);
    headers["x-ai-guard"] = stats.guardReplaced ? "replaced" : "ok";
  }
  return new Response(JSON.stringify(body), { status: 200, headers });
}

export async function handleAssistant(request: Request, env: ServerEnv = readEnv(), deps: HandlerDeps = {}): Promise<Response> {
  const started = Date.now();
  const done = (code: string, extra: Record<string, unknown> = {}) => log({ code, ms: Date.now() - started, ...extra });

  if (request.method !== "POST") {
    done("method_not_allowed");
    return new Response(JSON.stringify({ error: { code: "bad_request", message: "Use POST." } }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", allow: "POST" },
    });
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    done("too_large");
    return errorResponse("too_large", "The request is too large.");
  }
  if (!originAllowed(request, env)) {
    done("forbidden_origin");
    return errorResponse("forbidden_origin", "This request did not come from the app.");
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    done("bad_request");
    return errorResponse("bad_request", "Could not read the request.");
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    done("too_large");
    return errorResponse("too_large", "The request is too large.");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    done("bad_request");
    return errorResponse("bad_request", "The request is not valid JSON.");
  }
  const consent = (body as { consent?: { aiEnabled?: unknown } } | null)?.consent;
  if (!consent || consent.aiEnabled !== true) {
    done("no_consent");
    return errorResponse("no_consent", "Turn on AI help in the app before using the assistant.");
  }
  const parsed = AssistantRequestSchema.safeParse(body);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join(".") || "request";
    done("bad_request", { field: where });
    return errorResponse("bad_request", `Invalid request (${where}).`);
  }
  const req = parsed.data;

  if (!env.aiEnabled) {
    done("ai_disabled");
    return errorResponse("ai_disabled", "The assistant is turned off. Manual planning still works.");
  }
  if (env.aiMockRequested && isProduction(env)) {
    done("ai_disabled", { reason: "mock_in_production" });
    return errorResponse("ai_disabled", "The assistant is misconfigured (mock mode is not allowed in production).");
  }
  if (!deps.provider && !mockActive(env) && !env.openaiApiKey) {
    done("ai_disabled", { reason: "no_key" });
    return errorResponse("ai_disabled", "The assistant is not configured on this server. Manual planning still works.");
  }

  const fixed = deterministicResponse(req);
  if (fixed) {
    done("ok", { mode: req.mode, deterministic: true });
    return json(AssistantResponseSchema.parse(fixed), null);
  }

  const store = "store" in deps ? deps.store ?? null : storeForEnv(env);
  const now = deps.now?.() ?? new Date();
  const decision = await checkAndReserve(store, env, clientIp(request), clientIdOf(request), now);
  if (!decision.ok) {
    done(decision.code, { mode: req.mode });
    return errorResponse(decision.code, decision.message, decision.retryAfterSeconds);
  }

  const provider = deps.provider ?? (mockActive(env) ? mockProvider() : openAIProvider(env));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.timeoutMs);
  let stats: RunStats | null = null;
  try {
    const result = await runAssistant(req, env, provider, controller.signal);
    stats = result.stats;
    const checked = AssistantResponseSchema.safeParse(result.response);
    await settle(store, decision.budgetKey, decision.reservationMicros, costMicros(env, stats.inputTokens, stats.outputTokens));
    if (!checked.success) {
      done("upstream_error", { mode: req.mode, reason: "response_schema", field: checked.error.issues[0]?.path.join(".") });
      return errorResponse("upstream_error", "The assistant produced an invalid answer. Try again or use the form.");
    }
    done("ok", {
      mode: req.mode,
      kind: checked.data.kind,
      inTok: stats.inputTokens,
      outTok: stats.outputTokens,
      calls: stats.modelCalls,
      tools: stats.toolNames.length,
      guard: stats.guardReplaced,
    });
    return json(checked.data, stats);
  } catch (e) {
    const timedOut = controller.signal.aborted;
    const failure =
      e instanceof AssistantFailure
        ? e
        : timedOut
          ? new AssistantFailure("timeout", "The assistant took too long to answer. Try again or use the form.")
          : new AssistantFailure("upstream_error", "The assistant hit an error. Use the form instead.", undefined, (e as Error)?.name);
    // Keep the reservation on timeouts (tokens may have been billed); refund otherwise.
    if (failure.code !== "timeout") await settle(store, decision.budgetKey, decision.reservationMicros, 0);
    done(failure.code, { mode: req.mode, detail: failure.logDetail });
    return errorResponse(failure.code, failure.message, failure.retryAfterSeconds);
  } finally {
    clearTimeout(timer);
  }
}
