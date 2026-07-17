#!/usr/bin/env node
/**
 * Seed scripts/coverage-overrides.json from the current gap set.
 *
 * Produces a per-endpoint override file with categorical seed reasons:
 *
 *   data_plane          Runtime data ops (queue ack/pull, vectorize insert/
 *                       upsert/query, R2 object PUT, KV bulk writes, email
 *                       send, AI gateway logs/billing/topup, etc).
 *   imperative_action   One-shot admin actions (force_axfr, validate/*,
 *                       activation_check, preview, analyze, rollback,
 *                       revoke_tokens, refresh/rotate, enable/disable).
 *   redundant_with_put  PATCH X where we implement PUT X.
 *   dual_scope_covered  Endpoint at one scope where we implement the other
 *                       (account-only vs zone-only when the resource is
 *                       account-level by design).
 *   sub_feature_oos     Sub-feature out of zone-migration scope (e.g. AI
 *                       Gateway billing, R2 catalog).
 *   newer_subfeature    Triaged but unsupported. This remains a real gap in
 *                       coverage-report.mjs until implemented or relabeled.
 *
 * After seeding, the file is meant to be hand-reviewed: each entry has a
 * `reason` (seeded) and a `notes` field (empty — fill in if the seed is
 * wrong or needs context). Entries with reason=null require manual
 * categorization. Entries with reason=newer_subfeature are already triaged,
 * but still count as real gaps until implemented or relabeled.
 *
 * Run AFTER the coverage inputs have been regenerated:
 *   npm run generate:coverage-inputs
 *   node scripts/seed-coverage-overrides.mjs --write
 *
 * Safe to re-run with --write: existing entries' reasons/notes are preserved;
 * new gaps get seeded; gaps that no longer exist are dropped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const wantWrite = args.includes('--write');

const tz = JSON.parse(fs.readFileSync(path.join(ROOT, 'coverage/tz-coverage.generated.json'), 'utf8'));
const writes = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/openapi-writes.generated.json'), 'utf8'));
const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/feature-taxonomy.json'), 'utf8'));
const sdk = JSON.parse(fs.readFileSync(path.join(ROOT, 'coverage/sdk-index.generated.json'), 'utf8'));

const tzImplemented = new Set(tz.endpoints_reachable_from_migrate_keys);
const sdkShapes = new Set(Object.keys(sdk.by_shape_method));

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

/**
 * Seed reason heuristics. Order matters — first match wins.
 * Each rule is a function (method, path_shape, path) → reason | null.
 *
 * Heuristics are kept narrow on purpose. Anything that doesn't match a
 * specific rule gets `reason: null`, forcing human triage.
 */
