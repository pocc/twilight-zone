import { Hono } from 'hono';
import type { MigrationConfig, CertificateInput, MigrationReport, ZoneExport } from '../types';
import { diffExports, diffReportToDiscrepancies, diffReportIdentical } from '../diff';
import { exportZone, migrateZone, migrateAccountResources, generateReportMarkdown, generateDryRunPreview, filterExportData, LogFn } from '../migrate';
import { fuzzZoneSettings, fuzzZoneApiEndpoints, createMaximumConfig, createMinimumConfig, getRuleTypesList, subscribeToPlan, summarizePresetReports } from '../fuzz';
import { validateDryRun, getMigrationPhases } from '../validator';
import { parseAuth, isAuthError, AuthBody, isValidEmail, isBodySizeValid, validateIds, validateDomains, safeError, sendSafeError, isSafePathSegment } from '../utils';
import * as api from '../api';
import { generateTerraformFiles, generateTerraformBundle, terraformExportSummary, parseTerraformResources, extractAttributes } from '../terraform';
import { exportZoneTroubleshooting } from '../troubleshooting-export';
import { exportZoneOpenApiEverything } from '../openapi-export';
import { exportZoneAnalytics, probeZoneAnalytics, type AnalyticsExportBody } from '../analytics-export';
import { logMigrationRun, logRollbackRun, logPresetRun, getStatsCached, type WaitUntilContext } from '../migrate/run-log';
import { validatePingTarget, sanitizeMonitorHeaders, ALLOWED_MONITOR_METHODS, type MonitorMethod } from '../monitor';
import { APP_VERSION } from './version';
import { handleV1Route } from './api-v1';
import { checkSpecDrift, readSpecStatus } from './spec-monitor';

export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  /**
   * Beta troubleshooting telemetry: PII-stripped migration run logs + the
   * aggregate landing-page counter. Optional — when the binding is absent
   * (local dev), run-log.ts no-ops and the counter reads as zero. Also stores
   * the hourly spec-drift monitor's status under `spec-monitor:status`.
   */
  RUN_LOG?: KVNamespace;
  /**
   * Google Chat incoming-webhook URL for the hourly spec-drift monitor. Set via
   * `npx wrangler secret put NEW_API_ENDPOINT_GCHAT_WEBHOOK` (and `.dev.vars`
   * for local dev). Optional — when absent, the monitor still records status
   * for the in-app banner but sends no chat notification.
   */
  NEW_API_ENDPOINT_GCHAT_WEBHOOK?: string;
  /**
   * Google Chat incoming-webhook URL for the Step 4 "Next Steps" feedback
   * widget. Set via `npx wrangler secret put FEEDBACK_GCHAT_WEBHOOK` (and
   * `.dev.vars` for local dev). Optional — when absent, /api/feedback accepts
   * the submission and returns `{ ok: true, delivered: false }` so local dev
   * and unconfigured environments don't error.
   */
  FEEDBACK_GCHAT_WEBHOOK?: string;
}

/** Report-producing handlers receive env + ctx so they can fire-and-forget
 * a run-log write via ctx.waitUntil. Other handlers ignore the extra args. */
type RouteHandler = (request: Request, env?: Env, ctx?: WaitUntilContext) => Promise<Response>;

// Security headers for API responses
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
};

// APP_VERSION is defined in ./version and shared with the v1 API so the
// version stamped on /api/version and on logged runs never drifts.

// ── Interactive prompt system ──────────────────────────────────
// Module-level map: promptId → resolver. The migrate stream awaits a promise
// keyed by promptId; the /api/migrate/respond endpoint resolves it.
//
// promptId is a UUIDv4 (122 bits of entropy) — not a sequential counter —
// so a remote attacker cannot guess a victim's in-flight promptId and
// inject a response to /api/migrate/respond. Without this protection the
// previous `p_${++counter}_${Date.now()}` scheme was trivially guessable
// for any recent migration in the same workerd isolate.
//
// Map entries are removed on resolve/timeout. The 5-minute timeout caps the
// lifetime of any single entry.
const pendingPrompts = new Map<string, (answer: string) => void>();

// Favicon: arched mystical door (matches the header artwork's silhouette).
// Radial purple background → the door's portal aura at favicon scale.
// Silver-on-purple keeps the door readable at 16px while the violet glow
// signals the Twilight Zone theme. Designed to be recognisable at 16/32/48 px.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <defs>
    <radialGradient id="auraGrad" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#be5ad2"/>
      <stop offset="55%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#1a0a2e"/>
    </radialGradient>
    <linearGradient id="doorGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#9ca3af"/>
      <stop offset="50%" stop-color="#6b7280"/>
      <stop offset="100%" stop-color="#4b5563"/>
    </linearGradient>
  </defs>
  <!-- Aura disc -->
  <circle cx="32" cy="32" r="30" fill="url(#auraGrad)"/>
  <circle cx="32" cy="32" r="30" fill="none" stroke="#dc8ce6" stroke-width="1" opacity="0.6"/>
  <!-- Arched door frame -->
  <path d="M20 56 L20 24 Q20 12 32 12 Q44 12 44 24 L44 56 Z" fill="url(#doorGrad)" stroke="#1f2937" stroke-width="1.2"/>
  <!-- Inner door panel inset -->
  <path d="M23 53 L23 25 Q23 15 32 15 Q41 15 41 25 L41 53 Z" fill="#3b2a1a" stroke="#4b5563" stroke-width="0.5"/>
  <!-- Crescent decoration top -->
  <path d="M28 22 Q32 25 36 22" fill="none" stroke="#d4d4d8" stroke-width="0.8" stroke-linecap="round"/>
  <!-- Keyhole -->
  <circle cx="32" cy="34" r="2.5" fill="#0a0612"/>
  <rect x="31" y="35" width="2" height="5" fill="#0a0612"/>
  <!-- Hinge dots -->
  <circle cx="21.5" cy="32" r="0.8" fill="#1f2937"/>
  <circle cx="21.5" cy="42" r="0.8" fill="#1f2937"/>
</svg>`;

// Overall server-side wall-clock cap for any SSE stream. A migration/export
// run that wedges (hung upstream, pathological zone) must not hold a Worker
// stream — and connection slot — open indefinitely. On expiry we emit a final
// error event and close the stream. Normal completion clears the timer.
const SSE_MAX_DURATION_MS = 15 * 60 * 1000;

// How long an interactive mid-migration prompt waits for the user's answer
// before defaulting to the first option. Named (rather than an inline literal)
// to sit alongside SSE_MAX_DURATION_MS.
const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;

function sseWriter(maxDurationMs: number = SSE_MAX_DURATION_MS) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    writer.close().catch(() => {/* already closed */});
  };
  timer = setTimeout(() => {
    if (closed) return;
    writer
      .write(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: `Stream exceeded the maximum duration of ${Math.round(maxDurationMs / 1000)}s and was closed.` })}\n\n`))
      .catch(() => {/* stream closed */})
      .finally(finish);
  }, maxDurationMs);
  return {
    readable,
    // [W4] Handle closed stream gracefully — writer.write() can fail if client disconnects
    send(data: Record<string, unknown>) {
      if (closed) return;
      writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => {/* stream closed */});
    },
    close() { finish(); },
  };
}

// ── Hono app ───────────────────────────────────────────────────
// Replaces the previous manual `switch (pathname)` router. Each existing
// handler is a (Request) => Promise<Response>; we adapt by passing
// `c.req.raw`. Keeps handler bodies unchanged.

const app = new Hono<{ Bindings: Env }>();

// Global guards: body size, request log, and hardened response headers.
app.use('/api/*', async (c, next) => {
  console.log(`[TZ-Worker] ${c.req.method} ${c.req.path}`);
  if (!isBodySizeValid(c.req.header('content-length') ?? null)) {
    return c.json({ error: 'Request body too large (max 10MB)' }, 413);
  }
  await next();
  // Apply hardened headers to every /api/* response (JSON and SSE alike).
  // `no-store` keeps sensitive payloads (zone exports, analytics archives,
  // migration reports) out of browser/intermediary caches; `nosniff` +
  // referrer-policy are defense-in-depth. Centralised here so no individual
  // handler can forget them (this also retires the previously-unused
  // SECURITY_HEADERS constant).
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
});

// Public GET routes.
app.get('/favicon.svg', () =>
  new Response(FAVICON_SVG, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  }),
);
app.get('/favicon.ico', () =>
  new Response(FAVICON_SVG, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  }),
);
app.get('/api/version', (c) => c.json({ version: APP_VERSION }));

// Public webhook sink. Cloudflare's Notification webhook creation performs a
// live connectivity test (POST) against the destination URL and rejects the
// webhook if it does not get a 2xx. The e2e MaxConfig test (e01) needs a real,
// reachable endpoint so that notification webhook + zone-scoped policy
// migration is actually exercised (not just acknowledged). This endpoint
// returns 200 to any method and intentionally does NOT read, log, or store the
// request body — it is a side-effect-free sink, not a data endpoint, so there
// is nothing to authenticate or leak.
app.all('/api/webhook-sink', (c) => c.json({ ok: true }));

// Public, unauthenticated aggregate stats for the landing-page counter.
// Returns only non-PII totals (zones migrated + an estimated hours-saved
// figure). Safe to expose pre-auth; no per-customer data.
app.get('/api/stats', async (c) => c.json(await getStatsCached(c.env.RUN_LOG)));

// Public, unauthenticated spec-drift status for the in-app banner. Reports
// whether the live Cloudflare OpenAPI spec has write endpoints not yet in this
// tool's committed baseline (see src/worker/spec-monitor.ts). Read-only; the
// hourly cron is what performs the check and writes the KV record.
app.get('/api/spec-status', async (c) => c.json(await readSpecStatus(c.env.RUN_LOG)));

// /api/v1/* — programmatic JSON API. /docs is GET, everything else POST.
// We delegate to the existing v1 router which already enforces this. env + ctx
// are threaded through so v1 migrations can write run logs too.
app.all('/api/v1', (c) => handleV1Route(c.req.path, c.req.raw, c.env, c.executionCtx).then(r => r ?? c.json({ error: 'Not found' }, 404)));
app.all('/api/v1/', (c) => handleV1Route(c.req.path, c.req.raw, c.env, c.executionCtx).then(r => r ?? c.json({ error: 'Not found' }, 404)));
app.all('/api/v1/*', async (c) => {
  // /api/v1/docs allows GET; every other v1 route requires POST.
  if (c.req.path !== '/api/v1/docs' && c.req.method !== 'POST') {
    return c.json({ error: 'Method not allowed' }, 405);
  }
  const res = await handleV1Route(c.req.path, c.req.raw, c.env, c.executionCtx);
  return res ?? c.json({ error: 'Not found' }, 404);
});

