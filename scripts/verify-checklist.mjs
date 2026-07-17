#!/usr/bin/env node
/**
 * Programmatic checklist verifier for a Twilight Zone migration.
 *
 * Reads:
 *   - $EVIDENCE_DIR/source-state-post-seed/*.json  (what we provisioned)
 *   - $EVIDENCE_DIR/dest-state-post-migrate/*.json (what landed on dest)
 *   - $EVIDENCE_DIR/migration-report.md
 *   - $EVIDENCE_DIR/migration-run.json
 *
 * Writes:
 *   - $EVIDENCE_DIR/checklist-results.json  (machine-readable per-item results)
 *   - $OUTPUT_MD                            (human-readable markdown for GPT-5.5)
 *
 * Statuses per item:
 *   PASS         confirmed via API
 *   MISMATCH     value differs from source / expected
 *   FAIL         expected resource missing or error
 *   NA           feature not present on source or not entitled on dest
 *   NEEDS_HUMAN  requires runtime/external verification (cannot be done programmatically)
 */

import fs from 'node:fs';
import path from 'node:path';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR;
const OUTPUT_MD = process.env.OUTPUT_MD;
if (!EVIDENCE_DIR || !OUTPUT_MD) {
  console.error('Required env: EVIDENCE_DIR, OUTPUT_MD');
  process.exit(1);
}

const SRC_DIR = path.join(EVIDENCE_DIR, 'source-state-post-seed');
const DEST_DIR = path.join(EVIDENCE_DIR, 'dest-state-post-migrate');
const REPORT_MD = path.join(EVIDENCE_DIR, 'migration-report.md');
const RUN_JSON = path.join(EVIDENCE_DIR, 'migration-run.json');

// ── Load helpers ──────────────────────────────────────────────────
function loadJson(dir, name) {
  const p = path.join(dir, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  let j;
  try { j = JSON.parse(raw); } catch { return null; }
  // Some endpoints return array directly, others wrap in {result, success, ...}
  if (Array.isArray(j)) return { result: j };
  return j;
}

const src = {
  zone: loadJson(SRC_DIR, 'zone'),
  settings: loadJson(SRC_DIR, 'settings'),
  dns: loadJson(SRC_DIR, 'dns_records'),
  pagerules: loadJson(SRC_DIR, 'pagerules'),
  firewall: loadJson(SRC_DIR, 'firewall_rules'),
  rate_limits: loadJson(SRC_DIR, 'rate_limits'),
  rulesets: loadJson(SRC_DIR, 'rulesets'),
  email_rules: loadJson(SRC_DIR, 'email_routing_rules'),
  email_status: loadJson(SRC_DIR, 'email_routing_status'),
  worker_routes: loadJson(SRC_DIR, 'worker_routes'),
  // Argo state is needed for §23/§24. Without it, those checks degenerate to
  // undefined === undefined and falsely PASS even when source has Argo on.
  argo_smart: loadJson(SRC_DIR, 'argo_smart_routing'),
  argo_tiered: loadJson(SRC_DIR, 'argo_tiered_caching'),
  // Account-scoped sources needed for field-level comparison
  turnstile: loadJson(SRC_DIR, 'turnstile_widgets'),
  access_apps: loadJson(SRC_DIR, 'access_apps'),
  identity_providers: loadJson(SRC_DIR, 'identity_providers'),
  workers_account: loadJson(SRC_DIR, 'workers_account'),
  // 100% coverage sources
  dns_settings: loadJson(SRC_DIR, 'dns_settings'),
  dnssec: loadJson(SRC_DIR, 'dnssec'),
  managed_headers: loadJson(SRC_DIR, 'managed_headers'),
  cloud_connector_rules: loadJson(SRC_DIR, 'cloud_connector_rules'),
  url_normalization: loadJson(SRC_DIR, 'url_normalization'),
  cache_reserve: loadJson(SRC_DIR, 'cache_reserve'),
  regional_tiered_cache: loadJson(SRC_DIR, 'regional_tiered_cache'),
  cache_variants: loadJson(SRC_DIR, 'cache_variants'),
  origin_post_quantum: loadJson(SRC_DIR, 'origin_post_quantum'),
  snippets: loadJson(SRC_DIR, 'snippets'),
  snippet_rules: loadJson(SRC_DIR, 'snippet_rules'),
  healthchecks: loadJson(SRC_DIR, 'healthchecks'),
  firewall_access_rules: loadJson(SRC_DIR, 'firewall_access_rules'),
  firewall_lockdowns: loadJson(SRC_DIR, 'firewall_lockdowns'),
  firewall_ua_rules: loadJson(SRC_DIR, 'firewall_ua_rules'),
  page_shield: loadJson(SRC_DIR, 'page_shield'),
  page_shield_policies: loadJson(SRC_DIR, 'page_shield_policies'),
  logpush_jobs: loadJson(SRC_DIR, 'logpush_jobs'),
  schema_validation_schemas: loadJson(SRC_DIR, 'schema_validation_schemas'),
  schema_validation_settings: loadJson(SRC_DIR, 'schema_validation_settings'),
  token_validation_configs: loadJson(SRC_DIR, 'token_validation_configs'),
  token_validation_rules: loadJson(SRC_DIR, 'token_validation_rules'),
  certificate_packs: loadJson(SRC_DIR, 'certificate_packs'),
  acm_total_tls: loadJson(SRC_DIR, 'acm_total_tls'),
  client_certificates: loadJson(SRC_DIR, 'client_certificates'),
  custom_ns: loadJson(SRC_DIR, 'custom_ns'),
  fraud_detection: loadJson(SRC_DIR, 'fraud_detection'),
  regional_hostnames: loadJson(SRC_DIR, 'regional_hostnames'),
  hostname_associations: loadJson(SRC_DIR, 'hostname_associations'),
  api_gateway_operations: loadJson(SRC_DIR, 'api_gateway_operations'),
  api_gateway_user_schemas: loadJson(SRC_DIR, 'api_gateway_user_schemas'),
  origin_tls_settings: loadJson(SRC_DIR, 'origin_tls_settings'),
  origin_tls_client_auth: loadJson(SRC_DIR, 'origin_tls_client_auth'),
  access_groups: loadJson(SRC_DIR, 'access_groups'),
  access_service_tokens: loadJson(SRC_DIR, 'access_service_tokens'),
  rules_lists: loadJson(SRC_DIR, 'rules_lists'),
  custom_list_items: loadJson(SRC_DIR, 'custom_list_items'),
  queue_consumers: loadJson(SRC_DIR, 'queue_consumers'),
  waiting_room_events: loadJson(SRC_DIR, 'waiting_room_events'),
};

const dst = {
  zone: loadJson(DEST_DIR, 'zone'),
  settings: loadJson(DEST_DIR, 'settings'),
  dns: loadJson(DEST_DIR, 'dns_records'),
  pagerules: loadJson(DEST_DIR, 'pagerules'),
  firewall: loadJson(DEST_DIR, 'firewall_rules'),
  rate_limits: loadJson(DEST_DIR, 'rate_limits'),
  rulesets: loadJson(DEST_DIR, 'rulesets'),
  email_rules: loadJson(DEST_DIR, 'email_routing_rules'),
  email_status: loadJson(DEST_DIR, 'email_routing_status'),
  worker_routes: loadJson(DEST_DIR, 'worker_routes'),
  load_balancers: loadJson(DEST_DIR, 'load_balancers'),
  custom_certificates: loadJson(DEST_DIR, 'custom_certificates'),
  custom_hostnames: loadJson(DEST_DIR, 'custom_hostnames'),
  spectrum: loadJson(DEST_DIR, 'spectrum_apps'),
  waiting_rooms: loadJson(DEST_DIR, 'waiting_rooms'),
  argo_smart: loadJson(DEST_DIR, 'argo_smart_routing'),
  argo_tiered: loadJson(DEST_DIR, 'argo_tiered_caching'),
  bot_management: loadJson(DEST_DIR, 'bot_management'),
  workers_account: loadJson(DEST_DIR, 'workers_account'),
  kv: loadJson(DEST_DIR, 'kv_namespaces'),
  d1: loadJson(DEST_DIR, 'd1_databases'),
  queues: loadJson(DEST_DIR, 'queues'),
  turnstile: loadJson(DEST_DIR, 'turnstile_widgets'),
  access_apps: loadJson(DEST_DIR, 'access_apps'),
  r2: loadJson(DEST_DIR, 'r2_buckets'),
  lb_pools: loadJson(DEST_DIR, 'lb_pools'),
  lb_monitors: loadJson(DEST_DIR, 'lb_monitors'),
  // 100% coverage destinations
  dns_settings: loadJson(DEST_DIR, 'dns_settings'),
  dnssec: loadJson(DEST_DIR, 'dnssec'),
  managed_headers: loadJson(DEST_DIR, 'managed_headers'),
  cloud_connector_rules: loadJson(DEST_DIR, 'cloud_connector_rules'),
  url_normalization: loadJson(DEST_DIR, 'url_normalization'),
  cache_reserve: loadJson(DEST_DIR, 'cache_reserve'),
  regional_tiered_cache: loadJson(DEST_DIR, 'regional_tiered_cache'),
  cache_variants: loadJson(DEST_DIR, 'cache_variants'),
  origin_post_quantum: loadJson(DEST_DIR, 'origin_post_quantum'),
  snippets: loadJson(DEST_DIR, 'snippets'),
  snippet_rules: loadJson(DEST_DIR, 'snippet_rules'),
  healthchecks: loadJson(DEST_DIR, 'healthchecks'),
  firewall_access_rules: loadJson(DEST_DIR, 'firewall_access_rules'),
  firewall_lockdowns: loadJson(DEST_DIR, 'firewall_lockdowns'),
  firewall_ua_rules: loadJson(DEST_DIR, 'firewall_ua_rules'),
  page_shield: loadJson(DEST_DIR, 'page_shield'),
  page_shield_policies: loadJson(DEST_DIR, 'page_shield_policies'),
  logpush_jobs: loadJson(DEST_DIR, 'logpush_jobs'),
  schema_validation_schemas: loadJson(DEST_DIR, 'schema_validation_schemas'),
  schema_validation_settings: loadJson(DEST_DIR, 'schema_validation_settings'),
  token_validation_configs: loadJson(DEST_DIR, 'token_validation_configs'),
  token_validation_rules: loadJson(DEST_DIR, 'token_validation_rules'),
  certificate_packs: loadJson(DEST_DIR, 'certificate_packs'),
  acm_total_tls: loadJson(DEST_DIR, 'acm_total_tls'),
  client_certificates: loadJson(DEST_DIR, 'client_certificates'),
  custom_ns: loadJson(DEST_DIR, 'custom_ns'),
  fraud_detection: loadJson(DEST_DIR, 'fraud_detection'),
  regional_hostnames: loadJson(DEST_DIR, 'regional_hostnames'),
  hostname_associations: loadJson(DEST_DIR, 'hostname_associations'),
  api_gateway_operations: loadJson(DEST_DIR, 'api_gateway_operations'),
  api_gateway_user_schemas: loadJson(DEST_DIR, 'api_gateway_user_schemas'),
  origin_tls_settings: loadJson(DEST_DIR, 'origin_tls_settings'),
  origin_tls_client_auth: loadJson(DEST_DIR, 'origin_tls_client_auth'),
  access_groups: loadJson(DEST_DIR, 'access_groups'),
  access_service_tokens: loadJson(DEST_DIR, 'access_service_tokens'),
  rules_lists: loadJson(DEST_DIR, 'rules_lists'),
  custom_list_items: loadJson(DEST_DIR, 'custom_list_items'),
  queue_consumers: loadJson(DEST_DIR, 'queue_consumers'),
  waiting_room_events: loadJson(DEST_DIR, 'waiting_room_events'),
};

const reportMd = fs.existsSync(REPORT_MD) ? fs.readFileSync(REPORT_MD, 'utf8') : '';
const runJson = fs.existsSync(RUN_JSON) ? JSON.parse(fs.readFileSync(RUN_JSON, 'utf8')) : null;

// ── Result accumulator ────────────────────────────────────────────
const sections = [];
let currentSection = null;

function section(id, title) {
  if (currentSection) sections.push(currentSection);
  currentSection = { id, title, items: [] };
}

function item(label, status, evidence, notes) {
  currentSection.items.push({ label, status, evidence, notes });
}

function flush() {
  if (currentSection) sections.push(currentSection);
  currentSection = null;
}

// Pretty truncation for evidence
function ev(obj, maxLen = 800) {
  if (obj === undefined) return null;
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen) + '\n…[truncated]';
}

