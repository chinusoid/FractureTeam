/** Server-only configuration. Never import this from client components. */

export type QuotaMode = "upstash" | "memory" | "missing";

export interface ServerEnv {
  nodeEnv: string;
  /** AI_ENABLED=false switches the assistant off; manual features keep working. */
  aiEnabled: boolean;
  /** AI_MOCK=1 was requested (only honoured outside production). */
  aiMockRequested: boolean;
  openaiApiKey: string | null;
  openaiBaseUrl: string;
  model: string;
  /** OPENAI_MODEL was set explicitly (health check reports only this boolean). */
  modelExplicit: boolean;
  /** null = do not send the reasoning parameter (for non-reasoning models). */
  reasoningEffort: string | null;
  maxOutputTokens: number;
  timeoutMs: number;
  allowedOrigins: string[];
  quotaMode: QuotaMode;
  upstashUrl: string | null;
  upstashToken: string | null;
  dailyBudgetUsd: number;
  maxCostPerRequestUsd: number;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  ipPerMinute: number;
  clientPerDay: number;
}

type Source = Record<string, string | undefined>;

function num(src: Source, key: string, fallback: number, min = 0): number {
  const raw = src[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function str(src: Source, key: string): string | null {
  const v = src[key]?.trim();
  return v ? v : null;
}

export function readEnv(src: Source = process.env as Source): ServerEnv {
  const nodeEnv = src.NODE_ENV ?? "development";
  const production = nodeEnv === "production";
  const upstashUrl = str(src, "UPSTASH_REDIS_REST_URL");
  const upstashToken = str(src, "UPSTASH_REDIS_REST_TOKEN");
  let quotaMode: QuotaMode;
  if (upstashUrl && upstashToken && src.QUOTA_MODE !== "memory") quotaMode = "upstash";
  else if (!production && (src.QUOTA_MODE === "memory" || !(upstashUrl && upstashToken))) quotaMode = "memory";
  else if (upstashUrl && upstashToken) quotaMode = "upstash";
  else quotaMode = "missing";

  const effortRaw = (src.OPENAI_REASONING_EFFORT ?? "low").trim();
  const reasoningEffort = effortRaw === "" || effortRaw.toLowerCase() === "none" ? null : effortRaw;

  return {
    nodeEnv,
    aiEnabled: !["false", "0", "off", "no"].includes((src.AI_ENABLED ?? "true").trim().toLowerCase()),
    aiMockRequested: ["1", "true", "yes"].includes((src.AI_MOCK ?? "").trim().toLowerCase()),
    openaiApiKey: str(src, "OPENAI_API_KEY"),
    openaiBaseUrl: (str(src, "OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: str(src, "OPENAI_MODEL") ?? "gpt-6.1-sol",
    modelExplicit: Boolean(str(src, "OPENAI_MODEL")),
    reasoningEffort,
    maxOutputTokens: Math.round(num(src, "AI_MAX_OUTPUT_TOKENS", 1200, 100)),
    timeoutMs: Math.round(num(src, "AI_TIMEOUT_MS", 25000, 1000)),
    allowedOrigins: (src.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    quotaMode,
    upstashUrl,
    upstashToken,
    dailyBudgetUsd: num(src, "AI_DAILY_BUDGET_USD", 5),
    maxCostPerRequestUsd: num(src, "AI_MAX_COST_PER_REQUEST_USD", 0.05),
    inputPricePerMTok: num(src, "AI_INPUT_PRICE_PER_MTOK", 5),
    outputPricePerMTok: num(src, "AI_OUTPUT_PRICE_PER_MTOK", 40),
    ipPerMinute: Math.round(num(src, "AI_IP_PER_MINUTE", 30, 1)),
    clientPerDay: Math.round(num(src, "AI_CLIENT_PER_DAY", 60, 1)),
  };
}

export function isProduction(env: ServerEnv): boolean {
  return env.nodeEnv === "production";
}

/** Mock model is never used in production, even if AI_MOCK is set by mistake. */
export function mockActive(env: ServerEnv): boolean {
  return env.aiMockRequested && !isProduction(env);
}

export function aiConfigured(env: ServerEnv): boolean {
  return env.aiEnabled && (mockActive(env) || Boolean(env.openaiApiKey));
}
