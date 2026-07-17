// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Migration run logging — beta troubleshooting telemetry.
// ════════════════════════════════════════════════════════════════════════
//
// Twilight Zone is in beta and still has bugs. To debug failures users hit in
// the field, we persist a PII-stripped projection of each completed migration
// to the RUN_LOG KV namespace. This module is the single place that decides
// WHAT gets logged and HOW it is redacted.
//
// Two hard guarantees, in priority order:
//
//   1. CREDENTIALS ARE NEVER LOGGED. API tokens, API keys, worker secrets,
//      certificate private keys, mTLS bundles, etc. live ONLY on
//      MigrationConfig — they are never copied onto MigrationReport, and this
//      module only ever touches MigrationReport. We never accept or serialise
//      MigrationConfig here. This preserves the product's load-bearing promise
//      ("your tokens are never stored, logged, or persisted server-side")
//      verbatim.
//
//   2. NO PII. We use an ALLOWLIST projection (buildRunLogRecord) — only the
//      fields enumerated below are ever written. The full
//      `verification.destExport` ZoneExport is deliberately dropped: it
//      carries DNS/origin IPs and email-routing addresses we do not need to
//      see which resources failed. As defense-in-depth, every free-text field
//      that survives the allowlist (error strings, item names, warnings,
//      manual actions) is additionally run through redactPII() to strip any
//      email address or IP that leaked in from a Cloudflare API error body.
//
// Zone names and account IDs ARE kept on purpose: they are what makes a logged
// run actionable when investigating an error. They are not treated as PII for
// this tool's purposes (a zone name is the thing being migrated).
//
// Writes are best-effort and fire-and-forget (ctx.waitUntil): a KV failure, or
// the binding simply being absent in local dev, must NEVER break or delay a
// migration. Dry-runs are not logged (nothing changed on the destination).
//
// See docs/SECURITY.md § "Data collection (migration run logging)".

import type {
  MigrationReport,
  RunLogRecord,
  MigrationStats,
  ErrorCategory,
  DOMigrationResultSummary,
} from '../types';

/** RunLogRecord schema version. Bump when the projected shape changes. */
export const RUN_LOG_SCHEMA_VERSION = 1;

/** 90-day retention, in seconds. Applied as a KV TTL to every run-log entry. */
export const RUN_LOG_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Estimated engineer-hours saved per successful zone migration vs. rebuilding
 * the zone by hand (DNS + settings + rulesets + workers + LB + Access + certs).
 *
 * This is a deliberately conservative ESTIMATE, not a measurement — the
 * landing-page counter labels it as such. Tune this single constant to change
 * the "hours saved" figure everywhere.
 */
export const ESTIMATED_HOURS_PER_MIGRATION = 4;

/** Key prefix for every logged run. The landing-page total is DERIVED by
 * counting entries under this prefix whose metadata is flagged countable —
 * there is no separate mutable counter to race on. */
const RUN_KEY_PREFIX = 'run:';

/** Key prefix for rollback (destructive-delete) audit entries. Deliberately
 * distinct from RUN_KEY_PREFIX so rollback records never enter the migration
 * stats scan (readStats lists only `run:`) and never affect the landing-page
 * counter. */
const ROLLBACK_KEY_PREFIX = 'rollback:';

/** Metadata stored alongside each run-log KV entry. KV returns metadata in
 * list results, so readStats can count qualifying runs without reading each
 * value. */
interface RunLogKeyMeta {
  kind?: RunLogRecord['kind'];
  destZone?: string;
  failed?: number;
  toolVersion?: string;
  /** True when this run counts toward the landing-page total (a successful
   * zone migration that created a new destination zone). */
  counts?: boolean;
}

/** In-isolate memo so the public /api/stats endpoint doesn't KV-list on every
 * page load. Per-isolate and short-lived; staleness is bounded by STATS_CACHE_MS. */
let statsCache: { at: number; stats: MigrationStats } | null = null;
const STATS_CACHE_MS = 60_000;

// ── PII redaction (defense-in-depth over the allowlist) ──────────────────
//
// The allowlist is the primary protection; these regexes are a backstop for
// emails/IPs that leak into free-text error strings and resource names.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// IPv6 is matched by tokenizing maximal hex/colon runs and classifying them
// (a single replacement regex picks only a compressed prefix and leaves the
// leading hextets). A token is treated as IPv6 only if it contains a `::`
// compression or has 7+ colon-separated hex groups — so "HH:MM:SS" timestamps
// (3 decimal groups, no `::`) and account-id hashes (no colons) are NOT touched.
const IPV6_TOKEN_RE = /[0-9A-Fa-f:]{2,}/g;