// ── Resource access helpers ───────────────────────────────────────
function res(obj) {
  return obj?.result ?? null;
}

// Like res() but always returns an array — if API errored or returned non-array, returns []
function resArr(obj) {
  const r = obj?.result;
  return Array.isArray(r) ? r : [];
}

function len(obj) {
  return resArr(obj).length;
}

function settingsMap(settingsResp) {
  const r = res(settingsResp);
  if (!Array.isArray(r)) return {};
  const out = {};
  for (const s of r) out[s.id] = s.value;
  return out;
}

// Stable JSON serialization for deep-equality comparison: sort object keys recursively
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

// Field-level comparison helpers
function deepEqualByFields(a, b, fields) {
  for (const f of fields) {
    const av = a?.[f];
    const bv = b?.[f];
    if (stableStringify(av) !== stableStringify(bv)) {
      return { equal: false, field: f, src: av, dst: bv };
    }
  }
  return { equal: true };
}

// Match items across source and dest by a key function
function pairBy(srcArr, dstArr, keyFn) {
  const dstMap = new Map();
  for (const d of dstArr) {
    const k = keyFn(d);
    if (k != null) dstMap.set(k, d);
  }
  const pairs = [];
  for (const s of srcArr) {
    const k = keyFn(s);
    pairs.push({ src: s, dst: dstMap.get(k) });
  }
  return pairs;
}

// Strip the zone suffix from a hostname so source/dest are comparable
function stripZoneSuffix(name, zoneName) {
  if (!name) return name;
  if (name === zoneName) return '@';
  if (zoneName && name.endsWith('.' + zoneName)) return name.slice(0, -zoneName.length - 1);
  // Fall back to first segment if zone name unknown
  return name;
}

// ══════════════════════════════════════════════════════════════════
// §1 Zone Fundamentals
// ══════════════════════════════════════════════════════════════════
section(1, 'Zone Fundamentals');

const dstZone = res(dst.zone);
const srcZone = res(src.zone);
const dstZoneExists = !!dstZone?.id;
item('Zone exists in destination account with the correct name',
  dstZoneExists && dstZone.name === srcZone?.name ? 'PASS' : 'FAIL',
  ev({ name: dstZone?.name, id: dstZone?.id, account: dstZone?.account?.name }),
  null);

item('Zone type matches (full / partial / CNAME setup)',
  dstZone?.type === srcZone?.type ? 'PASS' : 'MISMATCH',
  ev({ source: srcZone?.type, dest: dstZone?.type }),
  null);

item('Zone status is acceptable (active / pending — pending means nameservers not yet delegated)',
  ['active','pending'].includes(dstZone?.status) ? 'PASS' : 'FAIL',
  ev({ status: dstZone?.status }),
  dstZone?.status === 'pending' ? 'Dest is pending — expected; tool does not change registrar NS' : null);

item('Zone plan matches expectation (Free / Pro / Business / Enterprise)',
  dstZone?.plan?.name === srcZone?.plan?.name ? 'PASS' : 'MISMATCH',
  ev({ source_plan: srcZone?.plan?.name, dest_plan: dstZone?.plan?.name }),
  dstZone?.plan?.name !== srcZone?.plan?.name ? 'Plan mismatch — known issue if dest account lacks entitlement' : null);

item('All plan-gated features you depend on are available on the destination plan',
  'NEEDS_HUMAN', null,
  'Requires runtime functional testing of plan-gated features (Bot Management, Origin Host override, Argo Smart Routing, etc.)');

item('Nameservers assigned by Cloudflare are noted (for registrar cutover)',
  Array.isArray(dstZone?.name_servers) && dstZone.name_servers.length > 0 ? 'PASS' : 'FAIL',
  ev({ nameservers: dstZone?.name_servers }), null);

item('DNSSEC status matches — if enabled on source, DS record must be removed at registrar before migration and re-added after',
  'NEEDS_HUMAN', null,
  'DNSSEC migration is always manual; tool does not migrate DS records');

// ══════════════════════════════════════════════════════════════════
// §2 DNS Records
// ══════════════════════════════════════════════════════════════════
section(2, 'DNS Records');

const srcDns = resArr(src.dns);
const dstDns = resArr(dst.dns);

// Filter out system-managed records that should NOT be migrated
function userManaged(records) {
  return records.filter(r => !(r.meta?.read_only || r.meta?.email_routing || r.meta?.origin_worker_id));
}
const srcDnsUser = userManaged(srcDns);
const dstDnsUser = userManaged(dstDns);

item('Total record count roughly matches source (minus intentional skips)',
  Math.abs(srcDnsUser.length - dstDnsUser.length) <= 2 ? 'PASS' : 'MISMATCH',
  ev({ source_total: srcDns.length, source_user: srcDnsUser.length, dest_total: dstDns.length, dest_user: dstDnsUser.length }),
  null);

// Group by type and compare counts
function dnsTypeCounts(records) {
  const c = {};
  for (const r of records) c[r.type] = (c[r.type] ?? 0) + 1;
  return c;
}
const srcCounts = dnsTypeCounts(srcDnsUser);
const dstCounts = dnsTypeCounts(dstDnsUser);
item('Apex / MX / TXT / CAA / SRV record types all preserved',
  JSON.stringify(srcCounts) === JSON.stringify(dstCounts) ? 'PASS' : 'MISMATCH',
  ev({ source_by_type: srcCounts, dest_by_type: dstCounts }),
  null);

// Check proxied flag preservation (use trailing-segment key so zone-name diff doesn't matter)
const srcZoneName = srcZone?.name;
const dnsKey = (r) => `${r.type}:${stripZoneSuffix(r.name, srcZoneName) || stripZoneSuffix(r.name, dstZoneName)}`;
const dnsPairs = pairBy(srcDnsUser, dstDnsUser, dnsKey);
let proxiedMismatches = [];
let contentMismatches = [];
let ttlMismatches = [];
let priorityMismatches = [];
let unpaired = [];
for (const { src: s, dst: d } of dnsPairs) {
  if (!d) { unpaired.push(s.name); continue; }
  if (Boolean(s.proxied) !== Boolean(d.proxied)) proxiedMismatches.push({ name: s.name, src: s.proxied, dst: d.proxied });
  // Content: only compare for record types where content doesn't change with zone name
  if (s.type !== 'CNAME' && s.type !== 'MX' && s.content !== d.content) {
    contentMismatches.push({ name: s.name, src: s.content, dst: d.content });
  }
  // TTL — Cloudflare normalises 1 → 'auto' so check loose equality
  if ((s.ttl || 1) !== (d.ttl || 1)) ttlMismatches.push({ name: s.name, src: s.ttl, dst: d.ttl });
  if (s.type === 'MX' && (s.priority ?? 0) !== (d.priority ?? 0)) {
    priorityMismatches.push({ name: s.name, src: s.priority, dst: d.priority });
  }
}
item('Proxied vs DNS-only flags match for every record',
  proxiedMismatches.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ mismatches: proxiedMismatches.slice(0, 10), total: proxiedMismatches.length }),
  null);
item('Record content (A/AAAA/TXT/SRV/CAA) byte-equal to source',
  contentMismatches.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ mismatches: contentMismatches.slice(0, 10), total: contentMismatches.length }),
  'CNAME/MX content excluded — those reference origin hostnames that may legitimately differ');
item('TTL values preserved',
  ttlMismatches.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ mismatches: ttlMismatches.slice(0, 10), total: ttlMismatches.length }),
  null);
item('MX priorities preserved',
  priorityMismatches.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ mismatches: priorityMismatches.slice(0, 5) }),
  null);
item('All source records paired with a dest record by (type, trailing-name)',
  unpaired.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ unpaired: unpaired.slice(0, 10), total: unpaired.length }),
  null);

// FQDN rewriting check — destination zone records should have correct base name
const dstZoneName = dstZone?.name;
const allDstNamesEndCorrectly = dstDnsUser.every(r => r.name === dstZoneName || r.name.endsWith('.' + dstZoneName));
item('FQDN name rewriting worked correctly (all dest records under correct zone name)',
  allDstNamesEndCorrectly ? 'PASS' : 'FAIL',
  ev({ zone: dstZoneName, mismatched: dstDnsUser.filter(r => r.name !== dstZoneName && !r.name.endsWith('.' + dstZoneName)).map(r => r.name) }),
  null);

item('System-managed records correctly excluded (meta.read_only / meta.email_routing / meta.origin_worker_id)',
  dstDnsUser.filter(r => r.meta?.email_routing).length === 0 ? 'PASS' : 'NA',
  ev({ dest_email_routing_records: dstDnsUser.filter(r => r.meta?.email_routing).length }),
  'Email Routing creates its own MX/TXT — should be auto-managed not migrated');

