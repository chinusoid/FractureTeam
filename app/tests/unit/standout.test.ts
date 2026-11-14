import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyState, type AppState, type Bill } from "../../src/lib/client/model";
import { billsInGap, everydayPerDay, lateCushionDays, latePaycheck } from "../../src/lib/client/stress";
import { lowerBillGuide, ordinal } from "../../src/lib/client/lowerBill";
import { aiWhere, answerOnDevice, setAiWhere } from "../../src/lib/client/onDevice";
import {
  buildAssistantRequest,
  describeShared,
  requestAssistant,
  ServerUnreachableError,
} from "../../src/lib/client/assistant";

const NOW = "2026-11-15";

function bill(name: string, dollars: number, dueDate: string, frequency: Bill["frequency"] = "Monthly", extra: Partial<Bill> = {}): Bill {
  return {
    id: name.toLowerCase().replace(/\W+/g, "-"),
    name,
    amountCents: dollars * 100,
    dueDate,
    frequency,
    status: "confirmed",
    evidence: [],
    note: "",
    ...extra,
  };
}

/** Balance $2,000, payday Nov 20, $600 everyday for 6 days ($100 a day), $250 reserve. Free: $35. */
function plan(bills: Bill[]): AppState {
  return {
    ...emptyState(),
    plan: {
      balanceCents: 200000,
      balanceDate: NOW,
      horizonEndDate: "2026-11-20",
      essentialsCents: 60000,
      reserveCents: 25000,
      confirmed: true,
    },
    bills,
  };
}

const BASE = [
  bill("Rent", 1100, "2026-11-18"),
  bill("Auto Insurance", 150, "2026-11-22"),
  bill("Streaming", 15, "2026-11-17", "Weekly"),
];

describe("late paycheck stress test", () => {
  it("spreads everyday spending over the days left", () => {
    expect(everydayPerDay(plan(BASE), NOW)).toBe(10000);
  });

  it("uses part of the reserve when the paycheck is a day late", () => {
    const r = latePaycheck(plan(BASE), 1, NOW);
    expect(r.newEnd).toBe("2026-11-21");
    expect(r.gapBills).toHaveLength(0);
    expect(r.extraEverydayCents).toBe(10000);
    expect(r.status).toBe("reserve");
    expect(r.gapCents).toBe(6500);
  });

  it("names the bill that lands before a late paycheck and the shortfall", () => {
    const r = latePaycheck(plan(BASE), 3, NOW);
    expect(r.gapBills.map((b) => b.name)).toEqual(["Auto Insurance"]);
    expect(r.gapBillsCents).toBe(15000);
    expect(r.status).toBe("short");
    expect(r.gapCents).toBe(16500);
  });

  it("adds the next date of a repeating bill that falls in the gap, once", () => {
    const week = latePaycheck(plan(BASE), 7, NOW);
    expect(week.gapBills.map((b) => `${b.name} ${b.dueDate} ${b.expected}`)).toEqual([
      "Auto Insurance 2026-11-22 false",
      "Streaming 2026-11-24 true",
    ]);
    const alreadyThere = billsInGap(plan([...BASE, bill("Streaming", 15, "2026-11-24", "Weekly", { id: "s2" })]), "2026-11-27");
    expect(alreadyThere.filter((b) => b.name === "Streaming")).toHaveLength(1);
  });

  it("ignores paid, dismissed and candidate bills", () => {
    const r = latePaycheck(plan([...BASE.slice(0, 1), bill("Phone", 60, "2026-11-21", "Monthly", { status: "candidate" })]), 3, NOW);
    expect(r.gapBills).toHaveLength(0);
  });

  it("says how many days late the plan can absorb", () => {
    expect(lateCushionDays(plan(BASE), 30, NOW)).toBe(1); // day 2: the $150 insurance on Nov 22 lands first
    expect(lateCushionDays(plan([]), 30, NOW)).toBe(14); // $1,400 after everyday spending, $100 a day
    expect(lateCushionDays({ ...plan([]), plan: { ...plan([]).plan, balanceCents: 900000 } }, 30, NOW)).toBe(30);
    const short = plan(BASE);
    short.plan.balanceCents = 100000;
    expect(lateCushionDays(short, 30, NOW)).toBe(0);
  });

  it("never changes the plan", () => {
    const s = plan(BASE);
    const before = JSON.stringify(s);
    latePaycheck(s, 7, NOW);
    lateCushionDays(s, 30, NOW);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("lower this bill", () => {
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd",
    ]);
  });

  it("gives an internet bill a negotiation script with the user's numbers", () => {
    const internet = bill("Brightwave Internet", 50, "2026-11-19", "Monthly", { evidence: ["a", "b", "c", "d"] });
    const g = lowerBillGuide(internet, "internet", { periodEnd: "2026-11-20" });
    expect(g.kind).toBe("negotiate");
    expect(g.lead).toContain("$600 a year");
    expect(g.script).toContain("Brightwave Internet");
    expect(g.script).toContain("$50 a month");
    expect(g.script).toContain("last 4 months");
    expect(g.dueDateTip).toContain("21st");
  });

  it("offers to cancel or pause a subscription, without a due-date tip", () => {
    const g = lowerBillGuide(bill("Streamly", 16, "2026-11-19"), "subscription", { periodEnd: "2026-11-20" });
    expect(g.kind).toBe("cancel");
    expect(g.title).toBe("Cancel or pause Streamly");
    expect(g.dueDateTip).toBeNull();
    expect(g.script).toContain("cancel");
  });

  it("only suggests moving a due date for monthly bills inside the period, never to the 29th-31st", () => {
    expect(lowerBillGuide(bill("Card", 80, "2026-11-25"), "card_payment", { periodEnd: "2026-11-20" }).dueDateTip).toBeNull();
    expect(lowerBillGuide(bill("Gas", 40, "2026-11-19", "Weekly"), "utilities", { periodEnd: "2026-11-20" }).dueDateTip).toBeNull();
    expect(lowerBillGuide(bill("Power", 90, "2026-11-25"), "utilities", { periodEnd: "2026-11-28" }).dueDateTip).toContain("1st");
  });

  it("falls back to a general script when the category is unknown", () => {
    const g = lowerBillGuide(bill("Something", 30, "2026-11-19"), null, { periodEnd: "2026-11-20" });
    expect(g.kind).toBe("negotiate");
    expect(g.steps.length).toBeGreaterThan(2);
  });
});

