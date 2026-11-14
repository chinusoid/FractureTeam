/**
 * The Covered model as an assistant provider. It answers in the same Responses-style items as the
 * OpenAI client, so the server's tool loop, validation, money guard and confirmation flow are unchanged:
 * the model only decides what the user wants; numbers come from the finance module.
 *
 *   intent  - learned (predictIntent): purchase, bill change, new bill, explain, other
 *   bill    - token overlap with the bill names, then the learned bill category ("rent" -> "Oakwood Apartments")
 *   amounts and dates - read from the text
 * Below the confidence threshold it hands the request to OpenAI (when configured) or asks the user.
 */
import { parseMoneyString } from "../../finance/money";
import { addDays, addMonths, isISODate, makeISODate } from "../../finance/dates";
import { AssistantFailure } from "../errors";
import type { InputItem, ModelProvider, OutputItem, ResponsesRequestBody, ResponsesResult } from "../openai";
import { CANDIDATES_PREFIX, CONTEXT_PREFIX } from "../prompts";
import { type Intent, predictCategory, predictIntent } from "./model";

export const OWN_MIN_CONFIDENCE = 0.5;

interface Bill {
  id: string;
  name: string;
  amount: string;
  due: string;
  status: string;
}

interface Context {
  today: string;
  bills: Bill[];
  period: { start: string; end: string } | null;
}

let counter = 0;
const callId = () => `call_own_${Date.now().toString(36)}_${(counter = (counter + 1) % 1e6)}`;

const message = (text: string): OutputItem => ({
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});

const call = (name: string, args: Record<string, unknown>): OutputItem => ({
  type: "function_call",
  call_id: callId(),
  name,
  arguments: JSON.stringify(args),
  status: "completed",
});

const done = (output: OutputItem[]): ResponsesResult => ({
  status: "completed",
  output,
  usage: { inputTokens: 0, outputTokens: 0 },
  incompleteReason: null,
});

function contentOf(item: InputItem): string | null {
  const c = (item as { content?: unknown }).content;
  return typeof c === "string" ? c : null;
}