function looksLikeIPv6(token: string): boolean {
  if (!token.includes(':')) return false;
  if (token.includes('::')) return true;
  const groups = token.split(':');
  return groups.length >= 7 && groups.every((g) => /^[0-9A-Fa-f]{1,4}$/.test(g));
}

/**
 * Replace any email addresses and IPv4/IPv6 literals in a free-text string
 * with `[email]` / `[ip]`. Over-redaction is the safe failure direction.
 * Returns the input unchanged when falsy.
 */
export function redactPII(input: string): string {
  if (!input) return input;
  return input
    .replace(EMAIL_RE, '[email]')
    .replace(IPV6_TOKEN_RE, (tok) => (looksLikeIPv6(tok) ? '[ip]' : tok))
    .replace(IPV4_RE, '[ip]');
}

function redactError(e: { resource: string; name: string; error: string; category?: ErrorCategory }) {
  return {
    resource: e.resource,
    name: redactPII(e.name),
    error: redactPII(e.error),
    ...(e.category ? { category: e.category } : {}),
  };
}

/**
 * Redact every string in the createdResources projection. These are mostly
 * opaque IDs (UUIDs/hashes that the regexes never match), but r2 bucket names
 * and worker IDs are author-chosen and could in principle embed an email or IP
 * — so we run them through redactPII too, to keep the module's "no email/IP
 * survives the allowlist" guarantee literally true. Redacting an opaque ID is a
 * no-op, so this is safe.
 */
function redactCreatedResources(
  cr: NonNullable<MigrationReport['createdResources']>,
): NonNullable<MigrationReport['createdResources']> {
  const arr = (xs: string[]) => xs.map(redactPII);
  return {
    ...(cr.zoneId ? { zoneId: redactPII(cr.zoneId) } : {}),
    workers: arr(cr.workers),
    kvNamespaces: arr(cr.kvNamespaces),
    r2Buckets: arr(cr.r2Buckets),
    d1Databases: arr(cr.d1Databases),
    queues: arr(cr.queues),
    doNamespaces: arr(cr.doNamespaces),
    dnsRecords: arr(cr.dnsRecords),
    pageRules: arr(cr.pageRules),
    rulesets: arr(cr.rulesets),
    accessApps: arr(cr.accessApps),
    emailRules: arr(cr.emailRules),
    customHostnames: arr(cr.customHostnames),
    turnstileWidgets: arr(cr.turnstileWidgets),
  };
}

/**
 * Redact the free-text fields of a DO migration result. `error` is a raw
 * upstream message that can carry hostnames/IPs/emails; worker and class names
 * are author-chosen identifiers. Numbers, status, and namespace IDs are kept.
 */
function redactDoResult(r: DOMigrationResultSummary): DOMigrationResultSummary {
  return {
    ...r,
    workerName: redactPII(r.workerName),
    className: redactPII(r.className),
    ...(r.error ? { error: redactPII(r.error) } : {}),
  };
}

/**
 * Project a MigrationReport down to the PII-stripped allowlist that is safe to
 * persist. Excludes `verification.destExport` entirely and never reads any
 * credential field (none exist on MigrationReport).
 */
export function buildRunLogRecord(
  report: MigrationReport,
  meta: { kind: RunLogRecord['kind']; toolVersion: string; runId?: string },
): RunLogRecord {
  return {
    schemaVersion: RUN_LOG_SCHEMA_VERSION,
    runId: meta.runId ?? crypto.randomUUID(),
    timestamp: report.timestamp,
    kind: meta.kind,
    toolVersion: meta.toolVersion,
    // Zone identity — intentionally kept (not PII for this tool).
    sourceZone: report.sourceZone,
    destZone: report.destZone,
    destAccountId: report.destAccountId,
    summary: report.summary,
    sections: report.sections.map((s) => ({
      name: s.name,
      total: s.total,
      success: s.success,
      failed: s.failed,
      skipped: s.skipped,
      ...(s.acknowledged !== undefined ? { acknowledged: s.acknowledged } : {}),
      items: s.items.map((it) => ({
        name: redactPII(it.name),
        status: it.status,
        ...(it.error ? { error: redactPII(it.error) } : {}),
        ...(it.reason ? { reason: redactPII(it.reason) } : {}),
        ...(it.detail ? { detail: redactPII(it.detail) } : {}),
      })),
    })),
    errors: report.errors.map(redactError),
    conflicts: (report.conflicts ?? []).map(redactError),
    warnings: report.warnings.map(redactPII),
    manualActions: report.manualActions.map(redactPII),
    newNameservers: report.newNameservers,
    ...(report.createdResources ? { createdResources: redactCreatedResources(report.createdResources) } : {}),
    ...(report.migratedIdentityProviders
      ? {
          // Drop the IdP display name; keep the non-PII dest id + type.
          migratedIdentityProviders: report.migratedIdentityProviders.map((idp) => ({
            destId: idp.destId,
            type: idp.type,
          })),
        }
      : {}),
    ...(report.doMigrationResults ? { doMigrationResults: report.doMigrationResults.map(redactDoResult) } : {}),
  };
}

