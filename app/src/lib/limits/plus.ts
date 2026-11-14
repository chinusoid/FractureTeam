/**
 * POST /api/plus — one browser says it wants Covered Plus. GET returns how many did.
 * Stores a counter and a per-browser marker only; no personal data.
 */
import { type ServerEnv, readEnv } from "../ai/env";
import { clientIdOf, originAllowed } from "../ai/handler";
import { storeForEnv } from "./quota";
import { type CounterStore, QuotaStoreError } from "./store";

const TOTAL_KEY = "plus:interest";
const YEAR = 365 * 86400;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handlePlus(
  request: Request,
  env: ServerEnv = readEnv(),
  deps: { store?: CounterStore | null } = {},
): Promise<Response> {
  const store = "store" in deps ? deps.store ?? null : storeForEnv(env);
  if (request.method === "POST" && !originAllowed(request, env)) return json(403, { ok: false });
  if (!store) return json(503, { ok: false });
  try {
    if (request.method === "GET") return json(200, { interested: await store.incrBy(TOTAL_KEY, 0, YEAR) });
    const id = clientIdOf(request);
    // A browser is counted once, however many times the button is pressed.
    const seen = id === "anon" ? 1 : await store.incrBy(`plus:client:${id}`, 1, YEAR);
    if (seen === 1) await store.incrBy(TOTAL_KEY, 1, YEAR);
    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof QuotaStoreError) return json(503, { ok: false });
    throw e;
  }
}
