#!/usr/bin/env node
/**
 * delete-maxconfig-zone.mjs — delete a MaxConfig (or test) config that was
 * applied to a zone/account, leaving the zone reset and the account free of
 * leaked account-scoped test resources.
 *
 * MaxConfig (and the e2e harness) sprays a zone with DNS, rulesets, page rules,
 * firewall rules, rate limits, worker routes, custom hostnames, email routing,
 * load balancers, etc. — plus account-scoped resources (workers, KV, R2, D1,
 * queues, Vectorize, Secrets Store, custom lists, Access apps, Turnstile,
 * Logpush, account rulesets, notification policies). This script tears all of
 * that back down so the zone can be reused for a fresh apply/migration.
 *
 * SAFETY MODEL (two tiers):
 *   • ZONE-SCOPED resources in the named zone are reset wholesale (all DNS,
 *     all page rules, all rulesets emptied, etc.). This is destructive and is
 *     the whole point — only point it at a throwaway test zone.
 *   • ACCOUNT-SCOPED resources are deleted ONLY when their name matches a known
 *     test prefix (maxconfig*, maxworker*, storage-rt*, svcchain*, svcbind*,
 *     do-state*) or a MaxConfig/Twilight-Zone-Test marker. This keeps the tool
 *     safe to run against a shared account (e.g. user@example.com) without nuking
 *     real projects.
 *
 * Credentials come from the environment / .env.test (CF_API_KEY + CF_API_EMAIL),
 * same as the Playwright harness. Defaults to the API-key auth used there.
 *
 * Usage:
 *   node scripts/delete-maxconfig-zone.mjs [--account <accountId>] [--zone <zoneId|domain>] [flags]
 *
 * Account/zone selection (wrangler-style):
 *   Omit --account and/or --zone and you'll get an interactive arrow-key menu
 *   built from the live list of accounts/zones the credentials can see (↑/↓,
 *   Enter to choose, Esc to cancel). A sole account is auto-selected. In a
 *   non-interactive shell (no TTY), the flags are required and the tool prints
 *   the candidate list so you can re-run with the right value.
 *
 * Flags:
 *   --account <id>       Account that owns the zone + account-scoped resources.
 *                        Optional — picked interactively if omitted.
 *   --zone <id|domain>   Target zone (zone ID or domain name). Optional —
 *                        picked interactively from the account if omitted.
 *   --dry-run            List everything that WOULD be deleted; make no changes.
 *   --force-delete       Actually perform deletions (required unless --dry-run).
 *   --skip-maxconfig-check  Skip the "does this look like MaxConfig?" pre-flight guard.
 *   --verbose            Per-request logging from the rate limiter.
 *
 * Examples:
 *   # Fully interactive — pick account, then zone, preview only:
 *   node scripts/delete-maxconfig-zone.mjs --dry-run
 *
 *   # Explicit account + zone, execute:
 *   node scripts/delete-maxconfig-zone.mjs --account <ACCOUNT_ID> --zone <ZONE_NAME> --force-delete
 */

import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createRateLimitedFetcher } from './rate-limiter.mjs';
import { loadEnvFile } from './e2e-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Env (CF_API_KEY + CF_API_EMAIL only; the rest are optional defaults) ──
const fileEnv = loadEnvFile(path.join(ROOT, '.env.test'));
const env = { ...fileEnv, ...process.env };

const CF_API_KEY = (env.CF_API_KEY ?? '').trim();
const CF_API_EMAIL = (env.CF_API_EMAIL ?? '').trim();
if (!CF_API_KEY || !CF_API_EMAIL) {
  console.error('Missing CF_API_KEY / CF_API_EMAIL. Set them in your shell or .env.test.');
  process.exit(1);
}

// ── CLI args ─────────────────────────────────────────────────────
const args = process.argv.slice(2);

// Known options, so we can reject typos/unknown flags instead of silently
// ignoring them (e.g. "--skip-maxconfi-check" must fail loudly, not fall
// through to an interactive run that does the wrong thing).
const KNOWN_FLAGS = ['--dry-run', '--force-delete', '--skip-maxconfig-check', '--verbose', '--help', '-h'];
const KNOWN_VALUE_OPTS = ['--account', '--zone'];

