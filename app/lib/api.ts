// Client-side fetch wrappers for /api/* endpoints

import type { MigrationStats } from '../../src/types';
import { browserJsonRequest, browserStreamRequest } from './request';
import type { BrowserAuthMode } from './oauth';

export interface Credentials {
  authMode: BrowserAuthMode;
  useApiKey: boolean;
  apiKey: string;
  apiEmail: string;
  destApiKey: string;
  destApiEmail: string;
  sourceToken: string;
  destToken: string;
  sourceAccountId: string;
  sourceZoneId: string;
  destAccountId: string;
  domainName: string;
}

/** Auth body for source-facing API calls (export, blocker checks on source, etc.) */
function authBody(creds: Partial<Credentials>): Record<string, unknown> {
  if (creds.useApiKey) {
    return { useApiKey: true, apiKey: creds.apiKey, apiEmail: creds.apiEmail };
  }
  return { token: creds.sourceToken || creds.destToken };
}

/** Auth body for destination-facing API calls (capabilities, available plans, rollback, etc.) */
function destAuthBody(creds: Partial<Credentials>): Record<string, unknown> {
  if (creds.useApiKey) {
    // Prefer destination-specific API key credentials when provided
    const key = creds.destApiKey || creds.apiKey;
    const email = creds.destApiEmail || creds.apiEmail;
    return { useApiKey: true, apiKey: key, apiEmail: email };
  }
  return { token: creds.destToken || creds.sourceToken };
}

async function post<T = unknown>(
  url: string,
  body: Record<string, unknown>,
  authMode: BrowserAuthMode = 'manual',
): Promise<T> {
  return browserJsonRequest<T>(url, body, { authMode });
}

/** Which credential context an account/zone listing should authenticate with.
 *  'source' (default) uses the source credentials; 'dest' uses destination
 *  credentials (which fall back to the primary ones — see destAuthBody). The
 *  destination dropdowns (migration dest, and the JSON/Terraform/preset target,
 *  whose only meaningful credentials ARE the destination's) use 'dest' so they
 *  authenticate against the right account. */
export type AuthMode = 'source' | 'dest';
const authBodyFor = (creds: Partial<Credentials>, mode: AuthMode) =>
  mode === 'dest' ? destAuthBody(creds) : authBody(creds);

export async function listAccounts(creds: Partial<Credentials>, authMode: AuthMode = 'source') {
  return post<{ accounts: Array<{ id: string; name: string }> }>(
    '/api/accounts',
    { ...authBodyFor(creds, authMode), oauthRole: authMode === 'dest' ? 'destination' : 'source' },
    creds.authMode,
  );
}

export async function listZones(creds: Partial<Credentials>, accountId: string, authMode: AuthMode = 'source') {
  return post<{ zones: Array<{ id: string; name: string; status: string }> }>(
    '/api/zones',
    { ...authBodyFor(creds, authMode), accountId, oauthRole: authMode === 'dest' ? 'destination' : 'source' },
    creds.authMode,
  );
}

/** Create a brand-new zone in the given account. Used by the preset flows
 *  (All Features On / Off) to provision a fresh test zone rather than reusing
 *  an existing one. Uses source-side auth.
 *
 *  When `parentZoneId` is provided (the new zone is a subdomain of a FULL zone
 *  the same credentials control), the server also delegates: it creates NS
 *  records in the parent zone pointing at the new zone's nameservers, so the
 *  subdomain activates without a registrar change. Without it, the new zone
 *  stays `pending` until its nameservers are delegated manually. */
export async function createZone(
  creds: Partial<Credentials>,
  accountId: string,
  name: string,
  parentZoneId?: string,
  authMode: AuthMode = 'source',
) {
  return post<{
    zone: { id: string; name: string; status: string };
    nameServers: string[];
    delegated: boolean;
    delegationError?: string;
  }>(
    '/api/zones/create',
    { ...authBodyFor(creds, authMode), accountId, name, ...(parentZoneId ? { parentZoneId } : {}) },
    creds.authMode,
  );
}

export interface MonitorPingResult { status: number; ok: boolean; latencyMs: number; error?: string }

/** One host-locked uptime ping (pre-cutover monitor). The Worker derives the
 * allowed host from `sourceZoneId` server-side and rejects off-zone targets. */
