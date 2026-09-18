import Redis from "ioredis";
import { env } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";

/**
 * Rate limiting and lockout counters — the Next.js equivalent of Django's
 * cache-backed throttles (spec §2).
 *
 * Redis in production (shared across App Service instances), an in-process Map
 * in development and tests. The in-process limiter is explicitly *not* correct
 * for a multi-instance deployment, which is why `REDIS_URL` is called out in
 * AZURE_DEPLOYMENT.md as required once you scale past one instance.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts recorded in the current window, including this one. */
  count: number;
  limit: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Record one hit and report whether it is within the limit. */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  /** Read the current count without recording a hit. */
  peek(key: string, limit: number): Promise<RateLimitResult>;
  /** Clear a counter — used after a successful login. */
  reset(key: string): Promise<void>;
}

class MemoryRateLimiter implements RateLimiter {
  private readonly store = new Map<string, { count: number; expiresAt: number }>();

  private sweep(now: number): void {
    if (this.store.size < 512) return;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweep(now);
    const existing = this.store.get(key);

    if (!existing || existing.expiresAt <= now) {
      const entry = { count: 1, expiresAt: now + windowSeconds * 1000 };
      this.store.set(key, entry);
      return { allowed: true, count: 1, limit, retryAfterSeconds: windowSeconds };
    }

    existing.count += 1;
    return {
      allowed: existing.count <= limit,
      count: existing.count,
      limit,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
    };
  }

  async peek(key: string, limit: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (!existing || existing.expiresAt <= now) {
      return { allowed: true, count: 0, limit, retryAfterSeconds: 0 };
    }
    return {
      allowed: existing.count <= limit,
      count: existing.count,
      limit,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
    };
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class RedisRateLimiter implements RateLimiter {
  constructor(private readonly client: Redis) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const namespaced = `rl:${key}`;
    try {
      const results = await this.client
        .multi()
        .incr(namespaced)
        .ttl(namespaced)
        .exec();

      const count = Number(results?.[0]?.[1] ?? 1);
      let ttl = Number(results?.[1]?.[1] ?? -1);

      if (ttl < 0) {
        await this.client.expire(namespaced, windowSeconds);
        ttl = windowSeconds;
      }

      return { allowed: count <= limit, count, limit, retryAfterSeconds: Math.max(1, ttl) };
    } catch (error) {
      // Failing open on a Redis outage is the deliberate choice: an unreachable
      // cache must not lock every user out of the help desk. The event is
      // logged so the outage is visible.
      logger().error({ err: (error as Error).message }, "Rate limiter unavailable; failing open");
      return { allowed: true, count: 0, limit, retryAfterSeconds: 0 };
    }
  }

  async peek(key: string, limit: number): Promise<RateLimitResult> {
    const namespaced = `rl:${key}`;
    try {
      const [countRaw, ttl] = await Promise.all([
        this.client.get(namespaced),
        this.client.ttl(namespaced),
      ]);
      const count = Number(countRaw ?? 0);
      return { allowed: count <= limit, count, limit, retryAfterSeconds: Math.max(0, ttl) };
    } catch (error) {
      logger().error({ err: (error as Error).message }, "Rate limiter unavailable; failing open");
      return { allowed: true, count: 0, limit, retryAfterSeconds: 0 };
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.client.del(`rl:${key}`);
    } catch {
      /* best effort */
    }
  }
}

const globalForLimiter = globalThis as unknown as {
  __radxRateLimiter?: RateLimiter;
  __radxRedis?: Redis;
};

export function rateLimiter(): RateLimiter {
  if (globalForLimiter.__radxRateLimiter) return globalForLimiter.__radxRateLimiter;

  const url = env().REDIS_URL;
  let limiter: RateLimiter;

  if (url) {
    const client =
      globalForLimiter.__radxRedis ??
      new Redis(url, {
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        lazyConnect: false,
      });
    client.on("error", (err) => logger().error({ err: err.message }, "Redis error"));
    globalForLimiter.__radxRedis = client;
    limiter = new RedisRateLimiter(client);
  } else {
    if (env().isProduction) {
      logger().warn(
        {},
        "REDIS_URL is not set: rate limits and lockouts are per-instance only. Set it before scaling out.",
      );
    }
    limiter = new MemoryRateLimiter();
  }

  globalForLimiter.__radxRateLimiter = limiter;
  return limiter;
}

/** Test-only: swap in a fresh in-memory limiter. */
export function resetRateLimiter(): void {
  globalForLimiter.__radxRateLimiter = new MemoryRateLimiter();
}
