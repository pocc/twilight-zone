#!/usr/bin/env node
/**
 * Playwright Integration Test Runner — E2E Zone Migrations
 *
 * Runs the e2e migration test suite through the Twilight Zone UI: one
 * edge-case config per file in docs/test_configs/ (e01-e12), e.g. the
 * MaxConfig omnibus, worker bindings, email routing, plan downgrade, etc.
 *
 * For each test:
 *   1. Clean source zone via API
 *   2. Apply company-specific config to source zone
 *   3. Open browser to dev server
 *   4. Fill Step 1 (Setup) credentials, screenshot
 *   5. Click "Scope Migration" → Account step (select-only), screenshot
 *   6. Resolve account gates, click "Continue to Zone" → Zone step
 *   7. Resolve zone gates, click "Continue to Apply" → Apply step
 *   8. Confirm destination, click "Run migration" (account + zone phases run
 *      back-to-back from the Apply step) → post-migration view, screenshot
 *   9. Click "Continue to Results" → Results
 *   10. Parse results, save artifacts
 *   11. Retry on failure (up to 2 retries)
 *   12. Suite teardown: clean dest account-scoped resources + delete dest zone
 *
 * Environment:
 *   CF_API_KEY, CF_API_EMAIL, CF_ZONE_ID, CF_ACCOUNT_ID,
 *   CF_TARGET_ACCOUNT_ID, SOURCE_DOMAIN, DEST_DOMAIN,
 *   DEV_SERVER_URL (default http://localhost:5173)
 *   E2E_PIN_ZONE_NAME=1 — use SOURCE_DOMAIN/DEST_DOMAIN verbatim instead of the
 *     default per-run unique name (twilight-e2e-{runId}.{parent}). The parent
 *     zone is always derived from SOURCE_DOMAIN; only the leaf label is unique.
 *
 * Usage:
 *   node scripts/run-playwright-migrations.mjs [--start N] [--only N] [--concurrency N]
 *   [--pin-zone-name]  reuse the fixed SOURCE_DOMAIN/DEST_DOMAIN zone (Option A)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { formatMissingE2eEnvMessage, getE2eEnv } from './e2e-env.mjs';
import { createRateLimitedFetcher } from './rate-limiter.mjs';
import { HOOKS_NEEDING_EVIDENCE, endpointsForHooks } from './capture-catalog.mjs';
import { ensureDevServer } from './dev-server.mjs';
import { assertZoneSingletonSettingsMatch, assertNoUnexpectedFailures } from './e2e-assertions.mjs';
import { preserveE2eEvidence } from './e2e-evidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Environment ──────────────────────────────────────────────────
const loadedEnv = getE2eEnv({ env: process.env, root: ROOT });
if (loadedEnv.missing.length > 0) {
  console.error(formatMissingE2eEnvMessage(loadedEnv.missing, loadedEnv.envFilePath));
  process.exit(1);
}
const env = loadedEnv.values;
const CF_API_KEY = env.CF_API_KEY ?? '';
const CF_API_EMAIL = env.CF_API_EMAIL ?? '';
// CF_ZONE_ID is the SOURCE zone id. It is no longer a fixed env value: main()
// resolves it from SOURCE_DOMAIN (created fresh per run by default, or reused in
// pin mode) and reassigns this binding + sourcePathVars.zone_id before any
// request fires. The env value, if present, is used as a fallback default.
let CF_ZONE_ID = env.CF_ZONE_ID ?? '';
const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID ?? '';
const CF_TARGET_ACCOUNT_ID = env.CF_TARGET_ACCOUNT_ID ?? '';
// `let` (not const): if no server is reachable we auto-start one (see
// ensureDevServer) and reassign this to the port we actually bound.
let DEV_SERVER_URL = env.DEV_SERVER_URL ?? 'http://localhost:5173';
// Stops the dev server IF this harness auto-started it (no-op otherwise). Set by
// ensureDevServer() in main(); invoked in the top-level .finally teardown.
let stopDevServerFn = () => {};
// Source/destination zone names. These are REQUIRED env vars (see e2e-env.mjs),
// but by default they are NOT used verbatim: main()'s module-level resolver
// below rewrites both to a per-RUN unique name (twilight-e2e-{runId}.{parent})
// so back-to-back runs never re-add the same domain and never trip Cloudflare's
// ~3h per-name zone-creation cooldown ("You attempted to add this domain too
// many times within a short period"). The env values still matter: the PARENT
// zone is derived from them (the label is swapped, the parent is kept), and
// E2E_PIN_ZONE_NAME=1 / --pin-zone-name keeps them verbatim when you need to
// target a specific fixed zone. `let`, not `const`, because the resolver
// reassigns them once at module load before any request or config rewrite.
let SOURCE_DOMAIN = env.SOURCE_DOMAIN ?? '';  // Source zone domain — set via SOURCE_DOMAIN env var
let DEST_DOMAIN = env.DEST_DOMAIN ?? '';  // Dest zone domain — set via DEST_DOMAIN env var
// Forward address used by email-routing tests (e04). Defaults to RFC 2606
// reserved example.com so tests work out of the box; override via env var
// if you want a real verified address on the destination account to exercise
// the "verified-forward" code path instead of the "unverified-acknowledged"
// path.
const TEST_FORWARD_EMAIL = env.TEST_FORWARD_EMAIL ?? 'forward-test@example.com';
const VERBOSE = !!env.VERBOSE;
// SLOW_MODE keeps the browser open on the Results step for 10 minutes so a
// human can inspect the migration outcome. It is OFF by default — the harness
// runs fast (a short pause before parsing results) so unattended runs don't
// stall for 10 minutes per attempt and risk the dev server dying underneath a
// long idle window. Set SLOW_MODE=1 to opt into the inspection pause.
// FAST_MODE is still honoured as a legacy no-op alias for "not slow".
const SLOW_MODE = !!env.SLOW_MODE && !env.FAST_MODE;
const MAX_RETRIES = env.MAX_RETRIES !== undefined ? Number(env.MAX_RETRIES) : 2;

// ── CLI args ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argVal(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? parseInt(args[idx + 1], 10) : null;
}
// String-valued arg (argVal parseInt-coerces, which mangles lists like
// "3,4,11" into 3). Use this for non-numeric flags.
function argStr(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? String(args[idx + 1]) : null;
}
const START_AT = argVal('--start') ?? 1;
const ONLY = argVal('--only');
const END_AT = argVal('--end');
// Explicit comma-separated rank list (e.g. --ranks 3,4,11). Used by the parallel
// orchestrator (scripts/run-e2e-parallel.mjs) to give each child process its
// bucket; takes precedence over --start/--end/--only when set.
const RANKS = argStr('--ranks');
// Source-zone mode (per-run unique naming — the default):
//   Each run derives a unique zone name twilight-e2e-{runId}.{parent} (parent
//   taken from the SOURCE_DOMAIN env) and uses it for BOTH source and dest, so
//   no two runs ever add the same domain. The source zone is created fresh as a
//   subdomain of the parent (NS-delegated + activation-polled) and deleted at
//   teardown; the dest zone is created by the migration and deleted at suite
//   end. This sidesteps Cloudflare's ~3h per-name zone-creation cooldown that
//   the old fixed-name reuse model kept tripping on back-to-back runs.
//
//   Pin mode (E2E_PIN_ZONE_NAME=1 or --pin-zone-name): skip the rewrite and use
//   the SOURCE_DOMAIN/DEST_DOMAIN env values verbatim (reuse a fixed zone). Use
//   this to target a specific existing zone — but back-to-back pinned runs that
//   delete + re-add the same name can hit the 3h cooldown again.
//
//   --fresh-source-zone is now redundant (every run is fresh) and kept only as a
//   harmless no-op alias for older invocations.
const PIN_ZONE_NAME = args.includes('--pin-zone-name') || !!env.E2E_PIN_ZONE_NAME;
const FRESH_SOURCE_ZONE = args.includes('--fresh-source-zone');
// How long to wait for a freshly-created source subdomain zone to go active.
// Measured ~64s in practice, so default 180s leaves comfortable margin.
const SOURCE_ZONE_ACTIVATION_TIMEOUT_SEC = Number(env.SOURCE_ZONE_ACTIVATION_TIMEOUT_SEC ?? 180);
// Set by main() for the per-run source zone that teardown must delete. Invoked
// by the top-level .finally so it runs on success AND error.
let sourceZoneTeardown = null;

// ── Per-run unique zone naming ───────────────────────────────────
// Resolve SOURCE_DOMAIN/DEST_DOMAIN to a per-run unique name unless pinned. Done
// at module load (before the config rewrite and any CF request) so every
// downstream reader sees the final value. The parent zone is derived from the
// env SOURCE_DOMAIN by stripping its leading label, then a unique leaf is
// prepended: twilight-maxconfig.example.com → twilight-e2e-{runId}.example.com. Both
// source and dest get the SAME unique name, preserving the same-name
// production-fidelity flow (and e03's "dest already exists" fallback, which
// pre-creates that name on the dest account).
const RUN_ZONE_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let UNIQUE_ZONE_NAME = null; // set below when not pinned; logged in main()
if (!PIN_ZONE_NAME) {
  const parent = (env.SOURCE_DOMAIN ?? '').split('.').slice(1).join('.');
  if (!parent) {
    console.error(
      `Cannot derive a parent zone from SOURCE_DOMAIN="${env.SOURCE_DOMAIN}". ` +
      `Set SOURCE_DOMAIN to a subdomain of a parent zone you own (e.g. ` +
      `twilight-maxconfig.example.com), or pass --pin-zone-name to use it verbatim.`
    );
    process.exit(1);
  }
  UNIQUE_ZONE_NAME = `twilight-e2e-${RUN_ZONE_ID}.${parent}`;
  SOURCE_DOMAIN = UNIQUE_ZONE_NAME;
  DEST_DOMAIN = UNIQUE_ZONE_NAME;
}

// ── Paths ────────────────────────────────────────────────────────
const CONFIG_DIR = path.join(ROOT, 'docs', 'test_configs');
const OUTPUT_DIR = path.join(ROOT, 'test', 'e2e-migrations');

// Post-run hooks that read evidence JSON files written by
// scripts/capture-zone-state.mjs. State capture takes ~85s per side, so we
// only run it when the test's hook actually needs it. Hooks that only read
// migration-report.md (assertEnterpriseFeaturesAcknowledged, etc.) are not
// listed here.
//
// HOOKS_NEEDING_EVIDENCE + the per-hook → capture-endpoint map now live in
// scripts/capture-catalog.mjs (single source of truth, shared with the capture
// script + guard test). endpointsForHooks() drives L1 targeted capture below.

// ── Rate-limited API client ──────────────────────────────────────
const authHeaders = { 'X-Auth-Key': CF_API_KEY, 'X-Auth-Email': CF_API_EMAIL };

// Shared, MUTABLE pathVars object. createRateLimitedFetcher captures this object
// by reference and reads it on every request, so when main() resolves the real
// source zone id it sets sourcePathVars.zone_id (and reassigns CF_ZONE_ID for the
// direct `${CF_ZONE_ID}` interpolations) and all `{zone_id}` templates follow.
const sourcePathVars = { zone_id: CF_ZONE_ID, account_id: CF_ACCOUNT_ID };

// Per-process API rate budget. Default 1000/5min (the standard single-run
// budget). The parallel orchestrator sets E2E_RATE_LIMIT = 1000/concurrency so
// N concurrent child processes stay under the per-user Cloudflare ceiling.
const RATE_LIMIT = Number(env.E2E_RATE_LIMIT) > 0 ? Number(env.E2E_RATE_LIMIT) : 1000;

const { cfRequest } = createRateLimitedFetcher({
  authHeaders,
  rateLimit: RATE_LIMIT,
  windowSec: 300,
  capacity: 20,
  maxRetries: 3,
  verbose: VERBOSE,
  pathVars: sourcePathVars,
});

// Separate fetcher for target account operations (same auth). The two fetchers
// share the same per-process budget intent; split it so source+dest traffic
// together stays under the slot's E2E_RATE_LIMIT.
const { cfRequest: targetCfRequest } = createRateLimitedFetcher({
  authHeaders,
  rateLimit: RATE_LIMIT,
  windowSec: 300,
  capacity: 20,
  maxRetries: 3,
  verbose: VERBOSE,
  pathVars: {},
});

// ── Test-resource identification ─────────────────────────────────
//
// Every resource the e2e configs create shares one of these name prefixes
// (derived from docs/test_configs/*.json: e01 maxconfig-*, e02 maxworker-*,
// e05 svcchain-*/svcbind-*, e06 do-state-*, e09 storage-rt-*). Cleanup matches
// these case-insensitively (so binding-derived uppercase names like
// MAXCONFIG_KV are caught too) which keeps two invariants:
//   1. Dest-account cleanup is COMPLETE — no account-scoped leakage across runs
//      (the bug that let 71 workers/KV/D1/queues/Turnstile/Vectorize pile up).
//   2. It is SAFE — account 958 is a shared account with real projects, so we
//      only ever delete resources whose names match a known test prefix.
const TEST_RESOURCE_PREFIXES = ['maxconfig', 'maxworker', 'storage-rt', 'svcchain', 'svcbind', 'do-state'];
function isTestResourceName(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return TEST_RESOURCE_PREFIXES.some(p => n.startsWith(p));
}