/**
 * A run counts toward the public landing-page counter only when it is a real
 * (non-dry-run) ZONE migration that actually created a new destination zone.
 * This is the faithful server-side proxy for "made it to Step 4 with a new
 * zone" and cannot be spoofed or double-counted by the client. Runs that reuse
 * an existing dest zone (no new `createdResources.zoneId`) do not count.
 */
export function isSuccessfulZoneMigration(
  report: MigrationReport,
  kind: RunLogRecord['kind'],
): boolean {
  return (
    kind === 'zone' &&
    !!report.destZone &&
    !!report.createdResources?.zoneId
  );
}

/**
 * Derive the landing-page total by counting logged run entries flagged
 * countable in their KV metadata. No separate counter, so no read-modify-write
 * race — counting reads immutable, already-written entries. Returns zeroes if
 * the binding is absent or anything fails.
 *
 * Cost note: this lists keys under `run:` (metadata comes back with the list,
 * so no per-key GET). KV list is paginated at 1000 keys/page and eventually
 * consistent. We paginate via cursor with a generous beta safety bound; at
 * CSE-tool volume this is one or two list calls. Use getStatsCached() from
 * request handlers so we don't list on every page load.
 */
export async function readStats(kv: KVNamespace | undefined): Promise<MigrationStats> {
  const empty: MigrationStats = {
    zonesMigrated: 0,
    hoursSaved: 0,
    hoursPerMigration: ESTIMATED_HOURS_PER_MIGRATION,
  };
  if (!kv) return empty;
  try {
    let zonesMigrated = 0;
    let cursor: string | undefined;
    let pages = 0;
    const MAX_PAGES = 100; // beta safety bound (~100k keys) to cap a public-endpoint scan
    do {
      const res = await kv.list<RunLogKeyMeta>({ prefix: RUN_KEY_PREFIX, limit: 1000, cursor });
      for (const k of res.keys) {
        if (k.metadata?.counts) zonesMigrated++;
      }
      cursor = res.list_complete ? undefined : res.cursor;
      pages++;
    } while (cursor && pages < MAX_PAGES);
    return {
      zonesMigrated,
      hoursSaved: zonesMigrated * ESTIMATED_HOURS_PER_MIGRATION,
      hoursPerMigration: ESTIMATED_HOURS_PER_MIGRATION,
    };
  } catch {
    return empty;
  }
}

/** readStats with a short in-isolate cache; use this from request handlers. */
export async function getStatsCached(kv: KVNamespace | undefined): Promise<MigrationStats> {
  const now = Date.now();
  if (statsCache && now - statsCache.at < STATS_CACHE_MS) return statsCache.stats;
  const stats = await readStats(kv);
  statsCache = { at: now, stats };
  return stats;
}

/** Minimal binding surface this module needs (the worker Env is a superset). */
export interface RunLogBindings {
  RUN_LOG?: KVNamespace;
}

export type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
};

/**
 * Persist a PII-stripped projection of a completed migration to KV, and bump
 * the landing-page counter when the run created a new zone. Best-effort and
 * fire-and-forget via ctx.waitUntil; a failure here must never affect the
 * migration response. No-ops when the binding is absent (local dev) or the
 * report is for a dry-run.
 */
export async function logMigrationRun(
  env: RunLogBindings | undefined,
  ctx: WaitUntilContext | undefined,
  report: MigrationReport,
  meta: { kind: RunLogRecord['kind']; toolVersion: string },
): Promise<void> {
  try {
    const kv = env?.RUN_LOG;
    if (!kv) return;

    const record = buildRunLogRecord(report, meta);
    const key = `${RUN_KEY_PREFIX}${record.timestamp}:${record.runId}`;
    const metadata: RunLogKeyMeta = {
      kind: record.kind,
      destZone: record.destZone,
      failed: record.summary.failed,
      toolVersion: record.toolVersion,
      // The landing-page total is derived by counting entries flagged here.
      counts: isSuccessfulZoneMigration(report, meta.kind),
    };

    const work = kv
      .put(key, JSON.stringify(record), { expirationTtl: RUN_LOG_TTL_SECONDS, metadata })
      .catch(() => {/* swallow — telemetry must never surface to the user */});

    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
  } catch {
    /* never throw from telemetry */
  }
}