const SEED_RULES = [
  // ── Per-entry CRUD covered by a full-collection PUT ─────────────
  // Must precede the more general redundant_with_put rule. Matches
  // POST /parent/entries and PUT /parent/entries/{} when TZ
  // implements PUT /parent (a single full-replace write).
  {
    name: 'redundant_with_collection_put',
    test: (method, _shape, _path) => method === 'POST' || method === 'PUT',
    apply: (method, sh) => {
      // Pattern: shape ends in /entries OR /entries/{}.
      // Parent collection: strip the trailing /entries[/{}] segment.
      const entriesEndMatch = sh.match(/^(.+)\/entries(?:\/\{\})?$/);
      if (!entriesEndMatch) return null;
      const parent = entriesEndMatch[1];
      const parentPutKey = `PUT ${parent}`;
      if (tzImplemented.has(parentPutKey)) {
        return { reason: 'redundant_with_put', covers: parentPutKey };
      }
      return null;
    },
  },

  // ── Workers script per-aspect endpoints covered by bundle PUT ────
  // The multipart-bundle PUT /accounts/{}/workers/scripts/{} writes
  // everything (content, deployments, schedules, settings, subdomain,
  // tails, versions, assets-upload-session). The per-aspect endpoints
  // are PATCHes/POSTs at a child path under /scripts/{}/<aspect>.
  // Also covers /workers/workers/{} (newer ID-based variant; TZ uses
  // the name-based bundle endpoint exclusively).
  {
    name: 'redundant_with_bundle_put',
    test: (method, _shape, _path) => method === 'POST' || method === 'PUT' || method === 'PATCH',
    apply: (method, sh) => {
      const bundlePutKey = 'PUT /accounts/{}/workers/scripts/{}';
      // Per-aspect script endpoints
      if (/^(POST|PUT|PATCH) \/accounts\/\{\}\/workers\/scripts\/\{\}\/(assets-upload-session|content|deployments|schedules|script-settings|settings|subdomain|tails|versions)$/.test(`${method} ${sh}`)) {
        return { reason: 'redundant_with_bundle_put', covers: bundlePutKey };
      }
      // /workers/workers/* (newer ID-based variant)
      if (/^(POST|PUT|PATCH) \/accounts\/\{\}\/workers\/workers(\/\{\}(\/versions)?)?$/.test(`${method} ${sh}`)) {
        return { reason: 'redundant_with_bundle_put', covers: bundlePutKey };
      }
      return null;
    },
  },

  // ── DNS bulk endpoints covered by per-record POST ───────────────
  // POST /zones/{}/dns_records/batch and /import are bulk variants;
  // TZ POSTs each record individually via /zones/{}/dns_records so it
  // can emit per-record progress and per-record error rows.
  {
    name: 'redundant_with_record_post',
    test: (method, _shape, _path) => method === 'POST',
    apply: (method, sh) => {
      if (/^\/zones\/\{\}\/dns_records\/(batch|import)$/.test(sh)) {
        return { reason: 'redundant_with_record_post', covers: 'POST /zones/{}/dns_records' };
      }
      return null;
    },
  },

  // ── Per-rule ruleset CRUD covered by full-record ruleset PUT ────
  // POST/PATCH /rulesets/{}/rules[/{}] add or update individual rules
  // within a ruleset; TZ PUTs the entire ruleset (rules and all) in
  // one call to ensure ordering and full-record semantics. Applies at
  // both account and zone scope.
  {
    name: 'redundant_with_ruleset_put',
    test: (method, _shape, _path) => method === 'POST' || method === 'PATCH',
    apply: (method, sh) => {
      if (/^\/(accounts|zones)\/\{\}\/rulesets\/\{\}\/rules(\/\{\})?$/.test(sh)) {
        const scope = sh.startsWith('/accounts/') ? 'accounts' : 'zones';
        return { reason: 'redundant_with_ruleset_put', covers: `PUT /${scope}/{}/rulesets/{}` };
      }
      return null;
    },
  },

  // ── PATCH redundant with PUT ────────────────────────────────────
  {
    name: 'redundant_with_put',
    test: (method, _shape, _path) => method === 'PATCH',
    apply: (method, sh) => {
      const putKey = 'PUT ' + sh;
      if (tzImplemented.has(putKey)) {
        return { reason: 'redundant_with_put', covers: putKey };
      }
      return null;
    },
  },

  // ── Dual-scope covered (zone↔account) ───────────────────────────
  {
    name: 'dual_scope_covered',
    test: () => true,
    apply: (method, sh) => {
      const altShape = sh.includes('/accounts/{}')
        ? sh.replace('/accounts/{}', '/zones/{}')
        : sh.includes('/zones/{}')
          ? sh.replace('/zones/{}', '/accounts/{}')
          : null;
      if (!altShape) return null;
      const altKey = method + ' ' + altShape;
      if (tzImplemented.has(altKey)) {
        return { reason: 'dual_scope_covered', covers: altKey };
      }
      return null;
    },
  },

  // ── Data-plane (runtime ops) ────────────────────────────────────
  {
    name: 'data_plane',
    test: () => true,
    apply: (method, sh) => {
      // Strong data-plane signals: messages, send/send_raw, insert/upsert/
      // query, ack/pull/purge, vectorize index data ops, R2 object writes,
      // KV bulk writes, email sending, AI inference, AI gateway logs/billing.
      const dataPlanePatterns = [
        /\/messages(\/|$)/,
        /\/messages\/(ack|pull|batch|purge)$/,
        /\/sending\/(send|send_raw)$/,
        /\/vectorize\/v2\/indexes\/\{\}\/(insert|upsert|query|delete_by_ids|get_by_ids)$/,
        /\/vectorize\/v2\/indexes\/\{\}\/metadata_index\/(create|delete)$/,
        /\/queues\/\{\}\/messages/,
        /\/r2\/buckets\/\{\}\/objects\/\{\}$/,
        /\/r2\/temp-access-credentials$/,
        /\/r2-catalog\//,
        /\/ai-gateway\/billing\//,
        /\/ai-gateway\/gateways\/\{\}\/logs\/\{\}$/,
        /\/storage\/kv\/.*\/bulk/,
        // KV per-key value PUT — runtime data ops, not config.
        /\/storage\/kv\/namespaces\/\{\}\/values\/\{\}$/,
      ];
      if (dataPlanePatterns.some(re => re.test(sh))) {
        return { reason: 'data_plane' };
      }
      return null;
    },
  },

  // ── Redundant with the modern POST /email/routing/dns ───────────
  // Must precede imperative_action because the catch-all /enable$ regex
  // below would otherwise grab POST /email/routing/enable.
  {
    name: 'redundant_with_post_dns',
    test: (method, _shape, _path) => method === 'POST',
    apply: (method, sh) => {
      if (sh === '/zones/{}/email/routing/enable') {
        return { reason: 'redundant_with_post_dns', covers: 'POST /zones/{}/email/routing/dns' };
      }
      return null;
    },
  },

  // ── Imperative actions (one-shot admin, not config) ─────────────
  {
    name: 'imperative_action',
    test: () => true,
    apply: (method, sh) => {
      // Verbs at the end of the path that imply "do a thing once" rather
      // than "configure state".
      const imperativeSuffixes = [
        /\/(activation_check|force_axfr|force_notify|preview|analyze|rollback|revoke_tokens|begin_verification|refresh|rotate|disable|enable|sync|order|deploy|trigger|submit)$/,
        /\/validate(\/|$)/,
        /\/ownership(\/|$)/,
        /\/scan(\/|$)/,
        /\/policy-tests$/,
        /\/access\/keys\/rotate$/,
        /\/saml_certificates\/\{\}\/rotate$/,
        /\/access\/organizations\/revoke_user$/,
        /\/expression-template\//,
        /\/messages-bulk\//,
        /\/secrets-bulk$/,
        /\/edge\/jobs$/,
        /\/control\/cmb\/config$/,
        // Cache management imperatives
        /\/purge_cache$/,
        /\/cache_reserve_clear$/,
        /\/cache\/tiered_cache_smart_topology_enable$/,
        // Leaked credentials enable (toggle, not config)
        /^POST \/zones\/\{\}\/leaked-credential-checks$/,
        // Firewall access rule PATCH (we POST fresh)
        /^PATCH \/zones\/\{\}\/firewall\/access_rules\/rules\/\{\}$/,
        // Rulesets PUT — we POST fresh per ruleset
        /^PUT \/zones\/\{\}\/rulesets\/\{\}$/,
        // Token validation rules PATCH — sub-feature update we don't tune
        /^PATCH \/zones\/\{\}\/token_validation\/rules\/\{\}$/,
        // Secrets store secret PATCH — cryptographic value change
        /\/secrets_store\/stores\/\{\}\/secrets\/\{\}$/,
        // Waiting rooms PUT/PATCH (we POST fresh)
        /^(PUT|PATCH) \/zones\/\{\}\/waiting_rooms\/\{\}$/,
        // SSO connectors POST — account-level Zero Trust admin
        /^POST \/accounts\/\{\}\/sso_connectors$/,
        // D1 data ops (export/import/time_travel are data-plane, not config
        // — categorising under imperative because they ARE one-shot ops)
        /\/d1\/database\/\{\}\/(export|import)$/,
        /\/time_travel\/restore$/,
        // Queue purge (admin action, not config)
        /\/queues\/\{\}\/purge$/,
        // Workflows: instance lifecycle ops
        /\/workflows\/\{\}\/instances/,
        // Secrets store duplicate
        /\/secrets_store\/stores\/\{\}\/secrets\/\{\}\/duplicate$/,
        // Speed Observatory: trigger tests / schedule (not config)
        /\/speed_api\/(pages\/\{\}\/tests|schedule\/\{\})$/,
        // Custom hostnames cert deployment ack
        /\/custom_hostnames\/\{\}\/certificate_pack\/\{\}\/certificates\/\{\}$/,
        // SAML cert rotate
        /\/saml_certificate$/,
      ];
      const key = method + ' ' + sh;
      if (imperativeSuffixes.some(re => re.test(sh) || re.test(key))) {
        return { reason: 'imperative_action' };
      }
      return null;
    },
  },

  // ── Sub-feature out of zone-migration scope ─────────────────────
  {
    name: 'sub_feature_oos',
    test: (method, sh) => true,
    apply: (method, sh) => {
      const key = method + ' ' + sh;
      // Patterns that match sub-features explicitly not part of zone migration.
      const subFeatureOosPatterns = [
        // Access AI controls (MCP / AI control plane)
        /\/access\/ai-controls\//,
        // Access bookmarks (Zero Trust bookmark apps, separate from real
        // Access apps)
        /\/access\/bookmarks(\/|$)/,
        // Access internal admin (organizations, users, certificates, gateway_ca, keys)
        /\/access\/(organizations|users|certificates|gateway_ca|keys|custom_pages)(\/|$)/,
        // Access SAML cert sets / mTLS hostname settings (out-of-band identity admin)
        /\/access\/saml_certificates\/\{\}/,
        // Workers observability destinations (separate observability
        // surface, not part of script migration)
        /\/workers\/observability\/(destinations|queries|telemetry)/,
        // Workers dispatch (separate platform feature, has its own admin)
        /\/workers\/dispatch\//,
        // Workers account-level settings (not zone-scoped)
        /\/workers\/account-settings$/,
        // Workers assets upload (handled implicitly by script upload)
        /\/workers\/assets\/upload$/,
        // Workers domains (handled via zone activation)
        /\/workers\/domains$/,
        // Workers script content/settings/deployments/tails/subdomain/versions
        // — these are alternative script-mgmt endpoints. TZ uses PUT
        // /workers/scripts/{name} (full script upload).
        /\/workers\/scripts\/\{\}\/(content|deployments|tails|subdomain|versions|schedules|script-settings|settings|assets-upload-session)$/,
        // Workers script PUT — TZ uses the bundle upload (multipart) endpoint
        // not the simple PUT-content. Categorise as redundant.
        // (covered by dual_scope already? no — different content type)
        // AI Gateway evaluations / datasets / provider_configs / routes
        // (advanced AI Gateway features, not basic gateway migration)
        /\/ai-gateway\/gateways\/\{\}\/(evaluations|datasets|provider_configs|routes)/,
        /\/ai-gateway\/gateways\/\{\}$/,   // we create gateway, update sub-config separately
        /\/ai-gateway\/custom-providers/,
        // (Removed: secondary_dns account-level ACLs/peers/tsigs were
        //  in admin_only until 2026-05-26. The audit re-scoped them as
        //  in-scope sub-resources of secondary_dns. POSTs are now
        //  implemented; PUTs are updated_via_post via the rule below.)
        // Logpush validation (validation endpoints, not config)
        /\/logpush\/(jobs\/\{\}|validate|ownership)/,
        /\/logs\/control\//,
        // SSL universal settings (auto-managed by Cloudflare)
        /\/ssl\/(universal|verification|certificate_packs\/order)/,
        /\/origin_tls_client_auth\/hostnames/,
        // origin_tls_client_auth POST (zone-level mTLS toggle) — we don't migrate
        /^POST \/zones\/\{\}\/origin_tls_client_auth$/,
        // API gateway operations (auto-discovery surface)
        /\/api_gateway\/(discovery|expression-template|configuration|labels)/,
        /\/api_gateway\/operations\/(\{\}\/(labels|schema_validation)|item)/,
        /\/api_gateway\/settings\/schema_validation/,
        /\/api_gateway\/operations\/schema_validation/,
        /\/api_gateway\/user_schemas\/\{\}/,
        // Schema validation v2 endpoints (newer, separate surface)
        /^(PUT|PATCH) \/zones\/\{\}\/schema_validation\//,
        // Token validation (separate sub-feature)
        /\/token_validation\/config\/\{\}/,
        // Pipelines v1 admin (data-plane management, beta)
        /\/pipelines\/v1\//,
        // Email routing imperative endpoints (DNS records, dest subdomains)
        /\/email\/(routing\/dns|routing\/disable|sending\/subdomains)/,
        // LB monitor groups (newer feature; we use monitors + pools)
        /\/load_balancers\/monitor_groups/,
        // Healthchecks preview (validation, not config)
        /\/healthchecks\/preview$/,
        // Zone environments (newer feature, separate migration scope)
        /\/zones\/\{\}\/environments/,
        // Devices/policy/certificates (Zero Trust device posture, sub-feature)
        /\/devices\/policy\/certificates$/,
        // ACM custom_trust_store (newer cert mgmt sub-feature)
        /\/acm\/custom_trust_store$/,
        // Origin CA temp-access-credentials (S3-compatible R2 access tokens)
        /\/r2\/temp-access-credentials$/,
        // Zone PATCH (general zone update — we use POST /zones for creation)
        /^PATCH \/zones\/\{\}$/,
        // Workers Routes account-level (we migrate per-zone routes)
        /\/workers\/scripts\/\{\}\/asset-upload-session$/,
        // Zaraz (managed analytics, separate sub-product surface)
        /\/settings\/zaraz\//,
        // Google Tag Gateway (Zaraz-adjacent newer sub-feature)
        /\/settings\/google-tag-gateway\//,
        // Cache origin_cloud_regions (newer sub-feature; we migrate basic cache)
        /\/cache\/origin_cloud_regions/,
        // Waiting rooms events + settings (we migrate the rooms, not the
        // per-room event override surface)
        /\/waiting_rooms\/\{\}\/events\/\{\}$/,
        /\/waiting_rooms\/settings$/,
        // Web3 IPFS content lists (specialized sub-feature)
        /\/web3\/hostnames\/\{\}\/ipfs_universal_path/,
        // KV value writes (data-plane — already covered by data_plane in
        // principle, but the pattern was too narrow)
        /\/storage\/kv\/namespaces\/\{\}\/values\/\{\}$/,
        // Hostnames settings (per-hostname overrides; we use custom_hostnames)
        /\/hostnames\/settings\/\{\}\/\{\}$/,
        /\/custom_hostnames\/fallback_origin$/,
        // Rulesets account-level rules PATCH/POST — we migrate the whole
        // ruleset via PUT, not individual rules
        /\/rulesets\/\{\}\/rules/,
        // Page rules PUT/PATCH (we migrate full page rules via POST + DELETE,
        // not per-rule updates)
        /^(PUT|PATCH) \/zones\/\{\}\/pagerules\/\{\}$/,
        // Snippets PUT (we POST snippets; snippet update is rare)
        /^PUT \/zones\/\{\}\/snippets\/\{\}$/,
        // Spectrum PUT (we POST spectrum apps fresh)
        /^PUT \/zones\/\{\}\/spectrum\/apps\/\{\}$/,
        // Rate limits PUT (we POST rate limits fresh)
        /^PUT \/zones\/\{\}\/rate_limits\/\{\}$/,
        // Email routing rules PUT (we POST rules fresh)
        /^PUT \/zones\/\{\}\/email\/routing\/rules\/\{\}$/,
        // Page Shield policies PUT (newer feature; we migrate page_shield
        // config only)
        /\/page_shield\/policies\/\{\}$/,
        // Workers script PUT — TZ uses the bundle/multipart upload endpoint
        /^PUT \/accounts\/\{\}\/workers\/scripts\/\{\}$/,
        // Workers.dev subdomain config — not zone migration
        /^PUT \/accounts\/\{\}\/workers\/subdomain$/,
        // workers/workers/{} — Cloudflare's newer "Workers v2" namespace
        // path; we use the established workers/scripts/{} path
        /\/workers\/workers/,
        // Workers route PUT — TZ deletes + recreates routes; doesn't update
        /^PUT \/zones\/\{\}\/workers\/routes\/\{\}$/,
        // Zone-level Access endpoints (we migrate Access at account scope)
        /^(POST|PUT|PATCH) \/zones\/\{\}\/access\/(apps|groups|identity_providers|service_tokens|certificates|organizations)/,
        // Access tags (newer sub-feature)
        /\/access\/tags(\/|$)/,
        // Access apps/CA POST at any scope — mTLS root certs, separate flow
        /\/access\/apps\/\{\}\/ca$/,
        // Snippets PUT — already covered above
        // ai_security custom-topics/settings (newer subscope)
        /\/ai-security\/(custom-topics|settings)$/,
        // content-upload-scan settings PUT — auto-config, we don't tune
        /\/content-upload-scan\/settings$/,
        // DNSSEC PATCH (we PATCH dnssec status; PATCH variant on same
        // endpoint is redundant)
        /^PATCH \/zones\/\{\}\/dnssec$/,
        // DNS bulk operations (separate batch-import surface)
        /\/dns_records\/(batch|import)$/,
        // Custom hostnames PATCH (we use POST + DELETE pattern)
        /^PATCH \/zones\/\{\}\/custom_hostnames\/\{\}$/,
        // Hyperdrive PUT/PATCH (we POST hyperdrive configs fresh)
        /^(PUT|PATCH) \/accounts\/\{\}\/hyperdrive\/configs\/\{\}$/,
        // Hyperdrive POST is a real gap unless we explicitly skip migration
        // — but Hyperdrive needs origin DB credentials which are
        // user-supplied, so it IS migratable. Keep this as a real gap.
        // Pipelines PUT/POST (we don't migrate pipeline configs in v1)
        /^(PUT|POST) \/accounts\/\{\}\/pipelines/,
        // Queues PUT/PATCH (we POST queues fresh)
        /^(PUT|PATCH) \/accounts\/\{\}\/queues\/\{\}$/,
        // Queue consumers PUT (we POST consumers fresh)
        /^PUT \/accounts\/\{\}\/queues\/\{\}\/consumers\/\{\}$/,
        // D1 PUT/PATCH (we POST databases fresh)
        /^(PUT|PATCH) \/accounts\/\{\}\/d1\/database\/\{\}$/,
        // R2 PATCH (we POST buckets fresh)
        /^PATCH \/accounts\/\{\}\/r2\/buckets\/\{\}$/,
        // R2 custom domains/lock/sippy (sub-features we don't migrate in v1)
        /\/r2\/buckets\/\{\}\/(domains\/custom|lock|sippy)/,
        // KV namespace PUT (we POST namespaces fresh)
        /^PUT \/accounts\/\{\}\/storage\/kv\/namespaces\/\{\}$/,
        // LB sub-resource updates (we POST monitors/pools/LBs fresh)
        /^(PUT|PATCH) \/accounts\/\{\}\/load_balancers\/(monitors|pools)\/\{\}$/,
        /^(PUT|PATCH) \/zones\/\{\}\/load_balancers\/\{\}$/,
        /^(PUT|PATCH) \/zones\/\{\}\/healthchecks\/\{\}$/,
        // (Removed: zone-scoped secondary_dns was sub_feature_oos until
        //  2026-05-26. POSTs are now implemented; PUTs are
        //  updated_via_post via the rule below.)
        // Access app/policy/group updates — we POST fresh on dest
        /^PUT \/accounts\/\{\}\/access\/(apps|policies|groups|service_tokens|identity_providers)\/\{\}$/,
        /^(PATCH|PUT) \/accounts\/\{\}\/access\/apps\/\{\}(\/settings)?$/,
        /^PUT \/accounts\/\{\}\/access\/apps\/\{\}\/policies\/\{\}$/,
        // Access apps/ca POST (mTLS root cert attachment — we don't migrate)
        /^POST \/accounts\/\{\}\/access\/apps\/\{\}\/ca$/,
        // Access service_tokens POST/PUT — service tokens are cryptographic
        // (already in IMPOSSIBLE) but the catalog matcher doesn't link to
        // this specific endpoint. Mark explicitly.
        /^POST \/accounts\/\{\}\/access\/service_tokens$/,
        // Access policies POST (we use account-level apps' policies endpoint)
        /^POST \/accounts\/\{\}\/access\/policies$/,
        // SSO connectors (Zero Trust admin)
        /\/sso_connectors\/\{\}/,
        // Custom CSRs / TLS sub-resources we don't tune
        /\/custom_csrs\/\{\}$/,
        // SSL client certs (mTLS, separate from server certs)
        /\/client_certificates(\/\{\})?$/,
        // SSL custom_certificates PATCH (we POST fresh)
        /^PATCH \/zones\/\{\}\/custom_certificates\/\{\}$/,
        // SSL cert pack PATCH (per-pack ACM config, not migrated in v1)
        /^PATCH \/zones\/\{\}\/ssl\/certificate_packs\/\{\}$/,
        // Cache reserve / cloud regions / TCS — handled above too
        // Workflows PUT (we POST fresh)
        /^PUT \/accounts\/\{\}\/workflows\/\{\}$/,
        // Workflows instance events (data-plane already; pattern catches
        // them anyway)
        // Vectorize POST /indexes (creation) — TZ does NOT yet migrate
        // vectorize indexes. Real gap.
        // ai_gateway PUT /gateways/{} (we POST fresh)
        /^PUT \/accounts\/\{\}\/ai-gateway\/gateways\/\{\}$/,
        // Page rules update — we POST fresh, never update
        // (covered above)
        // Rule lists (account-level Cloudflare-managed lists)
        /^(PUT|PATCH) \/accounts\/\{\}\/rulesets\/\{\}$/,
        // Filters PUT (legacy firewall filter update)
        /^PUT \/zones\/\{\}\/filters\/\{\}$/,
        // Firewall sub-resource updates (we POST fresh)
        /^(PUT|PATCH) \/zones\/\{\}\/firewall\/(rules|access_rules|lockdowns|ua_rules|waf\/overrides)\/\{\}/,
        /^PATCH \/accounts\/\{\}\/firewall\/access_rules\/rules\/\{\}$/,
        /^POST \/zones\/\{\}\/firewall\/waf\/overrides$/,
        // WAF packages (legacy WAF, group/rule overrides)
        /\/firewall\/waf\/packages\/\{\}\/(groups|rules)/,
        // Zone hold POST/PATCH (we don't migrate holds; they protect
        // against accidental deletion — destination starts fresh)
        /^(POST|PATCH) \/zones\/\{\}\/hold$/,
        // Zone subscription POST (we don't change subscription;
        // dest account decides plan)
        /^POST \/zones\/\{\}\/subscription$/,
        // Zone tags PUT (we PATCH tags via zone update if needed)
        /^PUT \/zones\/\{\}\/tags$/,
        // Web3 hostnames POST/PATCH (Web3 is beta; we don't migrate)
        /^(POST|PATCH) \/zones\/\{\}\/web3\/hostnames(\/\{\})?$/,
        // Leaked credentials detections (newer sub-feature)
        /\/leaked-credential-checks\/(detections|$)/,
        // Snippets PUT covered above
        // Custom hostnames cert PUT (handled above)
        // hostnames PUT (handled above)
        // Origin TLS POST (zone-level mTLS toggle) — handled above
      ];
      if (subFeatureOosPatterns.some(re => re.test(sh)) || subFeatureOosPatterns.some(re => re.test(key))) {
        return { reason: 'sub_feature_oos' };
      }
      return null;
    },
  },
];

