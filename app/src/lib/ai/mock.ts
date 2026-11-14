/**
 * Deterministic stand-in for the model (AI_MOCK=1, never in production).
 * It speaks the Responses API item format, so requests go through the same tool loop, validation and guards.
 */
import { parseMoneyString } from "../finance/money";
import { addDays, isISODate, makeISODate, addMonths } from "../finance/dates";
import type { InputItem, ModelProvider, OutputItem, ResponsesRequestBody, ResponsesResult } from "./openai";
import { CANDIDATES_PREFIX, CONTEXT_PREFIX } from "./prompts";
import { INTAKE_CONTEXT_PREFIX, INTAKE_FORMAT_NAME } from "../schemas/intake";

interface MockBill {
  id: string;
  name: string;
  amount: string;
  due: string;
  status: string;
}

interface MockContext {
  today: string;
  bills: MockBill[];
  period: { start: string; end: string } | null;
}

let counter = 0;
function callId(): string {
  counter += 1;
  return `call_mock_${counter}`;
}

function message(text: string): OutputItem {
  return { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
}

function call(name: string, args: Record<string, unknown>): OutputItem {
  return { type: "function_call", call_id: callId(), name, arguments: JSON.stringify(args), status: "completed" };
}

function result(output: OutputItem[], body: ResponsesRequestBody): ResponsesResult {
  const inputChars = JSON.stringify(body.input).length + body.instructions.length;
  return { status: "completed", output, usage: { inputTokens: Math.ceil(inputChars / 4), outputTokens: 60 }, incompleteReason: null };
}

function contentOf(item: InputItem): string | null {
  const c = (item as { content?: unknown }).content;
  return typeof c === "string" ? c : null;
}

function parseJsonAfter(prefix: string, input: InputItem[]): unknown {
  for (const item of input) {
    const c = contentOf(item);
    if (c && c.startsWith(prefix)) {
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

/** Finds a date mention: ISO, "tomorrow", "today", "Nov 20", "11/20", "the 20th". */
export function mockParseDate(text: string, today: string): string | null {
  const t = text.toLowerCase();
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso && isISODate(iso[1])) return iso[1];
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\btoday\b/.test(t)) return today;
  if (/\bnext week\b/.test(t)) return addDays(today, 7);
  const year = Number(today.slice(0, 4));
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(t);
  if (named) {
    const d = makeISODate(year, MONTHS.indexOf(named[1]) + 1, Number(named[2]));
    if (d) return d < addDays(today, -60) ? makeISODate(year + 1, MONTHS.indexOf(named[1]) + 1, Number(named[2])) : d;
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
  return null;
}

function amountsIn(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\b(\d[\d,]*(?:\.\d{1,2})?)\s?(?:dollars|usd|bucks)\b/gi;
  for (const m of text.matchAll(re)) {
    // "$1,100, due …": the comma after the amount belongs to the sentence, not to the number.
    const c = parseMoneyString((m[1] ?? m[2]).replace(/,+$/, ""));
    if (c !== null && c > 0) out.push(c / 100);
  }
  if (out.length === 0) {
    // "went up by 30", "a 400 jacket"
    for (const m of text.matchAll(/\b(?:by|to|for|is|of|costs?|a|an)\s+(\d{2,6}(?:\.\d{1,2})?)\b(?!\s*(?:st|nd|rd|th|\/|-))/gi)) {
      const c = parseMoneyString(m[1]);
      if (c !== null && c > 0) out.push(c / 100);
    }
  }
  return out;
}

const GENERIC = new Set(["bill", "bills", "payment", "monthly", "my", "the", "auto", "pay", "plan"]);

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));
}

function matchBills(text: string, bills: MockBill[]): MockBill[] {
  const words = new Set(tokens(text));
  let best: MockBill[] = [];
  let bestScore = 0;
  for (const b of bills) {
    if (b.status !== "unpaid") continue;
    const score = tokens(b.name).filter((w) => words.has(w) || words.has(w.replace(/s$/, ""))).length;
    if (score > bestScore) {
      best = [b];
      bestScore = score;
    } else if (score === bestScore && score > 0) best.push(b);
  }
  return best;
}

function dollars(amount: string): number {
  return (parseMoneyString(amount) ?? 0) / 100;
}

