import { type ServerEnv, aiConfigured, mockActive, readEnv } from "./env";

/** GET /api/health — booleans only, never env values. */
export function handleHealth(env: ServerEnv = readEnv()): Response {
  const body = {
    ok: true,
    aiEnabled: env.aiEnabled,
    aiConfigured: aiConfigured(env),
    mock: mockActive(env),
    modelSet: env.modelExplicit,
    quota: env.quotaMode,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
