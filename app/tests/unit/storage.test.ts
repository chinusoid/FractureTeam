import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BACKUP_KEY, STORAGE_KEY, clearState, loadState, saveState } from "../../src/lib/storage/local";
import { emptyState } from "../../src/lib/finance";

class MemoryStorage {
  data = new Map<string, string>();
  failWrites = false;
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = mem;
});

test("round trip keeps the state", () => {
  const s = { ...emptyState("client_x"), stateVersion: 4, account: { currency: "USD" as const, balanceCents: 220000, balanceAsOf: "2026-11-14" } };
  assert.equal(saveState(s), true);
  const loaded = loadState();
  assert.equal(loaded.notice, null);
  assert.deepEqual(loaded.state, s);
});

test("corrupted document is backed up and replaced with a fresh state", () => {
  mem.setItem(STORAGE_KEY, "{not json");
  const loaded = loadState();
  assert.ok(loaded.notice);
  assert.equal(loaded.state.stateVersion, 0);
  assert.equal(mem.getItem(BACKUP_KEY), "{not json");
  assert.equal(mem.getItem(STORAGE_KEY), null);
});

test("document with wrong shape is rejected", () => {
  mem.setItem(STORAGE_KEY, JSON.stringify({ ...emptyState("c"), account: { currency: "USD", balanceCents: 1.5, balanceAsOf: "2026-11-14" } }));
  const loaded = loadState();
  assert.ok(loaded.notice);
});

test("failed write is reported, not thrown", () => {
  mem.failWrites = true;
  assert.equal(saveState(emptyState("c")), false);
});

test("clear removes data", () => {
  saveState(emptyState("c"));
  clearState();
  assert.equal(mem.getItem(STORAGE_KEY), null);
});