function decideChat(userText: string, ctx: MockContext | null): OutputItem {
  const text = userText.toLowerCase();
  if (!ctx || !ctx.period) return message("Set up your plan first, then I can check purchases and bills.");
  const amounts = amountsIn(userText);
  const date = mockParseDate(userText, ctx.today);

  if (/\b(explain|why|how is (this|it) calculated|breakdown|what('s| is) left|how much (do i have|is left))\b/.test(text)) {
    return call("get_plan_summary", {});
  }

  const changeWords = /(went up|goes up|go up|increase|raised|higher|went down|goes down|decrease|lower|cheaper|now costs?|is now|changed|new amount|now due|moved to|update|change)/;
  const addWords = /\b(add|new bill|another bill|i also pay)\b/;
  const purchaseWords = /\b(afford|buy|purchase|spend|order|get a|get an|pay for)\b/;
  const matched = matchBills(userText, ctx.bills);

  if (addWords.test(text) && !changeWords.test(text)) {
    const nameMatch = /add (?:my |a |an |the )?([a-z][a-z ]{1,30}?)(?: bill)?(?:,|\s+for|\s+of|\s+\$|\s+due|\s*$)/i.exec(userText);
    const name = nameMatch ? nameMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()) : "New bill";
    if (!amounts.length) return message(`How much is the ${name.toLowerCase()} bill?`);
    if (!date) return message(`When is the ${name.toLowerCase()} bill due?`);
    return call("propose_new_bill", { name, amount_usd: amounts[0], due_date: date });
  }

  if (changeWords.test(text) && !purchaseWords.test(text)) {
    if (matched.length === 0) return message("I couldn't find that bill in your plan. Which bill do you mean?");
    if (matched.length > 1) {
      return message(`Which one changed: ${matched.map((b) => b.name).join(" or ")}?`);
    }
    const bill = matched[0];
    const old = dollars(bill.amount);
    let newAmount: number | null = null;
    if (amounts.length) {
      const amt = amounts[0];
      const down = /(down|decrease|lower|cheaper)/.test(text);
      if (/\bto\b/.test(text) && !/\bby\b/.test(text)) newAmount = amt;
      else if (/\bnow costs?\b|\bis now\b|new amount/.test(text)) newAmount = amt;
      else newAmount = down ? old - amt : old + amt;
    }
    const newDate = /(due|moved)/.test(text) ? date : null;
    if (newAmount === null && !newDate) return message(`What is the new amount for ${bill.name}?`);
    if (newAmount !== null && newAmount <= 0) return message(`What is the new amount for ${bill.name}?`);
    return call("propose_bill_change", {
      bill_id: bill.id,
      new_amount_usd: newAmount === null ? null : Math.round(newAmount * 100) / 100,
      new_due_date: newDate,
      new_name: null,
    });
  }

  if (purchaseWords.test(text) || amounts.length) {
    if (!amounts.length) return message("How much would it cost?");
    return call("simulate_purchase", { amount_usd: amounts[0], purchase_date: date });
  }
  return message("I can check a purchase, prepare a bill change, or explain your plan. What would you like to do?");
}

function decideSetup(body: ResponsesRequestBody): OutputItem {
  const raw = parseJsonAfter(CANDIDATES_PREFIX, body.input);
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const items = list.map((c) => {
    const descriptions = (c.descriptions as string[] | undefined) ?? [];
    const joined = descriptions.join(" ").toUpperCase();
    const transfer = Boolean(c.flagged_as_possible_transfer) || /TRANSFER|SAVINGS|ZELLE|VENMO/.test(joined);
    const name = String(c.currentName ?? "Payment")
      .replace(/\b(Online|Pmt|Autopay|Membership)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      candidateId: String(c.candidateId),
      displayName: name || String(c.currentName ?? "Payment"),
      isLikelyBill: !transfer,
      reason: transfer
        ? "Looks like a transfer to your own account, not a bill."
        : `Repeats ${String(c.cadence ?? "monthly")} with the same merchant.`,
      question: transfer
        ? "Is this a transfer to your own savings, or a payment you must make?"
        : c.amount_varies
          ? "The amount changes each time. Should the plan use the latest amount?"
          : null,
    };
  });
  return message(JSON.stringify({ items }));
}

const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Dates the test model understands: 2026-11-20, 11/20, Nov 20, "the 20th", today, tomorrow. */
function mockDate(text: string, today: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso && isISODate(iso[0])) return iso[0];
  if (/\btoday\b/i.test(text)) return today;
  if (/\btomorrow\b/i.test(text)) return addDays(today, 1);
  const [ty, tm] = today.split("-").map(Number);
  const onOrAfter = (month: number, day: number): string | null => {
    const d = makeISODate(ty, month, day);
    if (d && d >= today) return d;
    return makeISODate(ty + 1, month, day);
  };
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slash) return onOrAfter(Number(slash[1]), Number(slash[2]));
  const named = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if (named) return onOrAfter(MONTH_ABBR.indexOf(named[1].toLowerCase()) + 1, Number(named[2]));
  const nth = text.match(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/i);
  if (nth) {
    const thisMonth = makeISODate(ty, tm, Number(nth[1]));
    if (thisMonth && thisMonth >= today) return thisMonth;
    const next = makeISODate(tm === 12 ? ty + 1 : ty, tm === 12 ? 1 : tm + 1, Number(nth[1]));
    return next;
  }
  return null;
}

