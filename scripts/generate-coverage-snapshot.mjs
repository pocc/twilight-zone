#!/usr/bin/env node
/**
 * Generate app/lib/coverageData.ts — a compact, typed snapshot of the
 * Cloudflare API coverage data used by the landing-page coverage tiles
 * and modal.
 *
 * Inputs (all generated):
 *   src/openapi-writes.generated.json
 *   coverage/sdk-index.generated.json
 *   coverage/tz-coverage.generated.json
 *   scripts/feature-taxonomy.json
 *   scripts/coverage-overrides.json
 *
 * Output:
 *   app/lib/coverageData.ts — exports a typed object with:
 *     - categories[]         dashboard top-level groups + metadata
 *     - features[]           per-feature rollup (with category fk, counts)
 *     - endpointsByFeature   per-feature endpoint list with statuses
 *
 * The bundle size impact is small (~30-50KB minified JSON-as-TS), and the
 * data is small enough that streaming it from the worker would be
 * over-engineering.
 *
 * Re-run via:
 *   npm run generate:coverage-snapshot
 *   npm run coverage:all   (regenerates inputs + snapshot)
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
    console.error('Regenerate it. See scripts/coverage-report.mjs header.');
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

const writes = loadJson('src/openapi-writes.generated.json');
const sdk = loadJson('coverage/sdk-index.generated.json');
const tz = loadJson('coverage/tz-coverage.generated.json');
const taxonomy = loadJson('scripts/feature-taxonomy.json');
const overridesFile = loadJson('scripts/coverage-overrides.json');
const overrides = overridesFile.overrides || {};

function shape(p) { return p.replace(/\{[^}]+\}/g, '{}'); }

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

const sdkShapeIndex = sdk.by_shape_method;
const tzReachableSet = new Set(tz.endpoints_reachable_from_migrate_keys);
const GAP_OVERRIDE_REASONS = new Set(['newer_subfeature']);

function isExcludedOverride(override) {
  return Boolean(override && override.reason && !GAP_OVERRIDE_REASONS.has(override.reason));
}

// ── Build per-endpoint records ───────────────────────────────────────
function classify(op) {
  if (op.method === 'DELETE') return { status: 'na_delete' };
  const sk = `${op.method} ${shape(op.path)}`;
  const feat = classifyFeature(op.path);
  if (!feat) return { status: 'gap', feature: null };
  if (!feat.in_scope) return { status: 'out_of_scope', feature: feat };
  if (tzReachableSet.has(sk)) return { status: 'implemented', feature: feat };
  if (isExcludedOverride(overrides[sk])) {
    return { status: 'excluded', feature: feat, reason: overrides[sk].reason, notes: overrides[sk].notes };
  }
  if (overrides[sk] && overrides[sk].reason) {
    return { status: 'gap', feature: feat, reason: overrides[sk].reason, notes: overrides[sk].notes };
  }
  return { status: 'gap', feature: feat };
}

const endpointsByFeature = {};   // feature.id → array of { method, path, status, ... }
const featureCounts = {};         // feature.id → { implemented, excluded, gap, out_of_scope }

for (const op of writes.operations) {
  if (op.method === 'DELETE') continue;  // not part of migration coverage
  const c = classify(op);
  if (!c.feature) continue;  // (uncategorized — caught by --uncategorized gate)
  const fid = c.feature.id;
  // Always count for the feature rollup so the per-category numbers are
  // honest. But only retain per-endpoint records for in-scope features —
  // out-of-scope features have hundreds of endpoints (Magic, AI run,
  // CloudForce One) and the SPA modal never drills into them. Dropping
  // those records keeps the bundle small.
  if (c.feature.in_scope) {
    (endpointsByFeature[fid] ||= []).push({
      method: op.method,
      path: op.path,
      status: c.status,
      in_sdk: Boolean(sdkShapeIndex[`${op.method} ${shape(op.path)}`]),
      deprecated: Boolean(op.deprecated),
      ...(c.reason && { reason: c.reason }),
      ...(c.notes && { notes: c.notes }),
    });
  }
  if (!featureCounts[fid]) featureCounts[fid] = { implemented: 0, excluded: 0, gap: 0, out_of_scope: 0 };
  featureCounts[fid][c.status]++;
}

// ── Per-feature rollup ───────────────────────────────────────────────
const features = taxonomy.features.map(f => {
  const counts = featureCounts[f.id] || { implemented: 0, excluded: 0, gap: 0, out_of_scope: 0 };
  const inScopeWrites = counts.implemented + counts.gap;  // excluded NOT counted
  // "In-scope write endpoints" = implemented + excluded + gap. This is the
  // denominator for the secondary, informational share number (rendered in
  // gray): of every write endpoint in this in-scope feature, what fraction
  // does Twilight Zone actively call? Excluded endpoints (redundant PUTs,
  // imperative actions, data-plane ops) ARE in this denominator — they're
  // part of the surface, just deliberately not called. This is distinct
  // from implementation_rate_pct (the green "% of migratable" health metric).
  const inScopeWriteTotal = counts.implemented + counts.excluded + counts.gap;
  return {
    id: f.id,
    name: f.name,
    category: f.category,
    in_scope: f.in_scope,
    plan_required: f.plan_required,
    addon_required: f.addon_required,
    entitlement_required: f.entitlement_required,
    dashboard_path: f.dashboard_path,
    notes: f.notes,
    counts,
    implementation_rate_pct: inScopeWrites === 0 ? null
      : Number(((counts.implemented / inScopeWrites) * 100).toFixed(1)),
    in_scope_write_share_pct: inScopeWriteTotal === 0 ? null
      : Number(((counts.implemented / inScopeWriteTotal) * 100).toFixed(1)),
  };
});

// ── Per-category rollup ──────────────────────────────────────────────
const categoryMeta = taxonomy._categories || {};
const categories = Object.entries(categoryMeta).map(([id, meta]) => {
  const featuresInCat = features.filter(f => f.category === id);
  const counts = featuresInCat.reduce((acc, f) => ({
    implemented: acc.implemented + f.counts.implemented,
    excluded: acc.excluded + f.counts.excluded,
    gap: acc.gap + f.counts.gap,
    out_of_scope: acc.out_of_scope + f.counts.out_of_scope,
  }), { implemented: 0, excluded: 0, gap: 0, out_of_scope: 0 });

  // "In-scope writes for this category" = implemented + gap (excluded
  // endpoints don't count, out_of_scope features aren't migrated at all).
  // For categories that contain only out-of-scope features (e.g.
  // account_admin), the implementation rate is N/A.
  const denom = counts.implemented + counts.gap;
  const rate = denom === 0 ? null : Number(((counts.implemented / denom) * 100).toFixed(1));

  // Secondary informational share (gray): implemented / all in-scope write
  // endpoints (implemented + excluded + gap). See the per-feature comment above.
  const shareDenom = counts.implemented + counts.excluded + counts.gap;
  const share = shareDenom === 0 ? null : Number(((counts.implemented / shareDenom) * 100).toFixed(1));

  return {
    id,
    name: meta.name,
    icon: meta.icon,
    order: meta.order,
    description: meta.description,
    feature_ids: featuresInCat.map(f => f.id),
    in_scope_feature_count: featuresInCat.filter(f => f.in_scope).length,
    out_of_scope_feature_count: featuresInCat.filter(f => !f.in_scope).length,
    counts,
    implementation_rate_pct: rate,
    in_scope_write_share_pct: share,
  };
}).sort((a, b) => a.order - b.order);

// ── Reason descriptions (used by modal) ──────────────────────────────
const reasonDescriptions = {
  data_plane: {
    label: 'Data plane',
    summary: 'Runtime data operations — these endpoints handle data flowing through your services after migration. Your application calls them at request time, not your migration tool.',
    examples: ['POST .../queues/{}/messages/ack', 'PUT .../r2/buckets/{}/objects/{}', 'POST .../vectorize/v2/indexes/{}/insert'],
  },
  imperative_action: {
    label: 'Imperative action',
    summary: 'One-shot admin actions, not persistent state. Things like "purge cache", "rotate a token", or "validate a config". There\'s no resulting state to migrate.',
    examples: ['POST /zones/{}/purge_cache', 'POST .../service_tokens/{}/rotate', 'POST /zones/{}/ssl/analyze'],
  },
  redundant_with_put: {
    label: 'Redundant with PUT',
    summary: 'PATCH variant of an endpoint where we use PUT. PUT does a full overwrite, which is what we want for fresh migration.',
    examples: ['PATCH /zones/{}/dns_records/{} (we use PUT /zones/{}/dns_records/{})'],
  },
  dual_scope_covered: {
    label: 'Dual scope',
    summary: 'Same resource is addressable at both account and zone scope. We use one consistently.',
    examples: ['POST /zones/{}/access/apps (we use POST /accounts/{}/access/apps)'],
  },
  updated_via_post: {
    label: 'Created fresh on destination',
    summary: 'Twilight Zone creates these resources brand-new on the destination. We don\'t update existing resources — we POST a fresh one. The PUT/PATCH endpoint isn\'t relevant to a fresh-migration tool.',
    examples: ['PUT /accounts/{}/access/apps/{}', 'PUT /accounts/{}/queues/{}', 'PUT /zones/{}/load_balancers/{}'],
  },
  newer_subfeature: {
    label: 'Newer sub-feature',
    summary: 'Recently-shipped Cloudflare sub-feature that Twilight Zone has not yet added support for. These are real candidates for future implementation; we just haven\'t prioritized them yet.',
    examples: ['Access AI Controls (MCP)', 'Zaraz config', 'Page Shield policies', 'Web3 IPFS content lists'],
  },
  admin_only: {
    label: 'Account-wide admin',
    summary: 'Account-level administration sub-resources that don\'t belong in a per-zone migration tool. Things like org-level Access settings, Workers account settings, or account-wide certificate management.',
    examples: ['POST .../access/keys/rotate', 'PUT .../workers/account-settings', 'PATCH .../ssl/universal/settings'],
  },
  redundant_with_post: {
    label: 'Created via collection POST',
    summary: 'A per-item or alternative create endpoint that\'s covered by a collection POST we already call. We create the whole set in one place rather than item-by-item via these variants.',
    examples: ['POST .../api_gateway/operations/item (we use the bulk operations POST)', 'POST .../token_validation/rules/bulk (we use the per-rule POST)'],
  },
  redundant_with_settings_loop: {
    label: 'Covered by zone-settings migration',
    summary: 'An individual zone-setting endpoint. Twilight Zone migrates settings generically — it reads every value from GET /zones/{}/settings and PATCHes each one — so these dedicated per-setting endpoints are already covered.',
    examples: ['PATCH /zones/{}/settings/speed_brain', 'PATCH /zones/{}/settings/rum', 'PATCH /zones/{}/settings (bulk)'],
  },
  out_of_scope_subfeature: {
    label: 'Out-of-scope sub-feature',
    summary: 'Part of an in-scope product, but this specific capability is outside zone migration: advanced/experimental config (AI Gateway dynamic routing, eval datasets), a separate product surface (Log Explorer, Workers for Platforms dispatch, Pipelines, Vectorize, Zone Environments, Workers Observability/Logs), or an auto-managed/legacy variant (managed WAF packages, Cloudflare-managed API Shield labels). Runtime telemetry like Workers Observability is offered for capture via the analytics snapshot, not migrated as config.',
    examples: ['POST .../ai-gateway/gateways/{}/routes', 'POST .../pipelines/v1/pipelines', 'POST .../vectorize/indexes', 'POST .../logs/explorer/datasets'],
  },
  impossible_cryptographic: {
    label: 'Cryptographic — cannot export',
    summary: 'Write-only secret or key material (JWKS signing keys, CSR private keys). The API never returns the bytes, so it cannot be exported or migrated. You\'re asked to re-supply it on the destination. Tracked in the IMPOSSIBLE_TO_MIGRATE catalog.',
    examples: ['PUT /zones/{}/token_validation/config/{}/credentials'],
  },
};

// ── Summary stats ────────────────────────────────────────────────────
const inScopeFeatureIds = new Set(features.filter(f => f.in_scope).map(f => f.id));
const inScopeEndpoints = Object.entries(endpointsByFeature)
  .filter(([fid]) => inScopeFeatureIds.has(fid))
  .flatMap(([, eps]) => eps);
const totals = {
  in_scope_writes: inScopeEndpoints.length,
  implemented: inScopeEndpoints.filter(e => e.status === 'implemented').length,
  excluded: inScopeEndpoints.filter(e => e.status === 'excluded').length,
  gap: inScopeEndpoints.filter(e => e.status === 'gap').length,
  feature_count: features.length,
  category_count: categories.length,
};
totals.implementation_rate_pct = totals.implemented + totals.gap === 0
  ? 0
  : Number(((totals.implemented / (totals.implemented + totals.gap)) * 100).toFixed(1));
totals.settled_surface_pct = Number((((totals.implemented + totals.excluded) / totals.in_scope_writes) * 100).toFixed(1));
// Secondary informational share (gray): implemented / all in-scope write
// endpoints (implemented + excluded + gap = in_scope_writes). This is the
// "(N% of in-scope write endpoints)" number shown in parentheses next to the
// green "100% Zone Migratable" headline. It is NOT a health metric — it just
// conveys how much of the writeable surface the tool actively touches.
totals.in_scope_write_share_pct = totals.in_scope_writes === 0
  ? 0
  : Number(((totals.implemented / totals.in_scope_writes) * 100).toFixed(1));

// ── Emit two TS modules ──────────────────────────────────────────────
//
// app/lib/coverageSummary.ts — small, eagerly imported by the landing page.
//   Contains category-level rollups, total counts, and the reason
//   descriptions table. Used by the tiles to render with no detail.
//
// app/lib/coverageDetail.ts — larger, lazy-imported by the modal only.
//   Contains per-feature rollups and per-endpoint records. The landing
//   page never loads this unless the user clicks a tile.
//
// Splitting like this keeps the SPA's initial bundle small (the tile
// grid only needs ~10 KB of data) and defers the larger per-endpoint
// data behind a user gesture.

const generatedAt = new Date().toISOString();
const sdkVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/cloudflare/package.json'), 'utf8')).version;
  } catch { return null; }
})();

const summarySnapshot = {
  generated_at: generatedAt,
  openapi_version: writes.api_version,
  sdk_version: sdkVersion,
  totals,
  categories,
};

const detailSnapshot = {
  generated_at: generatedAt,
  reasonDescriptions,
  features,
  endpointsByFeature,
};

const SHARED_TYPES = `export type EndpointStatus = 'implemented' | 'excluded' | 'gap' | 'out_of_scope' | 'impossible' | 'na_delete';

export type EndpointRecord = {
  method: 'POST' | 'PATCH' | 'PUT';
  path: string;
  status: EndpointStatus;
  in_sdk: boolean;
  deprecated: boolean;
  reason?: string;
  notes?: string;
};

export type FeatureCounts = {
  implemented: number;
  excluded: number;
  gap: number;
  out_of_scope: number;
};

export type FeatureRecord = {
  id: string;
  name: string;
  category: string;
  in_scope: boolean;
  plan_required: string | null;
  addon_required: string | null;
  entitlement_required: string | null;
  dashboard_path: string;
  notes: string | null;
  counts: FeatureCounts;
  /** Green "% migratable" health metric: implemented / (implemented + gap) × 100, or null if no in-scope writes. */
  implementation_rate_pct: number | null;
  /** Gray informational share: implemented / (implemented + excluded + gap) × 100, or null if no in-scope writes. */
  in_scope_write_share_pct: number | null;
};