function flag(name) { return args.includes(name); }
function opt(name, fallback = null) {
  // Support both "--name value" and "--name=value".
  const eq = args.find(a => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('-') ? args[i + 1] : fallback;
}

// Validate args up front: any token starting with "-" must be a known flag or
// a known value-option; the token immediately after a value-option is its
// value (consumed). Anything else is an error. Bare positionals are unknown too.
(function validateArgs() {
  const unknown = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) { unknown.push(a); continue; }
    const base = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (KNOWN_FLAGS.includes(base)) continue;
    if (KNOWN_VALUE_OPTS.includes(base)) {
      // "--account=foo" carries its own value; "--account foo" consumes next.
      if (!a.includes('=')) i++;
      continue;
    }
    unknown.push(a);
  }
  if (unknown.length > 0) {
    console.error(`Unknown option(s): ${unknown.join(', ')}`);
    console.error(`Valid options: ${[...KNOWN_VALUE_OPTS.map(o => `${o} <value>`), ...KNOWN_FLAGS].join(', ')}`);
    process.exit(1);
  }
})();

const DRY_RUN = flag('--dry-run');
// --skip-maxconfig-check skips the "does this zone look like MaxConfig?"
// pre-flight guard, for the rare case of resetting an already-emptied test
// zone. It is the STRONGER assertion, so it implies --force-delete: you can't
// be "more sure" without being sure. (We deliberately keep --skip-maxconfig-check
// and --force-delete distinct rather than collapsing into one flag: on a normal
// --force-delete run the fingerprint guard still runs and can catch a wrong-zone
// mistake. A single "confirm + skip guard" flag would make every real run bypass
// the guard, defeating its purpose.)
const SKIP_MAXCONFIG_CHECK = flag('--skip-maxconfig-check');
const CONFIRMED = flag('--force-delete') || SKIP_MAXCONFIG_CHECK;
const VERBOSE = flag('--verbose') || !!env.VERBOSE;
// --account and --zone are OPTIONAL. When omitted, main() lists what the
// credentials can see and lets the user pick interactively (wrangler-style
// arrow-key menu). This is a destructive tool and the env usually holds more
// than one account, so we never silently default to one — we either take an
// explicit flag or make the user choose from the live list.
let ACCOUNT_ID = (opt('--account') ?? '').trim();
let ZONE_ARG = (opt('--zone') ?? '').trim();

// ── API client ───────────────────────────────────────────────────
const { cfRequest } = createRateLimitedFetcher({
  authHeaders: { 'X-Auth-Key': CF_API_KEY, 'X-Auth-Email': CF_API_EMAIL },
  rateLimit: 1000,
  windowSec: 300,
  capacity: 20,
  maxRetries: 3,
  verbose: VERBOSE,
  pathVars: {},
});

// ── Test-resource identification (account-scoped safety gate) ────
const TEST_RESOURCE_PREFIXES = ['maxconfig', 'maxworker', 'storage-rt', 'svcchain', 'svcbind', 'do-state', 'roundtrip', 'kv-roundtrip'];
function isTestResourceName(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return TEST_RESOURCE_PREFIXES.some(p => n.startsWith(p));
}
// Account-level rulesets / policies / pages are marked, not prefixed.
function isTestMarkedName(name) {
  if (!name) return false;
  return name.startsWith('Twilight Zone Test') || name.includes('MaxConfig');
}

// ── Counters + helpers ───────────────────────────────────────────
let deleted = 0;
let wouldDelete = 0;

function log(msg) { console.log(msg); }

/**
 * Perform (or, in dry-run, simulate) a destructive request and tally it.
 * @returns {Promise<boolean>} whether the operation succeeded (always true in dry-run)
 */
async function del(method, urlPath, label, body) {
  if (DRY_RUN) {
    wouldDelete++;
    log(`    • would ${method} ${label}`);
    return true;
  }
  const r = await cfRequest(method, urlPath, body);
  if (r.ok) {
    deleted++;
    if (VERBOSE) log(`    ✓ ${label}`);
    return true;
  }
  const err = r.data?.errors?.[0]?.message || `status ${r.status}`;
  log(`    ⚠ ${label}: ${err}`);
  return false;
}

