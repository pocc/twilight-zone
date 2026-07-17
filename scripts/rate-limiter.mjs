/**
 * Leaky Bucket Rate Limiter for Cloudflare API
 *
 * Cloudflare's default rate limit is 1200 requests per 5 minutes.
 * We target 1000/5min (~3.33 req/sec) to leave headroom for retries and bursts.
 *
 * Algorithm: Token bucket with continuous refill.
 * - Bucket capacity: configurable (default 20 — allows short bursts)
 * - Refill rate: 1000 tokens per 300 seconds = 3.333 tokens/sec
 * - On each request: wait until ≥1 token available, then consume 1 token
 *
 * Also respects Cloudflare's rate limit response headers to dynamically
 * throttle when the server reports low remaining quota.
 */

const DEFAULT_CAPACITY = 20;          // Max burst size
const DEFAULT_RATE_LIMIT = 1000;      // Requests per window
const DEFAULT_WINDOW_SEC = 300;       // 5 minutes

export class LeakyBucketRateLimiter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.capacity]    Max tokens (burst size). Default 20.
   * @param {number} [opts.rateLimit]   Requests per window. Default 1000.
   * @param {number} [opts.windowSec]   Window in seconds. Default 300 (5 min).
   * @param {boolean} [opts.verbose]    Log throttle events. Default false.
   */
  constructor(opts = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.rateLimit = opts.rateLimit ?? DEFAULT_RATE_LIMIT;
    this.windowSec = opts.windowSec ?? DEFAULT_WINDOW_SEC;
    this.verbose = opts.verbose ?? false;

    // Tokens refill at this rate (tokens per millisecond)
    this.refillRateMs = this.rateLimit / (this.windowSec * 1000);

    // Start with a full bucket
    this.tokens = this.capacity;
    this.lastRefill = Date.now();

    // Stats
    this.stats = {
      totalRequests: 0,
      totalWaitMs: 0,
      throttleEvents: 0,
      serverThrottleEvents: 0,
      peakWaitMs: 0,
    };

    // Server-reported remaining quota (updated via updateFromHeaders)
    this._serverRemaining = null;
    this._serverReset = null;
  }

  /**
   * Refill tokens based on elapsed time since last refill.
   * @private
   */
  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed * this.refillRateMs;
    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefill = now;
  }

  /**
   * Wait until a token is available, then consume it.
   * Call this BEFORE every API request.
   *
   * @returns {Promise<{ waited: number }>} How long we waited (ms). 0 if no wait.
   */
  async acquire() {
    this.stats.totalRequests++;
    this._refill();

    // If server reported very low remaining, inject extra delay
    if (this._serverRemaining !== null && this._serverRemaining < 50) {
      const extraDelay = this._serverRemaining < 10 ? 2000 : 500;
      if (this.verbose) {
        console.log(`[rate-limiter] Server reports ${this._serverRemaining} remaining — injecting ${extraDelay}ms delay`);
      }
      this.stats.serverThrottleEvents++;
      await this._sleep(extraDelay);
      this._refill();
    }

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { waited: 0 };
    }

    // Calculate wait time until 1 token is available
    const deficit = 1 - this.tokens;
    const waitMs = Math.ceil(deficit / this.refillRateMs);

    if (this.verbose) {
      console.log(`[rate-limiter] Throttling: waiting ${waitMs}ms (tokens: ${this.tokens.toFixed(2)}, rate: ${(this.refillRateMs * 1000).toFixed(2)}/sec)`);
    }

    this.stats.throttleEvents++;
    this.stats.totalWaitMs += waitMs;
    this.stats.peakWaitMs = Math.max(this.stats.peakWaitMs, waitMs);

    await this._sleep(waitMs);

    this._refill();
    this.tokens = Math.max(0, this.tokens - 1);
    return { waited: waitMs };
  }

  /**
   * Update internal state from Cloudflare response headers.
   * Call this AFTER every API response.
   *
   * Supports both new format (`Ratelimit: "default";r=50;t=30`)
   * and legacy format (`X-Ratelimit-Remaining`, `X-Ratelimit-Reset`).
   *
   * @param {Headers|Record<string, string>} headers
   */
  updateFromHeaders(headers) {
    const get = (name) => {
      if (typeof headers.get === 'function') return headers.get(name);
      // Plain object fallback
      return headers[name] || headers[name.toLowerCase()] || null;
    };

    // New format: Ratelimit: "default";r=50;t=30
    const ratelimitHeader = get('ratelimit');
    if (ratelimitHeader) {
      const rMatch = ratelimitHeader.match(/r=(\d+)/);
      const tMatch = ratelimitHeader.match(/t=(\d+)/);
      if (rMatch) this._serverRemaining = parseInt(rMatch[1], 10);
      if (tMatch) this._serverReset = parseInt(tMatch[1], 10);
    }

    // Legacy headers
    const legacyRemaining = get('x-ratelimit-remaining');
    const legacyReset = get('x-ratelimit-reset');
    if (legacyRemaining) this._serverRemaining = parseInt(legacyRemaining, 10);
    if (legacyReset) this._serverReset = parseInt(legacyReset, 10);
  }

  /**
   * Handle a 429 response. Back off based on server reset time or exponential backoff.
   *
   * @param {number} attempt Current retry attempt (0-indexed)
   * @param {Headers|Record<string, string>} [headers] Response headers
   * @returns {Promise<void>}
   */
  async backoff429(attempt, headers) {
    this.updateFromHeaders(headers || {});

    // Drain tokens to prevent further bursting
    this.tokens = 0;

    let waitMs;
    if (this._serverReset && this._serverReset > 0) {
      // Server told us when the window resets
      waitMs = this._serverReset * 1000 + 500; // +500ms safety margin
    } else {
      // Exponential backoff: 2s, 4s, 8s, 16s
      waitMs = Math.pow(2, attempt + 1) * 1000 + Math.random() * 500;
    }

    if (this.verbose) {
      console.log(`[rate-limiter] 429 backoff: waiting ${(waitMs / 1000).toFixed(1)}s (attempt ${attempt + 1})`);
    }

    this.stats.totalWaitMs += waitMs;
    this.stats.peakWaitMs = Math.max(this.stats.peakWaitMs, waitMs);
    await this._sleep(waitMs);
  }

  /**
   * Get human-readable stats summary.
   * @returns {object}
   */
  getStats() {
    return {
      ...this.stats,
      avgWaitMs: this.stats.throttleEvents > 0
        ? Math.round(this.stats.totalWaitMs / this.stats.throttleEvents)
        : 0,
      effectiveRate: this.stats.totalRequests > 0
        ? `${(this.stats.totalRequests / ((Date.now() - this.lastRefill) / 1000 + 1)).toFixed(2)} req/sec`
        : 'N/A',
      currentTokens: this.tokens.toFixed(2),
      serverRemaining: this._serverRemaining,
    };
  }

  /** @private */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a rate-limited fetch wrapper.
 *
 * Usage:
 *   const { cfRequest } = createRateLimitedFetcher({ authHeaders, verbose: true });
 *   const result = await cfRequest('GET', '/zones/{zone_id}/dns_records');
 *
 * @param {object} opts
 * @param {Record<string, string>} opts.authHeaders
 * @param {string} [opts.cfApi]        Base URL. Default 'https://api.cloudflare.com/client/v4'
 * @param {number} [opts.maxRetries]   Default 3
 * @param {number} [opts.timeoutMs]    Per-request timeout. Default 30000
 * @param {number} [opts.rateLimit]    Requests per window. Default 1000
 * @param {number} [opts.windowSec]    Window seconds. Default 300
 * @param {number} [opts.capacity]     Burst capacity. Default 20
 * @param {boolean} [opts.verbose]     Default false
 * @param {Record<string, string>} [opts.pathVars] Template variables like {zone_id} → actual value
 */
