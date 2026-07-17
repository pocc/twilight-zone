// Capture catalog — single source of truth for E2E evidence capture.
//
// PURE DATA, NO SIDE EFFECTS. Safe to import from anywhere (the capture script,
// the Playwright harness, and unit tests) without triggering env validation or
// network calls.
//
// Three things live here so they can never drift apart:
//   1. ENDPOINTS            — the full state-capture endpoint catalog.
//   2. HOOK_ENDPOINTS       — for each evidence-reading post-run assertion, the
//                             exact capture endpoints its evidence comes from.
//   3. HOOKS_NEEDING_EVIDENCE — derived from HOOK_ENDPOINTS keys, so the
//                             "does this test need a capture?" gate and the
//                             "which endpoints does it need?" map are the same
//                             source of truth.
//
// L1 (targeted capture): capture-zone-state.mjs honors CAPTURE_ONLY (a
// comma-separated endpoint-name allowlist) to fetch only what a test's
// assertions actually read, instead of the full ~78-endpoint sweep (~85s/side).
// The harness derives CAPTURE_ONLY from a config's post-run hooks via
// endpointsForHooks(). This is OPT-IN (env TARGETED_CAPTURE): when unset the
// capture is full and behavior is byte-for-byte unchanged.

// ── Endpoint catalog ────────────────────────────────────────────────
// Each entry: { name, method, path, optional }.
// `optional: true` means a 4xx (often "feature not enabled") is fine and the
// capture writes an empty result envelope instead of erroring.
export const ENDPOINTS = [
  // ── Zone-scoped (core) ─────────────────────────────────────────
  { name: 'zone',                 method: 'GET', path: '/zones/{zone_id}' },
  { name: 'settings',             method: 'GET', path: '/zones/{zone_id}/settings' },
  { name: 'dns_records',          method: 'GET', path: '/zones/{zone_id}/dns_records?per_page=500' },
  { name: 'dns_settings',         method: 'GET', path: '/zones/{zone_id}/dns_settings', optional: true },
  { name: 'dnssec',               method: 'GET', path: '/zones/{zone_id}/dnssec', optional: true },
  { name: 'pagerules',            method: 'GET', path: '/zones/{zone_id}/pagerules' },
  { name: 'firewall_rules',       method: 'GET', path: '/zones/{zone_id}/firewall/rules?per_page=500', optional: true },
  { name: 'rate_limits',          method: 'GET', path: '/zones/{zone_id}/rate_limits?per_page=500', optional: true },
  { name: 'rulesets',             method: 'GET', path: '/zones/{zone_id}/rulesets' },
  { name: 'worker_routes',        method: 'GET', path: '/zones/{zone_id}/workers/routes', optional: true },

  // ── Zone-scoped (resources currently or potentially migrated) ──
  { name: 'email_routing_status', method: 'GET', path: '/zones/{zone_id}/email/routing', optional: true },
  { name: 'email_routing_rules',  method: 'GET', path: '/zones/{zone_id}/email/routing/rules?per_page=500', optional: true },
  { name: 'load_balancers',       method: 'GET', path: '/zones/{zone_id}/load_balancers', optional: true },
  { name: 'custom_certificates',  method: 'GET', path: '/zones/{zone_id}/custom_certificates', optional: true },
  { name: 'custom_hostnames',     method: 'GET', path: '/zones/{zone_id}/custom_hostnames?per_page=500', optional: true },
  { name: 'spectrum_apps',        method: 'GET', path: '/zones/{zone_id}/spectrum/apps', optional: true },
  { name: 'waiting_rooms',        method: 'GET', path: '/zones/{zone_id}/waiting_rooms', optional: true },
  { name: 'argo_smart_routing',   method: 'GET', path: '/zones/{zone_id}/argo/smart_routing', optional: true },
  { name: 'argo_tiered_caching',  method: 'GET', path: '/zones/{zone_id}/argo/tiered_caching', optional: true },
  { name: 'bot_management',       method: 'GET', path: '/zones/{zone_id}/bot_management', optional: true },

  // ── Zone-scoped (newly-tracked resources) ──────────────────────
  { name: 'managed_headers',      method: 'GET', path: '/zones/{zone_id}/managed_headers', optional: true },
  { name: 'cloud_connector_rules',method: 'GET', path: '/zones/{zone_id}/cloud_connector/rules', optional: true },
  { name: 'url_normalization',    method: 'GET', path: '/zones/{zone_id}/url_normalization', optional: true },
  { name: 'cache_reserve',        method: 'GET', path: '/zones/{zone_id}/cache/cache_reserve', optional: true },
  { name: 'regional_tiered_cache',method: 'GET', path: '/zones/{zone_id}/cache/regional_tiered_cache', optional: true },
  { name: 'cache_variants',       method: 'GET', path: '/zones/{zone_id}/cache/variants', optional: true },
  { name: 'origin_post_quantum',  method: 'GET', path: '/zones/{zone_id}/cache/origin_post_quantum_encryption', optional: true },
  { name: 'snippets',             method: 'GET', path: '/zones/{zone_id}/snippets', optional: true },
  { name: 'snippet_rules',        method: 'GET', path: '/zones/{zone_id}/snippets/snippet_rules', optional: true },
  { name: 'page_shield',          method: 'GET', path: '/zones/{zone_id}/page_shield', optional: true },
  { name: 'page_shield_policies', method: 'GET', path: '/zones/{zone_id}/page_shield/policies', optional: true },
  { name: 'healthchecks',         method: 'GET', path: '/zones/{zone_id}/healthchecks', optional: true },
  { name: 'logpush_jobs',         method: 'GET', path: '/zones/{zone_id}/logpush/jobs', optional: true },
  { name: 'api_gateway_operations', method: 'GET', path: '/zones/{zone_id}/api_gateway/operations', optional: true },
  { name: 'api_gateway_user_schemas', method: 'GET', path: '/zones/{zone_id}/api_gateway/user_schemas', optional: true },
  { name: 'api_gateway_configuration', method: 'GET', path: '/zones/{zone_id}/api_gateway/configuration', optional: true },
  { name: 'schema_validation_settings', method: 'GET', path: '/zones/{zone_id}/schema_validation/settings', optional: true },
  { name: 'client_certificates',  method: 'GET', path: '/zones/{zone_id}/client_certificates', optional: true },
  { name: 'origin_tls_settings',  method: 'GET', path: '/zones/{zone_id}/origin_tls_client_auth/settings', optional: true },
  { name: 'origin_tls_client_auth', method: 'GET', path: '/zones/{zone_id}/origin_tls_client_auth', optional: true },
  { name: 'zaraz_config',         method: 'GET', path: '/zones/{zone_id}/settings/zaraz/config', optional: true },
  { name: 'google_tag_gateway',   method: 'GET', path: '/zones/{zone_id}/settings/google-tag-gateway/config', optional: true },
  { name: 'smart_shield',         method: 'GET', path: '/zones/{zone_id}/smart_shield', optional: true },
  { name: 'firewall_lockdowns',   method: 'GET', path: '/zones/{zone_id}/firewall/lockdowns?per_page=100', optional: true },
  { name: 'firewall_ua_rules',    method: 'GET', path: '/zones/{zone_id}/firewall/ua_rules?per_page=100', optional: true },
  { name: 'firewall_access_rules',method: 'GET', path: '/zones/{zone_id}/firewall/access_rules/rules?per_page=100', optional: true },
  { name: 'subscription',         method: 'GET', path: '/zones/{zone_id}/subscription', optional: true },

  // Read-only / analytics families (capture for parity/baseline diff)
  { name: 'dns_analytics_report', method: 'GET', path: '/zones/{zone_id}/dns_analytics/report?since=-PT1H', optional: true },
  { name: 'available_plans',      method: 'GET', path: '/zones/{zone_id}/available_plans', optional: true },
  { name: 'available_rate_plans', method: 'GET', path: '/zones/{zone_id}/available_rate_plans', optional: true },
  { name: 'fraud_detection',      method: 'GET', path: '/zones/{zone_id}/fraud_detection/settings', optional: true },
  { name: 'regional_hostnames',   method: 'GET', path: '/zones/{zone_id}/addressing/regional_hostnames', optional: true },
  { name: 'hostname_associations',method: 'GET', path: '/zones/{zone_id}/certificate_authorities/hostname_associations', optional: true },
  { name: 'certificate_packs',    method: 'GET', path: '/zones/{zone_id}/ssl/certificate_packs', optional: true },
  { name: 'acm_total_tls',        method: 'GET', path: '/zones/{zone_id}/acm/total_tls', optional: true },
  { name: 'dnssec',               method: 'GET', path: '/zones/{zone_id}/dnssec', optional: true },
  { name: 'custom_ns',            method: 'GET', path: '/zones/{zone_id}/custom_ns', optional: true },
  { name: 'token_validation_configs',method: 'GET', path: '/zones/{zone_id}/token_validation/config', optional: true },
  { name: 'token_validation_rules',  method: 'GET', path: '/zones/{zone_id}/token_validation/rules', optional: true },

  // ── Account-scoped ─────────────────────────────────────────────
  { name: 'workers_account',      method: 'GET', path: '/accounts/{account_id}/workers/scripts', optional: true },
  { name: 'worker_custom_domains',method: 'GET', path: '/accounts/{account_id}/workers/domains', optional: true },
  { name: 'durable_object_namespaces', method: 'GET', path: '/accounts/{account_id}/workers/durable_objects/namespaces', optional: true },
  { name: 'kv_namespaces',        method: 'GET', path: '/accounts/{account_id}/storage/kv/namespaces?per_page=100', optional: true },
  { name: 'd1_databases',         method: 'GET', path: '/accounts/{account_id}/d1/database?per_page=100', optional: true },
  { name: 'queues',               method: 'GET', path: '/accounts/{account_id}/queues', optional: true },
  { name: 'r2_buckets',           method: 'GET', path: '/accounts/{account_id}/r2/buckets', optional: true },
  { name: 'turnstile_widgets',    method: 'GET', path: '/accounts/{account_id}/challenges/widgets', optional: true },
  { name: 'access_apps',          method: 'GET', path: '/accounts/{account_id}/access/apps', optional: true },
  { name: 'access_groups',        method: 'GET', path: '/accounts/{account_id}/access/groups', optional: true },
  { name: 'access_service_tokens',method: 'GET', path: '/accounts/{account_id}/access/service_tokens', optional: true },
  { name: 'identity_providers',   method: 'GET', path: '/accounts/{account_id}/access/identity_providers', optional: true },
  { name: 'lb_pools',             method: 'GET', path: '/accounts/{account_id}/load_balancers/pools', optional: true },
  { name: 'lb_monitors',          method: 'GET', path: '/accounts/{account_id}/load_balancers/monitors', optional: true },
  { name: 'account_rulesets',     method: 'GET', path: '/accounts/{account_id}/rulesets', optional: true },
  { name: 'rules_lists',          method: 'GET', path: '/accounts/{account_id}/rules/lists', optional: true },
  // Workers-platform-adjacent resources used by MaxWorker bindings
  { name: 'vectorize_indexes',    method: 'GET', path: '/accounts/{account_id}/vectorize/v2/indexes', optional: true },
  { name: 'dispatch_namespaces',  method: 'GET', path: '/accounts/{account_id}/workers/dispatch/namespaces', optional: true },
  { name: 'pipelines',            method: 'GET', path: '/accounts/{account_id}/pipelines', optional: true },
  { name: 'hyperdrive_configs',   method: 'GET', path: '/accounts/{account_id}/hyperdrive/configs', optional: true },
  { name: 'workflows',            method: 'GET', path: '/accounts/{account_id}/workflows', optional: true },
  { name: 'secrets_store',        method: 'GET', path: '/accounts/{account_id}/secrets_store/stores', optional: true },
];

