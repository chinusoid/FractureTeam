import { test } from "vitest";
import assert from "node:assert/strict";
import { MemoryStore, UpstashStore } from "../../src/lib/limits/store";
import { checkAndReserve, costMicros, settle } from "../../src/lib/limits/quota";
import { handlePlus } from "../../src/lib/limits/plus";
import { planOf } from "../../src/lib/ai/handler";
import { readEnv } from "../../src/lib/ai/env";

const NOW = new Date("2026-11-14T13:30:15Z");

test("memory store counts and expires", async () => {
  let t = 0;
  const s = new MemoryStore(() => t);
  assert.equal(await s.incrBy("k", 1, 10), 1);
  assert.equal(await s.incrBy("k", 2, 10), 3);
  t = 11_000;
  assert.equal(await s.incrBy("k", 1, 10), 1);
});

test("soft per-IP limit", async () => {
  const env = readEnv({ AI_IP_PER_MINUTE: "3", AI_CLIENT_PER_DAY: "100" });
  const s = new MemoryStore();
  for (let i = 0; i < 3; i++) assert.equal((await checkAndReserve(s, env, "1.2.3.4", `c${i}`, NOW)).ok, true);
  const blocked = await checkAndReserve(s, env, "1.2.3.4", "c9", NOW);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.code, "rate_limited");
    assert.equal(blocked.retryAfterSeconds, 45);
  }
  assert.equal((await checkAndReserve(s, env, "5.6.7.8", "c9", NOW)).ok, true);
});

test("per-client daily limit", async () => {
  const env = readEnv({ AI_IP_PER_MINUTE: "100", AI_CLIENT_PER_DAY: "2" });
  const s = new MemoryStore();
  assert.equal((await checkAndReserve(s, env, "a", "client", NOW)).ok, true);
  assert.equal((await checkAndReserve(s, env, "b", "client", NOW)).ok, true);
  const third = await checkAndReserve(s, env, "c", "client", NOW);
  assert.equal(third.ok, false);
});

test("global budget: reservation, refusal, refund and settlement", async () => {
  const env = readEnv({ AI_DAILY_BUDGET_USD: "0.1", AI_MAX_COST_PER_REQUEST_USD: "0.05", AI_INPUT_PRICE_PER_MTOK: "2", AI_OUTPUT_PRICE_PER_MTOK: "8" });
  const s = new MemoryStore();
  const a = await checkAndReserve(s, env, "ip1", "c1", NOW);
  const b = await checkAndReserve(s, env, "ip2", "c2", NOW);
  assert.ok(a.ok && b.ok);
  const c = await checkAndReserve(s, env, "ip3", "c3", NOW);
  assert.equal(c.ok, false);
  if (!c.ok) assert.equal(c.code, "budget_exhausted");
  assert.equal(await s.incrBy("ai:budget:2026-11-14", 0, 60), 100000); // refusal did not leave its reservation
  // 1000 input + 500 output tokens at $2/$8 per million = $0.006 = 6000 micro-dollars
  assert.equal(costMicros(env, 1000, 500), 6000);
  if (a.ok) await settle(s, a.budgetKey, a.reservationMicros, 6000);
  assert.equal(await s.incrBy("ai:budget:2026-11-14", 0, 60), 56000);
  // 56000 used + 50000 reservation > 100000 budget: still refused until b settles
  assert.equal((await checkAndReserve(s, env, "ip4", "c4", NOW)).ok, false);
  if (b.ok) await settle(s, b.budgetKey, b.reservationMicros, 6000);
  assert.equal((await checkAndReserve(s, env, "ip5", "c5", NOW)).ok, true);
});

test("no store -> quota_unavailable", async () => {
  const d = await checkAndReserve(null, readEnv({}), "ip", "c", NOW);
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "quota_unavailable");
});