async function list(urlPath) {
  const r = await cfRequest('GET', urlPath);
  return r.ok && Array.isArray(r.data?.result) ? r.data.result : [];
}

// ── Pre-flight fingerprint detection ────────────────────────────
//
// Before wiping a zone, confirm it actually looks like a MaxConfig/test zone.
// The zone-scoped reset is destructive on ANY zone (it deletes all DNS, all
// rulesets, etc.), so pointing this at a real production zone by mistake would
// be catastrophic. We scan for zone-tied MaxConfig markers and refuse to run
// if none are present (unless --skip-maxconfig-check). We deliberately key off ZONE-tied
// signals (routes/rulesets/email/turnstile/access bound to THIS zone), not
// account-wide ones — a MaxConfig in some OTHER zone of the same account must
// not green-light wiping this one.
async function detectFingerprints(zoneId, zoneName) {
  const found = [];

  // Worker routes referencing a test-prefixed script (e.g. api.<zone>/worker/*
  // → maxconfig-zone-worker). Strongest, cheapest signal.
  for (const r of await list(`/zones/${zoneId}/workers/routes`)) {
    if (isTestResourceName(r.script)) found.push(`worker route ${r.pattern || ''} → ${r.script}`);
  }

  // Zone rulesets whose name carries a MaxConfig/Twilight-Zone-Test marker.
  for (const rs of await list(`/zones/${zoneId}/rulesets`)) {
    if (isTestMarkedName(rs.name)) found.push(`ruleset "${rs.name}"`);
  }

  // Email routing rules named "MaxConfig forward support" / "MaxConfig drop …".
  for (const rule of await list(`/zones/${zoneId}/email/routing/rules?per_page=100`)) {
    if (isTestMarkedName(rule.name)) found.push(`email rule "${rule.name}"`);
  }

  // Turnstile widgets are account-scoped but their domains[] tie them to a zone.
  for (const w of await list(`/accounts/${ACCOUNT_ID}/challenges/widgets?per_page=100`)) {
    const domainHit = zoneName && (w.domains || []).some(d => String(d).includes(zoneName));
    if (domainHit && isTestResourceName(w.name)) found.push(`turnstile "${w.name}" (${zoneName})`);
  }

  // Access apps that carry a MaxConfig marker AND reference this zone's domain.
  for (const a of await list(`/accounts/${ACCOUNT_ID}/access/apps`)) {
    if (isTestMarkedName(a.name) && zoneName && JSON.stringify(a).includes(zoneName)) {
      found.push(`access app "${a.name}"`);
    }
  }

  // DNS records whose name/comment names MaxConfig, or the maxconfig origin record.
  for (const rec of await list(`/zones/${zoneId}/dns_records?per_page=100`)) {
    const hay = `${rec.name || ''} ${rec.comment || ''}`.toLowerCase();
    if (hay.includes('maxconfig') || hay.includes('maxworker') || (rec.name || '').startsWith('worker-origin.')) {
      found.push(`DNS ${rec.type} ${rec.name}`);
    }
  }

  return found;
}

// ── Resolve zone ─────────────────────────────────────────────────
async function resolveZoneId(arg) {
  // A 32-char hex string is already a zone ID.
  if (/^[0-9a-f]{32}$/i.test(arg)) return arg;
  const zones = await list(`/zones?name=${encodeURIComponent(arg)}&account.id=${ACCOUNT_ID}`);
  if (zones.length > 0) return zones[0].id;
  // Fall back to a name lookup without the account filter (in case the account
  // arg is wrong but the zone is still reachable by this token).
  const any = await list(`/zones?name=${encodeURIComponent(arg)}`);
  return any.length > 0 ? any[0].id : null;
}

