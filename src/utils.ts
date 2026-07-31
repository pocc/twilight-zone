import type { ApiAuth } from './api';

// Input validation constants (SI-10)
const UUID_REGEX = /^[0-9a-f]{32}$/i;
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB limit for request bodies

// Validate Cloudflare account/zone ID format (32-char hex)
export function isValidCfId(id: string | undefined): boolean {
  if (!id) return false;
  return UUID_REGEX.test(id.trim());
}

// Validate domain name format
export function isValidDomain(domain: string | undefined): boolean {
  if (!domain) return false;
  const trimmed = domain.trim();
  return trimmed.length > 0 && trimmed.length <= 253 && DOMAIN_REGEX.test(trimmed);
}

// Validate email shape (loose check; full RFC 5321 conformance is upstream's job)
export function isValidEmail(email: string | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_REGEX.test(trimmed);
}

// Validate an object of CF IDs. By default, missing/undefined fields are
// treated as optional (skipped). Pass { required: true } to require every
// listed field. Returns null on success, or a { field, message } object on
// the first failure.
//
//   const err = validateIds({ sourceZoneId, sourceAccountId }, { required: true });
//   if (err) return Response.json({ error: err.message }, { status: 400 });
export function validateIds(
  ids: Record<string, string | undefined>,
  opts: { required?: boolean } = {},
): { field: string; message: string } | null {
  for (const [field, value] of Object.entries(ids)) {
    if (value === undefined || value === '') {
      if (opts.required) return { field, message: `${field} is required` };
      continue;
    }
    if (!isValidCfId(value)) {
      return { field, message: `${field} must be a 32-character hexadecimal Cloudflare ID` };
    }
  }
  return null;
}

export function validateDomains(
  domains: Record<string, string | undefined>,
  opts: { required?: boolean } = {},
): { field: string; message: string } | null {
  for (const [field, value] of Object.entries(domains)) {
    if (value === undefined || value === '') {
      if (opts.required) return { field, message: `${field} is required` };
      continue;
    }
    if (!isValidDomain(value)) {
      return { field, message: `${field} must be a valid domain name` };
    }
  }
  return null;
}

// Validate that a value is safe to interpolate as a single URL path segment.
// Type-agnostic on purpose: Cloudflare resource identifiers are heterogeneous
// (32-hex zone/account/KV/queue ids, D1 UUIDs with dashes, and worker/bucket
// NAMES that are not hex), so isValidCfId is too strict here. No legitimate CF
// id or name contains "/", "\", "..", whitespace, or control characters — so
// rejecting those neutralises path traversal without breaking valid values.
// Used by /api/rollback to vet caller-supplied createdResources entries before
// they reach the api.delete* URL builders (defence-in-depth alongside the
// encodeURIComponent wrapping in those builders).
export function isSafePathSegment(value: string | undefined): boolean {
  if (!value) return false;
  if (value.length > 256) return false;
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\s]/.test(value)) return false;
  return true;
}

// Validate request body size
export function isBodySizeValid(contentLength: string | null): boolean {
  if (!contentLength) return true; // Let it through if not specified
  const size = parseInt(contentLength, 10);
  return !isNaN(size) && size <= MAX_BODY_SIZE;
}

// Helper to parse auth from request body - reduces duplication across endpoints
export interface AuthBody {
  token?: string;
  useApiKey?: boolean;
  apiKey?: string;
  apiEmail?: string;
}

export function parseAuth(body: AuthBody): ApiAuth | { error: string } {
  if (body.useApiKey && body.apiKey && body.apiEmail) {
    return { type: 'key', apiKey: body.apiKey.trim(), email: body.apiEmail.trim() };
  }
  if (body.token) {
    const token = body.token.trim();
    if (token.length < 10) {
      return { error: 'Valid API token required' };
    }
    return { type: 'token', token };
  }
  return { error: 'Token or API key + email required' };
}

export function isAuthError(auth: ApiAuth | { error: string }): auth is { error: string } {
  return 'error' in auth;
}

