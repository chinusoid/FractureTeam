import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAssistantRequest, requestAssistant } from "../../src/lib/client/assistant";
import { emptyState } from "../../src/lib/client/model";
afterEach(() => vi.unstubAllGlobals());
describe("assistant connection boundaries", () => {
  it("sends nothing without consent", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      requestAssistant(emptyState(), "Explain my plan", "plan"),
    ).rejects.toThrow("enable the assistant");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("treats the catch-all HTML page as an unavailable endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<!DOCTYPE html><html></html>", {
            headers: { "content-type": "text/html" },
          }),
        ),
    );
    await expect(
      requestAssistant({ ...emptyState(), aiConsent: true }, "Explain", "plan"),
    ).rejects.toThrow("isn’t connected yet");
  });
  it("gives an actionable quota error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { code: "QUOTA_EXCEEDED" } }, { status: 429 }),
        ),
    );
    await expect(
      requestAssistant({ ...emptyState(), aiConsent: true }, "Explain", "plan"),
    ).rejects.toThrow("quota has been reached");
  });
  it("rejects incomplete proposals", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ kind: "change_proposal", message: "Change it" }),
        ),
    );
    await expect(
      requestAssistant(
        { ...emptyState(), aiConsent: true },
        "Change insurance",
        "plan",
      ),
    ).rejects.toThrow("incomplete reply");
  });
  it("keeps the raw CSV and unrelated history out of plan requests", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ kind: "answer", message: "Review your plan.", baseVersion: 0, factRefs: [], requiresConfirmation: false }),
      );
    vi.stubGlobal("fetch", fetch);
    const s = { ...emptyState(), aiConsent: true };
    s.transactions.push({
      id: "private",
      date: "2026-11-14",
      description: "Private purchase",
      amountCents: -100,
      row: 2,
      duplicate: false,
      transfer: false,
    });
    await requestAssistant(s, "Explain", "plan");
    const init = fetch.mock.calls[0][1];
    expect(init.headers["x-client-id"]).toBeTruthy();
    const sent = JSON.parse(init.body);
    expect(sent.mode).toBe("chat");
    expect(sent.context.candidates).toBe(undefined);
    expect(init.body).not.toContain("Private purchase");
  });
});

const ok = (body: unknown) => vi.fn().mockResolvedValue(Response.json(body));
function planState() {
  const s = { ...emptyState(), aiConsent: true, stateVersion: 7 };
  s.plan = {
    balanceCents: 220000,
    balanceDate: "2026-11-14",
    horizonEndDate: "2026-11-24",
    essentialsCents: 35000,
    reserveCents: 25000,
    confirmed: true,
  };
  s.bills = [
    { id: "bill_insurance", name: "Car insurance", amountCents: 15000, dueDate: "2026-11-17", frequency: "Monthly", status: "confirmed", evidence: [], note: "" },
    { id: "bill_rent", name: "Rent", amountCents: 110000, dueDate: "2026-11-20", frequency: "Monthly", status: "confirmed", evidence: [], note: "" },
    { id: "bill_old", name: "Gym", amountCents: 4000, dueDate: "2026-11-18", frequency: "Monthly", status: "dismissed", evidence: [], note: "" },
  ];
  return s;
}
const contractBase = { baseVersion: 7, factRefs: [], requiresConfirmation: false };

describe("shared contract adapter", () => {
  it("sends the plan in contract form without dismissed bills", () => {
    const req = buildAssistantRequest(planState(), "Explain", "plan");
    expect(req.mode).toBe("chat");
    expect(req.baseVersion).toBe(7);
    expect(req.context.plan).toMatchObject({ balanceCents: 220000, endDate: "2026-11-24", essentialRemainingCents: 35000, reserveTargetCents: 25000 });
    expect(req.context.obligations.map((o) => o.id)).toEqual(["bill_insurance", "bill_rent"]);
  });
  it("setup sends scrubbed candidate evidence only", () => {
    const s = planState();
    s.transactions = [
      { id: "t1", date: "2026-10-17", description: "SAFEROAD INS ACCT 99887766 john@example.com", amountCents: -15000, row: 2, duplicate: false, transfer: false },
      { id: "t2", date: "2026-09-17", description: "SAFEROAD INS ACCT 99887766", amountCents: -14000, row: 3, duplicate: false, transfer: false },
    ];
    s.bills.push({ id: "cand_1", name: "SAFEROAD INS", amountCents: 15000, dueDate: "2026-11-17", frequency: "Monthly", status: "candidate", evidence: ["t1", "t2"], note: "" });
    const req = buildAssistantRequest(s, "Review", "setup");
    const c = req.context.candidates![0];
    expect(c).toMatchObject({ id: "cand_1", minCents: 14000, maxCents: 15000, occurrences: 2, cadence: "monthly" });
    expect(JSON.stringify(c)).not.toContain("99887766");
    expect(JSON.stringify(c)).not.toContain("john@example.com");
  });
  it("maps a contract simulation and an amount proposal for the UI", async () => {
    vi.stubGlobal("fetch", ok({ ...contractBase, kind: "simulation", message: "ok", simulation: { kind: "outside_period", amountCents: 40000, purchaseDate: "2026-12-05", periodStart: "2026-11-14", periodEnd: "2026-11-24" } }));
    const sim = await requestAssistant(planState(), "Can I buy?", "plan");
    expect(sim.simulation).toEqual({ amountCents: 40000, purchaseDate: "2026-12-05" });
    vi.stubGlobal("fetch", ok({ ...contractBase, kind: "change_proposal", requiresConfirmation: true, message: "Review it", proposal: { id: "proposal_1", baseVersion: 7, factRefs: [], payload: { type: "update_obligation", targetId: "bill_insurance", changes: { amountCents: 18000 } } } }));
    const p = await requestAssistant(planState(), "Insurance +30", "plan");
    expect(p.proposal).toEqual({ id: "proposal_1", stateVersion: 7, billId: "bill_insurance", amountCents: 18000 });
  });
  it("turns proposals the UI cannot preview into a pointer to the Bills form", async () => {
    vi.stubGlobal("fetch", ok({ ...contractBase, kind: "change_proposal", requiresConfirmation: true, message: "Add it?", proposal: { id: "proposal_2", baseVersion: 7, factRefs: [], payload: { type: "add_obligation", obligation: { name: "Dentist", amountCents: 9000, dueDate: "2026-11-20" } } } }));
    const r = await requestAssistant(planState(), "Add dentist", "plan");
    expect(r.kind).toBe("answer");
    expect(r.proposal).toBe(undefined);
    expect(r.message).toContain("Bills");
  });
  it("maps contract error codes to actionable messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "budget_exhausted", message: "x" } }, { status: 429 })));
    await expect(requestAssistant(planState(), "Explain", "plan")).rejects.toThrow("budget has been reached");
  });
});