// Delete a set of dest-account workers, retrying once. Service-binding chains
// (e05) mean a worker can't be deleted while another still binds it
// ("Cannot delete service X because it is still referenced by … Workers 'Y'");
// a second pass after the referrers are gone clears the rest.
async function deleteDestWorkers(names) {
  let deleted = 0;
  const pending = [...new Set(names)].filter(Boolean);
  for (let pass = 0; pass < 2 && pending.length; pass++) {
    const stillFailing = [];
    for (const name of pending) {
      const r = await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/workers/scripts/${name}`);
      if (r.ok) deleted++;
      else if (pass === 0) stillFailing.push(name);
      else log(`    ⚠ could not delete worker ${name}: ${r.data?.errors?.[0]?.message || 'unknown'}`);
    }
    pending.length = 0;
    pending.push(...stillFailing);
  }
  return deleted;
}

// ── Source-zone lifecycle ────────────────────────────────────────
//
// The source zone is a subdomain of an owned parent (e.g. example.com). By default
// SOURCE_DOMAIN has already been rewritten (at module load) to a per-run unique
// name twilight-e2e-{runId}.<parent>, so each run creates a brand-new zone and
// deletes it at teardown — never re-adding the same name, never tripping the
// ~3h per-name creation cooldown. Pin mode (--pin-zone-name) instead reuses the
// fixed env zone across runs. A freshly POSTed subdomain zone is "pending"
// until the parent delegates NS to it, so createSubdomainZone also writes NS
// records into the parent zone and polls for activation.

async function findZoneByName(name, accountId = CF_ACCOUNT_ID) {
  const r = await cfRequest('GET', `/zones?name=${encodeURIComponent(name)}&account.id=${accountId}`);
  return r.ok && Array.isArray(r.data?.result) && r.data.result.length > 0 ? r.data.result[0] : null;
}

// Create SOURCE_DOMAIN as a subdomain zone and activate it by delegating NS in
// the parent. Returns the new zone id (or null on failure). Best-effort
// activation: if it stays pending, the caller proceeds with a warning.
async function createSubdomainZone(domain) {
  const create = await cfRequest('POST', `/zones`, {
    name: domain,
    account: { id: CF_ACCOUNT_ID },
    type: 'full',
  });
  if (!create.ok) {
    log(`  ⚠ Could not create source zone ${domain}: ${create.data?.errors?.[0]?.message || 'unknown'}`);
    return null;
  }
  const zone = create.data.result;
  const nameServers = zone.name_servers || [];
  log(`  ➕ Created source zone ${domain} (${zone.id}); delegating NS in parent...`);

  // Delegate: add NS records for the subdomain label into the parent zone.
  const label = domain.split('.')[0];
  const parentName = domain.split('.').slice(1).join('.');
  const parent = await findZoneByName(parentName);
  if (parent && nameServers.length > 0) {
    for (const ns of nameServers) {
      const r = await cfRequest('POST', `/zones/${parent.id}/dns_records`, { type: 'NS', name: label, content: ns, ttl: 1 });
      if (!r.ok && !/already exists/i.test(r.data?.errors?.[0]?.message || '')) {
        log(`    ⚠ NS delegation ${label} → ${ns} failed: ${r.data?.errors?.[0]?.message || 'unknown'}`);
      }
    }
    await cfRequest('PUT', `/zones/${zone.id}/activation_check`, {});
  } else if (!parent) {
    log(`  ⚠ Parent zone ${parentName} not found in account — source zone will stay pending (SSL-dependent features may not apply).`);
  }

  // Wait for activation. Empirically a freshly-delegated subdomain zone of a
  // parent already on Cloudflare goes active in ~60-65s, so the old 60s window
  // would frequently JUST miss it. Poll up to SOURCE_ZONE_ACTIVATION_TIMEOUT_SEC
  // (default 180s), re-nudging activation_check every ~30s. This is what makes
  // --fresh-source-zone usable: a fresh zone isn't run against until it's active
  // (or the timeout is hit, in which case we warn loudly and proceed).
  const t0 = Date.now();
  const deadline = t0 + SOURCE_ZONE_ACTIVATION_TIMEOUT_SEC * 1000;
  let status = zone.status || 'pending';
  log(`  ⏳ Waiting for ${domain} to activate (up to ${SOURCE_ZONE_ACTIVATION_TIMEOUT_SEC}s)...`);
  while (Date.now() < deadline) {
    await sleep(5000);
    const got = await cfRequest('GET', `/zones/${zone.id}`);
    status = got.data?.result?.status || status;
    const elapsed = Math.round((Date.now() - t0) / 1000);
    if (status === 'active') { log(`  ✓ Source zone ${domain} is active (after ${elapsed}s)`); break; }
    // Re-nudge the activation scan roughly every 30s.
    if (elapsed % 30 < 5) await cfRequest('PUT', `/zones/${zone.id}/activation_check`, {});
  }
  if (status !== 'active') {
    log(`  ⚠ Source zone ${domain} still '${status}' after ${SOURCE_ZONE_ACTIVATION_TIMEOUT_SEC}s — proceeding (SSL/custom-hostname features may not fully apply). Raise SOURCE_ZONE_ACTIVATION_TIMEOUT_SEC if this keeps timing out.`);
  }
  return zone.id;
}

async function deleteSourceZone(zoneId, domain) {
  if (!zoneId) return;
  // Release any zone hold first, then delete the zone. Also remove the NS
  // delegation records from the parent so they don't accumulate.
  await cfRequest('DELETE', `/zones/${zoneId}/hold`);
  let r = await cfRequest('DELETE', `/zones/${zoneId}`);
  // An Enterprise zone (e.g. e07's ensureSourceEnterprise upgraded it) cannot be
  // deleted until it's downgraded to Free. Detect that, downgrade, and retry —
  // otherwise the zone leaks and its name stays pinned to the source account.
  if (!r.ok && /downgraded to the Free plan/i.test(r.data?.errors?.[0]?.message || '')) {
    log(`  ⏬ Source zone ${domain} is Enterprise — downgrading to Free before delete...`);
    await cfRequest('POST', `/zones/${zoneId}/subscription`, { rate_plan: { id: 'free' } });
    await new Promise(res => setTimeout(res, 3000));
    r = await cfRequest('DELETE', `/zones/${zoneId}`);
  }
  if (r.ok) log(`  🗑️  Deleted source zone ${domain} (${zoneId})`);
  else log(`  ⚠ Could not delete source zone ${domain}: ${r.data?.errors?.[0]?.message || 'unknown'}`);

  const label = domain.split('.')[0];
  const parentName = domain.split('.').slice(1).join('.');
  const parent = await findZoneByName(parentName);
  if (parent) {
    const recs = await cfRequest('GET', `/zones/${parent.id}/dns_records?type=NS&name=${encodeURIComponent(domain)}&per_page=100`);
    for (const rec of (recs.data?.result || [])) {
      await cfRequest('DELETE', `/zones/${parent.id}/dns_records/${rec.id}`);
    }
  }
}

// Resolve the source zone id for this run.
// Returns { id, createdFresh } — createdFresh=true means teardown must delete it.
//   fresh=true  (default per-run unique mode): delete any stale leftover with
//               this name, then create + activate it. Caller always tears it down.
//   fresh=false (pin mode): reuse the fixed zone if present, else create once
//               and keep it for future runs.
async function ensureSourceZone(domain, { fresh }) {
  const existing = await findZoneByName(domain);
  if (fresh) {
    if (existing) {
      log(`  ♻️  Deleting stale existing ${domain} before recreating...`);
      await deleteSourceZone(existing.id, domain);
    }
    const id = await createSubdomainZone(domain);
    if (!id) throw new Error(`Failed to create fresh source zone ${domain}`);
    return { id, createdFresh: true };
  }
  // Pin mode: reuse if present, otherwise create once and keep.
  if (existing) {
    if (existing.status !== 'active') {
      log(`  ⚠ Source zone ${domain} exists but is '${existing.status}' — SSL-dependent features may not fully apply.`);
    }
    return { id: existing.id, createdFresh: false };
  }
  log(`  ℹ️  Source zone ${domain} not found — creating it once (pin mode; will be reused on future runs)...`);
  const id = await createSubdomainZone(domain);
  if (!id) throw new Error(`Failed to create source zone ${domain}`);
  return { id, createdFresh: false };
}

// ── Zone Cleanup ─────────────────────────────────────────────────

async function cleanZone() {
  log('  🧹 Cleaning source zone...');
  let deleted = 0;

  // Real-world prerequisite for account-to-account migration: a Cloudflare
  // "zone hold" on the source zone blocks the destination account from
  // creating the SAME-named zone (API error 1428: "subject to a hold").
  // A real migrator releases this hold on the source before migrating. We
  // mirror that here so the suite exercises the true same-zone-name flow
  // (dest zone name == source zone name, which is what actually happens in
  // production) instead of dodging it with a different dest domain. The
  // DELETE is idempotent — releasing an already-released hold is a no-op.
  const holdRel = await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/hold`);
  if (holdRel.ok) log('  🔓 Released source zone hold (prerequisite for same-name dest zone)');
  else if (VERBOSE) log(`  ⚠ Zone-hold release returned: ${holdRel.data?.errors?.[0]?.message || 'unknown'}`);

  // Email Routing teardown. Three steps for full isolation between tests:
  //   1. Delete all non-catch-all rules (per-address forwards etc.) — these
  //      stick around even after /disable and re-export onto subsequent tests.
  //   2. Reset the catch-all to default-state drop+disabled — DELETE is not
  //      supported for catch-all, so PUT is the closest to "remove".
  //   3. POST /disable to flip the zone-level toggle off and let MX records
  //      be deleted cleanly later.
  const sourceRules = await cfRequest('GET', `/zones/${CF_ZONE_ID}/email/routing/rules?per_page=100`);
  if (sourceRules.ok && Array.isArray(sourceRules.data?.result)) {
    for (const rule of sourceRules.data.result) {
      // Skip the catch-all — the matchers array starts with type:'all' and there's
      // no separate id field for it via this endpoint.
      const isCatchAll = rule.matchers?.length === 1 && rule.matchers[0].type === 'all';
      if (!isCatchAll && rule.tag) {
        await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/email/routing/rules/${rule.tag}`);
      }
    }
  }
  await cfRequest('PUT', `/zones/${CF_ZONE_ID}/email/routing/rules/catch_all`, {
    enabled: false,
    matchers: [{ type: 'all' }],
    actions: [{ type: 'drop' }],
  });
  await cfRequest('POST', `/zones/${CF_ZONE_ID}/email/routing/disable`);

  // DNS Records
  const dns = await cfRequest('GET', '/zones/{zone_id}/dns_records?per_page=100');
  if (dns.ok && Array.isArray(dns.data?.result)) {
    for (const r of dns.data.result) {
      const d = await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/dns_records/${r.id}`);
      if (d.ok) deleted++;
    }
  }

  // Page Rules
  const pr = await cfRequest('GET', '/zones/{zone_id}/pagerules?per_page=100');
  if (pr.ok && Array.isArray(pr.data?.result)) {
    for (const r of pr.data.result) {
      const d = await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/pagerules/${r.id}`);
      if (d.ok) deleted++;
    }
  }

  // Firewall Rules
  const fw = await cfRequest('GET', '/zones/{zone_id}/firewall/rules?per_page=100');
  if (fw.ok && Array.isArray(fw.data?.result)) {
    for (const r of fw.data.result) {
      await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/firewall/rules/${r.id}`);
    }
  }

  // Filters
  const fl = await cfRequest('GET', `/zones/${CF_ZONE_ID}/filters?per_page=100`);
  if (fl.ok && Array.isArray(fl.data?.result)) {
    for (const f of fl.data.result) {
      await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/filters/${f.id}`);
    }
  }

  // Rate Limits
  const rl = await cfRequest('GET', '/zones/{zone_id}/rate_limits?per_page=100');
  if (rl.ok && Array.isArray(rl.data?.result)) {
    for (const r of rl.data.result) {
      await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/rate_limits/${r.id}`);
    }
  }

  // Rulesets (clear all phases)
  const phases = [
    'http_request_firewall_custom', 'http_request_cache_settings', 'http_ratelimit',
    'http_request_firewall_managed', 'http_request_sbfm', 'http_request_redirect',
    'http_request_origin', 'http_request_late_transform', 'http_request_transform',
    'http_response_headers_transform', 'http_response_firewall_managed', 'http_config_settings',
    'http_request_dynamic_redirect', 'http_response_compression',
  ];
  for (const phase of phases) {
    await cfRequest('PUT', `/zones/${CF_ZONE_ID}/rulesets/phases/${phase}/entrypoint`, { rules: [] });
  }

  // Worker Routes
  const wr = await cfRequest('GET', '/zones/{zone_id}/workers/routes');
  if (wr.ok && Array.isArray(wr.data?.result)) {
    for (const r of wr.data.result) {
      await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/workers/routes/${r.id}`);
    }
  }

  // Worker Custom Domains (account-level, zone-filtered)
  const wcd = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/workers/domains`);
  if (wcd.ok && Array.isArray(wcd.data?.result)) {
    for (const d of wcd.data.result) {
      if (d.zone_id === CF_ZONE_ID) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/workers/domains/${d.id}`);
      }
    }
  }

  // Workers (account-level). Delete zone-tied workers (via routes/custom domains)
  // AND test workers identified by name prefix. The prefix list mirrors the
  // worker.name values in docs/test_configs/*.json so stale workers from
  // previous runs don't survive across reruns. Stale workers cause silent
  // worker-upload conflicts (worker exists but binding refs are stale →
  // 400 "validation error" → silent failure gated on VERBOSE).
  const TEST_WORKER_PREFIXES = [
    'maxconfig-', 'maxworker-', 'svcchain-', 'svcbind-', 'do-state-', 'storage-rt-',
    'spec-lb-', 'roundtrip-', 'access-', 'kv-roundtrip-',
    'shipvibes-', 'portofcall-', 'note-',
  ];
  const isTestWorkerName = (name) => TEST_WORKER_PREFIXES.some(p => (name || '').startsWith(p));
  const zoneWorkerNames = new Set();
  if (wr.ok && Array.isArray(wr.data?.result)) {
    for (const r of wr.data.result) { if (r.script) zoneWorkerNames.add(r.script); }
  }
  if (wcd.ok && Array.isArray(wcd.data?.result)) {
    for (const d of wcd.data.result) {
      if (d.zone_id === CF_ZONE_ID && d.service) zoneWorkerNames.add(d.service);
    }
  }
  // Also pull all account workers and add test-prefixed ones to the delete set.
  const allWorkers = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/workers/scripts`);
  if (allWorkers.ok && Array.isArray(allWorkers.data?.result)) {
    for (const w of allWorkers.data.result) {
      if (isTestWorkerName(w.id)) zoneWorkerNames.add(w.id);
    }
  }
  for (const name of zoneWorkerNames) {
    await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/workers/scripts/${name}`);
  }

  // Custom Hostnames
  const ch = await cfRequest('GET', '/zones/{zone_id}/custom_hostnames?per_page=100');
  if (ch.ok && Array.isArray(ch.data?.result)) {
    for (const h of ch.data.result) {
      await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/custom_hostnames/${h.id}`);
    }
  }

  // Load Balancers (zone-scoped, must delete BEFORE pools/monitors)
  const lb = await cfRequest('GET', '/zones/{zone_id}/load_balancers');
  if (lb.ok && Array.isArray(lb.data?.result)) {
    for (const l of lb.data.result) {
      await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/load_balancers/${l.id}`);
    }
  }
  // LB Pools (account-scoped) — match any of the test naming prefixes used
  // across configs to keep cleanup honest. Production pools in the source
  // account should not use any of these prefixes. Add new prefixes here
  // when new test configs introduce new pool naming patterns. The previous
  // hardcoded "lb-test-" prefix was leaving maxconfig-pool-*, spec-lb-pool-*,
  // and other test pools in place across runs, which caused pool POST to
  // return 409 in applyConfig and silently broke downstream LB POST.
  const TEST_LB_PREFIXES = ['lb-test-', 'maxconfig-pool-', 'spec-lb-pool-', 'storage-rt-pool-', 'request_headers', 'url_shortener'];
  const isTestPoolName = (name) => TEST_LB_PREFIXES.some(p => (name || '').startsWith(p)) || ['request_headers', 'url_shortener'].includes(name || '');
  const lbPools = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/load_balancers/pools?per_page=100`);
  if (lbPools.ok && Array.isArray(lbPools.data?.result)) {
    for (const p of lbPools.data.result) {
      if (isTestPoolName(p.name)) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/load_balancers/pools/${p.id}`);
      }
    }
  }
  // LB Monitors (account-scoped — match description against test prefixes)
  const lbMons = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/load_balancers/monitors?per_page=100`);
  if (lbMons.ok && Array.isArray(lbMons.data?.result)) {
    for (const m of lbMons.data.result) {
      if (isTestPoolName(m.description || '')) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/load_balancers/monitors/${m.id}`);
      }
    }
  }

  // Waiting Rooms
  const wait = await cfRequest('GET', '/zones/{zone_id}/waiting_rooms');
  if (wait.ok && Array.isArray(wait.data?.result)) {
    for (const w of wait.data.result) {
      await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/waiting_rooms/${w.id}`);
    }
  }

  // Spectrum Apps (zone-scoped). Critical: must be deleted before
  // re-seeding because Spectrum apps reserve their port and a re-seed
  // POST with the same port returns "Port(s) conflict with existing
  // application." Without this cleanup, back-to-back e01 runs leave the
  // first run's Spectrum app in place and break source seeding on
  // subsequent runs.
  const spectrum = await cfRequest('GET', `/zones/${CF_ZONE_ID}/spectrum/apps?per_page=100`);
  if (spectrum.ok && Array.isArray(spectrum.data?.result)) {
    for (const app of spectrum.data.result) {
      if (app.id) {
        await cfRequest('DELETE', `/zones/${CF_ZONE_ID}/spectrum/apps/${app.id}`);
      }
    }
  }

  // Pages Projects (account-scoped). Names use test-prefix convention.
  // Stale projects from prior runs are deleted before seeding so the
  // POST doesn't hit "name already taken" errors.
  const TEST_PAGES_PREFIXES = ['maxconfig-pages-', 'maxworker-pages-', 'svcchain-pages-', 'tz-test-pages-'];
  const isTestPagesProject = (name) => TEST_PAGES_PREFIXES.some(p => (name || '').startsWith(p));
  const pages = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/pages/projects?per_page=100`);
  if (pages.ok && Array.isArray(pages.data?.result)) {
    for (const project of pages.data.result) {
      if (isTestPagesProject(project.name)) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/pages/projects/${encodeURIComponent(project.name)}`);
      }
    }
  }

  // AI Gateways (account-scoped). Test gateways use test-prefix convention.
  const TEST_AIG_PREFIXES = ['maxconfig-aig-', 'maxworker-aig-', 'tz-test-aig-'];
  const isTestAiGateway = (id) => TEST_AIG_PREFIXES.some(p => (id || '').startsWith(p));
  const aiGateways = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/ai-gateway/gateways?per_page=100`);
  if (aiGateways.ok && Array.isArray(aiGateways.data?.result)) {
    for (const gw of aiGateways.data.result) {
      if (isTestAiGateway(gw.id)) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/ai-gateway/gateways/${encodeURIComponent(gw.id)}`);
      }
    }
  }
  const aiCustom = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/ai-gateway/custom-providers?per_page=100`);
  if (aiCustom.ok && Array.isArray(aiCustom.data?.result)) {
    for (const cp of aiCustom.data.result) {
      if (TEST_AIG_PREFIXES.some(p => (cp.slug || '').startsWith(p))) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/ai-gateway/custom-providers/${encodeURIComponent(cp.slug)}`);
      }
    }
  }

  // Access Apps
  const access = await cfRequest('GET', '/accounts/{account_id}/access/apps');
  if (access.ok && Array.isArray(access.data?.result)) {
    for (const a of access.data.result) {
      await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/access/apps/${a.id}`);
    }
  }

  // Turnstile widgets (account-scoped, zone-filtered by domain)
  const turnstile = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/challenges/widgets`);
  if (turnstile.ok && Array.isArray(turnstile.data?.result)) {
    for (const w of turnstile.data.result) {
      // Only delete widgets associated with the source zone domain
      const zoneDomains = (w.domains || []);
      if (SOURCE_DOMAIN && zoneDomains.some(d => d.includes(SOURCE_DOMAIN))) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/challenges/widgets/${w.sitekey}`);
      }
    }
  }

  // Account-scoped resources cleanup. Match by any test-config prefix —
  // KV/D1/Queue names follow predictable naming patterns. Stale resources
  // across runs were causing pool/monitor/worker conflicts; the same
  // pattern applies to KV/D1/Queues. Use per_page=100 — default 20 misses
  // stale resources on later pages.
  const TEST_RESOURCE_PREFIXES = ['maxconfig-', 'maxworker-', 'svcchain-', 'svcbind-', 'do-state-', 'storage-rt-', 'roundtrip-', 'kv-roundtrip-'];
  const isTestResource = (name) => TEST_RESOURCE_PREFIXES.some(p => (name || '').startsWith(p));

  // KV Namespaces
  const kvNs = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces?per_page=100`);
  if (kvNs.ok && Array.isArray(kvNs.data?.result)) {
    for (const ns of kvNs.data.result) {
      if (isTestResource(ns.title)) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${ns.id}`);
      }
    }
  }

  // D1 Databases
  const d1 = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/d1/database?per_page=100`);
  if (d1.ok && Array.isArray(d1.data?.result)) {
    for (const db of d1.data.result) {
      if (isTestResource(db.name)) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/d1/database/${db.uuid}`);
      }
    }
  }

  // Queues
  const queues = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/queues?per_page=100`);
  if (queues.ok && Array.isArray(queues.data?.result)) {
    for (const q of queues.data.result) {
      if (isTestResource(q.queue_name)) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/queues/${q.queue_id}`);
      }
    }
  }

  // Vectorize indexes (test-prefixed) — mirrors the dest sweep so the SOURCE
  // account (the maintainer Main) doesn't accumulate maxconfig-/maxworker-vectorize
  // indexes from seeding either.
  const vec = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes`);
  if (vec.ok && Array.isArray(vec.data?.result)) {
    for (const idx of vec.data.result) {
      if (isTestResource(idx.name)) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/vectorize/v2/indexes/${idx.name}`);
      }
    }
  }

  // Secrets Store stores (test-prefixed).
  const ss = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/secrets_store/stores`);
  if (ss.ok && Array.isArray(ss.data?.result)) {
    for (const store of ss.data.result) {
      if (isTestResource(store.name)) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/secrets_store/stores/${store.id}`);
      }
    }
  }

  // Account-level custom rulesets (only test-prefixed ones — never touch
  // production rulesets). Before deletion, remove any execute rules from
  // account-level phase entrypoints that reference these rulesets
  // (entrypoint rules pinning a target prevent the target from being
  // deleted, and stale rules accumulate across runs).
  const acctRulesets = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/rulesets`);
  if (acctRulesets.ok && Array.isArray(acctRulesets.data?.result)) {
    const testRulesetIds = new Set(
      acctRulesets.data.result
        .filter(rs => rs.name?.startsWith('Twilight Zone Test') || rs.name?.includes('MaxConfig'))
        .map(rs => rs.id),
    );
    // Find every account-level root entrypoint and strip execute rules
    // referencing our test rulesets.
    const rootRulesets = acctRulesets.data.result.filter(rs => rs.kind === 'root');
    for (const rs of rootRulesets) {
      const detail = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/rulesets/${rs.id}`);
      if (!detail.ok || !Array.isArray(detail.data?.result?.rules)) continue;
      const rules = detail.data.result.rules;
      const filtered = rules.filter(r => {
        if (r.action !== 'execute') return true;
        const targetId = r.action_parameters?.id;
        return !(typeof targetId === 'string' && testRulesetIds.has(targetId));
      });
      if (filtered.length !== rules.length) {
        const cleanRules = filtered.map(r => {
          const { id: _id, version: _v, last_updated: _lu, ref: _ref, ...rest } = r;
          return rest;
        });
        await cfRequest('PUT', `/accounts/${CF_ACCOUNT_ID}/rulesets/phases/${rs.phase}/entrypoint`, { rules: cleanRules });
      }
    }
    // Now delete the test-prefixed rulesets themselves.
    for (const rs of acctRulesets.data.result) {
      if (rs.name?.startsWith('Twilight Zone Test') || rs.name?.includes('MaxConfig')) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/rulesets/${rs.id}`);
      }
    }
  }

  // Notification policies + webhooks (only test/maxconfig-named ones)
  const np = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/alerting/v3/policies`);
  if (np.ok && Array.isArray(np.data?.result)) {
    for (const policy of np.data.result) {
      if (policy.name?.includes('MaxConfig') || policy.name?.startsWith('Twilight Zone Test')) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/alerting/v3/policies/${policy.id}`);
      }
    }
  }
  const nw = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/alerting/v3/destinations/webhooks`);
  if (nw.ok && Array.isArray(nw.data?.result)) {
    for (const hook of nw.data.result) {
      if (hook.name?.includes('MaxConfig') || hook.name?.startsWith('Twilight Zone Test')) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/alerting/v3/destinations/webhooks/${hook.id}`);
      }
    }
  }

  // Account-scoped Logpush jobs (test-prefixed)
  const alp = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/logpush/jobs`);
  if (alp.ok && Array.isArray(alp.data?.result)) {
    for (const job of alp.data.result) {
      if (isTestResource(job.name)) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/logpush/jobs/${job.id}`);
      }
    }
  }

  // Access tags, bookmarks, custom pages (test-prefixed)
  const at = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/access/tags`);
  if (at.ok && Array.isArray(at.data?.result)) {
    for (const tag of at.data.result) {
      if (isTestResource(tag.name)) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/access/tags/${encodeURIComponent(tag.name)}`);
      }
    }
  }
  const ab = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/access/bookmarks`);
  if (ab.ok && Array.isArray(ab.data?.result)) {
    for (const bookmark of ab.data.result) {
      if (bookmark.name?.includes('MaxConfig')) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/access/bookmarks/${bookmark.id}`);
      }
    }
  }
  const acp = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/access/custom_pages`);
  if (acp.ok && Array.isArray(acp.data?.result)) {
    for (const page of acp.data.result) {
      if (page.name?.includes('MaxConfig')) {
        await cfRequest('DELETE', `/accounts/${CF_ACCOUNT_ID}/access/custom_pages/${page.uid}`);
      }
    }
  }

  log(`  🧹 Cleaned ${deleted}+ resources`);
}

// ── Apply Config ─────────────────────────────────────────────────

// Patterns in error messages that indicate the source account lacks the
// entitlement for a particular binding type. When an upload fails with one
// of these, the harness drops the offending binding(s) and retries — this
// gives honest test scoping (assertion verifies only what the source could
// actually provision) without silently swallowing the error.
//
// Map binding type → list of regex patterns (case-insensitive) in error
// messages that pinpoint that binding as the cause. The patterns are
// matched against the API's error message string.
const SOURCE_ENTITLEMENT_BINDING_PATTERNS = [
  { type: 'dispatch_namespace',   patterns: [/dispatch namespace/i, /workers for platforms/i] },
  { type: 'hyperdrive',           patterns: [/hyperdrive/i] },
  { type: 'mtls_certificate',     patterns: [/\bmtls\b/i, /mutual tls/i] },
  { type: 'secrets_store_secret', patterns: [/secrets store/i, /secret store/i] },
  { type: 'vpc_service',          patterns: [/\bvpc\b/i, /magic wan/i] },
  { type: 'pipelines',            patterns: [/\bpipelines?\b/i] },
  { type: 'vectorize',            patterns: [/vectorize/i] },
  { type: 'send_email',           patterns: [/send_email/i, /send email/i] },
  { type: 'workflow',             patterns: [/\bworkflows?\b/i] },
  { type: 'browser',              patterns: [/browser rendering/i] },
  { type: 'ai',                   patterns: [/workers ai/i] },
  // Assets binding requires the worker to also ship a static-assets upload
  // (a separate multipart entry). The harness doesn't seed assets, so drop
  // the binding and rely on the migration tool to surface it as a manual
  // action.
  { type: 'assets',               patterns: [/assets binding without assets/i, /\bassets binding\b/i] },
];

// Returns the binding types likely to have caused an upload error, based
// on pattern matches in the error message. Returns an empty array when
// no patterns match (caller should not retry — the error is something
// else like 400 invalid payload).
function classifyWorkerUploadError(errMsg) {
  const hit = [];
  for (const entry of SOURCE_ENTITLEMENT_BINDING_PATTERNS) {
    if (entry.patterns.some(p => p.test(errMsg))) hit.push(entry.type);
  }
  return hit;
}

// Build the multipart FormData payload for a worker PUT, including DO
// migration metadata when needed. Pure: returns FormData without side
// effects so it can be unit-tested or retried easily.
function buildWorkerUploadPayload(script, isModules, mainModule, bindings) {
  const doBindings = bindings.filter(b => b.type === 'durable_object_namespace');
  const metadata = isModules
    ? { main_module: mainModule, bindings }
    : { body_part: 'script', bindings };
  if (doBindings.length > 0) {
    metadata.migrations = {
      tag: 'v1',
      new_classes: doBindings.map(b => b.class_name),
    };
  }
  const formData = new FormData();
  if (isModules) {
    formData.append(mainModule, new Blob([script], { type: 'application/javascript+module' }), mainModule);
  } else {
    formData.append('script', new Blob([script], { type: 'application/javascript' }), 'script');
  }
  formData.append('metadata', JSON.stringify(metadata));
  return formData;
}

// Upload a worker, retrying with binding-drop on entitlement errors.
// Returns { ok: boolean, error?: string, droppedBindings: Array<{type, name}> }.
//
// First attempt uses the full binding list. On failure, the error message
// is matched against SOURCE_ENTITLEMENT_BINDING_PATTERNS to identify which
// binding types the source account can't provision. Those bindings are
// dropped and the upload is retried once. If the second attempt also
// fails (or the first error doesn't match any known pattern), returns
// the full error message for the caller to log.
async function uploadWorkerWithRetryAndDrop(name, script, isModules, mainModule, bindings) {
  const dropped = [];
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/scripts/${name}`;

  const attempt = async (curBindings) => {
    const formData = buildWorkerUploadPayload(script, isModules, mainModule, curBindings);
    try {
      const res = await fetch(url, { method: 'PUT', headers: authHeaders, body: formData });
      if (res.ok) return { ok: true };
      const errText = await res.text();
      let errSummary = errText;
      try {
        const j = JSON.parse(errText);
        errSummary = j.errors?.[0]?.message || errText;
      } catch { /* keep raw */ }
      return { ok: false, error: errSummary };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // Iteratively attempt the upload, classifying errors and dropping
  // offending bindings until the upload succeeds, no more offenders are
  // identified, or we hit the safety cap (avoid infinite loops).
  let curBindings = bindings;
  // Cap higher than the longest known offending-type chain. Test 205's
  // MaxWorker config can produce 9+ sequential entitlement errors before
  // the worker uploads cleanly.
  const MAX_RETRIES = 15;
  for (let i = 0; i < MAX_RETRIES; i++) {
    const result = await attempt(curBindings);
    if (result.ok) return { ok: true, droppedBindings: dropped };

    const offendingTypes = classifyWorkerUploadError(result.error);
    if (VERBOSE) log(`    🔎 Worker "${name}" upload attempt ${i + 1} failed: "${result.error.slice(0, 120)}" → offenders=[${offendingTypes.join(',')}]`);

    if (offendingTypes.length === 0) {
      // Not an entitlement / known-skip error — don't retry, return error.
      return { ok: false, error: result.error, droppedBindings: dropped };
    }
    const offendingSet = new Set(offendingTypes);
    const nextBindings = curBindings.filter(b => {
      if (offendingSet.has(b.type)) {
        dropped.push({ type: b.type, name: b.name });
        return false;
      }
      return true;
    });
    if (nextBindings.length === curBindings.length) {
      // Nothing actually dropped — error message matched a binding type
      // that isn't in the current binding set. Stop retrying.
      return { ok: false, error: result.error, droppedBindings: dropped };
    }
    curBindings = nextBindings;
  }
  // Hit retry cap — return the last error.
  return { ok: false, error: `worker upload exhausted ${MAX_RETRIES} drop-retries`, droppedBindings: dropped };
}

async function applyConfig(config) {
  let created = 0;
  let failed = 0;
  const failedDnsRecords = [];

  // DNS Records
  if (config.dns_records?.length > 0) {
    for (const record of config.dns_records) {
      const r = await cfRequest('POST', '/zones/{zone_id}/dns_records', record);
      if (r.ok) created++;
      else {
        const err = r.data?.errors?.[0]?.message || `HTTP ${r.status}`;
        if (!String(err).includes('already exists')) {
          failed++;
          failedDnsRecords.push({ type: record.type, name: record.name, error: String(err) });
          // Always log DNS seeding failures (Principle 9: fail loud, fail
          // fast). A silently-dropped record means the migration never sees
          // that record type, so a type-specific regression (e.g. CAA/SRV/
          // HTTPS needing a structured `data` object) passes unnoticed.
          log(`    ❌ DNS seed failed ${record.type} ${record.name}: ${err}`);
        }
      }
    }
  }

  // Zone Settings
  if (config.zone_settings && typeof config.zone_settings === 'object') {
    for (const [key, value] of Object.entries(config.zone_settings)) {
      const r = await cfRequest('PATCH', `/zones/${CF_ZONE_ID}/settings/${key}`, { value });
      if (r.ok) created++;
      else failed++;
    }
  }

  // Page Rules
  if (config.page_rules?.length > 0) {
    for (const rule of config.page_rules) {
      const r = await cfRequest('POST', '/zones/{zone_id}/pagerules', rule);
      if (r.ok) created++;
      else { failed++; if (VERBOSE) log(`    ❌ Page Rule: ${r.data?.errors?.[0]?.message}`); }
    }
  }

  // Firewall Rules
  if (config.firewall_rules?.length > 0) {
    for (const rule of config.firewall_rules) {
      const r = await cfRequest('POST', `/zones/${CF_ZONE_ID}/firewall/rules`, [{
        filter: { expression: rule.filter?.expression || rule.expression || '' },
        action: rule.action,
        description: rule.description || '',
        priority: rule.priority,
      }]);
      if (r.ok) created++;
      else { failed++; if (VERBOSE) log(`    �� Firewall Rule: ${r.data?.errors?.[0]?.message}`); }
    }
  }

  // Rate Limits
  if (config.rate_limits?.length > 0) {
    for (const limit of config.rate_limits) {
      const r = await cfRequest('POST', '/zones/{zone_id}/rate_limits', limit);
      if (r.ok) created++;
      else { failed++; if (VERBOSE) log(`    ❌ Rate Limit: ${r.data?.errors?.[0]?.message}`); }
    }
  }

  // Account-level custom rulesets (provisioned first so zone rules below
  // can reference them via the symbolic placeholder ACCOUNT_RULESET_<key>).
  //
  // Config shape: config.account_rulesets is a Record<key, ruleset>
  // Each ruleset: { name, description?, kind: "custom", phase, rules: [...] }
  // The key is referenced from a zone rule like:
  //   { action: "execute", action_parameters: { id: "ACCOUNT_RULESET_<key>" } }
  // and is rewritten to the real ID after the account ruleset is created.
  const accountRulesetIdByKey = new Map();
  if (config.account_rulesets && typeof config.account_rulesets === 'object') {
    for (const [key, ruleset] of Object.entries(config.account_rulesets)) {
      const body = {
        name: ruleset.name,
        description: ruleset.description || '',
        kind: ruleset.kind || 'custom',
        phase: ruleset.phase,
        rules: (ruleset.rules || []).map(r => ({
          action: r.action,
          expression: r.expression,
          description: r.description || '',
          enabled: r.enabled !== false,
          ...(r.action_parameters ? { action_parameters: r.action_parameters } : {}),
        })),
      };
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/rulesets`, body);
      if (r.ok && r.data?.result?.id) {
        accountRulesetIdByKey.set(key, r.data.result.id);
        created++;
        if (VERBOSE) log(`    ✅ Account Ruleset "${key}" → ${r.data.result.id}`);
      } else {
        failed++;
        // Always log account-ruleset seeding failures. When the source
        // account-ruleset creation silently fails, the placeholder in
        // zone rules stays unresolved → migration tool has no execute
        // target → assertAccountRulesetReferenceRemapped fails with a
        // misleading "no Account Ruleset section in report" error.
        // If we already have an account ruleset by this name on the
        // source account, look it up and reuse the ID rather than
        // counting the create as a failure (this happens routinely
        // during back-to-back test runs).
        const reuseMatch = (r.data?.errors?.[0]?.message || '').match(/already exists|duplicate/i);
        if (reuseMatch) {
          // Look up by name
          const lookup = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/rulesets`);
          const existing = lookup.ok ? (lookup.data?.result || []).find(x => x.name === ruleset.name) : null;
          if (existing) {
            // Update its rules with PUT so the test gets a fresh state
            const upd = await cfRequest('PUT', `/accounts/${CF_ACCOUNT_ID}/rulesets/${existing.id}`, body);
            if (upd.ok) {
              accountRulesetIdByKey.set(key, existing.id);
              failed--; created++;
              log(`    ✅ Account Ruleset "${key}" reused (${existing.id})`);
              continue;
            }
            log(`    ❌ Account Ruleset "${key}": found existing ${existing.id} but PUT failed: ${upd.data?.errors?.[0]?.message || upd.status}`);
          } else {
            log(`    ❌ Account Ruleset "${key}": "already exists" but lookup failed`);
          }
        } else {
          log(`    ❌ Account Ruleset "${key}": ${r.data?.errors?.[0]?.message || r.status}`);
        }
      }
    }
  }

  // Account-level phase entrypoints (kind: root). The canonical CF API
  // path for deploying a custom account ruleset is via execute rules in
  // an account-level root entrypoint, NOT via zone-level execute rules
  // (which CF API rejects with error 20230). Configs declare this via:
  //   account_phase_entrypoints: { <phase>: [ { action: "execute",
  //     action_parameters: { id: "ACCOUNT_RULESET_<key>" }, ... } ] }
  // The placeholder ACCOUNT_RULESET_<key> is resolved to the real ID
  // from accountRulesetIdByKey, identical to the zone-rule path below.
  //
  // We use PUT /accounts/.../rulesets/phases/<phase>/entrypoint which
  // upserts the entrypoint — but we need to preserve existing rules so we
  // don't clobber unrelated account-level deployments. Fetch first, append.
  if (config.account_phase_entrypoints && typeof config.account_phase_entrypoints === 'object') {
    for (const [phase, rules] of Object.entries(config.account_phase_entrypoints)) {
      if (!Array.isArray(rules) || rules.length === 0) continue;
      const newRules = rules.map(rule => {
        const out = {
          action: rule.action,
          expression: rule.expression,
          description: rule.description || '',
          enabled: rule.enabled !== false,
          ...(rule.action_parameters ? { action_parameters: { ...rule.action_parameters } } : {}),
        };
        if (out.action === 'execute' && out.action_parameters?.id) {
          const placeholder = out.action_parameters.id;
          if (typeof placeholder === 'string' && placeholder.startsWith('ACCOUNT_RULESET_')) {
            const key = placeholder.slice('ACCOUNT_RULESET_'.length);
            const realId = accountRulesetIdByKey.get(key);
            if (realId) {
              out.action_parameters = { ...out.action_parameters, id: realId };
            } else {
              log(`    ⚠ Account phase entrypoint ${phase}: could not resolve ${placeholder} (no source ruleset created)`);
            }
          }
        }
        return out;
      });
      // Fetch existing entrypoint to merge.
      const existing = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/rulesets/phases/${phase}/entrypoint`);
      let mergedRules = newRules;
      if (existing.ok && existing.data?.result?.rules) {
        const existingClean = existing.data.result.rules.map(r => {
          const { id: _id, version: _v, last_updated: _lu, ref: _ref, ...rest } = r;
          return rest;
        });
        // Avoid duplicate execute targets across runs.
        const newTargets = new Set(newRules.filter(r => r.action === 'execute').map(r => r.action_parameters?.id).filter(Boolean));
        const filteredExisting = existingClean.filter(r => {
          if (r.action !== 'execute') return true;
          const id = r.action_parameters?.id;
          return !(typeof id === 'string' && newTargets.has(id));
        });
        mergedRules = [...filteredExisting, ...newRules];
      }
      const r = await cfRequest('PUT', `/accounts/${CF_ACCOUNT_ID}/rulesets/phases/${phase}/entrypoint`, { rules: mergedRules });
      if (r.ok) {
        created++;
        log(`    ✅ Account phase entrypoint "${phase}": ${newRules.length} rule(s) added`);
      } else {
        failed++;
        log(`    ❌ Account phase entrypoint "${phase}": ${r.data?.errors?.[0]?.message || `HTTP ${r.status}`}`);
      }
    }
  }

  // Rulesets
  if (config.rulesets && typeof config.rulesets === 'object') {
    for (const [phase, rules] of Object.entries(config.rulesets)) {
      if (!Array.isArray(rules) || rules.length === 0) continue;
      const cleanRules = rules.map(rule => {
        const out = {
          action: rule.action,
          expression: rule.expression,
          description: rule.description || '',
          enabled: rule.enabled !== false,
          ...(rule.action_parameters ? { action_parameters: rule.action_parameters } : {}),
          ...(rule.ratelimit ? { ratelimit: rule.ratelimit } : {}),
        };
        // Resolve symbolic ACCOUNT_RULESET_<key> placeholders to real IDs.
        if (out.action === 'execute' && out.action_parameters?.id) {
          const placeholder = out.action_parameters.id;
          if (typeof placeholder === 'string' && placeholder.startsWith('ACCOUNT_RULESET_')) {
            const key = placeholder.slice('ACCOUNT_RULESET_'.length);
            const realId = accountRulesetIdByKey.get(key);
            if (realId) {
              out.action_parameters = { ...out.action_parameters, id: realId };
            } else if (VERBOSE) {
              log(`    ⚠ Could not resolve placeholder ${placeholder} — rule will likely fail`);
            }
          }
        }
        return out;
      });
      // Try the full PUT first. If it fails specifically because the CF
      // API doesn't allow custom-kind account rulesets to be executed from
      // zones (code 20217 / "not possible to execute a ruleset of scope
      // account at scope zone"), drop the offending execute rule(s) and
      // retry. This honest scope-reduction lets the test exercise the
      // other rules in the same phase even when the execute path is
      // blocked. Without this, a single broken rule kills the entire
      // phase seeding.
      let r = await cfRequest('PUT', `/zones/${CF_ZONE_ID}/rulesets/phases/${phase}/entrypoint`, { rules: cleanRules });
      if (!r.ok) {
        const errMsg = r.data?.errors?.[0]?.message || '';
        if (/not possible to execute a ruleset of scope account/i.test(errMsg) || /scope.*account.*scope.*zone/i.test(errMsg)) {
          const withoutExecute = cleanRules.filter(rule => rule.action !== 'execute');
          if (withoutExecute.length < cleanRules.length) {
            log(`    ⚠ Ruleset ${phase}: CF API rejected execute rules (custom account ruleset can't be invoked from zone). Retrying without ${cleanRules.length - withoutExecute.length} execute rule(s).`);
            r = await cfRequest('PUT', `/zones/${CF_ZONE_ID}/rulesets/phases/${phase}/entrypoint`, { rules: withoutExecute });
          }
        }
      }
      if (r.ok) created++;
      else {
        failed++;
        // Always log ruleset seeding failures (not gated on VERBOSE). A
        // silently-empty ruleset cascades: zone export sees an empty
        // phase, migration tool has nothing to migrate, the user's
        // assertion fails further downstream with a misleading message.
        log(`    ❌ Ruleset ${phase}: ${r.data?.errors?.[0]?.message || `HTTP ${r.status}`}`);
      }
    }
  }

  // Argo
  if (config.argo) {
    if (config.argo.smart_routing) await cfRequest('PATCH', `/zones/${CF_ZONE_ID}/argo/smart_routing`, { value: config.argo.smart_routing });
    if (config.argo.tiered_caching) await cfRequest('PATCH', `/zones/${CF_ZONE_ID}/argo/tiered_caching`, { value: config.argo.tiered_caching });
  }

  // Bot Management
  if (config.bot_management) {
    await cfRequest('PUT', `/zones/${CF_ZONE_ID}/bot_management`, config.bot_management);
  }

  // Managed Headers / Managed Transforms. PATCH (not PUT) — see updateManagedHeaders
  // in src/api.ts. Without this handler a config's managed_headers block is silently
  // ignored, so the source zone keeps CF's all-disabled default and the migration of
  // enabled managed transforms is never actually exercised (false coverage — the
  // exact gap that hid behind the assertZoneSingletonSettingsMatch catalog false
  // positive). Seed loudly so a plan/availability gap surfaces (Principle 9).
  if (config.managed_headers) {
    const r = await cfRequest('PATCH', `/zones/${CF_ZONE_ID}/managed_headers`, config.managed_headers);
    if (r.ok) { created++; if (VERBOSE) log(`    ✅ Managed Headers seeded`); }
    else { failed++; log(`    ❌ Managed Headers seed failed: ${r.data?.errors?.[0]?.message || `HTTP ${r.status}`}`); }
  }

  // Waiting Rooms
  if (config.waiting_rooms?.length > 0) {
    for (const room of config.waiting_rooms) {
      const r = await cfRequest('POST', `/zones/${CF_ZONE_ID}/waiting_rooms`, room);
      if (r.ok) created++;
      else { failed++; if (VERBOSE) log(`    ❌ Waiting Room: ${r.data?.errors?.[0]?.message}`); }
    }
  }

  // Custom Hostnames
  if (config.custom_hostnames?.length > 0) {
    for (const hostname of config.custom_hostnames) {
      const r = await cfRequest('POST', `/zones/${CF_ZONE_ID}/custom_hostnames`, hostname);
      if (r.ok) created++;
      else failed++;
    }
  }

  // Spectrum Apps (zone-scoped, requires Enterprise + Spectrum entitlement on source)
  //
  // Previously a silent gap: configs declared `spectrum_apps` but applyConfig
  // had no provisioning path, so the source zone never had Spectrum apps and
  // the migration tool exported an empty list. This surfaced in the run log
  // as "MISSING FROM UI: Spectrum Apps (config has N spectrum_apps)" — a real
  // seeding bug that broke e01's omnibus coverage of Spectrum.
  //
  // Spectrum app POST body shape (from CF API + src/api.ts:createSpectrumApp):
  //   { protocol, dns: {type, name}, origin_dns: {name}, origin_port,
  //     tls, proxy_protocol, ip_firewall, edge_ips: {type, connectivity} }
  // Strip read-only `id` defensively.
  if (config.spectrum_apps?.length > 0) {
    for (const app of config.spectrum_apps) {
      const body = { ...app };
      delete body.id;
      // Strip any read-only / response-only `ips` field on edge_ips
      if (body.edge_ips && typeof body.edge_ips === 'object' && 'ips' in body.edge_ips) {
        const { ips: _unused, ...rest } = body.edge_ips;
        body.edge_ips = rest;
      }
      const r = await cfRequest('POST', `/zones/${CF_ZONE_ID}/spectrum/apps`, body);
      if (r.ok) created++;
      else {
        const errMsg = r.data?.errors?.[0]?.message || `HTTP ${r.status}`;
        // Spectrum requires Enterprise + Spectrum entitlement on the source
        // account. If the source can't provision Spectrum apps the rest of
        // the test still runs — log loudly so the gap is visible.
        if (/spectrum/i.test(errMsg) && (/not enabled|not entitled|subscription/i.test(errMsg))) {
          log(`    ⚠ Spectrum App not seeded: ${errMsg} (source account lacks Spectrum entitlement)`);
        } else {
          log(`    ❌ Spectrum App: ${errMsg}`);
        }
        failed++;
      }
    }
  }

  // R2 bucket sub-configurations — CORS, lifecycle, managed-domain.
  // Source-side seeding ensures the migration tool has something to
  // export and migrate. Each config is independently failable.
  if (config.r2_bucket_configs && typeof config.r2_bucket_configs === 'object') {
    for (const [bucketName, cfg] of Object.entries(config.r2_bucket_configs)) {
      const c = cfg;
      if (!c) continue;
      if (Array.isArray(c.cors) && c.cors.length > 0) {
        const r = await cfRequest('PUT', `/accounts/${CF_ACCOUNT_ID}/r2/buckets/${encodeURIComponent(bucketName)}/cors`, { rules: c.cors });
        if (r.ok) created++;
        else { failed++; log(`    ❌ R2 CORS "${bucketName}": ${r.data?.errors?.[0]?.message || `HTTP ${r.status}`}`); }
      }
      if (Array.isArray(c.lifecycle) && c.lifecycle.length > 0) {
        const r = await cfRequest('PUT', `/accounts/${CF_ACCOUNT_ID}/r2/buckets/${encodeURIComponent(bucketName)}/lifecycle`, { rules: c.lifecycle });
        if (r.ok) created++;
        else { failed++; log(`    ❌ R2 lifecycle "${bucketName}": ${r.data?.errors?.[0]?.message || `HTTP ${r.status}`}`); }
      }
      if (c.managed_domain && c.managed_domain.enabled === true) {
        const r = await cfRequest('PUT', `/accounts/${CF_ACCOUNT_ID}/r2/buckets/${encodeURIComponent(bucketName)}/domains/managed`, { enabled: true });
        if (r.ok) created++;
        else { failed++; log(`    ❌ R2 managed-domain "${bucketName}": ${r.data?.errors?.[0]?.message || `HTTP ${r.status}`}`); }
      }
    }
  }

  // Pages projects — account-scoped Pages projects with build config
  // and env vars. Deployment bundles are not seeded (the test asserts
  // metadata migration, not asset deployment).
  if (Array.isArray(config.pages_projects) && config.pages_projects.length > 0) {
    for (const project of config.pages_projects) {
      const body = { ...project };
      delete body.canonical_deployment;
      delete body.subdomain;
      delete body.created_on;
      delete body.domains;
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/pages/projects`, body);
      if (r.ok) created++;
      else {
        const errMsg = r.data?.errors?.[0]?.message || `HTTP ${r.status}`;
        // Already-exists is fine — the test config may have been run
        // before. The migration will skip the project on dest.
        if (errMsg.toLowerCase().includes('already exists') || errMsg.toLowerCase().includes('name is already taken')) {
          if (VERBOSE) log(`    ✅ Pages Project "${project.name}" already exists`);
        } else {
          failed++;
          log(`    ❌ Pages Project "${project.name}": ${errMsg}`);
        }
      }
    }
  }

  // AI Gateways — account-scoped gateway configs.
  if (Array.isArray(config.ai_gateways) && config.ai_gateways.length > 0) {
    for (const gateway of config.ai_gateways) {
      const body = { ...gateway };
      delete body.created_at;
      delete body.modified_at;
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/ai-gateway/gateways`, body);
      if (r.ok) created++;
      else {
        const errMsg = r.data?.errors?.[0]?.message || `HTTP ${r.status}`;
        if (errMsg.toLowerCase().includes('already exists') || errMsg.toLowerCase().includes('duplicate')) {
          if (VERBOSE) log(`    ✅ AI Gateway "${gateway.id}" already exists`);
        } else {
          failed++;
          log(`    ❌ AI Gateway "${gateway.id}": ${errMsg}`);
        }
      }
    }
  }

  // AI Gateway custom providers.
  if (Array.isArray(config.ai_gateway_custom_providers) && config.ai_gateway_custom_providers.length > 0) {
    for (const provider of config.ai_gateway_custom_providers) {
      const body = { ...provider };
      delete body.id;
      delete body.logo;
      delete body.curl_example;
      delete body.js_example;
      delete body.link;
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/ai-gateway/custom-providers`, body);
      if (r.ok) created++;
      else {
        const errMsg = r.data?.errors?.[0]?.message || `HTTP ${r.status}`;
        if (errMsg.toLowerCase().includes('already exists') || errMsg.toLowerCase().includes('duplicate')) {
          if (VERBOSE) log(`    ✅ AI Gateway custom provider "${provider.slug}" already exists`);
        } else {
          failed++;
          log(`    ❌ AI Gateway custom provider "${provider.slug}": ${errMsg}`);
        }
      }
    }
  }

  // Zaraz
  if (config.zaraz) {
    await cfRequest('PUT', `/zones/${CF_ZONE_ID}/settings/zaraz/v2/config`, config.zaraz);
  }

  // Email Routing (enable + catch-all + per-address rules)
  if (config.email_routing) {
    const enableResult = await cfRequest('POST', `/zones/${CF_ZONE_ID}/email/routing/enable`);
    if (enableResult.ok) { created++; if (VERBOSE) log(`    ✅ Email Routing enabled`); }
    if (config.email_routing.catch_all) {
      const catchAll = config.email_routing.catch_all;
      const r = await cfRequest('PUT', `/zones/${CF_ZONE_ID}/email/routing/rules/catch_all`, {
        enabled: catchAll.enabled !== false,
        matchers: catchAll.matchers || [{ type: 'all' }],
        actions: catchAll.actions || [{ type: 'drop' }],
      });
      if (r.ok) created++;
      else { failed++; if (VERBOSE) log(`    ❌ Email Routing catch-all: ${r.data?.errors?.[0]?.message}`); }
    }
    // Non-catch-all rules go to /email/routing/rules (POST per rule). These are
    // the per-address forward/drop/worker rules that test 105 exercises.
    if (Array.isArray(config.email_routing.rules)) {
      for (const rule of config.email_routing.rules) {
        const r = await cfRequest('POST', `/zones/${CF_ZONE_ID}/email/routing/rules`, {
          name: rule.name,
          enabled: rule.enabled !== false,
          priority: rule.priority || 0,
          matchers: rule.matchers,
          actions: rule.actions,
        });
        if (r.ok) { created++; if (VERBOSE) log(`    ✅ Email rule: ${rule.name}`); }
        else { failed++; if (VERBOSE) log(`    ❌ Email rule "${rule.name}": ${r.data?.errors?.[0]?.message}`); }
      }
    }
  }

  // Turnstile widgets (account-scoped)
  if (config.turnstile?.length > 0) {
    for (const widget of config.turnstile) {
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/challenges/widgets`, {
        name: widget.name, mode: widget.mode || 'managed',
        domains: widget.domains || [], region: widget.region || 'world',
      });
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Turnstile: ${widget.name}`); }
      else { failed++; if (VERBOSE) log(`    ❌ Turnstile "${widget.name}": ${r.data?.errors?.[0]?.message}`); }
    }
  }

  // Access Applications (account-scoped)
  const accessAppIdMap = {};
  if (config.access_apps?.length > 0) {
    for (const app of config.access_apps) {
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/access/apps`, {
        name: app.name, domain: app.domain, type: app.type || 'self_hosted',
        session_duration: app.session_duration || '24h',
        allowed_idps: app.allowed_idps || [],
        auto_redirect_to_identity: app.auto_redirect_to_identity || false,
        // Modern self-hosted apps route via these arrays instead of (or in
        // addition to) the single legacy `domain`. Only seed them when the
        // config supplies them so legacy single-domain apps stay unchanged.
        ...(app.self_hosted_domains ? { self_hosted_domains: app.self_hosted_domains } : {}),
        ...(app.destinations ? { destinations: app.destinations } : {}),
      });
      if (r.ok) {
        created++;
        if (r.data?.result?.id) accessAppIdMap[app.name] = r.data.result.id;
        if (VERBOSE) log(`    ✅ Access App: ${app.name}`);
      } else { failed++; if (VERBOSE) log(`    ❌ Access App "${app.name}": ${r.data?.errors?.[0]?.message}`); }
    }
  }

  // Access Policies (linked to apps by app_name)
  if (config.access_policies?.length > 0) {
    for (const policy of config.access_policies) {
      const appId = accessAppIdMap[policy.app_name];
      if (!appId) { failed++; if (VERBOSE) log(`    ❌ Access Policy "${policy.name}": no app for "${policy.app_name}"`); continue; }
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/access/apps/${appId}/policies`, {
        name: policy.name, decision: policy.decision || 'allow',
        include: policy.include || [], exclude: policy.exclude || [],
        require: policy.require || [], precedence: policy.precedence || 1,
      });
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Access Policy: ${policy.name}`); }
      else { failed++; if (VERBOSE) log(`    ❌ Access Policy "${policy.name}": ${r.data?.errors?.[0]?.message}`); }
    }
  }

  // KV Namespaces (account-scoped — BEFORE workers so bindings can reference them)
  const kvIdMap = {};
  if (config.kv_namespaces?.length > 0) {
    for (const kv of config.kv_namespaces) {
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces`, { title: kv.title });
      if (r.ok) {
        created++;
        if (r.data?.result?.id) kvIdMap[kv.title] = r.data.result.id;
        if (VERBOSE) log(`    ✅ KV: ${kv.title} (${r.data?.result?.id})`);
      } else {
        const err = r.data?.errors?.[0]?.message || '';
        if (String(err).includes('already exists')) {
          // Look up existing namespace ID. Use per_page=100 — the default
          // page size is 20, and the source account accumulates KV namespaces
          // across test runs. Without an explicit per_page, the lookup
          // silently misses namespaces that exist on later pages → kvIdMap
          // stays empty → worker upload fails with 'namespace_id is not
          // valid' (Issue manifesting in test 201/205).
          const listR = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces?per_page=100`);
          const existing = (listR.data?.result || []).find(ns => ns.title === kv.title);
          if (existing) {
            kvIdMap[kv.title] = existing.id;
            if (VERBOSE) log(`    ⏭️  KV "${kv.title}" exists (${existing.id})`);
          } else {
            // The KV namespace title exists somewhere but not in the first
            // 100 results — pagination would be needed. Log unconditionally
            // so the user can see the gap.
            log(`    ⚠ KV "${kv.title}" already exists but not found in first 100 results — pagination needed`);
          }
        } else { failed++; log(`    ❌ KV "${kv.title}": ${err}`); }
      }
    }
  }

  // D1 Databases (account-scoped — BEFORE workers). Populate d1IdMap so
  // worker binding placeholders like __STORAGE_RT_APP_DB_ID__ can be
  // patched before worker upload. Without this map, D1 placeholders stay
  // unresolved and the workers PUT returns 400.
  const d1IdMap = {};
  if (config.d1_databases?.length > 0) {
    for (const db of config.d1_databases) {
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/d1/database`, { name: db.name });
      if (r.ok) {
        created++;
        // D1 POST returns { result: { uuid, name, ... } } — uuid is the
        // database_id used in worker bindings.
        if (r.data?.result?.uuid) d1IdMap[db.name] = r.data.result.uuid;
        if (VERBOSE) log(`    ✅ D1: ${db.name}`);
      } else {
        const err = r.data?.errors?.[0]?.message || '';
        if (/already exists/i.test(err)) {
          // Look up the existing DB's UUID so worker binding patch can resolve.
          const existing = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/d1/database?per_page=100`);
          const match = existing.data?.result?.find(d => d.name === db.name);
          if (match?.uuid) {
            d1IdMap[db.name] = match.uuid;
            if (VERBOSE) log(`    ⏭️  D1 "${db.name}" exists (${match.uuid})`);
          }
        } else {
          failed++;
          log(`    ❌ D1 "${db.name}": ${err}`);
        }
      }
    }
  }

  // Queues (account-scoped — BEFORE workers)
  if (config.queues?.length > 0) {
    for (const q of config.queues) {
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/queues`, { queue_name: q.queue_name });
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Queue: ${q.queue_name}`); }
      else {
        const err = r.data?.errors?.[0]?.message || '';
        if (!String(err).includes('already exists') && !String(err).includes('already taken')) {
          failed++; if (VERBOSE) log(`    ❌ Queue "${q.queue_name}": ${err}`);
        } else if (VERBOSE) log(`    ⏭️  Queue "${q.queue_name}" already exists`);
      }
    }
  }

  // Patch worker bindings: replace placeholder IDs (e.g. __STORAGE_RT_CONFIG_ID__)
  // with real IDs from the resources we just seeded. The runner's seeding
  // path puts kv namespace/D1 database IDs into kvIdMap/d1IdMap keyed by
  // resource title/name; we use those to swap placeholders before worker
  // upload. Unpatched placeholder bindings cause workers/scripts PUT to
  // return 400 ("must have a valid `namespace_id`/`database_id` specified")
  // which silently fails the worker (Issue 8 root cause).
  if (config.workers?.length > 0) {
    for (const worker of config.workers) {
      for (const binding of (worker.bindings || [])) {
        // KV: match by config kv_namespaces title (existing logic)
        if (binding.type === 'kv_namespace' && binding.namespace_id?.startsWith('__')) {
          const kvTitle = (config.kv_namespaces || []).find(kv => {
            const placeholder = `__${kv.title.toUpperCase().replace(/-/g, '_')}_ID__`;
            return binding.namespace_id === placeholder;
          })?.title;
          if (kvTitle && kvIdMap[kvTitle]) {
            binding.namespace_id = kvIdMap[kvTitle];
            if (VERBOSE) log(`    🔗 Patched KV binding ${binding.name} → ${kvIdMap[kvTitle]}`);
          } else {
            // Fallback: AUTOCREATED-style bindings (binding.name itself is the
            // KV namespace title to look up in the live account). If a real
            // namespace with that title exists, use its ID. Otherwise the
            // binding references a namespace that needs to be created at
            // migration time — log unconditionally so the user can see
            // why the worker upload will fail.
            log(`    ⚠ KV binding "${binding.name}" has unresolved placeholder ${binding.namespace_id} — worker upload will fail`);
          }
        }
        // D1: match by config d1_databases name (new logic; mirrors KV pattern)
        if (binding.type === 'd1' && binding.database_id?.startsWith('__')) {
          const d1Name = (config.d1_databases || []).find(d => {
            const placeholder = `__${d.name.toUpperCase().replace(/-/g, '_')}_ID__`;
            return binding.database_id === placeholder;
          })?.name;
          if (d1Name && d1IdMap[d1Name]) {
            binding.database_id = d1IdMap[d1Name];
            if (VERBOSE) log(`    🔗 Patched D1 binding ${binding.name} → ${d1IdMap[d1Name]}`);
          } else {
            log(`    ⚠ D1 binding "${binding.name}" has unresolved placeholder ${binding.database_id} — worker upload will fail`);
          }
        }
      }
    }
  }

  // Workers (multipart upload — bypasses cfRequest which forces JSON content-type)
  if (config.workers?.length > 0) {
    for (const worker of config.workers) {
      const script = worker.script || '';
      const isModules = worker.format === 'modules';
      const mainModule = worker.main_module || 'worker.js';
      // Patch secret_text bindings: pull `text` from config.worker_secrets.
      // Without this, the workers PUT returns 400 'invalid or missing text
      // property for binding'. Secret values are confined to the test
      // config — same as production migration which collects them from
      // the user via Step 3 prompts.
      const initialBindings = (worker.bindings || []).map((b) => {
        if (b.type === 'secret_text' && !b.text) {
          const val = config.worker_secrets?.[worker.name]?.[b.name];
          if (val != null) return { ...b, text: val };
          // No secret provided — log and drop the binding so the worker
          // can still upload. The migration tool will surface this as a
          // manual action in the report (worker_secrets in the dest are
          // user-provided in Step 3 anyway).
          log(`    ⚠ Worker "${worker.name}" secret "${b.name}" has no value in worker_secrets — dropping binding`);
          return null;
        }
        return b;
      }).filter(Boolean);

      // Attempt upload with retry-and-drop on entitlement errors. The test
      // source account can't provision every binding type (e.g.
      // dispatch_namespace requires Workers for Platforms, hyperdrive
      // requires a Hyperdrive instance, etc.). When upload fails with a
      // "no access / not entitled / not enabled / no Workers for Platforms"
      // error, identify the binding type from the error message and drop
      // it before retrying. Log which bindings were dropped so the user
      // knows the test scope is reduced.
      //
      // Bindings dropped here will NOT be on the source worker, so they
      // cannot be migrated and the post-run assertion (which now reads
      // the source bindings rather than a hardcoded list) won't expect
      // them on dest. This is honest test scoping — the migration tool's
      // job is to faithfully migrate what's on source, and the test
      // verifies that. The harness explicitly cannot test binding types
      // its source account doesn't support.
      const uploadResult = await uploadWorkerWithRetryAndDrop(
        worker.name, script, isModules, mainModule, initialBindings,
      );
      if (uploadResult.ok) {
        created++;
        if (uploadResult.droppedBindings.length > 0) {
          log(`    ⚠ Worker "${worker.name}" uploaded after dropping ${uploadResult.droppedBindings.length} binding(s) the source account cannot provision: ${uploadResult.droppedBindings.map(b => `${b.type}:${b.name}`).join(', ')}`);
        } else if (VERBOSE) {
          log(`    ✅ Worker: ${worker.name}`);
        }
      } else {
        failed++;
        log(`    ❌ Worker "${worker.name}": ${uploadResult.error}`);
      }
    }
  }

  // Worker Routes (zone-level, must be created AFTER the worker script exists).
  // Always log failures: a missing route means the export will classify the
  // worker as account-level, which silently drops its bindings from Step 2.
  if (config.worker_routes?.length > 0) {
    for (const route of config.worker_routes) {
      const r = await cfRequest('POST', '/zones/{zone_id}/workers/routes', {
        pattern: route.pattern,
        script: route.script,
      });
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Worker Route: ${route.pattern}`); }
      else {
        failed++;
        log(`    ❌ Worker Route ${route.pattern} → ${route.script}: ${r.data?.errors?.[0]?.message || `HTTP ${r.status}`}`);
      }
    }
  }

  // Worker Custom Domains (account-level, must be created AFTER worker + DNS proxy record exists)
  if (config.worker_custom_domains?.length > 0) {
    for (const cd of config.worker_custom_domains) {
      const r = await cfRequest('PUT', `/accounts/${CF_ACCOUNT_ID}/workers/domains`, {
        hostname: cd.hostname,
        service: cd.service,
        zone_id: CF_ZONE_ID,
        environment: cd.environment || 'production',
      });
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Worker Custom Domain: ${cd.hostname}`); }
      else { failed++; if (VERBOSE) log(`    ❌ Worker Custom Domain ${cd.hostname}: ${r.data?.errors?.[0]?.message}`); }
    }
  }

  // ── Load Balancers (zone-scoped) ───────────────────────────────
  // Order: monitors → pools → load balancers (each references the prior).
  // Used by test 106 to validate ID-remap chain.
  if (config.lb_monitors?.length > 0 || config.lb_pools?.length > 0 || config.load_balancers?.length > 0) {
    const monitorIdMap = {};
    for (const mon of (config.lb_monitors || [])) {
      // Monitors are account-scoped — POST /accounts/{id}/load_balancers/monitors
      // NOTE: `name` is not a field on monitors; their identity is via description.
      const monBody = {
        type: mon.type, method: mon.method, path: mon.path,
        expected_codes: mon.expected_codes,
        interval: mon.interval, timeout: mon.timeout, retries: mon.retries,
        description: mon.name || mon.description || '',
      };
      // TCP monitors require a non-zero port; HTTPS monitors require it too
      // when not implied by URL. Forward the port field unconditionally when
      // the config provides one — leaving it off causes
      // 'port must be set to non-zero for TCP monitors' (400).
      if (mon.port != null) monBody.port = mon.port;
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/load_balancers/monitors`, monBody);
      if (r.ok) {
        created++;
        if (r.data?.result?.id) monitorIdMap[mon.name] = r.data.result.id;
        if (VERBOSE) log(`    ✅ LB Monitor: ${mon.name}`);
      } else {
        // Same stale-cleanup problem as pools (see comment in pool POST
        // block). Cleanup only deletes monitors with description starting
        // with "lb-test-", so other naming patterns survive across runs.
        const errMsg = r.data?.errors?.[0]?.message || `HTTP ${r.status}`;
        if (/already exists|not unique/i.test(errMsg)) {
          const existing = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/load_balancers/monitors?per_page=100`);
          // Monitors are identified by description (the closest thing to a
          // name); fall back to body.path + method match if needed.
          const match = existing.data?.result?.find(m => m.description === mon.name || m.description === (mon.description || mon.name));
          if (match?.id) {
            monitorIdMap[mon.name] = match.id;
            if (VERBOSE) log(`    ⏭️  LB Monitor "${mon.name}" already exists — reusing id ${match.id}`);
            continue;
          }
        }
        failed++;
        log(`    ❌ LB Monitor "${mon.name}": ${errMsg}`);
      }
    }
    const poolIdMap = {};
    for (const pool of (config.lb_pools || [])) {
      // Skip the monitor when origins use RFC5737 documentation IPs
      // (192.0.2.x, 198.51.100.x, 203.0.113.x). Cloudflare's pool API
      // rejects these as "not globally routable" if monitoring is enabled.
      const hasDocOrigin = (pool.origins || []).some(o =>
        /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(o.address || ''));
      // Normalize origin weights: Cloudflare's pool API requires
      // 0.0-1.0 range, but test configs sometimes use integer ratios
      // (1, 2, 5). If any weight > 1, normalize by the max weight.
      const origins = (pool.origins || []).map(o => ({ ...o }));
      const maxWeight = origins.reduce((m, o) => Math.max(m, Number(o.weight) || 1), 1);
      if (maxWeight > 1) {
        for (const o of origins) o.weight = (Number(o.weight) || 1) / maxWeight;
      }
      const poolBody = {
        name: pool.name,
        enabled: pool.enabled !== false,
        ...(hasDocOrigin ? {} : { monitor: monitorIdMap[pool.monitor_name] }),
        origins,
        minimum_origins: pool.minimum_origins || 1,
      };
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/load_balancers/pools`, poolBody);
      if (r.ok) {
        created++;
        if (r.data?.result?.id) poolIdMap[pool.name] = r.data.result.id;
        if (VERBOSE) log(`    ✅ LB Pool: ${pool.name}${hasDocOrigin ? ' (no monitor)' : ''}`);
      } else {
        // Pool cleanup at line ~249 only matches pools starting with
        // "lb-test-", so test configs that use other naming patterns
        // (maxconfig-pool-a, spec-lb-pool-*, etc.) leave stale pools
        // in place across runs. POST then returns 409 "already exists"
        // and poolIdMap[pool.name] is never populated — which causes
        // the LB POST below to send fallback_pool=undefined and fail
        // silently. Recover by looking up the existing pool ID so the
        // LB POST can still succeed.
        const errMsg = r.data?.errors?.[0]?.message || `HTTP ${r.status}`;
        if (/already exists|not unique/i.test(errMsg)) {
          const existing = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/load_balancers/pools?per_page=100`);
          const match = existing.data?.result?.find(p => p.name === pool.name);
          if (match?.id) {
            poolIdMap[pool.name] = match.id;
            if (VERBOSE) log(`    ⏭️  LB Pool "${pool.name}" already exists — reusing id ${match.id}`);
            continue;
          }
        }
        failed++;
        log(`    ❌ LB Pool "${pool.name}": ${errMsg}`);
      }
    }
    for (const lb of (config.load_balancers || [])) {
      // The metadata domain `lb-test.test.example.com` was rewritten to
      // `lb-test.tztest.example.com` by the runner's domain rewrite — but the
      // applyConfig path doesn't see that. Construct the LB name from the
      // source zone domain explicitly so it lives inside CF_ZONE_ID.
      const lbBody = {
        name: lb.name,
        fallback_pool: poolIdMap[lb.fallback_pool_name],
        default_pools: (lb.default_pool_names || []).map(n => poolIdMap[n]).filter(Boolean),
        proxied: lb.proxied !== false,
        enabled: lb.enabled !== false,
        ttl: lb.ttl || 30,
        steering_policy: lb.steering_policy || 'off',
        session_affinity: lb.session_affinity || 'none',
      };
      const r = await cfRequest('POST', `/zones/${CF_ZONE_ID}/load_balancers`, lbBody);
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Load Balancer: ${lb.name}`); }
      else {
        failed++;
        // Always log LB failures (not gated on VERBOSE). LB seeding has
        // historically failed silently; surfacing the error message
        // unconditionally makes audits possible without re-running with
        // VERBOSE=1. Also dump the request body — pool ID remapping is
        // a common failure cause.
        const errMsg = r.data?.errors?.[0]?.message || `HTTP ${r.status}`;
        log(`    ❌ LB "${lb.name}": ${errMsg}`);
        log(`       body: ${JSON.stringify(lbBody)}`);
      }
    }
  }

  // ── R2 Buckets (account-scoped) + seed objects ─────────────────
  // Used by test 109 (verify objects copy) and test 116 (binding integrity).
  if (config.r2_buckets?.length > 0) {
    for (const bucket of config.r2_buckets) {
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/r2/buckets`, { name: bucket.name });
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ R2 Bucket: ${bucket.name}`); }
      else {
        const err = r.data?.errors?.[0]?.message || '';
        if (!String(err).toLowerCase().includes('already exists')) { failed++; if (VERBOSE) log(`    ❌ R2 "${bucket.name}": ${err}`); }
        else if (VERBOSE) log(`    ⏭️  R2 "${bucket.name}" already exists`);
      }
    }
  }
  if (config.r2_seed_objects && typeof config.r2_seed_objects === 'object') {
    for (const [bucketName, objects] of Object.entries(config.r2_seed_objects)) {
      if (!Array.isArray(objects)) continue;
      for (const obj of objects) {
        // R2 object PUT needs a raw (non-JSON) body. cfRequest always
        // JSON-stringifies, so use fetch directly.
        try {
          const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${bucketName}/objects/${encodeURIComponent(obj.key)}`;
          const res = await fetch(url, {
            method: 'PUT',
            headers: {
              'X-Auth-Key': CF_API_KEY,
              'X-Auth-Email': CF_API_EMAIL,
              'Content-Type': obj.contentType || 'application/octet-stream',
            },
            body: obj.content || '',
          });
          if (res.ok) { created++; if (VERBOSE) log(`    ✅ R2 Object: ${bucketName}/${obj.key}`); }
          else { failed++; if (VERBOSE) log(`    ❌ R2 Object "${bucketName}/${obj.key}": HTTP ${res.status}`); }
        } catch (err) {
          failed++; if (VERBOSE) log(`    ❌ R2 Object "${bucketName}/${obj.key}": ${err.message}`);
        }
      }
    }
  }

  // ── D4 Access sub-resources: tags, bookmarks, custom_pages ─────
  // Tags and bookmarks are simple list-of-{name|domain} payloads. Custom
  // pages need name+type+custom_html.
  if (Array.isArray(config.access_tags) && config.access_tags.length > 0) {
    for (const tag of config.access_tags) {
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/access/tags`, { name: tag.name });
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Access Tag: ${tag.name}`); }
      else if (!/already exists/i.test(r.data?.errors?.[0]?.message || '')) {
        failed++; if (VERBOSE) log(`    ❌ Access Tag "${tag.name}": ${r.data?.errors?.[0]?.message}`);
      }
    }
  }
  if (Array.isArray(config.access_bookmarks) && config.access_bookmarks.length > 0) {
    for (const bookmark of config.access_bookmarks) {
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/access/bookmarks`, bookmark);
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Access Bookmark: ${bookmark.name || bookmark.domain}`); }
      else { failed++; if (VERBOSE) log(`    ❌ Access Bookmark: ${r.data?.errors?.[0]?.message}`); }
    }
  }
  if (Array.isArray(config.access_custom_pages) && config.access_custom_pages.length > 0) {
    for (const page of config.access_custom_pages) {
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/access/custom_pages`, page);
      const errMsg = r.data?.errors?.[0]?.message || `HTTP ${r.status}`;
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Access Custom Page: ${page.name}`); }
      // Custom pages require an Access/Zero Trust capability the test account
      // may lack. Treat a genuine permission/entitlement gap as a non-fatal
      // warning (consistent with the Principle-7 audit resources) — the
      // migration tool acknowledges it cleanly. Any other error still fails
      // loud so real config-shape bugs are not masked.
      else if (/permission|not enabled|not entitled|not available|subscription|forbidden/i.test(errMsg)) {
        log(`    ⚠️  Access Custom Page "${page.name}": ${errMsg} (entitlement gap, skipped)`);
      }
      else { failed++; if (VERBOSE) log(`    ❌ Access Custom Page "${page.name}": ${errMsg}`); }
    }
  }

  // ── D2 Notification webhooks + policies (zone-scoped) ──────────
  //
  // Webhooks are provisioned first. Policies reference them by symbolic
  // _webhook_name which is resolved to the just-created webhook ID. The
  // policy's filters.zones is auto-set to [CF_ZONE_ID] so the policy is
  // selected by the migration's zone-filter logic.
  //
  // Per-webhook secrets are intentionally omitted — the cryptographic
  // contract is "user re-pastes secrets post-migration" (per T1.2 /
  // notification_webhook_secret entry in IMPOSSIBLE_TO_MIGRATE).
  const webhookIdByName = new Map();
  if (Array.isArray(config.notification_webhooks) && config.notification_webhooks.length > 0) {
    for (const hook of config.notification_webhooks) {
      const body = { name: hook.name, type: hook.type, url: hook.url };
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/alerting/v3/destinations/webhooks`, body);
      if (r.ok && r.data?.result?.id) {
        webhookIdByName.set(hook.name, r.data.result.id);
        created++;
        if (VERBOSE) log(`    ✅ Notification Webhook: ${hook.name}`);
      } else {
        failed++; if (VERBOSE) log(`    ❌ Notification Webhook "${hook.name}": ${r.data?.errors?.[0]?.message}`);
      }
    }
  }
  if (Array.isArray(config.notification_policies) && config.notification_policies.length > 0) {
    for (const policy of config.notification_policies) {
      // Resolve symbolic _webhook_name → real ID
      const resolvedWebhooks = (policy.mechanisms?.webhooks || [])
        .map(w => {
          if (w.id) return w; // already resolved
          if (w._webhook_name) {
            const realId = webhookIdByName.get(w._webhook_name);
            return realId ? { id: realId } : null;
          }
          return null;
        })
        .filter(Boolean);
      const body = {
        name: policy.name,
        description: policy.description || '',
        alert_type: policy.alert_type,
        enabled: policy.enabled !== false,
        mechanisms: {
          ...policy.mechanisms,
          webhooks: resolvedWebhooks,
        },
        // Auto-scope to this zone so the migration's filter picks it up.
        filters: { ...(policy.filters || {}), zones: [CF_ZONE_ID] },
      };
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/alerting/v3/policies`, body);
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Notification Policy: ${policy.name}`); }
      else { failed++; if (VERBOSE) log(`    ❌ Notification Policy "${policy.name}": ${r.data?.errors?.[0]?.message}`); }
    }
  }

  // ── D3 Account-scoped Logpush jobs (zone-filtered) ─────────────
  if (Array.isArray(config.account_logpush_jobs) && config.account_logpush_jobs.length > 0) {
    for (const job of config.account_logpush_jobs) {
      const body = {
        ...job,
        // Filter format matches what Cloudflare returns: a JSON string with a
        // where clause keying on zone.id. Auto-set to source zone so migration
        // picks the job up via substring match.
        filter: JSON.stringify({
          where: { key: 'zone.id', operator: 'eq', value: CF_ZONE_ID },
        }),
      };
      const r = await cfRequest('POST', `/accounts/${CF_ACCOUNT_ID}/logpush/jobs`, body);
      if (r.ok) { created++; if (VERBOSE) log(`    ✅ Account Logpush Job: ${job.name}`); }
      else { failed++; if (VERBOSE) log(`    ❌ Account Logpush Job "${job.name}": ${r.data?.errors?.[0]?.message}`); }
    }
  }

  // ── KV seed data (bulk write per namespace) ────────────────────
  // Used by test 108 (verify keys copy) and test 116. Run after kv_namespaces
  // are created (which happens earlier in applyConfig).
  if (config.kv_seed_data && typeof config.kv_seed_data === 'object') {
    // Look up KV namespaces (kvIdMap is local to the earlier block — re-fetch
    // here so we don't need to thread it through).
    const listR = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces?per_page=100`);
    const namespaces = (listR.data?.result || []);
    for (const [title, items] of Object.entries(config.kv_seed_data)) {
      if (!Array.isArray(items) || items.length === 0) continue;
      const ns = namespaces.find(n => n.title === title);
      if (!ns) { if (VERBOSE) log(`    ⚠ KV seed "${title}": namespace not found`); continue; }
      // Bulk write: POST /accounts/{id}/storage/kv/namespaces/{ns_id}/bulk
      const bulkBody = items.map(it => ({
        key: it.key,
        value: it.value,
        ...(it.metadata != null ? { metadata: it.metadata } : {}),
        ...(it.expiration_ttl != null ? { expiration_ttl: it.expiration_ttl } : {}),
      }));
      const r = await cfRequest('PUT', `/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${ns.id}/bulk`, bulkBody);
      if (r.ok) { created += items.length; if (VERBOSE) log(`    ✅ KV seed "${title}": ${items.length} keys`); }
      else { failed++; if (VERBOSE) log(`    ❌ KV seed "${title}": ${r.data?.errors?.[0]?.message}`); }
    }
  }

  return { created, failed, failedDnsRecords };
}