// Step 4 "Next Steps" feedback widget. Public + unauthenticated (like
// /api/stats and /api/webhook-sink): it carries a coarse sentiment, an optional
// free-text message, and the migrator's auth EMAIL (so the team knows who to
// follow up with internally) — but never the API key/token. These are forwarded
// to a Google Chat space via an incoming webhook. The message is capped
// server-side so a single submission can't post a wall of text to the chat, and
// the email is forwarded only when it passes isValidEmail (so a malformed value
// can't inject into the chat message). Because the endpoint is unauthenticated
// the email is self-asserted by the client and could be spoofed; it is an
// identity hint for internal triage, not an authenticated claim. When no webhook
// is configured the submission is accepted but not delivered.
const FEEDBACK_SENTIMENTS = {
  hate: '\u{1F620} Hate',
  dislike: '\u{1F641} Dislike',
  like: '\u{1F642} Like',
  love: '\u{1F60D} Love',
} as const;

/**
 * Build the Google Chat message body for a feedback submission. Pure +
 * exported so the formatting/identity rules are unit-testable without a live
 * webhook (see test/feedbackMessage.test.ts).
 *
 * The migrator's email — the auth email they entered in Step 0 — is included so
 * the team can tell WHO sent the feedback and reach the right person internally
 * about that customer (most valuable for negative sentiment). The email is only
 * ever included when it passes `isValidEmail`; a valid address cannot contain
 * newlines/control chars, so this doubles as the chat-injection guard. The API
 * key/token is NEVER part of this payload — only the email identity.
 */
export function formatFeedbackMessage(label: string, message: string, email: string): string {
  let text = `*Twilight Zone feedback* — ${label}`;
  if (email) text += `\nFrom: ${email}`;
  if (message) text += `\n${message}`;
  return text;
}

async function handleFeedback(request: Request, env?: Env): Promise<Response> {
  if (!isBodySizeValid(request.headers.get('content-length'))) {
    return sendSafeError('Request body too large', { status: 413, log: false });
  }
  let body: { sentiment?: unknown; message?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return sendSafeError('Invalid JSON body', { status: 400, log: false });
  }
  const sentiment = typeof body.sentiment === 'string' ? body.sentiment : '';
  if (!(sentiment in FEEDBACK_SENTIMENTS)) {
    return sendSafeError('Invalid sentiment (expected hate|dislike|like|love)', { status: 400, log: false });
  }
  const message = typeof body.message === 'string' ? body.message.slice(0, 2000).trim() : '';
  // Only forward a well-formed email; anything else is dropped (never posted)
  // so a malformed/garbage value can't inject into the chat message.
  const emailRaw = typeof body.email === 'string' ? body.email.trim() : '';
  const email = isValidEmail(emailRaw) ? emailRaw : '';

  let delivered = false;
  const webhook = env?.FEEDBACK_GCHAT_WEBHOOK;
  if (webhook) {
    const label = FEEDBACK_SENTIMENTS[sentiment as keyof typeof FEEDBACK_SENTIMENTS];
    const text = formatFeedbackMessage(label, message, email);
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      delivered = res.ok;
    } catch {
      // Best-effort: a failed chat post must not fail the user's submission.
      delivered = false;
    }
  }
  return new Response(JSON.stringify({ ok: true, delivered }), {
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  });
}

// /api/* — UI-facing endpoints (mix of synchronous JSON + SSE streams).
// All POST. Each route is a one-line adapter to the existing handler.
const postRoutes: Array<[string, RouteHandler]> = [
  ['/api/feedback', handleFeedback],
  ['/api/migrate/stream', handleMigrateStream],
  ['/api/migrate/account-resources', handleMigrateAccountResources],
  ['/api/migrate/respond', handleMigrateRespond],
  ['/api/migrate', handleMigrate],
  ['/api/export/stream', handleExportStream],
  ['/api/export', handleExport],
  ['/api/export/troubleshooting/stream', handleExportTroubleshootingStream],
  ['/api/export/troubleshooting', handleExportTroubleshooting],
  ['/api/export/openapi/stream', handleExportOpenApiStream],
  ['/api/export/openapi', handleExportOpenApi],
  ['/api/analytics/export/stream', handleAnalyticsExportStream],
  ['/api/analytics/export', handleAnalyticsExport],
  ['/api/analytics/probe/stream', handleAnalyticsProbeStream],
  ['/api/terraform/export', handleTerraformExport],
  ['/api/terraform/export/stream', handleTerraformExportStream],
  ['/api/terraform/import/stream', handleTerraformImportStream],
  ['/api/validate-token', handleValidateToken],
  ['/api/check-blockers', handleCheckBlockers],
  ['/api/check-capabilities', handleCheckCapabilities],
  ['/api/monitor/ping', handleMonitorPing],
  ['/api/email-routing/send-verification', handleSendEmailRoutingVerification],
  ['/api/email-routing/check-verification', handleCheckEmailRoutingVerification],
  ['/api/zones', handleListZones],
  ['/api/zones/create', handleCreateZone],
  ['/api/accounts', handleListAccounts],
  ['/api/rdap', handleRdap],
  ['/api/available-plans', handleAvailablePlans],
  ['/api/validate', handleValidate],
  ['/api/rollback', handleRollback],
  ['/api/fuzz/stream', handleFuzzStream],
  ['/api/maxconfig/stream', handleMaxConfigStream],
  ['/api/minconfig/stream', handleMinConfigStream],
  ['/api/diff/stream', handleDiffStream],
];
for (const [path, handler] of postRoutes) {
  app.post(path, (c) => handler(c.req.raw, c.env, c.executionCtx));
}

// Reject non-POST on /api/* (Hono returns 404 by default for method mismatch
// on a registered POST route; we want a 405 for clarity).
app.all('/api/*', (c) => {
  if (c.req.method !== 'POST') return c.json({ error: 'Method not allowed' }, 405);
  return c.json({ error: 'Not found' }, 404);
});

// Everything else: serve static SPA assets.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

// Export both the HTTP handler and the hourly spec-drift cron. The cron is
// fire-and-forget via waitUntil; checkSpecDrift persists its own result to KV
// and never throws, so a failed check can't crash the scheduled invocation.
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(checkSpecDrift(env));
  },
} satisfies ExportedHandler<Env>;