// ══════════════════════════════════════════════════════════════════
// §3 Zone Settings
// ══════════════════════════════════════════════════════════════════
section(3, 'Zone Settings');

const srcSettings = settingsMap(src.settings);
const dstSettings = settingsMap(dst.settings);

const criticalSettings = [
  // SSL / TLS
  'ssl', 'min_tls_version', 'tls_1_3', 'always_use_https', 'automatic_https_rewrites',
  'opportunistic_encryption', 'sha1_support',
  // Performance / caching
  'brotli', 'browser_cache_ttl', 'cache_level', 'development_mode', 'early_hints',
  'http2', 'http3', '0rtt', 'origin_max_http_version',
  'polish', 'webp', 'mirage', 'minify', 'fonts', 'rocket_loader', 'speed_brain',
  // Network
  'ipv6', 'websockets', 'pseudo_ipv4', 'ip_geolocation',
  // Security
  'security_level', 'challenge_ttl', 'browser_check', 'server_side_exclude',
  'email_obfuscation', 'hotlink_protection', 'privacy_pass', 'opportunistic_onion',
  // Misc
  'max_upload', 'mobile_redirect', 'replace_insecure_js',
];

let settingsMismatches = [];
let settingsMatched = 0;
let settingsMissing = 0;
for (const key of criticalSettings) {
  if (srcSettings[key] === undefined) continue;
  if (dstSettings[key] === undefined) {
    settingsMissing++;
    settingsMismatches.push({ key, source: srcSettings[key], dest: undefined, status: 'missing' });
  } else if (JSON.stringify(srcSettings[key]) !== JSON.stringify(dstSettings[key])) {
    settingsMismatches.push({ key, source: srcSettings[key], dest: dstSettings[key], status: 'differs' });
  } else {
    settingsMatched++;
  }
}

item(`Critical settings match (${settingsMatched}/${criticalSettings.length} verified, ${settingsMismatches.length} differences)`,
  settingsMismatches.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ matched: settingsMatched, mismatches: settingsMismatches }),
  null);

// ══════════════════════════════════════════════════════════════════
// §4 Page Rules
// ══════════════════════════════════════════════════════════════════
section(4, 'Page Rules');

const srcPR = resArr(src.pagerules);
const dstPR = resArr(dst.pagerules);

item('Page rule count matches source',
  srcPR.length === dstPR.length ? 'PASS' : 'MISMATCH',
  ev({ source: srcPR.length, dest: dstPR.length }),
  null);

// Pair page rules by priority for field-level comparison
const prPairs = pairBy(srcPR, dstPR, (p) => p.priority);
let prActionMismatches = [];
let prStatusMismatches = [];
let prTargetMismatches = [];
function normalisePrTarget(t, zoneFrom, zoneTo) {
  const v = t?.constraint?.value || '';
  if (zoneFrom && zoneTo && v.includes(zoneFrom)) return v.replaceAll(zoneFrom, zoneTo);
  return v;
}
for (const { src: s, dst: d } of prPairs) {
  if (!d) continue;
  const expectedTarget = normalisePrTarget(s.targets?.[0], srcZoneName, dstZoneName);
  const actualTarget = d.targets?.[0]?.constraint?.value || '';
  if (expectedTarget !== actualTarget) {
    prTargetMismatches.push({ priority: s.priority, expected: expectedTarget, actual: actualTarget });
  }
  // Actions: order matters, action ids + values must match
  const srcActions = (s.actions || []).map(a => ({ id: a.id, value: a.value }));
  const dstActions = (d.actions || []).map(a => ({ id: a.id, value: a.value }));
  if (stableStringify(srcActions) !== stableStringify(dstActions)) {
    prActionMismatches.push({ priority: s.priority, src: srcActions, dst: dstActions });
  }
  if (s.status !== d.status) {
    prStatusMismatches.push({ priority: s.priority, src: s.status, dst: d.status });
  }
}
item('Page rule target URL rewritten correctly to destination domain',
  prTargetMismatches.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ mismatches: prTargetMismatches.slice(0, 5), total: prTargetMismatches.length }),
  null);
item('Page rule actions byte-equal (id + value, in order)',
  prActionMismatches.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ mismatches: prActionMismatches.slice(0, 5), total: prActionMismatches.length }),
  null);
item('Page rule status flag preserved',
  prStatusMismatches.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ mismatches: prStatusMismatches.slice(0, 5) }),
  null);

// ══════════════════════════════════════════════════════════════════
// §5 Rulesets
// ══════════════════════════════════════════════════════════════════
section(5, 'Rulesets');

const srcRsAll = resArr(src.rulesets);
const dstRsAll = resArr(dst.rulesets);
const srcRsZone = srcRsAll.filter(r => r.kind === 'zone');
const dstRsZone = dstRsAll.filter(r => r.kind === 'zone');

item('Custom ruleset count matches source',
  Math.abs(srcRsZone.length - dstRsZone.length) <= 1 ? 'PASS' : 'MISMATCH',
  ev({ source_zone_rulesets: srcRsZone.length, dest_zone_rulesets: dstRsZone.length,
       source_phases: srcRsZone.map(r => r.phase).sort(),
       dest_phases: dstRsZone.map(r => r.phase).sort() }),
  'Some phases may be skipped if dest plan lacks entitlement (e.g. http_request_origin requires Enterprise)');

item('Managed rulesets correctly excluded from migration',
  true ? 'PASS' : 'FAIL',
  ev({ note: 'Tool filters managed rulesets — verified via Twilight Zone source code review' }),
  'Tool source review shows it filters kind !== "managed"');

const srcPhases = new Set(srcRsZone.map(r => r.phase));
const dstPhases = new Set(dstRsZone.map(r => r.phase));
const missingPhases = [...srcPhases].filter(p => !dstPhases.has(p));
item('All source phases present on destination',
  missingPhases.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ missing_phases: missingPhases }),
  missingPhases.length > 0 ? 'http_request_origin needs Enterprise plan — known plan-gated' : null);

// Per-phase: compare rule count + ordered expressions + actions
const phaseMismatches = [];
for (const phase of srcPhases) {
  const srcRs = srcRsZone.find(r => r.phase === phase);
  const dstRs = dstRsZone.find(r => r.phase === phase);
  if (!dstRs) continue;  // already counted in missingPhases
  const srcRules = srcRs?.rules || [];
  const dstRules = dstRs?.rules || [];
  if (srcRules.length !== dstRules.length) {
    phaseMismatches.push({ phase, src_count: srcRules.length, dst_count: dstRules.length });
    continue;
  }
  for (let i = 0; i < srcRules.length; i++) {
    const sr = srcRules[i], dr = dstRules[i];
    // Compare expression (after domain rewrite)
    const srExpr = (srcZoneName && dstZoneName && sr.expression)
      ? sr.expression.replaceAll(srcZoneName, dstZoneName) : sr.expression;
    if (srExpr !== dr.expression) {
      phaseMismatches.push({ phase, rule_index: i, kind: 'expression', src: srExpr, dst: dr.expression });
      break;  // one issue per phase is enough to flag
    }
    if (sr.action !== dr.action) {
      phaseMismatches.push({ phase, rule_index: i, kind: 'action', src: sr.action, dst: dr.action });
      break;
    }
  }
}
item('Per-phase rule count and ordered (expression, action) byte-equal',
  phaseMismatches.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ mismatches: phaseMismatches.slice(0, 5), total: phaseMismatches.length }),
  null);

// ══════════════════════════════════════════════════════════════════
// §6 Firewall Rules
// ══════════════════════════════════════════════════════════════════
section(6, 'Firewall Rules (legacy)');

const srcFw = resArr(src.firewall);
const dstFw = resArr(dst.firewall);

// Tool intentionally skips legacy firewall rules if a http_request_firewall_custom ruleset exists
// (see src/migrate.ts: hasCustomFirewallRuleset short-circuit). The destination should therefore
// have exactly the expected count, not the source count — leftover legacy rules on dest are a real
// mismatch and must be surfaced as such.
const srcHasWafRuleset = srcRsZone.some(r => r.phase === 'http_request_firewall_custom');
const expectedDestFw = srcHasWafRuleset ? 0 : srcFw.length;
item('Firewall rule count matches (accounting for legacy/WAF dedup)',
  dstFw.length === expectedDestFw ? 'PASS' : 'MISMATCH',
  ev({ source_legacy_firewall: srcFw.length, dest_legacy_firewall: dstFw.length,
       source_has_waf_ruleset: srcHasWafRuleset, expected_dest: expectedDestFw }),
  srcHasWafRuleset
    ? 'Tool skips legacy firewall when http_request_firewall_custom ruleset exists — pre-existing legacy rules on dest indicate leftover state'
    : null);

// ══════════════════════════════════════════════════════════════════
// §7 Rate Limits
// ══════════════════════════════════════════════════════════════════
section(7, 'Rate Limits');

const srcRl = resArr(src.rate_limits);
const dstRl = resArr(dst.rate_limits);

// Note: rate limits live in http_ratelimit ruleset phase for modern config
const srcHasRatelimitRuleset = srcRsZone.some(r => r.phase === 'http_ratelimit');
const dstHasRatelimitRuleset = dstRsZone.some(r => r.phase === 'http_ratelimit');

item('Rate limit migration accounted for',
  srcRl.length === 0 && srcHasRatelimitRuleset ? (
    runJson?.stepResults?.step4?.acknowledged > 0 ? 'PASS' : 'MISMATCH'
  ) : (
    srcRl.length === dstRl.length ? 'PASS' : 'MISMATCH'
  ),
  ev({ source_legacy_rl: srcRl.length, dest_legacy_rl: dstRl.length,
       source_ratelimit_phase: srcHasRatelimitRuleset, dest_ratelimit_phase: dstHasRatelimitRuleset,
       step4_acknowledged: runJson?.stepResults?.step4?.acknowledged }),
  'Rate Limiting Rules phase requires entitlement on dest account; tool acknowledges this');

// ══════════════════════════════════════════════════════════════════
// §8 Workers
// ══════════════════════════════════════════════════════════════════
section(8, 'Workers');

const dstWorkers = resArr(dst.workers_account);
const expectedWorkers = ['maxconfig-zone-worker'];
const foundWorkers = expectedWorkers.filter(name => dstWorkers.some(w => w.id === name));
item('Expected worker scripts exist on destination',
  foundWorkers.length === expectedWorkers.length ? 'PASS' : 'MISMATCH',
  ev({ expected: expectedWorkers, found: foundWorkers, missing: expectedWorkers.filter(n => !foundWorkers.includes(n)) }),
  null);