export async function monitorPing(
  creds: Partial<Credentials>,
  sourceZoneId: string,
  req: { url: string; method?: string; headers?: Record<string, string>; requestBody?: string; expectedStatus?: number },
) {
  return post<MonitorPingResult>('/api/monitor/ping', { ...authBody(creds), sourceZoneId, ...req }, creds.authMode);
}

export async function validateToken(creds: Partial<Credentials>) {
  return post<{ valid: boolean; status?: string; error?: string; authType?: string }>(
    '/api/validate-token',
    creds.useApiKey
      ? { useApiKey: true, apiKey: creds.apiKey, apiEmail: creds.apiEmail }
      : { token: creds.sourceToken || creds.destToken },
    'manual',
  );
}

export interface PlannedApiCall { method: string; endpoint: string; description: string; count: number }

export interface ValidateMigrationResult {
  valid: boolean;
  errors: { type: string; message: string; suggestion?: string; feature?: string }[];
  warnings: { type: string; message: string }[];
  /** Planned WRITE calls for the full migration (drives the "Download script" button). */
  apiCalls: PlannedApiCall[];
  exportSummary?: { zoneName: string; plan: string; dnsRecords: number; workers: number; loadBalancers: number; customHostnames: number };
}

/** Dry-run validate: exports the source zone + validates against the dest WITHOUT
 * writing, and returns the planned API calls. Server re-exports so the result
 * matches exactly what a real run computes. */
export async function validateMigration(
  creds: Partial<Credentials>,
  sourceZoneId: string,
  sourceAccountId: string,
  destAccountId: string,
  domainName?: string,
) {
  return post<ValidateMigrationResult>(
    '/api/validate',
    { ...authBody(creds), sourceZoneId, sourceAccountId, destAccountId, domainName },
    creds.authMode,
  );
}

export async function checkBlockers(creds: Partial<Credentials>, sourceZoneId: string, sourceAccountId: string, destAccountId: string, domainName?: string) {
  // checkBlockers needs both source and dest auth since it checks both sides
  const dest = destAuthBody(creds);
  return post<{ blockers?: Array<{ type: string; message: string; details?: string }>; warnings?: Array<{ type: string; message: string; details?: string }> }>(
    '/api/check-blockers',
    { ...authBody(creds), destApiKey: dest.apiKey, destApiEmail: dest.apiEmail, destToken: dest.token, sourceZoneId, sourceAccountId, destAccountId, domainName },
    creds.authMode,
  );
}

export interface FeatureAvailability {
  available: boolean;
  reason?: string;
  action?: string;
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
  /** Email Routing destination addresses on the dest account. Step 2 uses this to detect forward-rule targets that need verification before migration. */
  emailRouting?: {
    destinationAddresses: { email: string; verified: boolean; tag?: string }[];
  };
}

export async function checkCapabilities(creds: Partial<Credentials>, destAccountId: string) {
  return post<{ capabilities: AccountCapabilities; existingTurnstileWidgets?: string[] }>(
    '/api/check-capabilities',
    { ...destAuthBody(creds), destAccountId },
    creds.authMode,
  );
}

// ── Email Routing destination-address verification ─────────────────────
//
// sendEmailRoutingVerification: POSTs to /accounts/{id}/email/routing/addresses
//   which causes Cloudflare to send a verification email to that address.
//   Safe to call multiple times - Cloudflare re-sends.
//
// checkEmailRoutingVerification: GETs the address list and returns the
//   verified state for the requested email. Used by the "Check status" button
//   in Step 2 to learn whether the user has clicked the verification link.

export async function sendEmailRoutingVerification(
  creds: Partial<Credentials>,
  destAccountId: string,
  email: string,
) {
  return post<{ ok: boolean; email: string; verified: boolean; tag?: string; note?: string }>(
    '/api/email-routing/send-verification',
    { ...destAuthBody(creds), destAccountId, email },
    creds.authMode,
  );
}

export async function checkEmailRoutingVerification(
  creds: Partial<Credentials>,
  destAccountId: string,
  email: string,
) {
  return post<{ email: string; exists: boolean; verified: boolean; verifiedAt?: string | null; tag?: string }>(
    '/api/email-routing/check-verification',
    { ...destAuthBody(creds), destAccountId, email },
    creds.authMode,
  );
}

export interface AvailablePlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  frequency: string;
  legacy_id: string;
  is_subscribed: boolean;
}

