import type {
  CFZone, CFDNSRecord, CFZoneSetting, CFPageRule, CFRuleset,
  CFWorkerScript, CFWorkerRoute, CFWorkerCustomDomain, CFLoadBalancer, CFPool, CFMonitor,
  CFSpectrumApp, CFCustomCertificate, CFCustomHostname, CFAccessApp,
  CFAccessPolicy, CFFirewallRule, CFRateLimit, CFWorkerBinding,
  CFEmailRoutingRule, CFWaitingRoom, CFZarazConfig, CFTurnstileWidget,
  CFKVNamespace, CFKVKey, CFR2Bucket, CFD1Database, CFQueue, CFDurableObjectNamespace,
  CFWorkerScriptFormat,
  CFR2CorsRule, CFR2LifecycleRule, CFR2ManagedDomain,
  CFR2CustomDomain, CFR2BucketLock,
  CFPagesProject,
  CFAiGateway, CFAiGatewayCustomProvider,
  CFOriginCaCertificate, OriginCaCertificateInput,
} from './types';

// [R1] Export CF_API so other modules can reference it instead of duplicating the URL
export const CF_API = 'https://api.cloudflare.com/client/v4';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

// [C7] Default timeout for cfFetch calls (30 seconds)
const CF_FETCH_TIMEOUT_MS = 30_000;

// Pagination configuration
const DEFAULT_PAGE_SIZE = 50;

// Concurrency limit to avoid rate limiting (1200 req/5min = 4 req/sec)
const MAX_CONCURRENT_REQUESTS = 10;

// [W23] Cap audit log to prevent unbounded memory growth
const MAX_AUDIT_LOG_SIZE = 5000;

// Audit log for recording API calls
export interface AuditLogEntry {
  timestamp: string;
  method: string;
  path: string;
  status: 'success' | 'error' | 'retry';
  statusCode?: number;
  error?: string;
  duration?: number;
}

// [C1+C2] Per-request context to isolate state across concurrent requests.
// Module-level globals are kept as fallback for callers that don't pass context.
export interface RequestContext {
  auditLog: AuditLogEntry[];
  rateLimitInfo: RateLimitInfo;
}

export function createRequestContext(): RequestContext {
  return {
    auditLog: [],
    rateLimitInfo: { remaining: 1200, limit: 1200, reset: 0, lastUpdated: '' },
  };
}

// Module-level fallback state (used when callers don't provide a RequestContext)
let auditLog: AuditLogEntry[] = [];

export function getAuditLog(ctx?: RequestContext): AuditLogEntry[] {
  return [...(ctx ? ctx.auditLog : auditLog)];
}

export function clearAuditLog(ctx?: RequestContext): void {
  if (ctx) {
    ctx.auditLog = [];
  } else {
    auditLog = [];
  }
}

function logApiCall(entry: Omit<AuditLogEntry, 'timestamp'>, ctx?: RequestContext): void {
  const log = ctx ? ctx.auditLog : auditLog;
  log.push({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  // [W23] Prevent unbounded growth — drop oldest entries when cap exceeded
  if (log.length > MAX_AUDIT_LOG_SIZE) {
    log.splice(0, log.length - MAX_AUDIT_LOG_SIZE);
  }
}

// Rate limit tracking
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  reset: number;
  lastUpdated: string;
}

let rateLimitInfo: RateLimitInfo = { remaining: 1200, limit: 1200, reset: 0, lastUpdated: '' };

export function getRateLimitInfo(ctx?: RequestContext): RateLimitInfo {
  return { ...(ctx ? ctx.rateLimitInfo : rateLimitInfo) };
}

function updateRateLimitFromHeaders(headers: Headers, ctx?: RequestContext): void {
  const rl = ctx ? ctx.rateLimitInfo : rateLimitInfo;
  // Try new Cloudflare header format first: Ratelimit: "default";r=50;t=30
  const ratelimitHeader = headers.get('ratelimit');
  if (ratelimitHeader) {
    const remainingMatch = ratelimitHeader.match(/r=(\d+)/);
    const resetMatch = ratelimitHeader.match(/t=(\d+)/);
    if (remainingMatch) rl.remaining = parseInt(remainingMatch[1], 10);
    if (resetMatch) rl.reset = parseInt(resetMatch[1], 10);
  }
  
  // Parse Ratelimit-Policy for total quota: "burst";q=100;w=60
  const policyHeader = headers.get('ratelimit-policy');
  if (policyHeader) {
    const quotaMatch = policyHeader.match(/q=(\d+)/);
    if (quotaMatch) rl.limit = parseInt(quotaMatch[1], 10);
  }
  
  // Fall back to legacy headers for backwards compatibility
  const remaining = headers.get('x-ratelimit-remaining');
  const limit = headers.get('x-ratelimit-limit');
  const reset = headers.get('x-ratelimit-reset');
  
  if (remaining) rl.remaining = parseInt(remaining, 10);
  if (limit) rl.limit = parseInt(limit, 10);
  if (reset) rl.reset = parseInt(reset, 10);
  rl.lastUpdated = new Date().toISOString();
}

// Auth can be either a Bearer token or API Key + Email
export type ApiAuth = 
  | { type: 'token'; token: string }
  | { type: 'key'; apiKey: string; email: string };

export function createAuth(token: string, apiKey?: string, email?: string): ApiAuth {
  if (apiKey && email) {
    return { type: 'key', apiKey, email };
  }
  return { type: 'token', token };
}

export function getAuthHeaders(auth: ApiAuth): Record<string, string> {
  if (auth.type === 'key') {
    return {
      'X-Auth-Key': auth.apiKey,
      'X-Auth-Email': auth.email,
    };
  }
  return {
    'Authorization': `Bearer ${auth.token}`,
  };
}

export function isRetryableError(status: number, errorMessage: string): boolean {
  if (status === 429) return true; // Rate limited
  if (status >= 500 && status < 600) return true; // Server errors
  if (errorMessage.includes('rate limit')) return true;
  if (errorMessage.includes('too many requests')) return true;
  return false;
}

// A single entry in a Cloudflare API `errors[]` array. Cloudflare wraps the
// real diagnostic for malformed-credential failures in `error_chain` while the
// top-level `message` stays the unhelpful generic "Invalid request headers"
// (code 6003) — so callers MUST look at `code` and `error_chain`, not just
// `message`, to know what actually went wrong.
export interface CFApiError {
  code?: number;
  message?: string;
  error_chain?: { code?: number; message?: string }[];
}

/**
 * Translate a Cloudflare authentication failure into a clear, actionable, and
 * auth-mode-correct message. Returns null when the envelope is NOT an auth
 * failure (so the caller falls back to the raw API message).
 *
 * Cloudflare's raw auth errors are cryptic and, for the most common cases,
 * actively misleading: a bad API token, a bad Global API Key, and a bad email
 * ALL surface the same generic top-level "Invalid request headers" (code 6003)
 * — the distinguishing detail only lives in `error_chain`. This maps every
 * verified shape to a message that names the real problem and the fix.
 *
 * Verified against the live API 2026-06 (api.cloudflare.com/client/v4):
 *   token, malformed charset → 6003 + chain 6111 "Invalid format for Authorization header"
 *   token, wrong value       → 9109 "Invalid access token" / 1000 "Invalid API Token"
 *   key,   malformed         → 6003 + chain 6103 "Invalid format for X-Auth-Key header"
 *   email, malformed         → 6003 + chain 6102 "Invalid format for X-Auth-Email header"
 *   key/email, wrong value   → 9103 "Unknown X-Auth-Key or X-Auth-Email"
 *   missing headers          → 9106 / 9107 "Missing X-Auth-* header"
 *
 * This is translation, not masking (AGENTS.md §7 debugging integrity): the
 * upstream status is reported accurately, just in language the user can act on.
 */
export function humanizeAuthError(
  errors: CFApiError[] | undefined,
  authType: 'token' | 'key',
): string | null {
  if (!errors || errors.length === 0) return null;

  // Collect every code from the top level AND the error_chain — the actionable
  // code for 6003 "Invalid request headers" only appears in the chain.
  const codes = new Set<number>();
  for (const e of errors) {
    if (typeof e.code === 'number') codes.add(e.code);
    for (const c of e.error_chain || []) {
      if (typeof c.code === 'number') codes.add(c.code);
    }
  }
  if (codes.size === 0) return null;

  if (authType === 'token') {
    if (codes.has(6111) || codes.has(6003)) {
      return 'Invalid API token: the token is malformed or contains invalid characters. Copy the full token from the Cloudflare dashboard under My Profile → API Tokens.';
    }
    if (codes.has(1000) || codes.has(9109) || codes.has(10000) || codes.has(9106) || codes.has(9107)) {
      return 'Invalid API token: Cloudflare rejected this token. It may be incorrect, expired, or revoked. Create or copy a valid token under My Profile → API Tokens.';
    }
    return null;
  }

  // authType === 'key'
  const badEmailFormat = codes.has(6102);
  const badKeyFormat = codes.has(6103);
  if (badEmailFormat && badKeyFormat) {
    return 'Invalid credentials: both the account email and the Global API Key are malformed. Enter the email for your Cloudflare account and the key from My Profile → API Tokens → Global API Key.';
  }
  if (badEmailFormat) {
    return 'Invalid account email: the email address is malformed. Enter the email associated with your Cloudflare account.';
  }
  if (badKeyFormat || codes.has(6003)) {
    return 'Invalid API key: the Global API Key is malformed. Copy the full key from My Profile → API Tokens → Global API Key.';
  }
  if (codes.has(9107)) {
    return 'Missing API key: enter your Global API Key (My Profile → API Tokens → Global API Key).';
  }
  if (codes.has(9106)) {
    return 'Missing account email: enter the email associated with your Cloudflare account.';
  }
  if (codes.has(9103) || codes.has(10000)) {
    return 'Invalid API key or email: Cloudflare did not recognize this Global API Key and email combination. Verify both under My Profile → API Tokens → Global API Key.';
  }
  return null;
}

/**
 * Many zone-resource list endpoints return an error rather than an empty
 * array when the zone hasn't configured / isn't entitled for the feature.
 * For export-side reads, these are NOT fatal — the caller wants "nothing
 * to migrate", not a halted export. Matches the common variants of the
 * "this resource isn't configured" family of error messages.
 *
 * Lowercase the input before calling.
 */
export function isExportTolerable(lowercaseMessage: string): boolean {
  if (!lowercaseMessage) return false;
  if (
    (lowercaseMessage.includes('forbidden') || lowercaseMessage.includes('permission')) &&
    !lowercaseMessage.includes('not entitled') &&
    !lowercaseMessage.includes('not available') &&
    !lowercaseMessage.includes('not included in your plan') &&
    !lowercaseMessage.includes('plan') &&
    !lowercaseMessage.includes('subscription')
  ) {
    return false;
  }
  return (
    lowercaseMessage.includes('not found') ||
    lowercaseMessage.includes('not entitled') ||
    lowercaseMessage.includes('not enabled') ||
    lowercaseMessage.includes('not available') ||
    lowercaseMessage.includes('does not exist') ||
    lowercaseMessage.includes('could not find entrypoint ruleset') ||
    // "Could not route to <path>, perhaps your object identifier is invalid?"
    // is Cloudflare's response when an endpoint/sub-feature isn't applicable to
    // this zone (e.g. cache/origin_cloud_regions on a zone without origin cloud
    // regions). Nothing to export — benign, not an outage.
    lowercaseMessage.includes('could not route to') ||
    lowercaseMessage.includes('object identifier is invalid') ||
    // Secondary DNS incoming/outgoing on a zone that was never linked to a peer.
    lowercaseMessage.includes('has not been linked to a peer') ||
    // Plan-restriction family. CF returns these when the zone's plan
    // doesn't include the feature — there's nothing to export, but
    // the API still surfaces it as an error. Examples:
    //   - "Plan level does not allow custom certificates with type "
    //     (code 1011, /zones/:id/custom_certificates)
    //   - "Plan does not allow ..." (various endpoints)
    //   - "Your plan does not include ..."
    //   - "Upgrade your plan to access this feature"
    //   - "Feature not enabled on this plan"
    lowercaseMessage.includes('plan level does not allow') ||
    lowercaseMessage.includes('plan does not allow') ||
    lowercaseMessage.includes('plan does not include') ||
    lowercaseMessage.includes('your plan does not') ||
    lowercaseMessage.includes('upgrade your plan') ||
    lowercaseMessage.includes('not included in your plan') ||
    lowercaseMessage.includes('not enabled on this plan')
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Concurrency limiter for batch operations - prevents overwhelming the API
export async function batchWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = MAX_CONCURRENT_REQUESTS
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((item, j) => fn(item, i + j))
    );
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Thrown by `cfFetch` when Cloudflare returns an unsuccessful envelope
 * (`{ success: false }`) carrying NO `errors[]` and NO `messages[]` — the
 * bare empty-envelope response an unprovisioned / unentitled feature returns
 * (e.g. Secondary DNS on a non-Enterprise dest zone). Kept DISTINCT from a
 * transient server failure (which surfaces as `"API request failed after
 * retries"`) so callers can classify an entitlement gap precisely via
 * `instanceof` + a 4xx status, instead of substring-matching the generic
 * `"API request failed"` message (which also matches the retry-exhaustion
 * string and would mask real outages). The `.message` stays "API request
 * failed" so report display is unchanged.
 */
export class EmptyEnvelopeError extends Error {
  readonly _tag = 'EmptyEnvelopeError' as const;
  constructor(public readonly requestPath: string, public readonly status: number) {
    super('API request failed');
    this.name = 'EmptyEnvelopeError';
  }
}

/**
 * Thrown by `cfFetch` / `cfFetchAll` when Cloudflare rejected the request's
 * CREDENTIALS (bad/expired token, malformed or unknown Global API Key, bad
 * email, missing auth headers). The `.message` is the humanized, auth-mode-
 * correct text from `humanizeAuthError`. Callers (e.g. the migration blocker
 * check) use `instanceof AuthError` to render a credential-specific title and
 * resolution instead of mislabeling a bad key as a "cannot access zone /
 * missing permission" problem.
 */
export class AuthError extends Error {
  readonly _tag = 'AuthError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

async function cfFetch<T>(auth: ApiAuth | string, path: string, options: RequestInit = {}, ctx?: RequestContext): Promise<T> {
  // Support legacy string token for backwards compatibility
  const authObj: ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;
  const method = options.method || 'GET';
  const startTime = Date.now();
  let lastError: Error | null = null;
  
  // Verbose logging: log outgoing request
  const authType = authObj.type === 'key' ? 'API-Key' : 'Bearer';
  console.log(`[CF-API] → ${method} ${path} (auth: ${authType})`);
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.log(`[CF-API] ↻ Retry ${attempt}/${MAX_RETRIES} for ${method} ${path} (waiting ${delay}ms)`);
      logApiCall({ method, path, status: 'retry', duration: Date.now() - startTime }, ctx);
      await sleep(delay);
    }

    // [C7] Wrap fetch with AbortController timeout to prevent hanging requests
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CF_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${CF_API}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          ...getAuthHeaders(authObj),
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const err = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      if (err.name === 'AbortError') {
        lastError = new Error(`Request timed out after ${CF_FETCH_TIMEOUT_MS}ms: ${method} ${path}`);
      } else {
        lastError = err;
      }
      if (attempt === MAX_RETRIES) {
        logApiCall({ method, path, status: 'error', error: lastError.message, duration: Date.now() - startTime }, ctx);
        throw lastError;
      }
      continue;
    } finally {
      clearTimeout(timeout);
    }

    // Track rate limits from response headers
    updateRateLimitFromHeaders(res.headers, ctx);

    // [C8] Handle non-JSON responses gracefully
    let data: {
      success: boolean;
      result: T;
      errors: CFApiError[];
      messages?: { message: string; code?: number }[];
    };
    try {
      data = await res.json() as typeof data;
    } catch {
      // Response body is not valid JSON
      const bodySnippet = await res.text().catch(() => '(unreadable body)');
      const snippet = bodySnippet.slice(0, 200);
      if (isRetryableError(res.status, '') && attempt < MAX_RETRIES) {
        lastError = new Error(`Non-JSON response (HTTP ${res.status}): ${snippet}`);
        continue; // retry
      }
      const duration = Date.now() - startTime;
      const errorMessage = `Non-JSON response (HTTP ${res.status}): ${snippet}`;
      logApiCall({ method, path, status: 'error', statusCode: res.status, error: errorMessage, duration }, ctx);
      throw new Error(errorMessage);
    }

    const duration = Date.now() - startTime;
    
    if (data.success) {
      console.log(`[CF-API] ✓ ${method} ${path} → ${res.status} (${duration}ms)`);
      logApiCall({ method, path, status: 'success', statusCode: res.status, duration }, ctx);
      return data.result;
    }

    // Cloudflare often returns a generic top-level error ("Bad Request") while
    // the meaningful diagnostic lives in `messages[]` (e.g. "A fraud detection
    // subscription is required"). Surface both so downstream pattern matchers
    // (isAcknowledgeableSingletonError, isManualActionError) can classify
    // entitlement gaps correctly instead of treating them as opaque failures.
    //
    // When the primary is a generic HTTP status string (Bad Request, Forbidden,
    // Not Found, Unauthorized) AND there's a meaningful secondary message,
    // drop the generic prefix — it adds noise to the report ("Bad Request —
    // A fraud detection subscription is required" reads worse than just the
    // subscription message). The pattern matchers don't depend on the prefix.
    const GENERIC_HTTP_STATUSES = new Set([
      'bad request', 'forbidden', 'not found', 'unauthorized',
      'internal server error', 'service unavailable', 'gateway timeout',
    ]);
    const errParts: string[] = [];
    // Cryptic, often-misleading credential failures (e.g. a bad token, key, or
    // email all surface the generic top-level "Invalid request headers") get
    // translated into a clear, auth-mode-correct message. This is the single
    // choke point where the full envelope (code + error_chain) is available,
    // so fixing it here covers every caller: blockers, token validation,
    // account/zone dropdowns, export, and migrate.
    const authMessage = humanizeAuthError(data.errors, authObj.type);
    const primary = authMessage || data.errors?.[0]?.message;
    const secondaryMessages = authMessage
      ? [] // the humanized message is self-contained; don't append CF jargon
      : (data.messages || [])
          .map(m => m.message)
          .filter((m): m is string => !!m && m !== primary);
    const primaryIsGeneric = primary && GENERIC_HTTP_STATUSES.has(primary.toLowerCase().trim());
    if (primary && !(primaryIsGeneric && secondaryMessages.length > 0)) {
      errParts.push(primary);
    }
    errParts.push(...secondaryMessages);
    // Empty envelope (success:false, no errors[], no messages[]) → throw the
    // tagged EmptyEnvelopeError carrying the status, so callers can tell an
    // entitlement gap (4xx) apart from a transient server failure (5xx) and
    // from retry-exhaustion. Otherwise a plain Error with the real message.
    const errorMessage = errParts.length > 0 ? errParts.join(' — ') : 'API request failed';
    lastError = authMessage
      ? new AuthError(errorMessage)
      : errParts.length > 0 ? new Error(errorMessage) : new EmptyEnvelopeError(path, res.status);

    if (!isRetryableError(res.status, errorMessage) || attempt === MAX_RETRIES) {
      console.log(`[CF-API] ✗ ${method} ${path} → ${res.status} "${errorMessage}" (${duration}ms)`);
      logApiCall({ method, path, status: 'error', statusCode: res.status, error: errorMessage, duration }, ctx);
      throw lastError;
    }
  }

  throw lastError || new Error('API request failed after retries');
}

interface PaginatedResponse<T> {
  success: boolean;
  result: T[];
  result_info?: { total_pages: number };
  errors: CFApiError[];
}

