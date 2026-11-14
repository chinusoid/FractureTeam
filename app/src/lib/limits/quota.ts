import type { ServerEnv } from "../ai/env";
import { type CounterStore, QuotaStoreError, UpstashStore, sharedMemoryStore } from "./store";

/** Costs are tracked in micro-dollars (1e-6 USD) so Redis only stores integers. */
export const MICROS_PER_USD = 1_000_000;

export type QuotaDecision =
  | { ok: true; reservationMicros: number; budgetKey: string }
  | {
      ok: false;
      code: "rate_limited" | "free_limit" | "budget_exhausted" | "quota_unavailable";
      message: string;
      retryAfterSeconds?: number;
    };

/** "free" stops at AI_FREE_PER_DAY questions a day; "plus" (early access) only has the general daily limit. */
export type AssistantPlan = "free" | "plus";

export function storeForEnv(env: ServerEnv): CounterStore | null {
  if (env.quotaMode === "upstash" && env.upstashUrl && env.upstashToken) {
    return new UpstashStore(env.upstashUrl, env.upstashToken);
  }
  if (env.quotaMode === "memory") return sharedMemoryStore();
  return null;
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function secondsToUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export function costMicros(env: ServerEnv, inputTokens: number, outputTokens: number): number {
  // price per million tokens * tokens / 1e6 USD = price * tokens micro-dollars
  return Math.ceil(inputTokens * env.inputPricePerMTok + outputTokens * env.outputPricePerMTok);
}

/**
 * Checks the soft per-IP limit, the per-client daily limit and reserves the worst-case cost
 * of one request from the global daily budget (plan section 13).
 * If storage is not available the model must not be called.
 */
export async function checkAndReserve(
  store: CounterStore | null,
  env: ServerEnv,
  ip: string,
  clientId: string,
  now: Date = new Date(),
  plan: AssistantPlan = "plus",
): Promise<QuotaDecision> {
  if (!store) {
    return {
      ok: false,
      code: "quota_unavailable",
      message: "The assistant is paused because usage limits are not configured. Manual planning still works.",
    };
  }
  const day = utcDay(now);
  const minute = Math.floor(now.getTime() / 60000);
  try {
    const ipCount = await store.incrBy(`ai:ip:${ip}:${minute}`, 1, 120);
    if (ipCount > env.ipPerMinute) {
      return {
        ok: false,
        code: "rate_limited",
        message: "Too many assistant requests from this network. Try again in a minute.",
        retryAfterSeconds: 60 - now.getUTCSeconds(),
      };
    }
    const clientKey = `ai:client:${clientId}:${day}`;
    const clientCount = await store.incrBy(clientKey, 1, 2 * 86400);
    if (clientCount > env.clientPerDay) {
      return {
        ok: false,
        code: "rate_limited",
        message: "You've reached today's assistant limit. Manual planning still works.",
        retryAfterSeconds: secondsToUtcMidnight(now),
      };
    }
    if (plan === "free" && clientCount > env.freePerDay) {
      // The refused question is not counted, so it can be asked again right after switching to Plus.
      await store.incrBy(clientKey, -1, 2 * 86400);
      return {
        ok: false,
        code: "free_limit",
        message: `You've used today's ${env.freePerDay} free assistant questions.`,
        retryAfterSeconds: secondsToUtcMidnight(now),
      };
    }
    const reservationMicros = Math.ceil(env.maxCostPerRequestUsd * MICROS_PER_USD);
    const budgetKey = `ai:budget:${day}`;
    const spent = await store.incrBy(budgetKey, reservationMicros, 2 * 86400);
    if (spent > env.dailyBudgetUsd * MICROS_PER_USD) {
      await store.incrBy(budgetKey, -reservationMicros, 2 * 86400);
      return {
        ok: false,
        code: "budget_exhausted",
        message: "The assistant has used today's budget. Manual planning still works.",
        retryAfterSeconds: secondsToUtcMidnight(now),
      };
    }
    return { ok: true, reservationMicros, budgetKey };
  } catch (e) {
    if (e instanceof QuotaStoreError) {
      return {
        ok: false,
        code: "quota_unavailable",
        message: "The assistant is temporarily unavailable. Manual planning still works.",
      };
    }
    throw e;
  }
}

/** Replaces the reservation with the real cost (may refund part of it). Errors are swallowed: the reservation stays. */
export async function settle(
  store: CounterStore | null,
  budgetKey: string,
  reservationMicros: number,
  actualMicros: number,
): Promise<void> {
  if (!store) return;
  const delta = actualMicros - reservationMicros;
  if (delta === 0) return;
  try {
    await store.incrBy(budgetKey, delta, 2 * 86400);
  } catch {
    // keep the reservation; better to over-count than to overspend
  }
}
