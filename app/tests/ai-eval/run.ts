/**
 * Assistant evaluation runner.
 *   Mock model:  npx tsx tests/ai-eval/run.ts --mock
 *   Real model:  OPENAI_API_KEY=... OPENAI_MODEL=gpt-6-luna npx tsx tests/ai-eval/run.ts
 *   Own model:   AI_PROVIDER=own AI_FALLBACK_TO_OPENAI=false npx tsx tests/ai-eval/run.ts   (the Covered model, no key needed)
 *   Own LLM:     AI_PROVIDER=local LOCAL_AI_BASE_URL=https://.../v1 AI_FALLBACK_TO_OPENAI=false npx tsx tests/ai-eval/run.ts
 *                (LOCAL_AI_FALLBACK=false so every answer comes from our model; the "served" column shows who answered)
 * Options: --only <id> (repeatable), --repeat <n> (run each scenario n times, real mode stability check).
 * Uses in-memory quotas and never needs Upstash. Prints a pass/fail table, tokens and estimated cost per task.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAssistant } from "../../src/lib/ai/handler";
import { readEnv } from "../../src/lib/ai/env";
import { MemoryStore } from "../../src/lib/limits/store";
import { costMicros } from "../../src/lib/limits/quota";
import type { ModelProvider } from "../../src/lib/ai/openai";
import { BILLS, PLAN, SCENARIOS, TODAY, sampleCandidates, type Scenario } from "./scenarios";

const args = process.argv.slice(2);
const forceMock = args.includes("--mock");
const only = args.flatMap((a, i) => (a === "--only" ? [args[i + 1]] : []));
const repeat = Math.max(1, Number(args[args.indexOf("--repeat") + 1]) || 1);
/** --min 0.9: succeed when at least this share passes (used in CI for our own model). Default: all must pass. */
const minShare = args.includes("--min") ? Math.min(1, Math.max(0, Number(args[args.indexOf("--min") + 1]) || 1)) : 1;
const ownMode = !forceMock && ["own", "covered"].includes((process.env.AI_PROVIDER ?? "").toLowerCase());
const localMode = ownMode || (!forceMock && (process.env.AI_PROVIDER ?? "").toLowerCase() === "local" && Boolean(process.env.LOCAL_AI_BASE_URL));
const realMode = !forceMock && (Boolean(process.env.OPENAI_API_KEY) || localMode);

console.info = () => {}; // silence per-request handler logs

const env = readEnv({
  ...(process.env as Record<string, string>),
  NODE_ENV: "development",
  QUOTA_MODE: "memory",
  AI_MOCK: realMode ? "" : "1",
  AI_DAILY_BUDGET_USD: process.env.AI_DAILY_BUDGET_USD ?? "5",
  AI_IP_PER_MINUTE: "1000",
  AI_CLIENT_PER_DAY: "10000",
});

const down: ModelProvider = async () => {
  throw new TypeError("fetch failed");
};

interface Row {
  id: string;
  run: number;
  pass: boolean;
  problems: string[];
  kind: string;
  tools: string;
  ms: number;
  inTok: number;
  outTok: number;
  costUsd: number;
  message: string;
  served: string;
}

function check(s: Scenario, status: number, json: Record<string, any>, tools: string[]): string[] {
  const e = s.expect;
  const p: string[] = [];
  if (e.errorCode) {
    if (json.error?.code !== e.errorCode) p.push(`expected error ${e.errorCode}, got ${json.error?.code ?? status}`);
    return p;
  }
  if (status !== 200) return [`HTTP ${status} ${json.error?.code ?? ""}: ${json.error?.message ?? ""}`];
  if (e.kind && !e.kind.includes(json.kind)) p.push(`kind ${json.kind} not in [${e.kind.join(", ")}]`);
  if (e.toolCalled && !tools.includes(e.toolCalled)) p.push(`tool ${e.toolCalled} not called (${tools.join(",") || "none"})`);
  if (e.noTools && tools.length) p.push(`expected no tools, got ${tools.join(",")}`);
  if (e.noProposal && json.proposal) p.push("unexpected proposal");
  if (e.noSimulation && json.simulation) p.push("unexpected simulation");
  if (e.proposal) {
    const pr = json.proposal?.payload;
    if (!pr) p.push("missing proposal");
    else {
      if (pr.type !== e.proposal.type) p.push(`proposal type ${pr.type}`);
      if (e.proposal.targetId && pr.targetId !== e.proposal.targetId) p.push(`target ${pr.targetId}`);
      const amount = pr.type === "add_obligation" ? pr.obligation?.amountCents : pr.changes?.amountCents;
      if (e.proposal.amountCents !== undefined && amount !== e.proposal.amountCents) p.push(`amount ${amount}`);
      const due = pr.type === "add_obligation" ? pr.obligation?.dueDate : pr.changes?.dueDate;
      if (e.proposal.dueDate && due !== e.proposal.dueDate) p.push(`due ${due}`);
      if (e.proposal.nameMatches && !new RegExp(e.proposal.nameMatches, "i").test(pr.obligation?.name ?? "")) p.push(`name ${pr.obligation?.name}`);
    }
  }
  if (e.simulation) {
    const sim = json.simulation;
    if (!sim) p.push("missing simulation");
    else {
      if (e.simulation.kind && sim.kind !== e.simulation.kind) p.push(`simulation kind ${sim.kind}`);
      if (e.simulation.status && sim.after?.status !== e.simulation.status) p.push(`status ${sim.after?.status}`);
      if (e.simulation.remainderCents !== undefined && sim.after?.remainderCents !== e.simulation.remainderCents) {
        p.push(`remainder ${sim.after?.remainderCents}`);
      }
      if (e.simulation.purchaseDate && sim.purchaseDate !== e.simulation.purchaseDate) p.push(`date ${sim.purchaseDate}`);
    }
  }
  if (e.messageMatches && !new RegExp(e.messageMatches, "i").test(json.message ?? "")) p.push(`message lacks /${e.messageMatches}/`);
  if (e.messageNotMatches && new RegExp(e.messageNotMatches, "i").test(json.message ?? "")) p.push(`message has /${e.messageNotMatches}/`);
  if (e.setup) {
    const items: { candidateId: string; isLikelyBill: boolean; question: string | null }[] = json.setupReview?.items ?? [];
    for (const want of e.setup) {
      const item = items.find((i) => i.candidateId.includes(want.candidateIncludes));
      if (!item) p.push(`setup item ${want.candidateIncludes} missing`);
      else if (item.isLikelyBill !== want.isLikelyBill) p.push(`${want.candidateIncludes}: isLikelyBill=${item.isLikelyBill}`);
    }
  }
  return p;
}

