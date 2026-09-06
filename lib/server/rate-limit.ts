/**
 * In-memory token-bucket rate limiter (P2.20-M).
 *
 * The smallest mechanism that protects the expensive AI endpoints from
 * flooding, accidental repeated requests and runaway concurrency — per user,
 * per route. Single-instance only (swap for a shared store when horizontally
 * scaled). Not a security control on its own; it sits behind auth.
 */

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitRule = {
  /** Sustained requests per minute. */
  readonly perMinute: number;
  /** Burst capacity. */
  readonly burst: number;
};

export const RATE_LIMITS: Record<string, RateLimitRule> = {
  "generate": { perMinute: 6, burst: 3 },
  "vision-loop": { perMinute: 10, burst: 4 },
  "recipe": { perMinute: 20, burst: 6 },
  "brief": { perMinute: 20, burst: 6 },
  "correction": { perMinute: 20, burst: 6 },
  "decision": { perMinute: 30, burst: 10 },
  "default": { perMinute: 60, burst: 20 }
};

export type RateDecision = { allowed: boolean; retryAfterSeconds: number };

export function checkRateLimit(
  key: string,
  route: keyof typeof RATE_LIMITS | string,
  now = Date.now()
): RateDecision {
  const rule = RATE_LIMITS[route] ?? RATE_LIMITS["default"]!;
  const refillPerMs = rule.perMinute / 60_000;
  const id = `${route}:${key}`;
  const bucket = buckets.get(id) ?? { tokens: rule.burst, updatedAt: now };

  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(rule.burst, bucket.tokens + elapsed * refillPerMs);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(id, bucket);
    const deficit = 1 - bucket.tokens;
    return { allowed: false, retryAfterSeconds: Math.ceil(deficit / refillPerMs / 1000) };
  }
  bucket.tokens -= 1;
  buckets.set(id, bucket);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}