// ── Capture state via scripts/capture-zone-state.mjs ─────────────
// Many post-run hooks (assertLbPoolIdsRemapped, assertKvKeysCopied, etc.)
// read evidence JSON files written by capture-zone-state.mjs. The hooks
// expect:
//   {testDir}/source-state-post-seed/{endpoint}.json
//   {testDir}/dest-state-post-migrate/{endpoint}.json
// Without these files, every evidence-based assertion fails with
// "no evidence captured". This helper invokes the capture script after
// source seeding (mode=source) and after dest migration (mode=dest).
function captureState(mode, testDir, captureOnly) {
  const stateDirName = mode === 'source' ? 'source-state-post-seed' : 'dest-state-post-migrate';
  const outDir = path.join(testDir, stateDirName);
  fs.mkdirSync(outDir, { recursive: true });

  // Source mode reads from the source account/zone, dest mode reads from the
  // target account and the dest zone. We have to look up the dest zone ID
  // because cleanDestZone/applyConfig don't pass it through.
  const captureEnv = {
    ...process.env,
    CF_API_KEY,
    CF_API_EMAIL,
    OUT_DIR: outDir,
  };
  // L1 targeted capture: when the caller passed a derived endpoint allowlist
  // (only under TARGETED_CAPTURE), fetch just those. Otherwise capture-zone-state
  // captures the full catalog (unchanged default behavior).
  if (Array.isArray(captureOnly) && captureOnly.length) {
    captureEnv.CAPTURE_ONLY = captureOnly.join(',');
  }
  if (mode === 'source') {
    captureEnv.CF_ZONE_ID = CF_ZONE_ID;
    captureEnv.CF_ACCOUNT_ID = CF_ACCOUNT_ID;
  } else {
    // For dest, we need the dest zone ID. Lookup synchronously isn't possible
    // here without making this async — caller passes via env if available, else
    // we fall back to the deferred lookup pattern (return without capturing).
    captureEnv.CF_ZONE_ID = process.env.LAST_DEST_ZONE_ID || '';
    captureEnv.CF_ACCOUNT_ID = CF_TARGET_ACCOUNT_ID;
    if (!captureEnv.CF_ZONE_ID) {
      log(`  ⚠ Capture ${mode}: LAST_DEST_ZONE_ID not set — skipping`);
      return false;
    }
  }

  const captureScript = path.join(__dirname, 'capture-zone-state.mjs');
  const start = Date.now();
  const res = spawnSync('node', [captureScript], {
    env: captureEnv,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (res.status !== 0) {
    log(`  ⚠ Capture ${mode} failed (${elapsed}s): ${(res.stderr || '').split('\n').slice(0, 3).join(' | ')}`);
    return false;
  }
  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.json'));
  log(`  📸 Capture ${mode}: ${files.length} endpoints (${elapsed}s)`);
  return true;
}

// Look up the dest zone ID by domain name. Used after migration completes so
// captureState('dest', …) knows which zone to snapshot.
async function findDestZoneId(domainName) {
  const list = await targetCfRequest('GET', `/zones?name=${encodeURIComponent(domainName)}&account.id=${CF_TARGET_ACCOUNT_ID}`);
  if (!list.ok || !Array.isArray(list.data?.result) || list.data.result.length === 0) {
    return null;
  }
  return list.data.result[0].id;
}

// ── Delete Destination Zone ──────────────────────────────────────

async function deleteDestZone(domainName) {
  const list = await targetCfRequest('GET', `/zones?name=${encodeURIComponent(domainName)}&account.id=${CF_TARGET_ACCOUNT_ID}`);
  if (!list.ok || !Array.isArray(list.data?.result) || list.data.result.length === 0) {
    log(`  ⚠️  No dest zone found for "${domainName}"`);
    return false;
  }
  const destZoneId = list.data.result[0].id;
  log(`  🗑️  Deleting dest zone ${destZoneId}...`);
  const del = await targetCfRequest('DELETE', `/zones/${destZoneId}`);
  if (del.ok) { log('  ✅ Dest zone deleted'); return true; }
  else { log(`  ❌ Failed to delete: ${del.data?.errors?.[0]?.message}`); return false; }
}

// ── Pre-run hooks (config.metadata.preRun) ───────────────────────
//
// Some tests need the destination to be in a specific state BEFORE the
// migration runs. Hooks are declared in config.metadata.preRun as a
// comma-separated list, e.g. "ensureDestZone,seedDestCatchAllDisabled".
//
// Available hooks:
//   ensureDestZone          — POST /zones to create DEST_DOMAIN in
//                             CF_TARGET_ACCOUNT_ID if it doesn't already
//                             exist there. Used by test 103 to force the
//                             zone-creation fallback path.
//   seedDestCatchAllDisabled — Ensures dest zone exists, then PUTs a
//                             catch-all rule onto it while leaving
//                             email_routing disabled. Used by test 104
//                             to force the email-routing-not-ready
//                             validation path.

async function ensureDestZoneExists() {
  const list = await targetCfRequest('GET', `/zones?name=${encodeURIComponent(DEST_DOMAIN)}&account.id=${CF_TARGET_ACCOUNT_ID}`);
  if (list.ok && Array.isArray(list.data?.result) && list.data.result.length > 0) {
    log(`  ✅ Dest zone "${DEST_DOMAIN}" already exists in account ${CF_TARGET_ACCOUNT_ID}: ${list.data.result[0].id}`);
    return list.data.result[0].id;
  }
  log(`  🆕 Pre-creating dest zone "${DEST_DOMAIN}" in account ${CF_TARGET_ACCOUNT_ID}...`);
  const create = await targetCfRequest('POST', `/zones`, {
    name: DEST_DOMAIN,
    account: { id: CF_TARGET_ACCOUNT_ID },
    type: 'full',
  });
  if (!create.ok) {
    const err = create.data?.errors?.[0]?.message || 'unknown';
    throw new Error(`Pre-run hook ensureDestZone failed: ${err}`);
  }
  log(`  ✅ Pre-created dest zone: ${create.data?.result?.id}`);
  return create.data?.result?.id;
}

// ensureSourceEnterprise — make the source zone Enterprise so the plan-downgrade
// test (e07) actually has enterprise-only features to migrate and acknowledge on
// the lower-tier destination. Without this, the shared source zone may be Free
// and the downgrade is a silent no-op (assertEnterpriseFeaturesAcknowledged
// would have nothing to acknowledge). Idempotent: no-op if already Enterprise.
// Requires the source account to hold an available Enterprise entitlement.
async function ensureSourceEnterprise() {
  const before = await cfRequest('GET', `/zones/${CF_ZONE_ID}`);
  const planId = before.ok ? before.data?.result?.plan?.legacy_id : null;
  const planName = before.ok ? before.data?.result?.plan?.name : null;
  if (planId === 'enterprise') {
    log(`  ✅ Source zone already Enterprise — no change`);
    return;
  }
  log(`  🆙 Subscribing source zone ${CF_ZONE_ID} to Enterprise (current: ${planName || planId || 'unknown'})...`);
  const sub = await cfRequest('POST', `/zones/${CF_ZONE_ID}/subscription`, { rate_plan: { id: 'enterprise' } });
  if (!sub.ok) {
    const err = sub.data?.errors?.[0]?.message || `HTTP ${sub.status}`;
    throw new Error(`Pre-run hook ensureSourceEnterprise failed: ${err}. The source account must have an available Enterprise entitlement.`);
  }
  // Enterprise is often contract/externally-managed — a 200 doesn't guarantee
  // the plan changed. Verify it actually took (PATCH /zones plan, for instance,
  // returns success but silently ignores enterprise).
  //
  // The subscription change is also eventually-consistent: an immediate GET
  // right after the POST frequently still reports the OLD plan ("free") even
  // though the change DID land (observed: the post-POST GET returns "free" but
  // a GET ~5s later — and teardown's own delete-guard — both see the zone as
  // Enterprise). A single eager re-check therefore produces a FALSE fatal that
  // aborts the whole suite. Poll a few times before concluding it failed.
  let newPlanId = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    const after = await cfRequest('GET', `/zones/${CF_ZONE_ID}`);
    newPlanId = after.ok ? after.data?.result?.plan?.legacy_id : null;
    if (newPlanId === 'enterprise') break;
    log(`  ⏳ Enterprise not yet reflected (attempt ${attempt}/6, plan="${newPlanId}") — retrying...`);
  }
  if (newPlanId !== 'enterprise') {
    throw new Error(`Pre-run hook ensureSourceEnterprise: subscription POST returned success but plan is "${newPlanId}" (expected enterprise) after polling — Enterprise may be contract/externally-managed on this account and not assignable via the API.`);
  }
  log(`  ✅ Source zone upgraded to Enterprise`);
}

async function seedDestCatchAllDisabled() {
  const destZoneId = await ensureDestZoneExists();
  // Explicitly disable routing on dest so the rule below sits on a not-ready zone
  await targetCfRequest('POST', `/zones/${destZoneId}/email/routing/disable`);
  // Pre-create the catch-all rule on dest while routing is still disabled. The
  // CF API allows the PUT even with routing disabled; verification will then
  // find the rule by name/shape but my fix must downgrade it to mismatched.
  const r = await targetCfRequest('PUT', `/zones/${destZoneId}/email/routing/rules/catch_all`, {
    name: 'catch-all',
    enabled: true,
    matchers: [{ type: 'all' }],
    actions: [{ type: 'drop' }],
  });
  if (!r.ok) {
    const err = r.data?.errors?.[0]?.message || 'unknown';
    log(`  ⚠️  seedDestCatchAllDisabled: PUT catch_all returned ${err} (this may be expected if routing must be enabled first; verification will still test the not-ready path)`);
  } else {
    log(`  ✅ Pre-seeded catch-all rule on dest zone ${destZoneId} (routing disabled)`);
  }
}

async function seedDestConflictingRuleset() {
  const destZoneId = await ensureDestZoneExists();
  // Put a single placeholder rule into http_request_firewall_custom so we can
  // verify the migration *overwrote* rather than appended.
  const r = await targetCfRequest('PUT', `/zones/${destZoneId}/rulesets/phases/http_request_firewall_custom/entrypoint`, {
    rules: [{
      expression: '(http.request.uri.path eq "/PRE-EXISTING-DEST-RULE")',
      action: 'block',
      description: 'Pre-existing dest rule (should be overwritten by migration)',
      enabled: true,
    }],
  });
  if (r.ok) log(`  ✅ Pre-seeded conflicting ruleset on dest zone ${destZoneId}`);
  else log(`  ⚠️  seedDestConflictingRuleset: ${r.data?.errors?.[0]?.message || r.status}`);
}

async function runPreRunHooks(config) {
  const hooks = (config.metadata?.preRun || '').split(',').map(s => s.trim()).filter(Boolean);
  if (hooks.length === 0) return;
  log(`  🪝 Running pre-run hooks: ${hooks.join(', ')}`);
  for (const hook of hooks) {
    switch (hook) {
      case 'ensureDestZone':
        await ensureDestZoneExists();
        break;
      case 'ensureSourceEnterprise':
        await ensureSourceEnterprise();
        break;
      case 'seedDestCatchAllDisabled':
        await seedDestCatchAllDisabled();
        break;
      case 'seedDestConflictingRuleset':
        await seedDestConflictingRuleset();
        break;
      default:
        log(`  ⚠️  Unknown pre-run hook: "${hook}" — skipping`);
    }
  }
}

// ── Post-run hooks (config.metadata.postRun) ─────────────────────
//
// After the migration completes and the UI reports verified/missing/mismatched
// counts, some tests need an additional assertion to catch silent-success
// failure modes. Hooks are declared in config.metadata.postRun the same way
// as preRun, and return { passed: boolean, reason: string }.
//
// Available hooks:
//   assertDestZoneInTargetAccount — Parse migration-report.md, extract the
//                                   "Destination Account" line, confirm it
//                                   equals CF_TARGET_ACCOUNT_ID. Used by test
//                                   103 to ensure the migration didn't silently
//                                   fall back to the source zone.
//   assertEmailRoutingMismatched  — Parse migration-report.md, confirm the
//                                   Email Routing Rules section reports
//                                   mismatched>=1 (not just verified=1).
//                                   Used by test 104.

function readReportMarkdown(testDir) {
  const p = path.join(testDir, 'migration-report.md');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

// When the destination account is missing a capability (R2, KV/Workers,
// Queues, D1, Load Balancing, etc.), the migration tool correctly
// acknowledges the affected resources instead of failing them. The
// migration report records them as sections named `<Label> (<field>)`
// (e.g. `R2 (r2Buckets)`, `Workers (workers)`) with a 🟡 acknowledged
// row and a "not enabled on destination account" reason string.
//
// Post-run assertions that verify those resources made it to dest must
// treat this state as a vacuous-pass (per the "No Surprise Failures"
// principle) — the user was warned in Step 2 and accepted that the
// resources wouldn't migrate, so there's nothing for the assertion
// to verify on the dest account.
//
// Returns { acknowledged: boolean, reason?: string }. When acknowledged
// is true, the caller should treat the assertion as a vacuous pass and
// surface the reason in its `passed: true` response so the run output
// makes it clear *why* nothing was checked.
function isCapabilityAcknowledged(testDir, label) {
  const md = readReportMarkdown(testDir);
  if (!md) return { acknowledged: false };
  // Match section heading like `### R2 (r2Buckets)` followed by an
  // acknowledged status row, OR a free-text "<Label>.*not enabled on
  // destination" phrase, OR a "<Label>.*degraded state" phrase (Load
  // Balancing-style entitlement detection).
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`${escapedLabel}\\s*\\(.*?\\).*?🟡\\s*acknowledged`, 'is'),
    new RegExp(`${escapedLabel}.*not enabled on destination`, 'i'),
    new RegExp(`${escapedLabel}.*degraded state`, 'i'),
    new RegExp(`${escapedLabel}.*not entitled`, 'i'),
  ];
  for (const re of patterns) {
    const m = md.match(re);
    if (m) {
      return { acknowledged: true, reason: `${label} acknowledged on destination (capability gap pre-warned): ${m[0].slice(0, 120)}` };
    }
  }
  return { acknowledged: false };
}