test("upstash REST pipeline request and failures", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const okFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init! });
    return new Response(JSON.stringify([{ result: 7 }, { result: 1 }]), { status: 200 });
  };
  const s = new UpstashStore("https://example.upstash.io/", "tok", okFetch);
  assert.equal(await s.incrBy("ai:x", 1, 120), 7);
  assert.equal(calls[0].url, "https://example.upstash.io/pipeline");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), [["INCRBY", "ai:x", "1"], ["EXPIRE", "ai:x", "120"]]);

  const env = readEnv({});
  const down = new UpstashStore("https://example.upstash.io", "tok", async () => {
    throw new TypeError("network");
  });
  const d = await checkAndReserve(down, env, "ip", "c", NOW);
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "quota_unavailable");

  const err = new UpstashStore("https://example.upstash.io", "tok", async () => new Response(JSON.stringify([{ error: "WRONGPASS" }]), { status: 200 }));
  const e = await checkAndReserve(err, env, "ip", "c", NOW);
  assert.equal(e.ok, false);
  const unauthorized = new UpstashStore("https://example.upstash.io", "tok", async () => new Response("no", { status: 401 }));
  assert.equal((await checkAndReserve(unauthorized, env, "ip", "c", NOW)).ok, false);
});

test("free plan: the sixth question is refused with the Plus offer and is not counted", async () => {
  const s = new MemoryStore(() => NOW.getTime());
  const env = readEnv({ AI_FREE_PER_DAY: "5", AI_CLIENT_PER_DAY: "60" });
  for (let i = 0; i < 5; i++) assert.equal((await checkAndReserve(s, env, "ip", "free", NOW, "free")).ok, true);
  const sixth = await checkAndReserve(s, env, "ip", "free", NOW, "free");
  assert.equal(sixth.ok, false);
  if (!sixth.ok) {
    assert.equal(sixth.code, "free_limit");
    assert.match(sixth.message, /5 free assistant questions/);
  }
  // Refused attempts do not use up the day: after switching to Plus the same browser goes on from 5.
  assert.equal((await checkAndReserve(s, env, "ip", "free", NOW, "free")).ok, false);
  assert.equal((await checkAndReserve(s, env, "ip", "free", NOW, "plus")).ok, true);
  assert.equal(await s.incrBy(`ai:client:free:${NOW.toISOString().slice(0, 10)}`, 0, 60), 6);
});

test("Plus still stops at the general daily limit", async () => {
  const s = new MemoryStore(() => NOW.getTime());
  const env = readEnv({ AI_FREE_PER_DAY: "1", AI_CLIENT_PER_DAY: "2" });
  assert.equal((await checkAndReserve(s, env, "ip", "p", NOW, "plus")).ok, true);
  assert.equal((await checkAndReserve(s, env, "ip", "p", NOW, "plus")).ok, true);
  const third = await checkAndReserve(s, env, "ip", "p", NOW, "plus");
  assert.equal(third.ok === false && third.code, "rate_limited");
});

test("setup review never counts as a free-plan question; chat does unless the browser is on Plus", () => {
  const plain = new Request("http://localhost/api/assistant", { method: "POST" });
  const plus = new Request("http://localhost/api/assistant", { method: "POST", headers: { "x-plan": "plus" } });
  assert.equal(planOf(plain, "chat"), "free");
  assert.equal(planOf(plain, "setup"), "plus");
  assert.equal(planOf(plus, "chat"), "plus");
});

test("Plus interest: one browser is counted once, and the count can be read", async () => {
  const s = new MemoryStore(() => NOW.getTime());
  const env = readEnv({});
  const post = (id: string) =>
    handlePlus(new Request("http://localhost/api/plus", { method: "POST", headers: { "x-client-id": id } }), env, { store: s });
  assert.equal((await post("browser-a")).status, 200);
  assert.equal((await post("browser-a")).status, 200);
  assert.equal((await post("browser-b")).status, 200);
  const res = await handlePlus(new Request("http://localhost/api/plus"), env, { store: s });
  assert.deepEqual(await res.json(), { interested: 2 });
  const none = await handlePlus(new Request("http://localhost/api/plus", { method: "POST" }), env, { store: null });
  assert.equal(none.status, 503);
});