async function cfFetchAll<T>(auth: ApiAuth | string, path: string): Promise<T[]> {
  const authObj: ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;
  const results: T[] = [];
  let page = 1;
  const perPage = DEFAULT_PAGE_SIZE;
  const authType = authObj.type === 'key' ? 'API-Key' : 'Bearer';
  const startTime = Date.now();

  console.log(`[CF-API] → GET ${path} (paginated, auth: ${authType})`);

  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    let lastError: Error | null = null;
    let data: PaginatedResponse<T> | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[CF-API] ↻ Retry ${attempt}/${MAX_RETRIES} for GET ${path} page ${page}`);
        await sleep(delay);
      }

      const res = await fetch(`${CF_API}${path}${separator}page=${page}&per_page=${perPage}`, {
        headers: {
          ...getAuthHeaders(authObj),
          'Content-Type': 'application/json',
        },
      });

      // Track rate limits from paginated responses too
      updateRateLimitFromHeaders(res.headers);

      data = await res.json() as PaginatedResponse<T>;

      if (data.success) {
        console.log(`[CF-API] ✓ GET ${path} page ${page} → ${res.status} (${data.result.length} items)`);
        break;
      }

      const authMessage = humanizeAuthError(data.errors, authObj.type);
      const errorMessage = authMessage || data.errors?.[0]?.message || 'API request failed';
      lastError = authMessage ? new AuthError(errorMessage) : new Error(errorMessage);

      if (!isRetryableError(res.status, errorMessage) || attempt === MAX_RETRIES) {
        console.log(`[CF-API] ✗ GET ${path} page ${page} → ${res.status} "${errorMessage}"`);
        throw lastError;
      }
    }

    if (!data || !data.success) {
      throw lastError || new Error('API request failed after retries');
    }

    results.push(...data.result);

    // Stop pagination if:
    // 1. No result_info (single page)
    // 2. Reached total_pages
    // 3. First page returned 0 items (nothing to paginate)
    // 4. Current page returned 0 items (no more data)
    if (!data.result_info || page >= data.result_info.total_pages || data.result.length === 0) {
      break;
    }
    page++;
  }

  console.log(`[CF-API] ✓ GET ${path} complete: ${results.length} total items (${Date.now() - startTime}ms)`);
  return results;
}

// Token Validation APIs
export interface TokenVerifyResult {
  valid: boolean;
  status: string;
  expires_on?: string;
  error?: string; // [W7] Error details for network failures vs invalid tokens
}

// [W7] Distinguish network/timeout errors from genuinely invalid tokens
export async function verifyToken(token: string): Promise<TokenVerifyResult> {
  try {
    const result = await cfFetch<TokenVerifyResult>(token, '/user/tokens/verify');
    return { ...result, valid: true };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    // Network/timeout errors should surface differently than "invalid token"
    if (err.name === 'AbortError' || err.message.includes('timed out') || err.message.includes('fetch failed') || err.message.includes('network')) {
      return { valid: false, status: 'network_error', error: err.message };
    }
    return { valid: false, status: 'invalid', error: err.message };
  }
}

export interface AccountInfo {
  id: string;
  name: string;
}

export async function listAccounts(auth: ApiAuth | string): Promise<AccountInfo[]> {
  return cfFetchAll<AccountInfo>(auth, '/accounts');
}

// Alias for backwards compatibility
export const listAccountsWithAuth = listAccounts;

export async function listAccountZones(auth: ApiAuth | string, accountId: string): Promise<CFZone[]> {
  return cfFetchAll<CFZone>(auth, `/zones?account.id=${accountId}`);
}

// Alias for backwards compatibility
export const listAccountZonesWithAuth = listAccountZones;

// Permission check - verify token has required permissions
export interface PermissionCheckResult {
  valid: boolean;
  missingPermissions: string[];
  checkedPermissions: { permission: string; ok: boolean }[];
}

export async function checkPermissions(auth: ApiAuth | string, zoneId: string, accountId: string, isSource: boolean): Promise<PermissionCheckResult> {
  const checks: { permission: string; ok: boolean }[] = [];
  const missing: string[] = [];

  // [R14] Include error details in permission check results for better diagnostics
  // Check zone read (required for both source and dest)
  try {
    await cfFetch<CFZone>(auth, `/zones/${zoneId}`);
    checks.push({ permission: 'Zone:Read', ok: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    checks.push({ permission: 'Zone:Read', ok: false });
    missing.push(`Zone:Read (${detail})`);
  }

  // Check DNS read
  try {
    await cfFetch<CFDNSRecord[]>(auth, `/zones/${zoneId}/dns_records?per_page=1`);
    checks.push({ permission: 'DNS:Read', ok: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    checks.push({ permission: 'DNS:Read', ok: false });
    missing.push(`DNS:Read (${detail})`);
  }

  // For destination, check WRITE permissions
  if (!isSource) {
    // Check Zone Settings read (needed before write)
    try {
      await cfFetch<CFZoneSetting[]>(auth, `/zones/${zoneId}/settings`);
      checks.push({ permission: 'Zone Settings:Read', ok: true });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      checks.push({ permission: 'Zone Settings:Read', ok: false });
      missing.push(`Zone Settings:Read (${detail})`);
    }

    // Check account-level write access by verifying we can list workers (implies account access)
    try {
      await cfFetch<CFWorkerScript[]>(auth, `/accounts/${accountId}/workers/scripts?per_page=1`);
      checks.push({ permission: 'Account Workers:Read', ok: true });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      checks.push({ permission: 'Account Workers:Read', ok: false });
      missing.push(`Account Workers:Read (${detail})`);
    }

    // Check zone creation permission by verifying account membership with write role
    try {
      const accounts = await cfFetch<{ id: string; name: string }[]>(auth, '/accounts');
      const hasAccount = accounts.some(a => a.id === accountId);
      if (hasAccount) {
        checks.push({ permission: 'Account:Write', ok: true });
      } else {
        checks.push({ permission: 'Account:Write', ok: false });
        missing.push('Account:Write (account not accessible)');
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      checks.push({ permission: 'Account:Write', ok: false });
      missing.push(`Account:Write (${detail})`);
    }
  }

  return {
    valid: missing.length === 0,
    missingPermissions: missing,
    checkedPermissions: checks,
  };
}

// Migration Blocker detection
export interface MigrationBlocker {
  type: 'error' | 'warning';
  code: string;
  title: string;
  message: string;
  resolution: string;
  docsUrl?: string;
}

export interface MigrationBlockerResult {
  canProceed: boolean;
  blockers: MigrationBlocker[];
}

export async function checkMigrationBlockers(
  sourceAuth: ApiAuth | string,
  destAuth: ApiAuth | string,
  sourceZoneId: string,
  sourceAccountId: string,
  destAccountId: string,
  domainName?: string
): Promise<MigrationBlockerResult> {
  const blockers: MigrationBlocker[] = [];
  let zoneName = domainName || '';

  // 1. Check source zone access and get zone name
  try {
    const zone = await cfFetch<CFZone>(sourceAuth, `/zones/${sourceZoneId}`);
    zoneName = domainName || zone.name;
    
    // Check if zone is pending deletion
    if (zone.status === 'pending' || zone.status === 'initializing') {
      blockers.push({
        type: 'warning',
        code: 'ZONE_PENDING',
        title: 'Zone Status Pending',
        message: `Source zone status is "${zone.status}"`,
        resolution: 'Wait for zone to become active before migrating',
      });
    }
  } catch (e) {
    const err = e as Error;
    const isAuth = e instanceof AuthError;
    blockers.push({
      type: 'error',
      code: isAuth ? 'INVALID_CREDENTIALS' : 'SOURCE_ACCESS',
      title: isAuth ? 'Invalid API Credentials' : 'Cannot Access Source Zone',
      message: err.message,
      resolution: isAuth
        ? 'Re-enter valid source credentials above — the token or API key was rejected by Cloudflare.'
        : 'Check that your API credentials have Zone:Read permission on the source account',
    });
    return { canProceed: false, blockers };
  }

  // 2. Check destination account access
  try {
    await cfFetch<{ id: string }[]>(destAuth, '/accounts');
  } catch (e) {
    const err = e as Error;
    const isAuth = e instanceof AuthError;
    blockers.push({
      type: 'error',
      code: isAuth ? 'INVALID_DEST_CREDENTIALS' : 'DEST_ACCESS',
      title: isAuth ? 'Invalid Destination API Credentials' : 'Cannot Access Destination Account',
      message: err.message,
      resolution: isAuth
        ? 'Re-enter valid destination credentials above — the token or API key was rejected by Cloudflare.'
        : 'Check that your API credentials have account access on the destination',
    });
    return { canProceed: false, blockers };
  }

  // 3. Check if zone already exists in destination account
  if (zoneName) {
    try {
      const existingZones = await cfFetch<CFZone[]>(destAuth, `/zones?name=${zoneName}&account.id=${destAccountId}`);
      if (existingZones && existingZones.length > 0) {
        blockers.push({
          type: 'warning',
          code: 'ZONE_EXISTS',
          title: 'Zone Already Exists',
          message: `Migration will overwrite existing "${zoneName}" zone in destination account`,
          resolution: 'Existing zone resources will be updated. New resources will be created alongside existing ones.',
        });
      }
    } catch (e) {
      // [W6] Log warning instead of silently swallowing
      blockers.push({
        type: 'warning',
        code: 'ZONE_LOOKUP_FAILED',
        title: 'Zone Lookup Failed',
        message: `Could not check if zone already exists in destination: ${(e as Error).message}`,
        resolution: 'Migration will proceed — existing resources may conflict.',
      });
    }
  }

  // 4. Check DNSSEC status on source
  try {
    const dnssec = await cfFetch<{ status: string }>(sourceAuth, `/zones/${sourceZoneId}/dnssec`);
    if (dnssec.status === 'active') {
      blockers.push({
        type: 'warning',
        code: 'DNSSEC_ENABLED',
        title: 'DNSSEC Enabled',
        message: 'DNSSEC is enabled on source zone and must be reconfigured after migration',
        resolution: '1. Disable DNSSEC on source\n2. Remove DS record from registrar\n3. Migrate zone\n4. Re-enable DNSSEC on destination',
        docsUrl: 'https://developers.cloudflare.com/dns/dnssec/',
      });
    }
  } catch (e) {
    // [W6] Log warning instead of silently swallowing
    blockers.push({
      type: 'warning',
      code: 'DNSSEC_CHECK_FAILED',
      title: 'DNSSEC Check Failed',
      message: `Could not check DNSSEC status: ${(e as Error).message}`,
      resolution: 'Verify DNSSEC status manually before migrating.',
    });
  }

  // [W26] Note: This blocker check intentionally re-fetches workers and zone settings that
  // exportZone also fetches. This is a lightweight pre-flight check; the full export fetches
  // all resource data. Deduplication would require coupling the two flows.

  // 5. Worker secrets are intentionally NOT surfaced here. They are write-only
  //    (cannot be exported) and are handled as an explicit acknowledgement in
  //    Step 2 via the `worker_secrets` IMPOSSIBLE_TO_MIGRATE entry (category
  //    cryptographic, actionable), which offers an inline fix-it (re-supply the
  //    values in Step 3) OR an acknowledge-it-won't-migrate path. A duplicate
  //    pre-flight warning here would re-alarm the user about something the
  //    acknowledgement flow already owns (Principle 4 / Principle 6).

  // 6. Enterprise-gated zone settings (prefetch_preload, response_buffering,
  //    true_client_ip_header, …) are intentionally NOT surfaced here. A Step 1
  //    pre-flight warning cannot know the destination plan (the dest zone may
  //    not exist yet) and only re-alarmed the user about something the migrate
  //    engine already handles: these settings are auto-acknowledged when the
  //    dest can't edit them (isAcknowledgeableSingletonError, see
  //    src/migrate/errors.ts + test/errors.test.ts). The proactive disclosure
  //    now lives in the Step 2 acknowledgment flow, which can compare the
  //    source-enabled settings against the selected destination plan
  //    (Principle 2 / Principle 4).

  const hasErrors = blockers.some(b => b.type === 'error');
  return {
    canProceed: !hasErrors,
    blockers,
  };
}

// Conflict detection - check if zone has existing resources
export interface ConflictCheckResult {
  hasConflicts: boolean;
  conflicts: { resource: string; count: number }[];
  /** Per-probe failure messages. When non-empty, the conflict check was
   * INCOMPLETE — `hasConflicts: false` then means "no conflicts among the
   * probes that succeeded", NOT "definitely no conflicts". Callers must treat
   * a result with warnings as "unknown" and not silently proceed with an
   * overwrite. Empty when every probe ran cleanly. */
  warnings: string[];
  /** True when one or more conflict probes failed (i.e. warnings.length > 0).
   * Convenience flag so callers don't have to inspect `warnings`. */
  checkIncomplete: boolean;
}

export async function checkZoneConflicts(token: string, zoneId: string): Promise<ConflictCheckResult> {
  const conflicts: { resource: string; count: number }[] = [];
  const warnings: string[] = [];
  
  try {
    // [W13] Log which resource type failed instead of silently catching
    const [dns, pageRules, workerRoutes] = await Promise.all([
      cfFetch<CFDNSRecord[]>(token, `/zones/${zoneId}/dns_records?per_page=1`)
        .catch((e) => { warnings.push(`DNS Records check failed: ${(e as Error).message}`); return []; }),
      cfFetch<CFPageRule[]>(token, `/zones/${zoneId}/pagerules?per_page=1`)
        .catch((e) => { warnings.push(`Page Rules check failed: ${(e as Error).message}`); return []; }),
      cfFetch<CFWorkerRoute[]>(token, `/zones/${zoneId}/workers/routes`)
        .catch((e) => { warnings.push(`Worker Routes check failed: ${(e as Error).message}`); return []; }),
    ]);
    
    if (Array.isArray(dns) && dns.length > 0) conflicts.push({ resource: 'DNS Records', count: dns.length });
    if (Array.isArray(pageRules) && pageRules.length > 0) conflicts.push({ resource: 'Page Rules', count: pageRules.length });
    if (Array.isArray(workerRoutes) && workerRoutes.length > 0) conflicts.push({ resource: 'Worker Routes', count: workerRoutes.length });
  } catch (e) {
    // [W9] Only expected when zone doesn't exist yet; log for other cases
    console.log(`[CF-API] Zone conflict check failed for ${zoneId}: ${(e as Error).message}`);
  }

  if (warnings.length > 0) {
    console.log(`[CF-API] Zone conflict check warnings: ${warnings.join('; ')}`);
  }

  // Surface `warnings`/`checkIncomplete` to callers: a probe failure (token
  // scope, 429) previously got buried in a console.log while `hasConflicts`
  // returned a confident `false` — which could let an overwrite proceed as if
  // the dest were known-empty. Now callers can tell "no conflicts" apart from
  // "couldn't check".
  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    warnings,
    checkIncomplete: warnings.length > 0,
  };
}

// Zone APIs
export async function getZone(auth: ApiAuth | string, zoneId: string): Promise<CFZone> {
  return cfFetch<CFZone>(auth, `/zones/${zoneId}`);
}

export async function createZone(auth: ApiAuth | string, accountId: string, name: string): Promise<CFZone> {
  // Backtick (template literal) not single-quote so the coverage
  // extractor in scripts/extract-tz-coverage.mjs picks up the path.
  return cfFetch<CFZone>(auth, `/zones`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      account: { id: accountId },
      type: 'full',
    }),
  });
}

export async function listZones(auth: ApiAuth | string, name: string): Promise<CFZone[]> {
  return cfFetch<CFZone[]>(auth, `/zones?name=${encodeURIComponent(name)}`);
}

export interface CreateZoneResult {
  zone: CFZone;
  /** Nameservers assigned to the new zone (used for delegation). */
  nameServers: string[];
  /** True when NS records were created in the parent zone. */
  delegated: boolean;
  /** Raw delegation error message when delegation was attempted but failed.
   *  Callers should sanitize before returning to clients. */
  delegationError?: string;
}

/**
 * Create a zone and, when `parentZoneId` is supplied, delegate it from that
 * parent: read the new zone's assigned Cloudflare nameservers (re-GETing if the
 * create response hasn't populated them yet) and create matching NS records in
 * the parent zone, so a subdomain zone activates without a registrar change.
 *
 * Zone creation failure throws (fatal). Delegation failure is non-fatal — the
 * zone already exists — and is reported via `delegationError` so the caller can
 * surface a warning while still proceeding.
 *
 * Extracted from the worker `/api/zones/create` handler so the
 * create→getZone→createDNSRecord orchestration is unit-testable.
 */
export async function createZoneWithDelegation(
  auth: ApiAuth | string,
  accountId: string,
  name: string,
  parentZoneId?: string,
): Promise<CreateZoneResult> {
  const zone = await createZone(auth, accountId, name);
  let nameServers: string[] = zone.name_servers || [];
  let delegated = false;
  let delegationError: string | undefined;

  if (parentZoneId) {
    try {
      // Newly created zones sometimes return an empty name_servers array until
      // the record is materialized; re-GET to be sure.
      if (nameServers.length === 0) {
        const fresh = await getZone(auth, zone.id);
        nameServers = fresh.name_servers || [];
      }
      if (nameServers.length === 0) {
        // Phrased to match the worker's safe-error allowlist ("not available")
        // so it survives sanitization instead of becoming a generic message.
        delegationError = 'Delegation is not available yet: the new zone has no nameservers assigned — delegate manually once they appear.';
      } else {
        for (const ns of nameServers) {
          await createDNSRecord(auth, parentZoneId, {
            type: 'NS',
            name: zone.name, // full subdomain FQDN; CF stores it relative to the parent zone
            content: ns,
            ttl: 3600,
          });
        }
        delegated = true;
      }
    } catch (e: unknown) {
      delegationError = e instanceof Error ? e.message : String(e);
    }
  }

  return { zone, nameServers, delegated, delegationError };
}

// Zone Subscription / Plan APIs
export interface ZoneSubscription {
  id: string;
  rate_plan: {
    id: string;
    public_name?: string;
    currency?: string;
    scope?: string;
    externally_managed?: boolean;
  };
  frequency?: string;
  component_values?: { name: string; value: number }[];
}

export interface AvailableRatePlan {
  id: string;
  name: string;
  currency: string;
  frequency: string;
  price: number;
  is_subscribed: boolean;
  can_subscribe: boolean;
  legacy_id: string;
}

export async function getZoneSubscription(auth: ApiAuth | string, zoneId: string): Promise<ZoneSubscription> {
  return cfFetch<ZoneSubscription>(auth, `/zones/${zoneId}/subscription`);
}

export async function getAvailablePlans(auth: ApiAuth | string, zoneId: string): Promise<AvailableRatePlan[]> {
  return cfFetch<AvailableRatePlan[]>(auth, `/zones/${zoneId}/available_plans`);
}

export async function updateZoneSubscription(auth: ApiAuth | string, zoneId: string, ratePlanId: string, frequency: string = 'monthly'): Promise<ZoneSubscription> {
  return cfFetch<ZoneSubscription>(auth, `/zones/${zoneId}/subscription`, {
    method: 'PUT',
    body: JSON.stringify({
      rate_plan: { id: ratePlanId },
      frequency,
    }),
  });
}

// DNS APIs
export async function listDNSRecords(auth: ApiAuth | string, zoneId: string): Promise<CFDNSRecord[]> {
  return cfFetchAll<CFDNSRecord>(auth, `/zones/${zoneId}/dns_records`);
}

export async function createDNSRecord(auth: ApiAuth | string, zoneId: string, record: Partial<CFDNSRecord>): Promise<CFDNSRecord> {
  return cfFetch<CFDNSRecord>(auth, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify(record),
  });
}

export async function updateDNSRecord(auth: ApiAuth | string, zoneId: string, recordId: string, record: Partial<CFDNSRecord>): Promise<CFDNSRecord> {
  return cfFetch<CFDNSRecord>(auth, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'PUT',
    body: JSON.stringify(record),
  });
}

export async function deleteDNSRecord(auth: ApiAuth | string, zoneId: string, recordId: string): Promise<void> {
  await cfFetch(auth, `/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
}

// Zone Settings APIs
export async function listZoneSettings(auth: ApiAuth | string, zoneId: string): Promise<CFZoneSetting[]> {
  return cfFetch<CFZoneSetting[]>(auth, `/zones/${zoneId}/settings`);
}

/**
 * Read a single zone setting via its dedicated `/zones/{id}/settings/{id}`
 * endpoint. Several newer settings (speed_brain, fonts, origin_max_http_version,
 * ssl_automatic_mode, origin_h2_max_streams, …) are NOT backfilled into the
 * aggregate `GET /zones/{id}/settings` response, so the export has to fetch them
 * individually. Returns the standard `{ id, value, editable, … }` setting shape.
 */
export async function getZoneSetting(auth: ApiAuth | string, zoneId: string, settingId: string): Promise<CFZoneSetting> {
  return cfFetch<CFZoneSetting>(auth, `/zones/${zoneId}/settings/${settingId}`);
}

export async function updateZoneSetting(auth: ApiAuth | string, zoneId: string, settingId: string, value: unknown): Promise<CFZoneSetting> {
  return cfFetch<CFZoneSetting>(auth, `/zones/${zoneId}/settings/${settingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  });
}

// Argo Smart Routing APIs (separate from zone settings)
export interface ArgoSetting {
  id: string;
  value: string; // 'on' | 'off'
  editable: boolean;
}

// [W8] Only swallow 403/404 (feature not available); rethrow 429/5xx so callers can retry
export async function getArgoSmartRouting(auth: ApiAuth | string, zoneId: string): Promise<ArgoSetting | null> {
  try {
    return await cfFetch<ArgoSetting>(auth, `/zones/${zoneId}/argo/smart_routing`);
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('not found') || msg.includes('not_found') || msg.includes('forbidden') || msg.includes('not available') || msg.includes('not authorized')) return null;
    throw e;
  }
}

export async function updateArgoSmartRouting(auth: ApiAuth | string, zoneId: string, value: string): Promise<ArgoSetting> {
  return cfFetch<ArgoSetting>(auth, `/zones/${zoneId}/argo/smart_routing`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  });
}

// Argo Tiered Caching APIs (separate from zone settings)
// [W8] Only swallow 403/404; rethrow 429/5xx
export async function getArgoTieredCaching(auth: ApiAuth | string, zoneId: string): Promise<ArgoSetting | null> {
  try {
    return await cfFetch<ArgoSetting>(auth, `/zones/${zoneId}/argo/tiered_caching`);
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('not found') || msg.includes('not_found') || msg.includes('forbidden') || msg.includes('not available') || msg.includes('not authorized')) return null;
    throw e;
  }
}

export async function updateArgoTieredCaching(auth: ApiAuth | string, zoneId: string, value: string): Promise<ArgoSetting> {
  return cfFetch<ArgoSetting>(auth, `/zones/${zoneId}/argo/tiered_caching`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  });
}

// Bot Management APIs (separate from zone settings — covers BFM, SBFM, and Enterprise Bot Management)
export interface BotManagementConfig {
  fight_mode?: boolean;
  sbfm_definitely_automated?: string;  // 'block' | 'managed_challenge' | 'allow'
  sbfm_likely_automated?: string;
  sbfm_verified_bots?: string;
  sbfm_static_resource_protection?: boolean;
  enable_js?: boolean;
  suppress_session_score?: boolean;
  optimize_wordpress?: boolean;
  using_latest_model?: boolean;
  // Enterprise Bot Management fields
  auto_update_model?: boolean;
  ai_bots_protection?: string;
}

// [W8] Only swallow 403/404; rethrow 429/5xx
export async function getBotManagement(auth: ApiAuth | string, zoneId: string): Promise<BotManagementConfig | null> {
  try {
    return await cfFetch<BotManagementConfig>(auth, `/zones/${zoneId}/bot_management`);
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('not found') || msg.includes('not_found') || msg.includes('forbidden') || msg.includes('not available') || msg.includes('not authorized')) return null;
    throw e;
  }
}

export async function updateBotManagement(auth: ApiAuth | string, zoneId: string, config: BotManagementConfig): Promise<BotManagementConfig> {
  return cfFetch<BotManagementConfig>(auth, `/zones/${zoneId}/bot_management`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// Page Rules APIs
export async function listPageRules(auth: ApiAuth | string, zoneId: string): Promise<CFPageRule[]> {
  return cfFetch<CFPageRule[]>(auth, `/zones/${zoneId}/pagerules`);
}

export async function createPageRule(auth: ApiAuth | string, zoneId: string, rule: Partial<CFPageRule>): Promise<CFPageRule> {
  return cfFetch<CFPageRule>(auth, `/zones/${zoneId}/pagerules`, {
    method: 'POST',
    body: JSON.stringify(rule),
  });
}

// Rulesets APIs
export async function listRulesets(auth: ApiAuth | string, zoneId: string): Promise<CFRuleset[]> {
  return cfFetch<CFRuleset[]>(auth, `/zones/${zoneId}/rulesets`);
}

export async function getRuleset(auth: ApiAuth | string, zoneId: string, rulesetId: string): Promise<CFRuleset> {
  return cfFetch<CFRuleset>(auth, `/zones/${zoneId}/rulesets/${rulesetId}`);
}

export async function createRuleset(auth: ApiAuth | string, zoneId: string, ruleset: Partial<CFRuleset>): Promise<CFRuleset> {
  return cfFetch<CFRuleset>(auth, `/zones/${zoneId}/rulesets`, {
    method: 'POST',
    body: JSON.stringify(ruleset),
  });
}

export async function updateRuleset(auth: ApiAuth | string, zoneId: string, phase: string, rules: CFRuleset['rules']): Promise<CFRuleset> {
  return cfFetch<CFRuleset>(auth, `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, {
    method: 'PUT',
    body: JSON.stringify({ rules }),
  });
}