// ── Explicit per-endpoint dispositions ──────────────────────────────────
// Authoritative, hand-curated reason for every in-scope gap the broad
// heuristics above don't classify precisely. Checked BEFORE the regex rules
// so it always wins. Keyed by "METHOD <shape>". Each value is { reason,
// covers?, notes? }. Endpoints that Twilight Zone genuinely implements are
// intentionally ABSENT here (they resolve to status=implemented via the
// tz-coverage index and never reach seedReason).
//
// Reason vocabulary additions (see REASON_DESC in scripts/coverage-report.mjs):
//   out_of_scope_subfeature  In-scope feature, but this sub-capability
//                            (advanced routing, separate product surface,
//                            runtime data) is out of zone-migration scope.
//   redundant_with_post      Per-item / alternative create endpoint covered
//                            by a collection POST that TZ implements.
//   redundant_with_settings_loop  Individual zone-setting endpoint covered by
//                            TZ's generic settings loop (PATCH every value
//                            returned by GET /zones/{}/settings).
//   impossible_cryptographic Write-only secret/key material in
//                            IMPOSSIBLE_TO_MIGRATE; cannot be exported.
const EXPLICIT_DISPOSITIONS = {
  // ── Zero Trust > Access ───────────────────────────────────────────────
  'PUT /accounts/{}/access/ai-controls/mcp/portals/{}': { reason: 'admin_only', notes: 'Access AI Controls (MCP) is an account-wide Zero Trust admin surface, not per-zone migration.' },
  'POST /accounts/{}/access/ai-controls/mcp/portals': { reason: 'admin_only', notes: 'Access AI Controls (MCP) is an account-wide Zero Trust admin surface.' },
  'PUT /accounts/{}/access/ai-controls/mcp/servers/{}': { reason: 'admin_only', notes: 'Access AI Controls (MCP) is an account-wide Zero Trust admin surface.' },
  'POST /accounts/{}/access/ai-controls/mcp/servers': { reason: 'admin_only', notes: 'Access AI Controls (MCP) is an account-wide Zero Trust admin surface.' },
  'PUT /accounts/{}/access/apps/{}/policies/{}/make_reusable': { reason: 'imperative_action', notes: 'One-shot conversion of an inline policy to reusable; not config state.' },
  'POST /accounts/{}/access/bookmarks/{}': { reason: 'updated_via_post', covers: 'POST /accounts/{}/access/bookmarks', notes: 'TZ migrates Access bookmarks via the collection POST; the per-id create/update endpoints are not used for a fresh migration.' },
  'PUT /accounts/{}/access/bookmarks/{}': { reason: 'updated_via_post', covers: 'POST /accounts/{}/access/bookmarks', notes: 'TZ creates bookmarks fresh on the destination.' },
  'PATCH /accounts/{}/access/seats': { reason: 'admin_only', notes: 'Seat assignment is account-wide Zero Trust admin.' },
  'POST /accounts/{}/scim/v2/Groups': { reason: 'admin_only', notes: 'SCIM provisioning is runtime identity sync driven by the IdP, not migration.' },
  'PATCH /accounts/{}/scim/v2/Groups/{}': { reason: 'admin_only', notes: 'SCIM provisioning is runtime identity sync.' },
  'POST /accounts/{}/scim/v2/Users': { reason: 'admin_only', notes: 'SCIM provisioning is runtime identity sync.' },
  'PATCH /accounts/{}/scim/v2/Users/{}': { reason: 'admin_only', notes: 'SCIM provisioning is runtime identity sync.' },
  'PUT /accounts/{}/scim/v2/Users/{}': { reason: 'admin_only', notes: 'SCIM provisioning is runtime identity sync.' },
  'POST /zones/{}/access/service_tokens': { reason: 'admin_only', notes: 'Access at account scope; the service-token CLIENT SECRET is cryptographic (IMPOSSIBLE_TO_MIGRATE access_service_token_secret).' },

  // ── AI > AI Gateway (advanced sub-features) ───────────────────────────
  'PATCH /accounts/{}/ai-gateway/custom-providers/{}': { reason: 'updated_via_post', notes: 'TZ POSTs custom providers fresh on the destination.' },
  'PATCH /accounts/{}/ai-gateway/custom-providers/costs/{}': { reason: 'updated_via_post', notes: 'TZ POSTs custom-provider costs fresh on the destination.' },
  'PUT /accounts/{}/ai-gateway/gateways/{}/datasets/{}': { reason: 'out_of_scope_subfeature', notes: 'Eval datasets are an advanced AI Gateway sub-feature beyond basic gateway migration.' },
  'POST /accounts/{}/ai-gateway/gateways/{}/datasets': { reason: 'out_of_scope_subfeature', notes: 'Eval datasets are an advanced AI Gateway sub-feature.' },
  'POST /accounts/{}/ai-gateway/gateways/{}/evaluations': { reason: 'imperative_action', notes: 'Runs an evaluation; one-shot action, not config.' },
  'PUT /accounts/{}/ai-gateway/gateways/{}/provider_configs/{}': { reason: 'out_of_scope_subfeature', notes: 'Per-gateway provider config is an advanced AI Gateway sub-feature.' },
  'POST /accounts/{}/ai-gateway/gateways/{}/routes/{}/deployments': { reason: 'imperative_action', notes: 'Deploys a route version; one-shot action.' },
  'POST /accounts/{}/ai-gateway/gateways/{}/routes/{}/versions': { reason: 'imperative_action', notes: 'Creates a route version snapshot; one-shot action.' },
  'PATCH /accounts/{}/ai-gateway/gateways/{}/routes/{}': { reason: 'out_of_scope_subfeature', notes: 'Dynamic routing (A/B, fallback) is an advanced AI Gateway sub-feature.' },
  'POST /accounts/{}/ai-gateway/gateways/{}/routes': { reason: 'out_of_scope_subfeature', notes: 'Dynamic routing is an advanced AI Gateway sub-feature.' },

  // ── D1 (data plane) ───────────────────────────────────────────────────
  'POST /accounts/{}/d1/database/{}/query': { reason: 'data_plane', notes: 'Runs SQL against the database — runtime data op.' },
  'POST /accounts/{}/d1/database/{}/raw': { reason: 'data_plane', notes: 'Runs raw SQL — runtime data op.' },

  // ── Email Routing / Sending ───────────────────────────────────────────
  'POST /accounts/{}/email/routing/suppression': { reason: 'data_plane', notes: 'Suppression list is runtime delivery data.' },
  'POST /accounts/{}/email/sending/suppression': { reason: 'data_plane', notes: 'Suppression list is runtime delivery data.' },
  'POST /zones/{}/email/routing/suppression': { reason: 'data_plane', notes: 'Suppression list is runtime delivery data.' },
  'POST /zones/{}/email/sending/suppression': { reason: 'data_plane', notes: 'Suppression list is runtime delivery data.' },
  'PATCH /zones/{}/email/routing/dns': { reason: 'redundant_with_post_dns', covers: 'POST /zones/{}/email/routing/dns', notes: 'Email Routing DNS records are (re)created via the POST endpoint TZ uses.' },
  'POST /zones/{}/email/sending/subdomains/{}/dns': { reason: 'out_of_scope_subfeature', notes: 'Email Sending (DMARC management subdomains) is a separate product surface.' },
  'PATCH /accounts/{}/email/routing/addresses/{}': { reason: 'admin_only', notes: 'Account-wide Email Routing destination-address admin; the address itself is account-scoped and its verification is manual (IMPOSSIBLE_TO_MIGRATE email_routing_destination_verification).' },
  'POST /zones/{}/email/routing/unlock': { reason: 'imperative_action', notes: 'Unlocks the Email Routing zone config; one-shot action, not config state.' },
  'PUT /zones/{}/email/routing': { reason: 'redundant_with_put', covers: 'PATCH /zones/{}/email/routing', notes: 'Email Routing settings (enabled/skip_wizard/support_subaddress) are migrated via the PATCH endpoint updateEmailRoutingSettings implements.' },

  // ── Workers (versioned-deploy endpoint) ───────────────────────────────
  'PATCH /accounts/{}/workers/workers/{}/versions/latest': { reason: 'redundant_with_bundle_put', notes: 'Worker version metadata patch; TZ deploys the entire worker via the multipart bundle PUT /accounts/{}/workers/scripts/{}.' },

  // ── Origin TLS dedicated settings (settings loop) ─────────────────────
  'PATCH /zones/{}/settings/origin_tls_compliance_modes': { reason: 'redundant_with_settings_loop', notes: 'Dedicated-endpoint Origin-TLS setting backfilled by export-zone (curatedSettingsAbsentFromAggregate) and applied via the generic settings loop.' },
  'PUT /zones/{}/settings/origin_tls_compliance_modes': { reason: 'redundant_with_settings_loop', notes: 'Dedicated-endpoint Origin-TLS setting applied via the settings loop (PATCH /settings/origin_tls_compliance_modes).' },

  // ── Load Balancing ────────────────────────────────────────────────────
  'PATCH /accounts/{}/load_balancers/pools': { reason: 'updated_via_post', notes: 'Bulk pool patch; TZ POSTs pools fresh on the destination.' },

  // ── Logs (Logpush job update + Log Explorer) ──────────────────────────
  'PUT /accounts/{}/logpush/jobs/{}': { reason: 'updated_via_post', notes: 'TZ POSTs Logpush jobs fresh on the destination.' },
  'POST /accounts/{}/logs/explorer/datasets': { reason: 'out_of_scope_subfeature', notes: 'Log Explorer saved datasets are a separate analytics product surface.' },
  'PUT /accounts/{}/logs/explorer/datasets/{}': { reason: 'out_of_scope_subfeature', notes: 'Log Explorer saved datasets are a separate analytics surface.' },
  'POST /accounts/{}/logs/explorer/query/sql': { reason: 'data_plane', notes: 'Runs an analytics SQL query — runtime data op.' },
  'POST /zones/{}/logs/explorer/datasets': { reason: 'out_of_scope_subfeature', notes: 'Log Explorer saved datasets are a separate analytics surface.' },
  'PUT /zones/{}/logs/explorer/datasets/{}': { reason: 'out_of_scope_subfeature', notes: 'Log Explorer saved datasets are a separate analytics surface.' },
  'POST /zones/{}/logs/explorer/query/sql': { reason: 'data_plane', notes: 'Runs an analytics SQL query — runtime data op.' },

  // ── Pipelines (account data-ingestion infra, beta) ────────────────────
  'POST /accounts/{}/pipelines': { reason: 'out_of_scope_subfeature', notes: 'Pipelines is account-scoped data-ingestion infrastructure, not zone configuration.' },
  'PUT /accounts/{}/pipelines/{}': { reason: 'out_of_scope_subfeature', notes: 'Pipelines is account-scoped data-ingestion infrastructure.' },
  'POST /accounts/{}/pipelines/v1/pipelines': { reason: 'out_of_scope_subfeature', notes: 'Pipelines is account-scoped data-ingestion infrastructure.' },
  'POST /accounts/{}/pipelines/v1/sinks': { reason: 'out_of_scope_subfeature', notes: 'Pipelines sinks are account-scoped data-ingestion infrastructure.' },
  'POST /accounts/{}/pipelines/v1/streams': { reason: 'out_of_scope_subfeature', notes: 'Pipelines streams are account-scoped data-ingestion infrastructure.' },
  'PATCH /accounts/{}/pipelines/v1/streams/{}': { reason: 'out_of_scope_subfeature', notes: 'Pipelines streams are account-scoped data-ingestion infrastructure.' },
  'POST /accounts/{}/pipelines/v1/validate_sql': { reason: 'imperative_action', notes: 'Validates a SQL transform; one-shot action.' },

  // ── R2 (data-plane + incremental-migration sub-features) ──────────────
  'PUT /accounts/{}/r2/buckets/{}/local-uploads': { reason: 'data_plane', notes: 'Multipart upload session management — runtime data op.' },
  'PUT /accounts/{}/r2/buckets/{}/sippy': { reason: 'out_of_scope_subfeature', notes: 'Sippy is incremental copy from another S3 provider; it requires the SOURCE bucket credentials, which cannot be exported.' },

  // ── Secondary DNS (PUT updates — TZ POSTs fresh) ──────────────────────
  'PUT /accounts/{}/secondary_dns/acls/{}': { reason: 'updated_via_post', covers: 'POST /accounts/{}/secondary_dns/acls', notes: 'TZ POSTs ACLs fresh on the destination.' },
  'PUT /accounts/{}/secondary_dns/peers/{}': { reason: 'updated_via_post', covers: 'POST /accounts/{}/secondary_dns/peers', notes: 'TZ POSTs peers fresh on the destination.' },
  'PUT /accounts/{}/secondary_dns/tsigs/{}': { reason: 'updated_via_post', covers: 'POST /accounts/{}/secondary_dns/tsigs', notes: 'TZ POSTs TSIGs fresh on the destination.' },
  'PUT /zones/{}/secondary_dns/incoming': { reason: 'updated_via_post', covers: 'POST /zones/{}/secondary_dns/incoming', notes: 'TZ POSTs the incoming-zone config fresh on the destination.' },
  'PUT /zones/{}/secondary_dns/outgoing': { reason: 'updated_via_post', covers: 'POST /zones/{}/secondary_dns/outgoing', notes: 'TZ POSTs the outgoing-zone config fresh on the destination.' },

  // ── Vectorize (account data infra; vectors are data-plane) ────────────
  'POST /accounts/{}/vectorize/indexes': { reason: 'out_of_scope_subfeature', notes: 'Vectorize indexes are account-scoped vector-DB infra; the vectors themselves are data-plane and cannot migrate, so the index config alone is not zone-migration scope.' },
  'PUT /accounts/{}/vectorize/indexes/{}': { reason: 'out_of_scope_subfeature', notes: 'Vectorize indexes are account-scoped vector-DB infra.' },
  'POST /accounts/{}/vectorize/indexes/{}/insert': { reason: 'data_plane', notes: 'Inserts vectors — runtime data op.' },
  'POST /accounts/{}/vectorize/indexes/{}/upsert': { reason: 'data_plane', notes: 'Upserts vectors — runtime data op.' },
  'POST /accounts/{}/vectorize/indexes/{}/query': { reason: 'data_plane', notes: 'Queries vectors — runtime data op.' },
  'POST /accounts/{}/vectorize/indexes/{}/get-by-ids': { reason: 'data_plane', notes: 'Reads vectors — runtime data op.' },
  'POST /accounts/{}/vectorize/indexes/{}/delete-by-ids': { reason: 'data_plane', notes: 'Deletes vectors — runtime data op.' },

  // ── Workers: dispatch (Workers for Platforms), observability, services ─
  'POST /accounts/{}/workers/assets/upload': { reason: 'redundant_with_bundle_put', covers: 'PUT /accounts/{}/workers/scripts/{}', notes: 'Asset upload is part of the multipart bundle PUT TZ uses for the whole script.' },
  'POST /accounts/{}/workers/dispatch/namespaces': { reason: 'out_of_scope_subfeature', notes: 'Workers for Platforms (dispatch namespaces) is a distinct platform product, not single-zone migration.' },
  'PATCH /accounts/{}/workers/dispatch/namespaces/{}': { reason: 'out_of_scope_subfeature', notes: 'Workers for Platforms dispatch namespace admin.' },
  'PUT /accounts/{}/workers/dispatch/namespaces/{}': { reason: 'out_of_scope_subfeature', notes: 'Workers for Platforms dispatch namespace admin.' },
  'PUT /accounts/{}/workers/dispatch/namespaces/{}/scripts/{}': { reason: 'out_of_scope_subfeature', notes: 'Workers for Platforms dispatch script.' },
  'POST /accounts/{}/workers/dispatch/namespaces/{}/scripts/{}/assets-upload-session': { reason: 'out_of_scope_subfeature', notes: 'Workers for Platforms dispatch script asset upload.' },
  'PUT /accounts/{}/workers/dispatch/namespaces/{}/scripts/{}/content': { reason: 'out_of_scope_subfeature', notes: 'Workers for Platforms dispatch script content.' },
  'PUT /accounts/{}/workers/dispatch/namespaces/{}/scripts/{}/secrets': { reason: 'out_of_scope_subfeature', notes: 'Workers for Platforms dispatch script secrets (cryptographic + WfP).' },
  'PATCH /accounts/{}/workers/dispatch/namespaces/{}/scripts/{}/settings': { reason: 'out_of_scope_subfeature', notes: 'Workers for Platforms dispatch script settings.' },
  'PUT /accounts/{}/workers/dispatch/namespaces/{}/scripts/{}/tags': { reason: 'out_of_scope_subfeature', notes: 'Workers for Platforms dispatch script tags.' },
  'PUT /accounts/{}/workers/dispatch/namespaces/{}/scripts/{}/tags/{}': { reason: 'out_of_scope_subfeature', notes: 'Workers for Platforms dispatch script tag.' },
  'PATCH /accounts/{}/workers/observability/destinations/{}': { reason: 'data_plane', notes: 'Workers Observability is runtime telemetry config; surfaced in the analytics capture modal, not migrated as zone config.' },
  'PATCH /accounts/{}/workers/observability/queries/{}': { reason: 'data_plane', notes: 'Saved observability query — runtime telemetry surface.' },
  'POST /accounts/{}/workers/observability/shared/query': { reason: 'data_plane', notes: 'Runs an observability query — runtime data op.' },
  'POST /accounts/{}/workers/observability/telemetry/keys': { reason: 'data_plane', notes: 'Observability telemetry introspection — runtime data op.' },
  'POST /accounts/{}/workers/observability/telemetry/live-tail': { reason: 'data_plane', notes: 'Live log tail — runtime data op.' },
  'POST /accounts/{}/workers/observability/telemetry/live-tail/heartbeat': { reason: 'data_plane', notes: 'Live log tail heartbeat — runtime data op.' },
  'POST /accounts/{}/workers/observability/telemetry/query': { reason: 'data_plane', notes: 'Observability log query — runtime data op; surfaced in the analytics capture modal.' },
  'POST /accounts/{}/workers/observability/telemetry/values': { reason: 'data_plane', notes: 'Observability facet values — runtime data op.' },
  'PUT /accounts/{}/workers/scripts/{}/usage-model': { reason: 'admin_only', notes: 'Account-level Workers billing/usage-model setting.' },
  'PUT /accounts/{}/workers/services/{}/environments/{}/content': { reason: 'redundant_with_bundle_put', covers: 'PUT /accounts/{}/workers/scripts/{}', notes: 'Legacy Services API; TZ uploads the whole script via the bundle PUT.' },
  'PATCH /accounts/{}/workers/services/{}/environments/{}/settings': { reason: 'redundant_with_bundle_put', covers: 'PUT /accounts/{}/workers/scripts/{}', notes: 'Legacy Services API; covered by the bundle PUT.' },
  'POST /workers/builds/deploy_hooks/{}': { reason: 'imperative_action', notes: 'Triggers a Workers build; one-shot action.' },

  // ── Security > API Shield ─────────────────────────────────────────────
  'PATCH /zones/{}/api_gateway/settings/schema_validation': { reason: 'redundant_with_put', covers: 'PUT /zones/{}/schema_validation/settings', notes: 'Legacy api_gateway path; TZ writes the schema-validation settings via the current /schema_validation/settings PUT.' },
  'PUT /zones/{}/api_gateway/settings/schema_validation': { reason: 'redundant_with_put', covers: 'PUT /zones/{}/schema_validation/settings', notes: 'Legacy api_gateway path; covered by the current /schema_validation/settings PUT.' },
  'PUT /zones/{}/api_gateway/operations/{}/schema_validation': { reason: 'redundant_with_post', covers: 'POST /zones/{}/api_gateway/operations/schema_validation', notes: 'Per-operation mitigation set in bulk via the operations/schema_validation POST TZ uses.' },
  'PATCH /zones/{}/schema_validation/settings/operations': { reason: 'redundant_with_post', covers: 'POST /zones/{}/api_gateway/operations/schema_validation', notes: 'Per-operation schema-validation mitigation set in bulk via operations/schema_validation.' },
  'PUT /zones/{}/schema_validation/settings/operations/{}': { reason: 'redundant_with_post', covers: 'POST /zones/{}/api_gateway/operations/schema_validation', notes: 'Per-operation schema-validation mitigation set in bulk.' },
  'PUT /zones/{}/api_gateway/labels/managed/{}/resources/operation': { reason: 'out_of_scope_subfeature', notes: 'Managed (Cloudflare-defined) API Shield labels are auto-managed, not user config.' },
  'PUT /zones/{}/api_gateway/labels/user/{}/resources/operation': { reason: 'redundant_with_put', covers: 'PUT /zones/{}/api_gateway/labels/user', notes: 'TZ migrates user labels via the labels/user PUT; operations carry labels at creation.' },
  'POST /zones/{}/api_gateway/operations/{}/labels': { reason: 'redundant_with_post', covers: 'POST /zones/{}/api_gateway/operations', notes: 'Operation labels are applied when TZ POSTs the operations.' },
  'PUT /zones/{}/api_gateway/operations/{}/labels': { reason: 'redundant_with_post', covers: 'POST /zones/{}/api_gateway/operations', notes: 'Operation labels are applied when TZ POSTs the operations.' },
  'POST /zones/{}/api_gateway/operations/labels': { reason: 'redundant_with_post', covers: 'POST /zones/{}/api_gateway/operations', notes: 'Bulk operation-label write; labels applied at operation creation.' },
  'PUT /zones/{}/api_gateway/operations/labels': { reason: 'redundant_with_post', covers: 'POST /zones/{}/api_gateway/operations', notes: 'Bulk operation-label write; labels applied at operation creation.' },
  'POST /zones/{}/api_gateway/operations/item': { reason: 'redundant_with_post', covers: 'POST /zones/{}/api_gateway/operations', notes: 'Single-operation create; TZ uses the bulk operations POST.' },
  'PATCH /zones/{}/token_validation/config/{}': { reason: 'updated_via_post', covers: 'POST /zones/{}/token_validation/config', notes: 'TZ POSTs token-validation configs fresh on the destination.' },
  'PUT /zones/{}/token_validation/config/{}/credentials': { reason: 'impossible_cryptographic', notes: 'JWKS signing/verification keys are write-only; cannot be exported. See IMPOSSIBLE_TO_MIGRATE api_shield_token_validation_credentials.' },
  'PATCH /zones/{}/token_validation/rules/bulk': { reason: 'redundant_with_post', covers: 'POST /zones/{}/token_validation/rules', notes: 'TZ writes token-validation rules via the per-rule POST.' },
  'POST /zones/{}/token_validation/rules/bulk': { reason: 'redundant_with_post', covers: 'POST /zones/{}/token_validation/rules', notes: 'TZ writes token-validation rules via the per-rule POST.' },

  // ── Security > Bots / Content Upload Scan / SSL ───────────────────────
  'POST /zones/{}/bot_management/feedback': { reason: 'data_plane', notes: 'Submits detection feedback — runtime data op.' },
  'POST /zones/{}/content-upload-scan/payloads': { reason: 'data_plane', notes: 'Submits a test scan payload — runtime data op.' },
  'POST /zones/{}/custom_csrs': { reason: 'imperative_action', notes: 'Generates a CSR; one-shot action producing a private key (cryptographic).' },

  // ── Caching origin cloud regions (covered by the /batch PATCH) ────────
  'PATCH /zones/{}/cache/origin_cloud_regions': { reason: 'redundant_with_put', covers: 'PATCH /zones/{}/cache/origin_cloud_regions/batch', notes: 'TZ writes origin cloud regions via the /batch endpoint.' },
  'POST /zones/{}/cache/origin_cloud_regions': { reason: 'redundant_with_post', covers: 'PATCH /zones/{}/cache/origin_cloud_regions/batch', notes: 'TZ writes origin cloud regions via the /batch endpoint.' },

  // ── Rules > Firewall (legacy) ─────────────────────────────────────────
  'POST /zones/{}/filters': { reason: 'updated_via_post', notes: 'Legacy filters underpin legacy firewall rules; TZ recreates firewall config fresh.' },
  'PUT /zones/{}/filters': { reason: 'updated_via_post', notes: 'Legacy filters bulk update; TZ recreates fresh.' },
  'PATCH /zones/{}/firewall/rules': { reason: 'updated_via_post', notes: 'Legacy firewall rules bulk update; TZ recreates fresh.' },
  'PUT /zones/{}/firewall/rules': { reason: 'updated_via_post', notes: 'Legacy firewall rules bulk update; TZ recreates fresh.' },
  'POST /zones/{}/firewall/waf/overrides': { reason: 'out_of_scope_subfeature', notes: 'Legacy WAF managed-ruleset overrides; the managed WAF is auto-managed and superseded by WAF custom rules (which TZ migrates).' },
  'PATCH /zones/{}/firewall/waf/packages/{}': { reason: 'out_of_scope_subfeature', notes: 'Legacy WAF managed package config; auto-managed/deprecated.' },
  'PATCH /zones/{}/firewall/waf/packages/{}/groups/{}': { reason: 'out_of_scope_subfeature', notes: 'Legacy WAF managed-rule group toggle; auto-managed/deprecated.' },
  'PATCH /zones/{}/firewall/waf/packages/{}/rules/{}': { reason: 'out_of_scope_subfeature', notes: 'Legacy WAF managed-rule toggle; auto-managed/deprecated.' },

  // ── Rules > Origin (Regional Services origin steering) ────────────────
  'PUT /zones/{}/origin/cloud_regions/{}': { reason: 'out_of_scope_subfeature', notes: 'Regional Services origin cloud-region steering; separate from Origin Rules transforms.' },
  'PUT /zones/{}/origin/cloud_regions/batch': { reason: 'out_of_scope_subfeature', notes: 'Regional Services origin cloud-region steering.' },

  // ── Traffic > Waiting Rooms (rules covered by full-replace PUT) ───────
  'POST /zones/{}/waiting_rooms/{}/rules': { reason: 'redundant_with_put', covers: 'PUT /zones/{}/waiting_rooms/{}/rules', notes: 'TZ writes all waiting-room rules via the full-replace PUT.' },
  'PATCH /zones/{}/waiting_rooms/{}/rules/{}': { reason: 'redundant_with_put', covers: 'PUT /zones/{}/waiting_rooms/{}/rules', notes: 'TZ writes all waiting-room rules via the full-replace PUT.' },

  // ── Zone Administration ───────────────────────────────────────────────
  'PATCH /zones/{}/email/auth/dmarc-reports': { reason: 'out_of_scope_subfeature', notes: 'DMARC Management is a separate Email Security surface.' },
  'PATCH /zones/{}/environments': { reason: 'out_of_scope_subfeature', notes: 'Zone Environments/Deployments is a pre-release feature outside the migration model.' },
  'POST /zones/{}/environments': { reason: 'out_of_scope_subfeature', notes: 'Zone Environments/Deployments is a pre-release feature.' },
  'PUT /zones/{}/environments': { reason: 'out_of_scope_subfeature', notes: 'Zone Environments/Deployments is a pre-release feature.' },
  'PATCH /zones/{}/pay-per-crawl/configuration': { reason: 'out_of_scope_subfeature', notes: 'Pay-per-crawl is a new monetization surface, not part of zone migration.' },

  // ── Zone Settings (individual setting endpoints + bulk) ───────────────
  'PATCH /zones/{}/settings': { reason: 'redundant_with_settings_loop', notes: 'Bulk settings PATCH; TZ migrates settings per-value via updateZoneSetting over GET /zones/{}/settings.' },
  'PATCH /zones/{}/settings/aegis': { reason: 'redundant_with_settings_loop', notes: 'Covered by the generic per-setting migration loop.' },
  'PATCH /zones/{}/settings/fonts': { reason: 'redundant_with_settings_loop', notes: 'Covered by the generic per-setting migration loop.' },
  'PATCH /zones/{}/settings/origin_h2_max_streams': { reason: 'redundant_with_settings_loop', notes: 'Covered by the generic per-setting migration loop.' },
  'PATCH /zones/{}/settings/origin_max_http_version': { reason: 'redundant_with_settings_loop', notes: 'Covered by the generic per-setting migration loop.' },
  'PATCH /zones/{}/settings/rum': { reason: 'redundant_with_settings_loop', notes: 'Covered by the generic per-setting migration loop.' },
  'PATCH /zones/{}/settings/speed_brain': { reason: 'redundant_with_settings_loop', notes: 'Covered by the generic per-setting migration loop.' },
  'PATCH /zones/{}/settings/ssl_automatic_mode': { reason: 'redundant_with_settings_loop', notes: 'Covered by the generic per-setting migration loop.' },

  // ── Security > Smart Shield (healthcheck updates — TZ POSTs fresh) ────
  'PATCH /zones/{}/smart_shield/healthchecks/{}': { reason: 'updated_via_post', covers: 'POST /zones/{}/smart_shield/healthchecks', notes: 'TZ POSTs Smart Shield health checks fresh on the destination.' },
  'PUT /zones/{}/smart_shield/healthchecks/{}': { reason: 'updated_via_post', covers: 'POST /zones/{}/smart_shield/healthchecks', notes: 'TZ POSTs Smart Shield health checks fresh on the destination.' },

  // ── Zaraz (publish/history/workflow are imperative; config is migrated) ─
  'PUT /zones/{}/settings/zaraz/history': { reason: 'imperative_action', notes: 'Restores a historical Zaraz config; one-shot action.' },
  'POST /zones/{}/settings/zaraz/publish': { reason: 'imperative_action', notes: 'Publishes the staged Zaraz config; one-shot action.' },
  'PUT /zones/{}/settings/zaraz/workflow': { reason: 'imperative_action', notes: 'Switches the active Zaraz workflow (realtime/preview); one-shot action.' },
};

