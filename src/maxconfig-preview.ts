// =============================================================================
// MaxConfig Preview Builder
// -----------------------------------------------------------------------------
// Constructs a synthetic ZoneExport-shaped object that represents what
// "All Features On" (the MaxConfig preset) is going to apply when the user
// runs it. This lets Step 2 preview the change set WITHOUT issuing ~28
// GET requests against the source zone — the source zone's current state
// is irrelevant for an additive preset that just slams MaxConfig values on
// top of whatever exists.
//
// The shape returned by `buildMaxConfigPreview` must satisfy the consumers
// in `app/components/steps/scope/groups.ts::buildGroups()`. Each field below
// mirrors a real /api/export response field, with synthetic IDs of the form
// `maxconfig-<resource>-<n>` so the UI can render and select items.
//
// In MaxConfig mode the source account IS the destination, so we already
// know the account's capability surface by the time the preview is built.
// We use that to OMIT resources we know cannot be applied (e.g. Spectrum
// apps when the account has no Spectrum entitlement). The user explicitly
// opted into "All Features On" — surfacing checkboxes to acknowledge things
// we already know won't apply is noise. They appear as "skipped" in the
// Step 4 report instead.
//
// IMPORTANT: This file MUST stay in sync with `createMaximumConfig()` in
// `src/fuzz.ts`. If you add a resource to MaxConfig, mirror it here so the
// Step 2 preview accurately reflects what's about to happen.
// =============================================================================
import { MAXIMUM_CONFIG_RULES, ZONE_SETTINGS, type SettingDefinition } from './fuzz';
import type { ZoneExport } from './types';

/** Subset of `AccountCapabilities` used for filtering — keeps this module
 *  free of any app-side imports. The fields match `app/lib/api.ts`. */
export interface MaxConfigCapabilities {
  zeroTrust?: { available: boolean };
  r2?: { available: boolean };
  loadBalancing?: { available: boolean };
  workers?: { available: boolean };
  spectrum?: { available: boolean };
  analyticsEngine?: { available: boolean };
  rateLimiting?: { available: boolean };
  queues?: { available: boolean };
  d1?: { available: boolean };
  vectorize?: { available: boolean };
}

/** True if the capability is unknown (no probe data) or explicitly available. */
function has(cap: { available: boolean } | undefined): boolean {
  return !cap || cap.available;
}

/**
 * Compute the "max" value MaxConfig will write for a given zone setting.
 * Mirrors `getMaxValue()` in `src/fuzz.ts` — kept private there because it's
 * tied to the apply path; we duplicate the logic here so the preview matches
 * the actual write without exporting an internal helper.
 *
 * Keep these two functions in sync. (Tests in `test/fuzz.test.ts` cover the
 * apply path; the preview is a UI concern only.)
 */
function maxValueFor(setting: SettingDefinition): unknown {
  if (setting.type === 'on_off') {
    return setting.testValues.includes('on') ? 'on' : setting.testValues[0];
  }
  switch (setting.id) {
    case 'ssl': return 'strict';
    case 'cache_level': return 'aggressive';
    case 'min_tls_version': return '1.2';
    case 'security_level': return 'high';
    case 'polish': return 'lossy';
    case 'pseudo_ipv4': return 'add_header';
    case 'browser_cache_ttl': return 31536000;
    case 'challenge_ttl': return 31536000;
    case 'max_upload': return setting.testValues[setting.testValues.length - 1];
    case 'proxy_read_timeout': return 100;
    case 'origin_dns_name': return '';
    case 'security_header':
      return { strict_transport_security: { enabled: true, max_age: 31536000, include_subdomains: true, preload: true, nosniff: true } };
    default: return setting.testValues[0];
  }
}

/**
 * Build a synthetic ZoneExport representing the change set that the
 * `/api/maxconfig/stream` endpoint will apply when run with `mode: 'all'`.
 *
 * This is what Step 2 displays for the "All Features On" source mode.
 * Selections are advisory only — the endpoint applies the full preset
 * regardless of which boxes the user checks/unchecks in Step 2.
 *
 * @param capabilities Optional capability probe result for the source account
 *   (which IS the destination in MaxConfig mode). When provided, resources
 *   gated by missing capabilities are omitted from the preview entirely.
 */
