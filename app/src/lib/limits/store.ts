/**
 * Counter storage for quotas. Upstash Redis over its REST API (shared between serverless instances)
 * or an in-memory map for local development only.
 */

export interface CounterStore {
  readonly kind: "upstash" | "memory";
  /** Atomically adds `by` to the counter and (re)sets its TTL. Returns the new value. */
  incrBy(key: string, by: number, ttlSeconds: number): Promise<number>;
}

export class QuotaStoreError extends Error {}

export class MemoryStore implements CounterStore {
  readonly kind = "memory" as const;
  private values = new Map<string, { value: number; expiresAt: number }>();
  constructor(private now: () => number = () => Date.now()) {}

  async incrBy(key: string, by: number, ttlSeconds: number): Promise<number> {
    const t = this.now();
    const current = this.values.get(key);
    const base = current && current.expiresAt > t ? current.value : 0;
    const value = base + by;
    this.values.set(key, { value, expiresAt: t + ttlSeconds * 1000 });
    if (this.values.size > 10_000) {
      for (const [k, v] of this.values) if (v.expiresAt <= t) this.values.delete(k);
    }
    return value;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class UpstashStore implements CounterStore {
  readonly kind = "upstash" as const;
  constructor(
    private url: string,
    private token: string,
    private fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private timeoutMs = 3000,
  ) {}

  async incrBy(key: string, by: number, ttlSeconds: number): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url.replace(/\/+$/, "")}/pipeline`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify([
          ["INCRBY", key, String(Math.round(by))],
          ["EXPIRE", key, String(ttlSeconds)],
        ]),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      throw new QuotaStoreError("Quota storage is unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new QuotaStoreError(`Quota storage responded ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new QuotaStoreError("Quota storage returned invalid JSON");
    }
    if (!Array.isArray(body) || body.length < 1) throw new QuotaStoreError("Unexpected quota storage response");
    const first = body[0] as { result?: unknown; error?: unknown };
    if (first.error !== undefined) throw new QuotaStoreError("Quota storage command failed");
    const value = Number(first.result);
    if (!Number.isFinite(value)) throw new QuotaStoreError("Unexpected quota storage value");
    return value;
  }
}

// One memory store per server process (development only).
let sharedMemory: MemoryStore | null = null;
export function sharedMemoryStore(): MemoryStore {
  if (!sharedMemory) sharedMemory = new MemoryStore();
  return sharedMemory;
}
