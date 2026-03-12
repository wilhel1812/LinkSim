type RateLimitBucket = {
  windowStartMs: number;
  count: number;
};

type RateLimitInput = {
  key: string;
  limit: number;
  windowMs?: number;
  nowMs?: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

const buckets = new Map<string, RateLimitBucket>();
let callsSinceSweep = 0;

const DEFAULT_WINDOW_MS = 60_000;

const sweepExpiredBuckets = (nowMs: number) => {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.windowStartMs + DEFAULT_WINDOW_MS * 4 < nowMs) buckets.delete(key);
  }
};

const toSafeLimit = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
};

export const getClientAddress = (request: Request): string => {
  const cfIp = (request.headers.get("cf-connecting-ip") ?? "").trim();
  if (cfIp) return cfIp;
  const forwarded = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return "unknown";
};

export const takeRateLimitToken = ({
  key,
  limit,
  windowMs = DEFAULT_WINDOW_MS,
  nowMs = Date.now(),
}: RateLimitInput): RateLimitResult => {
  const safeLimit = toSafeLimit(limit);
  const safeWindowMs = Math.max(1_000, Math.floor(windowMs));

  callsSinceSweep += 1;
  if (callsSinceSweep >= 100) {
    callsSinceSweep = 0;
    sweepExpiredBuckets(nowMs);
  }

  const existing = buckets.get(key);
  if (!existing || nowMs - existing.windowStartMs >= safeWindowMs) {
    buckets.set(key, { windowStartMs: nowMs, count: 1 });
    return {
      allowed: true,
      remaining: Math.max(0, safeLimit - 1),
      retryAfterSec: 0,
    };
  }

  if (existing.count >= safeLimit) {
    const retryMs = Math.max(0, safeWindowMs - (nowMs - existing.windowStartMs));
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)),
    };
  }

  existing.count += 1;
  buckets.set(key, existing);
  return {
    allowed: true,
    remaining: Math.max(0, safeLimit - existing.count),
    retryAfterSec: 0,
  };
};