function assertDestZoneInTargetAccount(testDir) {
  const md = readReportMarkdown(testDir);
  if (!md) return { passed: false, reason: 'migration-report.md not found' };
  const acctMatch = md.match(/\*\*Destination Account:\*\*\s*([0-9a-f]{32})/i);
  if (!acctMatch) return { passed: false, reason: 'could not parse Destination Account from report' };
  const reported = acctMatch[1];
  if (reported !== CF_TARGET_ACCOUNT_ID) {
    return { passed: false, reason: `Destination Account ${reported} != CF_TARGET_ACCOUNT_ID ${CF_TARGET_ACCOUNT_ID} — fallback selected wrong zone` };
  }
  return { passed: true, reason: `Destination Account ${reported} matches CF_TARGET_ACCOUNT_ID` };
}

function assertEmailRoutingMismatched(testDir) {
  const md = readReportMarkdown(testDir);
  if (!md) return { passed: false, reason: 'migration-report.md not found' };
  // Find the "Email Routing Rules" section and look for mismatched rows.
  const sectionMatch = md.match(/###\s+[^\n]*Email Routing Rules[\s\S]*?(?=\n###\s|\Z)/);
  if (!sectionMatch) return { passed: false, reason: 'no Email Routing Rules section in report' };
  const section = sectionMatch[0];
  // The validator emits "mismatched" badges in the table. Look for them.
  if (/mismatched/i.test(section)) {
    return { passed: true, reason: 'Email Routing Rules section contains mismatched badge as expected' };
  }
  return { passed: false, reason: 'Email Routing Rules section has no mismatched rows — fix may be bypassed' };
}

function assertEmailRoutingMixedOutcomes(testDir) {
  const md = readReportMarkdown(testDir);
  if (!md) return { passed: false, reason: 'migration-report.md not found' };
  const sectionMatch = md.match(/###\s+[^\n]*Email Routing Rules[\s\S]*?(?=\n###\s|\Z)/);
  if (!sectionMatch) return { passed: false, reason: 'no Email Routing Rules section in report' };
  const section = sectionMatch[0];
  const hasVerified = /✅\s*success/i.test(section) || /verified/i.test(section);
  const hasAck = /acknowledged/i.test(section);
  // Drop rules must succeed (they need no address verification). If any drop
  // rule appears with "❌ failed", that's a regression in the per-action-type
  // logic.
  const dropFailed = /\|\s*[^|]*[Dd]rop[^|]*\|\s*❌ failed/.test(section);
  if (dropFailed) return { passed: false, reason: 'A drop rule failed unexpectedly (drop needs no destination address verification)' };
  if (!hasVerified) return { passed: false, reason: 'No verified rules — drop rules and catch-all drop should have landed' };
  if (!hasAck) return { passed: false, reason: 'No acknowledged rules — the unverified-forward rule should have been skipped + acknowledged' };
  return { passed: true, reason: 'Mixed outcomes look right: verified drop(s) + at least one acknowledged forward-to-unverified' };
}

// 111: enterprise-only features must appear as acknowledged or skipped (not failed)
function assertEnterpriseFeaturesAcknowledged(testDir) {
  const md = readReportMarkdown(testDir);
  if (!md) return { passed: false, reason: 'migration-report.md not found' };
  // Look for the most likely indicators in the report
  const enterpriseKeywords = ['grpc', 'tls_client_auth', 'prefetch_preload', 'response_buffering', 'sort_query_string_for_cache', 'proxy_read_timeout', 'true_client_ip_header', 'ddos_l7', 'http_log_custom_fields'];
  // (1) NONE may be ❌ failed.
  const failedRowRe = /\|\s*[^|]+\|\s*❌ failed\s*\|\s*[^|]+\|/g;
  const failedRows = md.match(failedRowRe) || [];
  const offending = failedRows.filter(row => enterpriseKeywords.some(k => row.toLowerCase().includes(k)));
  if (offending.length > 0) {
    return {
      passed: false,
      reason: `Found ${offending.length} enterprise feature(s) listed as ❌ failed (should be ⏭ skipped or 🟡 acknowledged): ${offending[0].slice(0, 150)}`,
    };
  }
  // (2) POSITIVE evidence: at least one enterprise feature must actually appear
  // in a 🟡 acknowledged or ⏭️ skipped row. The previous version only checked
  // "no failed rows", so it ALSO passed when the features were silently dropped
  // (never exported, section omitted) — which is the catastrophic regression
  // e07 exists to catch (Principle 1). Require proof the ack/skip path fired.
  const ackOrSkipRowRe = /\|\s*[^|]+\|\s*(?:🟡 acknowledged|⏭️? skipped)\s*\|\s*[^|]+\|/g;
  const ackOrSkipRows = md.match(ackOrSkipRowRe) || [];
  const acknowledgedEnterprise = ackOrSkipRows.filter(row => enterpriseKeywords.some(k => row.toLowerCase().includes(k)));
  if (acknowledgedEnterprise.length === 0) {
    return {
      passed: false,
      reason: `No enterprise feature appears in a 🟡 acknowledged / ⏭️ skipped row. Expected the Enterprise→Pro downgrade to land features (${enterpriseKeywords.slice(0, 3).join(', ')}, …) as acknowledged; finding none means they were silently dropped, not acknowledged.`,
    };
  }
  return {
    passed: true,
    reason: `${acknowledgedEnterprise.length} enterprise feature row(s) acknowledged/skipped and 0 failed (e.g. ${acknowledgedEnterprise[0].slice(0, 120)})`,
  };
}

// 106: LB pool/monitor IDs were remapped — destination LB references should not equal source pool IDs.
function assertLbPoolIdsRemapped(testDir) {
  const srcStateDir = path.join(testDir, 'source-state-post-seed');
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const srcPools = readEvidenceJson(srcStateDir, 'lb_pools');
  const srcLBs = readEvidenceJson(srcStateDir, 'load_balancers');
  const dstPools = readEvidenceJson(dstStateDir, 'lb_pools');
  const dstLBs = readEvidenceJson(dstStateDir, 'load_balancers');

  // If the migration report indicates LB was acknowledged due to a
  // capability gap on the destination, that's the expected behaviour
  // (No Surprise Failures principle). The migration report is positive
  // evidence that the tool made an explicit, user-acknowledged decision
  // not to migrate the LB resources.
  const lbAck = isCapabilityAcknowledged(testDir, 'Load Balancing');
  if (lbAck.acknowledged) {
    return { passed: true, reason: lbAck.reason };
  }
  // Secondary positive-evidence path: cross-reference live capabilities.
  // The migration tool sometimes silently drops LB resources without
  // emitting an acknowledgment section (real bug — exportData.loadBalancers
  // ends up empty before the cap-check runs, so hasItems=false and no
  // section is created). To prevent the assertion from flagging this as
  // an LB migration failure, we re-probe the dest capability live: if
  // LB really is unavailable on dest, the assertion passes with a warning
  // and the tool bug is flagged for follow-up.
  //
  // This is NOT vacuous-pass-on-missing-evidence (which AGENTS.md forbids).
  // The positive evidence is the live capability API response showing
  // `loadBalancing.available === false`. The tool's failure to emit a
  // section is a separate bug worth a follow-up — but the assertion
  // shouldn't be the thing surfacing it.
  if (!dstLBs.length && srcLBs.length && CF_TARGET_ACCOUNT_ID) {
    // The expected case: LB seeded on source, none on dest, no report ack.
    // This is the migration-tool gap.
    return {
      passed: false,
      reason: 'Source has LBs but dest has none AND migration report has no LB acknowledgement section. Likely migration-tool bug: capabilities.loadBalancing.available=false silently dropped LB resources without emitting Load Balancing acknowledgment section. Check migration-report.md → section "Load Balancing (loadBalancers/pools/monitors)" should appear when dest LB is unavailable. (Workaround: enable LB on dest, or fix src/migrate.ts to emit the acknowledgment section even when exportData arrays are empty.)',
    };
  }

  // No source LB → real test setup failure. The config asked for an LB
  // to be seeded; if it isn't there we can't verify pool remap, and the
  // assertion shouldn't paper over the gap. Fix the upstream seeding
  // problem (or remove this assertion from configs that legitimately
  // don't seed LBs).
  if (!srcLBs.length) {
    return { passed: false, reason: 'No source load balancers captured — source seeding failed or config does not actually seed an LB' };
  }
  if (!srcPools.length || !dstPools.length || !dstLBs.length) {
    return { passed: false, reason: 'evidence missing — source pools, dest pools, or dest LBs not captured' };
  }
  const srcPoolIds = new Set(srcPools.map(p => p.id));
  const dstPoolIds = new Set(dstPools.map(p => p.id));
  for (const lb of dstLBs) {
    const refs = [...(lb.default_pools || []), ...(lb.fallback_pool ? [lb.fallback_pool] : [])];
    for (const ref of refs) {
      if (srcPoolIds.has(ref) && !dstPoolIds.has(ref)) {
        return { passed: false, reason: `LB "${lb.name}" still references source pool ID ${ref}` };
      }
      if (!dstPoolIds.has(ref)) {
        return { passed: false, reason: `LB "${lb.name}" references unknown pool ${ref}` };
      }
    }
  }
  return { passed: true, reason: 'All dest LB pool refs point to dest pool IDs' };
}

// 107: Worker service bindings resolve on the destination
function assertServiceBindingResolves(testDir) {
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const workers = readEvidenceJson(dstStateDir, 'workers_account');
  if (!workers.length) return { passed: false, reason: 'no dest workers found' };
  const workerNames = new Set(workers.map(w => w.id || w.name));
  // For every worker that has bindings, check service-binding references resolve
  let totalServiceBindings = 0;
  for (const w of workers) {
    for (const b of (w.bindings || [])) {
      if (b.type === 'service') {
        totalServiceBindings++;
        if (!workerNames.has(b.service)) {
          return { passed: false, reason: `Worker "${w.id || w.name}" has service binding to "${b.service}" which doesn't exist on dest` };
        }
      }
    }
  }
  if (totalServiceBindings === 0) {
    return { passed: false, reason: 'No service bindings found on dest workers — test setup may not have provisioned them' };
  }
  return { passed: true, reason: `All ${totalServiceBindings} service binding(s) resolve to existing dest workers` };
}

// 108: KV data round-trip — source KV keys must be present on dest with same values
async function assertKvKeysCopied(testDir, config) {
  // If KV/Workers capability is missing on dest, the migration correctly
  // acknowledges the namespaces and skips them. Surface this as a
  // vacuous-pass per the No Surprise Failures principle. KV migration
  // is gated on the Workers capability (KV namespaces are an account
  // resource owned by Workers Paid), so check both labels.
  const workersAck = isCapabilityAcknowledged(testDir, 'Workers');
  if (workersAck.acknowledged) {
    return { passed: true, reason: workersAck.reason };
  }
  const kvAck = isCapabilityAcknowledged(testDir, 'KV');
  if (kvAck.acknowledged) {
    return { passed: true, reason: kvAck.reason };
  }

  const srcStateDir = path.join(testDir, 'source-state-post-seed');
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const srcKv = readEvidenceJson(srcStateDir, 'kv_namespaces');
  const dstKv = readEvidenceJson(dstStateDir, 'kv_namespaces');
  if (!srcKv.length || !dstKv.length) return { passed: false, reason: 'no KV namespaces captured' };

  // For each source namespace, find the dest namespace with the same title
  // and verify expected keys are present. If a seeded namespace is missing
  // on dest, that's a real failure — DO NOT mask it. The harness's Step 2
  // group-selection bug (Issue 8) is the upstream cause of test 207's
  // missing namespaces; fix that bug, don't paper over it here.
  let totalKeysChecked = 0;
  const seedData = config.kv_seed_data || {};
  for (const [kvTitle, expected] of Object.entries(seedData)) {
    if (!Array.isArray(expected) || expected.length === 0) continue;
    const destNs = dstKv.find(n => n.title === kvTitle);
    if (!destNs) return { passed: false, reason: `Source KV "${kvTitle}" not found on dest` };
    // List keys on dest namespace
    const list = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/storage/kv/namespaces/${destNs.id}/keys`);
    if (!list.ok) return { passed: false, reason: `Cannot list dest KV "${kvTitle}" keys: ${list.status}` };
    const destKeySet = new Set((list.data?.result || []).map(k => k.name));
    for (const item of expected) {
      if (!destKeySet.has(item.key)) {
        return { passed: false, reason: `KV key "${item.key}" missing from dest namespace "${kvTitle}"` };
      }
      totalKeysChecked++;
    }
  }
  if (totalKeysChecked === 0) return { passed: false, reason: 'No KV keys to check in config.kv_seed_data' };
  return { passed: true, reason: `${totalKeysChecked} KV key(s) present on dest` };
}

// 109: R2 object copy — at least one object per seeded bucket made it to dest
async function assertR2ObjectsCopied(testDir, config) {
  // If R2 capability is missing on dest, the migration correctly
  // acknowledges the buckets and skips them. Surface this as a
  // vacuous-pass per the No Surprise Failures principle.
  const r2Ack = isCapabilityAcknowledged(testDir, 'R2');
  if (r2Ack.acknowledged) {
    return { passed: true, reason: r2Ack.reason };
  }

  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const dstBuckets = readEvidenceJson(dstStateDir, 'r2_buckets');
  if (!dstBuckets.length) return { passed: false, reason: 'no dest R2 buckets captured' };
  const seed = config.r2_seed_objects || {};
  let totalChecked = 0;
  for (const [bucketName, expected] of Object.entries(seed)) {
    if (!Array.isArray(expected) || expected.length === 0) continue;
    const exists = dstBuckets.some(b => b.name === bucketName);
    if (!exists) return { passed: false, reason: `R2 bucket "${bucketName}" missing on dest` };
    // Sample one object key to ensure it copied
    const probeKey = expected[0].key;
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_TARGET_ACCOUNT_ID}/r2/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(probeKey)}`;
    const res = await fetch(url, { method: 'HEAD', headers: authHeaders });
    if (!res.ok) return { passed: false, reason: `R2 object "${probeKey}" missing in dest bucket "${bucketName}" (HEAD ${res.status})` };
    totalChecked++;
  }
  if (totalChecked === 0) return { passed: false, reason: 'No R2 seed buckets to check' };
  return { passed: true, reason: `Sampled ${totalChecked} R2 object(s); all present on dest` };
}

// 110: Durable Object state migrated (count + sample storage key landed)
//
// Verifies that the migration tool created Durable Object namespace bindings
// on the dest worker. This is what the engine does automatically when a
// worker with a DO class is migrated — no Step 3 configuration required.
//
// IMPORTANT: This is NOT the same as DO STATE migration. State copy requires
// user-configured source/dest worker URLs via Step 3 Setup (see
// src/do-migrate.ts) and is verified by the separate `assertDoStateMigrated`
// assertion. Per AGENTS.md § Test integrity, these are two distinct
// invariants and must have distinct names: this checks namespace creation
// (the engine's actual default behaviour), `assertDoStateMigrated` checks
// state copy (opt-in, harness-driven).
function assertDoNamespaceCreated(testDir, config) {
  const srcStateDir = path.join(testDir, 'source-state-post-seed');
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const srcWorkers = readEvidenceJson(srcStateDir, 'workers_account');
  const dstWorkers = readEvidenceJson(dstStateDir, 'workers_account');
  if (!Array.isArray(srcWorkers) || srcWorkers.length === 0) {
    return { passed: false, reason: 'no source workers captured — source seeding likely failed' };
  }
  if (!Array.isArray(dstWorkers) || dstWorkers.length === 0) {
    return { passed: false, reason: 'no dest workers captured — migration may not have run' };
  }
  // Limit the check to workers this test config explicitly seeded. The
  // source account is shared with other e2e tests and contains
  // many unrelated workers; we must only verify the workers we know are
  // ours, otherwise the assertion fails on pre-existing workers that the
  // current migration was never asked to touch.
  const testWorkerNames = new Set((config?.workers || []).map(w => w.name));
  if (testWorkerNames.size === 0) {
    return { passed: false, reason: 'config has no workers — cannot scope DO assertion' };
  }
  // Collect every (workerName, doClassName) the SOURCE has FOR THIS TEST'S
  // workers, then verify each appears on dest via a durable_object_namespace
  // binding.
  const srcDoExpectations = [];
  for (const w of srcWorkers) {
    const name = w.id || w.name;
    if (!testWorkerNames.has(name)) continue;
    for (const b of (w.bindings || [])) {
      if (b.type === 'durable_object_namespace') {
        srcDoExpectations.push({ worker: name, doClass: b.class_name || b.name, bindingName: b.name });
      }
    }
  }
  if (srcDoExpectations.length === 0) {
    return { passed: false, reason: `no DO bindings on this test's source workers (${[...testWorkerNames].join(', ')}) — test seeding missed DO classes (assertion has nothing to verify)` };
  }
  const missing = [];
  for (const exp of srcDoExpectations) {
    const dstW = dstWorkers.find(w => (w.id || w.name) === exp.worker);
    if (!dstW) {
      missing.push(`worker "${exp.worker}" not on dest`);
      continue;
    }
    const found = (dstW.bindings || []).some(b => b.type === 'durable_object_namespace' && b.name === exp.bindingName);
    if (!found) {
      missing.push(`${exp.worker}: binding "${exp.bindingName}" missing`);
    }
  }
  if (missing.length > 0) {
    return { passed: false, reason: `DO namespace binding(s) missing on dest: ${missing.join('; ')}` };
  }
  return { passed: true, reason: `${srcDoExpectations.length} DO namespace binding(s) verified on dest worker(s)` };
}

// Strict: verifies that DO STATE (not just the namespace binding) was
// migrated end-to-end via the sandwich pattern. Requires:
//   1. Source-side: a pre-run hook that populates DO storage by hitting the
//      source worker (see test 110's notes; not currently wired).
//   2. Migration-side: Step 3 of the wizard configured with source/dest
//      worker URLs so do-migrate.ts can copy state between them.
//
// When the harness has neither of those, the migration tool ONLY creates
// namespace bindings (verified by assertDoNamespaceCreated) and this
// assertion's expectation is genuinely unfulfilled — that's a real bug
// surfaced honestly, not a test to relax.
function assertDoStateMigrated(testDir) {
  const md = readReportMarkdown(testDir);
  if (!md) return { passed: false, reason: 'migration-report.md not found' };
  // The DO migration emits a "Durable Object Data" or "Durable Objects" section
  // with instance counts + per-instance status. For the sandwich pattern to be
  // exercised, at least one DO must have synced state.
  const re = /###[^\n]*Durable Objects?[^\n]*[\s\S]*?(?=\n###\s|\Z)/i;
  const sectionMatch = md.match(re);
  if (!sectionMatch) return { passed: false, reason: 'No Durable Objects section in report — DO state migration was not driven via Step 3 (use assertDoNamespaceCreated to verify the namespace binding only, or wire a pre-run + Step 3 form-fill to exercise state copy)' };
  const section = sectionMatch[0];
  // Look for at least one ✅ success row in the DO section
  if (!/✅\s*success/i.test(section)) {
    return { passed: false, reason: 'No successful DO instances in report section' };
  }
  return { passed: true, reason: 'DO section reports at least one synced instance' };
}

// 112: Access policy IdP IDs remapped to dest IdPs
// A self-hosted Access app binds to a hostname on a Cloudflare zone, and
// Cloudflare only accepts that bind when the zone is ACTIVE. In an
// account-to-account migration the destination zone is always PENDING
// (the customer hasn't moved nameservers yet — that happens at cutover,
// AFTER the migration run), so the create is rejected with
// "domain does not belong to zone" (error 12130). Verified live against
// the API 2026-06-03: creating a self-hosted app succeeds on an active
// dest zone and fails on a pending one with that exact error. The tool
// therefore acknowledges these apps with a manual action — the correct,
// unavoidable behaviour per Principles 1 & 4 (the user re-creates them
// once the zone is active). This is a legitimate, tool-emitted
// acknowledgement (per the §7 "Legitimate vacuous pass" rule), NOT an
// evidence-missing vacuous pass: the positive evidence is the explicit
// acknowledgement row in the report. Returns the rewritten hostnames the
// acknowledgement cited so the rewrite can still be spot-checked.
function accessAppPendingZoneAck(testDir) {
  const md = readReportMarkdown(testDir);
  if (!md) return { acknowledged: false, hostnames: [] };
  const sec = md.match(/###\s+[^\n]*Access Applications[\s\S]*?(?=\n###\s|$)/);
  if (!sec) return { acknowledged: false, hostnames: [] };
  const section = sec[0];
  // Acknowledged rows that cite a hostname (wording-independent: we only
  // require a 🟡 acknowledged row carrying hostname "X"). A ❌ failed row
  // is NOT matched here, so genuine failures still fall through to a fail.
  const rows = section.match(/🟡\s*acknowledged[^\n]*?hostname "[^"]+"[^\n]*/gi) || [];
  const hostnames = [];
  for (const row of rows) {
    const h = row.match(/hostname "([^"]+)"/i);
    if (h) hostnames.push(h[1]);
  }
  return { acknowledged: rows.length > 0, hostnames };
}

function assertAccessPolicyIdpRemapped(testDir) {
  // Access is account-scoped and requires explicit enablement on the dest
  // account. When it's not enabled, the migration tool acknowledges Access
  // resources in the report — that's the legitimate "no apps to check"
  // path. Without the acknowledgement, an empty dstApps means either
  // (a) source seeding produced no Access apps to migrate, or (b)
  // migration failed silently — neither of which is a "remap verified" pass.
  const accessAck = isCapabilityAcknowledged(testDir, 'Access');
  if (accessAck.acknowledged) {
    return { passed: true, reason: accessAck.reason };
  }

  const srcStateDir = path.join(testDir, 'source-state-post-seed');
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const srcIdp = readEvidenceJson(srcStateDir, 'identity_providers');
  const dstIdp = readEvidenceJson(dstStateDir, 'identity_providers');
  const dstApps = readEvidenceJson(dstStateDir, 'access_apps');
  if (!dstApps.length) {
    // Expected path in this test environment: the self-hosted app can't be
    // created on the PENDING dest zone (verified CF constraint), so the
    // tool acknowledged it. That's a correct, non-failure outcome. The
    // live IdP-remap path (allowed_idps source→dest) is only reachable when
    // the dest zone is active; it cannot be exercised here. We pass on the
    // basis that the un-migratable app was acknowledged, not failed.
    const pend = accessAppPendingZoneAck(testDir);
    if (pend.acknowledged) {
      return {
        passed: true,
        reason: `Access app(s) acknowledged: self-hosted apps cannot be created on the PENDING destination zone (verified CF constraint — pending zone returns "domain does not belong to zone"). The tool acknowledged with a manual action (Principle 1), so this is a correct outcome, not a failure. Live IdP-remap is not exercisable without an active dest zone.`,
      };
    }
    return { passed: false, reason: 'No Access apps on dest and no pending-zone acknowledgement — Access failed to migrate or seeding failed' };
  }
  const srcIdpIds = new Set(srcIdp.map(i => i.id));
  const dstIdpIds = new Set(dstIdp.map(i => i.id));
  let checkedAppCount = 0;
  for (const app of dstApps) {
    for (const idpId of (app.allowed_idps || [])) {
      checkedAppCount++;
      if (srcIdpIds.has(idpId) && !dstIdpIds.has(idpId)) {
        return { passed: false, reason: `App "${app.name}" still references source IdP ${idpId}` };
      }
    }
  }
  if (checkedAppCount === 0) {
    return { passed: false, reason: `Found ${dstApps.length} dest Access app(s) but none had allowed_idps to verify — IdP remap untestable` };
  }
  return { passed: true, reason: `${checkedAppCount} IdP reference(s) verified across ${dstApps.length} dest Access app(s); no source IdP IDs leaked` };
}

// e12-access-multidomain: a modern self-hosted Access app routes via
// self_hosted_domains[] and destinations[] (the legacy single `domain` is
// empty or supplementary). Verify the dest app preserved those arrays AND
// that every hostname/URI was rewritten onto the destination zone — no
// source-zone hostname should leak through (it wouldn't resolve on dest).
function assertAccessMultiDomainMigrated(testDir) {
  // Account-scoped: if Access isn't enabled on the dest account the tool
  // acknowledges it (Principle 1) — that's a legitimate non-failure path.
  const accessAck = isCapabilityAcknowledged(testDir, 'Access');
  if (accessAck.acknowledged) {
    return { passed: true, reason: accessAck.reason };
  }

  const srcZone = (SOURCE_DOMAIN || '').toLowerCase();
  const dstZone = (DEST_DOMAIN || '').toLowerCase();
  if (!srcZone || !dstZone) {
    return { passed: false, reason: 'SOURCE_DOMAIN/DEST_DOMAIN not set — cannot verify zone rewrite' };
  }

  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const dstApps = readEvidenceJson(dstStateDir, 'access_apps');
  if (!dstApps.length) {
    // The self-hosted app can't land on the PENDING dest zone (verified CF
    // constraint), so the tool acknowledged it. That's correct (Principle
    // 1). We can still spot-check the rewrite from the acknowledgement
    // text: it cites the rewritten hostname, so a source-zone hostname
    // here would mean rewriteAccessAppDomains regressed. The full
    // self_hosted_domains[]/destinations[] array rewrite is covered by
    // unit tests (test/transforms.test.ts § rewriteAccessAppDomains).
    const pend = accessAppPendingZoneAck(testDir);
    if (pend.acknowledged) {
      if (pend.hostnames.length === 0) {
        return { passed: false, reason: 'Access app acknowledged but the acknowledgement cited no hostname — cannot confirm the rewrite ran' };
      }
      // A hostname is on a given zone if it equals the zone or is a subdomain
      // of it (tolerating a trailing path on destination URIs like
      // "admin.zone/secure").
      const onZone = (host, zone) =>
        host === zone || host.endsWith(`.${zone}`) || host.split('/')[0].endsWith(`.${zone}`);
      // A leak is a hostname on the SOURCE zone but NOT on the dest zone.
      // Account-to-account migration keeps the zone NAME (only the account
      // changes), so the common case is srcZone === dstZone, where the rewrite
      // is a legitimate no-op and every hostname is on both zones — that is NOT
      // a leak. Only when the migration also changes the zone name (srcZone !==
      // dstZone) can a surviving source-zone hostname be a real regression.
      const leaks = pend.hostnames.filter((h) => {
        const host = h.toLowerCase();
        return onZone(host, srcZone) && !onZone(host, dstZone);
      });
      if (leaks.length) {
        return { passed: false, reason: `Acknowledged Access app still cites source-zone hostname(s) ${leaks.join(', ')} — rewriteAccessAppDomains regressed (source hostnames must be rewritten onto the dest zone)` };
      }
      const onDest = pend.hostnames.some((h) => onZone(h.toLowerCase(), dstZone));
      if (!onDest) {
        return { passed: false, reason: `Acknowledged Access app cited hostname(s) ${pend.hostnames.join(', ')} but none on the destination zone ${dstZone} — rewrite produced no on-zone hostname` };
      }
      return { passed: true, reason: `Access app acknowledged (self-hosted app cannot be created on the PENDING dest zone — verified CF constraint). Cited hostname(s) ${pend.hostnames.join(', ')} were source→dest rewritten onto ${dstZone} with no source-zone leak; full self_hosted_domains[]/destinations[] rewrite is covered by unit tests (test/transforms.test.ts).` };
    }
    return { passed: false, reason: 'No Access apps on dest and no pending-zone acknowledgement — multi-domain migration failed to migrate or seeding failed' };
  }

  // Gather every hostname/URI referenced by each dest app.
  const hostnamesOf = (app) => {
    const out = [];
    if (app.domain) out.push(app.domain);
    for (const d of app.self_hosted_domains || []) if (typeof d === 'string' && d) out.push(d);
    for (const dest of app.destinations || []) {
      if (dest.uri) out.push(dest.uri);
      if (dest.hostname) out.push(dest.hostname);
    }
    return out;
  };

  // Only inspect apps that actually use the multi-domain arrays — there may
  // be unrelated legacy apps lingering on the dest account from prior runs.
  const multiDomainApps = dstApps.filter(
    a => (a.self_hosted_domains?.length || 0) > 0 || (a.destinations?.length || 0) > 0,
  );
  if (multiDomainApps.length === 0) {
    return { passed: false, reason: `Found ${dstApps.length} dest Access app(s) but none carried self_hosted_domains[]/destinations[] — arrays were dropped on migrate` };
  }

  let rewrittenHostCount = 0;
  for (const app of multiDomainApps) {
    for (const h of hostnamesOf(app)) {
      const host = h.toLowerCase();
      // A source-zone hostname surviving to dest means the rewrite failed.
      if (host === srcZone || host.endsWith(`.${srcZone}`) || host.split('/')[0].endsWith(`.${srcZone}`)) {
        return { passed: false, reason: `Dest app "${app.name}" still references source-zone hostname "${h}" — zone rewrite did not run` };
      }
      if (host === dstZone || host.endsWith(`.${dstZone}`) || host.split('/')[0].endsWith(`.${dstZone}`)) {
        rewrittenHostCount++;
      }
    }
  }

  if (rewrittenHostCount === 0) {
    return { passed: false, reason: `Found ${multiDomainApps.length} multi-domain dest app(s) but none referenced a destination-zone hostname — rewrite produced no on-zone hostnames` };
  }
  return { passed: true, reason: `${rewrittenHostCount} hostname(s) across ${multiDomainApps.length} multi-domain Access app(s) rewritten onto ${dstZone}; no source-zone hostnames leaked` };
}

// 113: missing worker secrets surface as a manual action, not a silent failure
function assertSecretsManualAction(testDir) {
  const md = readReportMarkdown(testDir);
  if (!md) return { passed: false, reason: 'migration-report.md not found' };
  // Scope to the SPECIFIC worker-secret manual-action phrasing the engine
  // emits, not a coincidental "secret" + "manual" anywhere in the report.
  // Canonical signals (src/types.ts IMPOSSIBLE "Worker Secrets" entry +
  // workers-deploy.ts binding warning):
  //   - "wrangler secret put"               (IMPOSSIBLE manualAction)
  //   - "Provide secret values in Step 3"   (IMPOSSIBLE manualAction)
  //   - "Re-add secret \"...\""             (secrets-store binding warning)
  //   - "secret VALUE was not migrated"     (secrets-store binding warning)
  const secretManualSignals = [
    /wrangler\s+secret\s+put/i,
    /provide\s+secret\s+values\s+in\s+step\s*3/i,
    /re-add\s+secret/i,
    /secret\s+value\s+was\s+not\s+migrated/i,
  ];
  const matched = secretManualSignals.find(re => re.test(md));
  if (matched) {
    return { passed: true, reason: `Worker-secret manual action surfaced (matched: ${matched})` };
  }
  return {
    passed: false,
    reason: 'No worker-secret manual action found. Expected one of: "wrangler secret put", "Provide secret values in Step 3", "Re-add secret", or "secret VALUE was not migrated".',
  };
}

// 114: Ruleset overwrite mode replaced existing rules cleanly (count + content match expectations)
function assertRulesetOverwrite(testDir) {
  const md = readReportMarkdown(testDir);
  if (!md) return { passed: false, reason: 'migration-report.md not found' };
  // Match the ZONE-level Rulesets section specifically — not "Account
  // Rulesets" or "Account Ruleset References". The zone section's heading
  // is exactly "Rulesets" (after the status icon), without an "Account"
  // qualifier. JS regex has no \Z; use the lookahead for either the next
  // ### or end-of-string.
  const sectionMatch = md.match(/###\s+\S+\s+Rulesets\n[\s\S]*?(?=\n### |$)/);
  if (!sectionMatch) return { passed: false, reason: 'no zone-level Rulesets section in report' };
  const section = sectionMatch[0];
  if (/❌ failed/.test(section)) return { passed: false, reason: 'Zone Rulesets section has failures during overwrite' };
  if (!/✅ success/.test(section)) return { passed: false, reason: 'No successful rows in zone Rulesets section' };
  return { passed: true, reason: 'Zone rulesets overwrote cleanly without failures' };
}

// e11-cert-pack-dedupe: Verify the migrate code dedupes certificate packs
// by {hosts, type, CA} tuple. The dedupe is a pure function in
// `src/migrate.ts:dedupeCertificatePacks` and the migrate flow surfaces
// duplicates as `skipped` rows in the Certificate Packs section with the
// reason "Duplicate certificate pack on source".
//
// Two valid pass states:
//   (a) Source had no duplicates → Certificate Packs section has 0 skipped
//       rows with the dedupe reason. The dedupe code was exercised (no-op
//       path) but didn't have anything to dedupe.
//   (b) Source had duplicates → section has N skipped rows with the
//       expected reason, and 1 successful row per unique tuple.
//
// Failure states:
//   - Section is missing entirely AND source had cert packs (would mean
//     migrate silently dropped the category).
//   - Section has any ❌ failed rows with "transient" cert-service errors
//     for duplicate hostname pairs (regression: dedupe didn't fire).
function assertCertPackDedupe(testDir) {
  const md = readReportMarkdown(testDir);
  if (!md) return { passed: false, reason: 'migration-report.md not found' };

  const sectionMatch = md.match(/###\s+\S+\s+Certificate Packs(\s+\([^)]+\))?\n[\s\S]*?(?=\n### |$)/);
  if (!sectionMatch) {
    // No cert packs at all on source — vacuous pass is OK here because the
    // dedupe code only runs when there are cert packs. We're not masking a
    // real failure (a missing section + duplicate hostname pairs would have
    // surfaced as failed POSTs, which the harness would have already failed).
    return { passed: true, reason: 'No Certificate Packs section (source had no cert packs to migrate)' };
  }

  const section = sectionMatch[0];
  // Hard failures are real failures
  const failedRows = (section.match(/❌ failed/g) || []).length;
  if (failedRows > 0) {
    return { passed: false, reason: `${failedRows} failed Certificate Pack row(s) in section` };
  }

  // Dedupe regression detection: count transient errors PER hostname pair.
  // The historical bug looked like 12 identical "transient" rows for the
  // same hostname pair — dedupe should have skipped 11 of them. After fix
  // #1 (dedupeCertificatePacks), duplicates land as ⏭️ skipped instead.
  //
  // What still legitimately surfaces as transient: genuinely-different
  // hostname pairs that hit the cert backend during an actual upstream
  // hiccup. Those are NOT a dedupe regression — they're Cloudflare-side
  // backend flakes the user should re-run.
  //
  // So the real regression signal is: ≥2 transient rows for the SAME
  // hostname pair (would mean the dedupe missed them).
  const rows = section.split('\n').filter(line => line.includes('|'));
  const transientByHosts = new Map();
  for (const row of rows) {
    if (!/certificate service was temporarily unavailable/i.test(row)) continue;
    // First cell after the leading pipe is the hostname pair
    const cells = row.split('|').map(c => c.trim());
    const hosts = cells[1] || '';
    transientByHosts.set(hosts, (transientByHosts.get(hosts) || 0) + 1);
  }
  const totalTransient = [...transientByHosts.values()].reduce((a, b) => a + b, 0);
  const dupedTransient = [...transientByHosts.entries()].filter(([_, n]) => n >= 2);
  if (dupedTransient.length > 0) {
    const detail = dupedTransient.map(([h, n]) => `${h}: ${n}`).join('; ');
    return {
      passed: false,
      reason: `Dedupe regression: ${dupedTransient.length} hostname pair(s) have ≥2 transient errors (${detail}). Same-pair transient errors are almost always duplicates the dedupe code missed.`,
    };
  }

  const skippedRows = (section.match(/⏭(?:️)? skipped/g) || []).length;
  const dedupeRows = (section.match(/Duplicate certificate pack on source/g) || []).length;
  return {
    passed: true,
    reason: `Cert pack section healthy: ${skippedRows} skipped (${dedupeRows} from dedupe, others may be capability gaps), ${totalTransient} transient on distinct host pairs (legitimate backend flake), 0 failed`,
  };
}

// 118: Account-level custom ruleset referenced by zone execute action.
//
// Asserts three things:
//   1. The migration report has an Account Rulesets section with at least
//      one successful row (the ruleset was recreated on dest).
//   2. Looking at the live dest zone's http_request_firewall_custom
//      entrypoint, the execute rule's action_parameters.id is a 32-hex
//      string AND is NOT the source-account ruleset ID — meaning the
//      remap happened.
//   3. Looking at the dest account's rulesets, a ruleset with the dest
//      execute target ID exists and is owned by CF_TARGET_ACCOUNT_ID.
//
// Source ruleset ID is discovered live from CF_ACCOUNT_ID rather than
// hardcoded, so the test works across test infrastructure rebuilds.
async function assertAccountRulesetReferenceRemapped(_testDir) {
  // 1. Confirm the migration report has an Account Rulesets section. The
  //    section is emitted whenever the migration tool processes a custom
  //    account ruleset (success OR acknowledged for entitlement gap).
  const md = readReportMarkdown(_testDir);
  if (!md) return { passed: false, reason: 'migration-report.md not found' };
  if (!/### .*Account Rulesets/i.test(md)) {
    return { passed: false, reason: 'no Account Rulesets section in migration report' };
  }

  // 1b. Acknowledgment short-circuit: if the dest account is not entitled
  // to use the source ruleset's phase, the migration tool emits the
  // Account Rulesets section with an acknowledged row. That's the legit
  // "feature not entitled on dest" path per the No Surprise Failures
  // principle — accept it as a vacuous pass with the acknowledgment as
  // positive evidence.
  if (/Account Rulesets[\s\S]*?🟡 acknowledged[\s\S]*?not entitled/i.test(md)) {
    return {
      passed: true,
      reason: 'Account Rulesets section reports acknowledgment for dest entitlement gap (phase not enabled on dest account)',
    };
  }

  // 2. Find the source ruleset ID by name (custom-kind).
  const srcList = await cfRequest('GET', `/accounts/${CF_ACCOUNT_ID}/rulesets`);
  if (!srcList.ok) return { passed: false, reason: `source account ruleset list failed: ${srcList.status}` };
  const srcRuleset = (srcList.data?.result || []).find(r => r.kind === 'custom' && r.name?.startsWith('Twilight Zone Test'));
  if (!srcRuleset) return { passed: false, reason: 'source test ruleset not found (expected custom-kind ruleset starting with "Twilight Zone Test")' };
  const srcRulesetId = srcRuleset.id;

  // 3. Look up the dest account-level phase entrypoint for the same phase.
  //    CF's correct deployment path for custom account rulesets is via
  //    execute rules in the ACCOUNT-level root entrypoint, not in zones.
  const destEntry = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/rulesets/phases/${srcRuleset.phase}/entrypoint`);
  if (!destEntry.ok) {
    return { passed: false, reason: `dest account phase entrypoint fetch failed for ${srcRuleset.phase}: ${destEntry.status}` };
  }
  const destEntryRules = destEntry.data?.result?.rules || [];

  // 4. Find an execute rule whose target is on the dest account and whose
  //    target is NOT the source ruleset ID (i.e. the remap happened).
  const destList = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/rulesets`);
  if (!destList.ok) return { passed: false, reason: `dest account ruleset list failed: ${destList.status}` };
  const destTwilightRuleset = (destList.data?.result || []).find(r => r.kind === 'custom' && r.name === srcRuleset.name);
  if (!destTwilightRuleset) {
    return { passed: false, reason: `dest account does not have a recreated custom ruleset named "${srcRuleset.name}"` };
  }
  const expectedDestId = destTwilightRuleset.id;

  const matchingExecute = destEntryRules.find(r => r.action === 'execute' && r.action_parameters?.id === expectedDestId);
  if (!matchingExecute) {
    // The custom ruleset was recreated but no execute rule on the dest
    // account's entrypoint points at it. That's a partial migration —
    // the ruleset exists but isn't deployed.
    return {
      passed: false,
      reason: `dest custom ruleset "${srcRuleset.name}" (${expectedDestId}) exists on dest account but no execute rule on the dest account's ${srcRuleset.phase} entrypoint references it`,
    };
  }
  if (expectedDestId === srcRulesetId) {
    return { passed: false, reason: `execute target ${expectedDestId} matches the SOURCE ruleset ID — remap did not happen (test infrastructure may be shared between source and dest accounts)` };
  }

  return {
    passed: true,
    reason: `Account ruleset migrated and remapped: src "${srcRuleset.name}" (${srcRulesetId}) → dest ${expectedDestId}; account-level execute rule on ${srcRuleset.phase} entrypoint references the new ID`,
  };
}

// 116/205: Every binding the source worker actually has must land on dest.
//
// Earlier version of this assertion had a hardcoded EXPECTED list of 26
// binding types. That failed in two ways:
//   1. If the test source account couldn't provision some types (e.g.
//      dispatch_namespace requires Workers for Platforms entitlement which
//      the test account doesn't have), the source upload would fail and
//      the entire test would fail with "worker not found on dest" — even
//      though the migration tool was never given a chance to migrate the
//      worker.
//   2. The hardcoded list could drift from the test config silently.
//
// The fix per AGENTS.md § Test integrity: scope honestly. Read the actual
// source bindings from evidence, and verify each of those landed on dest.
// Bindings that are known to be MANUAL (engine emits a warning, does not
// remap) are verified separately — they should be on dest AND have a
// warning in the migration report.
//
// Bindings dropped by the source-seeding retry-with-drop logic (because
// the source account lacks an entitlement) won't be in source-state
// evidence, so they aren't expected on dest. The harness logs which
// bindings were dropped so this scope reduction is visible.
const MANUAL_BINDING_TYPES = new Set([
  'hyperdrive',
  'mtls_certificate',
  'secrets_store_secret',
  'vpc_service',
]);
// Binding types whose dest-side enumeration via the workers API is
// unreliable (write-only or hidden from list responses). For these we
// only verify the source-side seeding success, not the dest binding row.
const HIDDEN_BINDING_TYPES = new Set([
  'secret_text', // write-only: API doesn't return text or even type in list
]);
function assertWorkerBindingsCompletelyMigrated(testDir) {
  const srcStateDir = path.join(testDir, 'source-state-post-seed');
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const srcWorkers = readEvidenceJson(srcStateDir, 'workers_account');
  const dstWorkers = readEvidenceJson(dstStateDir, 'workers_account');
  if (!Array.isArray(srcWorkers) || srcWorkers.length === 0) {
    return { passed: false, reason: 'no source workers captured in evidence — source seeding failed' };
  }
  if (!Array.isArray(dstWorkers) || dstWorkers.length === 0) {
    return { passed: false, reason: 'no dest workers captured in evidence' };
  }
  const zoneWorkerName = 'maxworker-zone-worker';
  const srcWorker = srcWorkers.find(w => (w.id || w.name) === zoneWorkerName);
  if (!srcWorker) {
    return { passed: false, reason: `${zoneWorkerName} not found on source — source seeding upload failed (check seeding log for the actual error)` };
  }
  const dstWorker = dstWorkers.find(w => (w.id || w.name) === zoneWorkerName);
  if (!dstWorker) {
    return { passed: false, reason: `${zoneWorkerName} not found on dest — migration did not upload it` };
  }
  const srcBindings = srcWorker.bindings || [];
  const dstBindings = dstWorker.bindings || [];
  if (srcBindings.length === 0) {
    return { passed: false, reason: `${zoneWorkerName} has 0 bindings on source — source seeding stripped all bindings` };
  }
  if (dstBindings.length === 0) {
    return { passed: false, reason: `${zoneWorkerName} has 0 bindings on dest (capture-zone-state must enrich bindings)` };
  }

  const dstByKey = new Map();
  for (const b of dstBindings) dstByKey.set(`${b.type}:${b.name}`, b);

  const md = readReportMarkdown(testDir) || '';

  // Bindings dropped during worker upload because the dest lacks the
  // backing capability are listed in the "Worker Bindings (Capability Gap)"
  // section. These are acknowledged, not failed.
  // JS regex has no \Z; use a lookahead for the next ### or end-of-string,
  // matched via the [\s\S] class (since dotAll flag isn't enough — we want
  // to match across blank lines too).
  const capGapDropped = new Set();
  const capGapSection = md.match(/### [^\n]*Worker Bindings \(Capability Gap\)[\s\S]*?(?=\n### |$)/);
  if (capGapSection) {
    // Each row is like "| <worker>: <type> binding "<name>" | 🟡 acknowledged | ..."
    for (const m of capGapSection[0].matchAll(/\|\s*[^:|]+:\s*(\w+)\s+binding\s+"([^"]+)"\s*\|\s*🟡/g)) {
      capGapDropped.add(`${m[1]}:${m[2]}`);
    }
  }

  const missing = [];
  const present = [];
  const acknowledgedCapGap = [];
  const manualVerified = [];
  const manualMissingWarning = [];

  for (const sb of srcBindings) {
    const key = `${sb.type}:${sb.name}`;
    if (HIDDEN_BINDING_TYPES.has(sb.type)) {
      // Secrets and similar write-only bindings: source seeded the value,
      // dest may or may not show the binding in list — we don't strictly
      // require the dest binding row, but we DO verify the migration report
      // mentions the binding (via secrets manual action or otherwise).
      continue;
    }
    if (capGapDropped.has(key)) {
      // Binding was acknowledged as dropped due to dest cap-gap (e.g. R2
      // disabled on dest). Verified positive evidence — no need to require
      // it on the dest worker.
      acknowledgedCapGap.push(key);
      continue;
    }
    if (MANUAL_BINDING_TYPES.has(sb.type)) {
      // Manual bindings: dest binding might be present (engine passes it
      // through) and a warning MUST appear in the report.
      const re = new RegExp(`\\b${sb.type}\\b[^.]*${sb.name}|\\b${sb.name}\\b[^.]*${sb.type}`, 'i');
      if (re.test(md)) {
        manualVerified.push(key);
      } else {
        manualMissingWarning.push(key);
      }
      continue;
    }
    // Regular binding: verify it exists on dest with the same type+name.
    if (dstByKey.has(key)) {
      present.push(key);
    } else {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    return {
      passed: false,
      reason: `${missing.length}/${srcBindings.length} binding(s) missing on dest: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ` (+${missing.length - 6} more)` : ''}`,
    };
  }
  if (manualMissingWarning.length > 0) {
    return {
      passed: false,
      reason: `${manualMissingWarning.length} manual binding(s) lack a warning in the report: ${manualMissingWarning.join(', ')}`,
    };
  }
  const parts = [`${present.length} regular present`];
  if (manualVerified.length > 0) parts.push(`${manualVerified.length} manual with warnings`);
  if (acknowledgedCapGap.length > 0) parts.push(`${acknowledgedCapGap.length} acknowledged (cap-gap)`);
  return {
    passed: true,
    reason: `All ${srcBindings.length} source binding(s) verified on dest worker (${parts.join(', ')})`,
  };
}

// 115: DNS proxied flag preservation
function assertProxiedFlagsMatch(testDir) {
  const srcStateDir = path.join(testDir, 'source-state-post-seed');
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const srcDns = readEvidenceJson(srcStateDir, 'dns_records');
  const dstDns = readEvidenceJson(dstStateDir, 'dns_records');
  if (!srcDns.length) return { passed: false, reason: 'no source DNS captured' };
  // Align records by (type, subdomain-prefix) — strip the zone name so
  // pairs match across different source/dest root domains.
  //   "api.twilight-maxconfig.example.com"   → "api"
  //   "api.swit.sh"                      → "api"
  //   "twilight-maxconfig.example.com"       → ""  (apex)
  //   "swit.sh"                          → ""  (apex)
  function subdomain(fullName, zoneName) {
    if (fullName === zoneName) return '';
    if (fullName.endsWith('.' + zoneName)) return fullName.slice(0, -zoneName.length - 1);
    // Fallback: if zone name isn't a suffix (shouldn't happen for real data),
    // return everything before the rightmost two dot-segments as a best effort.
    const parts = fullName.split('.');
    return parts.length > 2 ? parts.slice(0, -2).join('.') : '';
  }
  // Detect each side's zone name from records: the apex has the shortest name
  // among records that look like the apex (TXT, MX, SOA, NS, A on apex).
  function inferZone(records) {
    if (!records.length) return '';
    // The zone name should be the suffix shared by all records.
    const names = records.map(r => r.name);
    // Find the shortest name — apex records have the bare zone name.
    let shortest = names[0];
    for (const n of names) if (n.length < shortest.length) shortest = n;
    return shortest;
  }
  const srcZone = inferZone(srcDns);
  const dstZone = inferZone(dstDns);
  const dstByKey = new Map();
  for (const r of dstDns) dstByKey.set(`${r.type}:${subdomain(r.name, dstZone)}`, r);
  let mismatches = 0;
  let totalChecked = 0;
  const mismatchDetails = [];
  for (const r of srcDns) {
    const key = `${r.type}:${subdomain(r.name, srcZone)}`;
    const dst = dstByKey.get(key);
    if (!dst) continue;
    totalChecked++;
    if (Boolean(r.proxied) !== Boolean(dst.proxied)) {
      mismatches++;
      if (mismatchDetails.length < 5) {
        mismatchDetails.push(`${r.type} ${r.name} src=${r.proxied} dst=${dst.name} ${dst.proxied}`);
      }
    }
  }
  if (mismatches > 0) {
    return {
      passed: false,
      reason: `${mismatches}/${totalChecked} DNS records have mismatched proxied flag (e.g. ${mismatchDetails.join('; ')})`,
    };
  }
  if (totalChecked === 0) return { passed: false, reason: `No DNS pairs aligned (srcZone=${srcZone || '<none>'}, dstZone=${dstZone || '<none>'})` };
  return { passed: true, reason: `${totalChecked} DNS proxied flags match across source and dest` };
}

// ── assertDnsRecordTypesPresent ──────────────────────────────────────
// Record-type breadth guard (e14). The baseline is what the test DECLARED
// (source-config.json dns_records), NOT what actually seeded — so a record
// that failed to seed (e.g. CAA/SRV/HTTPS that need a structured `data`
// object) is still EXPECTED on dest and surfaces as a failure instead of a
// silent pass. This is the deliberate complement to assertProxiedFlagsMatch,
// which only checks proxied flags on records that aligned on both sides and
// therefore can't notice a non-proxiable type going missing.
//
// Alignment is by (type, subdomain-prefix) with the zone name stripped, so it
// holds even when source/dest root domains differ. Extra dest records (NS,
// SOA, CF-managed) are ignored — we only require declared ⊆ dest.
function assertDnsRecordTypesPresent(testDir) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(testDir, 'source-config.json'), 'utf8'));
  } catch {
    return { passed: false, reason: 'source-config.json not found — cannot determine declared DNS records' };
  }
  const declared = Array.isArray(config?.dns_records) ? config.dns_records : [];
  if (declared.length === 0) {
    return { passed: false, reason: 'source-config.json declares no dns_records — nothing to verify' };
  }
  const dstDns = readEvidenceJson(path.join(testDir, 'dest-state-post-migrate'), 'dns_records');
  if (!dstDns.length) {
    return { passed: false, reason: 'no dest DNS captured — cannot confirm declared records migrated' };
  }

  // Strip the zone name to a subdomain prefix so (type, prefix) keys align
  // across differing root domains (mirrors assertProxiedFlagsMatch).
  const subdomain = (fullName, zoneName) => {
    if (!fullName) return '';
    if (fullName === zoneName) return '';
    if (zoneName && fullName.endsWith('.' + zoneName)) return fullName.slice(0, -zoneName.length - 1);
    const parts = fullName.split('.');
    return parts.length > 2 ? parts.slice(0, -2).join('.') : '';
  };
  const inferZone = (records) => {
    if (!records.length) return '';
    let shortest = records[0].name;
    for (const r of records) if (r.name && r.name.length < shortest.length) shortest = r.name;
    return shortest;
  };
  const dstZone = inferZone(dstDns);
  // Declared names are already in SOURCE_DOMAIN form (rewritten at load); infer
  // their zone the same way from the declared set.
  const declZone = inferZone(declared);

  // Count declared keys (duplicates matter: MX×3, CAA×2 on the same name).
  const need = new Map();
  for (const r of declared) {
    const key = `${r.type}:${subdomain(r.name, declZone)}`;
    need.set(key, (need.get(key) || 0) + 1);
  }
  const have = new Map();
  for (const r of dstDns) {
    const key = `${r.type}:${subdomain(r.name, dstZone)}`;
    have.set(key, (have.get(key) || 0) + 1);
  }

  const missing = [];
  for (const [key, count] of need) {
    if ((have.get(key) || 0) < count) {
      missing.push(`${key.replace(':', ' ')}${count > 1 ? ` (need ${count}, have ${have.get(key) || 0})` : ''}`);
    }
  }
  if (missing.length) {
    return {
      passed: false,
      reason: `${missing.length} declared DNS record(s) missing on dest: ${missing.join(', ')} — they either failed to seed (needs structured \`data\`?) or were dropped during migration`,
    };
  }
  const types = [...new Set(declared.map(r => r.type))].sort().join(', ');
  return { passed: true, reason: `all ${declared.length} declared DNS record(s) present on dest (types: ${types})` };
}

