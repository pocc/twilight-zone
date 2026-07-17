#!/usr/bin/env node
/**
 * Cloudflare API Coverage Report — Feature-grouped, endpoint-granular.
 *
 * Inputs (all generated, all read-only):
 *   - coverage/openapi-writes.generated.json     (run scripts/generate-openapi-manifest.mjs)
 *   - coverage/sdk-index.generated.json          (run scripts/extract-sdk-index.mjs)
 *   - coverage/tz-coverage.generated.json        (run scripts/extract-tz-coverage.mjs)
 *   - scripts/feature-taxonomy.json              (hand-curated)
 *   - src/types.ts                               (IMPOSSIBLE_TO_MIGRATE catalog)
 *
 * For every POST/PATCH/PUT write endpoint in the OpenAPI spec, this script
 * classifies it into one of five statuses:
 *
 *   verified      Implemented by Twilight Zone AND covered by an e2e test
 *                 (e01-everything.json or a focused test). GET-back matches.
 *
 *   implemented   Implemented by Twilight Zone, no explicit e2e verification.
 *
 *   impossible    Listed in IMPOSSIBLE_TO_MIGRATE (cryptographic, account-tied,
 *                 auto-managed, read-only, data-ephemeral, data-offline,
 *                 manual-external). The user is asked to acknowledge.
 *
 *   out_of_scope  Belongs to a feature flagged in_scope=false in the taxonomy
 *                 (account admin, Magic Networking, AI/run, Zero Trust admin
 *                 surfaces, etc.). Not part of zone-migration scope.
 *
 *   gap           In-scope feature, no implementation, no acknowledgement. A
 *                 real gap that should be closed by adding code or moving the
 *                 endpoint to IMPOSSIBLE_TO_MIGRATE.
 *
 * Endpoints not in the public cloudflare-typescript SDK are still counted
 * (they exist on the API surface) but they're marked `not_in_sdk: true` so
 * they don't dominate the gap list — they're frequently internal or
 * deprecated paths that Cloudflare hasn't shipped in the SDK.
 *
 * Usage:
 *   node scripts/coverage-report.mjs                 # Human report to stdout
 *   node scripts/coverage-report.mjs --json          # Machine-readable JSON
 *   node scripts/coverage-report.mjs --gaps          # Only show gap endpoints
 *   node scripts/coverage-report.mjs --feature dns   # Drill into one feature
 *   node scripts/coverage-report.mjs --write-md      # Regenerate docs/COVERAGE.md
 *   node scripts/coverage-report.mjs --check         # CI gate
 *
 * No network calls.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadJson(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    console.error(`Missing input: ${rel}`);
    console.error(`Regenerate it. See header comment in scripts/coverage-report.mjs.`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

const writes = loadJson('src/openapi-writes.generated.json');
const sdk = loadJson('coverage/sdk-index.generated.json');
const tz = loadJson('coverage/tz-coverage.generated.json');
const taxonomy = loadJson('scripts/feature-taxonomy.json');

// Per-endpoint overrides — endpoints we deliberately do NOT count as gaps
// because they fall into one of the well-known not-really-a-gap categories
// (data_plane, imperative_action, redundant_with_put, dual_scope_covered,
// sub_feature_oos). Each override entry MUST correspond to a real OpenAPI
// endpoint; the CI gate fails on stale entries.
//
// `newer_subfeature` is intentionally NOT a not-really-a-gap reason. It means
// the endpoint has been triaged but is still unsupported, so it must keep the
// ratchet red instead of inflating coverage to 100%.
//
// The file is optional — coverage-report.mjs works without it (degraded:
// no narrowing happens, gap counts include the broader set).
const overridesPath = path.join(ROOT, 'scripts/coverage-overrides.json');
const overridesFile = fs.existsSync(overridesPath)
  ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
  : { overrides: {} };
const overrides = overridesFile.overrides || {};
const GAP_OVERRIDE_REASONS = new Set(['newer_subfeature']);

function isExcludedOverride(override) {
  return Boolean(override && override.reason && !GAP_OVERRIDE_REASONS.has(override.reason));
}

// ── Load IMPOSSIBLE_TO_MIGRATE catalogue from src/types.ts ───────────
const typesSrc = fs.readFileSync(path.join(ROOT, 'src', 'types.ts'), 'utf8');
const impossibleStart = typesSrc.indexOf('export const IMPOSSIBLE_TO_MIGRATE');
const impossibleEnd = typesSrc.indexOf('] as const);', impossibleStart);
const impossibleBlock = impossibleStart >= 0 ? typesSrc.slice(impossibleStart, impossibleEnd) : '';
const impossibleKeyRe = /key:\s*['"]([^'"]+)['"]/g;
const impossibleKeys = new Set();
let m;
while ((m = impossibleKeyRe.exec(impossibleBlock)) !== null) impossibleKeys.add(m[1]);

// Feature path-prefix → feature map, deepest match wins.
function shape(p) {
  return p.replace(/\{[^}]+\}/g, '{}');
}
const taxonomyPrefixes = [];
for (const f of taxonomy.features) {
  for (const prefix of f.path_prefixes) {
    taxonomyPrefixes.push({ shape: shape(prefix), feature: f });
  }
}
taxonomyPrefixes.sort((a, b) => b.shape.length - a.shape.length);

function classifyFeature(opPath) {
  const s = shape(opPath);
  for (const { shape: ps, feature } of taxonomyPrefixes) {
    if (s === ps || s.startsWith(ps + '/')) return feature;
  }
  return null;
}

// ── Build endpoint → status table ────────────────────────────────────
const sdkShapeIndex = sdk.by_shape_method;
const tzImplementedSet = new Set(tz.endpoints_implemented_keys);
const tzReachableSet = new Set(tz.endpoints_reachable_from_migrate_keys);

// Map a feature.id → impossible_key (allow some features to be entirely
// impossible-acknowledged even though they have endpoints). Hand-curated
// list keyed on taxonomy feature ID.
const FEATURE_IMPOSSIBLE_MARKERS = {
  keyless_ssl: 'keyless_ssl_keys',
  security_center: 'waf_attack_score',
  brand_protection: null,         // not in IMPOSSIBLE, but out_of_scope handles it
};

const endpoints = [];
for (const op of writes.operations) {
  if (op.method === 'DELETE') {
    // DELETEs are not part of *migration* coverage — Twilight Zone never
    // deletes resources on the destination. We still record them in the
    // raw count for completeness, but mark status = 'na_delete'.
    const feat = classifyFeature(op.path);
    endpoints.push({
      method: op.method,
      path: op.path,
      path_shape: shape(op.path),
      feature_id: feat ? feat.id : null,
      feature_name: feat ? feat.name : '(uncategorized)',
      in_scope: feat ? feat.in_scope : false,
      in_sdk: Boolean(sdkShapeIndex[`${op.method} ${shape(op.path)}`]),
      deprecated: Boolean(op.deprecated),
      status: 'na_delete',
      operation_id: op.operationId,
    });
    continue;
  }

  const sk = `${op.method} ${shape(op.path)}`;
  const feat = classifyFeature(op.path);
  const featureId = feat ? feat.id : null;
  const inScope = feat ? feat.in_scope : false;
  const inSdk = Boolean(sdkShapeIndex[sk]);
  const isReachable = tzReachableSet.has(sk);

  let status;
  if (!feat) {
    status = 'gap';  // unclassified endpoint — shouldn't happen but be safe
  } else if (!inScope) {
    // Out-of-scope feature. If the feature corresponds to an IMPOSSIBLE key,
    // surface it as impossible (more informative than out_of_scope).
    const impossibleMarker = FEATURE_IMPOSSIBLE_MARKERS[featureId];
    if (impossibleMarker && impossibleKeys.has(impossibleMarker)) {
      status = 'impossible';
    } else {
      status = 'out_of_scope';
    }
  } else if (isReachable) {
    // TZ implements this endpoint AND it's reached from migrate code.
    // (We don't yet have automated e2e linkage; verified vs implemented
    // would require parsing test outcomes. For now everything reachable
    // is 'implemented'.)
    status = 'implemented';
  } else {
    // Not implemented. Check the per-endpoint overrides file before
    // declaring it a gap. Covered exclusion reasons re-categorise the endpoint
    // as 'excluded'. reason:null and reason:newer_subfeature remain gaps; the
    // former is untriaged and the latter is triaged-but-unsupported.
    const override = overrides[sk];
    if (isExcludedOverride(override)) {
      status = 'excluded';
    } else {
      status = 'gap';
    }
  }

  const baseEndpoint = {
    method: op.method,
    path: op.path,
    path_shape: shape(op.path),
    feature_id: featureId,
    feature_name: feat ? feat.name : '(uncategorized)',
    in_scope: inScope,
    in_sdk: inSdk,
    deprecated: Boolean(op.deprecated),
    status,
    operation_id: op.operationId,
  };
  // Attach override metadata if present so the JSON output is auditable.
  if (overrides[sk]) {
    baseEndpoint.override = {
      reason: overrides[sk].reason,
      notes: overrides[sk].notes || '',
      ...(overrides[sk].covers && { covers: overrides[sk].covers }),
    };
  }
  endpoints.push(baseEndpoint);
}

// ── Stale-override check ─────────────────────────────────────────────
// Every key in scripts/coverage-overrides.json must correspond to a real
// OpenAPI endpoint. If not, the override is stale (the endpoint moved,
// was removed, or was typo'd).
const endpointKeySet = new Set(endpoints.map(e => `${e.method} ${e.path_shape}`));
const staleOverrides = [];
for (const key of Object.keys(overrides)) {
  if (!endpointKeySet.has(key)) staleOverrides.push(key);
}

// ── Aggregate by feature ─────────────────────────────────────────────
const byFeature = new Map();
for (const f of taxonomy.features) byFeature.set(f.id, {
  feature: f,
  total: 0,
  by_status: { verified: 0, implemented: 0, excluded: 0, impossible: 0, out_of_scope: 0, gap: 0, na_delete: 0 },
  by_method: { POST: 0, PATCH: 0, PUT: 0, DELETE: 0 },
  by_override_reason: {},
  endpoints: [],
});
for (const ep of endpoints) {
  if (!ep.feature_id || !byFeature.has(ep.feature_id)) continue;
  const agg = byFeature.get(ep.feature_id);
  agg.total++;
  agg.by_status[ep.status]++;
  agg.by_method[ep.method] = (agg.by_method[ep.method] || 0) + 1;
  if (ep.status === 'excluded' && ep.override && ep.override.reason) {
    agg.by_override_reason[ep.override.reason] = (agg.by_override_reason[ep.override.reason] || 0) + 1;
  }
  agg.endpoints.push(ep);
}

// ── Roll up totals ───────────────────────────────────────────────────
const statusTotals = { verified: 0, implemented: 0, excluded: 0, impossible: 0, out_of_scope: 0, gap: 0, na_delete: 0 };
const overrideReasonTotals = {};
const methodTotals = { POST: 0, PATCH: 0, PUT: 0, DELETE: 0 };
for (const ep of endpoints) {
  statusTotals[ep.status]++;
  methodTotals[ep.method] = (methodTotals[ep.method] || 0) + 1;
  if (ep.status === 'excluded' && ep.override && ep.override.reason) {
    overrideReasonTotals[ep.override.reason] = (overrideReasonTotals[ep.override.reason] || 0) + 1;
  }
}

const inScopeWrites = endpoints.filter(e => e.in_scope && e.method !== 'DELETE');
const inScopeImplemented = inScopeWrites.filter(e => e.status === 'implemented' || e.status === 'verified').length;
const inScopeExcluded = inScopeWrites.filter(e => e.status === 'excluded').length;
const inScopeGaps = inScopeWrites.filter(e => e.status === 'gap').length;
const inScopeGapsInSdk = inScopeWrites.filter(e => e.status === 'gap' && e.in_sdk).length;
// "Covered" = implemented OR formally excluded with a reason. This is the
// honest denominator for "how much of the in-scope surface is settled?"
const inScopeCovered = inScopeImplemented + inScopeExcluded;

// ── Output ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const wantGapsOnly = args.includes('--gaps');
const wantCheck = args.includes('--check');
const wantWriteMd = args.includes('--write-md');
const wantUncategorized = args.includes('--uncategorized');
const featureArgIdx = args.indexOf('--feature');
const featureFilter = featureArgIdx >= 0 ? args[featureArgIdx + 1] : null;

// ── --uncategorized: list endpoints whose path doesn't match any feature ──
// Build-time check that the feature-taxonomy.json keeps pace with new
// Cloudflare endpoints. CI fails if any endpoint can't be classified.
if (wantUncategorized) {
  const uncat = endpoints.filter(e => e.feature_id === null);
  if (uncat.length === 0) {
    console.log('✓ All endpoints classified by feature taxonomy.');
    process.exit(0);
  }
  console.error(`✗ ${uncat.length} endpoint(s) not classified by scripts/feature-taxonomy.json:`);
  // Group by deepest 2-segment prefix to make it easy to add to the taxonomy.
  const byPrefix = {};
  for (const e of uncat) {
    const segs = e.path.split('/').filter(Boolean);
    const prefix = segs.length >= 3 ? `${segs[0]}/{}/${segs[2]}` : segs.slice(0, 2).join('/');
    (byPrefix[prefix] ||= []).push(e);
  }
  for (const [prefix, eps] of Object.entries(byPrefix).sort()) {
    console.error(`  ${prefix}  (${eps.length})`);
    for (const e of eps.slice(0, 3)) console.error(`    ${e.method} ${e.path}`);
    if (eps.length > 3) console.error(`    ... and ${eps.length - 3} more`);
  }
  console.error('');
  console.error('Add the prefix to a feature\'s path_prefixes in scripts/feature-taxonomy.json,');
  console.error('or add a new feature entry if these endpoints belong to a new product surface.');
  process.exit(1);
}

function pct(n, d) { return d === 0 ? '0.0%' : ((n / d) * 100).toFixed(1) + '%'; }

if (wantJson) {
  const json = JSON.stringify({
    summary: {
      total_writes: endpoints.length,
      method_totals: methodTotals,
      status_totals: statusTotals,
      in_scope_writes: inScopeWrites.length,
      in_scope_implemented: inScopeImplemented,
      in_scope_excluded: inScopeExcluded,
      in_scope_covered: inScopeCovered,
      in_scope_gaps: inScopeGaps,
      in_scope_gaps_in_sdk: inScopeGapsInSdk,
      in_scope_coverage_pct: pct(inScopeCovered, inScopeWrites.length),
      in_scope_implementation_pct: pct(inScopeImplemented, inScopeWrites.length),
      override_reason_totals: overrideReasonTotals,
      stale_overrides: staleOverrides,
    },
    endpoints,
    by_feature: [...byFeature.values()].map(v => ({
      id: v.feature.id,
      name: v.feature.name,
      in_scope: v.feature.in_scope,
      plan: v.feature.plan_required,
      addon: v.feature.addon_required,
      entitlement: v.feature.entitlement_required,
      total: v.total,
      by_status: v.by_status,
      by_method: v.by_method,
    })),
  }, null, 2);
  await new Promise(resolve => process.stdout.write(json + '\n', resolve));
  process.exit(0);
}

const STATUS_EMOJI = {
  verified: '✅',
  implemented: '✅',
  excluded: '⚪',
  impossible: '🟡',
  out_of_scope: '⚪',
  gap: '❌',
  na_delete: '—',
};

function printHumanReport() {
  console.log('');
  console.log('═══ Cloudflare API Coverage — Twilight Zone v2 ═══════════════════════════');
  console.log('');
  console.log(`OpenAPI spec:        ${writes.api_version || 'unknown'}  (generated ${writes.generated_at.slice(0, 10)})`);
  console.log(`SDK package:         cloudflare@${getCloudflareVersion()}  (${sdk.total_entries} HTTP methods)`);
  console.log(`Twilight Zone:       ${tz.total_cf_fetch_calls} cfFetch calls in src/api.ts; ${tz.api_exports_called_from_migrate.length} api fns reached from migrate`);
  console.log('');
  console.log('Write operations by method:');
  for (const [mth, c] of Object.entries(methodTotals).sort()) {
    console.log(`  ${mth.padEnd(7)} ${c}`);
  }
  console.log('');
  console.log('Write operations by status (POST/PATCH/PUT only — DELETE shown separately):');
  console.log(`  ${STATUS_EMOJI.implemented}  Implemented    ${statusTotals.implemented.toString().padStart(4)}`);
  console.log(`  ${STATUS_EMOJI.excluded}  Excluded       ${statusTotals.excluded.toString().padStart(4)}   (formally excluded via scripts/coverage-overrides.json)`);
  console.log(`  ${STATUS_EMOJI.impossible}  Impossible     ${statusTotals.impossible.toString().padStart(4)}   (acknowledged in IMPOSSIBLE_TO_MIGRATE)`);
  console.log(`  ${STATUS_EMOJI.out_of_scope}  Out of scope   ${statusTotals.out_of_scope.toString().padStart(4)}   (account admin / non-zone-migration features)`);
  console.log(`  ${STATUS_EMOJI.gap}  Gap            ${statusTotals.gap.toString().padStart(4)}   (in-scope feature, no implementation, no override)`);
  console.log(`  ${STATUS_EMOJI.na_delete}  Delete (n/a)   ${statusTotals.na_delete.toString().padStart(4)}   (migration never deletes)`);
  console.log('');
  if (Object.keys(overrideReasonTotals).length) {
    console.log('Excluded endpoints by reason:');
    for (const [r, c] of Object.entries(overrideReasonTotals).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${r.padEnd(22)} ${String(c).padStart(4)}`);
    }
    console.log('');
  }
  console.log(`In-scope write endpoints (excludes DELETE): ${inScopeWrites.length}`);
  console.log(`  Implemented:                    ${inScopeImplemented} (${pct(inScopeImplemented, inScopeWrites.length)})`);
  console.log(`  Excluded (formally):            ${inScopeExcluded} (${pct(inScopeExcluded, inScopeWrites.length)})`);
  console.log(`  Covered (impl + excluded):      ${inScopeCovered} (${pct(inScopeCovered, inScopeWrites.length)})  ← settled surface`);
  console.log(`  Real gaps:                      ${inScopeGaps}    ← actionable`);
  console.log(`  Real gaps that are in the SDK:  ${inScopeGapsInSdk}`);
  console.log(`  Real gaps NOT in the SDK:       ${inScopeGaps - inScopeGapsInSdk}`);
  console.log('');
  if (staleOverrides.length) {
    console.log(`⚠ Stale overrides (${staleOverrides.length}) — these don't match any current endpoint:`);
    for (const k of staleOverrides.slice(0, 10)) console.log(`    ${k}`);
    if (staleOverrides.length > 10) console.log(`    ... and ${staleOverrides.length - 10} more`);
    console.log('');
  }

  if (featureFilter) {
    const agg = byFeature.get(featureFilter);
    if (!agg) {
      console.error(`Unknown feature: ${featureFilter}`);
      process.exit(1);
    }
    printFeatureDetail(agg);
    return;
  }

  console.log('─── By Feature ──────────────────────────────────────────────────────────');
  const longestName = [...byFeature.values()].reduce((m, v) => Math.max(m, v.feature.name.length), 0);
  console.log(`${'Feature'.padEnd(longestName)}  Scope?  Total  Impl  Excl  Imp.  OoS  Gap`);
  console.log(`${'─'.repeat(longestName)}  ──────  ─────  ────  ────  ────  ───  ───`);
  const sortedFeatures = [...byFeature.values()].sort((a, b) => {
    // In-scope first, then by gap count desc (real gaps only), then by total desc.
    if (a.feature.in_scope !== b.feature.in_scope) return a.feature.in_scope ? -1 : 1;
    if (a.by_status.gap !== b.by_status.gap) return b.by_status.gap - a.by_status.gap;
    return b.total - a.total;
  });
  for (const agg of sortedFeatures) {
    const writes = agg.total - agg.by_method.DELETE;
    console.log(
      `${agg.feature.name.padEnd(longestName)}  ${(agg.feature.in_scope ? 'yes' : 'no').padEnd(6)}  ` +
      `${String(writes).padStart(5)}  ` +
      `${String(agg.by_status.implemented).padStart(4)}  ` +
      `${String(agg.by_status.excluded).padStart(4)}  ` +
      `${String(agg.by_status.impossible).padStart(4)}  ` +
      `${String(agg.by_status.out_of_scope).padStart(3)}  ` +
      `${String(agg.by_status.gap).padStart(3)}`
    );
  }
  console.log('');

  if (wantGapsOnly || inScopeGaps > 0) {
    console.log('─── Gaps (in-scope, in-SDK only — these are the actionable ones) ───────');
    const actionableGaps = endpoints.filter(e => e.status === 'gap' && e.in_scope && e.in_sdk);
    if (actionableGaps.length === 0) {
      console.log('  (none)');
    } else {
      // Group by feature
      const byFeat = {};
      for (const ep of actionableGaps) (byFeat[ep.feature_name] ||= []).push(ep);
      for (const [fname, eps] of Object.entries(byFeat).sort()) {
        console.log(`  ${fname} (${eps.length}):`);
        for (const ep of eps.slice(0, 5)) {
          console.log(`    ${ep.method.padEnd(6)} ${ep.path}`);
        }
        if (eps.length > 5) console.log(`    ... and ${eps.length - 5} more (use --feature ${eps[0].feature_id})`);
      }
    }
    console.log('');
  }
}

function printFeatureDetail(agg) {
  const f = agg.feature;
  console.log(`─── ${f.name} (${f.id}) ─────────────────────────────────────`);
  console.log(`Dashboard:     ${f.dashboard_path}`);
  console.log(`Scope:         ${f.scope}`);
  console.log(`In-scope:      ${f.in_scope ? 'yes' : 'no'}`);
  console.log(`Plan:          ${f.plan_required || '—'}`);
  console.log(`Add-on:        ${f.addon_required || '—'}`);
  console.log(`Entitlement:   ${f.entitlement_required || '—'}`);
  if (f.notes) console.log(`Notes:         ${f.notes}`);
  console.log('');
  console.log('Endpoints:');
  for (const ep of agg.endpoints.sort((a, b) => (a.method + a.path).localeCompare(b.method + b.path))) {
    const emoji = STATUS_EMOJI[ep.status];
    const sdkMark = ep.in_sdk ? '' : '  (not in SDK)';
    const dep = ep.deprecated ? '  [deprecated]' : '';
    console.log(`  ${emoji} ${ep.method.padEnd(6)} ${ep.path}${dep}${sdkMark}`);
  }
  console.log('');
}

function getCloudflareVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'cloudflare', 'package.json'), 'utf8'));
    return pkg.version;
  } catch { return 'unknown'; }
}

// ── Markdown output ──────────────────────────────────────────────────
function buildMarkdown({ outputPath }) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push('# Cloudflare API Migration Coverage');
  lines.push('');
  lines.push(`_Auto-generated by \`scripts/coverage-report.mjs --write-md\` on ${today}._`);
  lines.push('_Edit \`scripts/feature-taxonomy.json\` and \`src/types.ts\` (IMPOSSIBLE_TO_MIGRATE) to change classifications._');
  lines.push('');
  lines.push('## What this document is');
  lines.push('');
  lines.push('Twilight Zone migrates a Cloudflare zone between accounts. The Cloudflare API has roughly 1,500 endpoints that mutate state (POST/PATCH/PUT); not all of them are part of zone migration. This document classifies every mutating endpoint into one of five buckets:');
  lines.push('');
  lines.push('| Status | Meaning |');
  lines.push('|---|---|');
  lines.push('| ✅ Implemented | Twilight Zone calls this endpoint during migration. |');
  lines.push('| ⚪ Excluded | Endpoint is in an in-scope feature but doesn\'t count as a gap: see `scripts/coverage-overrides.json` for the per-endpoint reason (data-plane, imperative action, redundant variant, dual-scope, or sub-feature out-of-scope). |');
  lines.push('| 🟡 Impossible | Listed in `IMPOSSIBLE_TO_MIGRATE` (cryptographic keys, account-tied resources, auto-managed features, read-only settings, ephemeral data, offline data, or external manual actions). The user is asked to acknowledge before migration runs. |');
  lines.push('| ⚪ Out of scope | Belongs to a feature not part of zone migration (account admin, Zero Trust admin surfaces, Magic Networking, AI model invocations, etc.). |');
  lines.push('| ❌ Gap | An in-scope feature where Twilight Zone does not call the endpoint AND no override entry covers it. These are the genuinely actionable items. |');
  lines.push('| — Delete (n/a) | Migration never deletes resources on the destination. DELETE endpoints are listed for completeness only. |');
  lines.push('');
  lines.push('## Cross-references');
  lines.push('');
  lines.push('Every endpoint is also tagged with whether it appears in the public `cloudflare` npm package (the official TypeScript SDK). Endpoints in the OpenAPI spec but **not** in the SDK are typically internal, deprecated, or pre-release; we flag them so we don\'t treat them as priority gaps.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **OpenAPI spec version**: ${writes.api_version || 'unknown'} (generated ${writes.generated_at.slice(0, 10)})`);
  lines.push(`- **cloudflare-typescript SDK**: v${getCloudflareVersion()} (${sdk.total_entries} HTTP-issuing methods)`);
  lines.push(`- **Twilight Zone**: ${tz.total_cf_fetch_calls} \`cfFetch\` calls in \`src/api.ts\`, ${tz.api_exports_called_from_migrate.length} of ${tz.api_exports_count} exported functions reached from migration code.`);
  lines.push('');
  lines.push('### Write endpoints by method');
  lines.push('');
  lines.push('| Method | Count |');
  lines.push('|---|---:|');
  for (const [mth, c] of Object.entries(methodTotals).sort()) {
    lines.push(`| ${mth} | ${c} |`);
  }
  lines.push('');
  lines.push('### Status totals (POST/PATCH/PUT — DELETE excluded from coverage)');
  lines.push('');
  lines.push('| Status | Count | % of writes |');
  lines.push('|---|---:|---:|');
  const writesOnly = endpoints.length - statusTotals.na_delete;
  lines.push(`| ✅ Implemented | ${statusTotals.implemented} | ${pct(statusTotals.implemented, writesOnly)} |`);
  lines.push(`| ⚪ Excluded | ${statusTotals.excluded} | ${pct(statusTotals.excluded, writesOnly)} |`);
  lines.push(`| 🟡 Impossible | ${statusTotals.impossible} | ${pct(statusTotals.impossible, writesOnly)} |`);
  lines.push(`| ⚪ Out of scope | ${statusTotals.out_of_scope} | ${pct(statusTotals.out_of_scope, writesOnly)} |`);
  lines.push(`| ❌ Gap | ${statusTotals.gap} | ${pct(statusTotals.gap, writesOnly)} |`);
  lines.push('');
  if (Object.keys(overrideReasonTotals).length) {
    lines.push('#### Excluded endpoints by reason');
    lines.push('');
    lines.push('| Reason | Count | Description |');
    lines.push('|---|---:|---|');
    const REASON_DESC = {
      data_plane: 'Runtime data ops (queue messages, vectorize insert/query, R2 object writes, email send, AI inference) — not configuration.',
      imperative_action: 'One-shot admin actions (purge, force_axfr, validate, preview, rollback, rotate, refresh, enable/disable) — not state config.',
      redundant_with_put: 'Endpoint covered by a PUT we implement — either the same shape (PATCH X covered by PUT X) or a parent collection write (per-entry POST/PUT covered by the parent collection\'s full-replace PUT).',
      redundant_with_post_dns: 'Deprecated alias endpoint covered by the modern POST /email/routing/dns we implement.',
      redundant_with_bundle_put: 'Per-aspect Workers script endpoint (content, deployments, schedules, settings, subdomain, tails, versions, assets-upload-session, /workers/workers/*) — covered by the single multipart bundle PUT /accounts/{}/workers/scripts/{} that TZ uses for the entire script upload.',
      redundant_with_record_post: 'DNS bulk endpoint (batch / import) — covered by the per-record POST /zones/{}/dns_records that TZ uses one-at-a-time, with progress reporting per record.',
      redundant_with_ruleset_put: 'Per-rule ruleset CRUD endpoint (POST/PATCH on /rulesets/{}/rules[/{}]) — covered by the full-record PUT /rulesets/{} that TZ uses to write the entire ruleset (rules and all) in one call.',
      dual_scope_covered: 'Endpoint at one scope (zone or account) where we implement the other scope.',
      updated_via_post: 'PUT/PATCH on a resource TZ POSTs fresh on the destination. Update endpoints aren\'t relevant to a fresh-migration tool.',
      newer_subfeature: 'Sub-feature not yet supported by TZ — usually a recently-shipped Cloudflare feature.',
      admin_only: 'Account-wide admin sub-resource (org-level Access settings, Workers account settings, SSL universal config) — not per-zone migration scope.',
      redundant_with_post: 'Per-item or alternative create endpoint covered by a collection POST that TZ implements (e.g. single-operation create covered by the bulk operations POST; per-rule write covered by the rules POST).',
      redundant_with_settings_loop: 'Individual zone-setting endpoint covered by TZ\'s generic settings loop, which PATCHes every value returned by GET /zones/{}/settings.',
      out_of_scope_subfeature: 'In an in-scope feature, but this specific sub-capability is out of zone-migration scope: advanced/experimental config (AI Gateway dynamic routing, eval datasets), a separate product surface (Log Explorer, Email Sending, Workers for Platforms dispatch, Pipelines, Vectorize, Zone Environments), or an auto-managed/legacy variant (managed WAF packages, managed API Shield labels).',
      impossible_cryptographic: 'Write-only secret/key material (JWKS signing keys, CSR private keys) listed in IMPOSSIBLE_TO_MIGRATE — the API never returns the bytes, so it cannot be exported or migrated. The user is asked to re-supply it.',
      sub_feature_oos: 'Legacy generic category — should not appear after the 2026-05-26 refinement. If you see this, re-run the seeder.',
    };
    for (const [r, c] of Object.entries(overrideReasonTotals).sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${r}\` | ${c} | ${REASON_DESC[r] || '(see scripts/coverage-overrides.json for context)'} |`);
    }
    lines.push('');
  }
  lines.push('### In-scope coverage');
  lines.push('');
  lines.push(`- **In-scope writes**: ${inScopeWrites.length}`);
  lines.push(`- **Implemented**: ${inScopeImplemented} (${pct(inScopeImplemented, inScopeWrites.length)})`);
  lines.push(`- **Excluded** (formally not-a-gap): ${inScopeExcluded} (${pct(inScopeExcluded, inScopeWrites.length)})`);
  lines.push(`- **Covered** (impl + excluded): ${inScopeCovered} (${pct(inScopeCovered, inScopeWrites.length)})`);
  lines.push(`- **Real gaps**: ${inScopeGaps}`);
  lines.push(`- **Real gaps in SDK** (prioritise): ${inScopeGapsInSdk}`);
  lines.push(`- **Real gaps NOT in SDK** (likely internal/deprecated): ${inScopeGaps - inScopeGapsInSdk}`);
  lines.push('');
  lines.push('## Coverage by Feature');
  lines.push('');
  lines.push('Sorted by in-scope first, then by real-gap count descending. Plan/Add-on/Entitlement are three distinct prerequisites and shown as separate columns.');
  lines.push('');
  lines.push('| Feature | Scope | Plan | Add-on | Entitlement | Writes | ✅ Impl | ⚪ Excl | 🟡 Imp | ⚪ OoS | ❌ Gap |');
  lines.push('|---|---|---|---|---|---:|---:|---:|---:|---:|---:|');
  const sortedFeatures = [...byFeature.values()].sort((a, b) => {
    if (a.feature.in_scope !== b.feature.in_scope) return a.feature.in_scope ? -1 : 1;
    if (a.by_status.gap !== b.by_status.gap) return b.by_status.gap - a.by_status.gap;
    return b.total - a.total;
  });
  for (const agg of sortedFeatures) {
    const writesCount = agg.total - agg.by_method.DELETE;
    if (writesCount === 0) continue;
    lines.push(`| **${agg.feature.name}** | ${agg.feature.in_scope ? 'zone-mig' : 'out'} | ${agg.feature.plan_required || '—'} | ${agg.feature.addon_required || '—'} | ${agg.feature.entitlement_required || '—'} | ${writesCount} | ${agg.by_status.implemented} | ${agg.by_status.excluded} | ${agg.by_status.impossible} | ${agg.by_status.out_of_scope} | ${agg.by_status.gap} |`);
  }
  lines.push('');

  // Per-feature endpoint detail
  lines.push('## Endpoint Detail by Feature');
  lines.push('');
  lines.push('Each in-scope feature lists every POST/PATCH/PUT endpoint that belongs to it, plus its status.');
  lines.push('');
  for (const agg of sortedFeatures.filter(a => a.feature.in_scope)) {
    const f = agg.feature;
    lines.push(`### ${f.name}`);
    lines.push('');
    lines.push(`- **Dashboard**: ${f.dashboard_path}`);
    lines.push(`- **Plan**: ${f.plan_required || '—'} | **Add-on**: ${f.addon_required || '—'} | **Entitlement**: ${f.entitlement_required || '—'}`);
    if (f.notes) lines.push(`- **Notes**: ${f.notes}`);
    lines.push('');
    const writes = agg.endpoints.filter(e => e.method !== 'DELETE')
      .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
    if (writes.length === 0) {
      lines.push('_(no write endpoints)_');
      lines.push('');
      continue;
    }
    lines.push('| Status | Method | Path | Reason | SDK | Deprecated |');
    lines.push('|---|---|---|---|:-:|:-:|');
    for (const ep of writes) {
      const emoji = STATUS_EMOJI[ep.status];
      const reason = ep.override && ep.override.reason ? `\`${ep.override.reason}\`` : '';
      lines.push(`| ${emoji} ${ep.status} | ${ep.method} | \`${ep.path}\` | ${reason} | ${ep.in_sdk ? '✓' : '—'} | ${ep.deprecated ? '⚠' : '—'} |`);
    }
    lines.push('');
  }

  lines.push('## Out-of-scope features');
  lines.push('');
  lines.push('These features are not part of zone migration. They have their own admin surfaces and most are out of scope for any per-zone tool.');
  lines.push('');
  lines.push('| Feature | Endpoints | Notes |');
  lines.push('|---|---:|---|');
  for (const agg of sortedFeatures.filter(a => !a.feature.in_scope)) {
    const writes = agg.total - agg.by_method.DELETE;
    if (writes === 0) continue;
    lines.push(`| ${agg.feature.name} | ${writes} | ${agg.feature.notes || ''} |`);
  }
  lines.push('');
  lines.push('## How to update this report');
  lines.push('');
  lines.push('```bash');
  lines.push('# 1. Regenerate the manifest (auto-downloads the latest OpenAPI spec by default)');
  lines.push('npm run generate:openapi-manifest');
  lines.push('');
  lines.push('# 2. Refresh the SDK index (after npm install)');
  lines.push('node scripts/extract-sdk-index.mjs');
  lines.push('');
  lines.push('# 3. Refresh the Twilight Zone implementation index');
  lines.push('node scripts/extract-tz-coverage.mjs');
  lines.push('');
  lines.push('# 4. Regenerate this document');
  lines.push('node scripts/coverage-report.mjs --write-md');
  lines.push('```');
  lines.push('');
  lines.push('## Notes on classification');
  lines.push('');
  lines.push('- **Feature taxonomy** is hand-curated in `scripts/feature-taxonomy.json`. It maps OpenAPI path prefixes to dashboard nav items, and declares whether each feature is in zone-migration scope. New endpoints will be classified automatically by deepest-prefix match.');
  lines.push('- **Impossible-to-migrate catalog** is `IMPOSSIBLE_TO_MIGRATE` in `src/types.ts`. Add new entries there when you discover a resource that fundamentally cannot be migrated (cryptographic, account-tied, etc.).');
  lines.push('- **Implementation detection** parses every `cfFetch[All](auth, \\`<template>\\`, { method: \'X\' })` call in `src/api.ts`, then determines which `api.<fn>` calls are reachable from `src/migrate.ts` or `src/migrate/*.ts`. An endpoint is "implemented" only if its api wrapper is actually called by migration code.');
  lines.push('- **Gaps** are in-scope endpoints with no implementation. The subset that is also in the cloudflare SDK is highlighted — these are the actionable gaps.');
  lines.push('');
  return lines.join('\n') + '\n';
}

const COVERAGE_DIR = path.join(ROOT, 'coverage');
const COVERAGE_MD_PATH = path.join(COVERAGE_DIR, 'api-surface.md');
const DOCS_MD_PATH = path.join(ROOT, 'docs', 'COVERAGE.md');

if (wantWriteMd) {
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(DOCS_MD_PATH), { recursive: true });
  const md = buildMarkdown({ outputPath: DOCS_MD_PATH });
  // Always write to docs/COVERAGE.md (checked in, curated summary doc).
  fs.writeFileSync(DOCS_MD_PATH, md);
  // Also write to coverage/api-surface.md so existing tooling that points
  // there (or anything in CI) keeps working.
  fs.writeFileSync(COVERAGE_MD_PATH, md);
  console.log(`✓ Wrote ${DOCS_MD_PATH}`);
  console.log(`✓ Wrote ${COVERAGE_MD_PATH}`);
  process.exit(0);
}

if (wantCheck) {
  const ratchetPath = path.join(ROOT, 'scripts', 'coverage-ratchet.json');
  let ratchet = { max_in_scope_gaps_in_sdk: 0, max_in_scope_gaps: 0 };
  if (fs.existsSync(ratchetPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(ratchetPath, 'utf8'));
      // Backwards-compat: old ratchet used family/path counts (per the prior
      // coverage report). Accept those keys without failing, but they're no
      // longer the gate.
      ratchet = { ...ratchet, ...parsed };
    } catch { /* fall through */ }
  }
  let failures = 0;

  // Gate 1: real-gap ratchet (in-SDK)
  if (inScopeGapsInSdk > (ratchet.max_in_scope_gaps_in_sdk ?? Infinity)) {
    console.error(`✗ In-scope SDK gaps ${inScopeGapsInSdk} exceeds ratchet ${ratchet.max_in_scope_gaps_in_sdk}.`);
    console.error('  Either implement one of the in-SDK gap endpoints, add an override to scripts/coverage-overrides.json, or update the ratchet (requires reviewer approval).');
    failures++;
  } else {
    console.log(`✓ In-scope SDK gaps ${inScopeGapsInSdk} ≤ ratchet ${ratchet.max_in_scope_gaps_in_sdk ?? '∞'}`);
  }

  // Gate 2: real-gap ratchet (all)
  if (inScopeGaps > (ratchet.max_in_scope_gaps ?? Infinity)) {
    console.error(`✗ In-scope gaps ${inScopeGaps} exceeds ratchet ${ratchet.max_in_scope_gaps}.`);
    failures++;
  } else {
    console.log(`✓ In-scope gaps ${inScopeGaps} ≤ ratchet ${ratchet.max_in_scope_gaps ?? '∞'}`);
  }

  // Gate 3: no stale overrides. Every entry in coverage-overrides.json
  // must correspond to a real endpoint in the current OpenAPI snapshot.
  // A stale override is almost always a sign that the API changed and
  // the override needs to be removed or updated.
  if (staleOverrides.length > 0) {
    console.error(`✗ ${staleOverrides.length} stale override(s) in scripts/coverage-overrides.json:`);
    for (const k of staleOverrides.slice(0, 5)) console.error(`    ${k}`);
    if (staleOverrides.length > 5) console.error(`    ... and ${staleOverrides.length - 5} more`);
    console.error('  Remove the entries that no longer match an OpenAPI endpoint,');
    console.error('  or re-seed via `node scripts/seed-coverage-overrides.mjs > scripts/coverage-overrides.json`.');
    failures++;
  } else if (Object.keys(overrides).length > 0) {
    console.log(`✓ All ${Object.keys(overrides).length} override(s) match a real endpoint`);
  }

  // Gate 4: every endpoint must be classified by a feature. New top-level
  // products (e.g. a brand-new Cloudflare product line) will land in
  // (uncategorized) — surfacing those forces an explicit taxonomy update.
  const uncategorized = endpoints.filter(e => e.feature_id === null);
  if (uncategorized.length > 0) {
    console.error(`✗ ${uncategorized.length} endpoint(s) not classified by scripts/feature-taxonomy.json.`);
    console.error('  Run `npm run coverage:uncategorized` for the list.');
    failures++;
  } else {
    console.log(`✓ All ${endpoints.length} endpoints classified by feature taxonomy`);
  }

  process.exit(failures > 0 ? 1 : 0);
}

printHumanReport();