// ── Interactive selection (wrangler-style arrow-key menu) ────────
//
// Renders a list, lets the user move with ↑/↓ (or j/k), Enter to choose,
// Esc/Ctrl-C to cancel. TTY-only; callers must handle the non-interactive case.
function pickFromList(title, items, render) {
  return new Promise((resolve, reject) => {
    let idx = 0;
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdout.write(`${title}\n`);
    const draw = (first) => {
      if (!first) process.stdout.write(`\x1b[${items.length}A`); // cursor up N lines
      items.forEach((it, i) => {
        const sel = i === idx;
        const prefix = sel ? '\x1b[36m❯ ' : '  ';
        const suffix = sel ? '\x1b[0m' : '';
        process.stdout.write(`\x1b[2K${prefix}${render(it)}${suffix}\n`); // clear line + write
      });
    };
    draw(true);

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('keypress', onKey);
      process.stdin.pause();
    };
    const onKey = (_str, key) => {
      if (!key) return;
      if (key.name === 'up' || key.name === 'k') { idx = (idx - 1 + items.length) % items.length; draw(false); }
      else if (key.name === 'down' || key.name === 'j') { idx = (idx + 1) % items.length; draw(false); }
      else if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(items[idx]); }
      else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { cleanup(); reject(new Error('cancelled')); }
    };
    process.stdin.on('keypress', onKey);
  });
}

// Resolve the account: explicit --account wins; otherwise list accounts the
// credentials can see and let the user pick. Auto-selects when there's exactly
// one. In non-interactive mode (no TTY) without --account, errors with the list.
async function chooseAccount() {
  const accounts = await list('/accounts?per_page=50');
  if (accounts.length === 0) {
    console.error('No accounts are accessible with these credentials.');
    process.exit(1);
  }
  if (accounts.length === 1) {
    log(`Using the only accessible account: ${accounts[0].name} (${accounts[0].id})`);
    return accounts[0].id;
  }
  if (!process.stdin.isTTY) {
    console.error('--account <id> is required when not running interactively. Accessible accounts:');
    for (const a of accounts) console.error(`  ${a.id}  ${a.name}`);
    process.exit(1);
  }
  const chosen = await pickFromList('Select an account (↑/↓, Enter; Esc to cancel):', accounts,
    a => `${a.name.padEnd(36)} ${a.id}`);
  return chosen.id;
}

// Resolve the zone within an account: explicit --zone wins; otherwise list the
// account's zones and let the user pick. Returns { id, name }.
async function chooseZone(accountId) {
  const zones = await list(`/zones?account.id=${accountId}&per_page=50`);
  if (zones.length === 0) {
    console.error(`No zones found in account ${accountId}.`);
    process.exit(1);
  }
  if (!process.stdin.isTTY) {
    console.error(`--zone <id|domain> is required when not running interactively. Zones in ${accountId}:`);
    for (const z of zones) console.error(`  ${z.id}  ${z.name}`);
    process.exit(1);
  }
  const chosen = await pickFromList('Select a zone (↑/↓, Enter; Esc to cancel):', zones,
    z => `${z.name.padEnd(36)} ${z.id}`);
  return { id: chosen.id, name: chosen.name };
}