function seedReason(method, pathShape) {
  const explicit = EXPLICIT_DISPOSITIONS[`${method} ${pathShape}`];
  if (explicit) return explicit;
  for (const rule of SEED_RULES) {
    if (!rule.test(method, pathShape)) continue;
    const r = rule.apply(method, pathShape);
    if (r) return r;
  }
  return { reason: null };
}

/**
 * Second-pass classification: refine the broad sub_feature_oos bucket into
 * three honest categories so the modal can give users distinct, accurate
 * explanations.
 *
 *   updated_via_post     TZ creates resources fresh on the destination
 *                        rather than updating existing ones. The PUT/PATCH
 *                        endpoint isn't relevant to a fresh-migration tool.
 *                        Example: PUT /accounts/{}/access/apps/{} — TZ
 *                        POSTs a new app, doesn't update an existing one.
 *
 *   newer_subfeature     Sub-feature not yet supported by TZ. Usually a
 *                        recently-shipped Cloudflare feature. Has a real
 *                        decision behind it ("we haven't added support
 *                        yet"), not a structural reason.
 *                        Example: POST /accounts/{}/access/ai-controls/
 *                        mcp/servers — Access AI Controls (MCP) is a
 *                        newer Zero Trust sub-feature.
 *
 *   admin_only           Account-wide admin sub-resource that doesn't
 *                        belong in a per-zone migration tool.
 *                        Example: POST /accounts/{}/access/keys/rotate —
 *                        rotating the account-wide Access JWT keys.
 */