export function buildMaxConfigPreview(
  zoneId: string,
  zoneName: string,
  accountId: string,
  accountName: string,
  capabilities?: MaxConfigCapabilities,
): ZoneExport {
  const hasLB        = has(capabilities?.loadBalancing);
  const hasSpectrum  = has(capabilities?.spectrum);
  const hasWorkers   = has(capabilities?.workers);
  const hasR2        = has(capabilities?.r2);
  const hasD1        = has(capabilities?.d1);
  const hasQueues    = has(capabilities?.queues);
  const hasRateLimit = has(capabilities?.rateLimiting);
  const hasAE        = has(capabilities?.analyticsEngine);

  // ── Zone Settings ────────────────────────────────────────────
  // One entry per ZONE_SETTINGS definition (deprecated entries excluded —
  // MaxConfig skips them too via the `deprecated` flag in fuzz.ts).
  const settings = ZONE_SETTINGS
    .filter(s => !s.deprecated)
    .map(s => ({ id: s.id, value: maxValueFor(s), editable: true }));

  // ── Rulesets ─────────────────────────────────────────────────
  // Group MAXIMUM_CONFIG_RULES by phase. Skip the http_ratelimit phase when
  // the account has no Rate Limiting entitlement.
  const rulesByPhase = new Map<string, typeof MAXIMUM_CONFIG_RULES>();
  for (const rule of MAXIMUM_CONFIG_RULES) {
    if (rule.phase === 'http_ratelimit' && !hasRateLimit) continue;
    const list = rulesByPhase.get(rule.phase) || [];
    list.push(rule);
    rulesByPhase.set(rule.phase, list);
  }
  const rulesets = Array.from(rulesByPhase.entries()).map(([phase, rules], i) => ({
    id: `maxconfig-ruleset-${i}`,
    name: `MaxConfig ${phase}`,
    description: `MaxConfig rules for ${phase}`,
    kind: 'zone',
    phase,
    rules: rules.map((r, j) => ({
      id: `maxconfig-rule-${i}-${j}`,
      action: r.rule.action,
      action_parameters: r.rule.action_parameters,
      expression: r.rule.expression,
      description: r.rule.description,
      enabled: r.rule.enabled !== false,
      ratelimit: r.rule.ratelimit,
    })),
  }));

  // ── DNS Edge-Case Records ───────────────────────────────────
  // Mirrors the `edgeRecords` array in `createMaximumConfig` (fuzz.ts).
  const edgeBase = `maxconfig-edge.${zoneName}`;
  const dnsRecords = [
    { type: 'A',          name: `maxconfig-a.${zoneName}`,         content: '192.0.2.1',     ttl: 1, proxied: false, comment: '[MaxConfig] DNS edge pack (A)' },
    { type: 'AAAA',       name: `maxconfig-aaaa.${zoneName}`,      content: '2001:db8::1',   ttl: 1, proxied: false, comment: '[MaxConfig] DNS edge pack (AAAA)' },
    { type: 'CNAME',      name: `maxconfig-cname.${zoneName}`,     content: 'example.com',   ttl: 1, proxied: false, comment: '[MaxConfig] DNS edge pack (CNAME)' },
    { type: 'TXT',        name: `maxconfig-txt.${zoneName}`,       content: 'maxconfig=on',  ttl: 1, comment: '[MaxConfig] DNS edge pack (TXT)' },
    { type: 'MX',         name: `maxconfig-mx.${zoneName}`,        content: 'mail.example.com', priority: 10, ttl: 1, comment: '[MaxConfig] DNS edge pack (MX)' },
    { type: 'LOC',        name: `maxconfig-loc.${zoneName}`,       content: '37 46 30.000 N 122 23 30.000 W 10m', ttl: 1, comment: '[MaxConfig] DNS edge pack (LOC)' },
    { type: 'URI',        name: `maxconfig-uri.${zoneName}`,       content: '10 1 "https://example.com/maxconfig"', ttl: 1, comment: '[MaxConfig] DNS edge pack (URI)' },
    { type: 'NAPTR',      name: `maxconfig-naptr.${zoneName}`,     content: '100 10 "U" "E2U+sip" "!^.*$!sip:info@example.com!" .', ttl: 1, comment: '[MaxConfig] DNS edge pack (NAPTR)' },
    { type: 'SRV',        name: `_sip._tcp.${edgeBase}`,           content: '10 5 5060 sip.example.com', ttl: 1, comment: '[MaxConfig] DNS edge pack (SRV)' },
    { type: 'CAA',        name: `maxconfig-caa.${zoneName}`,       content: '0 issue "letsencrypt.org"', ttl: 1, comment: '[MaxConfig] DNS edge pack (CAA)' },
    { type: 'SSHFP',      name: `maxconfig-sshfp.${zoneName}`,     content: '1 1 1234567890abcdef1234567890abcdef12345678', ttl: 1, comment: '[MaxConfig] DNS edge pack (SSHFP)' },
    { type: 'TLSA',       name: `_443._tcp.${edgeBase}`,           content: '3 1 1 0123…', ttl: 1, comment: '[MaxConfig] DNS edge pack (TLSA)' },
    { type: 'SMIMEA',     name: `test._smimecert.${edgeBase}`,     content: '3 1 1 abcd…', ttl: 1, comment: '[MaxConfig] DNS edge pack (SMIMEA)' },
    { type: 'OPENPGPKEY', name: `test._openpgpkey.${edgeBase}`,    content: 'mQENBF9nQasBCADN2g==', ttl: 1, comment: '[MaxConfig] DNS edge pack (OPENPGPKEY)' },
    { type: 'HTTPS',      name: `maxconfig-https.${zoneName}`,     content: '1 . alpn=h3,h2', ttl: 1, comment: '[MaxConfig] DNS edge pack (HTTPS)' },
    { type: 'SVCB',       name: `maxconfig-svcb.${zoneName}`,      content: '1 . alpn=h3,h2', ttl: 1, comment: '[MaxConfig] DNS edge pack (SVCB)' },
  ].map((r, i) => ({ ...r, id: `maxconfig-dns-${i}` }));

  // ── Capability-gated zone resources ─────────────────────────
  const customHostnames = [
    { id: 'maxconfig-saas-0', hostname: `maxconfig-saas.${zoneName}`, ssl: { method: 'http' } },
  ];

  const loadBalancers = hasLB ? [
    { id: 'maxconfig-lb-0', name: `maxconfig-lb.${zoneName}`, description: '[MaxConfig] Load balancer',
      default_pools: ['maxconfig-lb-pool-0'], fallback_pool: 'maxconfig-lb-pool-0', proxied: true } as any,
  ] : [];
  const pools = hasLB ? [
    { id: 'maxconfig-lb-pool-0', name: 'maxconfig-lb-pool', description: '[MaxConfig] LB pool',
      enabled: true, monitor: 'maxconfig-lb-monitor-0',
      origins: [{ name: 'maxconfig-origin', address: '192.0.2.10', enabled: true, weight: 1 }] } as any,
  ] : [];
  const monitors = hasLB ? [
    { id: 'maxconfig-lb-monitor-0', type: 'https', description: '[MaxConfig] LB monitor',
      method: 'GET', path: '/', port: 443, interval: 60, timeout: 5, retries: 2,
      expected_codes: '2xx', follow_redirects: true, allow_insecure: false } as any,
  ] : [];

  const spectrumApps = hasSpectrum ? [
    { id: 'maxconfig-spectrum-0', protocol: 'tcp/443',
      dns: { type: 'CNAME', name: `maxconfig-spectrum.${zoneName}` },
      // RFC 5737 TEST-NET-1 documentation IP — never route real traffic here.
      origin_direct: ['tcp://192.0.2.10:443'], traffic_type: 'direct',
      ip_firewall: true, proxy_protocol: 'off', tls: 'full' } as any,
  ] : [];

  const turnstileWidgets = [
    { sitekey: 'maxconfig-turnstile-0', name: 'maxconfig-turnstile', mode: 'managed',
      domains: [zoneName, `maxconfig.${zoneName}`], region: 'world' } as any,
  ];

  const waitingRooms = [
    { id: 'maxconfig-waiting-0', name: 'maxconfig_global_squeezer',
      host: zoneName, path: '/', new_users_per_minute: 200, total_active_users: 200,
      session_duration: 5, queueing_method: 'fifo' } as any,
  ];

  const healthchecks = [
    { id: 'maxconfig-hc-0', name: 'maxconfig_origin_health_check',
      address: zoneName, type: 'HTTPS' as const, interval: 60, timeout: 5, retries: 2,
      description: '[MaxConfig] Health check for origin monitoring',
      http_config: { method: 'GET', path: '/', port: 443, expected_codes: ['2xx', '3xx'], follow_redirects: true, allow_insecure: false },
      check_regions: ['WNAM', 'ENAM', 'WEU'] },
  ];

  // Worker route + worker only when the account has Workers entitlement.
  const workerRoutes = hasWorkers ? [
    { id: 'maxconfig-route-0', pattern: `${zoneName}/maxconfig-worker/*`, script: 'maxconfig-worker' } as any,
  ] : [];

  // Worker bindings are dropped per-binding when the underlying capability
  // is missing — a worker with only KV (always available) still gets created.
  const workerBindings = [
    { type: 'kv_namespace', name: 'KV', namespace_id: 'maxconfig-kv-0' },
    ...(hasR2 ? [{ type: 'r2_bucket', name: 'R2', bucket_name: 'maxconfig-r2' }] : []),
    ...(hasD1 ? [{ type: 'd1',        name: 'DB', id: 'maxconfig-d1-0' }] : []),
    ...(hasAE ? [{ type: 'analytics_engine', name: 'AE', dataset: 'maxconfig_ae' }] : []),
  ];
  const workers = hasWorkers ? [
    { id: 'maxconfig-worker', etag: '', handlers: ['fetch'], modified_on: new Date().toISOString(),
      isAccountLevel: false, bindings: workerBindings } as any,
  ] : [];

  const kvNamespaces = hasWorkers ? [{ id: 'maxconfig-kv-0', title: 'maxconfig-kv' } as any] : [];
  const r2Buckets    = (hasWorkers && hasR2) ? [{ name: 'maxconfig-r2' } as any] : [];
  const d1Databases  = (hasWorkers && hasD1) ? [{ uuid: 'maxconfig-d1-0', name: 'maxconfig-d1' } as any] : [];
  const queues       = hasQueues ? [] as any[] : [] as any[]; // MaxConfig doesn't currently create queues
  const durableObjectNamespaces: any[] = [];

  const snippets     = [{ snippet_name: 'maxconfig_snippet', code: '// MaxConfig snippet' }];
  const snippetRules = [{ snippet_name: 'maxconfig_snippet', expression: 'starts_with(http.request.uri.path, "/maxconfig_snippet/")',
    description: '[MaxConfig] Snippet activation rule', enabled: true }];

  const accessRules = [{
    mode: 'block',
    notes: '[MaxConfig] Firewall access rule (block test IP)',
    configuration: { target: 'ip', value: '192.0.2.1' },
  }];
  const firewallLockdowns = [{
    description: '[MaxConfig] Lockdown for /maxconfig-lockdown/*',
    urls: [`${zoneName}/maxconfig-lockdown/*`],
    configurations: [{ target: 'ip', value: '192.0.2.1' }],
  }];
  const uaRules = [{
    mode: 'block',
    configuration: { target: 'ua' as const, value: 'MaxConfig-UA-Test' },
    description: '[MaxConfig] Block UA: MaxConfig-UA-Test',
  }];

  const pageShieldSettings = { enabled: true };
  const pageShieldPolicies = [{
    description: '[MaxConfig] Page Shield policy (log all scripts)',
    action: 'log' as const,
    expression: 'true',
    enabled: true,
  }];

  const pageRules = [{
    id: 'maxconfig-page-rule-0',
    targets: [{ target: 'url', constraint: { operator: 'matches', value: `*fuzz-test.${zoneName}/*` } }],
    actions: [{ id: 'browser_cache_ttl', value: 14400 }],
    priority: 1,
    status: 'active',
  }];

  const managedHeaders = {
    managed_request_headers: [
      { id: 'add_true_client_ip_headers', enabled: true },
    ],
    managed_response_headers: [
      { id: 'remove_x-powered-by_header', enabled: true },
    ],
  };

  return {
    zone: {
      id: zoneId,
      name: zoneName,
      account: { id: accountId, name: accountName },
      name_servers: [],
      status: 'active',
      plan: { id: 'unknown', name: 'unknown' },
    },
    dnsRecords,
    settings,
    pageRules,
    rulesets,
    workers,
    workerRoutes,
    workerCustomDomains: [],
    loadBalancers,
    pools,
    monitors,
    spectrumApps,
    customCertificates: [],
    customHostnames,
    accessApps: [],
    accessPolicies: [],
    firewallRules: [],      // legacy firewall rules — MaxConfig uses Custom Rules ruleset instead
    rateLimits: [],         // legacy rate limits — MaxConfig uses http_ratelimit ruleset
    emailRoutingRules: [],  // MaxConfig only toggles Email Routing on; no rules
    waitingRooms,
    zarazConfig: null,
    turnstileWidgets,
    argoSmartRouting: { value: 'on' },
    argoTieredCaching: { value: 'on' },
    botManagement: null,
    kvNamespaces,
    r2Buckets,
    d1Databases,
    queues,
    durableObjectNamespaces,
    snippets,
    snippetRules,
    healthchecks,
    cacheReserve: { value: 'on' },
    managedHeaders,
    urlNormalization: { type: 'cloudflare', scope: 'incoming' },
    regionalTieredCache: { value: 'on' },
    originPostQuantum: { value: 'preferred' },
    acmTotalTls: { enabled: true, certificate_authority: 'lets_encrypt' },
    contentUploadScanSettings: { enabled: true },
    leakedCredentialChecksStatus: { enabled: true },
    waitingRoomSettings: { search_engine_crawler_bypass: true },
    accessRules,
    firewallLockdowns,
    uaRules,
    pageShieldSettings,
    pageShieldPolicies,
  } as unknown as ZoneExport;
}