export type CategoryRecord = {
  id: string;
  name: string;
  icon: string;
  order: number;
  description: string;
  feature_ids: string[];
  in_scope_feature_count: number;
  out_of_scope_feature_count: number;
  counts: FeatureCounts;
  /** Green "% migratable" health metric: implemented / (implemented + gap) × 100, or null if no in-scope writes. */
  implementation_rate_pct: number | null;
  /** Gray informational share: implemented / (implemented + excluded + gap) × 100, or null if no in-scope writes. */
  in_scope_write_share_pct: number | null;
};

export type ReasonDescription = {
  label: string;
  summary: string;
  examples: string[];
};
`;

const summaryTs = `// GENERATED FILE. DO NOT EDIT BY HAND.
// Source: scripts/generate-coverage-snapshot.mjs
// Generated: ${generatedAt}
//
// Eagerly imported by the landing-page coverage tiles.
// For per-feature endpoint detail, lazy-import ./coverageDetail.

${SHARED_TYPES}
export type CoverageSummary = {
  generated_at: string;
  openapi_version: string | null;
  sdk_version: string | null;
  totals: {
    in_scope_writes: number;
    implemented: number;
    excluded: number;
    gap: number;
    feature_count: number;
    category_count: number;
    implementation_rate_pct: number;
    settled_surface_pct: number;
    in_scope_write_share_pct: number;
  };
  categories: CategoryRecord[];
};

