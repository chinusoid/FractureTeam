/**
 * Picks the model for a request: our own Covered model (AI_PROVIDER=own, used in production),
 * OpenAI (the default when AI_PROVIDER is unset), a self-hosted LLM (AI_PROVIDER=local) or the
 * deterministic test model. Own and local hand a request to OpenAI when they are unsure, fail or are too slow.
 */
import { chatCompletionsProvider } from "./chat";
import { type ServerEnv, mockActive } from "./env";
import { mockProvider } from "./mock";
import { type ModelProvider, openAIProvider } from "./openai";
import { ownProvider } from "./own/provider";

export type ServedBy = "openai" | "local" | "own" | "mock" | "custom";

export interface ProviderHandle {
  call: ModelProvider;
  /** Which models actually answered during this request (for logs and the eval). */
  served: Set<ServedBy>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Tries `primary` with its own time limit. On any failure (not the request's own abort) the rest of the
 * request goes to `secondary`, so a slow or offline self-hosted model never breaks the user's answer.
 */
export function withFallback(
  primary: ModelProvider,
  secondary: ModelProvider | null,
  primaryTimeoutMs: number,
  served: Set<ServedBy>,
  primaryName: ServedBy = "local",
): ModelProvider {
  let failedOver = false;
  return async (body, signal) => {
    if (!failedOver) {
      const ctrl = new AbortController();
      const forward = () => ctrl.abort();
      signal.addEventListener("abort", forward, { once: true });
      const timer = setTimeout(() => ctrl.abort(), primaryTimeoutMs);
      try {
        const result = await primary(body, ctrl.signal);
        served.add(primaryName);
        return result;
      } catch (e) {
        if (signal.aborted || !secondary) throw e;
        failedOver = true;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", forward);
      }
    }
    served.add("openai");
    return secondary!(body, signal);
  };
}

export function createProvider(env: ServerEnv, fetchImpl?: FetchLike): ProviderHandle {
  const served = new Set<ServedBy>();
  if (mockActive(env)) {
    const mock = mockProvider();
    return { served, call: (b, s) => (served.add("mock"), mock(b, s)) };
  }
  const openai = env.openaiApiKey ? openAIProvider(env, fetchImpl) : null;
  if (env.provider === "own") {
    const fallback = env.localFallback ? openai : null;
    const own = ownProvider({ lowConfidence: fallback ? "fallback" : "ask" });
    return { served, call: withFallback(own, fallback, env.localTimeoutMs, served, "own") };
  }
  if (env.provider === "local" && env.localBaseUrl) {
    const local = chatCompletionsProvider(
      { baseUrl: env.localBaseUrl, apiKey: env.localApiKey, model: env.localModel, thinking: env.localThinking },
      fetchImpl,
    );
    return { served, call: withFallback(local, env.localFallback ? openai : null, env.localTimeoutMs, served) };
  }
  const fallbackFree = openai ?? openAIProvider(env, fetchImpl); // reports "not configured" when there is no key
  return { served, call: (b, s) => (served.add("openai"), fallbackFree(b, s)) };
}