async function runOne(s: Scenario, run: number): Promise<Row> {
  const payload = {
    mode: s.mode,
    message: s.message,
    baseVersion: 7,
    consent: { aiEnabled: true, policyVersion: 1 },
    context: {
      today: TODAY,
      plan: s.noPlan || s.mode === "setup" ? null : PLAN,
      obligations: s.mode === "setup" ? [] : s.obligations ?? BILLS,
      ...(s.candidates ? { candidates: sampleCandidates(s.candidates) } : {}),
    },
  };
  const started = Date.now();
  const res = await handleAssistant(
    new Request("http://localhost:3000/api/assistant", {
      method: "POST",
      headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json", "x-client-id": "eval" },
      body: JSON.stringify(payload),
    }),
    env,
    { store: new MemoryStore(), ...(s.providerDown ? { provider: down } : {}) },
  );
  const json = (await res.json()) as Record<string, any>;
  const tools = (res.headers.get("x-ai-tools") ?? "").split(",").filter(Boolean);
  const inTok = Number(res.headers.get("x-ai-input-tokens") ?? 0);
  const outTok = Number(res.headers.get("x-ai-output-tokens") ?? 0);
  const problems = check(s, res.status, json, tools);
  return {
    id: s.id,
    run,
    pass: problems.length === 0,
    problems,
    kind: json.kind ?? json.error?.code ?? String(res.status),
    tools: tools.join(",") || "-",
    ms: Date.now() - started,
    inTok,
    outTok,
    costUsd: costMicros(env, inTok, outTok) / 1_000_000,
    message: String(json.message ?? json.error?.message ?? "").slice(0, 160),
    served: res.headers.get("x-ai-served") ?? "-",
  };
}

async function main() {
  const list = SCENARIOS.filter((s) => only.length === 0 || only.includes(s.id));
  const label = !realMode
    ? "MOCK model"
    : ownMode
      ? `OWN Covered model in this server (fallback to OpenAI: ${env.localFallback && env.openaiApiKey ? "on" : "off"})`
      : localMode
      ? `OWN model ${env.localModel} at ${new URL(env.localBaseUrl ?? "http://local").host} (fallback to OpenAI: ${env.localFallback && env.openaiApiKey ? "on" : "off"})`
      : `REAL model ${env.model} (reasoning: ${env.reasoningEffort ?? "off"})`;
  console.log(`Assistant eval — ${label} — ${list.length} scenarios x ${repeat}`);
  const rows: Row[] = [];
  for (let r = 1; r <= repeat; r++) {
    for (const s of list) {
      const row = await runOne(s, r);
      rows.push(row);
      const mark = row.pass ? "PASS" : "FAIL";
      console.log(
        `${mark}  ${row.id.padEnd(28)} ${row.kind.padEnd(16)} tools=${row.tools.padEnd(22)} ${String(row.ms).padStart(6)}ms  in=${row.inTok} out=${row.outTok} $${row.costUsd.toFixed(5)} served=${row.served}`,
      );
      if (!row.pass) console.log(`      problems: ${row.problems.join("; ")}\n      message: ${row.message}`);
    }
  }
  const passed = rows.filter((r) => r.pass).length;
  const modelRows = rows.filter((r) => r.inTok > 0);
  const avgCost = modelRows.length ? modelRows.reduce((s, r) => s + r.costUsd, 0) / modelRows.length : 0;
  const avgMs = modelRows.length ? Math.round(modelRows.reduce((s, r) => s + r.ms, 0) / modelRows.length) : 0;
  console.log(`\n${passed}/${rows.length} passed. Avg per AI task: ${avgMs} ms, ~$${avgCost.toFixed(5)} (prices from AI_INPUT_PRICE_PER_MTOK=${env.inputPricePerMTok}, AI_OUTPUT_PRICE_PER_MTOK=${env.outputPricePerMTok}).`);
  const out = join(dirname(fileURLToPath(import.meta.url)), "last-run.json");
  const servedCounts = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.served] = (acc[r.served] ?? 0) + 1), acc), {});
  console.log(`Answered by: ${Object.entries(servedCounts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const sorted = modelRows.map((r) => r.ms).sort((a, b) => a - b);
  if (sorted.length) console.log(`Latency: median ${sorted[Math.floor(sorted.length / 2)]} ms, p90 ${sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]} ms`);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), real: realMode, local: localMode, model: ownMode ? "covered-nlu-1" : localMode ? env.localModel : env.model, passed, total: rows.length, served: servedCounts, rows }, null, 2));
  console.log(`Details: ${out}`);
  process.exitCode = passed >= Math.ceil(rows.length * minShare) ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