describe("private mode: the Covered model on this device", () => {
  afterEach(() => vi.unstubAllGlobals());
  const state: AppState = { ...plan(BASE), aiConsent: false };

  it("defaults to the cloud and remembers the choice", () => {
    expect(aiWhere()).toBe("cloud");
    setAiWhere("device");
    expect(aiWhere()).toBe("device");
    setAiWhere("cloud");
  });

  it("checks a purchase with no network call and no consent to share", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const r = await answerOnDevice(state, "Can I afford $400 this weekend?", "plan");
    expect(r.kind).toBe("simulation");
    expect(r.simulation?.amountCents).toBe(40000);
    expect(r.servedBy).toBe("device");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("proposes a bill change that still needs confirmation", async () => {
    const r = await answerOnDevice(state, "My auto insurance went up by $30", "plan");
    expect(r.kind).toBe("change_proposal");
    expect(r.proposal?.payload).toMatchObject({ type: "update_obligation", targetId: "auto-insurance", changes: { amountCents: 18000 } });
    expect(r.proposal?.stateVersion).toBe(state.stateVersion);
  });

  it("marks network failures and a missing endpoint as unreachable, but not a server that said no", async () => {
    const consented = { ...state, aiConsent: true };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.reject(new TypeError("Failed to fetch"))));
    let err: unknown;
    try {
      await requestAssistant(consented, "Explain my plan", "plan");
    } catch (e) {
      err = e;
    }
    expect(err instanceof ServerUnreachableError).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { status: 404, headers: { "content-type": "text/html" } })));
    err = undefined;
    try {
      await requestAssistant(consented, "Explain my plan", "plan");
    } catch (e) {
      err = e;
    }
    expect(err instanceof ServerUnreachableError).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: { code: "ai_disabled", message: "Off." } }, { status: 503 })),
    );
    err = undefined;
    try {
      await requestAssistant(consented, "Explain my plan", "plan");
    } catch (e) {
      err = e;
    }
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ServerUnreachableError).toBe(false);
  });

  it("describes exactly what a cloud request shares", () => {
    const req = buildAssistantRequest(state, "Explain my plan", "plan", [
      { role: "user", text: "hi" },
      { role: "assistant", text: "Hello" },
    ]);
    const shared = describeShared(req, 42);
    expect(shared.sent[0]).toBe("Your question and the last 2 messages of this chat");
    expect(shared.sent).toContain("3 bills: name, amount and due date");
    expect(shared.kept[0]).toBe("Your file and its 42 transactions");
  });
});