export const coverageSummary: CoverageSummary = ${JSON.stringify(summarySnapshot, null, 2)};
`;

const detailTs = `// GENERATED FILE. DO NOT EDIT BY HAND.
// Source: scripts/generate-coverage-snapshot.mjs
// Generated: ${generatedAt}
//
// Lazy-imported by the coverage modal. Do NOT eagerly import this from
// the landing page — it inflates the initial bundle by ~50 KB minified.

import type { EndpointRecord, FeatureRecord, ReasonDescription } from './coverageSummary';

export type CoverageDetail = {
  generated_at: string;
  reasonDescriptions: Record<string, ReasonDescription>;
  features: FeatureRecord[];
  endpointsByFeature: Record<string, EndpointRecord[]>;
};

export const coverageDetail: CoverageDetail = ${JSON.stringify(detailSnapshot, null, 2)};
`;

const SUMMARY_PATH = path.resolve(ROOT, 'app/lib/coverageSummary.ts');
const DETAIL_PATH = path.resolve(ROOT, 'app/lib/coverageDetail.ts');
fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
fs.writeFileSync(SUMMARY_PATH, summaryTs);
fs.writeFileSync(DETAIL_PATH, detailTs);

console.log(`✓ Wrote ${SUMMARY_PATH}  (${(fs.statSync(SUMMARY_PATH).size / 1024).toFixed(1)} KB)`);
console.log(`✓ Wrote ${DETAIL_PATH}   (${(fs.statSync(DETAIL_PATH).size / 1024).toFixed(1)} KB)`);
console.log(`  ${summarySnapshot.categories.length} categories`);
console.log(`  ${detailSnapshot.features.length} features`);
console.log(`  ${Object.values(detailSnapshot.endpointsByFeature).flat().length} endpoints`);