// Endpoints always captured under targeted mode (cheap, broadly useful baseline).
export const CORE_ENDPOINTS = ['zone'];

// Map each evidence-reading post-run assertion to the capture endpoints its
// evidence comes from. The aggregate `settings` capture also drives the
// dedicated-scalar enrichment (settings_dedicated.json) and the per-worker
// bindings enrichment runs off `workers_account`, so those enrichments come
// along automatically when their base endpoint is selected.
//
// Adding a new evidence assertion? Add it here (the guard test
// test/captureCatalog.test.ts fails until every HOOKS_NEEDING_EVIDENCE hook is
// mapped to real endpoint names).
export const HOOK_ENDPOINTS = {
  // Aggregate zone settings (+ dedicated-scalar enrichment off settings.json).
  assertZoneSettingsMatch: ['settings'],
  assertDedicatedScalarSettingsMatch: ['settings'],
  // Dedicated subsystem settings.
  assertDedicatedSettingsMatch: ['dns_settings', 'origin_tls_settings', 'fraud_detection', 'schema_validation_settings'],
  assertZoneSingletonSettingsMatch: [
    'managed_headers',
    'url_normalization',
    'cache_reserve',
    'dns_settings',
    'regional_tiered_cache',
    'cache_variants',
    'origin_post_quantum',
    'fraud_detection',
    'page_shield',
    'schema_validation_settings',
    'api_gateway_configuration',
    'origin_tls_settings',
    'google_tag_gateway',
    'smart_shield',
  ],
  // DNS proxied flags.
  assertProxiedFlagsMatch: ['dns_records'],
  // DNS record-type breadth: every declared record present on dest.
  assertDnsRecordTypesPresent: ['dns_records'],
  // Load balancer pool/monitor remap.
  assertLbPoolIdsRemapped: ['lb_pools', 'lb_monitors', 'load_balancers'],
  // Storage round-trips.
  assertKvKeysCopied: ['kv_namespaces'],
  assertR2ObjectsCopied: ['r2_buckets'],
  // Durable Objects.
  assertDoNamespaceCreated: ['durable_object_namespaces', 'workers_account'],
  assertDoStateMigrated: ['durable_object_namespaces', 'workers_account'],
  // Access.
  assertAccessPolicyIdpRemapped: ['access_apps', 'identity_providers', 'access_groups'],
  assertAccessMultiDomainMigrated: ['access_apps'],
  // Workers.
  assertServiceBindingResolves: ['workers_account'],
  assertWorkerBindingsCompletelyMigrated: ['workers_account'],
};

// Derived: the set of post-run hooks that require an evidence capture. Keeping
// this as the keys of HOOK_ENDPOINTS guarantees the "needs capture" gate and the
// "which endpoints" map can never disagree.
export const HOOKS_NEEDING_EVIDENCE = new Set(Object.keys(HOOK_ENDPOINTS));

/**
 * Given a list of post-run hook names, return the targeted capture endpoint-name
 * allowlist (CORE ∪ the union of each evidence hook's endpoints), or `null` when
 * any evidence hook is unmapped — in which case the caller MUST fall back to a
 * full capture (fail-safe: never silently under-capture).
 *
 * Non-evidence hooks (report-text / live-fetch assertions) are ignored.
 */
export function endpointsForHooks(hooks) {
  const list = (Array.isArray(hooks) ? hooks : []).map(h => String(h).trim()).filter(Boolean);
  const out = new Set(CORE_ENDPOINTS);
  for (const h of list) {
    if (!HOOKS_NEEDING_EVIDENCE.has(h)) continue; // non-evidence hook
    const eps = HOOK_ENDPOINTS[h];
    if (!eps) return null; // evidence hook with no mapping → caller does full capture
    for (const e of eps) out.add(e);
  }
  return [...out];
}