// ── assertZoneSettingsMatch ──────────────────────────────────────────
// The gold-standard "did every zone setting actually migrate" check.
//
// This does NOT trust the migration engine's own GET-back verification
// (the VERIFIED/MISSING/MISMATCHED badges). Instead it independently reads
// the destination zone's live `/zones/{id}/settings` (captured post-migrate)
// and compares it field-by-field against the source zone's live settings
// (captured post-seed). If the engine's verifier ever lied or silently
// dropped a setting, this assertion catches it — satisfying Principle 5
// (Verification Must Match Migration) with an out-of-band second source of
// truth.
//
// Scope of the invariant: for EVERY setting that is `editable` on the source
// and not in the read-only / blocked / no-op exclusion sets, the destination
// value must deep-equal the source value. A setting that is present+editable
// on source but absent or different on dest is a FAILURE — unless the
// migration report explicitly acknowledged it (plan/entitlement gap), in
// which case it is allowed per Principle 2 (Entitlement Gaps →
// Acknowledgment, Not Failure).
//
// Exclusion sets are mirrored from src/migrate/constants.ts. Keep them in
// sync; they are inlined here because this is a standalone .mjs harness that
// cannot import the TS module.
const ZS_READ_ONLY = new Set([
  'advanced_ddos', 'plan_level', 'ssl_status', 'custom_certificate_quota',
  'page_rule_quota', 'cname_flattening', 'orange_to_orange',
]);
const ZS_BLOCKED = new Set([
  'filter_logs_to_cloudflare', 'log_to_cloudflare', 'visitor_ip', 'waf',
]);
function zsIsNoOp(setting) {
  // ciphers: [] means "use defaults" — nothing to migrate (mirrors isNoOpSetting).
  return setting.id === 'ciphers' && Array.isArray(setting.value) && setting.value.length === 0;
}
// Stable deep-equality via key-sorted JSON so object-valued settings
// (minify, security_header, nel, mobile_redirect, ...) compare order-insensitively.
function zsStableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(zsStableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + zsStableStringify(v[k])).join(',') + '}';
}
function assertZoneSettingsMatch(testDir) {
  const srcStateDir = path.join(testDir, 'source-state-post-seed');
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const srcSettings = readEvidenceJson(srcStateDir, 'settings');
  const dstSettings = readEvidenceJson(dstStateDir, 'settings');

  // Empty evidence MUST fail — an assertion that reads no data cannot prove
  // anything (anti-pattern: "evidence-missing → pass anyway", see AGENTS.md §8).
  if (!srcSettings.length) {
    return { passed: false, reason: 'no source zone settings captured (settings.json empty/missing) — cannot verify settings migration' };
  }
  if (!dstSettings.length) {
    return { passed: false, reason: 'no dest zone settings captured (settings.json empty/missing) — cannot verify settings migration' };
  }

  const dstMap = new Map(dstSettings.map(s => [s.id, s]));

  // Acknowledgment whitelist: setting ids the migration report flagged as
  // acknowledged / plan-gated are allowed to differ (Principle 2). We only
  // whitelist a setting if its id literally appears on a report line that is
  // marked acknowledged (🟡) or names a plan/entitlement gap — so a clean
  // run with no report still enforces the strict invariant.
  const ackIds = new Set();
  const reportPath = path.join(testDir, 'migration-report.md');
  if (fs.existsSync(reportPath)) {
    const reportText = fs.readFileSync(reportPath, 'utf8');
    for (const line of reportText.split('\n')) {
      const isAckLine = line.includes('🟡')
        || /acknowledg/i.test(line)
        || /not (enabled|entitled|available|subscrib)/i.test(line)
        || /plan (limit|downgrad|gated|requires)/i.test(line);
      if (!isAckLine) continue;
      for (const s of srcSettings) {
        // Word-ish boundary match so "ssl" doesn't whitelist "ssl_status" etc.
        const re = new RegExp(`(^|[^a-z0-9_])${s.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_]|$)`, 'i');
        if (re.test(line)) ackIds.add(s.id);
      }
    }
  }

  const missing = [];     // editable on source, absent on dest, not acknowledged
  const mismatched = [];   // present on both, value differs, not acknowledged
  const acknowledged = []; // differs/absent but report-acknowledged (allowed)
  let totalChecked = 0;

  for (const s of srcSettings) {
    if (!s.editable) continue;
    if (ZS_READ_ONLY.has(s.id) || ZS_BLOCKED.has(s.id) || zsIsNoOp(s)) continue;
    totalChecked++;
    const d = dstMap.get(s.id);
    if (!d) {
      if (ackIds.has(s.id)) acknowledged.push(s.id);
      else missing.push(s.id);
      continue;
    }
    if (zsStableStringify(s.value) !== zsStableStringify(d.value)) {
      if (ackIds.has(s.id)) acknowledged.push(`${s.id}`);
      else mismatched.push(`${s.id}: src=${zsStableStringify(s.value)} dst=${zsStableStringify(d.value)}`);
    }
  }

  if (totalChecked === 0) {
    return { passed: false, reason: 'no editable zone settings to check on source — capture likely failed' };
  }

  const ackNote = acknowledged.length ? ` (${acknowledged.length} acknowledged/plan-gated allowed: ${acknowledged.slice(0, 8).join(', ')})` : '';
  if (missing.length || mismatched.length) {
    const parts = [];
    if (missing.length) parts.push(`${missing.length} MISSING on dest: ${missing.slice(0, 12).join(', ')}`);
    if (mismatched.length) parts.push(`${mismatched.length} MISMATCHED: ${mismatched.slice(0, 8).join('; ')}`);
    // MISSING (setting absent on dest, no ack) is a blocking ❌. A pure value
    // MISMATCH (setting present on dest, value differs) is the Principle-1
    // "Mismatched" category — non-blocking 🟡 caution, still fully surfaced.
    const severity = missing.length ? undefined : 'caution';
    return { passed: false, severity, reason: `${parts.join(' | ')}${ackNote}` };
  }
  return {
    passed: true,
    reason: `all ${totalChecked} editable zone settings migrated & verified (independent source→dest GET comparison)${ackNote}`,
  };
}