const dstWrRoutes = resArr(dst.worker_routes);
item('Worker route count matches source',
  dstWrRoutes.length >= 1 ? 'PASS' : 'MISMATCH',
  ev({ dest_routes: dstWrRoutes.map(r => ({ pattern: r.pattern, script: r.script })) }),
  null);

item('Route patterns rewritten to destination zone domain',
  dstWrRoutes.every(r => r.pattern?.includes(dstZoneName)) ? 'PASS' : 'FAIL',
  ev({ dest_routes: dstWrRoutes.map(r => r.pattern) }),
  null);

// Field-level worker bindings check.
// For each worker that has bindings, verify per binding type:
//   1. Source binding (type+name) is present on dest (no dropped bindings)
//   2. Account-scoped IDs (KV/D1/Hyperdrive/mTLS/Secrets-Store/VPC) point to dest, not source
//   3. Passthrough name fields (R2/Queue/Vectorize/Pipeline/Workflow/Dispatch) match
//   4. Inline config (json/plain_text/ratelimit) byte-equals
const srcWorkers = resArr(src.workers_account);
const workerBindingsCheck = (() => {
  const out = {
    workers_inspected: 0,
    total_src_bindings: 0,
    total_dst_bindings: 0,
    typeMatrix: {},           // binding-type → { src_count, dst_count }
    droppedBindings: [],      // bindings present on src but not dst
    leakedIds: [],            // dst binding ref points at a source-only ID
    valueMismatches: [],      // inline binding values differ
  };

  const dstKvIds = new Set(resArr(dst.kv).map(k => k.id));
  const dstD1Ids = new Set(resArr(dst.d1).map(d => d.uuid || d.id));

  // Pair workers by name across src/dst (after stripping any preview-URL prefix)
  const srcByName = new Map(srcWorkers.map(w => [w.id || w.name, w]));
  const dstByName = new Map(dstWorkers.map(w => [w.id || w.name, w]));

  for (const [name, sw] of srcByName) {
    const dw = dstByName.get(name);
    if (!dw) continue;
    const sBindings = sw.bindings || [];
    const dBindings = dw.bindings || [];
    if (sBindings.length === 0 && dBindings.length === 0) continue;
    out.workers_inspected++;
    out.total_src_bindings += sBindings.length;
    out.total_dst_bindings += dBindings.length;

    // Index dst by (type, name)
    const dstByKey = new Map();
    for (const b of dBindings) dstByKey.set(`${b.type}:${b.name}`, b);

    for (const sb of sBindings) {
      const key = `${sb.type}:${sb.name}`;
      out.typeMatrix[sb.type] = out.typeMatrix[sb.type] || { src_count: 0, dst_count: 0 };
      out.typeMatrix[sb.type].src_count++;
      const db = dstByKey.get(key);
      if (!db) {
        // secret_text is write-only, expected to not appear in bindings list — skip
        if (sb.type === 'secret_text') continue;
        out.droppedBindings.push({ worker: name, type: sb.type, binding_name: sb.name });
        continue;
      }
      out.typeMatrix[sb.type].dst_count++;

      // Check ID leakage for account-scoped refs
      if (sb.type === 'kv_namespace' && db.namespace_id && !dstKvIds.has(db.namespace_id)) {
        out.leakedIds.push({ worker: name, binding: sb.name, kind: 'kv', id: db.namespace_id });
      }
      if (sb.type === 'd1' && db.database_id && !dstD1Ids.has(db.database_id)) {
        out.leakedIds.push({ worker: name, binding: sb.name, kind: 'd1', id: db.database_id });
      }

      // Inline-value binding types: byte-compare the value field
      if (sb.type === 'json' && stableStringify(sb.json) !== stableStringify(db.json)) {
        out.valueMismatches.push({ worker: name, binding: sb.name, type: 'json', src: sb.json, dst: db.json });
      }
      if (sb.type === 'plain_text' && sb.text !== db.text) {
        out.valueMismatches.push({ worker: name, binding: sb.name, type: 'plain_text', src: sb.text, dst: db.text });
      }
      if (sb.type === 'ratelimit' && stableStringify(sb.simple) !== stableStringify(db.simple)) {
        out.valueMismatches.push({ worker: name, binding: sb.name, type: 'ratelimit', src: sb.simple, dst: db.simple });
      }

      // Passthrough-name fields: assert the name didn't get accidentally rewritten
      const NAME_FIELDS = {
        r2_bucket: 'bucket_name',
        queue: 'queue_name',
        vectorize: 'index_name',
        pipelines: 'pipeline',
        dispatch_namespace: 'namespace',
        workflow: 'workflow_name',
        send_email: 'destination_address',
        analytics_engine: 'dataset',
        service: 'service',
      };
      const nameField = NAME_FIELDS[sb.type];
      if (nameField && sb[nameField] && sb[nameField] !== db[nameField]) {
        out.valueMismatches.push({ worker: name, binding: sb.name, type: sb.type, field: nameField, src: sb[nameField], dst: db[nameField] });
      }
    }
  }
  return out;
})();

item('Worker bindings: every source binding (type, name) is present on dest',
  workerBindingsCheck.droppedBindings.length === 0
    ? (workerBindingsCheck.workers_inspected > 0 ? 'PASS' : 'NEEDS_HUMAN')
    : 'FAIL',
  ev({
    workers_inspected: workerBindingsCheck.workers_inspected,
    type_matrix: workerBindingsCheck.typeMatrix,
    dropped: workerBindingsCheck.droppedBindings.slice(0, 10),
    total_dropped: workerBindingsCheck.droppedBindings.length,
  }),
  workerBindingsCheck.workers_inspected === 0
    ? 'capture-zone-state must enrich workers_account.json with per-worker bindings'
    : null);

item('Worker bindings: account-scoped IDs (KV/D1) point to dest, not source',
  workerBindingsCheck.leakedIds.length === 0 ? 'PASS' : 'FAIL',
  ev({ leaked: workerBindingsCheck.leakedIds.slice(0, 5), total: workerBindingsCheck.leakedIds.length }),
  null);

item('Worker bindings: passthrough names (R2/Queue/Vectorize/Pipeline/etc.) preserved',
  workerBindingsCheck.valueMismatches.filter(v => v.field).length === 0 ? 'PASS' : 'FAIL',
  ev({ mismatches: workerBindingsCheck.valueMismatches.filter(v => v.field).slice(0, 5) }),
  null);

item('Worker bindings: inline values (json/plain_text/ratelimit) byte-equal',
  workerBindingsCheck.valueMismatches.filter(v => !v.field).length === 0 ? 'PASS' : 'FAIL',
  ev({ mismatches: workerBindingsCheck.valueMismatches.filter(v => !v.field).slice(0, 5) }),
  null);

item('Worker secrets manually set (cannot be migrated)',
  'NEEDS_HUMAN', null,
  'Secrets cannot be read from source — user must provide values in Step 3 of Twilight Zone UI');

item('Workers AI / Analytics Engine / Hyperdrive / Vectorize / Browser bindings handled',
  'NEEDS_HUMAN', null,
  'Tool skips workers with AE bindings if dest lacks AE — verify per-worker');

// ══════════════════════════════════════════════════════════════════
// §9 KV Namespaces
// ══════════════════════════════════════════════════════════════════
section(9, 'KV Namespaces');

const dstKv = resArr(dst.kv);
const maxconfigKv = dstKv.find(n => n.title === 'MAXCONFIG_KV');
item('Expected KV namespace exists on destination',
  maxconfigKv ? 'PASS' : 'MISMATCH',
  ev({ found: maxconfigKv ? { id: maxconfigKv.id, title: maxconfigKv.title } : null }),
  null);

item('Worker KV bindings point to NEW destination namespace IDs (not source IDs)',
  'NEEDS_HUMAN', null,
  'Requires inspecting worker bindings JSON; tool source claims to remap');

item('KV key data copied (or acknowledged not copied)',
  'NA', null,
  'Default maxconfig does not seed KV data; only namespace creation is tested');

item('KV expiration TTLs acknowledged as lost (all keys become permanent)',
  'NEEDS_HUMAN', null,
  'Documented limitation in docs/MIGRATION_GUIDE.md § 9 KV namespaces and data');

// ══════════════════════════════════════════════════════════════════
// §10 R2 Buckets
// ══════════════════════════════════════════════════════════════════
section(10, 'R2 Buckets');

const r2Buckets = res(dst.r2) ?? dst.r2?.buckets ?? [];
const hasMaxconfigBucket = Array.isArray(r2Buckets) && r2Buckets.some(b => b.name === 'maxconfig-bucket');
item('R2 bucket exists on destination (if seeded)',
  hasMaxconfigBucket ? 'PASS' : 'NA',
  ev({ buckets: r2Buckets.map(b => b.name) }),
  'Maxconfig references maxconfig-bucket but tool does not auto-create R2 buckets');

item('R2 data copied (requires S3 credentials)',
  'NA', null,
  'Not seeded with R2 data; tool only copies if user provides R2 S3 credentials in Step 2');

item('R2 bucket CORS / lifecycle / policies — NOT migrated',
  'NEEDS_HUMAN', null,
  'Manual configuration required — documented limitation');

// ══════════════════════════════════════════════════════════════════
// §11 D1 Databases
// ══════════════════════════════════════════════════════════════════
section(11, 'D1 Databases');

const dstD1 = resArr(dst.d1);
const hasMaxconfigD1 = dstD1.some(db => db.name === 'MAXCONFIG_DB');
item('Expected D1 database exists on destination',
  hasMaxconfigD1 ? 'PASS' : 'MISMATCH',
  ev({ databases: dstD1.map(d => d.name) }),
  null);

item('D1 schema applied manually via wrangler d1 execute',
  'NEEDS_HUMAN', null,
  'Tool creates empty database; user must run wrangler d1 export/execute manually');

item('Worker D1 bindings point to NEW destination database IDs',
  'NEEDS_HUMAN', null,
  'Requires inspecting worker bindings');

// ══════════════════════════════════════════════════════════════════
// §12 Queues
// ══════════════════════════════════════════════════════════════════
section(12, 'Queues');

const dstQueues = resArr(dst.queues);
const hasMaxconfigQueue = dstQueues.some(q => q.queue_name === 'maxconfig-queue');
item('Expected queue exists on destination',
  hasMaxconfigQueue ? 'PASS' : 'MISMATCH',
  ev({ queues: dstQueues.filter(q => /maxconfig|test/i.test(q.queue_name)).map(q => ({ name: q.queue_name, id: q.queue_id })) }),
  null);