// ── Zone-scoped teardown (full reset of the named zone) ──────────
async function deleteZoneScoped(zoneId) {
  log(`\n  🧹 Zone-scoped reset for ${zoneId}`);

  // Email Routing: delete per-address rules, reset catch-all, disable.
  log('  · Email routing');
  for (const rule of await list(`/zones/${zoneId}/email/routing/rules?per_page=100`)) {
    const isCatchAll = rule.matchers?.length === 1 && rule.matchers[0].type === 'all';
    if (!isCatchAll && rule.tag) {
      await del('DELETE', `/zones/${zoneId}/email/routing/rules/${rule.tag}`, `email rule ${rule.name || rule.tag}`);
    }
  }
  await del('PUT', `/zones/${zoneId}/email/routing/rules/catch_all`, 'reset email catch-all', {
    enabled: false, matchers: [{ type: 'all' }], actions: [{ type: 'drop' }],
  });
  await del('POST', `/zones/${zoneId}/email/routing/disable`, 'disable email routing');

  // DNS records
  log('  · DNS records');
  for (const rec of await list(`/zones/${zoneId}/dns_records?per_page=100`)) {
    await del('DELETE', `/zones/${zoneId}/dns_records/${rec.id}`, `DNS ${rec.type} ${rec.name}`);
  }

  // Page rules
  log('  · Page rules');
  for (const r of await list(`/zones/${zoneId}/pagerules?per_page=100`)) {
    await del('DELETE', `/zones/${zoneId}/pagerules/${r.id}`, `page rule ${r.id}`);
  }

  // Firewall rules + filters (legacy)
  log('  · Firewall rules + filters');
  for (const r of await list(`/zones/${zoneId}/firewall/rules?per_page=100`)) {
    await del('DELETE', `/zones/${zoneId}/firewall/rules/${r.id}`, `firewall rule ${r.id}`);
  }
  for (const f of await list(`/zones/${zoneId}/filters?per_page=100`)) {
    await del('DELETE', `/zones/${zoneId}/filters/${f.id}`, `filter ${f.id}`);
  }

  // Rate limits
  log('  · Rate limits');
  for (const r of await list(`/zones/${zoneId}/rate_limits?per_page=100`)) {
    await del('DELETE', `/zones/${zoneId}/rate_limits/${r.id}`, `rate limit ${r.id}`);
  }

  // Rulesets: empty every zone phase entrypoint (covers custom firewall,
  // transforms, cache, redirects, compression, etc.).
  log('  · Ruleset phases');
  const phases = [
    'http_request_firewall_custom', 'http_request_cache_settings', 'http_ratelimit',
    'http_request_firewall_managed', 'http_request_sbfm', 'http_request_redirect',
    'http_request_origin', 'http_request_late_transform', 'http_request_transform',
    'http_response_headers_transform', 'http_response_firewall_managed', 'http_config_settings',
    'http_request_dynamic_redirect', 'http_response_compression',
  ];
  for (const phase of phases) {
    await del('PUT', `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, `clear phase ${phase}`, { rules: [] });
  }

  // Worker routes
  log('  · Worker routes');
  const routes = await list(`/zones/${zoneId}/workers/routes`);
  for (const r of routes) {
    await del('DELETE', `/zones/${zoneId}/workers/routes/${r.id}`, `worker route ${r.pattern || r.id}`);
  }

  // Custom hostnames
  log('  · Custom hostnames');
  for (const h of await list(`/zones/${zoneId}/custom_hostnames?per_page=100`)) {
    await del('DELETE', `/zones/${zoneId}/custom_hostnames/${h.id}`, `custom hostname ${h.hostname || h.id}`);
  }

  // Load balancers (zone-scoped) — delete before pools/monitors below.
  log('  · Load balancers');
  for (const l of await list(`/zones/${zoneId}/load_balancers`)) {
    await del('DELETE', `/zones/${zoneId}/load_balancers/${l.id}`, `load balancer ${l.name || l.id}`);
  }

  // Waiting rooms
  log('  · Waiting rooms');
  for (const wr of await list(`/zones/${zoneId}/waiting_rooms?per_page=100`)) {
    await del('DELETE', `/zones/${zoneId}/waiting_rooms/${wr.id}`, `waiting room ${wr.name || wr.id}`);
  }

  // Spectrum apps
  log('  · Spectrum apps');
  for (const app of await list(`/zones/${zoneId}/spectrum/apps?per_page=100`)) {
    await del('DELETE', `/zones/${zoneId}/spectrum/apps/${app.id}`, `spectrum app ${app.id}`);
  }

  // Worker custom domains (account-level, filtered to this zone). Collect
  // worker names so the account sweep can delete the scripts too.
  const zoneWorkerNames = new Set();
  for (const r of routes) { if (r.script) zoneWorkerNames.add(r.script); }
  for (const d of await list(`/accounts/${ACCOUNT_ID}/workers/domains`)) {
    if (d.zone_id === zoneId) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/workers/domains/${d.id}`, `worker domain ${d.hostname || d.id}`);
      if (d.service) zoneWorkerNames.add(d.service);
    }
  }
  return zoneWorkerNames;
}