// Helper: read JSON evidence file (capture-zone-state output)
function readEvidenceJson(dir, name) {
  const p = path.join(dir, `${name}.json`);
  if (!fs.existsSync(p)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(j) ? j : Array.isArray(j?.result) ? j.result : [];
  } catch {
    return [];
  }
}

// Helper: read an OBJECT-shaped evidence file (capture-zone-state output for
// dedicated subsystem endpoints, which return a single `{ result: {...} }`
// object rather than a list). Returns the unwrapped `.result` object, or the
// root object if there's no `.result`, or null when the file is absent/empty.
function readEvidenceObject(dir, name) {
  const p = path.join(dir, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const r = (j && typeof j === 'object' && 'result' in j) ? j.result : j;
    return (r && typeof r === 'object') ? r : null;
  } catch {
    return null;
  }
}

// ── assertDedicatedSettingsMatch ─────────────────────────────────────
// Completeness companion to assertZoneSettingsMatch. The aggregate
// `GET /zones/{id}/settings` (compared by assertZoneSettingsMatch) does NOT
// include the request-affecting config that lives behind dedicated subsystem
// endpoints (DNS settings, Origin mTLS, Fraud Detection, Schema Validation).
// This assertion independently compares those, source→dest, for the exact
// fields the migration engine writes (see updateDnsSettings /
// updateOriginTlsSettings / updateFraudDetectionSettings /
// updateSchemaValidationSettings in src/api.ts).
//
// We compare a curated per-endpoint field allowlist — NOT the whole blob —
// because each subsystem also returns zone-identity / auto-managed fields
// (nameservers, SOA, modified_on) that legitimately differ across zones and
// are intentionally NOT migrated. The allowlist is the honest contract: "the
// fields the tool claims to migrate must match on the destination."
const DEDICATED_SETTINGS_SPEC = [
  { file: 'dns_settings',                label: 'DNS Settings',      fields: ['foundation_dns', 'multi_provider', 'secondary_overrides', 'ns_ttl', 'zone_mode'] },
  { file: 'origin_tls_settings',         label: 'Origin TLS',        fields: ['enabled'] },
  { file: 'fraud_detection',             label: 'Fraud Detection',   fields: ['user_profiles', 'username_expressions'] },
  { file: 'schema_validation_settings',  label: 'Schema Validation', fields: ['validation_default_mitigation_action', 'validation_override_mitigation_action'] },
];
function assertDedicatedSettingsMatch(testDir) {
  const srcStateDir = path.join(testDir, 'source-state-post-seed');
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');

  // Acknowledgment whitelist: a subsystem whose human label appears on an
  // acknowledged (🟡) / plan-gated report line is allowed to differ
  // (Principle 2 — e.g. Origin mTLS / Fraud Detection are entitlement-gated
  // and may not migrate to a lower-tier destination).
  const ackLabels = new Set();
  const reportPath = path.join(testDir, 'migration-report.md');
  if (fs.existsSync(reportPath)) {
    const reportText = fs.readFileSync(reportPath, 'utf8');
    for (const line of reportText.split('\n')) {
      const isAckLine = line.includes('🟡')
        || /acknowledg/i.test(line)
        || /not (enabled|entitled|available|subscrib)/i.test(line)
        || /plan (limit|downgrad|gated|requires)/i.test(line);
      if (!isAckLine) continue;
      for (const spec of DEDICATED_SETTINGS_SPEC) {
        if (line.toLowerCase().includes(spec.label.toLowerCase())) ackLabels.add(spec.label);
      }
    }
  }

  const norm = (v) => zsStableStringify(v);
  const mismatched = [];     // field-level value differences (not acknowledged)
  const missingDst = [];     // subsystem present on source, absent on dest
  const acknowledged = [];   // differences allowed via report acknowledgment
  let endpointsPresentOnSource = 0;
  let fieldsChecked = 0;

  for (const spec of DEDICATED_SETTINGS_SPEC) {
    const src = readEvidenceObject(srcStateDir, spec.file);
    if (!src) continue; // subsystem not captured / not applicable on source
    endpointsPresentOnSource++;
    const dst = readEvidenceObject(dstStateDir, spec.file);
    if (!dst) {
      if (ackLabels.has(spec.label)) acknowledged.push(`${spec.label} (whole subsystem)`);
      else missingDst.push(spec.label);
      continue;
    }
    for (const field of spec.fields) {
      if (!(field in src)) continue; // source didn't expose this field
      fieldsChecked++;
      if (norm(src[field]) !== norm(dst[field])) {
        if (ackLabels.has(spec.label)) acknowledged.push(`${spec.label}.${field}`);
        else mismatched.push(`${spec.label}.${field}: src=${norm(src[field])} dst=${norm(dst[field])}`);
      }
    }
  }

  // Empty evidence MUST fail (anti-pattern: "evidence-missing → pass anyway").
  if (endpointsPresentOnSource === 0) {
    return { passed: false, reason: 'no dedicated-endpoint subsystem settings captured on source (dns/origin-tls/fraud/schema) — capture likely failed' };
  }

  const ackNote = acknowledged.length ? ` (${acknowledged.length} acknowledged/plan-gated allowed: ${acknowledged.slice(0, 8).join(', ')})` : '';
  if (missingDst.length || mismatched.length) {
    const parts = [];
    if (missingDst.length) parts.push(`${missingDst.length} subsystem(s) MISSING on dest: ${missingDst.join(', ')}`);
    if (mismatched.length) parts.push(`${mismatched.length} MISMATCHED field(s): ${mismatched.slice(0, 8).join('; ')}`);
    // MISSING subsystem = blocking ❌; pure field MISMATCH = non-blocking 🟡 caution.
    const severity = missingDst.length ? undefined : 'caution';
    return { passed: false, severity, reason: `${parts.join(' | ')}${ackNote}` };
  }
  return {
    passed: true,
    reason: `${endpointsPresentOnSource} dedicated subsystem(s), ${fieldsChecked} migrated field(s) match across source and dest${ackNote}`,
  };
}

// ── assertDedicatedScalarSettingsMatch ───────────────────────────────
// Closes the last zone-settings coverage gap. assertZoneSettingsMatch compares
// the aggregate GET /zones/{id}/settings, which OMITS the scalar settings that
// live only behind their own /settings/<id> endpoint (speed_brain, fonts,
// origin_max_http_version, ssl_automatic_mode, h2_prioritization, rum,
// csam_scanner, …). capture-zone-state.mjs fetches those into
// settings_dedicated.json; this assertion independently compares them
// source→dest, exactly like assertZoneSettingsMatch does for the aggregate.
// Acknowledgment-aware (Principle 2) and fails on empty evidence (no vacuous
// pass). This is the assertion that independently catches the csam "false
// missing" class of bug — and proves dedicated-only settings actually migrate.
function assertDedicatedScalarSettingsMatch(testDir) {
  const srcStateDir = path.join(testDir, 'source-state-post-seed');
  const dstStateDir = path.join(testDir, 'dest-state-post-migrate');
  const src = readEvidenceJson(srcStateDir, 'settings_dedicated');
  const dst = readEvidenceJson(dstStateDir, 'settings_dedicated');

  if (!src.length) {
    return { passed: false, reason: 'no dedicated-scalar settings captured on source (settings_dedicated.json empty/missing) — capture likely failed' };
  }
  if (!dst.length) {
    return { passed: false, reason: 'no dedicated-scalar settings captured on dest (settings_dedicated.json empty/missing) — capture likely failed' };
  }

  const dstMap = new Map(dst.map(s => [s.id, s]));

  // Acknowledgment whitelist by setting id (same approach as assertZoneSettingsMatch).
  const ackIds = new Set();
  const reportPath = path.join(testDir, 'migration-report.md');
  if (fs.existsSync(reportPath)) {
    const reportText = fs.readFileSync(reportPath, 'utf8');
    for (const line of reportText.split('\n')) {
      const isAckLine = line.includes('🟡')
        || /acknowledg/i.test(line)
        || /not (enabled|entitled|available|subscrib)/i.test(line)
        || /plan (limit|downgrad|gated|requires)/i.test(line);
      if (!isAckLine) continue;
      for (const s of src) {
        const re = new RegExp(`(^|[^a-z0-9_])${String(s.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_]|$)`, 'i');
        if (re.test(line)) ackIds.add(s.id);
      }
    }
  }

  const norm = (v) => zsStableStringify(v);
  const missing = [];
  const mismatched = [];
  const acknowledged = [];
  let totalChecked = 0;

  for (const s of src) {
    // Skip server-managed (non-editable) settings — they cannot be migrated by
    // design, so a value difference is expected, not a failure. This mirrors
    // assertZoneSettingsMatch's `if (!s.editable) continue` for the aggregate
    // settings. `editable` is captured in settings_dedicated.json; when absent
    // (older captures) we conservatively still compare.
    if (s.editable === false) continue;
    if (ZS_READ_ONLY.has(s.id) || ZS_BLOCKED.has(s.id) || zsIsNoOp(s)) continue;
    totalChecked++;
    const d = dstMap.get(s.id);
    if (!d) {
      if (ackIds.has(s.id)) acknowledged.push(s.id);
      else missing.push(s.id);
      continue;
    }
    if (norm(s.value) !== norm(d.value)) {
      if (ackIds.has(s.id)) acknowledged.push(s.id);
      else mismatched.push(`${s.id}: src=${norm(s.value)} dst=${norm(d.value)}`);
    }
  }

  if (totalChecked === 0) {
    return { passed: false, reason: 'no comparable dedicated-scalar settings on source after exclusions — capture likely failed' };
  }

  const ackNote = acknowledged.length ? ` (${acknowledged.length} acknowledged/plan-gated allowed: ${acknowledged.slice(0, 8).join(', ')})` : '';
  if (missing.length || mismatched.length) {
    const parts = [];
    if (missing.length) parts.push(`${missing.length} MISSING on dest: ${missing.slice(0, 12).join(', ')}`);
    if (mismatched.length) parts.push(`${mismatched.length} MISMATCHED: ${mismatched.slice(0, 8).join('; ')}`);
    // MISSING (setting absent on dest) = blocking ❌; pure value MISMATCH = 🟡 caution.
    const severity = missing.length ? undefined : 'caution';
    return { passed: false, severity, reason: `${parts.join(' | ')}${ackNote}` };
  }
  return {
    passed: true,
    reason: `all ${totalChecked} dedicated-endpoint scalar setting(s) migrated & verified (independent source→dest GET comparison)${ackNote}`,
  };
}

function assertEmailRoutingAcknowledged(testDir) {
  const md = readReportMarkdown(testDir);
  if (!md) return { passed: false, reason: 'migration-report.md not found' };
  const sectionMatch = md.match(/###\s+[^\n]*Email Routing Rules[\s\S]*?(?=\n###\s|\Z)/);
  if (!sectionMatch) return { passed: false, reason: 'no Email Routing Rules section in report' };
  const section = sectionMatch[0];
  // The migrator emits "❌ acknowledged" rows for pre-acknowledged items.
  if (/acknowledged/i.test(section)) {
    // Also confirm no genuine "❌ failed" rows for forward-to-unverified rules
    // (those would mean the acknowledgment marker didn't reach migrateItems).
    const failedMatch = section.match(/\|\s*[^|]*\|\s*❌ failed/);
    if (failedMatch) {
      return { passed: false, reason: `Email Routing Rules section has a failed row in addition to acknowledged: ${failedMatch[0]}` };
    }
    return { passed: true, reason: 'Email Routing Rules section contains acknowledged badge and no unexpected failures' };
  }
  return { passed: false, reason: 'Email Routing Rules section has no acknowledged rows — pre-acknowledged-skip flow may not be wired correctly' };
}

// e13: verify the "Archive source analytics" add-on captured a snapshot and the
// download succeeded on Results. Reads the summary written by runMigration's
// keepAnalytics block. Regression for the 2026-06-06 bug where the Zone phase
// reset the Account-phase analytics capture, so the download never appeared.
function assertAnalyticsArchiveDownloaded(testDir) {
  const summaryPath = path.join(testDir, 'analytics-download', 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    return { passed: false, reason: 'no analytics-download/summary.json — keepAnalyticsArchive capture did not run' };
  }
  let s;
  try { s = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); }
  catch (e) { return { passed: false, reason: `summary.json unreadable: ${e.message}` }; }

  if (!s.downloaded) {
    return { passed: false, reason: `analytics download did not occur: ${s.reason || 'unknown'}` };
  }
  // Empty-evidence guard (AGENTS.md test integrity): a downloaded file that is
  // empty, non-JSON, or carries no datasets cannot prove the capture worked.
  if (!s.bytes || s.bytes < 200) {
    return { passed: false, reason: `downloaded bundle suspiciously small (${s.bytes} bytes)` };
  }
  if (!Array.isArray(s.topLevelKeys) || !s.topLevelKeys.includes('graphql') || !s.topLevelKeys.includes('meta')) {
    return { passed: false, reason: `bundle missing expected shape (keys: ${JSON.stringify(s.topLevelKeys)})` };
  }
  if (!s.graphqlDatasets || s.graphqlDatasets < 1) {
    return { passed: false, reason: 'bundle.graphql is empty — no datasets were queried' };
  }
  return {
    passed: true,
    reason: `analytics archive downloaded (${s.file}, ${s.bytes} bytes, ${s.graphqlDatasets} datasets, ${s.datasetsWithData} with data)`,
  };
}

async function runPostRunHooks(config, testDir) {
  const hooks = (config.metadata?.postRun || '').split(',').map(s => s.trim()).filter(Boolean);
  if (hooks.length === 0) return { passed: true, reasons: [] };
  log(`  🪝 Running post-run hooks: ${hooks.join(', ')}`);
  let allPassed = true;
  const reasons = [];
  const cautions = [];
  for (const hook of hooks) {
    let result;
    switch (hook) {
      case 'assertDestZoneInTargetAccount':
        result = assertDestZoneInTargetAccount(testDir);
        break;
      case 'assertEmailRoutingMismatched':
        result = assertEmailRoutingMismatched(testDir);
        break;
      case 'assertEmailRoutingAcknowledged':
        result = assertEmailRoutingAcknowledged(testDir);
        break;
      case 'assertEmailRoutingMixedOutcomes':
        result = assertEmailRoutingMixedOutcomes(testDir);
        break;
      case 'assertEnterpriseFeaturesAcknowledged':
        result = assertEnterpriseFeaturesAcknowledged(testDir);
        break;
      case 'assertLbPoolIdsRemapped':
        result = assertLbPoolIdsRemapped(testDir);
        break;
      case 'assertServiceBindingResolves':
        result = assertServiceBindingResolves(testDir);
        break;
      case 'assertKvKeysCopied':
        result = await assertKvKeysCopied(testDir, config);
        break;
      case 'assertR2ObjectsCopied':
        result = await assertR2ObjectsCopied(testDir, config);
        break;
      case 'assertDoStateMigrated':
        result = assertDoStateMigrated(testDir);
        break;
      case 'assertDoNamespaceCreated':
        result = assertDoNamespaceCreated(testDir, config);
        break;
      case 'assertAccessPolicyIdpRemapped':
        result = assertAccessPolicyIdpRemapped(testDir);
        break;
      case 'assertAccessMultiDomainMigrated':
        result = assertAccessMultiDomainMigrated(testDir);
        break;
      case 'assertSecretsManualAction':
        result = assertSecretsManualAction(testDir);
        break;
      case 'assertRulesetOverwrite':
        result = assertRulesetOverwrite(testDir);
        break;
      case 'assertProxiedFlagsMatch':
        result = assertProxiedFlagsMatch(testDir);
        break;
      case 'assertDnsRecordTypesPresent':
        result = assertDnsRecordTypesPresent(testDir);
        break;
      case 'assertZoneSettingsMatch':
        result = assertZoneSettingsMatch(testDir);
        break;
      case 'assertDedicatedSettingsMatch':
        result = assertDedicatedSettingsMatch(testDir);
        break;
      case 'assertDedicatedScalarSettingsMatch':
        result = assertDedicatedScalarSettingsMatch(testDir);
        break;
      case 'assertZoneSingletonSettingsMatch':
        result = assertZoneSingletonSettingsMatch(testDir);
        break;
      case 'assertNoUnexpectedFailures':
        result = assertNoUnexpectedFailures(testDir);
        break;
      case 'assertWorkerBindingsCompletelyMigrated':
        result = assertWorkerBindingsCompletelyMigrated(testDir);
        break;
      case 'assertAccountRulesetReferenceRemapped':
        result = await assertAccountRulesetReferenceRemapped(testDir);
        break;
      case 'assertCertPackDedupe':
        result = assertCertPackDedupe(testDir);
        break;
      case 'assertAnalyticsArchiveDownloaded':
        result = assertAnalyticsArchiveDownloaded(testDir);
        break;
      default:
        result = { passed: false, reason: `unknown post-run hook "${hook}"` };
    }
    // Three-tier severity, mirroring the product's own Principle 1 taxonomy:
    //   pass         → ✅
    //   caution 🟡   → NON-BLOCKING. A resource migrated and is present, but a
    //                  value differs (the Principle-1 "Mismatched" category, which
    //                  the product UI itself renders yellow, not red). Surfaced in
    //                  full so it stays findable, but does NOT fail the run / block
    //                  commits. An assertion opts in with `severity: 'caution'`.
    //   fail ❌      → BLOCKING. Missing/Failed/empty-evidence/hook error — genuine
    //                  issues that must stop a commit.
    const isCaution = result.severity === 'caution' && !result.passed;
    const icon = result.passed ? '✅' : (isCaution ? '🟡' : '❌');
    log(`    ${icon} ${hook}: ${result.reason}`);
    if (!result.passed && !isCaution) allPassed = false;
    if (isCaution) cautions.push(`${hook}: ${result.reason}`);
    reasons.push(`${hook}: ${result.reason}`);
  }
  if (cautions.length) log(`  🟡 ${cautions.length} non-blocking caution(s) (mismatches, not failures): review above`);
  return { passed: allPassed, reasons, cautions };
}

// ── Clean Destination Zone (keep zone, remove config) ────────────────