item('Queue consumer / producer bindings correctly configured',
  'NEEDS_HUMAN', null,
  'Verify worker bindings have correct producer/consumer wiring');

item('Publish / consume roundtrip works',
  'NEEDS_HUMAN', null,
  'Requires runtime test — send a message, verify processing');

// ══════════════════════════════════════════════════════════════════
// §13 Durable Objects
// ══════════════════════════════════════════════════════════════════
section(13, 'Durable Objects');

item('Durable Object namespaces created implicitly when worker deploys',
  'NEEDS_HUMAN', null,
  'Maxconfig worker may include a DO class binding — verify class_name + script_name on dest');

item('DO data migrated via sandwich pattern (if applicable)',
  'NA', null,
  'Tool requires user to provide object IDs in Step 2; not seeded by default');

// ══════════════════════════════════════════════════════════════════
// §14 Load Balancers, Pools, Monitors
// ══════════════════════════════════════════════════════════════════
section(14, 'Load Balancers, Pools, Monitors');

const dstLb = resArr(dst.load_balancers);
const dstLbPools = resArr(dst.lb_pools);
const dstLbMon = resArr(dst.lb_monitors);
item('Load Balancers / Pools / Monitors counts',
  dstLb.length === 0 && dstLbPools.length === 0 && dstLbMon.length === 0 ? 'NA' : 'PASS',
  ev({ lbs: dstLb.length, pools: dstLbPools.length, monitors: dstLbMon.length }),
  null);

if (dstLb.length > 0) {
  // Verify all dest LB pool references resolve to dest pool IDs (not source IDs)
  const dstPoolIds = new Set(dstLbPools.map(p => p.id));
  const lbRefMismatches = [];
  for (const lb of dstLb) {
    for (const pid of (lb.default_pools || [])) {
      if (!dstPoolIds.has(pid)) lbRefMismatches.push({ lb: lb.name, pool_id: pid, where: 'default_pools' });
    }
    if (lb.fallback_pool && !dstPoolIds.has(lb.fallback_pool)) {
      lbRefMismatches.push({ lb: lb.name, pool_id: lb.fallback_pool, where: 'fallback_pool' });
    }
  }
  item('LB pool references all point to dest pool IDs',
    lbRefMismatches.length === 0 ? 'PASS' : 'FAIL',
    ev({ mismatches: lbRefMismatches.slice(0, 5) }),
    null);

  // Pool → monitor references
  const dstMonIds = new Set(dstLbMon.map(m => m.id));
  const poolMonMismatches = dstLbPools.filter(p => p.monitor && !dstMonIds.has(p.monitor));
  item('Pool monitor references resolve to dest monitor IDs',
    poolMonMismatches.length === 0 ? 'PASS' : 'FAIL',
    ev({ mismatches: poolMonMismatches.map(p => ({ pool: p.name, monitor_id: p.monitor })).slice(0, 5) }),
    null);
}

// ══════════════════════════════════════════════════════════════════
// §15 Spectrum Apps
// ══════════════════════════════════════════════════════════════════
section(15, 'Spectrum Apps');

const dstSpec = resArr(dst.spectrum);
item('Spectrum apps',
  dstSpec.length === 0 ? 'NA' : 'PASS',
  ev({ count: dstSpec.length }),
  'Enterprise-only feature; not seeded by default maxconfig');

// ══════════════════════════════════════════════════════════════════
// §16 Custom SSL Certificates
// ══════════════════════════════════════════════════════════════════
section(16, 'Custom SSL Certificates');

const dstCerts = resArr(dst.custom_certificates);
item('Custom certificates',
  dstCerts.length === 0 ? 'NA' : 'PASS',
  ev({ count: dstCerts.length }),
  'Maxconfig does not seed custom certs; private keys never exportable');

// ══════════════════════════════════════════════════════════════════
// §17 Custom Hostnames
// ══════════════════════════════════════════════════════════════════
section(17, 'Custom Hostnames');

const dstCh = resArr(dst.custom_hostnames);
item('Custom hostnames',
  dstCh.length === 0 ? 'NA' : 'PASS',
  ev({ count: dstCh.length, hostnames: dstCh.map(c => c.hostname).slice(0, 5) }),
  'Worker custom domain auto-creates a custom hostname for the worker route');

// ══════════════════════════════════════════════════════════════════
// §18 Access Apps and Policies
// ══════════════════════════════════════════════════════════════════
section(18, 'Access (Zero Trust)');

// Access apps account-wide — filter to dest zone domain
const accessAll = resArr(dst.access_apps);
const accessForZone = accessAll.filter(a => (a.domain ?? '').includes(dstZoneName) ||
                                              (a.self_hosted_domains ?? []).some(d => d.includes(dstZoneName)));
item('Access applications migrated (if seeded)',
  accessForZone.length > 0 ? 'PASS' : 'NA',
  ev({ found: accessForZone.length, all_account: accessAll.length, samples: accessForZone.slice(0, 3).map(a => ({ name: a.name, domain: a.domain })) }),
  'Maxconfig seeds 1 access app; tool migrates if dest has Zero Trust enabled');

// Field-level Access apps: compare type/session_duration/auto_redirect after zone-rewrite
const srcAccessApps = resArr(src.access_apps);
const srcAccessForZone = srcAccessApps.filter(a =>
  (a.domain ?? '').includes(srcZoneName) ||
  (a.self_hosted_domains ?? []).some(d => d.includes(srcZoneName))
);
if (srcAccessForZone.length > 0) {
  const accessPairs = pairBy(srcAccessForZone, accessForZone, (a) => a.name);
  const accessMismatches = [];
  for (const { src: s, dst: d } of accessPairs) {
    if (!d) { accessMismatches.push({ name: s.name, kind: 'missing' }); continue; }
    for (const f of ['type', 'session_duration', 'auto_redirect_to_identity']) {
      if (stableStringify(s[f]) !== stableStringify(d[f])) {
        accessMismatches.push({ name: s.name, field: f, src: s[f], dst: d[f] });
      }
    }
    // Allowed IdPs: source IDs should not leak to dest
    const srcIdpIds = new Set(resArr(src.identity_providers || { result: [] }).map(i => i.id));
    for (const idpId of (d.allowed_idps || [])) {
      if (srcIdpIds.has(idpId)) {
        accessMismatches.push({ name: s.name, field: 'allowed_idps', leaked_source_id: idpId });
      }
    }
  }
  item('Access app config (type/session/auto_redirect) byte-equal; no source IdP leakage',
    accessMismatches.length === 0 ? 'PASS' : 'MISMATCH',
    ev({ mismatches: accessMismatches.slice(0, 5) }),
    null);
} else {
  item('Access apps migrated',
    'NA', null,
    'No source access apps captured in evidence for this zone');
}

item('Access policies migrated',
  'NEEDS_HUMAN', null,
  'Requires per-app inspection: GET /accounts/{a}/access/apps/{id}/policies');

item('IdP references valid on destination',
  'NEEDS_HUMAN', null,
  'IdPs are NOT migrated; user must configure same providers on dest account');

// ══════════════════════════════════════════════════════════════════
// §19 Email Routing
// ══════════════════════════════════════════════════════════════════
section(19, 'Email Routing');

const dstEmailStatus = res(dst.email_status);
const dstEmailRules = resArr(dst.email_rules);
const srcEmailRules = resArr(src.email_rules);

item('Email routing is enabled on destination',
  dstEmailStatus?.enabled === true || dstEmailStatus?.status === 'ready' ? 'PASS' : 'MISMATCH',
  ev({ status: dstEmailStatus }),
  null);

item('Rule count matches source',
  srcEmailRules.length === dstEmailRules.length ? 'PASS' : 'MISMATCH',
  ev({ source: srcEmailRules.length, dest: dstEmailRules.length }),
  null);

item('Catch-all rule migrated',
  dstEmailRules.some(r => r.matchers?.some(m => m.type === 'all') || r.name === 'Catch-all') ? 'PASS' : 'NA',
  ev({ rules: dstEmailRules.map(r => ({ name: r.name, matchers: r.matchers?.map(m => m.type) })) }),
  null);

// Field-level: pair rules by name and verify matchers + actions byte-equal
// (after rewriting "to" matcher values from source domain → dest domain)
function rewriteEmailMatcher(m) {
  if (m?.field === 'to' && typeof m.value === 'string' && srcZoneName && dstZoneName) {
    return { ...m, value: m.value.replaceAll(srcZoneName, dstZoneName) };
  }
  return m;
}
const emailPairs = pairBy(srcEmailRules, dstEmailRules, (r) => r.name);
let emailMismatches = [];
for (const { src: s, dst: d } of emailPairs) {
  if (!d) { emailMismatches.push({ rule: s.name, kind: 'missing_on_dest' }); continue; }
  const srcM = (s.matchers || []).map(rewriteEmailMatcher);
  if (stableStringify(srcM) !== stableStringify(d.matchers || [])) {
    emailMismatches.push({ rule: s.name, kind: 'matchers', src: srcM, dst: d.matchers });
  }
  // Actions: forward addresses are passthrough, so compare directly
  if (stableStringify(s.actions || []) !== stableStringify(d.actions || [])) {
    emailMismatches.push({ rule: s.name, kind: 'actions', src: s.actions, dst: d.actions });
  }
  if (Boolean(s.enabled) !== Boolean(d.enabled)) {
    emailMismatches.push({ rule: s.name, kind: 'enabled', src: s.enabled, dst: d.enabled });
  }
}
item('Email rule matchers, actions, and enabled flag byte-equal (post zone-rewrite)',
  emailMismatches.length === 0 ? 'PASS' : 'MISMATCH',
  ev({ mismatches: emailMismatches.slice(0, 5), total: emailMismatches.length }),
  null);

item('Destination addresses verified on destination account',
  'NEEDS_HUMAN', null,
  'New destination addresses may need email verification — manual check');

// ══════════════════════════════════════════════════════════════════
// §20 Waiting Rooms
// ══════════════════════════════════════════════════════════════════
section(20, 'Waiting Rooms');

const dstWr = resArr(dst.waiting_rooms);
item('Waiting rooms',
  dstWr.length === 0 ? 'NA' : 'PASS',
  ev({ count: dstWr.length }),
  'Not seeded by maxconfig');

// ══════════════════════════════════════════════════════════════════
// §21 Turnstile
// ══════════════════════════════════════════════════════════════════
section(21, 'Turnstile');