// Account-level rulesets (custom rulesets that zones reference via
// `action=execute, action_parameters.id=<ruleset_id>`). These are distinct
// from zone-level rulesets: they live at /accounts/{id}/rulesets and can be
// invoked from multiple zones' entry-point rulesets.
//
// Zone migration must export the subset of account rulesets that this zone
// actually references, recreate them on the destination account, then
// rewrite the `execute` references in the zone's own rulesets to point at
// the new IDs.
export async function listAccountRulesets(auth: ApiAuth | string, accountId: string): Promise<CFRuleset[]> {
  try {
    return await cfFetch<CFRuleset[]>(auth, `/accounts/${accountId}/rulesets`);
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}

export async function getAccountRuleset(auth: ApiAuth | string, accountId: string, rulesetId: string): Promise<CFRuleset> {
  return cfFetch<CFRuleset>(auth, `/accounts/${accountId}/rulesets/${rulesetId}`);
}

export async function createAccountRuleset(auth: ApiAuth | string, accountId: string, ruleset: Partial<CFRuleset>): Promise<CFRuleset> {
  return cfFetch<CFRuleset>(auth, `/accounts/${accountId}/rulesets`, {
    method: 'POST',
    body: JSON.stringify(ruleset),
  });
}

/**
 * Get the account-level entrypoint ruleset for a given phase. The CF API
 * organizes account-level rulesets into phase entrypoints (kind: root) that
 * contain `execute` rules referencing custom account rulesets. This is the
 * canonical place where account-scoped custom rulesets are deployed —
 * zone-level execute rules pointing at custom account rulesets are not
 * accepted by the API (error 20230 "not possible to execute a ruleset of
 * scope account at scope zone"); deployment must go via the account-level
 * phase entrypoint.
 *
 * Returns null when the entrypoint doesn't exist yet (404). Other errors
 * propagate.
 */
export async function getAccountPhaseEntrypoint(
  auth: ApiAuth | string,
  accountId: string,
  phase: string,
): Promise<CFRuleset | null> {
  try {
    return await cfFetch<CFRuleset>(auth, `/accounts/${accountId}/rulesets/phases/${phase}/entrypoint`);
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (m.includes('not found') || m.includes('404')) return null;
    if (isExportTolerable(m)) return null;
    throw e;
  }
}

/**
 * Update (or create) the account-level entrypoint ruleset for a phase.
 * The CF API supports both POST (create) and PUT-by-id (update) for these;
 * the simplest cross-state operation is PUT to the phases/{phase}/entrypoint
 * endpoint which upserts the entrypoint's rules.
 */
export async function putAccountPhaseEntrypoint(
  auth: ApiAuth | string,
  accountId: string,
  phase: string,
  body: { rules: Array<Record<string, unknown>> },
): Promise<CFRuleset> {
  return cfFetch<CFRuleset>(auth, `/accounts/${accountId}/rulesets/phases/${phase}/entrypoint`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

// Notifications API (account-level alerting).
//
// Notification policies fire alerts when zone/account events occur (DDoS
// attacks, certificate issues, Logpush failures, etc.). They route to
// "mechanisms" — email recipients, webhooks, and PagerDuty integrations.
//
// For zone migration we care about the subset of policies that filter to
// this zone via filters.zones[]. The destinations (webhooks/pagerduty)
// are also account-scoped and need re-issuing on dest because their
// secret tokens are write-only.
export interface NotificationPolicy {
  id?: string;
  name: string;
  description?: string;
  alert_type: string;
  enabled: boolean;
  mechanisms: {
    email?: { id: string }[];
    webhooks?: { id: string }[];
    pagerduty?: { id: string }[];
  };
  filters?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  alert_interval?: string;
  created?: string;
  modified?: string;
}

export interface NotificationWebhook {
  id?: string;
  name: string;
  type: string; // "slack" | "generic" | etc.
  url: string;
  secret?: string; // write-only; never returned by GET
  created_at?: string;
  last_success?: string;
  last_failure?: string;
}

export interface NotificationPagerDuty {
  id?: string;
  name: string;
  // token_id is set via the connect flow; not migratable via API
}

export async function listNotificationPolicies(auth: ApiAuth | string, accountId: string): Promise<NotificationPolicy[]> {
  try {
    return await cfFetch<NotificationPolicy[]>(auth, `/accounts/${accountId}/alerting/v3/policies`);
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}

export async function createNotificationPolicy(auth: ApiAuth | string, accountId: string, policy: Partial<NotificationPolicy>): Promise<NotificationPolicy> {
  return cfFetch<NotificationPolicy>(auth, `/accounts/${accountId}/alerting/v3/policies`, {
    method: 'POST',
    body: JSON.stringify(policy),
  });
}

export async function listNotificationWebhooks(auth: ApiAuth | string, accountId: string): Promise<NotificationWebhook[]> {
  try {
    return await cfFetch<NotificationWebhook[]>(auth, `/accounts/${accountId}/alerting/v3/destinations/webhooks`);
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}

export async function createNotificationWebhook(auth: ApiAuth | string, accountId: string, webhook: Partial<NotificationWebhook>): Promise<NotificationWebhook> {
  return cfFetch<NotificationWebhook>(auth, `/accounts/${accountId}/alerting/v3/destinations/webhooks`, {
    method: 'POST',
    body: JSON.stringify(webhook),
  });
}

export async function listNotificationPagerDuty(auth: ApiAuth | string, accountId: string): Promise<NotificationPagerDuty[]> {
  try {
    return await cfFetch<NotificationPagerDuty[]>(auth, `/accounts/${accountId}/alerting/v3/destinations/pagerduty`);
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}

// Workers APIs (Account-level)
export async function listWorkerScripts(auth: ApiAuth | string, accountId: string): Promise<CFWorkerScript[]> {
  return cfFetch<CFWorkerScript[]>(auth, `/accounts/${accountId}/workers/scripts`);
}

export interface WorkerScriptBundle {
  format: CFWorkerScriptFormat;
  /** Main entry script (service worker body, or modules entry module content). */
  script: string;
  /** For modules workers, entry module name (e.g. "worker.js"). */
  main_module?: string;
  /** For modules workers, all text modules (filename -> content). */
  modules?: Record<string, string>;
  /** Raw metadata JSON when available (modules only). */
  metadata?: unknown;
}

function parseMultipartWorkerResponse(
  bodyText: string,
  contentType: string,
  scriptName: string,
): { modules: Record<string, string>; metadata?: unknown; main_module?: string } {
  const boundaryMatch = contentType.match(/boundary=([^;\s]+)/);
  const boundary = boundaryMatch ? boundaryMatch[1] : null;
  if (!boundary) {
    console.log(`[CF-API] Warning: multipart response missing boundary for ${scriptName}`);
    return { modules: {} };
  }

  const modules: Record<string, string> = {};
  let metadata: unknown = undefined;
  let main_module: string | undefined;

  const parts = bodyText.split(`--${boundary}`);
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part || part === '--') continue;

    let headerEnd = part.indexOf('\r\n\r\n');
    let sepLen = 4;
    if (headerEnd === -1) {
      headerEnd = part.indexOf('\n\n');
      sepLen = 2;
    }
    if (headerEnd === -1) continue;

    const headerBlock = part.slice(0, headerEnd);
    const content = part.slice(headerEnd + sepLen);

    const headers: Record<string, string> = {};
    for (const line of headerBlock.split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const k = line.slice(0, idx).trim().toLowerCase();
      const v = line.slice(idx + 1).trim();
      headers[k] = v;
    }

    const disp = headers['content-disposition'] || '';
    const nameMatch = disp.match(/name="([^"]+)"/);
    const filenameMatch = disp.match(/filename="([^"]+)"/);
    const partName = filenameMatch?.[1] || nameMatch?.[1] || '';
    const ct = (headers['content-type'] || '').toLowerCase();
    const text = content.replace(/\s*--\s*$/, '');

    if (ct.includes('application/json') || partName === 'metadata') {
      try {
        const json = JSON.parse(text);
        metadata = json;
        if (json && typeof json === 'object' && 'main_module' in json && typeof (json as any).main_module === 'string') {
          main_module = (json as any).main_module;
        }
      } catch {
        // ignore invalid metadata
      }
      continue;
    }

    // Preserve text modules (JS/TS/Plain text).
    // Also accept parts with JS-like filenames even without a Content-Type header,
    // as the Cloudflare API sometimes returns multipart worker responses without Content-Type on script parts.
    const isJsLikeName = /\.(js|mjs|ts|mts|cjs)$/i.test(partName);
    if (ct.includes('javascript') || ct.includes('text/javascript') || ct.includes('application/text') || ct.startsWith('text/') || (!ct && isJsLikeName) || (!ct && !partName)) {
      const key = partName || (Object.keys(modules).length === 0 ? 'worker.js' : `module-${Object.keys(modules).length + 1}.js`);
      modules[key] = text;
      continue;
    }

    // Non-text module types (e.g. wasm) are currently skipped.
    if (partName) {
      console.log(`[CF-API] Warning: skipping non-text worker module part "${partName}" (${ct || 'unknown content-type'}) for ${scriptName}`);
    }
  }

  return { modules, metadata, main_module };
}

/**
 * Fetch worker script content from source account.
 * 
 * Methodology (from Cloudflare API):
 * 1. Authentication: Uses API token with Worker:Read permissions
 * 2. GET request to /accounts/{account_id}/workers/scripts/{script_name}
 * 3. Response format: Raw JS for Service Workers, multipart for ES Module Workers
 * 4. Parsing: Extracts JavaScript content from multipart responses
 * 
 * Note: This returns code only - secrets/env vars must be fetched separately via getWorkerBindings
 */
export async function getWorkerScript(auth: ApiAuth | string, accountId: string, scriptName: string): Promise<string> {
  const bundle = await getWorkerScriptBundle(auth, accountId, scriptName);
  return bundle.script;
}

/**
 * Fetch worker script content + detect script format.
 * For modules workers, this attempts to parse multipart response and capture text modules.
 */
export async function getWorkerScriptBundle(auth: ApiAuth | string, accountId: string, scriptName: string): Promise<WorkerScriptBundle> {
  const authObj: ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;

  // [W10] Add timeout and retry loop for raw worker script fetch
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[CF-API] ↻ Retry ${attempt}/${MAX_RETRIES} for worker script ${scriptName}`);
      await sleep(delay);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CF_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${scriptName}`, {
        signal: controller.signal,
        headers: {
          ...getAuthHeaders(authObj),
          'Accept': 'application/javascript, text/javascript, */*',
        },
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      if (lastError.name === 'AbortError') {
        lastError = new Error(`Worker script fetch timed out after ${CF_FETCH_TIMEOUT_MS}ms: ${scriptName}`);
      }
      if (attempt === MAX_RETRIES) throw lastError;
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      lastError = new Error(`Worker script fetch HTTP ${res.status}: ${scriptName}`);
      if (attempt === MAX_RETRIES) throw lastError;
      continue;
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to get worker script ${scriptName}: ${res.status} ${errorText}`);
    }

    const contentType = res.headers.get('content-type') || '';

    // Modules workers return multipart
    if (contentType.toLowerCase().includes('multipart')) {
      const text = await res.text();
      const parsed = parseMultipartWorkerResponse(text, contentType, scriptName);
      const modules = parsed.modules;
      const keys = Object.keys(modules);
      let mainModule = parsed.main_module || (modules['worker.js'] ? 'worker.js' : keys[0]);
      let mainScript = (mainModule && modules[mainModule]) ? modules[mainModule] : '';

      if (!mainScript && keys.length > 0) {
        mainModule = mainModule || keys[0];
        mainScript = modules[mainModule] || modules[keys[0]] || '';
      }

      if (!mainScript) {
        // Fallback: attempt to extract JS by pattern matching within the raw multipart text.
        const jsMatch = text.match(/(?:export default|addEventListener|fetch\s*\()/s);
        if (jsMatch && jsMatch.index !== undefined) {
          let start = jsMatch.index;
          while (start > 0 && text[start - 1] !== '\n') start--;
          let end = text.indexOf('\n--', jsMatch.index);
          if (end === -1) end = text.length;
          const candidate = text.slice(start, end).trim();
          if (candidate.length > 0) {
            mainScript = candidate;
          }
        }
      }

      if (!mainScript) {
        console.log(`[CF-API] Warning: could not determine main module content for ${scriptName} (module parts: ${keys.length})`);
      }

      return {
        format: 'modules',
        script: mainScript,
        main_module: mainModule,
        modules: Object.keys(modules).length > 0 ? modules : undefined,
        metadata: parsed.metadata,
      };
    }

    // Legacy service worker: plain JS
    const script = await res.text();
    return { format: 'service_worker', script };
  }

  throw lastError || new Error(`Failed to get worker script after retries: ${scriptName}`);
}

export async function getWorkerBindings(auth: ApiAuth | string, accountId: string, scriptName: string): Promise<CFWorkerBinding[]> {
  const data = await cfFetch<{ bindings: CFWorkerBinding[] }>(
    auth,
    `/accounts/${accountId}/workers/scripts/${scriptName}/settings`
  );
  return data.bindings || [];
}

/**
 * Upload a worker script to the destination account.
 * 
 * Methodology (from Cloudflare API):
 * 1. Authentication: Uses API token with Worker:Edit permissions
 * 2. Format detection: Detects ES Module vs Service Worker format
 * 3. Upload: PUT request with multipart/form-data for modules, or plain JS for service workers
 * 4. Bindings: Included in metadata (secrets must be set separately via setWorkerSecret)
 */
export async function uploadWorkerScript(
  auth: ApiAuth | string,
  accountId: string,
  scriptName: string,
  script: string,
  bindings: CFWorkerBinding[],
  opts?: {
    format?: CFWorkerScriptFormat;
    main_module?: string;
    modules?: Record<string, string>;
  }
): Promise<void> {
  const authObj: ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;
  
  const requestedFormat = opts?.format;

  // Best-effort detection when format isn't provided.
  const detectedModules = /\bexport\s+default\b|\bimport\s+[^\n;]+\s+from\s+['"]/m.test(script);
  const isModules = requestedFormat ? (requestedFormat === 'modules') : detectedModules;

  console.log(`[CF-API] uploadWorkerScript: ${scriptName} format=${requestedFormat || '(auto)'} isModules=${isModules} scriptLen=${script.length} modules=${opts?.modules ? Object.keys(opts.modules).length : 0}`);
  
  // Filter out secrets (they must be set separately via setWorkerSecret API)
  const nonSecretBindings = bindings.filter(b => b.type !== 'secret_text');
  
  // [C11] Add retry loop for worker upload (raw fetch without cfFetch retry)
  const doBindings = nonSecretBindings.filter(b => b.type === 'durable_object_namespace' && b.class_name);

  // DO migration class type: prefer new_sqlite_classes (works on free+paid plans, newer API)
  // Falls back to new_classes if new_sqlite_classes is rejected.
  type DoMigrationType = 'new_sqlite_classes' | 'new_classes' | 'none';

  const buildFormData = (doMigration: DoMigrationType) => {
    const formData = new FormData();
    if (isModules) {
      const modules = opts?.modules && Object.keys(opts.modules).length > 0
        ? opts.modules
        : { [opts?.main_module || 'worker.js']: script };
      const mainModule = opts?.main_module || Object.keys(modules)[0] || 'worker.js';
      if (!modules[mainModule]) {
        // Ensure metadata.main_module points at an uploaded part.
        modules[mainModule] = script;
      }

      const metadata: Record<string, unknown> = { main_module: mainModule, bindings: nonSecretBindings };
      // Include DO migrations for workers with Durable Object bindings (first deploy)
      if (doMigration !== 'none' && doBindings.length > 0) {
        metadata.migrations = {
          tag: 'v1',
          [doMigration]: doBindings.map(b => b.class_name),
        };
      }
      for (const [filename, content] of Object.entries(modules)) {
        formData.append(filename, new Blob([content], { type: 'application/javascript+module' }), filename);
      }
      formData.append('metadata', JSON.stringify(metadata));
    } else {
      const metadata: Record<string, unknown> = { body_part: 'script', bindings: nonSecretBindings };
      // Include DO migrations for workers with Durable Object bindings (first deploy)
      if (doMigration !== 'none' && doBindings.length > 0) {
        metadata.migrations = {
          tag: 'v1',
          [doMigration]: doBindings.map(b => b.class_name),
        };
      }
      formData.append('script', new Blob([script], { type: 'application/javascript' }), 'script');
      formData.append('metadata', JSON.stringify(metadata));
    }
    return formData;
  };

  let lastUploadError: Error | null = null;
  // Start with new_sqlite_classes (works on free+paid plans), fall back to new_classes, then none
  let doMigration: DoMigrationType = doBindings.length > 0 ? 'new_sqlite_classes' : 'none';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[CF-API] ↻ Retry ${attempt}/${MAX_RETRIES} for worker upload ${scriptName}`);
      await sleep(delay);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CF_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${scriptName}`, {
        method: 'PUT',
        signal: controller.signal,
        headers: getAuthHeaders(authObj),
        body: buildFormData(doMigration),
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      lastUploadError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      if (attempt === MAX_RETRIES) throw lastUploadError;
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      lastUploadError = new Error(`Worker upload HTTP ${res.status}: ${scriptName}`);
      if (attempt === MAX_RETRIES) throw lastUploadError;
      continue;
    }

    if (!res.ok) {
      const err = await res.text();
      // If DO class already exists, retry without migrations (same pattern as zone-apply.mjs)
      if (doMigration !== 'none' && (err.includes('already depended on') || err.includes('already exists'))) {
        console.log(`[CF-API] DO class already exists for ${scriptName}, retrying without migrations`);
        doMigration = 'none';
        attempt--; // Don't count this as a retry attempt
        continue;
      }
      // If new_sqlite_classes not supported, fall back to new_classes
      if (doMigration === 'new_sqlite_classes' && (err.includes('new_classes') || err.includes('migration'))) {
        console.log(`[CF-API] new_sqlite_classes not accepted for ${scriptName}, trying new_classes`);
        doMigration = 'new_classes';
        attempt--; // Don't count this as a retry attempt
        continue;
      }
      throw new Error(`Failed to upload worker: ${err}`);
    }
    return; // success
  }

  throw lastUploadError || new Error(`Failed to upload worker after retries: ${scriptName}`);
}

export async function setWorkerSecret(auth: ApiAuth | string, accountId: string, scriptName: string, secretName: string, secretValue: string): Promise<void> {
  await cfFetch(auth, `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`, {
    method: 'PUT',
    body: JSON.stringify({ name: secretName, text: secretValue, type: 'secret_text' }),
  });
}

// Worker Routes APIs (Zone-level)
export async function listWorkerRoutes(auth: ApiAuth | string, zoneId: string): Promise<CFWorkerRoute[]> {
  return cfFetch<CFWorkerRoute[]>(auth, `/zones/${zoneId}/workers/routes`);
}

export async function createWorkerRoute(auth: ApiAuth | string, zoneId: string, pattern: string, script: string): Promise<CFWorkerRoute> {
  return cfFetch<CFWorkerRoute>(auth, `/zones/${zoneId}/workers/routes`, {
    method: 'POST',
    body: JSON.stringify({ pattern, script }),
  });
}

export async function deleteWorkerRoute(auth: ApiAuth | string, zoneId: string, routeId: string): Promise<void> {
  await cfFetch(auth, `/zones/${zoneId}/workers/routes/${routeId}`, { method: 'DELETE' });
}

// Worker Custom Domains APIs (Account-level)
export async function listWorkerCustomDomains(auth: ApiAuth | string, accountId: string): Promise<CFWorkerCustomDomain[]> {
  return cfFetch<CFWorkerCustomDomain[]>(auth, `/accounts/${accountId}/workers/domains`);
}

export async function createWorkerCustomDomain(
  auth: ApiAuth | string, 
  accountId: string, 
  hostname: string, 
  service: string, 
  zoneId: string,
  environment: string = 'production'
): Promise<CFWorkerCustomDomain> {
  return cfFetch<CFWorkerCustomDomain>(auth, `/accounts/${accountId}/workers/domains`, {
    method: 'PUT',
    body: JSON.stringify({ hostname, service, zone_id: zoneId, environment }),
  });
}

// Load Balancer APIs
export async function listLoadBalancers(auth: ApiAuth | string, zoneId: string): Promise<CFLoadBalancer[]> {
  return cfFetch<CFLoadBalancer[]>(auth, `/zones/${zoneId}/load_balancers`);
}

export async function createLoadBalancer(auth: ApiAuth | string, zoneId: string, lb: Partial<CFLoadBalancer>): Promise<CFLoadBalancer> {
  return cfFetch<CFLoadBalancer>(auth, `/zones/${zoneId}/load_balancers`, {
    method: 'POST',
    body: JSON.stringify(lb),
  });
}

// Pools APIs (Account-level)
export async function listPools(auth: ApiAuth | string, accountId: string): Promise<CFPool[]> {
  return cfFetch<CFPool[]>(auth, `/accounts/${accountId}/load_balancers/pools`);
}

export async function createPool(auth: ApiAuth | string, accountId: string, pool: Partial<CFPool>): Promise<CFPool> {
  return cfFetch<CFPool>(auth, `/accounts/${accountId}/load_balancers/pools`, {
    method: 'POST',
    body: JSON.stringify(pool),
  });
}

// Monitors APIs (Account-level)
export async function listMonitors(auth: ApiAuth | string, accountId: string): Promise<CFMonitor[]> {
  return cfFetch<CFMonitor[]>(auth, `/accounts/${accountId}/load_balancers/monitors`);
}

export async function createMonitor(auth: ApiAuth | string, accountId: string, monitor: Partial<CFMonitor>): Promise<CFMonitor> {
  return cfFetch<CFMonitor>(auth, `/accounts/${accountId}/load_balancers/monitors`, {
    method: 'POST',
    body: JSON.stringify(monitor),
  });
}

/** Load Balancer Monitor Groups — account-scoped sub-resource that
 *  groups monitors with shared {enabled, monitoring_only, must_be_healthy}
 *  policy. Pools reference monitor groups via `monitor_group`.
 *  Each member references a monitor by ID, so the migrate code must
 *  remap source monitor IDs to dest via monitorIdMap. */
export interface LoadBalancerMonitorGroupMember {
  monitor_id: string;
  enabled?: boolean;
  monitoring_only?: boolean;
  must_be_healthy?: boolean;
}
export interface LoadBalancerMonitorGroup {
  id?: string;
  description?: string;
  members?: LoadBalancerMonitorGroupMember[];
}
export async function listLoadBalancerMonitorGroups(
  auth: ApiAuth | string, accountId: string,
): Promise<LoadBalancerMonitorGroup[]> {
  try { return await cfFetch<LoadBalancerMonitorGroup[]>(auth, `/accounts/${accountId}/load_balancers/monitor_groups`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createLoadBalancerMonitorGroup(
  auth: ApiAuth | string, accountId: string, group: LoadBalancerMonitorGroup,
): Promise<LoadBalancerMonitorGroup> {
  const body: Record<string, unknown> = {};
  if (group.description !== undefined) body.description = group.description;
  if (Array.isArray(group.members)) body.members = group.members.map(m => {
    const out: Record<string, unknown> = { monitor_id: m.monitor_id };
    if (m.enabled !== undefined) out.enabled = m.enabled;
    if (m.monitoring_only !== undefined) out.monitoring_only = m.monitoring_only;
    if (m.must_be_healthy !== undefined) out.must_be_healthy = m.must_be_healthy;
    return out;
  });
  return cfFetch<LoadBalancerMonitorGroup>(auth, `/accounts/${accountId}/load_balancers/monitor_groups`,
    { method: 'POST', body: JSON.stringify(body) });
}

/** Hyperdrive — account-scoped connection pools for upstream databases.
 *  Each config has an `origin` block that is one of:
 *    - PublicDatabase: {scheme, host, port, database, user, password}
 *    - AccessProtected: + access_client_id + access_client_secret
 *    - WorkersVPC: {scheme, database, user, password, service_id}
 *  `password` (and `access_client_secret`) are write-only — the source
 *  GET never returns them, so create requires the user to re-supply
 *  these via MigrationConfig.hyperdriveOriginCredentials. */
export interface HyperdriveOrigin {
  scheme?: 'postgres' | 'postgresql' | 'mysql';
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  access_client_id?: string;
  access_client_secret?: string;
  service_id?: string;
}
export interface HyperdriveConfig {
  id?: string;
  name: string;
  origin?: HyperdriveOrigin;
  caching?: { disabled?: boolean; max_age?: number; stale_while_revalidate?: number };
  mtls?: { ca_certificate_id?: string; mtls_certificate_id?: string; sslmode?: string };
  origin_connection_limit?: number;
}
export async function listHyperdriveConfigs(
  auth: ApiAuth | string, accountId: string,
): Promise<HyperdriveConfig[]> {
  try { return await cfFetch<HyperdriveConfig[]>(auth, `/accounts/${accountId}/hyperdrive/configs`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createHyperdriveConfig(
  auth: ApiAuth | string, accountId: string, config: HyperdriveConfig,
): Promise<HyperdriveConfig> {
  // Strip read-only fields the API rejects on create.
  const body: Record<string, unknown> = { name: config.name };
  if (config.origin) body.origin = config.origin;
  if (config.caching) body.caching = config.caching;
  if (config.mtls) body.mtls = config.mtls;
  if (config.origin_connection_limit !== undefined) body.origin_connection_limit = config.origin_connection_limit;
  return cfFetch<HyperdriveConfig>(auth, `/accounts/${accountId}/hyperdrive/configs`,
    { method: 'POST', body: JSON.stringify(body) });
}

// Spectrum APIs
export async function listSpectrumApps(auth: ApiAuth | string, zoneId: string): Promise<CFSpectrumApp[]> {
  return cfFetchAll<CFSpectrumApp>(auth, `/zones/${zoneId}/spectrum/apps`);
}

export async function createSpectrumApp(auth: ApiAuth | string, zoneId: string, app: Partial<CFSpectrumApp>): Promise<CFSpectrumApp> {
  return cfFetch<CFSpectrumApp>(auth, `/zones/${zoneId}/spectrum/apps`, {
    method: 'POST',
    body: JSON.stringify(app),
  });
}

// Custom Certificates APIs
export async function listCustomCertificates(auth: ApiAuth | string, zoneId: string): Promise<CFCustomCertificate[]> {
  return cfFetchAll<CFCustomCertificate>(auth, `/zones/${zoneId}/custom_certificates`);
}

export async function uploadCustomCertificate(
  auth: ApiAuth | string,
  zoneId: string,
  certificate: string,
  privateKey: string,
  bundleMethod?: string
): Promise<CFCustomCertificate> {
  return cfFetch<CFCustomCertificate>(auth, `/zones/${zoneId}/custom_certificates`, {
    method: 'POST',
    body: JSON.stringify({
      certificate,
      private_key: privateKey,
      bundle_method: bundleMethod || 'ubiquitous',
    }),
  });
}

// Custom Hostnames APIs
export async function listCustomHostnames(auth: ApiAuth | string, zoneId: string): Promise<CFCustomHostname[]> {
  return cfFetchAll<CFCustomHostname>(auth, `/zones/${zoneId}/custom_hostnames`);
}

export async function createCustomHostname(auth: ApiAuth | string, zoneId: string, hostname: Partial<CFCustomHostname>): Promise<CFCustomHostname> {
  return cfFetch<CFCustomHostname>(auth, `/zones/${zoneId}/custom_hostnames`, {
    method: 'POST',
    body: JSON.stringify(hostname),
  });
}

// Access APIs (Account-level)
export async function listAccessApps(auth: ApiAuth | string, accountId: string): Promise<CFAccessApp[]> {
  return cfFetch<CFAccessApp[]>(auth, `/accounts/${accountId}/access/apps`);
}

export async function createAccessApp(auth: ApiAuth | string, accountId: string, app: Partial<CFAccessApp>): Promise<CFAccessApp> {
  return cfFetch<CFAccessApp>(auth, `/accounts/${accountId}/access/apps`, {
    method: 'POST',
    body: JSON.stringify(app),
  });
}

export async function listAccessPolicies(auth: ApiAuth | string, accountId: string, appId: string): Promise<CFAccessPolicy[]> {
  return cfFetch<CFAccessPolicy[]>(auth, `/accounts/${accountId}/access/apps/${appId}/policies`);
}

export async function createAccessPolicy(auth: ApiAuth | string, accountId: string, appId: string, policy: Partial<CFAccessPolicy>): Promise<CFAccessPolicy> {
  return cfFetch<CFAccessPolicy>(auth, `/accounts/${accountId}/access/apps/${appId}/policies`, {
    method: 'POST',
    body: JSON.stringify(policy),
  });
}

// Firewall Rules APIs
export async function listFirewallRules(auth: ApiAuth | string, zoneId: string): Promise<CFFirewallRule[]> {
  return cfFetchAll<CFFirewallRule>(auth, `/zones/${zoneId}/firewall/rules`);
}

export async function createFirewallRule(auth: ApiAuth | string, zoneId: string, rule: Partial<CFFirewallRule>): Promise<CFFirewallRule[]> {
  return cfFetch<CFFirewallRule[]>(auth, `/zones/${zoneId}/firewall/rules`, {
    method: 'POST',
    body: JSON.stringify([rule]),
  });
}

// Rate Limits APIs
export async function listRateLimits(auth: ApiAuth | string, zoneId: string): Promise<CFRateLimit[]> {
  return cfFetchAll<CFRateLimit>(auth, `/zones/${zoneId}/rate_limits`);
}

export async function createRateLimit(auth: ApiAuth | string, zoneId: string, rateLimit: Partial<CFRateLimit>): Promise<CFRateLimit> {
  return cfFetch<CFRateLimit>(auth, `/zones/${zoneId}/rate_limits`, {
    method: 'POST',
    body: JSON.stringify(rateLimit),
  });
}

// Email Routing APIs
export interface EmailRoutingSettings {
  id: string;
  enabled: boolean;
  name: string;
  status: string;
  skip_wizard?: boolean;
  /** Whether sub-addressing (user+tag@domain) is honored — request-affecting,
   *  so it's migrated via updateEmailRoutingSettings (PATCH /email/routing). */
  support_subaddress?: boolean;
}

/** Build the writable PATCH body for the Email Routing settings singleton.
 *  Emits ONLY the three documented booleans, and only when they're actually
 *  booleans — the GET result carries read-only envelope fields (id, name,
 *  status, created, modified, tag) that the PATCH rejects (Principle 1). */
export function normalizeEmailRoutingSettings(
  settings: unknown,
): { enabled?: boolean; skip_wizard?: boolean; support_subaddress?: boolean } {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? (settings as Record<string, unknown>) : {};
  const out: { enabled?: boolean; skip_wizard?: boolean; support_subaddress?: boolean } = {};
  if (typeof s.enabled === 'boolean') out.enabled = s.enabled;
  if (typeof s.skip_wizard === 'boolean') out.skip_wizard = s.skip_wizard;
  if (typeof s.support_subaddress === 'boolean') out.support_subaddress = s.support_subaddress;
  return out;
}

/** Update the Email Routing settings singleton (PATCH /zones/{}/email/routing).
 *  Only the writable flags are sent. `enabled` is normally provisioned via
 *  enableEmailRouting (which also creates the MX/SPF records); this carries the
 *  request-affecting `support_subaddress` flag (and `skip_wizard`) from source. */
export async function updateEmailRoutingSettings(
  auth: ApiAuth | string,
  zoneId: string,
  settings: { enabled?: boolean; skip_wizard?: boolean; support_subaddress?: boolean },
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/email/routing`, {
    method: 'PATCH',
    body: JSON.stringify(normalizeEmailRoutingSettings(settings)),
  });
}

// [W8] Only swallow 403/404; rethrow 429/5xx
export async function getEmailRoutingSettings(auth: ApiAuth | string, zoneId: string): Promise<EmailRoutingSettings | null> {
  try {
    return await cfFetch<EmailRoutingSettings>(auth, `/zones/${zoneId}/email/routing`);
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('not found') || msg.includes('not_found') || msg.includes('forbidden') || msg.includes('not available') || msg.includes('not enabled')) return null;
    throw e;
  }
}