function refineSubFeatureOos(method, pathShape) {
  const key = method + ' ' + pathShape;

  // ── updated_via_post: TZ POSTs fresh, doesn't use the update endpoint ──
  // Pattern: PUT or PATCH on a resource where we know TZ implements POST.
  // The key signal is method=PUT/PATCH and the path ends in `/{}` (per-
  // resource update) for a resource type TZ creates.
  const updatedViaPostPatterns = [
    // Access apps/policies/groups/IdPs/service tokens
    /^(PUT|PATCH) \/(accounts|zones)\/\{\}\/access\/(apps|policies|groups|service_tokens|identity_providers)\/\{\}/,
    // Load balancing resources
    /^(PUT|PATCH) \/(accounts|zones)\/\{\}\/load_balancers\/(monitors|pools)\/\{\}$/,
    /^(PUT|PATCH) \/zones\/\{\}\/load_balancers\/\{\}$/,
    /^(PUT|PATCH) \/zones\/\{\}\/healthchecks\/\{\}$/,
    // Waiting rooms
    /^(PUT|PATCH) \/zones\/\{\}\/waiting_rooms\/\{\}$/,
    // Page rules
    /^(PUT|PATCH) \/zones\/\{\}\/pagerules\/\{\}$/,
    // Rulesets
    /^(PUT|PATCH) \/(accounts|zones)\/\{\}\/rulesets\/\{\}$/,
    // Firewall sub-resources
    /^(PUT|PATCH) \/zones\/\{\}\/firewall\/(rules|access_rules|lockdowns|ua_rules|waf\/overrides)\/\{\}/,
    /^PATCH \/accounts\/\{\}\/firewall\/access_rules\/rules\/\{\}$/,
    // Storage primitives we POST fresh
    /^(PUT|PATCH) \/accounts\/\{\}\/queues\/\{\}$/,
    /^PUT \/accounts\/\{\}\/queues\/\{\}\/consumers\/\{\}$/,
    /^(PUT|PATCH) \/accounts\/\{\}\/d1\/database\/\{\}$/,
    /^PATCH \/accounts\/\{\}\/r2\/buckets\/\{\}$/,
    /^PUT \/accounts\/\{\}\/storage\/kv\/namespaces\/\{\}$/,
    /^(PUT|PATCH) \/accounts\/\{\}\/hyperdrive\/configs\/\{\}$/,
    /^PUT \/accounts\/\{\}\/workflows\/\{\}$/,
    // Email routing/sending
    /^PUT \/zones\/\{\}\/email\/routing\/rules\/\{\}$/,
    // Custom hostnames
    /^PATCH \/zones\/\{\}\/custom_hostnames\/\{\}$/,
    // SSL custom certs
    /^PATCH \/zones\/\{\}\/custom_certificates\/\{\}$/,
    // Rate limits
    /^PUT \/zones\/\{\}\/rate_limits\/\{\}$/,
    // Snippets
    /^PUT \/zones\/\{\}\/snippets\/\{\}$/,
    // Spectrum
    /^PUT \/zones\/\{\}\/spectrum\/apps\/\{\}$/,
    // Filters PUT
    /^PUT \/zones\/\{\}\/filters\/\{\}$/,
    // Tags
    /^PUT \/zones\/\{\}\/tags$/,
    // Filters / SAML cert
    /^PUT \/accounts\/\{\}\/ai-gateway\/gateways\/\{\}$/,
    // Workers script PUT (TZ uses multipart bundle upload)
    /^PUT \/accounts\/\{\}\/workers\/scripts\/\{\}$/,
    // Workers route PUT (TZ deletes + recreates routes)
    /^PUT \/zones\/\{\}\/workers\/routes\/\{\}$/,
    // Hostnames settings (per-hostname PUT)
    /^PUT \/zones\/\{\}\/hostnames\/settings\/\{\}\/\{\}$/,
    // Custom hostnames cert pack PUT
    /^PUT \/zones\/\{\}\/custom_hostnames\/\{\}\/certificate_pack\/\{\}\/certificates\/\{\}$/,
    // Leaked credential custom detection PUT — TZ POSTs fresh
    /^PUT \/zones\/\{\}\/leaked-credential-checks\/detections\/\{\}$/,
    // Web3 hostname PATCH — TZ POSTs fresh hostnames on dest
    /^PATCH \/zones\/\{\}\/web3\/hostnames\/\{\}$/,
    // Secondary DNS — TZ POSTs fresh on the dest; no PUT needed
    /^PUT \/accounts\/\{\}\/secondary_dns\/(acls|peers|tsigs)\/\{\}$/,
    /^PUT \/zones\/\{\}\/secondary_dns\/(incoming|outgoing)$/,
    // LB monitor groups — TZ POSTs fresh
    /^(PUT|PATCH) \/accounts\/\{\}\/load_balancers\/monitor_groups\/\{\}$/,
    // Logpush / Page Shield policies — TZ POSTs fresh
    /^PUT \/zones\/\{\}\/(logpush\/jobs|page_shield\/policies)\/\{\}$/,
    // DNSSEC PATCH — TZ PUTs the singleton fresh
    /^PATCH \/zones\/\{\}\/dnssec$/,
    // API Gateway discovery / labels / user_schemas — TZ POSTs fresh
    /^(PUT|PATCH) \/zones\/\{\}\/api_gateway\/(discovery\/operations(\/\{\})?|labels\/user\/\{\}|user_schemas\/\{\})$/,
    // schema_validation schemas PATCH — TZ POSTs fresh
    /^PATCH \/zones\/\{\}\/schema_validation\/schemas\/\{\}$/,
    // Waiting room events PUT/PATCH — TZ POSTs fresh
    /^(PUT|PATCH) \/zones\/\{\}\/waiting_rooms\/\{\}\/events\/\{\}$/,
  ];
  if (updatedViaPostPatterns.some(re => re.test(key))) {
    return 'updated_via_post';
  }

  // ── admin_only: account-wide admin sub-resources ────────────────────
  const adminOnlyPatterns = [
    // Access internal admin: organizations, users, certificates, keys,
    // saml_certificates (account-wide JWT/SSO admin)
    /\/access\/(organizations|users|certificates|gateway_ca|keys|custom_pages|saml_certificates|tags)/,
    // SSO connectors (account-level Zero Trust admin)
    /\/sso_connectors\b/,
    // Workers account-level settings
    /\/workers\/account-settings$/,
    /\/workers\/domains$/,
    /\/workers\/subdomain$/,
    // Logpush ownership / validate (account-level access checks)
    /\/logpush\/(validate|ownership)/,
    /\/logs\/control\//,
    // Devices/policy/certificates (Zero Trust device admin)
    /\/devices\/policy\/certificates$/,
    // SSL universal settings (auto-managed, account-level cert mgmt)
    /\/ssl\/(universal|verification)/,
    // Origin TLS client auth root (zone-level mTLS toggle)
    /^POST \/zones\/\{\}\/origin_tls_client_auth$/,
    // Origin TLS hostnames (per-hostname mTLS — account-wide reuse)
    /\/origin_tls_client_auth\/hostnames/,
    // Zone hold / subscription (account-wide zone admin)
    /^(POST|PATCH) \/zones\/\{\}\/hold$/,
    /^POST \/zones\/\{\}\/subscription$/,
    // Zone PATCH (general zone admin update)
    /^PATCH \/zones\/\{\}$/,
    // (Removed: secondary_dns account-level was admin_only until
    //  2026-05-26. The audit re-scoped these as in-scope sub-resources;
    //  POSTs are now implemented, PUTs are updated_via_post.)
    // R2 catalog & temp credentials (account-wide R2 admin)
    /\/r2\/temp-access-credentials$/,
    /\/r2-catalog\//,
    // Access apps/CA POST (mTLS root cert attachment)
    /\/access\/apps\/\{\}\/ca$/,
    // Access service tokens / policies POST (cryptographic — see IMPOSSIBLE)
    /^POST \/accounts\/\{\}\/access\/service_tokens$/,
    /^POST \/accounts\/\{\}\/access\/policies$/,
    // Custom CSRs
    /\/custom_csrs\/\{\}$/,
    // Client certificates (mTLS, separate from server certs)
    /\/client_certificates(\/\{\})?$/,
    // SSL cert pack PATCH (per-pack ACM, account-wide cert mgmt)
    /^PATCH \/zones\/\{\}\/ssl\/certificate_packs\/\{\}$/,
    // ACM custom trust store
    /\/acm\/custom_trust_store$/,
  ];
  if (adminOnlyPatterns.some(re => re.test(key))) {
    return 'admin_only';
  }

  // ── Everything else → newer_subfeature (default for sub_feature_oos) ──
  // These are typically recently-shipped Cloudflare features that TZ has
  // not yet added support for. Examples: Access AI Controls (MCP), AI
  // Gateway sub-features (evaluations/datasets/routes), Zaraz config,
  // Page Shield policies, Web3 IPFS, Workers V2, leaked credential
  // detections, content upload scan, Zone environments, schema validation
  // v2, token validation rules.
  return 'newer_subfeature';
}