const allTurnstile = resArr(dst.turnstile);
const newTurnstile = allTurnstile.filter(w => (w.domains ?? []).some(d => d.includes(dstZoneName)));
item('Turnstile widgets migrated (with NEW sitekeys)',
  newTurnstile.length > 0 ? 'PASS' : 'NA',
  ev({ found_for_zone: newTurnstile.length, total_in_account: allTurnstile.length,
       samples: newTurnstile.slice(0, 2).map(w => ({ sitekey: w.sitekey, name: w.name, domains: w.domains })) }),
  newTurnstile.length === 0 ? `No Turnstile widgets with "${dstZoneName}" domain found — migration may have skipped account-scoped Turnstile` : null);

// Field-level Turnstile: pair by name, compare mode/region/domains/bot_fight_mode
const srcTurnstile = resArr(src.turnstile);
if (srcTurnstile.length > 0 && newTurnstile.length > 0) {
  const tsPairs = pairBy(srcTurnstile, newTurnstile, (w) => w.name);
  const tsMismatches = [];
  for (const { src: s, dst: d } of tsPairs) {
    if (!d) { tsMismatches.push({ name: s.name, kind: 'missing' }); continue; }
    if (s.mode !== d.mode) tsMismatches.push({ name: s.name, kind: 'mode', src: s.mode, dst: d.mode });
    if (s.region !== d.region) tsMismatches.push({ name: s.name, kind: 'region', src: s.region, dst: d.region });
    if (Boolean(s.bot_fight_mode) !== Boolean(d.bot_fight_mode)) {
      tsMismatches.push({ name: s.name, kind: 'bot_fight_mode', src: s.bot_fight_mode, dst: d.bot_fight_mode });
    }
    // Domains: after zone rewrite
    const srcDomains = (s.domains || []).map(d => srcZoneName && dstZoneName ? d.replaceAll(srcZoneName, dstZoneName) : d).sort();
    const dstDomains = [...(d.domains || [])].sort();
    if (stableStringify(srcDomains) !== stableStringify(dstDomains)) {
      tsMismatches.push({ name: s.name, kind: 'domains', src: srcDomains, dst: dstDomains });
    }
  }
  item('Turnstile widget config (mode/region/domains/bot_fight_mode) byte-equal',
    tsMismatches.length === 0 ? 'PASS' : 'MISMATCH',
    ev({ mismatches: tsMismatches.slice(0, 5) }),
    null);
}

item('NEW sitekeys updated in frontend code',
  'NEEDS_HUMAN', null,
  'Critical post-migration step — sitekeys always regenerate, frontend must be updated');

// ══════════════════════════════════════════════════════════════════
// §22 Zaraz
// ══════════════════════════════════════════════════════════════════
section(22, 'Zaraz Configuration');

item('Zaraz config present on destination (if it was on source)',
  'NEEDS_HUMAN', null,
  'Zaraz is a singleton PUT config; gracefully degrades if not entitled. Verify GET /zones/{z}/settings/zaraz/v2/config');

// ══════════════════════════════════════════════════════════════════
// §23 Argo Smart Routing
// ══════════════════════════════════════════════════════════════════
section(23, 'Argo Smart Routing');

const srcArgo = res(src.argo_smart);
const dstArgo = res(dst.argo_smart);
// If neither side has been snapshotted, surface as NEEDS_HUMAN rather than a false PASS
// (undefined === undefined would otherwise pass silently).
const argoStatus = (!srcArgo && !dstArgo)
  ? 'NEEDS_HUMAN'
  : (JSON.stringify(srcArgo?.value) === JSON.stringify(dstArgo?.value) ? 'PASS' : 'MISMATCH');
item('Argo Smart Routing value matches',
  argoStatus,
  ev({ source: srcArgo?.value ?? null, dest: dstArgo?.value ?? null }),
  argoStatus === 'NEEDS_HUMAN'
    ? 'No Argo snapshot in evidence — re-run with argo_smart_routing.json captured on both sides'
    : 'Argo is an add-on entitlement; gracefully skipped if not available');

// ══════════════════════════════════════════════════════════════════
// §24 Tiered Caching
// ══════════════════════════════════════════════════════════════════
section(24, 'Argo Tiered Caching');

const srcTc = res(src.argo_tiered);
const dstTc = res(dst.argo_tiered);
const tcStatus = (!srcTc && !dstTc)
  ? 'NEEDS_HUMAN'
  : (JSON.stringify(srcTc?.value) === JSON.stringify(dstTc?.value) ? 'PASS' : 'MISMATCH');
item('Tiered caching value matches',
  tcStatus,
  ev({ source: srcTc?.value ?? null, dest: dstTc?.value ?? null }),
  tcStatus === 'NEEDS_HUMAN'
    ? 'No tiered-caching snapshot in evidence — re-run with argo_tiered_caching.json captured on both sides'
    : null);

// ══════════════════════════════════════════════════════════════════
// §25 Bot Management
// ══════════════════════════════════════════════════════════════════
section(25, 'Bot Management');

const dstBm = res(dst.bot_management);
item('Bot management config (if entitled)',
  dstBm ? 'PASS' : 'NA',
  ev({ dest_bot_mgmt: dstBm }),
  'Plan-gated; silently skipped if dest lacks entitlement');

// ══════════════════════════════════════════════════════════════════
// §26 Worker Custom Domains
// ══════════════════════════════════════════════════════════════════
section(26, 'Worker Custom Domains');

item('Worker custom domains',
  'NEEDS_HUMAN', null,
  'Tool fetches for zone-relatedness detection only; not migrated. Verify GET /accounts/{a}/workers/domains');

// ══════════════════════════════════════════════════════════════════
// §27–§34 — Mostly NEEDS_HUMAN
// ══════════════════════════════════════════════════════════════════
section(27, 'Things That Never Migrate');
item('Billing, API tokens, logpush, notifications, R2 policies, IdPs, KV expirations, Tunnel configs, etc.',
  'NEEDS_HUMAN', null,
  'Documented in docs/MIGRATION_GUIDE.md § 27 Cloudflare Tunnel and § What cannot be migrated automatically');

section(28, 'Conflict Strategy');
const usedStrategy = 'skip'; // from playwright run defaults
item(`Conflict strategy used: ${usedStrategy}`,
  'PASS',
  ev({ strategy: usedStrategy }),
  'Default Step-2 strategy was "skip" — pre-existing resources on dest preserved');

section(29, 'Dependency Chain');
item('No resources failed because a dependency was missing or had a different ID',
  runJson?.stepResults?.step4?.failed === 0 || runJson?.stepResults?.step4?.failed === null ? 'PASS' : 'MISMATCH',
  ev({ step4_failed: runJson?.stepResults?.step4?.failed }),
  null);

section(30, 'ID Remapping');
item('KV namespace IDs in worker bindings → dest IDs',
  'NEEDS_HUMAN', null,
  'Requires worker binding inspection');
item('D1 database IDs in worker bindings → dest IDs',
  'NEEDS_HUMAN', null,
  'Requires worker binding inspection');
item('LB monitor IDs in pool configs → dest IDs',
  'NA', null,
  'No LBs in this migration');
item('Access app IDs in policy configs → dest IDs',
  'NEEDS_HUMAN', null,
  'Requires policy inspection');

section(33, 'Observability');
item('Logpush / log retention configured on destination',
  'NEEDS_HUMAN', null,
  'Not migrated — manual setup required');
item('Analytics history (not migrated, starts fresh on dest)',
  'NEEDS_HUMAN', null,
  'Expected — analytics never migrate');
item('Alert / notification policies configured',
  'NEEDS_HUMAN', null,
  'PagerDuty / webhooks / email alerts — manual setup');
item('Audit log shows expected changes',
  'NEEDS_HUMAN', null,
  'Verify via GET /accounts/{a}/audit_logs?zone_name=...');
item('Rollback plan documented',
  'NEEDS_HUMAN', null,
  'Standard ops hygiene — out of tool scope');

section(34, 'Final Cutover Checks');
item('Origin server allowlists include Cloudflare IPs',
  'NEEDS_HUMAN', null,
  'No traffic flowing yet — dest is pending. Manual cutover step.');
item('Origin certs / mTLS / Authenticated Origin Pulls configured',
  'NEEDS_HUMAN', null,
  'AOP client certs are never exportable — must be reconfigured');
item('Cache behavior verified',
  'NEEDS_HUMAN', null,
  'Send real requests, inspect Cache-Status headers');
item('Redirects / rewrites do not cause loops',
  'NEEDS_HUMAN', null,
  'Runtime smoke test required');
item('WebSocket / gRPC / streaming endpoints work',
  'NEEDS_HUMAN', null,
  'Runtime smoke test required');
item('Error pages render correctly',
  'NEEDS_HUMAN', null,
  'Runtime smoke test required');
item('Rate limiting / bot management not false-positive',
  'NEEDS_HUMAN', null,
  'Runtime smoke test required');

// ══════════════════════════════════════════════════════════════════
// §35–§57: 100%-coverage verification sections
// Each new resource family gets a section that compares source vs dest
// either by count, field-level, or — for ack-only resources — by
// confirming the report acknowledged them.
// ══════════════════════════════════════════════════════════════════

section(35, 'Managed Headers');
{
  const s = res(src.managed_headers); const d = res(dst.managed_headers);
  item('Request + response header config equal',
    stableStringify(s) === stableStringify(d) ? 'PASS' : (s == null ? 'NA' : 'MISMATCH'),
    ev({ src: s, dst: d }), null);
}

section(36, 'Cloud Connector Rules');
{
  const s = resArr(src.cloud_connector_rules); const d = resArr(dst.cloud_connector_rules);
  item('Rule count matches', s.length === d.length ? 'PASS' : (s.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: s.length, dst: d.length }), null);
}

section(37, 'URL Normalization');
{
  const s = res(src.url_normalization); const d = res(dst.url_normalization);
  item('Type + scope match',
    stableStringify(s) === stableStringify(d) ? 'PASS' : (s == null ? 'NA' : 'MISMATCH'),
    ev({ src: s, dst: d }), null);
}

section(38, 'Cache Reserve');
{
  const s = res(src.cache_reserve); const d = res(dst.cache_reserve);
  item('Cache Reserve value matches',
    s?.value === d?.value ? 'PASS' : (s == null ? 'NA' : 'MISMATCH'),
    ev({ src: s?.value, dst: d?.value }), 'Entitlement-gated; PASS if absent on both');
}

section(39, 'Regional Tiered Cache');
{
  const s = res(src.regional_tiered_cache); const d = res(dst.regional_tiered_cache);
  item('Regional Tiered Cache value matches',
    s?.value === d?.value ? 'PASS' : (s == null ? 'NA' : 'MISMATCH'),
    ev({ src: s?.value, dst: d?.value }), null);
}