export function createRateLimitedFetcher(opts) {
  const cfApi = opts.cfApi ?? 'https://api.cloudflare.com/client/v4';
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const authHeaders = opts.authHeaders;
  const pathVars = opts.pathVars ?? {};
  const verbose = opts.verbose ?? false;

  const limiter = new LeakyBucketRateLimiter({
    capacity: opts.capacity ?? 20,
    rateLimit: opts.rateLimit ?? 1000,
    windowSec: opts.windowSec ?? 300,
    verbose,
  });

  /**
   * Make a rate-limited Cloudflare API request.
   *
   * @param {string} method  HTTP method
   * @param {string} pathTemplate  Path with optional {var} placeholders
   * @param {any} [body]  JSON body (will be stringified)
   * @returns {Promise<{ ok: boolean, status: number, data: any, url: string }>}
   */
  async function cfRequest(method, pathTemplate, body) {
    // Expand path template variables
    let urlPath = pathTemplate;
    for (const [key, value] of Object.entries(pathVars)) {
      urlPath = urlPath.replaceAll(`{${key}}`, value);
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Wait for rate limit token
      await limiter.acquire();

      if (attempt > 0 && verbose) {
        console.log(`[rate-limiter] Retry ${attempt}/${maxRetries} for ${method} ${urlPath}`);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let response;
      try {
        response = await fetch(`${cfApi}${urlPath}`, {
          method,
          signal: controller.signal,
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        clearTimeout(timeout);
        if (attempt < maxRetries) {
          const backoff = Math.pow(2, attempt + 1) * 1000 + Math.random() * 500;
          if (verbose) {
            console.log(`[rate-limiter] Network error on ${method} ${urlPath} — retry in ${(backoff / 1000).toFixed(1)}s: ${err.message}`);
          }
          await limiter._sleep(backoff);
          continue;
        }
        return { ok: false, status: 0, data: { success: false, errors: [{ message: err.message }] }, url: `${cfApi}${urlPath}` };
      } finally {
        clearTimeout(timeout);
      }

      // Update limiter from response headers
      limiter.updateFromHeaders(response.headers);

      // Handle 429 with proper backoff
      if (response.status === 429 && attempt < maxRetries) {
        await limiter.backoff429(attempt, response.headers);
        continue;
      }

      // Handle server errors with retry
      if (response.status >= 500 && response.status < 600 && attempt < maxRetries) {
        const backoff = Math.pow(2, attempt + 1) * 1000 + Math.random() * 500;
        if (verbose) {
          console.log(`[rate-limiter] Server error ${response.status} on ${method} ${urlPath} — retry in ${(backoff / 1000).toFixed(1)}s`);
        }
        await limiter._sleep(backoff);
        continue;
      }

      let data;
      try {
        data = await response.json();
      } catch {
        data = { success: false, errors: [{ message: 'non-json response' }] };
      }

      return {
        ok: response.ok && data?.success !== false,
        status: response.status,
        data,
        url: `${cfApi}${urlPath}`,
      };
    }

    // Should not reach here, but safety net
    return { ok: false, status: 0, data: { success: false, errors: [{ message: 'max retries exceeded' }] }, url: '' };
  }

  return {
    cfRequest,
    limiter,
    getStats: () => limiter.getStats(),
  };
}