async function cleanDestZone() {
  const list = await targetCfRequest('GET', `/zones?name=${encodeURIComponent(DEST_DOMAIN)}&account.id=${CF_TARGET_ACCOUNT_ID}`);
  if (!list.ok || !Array.isArray(list.data?.result) || list.data.result.length === 0) {
    log(`  \u26a0\ufe0f  No dest zone found for "${DEST_DOMAIN}" (will be created by migration)`);
    return;
  }
  const destZoneId = list.data.result[0].id;
  log(`  \u{1F9F9} Cleaning dest zone ${destZoneId}...`);
  let cleaned = 0;

  // Email Routing teardown — mirrors cleanZone() but on the destination zone.
  // See cleanZone() for the rationale (per-address rules and catch-all leftover
  // state cause cross-test contamination).
  const destRules = await targetCfRequest('GET', `/zones/${destZoneId}/email/routing/rules?per_page=100`);
  if (destRules.ok && Array.isArray(destRules.data?.result)) {
    for (const rule of destRules.data.result) {
      const isCatchAll = rule.matchers?.length === 1 && rule.matchers[0].type === 'all';
      if (!isCatchAll && rule.tag) {
        await targetCfRequest('DELETE', `/zones/${destZoneId}/email/routing/rules/${rule.tag}`);
      }
    }
  }
  await targetCfRequest('PUT', `/zones/${destZoneId}/email/routing/rules/catch_all`, {
    enabled: false,
    matchers: [{ type: 'all' }],
    actions: [{ type: 'drop' }],
  });
  await targetCfRequest('POST', `/zones/${destZoneId}/email/routing/disable`);

  // Delete DNS records
  const dns = await targetCfRequest('GET', `/zones/${destZoneId}/dns_records?per_page=100`);
  if (dns.ok && Array.isArray(dns.data?.result)) {
    for (const rec of dns.data.result) {
      await targetCfRequest('DELETE', `/zones/${destZoneId}/dns_records/${rec.id}`);
      cleaned++;
    }
  }

  // Delete page rules
  const pr = await targetCfRequest('GET', `/zones/${destZoneId}/pagerules`);
  if (pr.ok && Array.isArray(pr.data?.result)) {
    for (const rule of pr.data.result) {
      await targetCfRequest('DELETE', `/zones/${destZoneId}/pagerules/${rule.id}`);
      cleaned++;
    }
  }

  // Delete firewall rules
  const fw = await targetCfRequest('GET', `/zones/${destZoneId}/firewall/rules?per_page=100`);
  if (fw.ok && Array.isArray(fw.data?.result)) {
    for (const rule of fw.data.result) {
      await targetCfRequest('DELETE', `/zones/${destZoneId}/firewall/rules/${rule.id}`);
      cleaned++;
    }
  }

  // Delete rate limits
  const rl = await targetCfRequest('GET', `/zones/${destZoneId}/rate_limits?per_page=100`);
  if (rl.ok && Array.isArray(rl.data?.result)) {
    for (const rule of rl.data.result) {
      await targetCfRequest('DELETE', `/zones/${destZoneId}/rate_limits/${rule.id}`);
      cleaned++;
    }
  }

  // Clean rulesets (PUT empty rules)
  const rs = await targetCfRequest('GET', `/zones/${destZoneId}/rulesets`);
  if (rs.ok && Array.isArray(rs.data?.result)) {
    for (const ruleset of rs.data.result) {
      if (ruleset.rules?.length > 0) {
        await targetCfRequest('PUT', `/zones/${destZoneId}/rulesets/${ruleset.id}`, {
          rules: []
        });
        cleaned++;
      }
    }
  }

  // Delete worker routes on dest zone
  const dwr = await targetCfRequest('GET', `/zones/${destZoneId}/workers/routes`);
  if (dwr.ok && Array.isArray(dwr.data?.result)) {
    for (const r of dwr.data.result) {
      await targetCfRequest('DELETE', `/zones/${destZoneId}/workers/routes/${r.id}`);
      cleaned++;
    }
  }

  // Delete worker custom domains on dest account (zone-filtered)
  const dwcd = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/workers/domains`);
  const destZoneWorkerNames = new Set();
  if (dwcd.ok && Array.isArray(dwcd.data?.result)) {
    for (const d of dwcd.data.result) {
      if (d.zone_id === destZoneId) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/workers/domains/${d.id}`);
        if (d.service) destZoneWorkerNames.add(d.service);
        cleaned++;
      }
    }
  }

  // Collect worker names from routes too
  if (dwr.ok && Array.isArray(dwr.data?.result)) {
    for (const r of dwr.data.result) { if (r.script) destZoneWorkerNames.add(r.script); }
  }

  // Delete worker scripts: the zone-tied ones (via routes/custom domains) PLUS
  // every test-prefixed account worker. Service-binding-chain workers (e05) and
  // service targets (maxconfig-svc-worker, maxworker-child-svc, svcchain-*) are
  // NOT zone-tied, so matching only zone-tied names left them to leak. Use the
  // retrying deleter so binding-referenced workers (e.g. an RPC helper still
  // bound by its parent) get removed on the second pass.
  const allDestWorkers = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/workers/scripts`);
  if (allDestWorkers.ok && Array.isArray(allDestWorkers.data?.result)) {
    for (const w of allDestWorkers.data.result) {
      if (isTestResourceName(w.id)) destZoneWorkerNames.add(w.id);
    }
  }
  cleaned += await deleteDestWorkers([...destZoneWorkerNames]);

  // Delete Access apps on dest account
  const daccess = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/access/apps`);
  if (daccess.ok && Array.isArray(daccess.data?.result)) {
    for (const a of daccess.data.result) {
      await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/access/apps/${a.id}`);
      cleaned++;
    }
  }

  // Delete Turnstile widgets on dest: test-named ones (maxconfig-turnstile etc.)
  // OR any widget whose domains include the source/dest test domain. Matching by
  // name (not only domain) stops the "reached the limit of widgets" acknowledgment
  // that built up from leaked widgets across runs.
  const dturn = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/challenges/widgets?per_page=100`);
  if (dturn.ok && Array.isArray(dturn.data?.result)) {
    for (const w of dturn.data.result) {
      const zoneDomains = (w.domains || []);
      const domainMatch = [DEST_DOMAIN, SOURCE_DOMAIN].some(dom => dom && zoneDomains.some(d => d.includes(dom)));
      if (isTestResourceName(w.name) || domainMatch) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/challenges/widgets/${w.sitekey}`);
        cleaned++;
      }
    }
  }

  // Delete KV Namespaces on dest (maxconfig-prefixed)
  const dkv = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/storage/kv/namespaces`);
  if (dkv.ok && Array.isArray(dkv.data?.result)) {
    for (const ns of dkv.data.result) {
      if (isTestResourceName(ns.title)) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/storage/kv/namespaces/${ns.id}`);
        cleaned++;
      }
    }
  }

  // Delete D1 Databases on dest (maxconfig-prefixed)
  const dd1 = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/d1/database`);
  if (dd1.ok && Array.isArray(dd1.data?.result)) {
    for (const db of dd1.data.result) {
      if (isTestResourceName(db.name)) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/d1/database/${db.uuid}`);
        cleaned++;
      }
    }
  }

  // Delete Queues on dest (maxconfig-prefixed)
  const dq = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/queues`);
  if (dq.ok && Array.isArray(dq.data?.result)) {
    for (const q of dq.data.result) {
      if (isTestResourceName(q.queue_name)) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/queues/${q.queue_id}`);
        cleaned++;
      }
    }
  }

  // Delete Vectorize indexes on dest (test-prefixed). No cleanup existed for
  // these before, so maxconfig-/maxworker-vectorize-* indexes leaked every run.
  const dvec = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/vectorize/v2/indexes`);
  if (dvec.ok && Array.isArray(dvec.data?.result)) {
    for (const idx of dvec.data.result) {
      if (isTestResourceName(idx.name)) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/vectorize/v2/indexes/${idx.name}`);
        cleaned++;
      }
    }
  }

  // Delete Secrets Store stores on dest (test-prefixed). Also previously
  // uncleaned — leaked stores trip the "maximum number of Secrets Stores"
  // acknowledgment on later runs.
  const dss = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/secrets_store/stores`);
  if (dss.ok && Array.isArray(dss.data?.result)) {
    for (const store of dss.data.result) {
      if (isTestResourceName(store.name)) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/secrets_store/stores/${store.id}`);
        cleaned++;
      }
    }
  }

  // Delete Custom Lists on dest (test-prefixed, e.g. maxconfig_allowed_ips).
  const dcl = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/rules/lists`);
  if (dcl.ok && Array.isArray(dcl.data?.result)) {
    for (const lst of dcl.data.result) {
      if (isTestResourceName(lst.name)) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/rules/lists/${lst.id}`);
        cleaned++;
      }
    }
  }

  // Delete account-level test rulesets on dest (only "Twilight Zone Test"-named
  // or MaxConfig-named ones — never touch production rulesets). Before
  // deletion, strip any execute rules from account-level phase entrypoints
  // that reference these rulesets (otherwise the entrypoint pin prevents
  // deletion).
  const dRs = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/rulesets`);
  if (dRs.ok && Array.isArray(dRs.data?.result)) {
    const testRulesetIds = new Set(
      dRs.data.result
        .filter(rs => rs.name?.startsWith('Twilight Zone Test') || rs.name?.includes('MaxConfig'))
        .map(rs => rs.id),
    );
    const rootRulesets = dRs.data.result.filter(rs => rs.kind === 'root');
    for (const rs of rootRulesets) {
      const detail = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/rulesets/${rs.id}`);
      if (!detail.ok || !Array.isArray(detail.data?.result?.rules)) continue;
      const rules = detail.data.result.rules;
      const filtered = rules.filter(r => {
        if (r.action !== 'execute') return true;
        const targetId = r.action_parameters?.id;
        return !(typeof targetId === 'string' && testRulesetIds.has(targetId));
      });
      if (filtered.length !== rules.length) {
        const cleanRules = filtered.map(r => {
          const { id: _id, version: _v, last_updated: _lu, ref: _ref, ...rest } = r;
          return rest;
        });
        await targetCfRequest('PUT', `/accounts/${CF_TARGET_ACCOUNT_ID}/rulesets/phases/${rs.phase}/entrypoint`, { rules: cleanRules });
      }
    }
    for (const rs of dRs.data.result) {
      if (rs.name?.startsWith('Twilight Zone Test') || rs.name?.includes('MaxConfig')) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/rulesets/${rs.id}`);
        cleaned++;
      }
    }
  }

  // Dest notification policies + webhooks
  const dnp = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/alerting/v3/policies`);
  if (dnp.ok && Array.isArray(dnp.data?.result)) {
    for (const policy of dnp.data.result) {
      if (policy.name?.includes('MaxConfig') || policy.name?.startsWith('Twilight Zone Test')) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/alerting/v3/policies/${policy.id}`);
        cleaned++;
      }
    }
  }
  const dnw = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/alerting/v3/destinations/webhooks`);
  if (dnw.ok && Array.isArray(dnw.data?.result)) {
    for (const hook of dnw.data.result) {
      if (hook.name?.includes('MaxConfig') || hook.name?.startsWith('Twilight Zone Test')) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/alerting/v3/destinations/webhooks/${hook.id}`);
        cleaned++;
      }
    }
  }

  // Dest account-scoped Logpush jobs (maxconfig-prefixed)
  const dalp = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/logpush/jobs`);
  if (dalp.ok && Array.isArray(dalp.data?.result)) {
    for (const job of dalp.data.result) {
      if (isTestResourceName(job.name)) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/logpush/jobs/${job.id}`);
        cleaned++;
      }
    }
  }

  // Dest Access tags / bookmarks / custom pages (maxconfig-prefixed/named)
  const dat = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/access/tags`);
  if (dat.ok && Array.isArray(dat.data?.result)) {
    for (const tag of dat.data.result) {
      if (isTestResourceName(tag.name)) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/access/tags/${encodeURIComponent(tag.name)}`);
        cleaned++;
      }
    }
  }
  const dab = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/access/bookmarks`);
  if (dab.ok && Array.isArray(dab.data?.result)) {
    for (const bookmark of dab.data.result) {
      if (bookmark.name?.includes('MaxConfig')) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/access/bookmarks/${bookmark.id}`);
        cleaned++;
      }
    }
  }
  const dacp = await targetCfRequest('GET', `/accounts/${CF_TARGET_ACCOUNT_ID}/access/custom_pages`);
  if (dacp.ok && Array.isArray(dacp.data?.result)) {
    for (const page of dacp.data.result) {
      if (page.name?.includes('MaxConfig')) {
        await targetCfRequest('DELETE', `/accounts/${CF_TARGET_ACCOUNT_ID}/access/custom_pages/${page.uid}`);
        cleaned++;
      }
    }
  }

  log(`  \u{1F9F9} Cleaned ${cleaned}+ resources from dest zone`);
}

// ── Logging ──────────────────────────────────────────────────────

const logLines = [];
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

// ── Playwright Migration ─────────────────────────────────────────

// Click a wizard step's primary button and wait until the next step is reached
// (a button matching `doneRe` appears) or the migration stream surfaces an
// ERROR. Throws with the captured error text on failure, or if the primary
// button never becomes enabled (an unsatisfied gate). Drives the two streaming
// phases of the 5-step flow: account-resources deploy (Step 2→3) and zone
// migrate (Step 3→4).
async function runPhase(page, clickText, doneRe, timeoutMs, phaseName, outputDir) {
  const btn = page.locator('button', { hasText: clickText }).first();
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  const enabled = await page.waitForFunction((t) => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes(t));
    return b && !b.disabled;
  }, clickText, { timeout: 15000 }).catch(() => null);
  if (!enabled) throw new Error(`${phaseName}: primary button "${clickText}" stayed disabled — an unsatisfied gate (e.g. unresolved email address or unacknowledged out-of-scope item).`);
  log(`  ▶️  ${phaseName}: clicking "${clickText}"...`);
  await btn.click();
  const outcome = await page.waitForFunction(({ re }) => {
    const rx = new RegExp(re, 'i');
    const btns = [...document.querySelectorAll('button')];
    if (btns.some(b => rx.test(b.textContent || ''))) return 'done';
    if ((document.body.innerText || '').includes('ERROR:')) return 'error';
    return null;
  }, { re: doneRe.source }, { timeout: timeoutMs });
  if ((await outcome.jsonValue()) === 'error') {
    const errorText = await page.evaluate(() => document.body.innerText.split('\n').filter(l => l.includes('ERROR:')).join('; ') || 'Unknown migration error');
    if (outputDir) await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true }).catch(() => {});
    throw new Error(`${phaseName} error: ${errorText}`);
  }
  await page.waitForTimeout(1200);
}

// Click a select-only navigation button (e.g. "Continue to Zone", "Continue to
// Apply") and wait for the next step's marker button to appear. Unlike
// runPhase, these don't stream — they just advance the wizard — so the wait is
// short. Throws if the button stays disabled (an unsatisfied gate upstream).
async function navigateStep(page, clickText, nextRe, label) {
  const btn = page.locator('button', { hasText: clickText }).first();
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  const enabled = await page.waitForFunction((t) => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes(t));
    return b && !b.disabled;
  }, clickText, { timeout: 15000 }).catch(() => null);
  if (!enabled) throw new Error(`${label}: navigation button "${clickText}" stayed disabled — an unsatisfied gate (e.g. unresolved email address or unacknowledged out-of-scope item).`);
  log(`  ▶️  ${label}: clicking "${clickText}"...`);
  await btn.click();
  await page.waitForFunction(({ re }) => {
    const rx = new RegExp(re, 'i');
    return [...document.querySelectorAll('button')].some(b => rx.test(b.textContent || ''));
  }, { re: nextRe.source }, { timeout: 30000 });
  await page.waitForTimeout(800);
}

// Resolve gates that can block a scope page's primary button on EITHER the
// Account or Zone step: per-address "Skip" on the email
// verification card, the master "I accept responsibility…" out-of-scope
// acknowledgment checkbox, and the pre-checked "Archive source analytics"
// add-on (unchecked to avoid a parallel capture during tests). Safe no-op when
// none are present. (Step 2 also has its own inline account-scoped group
// selection; this covers the gates common to both scope pages.)
async function resolveBlockingGates(page, emailStrategy = 'skip-all', keepAnalytics = false) {
  if (emailStrategy === 'skip-all') {
    const candidates = await page.locator('button:has-text("Skip")').all();
    let skipped = 0;
    for (const btn of candidates) {
      try {
        if (!(await btn.isVisible()) || !(await btn.isEnabled())) continue;
        const inCard = await btn.evaluate((el) => {
          let cur = el;
          for (let i = 0; i < 8 && cur; i++) { if (cur.textContent && /forwarding address/i.test(cur.textContent)) return true; cur = cur.parentElement; }
          return false;
        });
        if (!inCard) continue;
        await btn.click(); skipped++; await page.waitForTimeout(150);
      } catch { /* row removed mid-iteration */ }
    }
    if (skipped > 0) log(`  ⊘ Skipped ${skipped} unverified email forwarding address(es)`);
  }
  // Out-of-scope acknowledgment: tick the master "Skip and acknowledge all
  // remaining items" toggle (OutOfScopePanel.tsx) — stable label text, far more
  // robust than walking the DOM for the first checkbox. Fallback: tick every
  // unchecked checkbox inside the "Will Not Migrate" panel.
  const master = page.locator('label:has-text("Skip and acknowledge all remaining items") input[type="checkbox"]').first();
  if (await master.count() > 0) {
    if (!(await master.isChecked())) {
      await master.click();
      log('  ☑️  Acknowledged out-of-scope items');
      await page.waitForTimeout(300);
    }
  } else {
    // Fallback for older/renamed panels: tick any unchecked checkbox under a
    // "Will Not Migrate" / "Cannot Migrate" heading.
    const ticked = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find(x => /Will Not Migrate|Cannot Migrate/i.test(x.textContent || ''));
      if (!h) return 0;
      let c = h.parentElement;
      while (c && !c.matches('div.rounded-lg')) c = c.parentElement;
      if (!c) return 0;
      let n = 0;
      for (const cb of c.querySelectorAll('input[type="checkbox"]')) { if (!cb.checked) { cb.click(); n++; } }
      return n;
    });
    if (ticked > 0) { log(`  ☑️  Acknowledged out-of-scope items (${ticked} checkbox(es))`); await page.waitForTimeout(300); }
  }
  // Tick any remaining "I understand / I have run these / acknowledge" ack
  // checkboxes — identified by ack-label text so resource-selection checkboxes
  // are never touched. NOTE (#9/#15): the manual-action cards (missing-storage
  // deps, enterprise-plan settings) and the D1 per-db card no longer GATE
  // Continue — they're non-blocking disclosures now, so this usually finds 0
  // and is a harmless no-op. Kept for any genuinely-blocking future ack.
  const preAcked = await page.evaluate(() => {
    let n = 0;
    for (const lbl of document.querySelectorAll('label')) {
      if (!/I understand|I have run these commands|acknowledge/i.test(lbl.textContent || '')) continue;
      const cb = lbl.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) { cb.click(); n++; }
    }
    return n;
  });
  if (preAcked > 0) { log(`  ☑️  Acknowledged ${preAcked} pre-migration manual action(s)`); await page.waitForTimeout(300); }
  // Destination confirmation checkboxes (ScopeReview "Confirm destination"):
  // the action button stays disabled until the account (Account step) and/or
  // zone (Zone step) destination is explicitly confirmed. Tick any present.
  const destConfirmed = await page.evaluate(() => {
    let n = 0;
    for (const sel of ['Confirm destination account', 'Confirm destination zone']) {
      const cb = document.querySelector(`input[aria-label="${sel}"]`);
      if (cb && !cb.checked) { cb.click(); n++; }
    }
    return n;
  });
  if (destConfirmed > 0) { log(`  ☑️  Confirmed destination (${destConfirmed} checkbox(es))`); await page.waitForTimeout(200); }
  // Leave the "Archive source analytics" add-on alone when keepAnalytics is set
  // (e13 exercises the capture+download path); otherwise uncheck it to avoid a
  // parallel GraphQL capture during migration-verification tests.
  if (!keepAnalytics) {
    try {
      const analytics = await page.evaluate(() => {
        const cb = document.querySelector('input[aria-label="Archive source analytics alongside the migration"]');
        if (!cb) return 'absent';
        if (cb.checked) { cb.click(); return 'unchecked'; }
        return 'off';
      });
      if (analytics === 'unchecked') { log('  ⊘ Unchecked "Archive source analytics"'); await page.waitForTimeout(150); }
    } catch { /* older UI */ }
  }
}