// Patterns in error messages that are safe to surface to the client. These
// are operational errors the user can act on (auth failures, upstream API
// validation messages, "already exists" / "not found", etc.). Anything not
// matching these patterns is treated as an unexpected internal error and
// the message is replaced with a generic string before being returned.
//
// Why a default-deny stance: raw `.message` strings can include Cloudflare
// API request IDs, internal codes, stack traces, hostnames, and other
// information that's useful internally but should not leak to anonymous
// HTTP callers of a public deployment.
const SAFE_ERROR_PATTERNS: RegExp[] = [
  /already exists/i,
  /not found/i,
  /unauthorized|forbidden|invalid (token|api key|email|credentials)/i,
  /validation failed/i,
  /required|must be|cannot be|invalid/i,
  /rate limit|too many requests/i,
  /not enabled|not available|subscription required/i,
  /(\d{4,5}\.\d+|code\s*[:=]\s*\d{4,5})/, // Cloudflare API codes like 10001 or "code: 10001"
  /timeout|timed out/i,
  /conflict/i,
];

// Strip information from messages even when they're surfaced: collapse
// internal hostnames, file paths, and stack-frame-looking sequences.
function redactMessage(message: string): string {
  return message
    .replace(/at\s+\S+\s+\(.+?:\d+:\d+\)/g, '[stack]')
    .replace(/\/Users\/[^/\s]+/g, '/home/$user')
    .replace(/\b[a-z0-9-]+\.cfdata\.org\b/gi, '[internal-host]')
    .replace(/\b[a-z0-9-]+\.cloudflare\.net\b/gi, '[internal-host]')
    .slice(0, 1000); // hard cap so a runaway message can't fill response
}

export interface SafeErrorOptions {
  // When provided, the prefix is preserved verbatim (it's typically a
  // handler-controlled label like "Validation:" or "Export failed:").
  prefix?: string;
  // Status code for the response. Defaults to 500.
  status?: number;
  // When set, also log the raw error to the console (for ops). Default true.
  log?: boolean;
}

// Convert an unknown thrown value into a safe { error: string } payload.
// Use directly:
//
//   return Response.json(safeError(e), { status: 500 });
//
// Or use sendSafeError for a complete Response:
//
//   return sendSafeError(e);
export function safeError(e: unknown, opts: SafeErrorOptions = {}): { error: string } {
  const raw = e instanceof Error ? e.message : String(e);
  if (opts.log !== false) {
    // eslint-disable-next-line no-console
    console.error('[TZ-Error]', raw, e instanceof Error ? e.stack : '');
  }
  const isSafe = SAFE_ERROR_PATTERNS.some(p => p.test(raw));
  const message = isSafe ? redactMessage(raw) : 'Internal error. Check worker logs.';
  return { error: opts.prefix ? `${opts.prefix} ${message}` : message };
}

/**
 * Derive the correct HTTP status for a thrown error so a *client* failure
 * (bad/expired/malformed credentials, an entitlement/"not found" 4xx from the
 * upstream Cloudflare API) is reported as a 4xx rather than a blanket 500.
 *
 * Reporting a rejected token as HTTP 500 is a lie about *whose* fault it is:
 * the caller sent bad credentials, so the honest status is 401 (per the
 * debugging-integrity rule — surface the true nature of the error, never mask
 * a client error as a server error, and vice versa). It also lets the browser
 * treat these responses as terminal rather than as transient server errors to
 * hammer on retry.
 *
 * The two tagged errors thrown by `cfFetch`/`cfFetchAll` in `src/api.ts` carry
 * a structural `_tag` discriminant, so we classify without importing `api.ts`
 * (which would create a runtime import cycle — utils only imports a `type`):
 *   - AuthError          → 401 (Cloudflare rejected the credentials)
 *   - EmptyEnvelopeError → its own upstream `.status` when that was a 4xx
 *     (e.g. 403/404 entitlement gap); otherwise fall through to 500.
 */
function hasTag(e: unknown, tag: string): e is { _tag: string; status?: number } {
  return typeof e === 'object' && e !== null && (e as { _tag?: unknown })._tag === tag;
}

export function deriveErrorStatus(e: unknown): number {
  if (hasTag(e, 'AuthError')) return 401;
  if (hasTag(e, 'EmptyEnvelopeError')) {
    const status = (e as { status?: number }).status;
    // Only trust an upstream 4xx; a 5xx (or missing) upstream status stays 500
    // because it genuinely was a server-side/transient failure.
    if (typeof status === 'number' && status >= 400 && status < 500) return status;
  }
  return 500;
}

const responseErrors = new WeakMap<Response, unknown>();

export function getResponseError(response: Response): unknown {
  return responseErrors.get(response);
}

export function sendSafeError(e: unknown, opts: SafeErrorOptions = {}): Response {
  const response = Response.json(safeError(e, opts), { status: opts.status ?? deriveErrorStatus(e) });
  responseErrors.set(response, e);
  return response;
}
