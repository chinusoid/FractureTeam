import { type ServerEnv, aiConfigured, localConfigured, mockActive, readEnv } from "./env";
import { OWN_MODEL } from "./own/model";

/** GET /api/health — booleans only, never env values. */
export function handleHealth(env: ServerEnv = readEnv()): Response {
  const body = {
    ok: true,
    aiEnabled: env.aiEnabled,
    aiConfigured: aiConfigured(env),
    mock: mockActive(env),
    modelSet: env.modelExplicit,
    quota: env.quotaMode,
    provider: env.provider,
    localConfigured: localConfigured(env),
    fallbackToOpenAI: env.provider !== "openai" ? env.localFallback && Boolean(env.openaiApiKey) : false,
    ownModel: env.provider === "own" ? { name: OWN_MODEL.name, heldOut: OWN_MODEL.heldOut } : undefined,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