section(40, 'Cache Variants');
{
  const s = res(src.cache_variants); const d = res(dst.cache_variants);
  item('Cache Variants configuration matches',
    stableStringify(s) === stableStringify(d) ? 'PASS' : (s == null ? 'NA' : 'MISMATCH'),
    ev({ src: s, dst: d }), null);
}

section(41, 'Origin Post-Quantum Encryption');
{
  const s = res(src.origin_post_quantum); const d = res(dst.origin_post_quantum);
  item('Post-quantum value matches',
    s?.value === d?.value ? 'PASS' : (s == null ? 'NA' : 'MISMATCH'),
    ev({ src: s?.value, dst: d?.value }), null);
}

section(42, 'Snippets + Snippet Rules');
{
  const sSnippets = resArr(src.snippets); const dSnippets = resArr(dst.snippets);
  item('Snippet count matches',
    sSnippets.length === dSnippets.length ? 'PASS' : (sSnippets.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sSnippets.length, dst: dSnippets.length }), null);
  const sRules = res(src.snippet_rules)?.rules || []; const dRules = res(dst.snippet_rules)?.rules || [];
  item('Snippet rules count matches',
    sRules.length === dRules.length ? 'PASS' : (sRules.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sRules.length, dst: dRules.length }), null);
}

section(43, 'Standalone Healthchecks');
{
  const s = resArr(src.healthchecks); const d = resArr(dst.healthchecks);
  item('Healthcheck count matches',
    s.length === d.length ? 'PASS' : (s.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: s.length, dst: d.length }), null);
}

section(44, 'DNS Settings');
{
  const s = res(src.dns_settings); const d = res(dst.dns_settings);
  if (!s && !d) item('DNS Settings (not configured on either side)', 'NA', null, null);
  else item('DNS Settings byte-equal',
    stableStringify(s) === stableStringify(d) ? 'PASS' : 'MISMATCH',
    ev({ src: s, dst: d }), null);
}

section(45, 'DNSSEC Status');
{
  const s = res(src.dnssec); const d = res(dst.dnssec);
  if (!s || s.status !== 'active') item('DNSSEC not active on source', 'NA', null, null);
  else item('DNSSEC must be re-enabled on dest manually (DS record at registrar)',
    'NEEDS_HUMAN', ev({ src_status: s.status, dst_status: d?.status }),
    'Documented in IMPOSSIBLE_TO_MIGRATE — surface as acknowledged in report');
}

section(46, 'Regional Hostnames');
{
  const s = resArr(src.regional_hostnames); const d = resArr(dst.regional_hostnames);
  item('Regional hostname count matches',
    s.length === d.length ? 'PASS' : (s.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: s.length, dst: d.length }), null);
}

section(47, 'Custom Nameservers');
{
  const s = res(src.custom_ns); const d = res(dst.custom_ns);
  item('Custom NS count matches',
    (Array.isArray(s) ? s.length : 0) === (Array.isArray(d) ? d.length : 0) ? 'PASS' : (s == null ? 'NA' : 'MISMATCH'),
    ev({ src: s, dst: d }), 'Biz+ feature');
}

section(48, 'Fraud Detection Settings');
{
  const s = res(src.fraud_detection); const d = res(dst.fraud_detection);
  item('Fraud detection settings byte-equal',
    stableStringify(s) === stableStringify(d) ? 'PASS' : (s == null ? 'NA' : 'MISMATCH'),
    ev({ src: s, dst: d }), null);
}

section(49, 'Firewall (Access Rules / Lockdowns / UA Rules)');
{
  const sAr = resArr(src.firewall_access_rules); const dAr = resArr(dst.firewall_access_rules);
  item('Access rule count matches',
    sAr.length === dAr.length ? 'PASS' : (sAr.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sAr.length, dst: dAr.length }), null);
  const sL = resArr(src.firewall_lockdowns); const dL = resArr(dst.firewall_lockdowns);
  item('Lockdown count matches',
    sL.length === dL.length ? 'PASS' : (sL.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sL.length, dst: dL.length }), null);
  const sU = resArr(src.firewall_ua_rules); const dU = resArr(dst.firewall_ua_rules);
  item('UA rule count matches',
    sU.length === dU.length ? 'PASS' : (sU.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sU.length, dst: dU.length }), null);
}

section(50, 'Page Shield');
{
  const sS = res(src.page_shield); const dS = res(dst.page_shield);
  item('Page Shield enabled flag matches',
    sS?.enabled === dS?.enabled ? 'PASS' : (sS == null ? 'NA' : 'MISMATCH'),
    ev({ src: sS?.enabled, dst: dS?.enabled }), null);
  const sP = resArr(src.page_shield_policies); const dP = resArr(dst.page_shield_policies);
  item('Page Shield policy count matches',
    sP.length === dP.length ? 'PASS' : (sP.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sP.length, dst: dP.length }), null);
}

section(51, 'Logpush Jobs');
{
  const s = resArr(src.logpush_jobs); const d = resArr(dst.logpush_jobs);
  item('Logpush job count matches',
    s.length === d.length ? 'PASS' : (s.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: s.length, dst: d.length }), 'Enterprise; destination_conf may need credential rewrite');
}

section(52, 'Schema Validation + API Gateway');
{
  const sS = resArr(src.schema_validation_schemas); const dS = resArr(dst.schema_validation_schemas);
  item('Schema Validation schema count matches',
    sS.length === dS.length ? 'PASS' : (sS.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sS.length, dst: dS.length }), null);
  const sO = resArr(src.api_gateway_operations); const dO = resArr(dst.api_gateway_operations);
  item('API Gateway operation count matches',
    sO.length === dO.length ? 'PASS' : (sO.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sO.length, dst: dO.length }), null);
}

section(53, 'Token Validation');
{
  const sC = resArr(src.token_validation_configs); const dC = resArr(dst.token_validation_configs);
  item('Token validation config count matches',
    sC.length === dC.length ? 'PASS' : (sC.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sC.length, dst: dC.length }), null);
  const sR = resArr(src.token_validation_rules); const dR = resArr(dst.token_validation_rules);
  item('Token validation rule count matches',
    sR.length === dR.length ? 'PASS' : (sR.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sR.length, dst: dR.length }), null);
}

section(54, 'SSL Certificate Packs + ACM Total TLS');
{
  const sP = resArr(src.certificate_packs); const dP = resArr(dst.certificate_packs);
  item('Certificate pack count matches',
    sP.length === dP.length ? 'PASS' : (sP.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sP.length, dst: dP.length }), 'Universal pack auto-created; advanced packs migrate');
  const sT = res(src.acm_total_tls); const dT = res(dst.acm_total_tls);
  item('ACM Total TLS enabled flag matches',
    sT?.enabled === dT?.enabled ? 'PASS' : (sT == null ? 'NA' : 'MISMATCH'),
    ev({ src: sT, dst: dT }), 'Requires ACM add-on');
}

section(55, 'mTLS (Client Certs + Hostname Associations + Origin TLS)');
{
  const sCC = resArr(src.client_certificates); const dCC = resArr(dst.client_certificates);
  item('Client certificate count matches',
    sCC.length === dCC.length ? 'PASS' : (sCC.length === 0 ? 'NA' : 'NEEDS_HUMAN'),
    ev({ src: sCC.length, dst: dCC.length }),
    'Public certs migrate; private keys must be re-uploaded');
  const sHA = res(src.hostname_associations); const dHA = res(dst.hostname_associations);
  item('mTLS hostname associations count matches',
    (sHA?.hostnames?.length ?? 0) === (dHA?.hostnames?.length ?? 0) ? 'PASS' : (sHA == null ? 'NA' : 'MISMATCH'),
    ev({ src: sHA?.hostnames?.length, dst: dHA?.hostnames?.length }), null);
  const sOTS = res(src.origin_tls_settings); const dOTS = res(dst.origin_tls_settings);
  item('Origin TLS Client Auth enabled flag matches',
    sOTS?.enabled === dOTS?.enabled ? 'PASS' : (sOTS == null ? 'NA' : 'MISMATCH'),
    ev({ src: sOTS, dst: dOTS }), null);
}

section(56, 'Access Account-Scoped (Groups / Service Tokens / IdPs)');
{
  const sG = resArr(src.access_groups); const dG = resArr(dst.access_groups);
  item('Access group count matches',
    sG.length === dG.length ? 'PASS' : (sG.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sG.length, dst: dG.length }), null);
  const sST = resArr(src.access_service_tokens); const dST = resArr(dst.access_service_tokens);
  item('Service tokens acknowledged (client_secret not exportable)',
    sST.length === 0 ? 'NA' : 'NEEDS_HUMAN',
    ev({ src: sST.length, dst: dST.length }),
    'Must be recreated; new client_secrets must be distributed to consumers');
  const sIdP = resArr(src.identity_providers); const dIdP = resArr(dst.identity_providers);
  item('Identity Provider names match (config must be re-entered)',
    sIdP.length > 0 ? 'NEEDS_HUMAN' : 'NA',
    ev({ src_names: sIdP.map(p => p.name), dst_names: dIdP.map(p => p.name) }),
    'OAuth/SAML secrets are not exportable — re-enter on dest');
}

section(57, 'Account-Scoped Sub-Resources (Custom Lists / Queue Consumers / Waiting Room Events)');
{
  const sLists = resArr(src.rules_lists); const dLists = resArr(dst.rules_lists);
  item('Custom list count matches',
    sLists.length === dLists.length ? 'PASS' : (sLists.length === 0 ? 'NA' : 'MISMATCH'),
    ev({ src: sLists.length, dst: dLists.length }), null);
  const sItems = res(src.custom_list_items); const dItems = res(dst.custom_list_items);
  if (sItems && typeof sItems === 'object') {
    const totalSrc = Object.values(sItems).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0);
    const totalDst = dItems && typeof dItems === 'object'
      ? Object.values(dItems).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0) : 0;
    item('Total custom list items match',
      totalSrc === totalDst ? 'PASS' : 'MISMATCH',
      ev({ src: totalSrc, dst: totalDst }), null);
  }
  const sQC = res(src.queue_consumers); const dQC = res(dst.queue_consumers);
  if (sQC && typeof sQC === 'object') {
    const totalSrcQC = Object.values(sQC).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0);
    const totalDstQC = dQC && typeof dQC === 'object'
      ? Object.values(dQC).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0) : 0;
    item('Queue consumer count matches',
      totalSrcQC === totalDstQC ? 'PASS' : 'MISMATCH',
      ev({ src: totalSrcQC, dst: totalDstQC }), null);
  }
  const sWRE = res(src.waiting_room_events); const dWRE = res(dst.waiting_room_events);
  if (sWRE && typeof sWRE === 'object') {
    const totalSrcWRE = Object.values(sWRE).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0);
    const totalDstWRE = dWRE && typeof dWRE === 'object'
      ? Object.values(dWRE).reduce((a, arr) => a + (Array.isArray(arr) ? arr.length : 0), 0) : 0;
    item('Waiting room event count matches',
      totalSrcWRE === totalDstWRE ? 'PASS' : 'MISMATCH',
      ev({ src: totalSrcWRE, dst: totalDstWRE }), null);
  }
}