function jsonAfter(prefix: string, input: InputItem[]): unknown {
  for (const item of input) {
    const c = contentOf(item);
    if (c?.startsWith(prefix)) {
      try {
        return JSON.parse(c.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseDate(text: string, today: string): string | null {
  const t = text.toLowerCase();
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso && isISODate(iso[1])) return iso[1];
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\b(today|tonight|right now)\b/.test(t)) return today;
  if (/\bnext week\b/.test(t)) return addDays(today, 7);
  const year = Number(today.slice(0, 4));
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(t);
  if (named) {
    const month = MONTHS.indexOf(named[1]) + 1;
    const d = makeISODate(year, month, Number(named[2]));
    if (d) return d < addDays(today, -60) ? makeISODate(year + 1, month, Number(named[2])) : d;
  }
  const slash = /\b(\d{1,2})\/(\d{1,2})\b(?!\/)/.exec(t);
  if (slash) {
    const d = makeISODate(year, Number(slash[1]), Number(slash[2]));
    if (d) return d;
  }
  const nth = /\bthe (\d{1,2})(?:st|nd|rd|th)\b/.exec(t);
  if (nth) {
    const day = Number(nth[1]);
    let d = makeISODate(year, Number(today.slice(5, 7)), day);
    if (d && d < today) d = addMonths(d, 1, day);
    if (d) return d;
  }
  const wd = /\b(?:on |this |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (wd) {
    const [y, m, d] = today.split("-").map(Number);
    const cur = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    let diff = (WEEKDAYS.indexOf(wd[1]) - cur + 7) % 7;
    if (diff === 0 || /next/.test(wd[0])) diff += diff === 0 ? 7 : 0;
    return addDays(today, diff);
  }
  return null;
}

export function amountsIn(text: string): number[] {
  const out: number[] = [];
  // "$1,100" and "$65," (a comma after the number is punctuation, not a thousands separator).
  const num = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?`;
  for (const m of text.matchAll(new RegExp(String.raw`\$\s?(${num})|\b(${num})\s?(?:dollars|usd|bucks)\b`, "gi"))) {
    const c = parseMoneyString(m[1] ?? m[2]);
    if (c !== null && c > 0) out.push(c / 100);
  }
  if (!out.length) {
    for (const m of text.matchAll(/\b(?:by|to|for|is|of|costs?|at|now|a|an|up|down|plus|off)\s+(\d{2,6}(?:\.\d{1,2})?)\b(?!\s*(?:st|nd|rd|th|\/|-|am|pm))/gi)) {
      const c = parseMoneyString(m[1]);
      if (c !== null && c > 0) out.push(c / 100);
    }
  }
  return out;
}

const GENERIC = new Set(["bill", "bills", "payment", "monthly", "my", "the", "auto", "pay", "plan", "now", "due", "month", "this", "went", "new"]);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));

/** Bills the user means: shared words first, then the same learned category ("rent" -> "Oakwood Apartments"). */
export function matchBills(text: string, bills: Bill[]): Bill[] {
  const open = bills.filter((b) => b.status === "unpaid");
  const said = new Set(words(text).flatMap((w) => [w, w.replace(/s$/, "")]));
  let best: Bill[] = [];
  let bestScore = 0;
  for (const b of open) {
    const score = words(b.name).filter((w) => said.has(w) || said.has(w.replace(/s$/, ""))).length;
    if (score > bestScore) {
      best = [b];
      bestScore = score;
    } else if (score === bestScore && score > 0) best.push(b);
  }
  if (best.length) return best;
  const asked = predictCategory(text);
  if (!asked.isBill || asked.confidence < 0.45) return [];
  return open.filter((b) => {
    const c = predictCategory(b.name);
    return c.label === asked.label && c.confidence >= 0.45;
  });
}

const dollars = (amount: string) => (parseMoneyString(amount) ?? 0) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

function newBillName(text: string): string | null {
  const m =
    /\b(?:add|track|include|put)\s+(?:my |a |an |the |another )?(?:new )?(?:bill(?: for|:)?\s+)?([a-z][a-z ]{1,30}?)(?:\s+bill|\s+payment)?(?:,|\s+for\b|\s+of\b|\s+at\b|\s+\$|\s+due\b|\s+on\b|\s+in\b|\s+every\b|\s+too\b|\s*$)/i.exec(text) ??
    /\b(?:i also pay|i have a|there'?s also|i need to pay|forgot my)\s+(?:my |a |an |the )?([a-z][a-z ]{1,30}?)(?:\s+bill|\s+payment)?(?:,|\s+for\b|\s+of\b|\s+at\b|\s+\$|\s+due\b|\s+on\b|\s*$)/i.exec(text);
  const raw = m?.[1]?.trim();
  if (!raw || /^(something|it|that|this|bill|payment|one)$/i.test(raw)) return null;
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface OwnOptions {
  /** "fallback": low confidence throws so the request goes to OpenAI. "ask": ask the user instead. */
  lowConfidence: "fallback" | "ask";
}

function decideChat(userText: string, ctx: Context | null, opts: OwnOptions): OutputItem {
  if (!ctx?.period) return message("Set up your plan first, then I can check purchases and bills.");
  const pred = predictIntent(userText);
  if (pred.confidence < OWN_MIN_CONFIDENCE) {
    if (opts.lowConfidence === "fallback") {
      throw new AssistantFailure("upstream_error", "The assistant could not answer.", undefined, `own low confidence ${pred.label} ${pred.confidence.toFixed(2)}`);
    }
    return message("I can check a purchase, prepare a bill change, or explain your plan. What would you like to do?");
  }
  const text = userText.toLowerCase();
  const amounts = amountsIn(userText);
  const date = parseDate(userText, ctx.today);
  let intent: Intent = pred.label;
  // Phrases like "went up to $20" state the final amount even when the wording sounds like a change.
  if ((intent === "bill_up" || intent === "bill_down") && /\bto\s+\$?\d/.test(text) && !/\bby\b/.test(text)) intent = "bill_set";

  switch (intent) {
    case "explain":
      return call("get_plan_summary", {});
    case "purchase":
      if (!amounts.length) return message("How much would it cost?");
      return call("simulate_purchase", { amount_usd: amounts[0], purchase_date: date });
    case "bill_new": {
      const name = newBillName(userText);
      if (!name) return message("Which bill would you like to add, how much is it, and when is it due?");
      if (!amounts.length) return message(`How much is the ${name.toLowerCase()} bill?`);
      if (!date) return message(`When is the ${name.toLowerCase()} bill due?`);
      return call("propose_new_bill", { name, amount_usd: amounts[0], due_date: date });
    }
    case "bill_up":
    case "bill_down":
    case "bill_set":
    case "bill_due": {
      const matched = matchBills(userText, ctx.bills);
      if (!matched.length) {
        const names = ctx.bills.filter((b) => b.status === "unpaid").map((b) => b.name);
        return message(`I couldn't find that bill in your plan. Which one do you mean${names.length ? `: ${names.slice(0, 6).join(", ")}` : ""}?`);
      }
      if (matched.length > 1) return message(`Which one changed: ${matched.map((b) => b.name).join(" or ")}?`);
      const bill = matched[0];
      if (intent === "bill_due") {
        if (!date) return message(`What is the new due date for ${bill.name}?`);
        return call("propose_bill_change", { bill_id: bill.id, new_amount_usd: null, new_due_date: date, new_name: null });
      }
      if (!amounts.length) return message(`What is the new amount for ${bill.name}?`);
      const old = dollars(bill.amount);
      const a = amounts[0];
      const next = intent === "bill_set" ? a : intent === "bill_up" ? old + a : old - a;
      if (next <= 0) return message(`What is the new amount for ${bill.name}?`);
      const newDate = /\b(due|moved|charged)\b/.test(text) ? date : null;
      return call("propose_bill_change", { bill_id: bill.id, new_amount_usd: round2(next), new_due_date: newDate, new_name: null });
    }
    default:
      return message("I can check a purchase, prepare a bill change, or explain your plan. I can't move money or give investment advice. What would you like to do?");
  }
}

const CATEGORY_WORDS: Record<string, string> = {
  rent: "rent",
  insurance: "an insurance payment",
  phone: "a phone bill",
  internet: "an internet bill",
  utilities: "a utility bill",
  subscription: "a subscription",
  gym: "a gym membership",
  loan: "a loan payment",
  other_bill: "a regular bill",
  card_payment: "a credit card payment",
  savings_transfer: "a transfer to your own savings",
  person_transfer: "a transfer to a person",
  everyday: "everyday spending",
  income: "income",
};

function decideSetup(body: ResponsesRequestBody): OutputItem {
  const raw = jsonAfter(CANDIDATES_PREFIX, body.input);
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const items = list.map((c) => {
    const descriptions = ((c.descriptions as string[] | undefined) ?? []).join(" ");
    const current = String(c.currentName ?? "Payment");
    const cat = predictCategory(`${current} ${descriptions}`);
    const transfer = Boolean(c.flagged_as_possible_transfer);
    const likely = cat.isBill && !(transfer && cat.confidence < 0.8);
    const name =
      current
        .replace(/\b(Online|Pmt|Autopay|Membership|Ppd|Web|Pos|Ach)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim() || current;
    const question = !likely
      ? cat.label === "card_payment"
        ? "Is this a credit card payment you must make before payday?"
        : "Is this a transfer between your own accounts, or a payment you must make?"
      : c.amount_varies
        ? "The amount changes each time. Should the plan use the latest amount?"
        : null;
    return {
      candidateId: String(c.candidateId),
      displayName: name.slice(0, 60),
      isLikelyBill: likely,
      reason: `Looks like ${CATEGORY_WORDS[cat.label] ?? "a payment"} (Covered model, ${Math.round(cat.confidence * 100)}% sure).`,
      question,
    };
  });
  return message(JSON.stringify({ items }));
}

export function ownProvider(opts: OwnOptions = { lowConfidence: "ask" }): ModelProvider {
  return async (body) => {
    if (body.text?.format?.type === "json_schema") return done([decideSetup(body)]);
    const input = body.input;
    let lastUser = -1;
    input.forEach((item, i) => {
      if ((item as { role?: string }).role === "user") lastUser = i;
    });
    const outputs = input.slice(lastUser + 1).filter((i) => (i as { type?: string }).type === "function_call_output") as { output: string }[];
    if (outputs.length > 0 || body.tool_choice === "none") {
      let text = "Here is what that means for your plan.";
      try {
        const parsed = JSON.parse(outputs[outputs.length - 1]?.output ?? "{}") as { verified_summary?: string; message?: string };
        text = parsed.verified_summary ?? parsed.message ?? text;
      } catch {
        /* keep default */
      }
      return done([message(text)]);
    }
    const userText = lastUser >= 0 ? contentOf(input[lastUser]) ?? "" : "";
    const ctx = jsonAfter(CONTEXT_PREFIX, input) as Context | null;
    return done([decideChat(userText, ctx, opts)]);
  };
}