/**
 * Persist a run-log entry for a preset apply (MaxConfig / MinConfig).
 *
 * IMPORTANT: a preset apply NEVER counts toward the landing-page "zones cloned"
 * total. Only account-to-account migrations — source mode api / json / terraform,
 * which all run through /api/migrate/stream and are logged with kind 'zone' —
 * count (see isSuccessfulZoneMigration). A preset stamps a canned config onto a
 * single zone (or resets one); it is not a clone, regardless of whether it
 * provisioned the zone. This entry is therefore TROUBLESHOOTING TELEMETRY ONLY
 * (`counts: false`), so MaxConfig/MinConfig failures are still debuggable.
 *
 * Same guarantees as logMigrationRun: PII/credential-free, best-effort,
 * fire-and-forget, no-ops without the binding, never throws.
 */
export async function logPresetRun(
  env: RunLogBindings | undefined,
  ctx: WaitUntilContext | undefined,
  info: {
    kind: 'maxconfig' | 'minconfig';
    /** Target zone name (kept; not PII for this tool). */
    destZone: string;
    /** Whether this apply provisioned the zone — recorded for troubleshooting;
     *  does NOT affect counting (presets never count). */
    createdNewZone: boolean;
    /** Best-effort failed-operation count, for troubleshooting. */
    failed: number;
    toolVersion: string;
  },
): Promise<void> {
  try {
    const kv = env?.RUN_LOG;
    if (!kv) return;

    const timestamp = new Date().toISOString();
    const runId = crypto.randomUUID();
    const record = {
      schemaVersion: RUN_LOG_SCHEMA_VERSION,
      runId,
      timestamp,
      kind: info.kind,
      destZone: redactPII(info.destZone),
      createdNewZone: info.createdNewZone,
      failed: info.failed,
      toolVersion: info.toolVersion,
    };
    const key = `${RUN_KEY_PREFIX}${timestamp}:${runId}`;
    const metadata: RunLogKeyMeta = {
      kind: info.kind,
      destZone: record.destZone,
      failed: info.failed,
      toolVersion: info.toolVersion,
      // Presets are never clones — only api/json/terraform migrations count.
      counts: false,
    };

    const work = kv
      .put(key, JSON.stringify(record), { expirationTtl: RUN_LOG_TTL_SECONDS, metadata })
      .catch(() => {/* swallow — telemetry must never surface to the user */});

    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
  } catch {
    /* never throw from telemetry */
  }
}

/** Credential-free forensic record of a destructive /api/rollback call. */
export interface RollbackLogRecord {
  /** Destination account the deletes targeted (a 32-hex id — not a credential
   * or PII for this tool, same classification as RunLogRecord.destAccountId). */
  destAccountId: string;
  /** Count of resources successfully deleted. */
  deleted: number;
  /** Count of resources that failed to delete (including rejected identifiers). */
  failed: number;
  /** Tool version that performed the rollback. */
  toolVersion: string;
}

/**
 * Persist a PII/credential-free audit entry for a rollback (destructive
 * delete) operation to KV under the `rollback:` prefix. Mirrors logMigrationRun:
 * best-effort, fire-and-forget via ctx.waitUntil, never throws, no-ops without
 * the binding (local dev). Records ONLY counts + dest account id + version —
 * never resource names, tokens, or any caller-supplied secret. Kept out of the
 * migration stats scan by its distinct key prefix.
 */
export async function logRollbackRun(
  env: RunLogBindings | undefined,
  ctx: WaitUntilContext | undefined,
  info: RollbackLogRecord,
): Promise<void> {
  try {
    const kv = env?.RUN_LOG;
    if (!kv) return;

    const timestamp = new Date().toISOString();
    const record = {
      schemaVersion: RUN_LOG_SCHEMA_VERSION,
      runId: crypto.randomUUID(),
      timestamp,
      kind: 'rollback' as const,
      destAccountId: info.destAccountId,
      deleted: info.deleted,
      failed: info.failed,
      toolVersion: info.toolVersion,
    };
    const key = `${ROLLBACK_KEY_PREFIX}${timestamp}:${record.runId}`;

    const work = kv
      .put(key, JSON.stringify(record), { expirationTtl: RUN_LOG_TTL_SECONDS })
      .catch(() => {/* swallow — telemetry must never surface to the user */});

    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
  } catch {
    /* never throw from telemetry */
  }
}