// Pre-populated notes for endpoints that need human context rather than
// categorization. Keyed by "METHOD path_shape". These are NOT
// recategorized; they remain reason:null but get a human-readable note
// explaining why so the gap list is meaningful.
// (All three previously-listed prepopulated notes — Vectorize indexes,
//  Hyperdrive configs, Secrets Store stores — were the 3 in-SDK gaps
//  landed in the 2026-05-26 audit. As of that audit the in-SDK gap
//  count is 0; the notes are no longer applicable.)
const PREPOPULATED_NOTES = {};

// Load existing overrides to preserve hand-edits.
const OVERRIDES_PATH = path.join(ROOT, 'scripts/coverage-overrides.json');
let existing = { _comment: '', overrides: {} };
if (fs.existsSync(OVERRIDES_PATH)) {
  try { existing = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')); }
  catch { /* fall through */ }
}
const existingOverrides = existing.overrides || {};

// Build current gap set.
const overrides = {};
let gapCount = 0;
let seededCount = 0;
let preservedCount = 0;
let nullCount = 0;
for (const op of writes.operations) {
  if (op.method === 'DELETE') continue;
  const feat = classifyFeature(op.path);
  if (!feat || !feat.in_scope) continue;
  const sk = `${op.method} ${shape(op.path)}`;
  if (tzImplemented.has(sk)) continue;
  // Seed EVERY in-scope gap, whether or not it ships in the public SDK.
  // not-in-SDK endpoints (internal/pre-release/deprecated) are still real
  // OpenAPI surface; they need an honest reason so coverage docs/scripts make
  // clear they are not part of zone migration. The `in_sdk` flag is recorded
  // per entry for transparency.
  const inSdk = sdkShapes.has(sk);
  gapCount++;

  const key = sk;  // "METHOD /path/{}/etc"
  const explicit = EXPLICIT_DISPOSITIONS[key];
  const existingEntry = existingOverrides[key];
  // Preserve hand-edited entries — UNLESS the existing reason is a real-gap
  // marker (null / newer_subfeature) AND we now have an authoritative explicit
  // disposition for it. In that case the explicit disposition wins so the
  // 2026-05 audit's triaged classifications take effect.
  if (existingEntry && !(explicit && (!existingEntry.reason || existingEntry.reason === 'newer_subfeature'))) {
    overrides[key] = { ...existingEntry, in_sdk: inSdk };
    preservedCount++;
    if (!existingEntry.reason) nullCount++;
    continue;
  }
  const seeded = seedReason(op.method, shape(op.path));
  // Refine the broad sub_feature_oos bucket into honest sub-reasons so the
  // landing-page coverage modal can give users distinct explanations.
  const finalReason = seeded.reason === 'sub_feature_oos'
    ? refineSubFeatureOos(op.method, shape(op.path))
    : seeded.reason;
  const prepopulatedNotes = PREPOPULATED_NOTES[key] || '';
  overrides[key] = {
    reason: finalReason,
    ...(seeded.covers && { covers: seeded.covers }),
    notes: prepopulatedNotes,
    feature: feat.id,
    in_sdk: inSdk,
    example_path: op.path,
  };
  if (finalReason) seededCount++;
  else nullCount++;
}

const out = {
  _comment: 'Per-endpoint coverage overrides. Each entry corresponds to an in-SDK in-scope endpoint that Twilight Zone does NOT implement. Reasons counted as covered exclusions: data_plane (runtime data ops — queue messages, vectorize insert/query, R2 object writes, email send, AI inference); imperative_action (one-shot admin actions — purge, force_axfr, validate, preview, rollback, rotate, refresh, enable/disable); redundant_with_put (PATCH X covered by PUT X with full-record semantics); redundant_with_post_dns (deprecated alias covered by POST /email/routing/dns); redundant_with_bundle_put (per-aspect Workers script endpoint covered by the multipart bundle PUT); redundant_with_record_post (DNS bulk endpoint covered by per-record POST); redundant_with_ruleset_put (per-rule ruleset CRUD covered by full-record ruleset PUT); dual_scope_covered (endpoint at one scope (zone or account) covered by the other); updated_via_post (PUT/PATCH on a resource TZ POSTs fresh on the destination); admin_only (account-wide admin sub-resource not part of per-zone migration). reason:newer_subfeature is triaged but unsupported and still counts as a gap. reason:null means an untriaged real gap. Re-seed via `node scripts/seed-coverage-overrides.mjs --write`.',
  _stats: {
    total: Object.keys(overrides).length,
    by_reason: countByReason(overrides),
    real_gaps_remaining: countRealGaps(overrides),
  },
  overrides,
};

// Pretty-printed JSON output.
const output = JSON.stringify(out, null, 2) + '\n';
if (wantWrite) {
  fs.writeFileSync(OVERRIDES_PATH, output);
} else {
  process.stdout.write(output);
}

// Stats to stderr so they don't pollute redirected stdout.
console.error(`✓ Total in-scope in-SDK gap endpoints: ${gapCount}`);
console.error(`✓ Preserved from existing file: ${preservedCount}`);
console.error(`✓ Seeded with reason: ${seededCount}`);
console.error(`✓ Real gaps (reason:null or newer_subfeature): ${countRealGaps(overrides)}`);
console.error('');
console.error('Breakdown by seeded reason:');
for (const [r, c] of Object.entries(countByReason(overrides)).sort((a, b) => b[1] - a[1])) {
  console.error(`  ${(r || '(null/real gap)').padEnd(22)} ${c}`);
}

function countByReason(o) {
  const counts = {};
  for (const v of Object.values(o)) {
    const r = v.reason || '_null';
    counts[r] = (counts[r] || 0) + 1;
  }
  return counts;
}

function countRealGaps(o) {
  let count = 0;
  for (const v of Object.values(o)) {
    if (!v.reason || v.reason === 'newer_subfeature') count++;
  }
  return count;
}
