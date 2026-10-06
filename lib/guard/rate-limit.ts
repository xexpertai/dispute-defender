/**
 * Per-IP fixed-window rate limiter for the public demo (in-memory: one Render instance).
 * Buckets: run (agent runs), ai (live Claude), write (sandbox writes), reset.
 */
export interface Limit {
  max: number;
  windowMs: number;
}

export const LIMITS = {
  run: { max: 20, windowMs: 60_000 },
  ai: { max: 3, windowMs: 10 * 60_000 },
  write: { max: 5, windowMs: 60_000 },
  reset: { max: 3, windowMs: 60_000 },
} satisfies Record<string, Limit>;

export type Bucket = keyof typeof LIMITS;

export class RateLimiter {
  private hits = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limits: Record<string, Limit> = LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns seconds to wait, or 0 when allowed (and counts the hit). */
  check(bucket: string, key: string): number {
    const limit = this.limits[bucket];
    if (!limit) return 0;
    const id = `${bucket}:${key}`;
    const t = this.now();
    const h = this.hits.get(id);
    if (!h || t - h.start >= limit.windowMs) {
      this.hits.set(id, { start: t, count: 1 });
      if (this.hits.size > 10_000) this.sweep(t);
      return 0;
    }
    if (h.count >= limit.max) return Math.ceil((h.start + limit.windowMs - t) / 1000);
    h.count += 1;
    return 0;
  }

  private sweep(t: number) {
    for (const [id, h] of this.hits) if (t - h.start > 3_600_000) this.hits.delete(id);
  }
}

/** Client IP for rate limiting: first X-Forwarded-For hop (Render sets it), else a shared key. */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local").slice(0, 64);
}

export const limiter = new RateLimiter();

export function tooMany(seconds: number) {
  return Response.json({ error: `Too many requests. Try again in ${seconds} s.` }, { status: 429, headers: { "Retry-After": String(seconds) } });
}