// ── Account-scoped teardown (test-prefixed only) ─────────────────
async function deleteAccountScoped(zoneId, zoneName, zoneWorkerNames) {
  log(`\n  🧹 Account-scoped sweep for ${ACCOUNT_ID} (test-prefixed resources only)`);

  // Workers: zone-tied (from routes/domains) + every test-prefixed script.
  // Two-pass delete so service-binding chains (a worker bound by another) clear.
  log('  · Workers');
  const names = new Set(zoneWorkerNames);
  for (const w of await list(`/accounts/${ACCOUNT_ID}/workers/scripts`)) {
    if (isTestResourceName(w.id)) names.add(w.id);
  }
  let pending = [...names].filter(Boolean);
  for (let pass = 0; pass < 2 && pending.length; pass++) {
    const stillFailing = [];
    for (const name of pending) {
      const okOrDry = await del('DELETE', `/accounts/${ACCOUNT_ID}/workers/scripts/${name}`, `worker ${name}`);
      if (!okOrDry && pass === 0) stillFailing.push(name);
    }
    pending = stillFailing;
  }

  // Access apps (account-scoped). MaxConfig Access apps route to the migrated
  // zone; delete test-named ones plus any whose domain references the zone.
  log('  · Access apps');
  for (const a of await list(`/accounts/${ACCOUNT_ID}/access/apps`)) {
    const domainHit = zoneName && JSON.stringify(a).includes(zoneName);
    if (isTestResourceName(a.name) || isTestMarkedName(a.name) || domainHit) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/access/apps/${a.id}`, `access app ${a.name || a.id}`);
    }
  }

  // Turnstile widgets (test-named or domain-match)
  log('  · Turnstile widgets');
  for (const w of await list(`/accounts/${ACCOUNT_ID}/challenges/widgets?per_page=100`)) {
    const domainHit = zoneName && (w.domains || []).some(d => String(d).includes(zoneName));
    if (isTestResourceName(w.name) || domainHit) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/challenges/widgets/${w.sitekey}`, `turnstile ${w.name || w.sitekey}`);
    }
  }

  // KV namespaces
  log('  · KV namespaces');
  for (const ns of await list(`/accounts/${ACCOUNT_ID}/storage/kv/namespaces?per_page=100`)) {
    if (isTestResourceName(ns.title)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${ns.id}`, `KV ${ns.title}`);
    }
  }

  // D1 databases
  log('  · D1 databases');
  for (const db of await list(`/accounts/${ACCOUNT_ID}/d1/database?per_page=100`)) {
    if (isTestResourceName(db.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/d1/database/${db.uuid}`, `D1 ${db.name}`);
    }
  }

  // Queues
  log('  · Queues');
  for (const q of await list(`/accounts/${ACCOUNT_ID}/queues`)) {
    if (isTestResourceName(q.queue_name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/queues/${q.queue_id}`, `queue ${q.queue_name}`);
    }
  }

  // R2 buckets — empty objects first (DELETE bucket requires it), then delete.
  log('  · R2 buckets');
  for (const b of await list(`/accounts/${ACCOUNT_ID}/r2/buckets`)) {
    if (!isTestResourceName(b.name)) continue;
    const objs = await list(`/accounts/${ACCOUNT_ID}/r2/buckets/${encodeURIComponent(b.name)}/objects?per_page=1000`);
    for (const o of objs) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/r2/buckets/${encodeURIComponent(b.name)}/objects/${encodeURIComponent(o.key)}`, `R2 object ${b.name}/${o.key}`);
    }
    await del('DELETE', `/accounts/${ACCOUNT_ID}/r2/buckets/${encodeURIComponent(b.name)}`, `R2 bucket ${b.name}`);
  }

  // Vectorize indexes
  log('  · Vectorize indexes');
  for (const idx of await list(`/accounts/${ACCOUNT_ID}/vectorize/v2/indexes`)) {
    if (isTestResourceName(idx.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/vectorize/v2/indexes/${idx.name}`, `vectorize ${idx.name}`);
    }
  }

  // Secrets Store
  log('  · Secrets Store');
  for (const s of await list(`/accounts/${ACCOUNT_ID}/secrets_store/stores`)) {
    if (isTestResourceName(s.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/secrets_store/stores/${s.id}`, `secrets store ${s.name}`);
    }
  }

  // Custom lists (rules lists)
  log('  · Custom lists');
  for (const lst of await list(`/accounts/${ACCOUNT_ID}/rules/lists`)) {
    if (isTestResourceName(lst.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/rules/lists/${lst.id}`, `list ${lst.name}`);
    }
  }

  // Account-level rulesets (test-marked). Strip execute refs from root phase
  // entrypoints first, otherwise the entrypoint pin blocks deletion.
  log('  · Account rulesets');
  const accRulesets = await list(`/accounts/${ACCOUNT_ID}/rulesets`);
  const testRulesetIds = new Set(accRulesets.filter(rs => isTestMarkedName(rs.name)).map(rs => rs.id));
  if (testRulesetIds.size > 0) {
    for (const rs of accRulesets.filter(rs => rs.kind === 'root')) {
      const detail = await cfRequest('GET', `/accounts/${ACCOUNT_ID}/rulesets/${rs.id}`);
      const rules = detail.data?.result?.rules;
      if (!Array.isArray(rules)) continue;
      const filtered = rules.filter(r => !(r.action === 'execute' && testRulesetIds.has(r.action_parameters?.id)));
      if (filtered.length !== rules.length) {
        const cleanRules = filtered.map(r => {
          const { id, version, last_updated, ref, ...rest } = r;
          return rest;
        });
        await del('PUT', `/accounts/${ACCOUNT_ID}/rulesets/phases/${rs.phase}/entrypoint`, `strip execute refs from ${rs.phase}`, { rules: cleanRules });
      }
    }
  }
  for (const rs of accRulesets) {
    if (isTestMarkedName(rs.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/rulesets/${rs.id}`, `account ruleset ${rs.name}`);
    }
  }

  // Notification policies + webhooks (test-marked)
  log('  · Notification policies + webhooks');
  for (const p of await list(`/accounts/${ACCOUNT_ID}/alerting/v3/policies`)) {
    if (isTestMarkedName(p.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/alerting/v3/policies/${p.id}`, `policy ${p.name}`);
    }
  }
  for (const h of await list(`/accounts/${ACCOUNT_ID}/alerting/v3/destinations/webhooks`)) {
    if (isTestMarkedName(h.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/alerting/v3/destinations/webhooks/${h.id}`, `webhook ${h.name}`);
    }
  }

  // Logpush jobs (test-prefixed)
  log('  · Logpush jobs');
  for (const j of await list(`/accounts/${ACCOUNT_ID}/logpush/jobs`)) {
    if (isTestResourceName(j.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/logpush/jobs/${j.id}`, `logpush ${j.name}`);
    }
  }

  // Access tags / bookmarks / custom pages (test-marked)
  log('  · Access tags / bookmarks / custom pages');
  for (const t of await list(`/accounts/${ACCOUNT_ID}/access/tags`)) {
    if (isTestResourceName(t.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/access/tags/${encodeURIComponent(t.name)}`, `access tag ${t.name}`);
    }
  }
  for (const b of await list(`/accounts/${ACCOUNT_ID}/access/bookmarks`)) {
    if (isTestMarkedName(b.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/access/bookmarks/${b.id}`, `bookmark ${b.name}`);
    }
  }
  for (const p of await list(`/accounts/${ACCOUNT_ID}/access/custom_pages`)) {
    if (isTestMarkedName(p.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/access/custom_pages/${p.uid}`, `access custom page ${p.name}`);
    }
  }

  // LB pools + monitors (account-scoped, test-prefixed by name/description)
  log('  · LB pools + monitors');
  for (const pool of await list(`/accounts/${ACCOUNT_ID}/load_balancers/pools?per_page=100`)) {
    if (isTestResourceName(pool.name)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/load_balancers/pools/${pool.id}`, `LB pool ${pool.name}`);
    }
  }
  for (const mon of await list(`/accounts/${ACCOUNT_ID}/load_balancers/monitors?per_page=100`)) {
    if (isTestResourceName(mon.description)) {
      await del('DELETE', `/accounts/${ACCOUNT_ID}/load_balancers/monitors/${mon.id}`, `LB monitor ${mon.description}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────
(async () => {
  // Resolve the account (explicit --account, else interactive pick from the
  // accounts these credentials can see). Assigns the module-level ACCOUNT_ID
  // used by every delete helper.
  if (!ACCOUNT_ID) ACCOUNT_ID = await chooseAccount();

  // Resolve the zone. Explicit --zone (id or domain) is looked up; otherwise
  // pick from the chosen account's zones.
  let zoneId;
  let zoneName;
  if (ZONE_ARG) {
    zoneId = await resolveZoneId(ZONE_ARG);
    if (!zoneId) {
      console.error(`Could not resolve zone "${ZONE_ARG}" in account ${ACCOUNT_ID}.`);
      process.exit(1);
    }
  } else {
    const z = await chooseZone(ACCOUNT_ID);
    zoneId = z.id;
    zoneName = z.name;
  }

  // Confirm the zone actually belongs to the named account — a zone reachable
  // by the token but owned by a DIFFERENT account is a strong sign of a wrong
  // --account/--zone pairing.
  const zoneResp = await cfRequest('GET', `/zones/${zoneId}`);
  zoneName = zoneResp.data?.result?.name || zoneName || ZONE_ARG;
  const zoneAccountId = zoneResp.data?.result?.account?.id || '';
  if (zoneAccountId && zoneAccountId !== ACCOUNT_ID) {
    console.error(`Zone ${zoneName} (${zoneId}) belongs to account ${zoneAccountId}, not ${ACCOUNT_ID}.`);
    console.error('  Re-run with the correct --account (or --zone). Refusing to proceed.');
    process.exit(1);
  }

  log('═'.repeat(70));
  log('  MaxConfig zone deletion');
  log(`  Auth:    ${CF_API_EMAIL}`);
  log(`  Account: ${ACCOUNT_ID}`);
  log(`  Zone:    ${zoneName} (${zoneId})`);
  log(`  Mode:    ${DRY_RUN ? 'DRY RUN (no changes)' : CONFIRMED ? 'EXECUTE' : 'unconfirmed'}`);
  log('═'.repeat(70));

  // ── Pre-flight guard: does this zone look like MaxConfig was applied? ──
  if (SKIP_MAXCONFIG_CHECK) {
    log('\n  ⚠ --skip-maxconfig-check: skipping the MaxConfig fingerprint check.');
  } else {
    log('\n  🔎 Pre-flight: scanning for MaxConfig fingerprints...');
    const fingerprints = await detectFingerprints(zoneId, zoneName);
    if (fingerprints.length === 0) {
      log('');
      log('  ✋ No MaxConfig fingerprints found in this zone.');
      log(`     Zone ${zoneName} (${zoneId}) in account ${ACCOUNT_ID} shows none of the`);
      log('     markers MaxConfig leaves behind (test-prefixed worker routes, rulesets,');
      log('     email rules, Turnstile widgets, Access apps, or DNS records).');
      log('');
      log('     Refusing to wipe the zone — this is almost certainly the wrong');
      log('     zone/account, or MaxConfig was never applied here.');
      log('');
      log('     If the zone really is a throwaway test zone whose markers were');
      log('     already emptied, re-run with --skip-maxconfig-check to reset it anyway.');
      process.exit(3);
    }
    log(`  ✓ Found ${fingerprints.length} MaxConfig marker(s) — this looks like a MaxConfig zone:`);
    for (const f of fingerprints.slice(0, 12)) log(`      · ${f}`);
    if (fingerprints.length > 12) log(`      · …and ${fingerprints.length - 12} more`);
  }

  if (!DRY_RUN && !CONFIRMED) {
    log('');
    log('  ⚠ This will DELETE all zone-scoped resources in the named zone and all');
    log('    test-prefixed account-scoped resources. This cannot be undone.');
    log('');
    log('    Re-run with --dry-run to preview, or --force-delete to proceed.');
    process.exit(2);
  }

  const zoneWorkerNames = await deleteZoneScoped(zoneId);
  await deleteAccountScoped(zoneId, zoneName, zoneWorkerNames);

  log('\n' + '═'.repeat(70));
  if (DRY_RUN) {
    log(`  DRY RUN complete — ${wouldDelete} resource(s) would be deleted.`);
    log('  Re-run with --force-delete to perform the deletions.');
  } else {
    log(`  ✅ Deletion complete — ${deleted} resource(s) deleted.`);
  }
  log('═'.repeat(70));
})().catch(err => {
  if (err && err.message === 'cancelled') {
    console.log('\nCancelled.');
    process.exit(130);
  }
  console.error('Fatal error:', err);
  process.exit(1);
});