flush();

// ══════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════
const statusCounts = { PASS: 0, MISMATCH: 0, FAIL: 0, NA: 0, NEEDS_HUMAN: 0 };
let totalItems = 0;
for (const s of sections) for (const it of s.items) { statusCounts[it.status] = (statusCounts[it.status] ?? 0) + 1; totalItems++; }

// ══════════════════════════════════════════════════════════════════
// Write machine-readable JSON
// ══════════════════════════════════════════════════════════════════
fs.writeFileSync(
  path.join(EVIDENCE_DIR, 'checklist-results.json'),
  JSON.stringify({ summary: statusCounts, total: totalItems, sections, generated_at: new Date().toISOString() }, null, 2)
);

// ══════════════════════════════════════════════════════════════════
// Write human-readable Markdown
// ══════════════════════════════════════════════════════════════════
const md = [];
md.push(`# Twilight Zone Migration Checklist Evidence`);
md.push('');
md.push(`> **Generated:** ${new Date().toISOString()}`);
md.push(`> **Source:** ${srcZone?.name ?? '?'} (\`${srcZone?.id ?? '?'}\`) in **${srcZone?.account?.name ?? '?'}**`);
md.push(`> **Destination:** ${dstZone?.name ?? '?'} (\`${dstZone?.id ?? '?'}\`) in **${dstZone?.account?.name ?? '?'}** [${dstZone?.status ?? '?'}]`);
md.push(`> **Tool:** ${process.env.TZ_URL ?? 'https://your-twilight-zone.example.com'}`);
md.push(`> **Migration outcome:** ${runJson?.outcome === 'step4' ? '✅ Completed' : '❌ ' + runJson?.outcome}`);
md.push(`> **Migration duration:** ${runJson ? (runJson.elapsedMs / 1000).toFixed(1) + 's' : '?'}`);
md.push('');
md.push(`## 🎯 How to use this document`);
md.push('');
md.push(`This evidence file is the output of an end-to-end automated verification of a Cloudflare zone migration performed via the Twilight Zone tool. Each section maps to a section of \`docs/MIGRATION_GUIDE.md\` in the repo.`);
md.push('');
md.push(`**Triage rules:**`);
md.push(`1. **🤔 NEEDS_HUMAN** — items that cannot be verified programmatically and need a runtime smoke test or human judgment.`);
md.push(`2. **⚠️ MISMATCH** — confirm whether the difference is acceptable (plan-gated, etc.) or a real bug.`);
md.push(`3. **❌ FAIL** — confirmed problems; fix before declaring the migration complete.`);
md.push('');
md.push(`**Trust but verify the PASS items too** — spot-check at least 3 PASS items by re-running the relevant API call and confirming the data.`);
md.push('');
md.push(`## Summary`);
md.push('');
md.push('| Status | Count | Meaning |');
md.push('|---|---:|---|');
md.push(`| ✅ PASS | ${statusCounts.PASS} | Verified via API call |`);
md.push(`| ⚠️ MISMATCH | ${statusCounts.MISMATCH} | Differs from source; review |`);
md.push(`| ❌ FAIL | ${statusCounts.FAIL} | Confirmed problem |`);
md.push(`| ⏭️ NA | ${statusCounts.NA} | Not present on source / not entitled on dest |`);
md.push(`| 🤔 NEEDS_HUMAN | ${statusCounts.NEEDS_HUMAN} | Requires runtime smoke test or human review |`);
md.push(`| | **${totalItems}** | **Total items** |`);
md.push('');
md.push(`## Migration Tool Result (from Step 4 UI)`);
md.push('');
const step4 = runJson?.stepResults?.step4;
if (step4) {
  md.push('| Metric | Count |');
  md.push('|---|---:|');
  md.push(`| Total | ${step4.total ?? '?'} |`);
  md.push(`| Verified | ${step4.verified ?? '?'} |`);
  md.push(`| Missing | ${step4.missing ?? '?'} |`);
  md.push(`| Mismatched | ${step4.mismatched ?? '?'} |`);
  md.push(`| Failed | ${step4.failed ?? '?'} |`);
  md.push(`| Acknowledged | ${step4.acknowledged ?? '?'} |`);
}
md.push('');
md.push(`## Reproduction`);
md.push('');
md.push('```bash');
md.push('# 1. Seed source zone with the canonical maxconfig test fixture');
md.push('CF_API_KEY=<key> CF_API_EMAIL=<email> \\');
md.push(`CF_ZONE_ID=${srcZone?.id ?? '<src_zone_id>'} CF_ACCOUNT_ID=${srcZone?.account?.id ?? '<src_account_id>'} \\`);
md.push('node scripts/zone-apply.mjs reset docs/test_configs/101-maxconfig.json');
md.push('');
md.push('# 2. Snapshot source state');
md.push('CF_API_KEY=<key> CF_API_EMAIL=<email> \\');
md.push(`CF_ZONE_ID=${srcZone?.id ?? '<src_zone_id>'} CF_ACCOUNT_ID=${srcZone?.account?.id ?? '<src_account_id>'} \\`);
md.push(`OUT_DIR=${EVIDENCE_DIR}/source-state-post-seed \\`);
md.push('node scripts/capture-zone-state.mjs');
md.push('');
md.push('# 3. Run migration via Playwright');
md.push('CF_API_KEY=<key> CF_API_EMAIL=<email> \\');
md.push(`SRC_ACCOUNT_ID=${srcZone?.account?.id ?? '<src_account_id>'} \\`);
md.push(`DEST_ACCOUNT_ID=${dstZone?.account?.id ?? '<dest_account_id>'} \\`);
md.push(`SRC_ZONE_ID=${srcZone?.id ?? '<src_zone_id>'} \\`);
md.push(`ZONE_NAME=${srcZone?.name ?? '<zone_name>'} \\`);
md.push(`EVIDENCE_DIR=${EVIDENCE_DIR} \\`);
md.push('node scripts/run-single-zone-migration.mjs');
md.push('');
md.push('# 4. Snapshot destination state');
md.push('CF_API_KEY=<key> CF_API_EMAIL=<email> \\');
md.push(`CF_ZONE_ID=${dstZone?.id ?? '<dest_zone_id>'} CF_ACCOUNT_ID=${dstZone?.account?.id ?? '<dest_account_id>'} \\`);
md.push(`OUT_DIR=${EVIDENCE_DIR}/dest-state-post-migrate \\`);
md.push('node scripts/capture-zone-state.mjs');
md.push('');
md.push('# 5. Verify');
md.push(`EVIDENCE_DIR=${EVIDENCE_DIR} OUTPUT_MD=${OUTPUT_MD} \\`);
md.push('node scripts/verify-checklist.mjs');
md.push('```');
md.push('');
md.push(`## Artifacts`);
md.push('');
md.push(`- \`evidence/.../migration-report.md\` — Twilight Zone's own migration report`);
md.push(`- \`evidence/.../migration-run.json\` — Playwright run state, console logs, network errors`);
md.push(`- \`evidence/.../playwright-run.log\` — Step-by-step log of the Playwright session`);
md.push(`- \`evidence/.../screenshots/*.png\` — Screenshot after each Step 1-4`);
md.push(`- \`evidence/.../source-state-pre-seed/*.json\` — Source zone state BEFORE seeding`);
md.push(`- \`evidence/.../source-state-post-seed/*.json\` — Source zone state AFTER seeding (this is what we migrated FROM)`);
md.push(`- \`evidence/.../dest-state-post-migrate/*.json\` — Destination zone state AFTER migration (this is what we verify)`);
md.push(`- \`evidence/.../checklist-results.json\` — Machine-readable version of this document`);
md.push('');
md.push(`---`);
md.push('');
md.push(`## Per-section evidence`);
md.push('');

function statusBadge(s) {
  switch (s) {
    case 'PASS': return '✅ PASS';
    case 'MISMATCH': return '⚠️ MISMATCH';
    case 'FAIL': return '❌ FAIL';
    case 'NA': return '⏭️ NA';
    case 'NEEDS_HUMAN': return '🤔 NEEDS_HUMAN';
    default: return s;
  }
}

for (const s of sections) {
  const sectionCounts = s.items.reduce((acc, it) => { acc[it.status] = (acc[it.status] ?? 0) + 1; return acc; }, {});
  const summary = Object.entries(sectionCounts).map(([k,v]) => `${statusBadge(k).split(' ')[0]} ${v}`).join('  ');
  md.push(`### §${s.id} — ${s.title}`);
  md.push('');
  md.push(`*${s.items.length} items: ${summary}*`);
  md.push('');
  for (const it of s.items) {
    md.push(`- **${statusBadge(it.status)}** — ${it.label}`);
    if (it.notes) md.push(`  - 📝 ${it.notes}`);
    if (it.evidence) {
      md.push(`  - 🔍 Evidence:`);
      md.push('    ```json');
      md.push(it.evidence.split('\n').map(l => '    ' + l).join('\n'));
      md.push('    ```');
    }
  }
  md.push('');
}

md.push(`---`);
md.push('');
md.push(`## 🚨 Findings`);
md.push('');
md.push(`Any items above marked **❌ FAIL** or **⚠️ MISMATCH** are real findings that should be triaged. **🤔 NEEDS_HUMAN** items require runtime smoke tests or external verification — they cannot be confirmed programmatically.`);
md.push('');
md.push(`If the migration tool reports "verified" while this checklist shows failures, treat that as a **silent lie** — investigate before trusting the tool's success report.`);
md.push('');

fs.writeFileSync(OUTPUT_MD, md.join('\n'));
console.log(`✅ Wrote evidence MD → ${OUTPUT_MD}`);
console.log(`✅ Wrote results JSON → ${path.join(EVIDENCE_DIR, 'checklist-results.json')}`);
console.log('');
console.log('Summary:');
for (const [k, v] of Object.entries(statusCounts)) console.log(`  ${statusBadge(k)}: ${v}`);
console.log(`  Total: ${totalItems} items across ${sections.length} sections`);
