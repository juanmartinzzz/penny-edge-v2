/**
 * Shared CoinGecko Demo API rate limiter (one DO per API key).
 *
 * Demo plan is ~100 calls/min; we target 80/min with a small burst so EVG,
 * TAS, and SWATCH cannot stampede the same key when queues overlap.
 *
 * Coordination atom = the Demo API key (not per-IP / per-user). A single
 * named instance is intentional.
 */
import { DurableObject } from "cloudflare:workers";

/** Stay under Demo 100/min with headroom for other callers / clock skew. */
export const COINGECKO_TARGET_PER_MINUTE = 80;

/** Allows short bursts (e.g. daily + hourly chart pair) without dumping the minute budget. */
export const COINGECKO_BURST_CAPACITY = 8;

const REFILL_PER_MS = COINGECKO_TARGET_PER_MINUTE / 60_000;

/** Deterministic DO name for the shared Demo-key bucket. */
export const COINGECKO_RATE_LIMITER_NAME = "demo";

export class CoinGeckoRateLimiter extends DurableObject {
  private tokens = COINGECKO_BURST_CAPACITY;
  private lastRefillMs = Date.now();

  /**
   * Block until one call slot is available, then consume it.
   * Token math runs under `blockConcurrencyWhile`; sleeping happens outside
   * so other acquire() calls can interleave safely.
   */
  async acquire(): Promise<void> {
    for (;;) {
      const waitMs = await this.ctx.blockConcurrencyWhile(async () => {
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return 0;
        }
        const need = 1 - this.tokens;
        return Math.max(1, Math.ceil(need / REFILL_PER_MS));
      });

      if (waitMs <= 0) return;
      // Cap individual sleeps so a long wait still re-checks state periodically.
      await scheduler.wait(Math.min(waitMs, 5_000));
    }
  }

  /**
   * After an upstream 429, empty the bucket and pause refills until `waitMs`
   * elapses so concurrent callers back off with the server.
   */
  async penalize(waitMs: number): Promise<void> {
    const pause = Math.max(0, Math.floor(waitMs));
    await this.ctx.blockConcurrencyWhile(async () => {
      this.tokens = 0;
      this.lastRefillMs = Date.now() + pause;
    });
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillMs;
    if (elapsed <= 0) return;
    this.tokens = Math.min(
      COINGECKO_BURST_CAPACITY,
      this.tokens + elapsed * REFILL_PER_MS,
    );
    this.lastRefillMs = now;
  }
}

export type CoinGeckoRateLimiterNamespace =
  DurableObjectNamespace<CoinGeckoRateLimiter>;

export type CoinGeckoRateLimiterStub = DurableObjectStub<CoinGeckoRateLimiter>;

export function getCoinGeckoRateLimiter(
  ns: CoinGeckoRateLimiterNamespace,
): CoinGeckoRateLimiterStub {
  return ns.getByName(COINGECKO_RATE_LIMITER_NAME);
}
