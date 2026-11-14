import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAssistant } from "../../src/lib/client/assistant";
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
        Response.json({ kind: "answer", message: "Review your plan." }),
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
    expect(JSON.parse(init.body).context.transactions).toEqual([]);
    expect(init.body).not.toContain("Private purchase");
  });
});