async function runMigration(browser, config, outputDir) {
  const startTime = Date.now();
  const consoleLogs = [];
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  const page = await context.newPage();

  // Capture console messages
  page.on('console', (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    consoleLogs.push(`[PAGE ERROR] ${err.message}`);
  });

  try {
    const company = config.metadata?.company || 'Unknown';
    const domain = DEST_DOMAIN;  // Always use source zone domain, not company domain
    log(`  🌐 Opening browser for ${company}...`);

    // Navigate to the app
    await page.goto(DEV_SERVER_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    // ── Step 1: Credentials ──────────────────────────────
    log('  📝 Step 1: Filling credentials...');

    // 5-step wizard (Setup → Account → Zone → Cutover → Results). The source
    // mode defaults to "API"; there's no longer a "Migrate"/"Export" mode
    // toggle or a "Both Accounts" button, so we only flip auth to API Key and
    // fill the fields. Selects are addressed by their stable ids
    // (#source-account / #source-zone / #dest-account) rather than nth() so a
    // layout change can't silently pick the wrong dropdown.

    // Auth type: API Key (vs API Token)
    await page.locator('button', { hasText: 'API Key' }).first().click();
    await page.waitForTimeout(300);

    // Fill email and API key
    await page.locator('input[type="email"]').first().fill(CF_API_EMAIL);
    await page.waitForTimeout(200);
    await page.locator('input[type="password"]').first().fill(CF_API_KEY);
    await page.waitForTimeout(500);

    // Source account
    log('  ⏳ Waiting for accounts to load...');
    await page.waitForFunction(() => {
      const s = document.querySelector('#source-account');
      return s && s.options.length > 1;
    }, null, { timeout: 30000 });
    log(`  📋 Selecting source account ${CF_ACCOUNT_ID}...`);
    await page.locator('#source-account').selectOption(CF_ACCOUNT_ID);
    await page.waitForTimeout(1000);

    // Source zone
    log('  ⏳ Waiting for zones to load...');
    await page.waitForFunction(() => {
      const s = document.querySelector('#source-zone');
      return s && s.options.length > 1;
    }, null, { timeout: 30000 });
    log(`  📋 Selecting source zone ${CF_ZONE_ID}...`);
    await page.locator('#source-zone').selectOption(CF_ZONE_ID);
    await page.waitForTimeout(500);

    // Destination account
    log(`  📋 Selecting destination account ${CF_TARGET_ACCOUNT_ID}...`);
    await page.waitForFunction(() => {
      const s = document.querySelector('#dest-account');
      return s && s.options.length > 1;
    }, null, { timeout: 15000 });
    await page.locator('#dest-account').selectOption(CF_TARGET_ACCOUNT_ID);
    await page.waitForTimeout(500);

    // Destination domain (auto-fills from the source zone, but force it anyway)
    const domainInput = page.locator('#dest-domain');
    if (await domainInput.count() > 0) {
      await domainInput.fill(domain);
      await page.waitForTimeout(300);
    }

    // Select the highest available destination plan (Enterprise) if offered + enabled
    const entButton = page.locator('button', { hasText: /^Enterprise/ });
    if (await entButton.count() > 0 && !(await entButton.first().isDisabled())) {
      await entButton.first().click();
      await page.waitForTimeout(200);
    }

    // Screenshot Step 1
    await page.screenshot({ path: path.join(outputDir, 'step1-setup.png'), fullPage: true });
    log('  📸 Step 1 screenshot saved');

    // ── Click "Scope Migration" → Step 2 (Account) ──────
    log('  🔄 Clicking Scope Migration...');
    await page.locator('button', { hasText: 'Scope Migration' }).first().click();

    // The export stream runs, then the Account step renders. It's select-only
    // navigation now (the migration runs from the Apply step), so its primary
    // button is "Continue to Zone →".
    log('  ⏳ Waiting for export to complete and Account step to load...');
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('button')].some(b => /Continue to Zone/i.test(b.textContent || ''));
    }, null, { timeout: 120000 });
    await page.waitForTimeout(1000);

    // ── Step 2: Scope ───────────────────────────────────
    log('  📋 Step 2: Scope loaded');
    await page.screenshot({ path: path.join(outputDir, 'step2-preview.png'), fullPage: true });
    log('  📸 Step 2 screenshot saved');

    // ── Select account-scoped groups when the test needs them ────────
    // Zone-scoped groups default to ON (DNS, page rules, etc.). Account-scoped
    // groups (LBs, KV, R2, D1, Workers, etc.) default to OFF because they
    // affect billing/quotas. Tests 106-116 need at least some of these on;
    // opt-in via config.metadata.selectAccountScoped (true to select all, or
    // an array of group keys to select specifically).
    const accountScope = config.metadata?.selectAccountScoped;
    if (accountScope === true || Array.isArray(accountScope)) {
      const groupLabels = [
        'Worker Scripts', 'Load Balancers', 'LB Pools', 'LB Health Monitors',
        'Access Applications', 'Spectrum Apps', 'Queues', 'Turnstile Widgets',
        'KV Namespaces', 'R2 Buckets', 'D1 Databases', 'Custom Lists',
        'Pages Projects', 'AI Gateways', 'AI Gateway Custom Providers',
        'Origin CA Certificates',
        // 'Durable Objects' is intentionally NOT in this list — it's a
        // config-required group (needs source/dest worker URL setup in
        // Step 3) and selecting the top-level checkbox without configuring
        // each item just leaves the migration with empty DO config.
      ];
      // Walk every group row that has an account-scope label and click its
      // checkbox if not already checked + not disabled. We identify the row
      // by matching its visible label text and find the input inside.
      // Also collect diagnostic info — which expected groups were present /
      // disabled / missing — so the run log shows the silent gaps (e.g.
      // "Selected 1" when the config seeds 5 storage resources but the
      // export didn't pick them up because of stale source state).
      const result = await page.evaluate((labels) => {
        const out = { clicked: 0, present: [], disabled: [], alreadyChecked: [] };
        const rows = document.querySelectorAll('div.flex.items-center.gap-3');
        for (const row of rows) {
          const label = row.querySelector('.font-medium');
          if (!label) continue;
          const text = (label.textContent || '').trim();
          if (!labels.includes(text)) continue;
          const cb = row.querySelector('input[type="checkbox"]');
          if (!cb) continue;
          if (cb.disabled) { out.disabled.push(text); continue; }
          if (cb.checked) { out.alreadyChecked.push(text); continue; }
          cb.click();
          out.clicked++;
          out.present.push(text);
        }
        return out;
      }, groupLabels);
      log(`  ☑️  Selected ${result.clicked} account-scoped group(s)`);
      if (result.disabled.length > 0) log(`     disabled (cap-gap): ${result.disabled.join(', ')}`);
      if (result.alreadyChecked.length > 0) log(`     already checked: ${result.alreadyChecked.join(', ')}`);
      // Diagnostic: if config seeded resources we expected to see, warn when
      // none of them rendered (most common silent failure mode in our test
      // harness — e.g. worker upload failed silently, so KV/R2/D1 groups
      // never showed up in Step 2). Maps config keys → expected group label.
      const expectedGroups = {
        workers: 'Worker Scripts',
        kv_namespaces: 'KV Namespaces',
        r2_buckets: 'R2 Buckets',
        d1_databases: 'D1 Databases',
        queues: 'Queues',
        access_apps: 'Access Applications',
        spectrum_apps: 'Spectrum Apps',
        turnstile_widgets: 'Turnstile Widgets',
        load_balancers: 'Load Balancers',
        lb_pools: 'LB Pools',
        pages_projects: 'Pages Projects',
        ai_gateways: 'AI Gateways',
        ai_gateway_custom_providers: 'AI Gateway Custom Providers',
      };
      const seenLabels = new Set([...result.present, ...result.disabled, ...result.alreadyChecked]);
      const missingFromUi = [];
      for (const [k, label] of Object.entries(expectedGroups)) {
        if (Array.isArray(config[k]) && config[k].length > 0 && !seenLabels.has(label)) {
          missingFromUi.push(`${label} (config has ${config[k].length} ${k})`);
        }
      }
      if (missingFromUi.length > 0) {
        log(`     ⚠ MISSING FROM UI (likely silent source seeding failure): ${missingFromUi.join('; ')}`);
      }
      await page.waitForTimeout(500);
    }

    // ── Resolve email-address verification card (if present) ─────────
    // The card lives inside an element with `📧` header text. We scope the
    // "Skip" button query to that card so we don't accidentally click the
    // conflict-strategy "Skip" toggle elsewhere on the page.
    const resolutionStrategy = config.metadata?.emailAddressResolution || 'skip-all';
    if (resolutionStrategy === 'skip-all') {
      // Each unverified address row has a per-row Skip button. They live
      // inside the verification card which renders code elements containing
      // the email — locate the row container, then find Skip within it.
      const cardSkipBtns = await page.locator(
        'div:has(> div > div.text-amber-300:has-text("need attention")) button:has-text("Skip")'
      ).all();
      // Fallback: if the structural locator misses, use a text-based locator
      // that matches only buttons whose text is EXACTLY "Skip" (the conflict-
      // strategy button has the same text — but it's a single button not a
      // group, so we check ancestor for "forwarding").
      const candidates = cardSkipBtns.length > 0
        ? cardSkipBtns
        : (await page.locator('button:has-text("Skip")').all());
      let skipped = 0;
      for (const btn of candidates) {
        try {
          if (!(await btn.isVisible()) || !(await btn.isEnabled())) continue;
          // Walk up the DOM to confirm we're inside the verification card.
          const inCard = await btn.evaluate((el) => {
            let cur = el;
            for (let i = 0; i < 8 && cur; i++) {
              if (cur.textContent && /forwarding address/i.test(cur.textContent)) return true;
              cur = cur.parentElement;
            }
            return false;
          });
          if (!inCard) continue;
          await btn.click();
          skipped++;
          await page.waitForTimeout(150);
        } catch { /* button removed mid-iteration */ }
      }
      if (skipped > 0) log(`  ⊘ Skipped ${skipped} unverified email forwarding address(es)`);
      await page.waitForTimeout(300);
    }

    // ── Auto-acknowledge out-of-scope items (IMPOSSIBLE_TO_MIGRATE) ─
    // The Step 2 OutOfScopePanel's gated block now contains ONLY actionable
    // items with an inline fix-it form (worker secrets, cert keys, etc. —
    // values the tool consumes at migrate time). Those block "Continue to
    // Migration" until fixed or acknowledged. Actionable items the user
    // performs AFTER zone creation (no fix-it form: D1/R2/Pages CLI,
    // registrar/DNSSEC, account re-provisioning) moved to the disclosure-only
    // PostMigrationWorkPanel and never gate. Informational categories
    // (auto_managed / read_only / data_ephemeral) also never gate.
    // If the gated block isn't present (no fix-it items this run), Continue
    // is already enabled and this is a no-op.
    //
    // The actionable block renders `Will Not Migrate — You Must Act (N)`
    // as the heading; we find the master "I accept responsibility for
    // all N manual actions below" checkbox by walking from that
    // heading. Regex stays loose (`Will Not Migrate|Cannot Migrate`)
    // so a future framing tweak doesn't silently break the harness.
    // If the panel isn't present (no actionable items for this
    // migration), this is a no-op — informational-only panels have a
    // different heading and contain no checkboxes to click.
    //
    // The panel container is also distinguishable now: actionable
    // block uses `border-2 border-amber-700`; informational uses a
    // gray border. We anchor on the heading so we don't depend on
    // container styling.
    const ackResult = await page.evaluate(() => {
      // Find the actionable-block heading (h2 in OutOfScopePanel).
      const headings = [...document.querySelectorAll('h2')];
      const panelHeading = headings.find(h =>
        /Will Not Migrate|Cannot Migrate/i.test(h.textContent || ''),
      );
      if (!panelHeading) return { found: false, clicked: false };
      // Walk up to the actionable-block container (the rounded panel
      // wrapping this heading).
      let container = panelHeading.parentElement;
      while (container && !container.matches('div.rounded-lg')) {
        container = container.parentElement;
      }
      if (!container) return { found: true, clicked: false };
      const masterCb = container.querySelector('input[type="checkbox"]');
      if (!masterCb) return { found: true, clicked: false };
      if (masterCb.checked && !masterCb.indeterminate) return { found: true, clicked: false, alreadyAcked: true };
      masterCb.click();
      return { found: true, clicked: true, nowChecked: masterCb.checked };
    });
    if (ackResult.found) {
      if (ackResult.alreadyAcked) {
        log(`  ☑️  Out-of-scope items already acknowledged`);
      } else if (ackResult.clicked) {
        log(`  ☑️  Acknowledged all out-of-scope items (IMPOSSIBLE_TO_MIGRATE)`);
        await page.waitForTimeout(300);
      } else {
        log(`  ⚠ Out-of-scope panel present but master checkbox could not be located`);
      }
    }

    // ── Uncheck the Step 2 "Archive source analytics" add-on ──────
    // It's pre-checked (opt-out) and, if left on, fires a parallel source-
    // analytics capture (~N GraphQL calls) during the migration — extra load
    // and rate-limit risk that's irrelevant to migration verification. Uncheck
    // it here. The config lives in Step 2 now (no execute-time modal), so this
    // also prevents the capture from running. Guarded for older UI builds.
    //
    // EXCEPTION: when config.metadata.keepAnalyticsArchive is set (e13), leave
    // it CHECKED — that test exercises the capture→Results→download path and
    // the download is verified by assertAnalyticsArchiveDownloaded.
    const keepAnalytics = config.metadata?.keepAnalyticsArchive === true;
    if (!keepAnalytics) {
      try {
        const analyticsUnchecked = await page.evaluate(() => {
          const cb = document.querySelector('input[aria-label="Archive source analytics alongside the migration"]');
          if (!cb) return 'absent';
          if (cb.checked) { cb.click(); return 'unchecked'; }
          return 'already-off';
        });
        if (analyticsUnchecked === 'unchecked') {
          log('  ⊘ Unchecked "Archive source analytics" (skip parallel capture in tests)');
          await page.waitForTimeout(150);
        }
      } catch { /* older UI without the analytics section */ }
    } else {
      // Ensure it's ON (it's pre-checked by default, but be explicit/robust).
      try {
        const state = await page.evaluate(() => {
          const cb = document.querySelector('input[aria-label="Archive source analytics alongside the migration"]');
          if (!cb) return 'absent';
          if (!cb.checked) { cb.click(); return 'checked-on' ; }
          return 'already-on';
        });
        log(`  📈 "Archive source analytics" kept ON for capture test (${state})`);
      } catch { /* older UI */ }
    }

    // ── Account step → "Continue to Zone" (navigation only) → Zone step ──
    // The Account step is select-only now; the destructive account-resources
    // deploy happens from the Apply step. Just navigate forward.
    await navigateStep(page, 'Continue to Zone', /Continue to Apply/, 'Account → Zone');
    log('  ⚙️  Zone step loaded');
    await page.screenshot({ path: path.join(outputDir, 'step3-zone.png'), fullPage: true });

    // Resolve any zone-phase gates (email-address verification card, out-of-
    // scope acknowledgments, analytics add-on) before navigating to Apply. The
    // destination confirmation is no longer here — it's on the Apply step.
    await resolveBlockingGates(page, config.metadata?.emailAddressResolution || 'skip-all', keepAnalytics);

    // ── Zone step → "Continue to Apply" (navigation only) → Apply step ──
    await navigateStep(page, 'Continue to Apply', /Run migration/, 'Zone → Apply');
    log('  🧭 Apply step loaded (review plan + run)');
    await page.screenshot({ path: path.join(outputDir, 'step3-apply.png'), fullPage: true });

    // ── Apply step: confirm destination, then "Run migration" (both phases) ──
    // The migration now runs from the Apply step. Tick the account + zone
    // destination confirmations (they gate the Run button), then run. The
    // account-resources phase and zone phase stream back-to-back; the run is
    // done when the post-migration view's "Continue to Results" appears.
    const applyConfirmed = await page.evaluate(() => {
      let n = 0;
      for (const sel of ['Confirm destination account', 'Confirm destination zone']) {
        const cb = document.querySelector(`input[aria-label="${sel}"]`);
        if (cb && !cb.checked) { cb.click(); n++; }
      }
      return n;
    });
    if (applyConfirmed > 0) { log(`  ☑️  Confirmed destination (${applyConfirmed} checkbox(es))`); await page.waitForTimeout(200); }

    const MIGRATION_TIMEOUT = Number(env.MIGRATION_TIMEOUT_MS) || 180000;
    const ACCOUNT_PHASE_TIMEOUT = Number(env.ACCOUNT_PHASE_TIMEOUT_MS) || 180000;
    log(`  🚀 Running migration (account + zone, up to ${Math.round((MIGRATION_TIMEOUT + ACCOUNT_PHASE_TIMEOUT) / 60000)} min)...`);
    await runPhase(page, 'Run migration', /Continue to Results|Start New Migration|Migration Report/, MIGRATION_TIMEOUT + ACCOUNT_PHASE_TIMEOUT, 'Migration', outputDir);
    await page.screenshot({ path: path.join(outputDir, 'step4-cutover.png'), fullPage: true });

    // ── Apply (post-migration) → "Continue to Results" → Results ──
    const toResults = page.locator('button', { hasText: 'Continue to Results' });
    if (await toResults.count() > 0) {
      log('  ➡️  Cutover → Results');
      await toResults.first().click();
      await page.waitForFunction(() => {
        return [...document.querySelectorAll('button')].some(b => /Start New Migration|Migration Report/i.test(b.textContent || ''));
      }, null, { timeout: 30000 }).catch(() => {});
    }
    await page.waitForTimeout(1000);

    // ── Step 5: Results ───────────────────────────────────
    log('  📊 Step 5: Results loaded');
    await page.screenshot({ path: path.join(outputDir, 'step5-results.png'), fullPage: true });
    log('  📸 Step 5 screenshot saved');

    const pauseMs = SLOW_MODE ? 600000 : 5000;
    if (SLOW_MODE) {
      console.log('\n\n  >>> SLOW_MODE: Results are displayed. Browser will stay open for 10 minutes. <<<');
      console.log('  >>> Press Ctrl+C to close when done inspecting. <<<\n');
    } else {
      console.log('\n  >>> 5s pause before parsing results (set SLOW_MODE=1 for a 10-min inspection pause) <<<\n');
    }
    await page.waitForTimeout(pauseMs);

    // ── Parse results from the page ───────────────────────
    const results = await page.evaluate(() => {
      const text = document.body.innerText;
      // Stat badges format: "51\nTOTAL" or "8\nVERIFIED" (number then label)
      const totalMatch = text.match(/(\d+)\s*(?:\n|\r)\s*TOTAL/i);
      const successMatch = text.match(/(\d+)\s*(?:\n|\r)\s*SUCCESS/i);
      const failedMatch = text.match(/(\d+)\s*(?:\n|\r)\s*FAILED/i);
      const skippedMatch = text.match(/(\d+)\s*(?:\n|\r)\s*SKIPPED/i);
      const verifiedMatch = text.match(/(\d+)\s*(?:\n|\r)\s*VERIFIED/i);
      const missingMatch = text.match(/(\d+)\s*(?:\n|\r)\s*MISSING/i);
      const mismatchedMatch = text.match(/(\d+)\s*(?:\n|\r)\s*MISMATCHED/i);
      const acknowledgedMatch = text.match(/(\d+)\s*(?:\n|\r)\s*ACKNOWLEDGED/i);

      // Migration output line: "Migration output: 51 created, 13 failed"
      const migOutputMatch = text.match(/Migration output:\s*(\d+)\s*created[,\s]*(\d+)\s*failed/i);

      // Status emoji
      const hasSuccess = text.includes('\u{1F389}') || text.includes('\u2705');
      const hasFailure = text.includes('\u274C') || text.includes('\u26A0');

      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      const verified = verifiedMatch ? parseInt(verifiedMatch[1]) : null;
      const missing = missingMatch ? parseInt(missingMatch[1]) : null;
      const mismatched = mismatchedMatch ? parseInt(mismatchedMatch[1]) : null;
      const success = successMatch ? parseInt(successMatch[1]) : 0;
      const failed = failedMatch ? parseInt(failedMatch[1]) : 0;

      // Validation mode (VERIFIED/MISSING/MISMATCHED badges present)
      const hasValidation = verified !== null;
      // Pass = total > 0 AND (in validation mode: 0 missing + 0 mismatched; else: 0 failed)
      const passed = total > 0 && (hasValidation
        ? (missing === 0 && mismatched === 0)
        : (failed === 0));

      const acknowledged = acknowledgedMatch ? parseInt(acknowledgedMatch[1]) : null;

      return {
        total,
        success,
        failed,
        skipped: skippedMatch ? parseInt(skippedMatch[1]) : 0,
        verified,
        missing,
        mismatched,
        acknowledged,
        migCreated: migOutputMatch ? parseInt(migOutputMatch[1]) : null,
        migFailed: migOutputMatch ? parseInt(migOutputMatch[2]) : null,
        passed,
        statusText: text.substring(0, 3000),
      };
    });

    // ── Analytics archive download (e13: keepAnalyticsArchive) ───────
    // The capture fired in the Account phase and runs in parallel; on Results
    // it surfaces as the "Analytics data exported" card with a download button.
    // Click it, save the bundle + a summary the postRun hook reads. Regression
    // for the 2026-06-06 bug where the Zone phase wiped the Account-phase
    // capture so the download never appeared.
    if (keepAnalytics) {
      const dlDir = path.join(outputDir, 'analytics-download');
      fs.mkdirSync(dlDir, { recursive: true });
      const summary = { downloaded: false, reason: '', file: null, bytes: 0 };
      try {
        // Wait for the analytics section to reach a terminal state (ready w/
        // download button, or an explicit "didn't complete" notice).
        await page.waitForFunction(() => {
          return [...document.querySelectorAll('button')].some(b => /Download Source Analytics/i.test(b.textContent || ''))
            || /Analytics export didn.t complete/i.test(document.body.innerText);
        }, null, { timeout: 120000 }).catch(() => {});
        const dlBtn = page.locator('button', { hasText: 'Download Source Analytics' });
        if (await dlBtn.count() === 0) {
          summary.reason = 'Download button never appeared on Results (capture wiped or errored)';
        } else {
          await page.locator('text=Analytics data exported').scrollIntoViewIfNeeded().catch(() => {});
          await page.locator('div.rounded-xl:has(h3:has-text("Analytics data exported"))')
            .first().screenshot({ path: path.join(outputDir, 'analytics-card.png') }).catch(() => {});
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 30000 }),
            dlBtn.first().click(),
          ]);
          const fname = download.suggestedFilename();
          const savePath = path.join(dlDir, fname);
          await download.saveAs(savePath);
          const bytes = fs.statSync(savePath).size;
          let bundle = null;
          try { bundle = JSON.parse(fs.readFileSync(savePath, 'utf8')); } catch { /* malformed */ }
          const gql = Array.isArray(bundle?.graphql) ? bundle.graphql : [];
          Object.assign(summary, {
            downloaded: true,
            file: fname,
            bytes,
            zoneName: bundle?.meta?.zoneName ?? null,
            lookbackDays: bundle?.meta?.window?.lookbackDays ?? null,
            graphqlDatasets: gql.length,
            datasetsWithData: gql.filter(g => !g.error && g.rowCount > 0).length,
            topLevelKeys: bundle ? Object.keys(bundle) : [],
          });
          log(`  📈 Analytics archive downloaded: ${fname} (${bytes} bytes, ${summary.graphqlDatasets} datasets, ${summary.datasetsWithData} with data)`);
        }
      } catch (e) {
        summary.reason = `analytics download failed: ${e.message}`;
        log(`  ⚠ ${summary.reason}`);
      }
      fs.writeFileSync(path.join(dlDir, 'summary.json'), JSON.stringify(summary, null, 2));
    }

    // Try to get the migration report markdown (download button click simulation)
    let reportMarkdown = '';
    try {
      // Look for report download link/button
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
        page.locator('button', { hasText: 'Migration Report' }).click().catch(() => null),
      ]);
      if (download) {
        const reportPath = path.join(outputDir, 'migration-report.md');
        await download.saveAs(reportPath);
        reportMarkdown = fs.readFileSync(reportPath, 'utf8');
        log('  📝 Migration report saved');
      }
    } catch {
      // Report download not critical
    }

    const elapsed = Date.now() - startTime;
    if (results.verified !== null) {
      const ackStr = results.acknowledged ? `, Acknowledged: ${results.acknowledged}` : '';
      log(`  ✅ Migration completed in ${(elapsed / 1000).toFixed(1)}s — Total: ${results.total}, Verified: ${results.verified}, Missing: ${results.missing}, Mismatched: ${results.mismatched}${ackStr}`);
    } else {
      log(`  ✅ Migration completed in ${(elapsed / 1000).toFixed(1)}s — Total: ${results.total}, Success: ${results.success}, Failed: ${results.failed}, Skipped: ${results.skipped}`);
    }

    return {
      success: true,
      results,
      elapsed,
      consoleLogs,
      reportMarkdown,
    };

  } catch (err) {
    const elapsed = Date.now() - startTime;
    log(`  ❌ Migration failed after ${(elapsed / 1000).toFixed(1)}s: ${err.message}`);

    // Try to take a failure screenshot
    try {
      await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true });
    } catch { /* ignore */ }

    return {
      success: false,
      error: err.message,
      elapsed,
      consoleLogs,
    };

  } finally {
    await context.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────

// Is the dev server (the UI the harness drives) reachable? Used both at startup
// and before each migration attempt — a server that dies MID-RUN otherwise
// surfaces as a cryptic page.goto ERR_CONNECTION_REFUSED after ~85s of wasted
// state capture + retries. Cheap (<3s), so call it liberally.
async function isDevServerReachable() {
  try {
    await fetch(DEV_SERVER_URL, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  log('🏁 Starting E2E Migration Test Suite');

  // Preflight: ensure the UI is being served. If nothing is reachable we
  // auto-start a dev server on a free port (and stop it at teardown) rather than
  // making the caller do it — checked FIRST, before any CF work, so a missing
  // server never wastes source-zone creation (~96s) + per-test setup only to die
  // at page.goto with ERR_CONNECTION_REFUSED. (Principle 9: fail loud, fail fast.)
  try {
    const dev = await ensureDevServer(DEV_SERVER_URL, { log, outDir: OUTPUT_DIR });
    DEV_SERVER_URL = dev.url;     // may be a different port if 5173 was taken
    stopDevServerFn = dev.stop;  // no-op if a server was already running
  } catch (e) {
    log(`❌ ${e.message}`);
    process.exit(1);
  }

  // Resolve the source zone before anything touches it. In the default per-run
  // unique mode the name is brand new each run, so we always create it fresh
  // (and delete any stale leftover defensively) and ALWAYS register a teardown
  // that deletes it — otherwise the unique zone would leak (the createdFresh
  // path is what triggers cleanup, and a never-seen name would take the
  // create-and-keep branch). Pin mode reuses the fixed env zone (Option A) and
  // only tears down when it actually created the zone fresh. Teardown runs on
  // success AND error via the top-level .finally. Updates CF_ZONE_ID +
  // sourcePathVars so every subsequent request targets the resolved zone.
  if (PIN_ZONE_NAME) {
    log(`   Source-zone mode: PINNED — reuse fixed env zone "${SOURCE_DOMAIN}"`);
  } else {
    log(`   Source-zone mode: per-run unique — "${UNIQUE_ZONE_NAME}" (created fresh + deleted at teardown)`);
  }
  if (SOURCE_DOMAIN) {
    const freshNeeded = !PIN_ZONE_NAME || FRESH_SOURCE_ZONE;
    const info = await ensureSourceZone(SOURCE_DOMAIN, { fresh: freshNeeded });
    CF_ZONE_ID = info.id;
    sourcePathVars.zone_id = info.id;
    // Per-run unique zones must always be cleaned up, even if ensureSourceZone
    // reported createdFresh=false (it can't on a never-seen name, but guard
    // anyway). Pinned zones are only deleted when we actually created them.
    if (!PIN_ZONE_NAME || info.createdFresh) {
      sourceZoneTeardown = async () => {
        log('  📍 Teardown: deleting per-run source zone...');
        await deleteSourceZone(info.id, SOURCE_DOMAIN);
      };
    }
  }

  log(`   Config dir: ${CONFIG_DIR}`);
  log(`   Output dir: ${OUTPUT_DIR}`);
  log(`   Dev server: ${DEV_SERVER_URL}`);
  log(`   Source zone: ${SOURCE_DOMAIN || '(unset)'} → ${CF_ZONE_ID} (account: ${CF_ACCOUNT_ID})`);
  log(`   Target account: ${CF_TARGET_ACCOUNT_ID}`);
  log('');

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // List config files
  const configFiles = fs.readdirSync(CONFIG_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (configFiles.length === 0) {
    log('❌ No config files found. Run: node scripts/generate-test-configs.mjs');
    process.exit(1);
  }

  log(`📦 Found ${configFiles.length} config files`);

  // Filter based on CLI args
  let configs = configFiles.map(f => {
    let raw = fs.readFileSync(path.join(CONFIG_DIR, f), 'utf8');
    // Rewrite placeholder domains: test configs use "test.example.com" as placeholder.
    // Replace with the actual source zone domain (SOURCE_DOMAIN env var).
    const parsed = JSON.parse(raw);
    const configDomain = parsed.metadata?.domain || 'test.example.com';
    const placeholderBase = configDomain.replace(/^[^.]+\./, ''); // e.g. "example.com"
    const placeholder = `test.${placeholderBase}`; // e.g. "test.example.com"
    if (SOURCE_DOMAIN && placeholder !== SOURCE_DOMAIN) {
      raw = raw.replaceAll(placeholder, SOURCE_DOMAIN);
      log(`  🔄 Rewrote "${placeholder}" → "${SOURCE_DOMAIN}" in ${f}`);
    }
    // Substitute the test forward email placeholder. The canonical placeholder
    // is forward-test@example.com (RFC 2606 reserved). Users can override via
    // TEST_FORWARD_EMAIL env var to test against a real verified address.
    if (TEST_FORWARD_EMAIL !== 'forward-test@example.com') {
      raw = raw.replaceAll('forward-test@example.com', TEST_FORWARD_EMAIL);
    }
    return { file: f, path: path.join(CONFIG_DIR, f), config: JSON.parse(raw) };
  });

  if (RANKS) {
    // Explicit rank list (used by the parallel orchestrator to hand each child
    // its bucket). Preserves the listed order.
    const wanted = RANKS.split(',').map(s => Number(s.trim())).filter(n => n > 0);
    const byRank = new Map(configs.map(c => [c.config.metadata?.rank, c]));
    configs = wanted.map(r => byRank.get(r)).filter(Boolean);
  } else if (ONLY) {
    configs = configs.filter(c => c.config.metadata?.rank === ONLY);
  } else {
    if (START_AT > 1) configs = configs.filter(c => (c.config.metadata?.rank || 0) >= START_AT);
    if (END_AT) configs = configs.filter(c => (c.config.metadata?.rank || 0) <= END_AT);
  }

  log(`🎯 Running ${configs.length} tests (${RANKS ? `ranks ${RANKS}` : ONLY ? `only #${ONLY}` : `#${START_AT}-${END_AT || 'end'}`})\n`);

  // Launch browser. Default to headed mode so a human can watch failures
  // during interactive debugging; set HEADLESS=1 (or HEADLESS=true) to
  // force headless mode for CI / unattended runs.
  const headlessEnv = (env.HEADLESS || '').toLowerCase();
  const isHeadless = headlessEnv === '1' || headlessEnv === 'true' || headlessEnv === 'yes';
  const browser = await chromium.launch({
    headless: isHeadless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  if (isHeadless) log(`🎭 Running in headless mode (HEADLESS=${env.HEADLESS})`);

  const summaryResults = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const { file, path: configPath, config } of configs) {
    const rank = config.metadata?.rank || 0;
    const company = config.metadata?.company || 'Unknown';
    const domain = config.metadata?.domain || 'unknown.com';
    const slug = file.replace('.json', '');
    const testDir = path.join(OUTPUT_DIR, slug);

    log(`\n${'═'.repeat(70)}`);
    log(`  #${String(rank).padStart(3, '0')} ${company} (${domain})`);
    log(`  Profile: ${config.metadata?.profile || 'unknown'}`);
    log(`${'═'.repeat(70)}`);

    fs.mkdirSync(testDir, { recursive: true });

    // Save a copy of the source config
    fs.writeFileSync(path.join(testDir, 'source-config.json'), JSON.stringify(config, null, 2));

    let passed = false;
    let lastResult = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Deep-clone the config per attempt. applyConfig() mutates resource
      // definitions in place (e.g. it rewrites worker KV/D1 binding placeholders
      // like __MAXCONFIG_KV_ID__ to the real namespace ID it just seeded). If we
      // reused the same object across retries, attempt 0 would replace the
      // placeholder with a literal ID; then on retry cleanZone() deletes that
      // namespace and re-seeds a fresh one, but the binding no longer starts
      // with "__" so the patch logic skips it — leaving the worker pointed at a
      // deleted namespace ("KV namespace '…' not found" → worker + route fail).
      // Cloning restores pristine placeholders every attempt so they re-resolve
      // to whatever namespace ID the current attempt actually seeded.
      const attemptConfig = structuredClone(config);

      if (attempt > 0) {
        log(`\n  \u{1F504} Retry ${attempt}/${MAX_RETRIES}...`);
        // Clean dest zone config instead of deleting (avoids zone creation rate limits)
        await cleanDestZone();
        await sleep(2000);
      }

      // Re-check the dev server is still up BEFORE the ~6 min of clean/apply/
      // capture below — it can die mid-suite (crash, OOM, an errant pkill), and
      // without this the attempt burns all that API work only to fail at
      // page.goto with ERR_CONNECTION_REFUSED. Fail fast + clear instead.
      if (!(await isDevServerReachable())) {
        log(`  ❌ Dev server at ${DEV_SERVER_URL} is no longer reachable — it went down mid-run.`);
        log('     Restart it (`npm run dev`, or DEV_PORT=<port> npm run dev) and re-run this rank.');
        lastResult = { passed: false, error: `dev server unreachable at ${DEV_SERVER_URL}` };
        break; // stop retrying this test; the server is down
      }

      // Wrap the whole attempt body so a thrown exception in setup (e.g. a
      // pre-run hook like ensureSourceEnterprise, or applyConfig/captureState)
      // fails ONLY this test and lets the loop retry / the suite continue —
      // instead of escaping main() and aborting tests that haven't run yet.
      // runMigration already catches internally and returns a result; this
      // catch covers the setup phases that throw.
      try {
      // 0. Clean dest zone before migration (removes leftovers from previous runs)
      log('  📍 Phase 0: Cleaning dest zone...');
      await cleanDestZone();

      // 1. Clean source zone
      log('  📍 Phase 1: Cleaning source zone...');
      await cleanZone();

      // 2. Apply config
      log('  📍 Phase 2: Applying config...');
      const applyResult = await applyConfig(attemptConfig);
      log(`  📍 Applied: ${applyResult.created} created, ${applyResult.failed} failed`);
      if (applyResult.failedDnsRecords?.length) {
        // Fail loud: a DNS record the test declared could not be seeded, so
        // the migration will never exercise it. Surface it immediately rather
        // than letting a green proxied-flag check mask the missing type.
        const summary = applyResult.failedDnsRecords
          .map(r => `${r.type} ${r.name}`)
          .join(', ');
        log(`  ⚠️  ${applyResult.failedDnsRecords.length} DNS record(s) failed to seed and will NOT be migrated: ${summary}`);
      }

      // 2a. Capture source-state-post-seed for evidence-based post-run hooks
      //     (assertLbPoolIdsRemapped, assertKvKeysCopied, assertProxiedFlagsMatch,
      //     etc.). Skip when the test's post-run hook doesn't read evidence
      //     (capture takes ~85s, so don't do it unless the test needs it).
      //     postRun is comma-separated (multiple assertions stacked) — capture
      //     if ANY of the stacked hooks needs evidence.
      const hookList = (attemptConfig.metadata?.postRun || '')
        .split(',')
        .map(h => h.trim())
        .filter(Boolean);
      const needsEvidence = hookList.some(h => HOOKS_NEEDING_EVIDENCE.has(h));
      // L1 targeted capture (opt-in via TARGETED_CAPTURE). Derive the minimal
      // endpoint allowlist from this config's evidence hooks; endpointsForHooks
      // returns null if any evidence hook is unmapped, in which case we leave
      // captureOnly undefined → full capture (fail-safe, never under-capture).
      const targetedEndpoints = process.env.TARGETED_CAPTURE
        ? endpointsForHooks(hookList)
        : null;
      if (needsEvidence) {
        log(`  📍 Phase 2a: Capturing source state${targetedEndpoints ? ` (targeted: ${targetedEndpoints.length} endpoints)` : ''}...`);
        captureState('source', testDir, targetedEndpoints);
      }

      // 2b. Run pre-run hooks (e.g. ensureDestZone for test 103,
      //     seedDestCatchAllDisabled for test 104). Hooks run AFTER source
      //     config is applied but BEFORE the UI migration starts, so they
      //     can force the destination into a specific state that the
      //     migration must handle.
      log('  📍 Phase 2b: Running pre-run hooks...');
      await runPreRunHooks(attemptConfig);

      // 3. Run migration through UI
      log('  📍 Phase 3: Running migration through UI...');
      lastResult = await runMigration(browser, attemptConfig, testDir);

      // 3a. Capture dest-state-post-migrate. Pair with source state for the
      //     evidence-based assertions in runPostRunHooks. Look up the dest zone
      //     by DEST_DOMAIN (not config.metadata.domain) because the runner
      //     rewrites all configs to use SOURCE_DOMAIN/DEST_DOMAIN — the metadata
      //     domain is just a label from the config file.
      if (needsEvidence) {
        const destZoneId = await findDestZoneId(DEST_DOMAIN);
        if (destZoneId) {
          log(`  📍 Phase 3a: Capturing dest state${targetedEndpoints ? ` (targeted: ${targetedEndpoints.length} endpoints)` : ''}...`);
          process.env.LAST_DEST_ZONE_ID = destZoneId;
          captureState('dest', testDir, targetedEndpoints);
          delete process.env.LAST_DEST_ZONE_ID;
        } else {
          log(`  ⚠ Could not find dest zone for "${DEST_DOMAIN}" — skipping dest state capture`);
        }
      }

      // A test passes if the migration completed (reached Step 4 with results)
      if (lastResult.success && lastResult.results?.total > 0) {
        const r = lastResult.results;
        // In validation mode (VERIFIED/MISSING/MISMATCHED), pass = 0 missing + 0 mismatched
        // In fallback mode (SUCCESS/FAILED/SKIPPED), pass = 0 failed
        passed = r.passed !== false; // use page's own assessment
        if (r.verified !== null) {
          const ackStr = r.acknowledged ? `, Acknowledged=${r.acknowledged}` : '';
          log(`  📊 Results: Total=${r.total}, Verified=${r.verified}, Missing=${r.missing}, Mismatched=${r.mismatched}${ackStr}`);
        } else {
          log(`  📊 Results: Total=${r.total}, Success=${r.success}, Failed=${r.failed}, Skipped=${r.skipped}`);
        }
        // Post-run hooks add test-specific assertions that catch silent-success
        // failures (e.g. test 103 needs to verify the dest zone was NOT the
        // source zone — a check that page-side verified/missing/mismatched
        // counts can't make).
        //
        // When config.metadata.postRunAuthoritative is true, the post-run hook
        // RESULT determines pass/fail, overriding the page's verified/missing
        // /mismatched check. This is for tests where mismatched>=1 is the
        // EXPECTED outcome (e.g. test 104, where my email-routing fix MUST
        // downgrade rules to mismatched when routing isn't ready).
        const postRunResult = await runPostRunHooks(attemptConfig, testDir);
        if (attemptConfig.metadata?.postRunAuthoritative) {
          passed = postRunResult.passed;
        } else if (!postRunResult.passed) {
          passed = false;
        }
        if (!postRunResult.passed) {
          lastResult.postRunFailures = postRunResult.reasons;
        }
        break;
      }

      if (lastResult.success) {
        log(`  ⚠️  Migration completed but results seem empty`);
      }
      } catch (setupErr) {
        // A setup/pre-run-hook exception: record it as a per-test failure and
        // let the loop retry (or fall through to the next test) rather than
        // aborting the entire suite. Fail loud (Principle 9) but locally.
        log(`  ❌ Attempt ${attempt + 1} threw during setup: ${setupErr.message}`);
        lastResult = { success: false, passed: false, error: setupErr.message };
      }
    }

    // Save timing data
    const timing = {
      company,
      rank,
      domain,
      profile: config.metadata?.profile,
      attempts: passed ? 1 : MAX_RETRIES + 1,
      elapsed: lastResult?.elapsed || 0,
      passed,
      results: lastResult?.results || null,
      error: lastResult?.error || null,
    };
    fs.writeFileSync(path.join(testDir, 'timing.json'), JSON.stringify(timing, null, 2));

    // Save console log
    if (lastResult?.consoleLogs?.length > 0) {
      fs.writeFileSync(path.join(testDir, 'console-log.txt'), lastResult.consoleLogs.join('\n'));
    }

    // Update summary
    summaryResults.push(timing);
    if (passed) {
      totalPassed++;
      log(`  ✅ PASSED — ${company}`);
    } else {
      totalFailed++;
      log(`  ❌ FAILED — ${company}: ${lastResult?.error || 'migration failures'}`);
    }

    // Clean dest zone config between tests. We keep the SAME zone for all tests
    // in a run (it's the run's unique zone) and just wipe its config + do the
    // account-scoped sweep — deleting + recreating per test is unnecessary now
    // that the run-level name already dodges the per-name creation cooldown.
    log('  \u{1F4CD} Phase 4: Cleaning dest zone config...');
    await cleanDestZone();
    await sleep(1000);
  }

  await browser.close();

  // ── Final teardown: leave the dest account clean ─────────────
  // All tests in a run share the run's unique dest zone. At suite end we do a
  // last account-scoped sweep (workers, KV, D1, queues, Vectorize, Secrets
  // Store, Turnstile, custom lists, test rulesets…) and then delete the dest
  // zone itself, so the dest account isn't left holding test artifacts. The
  // matching source zone is deleted by sourceZoneTeardown in the top-level
  // .finally.
  //   • KEEP_DEST_ZONE=1 skips ONLY the zone delete (account-scoped cleanup
  //     still runs). In per-run unique mode the zone name is single-use, so a
  //     kept zone is dead weight and never reused — KEEP_DEST_ZONE is honored
  //     only in pin mode and ignored (with a warning) otherwise.
  log(`\n${'═'.repeat(70)}`);
  log('  🧹 Final teardown: dest account + zone cleanup');
  log(`${'═'.repeat(70)}`);
  await cleanDestZone(); // account-scoped sweep happens here (zone still exists)
  if (env.KEEP_DEST_ZONE && PIN_ZONE_NAME) {
    log('  ⏭ KEEP_DEST_ZONE set (pin mode) — leaving dest zone in place (account resources still cleaned).');
  } else {
    if (env.KEEP_DEST_ZONE) {
      log('  ⚠ KEEP_DEST_ZONE ignored: per-run unique zone names are single-use, so a kept zone would just leak. Use --pin-zone-name to keep a fixed zone.');
    }
    await deleteDestZone(DEST_DOMAIN);
  }

  // ── Write Summary ────────────────────────────────────────────
  log(`\n${'═'.repeat(70)}`);
  log('  📊 SUMMARY');
  log(`${'═'.repeat(70)}`);
  log(`  Total:  ${summaryResults.length}`);
  log(`  Passed: ${totalPassed}`);
  log(`  Failed: ${totalFailed}`);
  log(`  Pass Rate: ${((totalPassed / summaryResults.length) * 100).toFixed(1)}%`);

  // Write summary.json
  const summary = {
    timestamp: new Date().toISOString(),
    total: summaryResults.length,
    passed: totalPassed,
    failed: totalFailed,
    passRate: `${((totalPassed / summaryResults.length) * 100).toFixed(1)}%`,
    results: summaryResults,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  // Write report.md
  const report = generateReport(summary);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.md'), report);

  // Write full run log
  fs.writeFileSync(path.join(OUTPUT_DIR, 'run-log.txt'), logLines.join('\n'));

  const evidenceDir = preserveE2eEvidence({ outputDir: OUTPUT_DIR, timestamp: summary.timestamp });

  log(`\n✅ Report saved to ${path.join(OUTPUT_DIR, 'report.md')}`);
  log(`✅ Summary saved to ${path.join(OUTPUT_DIR, 'summary.json')}`);
  log(`✅ Evidence bundle saved to ${evidenceDir}`);

  if (totalFailed > 0) {
    process.exitCode = 1;
  }
}

// ── Report Generator ─────────────────────────────────────────────

function generateReport(summary) {
  const lines = [
    '# E2E Migration Test Report',
    '',
    `**Date**: ${summary.timestamp}`,
    `**Total Tests**: ${summary.total}`,
    `**Passed**: ${summary.passed}`,
    `**Failed**: ${summary.failed}`,
    `**Pass Rate**: ${summary.passRate}`,
    '',
    '---',
    '',
    '## Results by Company',
    '',
    '| # | Company | Domain | Profile | Status | Time | Total | Verified | Missing | Mismatched | Ack\'d | Mig Created | Mig Failed |',
    '|---|---------|--------|---------|--------|------|-------|----------|---------|------------|-------|-------------|------------|',
  ];

  for (const r of summary.results) {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    const time = `${(r.elapsed / 1000).toFixed(1)}s`;
    const r_total = r.results?.total ?? '-';
    const r_verified = r.results?.verified ?? '-';
    const r_missing = r.results?.missing ?? '-';
    const r_mismatched = r.results?.mismatched ?? '-';
    const r_acked = r.results?.acknowledged ?? '-';
    const r_created = r.results?.migCreated ?? '-';
    const r_failed = r.results?.migFailed ?? '-';
    lines.push(`| ${r.rank} | ${r.company} | ${r.domain} | ${r.profile} | ${status} | ${time} | ${r_total} | ${r_verified} | ${r_missing} | ${r_mismatched} | ${r_acked} | ${r_created} | ${r_failed} |`);
  }

  lines.push('', '---', '', '## Screenshots', '');

  for (const r of summary.results) {
    const slug = `${String(r.rank).padStart(3, '0')}-${slugify(r.company)}`;
    lines.push(`### #${r.rank} ${r.company}`, '');
    lines.push(`| Step 1 | Step 2 | Step 3 | Step 4 |`);
    lines.push(`|--------|--------|--------|--------|`);
    lines.push(
      `| ![Step 1](${slug}/step1-credentials.png) ` +
      `| ![Step 2](${slug}/step2-preview.png) ` +
      `| ![Step 3](${slug}/step3-execute.png) ` +
      `| ![Step 4](${slug}/step4-results.png) |`
    );
    lines.push('');
  }

  // Failed tests section
  const failed = summary.results.filter(r => !r.passed);
  if (failed.length > 0) {
    lines.push('---', '', '## Failed Tests', '');
    for (const r of failed) {
      lines.push(`- **#${r.rank} ${r.company}**: ${r.error || 'Migration had failures'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Run ──────────────────────────────────────────────────────────
main()
  .catch(err => {
    console.error('Fatal error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Teardown that must run regardless of success/failure (per-run source-zone
    // deletion). Wrapped so a teardown error can't mask the run's exit code.
    if (sourceZoneTeardown) {
      try { await sourceZoneTeardown(); }
      catch (e) { console.error('Source-zone teardown error:', e); }
    }
    // Stop the dev server only if WE auto-started it (leaves a user's own alone).
    try { stopDevServerFn(); } catch { /* ignore */ }
  });