function mockAmount(text: string): number | null {
  const m = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/) ?? text.match(/(?<![\d\/-])([\d,]+(?:\.\d{1,2})?)(?![\d\/]|(?:st|nd|rd|th)\b)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** The interview's JSON form, filled by plain rules (see lib/ai/intake.ts for the real prompt). */
function readInterviewAnswer(body: ResponsesRequestBody) {
  const ctx = (parseJsonAfter(INTAKE_CONTEXT_PREFIX, body.input) ?? {}) as { step?: string; today?: string };
  const today = ctx.today ?? "2026-01-01";
  let answer = "";
  for (const item of body.input) if ((item as { role?: string }).role === "user") answer = contentOf(item) ?? "";
  const empty = { amount_usd: null as number | null, date: null as string | null, bills: [] as { name: string; amount_usd: number | null; due_date: string | null }[], no_more: false, unclear: false };
  if (ctx.step === "payday") {
    const date = mockDate(answer, today);
    return { ...empty, date, unclear: date === null };
  }
  if (ctx.step === "bills") {
    const noMore = /\b(that'?s all|that’s all|no more|nothing else|none|done|no)\b/i.test(answer);
    const bills = answer
      .split(/;|\n|,\s*(?=[a-z])|\band\b/i)
      .map((part) => part.trim())
      .filter((part) => /[a-z]/i.test(part) && !/^(that'?s all|that’s all|no more|nothing else|none|done|no)\.?$/i.test(part))
      .map((part) => {
        const date = mockDate(part, today);
        const withoutDate = part.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\bthe\s+\d{1,2}(?:st|nd|rd|th)\b/gi, " ");
        const name = withoutDate.replace(/\$?\s*[\d,]+(?:\.\d{1,2})?/g, " ").replace(/\b(due|on|is|my|bill|dollars|for|of)\b/gi, " ").replace(/[^a-z ]/gi, " ").replace(/\s+/g, " ").trim();
        return { name, amount_usd: mockAmount(withoutDate), due_date: date };
      })
      .filter((b) => b.name);
    return { ...empty, bills, no_more: noMore && bills.length === 0, unclear: bills.length === 0 && !noMore };
  }
  if (/\b(nothing|zero|none)\b/i.test(answer)) return { ...empty, amount_usd: 0 };
  const amount = mockAmount(answer);
  return { ...empty, amount_usd: amount, unclear: amount === null };
}

export function mockProvider(): ModelProvider {
  return async (body) => {
    if (body.text?.format?.type === "json_schema" && body.text.format.name === INTAKE_FORMAT_NAME) {
      return result([message(JSON.stringify(readInterviewAnswer(body)))], body);
    }
    if (body.text?.format?.type === "json_schema") return result([decideSetup(body)], body);
    const input = body.input;
    let lastUser = -1;
    input.forEach((item, i) => {
      if ((item as { role?: string }).role === "user") lastUser = i;
    });
    const userText = lastUser >= 0 ? contentOf(input[lastUser]) ?? "" : "";
    const outputs = input.slice(lastUser + 1).filter((i) => (i as { type?: string }).type === "function_call_output") as {
      output: string;
    }[];
    if (outputs.length > 0 || body.tool_choice === "none") {
      const last = outputs[outputs.length - 1];
      let text = "Done.";
      try {
        const parsed = JSON.parse(last?.output ?? "{}") as { verified_summary?: string; message?: string; ok?: boolean; draft_only?: boolean };
        text = parsed.verified_summary ?? parsed.message ?? text;
      } catch {
        /* keep default */
      }
      return result([message(text)], body);
    }
    const ctx = parseJsonAfter(CONTEXT_PREFIX, input) as MockContext | null;
    return result([decideChat(userText, ctx)], body);
  };
}