// ── OpenAPI Everything Export ─────────────────────────────────────────
async function handleExportOpenApiStream(request: Request): Promise<Response> {
  const body = await request.json() as {
    sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
    useApiKey?: boolean; apiKey?: string; apiEmail?: string;
    limits?: { maxPages?: number; perPage?: number; maxDetailItems?: number; concurrency?: number };
  };

  const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
  const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
  if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
  if (!hasApiKey && !body.sourceToken) {
    return Response.json({ error: 'Either API token or API key + email required' }, { status: 400 });
  }

  const sse = sseWriter();
  (async () => {
    try {
      const sendLog = (message: string) => sse.send({ type: 'log', message });
      const exportData = await exportZoneOpenApiEverything(body, sendLog);
      sse.send({ type: 'done', export: exportData });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally {
      sse.close();
    }
  })().catch(() => {/* prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

async function handleExportOpenApi(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
      useApiKey?: boolean; apiKey?: string; apiEmail?: string;
      limits?: { maxPages?: number; perPage?: number; maxDetailItems?: number; concurrency?: number };
    };

    const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    if (!hasApiKey && !body.sourceToken) {
      return Response.json({ error: 'Either API token or API key + email required' }, { status: 400 });
    }

    const exportData = await exportZoneOpenApiEverything(body);
    return Response.json({ export: exportData });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Source-zone Analytics Export (spike/analytics-export) ──────
// Pulls a read-only snapshot of all queryable analytics for the SOURCE zone.
// Analytics history cannot be migrated between accounts (data_ephemeral); this
// lets the user archive it. Mirrors the troubleshooting/openapi export shape.
function parseAnalyticsBody(raw: unknown): AnalyticsExportBody {
  const body = raw as AnalyticsExportBody;
  return {
    sourceToken: body.sourceToken,
    sourceZoneId: body.sourceZoneId,
    sourceAccountId: body.sourceAccountId,
    useApiKey: body.useApiKey,
    apiKey: body.apiKey,
    apiEmail: body.apiEmail,
    lookbackDays: body.lookbackDays,
    zoneName: body.zoneName,
    datasets: Array.isArray(body.datasets) ? body.datasets : undefined,
  };
}

function validateAnalyticsBody(body: AnalyticsExportBody): Response | null {
  const idErr = validateIds(
    { sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId },
    { required: true },
  );
  if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
  const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
  if (!hasApiKey && !body.sourceToken) {
    return Response.json({ error: 'Either API token or API key + email required' }, { status: 400 });
  }
  return null;
}

async function handleAnalyticsExportStream(request: Request): Promise<Response> {
  const body = parseAnalyticsBody(await request.json());
  const invalid = validateAnalyticsBody(body);
  if (invalid) return invalid;

  const sse = sseWriter();
  (async () => {
    try {
      const exportData = await exportZoneAnalytics(body, (message) => sse.send({ type: 'log', message }));
      sse.send({ type: 'done', export: exportData });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally {
      sse.close();
    }
  })().catch(() => {/* prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

async function handleAnalyticsExport(request: Request): Promise<Response> {
  try {
    const body = parseAnalyticsBody(await request.json());
    const invalid = validateAnalyticsBody(body);
    if (invalid) return invalid;
    const exportData = await exportZoneAnalytics(body);
    return Response.json({ export: exportData });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// Per-dataset access probe for the Step 2 "Archive source analytics" section.
// Streams per-dataset progress; the final 'done' carries the availability list
// so the UI can show only datasets the source credentials can actually read.
async function handleAnalyticsProbeStream(request: Request): Promise<Response> {
  const body = parseAnalyticsBody(await request.json());
  const invalid = validateAnalyticsBody(body);
  if (invalid) return invalid;

  const sse = sseWriter();
  (async () => {
    try {
      const result = await probeZoneAnalytics(body, (message) => sse.send({ type: 'log', message }));
      sse.send({ type: 'done', probe: result });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally {
      sse.close();
    }
  })().catch(() => {/* prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

// ── Troubleshooting Export (LLM-friendly) ──────────────────────
async function handleExportTroubleshootingStream(request: Request): Promise<Response> {
  const body = await request.json() as {
    sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
    useApiKey?: boolean; apiKey?: string; apiEmail?: string;
  };

  const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
  {
    const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
    if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
  }
  if (!hasApiKey && !body.sourceToken) {
    return Response.json({ error: 'Either API token or API key + email required' }, { status: 400 });
  }

  const sse = sseWriter();
  let logCount = 0;
  const totalSteps = 12;

  (async () => {
    try {
      const sendLog = (message: string) => {
        logCount++;
        const progress = Math.min(Math.round((logCount / totalSteps) * 100), 95);
        sse.send({ type: 'log', message, progress: { current: progress, total: 100 } });
      };
      const exportData = await exportZoneTroubleshooting(body, sendLog);
      sse.send({ type: 'done', export: exportData, progress: { current: 100, total: 100 } });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally {
      sse.close();
    }
  })().catch(() => {/* prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

async function handleExportTroubleshooting(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
      useApiKey?: boolean; apiKey?: string; apiEmail?: string;
    };

    const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    if (!hasApiKey && !body.sourceToken) {
      return Response.json({ error: 'Either API token or API key + email required' }, { status: 400 });
    }

    const exportData = await exportZoneTroubleshooting(body);
    return Response.json({ export: exportData });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Streaming Migration ────────────────────────────────────────
async function handleMigrateStream(request: Request, env?: Env, ctx?: WaitUntilContext): Promise<Response> {
  const body = await request.json() as MigrationConfig & {
    customCertificates?: CertificateInput[];
    workerSecrets?: Record<string, Record<string, string>>;
    selections?: Record<string, Record<string, boolean>>;
    doMigration?: Array<{ scriptName: string; classNames: string[]; objectNames: string[]; sourceWorkerUrl: string; destWorkerUrl: string }>;
    conflictStrategy?: 'skip' | 'overwrite';
  };

  const config: MigrationConfig = {
    sourceToken: body.sourceToken,
    destToken: body.destToken,
    sourceZoneId: body.sourceZoneId,
    sourceAccountId: body.sourceAccountId,
    destAccountId: body.destAccountId,
    domainName: body.domainName,
    dryRun: body.dryRun || false,
    customCertificates: body.customCertificates,
    workerSecrets: body.workerSecrets,
    // Bucket 1: Origin CA re-issuance CSRs.
    originCaCertificates: body.originCaCertificates,
    // Bucket 2.1-2.4: inline fix-it forms supplied via Step 2.
    notificationWebhookSecrets: body.notificationWebhookSecrets,
    identityProviderSecrets: body.identityProviderSecrets,
    aopMtlsBundles: body.aopMtlsBundles,
    aiGatewayProviderApiKeys: body.aiGatewayProviderApiKeys,
    useApiKey: body.useApiKey,
    apiKey: body.apiKey,
    apiEmail: body.apiEmail,
    destApiKey: body.destApiKey,
    destApiEmail: body.destApiEmail,
    selections: body.selections,
    doMigration: body.doMigration,
    targetPlan: body.targetPlan,
    conflictStrategy: body.conflictStrategy || 'skip',
    skipAccountResources: body.skipAccountResources,
    r2Credentials: body.r2Credentials,
    acknowledgments: body.acknowledgments,
    skippedEmailAddresses: body.skippedEmailAddresses,
  };

  const hasApiKey = config.useApiKey && (config.apiKey && config.apiEmail || config.destApiKey && config.destApiEmail);
  const hasTokens = config.sourceToken && config.destToken;

  {
    const idErr = validateIds({ sourceZoneId: config.sourceZoneId, sourceAccountId: config.sourceAccountId, destAccountId: config.destAccountId }, { required: true });
    if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
  }
  if (!hasApiKey && !hasTokens) {
    return Response.json({ error: 'Either API tokens or API key + email required' }, { status: 400 });
  }

  const sse = sseWriter();

  const sendLog = (message: string, progress?: { current: number; total: number }) => {
    sse.send({ type: 'log', message, progress });
  };

  // Interactive prompt: sends a prompt event to the frontend, awaits user's response.
  // promptId uses crypto.randomUUID() — unguessable by an external party.
  const promptUser = (question: string, options: { value: string; label: string }[]): Promise<string> => {
    const promptId = crypto.randomUUID();
    return new Promise((resolve) => {
      // Default to first option after PROMPT_TIMEOUT_MS if no response
      const timeout = setTimeout(() => {
        pendingPrompts.delete(promptId);
        resolve(options[0].value);
      }, PROMPT_TIMEOUT_MS);

      pendingPrompts.set(promptId, (answer: string) => {
        clearTimeout(timeout);
        resolve(answer);
      });

      sse.send({ type: 'prompt', promptId, question, options });
    });
  };

  // Fire-and-forget IIFE; the .catch() below swallows rejections to prevent
  // unhandled-rejection warnings (errors are surfaced via SSE inside).
  // TODO: Use ctx.waitUntil() when ExecutionContext becomes available here.
  (async () => {
    try {
      api.clearAuditLog();
      const rawExportData = await exportZone(config, sendLog);
      const exportData = filterExportData(rawExportData, config.selections);

      if (config.selections) {
        sendLog('');
        sendLog('📋 Applying selection filters...');
        const filterLog: [string, number, number][] = [
          ['workers', rawExportData.workers.length, exportData.workers.length],
          ['dnsRecords', rawExportData.dnsRecords.length, exportData.dnsRecords.length],
          ['settings', rawExportData.settings.length, exportData.settings.length],
          ['rulesets', rawExportData.rulesets.length, exportData.rulesets.length],
          ['pools', rawExportData.pools.length, exportData.pools.length],
        ];
        for (const [cat, before, after] of filterLog) {
          if (before > 0 && before !== after) {
            sendLog(`   ${cat}: ${before} → ${after} (filtered ${before - after})`);
          }
        }
        const totalBefore = rawExportData.workers.length + rawExportData.dnsRecords.length + rawExportData.settings.length;
        const totalAfter = exportData.workers.length + exportData.dnsRecords.length + exportData.settings.length;
        sendLog(`✓ Filtered: ${totalAfter} items selected (from ${totalBefore} available)`);
        sendLog('');
      } else {
        sendLog('⚠️ No selections provided - migrating all items');
      }

      if (config.dryRun) {
        const destZoneName = config.domainName || exportData.zone.name;
        const preview = generateDryRunPreview(exportData, config.destAccountId, destZoneName);

        sendLog('');
        sendLog('📋 DRY RUN - API calls that would be made:');
        sendLog('─'.repeat(60));
        for (const call of preview.apiCalls) {
          sendLog(`  ${call.method.padEnd(6)} ${call.endpoint}`);
          sendLog(`         └─ ${call.description} (${call.count} call${call.count > 1 ? 's' : ''})`);
        }
        sendLog('─'.repeat(60));
        sendLog(`📊 Total: ${preview.summary.total} API calls across ${preview.summary.resourceTypes} resource types`);
        sendLog('');
        sendLog('✅ Dry run complete - no changes made');

        const auditLog = api.getAuditLog();
        sse.send({
          type: 'done',
          report: {
            timestamp: new Date().toISOString(),
            sourceZone: exportData.zone.name,
            destZone: destZoneName,
            destAccountId: config.destAccountId,
            summary: { total: preview.summary.total, success: 0, failed: 0, skipped: 0 },
            sections: [], errors: [], conflicts: [], warnings: [], manualActions: [], newNameservers: [],
          },
          reportMarkdown: '',
          auditLog,
          apiCalls: preview.apiCalls,
        });
      } else {
        const report = await migrateZone(config, exportData, sendLog, promptUser, rawExportData);
        const reportMarkdown = generateReportMarkdown(report);
        const auditLog = api.getAuditLog();
        sse.send({ type: 'done', report, reportMarkdown, auditLog });
        // Beta troubleshooting telemetry (PII-stripped, best-effort). Not
        // logged for the dry-run branch above — nothing changed on dest.
        await logMigrationRun(env, ctx, report, { kind: 'zone', toolVersion: APP_VERSION });
      }
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally {
      sse.close();
    }
  })().catch(() => {/* [C4] prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

// ── Account-level resource pre-deployment (streaming) ─────────────────
// Deploys workers, storage (KV, R2, D1, queues), LB monitors/pools,
// Access apps/policies, and Turnstile widgets to the destination account
// independently of any zone.  Called from the Account step (ScopeReview) before the zone migration.
async function handleMigrateAccountResources(request: Request, env?: Env, ctx?: WaitUntilContext): Promise<Response> {
  const body = await request.json() as MigrationConfig & {
    workerSecrets?: Record<string, Record<string, string>>;
    selections?: Record<string, Record<string, boolean>>;
  };

  const config: MigrationConfig = {
    sourceToken: body.sourceToken,
    destToken: body.destToken,
    sourceZoneId: body.sourceZoneId,
    sourceAccountId: body.sourceAccountId,
    destAccountId: body.destAccountId,
    domainName: body.domainName,
    dryRun: false,
    workerSecrets: body.workerSecrets,
    useApiKey: body.useApiKey,
    apiKey: body.apiKey,
    apiEmail: body.apiEmail,
    destApiKey: body.destApiKey,
    destApiEmail: body.destApiEmail,
    selections: body.selections,
    conflictStrategy: body.conflictStrategy,
    r2Credentials: body.r2Credentials,
  };

  const hasApiKey = config.useApiKey && (config.apiKey && config.apiEmail || config.destApiKey && config.destApiEmail);
  const hasTokens = config.sourceToken && config.destToken;

  {
    const idErr = validateIds({ sourceZoneId: config.sourceZoneId, sourceAccountId: config.sourceAccountId, destAccountId: config.destAccountId }, { required: true });
    if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
  }
  if (!hasApiKey && !hasTokens) {
    return Response.json({ error: 'Either API tokens or API key + email required' }, { status: 400 });
  }

  const sse = sseWriter();

  const sendLog = (message: string, progress?: { current: number; total: number }) => {
    sse.send({ type: 'log', message, progress });
  };

  (async () => {
    try {
      api.clearAuditLog();
      sendLog('📤 Exporting zone configuration...');
      const rawExportData = await exportZone(config, sendLog);
      const exportData = filterExportData(rawExportData, config.selections);

      sendLog('');
      const report = await migrateAccountResources(config, exportData, sendLog);
      const reportMarkdown = generateReportMarkdown(report);
      sse.send({ type: 'done', report, reportMarkdown, auditLog: api.getAuditLog() });
      await logMigrationRun(env, ctx, report, { kind: 'account-resources', toolVersion: APP_VERSION });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally {
      sse.close();
    }
  })().catch(() => {/* [C4] prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

// ── Prompt Response (side-channel for interactive migration prompts) ──
async function handleMigrateRespond(request: Request): Promise<Response> {
  const body = await request.json() as { promptId: string; answer: string };
  if (!body.promptId || !body.answer) {
    return Response.json({ error: 'promptId and answer required' }, { status: 400 });
  }
  const resolver = pendingPrompts.get(body.promptId);
  if (!resolver) {
    return Response.json({ error: 'Prompt not found or already answered' }, { status: 404 });
  }
  pendingPrompts.delete(body.promptId);
  resolver(body.answer);
  return Response.json({ ok: true });
}

// ── Non-Streaming Migration (legacy) ──────────────────────────
async function handleMigrate(request: Request, env?: Env, ctx?: WaitUntilContext): Promise<Response> {
  try {
    const body = await request.json() as MigrationConfig & {
      customCertificates?: CertificateInput[];
      workerSecrets?: Record<string, Record<string, string>>;
    };

    const config: MigrationConfig = {
      sourceToken: body.sourceToken, destToken: body.destToken,
      sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId,
      destAccountId: body.destAccountId, domainName: body.domainName,
      dryRun: body.dryRun || false, customCertificates: body.customCertificates,
      workerSecrets: body.workerSecrets, useApiKey: body.useApiKey,
      apiKey: body.apiKey, apiEmail: body.apiEmail,
      destApiKey: body.destApiKey, destApiEmail: body.destApiEmail,
      // Bucket 1 (originCaCertificates) + bucket 2.1-2.4.
      originCaCertificates: body.originCaCertificates,
      notificationWebhookSecrets: body.notificationWebhookSecrets,
      identityProviderSecrets: body.identityProviderSecrets,
      aopMtlsBundles: body.aopMtlsBundles,
      aiGatewayProviderApiKeys: body.aiGatewayProviderApiKeys,
    };

    const hasApiKey = config.useApiKey && (config.apiKey && config.apiEmail || config.destApiKey && config.destApiEmail);
    const hasTokens = config.sourceToken && config.destToken;

    {
      const idErr = validateIds({ sourceZoneId: config.sourceZoneId, sourceAccountId: config.sourceAccountId, destAccountId: config.destAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    if (!hasApiKey && !hasTokens) {
      return Response.json({ error: 'Either API tokens or API key + email required' }, { status: 400 });
    }

    const exportData = await exportZone(config);
    if (config.dryRun) {
      return Response.json({ dryRun: true, export: exportData, message: 'Dry run complete - no changes made' });
    }

    const report = await migrateZone(config, exportData);
    const reportMarkdown = generateReportMarkdown(report);
    await logMigrationRun(env, ctx, report, { kind: 'zone', toolVersion: APP_VERSION });
    return Response.json({ success: true, report, reportMarkdown });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Streaming Export ───────────────────────────────────────────
async function handleExportStream(request: Request): Promise<Response> {
  const body = await request.json() as {
    sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
    useApiKey?: boolean; apiKey?: string; apiEmail?: string;
  };

  const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
  {
    const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
    if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
  }
  if (!hasApiKey && !body.sourceToken) {
    return Response.json({ error: 'Either API token or API key + email required' }, { status: 400 });
  }

  const config: MigrationConfig = {
    sourceToken: body.sourceToken || '', destToken: '',
    sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId,
    destAccountId: '', dryRun: true,
    useApiKey: body.useApiKey, apiKey: body.apiKey, apiEmail: body.apiEmail,
  };

  const sse = sseWriter();
  let logCount = 0;
  const totalSteps = 20;

  // [C4] Add .catch() to fire-and-forget IIFE
  (async () => {
    try {
      const exportData = await exportZone(config, (message: string) => {
        logCount++;
        const progress = Math.min(Math.round((logCount / totalSteps) * 100), 95);
        sse.send({ type: 'log', message, progress: { current: progress, total: 100 } });
      });
      sse.send({ type: 'done', export: exportData, progress: { current: 100, total: 100 } });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally {
      sse.close();
    }
  })().catch(() => {/* [C4] prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

// ── Non-Streaming Export ──────────────────────────────────────
async function handleExport(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
      useApiKey?: boolean; apiKey?: string; apiEmail?: string;
    };

    const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    if (!hasApiKey && !body.sourceToken) {
      return Response.json({ error: 'Either API token or API key + email required' }, { status: 400 });
    }

    const config: MigrationConfig = {
      sourceToken: body.sourceToken || '', destToken: '',
      sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId,
      destAccountId: '', dryRun: true,
      useApiKey: body.useApiKey, apiKey: body.apiKey, apiEmail: body.apiEmail,
    };

    const exportData = await exportZone(config);
    return Response.json({ export: exportData });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Terraform Export ──────────────────────────────────────────
async function handleTerraformExport(request: Request): Promise<Response> {
  try {
    const body = await request.json() as {
      sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
      useApiKey?: boolean; apiKey?: string; apiEmail?: string;
      format?: 'bundle' | 'files';
    };

    const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    if (!hasApiKey && !body.sourceToken) {
      return Response.json({ error: 'Either API token or API key + email required' }, { status: 400 });
    }

    const config: MigrationConfig = {
      sourceToken: body.sourceToken || '', destToken: '',
      sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId,
      destAccountId: '', dryRun: true,
      useApiKey: body.useApiKey, apiKey: body.apiKey, apiEmail: body.apiEmail,
    };

    const exportData = await exportZone(config);
    if (body.format === 'files') {
      const files = generateTerraformFiles(exportData);
      const summary = terraformExportSummary(exportData);
      return Response.json({ files, summary });
    }
    const bundle = generateTerraformBundle(exportData);
    const summary = terraformExportSummary(exportData);
    return Response.json({ bundle, summary });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Terraform Export Stream ───────────────────────────────────
async function handleTerraformExportStream(request: Request): Promise<Response> {
  const body = await request.json() as {
    sourceToken?: string; sourceZoneId: string; sourceAccountId: string;
    useApiKey?: boolean; apiKey?: string; apiEmail?: string;
  };

  const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
  {
    const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId }, { required: true });
    if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
  }
  if (!hasApiKey && !body.sourceToken) {
    return Response.json({ error: 'Either API token or API key + email required' }, { status: 400 });
  }

  const config: MigrationConfig = {
    sourceToken: body.sourceToken || '', destToken: '',
    sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId,
    destAccountId: '', dryRun: true,
    useApiKey: body.useApiKey, apiKey: body.apiKey, apiEmail: body.apiEmail,
  };

  const sse = sseWriter();
  let logCount = 0;
  const totalSteps = 25;

  (async () => {
    try {
      const sendLog = (message: string) => {
        logCount++;
        const progress = Math.min(Math.round((logCount / totalSteps) * 100), 90);
        sse.send({ type: 'log', message, progress: { current: progress, total: 100 } });
      };

      sendLog('📤 Exporting zone configuration...');
      const exportData = await exportZone(config, sendLog);
      sendLog('🔧 Generating Terraform HCL files...');
      const files = generateTerraformFiles(exportData);
      const summary = terraformExportSummary(exportData);
      sendLog(`✓ Generated ${files.length} Terraform files with ${summary.totalResources} resources`);
      for (const f of summary.files) {
        sendLog(`   ${f.filename}: ${f.resourceCount} resource${f.resourceCount > 1 ? 's' : ''}`);
      }
      sse.send({ type: 'done', files, summary, progress: { current: 100, total: 100 } });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally {
      sse.close();
    }
  })().catch(() => {/* [C4] prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

// ── Terraform Import Stream ──────────────────────────────────
async function handleTerraformImportStream(request: Request): Promise<Response> {
  const body = await request.json() as {
    destToken?: string; destAccountId: string; destZoneId?: string;
    domainName?: string; useApiKey?: boolean; apiKey?: string; apiEmail?: string;
    tfContent: string; dryRun?: boolean;
  };

  const hasApiKey = body.useApiKey && body.apiKey && body.apiEmail;
  if (!body.destAccountId) return Response.json({ error: 'destAccountId required' }, { status: 400 });
  if (!hasApiKey && !body.destToken) return Response.json({ error: 'Either API token or API key + email required' }, { status: 400 });
  if (!body.tfContent) return Response.json({ error: 'tfContent required' }, { status: 400 });

  const destAuth: api.ApiAuth | string = body.useApiKey
    ? { type: 'key', apiKey: body.apiKey!, email: body.apiEmail! }
    : body.destToken!;

  const sse = sseWriter();

  (async () => {
    try {
      api.clearAuditLog();
      sse.send({ type: 'log', message: '🔍 Parsing Terraform configuration...' });
      const resources = parseTerraformResources(body.tfContent);
      sse.send({ type: 'log', message: `   Found ${resources.length} resource blocks` });

      if (resources.length === 0) {
        sse.send({ type: 'log', message: '⚠️ No resource blocks found in the uploaded .tf content' });
        sse.send({ type: 'done', applied: 0, failed: 0, skipped: 0 });
        sse.close();
        return;
      }

      const byType: Record<string, typeof resources> = {};
      for (const r of resources) {
        if (!byType[r.type]) byType[r.type] = [];
        byType[r.type].push(r);
      }
      sse.send({ type: 'log', message: `   Resource types: ${Object.keys(byType).join(', ')}` });

      let applied = 0, failed = 0, skipped = 0;
      const errors: { resource: string; error: string }[] = [];

      let zoneId = body.destZoneId || '';
      if (!zoneId && body.domainName) {
        sse.send({ type: 'log', message: `⏳ Looking up zone for ${body.domainName}...` });
        try {
          const zones = await api.listAccountZonesWithAuth(destAuth, body.destAccountId);
          const found = zones.find((z: { name: string; id: string }) => z.name === body.domainName);
          if (found) { zoneId = found.id; sse.send({ type: 'log', message: `✓ Found zone: ${found.name} (${zoneId})` }); }
          else sse.send({ type: 'log', message: `⚠️ Zone ${body.domainName} not found – zone-level resources will be skipped` });
        } catch { sse.send({ type: 'log', message: '⚠️ Could not look up zones' }); }
      }

      const isDryRun = body.dryRun === true;
      sse.send({ type: 'log', message: isDryRun ? '\n📋 DRY RUN – listing what would be applied:' : '\n🚀 Applying Terraform resources via API...' });

      // DNS records
      // [W22] Batch DNS record creation with Promise.allSettled + concurrency limit
      const dnsType = byType['cloudflare_dns_record'] ? 'cloudflare_dns_record' : (byType['cloudflare_record'] ? 'cloudflare_record' : null);
      if (dnsType) {
        sse.send({ type: 'log', message: `\n── DNS Records (${byType[dnsType].length}) ──` });
        const dnsRecords = byType[dnsType];
        const DNS_CONCURRENCY = 10;
        
        // Separate out skipped/dry-run records first
        const toCreate: typeof dnsRecords = [];
        for (const r of dnsRecords) {
          const attrs = extractAttributes(r.body);
          const name = attrs.name || r.label;
          const type = attrs.type || 'A';
          const content = attrs.content || '';
          if (!zoneId) { sse.send({ type: 'log', message: `   SKIP ${type} ${name} – no zone ID` }); skipped++; continue; }
          if (isDryRun) { sse.send({ type: 'log', message: `   WOULD CREATE ${type} ${name} → ${content}` }); applied++; continue; }
          if (!content) {
            sse.send({ type: 'log', message: `   SKIP ${type} ${name} – complex record (data/settings) not supported by inline importer` });
            skipped++;
            continue;
          }
          toCreate.push(r);
        }
        
        if (toCreate.length > 0) {
          // Concurrency-limited parallel DNS creation
          const dnsResults: PromiseSettledResult<{ r: typeof toCreate[0]; attrs: Record<string, string> }>[] = new Array(toCreate.length);
          let dnsIdx = 0;
          async function dnsWorker() {
            while (dnsIdx < toCreate.length) {
              const i = dnsIdx++;
              const r = toCreate[i];
              const attrs = extractAttributes(r.body);
              const name = attrs.name || r.label;
              const type = attrs.type || 'A';
              const content = attrs.content || '';
              const proxied = attrs.proxied === 'true';
              const ttl = parseInt(attrs.ttl || '1', 10);
              try {
                if (!content) throw new Error('Missing content (likely a data-based record)');
                await api.createDNSRecord(destAuth, zoneId, { type, name, content, proxied, ttl });
                dnsResults[i] = { status: 'fulfilled', value: { r, attrs } };
              } catch (e) {
                dnsResults[i] = { status: 'rejected', reason: e };
              }
            }
          }
          await Promise.all(Array.from({ length: Math.min(DNS_CONCURRENCY, toCreate.length) }, () => dnsWorker()));
          
          for (let i = 0; i < toCreate.length; i++) {
            const r = toCreate[i];
            const attrs = extractAttributes(r.body);
            const name = attrs.name || r.label;
            const type = attrs.type || 'A';
            const content = attrs.content || '';
            const result = dnsResults[i];
            if (result.status === 'fulfilled') {
              sse.send({ type: 'log', message: `   ✓ ${type} ${name} → ${content}` });
              applied++;
            } else {
              const msg = (result.reason as Error).message;
              sse.send({ type: 'log', message: `   ✗ ${type} ${name}: ${msg}` });
              errors.push({ resource: `DNS ${type} ${name}`, error: msg }); failed++;
            }
          }
        }
      }

      // Zone settings
      if (byType['cloudflare_zone_setting']) {
        sse.send({ type: 'log', message: `\n── Zone Settings (${byType['cloudflare_zone_setting'].length}) ──` });
        if (!zoneId) { sse.send({ type: 'log', message: '   SKIP – no zone ID' }); skipped++; }
        else {
          for (const r of byType['cloudflare_zone_setting']) {
            const attrs = extractAttributes(r.body);
            const settingId = attrs.setting_id || attrs.id || '';
            if (!settingId) { sse.send({ type: 'log', message: `   SKIP ${r.label} – missing setting_id` }); skipped++; continue; }
            const enabled = attrs.enabled;
            const valueRaw = attrs.value;
            const value: unknown = enabled !== undefined
              ? (enabled === 'true')
              : valueRaw === 'true' ? true : valueRaw === 'false' ? false : valueRaw;
            if (isDryRun) { sse.send({ type: 'log', message: `   WOULD SET ${settingId}` }); applied++; continue; }
            try {
              await api.updateZoneSetting(destAuth, zoneId, settingId, value);
              sse.send({ type: 'log', message: `   ✓ ${settingId}` });
              applied++;
            } catch (e) {
              sse.send({ type: 'log', message: `   ✗ ${settingId}: ${(e as Error).message}` });
              failed++;
            }
          }
        }
      }

      // Rulesets
      if (byType['cloudflare_ruleset']) {
        sse.send({ type: 'log', message: `\n── Rulesets (${byType['cloudflare_ruleset'].length}) ──` });
        for (const r of byType['cloudflare_ruleset']) {
          const attrs = extractAttributes(r.body);
          const phase = attrs.phase || 'unknown';
          const name = attrs.name || 'default';
          if (!zoneId) { sse.send({ type: 'log', message: `   SKIP ${phase} – no zone ID` }); skipped++; continue; }
          if (isDryRun) { sse.send({ type: 'log', message: `   WOULD CREATE ruleset ${name} (${phase})` }); applied++; continue; }
          sse.send({ type: 'log', message: `   ⚠️ Ruleset ${name} (${phase}) – complex resource, apply via terraform CLI` }); skipped++;
        }
      }

      // Page rules
      if (byType['cloudflare_page_rule']) {
        sse.send({ type: 'log', message: `\n── Page Rules (${byType['cloudflare_page_rule'].length}) ──` });
        for (const r of byType['cloudflare_page_rule']) {
          const attrs = extractAttributes(r.body);
          const target = attrs.target || '*';
          if (!zoneId) { sse.send({ type: 'log', message: `   SKIP page rule – no zone ID` }); skipped++; continue; }
          if (isDryRun) { sse.send({ type: 'log', message: `   WOULD CREATE page rule: ${target}` }); applied++; continue; }
          sse.send({ type: 'log', message: `   ⚠️ Page rule ${target} – complex resource, apply via terraform CLI` }); skipped++;
        }
      }

      // Workers
      if (byType['cloudflare_workers_script'] || byType['cloudflare_worker_script']) {
        const wType = byType['cloudflare_workers_script'] ? 'cloudflare_workers_script' : 'cloudflare_worker_script';
        sse.send({ type: 'log', message: `\n── Workers (${byType[wType].length}) ──` });
        for (const r of byType[wType]) {
          const attrs = extractAttributes(r.body);
          const workerName = attrs.script_name || attrs.name || r.label;
          if (isDryRun) { sse.send({ type: 'log', message: `   WOULD CREATE worker: ${workerName}` }); applied++; continue; }
          sse.send({ type: 'log', message: `   ⚠️ Worker ${workerName} – upload via wrangler` }); skipped++;
        }
      }

      // Worker routes
      if (byType['cloudflare_workers_route'] || byType['cloudflare_worker_route']) {
        const rType = byType['cloudflare_workers_route'] ? 'cloudflare_workers_route' : 'cloudflare_worker_route';
        sse.send({ type: 'log', message: `\n── Worker Routes (${byType[rType].length}) ──` });
        for (const r of byType[rType]) {
          const attrs = extractAttributes(r.body);
          const pattern = attrs.pattern || '*';
          const script = attrs.script || attrs.script_name || '';
          if (!zoneId) { sse.send({ type: 'log', message: `   SKIP route ${pattern} – no zone ID` }); skipped++; continue; }
          if (isDryRun) { sse.send({ type: 'log', message: `   WOULD CREATE route: ${pattern} → ${script}` }); applied++; continue; }
          try {
            await api.createWorkerRoute(destAuth, zoneId, pattern, script);
            sse.send({ type: 'log', message: `   ✓ ${pattern} → ${script}` }); applied++;
          } catch (e) {
            const msg = (e as Error).message;
            sse.send({ type: 'log', message: `   ✗ Route ${pattern}: ${msg}` }); errors.push({ resource: `Route ${pattern}`, error: msg }); failed++;
          }
        }
      }

      // KV namespaces
      if (byType['cloudflare_workers_kv_namespace']) {
        sse.send({ type: 'log', message: `\n── KV Namespaces (${byType['cloudflare_workers_kv_namespace'].length}) ──` });
        for (const r of byType['cloudflare_workers_kv_namespace']) {
          const attrs = extractAttributes(r.body);
          const title = attrs.title || r.label;
          if (isDryRun) { sse.send({ type: 'log', message: `   WOULD CREATE KV namespace: ${title}` }); applied++; continue; }
          try {
            await api.createKVNamespace(destAuth, body.destAccountId, title);
            sse.send({ type: 'log', message: `   ✓ ${title}` }); applied++;
          } catch (e) {
            const msg = (e as Error).message;
            sse.send({ type: 'log', message: `   ✗ KV ${title}: ${msg}` }); errors.push({ resource: `KV ${title}`, error: msg }); failed++;
          }
        }
      }

      // R2 buckets
      if (byType['cloudflare_r2_bucket']) {
        sse.send({ type: 'log', message: `\n── R2 Buckets (${byType['cloudflare_r2_bucket'].length}) ──` });
        for (const r of byType['cloudflare_r2_bucket']) {
          const attrs = extractAttributes(r.body);
          const bucketName = attrs.name || r.label;
          if (isDryRun) { sse.send({ type: 'log', message: `   WOULD CREATE R2 bucket: ${bucketName}` }); applied++; continue; }
          try {
            await api.createR2Bucket(destAuth, body.destAccountId, bucketName);
            sse.send({ type: 'log', message: `   ✓ ${bucketName}` }); applied++;
          } catch (e) {
            const msg = (e as Error).message;
            sse.send({ type: 'log', message: `   ✗ R2 ${bucketName}: ${msg}` }); errors.push({ resource: `R2 ${bucketName}`, error: msg }); failed++;
          }
        }
      }

      // D1 databases
      if (byType['cloudflare_d1_database']) {
        sse.send({ type: 'log', message: `\n── D1 Databases (${byType['cloudflare_d1_database'].length}) ──` });
        for (const r of byType['cloudflare_d1_database']) {
          const attrs = extractAttributes(r.body);
          const dbName = attrs.name || r.label;
          if (isDryRun) { sse.send({ type: 'log', message: `   WOULD CREATE D1 database: ${dbName}` }); applied++; continue; }
          try {
            await api.createD1Database(destAuth, body.destAccountId, dbName);
            sse.send({ type: 'log', message: `   ✓ ${dbName}` }); applied++;
          } catch (e) {
            const msg = (e as Error).message;
            sse.send({ type: 'log', message: `   ✗ D1 ${dbName}: ${msg}` }); errors.push({ resource: `D1 ${dbName}`, error: msg }); failed++;
          }
        }
      }

      // Queues
      if (byType['cloudflare_queue']) {
        sse.send({ type: 'log', message: `\n── Queues (${byType['cloudflare_queue'].length}) ──` });
        for (const r of byType['cloudflare_queue']) {
          const attrs = extractAttributes(r.body);
          const queueName = attrs.queue_name || attrs.name || r.label;
          if (isDryRun) { sse.send({ type: 'log', message: `   WOULD CREATE queue: ${queueName}` }); applied++; continue; }
          try {
            await api.createQueue(destAuth, body.destAccountId, queueName);
            sse.send({ type: 'log', message: `   ✓ ${queueName}` }); applied++;
          } catch (e) {
            const msg = (e as Error).message;
            sse.send({ type: 'log', message: `   ✗ Queue ${queueName}: ${msg}` }); errors.push({ resource: `Queue ${queueName}`, error: msg }); failed++;
          }
        }
      }

      // Summary
      sse.send({ type: 'log', message: '' });
      sse.send({ type: 'log', message: '─'.repeat(50) });
      sse.send({ type: 'log', message: `📊 ${isDryRun ? 'Dry Run' : 'Import'} Summary:` });
      sse.send({ type: 'log', message: `   ${isDryRun ? 'Would apply' : 'Applied'}: ${applied}` });
      sse.send({ type: 'log', message: `   Failed: ${failed}` });
      sse.send({ type: 'log', message: `   Skipped (complex/manual): ${skipped}` });
      if (skipped > 0) {
        sse.send({ type: 'log', message: '' });
        sse.send({ type: 'log', message: '💡 Tip: Complex resources (rulesets, workers, page rules) are best' });
        sse.send({ type: 'log', message: '   applied via `terraform apply` with the generated .tf files.' });
      }

      const auditLog = api.getAuditLog();
      sse.send({ type: 'done', applied, failed, skipped, errors, auditLog });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally {
      sse.close();
    }
  })().catch(() => {/* [C4] prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

// ── Token Validation ──────────────────────────────────────────
async function handleValidateToken(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { token?: string; useApiKey?: boolean; apiKey?: string; apiEmail?: string };
    if (body.useApiKey && body.apiKey && body.apiEmail) {
      try {
        const auth: api.ApiAuth = { type: 'key', apiKey: body.apiKey.trim(), email: body.apiEmail.trim() };
        await api.listAccountsWithAuth(auth);
        return Response.json({ valid: true, status: 'active', authType: 'api_key' });
      } catch (e: unknown) {
        // Surface the (already humanized) cause instead of a blanket
        // "Invalid API key or email" — that label is wrong for a network
        // failure and hides the specific malformed-key vs unknown-key cause.
        const err = e instanceof Error ? e : new Error(String(e));
        const isNetwork = err.name === 'AbortError' || /timed out|fetch failed|network/i.test(err.message);
        return Response.json({
          valid: false,
          status: isNetwork ? 'network_error' : 'invalid',
          error: err.message || 'Invalid API key or email',
          authType: 'api_key',
        });
      }
    }
    if (!body.token) return Response.json({ valid: false, error: 'No token provided' }, { status: 400 });
    const result = await api.verifyToken(body.token.trim());
    return Response.json({ ...result, authType: 'token' });
  } catch (e: unknown) {
    return Response.json({ valid: false, ...safeError(e) });
  }
}

// ── Check Blockers ────────────────────────────────────────────
async function handleCheckBlockers(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & {
      sourceZoneId: string; sourceAccountId: string; destAccountId: string; domainName?: string;
      destApiKey?: string; destApiEmail?: string; destToken?: string;
    };
    const sourceAuth = parseAuth(body);
    if (isAuthError(sourceAuth)) return Response.json({ error: sourceAuth.error }, { status: 400 });
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId, destAccountId: body.destAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    {
      const domErr = validateDomains({ domainName: body.domainName });
      if (domErr) return Response.json({ error: domErr.message }, { status: 400 });
    }
    // Build dest auth: prefer dest-specific credentials, fall back to source auth
    let destAuth: api.ApiAuth | string = sourceAuth;
    if (body.useApiKey && body.destApiKey && body.destApiEmail) {
      destAuth = { type: 'key', apiKey: body.destApiKey.trim(), email: body.destApiEmail.trim() };
    } else if (body.destToken) {
      destAuth = { type: 'token', token: body.destToken.trim() };
    }
    const result = await api.checkMigrationBlockers(sourceAuth, destAuth, body.sourceZoneId, body.sourceAccountId, body.destAccountId, body.domainName);
    return Response.json(result);
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Check Capabilities ────────────────────────────────────────
async function handleCheckCapabilities(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & { destAccountId: string };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
    {
      const idErr = validateIds({ destAccountId: body.destAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }

    // Run capability check and Turnstile widget listing in parallel
    const [capabilities, existingTurnstileWidgets] = await Promise.all([
      api.checkAccountCapabilities(auth, body.destAccountId),
      api.listTurnstileWidgets(auth, body.destAccountId).catch(() => []),
    ]);

    return Response.json({
      capabilities,
      existingTurnstileWidgets: existingTurnstileWidgets.map(w => w.name),
    });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Pre-cutover uptime monitor: host-locked single ping ───────
//
// The browser drives a ~1/sec loop; each tick is ONE short subrequest here. The
// target is HOST-LOCKED to the migrating zone: we resolve the canonical zone
// name server-side from the source zone ID (never trust a client-claimed
// allowlist), reject off-zone / private / metadata hosts (validatePingTarget),
// strip spoofable headers, never follow redirects, and time out fast. The
// pasted curl may carry credentials — they are used for the single fetch and
// never logged or persisted (AGENTS.md §7).
async function handleMonitorPing(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & {
      sourceZoneId: string;
      url: string;
      method?: string;
      headers?: Record<string, string>;
      requestBody?: string;
      expectedStatus?: number;
    };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
    if (typeof body.sourceZoneId !== 'string' || !body.sourceZoneId.trim()) {
      return Response.json({ error: 'sourceZoneId is required' }, { status: 400 });
    }
    if (typeof body.url !== 'string' || !body.url.trim()) {
      return Response.json({ error: 'url is required' }, { status: 400 });
    }

    // Derive the canonical migrating-zone name server-side and host-lock to it.
    let zoneName: string;
    try {
      zoneName = (await api.getZone(auth, body.sourceZoneId)).name;
    } catch {
      return Response.json({ error: 'Could not resolve the migrating zone to validate the target host.' }, { status: 400 });
    }
    const check = validatePingTarget(body.url, zoneName);
    if (!check.ok) return Response.json({ error: check.reason }, { status: 400 });

    const method = (body.method || 'GET').toUpperCase();
    if (!ALLOWED_MONITOR_METHODS.includes(method as MonitorMethod)) {
      return Response.json({ error: `Unsupported method ${method}` }, { status: 400 });
    }
    const headers = sanitizeMonitorHeaders(body.headers);
    const hasBody = method !== 'GET' && method !== 'HEAD' && typeof body.requestBody === 'string';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const started = Date.now();
    try {
      const resp = await fetch(check.url, {
        method,
        headers,
        redirect: 'manual', // never follow redirects off the locked host
        signal: controller.signal,
        body: hasBody ? body.requestBody : undefined,
      });
      const latencyMs = Date.now() - started;
      const expected = typeof body.expectedStatus === 'number' ? body.expectedStatus : undefined;
      const ok = expected !== undefined ? resp.status === expected : resp.status >= 200 && resp.status < 400;
      return Response.json({ status: resp.status, ok, latencyMs });
    } catch (e: unknown) {
      const latencyMs = Date.now() - started;
      const name = (e as Error)?.name;
      return Response.json({ status: 0, ok: false, latencyMs, error: name === 'AbortError' ? 'timeout' : (e as Error)?.message || 'fetch failed' });
    } finally {
      clearTimeout(timer);
    }
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Email Routing: Send Verification ──────────────────────────
//
// POST /accounts/{destAccountId}/email/routing/addresses {email} sends a
// verification email to that address. The address holder must click the link
// to complete verification. Safe to call multiple times — Cloudflare re-sends.
async function handleSendEmailRoutingVerification(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & { destAccountId: string; email: string };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
    {
      const idErr = validateIds({ destAccountId: body.destAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    if (!isValidEmail(body.email)) return Response.json({ error: 'email must be a valid email address' }, { status: 400 });
    try {
      const created = await api.createEmailRoutingAddress(auth, body.destAccountId, body.email);
      return Response.json({ ok: true, email: created.email, verified: !!created.verified, tag: created.tag });
    } catch (createErr: unknown) {
      // The API returns an error if the address already exists. That's fine —
      // treat as "verification email was already sent at some point" and look
      // up the current state so the client knows whether to keep waiting.
      const errMsg = createErr instanceof Error ? createErr.message : String(createErr);
      const alreadyExists = /already exists|duplicate|10000\b/i.test(errMsg);
      if (alreadyExists) {
        try {
          const list = await api.listEmailRoutingAddresses(auth, body.destAccountId);
          const existing = list.find(a => a.email.toLowerCase() === body.email.toLowerCase());
          if (existing) {
            return Response.json({
              ok: true,
              email: existing.email,
              verified: !!existing.verified,
              tag: existing.tag,
              note: 'Address already exists on the destination account; verification status unchanged.',
            });
          }
        } catch { /* fall through to error */ }
      }
      return sendSafeError(createErr);
    }
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Email Routing: Check Verification ─────────────────────────
//
// Returns the current verification state of a destination address on the
// dest account. Lets the UI poll without polling the full capabilities call.
async function handleCheckEmailRoutingVerification(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & { destAccountId: string; email: string };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
    {
      const idErr = validateIds({ destAccountId: body.destAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    if (!isValidEmail(body.email)) return Response.json({ error: 'email must be a valid email address' }, { status: 400 });
    const list = await api.listEmailRoutingAddresses(auth, body.destAccountId);
    const target = body.email.toLowerCase();
    const found = list.find(a => a.email.toLowerCase() === target);
    if (!found) {
      return Response.json({ email: body.email, exists: false, verified: false });
    }
    return Response.json({
      email: found.email,
      exists: true,
      verified: !!found.verified,
      verifiedAt: found.verified || null,
      tag: found.tag,
    });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── List Zones ────────────────────────────────────────────────
async function handleListZones(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & { accountId: string };
    const accountId = body.accountId?.trim();
    {
      const idErr = validateIds({ accountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    const auth = parseAuth(body);
    if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
    const zones = await api.listAccountZonesWithAuth(auth, accountId);
    return Response.json({ zones });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Create Zone ───────────────────────────────────────────────
// Provisions a brand-new zone in the given account. Used by the preset
// flows (All Features On / Off) so a user can spin up a fresh test zone
// and slam a preset onto it instead of selecting an existing zone. The
// new zone is created `type: 'full'` and starts as `pending` until its
// nameservers are delegated.
//
// When `parentZoneId` is supplied (the new zone is a subdomain of a FULL
// zone the same credentials control), we auto-delegate: read the new zone's
// assigned Cloudflare nameservers and create matching NS records in the
// parent zone, so the subdomain activates without a registrar change. This
// is exactly what the E2E harness does for its per-run subdomain zones.
async function handleCreateZone(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & {
      accountId: string;
      name: string;
      parentZoneId?: string;
    };
    const accountId = body.accountId?.trim();
    const name = body.name?.trim();
    const parentZoneId = body.parentZoneId?.trim();
    {
      const idErr = validateIds({ accountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    {
      const domErr = validateDomains({ name }, { required: true });
      if (domErr) return Response.json({ error: domErr.message }, { status: 400 });
    }
    if (parentZoneId) {
      const idErr = validateIds({ parentZoneId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    const auth = parseAuth(body);
    if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });

    // Orchestration (create → re-GET NS if empty → per-NS delegation) lives in
    // api.createZoneWithDelegation so it's unit-testable. Delegation failure is
    // non-fatal; sanitize its raw message before returning to the client.
    const result = await api.createZoneWithDelegation(auth, accountId!, name!, parentZoneId);

    return Response.json({
      zone: { id: result.zone.id, name: result.zone.name, status: result.zone.status },
      nameServers: result.nameServers,
      delegated: result.delegated,
      delegationError: result.delegationError
        ? safeError(new Error(result.delegationError), { log: false }).error
        : undefined,
    });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── List Accounts ─────────────────────────────────────────────
async function handleListAccounts(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody;
    const auth = parseAuth(body);
    if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
    const accounts = await api.listAccountsWithAuth(auth);
    return Response.json({ accounts });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── RDAP Lookup ───────────────────────────────────────────────
async function handleRdap(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { domain: string };
    const domain = body.domain?.trim();
    {
      const domErr = validateDomains({ domain }, { required: true });
      if (domErr) return Response.json({ error: domErr.message }, { status: 400 });
    }
    // domain is now known-valid (regex-checked above); safe to interpolate.
    // [W16] Add timeout to RDAP fetch to prevent hanging
    const rdapUrl = `https://rdap.org/domain/${encodeURIComponent(domain!)}`;
    const rdapController = new AbortController();
    const rdapTimeout = setTimeout(() => rdapController.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(rdapUrl, { headers: { 'Accept': 'application/json' }, signal: rdapController.signal });
    } catch (fetchErr) {
      clearTimeout(rdapTimeout);
      const err = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      if (err.name === 'AbortError') {
        return Response.json({ domain, error: 'RDAP lookup timed out after 10s' });
      }
      throw fetchErr;
    } finally {
      clearTimeout(rdapTimeout);
    }

    if (response.status === 404) {
      return Response.json({ domain, available: true, error: 'Domain not found in RDAP registry' });
    }
    if (!response.ok) {
      return Response.json({ domain, error: `RDAP lookup failed: ${response.status}` });
    }

    const data = await response.json() as {
      status?: string[]; entities?: Array<{ roles: string[]; vcardArray?: unknown[][] }>;
      secureDNS?: { delegationSigned?: boolean }; ldhName?: string;
    };

    const registrarEntity = data.entities?.find(e => e.roles?.includes('registrar'));
    let registrar: string | undefined;
    if (registrarEntity?.vcardArray) {
      const vcard = registrarEntity.vcardArray as unknown[][];
      if (vcard[1] && Array.isArray(vcard[1][2])) {
        registrar = (vcard[1][2] as unknown[])[3] as string | undefined;
      }
    }

    const statuses = data.status || [];
    const statusLower = statuses.map(s => s.toLowerCase());
    const validStatuses = ['active', 'ok', 'registered'];
    const hasValidStatus = statusLower.some(s => validStatuses.some(valid => s.includes(valid)));

    return Response.json({
      domain: data.ldhName || domain,
      registrar: registrar || 'Unknown',
      status: statuses,
      hasValidStatus,
      hasHold: statusLower.some(s => s.includes('hold')),
      hasPendingDelete: statusLower.some(s => s.includes('pendingdelete')),
      hasRedemption: statusLower.some(s => s.includes('redemption')),
      dnssecEnabled: data.secureDNS?.delegationSigned === true,
    });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Available Plans ────────────────────────────────────────────
async function handleAvailablePlans(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & { destAccountId: string; domainName?: string };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
    {
      const idErr = validateIds({ destAccountId: body.destAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    {
      const domErr = validateDomains({ domainName: body.domainName });
      if (domErr) return Response.json({ error: domErr.message }, { status: 400 });
    }

    // We need a zone ID to query available_plans. Look up the zone in the dest account.
    // Available plans are account-level, so any zone in the same account works.
    const destAuth = auth;
    const zones = await api.listAccountZonesWithAuth(destAuth, body.destAccountId);
    let zoneId: string | null = null;

    // First, look for the target domain in dest account (if provided)
    if (body.domainName) {
      const targetZone = zones.find((z: { name: string; id: string }) => z.name === body.domainName);
      if (targetZone) {
        zoneId = targetZone.id;
      }
    }
    // Fall back to any zone in the account — plans are account-level
    if (!zoneId && zones.length > 0) {
      zoneId = zones[0].id;
    }

    if (!zoneId) {
      // No zones in the destination account yet (common — you migrate INTO an
      // account before its zone exists). Available plans can only be read via a
      // zone, so this isn't a client error: return an empty, graceful result
      // (the UI defaults to the free tier) instead of a 400 that logs to the
      // console.
      return Response.json({ plans: [], planCounts: { free: 0, pro: 0, business: 0, enterprise: 0 } });
    }

    const plans = await api.getAvailablePlans(destAuth, zoneId);
    // Filter to only plans the account can actually subscribe to
    const subscribable = plans
      .filter((p: api.AvailableRatePlan) => p.can_subscribe)
      .map((p: api.AvailableRatePlan) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        currency: p.currency,
        frequency: p.frequency,
        legacy_id: p.legacy_id,
        is_subscribed: p.is_subscribed,
      }));

    // Count zones by plan tier in the destination account.
    // Zone plan.id is a UUID, so match by plan.name which contains the tier keyword.
    const planCounts: Record<string, number> = { free: 0, pro: 0, business: 0, enterprise: 0 };
    for (const z of zones) {
      const zoneAny = z as { plan?: { id?: string; name?: string; legacy_id?: string } };
      const legacyId = zoneAny.plan?.legacy_id?.toLowerCase() || '';
      const planName = zoneAny.plan?.name?.toLowerCase() || '';
      if (legacyId === 'enterprise' || planName.includes('enterprise')) planCounts.enterprise++;
      else if (legacyId === 'business' || planName.includes('business')) planCounts.business++;
      else if (legacyId === 'pro' || planName.includes('pro')) planCounts.pro++;
      else planCounts.free++;
    }

    return Response.json({ plans: subscribable, planCounts });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Validate ──────────────────────────────────────────────────
async function handleValidate(request: Request): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & {
      sourceZoneId: string; sourceAccountId: string; destAccountId: string; domainName?: string;
    };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
    {
      const idErr = validateIds({ sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId, destAccountId: body.destAccountId }, { required: true });
      if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    }
    {
      const domErr = validateDomains({ domainName: body.domainName });
      if (domErr) return Response.json({ error: domErr.message }, { status: 400 });
    }

    const config: MigrationConfig = {
      sourceToken: body.token || '', destToken: body.token || '',
      sourceZoneId: body.sourceZoneId, sourceAccountId: body.sourceAccountId,
      destAccountId: body.destAccountId, dryRun: true,
      useApiKey: body.useApiKey, apiKey: body.apiKey, apiEmail: body.apiEmail,
    };

    const exportData = await exportZone(config, () => {});
    const destZoneName = body.domainName || exportData.zone.name;
    const logs: string[] = [];
    const result = await validateDryRun(exportData, auth, body.destAccountId, destZoneName, (msg) => logs.push(msg));
    const phases = getMigrationPhases();
    // Planned WRITE calls for the full migration — same pure preview the
    // migrate stream uses (index.ts:555), so a downloaded script matches what
    // a real run would do. Drives the Step 2 "Download script" button (Part D).
    const preview = generateDryRunPreview(exportData, body.destAccountId, destZoneName);

    return Response.json({
      ...result, logs, phases,
      apiCalls: preview.apiCalls,
      exportSummary: {
        zoneName: exportData.zone.name, plan: exportData.zone.plan.name,
        dnsRecords: exportData.dnsRecords.length, workers: exportData.workers.length,
        loadBalancers: exportData.loadBalancers.length, customHostnames: exportData.customHostnames.length,
      },
    });
  } catch (e: unknown) {
    return sendSafeError(e);
  }
}

// ── Rollback ──────────────────────────────────────────────────
async function handleRollback(request: Request, env?: Env, ctx?: WaitUntilContext): Promise<Response> {
  try {
    const body = await request.json() as AuthBody & {
      destAccountId?: string;
      createdResources: {
        zoneId?: string; workers?: string[]; kvNamespaces?: string[];
        r2Buckets?: string[]; d1Databases?: string[]; queues?: string[];
      };
    };
    const auth = parseAuth(body);
    if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
    const idErr = validateIds({ destAccountId: body.destAccountId }, { required: true });
    if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
    const destAccountId = body.destAccountId!;

    const resources = body.createdResources || {};
    const deleted: string[] = [];
    const failed: string[] = [];

    // Vet every caller-supplied identifier before it reaches a delete URL.
    // No CF id/name contains "/" or ".."; rejecting those here gives a clear
    // error instead of a confusing upstream 404 and is defence-in-depth on top
    // of the encodeURIComponent wrapping in the api.delete* builders. Invalid
    // entries are recorded as failed and skipped — never sent to the API.
    const runDelete = async (
      kind: string,
      id: string | undefined,
      del: (value: string) => Promise<void>,
    ): Promise<void> => {
      if (id === undefined) return;
      if (!isSafePathSegment(id)) {
        failed.push(`${kind}: ${id} - rejected: invalid identifier`);
        return;
      }
      try { await del(id); deleted.push(`${kind}: ${id}`); }
      catch (e) { failed.push(`${kind}: ${id} - ${(e as Error).message}`); }
    };

    await runDelete('Zone', resources.zoneId, (z) => api.deleteZone(auth, z));
    for (const worker of resources.workers || []) {
      await runDelete('Worker', worker, (w) => api.deleteWorker(auth, destAccountId, w));
    }
    for (const kvId of resources.kvNamespaces || []) {
      await runDelete('KV Namespace', kvId, (k) => api.deleteKVNamespace(auth, destAccountId, k));
    }
    for (const bucket of resources.r2Buckets || []) {
      await runDelete('R2 Bucket', bucket, (b) => api.deleteR2Bucket(auth, destAccountId, b));
    }
    for (const dbId of resources.d1Databases || []) {
      await runDelete('D1 Database', dbId, (d) => api.deleteD1Database(auth, destAccountId, d));
    }
    for (const queueId of resources.queues || []) {
      await runDelete('Queue', queueId, (q) => api.deleteQueue(auth, destAccountId, q));
    }

    // Forensic record of a destructive operation (credential-free, never
    // counted toward migration stats). Best-effort; never blocks the response.
    logRollbackRun(env, ctx, {
      destAccountId,
      deleted: deleted.length,
      failed: failed.length,
      toolVersion: APP_VERSION,
    });

    return Response.json({ success: true, deleted, failed });
  } catch (e: unknown) {
    return Response.json({ success: false, ...safeError(e) }, { status: 500 });
  }
}

// ── Fuzz Stream ───────────────────────────────────────────────
async function handleFuzzStream(request: Request): Promise<Response> {
  const body = await request.json() as AuthBody & { zoneId: string; mode?: 'settings' | 'api' | 'all'; cleanup?: boolean };
  const auth = parseAuth(body);
  if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
  {
    const idErr = validateIds({ zoneId: body.zoneId }, { required: true });
    if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
  }

  const mode = body.mode || 'settings';
  const cleanup = body.cleanup !== false;
  const sse = sseWriter();

  (async () => {
    try {
      api.clearAuditLog();
      let settingsReport = null, apiReport = null;
      if (mode === 'settings' || mode === 'all') {
        sse.send({ type: 'log', message: '🔬 Running Zone Settings Fuzz Test...' });
        settingsReport = await fuzzZoneSettings(auth, body.zoneId, (m) => sse.send({ type: 'log', message: m }));
      }
      if (mode === 'api' || mode === 'all') {
        sse.send({ type: 'log', message: '' });
        sse.send({ type: 'log', message: '🔬 Running API Endpoints Fuzz Test...' });
        apiReport = await fuzzZoneApiEndpoints(auth, body.zoneId, (m) => sse.send({ type: 'log', message: m }), cleanup);
      }
      const auditLog = api.getAuditLog();
      sse.send({ type: 'done', settingsReport, apiReport, auditLog });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally { sse.close(); }
  })().catch(() => {/* [C4] prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

// ── MaxConfig Stream ──────────────────────────────────────────
async function handleMaxConfigStream(request: Request, env?: Env, ctx?: WaitUntilContext): Promise<Response> {
  const body = await request.json() as AuthBody & {
    zoneId: string;
    mode?: 'settings' | 'rules' | 'all';
    includeUnsafeAccountWideTrafficSettings?: boolean;
    targetPlan?: string;
    /** Telemetry only: the target zone name + whether this apply created it. */
    zoneName?: string;
    createdNewZone?: boolean;
  };
  const auth = parseAuth(body);
  if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
  {
    const idErr = validateIds({ zoneId: body.zoneId }, { required: true });
    if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
  }

  const mode = body.mode || 'all';
  const sse = sseWriter();

  (async () => {
    try {
      api.clearAuditLog();
      // Apply the user-selected License first so plan-gated zone settings (run
      // in the settings phase below) can take effect on the upgraded plan.
      if (body.targetPlan) {
        await subscribeToPlan(auth, body.zoneId, body.targetPlan, (m) => sse.send({ type: 'log', message: m }));
        sse.send({ type: 'log', message: '' });
      }
      let settingsReport = null, rulesReport = null, apiReport = null;
      if (mode === 'settings' || mode === 'all') {
        settingsReport = await fuzzZoneSettings(auth, body.zoneId, (m) => sse.send({ type: 'log', message: m }));
        sse.send({ type: 'log', message: '' });
      }
      if (mode === 'rules' || mode === 'all') {
        rulesReport = await createMaximumConfig(auth, body.zoneId, (m) => sse.send({ type: 'log', message: m }), {
          includeUnsafeAccountWideTrafficSettings: body.includeUnsafeAccountWideTrafficSettings === true,
        });
        sse.send({ type: 'log', message: '' });
      }
      if (mode === 'all') {
        sse.send({ type: 'log', message: '🔬 Running API Endpoints Fuzz Test (MaxConfig extension)...' });
        // For MaxConfig we intentionally DO NOT clean up — the goal is maximum surface area.
        apiReport = await fuzzZoneApiEndpoints(auth, body.zoneId, (m) => sse.send({ type: 'log', message: m }), false);
      }
      const auditLog = api.getAuditLog();
      sse.send({ type: 'done', settingsReport, rulesReport, apiReport, auditLog });
      // Run-log telemetry: counts toward the landing total only if this apply
      // created a brand-new zone (see logPresetRun). Best-effort, never throws.
      await logPresetRun(env, ctx, {
        kind: 'maxconfig',
        destZone: body.zoneName || body.zoneId,
        createdNewZone: body.createdNewZone === true,
        failed: summarizePresetReports([settingsReport, rulesReport, apiReport]).summary.failed,
        toolVersion: APP_VERSION,
      });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally { sse.close(); }
  })().catch(() => {/* [C4] prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

// ── MinConfig Stream ──────────────────────────────────────────
async function handleMinConfigStream(request: Request, env?: Env, ctx?: WaitUntilContext): Promise<Response> {
  const body = await request.json() as AuthBody & {
    zoneId: string;
    targetPlan?: string;
    /** Telemetry only: the target zone name + whether this apply created it. */
    zoneName?: string;
    createdNewZone?: boolean;
  };
  const auth = parseAuth(body);
  if (isAuthError(auth)) return Response.json({ error: auth.error }, { status: 400 });
  {
    const idErr = validateIds({ zoneId: body.zoneId }, { required: true });
    if (idErr) return Response.json({ error: idErr.message }, { status: 400 });
  }

  const sse = sseWriter();

  (async () => {
    try {
      api.clearAuditLog();
      // Apply the user-selected License as part of the reset (e.g. downgrade to
      // Free). Explicit pick = consent for the billing change.
      if (body.targetPlan) {
        await subscribeToPlan(auth, body.zoneId, body.targetPlan, (m) => sse.send({ type: 'log', message: m }));
        sse.send({ type: 'log', message: '' });
      }
      const report = await createMinimumConfig(auth, body.zoneId, (m) => sse.send({ type: 'log', message: m }));
      const auditLog = api.getAuditLog();
      sse.send({ type: 'done', report, auditLog });
      // Run-log telemetry: counts only when this apply created a new zone.
      await logPresetRun(env, ctx, {
        kind: 'minconfig',
        destZone: body.zoneName || body.zoneId,
        createdNewZone: body.createdNewZone === true,
        failed: summarizePresetReports([report]).summary.failed,
        toolVersion: APP_VERSION,
      });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally { sse.close(); }
  })().catch(() => {/* [C4] prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}

// ── Diff Stream ───────────────────────────────────────────────
// Pure source-vs-destination comparison of two already-exported zones. The
// client (Step 4 "Verify against destination") exports the destination zone,
// then POSTs both exports here. We compute the diff in-process — no live API
// calls, hence no auth required — and return the discrepancies in the shape
// Step 4 renders (MigrationReport.verification.diff.discrepancies). Previously
// this route was unregistered, so the Verify button 404'd silently.
async function handleDiffStream(request: Request): Promise<Response> {
  const body = await request.json() as { sourceExport?: ZoneExport; destExport?: ZoneExport };
  if (!body.sourceExport || !body.destExport) {
    return Response.json({ error: 'Both sourceExport and destExport are required' }, { status: 400 });
  }

  const sse = sseWriter();
  (async () => {
    try {
      sse.send({ type: 'log', message: '🔍 Comparing source and destination configuration...' });
      const report = diffExports(body.sourceExport!, body.destExport!);
      const discrepancies = diffReportToDiscrepancies(report);
      // `identical` (skip items) drives the Step 2 "already identical on
      // destination" graying; the Step 4 verify view ignores it and reads
      // `discrepancies`.
      const identical = diffReportIdentical(report);
      sse.send({
        type: 'log',
        message: discrepancies.length === 0
          ? '✓ No discrepancies found — destination matches source.'
          : `⚠️ ${discrepancies.length} discrepanc${discrepancies.length === 1 ? 'y' : 'ies'} found.`,
      });
      sse.send({ type: 'done', discrepancies, identical, summary: report.summary });
    } catch (e: unknown) {
      sse.send({ type: 'error', ...safeError(e) });
    } finally { sse.close(); }
  })().catch(() => {/* [C4] prevent unhandled rejection */});

  return new Response(sse.readable, { headers: SSE_HEADERS });
}