export async function enableEmailRouting(auth: ApiAuth | string, zoneId: string): Promise<EmailRoutingSettings> {
  // Use POST /email/routing/dns (the modern non-deprecated endpoint that
  // also adds + locks the necessary MX/SPF records as a side effect).
  // The older /email/routing/enable is marked deprecated in the OpenAPI
  // spec and is covered by the redundant_with_post_dns override entry.
  return cfFetch<EmailRoutingSettings>(auth, `/zones/${zoneId}/email/routing/dns`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function listEmailRoutingRules(auth: ApiAuth | string, zoneId: string): Promise<CFEmailRoutingRule[]> {
  return cfFetch<CFEmailRoutingRule[]>(auth, `/zones/${zoneId}/email/routing/rules`);
}

export async function createEmailRoutingRule(auth: ApiAuth | string, zoneId: string, rule: Partial<CFEmailRoutingRule>): Promise<CFEmailRoutingRule> {
  return cfFetch<CFEmailRoutingRule>(auth, `/zones/${zoneId}/email/routing/rules`, {
    method: 'POST',
    body: JSON.stringify(rule),
  });
}

// Catch-all rules are managed via a dedicated endpoint (PUT, not POST).
// They cannot be created via the regular /email/routing/rules endpoint.
export async function updateEmailRoutingCatchAllRule(
  auth: ApiAuth | string,
  zoneId: string,
  rule: { enabled: boolean; matchers: Array<{ type: string }>; actions: Array<{ type: string; value?: string[] }> },
): Promise<CFEmailRoutingRule> {
  return cfFetch<CFEmailRoutingRule>(auth, `/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: 'PUT',
    body: JSON.stringify(rule),
  });
}

// Email Routing Destination Addresses APIs
export interface EmailRoutingAddress {
  id: string;
  tag: string;
  email: string;
  verified: string | null; // ISO date if verified, null if pending
  created: string;
  modified: string;
}

export async function listEmailRoutingAddresses(auth: ApiAuth | string, accountId: string): Promise<EmailRoutingAddress[]> {
  return cfFetch<EmailRoutingAddress[]>(auth, `/accounts/${accountId}/email/routing/addresses`);
}

export async function createEmailRoutingAddress(auth: ApiAuth | string, accountId: string, email: string): Promise<EmailRoutingAddress> {
  return cfFetch<EmailRoutingAddress>(auth, `/accounts/${accountId}/email/routing/addresses`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** Email Sending Subdomains — outbound transactional sending config
 *  attached to a zone. Each subdomain (e.g. `mail.example.com`) gets a
 *  CF-managed DKIM selector and return-path domain provisioned when
 *  created. Only the `name` is user-supplied at create time; everything
 *  else (tag, dkim_selector, return_path_domain) is server-assigned.
 *  Migration: list source subdomains, POST each name on the dest.
 *
 *  Note: this is the Email Sending API (transactional outbound), NOT
 *  Email Routing (inbound). The two products share the `/email/*`
 *  path prefix but are otherwise independent. */
export interface EmailSendingSubdomain {
  tag?: string;
  name: string;
  enabled?: boolean;
  dkim_selector?: string;
  return_path_domain?: string;
  created?: string;
  modified?: string;
}
export async function listEmailSendingSubdomains(
  auth: ApiAuth | string, zoneId: string,
): Promise<EmailSendingSubdomain[]> {
  try { return await cfFetch<EmailSendingSubdomain[]>(auth, `/zones/${zoneId}/email/sending/subdomains`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createEmailSendingSubdomain(
  auth: ApiAuth | string, zoneId: string, subdomain: EmailSendingSubdomain,
): Promise<EmailSendingSubdomain> {
  return cfFetch<EmailSendingSubdomain>(auth, `/zones/${zoneId}/email/sending/subdomains`,
    { method: 'POST', body: JSON.stringify({ name: subdomain.name }) });
}

// Waiting Rooms APIs
export async function listWaitingRooms(auth: ApiAuth | string, zoneId: string): Promise<CFWaitingRoom[]> {
  return cfFetch<CFWaitingRoom[]>(auth, `/zones/${zoneId}/waiting_rooms`);
}

export async function createWaitingRoom(auth: ApiAuth | string, zoneId: string, waitingRoom: Partial<CFWaitingRoom>): Promise<CFWaitingRoom> {
  return cfFetch<CFWaitingRoom>(auth, `/zones/${zoneId}/waiting_rooms`, {
    method: 'POST',
    body: JSON.stringify(waitingRoom),
  });
}

// Zaraz APIs
// [W8] Only swallow 403/404; rethrow 429/5xx
// Path note: the current Cloudflare API exposes Zaraz config under
// /zones/{}/settings/zaraz/config (the legacy /zones/{}/zaraz/config alias
// still works). We use the /settings/ path so coverage matches the OpenAPI
// surface and we stay on the supported route.
export async function getZarazConfig(auth: ApiAuth | string, zoneId: string): Promise<CFZarazConfig | null> {
  try {
    return await cfFetch<CFZarazConfig>(auth, `/zones/${zoneId}/settings/zaraz/config`);
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('not found') || msg.includes('not_found') || msg.includes('forbidden') || msg.includes('not available') || msg.includes('not enabled') || msg.includes('not authorized') || msg.includes('could not route')) return null;
    throw e;
  }
}

export async function updateZarazConfig(auth: ApiAuth | string, zoneId: string, config: CFZarazConfig): Promise<CFZarazConfig> {
  return cfFetch<CFZarazConfig>(auth, `/zones/${zoneId}/settings/zaraz/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// Google Tag Gateway — server-side Google tag (gtag/GTM) loading config.
// Zone-scoped singleton under /settings. The config is passed through
// verbatim (shape is small and forward-compatible).
export async function getGoogleTagGatewayConfig(auth: ApiAuth | string, zoneId: string): Promise<Record<string, unknown> | null> {
  try {
    return await cfFetch<Record<string, unknown>>(auth, `/zones/${zoneId}/settings/google-tag-gateway/config`);
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m) || m.includes('not found') || m.includes('404')) return null;
    throw e;
  }
}
export async function updateGoogleTagGatewayConfig(auth: ApiAuth | string, zoneId: string, config: Record<string, unknown>): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/settings/google-tag-gateway/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// Smart Shield — Enterprise traffic-protection settings + health checks.
// Settings are a zone-scoped singleton (PATCH); health checks are a list
// (POST to create). Both are passed through verbatim.
export async function getSmartShield(auth: ApiAuth | string, zoneId: string): Promise<Record<string, unknown> | null> {
  try {
    return await cfFetch<Record<string, unknown>>(auth, `/zones/${zoneId}/smart_shield`);
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m) || m.includes('not found') || m.includes('404')) return null;
    throw e;
  }
}
export async function updateSmartShield(auth: ApiAuth | string, zoneId: string, settings: Record<string, unknown>): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/smart_shield`, {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}
export async function listSmartShieldHealthchecks(auth: ApiAuth | string, zoneId: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await cfFetch<Record<string, unknown>[]>(auth, `/zones/${zoneId}/smart_shield/healthchecks`);
    return Array.isArray(res) ? res : [];
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m) || m.includes('not found') || m.includes('404')) return [];
    throw e;
  }
}
export async function createSmartShieldHealthcheck(auth: ApiAuth | string, zoneId: string, healthcheck: Record<string, unknown>): Promise<unknown> {
  // Drop server-managed fields so the dest assigns its own.
  const { id, healthcheck_id, created_on, modified_on, ...body } = healthcheck as Record<string, unknown>;
  void id; void healthcheck_id; void created_on; void modified_on;
  return cfFetch(auth, `/zones/${zoneId}/smart_shield/healthchecks`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Turnstile APIs (Account-level)
export async function listTurnstileWidgets(auth: ApiAuth | string, accountId: string): Promise<CFTurnstileWidget[]> {
  return cfFetch<CFTurnstileWidget[]>(auth, `/accounts/${accountId}/challenges/widgets`);
}

export async function createTurnstileWidget(auth: ApiAuth | string, accountId: string, widget: Partial<CFTurnstileWidget>): Promise<CFTurnstileWidget> {
  return cfFetch<CFTurnstileWidget>(auth, `/accounts/${accountId}/challenges/widgets`, {
    method: 'POST',
    body: JSON.stringify(widget),
  });
}

export async function deleteTurnstileWidget(auth: ApiAuth | string, accountId: string, sitekey: string): Promise<void> {
  await cfFetch(auth, `/accounts/${accountId}/challenges/widgets/${sitekey}`, { method: 'DELETE' });
}

// KV Namespace APIs (Account-level)
export async function listKVNamespaces(auth: ApiAuth | string, accountId: string): Promise<CFKVNamespace[]> {
  return cfFetchAll<CFKVNamespace>(auth, `/accounts/${accountId}/storage/kv/namespaces`);
}

export async function createKVNamespace(auth: ApiAuth | string, accountId: string, title: string): Promise<CFKVNamespace> {
  return cfFetch<CFKVNamespace>(auth, `/accounts/${accountId}/storage/kv/namespaces`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

// KV keys use cursor-based pagination (not page-based like most CF APIs).
// The response includes `result_info.cursor` — pass it as `?cursor=xxx` for the next page.
// Using cfFetchAll (page-based) would loop forever since the KV keys endpoint ignores `page=`.
export async function listKVKeys(
  auth: ApiAuth | string,
  accountId: string,
  namespaceId: string,
  onProgress?: (fetched: number) => void,
): Promise<CFKVKey[]> {
  const authObj: ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;
  const results: CFKVKey[] = [];
  let cursor: string | undefined;
  const perPage = 1000; // KV keys max per_page
  const basePath = `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`;
  const startTime = Date.now();

  interface KVKeysResponse { success: boolean; result: CFKVKey[]; result_info?: { cursor?: string }; errors?: { message: string }[] }

  console.log(`[CF-API] → GET ${basePath} (cursor-paginated)`);

  while (true) {
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (cursor) params.set('cursor', cursor);
    const url = `${CF_API}${basePath}?${params}`;

    let lastError: Error | null = null;
    let data: KVKeysResponse | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[CF-API] ↻ Retry ${attempt}/${MAX_RETRIES} for KV keys (cursor: ${cursor?.slice(0, 12) || 'start'})`);
        await sleep(delay);
      }

      const res = await fetch(url, {
        headers: { ...getAuthHeaders(authObj), 'Content-Type': 'application/json' },
      });
      updateRateLimitFromHeaders(res.headers);
      data = await res.json() as KVKeysResponse;

      if (data.success) {
        console.log(`[CF-API] ✓ KV keys page → ${res.status} (${data.result.length} keys, total so far: ${results.length + data.result.length})`);
        break;
      }

      const errorMessage = data.errors?.[0]?.message || `HTTP ${res.status}`;
      lastError = new Error(errorMessage);
      if (!isRetryableError(res.status, errorMessage) || attempt === MAX_RETRIES) {
        console.log(`[CF-API] ✗ KV keys → ${res.status} "${errorMessage}"`);
        throw lastError;
      }
    }

    if (!data || !data.success) {
      throw lastError || new Error('KV key listing failed after retries');
    }

    results.push(...data.result);
    onProgress?.(results.length);

    // Stop if: no cursor returned, empty page, or fewer than per_page results
    const nextCursor = data.result_info?.cursor;
    if (!nextCursor || data.result.length === 0 || data.result.length < perPage) {
      break;
    }
    cursor = nextCursor;
  }

  console.log(`[CF-API] ✓ KV keys complete: ${results.length} keys (${Date.now() - startTime}ms)`);
  return results;
}

// KV value timeout (30s per key operation)
const KV_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = KV_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// KV value operations with retry + timeout to prevent hangs
async function kvFetchWithRetry(url: string, options: RequestInit, label: string): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[CF-API] ↻ KV retry ${attempt}/${MAX_RETRIES} for ${label} (waiting ${delay}ms)`);
      await sleep(delay);
    }
    try {
      const res = await fetchWithTimeout(url, options);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastError = new Error(`KV ${label}: HTTP ${res.status}`);
        if (attempt === MAX_RETRIES) throw lastError;
        continue;
      }
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.name === 'AbortError') {
        lastError = new Error(`KV ${label}: timed out after ${KV_TIMEOUT_MS}ms`);
      }
      if (attempt === MAX_RETRIES) throw lastError;
    }
  }
  throw lastError || new Error(`KV ${label} failed after retries`);
}

export async function getKVValue(auth: ApiAuth | string, accountId: string, namespaceId: string, key: string): Promise<string> {
  const authObj: ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;
  const url = `${CF_API}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await kvFetchWithRetry(url, { headers: getAuthHeaders(authObj) }, `GET "${key}"`);
  if (!res.ok) {
    throw new Error(`Failed to get KV value "${key}": ${res.status}`);
  }
  return res.text();
}

export async function putKVValue(auth: ApiAuth | string, accountId: string, namespaceId: string, key: string, value: string, metadata?: Record<string, unknown>): Promise<void> {
  const authObj: ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;
  const url = `${CF_API}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  
  const headers: Record<string, string> = {
    ...getAuthHeaders(authObj),
  };
  
  if (metadata) {
    headers['CF-KV-Metadata'] = JSON.stringify(metadata);
  }
  
  const res = await kvFetchWithRetry(url, { method: 'PUT', headers, body: value }, `PUT "${key}"`);
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to put KV value "${key}": ${err}`);
  }
}

// R2 Bucket APIs (Account-level)
// Note: R2 API returns { buckets: [...] } not a direct array
export async function listR2Buckets(auth: ApiAuth | string, accountId: string): Promise<CFR2Bucket[]> {
  const response = await cfFetch<{ buckets: CFR2Bucket[] }>(auth, `/accounts/${accountId}/r2/buckets`);
  return response?.buckets || [];
}

export async function createR2Bucket(auth: ApiAuth | string, accountId: string, name: string, location?: string): Promise<CFR2Bucket> {
  return cfFetch<CFR2Bucket>(auth, `/accounts/${accountId}/r2/buckets`, {
    method: 'POST',
    body: JSON.stringify({ name, locationHint: location }),
  });
}

// ── R2 Bucket Sub-Configurations ────────────────────────────────────────
//
// Cloudflare exposes three distinct config surfaces per R2 bucket beyond
// the bucket itself: CORS, lifecycle rules, and managed-domain (public
// access). All three live under /accounts/{id}/r2/buckets/{name}/*.
//
// `isExportTolerable` is used in the GET helpers because empty configs
// (e.g. no CORS rules ever set) return 404 in some regions and 200 with
// empty arrays in others — both should be treated as "no config".

/** Read CORS rules for a bucket. Returns `[]` when no rules are set. */
export async function listR2BucketCors(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
): Promise<CFR2CorsRule[]> {
  try {
    const resp = await cfFetch<{ rules?: CFR2CorsRule[] } | CFR2CorsRule[]>(
      auth,
      `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/cors`,
    );
    if (Array.isArray(resp)) return resp;
    return resp?.rules || [];
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m) || m.includes('not found') || m.includes('404')) return [];
    throw e;
  }
}

/** Replace the CORS rule set for a bucket. PUT semantics — sending an
 * empty array deletes all rules. */
export async function putR2BucketCors(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
  rules: CFR2CorsRule[],
): Promise<unknown> {
  return cfFetch(
    auth,
    `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/cors`,
    { method: 'PUT', body: JSON.stringify({ rules }) },
  );
}

/** Read object lifecycle rules for a bucket. Returns `[]` when none set. */
export async function listR2BucketLifecycle(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
): Promise<CFR2LifecycleRule[]> {
  try {
    const resp = await cfFetch<{ rules?: CFR2LifecycleRule[] } | CFR2LifecycleRule[]>(
      auth,
      `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/lifecycle`,
    );
    if (Array.isArray(resp)) return resp;
    return resp?.rules || [];
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m) || m.includes('not found') || m.includes('404')) return [];
    throw e;
  }
}

/** Replace the lifecycle rule set for a bucket. PUT semantics — empty
 * array deletes all rules. */
export async function putR2BucketLifecycle(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
  rules: CFR2LifecycleRule[],
): Promise<unknown> {
  return cfFetch(
    auth,
    `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/lifecycle`,
    { method: 'PUT', body: JSON.stringify({ rules }) },
  );
}

/** Read the managed-domain (r2.dev public URL) config for a bucket.
 * Returns `null` when disabled or never enabled. */
export async function getR2BucketManagedDomain(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
): Promise<CFR2ManagedDomain | null> {
  try {
    return await cfFetch<CFR2ManagedDomain>(
      auth,
      `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/domains/managed`,
    );
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m) || m.includes('not found') || m.includes('404')) return null;
    throw e;
  }
}

/** Enable or disable the managed domain for a bucket. */
export async function putR2BucketManagedDomain(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
  config: CFR2ManagedDomain,
): Promise<unknown> {
  return cfFetch(
    auth,
    `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/domains/managed`,
    { method: 'PUT', body: JSON.stringify({ enabled: config.enabled }) },
  );
}

// ── R2 custom domains (bucket → public hostname) ────────────────────────
// A bucket can serve objects over one or more custom domains. The TLS cert
// is auto-provisioned by Cloudflare; the domain's zone must be on the dest
// account for the connection to come up (otherwise the domain stays pending).
export async function listR2BucketCustomDomains(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
): Promise<CFR2CustomDomain[]> {
  try {
    const res = await cfFetch<{ domains: CFR2CustomDomain[] }>(
      auth,
      `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/domains/custom`,
    );
    return Array.isArray(res?.domains) ? res.domains : [];
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m) || m.includes('not found') || m.includes('404')) return [];
    throw e;
  }
}

/** Attach a custom domain to a bucket. */
export async function addR2BucketCustomDomain(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
  domain: CFR2CustomDomain,
): Promise<unknown> {
  const body: Record<string, unknown> = {
    domain: domain.domain,
    enabled: domain.enabled !== false,
  };
  // Deliberately do NOT forward the exported `zoneId`: it is the SOURCE
  // account's zone id, which is invalid on the destination account and would
  // make the attach fail (or bind the wrong zone). Cloudflare resolves the
  // owning zone from `domain` at attach time (see CFR2CustomDomain), so the
  // hostname — which is preserved across the account move — is sufficient.
  if (domain.minTLS) body.minTLS = domain.minTLS;
  return cfFetch(
    auth,
    `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/domains/custom`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** Update an existing custom domain's settings (enabled / minTLS). */
export async function updateR2BucketCustomDomain(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
  domain: CFR2CustomDomain,
): Promise<unknown> {
  const body: Record<string, unknown> = {};
  if (domain.enabled !== undefined) body.enabled = domain.enabled;
  if (domain.minTLS) body.minTLS = domain.minTLS;
  return cfFetch(
    auth,
    `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/domains/custom/${encodeURIComponent(domain.domain)}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
}

// ── R2 object-lock (immutability) configuration ─────────────────────────
export async function getR2BucketLock(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
): Promise<CFR2BucketLock | null> {
  try {
    return await cfFetch<CFR2BucketLock>(
      auth,
      `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/lock`,
    );
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m) || m.includes('not found') || m.includes('404')) return null;
    throw e;
  }
}

/** Replace the object-lock rules for a bucket. */
export async function putR2BucketLock(
  auth: ApiAuth | string,
  accountId: string,
  bucketName: string,
  lock: CFR2BucketLock,
): Promise<unknown> {
  return cfFetch(
    auth,
    `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/lock`,
    { method: 'PUT', body: JSON.stringify({ rules: lock.rules ?? [] }) },
  );
}

// ── Cloudflare Pages projects (Account-level) ───────────────────────────
//
// Pages projects have: build config, env vars (per-environment), source
// repo metadata, deployment_configs, and a list of deployments. We
// migrate metadata + env vars + deployment_configs. The actual deployment
// bundles (static asset uploads) are immutable per-deployment and must
// be redeployed via `wrangler pages deploy` (acknowledged via the
// `pages_deployment_data` IMPOSSIBLE_TO_MIGRATE key).

export async function listPagesProjects(
  auth: ApiAuth | string,
  accountId: string,
): Promise<CFPagesProject[]> {
  try {
    // The Pages projects list endpoint is NOT page/per_page paginated -
    // passing those params makes it reject the request with "Invalid list
    // options provided. Review the `page` or `per_page` parameter." So use
    // cfFetch (single request, no pagination params), which returns the full
    // `result` array, rather than cfFetchAll (which always appends
    // ?page=&per_page=). Bug found via e2e export against a live account.
    return (await cfFetch<CFPagesProject[]>(auth, `/accounts/${accountId}/pages/projects`)) ?? [];
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}

export async function createPagesProject(
  auth: ApiAuth | string,
  accountId: string,
  project: Partial<CFPagesProject>,
): Promise<CFPagesProject> {
  // Strip read-only fields. The POST API rejects `canonical_deployment`,
  // `subdomain`, `created_on`, and `domains` (domains is read via a
  // separate sub-resource and set via `POST /domains`).
  const body: Partial<CFPagesProject> = { ...project };
  delete body.canonical_deployment;
  delete body.subdomain;
  delete body.created_on;
  delete body.domains;
  return cfFetch<CFPagesProject>(auth, `/accounts/${accountId}/pages/projects`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Attach a custom domain to a Pages project. Domains migrate
 * separately from project creation. */
export async function addPagesProjectDomain(
  auth: ApiAuth | string,
  accountId: string,
  projectName: string,
  domain: string,
): Promise<unknown> {
  return cfFetch(
    auth,
    `/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/domains`,
    { method: 'POST', body: JSON.stringify({ name: domain }) },
  );
}

// ── AI Gateway (Account-level) ──────────────────────────────────────────
//
// Cloudflare AI Gateway has two sub-resources we care about:
//   1. Gateways at /accounts/{id}/ai-gateway/gateways
//   2. Custom providers at /accounts/{id}/ai-gateway/custom-providers
//
// Both are migratable end-to-end (config + slugs + URLs). API keys for
// custom providers are write-only (acknowledged via
// `ai_gateway_custom_provider_api_keys`).

export async function listAiGateways(
  auth: ApiAuth | string,
  accountId: string,
): Promise<CFAiGateway[]> {
  try {
    return await cfFetchAll<CFAiGateway>(auth, `/accounts/${accountId}/ai-gateway/gateways`);
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}

export async function createAiGateway(
  auth: ApiAuth | string,
  accountId: string,
  gateway: Partial<CFAiGateway>,
): Promise<CFAiGateway> {
  // Strip read-only metadata fields that the POST rejects.
  const body: Partial<CFAiGateway> = { ...gateway };
  delete body.created_at;
  delete body.modified_at;
  return cfFetch<CFAiGateway>(auth, `/accounts/${accountId}/ai-gateway/gateways`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function listAiGatewayCustomProviders(
  auth: ApiAuth | string,
  accountId: string,
): Promise<CFAiGatewayCustomProvider[]> {
  try {
    return await cfFetchAll<CFAiGatewayCustomProvider>(
      auth,
      `/accounts/${accountId}/ai-gateway/custom-providers`,
    );
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}

export async function createAiGatewayCustomProvider(
  auth: ApiAuth | string,
  accountId: string,
  provider: Partial<CFAiGatewayCustomProvider>,
): Promise<CFAiGatewayCustomProvider> {
  // Strip read-only/auto-generated fields. `id`, `logo`, `curl_example`,
  // `js_example` are server-generated. `link` is set via a separate PUT.
  const body: Partial<CFAiGatewayCustomProvider> = { ...provider };
  delete body.id;
  delete body.logo;
  delete body.curl_example;
  delete body.js_example;
  delete body.link;
  // The list endpoint returns optional fields as `null` when unset (e.g. a
  // provider created without a description/headers). Cloudflare's create
  // schema is strict — POSTing an explicit `null` for a typed-string field is
  // rejected with "Expected string, received null". Omitting the field lets
  // the server apply its default. Strip every null/undefined value rather
  // than enumerating fields, so new optional fields are handled too.
  for (const k of Object.keys(body) as (keyof CFAiGatewayCustomProvider)[]) {
    if (body[k] === null || body[k] === undefined) delete body[k];
  }
  return cfFetch<CFAiGatewayCustomProvider>(
    auth,
    `/accounts/${accountId}/ai-gateway/custom-providers`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

// ── Origin CA certificates ──────────────────────────────────────────────
//
// Origin CA certs are issued via /certificates. The certificate body IS
// readable (so we can list what the source has), but the private key was
// generated client-side and never stored by Cloudflare. To re-issue on
// the destination, the user must provide a NEW CSR (which encodes a
// fresh private key). The Step 3 UI prompts the user for CSRs to use
// for re-issuance.
//
// Note: /certificates is a user-API endpoint (not /accounts/{id}/...) —
// it uses Origin-CA-Key auth, not the regular API token. The list
// endpoint is filtered by `zone_id` query param.

export async function listOriginCaCertificates(
  auth: ApiAuth | string,
  zoneId: string,
): Promise<CFOriginCaCertificate[]> {
  try {
    return await cfFetchAll<CFOriginCaCertificate>(
      auth,
      `/certificates?zone_id=${zoneId}`,
    );
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}

/** Re-issue an Origin CA cert on the destination account. Caller
 * provides a CSR (with a fresh private key generated client-side or
 * supplied via the Step 3 form). */
export async function createOriginCaCertificate(
  auth: ApiAuth | string,
  input: OriginCaCertificateInput,
): Promise<CFOriginCaCertificate> {
  return cfFetch<CFOriginCaCertificate>(auth, `/certificates`, {
    method: 'POST',
    body: JSON.stringify({
      hostnames: input.hostnames,
      csr: input.csr,
      request_type: input.request_type,
      requested_validity: input.requested_validity,
    }),
  });
}

// D1 Database APIs (Account-level)
export async function listD1Databases(auth: ApiAuth | string, accountId: string): Promise<CFD1Database[]> {
  return cfFetchAll<CFD1Database>(auth, `/accounts/${accountId}/d1/database`);
}

export async function createD1Database(auth: ApiAuth | string, accountId: string, name: string): Promise<CFD1Database> {
  return cfFetch<CFD1Database>(auth, `/accounts/${accountId}/d1/database`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

// Queue APIs (Account-level)
export async function listQueues(auth: ApiAuth | string, accountId: string): Promise<CFQueue[]> {
  return cfFetch<CFQueue[]>(auth, `/accounts/${accountId}/queues`);
}

export async function createQueue(auth: ApiAuth | string, accountId: string, name: string): Promise<CFQueue> {
  return cfFetch<CFQueue>(auth, `/accounts/${accountId}/queues`, {
    method: 'POST',
    body: JSON.stringify({ queue_name: name }),
  });
}

// Durable Object Namespace APIs (Account-level)
export async function listDurableObjectNamespaces(auth: ApiAuth | string, accountId: string): Promise<CFDurableObjectNamespace[]> {
  return cfFetch<CFDurableObjectNamespace[]>(auth, `/accounts/${accountId}/workers/durable_objects/namespaces`);
}

// Delete APIs for rollback functionality
// Dynamic path segments are encodeURIComponent-wrapped so an attacker-supplied
// resource id/name (e.g. via the /api/rollback createdResources manifest)
// cannot contain "/" or ".." and traverse to a different API endpoint. For
// legitimate ids (32-hex), UUIDs (D1), and resource names (workers/buckets:
// alphanumerics + "-"/"_") encodeURIComponent is a no-op. Defense-in-depth at
// the URL-construction layer, protecting every caller of these builders.
export async function deleteZone(auth: ApiAuth | string, zoneId: string): Promise<void> {
  await cfFetch(auth, `/zones/${encodeURIComponent(zoneId)}`, { method: 'DELETE' });
}

export async function deleteWorker(auth: ApiAuth | string, accountId: string, scriptName: string): Promise<void> {
  await cfFetch(auth, `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(scriptName)}`, { method: 'DELETE' });
}

export async function deleteKVNamespace(auth: ApiAuth | string, accountId: string, namespaceId: string): Promise<void> {
  await cfFetch(auth, `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}`, { method: 'DELETE' });
}

export async function deleteR2Bucket(auth: ApiAuth | string, accountId: string, bucketName: string): Promise<void> {
  await cfFetch(auth, `/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucketName)}`, { method: 'DELETE' });
}

export async function deleteD1Database(auth: ApiAuth | string, accountId: string, databaseId: string): Promise<void> {
  await cfFetch(auth, `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}`, { method: 'DELETE' });
}

export async function deleteQueue(auth: ApiAuth | string, accountId: string, queueId: string): Promise<void> {
  await cfFetch(auth, `/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}`, { method: 'DELETE' });
}

// Feature availability checks for pre-flight validation
export interface FeatureAvailability {
  available: boolean;
  reason?: string;
  action?: string;
}

/**
 * Classify an error from the LB monitor probe into a FeatureAvailability.
 *
 * Returns `null` when the error indicates LB IS available (i.e. a field-level
 * validation error like "expected_codes is required" — meaning the API got
 * past entitlement checks). Returns a non-available FeatureAvailability when
 * the error signals LB is missing or in a degraded entitlement state.
 *
 * Three classes of degraded state:
 *   1. Range "[0, 0]" — classic "no LB subscription" signal.
 *   2. Range "[N, N]" with N ≤ 1 — degenerate entitlement (e.g. "[1, 1]").
 *      Subscription exists but `ctm.monitor_interval` min/max are
 *      misconfigured server-side; observed intermittently when an LB
 *      subscription is partially provisioned. Recovery requires support.
 *   3. Generic "subscription / not enabled / access failed / not available"
 *      messages.
 *
 * Pure function — safe to unit-test without HTTP mocking.
 */
export function classifyLoadBalancingProbeError(errorMessage: string): FeatureAvailability | null {
  const errMsg = (errorMessage || '').toLowerCase();
  const degenerateRange = /not in range \[\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(errMsg);
  const hasDegenerateRange =
    degenerateRange &&
    degenerateRange[1] === degenerateRange[2] &&
    Number(degenerateRange[1]) <= 1;

  if (hasDegenerateRange && degenerateRange[1] === '0') {
    return {
      available: false,
      reason: 'Load Balancing add-on is not enabled on this account',
      action: 'Dashboard → Traffic → Load Balancing → Enable ($5/mo minimum). Then re-run the capability check.',
    };
  }
  if (hasDegenerateRange) {
    return {
      available: false,
      reason: `Load Balancing entitlement is in a degraded state (interval clamped to [${degenerateRange[1]}, ${degenerateRange[2]}], blocking all monitor creation). The subscription exists but the entitlement min/max are misconfigured.`,
      action: 'Contact Cloudflare Support to re-sync the Load Balancing subscription on this account.',
    };
  }
  if (errMsg.includes('access failed') ||
      errMsg.includes('not enabled') ||
      errMsg.includes('subscription') ||
      errMsg.includes('not available')) {
    return {
      available: false,
      reason: 'Load Balancing add-on is not enabled',
      action: 'Dashboard → Traffic → Load Balancing → Enable ($5/mo minimum).',
    };
  }
  // Field-level error (e.g. "expected_codes is required") — LB is available.
  return null;
}

export interface AccountCapabilities {
  zeroTrust: FeatureAvailability;
  r2: FeatureAvailability;
  loadBalancing: FeatureAvailability;
  workers: FeatureAvailability;
  spectrum: FeatureAvailability;
  analyticsEngine: FeatureAvailability;
  rateLimiting: FeatureAvailability;
  queues: FeatureAvailability;
  d1: FeatureAvailability;
  vectorize: FeatureAvailability;
  /** Email Routing destination addresses on the dest account (account-scoped, not zone). Used by Step 2 to detect forward-rule targets that need verification before migration. */
  emailRouting?: {
    /** All destination addresses configured on the account, with verification state. */
    destinationAddresses: { email: string; verified: boolean; tag?: string }[];
  };
}

export async function checkAccountCapabilities(auth: ApiAuth | string, accountId: string): Promise<AccountCapabilities> {
  const capabilities: AccountCapabilities = {
    zeroTrust: { available: true },
    r2: { available: true },
    loadBalancing: { available: true },
    workers: { available: true },
    spectrum: { available: true },
    analyticsEngine: { available: true },
    rateLimiting: { available: true },
    queues: { available: true },
    d1: { available: true },
    vectorize: { available: true },
  };

  // Check Zero Trust / Access availability
  try {
    await cfFetch(auth, `/accounts/${accountId}/access/apps`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message.toLowerCase() : '';
    if (errMsg.includes('not_enabled') || errMsg.includes('not enabled') || errMsg.includes('access is not enabled')) {
      capabilities.zeroTrust = {
        available: false,
        reason: 'Zero Trust is not enabled on this account',
        action: 'Dashboard → Zero Trust → Get Started. Select a team domain and plan (Free available).',
      };
    }
  }

  // Check R2 availability
  try {
    await cfFetch(auth, `/accounts/${accountId}/r2/buckets`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message.toLowerCase() : '';
    if (errMsg.includes('enable r2') || errMsg.includes('r2 is not enabled') || errMsg.includes('not enabled')) {
      capabilities.r2 = {
        available: false,
        // Consequence-first phrasing, mirroring the richer Load Balancing
        // monitor message: state what breaks before the entitlement fact.
        // Keep "on this account" as the final clause so groups.ts can swap in
        // the specific destination-account label.
        reason: 'R2 buckets will not be created and any Workers bound to them will fail to deploy because R2 is not enabled on this account',
        action: 'Dashboard → R2 → Get Started. A payment method is required. Then re-run the capability check.',
      };
    }
  }

  // Check Load Balancing availability + entitlement health.
  // Listing pools returns 200 even without a subscription, so we probe by
  // attempting to create a monitor with a minimal body. The response shape
  // tells us three distinct states:
  //
  //   1. LB not subscribed: `interval is not in range [0, 0]` or
  //      "access failed" / "not enabled" / "subscription required".
  //   2. LB subscribed but `ctm.monitor_interval` entitlement is broken
  //      (degenerate min == max, often [1, 1]). Pattern: `interval is not
  //      in range [N, N]` where min == max and N is small (≤ 1). Cause:
  //      account has stale/missing entitlement min/max — observed
  //      intermittently when LB is partially provisioned.
  //   3. LB healthy: any other validation error (e.g. "expected_codes is
  //      required") — the API accepted the request far enough to validate
  //      fields, meaning LB IS available.
  try {
    await cfFetch(auth, `/accounts/${accountId}/load_balancers/monitors`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'http',
        expected_codes: '',   // intentionally invalid so it's rejected even WITH LB
        description: '__twilight_zone_probe__',
      }),
    });
    // If the POST somehow succeeds we still know LB is available; the
    // monitor with empty expected_codes should never actually be created,
    // but just in case, we don't mark it unavailable.
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : '';
    const classification = classifyLoadBalancingProbeError(errMsg);
    if (classification) capabilities.loadBalancing = classification;
    // Any other error (e.g. "expected_codes is required") means the API
    // accepted the request far enough to validate fields → LB IS available.
  }

  // Check Workers availability
  try {
    await cfFetch(auth, `/accounts/${accountId}/workers/scripts`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message.toLowerCase() : '';
    if (errMsg.includes('not enabled') || errMsg.includes('subscription')) {
      capabilities.workers = {
        available: false,
        reason: 'Workers is not enabled on this account',
        action: 'Dashboard → Workers & Pages → Get Started.',
      };
    }
  }

  // Check Analytics Engine availability
  // Workers with analytics_engine bindings require AE to be enabled on the account.
  // Probe by querying the AE SQL endpoint — returns an error if AE isn't enabled.
  try {
    await cfFetch(auth, `/accounts/${accountId}/analytics_engine/sql`, {
      method: 'POST',
      body: 'SELECT 1',
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message.toLowerCase() : '';
    if (errMsg.includes('enable analytics engine') || errMsg.includes('analytics engine') ||
        errMsg.includes('10089') || errMsg.includes('not enabled')) {
      capabilities.analyticsEngine = {
        available: false,
        reason: 'Analytics Engine is not enabled on this account',
        action: 'Dashboard → Workers & Pages → Analytics Engine → Enable. Workers with analytics_engine bindings will be skipped.',
      };
    }
  }

  // Check Rate Limiting availability
  // Probe by listing rate limits on a zone — if the account isn't entitled,
  // the API returns "not_entitled" error. We need a zone for this check,
  // so we just probe the rate-limit-specific account endpoint.
  try {
    // List existing rate limits — if account lacks entitlement, this returns an error
    await cfFetch(auth, `/accounts/${accountId}/rate_limits`, { method: 'GET' });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message.toLowerCase() : '';
    if (errMsg.includes('not_entitled') || errMsg.includes('not entitled') ||
        errMsg.includes('ratelimit') || errMsg.includes('rate_limit')) {
      capabilities.rateLimiting = {
        available: false,
        reason: 'Rate Limiting is not enabled on this account',
        action: 'Dashboard → Security → WAF → Rate Limiting Rules. Requires a paid plan add-on.',
      };
    }
    // 404 or other errors likely mean the endpoint doesn't exist at account level —
    // we'll let the zone-level migration discover the issue instead.
  }

  // Check Queues availability
  try {
    await cfFetch(auth, `/accounts/${accountId}/queues`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message.toLowerCase() : '';
    if (errMsg.includes('not enabled') || errMsg.includes('subscription') || errMsg.includes('not available') || errMsg.includes('11002')) {
      capabilities.queues = {
        available: false,
        reason: 'Queues is not enabled on this account',
        action: 'Dashboard → Workers & Pages → Queues → Enable.',
      };
    }
  }

  // Check D1 availability
  try {
    await cfFetch(auth, `/accounts/${accountId}/d1/database`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message.toLowerCase() : '';
    if (errMsg.includes('not enabled') || errMsg.includes('subscription') || errMsg.includes('not available')) {
      capabilities.d1 = {
        available: false,
        reason: 'D1 is not enabled on this account',
        action: 'Dashboard → Workers & Pages → D1 → Create Database to activate.',
      };
    }
  }

  // Check Vectorize availability
  try {
    await cfFetch(auth, `/accounts/${accountId}/vectorize/v2/indexes`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message.toLowerCase() : '';
    if (errMsg.includes('not enabled') || errMsg.includes('subscription') || errMsg.includes('not available')) {
      capabilities.vectorize = {
        available: false,
        reason: 'Vectorize is not enabled on this account',
        action: 'Dashboard → Workers & Pages → Vectorize → Get Started.',
      };
    }
  }

  // Spectrum is Enterprise-only, we can't easily check this but mark as potentially unavailable
  // The actual check happens during migration

  // Email Routing — fetch the destination address list. Used by Step 2 to
  // surface forward-rule targets that need verification before migration.
  // Failure here is non-fatal; the capability is left undefined and the UI
  // falls back to its generic "verify destination addresses" warning.
  try {
    const addresses = await listEmailRoutingAddresses(auth, accountId);
    capabilities.emailRouting = {
      destinationAddresses: addresses.map(a => ({
        email: a.email,
        verified: !!a.verified,
        tag: a.tag,
      })),
    };
  } catch {
    // Account may not have email routing at all yet — that's fine, list is empty
    capabilities.emailRouting = { destinationAddresses: [] };
  }

  return capabilities;
}

// Managed Headers APIs
export interface ManagedHeader {
  id: string;
  enabled: boolean;
}
export interface ManagedHeadersConfig {
  managed_request_headers?: ManagedHeader[];
  managed_response_headers?: ManagedHeader[];
}
export async function getManagedHeaders(auth: ApiAuth | string, zoneId: string): Promise<ManagedHeadersConfig | null> {
  try {
    return await cfFetch<ManagedHeadersConfig>(auth, `/zones/${zoneId}/managed_headers`);
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('not found') || msg.includes('forbidden')) return null;
    throw e;
  }
}
export async function updateManagedHeaders(auth: ApiAuth | string, zoneId: string, config: ManagedHeadersConfig): Promise<ManagedHeadersConfig> {
  // Cloudflare's Managed Headers (a.k.a. Managed Transforms) endpoint uses PATCH,
  // not PUT — PUT and POST both return method_not_allowed (code 1001).
  return cfFetch<ManagedHeadersConfig>(auth, `/zones/${zoneId}/managed_headers`, {
    method: 'PATCH',
    body: JSON.stringify(config),
  });
}

// Cloud Connector rules APIs
export interface CloudConnectorRule {
  id?: string;
  expression: string;
  provider: string;
  parameters: { host: string };
  description?: string;
  enabled?: boolean;
}
export async function getCloudConnectorRules(auth: ApiAuth | string, zoneId: string): Promise<CloudConnectorRule[]> {
  try {
    return await cfFetch<CloudConnectorRule[]>(auth, `/zones/${zoneId}/cloud_connector/rules`);
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(msg)) return [];
    throw e;
  }
}
export async function updateCloudConnectorRules(auth: ApiAuth | string, zoneId: string, rules: CloudConnectorRule[]): Promise<CloudConnectorRule[]> {
  return cfFetch<CloudConnectorRule[]>(auth, `/zones/${zoneId}/cloud_connector/rules`, {
    method: 'PUT',
    body: JSON.stringify(rules),
  });
}

// URL Normalization APIs
export interface UrlNormalizationConfig {
  type: string;   // e.g. 'cloudflare'
  scope: string;  // 'incoming' | 'effective_directives_only'
}
export async function getUrlNormalization(auth: ApiAuth | string, zoneId: string): Promise<UrlNormalizationConfig | null> {
  try {
    return await cfFetch<UrlNormalizationConfig>(auth, `/zones/${zoneId}/url_normalization`);
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('not found') || msg.includes('forbidden')) return null;
    throw e;
  }
}
// ── Singleton write-payload normalizers ─────────────────────────────────
// The export captures each singleton's GET *result* verbatim (cfFetch
// unwraps `data.result`). That raw result carries read-only envelope fields
// (status, updated_at, editable, id, modified_on) and — for unconfigured /
// unsubscribed features — can even be an ARRAY (e.g. fraud_detection returns
// `[]` when there is no subscription). Replaying that shape to the PUT/POST
// write endpoint yields confusing 400s ("invalid JSON", "cannot unmarshal
// array into ... JSONSettings", "Unable to decode the JSON request body",
// "Bad request") that surface as FAILED rows and violate Principle 1.
//
// Each normalizer below reshapes to EXACTLY the documented writable contract
// (verified against the Cloudflare OpenAPI spec, api_version 4.0.0) so the
// request is either accepted, or rejected with a genuine entitlement error
// that `isAcknowledgeableSingletonError` already classifies as acknowledged.
// They are pure and idempotent: callers that already pass a clean write shape
// (e.g. fuzz.ts) are unaffected.
const ORIGIN_PQE_VALUES = new Set(['preferred', 'supported', 'off']);
const ACM_TOTAL_TLS_CAS = new Set(['google', 'lets_encrypt', 'ssl_com']);

function asWritableObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** URL Normalization PUT body: `{ scope, type }` only. */
export function normalizeUrlNormalization(config: unknown): UrlNormalizationConfig {
  const c = asWritableObject(config);
  return {
    scope: typeof c.scope === 'string' && c.scope ? c.scope : 'incoming',
    type: typeof c.type === 'string' && c.type ? c.type : 'cloudflare',
  };
}

/**
 * Origin Post-Quantum Encryption value. Accepts the bare enum string OR the
 * full GET result object (`{ id, value, editable }`) and extracts a valid
 * enum, returning null when the source value is missing/invalid so the caller
 * can skip rather than emit a surprise failed row.
 */
export function normalizeOriginPostQuantumValue(v: unknown): 'preferred' | 'supported' | 'off' | null {
  if (typeof v === 'string' && ORIGIN_PQE_VALUES.has(v)) return v as 'preferred' | 'supported' | 'off';
  const obj = asWritableObject(v);
  if (typeof obj.value === 'string' && ORIGIN_PQE_VALUES.has(obj.value)) {
    return obj.value as 'preferred' | 'supported' | 'off';
  }
  return null;
}

/** Fraud Detection PUT body: only the 3 writable fields, never an array. */
export function normalizeFraudDetectionSettings(s: unknown): Record<string, unknown> {
  const src = asWritableObject(s);
  const out: Record<string, unknown> = {};
  for (const k of ['authentication_settings', 'user_profiles', 'username_expressions']) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

/** Page Shield PUT body: drop read-only `updated_at`. */
export function normalizePageShieldSettings(s: unknown): Record<string, unknown> {
  const src = asWritableObject(s);
  const out: Record<string, unknown> = {};
  for (const k of ['enabled', 'use_cloudflare_reporting_endpoint', 'use_connection_url_path']) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

/**
 * Schema Validation Settings PUT body. The GET result returns
 * `validation_override_mitigation_action: null` when unset, but the PUT
 * rejects an explicit null with "Bad request" — omit null/absent keys.
 */
export function normalizeSchemaValidationSettings(s: unknown): SchemaValidationSettings {
  const src = asWritableObject(s);
  const out: SchemaValidationSettings = {};
  if (typeof src.validation_default_mitigation_action === 'string') {
    out.validation_default_mitigation_action = src.validation_default_mitigation_action as SchemaValidationSettings['validation_default_mitigation_action'];
  }
  if (src.validation_override_mitigation_action != null) {
    out.validation_override_mitigation_action = src.validation_override_mitigation_action as SchemaValidationSettings['validation_override_mitigation_action'];
  }
  return out;
}

/** ACM Total TLS POST body: `{ enabled, certificate_authority? }`; drop read-only `status` and empty/invalid CA. */
export function normalizeAcmTotalTls(s: unknown): { enabled: boolean; certificate_authority?: string } {
  const src = asWritableObject(s);
  const out: { enabled: boolean; certificate_authority?: string } = { enabled: src.enabled === true };
  if (typeof src.certificate_authority === 'string' && ACM_TOTAL_TLS_CAS.has(src.certificate_authority)) {
    out.certificate_authority = src.certificate_authority;
  }
  return out;
}

export async function updateUrlNormalization(auth: ApiAuth | string, zoneId: string, config: UrlNormalizationConfig): Promise<UrlNormalizationConfig> {
  return cfFetch<UrlNormalizationConfig>(auth, `/zones/${zoneId}/url_normalization`, {
    method: 'PUT',
    body: JSON.stringify(normalizeUrlNormalization(config)),
  });
}

// Cache Reserve APIs (entitlement-gated — wrap errors)
export interface CacheReserveSetting {
  id: string;
  value: 'on' | 'off';
  modified_on?: string;
}
export async function getCacheReserve(auth: ApiAuth | string, zoneId: string): Promise<CacheReserveSetting | null> {
  try {
    return await cfFetch<CacheReserveSetting>(auth, `/zones/${zoneId}/cache/cache_reserve`);
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('not found') || msg.includes('forbidden') || msg.includes('not available')) return null;
    throw e;
  }
}
export async function updateCacheReserve(auth: ApiAuth | string, zoneId: string, value: 'on' | 'off'): Promise<CacheReserveSetting> {
  return cfFetch<CacheReserveSetting>(auth, `/zones/${zoneId}/cache/cache_reserve`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  });
}

// Snippets APIs
export interface Snippet {
  snippet_name: string;
  /** Server-side metadata fields */
  created_on?: string;
  modified_on?: string;
}
export interface SnippetContent {
  snippet_name: string;
  /** ES module worker source */
  code: string;
}
export interface SnippetRule {
  id?: string;
  expression: string;
  description?: string;
  enabled?: boolean;
  snippet_name: string;
}
export async function listSnippets(auth: ApiAuth | string, zoneId: string): Promise<Snippet[]> {
  try {
    const result = await cfFetch<Snippet[] | null>(auth, `/zones/${zoneId}/snippets`);
    // The API returns result: null (not []) when the zone has no snippets.
    // Normalize to an empty array so callers can treat as Snippet[].
    return Array.isArray(result) ? result : [];
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(msg)) return [];
    throw e;
  }
}
export async function getSnippetContent(auth: ApiAuth | string, zoneId: string, snippetName: string): Promise<string | null> {
  // The content endpoint returns the raw module source, NOT wrapped in the CF envelope.
  const headers = getAuthHeaders(typeof auth === 'string' ? createAuth(auth) : auth);
  const res = await fetch(`${CF_API}/zones/${zoneId}/snippets/${snippetName}/content`, { headers });
  if (!res.ok) return null;
  return res.text();
}
export async function createSnippet(auth: ApiAuth | string, zoneId: string, snippetName: string, code: string): Promise<Snippet> {
  // PUT uses multipart/form-data with a metadata part + the module file.
  const fd = new FormData();
  const mainModule = `${snippetName}.js`;
  fd.append('metadata', JSON.stringify({ main_module: mainModule }));
  fd.append(mainModule, new Blob([code], { type: 'application/javascript+module' }), mainModule);

  const headers = getAuthHeaders(typeof auth === 'string' ? createAuth(auth) : auth);
  // Do NOT set Content-Type — let fetch set the multipart boundary.
  const res = await fetch(`${CF_API}/zones/${zoneId}/snippets/${snippetName}`, {
    method: 'PUT',
    headers,
    body: fd,
  });
  const j = await res.json() as CfApiEnvelope<Snippet>;
  if (!res.ok || !j.success) {
    throw new Error(j.errors?.[0]?.message || `Snippet PUT failed: ${res.status}`);
  }
  return j.result;
}
export async function listSnippetRules(auth: ApiAuth | string, zoneId: string): Promise<{ rules: SnippetRule[] }> {
  try {
    const result = await cfFetch<{ rules: SnippetRule[] } | null>(auth, `/zones/${zoneId}/snippets/snippet_rules`);
    // Normalize null and missing-rules to empty
    if (!result || !Array.isArray(result.rules)) return { rules: [] };
    return result;
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(msg)) return { rules: [] };
    throw e;
  }
}
export async function updateSnippetRules(auth: ApiAuth | string, zoneId: string, rules: SnippetRule[]): Promise<{ rules: SnippetRule[] }> {
  return cfFetch<{ rules: SnippetRule[] }>(auth, `/zones/${zoneId}/snippets/snippet_rules`, {
    method: 'PUT',
    body: JSON.stringify({ rules }),
  });
}

// Healthchecks (standalone — not LB monitors) APIs
export interface Healthcheck {
  id?: string;
  name: string;
  description?: string;
  address: string;
  type: 'HTTP' | 'HTTPS' | 'TCP';
  interval?: number;
  timeout?: number;
  retries?: number;
  http_config?: {
    method?: string;
    port?: number;
    path?: string;
    expected_codes?: string[];
    follow_redirects?: boolean;
    allow_insecure?: boolean;
    expected_body?: string;
    header?: Record<string, string[]>;
  };
  tcp_config?: { method?: string; port?: number };
  suspended?: boolean;
  check_regions?: string[];
}
export async function listHealthchecks(auth: ApiAuth | string, zoneId: string): Promise<Healthcheck[]> {
  try {
    return await cfFetch<Healthcheck[]>(auth, `/zones/${zoneId}/healthchecks`);
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('not found') || msg.includes('forbidden')) return [];
    throw e;
  }
}
export async function createHealthcheck(auth: ApiAuth | string, zoneId: string, hc: Partial<Healthcheck>): Promise<Healthcheck> {
  return cfFetch<Healthcheck>(auth, `/zones/${zoneId}/healthchecks`, {
    method: 'POST',
    body: JSON.stringify(hc),
  });
}

// DNS Settings APIs (per-zone DNS behavior toggles)
export interface DnsSettings {
  nameservers?: { type: string; ns_set?: number };
  ns_ttl?: number;
  secondary_overrides?: boolean;
  soa?: {
    expire: number; min_ttl: number; mname: string | null; refresh: number; retry: number; rname: string; ttl: number;
  };
  zone_mode?: string;
  flatten_all_cnames?: boolean;
  foundation_dns?: boolean;
  multi_provider?: boolean;
  internal_dns?: { reference_zone_id?: string };
}
export async function getDnsSettings(auth: ApiAuth | string, zoneId: string): Promise<DnsSettings | null> {
  try { return await cfFetch<DnsSettings>(auth, `/zones/${zoneId}/dns_settings`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateDnsSettings(auth: ApiAuth | string, zoneId: string, settings: DnsSettings): Promise<DnsSettings> {
  // Strip fields that the destination zone won't accept:
  //   - `soa` when mname is null/empty: the default SOA is auto-managed by CF,
  //     and Custom SOA is enterprise-gated:
  //     "Custom SOA records are not available to this account or zone."
  //   - `internal_dns`: only legal on Internal zones (a special zone type for
  //     Cloudflare One internal DNS). Sending it to a regular zone returns:
  //     "Reference zones can only be set on Internal zones."
  const body: DnsSettings = { ...settings };
  if (body.soa && (body.soa.mname == null || body.soa.mname === '')) {
    delete body.soa;
  }
  if (body.internal_dns != null) {
    delete body.internal_dns;
  }
  return cfFetch<DnsSettings>(auth, `/zones/${zoneId}/dns_settings`, { method: 'PATCH', body: JSON.stringify(body) });
}

// DNSSEC APIs (read-only flag — DS record at registrar is manual)
export interface DnssecStatus {
  status: 'active' | 'pending' | 'disabled' | 'pending-disabled';
  flags?: number;
  algorithm?: string;
  key_type?: string;
  digest_type?: string;
  digest?: string;
  ds?: string;
  key_tag?: number;
  public_key?: string;
}
export async function getDnssec(auth: ApiAuth | string, zoneId: string): Promise<DnssecStatus | null> {
  try { return await cfFetch<DnssecStatus>(auth, `/zones/${zoneId}/dnssec`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function enableDnssec(auth: ApiAuth | string, zoneId: string): Promise<DnssecStatus> {
  return cfFetch<DnssecStatus>(auth, `/zones/${zoneId}/dnssec`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
}

// Regional Hostnames APIs (Data Localization)
export interface RegionalHostname {
  hostname: string;
  region_key: string;
  created_on?: string;
}
export async function listRegionalHostnames(auth: ApiAuth | string, zoneId: string): Promise<RegionalHostname[]> {
  try {
    const result = await cfFetch<RegionalHostname[] | null>(auth, `/zones/${zoneId}/addressing/regional_hostnames`);
    return Array.isArray(result) ? result : [];
  } catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createRegionalHostname(auth: ApiAuth | string, zoneId: string, rh: RegionalHostname): Promise<RegionalHostname> {
  return cfFetch<RegionalHostname>(auth, `/zones/${zoneId}/addressing/regional_hostnames`, { method: 'POST', body: JSON.stringify(rh) });
}

// API Gateway: Operations + User Schemas
export interface ApiGatewayOperation {
  operation_id?: string;
  method: string;
  endpoint: string;
  host: string;
}
export async function listApiGatewayOperations(auth: ApiAuth | string, zoneId: string): Promise<ApiGatewayOperation[]> {
  try { return await cfFetch<ApiGatewayOperation[]>(auth, `/zones/${zoneId}/api_gateway/operations`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createApiGatewayOperation(auth: ApiAuth | string, zoneId: string, ops: ApiGatewayOperation[]): Promise<ApiGatewayOperation[]> {
  return cfFetch<ApiGatewayOperation[]>(auth, `/zones/${zoneId}/api_gateway/operations`, { method: 'POST', body: JSON.stringify(ops) });
}
export interface ApiGatewaySchema {
  schema_id?: string;
  name: string;
  kind: 'openapi_v3';
  source: string;
  validation_enabled?: boolean;
}
export async function listApiGatewaySchemas(auth: ApiAuth | string, zoneId: string): Promise<ApiGatewaySchema[]> {
  try { return await cfFetch<ApiGatewaySchema[]>(auth, `/zones/${zoneId}/api_gateway/user_schemas`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createApiGatewaySchema(auth: ApiAuth | string, zoneId: string, schema: ApiGatewaySchema): Promise<ApiGatewaySchema> {
  return cfFetch<ApiGatewaySchema>(auth, `/zones/${zoneId}/api_gateway/user_schemas`, { method: 'POST', body: JSON.stringify(schema) });
}

// Cache: regional tiered, variants, origin post-quantum
export async function getRegionalTieredCache(auth: ApiAuth | string, zoneId: string): Promise<{ value: 'on' | 'off' } | null> {
  try { return await cfFetch(auth, `/zones/${zoneId}/cache/regional_tiered_cache`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (m.includes('not found') || m.includes('forbidden') || m.includes('not available')) return null; throw e; }
}
export async function updateRegionalTieredCache(auth: ApiAuth | string, zoneId: string, value: 'on' | 'off'): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/cache/regional_tiered_cache`, { method: 'PATCH', body: JSON.stringify({ value }) });
}
export interface CacheVariants {
  avif?: string[];
  bmp?: string[];
  gif?: string[];
  jp2?: string[];
  jpeg?: string[];
  jpg?: string[];
  jpg2?: string[];
  png?: string[];
  tif?: string[];
  tiff?: string[];
  webp?: string[];
}
export async function getCacheVariants(auth: ApiAuth | string, zoneId: string): Promise<{ value: CacheVariants } | null> {
  try { return await cfFetch(auth, `/zones/${zoneId}/cache/variants`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateCacheVariants(auth: ApiAuth | string, zoneId: string, value: CacheVariants): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/cache/variants`, { method: 'PATCH', body: JSON.stringify({ value }) });
}
export async function getOriginPostQuantum(auth: ApiAuth | string, zoneId: string): Promise<{ value: 'preferred' | 'supported' | 'off' } | null> {
  try { return await cfFetch(auth, `/zones/${zoneId}/cache/origin_post_quantum_encryption`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateOriginPostQuantum(auth: ApiAuth | string, zoneId: string, value: 'preferred' | 'supported' | 'off'): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/cache/origin_post_quantum_encryption`, { method: 'PUT', body: JSON.stringify({ value }) });
}

// Client Certificates APIs (public certs — private key is excluded)
export interface ClientCertificate {
  id?: string;
  certificate: string;
  csr?: string;
  fingerprint_sha256?: string;
  serial_number?: string;
  signature?: string;
  ski?: string;
  validity_days?: number;
  status?: string;
}
export async function listClientCertificates(auth: ApiAuth | string, zoneId: string): Promise<ClientCertificate[]> {
  try { return await cfFetch<ClientCertificate[]>(auth, `/zones/${zoneId}/client_certificates`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}

// Custom Nameservers: the zone-level state is a singleton `{enabled, ns_set}`
// object exposed at GET/PUT /zones/{id}/custom_ns. See getCustomNameserversMetadata
// / updateCustomNameserversMetadata below. (A former getCustomNs/updateCustomNs
// pair treated the same endpoint as an array `CustomNs[]`, which was wrong — the
// endpoint returns metadata, not a list — so it was removed.)

// Fraud Detection settings
export interface FraudDetectionSettings { [key: string]: unknown }
export async function getFraudDetectionSettings(auth: ApiAuth | string, zoneId: string): Promise<FraudDetectionSettings | null> {
  try { return await cfFetch(auth, `/zones/${zoneId}/fraud_detection/settings`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateFraudDetectionSettings(auth: ApiAuth | string, zoneId: string, settings: FraudDetectionSettings): Promise<unknown> {
  // PATCH returns 405 method_not_allowed; PUT is the correct verb.
  return cfFetch(auth, `/zones/${zoneId}/fraud_detection/settings`, { method: 'PUT', body: JSON.stringify(normalizeFraudDetectionSettings(settings)) });
}

// Firewall Access Rules (IP-level allow/block — zone-scoped)
export interface AccessRule {
  id?: string;
  mode: 'block' | 'challenge' | 'whitelist' | 'js_challenge' | 'managed_challenge';
  notes?: string;
  configuration: { target: string; value: string };
}
export async function listAccessRules(auth: ApiAuth | string, zoneId: string): Promise<AccessRule[]> {
  try { return await cfFetch<AccessRule[]>(auth, `/zones/${zoneId}/firewall/access_rules/rules`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createAccessRule(auth: ApiAuth | string, zoneId: string, rule: AccessRule): Promise<AccessRule> {
  return cfFetch<AccessRule>(auth, `/zones/${zoneId}/firewall/access_rules/rules`, { method: 'POST', body: JSON.stringify(rule) });
}

// Firewall Lockdowns
export interface FirewallLockdown {
  id?: string;
  paused?: boolean;
  description?: string;
  urls: string[];
  configurations: { target: string; value: string }[];
}
export async function listFirewallLockdowns(auth: ApiAuth | string, zoneId: string): Promise<FirewallLockdown[]> {
  try { return await cfFetch<FirewallLockdown[]>(auth, `/zones/${zoneId}/firewall/lockdowns`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createFirewallLockdown(auth: ApiAuth | string, zoneId: string, lock: FirewallLockdown): Promise<FirewallLockdown> {
  return cfFetch<FirewallLockdown>(auth, `/zones/${zoneId}/firewall/lockdowns`, { method: 'POST', body: JSON.stringify(lock) });
}

// Firewall User Agent Rules
export interface UaRule {
  id?: string;
  paused?: boolean;
  description?: string;
  mode: 'block' | 'challenge' | 'js_challenge' | 'managed_challenge';
  configuration: { target: 'ua'; value: string };
}
export async function listUaRules(auth: ApiAuth | string, zoneId: string): Promise<UaRule[]> {
  try { return await cfFetch<UaRule[]>(auth, `/zones/${zoneId}/firewall/ua_rules`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createUaRule(auth: ApiAuth | string, zoneId: string, rule: UaRule): Promise<UaRule> {
  return cfFetch<UaRule>(auth, `/zones/${zoneId}/firewall/ua_rules`, { method: 'POST', body: JSON.stringify(rule) });
}

// Page Shield (settings + policies)
export interface PageShieldSettings {
  enabled?: boolean;
  use_cloudflare_reporting_endpoint?: boolean;
  use_connection_url_path?: boolean;
}
export interface PageShieldPolicy {
  id?: string;
  description?: string;
  enabled?: boolean;
  expression: string;
  action: 'allow' | 'log';
  value?: string;
}
export async function getPageShieldSettings(auth: ApiAuth | string, zoneId: string): Promise<PageShieldSettings | null> {
  try { return await cfFetch<PageShieldSettings>(auth, `/zones/${zoneId}/page_shield`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updatePageShieldSettings(auth: ApiAuth | string, zoneId: string, settings: PageShieldSettings): Promise<PageShieldSettings> {
  return cfFetch<PageShieldSettings>(auth, `/zones/${zoneId}/page_shield`, { method: 'PUT', body: JSON.stringify(normalizePageShieldSettings(settings)) });
}
export async function listPageShieldPolicies(auth: ApiAuth | string, zoneId: string): Promise<PageShieldPolicy[]> {
  try { return await cfFetch<PageShieldPolicy[]>(auth, `/zones/${zoneId}/page_shield/policies`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createPageShieldPolicy(auth: ApiAuth | string, zoneId: string, policy: PageShieldPolicy): Promise<PageShieldPolicy> {
  return cfFetch<PageShieldPolicy>(auth, `/zones/${zoneId}/page_shield/policies`, { method: 'POST', body: JSON.stringify(policy) });
}

// Logpush Jobs
export interface LogpushJob {
  id?: number;
  dataset?: string;
  destination_conf: string;
  enabled?: boolean;
  filter?: string;
  frequency?: string;
  kind?: string;
  logpull_options?: string;
  max_upload_bytes?: number;
  max_upload_interval_seconds?: number;
  max_upload_records?: number;
  name?: string;
  output_options?: unknown;
  ownership_challenge?: string;
}
export async function listLogpushJobs(auth: ApiAuth | string, zoneId: string): Promise<LogpushJob[]> {
  try { return await cfFetch<LogpushJob[]>(auth, `/zones/${zoneId}/logpush/jobs`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createLogpushJob(auth: ApiAuth | string, zoneId: string, job: Partial<LogpushJob>): Promise<LogpushJob> {
  return cfFetch<LogpushJob>(auth, `/zones/${zoneId}/logpush/jobs`, { method: 'POST', body: JSON.stringify(job) });
}

// Account-scoped Logpush jobs (D3).
//
// Account-scoped jobs live at /accounts/{id}/logpush/jobs (vs zone-scoped
// at /zones/{id}/logpush/jobs). They can include or exclude specific zones
// via a filter expression, so for zone migration we only care about the
// subset that includes the source zone.
export async function listAccountLogpushJobs(auth: ApiAuth | string, accountId: string): Promise<LogpushJob[]> {
  try { return await cfFetch<LogpushJob[]>(auth, `/accounts/${accountId}/logpush/jobs`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createAccountLogpushJob(auth: ApiAuth | string, accountId: string, job: Partial<LogpushJob>): Promise<LogpushJob> {
  return cfFetch<LogpushJob>(auth, `/accounts/${accountId}/logpush/jobs`, { method: 'POST', body: JSON.stringify(job) });
}

// Schema Validation (new API replacing api_gateway user_schemas)
export interface SchemaValidationSchema {
  schema_id?: string;
  name: string;
  kind: 'openapi_v3';
  source: string;
  validation_enabled?: boolean;
}
export interface SchemaValidationSettings {
  validation_default_mitigation_action?: 'none' | 'log' | 'block';
  validation_override_mitigation_action?: 'none' | 'disable_override';
}
export async function listSchemaValidationSchemas(auth: ApiAuth | string, zoneId: string): Promise<SchemaValidationSchema[]> {
  try { return await cfFetch<SchemaValidationSchema[]>(auth, `/zones/${zoneId}/schema_validation/schemas`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createSchemaValidationSchema(auth: ApiAuth | string, zoneId: string, schema: SchemaValidationSchema): Promise<SchemaValidationSchema> {
  return cfFetch<SchemaValidationSchema>(auth, `/zones/${zoneId}/schema_validation/schemas`, { method: 'POST', body: JSON.stringify(schema) });
}
export async function getSchemaValidationSettings(auth: ApiAuth | string, zoneId: string): Promise<SchemaValidationSettings | null> {
  try { return await cfFetch<SchemaValidationSettings>(auth, `/zones/${zoneId}/schema_validation/settings`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateSchemaValidationSettings(auth: ApiAuth | string, zoneId: string, settings: SchemaValidationSettings): Promise<SchemaValidationSettings> {
  return cfFetch<SchemaValidationSettings>(auth, `/zones/${zoneId}/schema_validation/settings`, { method: 'PUT', body: JSON.stringify(normalizeSchemaValidationSettings(settings)) });
}

// Token Validation Rules (JWT validation at edge)
export interface TokenValidationConfig {
  id?: string;
  name?: string;
  source?: { id?: string; type?: string };
  validation?: { algorithm?: string; key?: string };
}
export interface TokenValidationRule {
  id?: string;
  config?: string;
  expression: string;
  enabled?: boolean;
  description?: string;
}
export async function listTokenValidationConfigs(auth: ApiAuth | string, zoneId: string): Promise<TokenValidationConfig[]> {
  try { return await cfFetch<TokenValidationConfig[]>(auth, `/zones/${zoneId}/token_validation/config`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createTokenValidationConfig(auth: ApiAuth | string, zoneId: string, cfg: TokenValidationConfig): Promise<TokenValidationConfig> {
  return cfFetch<TokenValidationConfig>(auth, `/zones/${zoneId}/token_validation/config`, { method: 'POST', body: JSON.stringify(cfg) });
}
export async function listTokenValidationRules(auth: ApiAuth | string, zoneId: string): Promise<TokenValidationRule[]> {
  try { return await cfFetch<TokenValidationRule[]>(auth, `/zones/${zoneId}/token_validation/rules`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createTokenValidationRule(auth: ApiAuth | string, zoneId: string, rule: TokenValidationRule): Promise<TokenValidationRule> {
  return cfFetch<TokenValidationRule>(auth, `/zones/${zoneId}/token_validation/rules`, { method: 'POST', body: JSON.stringify(rule) });
}

// ── API Shield surface extensions (2026-05-26 API Shield iteration) ──
//
// Three migratable pieces beyond operations/schemas/token-validation:
//   1. Zone-wide configuration (auth_id_characteristics — defines how
//      API Shield identifies API sessions for discovery/analytics).
//   2. User labels (user-defined tags for grouping API operations).
//   3. Per-operation schema-validation mitigation overrides — keyed by
//      the operation triple (method|host|endpoint) which is stable
//      across accounts, so no fragile ID remap is needed.
// Token-validation JWT key credentials are write-only (cryptographic)
// and are acknowledged via api_shield_token_validation_credentials.

/** API Shield zone-wide configuration. `auth_id_characteristics` is an
 *  opaque list (mix of header/cookie/jwt-claim session identifiers);
 *  typed as unknown[] to avoid over-constraining the evolving shape. */
export interface ApiGatewayConfiguration {
  auth_id_characteristics?: unknown[];
}
export async function getApiGatewayConfiguration(
  auth: ApiAuth | string, zoneId: string,
): Promise<ApiGatewayConfiguration | null> {
  try { return await cfFetch<ApiGatewayConfiguration>(auth, `/zones/${zoneId}/api_gateway/configuration`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateApiGatewayConfiguration(
  auth: ApiAuth | string, zoneId: string, config: ApiGatewayConfiguration,
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/api_gateway/configuration`,
    { method: 'PUT', body: JSON.stringify({ auth_id_characteristics: config.auth_id_characteristics ?? [] }) });
}

/** API Shield user labels — user-defined tags for grouping operations.
 *  Labels attach to operations BY NAME (not ID), so migrating the label
 *  set + re-attaching by name needs no ID remap. */
export interface ApiGatewayUserLabel {
  label_id?: string;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  /** SDK marks managed (Cloudflare-provisioned) labels with `source:'managed'`;
   *  user labels are `source:'user'`. Used to exclude managed labels from
   *  export, since POSTing them to the user-label endpoint always fails. */
  source?: 'user' | 'managed';
}
export async function listApiGatewayUserLabels(
  auth: ApiAuth | string, zoneId: string,
): Promise<ApiGatewayUserLabel[]> {
  try {
    // GET /labels returns both managed + user labels; user labels are
    // the ones without a managed marker. The API distinguishes them via
    // the label_id prefix / a `managed` flag; we keep all that have a
    // `name` and no managed marker.
    const all = await cfFetch<Array<ApiGatewayUserLabel & { managed?: boolean }>>(auth, `/zones/${zoneId}/api_gateway/labels`);
    return (Array.isArray(all) ? all : [])
      // Skip Cloudflare-managed labels. Three markers, any of which is
      // authoritative: the SDK's `source:'managed'` field (the canonical
      // signal), a legacy `managed` boolean, and the reserved `cf-` name
      // prefix. The create endpoint rejects any `cf-`-prefixed name ("name
      // cannot start with 'cf-'"), and managed labels are auto-provisioned on
      // every zone anyway — so exporting them only produces guaranteed
      // migrate-time failures with no functionality lost (they already exist
      // on the destination). Treat as auto-managed.
      .filter(l => l && l.name && !l.managed && l.source !== 'managed' && !/^cf-/i.test(l.name))
      .map(l => ({ label_id: l.label_id, name: l.name, description: l.description, metadata: l.metadata }));
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}
export async function createApiGatewayUserLabel(
  auth: ApiAuth | string, zoneId: string, label: ApiGatewayUserLabel,
): Promise<ApiGatewayUserLabel> {
  // The POST endpoint accepts an ARRAY of label-create requests.
  const body = [{
    name: label.name,
    ...(label.description !== undefined && { description: label.description }),
    ...(label.metadata !== undefined && { metadata: label.metadata }),
  }];
  const res = await cfFetch<ApiGatewayUserLabel[]>(auth, `/zones/${zoneId}/api_gateway/labels/user`,
    { method: 'POST', body: JSON.stringify(body) });
  return Array.isArray(res) ? res[0] : (res as ApiGatewayUserLabel);
}

/** Per-operation schema-validation mitigation override. The export
 *  captures the operation triple so the migrate step can remap to the
 *  dest operation ID after operations are re-created. */
export interface ApiGatewayOperationSchemaValidation {
  method: string;
  host: string;
  endpoint: string;
  mitigation_action?: string | null;
}
export async function getApiGatewayOperationSchemaValidation(
  auth: ApiAuth | string, zoneId: string, operationId: string,
): Promise<{ mitigation_action?: string | null } | null> {
  try { return await cfFetch<{ mitigation_action?: string | null }>(auth, `/zones/${zoneId}/api_gateway/operations/${operationId}/schema_validation`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
/** Bulk-set per-operation schema-validation mitigation. Body is a map
 *  of `{ operationId: { mitigation_action } }`. */
export async function bulkSetApiGatewayOperationSchemaValidation(
  auth: ApiAuth | string, zoneId: string, byOperationId: Record<string, { mitigation_action?: string | null }>,
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/api_gateway/operations/schema_validation`,
    { method: 'PATCH', body: JSON.stringify(byOperationId) });
}

// SSL Certificate Packs (advanced ACM packs)
export interface CertificatePack {
  id?: string;
  type?: 'universal' | 'advanced';
  hosts?: string[];
  primary_certificate?: string;
  certificates?: unknown[];
  certificate_authority?: string;
  validation_method?: 'txt' | 'http' | 'email';
  validity_days?: 14 | 30 | 90 | 365;
  cloudflare_branding?: boolean;
}
export async function listCertificatePacks(auth: ApiAuth | string, zoneId: string): Promise<CertificatePack[]> {
  try { return await cfFetch<CertificatePack[]>(auth, `/zones/${zoneId}/ssl/certificate_packs`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
/**
 * Detect transient errors from the Cloudflare certificate service backend.
 * These are infrastructure-level failures (upstream timeout, backend
 * unavailability) — NOT entitlement gaps or validation errors. Worth
 * retrying with backoff.
 *
 * Empirically observed during bulk cert pack creation: a large fraction
 * of concurrent calls fail with this exact message in a single migration
 * run, while individual probes succeed. The upstream service appears to
 * rate-limit on the certificate-issuance backend rather than the public
 * API gateway, so backoff is more reliable than the standard 429 path.
 */
export function isTransientCertServiceError(message: string): boolean {
  const lower = (message || '').toLowerCase();
  return lower.includes('error while requesting from certificate service') ||
         lower.includes('certificate service unavailable') ||
         lower.includes('certificate service timeout');
}

export async function createCertificatePack(auth: ApiAuth | string, zoneId: string, pack: Partial<CertificatePack>): Promise<CertificatePack> {
  // Strip read-only/forbidden fields that Cloudflare rejects on POST:
  //   - `id`, `primary_certificate`, `certificates` — read-only, set by CF
  //   - `validity_days` — only legal for dedicated certificates with custom
  //     hostnames. Sending it on an advanced pack returns:
  //     "Validity can only be specified for dedicated certificates with
  //     custom hostnames"
  const body: Partial<CertificatePack> = { ...pack };
  delete body.id;
  delete body.primary_certificate;
  delete body.certificates;
  delete body.validity_days;

  // Retry on transient cert-service backend errors with exponential backoff.
  // These show up as 4xx with a generic upstream-call message rather than
  // a real validation failure, so cfFetch doesn't auto-retry them.
  // Max 3 attempts: 0s, 1s, 3s wait.
  const RETRY_DELAYS_MS = [0, 1000, 3000];
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
    try {
      return await cfFetch<CertificatePack>(auth, `/zones/${zoneId}/ssl/certificate_packs`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!isTransientCertServiceError(lastError.message)) {
        // Not a transient cert-service error — re-throw immediately so
        // the migrator can classify it (entitlement, validation, etc.).
        throw lastError;
      }
      // Transient — fall through to next retry.
    }
  }
  // All retries exhausted on transient error. Surface a friendlier message
  // explaining what's actually wrong (without losing the original).
  throw new Error(
    `Cloudflare's certificate service was temporarily unavailable after 3 attempts. ` +
    `This is a transient backend issue, not a configuration problem. ` +
    `Re-run the migration to retry. Original error: ${lastError?.message || 'unknown'}`
  );
}

// ACM Total TLS toggle
export async function getAcmTotalTls(auth: ApiAuth | string, zoneId: string): Promise<{ enabled: boolean; certificate_authority?: string } | null> {
  try { return await cfFetch(auth, `/zones/${zoneId}/acm/total_tls`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateAcmTotalTls(auth: ApiAuth | string, zoneId: string, body: { enabled: boolean; certificate_authority?: string }): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/acm/total_tls`, { method: 'POST', body: JSON.stringify(normalizeAcmTotalTls(body)) });
}

// Waiting Room events + rules + settings (sub-resources of a waiting room)
export interface WaitingRoomEvent {
  id?: string;
  name: string;
  event_start_time: string;
  event_end_time: string;
  description?: string;
  custom_page_html?: string;
  disable_session_renewal?: boolean;
  new_users_per_minute?: number;
  prequeue_start_time?: string;
  queueing_method?: string;
  random_pre_queue?: boolean;
  session_duration?: number;
  shuffle_at_event_start?: boolean;
  suspended?: boolean;
  total_active_users?: number;
}
export async function listWaitingRoomEvents(auth: ApiAuth | string, zoneId: string, roomId: string): Promise<WaitingRoomEvent[]> {
  try { return await cfFetch<WaitingRoomEvent[]>(auth, `/zones/${zoneId}/waiting_rooms/${roomId}/events`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createWaitingRoomEvent(auth: ApiAuth | string, zoneId: string, roomId: string, event: WaitingRoomEvent): Promise<WaitingRoomEvent> {
  return cfFetch<WaitingRoomEvent>(auth, `/zones/${zoneId}/waiting_rooms/${roomId}/events`, { method: 'POST', body: JSON.stringify(event) });
}

// Per-Hostname settings (Enterprise — TLS, SSL etc per-hostname overrides)
export interface HostnameSetting {
  setting_id: string;
  hostname: string;
  value: unknown;
}
export async function listHostnameSettings(auth: ApiAuth | string, zoneId: string, settingId: string): Promise<HostnameSetting[]> {
  try { return await cfFetch<HostnameSetting[]>(auth, `/zones/${zoneId}/hostnames/settings/${settingId}`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function setHostnameSetting(auth: ApiAuth | string, zoneId: string, settingId: string, hostname: string, value: unknown): Promise<HostnameSetting> {
  return cfFetch<HostnameSetting>(auth, `/zones/${zoneId}/hostnames/settings/${settingId}/${hostname}`, { method: 'PUT', body: JSON.stringify({ value }) });
}

// Origin TLS Client Auth hostname-level associations + settings
export interface OriginTlsHostnameCert {
  id?: string;
  hostname: string;
  cert_id?: string;
  enabled?: boolean;
}
export async function getOriginTlsSettings(auth: ApiAuth | string, zoneId: string): Promise<{ enabled?: boolean } | null> {
  try { return await cfFetch(auth, `/zones/${zoneId}/origin_tls_client_auth/settings`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateOriginTlsSettings(auth: ApiAuth | string, zoneId: string, body: { enabled: boolean }): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/origin_tls_client_auth/settings`, { method: 'PUT', body: JSON.stringify(body) });
}
export async function listOriginTlsHostnames(auth: ApiAuth | string, zoneId: string): Promise<OriginTlsHostnameCert[]> {
  try { return await cfFetch<OriginTlsHostnameCert[]>(auth, `/zones/${zoneId}/origin_tls_client_auth/hostnames/certificates`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}

// Certificate Authorities hostname associations (for mTLS)
export interface HostnameAssociation {
  mtls_certificate_id?: string;
  hostnames?: string[];
}
export async function getHostnameAssociations(auth: ApiAuth | string, zoneId: string): Promise<HostnameAssociation | null> {
  try { return await cfFetch<HostnameAssociation>(auth, `/zones/${zoneId}/certificate_authorities/hostname_associations`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateHostnameAssociations(auth: ApiAuth | string, zoneId: string, assoc: HostnameAssociation): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/certificate_authorities/hostname_associations`, { method: 'PUT', body: JSON.stringify(assoc) });
}

// Secrets Store (account-scoped). Used by AI Gateway BYOK and other
// integrations to hold write-only credential material centrally
// rather than embedding it per-resource.
//
// Per bucket 2.4 spike findings:
//   - The API lives at /accounts/{id}/secrets_store/stores; every
//     account has at least one default store (created on first
//     reference).
//   - Secret create body is an ARRAY of secrets (batch create).
//   - Secret value is write-only; GET returns metadata only.
//   - `scopes: ["ai_gateway"]` is the scope needed for AI Gateway
//     BYOK references.
export interface SecretsStoreStore {
  id: string;
  account_id?: string;
  name?: string;
  created?: string;
  modified?: string;
}
export interface SecretsStoreSecret {
  id: string;
  store_id?: string;
  name: string;
  comment?: string;
  scopes?: string[];
  status?: 'pending' | 'deployed' | string;
  created?: string;
  modified?: string;
}
export async function listSecretsStoreStores(auth: ApiAuth | string, accountId: string): Promise<SecretsStoreStore[]> {
  try { return await cfFetch<SecretsStoreStore[]>(auth, `/accounts/${accountId}/secrets_store/stores`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
/** Create a new Secrets Store on the destination account. Only `name`
 *  is settable; the API rejects readonly fields. The store ID is
 *  server-assigned and returned in the response — the migrator
 *  records source-id → dest-id in secretsStoreIdMap for Worker
 *  `secrets_store_secrets` binding remap. */
export async function createSecretsStoreStore(
  auth: ApiAuth | string, accountId: string, store: { name: string },
): Promise<SecretsStoreStore> {
  return cfFetch<SecretsStoreStore>(auth, `/accounts/${accountId}/secrets_store/stores`,
    { method: 'POST', body: JSON.stringify({ name: store.name }) });
}
export async function createSecretsStoreSecret(
  auth: ApiAuth | string,
  accountId: string,
  storeId: string,
  body: { name: string; value: string; scopes: string[]; comment?: string },
): Promise<SecretsStoreSecret | null> {
  // The API expects an array of secrets (batch endpoint) and
  // returns an array of created secrets. We accept a single secret
  // as the input shape (the caller usually wants one-at-a-time) and
  // unwrap the result.
  const created = await cfFetch<SecretsStoreSecret[]>(
    auth,
    `/accounts/${accountId}/secrets_store/stores/${storeId}/secrets`,
    { method: 'POST', body: JSON.stringify([body]) },
  );
  return Array.isArray(created) && created.length > 0 ? created[0] : null;
}

// mTLS certificates (account-scoped). Used by AOP, mTLS bindings,
// and Zero Trust Gateway. The private_key field on POST is write-
// only — subsequent GETs do not return it. Per bucket 2.3 spike
// findings: the API also returns "JSON decode error" on some
// successful uploads, so callers MUST list-by-name after a failed
// POST to verify whether the upload actually succeeded.
export interface MtlsCertificate {
  id?: string;
  name?: string;
  ca?: boolean;
  certificates: string;
  private_key?: string;  // write-only
  issuer?: string;
  signature?: string;
  serial_number?: string;
  type?: 'custom' | 'gateway_managed';
  expires_on?: string;
  uploaded_on?: string;
}
export async function listMtlsCertificates(auth: ApiAuth | string, accountId: string): Promise<MtlsCertificate[]> {
  try { return await cfFetch<MtlsCertificate[]>(auth, `/accounts/${accountId}/mtls_certificates`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function uploadMtlsCertificate(
  auth: ApiAuth | string,
  accountId: string,
  body: { name?: string; certificates: string; private_key: string; ca?: boolean },
): Promise<MtlsCertificate> {
  return cfFetch<MtlsCertificate>(auth, `/accounts/${accountId}/mtls_certificates`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Account-scoped: Access groups + service tokens + identity providers
export interface AccessGroup {
  id?: string;
  name: string;
  include?: unknown[];
  exclude?: unknown[];
  require?: unknown[];
}
export async function listAccessGroups(auth: ApiAuth | string, accountId: string): Promise<AccessGroup[]> {
  try { return await cfFetch<AccessGroup[]>(auth, `/accounts/${accountId}/access/groups`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createAccessGroup(auth: ApiAuth | string, accountId: string, group: AccessGroup): Promise<AccessGroup> {
  return cfFetch<AccessGroup>(auth, `/accounts/${accountId}/access/groups`, { method: 'POST', body: JSON.stringify(group) });
}
export interface AccessServiceToken {
  id?: string;
  name: string;
  client_id?: string;
  client_secret?: string;
  duration?: string;
}
export async function listAccessServiceTokens(auth: ApiAuth | string, accountId: string): Promise<AccessServiceToken[]> {
  try { return await cfFetch<AccessServiceToken[]>(auth, `/accounts/${accountId}/access/service_tokens`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createAccessServiceToken(auth: ApiAuth | string, accountId: string, token: AccessServiceToken): Promise<AccessServiceToken> {
  return cfFetch<AccessServiceToken>(auth, `/accounts/${accountId}/access/service_tokens`, { method: 'POST', body: JSON.stringify(token) });
}
export interface IdentityProvider {
  id?: string;
  name: string;
  type: string;
  config?: Record<string, unknown>;
}
export async function listIdentityProviders(auth: ApiAuth | string, accountId: string): Promise<IdentityProvider[]> {
  try { return await cfFetch<IdentityProvider[]>(auth, `/accounts/${accountId}/access/identity_providers`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createIdentityProvider(auth: ApiAuth | string, accountId: string, idp: IdentityProvider): Promise<IdentityProvider> {
  return cfFetch<IdentityProvider>(auth, `/accounts/${accountId}/access/identity_providers`, { method: 'POST', body: JSON.stringify(idp) });
}

/**
 * Access organization (a.k.a. "team domain") — the
 * `<auth_domain>.cloudflareaccess.com` subdomain the customer uses
 * for their Zero Trust login pages.
 *
 * Required for building IdP test-login URLs in Step 4. Returns
 * `null` when the account has no Access org configured yet (404 or
 * empty result). Callers should treat null as "no team domain" and
 * render a fallback message instead of constructing broken links.
 *
 * Only the two fields we actually need are typed; the full response
 * includes session/duration/auth settings we don't use.
 */
export interface AccessOrganization {
  auth_domain: string;
  name: string;
}
export async function getAccessOrganization(
  auth: ApiAuth | string,
  accountId: string,
): Promise<AccessOrganization | null> {
  try {
    const result = await cfFetch<AccessOrganization>(
      auth,
      `/accounts/${accountId}/access/organizations`,
    );
    // Treat empty/missing auth_domain as null. The Cloudflare API
    // can return an object with empty strings when the org was
    // partially provisioned but never finalised.
    if (!result || typeof result.auth_domain !== 'string' || result.auth_domain.length === 0) {
      return null;
    }
    return result;
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    // Account has no Access org yet — common for fresh accounts
    // that haven't visited the Zero Trust dashboard. Not an error.
    if (msg.includes('404') || msg.includes('not found') || msg.includes('no organization')) {
      return null;
    }
    throw e;
  }
}

// Access sub-resources for D4: tags + bookmarks + custom_pages.
// gateway_ca is read-only (the dest account auto-generates its own CA),
// so we list it for visibility but never POST.
export interface AccessTag {
  name: string;
  app_count?: number;
  created_at?: string;
  updated_at?: string;
}
export async function listAccessTags(auth: ApiAuth | string, accountId: string): Promise<AccessTag[]> {
  try { return await cfFetch<AccessTag[]>(auth, `/accounts/${accountId}/access/tags`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createAccessTag(auth: ApiAuth | string, accountId: string, tag: { name: string }): Promise<AccessTag> {
  return cfFetch<AccessTag>(auth, `/accounts/${accountId}/access/tags`, { method: 'POST', body: JSON.stringify(tag) });
}

export interface AccessBookmark {
  id?: string;
  name?: string;
  domain?: string;
  app_launcher_visible?: boolean;
  logo_url?: string;
}
export async function listAccessBookmarks(auth: ApiAuth | string, accountId: string): Promise<AccessBookmark[]> {
  try { return await cfFetch<AccessBookmark[]>(auth, `/accounts/${accountId}/access/bookmarks`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createAccessBookmark(auth: ApiAuth | string, accountId: string, bookmark: Partial<AccessBookmark>): Promise<AccessBookmark> {
  return cfFetch<AccessBookmark>(auth, `/accounts/${accountId}/access/bookmarks`, { method: 'POST', body: JSON.stringify(bookmark) });
}

export interface AccessCustomPage {
  uid?: string;
  name: string;
  type: 'identity_denied' | 'forbidden';
  custom_html: string;
  app_count?: number;
}
export async function listAccessCustomPages(auth: ApiAuth | string, accountId: string): Promise<AccessCustomPage[]> {
  try { return await cfFetch<AccessCustomPage[]>(auth, `/accounts/${accountId}/access/custom_pages`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function getAccessCustomPage(auth: ApiAuth | string, accountId: string, uid: string): Promise<AccessCustomPage> {
  return cfFetch<AccessCustomPage>(auth, `/accounts/${accountId}/access/custom_pages/${uid}`);
}
export async function createAccessCustomPage(auth: ApiAuth | string, accountId: string, page: Partial<AccessCustomPage>): Promise<AccessCustomPage> {
  return cfFetch<AccessCustomPage>(auth, `/accounts/${accountId}/access/custom_pages`, { method: 'POST', body: JSON.stringify(page) });
}

// Account-scoped: Custom lists, account rulesets
export interface CustomList {
  id?: string;
  name: string;
  kind: 'ip' | 'redirect' | 'asn' | 'hostname';
  description?: string;
  num_items?: number;
}
export async function listCustomLists(auth: ApiAuth | string, accountId: string): Promise<CustomList[]> {
  try { return await cfFetch<CustomList[]>(auth, `/accounts/${accountId}/rules/lists`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createCustomList(auth: ApiAuth | string, accountId: string, list: CustomList): Promise<CustomList> {
  // /rules/lists rejects `id`, `num_items`, and other read-only fields with
  // `filters.api.invalid_json` (code 10026). Strip down to the create-allowed
  // shape: name + kind + optional description.
  const body: { name: string; kind: string; description?: string } = {
    name: list.name,
    kind: list.kind,
  };
  if (list.description) body.description = list.description;
  return cfFetch<CustomList>(auth, `/accounts/${accountId}/rules/lists`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export interface CustomListItem {
  ip?: string;
  hostname?: { url_hostname: string };
  asn?: number;
  redirect?: { source_url: string; target_url: string; status_code?: number };
  comment?: string;
}
export async function listCustomListItems(auth: ApiAuth | string, accountId: string, listId: string): Promise<CustomListItem[]> {
  try { return await cfFetch<CustomListItem[]>(auth, `/accounts/${accountId}/rules/lists/${listId}/items`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function appendCustomListItems(auth: ApiAuth | string, accountId: string, listId: string, items: CustomListItem[]): Promise<unknown> {
  // /rules/lists/{id}/items rejects unknown fields (`id`, `created_on`,
  // `modified_on`, etc.) with `filters.api.invalid_json` (code 10026). Strip
  // each item to just the value-bearing fields the API accepts.
  const body = items.map((it) => {
    const out: CustomListItem = {};
    if (it.ip != null) out.ip = it.ip;
    if (it.hostname != null) out.hostname = it.hostname;
    if (it.asn != null) out.asn = it.asn;
    if (it.redirect != null) out.redirect = it.redirect;
    if (it.comment != null) out.comment = it.comment;
    return out;
  });
  return cfFetch(auth, `/accounts/${accountId}/rules/lists/${listId}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Queue consumers
export interface QueueConsumer {
  consumer_id?: string;
  script_name: string;
  environment?: string;
  queue_name?: string;
  settings?: { batch_size?: number; max_retries?: number; max_wait_time_ms?: number };
  dead_letter_queue?: string;
}
export async function listQueueConsumers(auth: ApiAuth | string, accountId: string, queueId: string): Promise<QueueConsumer[]> {
  try { return await cfFetch<QueueConsumer[]>(auth, `/accounts/${accountId}/queues/${queueId}/consumers`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createQueueConsumer(auth: ApiAuth | string, accountId: string, queueId: string, consumer: QueueConsumer): Promise<QueueConsumer> {
  return cfFetch<QueueConsumer>(auth, `/accounts/${accountId}/queues/${queueId}/consumers`, { method: 'POST', body: JSON.stringify(consumer) });
}

// ─── Newer zone-level features (AGENTS.md Principle 7) ──────────────────
//
// These features all pass the "would the user notice this missing on the
// destination?" test — they are zone-experience or Workers-experience
// features that travel with a zone or worker migration. They live here
// rather than scattered through the file because they were all added in a
// single pass after the override audit surfaced them as in-scope.
//
// All export-side helpers swallow not-entitled/not-found errors and
// return null/[] so the export can run on free zones without failing.

/** Custom Hostnames Fallback Origin (SaaS feature).
 *  Singleton per zone — defines the origin used when no custom hostname
 *  matches a request. */
export interface CustomHostnameFallbackOrigin {
  origin: string;
  status?: string;
}
export async function getCustomHostnameFallbackOrigin(
  auth: ApiAuth | string, zoneId: string,
): Promise<CustomHostnameFallbackOrigin | null> {
  try { return await cfFetch<CustomHostnameFallbackOrigin>(auth, `/zones/${zoneId}/custom_hostnames/fallback_origin`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateCustomHostnameFallbackOrigin(
  auth: ApiAuth | string, zoneId: string, origin: CustomHostnameFallbackOrigin,
): Promise<unknown> {
  // API rejects read-only fields; only `origin` is settable.
  return cfFetch(auth, `/zones/${zoneId}/custom_hostnames/fallback_origin`,
    { method: 'PUT', body: JSON.stringify({ origin: origin.origin }) });
}

/** AI Security zone settings — currently two singleton resources:
 *  /ai-security/settings and /ai-security/custom-topics.
 *  Both are gated behind App Sec Advanced bundle on Enterprise. */
export interface AiSecuritySettings { [k: string]: unknown }
export interface AiSecurityCustomTopics { [k: string]: unknown }
export async function getAiSecuritySettings(
  auth: ApiAuth | string, zoneId: string,
): Promise<AiSecuritySettings | null> {
  try { return await cfFetch<AiSecuritySettings>(auth, `/zones/${zoneId}/ai-security/settings`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateAiSecuritySettings(
  auth: ApiAuth | string, zoneId: string, settings: AiSecuritySettings,
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/ai-security/settings`,
    { method: 'PUT', body: JSON.stringify(settings) });
}
export async function getAiSecurityCustomTopics(
  auth: ApiAuth | string, zoneId: string,
): Promise<AiSecurityCustomTopics | null> {
  try { return await cfFetch<AiSecurityCustomTopics>(auth, `/zones/${zoneId}/ai-security/custom-topics`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateAiSecurityCustomTopics(
  auth: ApiAuth | string, zoneId: string, topics: AiSecurityCustomTopics,
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/ai-security/custom-topics`,
    { method: 'PUT', body: JSON.stringify(topics) });
}

/** Workers Observability — account-scoped log/event routing for Workers.
 *
 *  - destinations: external sinks (R2, S3, Datadog, Splunk, etc.) where
 *    Workers Logs route to. Each destination's `config` may contain a
 *    write-only `token` field that is NOT returned on GET; the binding
 *    is migratable but the token must be re-supplied (acknowledged in
 *    IMPOSSIBLE_TO_MIGRATE as worker_observability_destination_tokens).
 *  - queries: saved Workers Logs queries used to build dashboards. */
export interface WorkersObservabilityDestination {
  id?: string;
  slug?: string;
  name: string;
  type: string;       // 'r2' | 's3' | 'datadog' | 'splunk' | 'http_endpoint' | ...
  enabled?: boolean;
  config?: Record<string, unknown>;
}
export interface WorkersObservabilityQuery {
  id?: string;
  name: string;
  query: string;
  description?: string;
}
export async function listWorkersObservabilityDestinations(
  auth: ApiAuth | string, accountId: string,
): Promise<WorkersObservabilityDestination[]> {
  try { return await cfFetch<WorkersObservabilityDestination[]>(auth, `/accounts/${accountId}/workers/observability/destinations`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createWorkersObservabilityDestination(
  auth: ApiAuth | string, accountId: string, dest: WorkersObservabilityDestination,
): Promise<WorkersObservabilityDestination> {
  // Strip read-only fields. The token (if present) is included from the
  // user's Step 3 supplied values — see worker-secrets pattern.
  const body: WorkersObservabilityDestination = { ...dest };
  delete body.id;
  delete body.slug;
  return cfFetch<WorkersObservabilityDestination>(auth, `/accounts/${accountId}/workers/observability/destinations`,
    { method: 'POST', body: JSON.stringify(body) });
}
export async function listWorkersObservabilityQueries(
  auth: ApiAuth | string, accountId: string,
): Promise<WorkersObservabilityQuery[]> {
  try { return await cfFetch<WorkersObservabilityQuery[]>(auth, `/accounts/${accountId}/workers/observability/queries`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createWorkersObservabilityQuery(
  auth: ApiAuth | string, accountId: string, query: WorkersObservabilityQuery,
): Promise<WorkersObservabilityQuery> {
  const body: WorkersObservabilityQuery = { ...query };
  delete body.id;
  return cfFetch<WorkersObservabilityQuery>(auth, `/accounts/${accountId}/workers/observability/queries`,
    { method: 'POST', body: JSON.stringify(body) });
}

/** Vectorize indexes — account-scoped vector databases used as Worker
 *  bindings. The index ITSELF is migratable via POST; the vector DATA
 *  inside is data_offline (separate dump/load via the API) and is
 *  acknowledged via worker_binding_vectorize. */
export interface VectorizeIndex {
  name: string;
  description?: string;
  config: { dimensions: number; metric: 'cosine' | 'euclidean' | 'dot-product' };
  created_on?: string;
  modified_on?: string;
}
export async function listVectorizeIndexes(
  auth: ApiAuth | string, accountId: string,
): Promise<VectorizeIndex[]> {
  try { return await cfFetch<VectorizeIndex[]>(auth, `/accounts/${accountId}/vectorize/v2/indexes`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createVectorizeIndex(
  auth: ApiAuth | string, accountId: string, index: VectorizeIndex,
): Promise<VectorizeIndex> {
  const body = {
    name: index.name,
    description: index.description,
    config: index.config,
  };
  return cfFetch<VectorizeIndex>(auth, `/accounts/${accountId}/vectorize/v2/indexes`,
    { method: 'POST', body: JSON.stringify(body) });
}

/** Waiting Room zone-level settings — singleton governing zone-wide
 *  defaults (search-engine crawler bypass, etc.). Per-room config is
 *  migrated separately via `listWaitingRooms` / `createWaitingRoom`. */
export interface WaitingRoomSettings { [k: string]: unknown }
export async function getWaitingRoomSettings(
  auth: ApiAuth | string, zoneId: string,
): Promise<WaitingRoomSettings | null> {
  try { return await cfFetch<WaitingRoomSettings>(auth, `/zones/${zoneId}/waiting_rooms/settings`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateWaitingRoomSettings(
  auth: ApiAuth | string, zoneId: string, settings: WaitingRoomSettings,
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/waiting_rooms/settings`,
    { method: 'PUT', body: JSON.stringify(settings) });
}

/** Content Upload Scan zone settings — singleton toggling WAF Content
 *  Scanning for the zone. Gated by App Sec Advanced bundle, but the
 *  capability probe surfaces that as an entitlement issue (per
 *  Principle 2); the migration itself is a simple PUT. */
export interface ContentUploadScanSettings { [k: string]: unknown }
export async function getContentUploadScanSettings(
  auth: ApiAuth | string, zoneId: string,
): Promise<ContentUploadScanSettings | null> {
  try { return await cfFetch<ContentUploadScanSettings>(auth, `/zones/${zoneId}/content-upload-scan/settings`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateContentUploadScanSettings(
  auth: ApiAuth | string, zoneId: string, settings: ContentUploadScanSettings,
): Promise<unknown> {
  // PUT /content-upload-scan/settings only accepts { value: "enabled" |
  // "disabled" }. The GET (and thus the exported source value) is
  // { modified, value } — sending `modified` back returns 'invalid JSON:
  // unknown field "modified"', and passing { enabled: true } returns the same
  // for "enabled". Normalise to the single accepted field so both the migrate
  // path (source { modified, value }) and presets ({ value }) send a clean body.
  const value = (settings as { value?: unknown }).value;
  const body = value !== undefined ? { value } : settings;
  return cfFetch(auth, `/zones/${zoneId}/content-upload-scan/settings`,
    { method: 'PUT', body: JSON.stringify(body) });
}

/** Certificate Transparency (CT) Monitoring alerting subscription — zone
 *  singleton under SSL/TLS → Edge Certificates → Certificate Transparency
 *  Monitoring. Cloudflare emails the configured recipients whenever a TLS
 *  certificate for the zone's hostnames is newly logged in a public CT log;
 *  losing it after a migration is a real (if quiet) functionality loss
 *  (Principle 7), so it is migrated.
 *
 *  The GET result and PATCH body share the shape `{ enabled, emails? }`. The
 *  PATCH enforces `additionalProperties:false` and requires `enabled`, so the
 *  normalizer sends EXACTLY those fields (and `emails` only when non-empty) —
 *  replaying any read-only envelope field would yield a Bad Request that
 *  surfaces as a surprise failed row (Principle 1). `emails` is only
 *  configurable on Business/Enterprise zones; on Free/Pro the API rejects it
 *  and notifications instead go to all SSL-permissioned users, so a plan-gated
 *  rejection is classified as acknowledged by `isAcknowledgeableSingletonError`
 *  rather than failed (Principle 2). */
export interface CtAlertingSubscription {
  enabled: boolean;
  emails?: string[];
}
export function normalizeCtAlerting(sub: unknown): CtAlertingSubscription {
  const s = sub && typeof sub === 'object' && !Array.isArray(sub) ? (sub as Record<string, unknown>) : {};
  const out: CtAlertingSubscription = { enabled: s.enabled === true };
  if (Array.isArray(s.emails)) {
    const emails = s.emails.filter((e): e is string => typeof e === 'string' && e.length > 0);
    if (emails.length > 0) out.emails = emails;
  }
  return out;
}
export async function getCtAlerting(auth: ApiAuth | string, zoneId: string): Promise<CtAlertingSubscription | null> {
  try { return await cfFetch<CtAlertingSubscription>(auth, `/zones/${zoneId}/ct/alerting`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateCtAlerting(auth: ApiAuth | string, zoneId: string, sub: CtAlertingSubscription): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/ct/alerting`, { method: 'PATCH', body: JSON.stringify(normalizeCtAlerting(sub)) });
}

// Automatic Origin TLS Key Exchange (SSL/TLS → Origin Server). Dedicated
// Origin-TLS setting living behind /zones/{}/settings/auto_origin_tls_kex (NOT
// returned by the aggregate GET /settings, and its PATCH body is { enabled }
// rather than the standard { value }, so it's migrated as its own singleton).
export async function getAutoOriginTlsKex(auth: ApiAuth | string, zoneId: string): Promise<{ enabled: boolean } | null> {
  try {
    const r = await cfFetch<{ enabled?: boolean }>(auth, `/zones/${zoneId}/settings/auto_origin_tls_kex`);
    return { enabled: r?.enabled === true };
  } catch (e) {
    const msg = (e as Error).message?.toLowerCase() || '';
    if (msg.includes('not found') || msg.includes('not_found') || msg.includes('forbidden') || msg.includes('not available') || msg.includes('not enabled')) return null;
    throw e;
  }
}

export async function updateAutoOriginTlsKex(auth: ApiAuth | string, zoneId: string, enabled: boolean): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/settings/auto_origin_tls_kex`, { method: 'PATCH', body: JSON.stringify({ enabled: enabled === true }) });
}

/** Cache Origin Cloud Regions — list of IP-to-cloud-region mappings that
 *  let Tiered Cache route through the upper-tier colo co-located with
 *  the origin's cloud provider. Three write endpoints exist:
 *    - POST /cache/origin_cloud_regions (single, errors on duplicate)
 *    - PATCH /cache/origin_cloud_regions (single, upsert)
 *    - PATCH /cache/origin_cloud_regions/batch (up to 100, upsert)
 *  Migration uses the batch PATCH (one API call, idempotent, handles
 *  re-runs cleanly). The list endpoint returns a wrapped envelope with
 *  the array at `result.value`, and entries use a hyphenated `origin-ip`
 *  key — see normalisation in `listCacheOriginCloudRegions`. */
export interface CacheOriginCloudRegion {
  ip: string;
  region: string;
  vendor: 'aws' | 'azure' | 'gcp' | 'oci';
}
// Raw envelope returned by GET /cache/origin_cloud_regions — the
// mappings live at result.value and use a hyphenated key.
interface CacheOriginCloudRegionsEnvelope {
  id?: string;
  editable?: boolean;
  value?: Array<{ 'origin-ip': string; region: string; vendor: 'aws' | 'azure' | 'gcp' | 'oci'; modified_on?: string }>;
  modified_on?: string | null;
}
export async function listCacheOriginCloudRegions(
  auth: ApiAuth | string, zoneId: string,
): Promise<CacheOriginCloudRegion[]> {
  try {
    const env = await cfFetch<CacheOriginCloudRegionsEnvelope>(auth, `/zones/${zoneId}/cache/origin_cloud_regions`);
    const raw = Array.isArray(env?.value) ? env.value : [];
    // Normalise to the request-shape used by the write endpoints
    // (`ip` instead of `origin-ip`).
    return raw.map(m => ({ ip: m['origin-ip'], region: m.region, vendor: m.vendor }));
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}
export async function createCacheOriginCloudRegion(
  auth: ApiAuth | string, zoneId: string, mapping: CacheOriginCloudRegion,
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/cache/origin_cloud_regions`,
    { method: 'POST', body: JSON.stringify(mapping) });
}
export async function updateCacheOriginCloudRegion(
  auth: ApiAuth | string, zoneId: string, mapping: CacheOriginCloudRegion,
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/cache/origin_cloud_regions`,
    { method: 'PATCH', body: JSON.stringify(mapping) });
}
export async function batchUpdateCacheOriginCloudRegions(
  auth: ApiAuth | string, zoneId: string, mappings: CacheOriginCloudRegion[],
): Promise<unknown> {
  // Batch endpoint accepts up to 100 mappings; chunk if the source zone
  // has more. The API is idempotent (upsert) so chunks don't conflict.
  const CHUNK = 100;
  if (mappings.length <= CHUNK) {
    return cfFetch(auth, `/zones/${zoneId}/cache/origin_cloud_regions/batch`,
      { method: 'PATCH', body: JSON.stringify(mappings) });
  }
  const results: unknown[] = [];
  for (let i = 0; i < mappings.length; i += CHUNK) {
    const slice = mappings.slice(i, i + CHUNK);
    results.push(await cfFetch(auth, `/zones/${zoneId}/cache/origin_cloud_regions/batch`,
      { method: 'PATCH', body: JSON.stringify(slice) }));
  }
  return results;
}

/** Leaked Credential Checks — has two migrate-able pieces:
 *    1) Zone-wide enable status (GET + POST /leaked-credential-checks).
 *    2) User-defined "custom detection" patterns — pairs of ruleset
 *       expressions matching where username/password live in the
 *       request body (GET + POST + PUT /detections, DELETE /detections/{}).
 *  The default/managed detections are auto-managed by Cloudflare and
 *  are covered by the `leaked_credential_detection` IMPOSSIBLE entry. */
export interface LeakedCredentialChecksStatus { enabled?: boolean }
export interface LeakedCredentialCustomDetection {
  id?: string;
  username?: string;
  password?: string;
}
export async function getLeakedCredentialChecksStatus(
  auth: ApiAuth | string, zoneId: string,
): Promise<LeakedCredentialChecksStatus | null> {
  try { return await cfFetch<LeakedCredentialChecksStatus>(auth, `/zones/${zoneId}/leaked-credential-checks`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function setLeakedCredentialChecksStatus(
  auth: ApiAuth | string, zoneId: string, status: LeakedCredentialChecksStatus,
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/leaked-credential-checks`,
    { method: 'POST', body: JSON.stringify({ enabled: status.enabled ?? false }) });
}
export async function listLeakedCredentialCustomDetections(
  auth: ApiAuth | string, zoneId: string,
): Promise<LeakedCredentialCustomDetection[]> {
  try { return await cfFetch<LeakedCredentialCustomDetection[]>(auth, `/zones/${zoneId}/leaked-credential-checks/detections`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createLeakedCredentialCustomDetection(
  auth: ApiAuth | string, zoneId: string, detection: LeakedCredentialCustomDetection,
): Promise<LeakedCredentialCustomDetection> {
  const body: LeakedCredentialCustomDetection = {};
  if (detection.username !== undefined) body.username = detection.username;
  if (detection.password !== undefined) body.password = detection.password;
  return cfFetch<LeakedCredentialCustomDetection>(auth, `/zones/${zoneId}/leaked-credential-checks/detections`,
    { method: 'POST', body: JSON.stringify(body) });
}

/** Web3 Gateway Hostnames — CNAME-fronted IPFS / IPFS Universal Path /
 *  Ethereum gateways attached to a zone. Migrate the parent hostname
 *  via POST; the optional IPFS content block-list (only relevant for
 *  `ipfs_universal_path` targets) migrates via the full-replace PUT.
 *
 *  Removed from `IMPOSSIBLE_TO_MIGRATE.web3_gateway` in the
 *  2026-05-26 audit — the old "slugs are unique per-account" reason
 *  was incorrect (the API uses zone-scoped CNAMEs, not account slugs). */
export interface Web3Hostname {
  id?: string;
  name: string;
  target: 'ethereum' | 'ipfs' | 'ipfs_universal_path';
  description?: string;
  dnslink?: string;
  status?: 'active' | 'pending' | 'deleting' | 'error';
  created_on?: string;
  modified_on?: string;
}
export interface Web3ContentList {
  action: 'block';
  entries: { id?: string; content: string; type: 'cid' | 'content_path'; description?: string }[];
}
export async function listWeb3Hostnames(
  auth: ApiAuth | string, zoneId: string,
): Promise<Web3Hostname[]> {
  try { return await cfFetch<Web3Hostname[]>(auth, `/zones/${zoneId}/web3/hostnames`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createWeb3Hostname(
  auth: ApiAuth | string, zoneId: string, hostname: Web3Hostname,
): Promise<Web3Hostname> {
  // POST body accepts {name, target, description?, dnslink?}; server
  // assigns id/status/timestamps.
  const body: Record<string, unknown> = { name: hostname.name, target: hostname.target };
  if (hostname.description !== undefined) body.description = hostname.description;
  if (hostname.dnslink !== undefined) body.dnslink = hostname.dnslink;
  return cfFetch<Web3Hostname>(auth, `/zones/${zoneId}/web3/hostnames`,
    { method: 'POST', body: JSON.stringify(body) });
}
/** GET the IPFS Universal Path content list summary. The actual entries
 *  live at the /entries sub-resource — see listWeb3ContentListEntries. */
export async function getWeb3ContentList(
  auth: ApiAuth | string, zoneId: string, hostnameId: string,
): Promise<Web3ContentList | null> {
  try { return await cfFetch<Web3ContentList>(auth, `/zones/${zoneId}/web3/hostnames/${hostnameId}/ipfs_universal_path/content_list`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
/** List individual entries — needed at export time because the
 *  /content_list GET only returns the action, not the entries. */
export async function listWeb3ContentListEntries(
  auth: ApiAuth | string, zoneId: string, hostnameId: string,
): Promise<Web3ContentList['entries']> {
  try {
    // The list response is { entries: [...] } — cfFetch unwraps .result
    // but the entries themselves are nested under .entries.
    const env = await cfFetch<{ entries?: Web3ContentList['entries'] }>(auth, `/zones/${zoneId}/web3/hostnames/${hostnameId}/ipfs_universal_path/content_list/entries`);
    return Array.isArray(env?.entries) ? env.entries : [];
  } catch (e) {
    const m = (e as Error).message?.toLowerCase() || '';
    if (isExportTolerable(m)) return [];
    throw e;
  }
}
/** Full-replace PUT for the IPFS Universal Path content list. The body
 *  is the entire {action, entries} object — server replaces whatever
 *  was there. This is the migration hot path (one call writes the
 *  whole list). */
export async function updateWeb3ContentList(
  auth: ApiAuth | string, zoneId: string, hostnameId: string, list: Web3ContentList,
): Promise<unknown> {
  // Strip per-entry IDs/timestamps that the server assigns.
  const entries = list.entries.map(e => {
    const out: Record<string, unknown> = { content: e.content, type: e.type };
    if (e.description !== undefined) out.description = e.description;
    return out;
  });
  return cfFetch(auth, `/zones/${zoneId}/web3/hostnames/${hostnameId}/ipfs_universal_path/content_list`,
    { method: 'PUT', body: JSON.stringify({ action: list.action, entries }) });
}

/** Secondary DNS — Enterprise feature for using CF as a secondary
 *  nameserver (incoming AXFR/IXFR from a customer primary) or as a
 *  primary that ships transfers to customer secondaries (outgoing).
 *  Has two scopes:
 *
 *  Account-scoped (peers/tsigs/acls are shared across zones):
 *    - ACLs: IP allowlists (`{name, ip_range}`)
 *    - Peers: remote nameservers (`{name, ip, port, ixfr_enable, tsig_id?}`)
 *    - TSIGs: HMAC keys (`{name, algo, secret}`) — secret is write-only
 *
 *  Zone-scoped:
 *    - Incoming: `{name, auto_refresh_seconds, peers[]}` — peer IDs
 *    - Outgoing: `{name, peers[]}` — peer IDs
 *
 *  Migration order matters: TSIGs and ACLs first (no deps), then peers
 *  (reference TSIG IDs), then zone incoming/outgoing (reference peer IDs).
 *  Source→dest ID remapping is handled in the migrate code. */
export interface SecondaryDnsAcl { id?: string; name: string; ip_range: string }
export interface SecondaryDnsPeer { id?: string; name: string; ip?: string; port?: number; ixfr_enable?: boolean; tsig_id?: string }
export interface SecondaryDnsTsig { id?: string; name: string; algo: string; secret?: string }
export interface SecondaryDnsIncoming { id?: string; name?: string; auto_refresh_seconds?: number; peers?: string[] }
export interface SecondaryDnsOutgoing { id?: string; name?: string; peers?: string[] }

// Account-scoped reads
export async function listSecondaryDnsAcls(
  auth: ApiAuth | string, accountId: string,
): Promise<SecondaryDnsAcl[]> {
  try { return await cfFetch<SecondaryDnsAcl[]>(auth, `/accounts/${accountId}/secondary_dns/acls`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function listSecondaryDnsPeers(
  auth: ApiAuth | string, accountId: string,
): Promise<SecondaryDnsPeer[]> {
  try { return await cfFetch<SecondaryDnsPeer[]>(auth, `/accounts/${accountId}/secondary_dns/peers`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function listSecondaryDnsTsigs(
  auth: ApiAuth | string, accountId: string,
): Promise<SecondaryDnsTsig[]> {
  try { return await cfFetch<SecondaryDnsTsig[]>(auth, `/accounts/${accountId}/secondary_dns/tsigs`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}

// Account-scoped writes
export async function createSecondaryDnsAcl(
  auth: ApiAuth | string, accountId: string, acl: SecondaryDnsAcl,
): Promise<SecondaryDnsAcl> {
  return cfFetch<SecondaryDnsAcl>(auth, `/accounts/${accountId}/secondary_dns/acls`,
    { method: 'POST', body: JSON.stringify({ name: acl.name, ip_range: acl.ip_range }) });
}
export async function createSecondaryDnsPeer(
  auth: ApiAuth | string, accountId: string, peer: SecondaryDnsPeer,
): Promise<SecondaryDnsPeer> {
  const body: Record<string, unknown> = { name: peer.name };
  if (peer.ip !== undefined) body.ip = peer.ip;
  if (peer.port !== undefined) body.port = peer.port;
  if (peer.ixfr_enable !== undefined) body.ixfr_enable = peer.ixfr_enable;
  if (peer.tsig_id !== undefined) body.tsig_id = peer.tsig_id;
  return cfFetch<SecondaryDnsPeer>(auth, `/accounts/${accountId}/secondary_dns/peers`,
    { method: 'POST', body: JSON.stringify(body) });
}
/** Create a TSIG key. The `secret` body field is required and write-only —
 *  callers must obtain it from MigrationConfig.tsigSecrets (re-supplied
 *  by the user) since the source API never exposes the secret bytes. */
export async function createSecondaryDnsTsig(
  auth: ApiAuth | string, accountId: string, tsig: SecondaryDnsTsig,
): Promise<SecondaryDnsTsig> {
  return cfFetch<SecondaryDnsTsig>(auth, `/accounts/${accountId}/secondary_dns/tsigs`,
    { method: 'POST', body: JSON.stringify({ name: tsig.name, algo: tsig.algo, secret: tsig.secret ?? '' }) });
}

// Zone-scoped reads
export async function getSecondaryDnsIncoming(
  auth: ApiAuth | string, zoneId: string,
): Promise<SecondaryDnsIncoming | null> {
  try { return await cfFetch<SecondaryDnsIncoming>(auth, `/zones/${zoneId}/secondary_dns/incoming`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function getSecondaryDnsOutgoing(
  auth: ApiAuth | string, zoneId: string,
): Promise<SecondaryDnsOutgoing | null> {
  try { return await cfFetch<SecondaryDnsOutgoing>(auth, `/zones/${zoneId}/secondary_dns/outgoing`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}

// Zone-scoped writes
export async function createSecondaryDnsIncoming(
  auth: ApiAuth | string, zoneId: string, incoming: SecondaryDnsIncoming,
): Promise<SecondaryDnsIncoming> {
  const body: Record<string, unknown> = {};
  if (incoming.name !== undefined) body.name = incoming.name;
  if (incoming.auto_refresh_seconds !== undefined) body.auto_refresh_seconds = incoming.auto_refresh_seconds;
  if (Array.isArray(incoming.peers)) body.peers = incoming.peers;
  return cfFetch<SecondaryDnsIncoming>(auth, `/zones/${zoneId}/secondary_dns/incoming`,
    { method: 'POST', body: JSON.stringify(body) });
}
export async function createSecondaryDnsOutgoing(
  auth: ApiAuth | string, zoneId: string, outgoing: SecondaryDnsOutgoing,
): Promise<SecondaryDnsOutgoing> {
  const body: Record<string, unknown> = {};
  if (outgoing.name !== undefined) body.name = outgoing.name;
  if (Array.isArray(outgoing.peers)) body.peers = outgoing.peers;
  return cfFetch<SecondaryDnsOutgoing>(auth, `/zones/${zoneId}/secondary_dns/outgoing`,
    { method: 'POST', body: JSON.stringify(body) });
}

/** Custom Nameservers metadata — per-zone {enabled, ns_set} singleton.
 *  Account-level CNS provisioning is admin_only; this is just the
 *  per-zone ON/OFF toggle. */
export interface CustomNameserversMetadata { enabled?: boolean; ns_set?: number }
export async function getCustomNameserversMetadata(
  auth: ApiAuth | string, zoneId: string,
): Promise<CustomNameserversMetadata | null> {
  try { return await cfFetch<CustomNameserversMetadata>(auth, `/zones/${zoneId}/custom_ns`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function updateCustomNameserversMetadata(
  auth: ApiAuth | string, zoneId: string, meta: CustomNameserversMetadata,
): Promise<unknown> {
  const body: Record<string, unknown> = {};
  if (meta.enabled !== undefined) body.enabled = meta.enabled;
  if (meta.ns_set !== undefined) body.ns_set = meta.ns_set;
  return cfFetch(auth, `/zones/${zoneId}/custom_ns`,
    { method: 'PUT', body: JSON.stringify(body) });
}

/** Pay-per-Crawl configuration — singleton {enabled,
 *  price_usd_microcents, bot_overrides}. AI crawler toll
 *  monetization. */
export interface PayPerCrawlConfiguration {
  enabled?: boolean;
  price_usd_microcents?: number;
  bot_overrides?: Record<string, unknown>;
}
export async function getPayPerCrawlConfiguration(
  auth: ApiAuth | string, zoneId: string,
): Promise<PayPerCrawlConfiguration | null> {
  try { return await cfFetch<PayPerCrawlConfiguration>(auth, `/zones/${zoneId}/pay-per-crawl/configuration`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return null; throw e; }
}
export async function createPayPerCrawlConfiguration(
  auth: ApiAuth | string, zoneId: string, cfg: PayPerCrawlConfiguration,
): Promise<unknown> {
  const body: Record<string, unknown> = {};
  if (cfg.enabled !== undefined) body.enabled = cfg.enabled;
  if (cfg.price_usd_microcents !== undefined) body.price_usd_microcents = cfg.price_usd_microcents;
  if (cfg.bot_overrides !== undefined) body.bot_overrides = cfg.bot_overrides;
  return cfFetch(auth, `/zones/${zoneId}/pay-per-crawl/configuration`,
    { method: 'POST', body: JSON.stringify(body) });
}

/** Waiting Room per-room override rules. Each room has a list of
 *  `{action, expression, description?, enabled?}` rules. The
 *  full-replace PUT writes all rules for a room in one call —
 *  used as the migrate hot path. */
export interface WaitingRoomRule {
  id?: string;
  action: string;
  expression: string;
  description?: string;
  enabled?: boolean;
}
export async function listWaitingRoomRules(
  auth: ApiAuth | string, zoneId: string, roomId: string,
): Promise<WaitingRoomRule[]> {
  try { return await cfFetch<WaitingRoomRule[]>(auth, `/zones/${zoneId}/waiting_rooms/${roomId}/rules`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function replaceWaitingRoomRules(
  auth: ApiAuth | string, zoneId: string, roomId: string, rules: WaitingRoomRule[],
): Promise<unknown> {
  const body = rules.map(r => {
    const out: Record<string, unknown> = { action: r.action, expression: r.expression };
    if (r.description !== undefined) out.description = r.description;
    if (r.enabled !== undefined) out.enabled = r.enabled;
    return out;
  });
  return cfFetch(auth, `/zones/${zoneId}/waiting_rooms/${roomId}/rules`,
    { method: 'PUT', body: JSON.stringify(body) });
}

/** AI Gateway Custom Provider Costs — per-provider cost config
 *  (e.g. $/token, $/image). Account-scoped list. */
export interface AiGatewayCustomProviderCost {
  id?: string;
  name?: string;
  provider?: string;
  model?: string;
  per_token_cost?: number;
  per_image_cost?: number;
  per_audio_cost?: number;
  per_video_cost?: number;
  per_request_cost?: number;
  per_search_cost?: number;
  per_cached_token_cost?: number;
  per_output_token_cost?: number;
}
export async function listAiGatewayCustomProviderCosts(
  auth: ApiAuth | string, accountId: string,
): Promise<AiGatewayCustomProviderCost[]> {
  try { return await cfFetch<AiGatewayCustomProviderCost[]>(auth, `/accounts/${accountId}/ai-gateway/custom-providers/costs`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
export async function createAiGatewayCustomProviderCost(
  auth: ApiAuth | string, accountId: string, cost: AiGatewayCustomProviderCost,
): Promise<AiGatewayCustomProviderCost> {
  const body: Record<string, unknown> = {};
  for (const k of ['name','provider','model','per_token_cost','per_image_cost','per_audio_cost','per_video_cost','per_request_cost','per_search_cost','per_cached_token_cost','per_output_token_cost'] as const) {
    if (cost[k] !== undefined) body[k] = cost[k];
  }
  return cfFetch<AiGatewayCustomProviderCost>(auth, `/accounts/${accountId}/ai-gateway/custom-providers/costs`,
    { method: 'POST', body: JSON.stringify(body) });
}

/** AI Gateway per-gateway Provider Configs — a "bring your own key"
 *  (BYOK) binding between a gateway, a provider, and a Secrets Store
 *  secret holding the provider API key.
 *
 *  Field shape verified against the Cloudflare SDK
 *  (node_modules/cloudflare/resources/ai-gateway/provider-configs):
 *    - list/GET returns: id, alias, default_config, gateway_id,
 *      provider_slug, secret_id, secret_preview, rate_limit?,
 *      rate_limit_period?  — the raw `secret` is NEVER returned.
 *    - create/POST requires: alias, default_config, provider_slug,
 *      `secret` (the write-only key value) AND `secret_id`.
 *
 *  Because `secret` is write-only and unreadable from the source, and
 *  `secret_id` references a SOURCE-account Secrets Store secret that
 *  does not exist on the destination, a provider config cannot be
 *  re-created automatically across accounts — see the acknowledged
 *  handling in src/migrate/zone-extras.ts. This wrapper is kept honest
 *  (correct field names) for any caller that DOES have the secret. */
export interface AiGatewayProviderConfig {
  id?: string;
  alias?: string;
  default_config?: boolean;
  gateway_id?: string;
  provider_slug?: string;
  /** Write-only API key value. Never returned by GET/list. */
  secret?: string;
  /** References a Secrets Store secret on the SAME account. */
  secret_id?: string;
  /** Read-only masked preview of the stored secret (GET only). */
  secret_preview?: string;
  rate_limit?: number;
  rate_limit_period?: number;
}
export async function listAiGatewayProviderConfigs(
  auth: ApiAuth | string, accountId: string, gatewayId: string,
): Promise<AiGatewayProviderConfig[]> {
  try { return await cfFetch<AiGatewayProviderConfig[]>(auth, `/accounts/${accountId}/ai-gateway/gateways/${gatewayId}/provider_configs`); }
  catch (e) { const m = (e as Error).message?.toLowerCase() || ''; if (isExportTolerable(m)) return []; throw e; }
}
/**
 * NOTE: the migrate engine intentionally does NOT call this. BYOK provider
 * configs reference a write-only `secret` (unreadable from source) plus a
 * source-account `secret_id`, so `src/migrate/zone-extras.ts` acknowledges
 * them rather than re-creating (see that file + AiGatewayProviderConfig
 * above). This wrapper is kept correct (real field names, verified against
 * the Cloudflare SDK and pinned by test/api.test.ts) for the api-v1
 * programmatic surface and any caller that DOES hold the secret value.
 */
export async function createAiGatewayProviderConfig(
  auth: ApiAuth | string, accountId: string, gatewayId: string, cfg: AiGatewayProviderConfig,
): Promise<AiGatewayProviderConfig> {
  const body: Record<string, unknown> = {};
  if (cfg.alias !== undefined) body.alias = cfg.alias;
  if (cfg.default_config !== undefined) body.default_config = cfg.default_config;
  if (cfg.provider_slug !== undefined) body.provider_slug = cfg.provider_slug;
  if (cfg.secret !== undefined) body.secret = cfg.secret;
  if (cfg.secret_id !== undefined) body.secret_id = cfg.secret_id;
  if (cfg.rate_limit !== undefined) body.rate_limit = cfg.rate_limit;
  if (cfg.rate_limit_period !== undefined) body.rate_limit_period = cfg.rate_limit_period;
  return cfFetch<AiGatewayProviderConfig>(auth, `/accounts/${accountId}/ai-gateway/gateways/${gatewayId}/provider_configs`,
    { method: 'POST', body: JSON.stringify(body) });
}

/** Reprioritize custom certs — PUT a list of {id, priority} objects.
 *  After cert pack migration on dest, source cert IDs are remapped
 *  to dest cert IDs by hosts; the migrator builds the priority list
 *  using the remapped IDs. */
export async function prioritizeCustomCertificates(
  auth: ApiAuth | string, zoneId: string, certificates: { id: string; priority: number }[],
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/custom_certificates/prioritize`,
    { method: 'PUT', body: JSON.stringify({ certificates }) });
}

/** Origin TLS Client Auth per-hostname enable/disable + cert assignment.
 *  Writes the full per-hostname config in one PUT. Each entry is
 *  `{hostname, cert_id, enabled}`. cert_id remapping happens in the
 *  migrate code via aopMtlsBundles. */
export interface OriginTlsHostnameConfig {
  hostname: string;
  cert_id?: string;
  enabled?: boolean;
}
export async function updateOriginTlsHostnames(
  auth: ApiAuth | string, zoneId: string, configs: OriginTlsHostnameConfig[],
): Promise<unknown> {
  return cfFetch(auth, `/zones/${zoneId}/origin_tls_client_auth/hostnames`,
    { method: 'PUT', body: JSON.stringify({ config: configs }) });
}

// ---------------------------------------------------------------------------
// Generic request helpers (for OpenAPI-derived / troubleshooting exports)
// ---------------------------------------------------------------------------

export interface CfApiEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ message: string; code?: number }>;
  messages?: unknown[];
  result_info?: unknown;
}

/**
 * Low-level Cloudflare API request that returns the full JSON envelope.
 *
 * - Uses the same retry + timeout behavior as cfFetch.
 * - Does NOT throw on `success:false`; callers can inspect the envelope.
 */
export async function cfRequestEnvelope<T = unknown>(
  auth: ApiAuth | string,
  path: string,
  options: RequestInit = {},
  ctx?: RequestContext,
): Promise<CfApiEnvelope<T>> {
  const authObj: ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;
  const method = options.method || 'GET';
  const startTime = Date.now();
  let lastError: Error | null = null;

  const authType = authObj.type === 'key' ? 'API-Key' : 'Bearer';
  console.log(`[CF-API] → ${method} ${path} (envelope, auth: ${authType})`);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[CF-API] ↻ Retry ${attempt}/${MAX_RETRIES} for ${method} ${path} (waiting ${delay}ms)`);
      logApiCall({ method, path, status: 'retry', duration: Date.now() - startTime }, ctx);
      await sleep(delay);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CF_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${CF_API}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          ...getAuthHeaders(authObj),
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const err = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      lastError = err.name === 'AbortError'
        ? new Error(`Request timed out after ${CF_FETCH_TIMEOUT_MS}ms: ${method} ${path}`)
        : err;
      if (attempt === MAX_RETRIES) {
        logApiCall({ method, path, status: 'error', error: lastError.message, duration: Date.now() - startTime }, ctx);
        throw lastError;
      }
      continue;
    } finally {
      clearTimeout(timeout);
    }

    updateRateLimitFromHeaders(res.headers, ctx);

    let envelope: CfApiEnvelope<T>;
    try {
      envelope = await res.json() as CfApiEnvelope<T>;
    } catch {
      const bodySnippet = await res.text().catch(() => '(unreadable body)');
      const snippet = bodySnippet.slice(0, 200);
      const duration = Date.now() - startTime;
      const errorMessage = `Non-JSON response (HTTP ${res.status}): ${snippet}`;
      if (isRetryableError(res.status, '') && attempt < MAX_RETRIES) {
        lastError = new Error(errorMessage);
        continue;
      }
      logApiCall({ method, path, status: 'error', statusCode: res.status, error: errorMessage, duration }, ctx);
      throw new Error(errorMessage);
    }

    const duration = Date.now() - startTime;

    if (res.ok) {
      console.log(`[CF-API] ✓ ${method} ${path} → ${res.status} (${duration}ms, envelope)`);
      logApiCall({ method, path, status: envelope.success ? 'success' : 'error', statusCode: res.status, error: envelope.success ? undefined : (envelope.errors?.[0]?.message || 'API request failed'), duration }, ctx);
      return envelope;
    }

    // HTTP error - decide retry based on body error message.
    const errorMessage = envelope?.errors?.[0]?.message || `HTTP ${res.status}`;
    lastError = new Error(errorMessage);
    if (!isRetryableError(res.status, errorMessage) || attempt === MAX_RETRIES) {
      console.log(`[CF-API] ✗ ${method} ${path} → ${res.status} "${errorMessage}" (${duration}ms, envelope)`);
      logApiCall({ method, path, status: 'error', statusCode: res.status, error: errorMessage, duration }, ctx);
      return envelope;
    }
  }

  throw lastError || new Error('API request failed after retries');
}