export async function getAvailablePlans(creds: Partial<Credentials>, destAccountId: string, domainName?: string) {
  return post<{ plans: AvailablePlan[]; planCounts: Record<string, number> }>(
    '/api/available-plans',
    { ...destAuthBody(creds), destAccountId, ...(domainName ? { domainName } : {}) },
    creds.authMode,
  );
}

export async function rdapLookup(domain: string) {
  return post<{
    domain: string; registrar?: string; status?: string[];
    hasValidStatus?: boolean; hasHold?: boolean; hasPendingDelete?: boolean;
    hasRedemption?: boolean; dnssecEnabled?: boolean; available?: boolean; error?: string;
  }>('/api/rdap', { domain });
}

export async function rollback(creds: Partial<Credentials>, destAccountId: string, createdResources: Record<string, unknown>) {
  return post<{ success: boolean; deleted: string[]; failed: string[] }>(
    '/api/rollback',
    { ...destAuthBody(creds), destAccountId, createdResources },
    creds.authMode,
  );
}

// SSE stream helper
export interface StreamPrompt {
  migrationId?: string;
  promptId: string;
  question: string;
  options: { value: string; label: string }[];
}

export interface StreamCallbacks {
  onLog: (message: string, progress?: { current: number; total: number }) => void;
  onDone: (data: Record<string, unknown>) => void;
  onError: (error: string) => void;
  onPrompt?: (prompt: StreamPrompt) => void;
  onReauthorizationRequired?: (role: 'source' | 'destination', reason: string) => void;
}

export function streamRequest(
  url: string,
  body: Record<string, unknown>,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  authMode: BrowserAuthMode = 'manual',
): Promise<void> {
  return browserStreamRequest(url, body, callbacks, { authMode, signal });
}

// ── Source-zone analytics export (spike/analytics-export) ──────────────
//
// Streams a read-only analytics snapshot of the SOURCE zone. Fired in
// parallel with the migration (non-blocking) from App.handleExecute; the
// resulting bundle is offered as a JSON download on Step 4. Analytics history
// is data_ephemeral - it cannot be migrated, so this is the only way to keep
// it before the source account goes away.
export function startAnalyticsExport(
  creds: Partial<Credentials>,
  sourceZoneId: string,
  sourceAccountId: string,
  lookbackDays: number,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  /** Per-dataset selection from Step 2. Omitted/empty = capture all available. */
  datasets?: string[],
): Promise<void> {
  return streamRequest(
    '/api/analytics/export/stream',
    {
      ...authBody(creds),
      sourceZoneId,
      sourceAccountId,
      lookbackDays,
      zoneName: creds.domainName,
      ...(datasets && datasets.length > 0 ? { datasets } : {}),
    },
    callbacks,
    signal,
    creds.authMode,
  );
}

// Per-dataset access probe for the Step 2 "Archive source analytics" section.
// Streams progress; the 'done' payload carries { probe: AnalyticsProbeResult }.
export function startAnalyticsProbe(
  creds: Partial<Credentials>,
  sourceZoneId: string,
  sourceAccountId: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  return streamRequest(
    '/api/analytics/probe/stream',
    {
      ...authBody(creds),
      sourceZoneId,
      sourceAccountId,
    },
    callbacks,
    signal,
    creds.authMode,
  );
}

/** Public, unauthenticated aggregate stats for the landing-page counter. */
export async function getStats(): Promise<MigrationStats> {
  const res = await fetch('/api/stats');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<MigrationStats>;
}

/** Daily spec-drift monitor status (src/worker/spec-monitor.ts). Mirrors the
 *  worker-side SpecStatus shape; kept local so the app doesn't import worker code. */
export type SpecStatus = {
  ok: boolean;
  checkedAt: string | null;
  lastSuccessfulCheck: string | null;
  lastFullCoverageCheck: string | null;
  fullCoverageSince: string | null;
  manifestGeneratedAt: string;
  baselineCount: number;
  liveCount: number | null;
  specEtag: string | null;
  specCommitDate: string | null;
  newEndpoints: string[];
  removedCount: number;
  drift: boolean;
  notifiedSignature: string | null;
  error: string | null;
};

/** Public, unauthenticated spec-drift status for the in-app banner. */
export async function getSpecStatus(): Promise<SpecStatus> {
  const res = await fetch('/api/spec-status');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<SpecStatus>;
}
