// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Zone export — fans out ~72 GETs against the source account/zone in
// three batched phases:
//
//   Phase 1: list endpoints (DNS, settings, rulesets, workers list, etc.)
//   Phase 2: per-item enrichment (worker script + bindings, ruleset rules,
//            snippet content, page-shield/managed-headers/etc.)
//   Phase 3: zone-relatedness scoring + final ZoneExport assembly
//
// Failure model (fetchAndLog):
//   • "Plan-restriction / not-entitled / not-enabled / not-found" responses
//     are expected (the source zone doesn't have the feature). They log as
//     `⏭ <label>: <reason>` and the field gets an empty default. Not
//     surfaced as a warning.
//   • Real errors (transient, permissions misconfig, etc.) log as
//     `⚠ <label>: <full message>` and are pushed to exportWarnings, which
//     the worker exposes back to the UI so Step 2 can show a banner.
//
// This is read-only against the source account. Nothing here mutates dest.

import type { MigrationConfig, ZoneExport, CFR2BucketConfig } from '../types';
import type { LogFn } from '../migrate';
import * as api from '../api';
import { getSourceAuth } from './auth';
import { collectExecutedAccountRulesetIds, partitionAccountRulesetReferences } from './rulesets';
import { accessAppHostnames } from './transforms';
import { curatedSettingsAbsentFromAggregate } from '../fuzz';

export async function exportZone(config: MigrationConfig, log: LogFn = console.log): Promise<ZoneExport> {
  const { sourceZoneId, sourceAccountId } = config;
  const sourceAuth = getSourceAuth(config);

  log('📤 Starting zone export...');

  const zone = await api.getZone(sourceAuth, sourceZoneId);
  log(`✓ Zone: ${zone.name}`);

  // Phase 1: Fetch ALL resource lists in parallel (zone-level + account-level + Zaraz + Storage)
  // [C9] Track which resource fetches fail so we can warn the user
  const exportWarnings: string[] = [];
  log('⏳ Fetching all resources (28 parallel requests)...');

  // Helper: log the API endpoint and result together when the promise resolves.
  //
  // Error handling distinguishes two classes:
  //   1. Plan-restriction / not-entitled / not-enabled / not-found — these
  //      are expected "this zone doesn't have the feature" responses and are
  //      logged as `⏭ <label>: <short reason>` (skip icon, no warning,
  //      no export-warnings banner). Treated as an empty result.
  //   2. Real errors (transient failures, permissions misconfig, etc.) —
  //      logged as `⚠ <label>: <full message>` and pushed to
  //      exportWarnings via the caller's onError.
  function fetchAndLog<T>(
    label: string, endpoint: string,
    fn: () => Promise<T>,
    onSuccess: (r: T) => void,
    onError?: (e: Error) => void,
  ): Promise<T> {
    const p = fn().then(r => { log(`  GET ${endpoint}`); onSuccess(r); return r; });
    return p.catch(e => {
      api.throwIfAuthError(e);
      const err = e as Error;
      log(`  GET ${endpoint}`);
      const lower = (err.message || '').toLowerCase();
      // An EmptyEnvelopeError is what an unprovisioned/unentitled feature
      // returns (success:false, no errors[]/messages[]). Its `.message` is the
      // generic "API request failed", but it carries the real HTTP status. A
      // 4xx is a benign "not entitled/configured" gap — surface the status so
      // the log is specific (Principle 9) instead of a bare "API request
      // failed". A 5xx is a genuine warning, but still annotate the status.
      const emptyEnvelope = (err as { _tag?: string })._tag === 'EmptyEnvelopeError'
        ? (err as unknown as { status: number })
        : null;
      if (emptyEnvelope && emptyEnvelope.status >= 400 && emptyEnvelope.status < 500) {
        log(`  ⏭ ${label}: not entitled/configured (HTTP ${emptyEnvelope.status})`);
      } else if (api.isExportTolerable(lower)) {
        // Compact "not entitled" reason — match the existing `⏭ Cache
        // Reserve: not entitled` style for the success-path skip.
        let reason = 'not entitled';
        if (lower.includes('plan level does not allow') ||
            lower.includes('plan does not allow') ||
            lower.includes('plan does not include') ||
            lower.includes('your plan does not') ||
            lower.includes('upgrade your plan') ||
            lower.includes('not included in your plan') ||
            lower.includes('not enabled on this plan')) {
          reason = 'plan does not include this feature';
        } else if (lower.includes('not found') || lower.includes('does not exist') ||
                   lower.includes('has not been linked to a peer')) {
          reason = 'not configured';
        } else if (lower.includes('could not route to') || lower.includes('object identifier is invalid')) {
          reason = 'not applicable to this zone';
        } else if (lower.includes('forbidden')) {
          reason = 'not entitled (forbidden)';
        } else if (lower.includes('not enabled')) {
          reason = 'not enabled';
        } else if (lower.includes('not available')) {
          reason = 'not available';
        }
        log(`  ⏭ ${label}: ${reason}`);
      } else {
        // Non-tolerable: still annotate the HTTP status when we have it so a
        // generic message isn't the whole story.
        const statusSuffix = emptyEnvelope ? ` (HTTP ${emptyEnvelope.status})` : '';
        log(`  ⚠ ${label}: ${err.message}${statusSuffix}`);
        if (onError) onError(err);
      }
      // Default: never let one resource's read failure kill the entire export.
      // Returning an empty array works for list endpoints (most callers) and
      // is null-coerced where the caller treats T as a singleton resource
      // (those callers explicitly check for null/undefined).
      return [] as unknown as T;
    });
  }

  const z = sourceZoneId;
  const a = sourceAccountId;

  const [
    dnsRecords,
    settings,
    pageRules,
    rulesets,
    workerRoutes,
    loadBalancers,
    spectrumApps,
    customCertificates,
    customHostnames,
    firewallRules,
    rateLimits,
    emailRoutingRules,
    waitingRooms,
    allWorkers,
    workerCustomDomains,
    pools,
    monitors,
    accessApps,
    turnstileWidgets,
    zarazConfig,
    // Separate-endpoint features (not part of /zone/settings)
    argoSmartRouting,
    argoTieredCaching,
    botManagement,
    // Storage resources
    kvNamespaces,
    r2Buckets,
    d1Databases,
    queues,
    durableObjectNamespaces,
    // Developer-platform resources
    pagesProjectsRaw,
    aiGatewaysRaw,
    aiGatewayCustomProvidersRaw,
    // Origin CA certs (zone-scoped via user-API endpoint)
    originCaCertificatesRaw,
  ] = await Promise.all([
    // Zone-level resources
    fetchAndLog('DNS Records', `/zones/${z}/dns_records`,
      () => api.listDNSRecords(sourceAuth, z),
      r => log(`  ✓ DNS Records: ${r.length}`)),
    fetchAndLog('Zone Settings', `/zones/${z}/settings`,
      () => api.listZoneSettings(sourceAuth, z),
      r => log(`  ✓ Zone Settings: ${r.length}`),
      e => { exportWarnings.push(`Zone Settings: ${e.message}`); }),
    fetchAndLog('Page Rules', `/zones/${z}/pagerules`,
      () => api.listPageRules(sourceAuth, z),
      r => log(`  ✓ Page Rules: ${r.length}`)),
    // [C9] Log warnings when resource fetches fail instead of silently dropping
    fetchAndLog('Rulesets', `/zones/${z}/rulesets`,
      () => api.listRulesets(sourceAuth, z),
      r => log(`  ✓ Rulesets: ${r.length}`),
      e => { exportWarnings.push(`Rulesets: ${e.message}`); }),
    fetchAndLog('Worker Routes', `/zones/${z}/workers/routes`,
      () => api.listWorkerRoutes(sourceAuth, z),
      r => log(`  ✓ Worker Routes: ${r.length}`),
      e => { exportWarnings.push(`Worker Routes: ${e.message}`); }),
    fetchAndLog('Load Balancers', `/zones/${z}/load_balancers`,
      () => api.listLoadBalancers(sourceAuth, z),
      r => log(`  ✓ Load Balancers: ${r.length}`),
      e => { exportWarnings.push(`Load Balancers: ${e.message}`); }),
    fetchAndLog('Spectrum Apps', `/zones/${z}/spectrum/apps`,
      () => api.listSpectrumApps(sourceAuth, z),
      r => log(`  ✓ Spectrum Apps: ${r.length}`),
      e => { exportWarnings.push(`Spectrum Apps: ${e.message}`); }),
    fetchAndLog('Custom Certificates', `/zones/${z}/custom_certificates`,
      () => api.listCustomCertificates(sourceAuth, z),
      r => log(`  ✓ Custom Certificates: ${r.length}`),
      e => { exportWarnings.push(`Custom Certificates: ${e.message}`); }),
    fetchAndLog('Custom Hostnames', `/zones/${z}/custom_hostnames`,
      () => api.listCustomHostnames(sourceAuth, z),
      r => log(`  ✓ Custom Hostnames: ${r.length}`),
      e => { exportWarnings.push(`Custom Hostnames: ${e.message}`); }),
    fetchAndLog('Firewall Rules', `/zones/${z}/firewall/rules`,
      () => api.listFirewallRules(sourceAuth, z),
      r => log(`  ✓ Firewall Rules: ${r.length}`),
      e => { exportWarnings.push(`Firewall Rules: ${e.message}`); }),
    fetchAndLog('Rate Limits', `/zones/${z}/rate_limits`,
      () => api.listRateLimits(sourceAuth, z),
      r => log(`  ✓ Rate Limits: ${r.length}`),
      e => { exportWarnings.push(`Rate Limits: ${e.message}`); }),
    fetchAndLog('Email Routing Rules', `/zones/${z}/email/routing/rules`,
      () => api.listEmailRoutingRules(sourceAuth, z),
      r => log(`  ✓ Email Routing Rules: ${r.length}`),
      e => { exportWarnings.push(`Email Routing Rules: ${e.message}`); }),
    fetchAndLog('Waiting Rooms', `/zones/${z}/waiting_rooms`,
      () => api.listWaitingRooms(sourceAuth, z),
      r => log(`  ✓ Waiting Rooms: ${r.length}`),
      e => { exportWarnings.push(`Waiting Rooms: ${e.message}`); }),
    // Account-level resources
    fetchAndLog('Workers', `/accounts/${a}/workers/scripts`,
      () => api.listWorkerScripts(sourceAuth, a),
      r => log(`  ✓ Workers (all): ${r.length}`),
      e => { exportWarnings.push(`Workers: ${e.message}`); }),
    fetchAndLog('Worker Custom Domains', `/accounts/${a}/workers/domains`,
      () => api.listWorkerCustomDomains(sourceAuth, a),
      r => log(`  ✓ Worker Custom Domains: ${r.length}`),
      e => { exportWarnings.push(`Worker Custom Domains: ${e.message}`); }),
    fetchAndLog('Pools', `/accounts/${a}/load_balancers/pools`,
      () => api.listPools(sourceAuth, a),
      r => log(`  ✓ Pools: ${r.length}`),
      e => { exportWarnings.push(`Pools: ${e.message}`); }),
    fetchAndLog('Health Monitors', `/accounts/${a}/load_balancers/monitors`,
      () => api.listMonitors(sourceAuth, a),
      r => log(`  ✓ Health Monitors: ${r.length}`),
      e => { exportWarnings.push(`Health Monitors: ${e.message}`); }),
    fetchAndLog('Access Apps', `/accounts/${a}/access/apps`,
      () => api.listAccessApps(sourceAuth, a),
      r => log(`  ✓ Access Apps: ${r.length}`),
      e => { exportWarnings.push(`Access Apps: ${e.message}`); }),
    fetchAndLog('Turnstile Widgets', `/accounts/${a}/challenges/widgets`,
      () => api.listTurnstileWidgets(sourceAuth, a),
      r => log(`  ✓ Turnstile Widgets: ${r.length}`),
      e => { exportWarnings.push(`Turnstile Widgets: ${e.message}`); }),
    // Zaraz config
    fetchAndLog('Zaraz', `/zones/${z}/zaraz/config`,
      () => api.getZarazConfig(sourceAuth, z),
      r => log(r ? `  ✓ Zaraz config found` : `  ⏭ Zaraz not configured`)),
    // Separate-endpoint features (not part of /zone/settings)
    fetchAndLog('Argo Smart Routing', `/zones/${z}/argo/smart_routing`,
      () => api.getArgoSmartRouting(sourceAuth, z),
      r => log(r?.value === 'on' ? `  ✓ Argo Smart Routing: on` : `  ⏭ Argo Smart Routing: off/unavailable`)),
    fetchAndLog('Tiered Caching', `/zones/${z}/argo/tiered_caching`,
      () => api.getArgoTieredCaching(sourceAuth, z),
      r => log(r?.value === 'on' ? `  ✓ Tiered Caching: on` : `  ⏭ Tiered Caching: off/unavailable`)),
    fetchAndLog('Bot Management', `/zones/${z}/bot_management`,
      () => api.getBotManagement(sourceAuth, z),
      r => log(r ? `  ✓ Bot Management config found` : `  ⏭ Bot Management not configured`)),
    // Storage resources (Account-level)
    fetchAndLog('KV Namespaces', `/accounts/${a}/storage/kv/namespaces`,
      () => api.listKVNamespaces(sourceAuth, a),
      r => log(`  ✓ KV Namespaces: ${r.length}`),
      e => { exportWarnings.push(`KV Namespaces: ${e.message}`); }),
    fetchAndLog('R2 Buckets', `/accounts/${a}/r2/buckets`,
      () => api.listR2Buckets(sourceAuth, a),
      r => log(`  ✓ R2 Buckets: ${r.length}`),
      e => { exportWarnings.push(`R2 Buckets: ${e.message}`); }),
    fetchAndLog('D1 Databases', `/accounts/${a}/d1/database`,
      () => api.listD1Databases(sourceAuth, a),
      r => log(`  ✓ D1 Databases: ${r.length}`),
      e => { exportWarnings.push(`D1 Databases: ${e.message}`); }),
    fetchAndLog('Queues', `/accounts/${a}/queues`,
      () => api.listQueues(sourceAuth, a),
      r => log(`  ✓ Queues: ${r.length}`),
      e => { exportWarnings.push(`Queues: ${e.message}`); }),
    fetchAndLog('Durable Objects', `/accounts/${a}/workers/durable_objects/namespaces`,
      () => api.listDurableObjectNamespaces(sourceAuth, a),
      r => log(`  ✓ Durable Objects: ${r.length}`),
      e => { exportWarnings.push(`Durable Objects: ${e.message}`); }),
    // Developer-platform resources (account-scoped)
    fetchAndLog('Pages Projects', `/accounts/${a}/pages/projects`,
      () => api.listPagesProjects(sourceAuth, a),
      r => log(`  ✓ Pages Projects: ${r.length}`),
      e => { exportWarnings.push(`Pages Projects: ${e.message}`); }),
    fetchAndLog('AI Gateways', `/accounts/${a}/ai-gateway/gateways`,
      () => api.listAiGateways(sourceAuth, a),
      r => log(`  ✓ AI Gateways: ${r.length}`),
      e => { exportWarnings.push(`AI Gateways: ${e.message}`); }),
    fetchAndLog('AI Gateway Custom Providers', `/accounts/${a}/ai-gateway/custom-providers`,
      () => api.listAiGatewayCustomProviders(sourceAuth, a),
      r => log(`  ✓ AI Gateway Custom Providers: ${r.length}`),
      e => { exportWarnings.push(`AI Gateway Custom Providers: ${e.message}`); }),
    // Origin CA certificates (zone-scoped via user-API endpoint).
    // Requires Origin-CA-Key auth which is different from the regular
    // API token. If the user's auth doesn't include the Origin CA key
    // permission, this returns 401 — caught and skipped via the
    // export-tolerable error path.
    fetchAndLog('Origin CA Certificates', `/certificates?zone_id=${z}`,
      () => api.listOriginCaCertificates(sourceAuth, z),
      r => log(`  ✓ Origin CA Certificates: ${r.length}`),
      e => { exportWarnings.push(`Origin CA Certificates: ${e.message}`); }),
  ]);

  // Phase 1a: Backfill dedicated-endpoint zone settings the aggregate GET omits.
  // Several newer settings live ONLY behind `/zones/{id}/settings/<id>` and are
  // NOT returned by the aggregate `GET /zones/{id}/settings` (speed_brain, fonts,
  // origin_max_http_version, ssl_automatic_mode, origin_h2_max_streams). Without
  // this they were never exported, so `/api/migrate` silently dropped them. We
  // derive the set from `curatedSettingsAbsentFromAggregate` (the same curated
  // ZONE_SETTINGS list MaxConfig uses), so it stays in sync. `rum` IS in that
  // curated list now (its on/off PATCH shape was verified live 2026-06-02), so it
  // is exported + migrated here. `aegis` (account-tied) is deliberately NOT in the
  // curated list, so it is correctly excluded here, avoiding the false-failure
  // noise that exporting an un-PATCHable value would cause. Each
  // GET is best-effort: a not-entitled / not-found setting is skipped silently.
  // The merged entries flow through the normal migrate + verify path (the
  // settings loop PATCHes each via the same dedicated `/settings/<id>` URL).
  {
    const aggregateIds = new Set(settings.map(s => s.id));
    const dedicatedDefs = curatedSettingsAbsentFromAggregate(aggregateIds);
    if (dedicatedDefs.length > 0) {
      log(`⏳ Fetching ${dedicatedDefs.length} dedicated-endpoint zone settings the aggregate GET omits...`);
      const dedicatedSettings = await Promise.all(
        dedicatedDefs.map(def =>
          fetchAndLog(`Zone Setting: ${def.id}`, `/zones/${z}/settings/${def.id}`,
            () => api.getZoneSetting(sourceAuth, z, def.id),
            r => { if (r) log(`  ✓ ${def.id}: ${JSON.stringify(r.value)}`); else log(`  ⏭ ${def.id}: not available`); },
            e => { exportWarnings.push(`Zone Setting ${def.id}: ${e.message}`); }),
        ),
      );
      for (const s of dedicatedSettings) {
        // fetchAndLog null-coerces failures to an empty array; a real setting is
        // a single object with an `id`. Only merge genuine, not-already-present
        // settings so we never double-list or push an empty placeholder.
        if (s && !Array.isArray(s) && s.id && !aggregateIds.has(s.id)) {
          settings.push(s);
        }
      }
    }
  }

  // Phase 1b: Fetch additional zone-scoped resources that were previously not migrated.
  // These all have small/simple payloads, so they go in their own batch to keep the
  // primary batch readable. Each silently returns null/empty on 4xx (not entitled / not configured).
  log('⏳ Fetching extended zone resources (managed headers, cloud connector, snippets, healthchecks, etc.)...');
  const [
    managedHeaders,
    cloudConnectorRulesRaw,
    urlNormalization,
    precursor,
    cacheReserve,
    snippetsList,
    snippetRulesRaw,
    healthchecksList,
  ] = await Promise.all([
    fetchAndLog('Managed Headers', `/zones/${z}/managed_headers`,
      () => api.getManagedHeaders(sourceAuth, z),
      r => log(r ? `  ✓ Managed Headers: req=${r.managed_request_headers?.length || 0}, resp=${r.managed_response_headers?.length || 0}` : `  ⏭ Managed Headers: not configured`)),
    fetchAndLog('Cloud Connector Rules', `/zones/${z}/cloud_connector/rules`,
      () => api.getCloudConnectorRules(sourceAuth, z),
      r => log(`  ✓ Cloud Connector Rules: ${r.length}`)),
    fetchAndLog('URL Normalization', `/zones/${z}/url_normalization`,
      () => api.getUrlNormalization(sourceAuth, z),
      r => log(r ? `  ✓ URL Normalization: ${r.type}/${r.scope}` : `  ⏭ URL Normalization: not configured`)),
    fetchAndLog('Precursor', `/zones/${z}/precursor`,
      () => api.getPrecursor(sourceAuth, z),
      r => log(r ? `  ✓ Precursor: mode=${r.default_mode || 'off'}, rules=${r.enforcement_rules?.length || 0}` : `  ⏭ Precursor: not configured`)),
    fetchAndLog('Cache Reserve', `/zones/${z}/cache/cache_reserve`,
      () => api.getCacheReserve(sourceAuth, z),
      r => log(r ? `  ✓ Cache Reserve: ${r.value}` : `  ⏭ Cache Reserve: not entitled/available`)),
    fetchAndLog('Snippets', `/zones/${z}/snippets`,
      () => api.listSnippets(sourceAuth, z),
      r => log(`  ✓ Snippets: ${r.length}`)),
    fetchAndLog('Snippet Rules', `/zones/${z}/snippets/snippet_rules`,
      () => api.listSnippetRules(sourceAuth, z),
      r => log(`  ✓ Snippet Rules: ${r.rules?.length || 0}`)),
    fetchAndLog('Healthchecks', `/zones/${z}/healthchecks`,
      () => api.listHealthchecks(sourceAuth, z),
      r => log(`  ✓ Healthchecks: ${r.length}`)),
  ]);

  // Fetch snippet source code in parallel (each snippet's content is a separate endpoint)
  const snippets: { snippet_name: string; code: string }[] = [];
  if (snippetsList && snippetsList.length > 0) {
    const contents = await Promise.all(snippetsList.map(async (s) => {
      try {
        const code = await api.getSnippetContent(sourceAuth, z, s.snippet_name);
        return { snippet_name: s.snippet_name, code: code || '' };
      } catch (e) {
        api.throwIfAuthError(e);
        log(`  ⚠ Snippet ${s.snippet_name}: content fetch failed (${(e as Error).message})`);
        return { snippet_name: s.snippet_name, code: '' };
      }
    }));
    snippets.push(...contents.filter(c => c.code));
  }

  // Phase 1c: Fetch the FINAL set of zone-scoped resources for 100% coverage.
  // These are smaller, single-shot endpoints. Each silently returns null/empty
  // on 4xx (not entitled / not configured).
  log('⏳ Fetching final-coverage zone resources (DNS settings, page shield, schemas, logpush, ...)...');
  const [
    dnsSettings,
    dnssecStatus,
    regionalHostnames,
    regionalTieredCache,
    cacheVariants,
    originPostQuantum,
    clientCertificates,
    fraudDetectionSettings,
    accessRules,
    firewallLockdowns,
    uaRules,
    pageShieldSettings,
    pageShieldPolicies,
    logpushJobs,
    schemaValidationSchemas,
    schemaValidationSettings,
    tokenValidationConfigs,
    tokenValidationRules,
    certificatePacks,
    acmTotalTls,
    apiGatewayOperations,
    apiGatewaySchemas,
    apiGatewayConfiguration,
    apiGatewayUserLabels,
    hostnameAssociations,
    originTlsSettings,
    originTlsHostnames,
  ] = await Promise.all([
    fetchAndLog('DNS Settings', `/zones/${z}/dns_settings`, () => api.getDnsSettings(sourceAuth, z),
      r => log(r ? `  ✓ DNS Settings: ${Object.keys(r).length} fields` : `  ⏭ DNS Settings: not configured`)),
    fetchAndLog('DNSSEC Status', `/zones/${z}/dnssec`, () => api.getDnssec(sourceAuth, z),
      r => log(r ? `  ✓ DNSSEC: ${r.status}` : `  ⏭ DNSSEC: not configured`)),
    fetchAndLog('Regional Hostnames', `/zones/${z}/addressing/regional_hostnames`, () => api.listRegionalHostnames(sourceAuth, z),
      r => log(`  ✓ Regional Hostnames: ${r.length}`)),
    fetchAndLog('Regional Tiered Cache', `/zones/${z}/cache/regional_tiered_cache`, () => api.getRegionalTieredCache(sourceAuth, z),
      r => log(r ? `  ✓ Regional Tiered Cache: ${r.value}` : `  ⏭ Regional Tiered Cache: not entitled`)),
    fetchAndLog('Cache Variants', `/zones/${z}/cache/variants`, () => api.getCacheVariants(sourceAuth, z),
      r => log(r ? `  ✓ Cache Variants configured` : `  ⏭ Cache Variants: not configured`)),
    fetchAndLog('Origin Post-Quantum', `/zones/${z}/cache/origin_post_quantum_encryption`, () => api.getOriginPostQuantum(sourceAuth, z),
      r => log(r ? `  ✓ Origin PostQuantum: ${r.value}` : `  ⏭ Origin PostQuantum: not configured`)),
    fetchAndLog('Client Certificates', `/zones/${z}/client_certificates`, () => api.listClientCertificates(sourceAuth, z),
      r => log(`  ✓ Client Certificates: ${r.length}`)),
    // NB: the zone's Custom Nameservers state (enabled + ns_set) comes from the
    // singleton `customNameserversMetadata` fetch below. The endpoint
    // `GET /zones/{id}/custom_ns` returns metadata, NOT an array (per its
    // OpenAPI operationId "...get-account-custom-nameserver-related-zone-metadata"),
    // so there is no separate array-shaped `customNs` fetch — a previous
    // duplicate one mislabelled the same payload as an array and logged
    // "Custom NS: undefined".
    fetchAndLog('Fraud Detection Settings', `/zones/${z}/fraud_detection/settings`, () => api.getFraudDetectionSettings(sourceAuth, z),
      r => log(r ? `  ✓ Fraud Detection: configured` : `  ⏭ Fraud Detection: not configured`)),
    fetchAndLog('Firewall Access Rules', `/zones/${z}/firewall/access_rules/rules`, () => api.listAccessRules(sourceAuth, z),
      r => log(`  ✓ Access Rules: ${r.length}`)),
    fetchAndLog('Firewall Lockdowns', `/zones/${z}/firewall/lockdowns`, () => api.listFirewallLockdowns(sourceAuth, z),
      r => log(`  ✓ Lockdowns: ${r.length}`)),
    fetchAndLog('UA Rules', `/zones/${z}/firewall/ua_rules`, () => api.listUaRules(sourceAuth, z),
      r => log(`  ✓ UA Rules: ${r.length}`)),
    fetchAndLog('Page Shield Settings', `/zones/${z}/page_shield`, () => api.getPageShieldSettings(sourceAuth, z),
      r => log(r ? `  ✓ Page Shield: ${r.enabled ? 'on' : 'off'}` : `  ⏭ Page Shield: not entitled`)),
    fetchAndLog('Page Shield Policies', `/zones/${z}/page_shield/policies`, () => api.listPageShieldPolicies(sourceAuth, z),
      r => log(`  ✓ Page Shield Policies: ${r.length}`)),
    fetchAndLog('Logpush Jobs', `/zones/${z}/logpush/jobs`, () => api.listLogpushJobs(sourceAuth, z),
      r => log(`  ✓ Logpush Jobs: ${r.length}`)),
    fetchAndLog('Schema Validation Schemas', `/zones/${z}/schema_validation/schemas`, () => api.listSchemaValidationSchemas(sourceAuth, z),
      r => log(`  ✓ Schema Validation Schemas: ${r.length}`)),
    fetchAndLog('Schema Validation Settings', `/zones/${z}/schema_validation/settings`, () => api.getSchemaValidationSettings(sourceAuth, z),
      r => log(r ? `  ✓ Schema Validation Settings` : `  ⏭ Schema Validation Settings: not configured`)),
    fetchAndLog('Token Validation Configs', `/zones/${z}/token_validation/config`, () => api.listTokenValidationConfigs(sourceAuth, z),
      r => log(`  ✓ Token Validation Configs: ${r.length}`)),
    fetchAndLog('Token Validation Rules', `/zones/${z}/token_validation/rules`, () => api.listTokenValidationRules(sourceAuth, z),
      r => log(`  ✓ Token Validation Rules: ${r.length}`)),
    fetchAndLog('Certificate Packs', `/zones/${z}/ssl/certificate_packs`, () => api.listCertificatePacks(sourceAuth, z),
      r => log(`  ✓ Certificate Packs: ${r.length}`)),
    fetchAndLog('ACM Total TLS', `/zones/${z}/acm/total_tls`, () => api.getAcmTotalTls(sourceAuth, z),
      r => log(r ? `  ✓ ACM Total TLS: ${r.enabled ? 'on' : 'off'}` : `  ⏭ ACM Total TLS: not entitled`)),
    fetchAndLog('API Gateway Operations', `/zones/${z}/api_gateway/operations`, () => api.listApiGatewayOperations(sourceAuth, z),
      r => log(`  ✓ API Gateway Operations: ${r.length}`)),
    fetchAndLog('API Gateway Schemas', `/zones/${z}/api_gateway/user_schemas`, () => api.listApiGatewaySchemas(sourceAuth, z),
      r => log(`  ✓ API Gateway Schemas: ${r.length}`)),
    fetchAndLog('API Shield Configuration', `/zones/${z}/api_gateway/configuration`, () => api.getApiGatewayConfiguration(sourceAuth, z),
      r => log(r ? `  ✓ API Shield Configuration: ${(r.auth_id_characteristics || []).length} session identifier(s)` : `  ⏭ API Shield Configuration: not configured`)),
    fetchAndLog('API Shield User Labels', `/zones/${z}/api_gateway/labels`, () => api.listApiGatewayUserLabels(sourceAuth, z),
      r => log(`  ✓ API Shield User Labels: ${r.length}`)),
    fetchAndLog('Hostname Associations (mTLS)', `/zones/${z}/certificate_authorities/hostname_associations`, () => api.getHostnameAssociations(sourceAuth, z),
      r => log(r ? `  ✓ Hostname Associations: ${(r.hostnames || []).length}` : `  ⏭ Hostname Associations: none`)),
    fetchAndLog('Origin TLS Settings', `/zones/${z}/origin_tls_client_auth/settings`, () => api.getOriginTlsSettings(sourceAuth, z),
      r => log(r ? `  ✓ Origin TLS Settings: ${r.enabled ? 'on' : 'off'}` : `  ⏭ Origin TLS: not configured`)),
    fetchAndLog('Origin TLS Hostnames', `/zones/${z}/origin_tls_client_auth/hostnames/certificates`, () => api.listOriginTlsHostnames(sourceAuth, z),
      r => log(`  ✓ Origin TLS Hostnames: ${r.length}`)),
  ]);

  // Phase 1c-bis: Newer zone-level features added under AGENTS.md
  // Principle 7 ("would the user notice this missing on dest?"). Each
  // is a small singleton or short list; grouped here rather than
  // scattered to keep the diff for the audit pass legible.
  log('⏳ Fetching newer zone/account features (Principle 7 audit)...');
  const [
    customHostnameFallbackOrigin,
    aiSecuritySettings,
    aiSecurityCustomTopics,
    workersObservabilityDestinations,
    workersObservabilityQueries,
    vectorizeIndexes,
    waitingRoomSettings,
    contentUploadScanSettings,
    cacheOriginCloudRegions,
    leakedCredentialChecksStatus,
    leakedCredentialCustomDetections,
    emailSendingSubdomains,
    web3HostnamesRaw,
    secondaryDnsAcls,
    secondaryDnsPeers,
    secondaryDnsTsigs,
    secondaryDnsIncoming,
    secondaryDnsOutgoing,
    loadBalancerMonitorGroups,
    hyperdriveConfigs,
    secretsStoreStores,
    customNameserversMetadata,
    payPerCrawlConfiguration,
    aiGatewayCustomProviderCosts,
    googleTagGateway,
    smartShield,
    smartShieldHealthchecks,
    ctAlerting,
    autoOriginTlsKex,
    emailRoutingSettings,
  ] = await Promise.all([
    fetchAndLog('Custom Hostname Fallback Origin', `/zones/${z}/custom_hostnames/fallback_origin`, () => api.getCustomHostnameFallbackOrigin(sourceAuth, z),
      r => log(r ? `  ✓ Fallback Origin: ${r.origin}` : `  ⏭ Fallback Origin: not configured`)),
    fetchAndLog('AI Security Settings', `/zones/${z}/ai-security/settings`, () => api.getAiSecuritySettings(sourceAuth, z),
      r => log(r ? `  ✓ AI Security Settings: configured` : `  ⏭ AI Security: not entitled`)),
    fetchAndLog('AI Security Custom Topics', `/zones/${z}/ai-security/custom-topics`, () => api.getAiSecurityCustomTopics(sourceAuth, z),
      r => log(r ? `  ✓ AI Security Custom Topics: configured` : `  ⏭ AI Security Custom Topics: not configured`)),
    fetchAndLog('Workers Observability Destinations', `/accounts/${a}/workers/observability/destinations`, () => api.listWorkersObservabilityDestinations(sourceAuth, a),
      r => log(`  ✓ Workers Observability Destinations: ${r.length}`)),
    fetchAndLog('Workers Observability Queries', `/accounts/${a}/workers/observability/queries`, () => api.listWorkersObservabilityQueries(sourceAuth, a),
      r => log(`  ✓ Workers Observability Queries: ${r.length}`)),
    fetchAndLog('Vectorize Indexes', `/accounts/${a}/vectorize/v2/indexes`, () => api.listVectorizeIndexes(sourceAuth, a),
      r => log(`  ✓ Vectorize Indexes: ${r.length}`)),
    fetchAndLog('Waiting Room Settings', `/zones/${z}/waiting_rooms/settings`, () => api.getWaitingRoomSettings(sourceAuth, z),
      r => log(r ? `  ✓ Waiting Room Settings: configured` : `  ⏭ Waiting Room Settings: not configured`)),
    fetchAndLog('Content Upload Scan Settings', `/zones/${z}/content-upload-scan/settings`, () => api.getContentUploadScanSettings(sourceAuth, z),
      r => log(r ? `  ✓ Content Upload Scan Settings: configured` : `  ⏭ Content Upload Scan: not entitled`)),
    fetchAndLog('Cache Origin Cloud Regions', `/zones/${z}/cache/origin_cloud_regions`, () => api.listCacheOriginCloudRegions(sourceAuth, z),
      r => log(`  ✓ Cache Origin Cloud Regions: ${r.length}`)),
    fetchAndLog('Leaked Credential Checks Status', `/zones/${z}/leaked-credential-checks`, () => api.getLeakedCredentialChecksStatus(sourceAuth, z),
      r => log(r ? `  ✓ Leaked Credential Checks: ${r.enabled ? 'enabled' : 'disabled'}` : `  ⏭ Leaked Credential Checks: not entitled`)),
    fetchAndLog('Leaked Credential Custom Detections', `/zones/${z}/leaked-credential-checks/detections`, () => api.listLeakedCredentialCustomDetections(sourceAuth, z),
      r => log(`  ✓ Leaked Credential Custom Detections: ${r.length}`)),
    fetchAndLog('Email Sending Subdomains', `/zones/${z}/email/sending/subdomains`, () => api.listEmailSendingSubdomains(sourceAuth, z),
      r => log(`  ✓ Email Sending Subdomains: ${r.length}`)),
    fetchAndLog('Web3 Hostnames', `/zones/${z}/web3/hostnames`, () => api.listWeb3Hostnames(sourceAuth, z),
      r => log(`  ✓ Web3 Hostnames: ${r.length}`)),
    fetchAndLog('Secondary DNS ACLs', `/accounts/${a}/secondary_dns/acls`, () => api.listSecondaryDnsAcls(sourceAuth, a),
      r => log(`  ✓ Secondary DNS ACLs: ${r.length}`)),
    fetchAndLog('Secondary DNS Peers', `/accounts/${a}/secondary_dns/peers`, () => api.listSecondaryDnsPeers(sourceAuth, a),
      r => log(`  ✓ Secondary DNS Peers: ${r.length}`)),
    fetchAndLog('Secondary DNS TSIGs', `/accounts/${a}/secondary_dns/tsigs`, () => api.listSecondaryDnsTsigs(sourceAuth, a),
      r => log(`  ✓ Secondary DNS TSIGs: ${r.length}`)),
    fetchAndLog('Secondary DNS Incoming', `/zones/${z}/secondary_dns/incoming`, () => api.getSecondaryDnsIncoming(sourceAuth, z),
      r => log(r ? `  ✓ Secondary DNS Incoming: configured (${r.peers?.length || 0} peers)` : `  ⏭ Secondary DNS Incoming: not configured`)),
    fetchAndLog('Secondary DNS Outgoing', `/zones/${z}/secondary_dns/outgoing`, () => api.getSecondaryDnsOutgoing(sourceAuth, z),
      r => log(r ? `  ✓ Secondary DNS Outgoing: configured (${r.peers?.length || 0} peers)` : `  ⏭ Secondary DNS Outgoing: not configured`)),
    fetchAndLog('LB Monitor Groups', `/accounts/${a}/load_balancers/monitor_groups`, () => api.listLoadBalancerMonitorGroups(sourceAuth, a),
      r => log(`  ✓ LB Monitor Groups: ${r.length}`)),
    fetchAndLog('Hyperdrive Configs', `/accounts/${a}/hyperdrive/configs`, () => api.listHyperdriveConfigs(sourceAuth, a),
      r => log(`  ✓ Hyperdrive Configs: ${r.length}`)),
    fetchAndLog('Secrets Store Stores', `/accounts/${a}/secrets_store/stores`, () => api.listSecretsStoreStores(sourceAuth, a),
      r => log(`  ✓ Secrets Store Stores: ${r.length}`)),
    fetchAndLog('Custom Nameservers Metadata', `/zones/${z}/custom_ns`, () => api.getCustomNameserversMetadata(sourceAuth, z),
      r => log(r ? `  ✓ Custom Nameservers: ${r.enabled ? `enabled (set ${r.ns_set || 1})` : 'disabled'}` : `  ⏭ Custom Nameservers: not configured`)),
    fetchAndLog('Pay-per-Crawl Configuration', `/zones/${z}/pay-per-crawl/configuration`, () => api.getPayPerCrawlConfiguration(sourceAuth, z),
      r => log(r ? `  ✓ Pay-per-Crawl: ${r.enabled ? 'enabled' : 'disabled'}` : `  ⏭ Pay-per-Crawl: not configured`)),
    fetchAndLog('AI Gateway Custom Provider Costs', `/accounts/${a}/ai-gateway/custom-providers/costs`, () => api.listAiGatewayCustomProviderCosts(sourceAuth, a),
      r => log(`  ✓ AI Gateway Custom Provider Costs: ${r.length}`)),
    fetchAndLog('Google Tag Gateway', `/zones/${z}/settings/google-tag-gateway/config`, () => api.getGoogleTagGatewayConfig(sourceAuth, z),
      r => log(r ? `  ✓ Google Tag Gateway: configured` : `  ⏭ Google Tag Gateway: not configured`)),
    fetchAndLog('Smart Shield Settings', `/zones/${z}/smart_shield`, () => api.getSmartShield(sourceAuth, z),
      r => log(r ? `  ✓ Smart Shield: configured` : `  ⏭ Smart Shield: not entitled`)),
    fetchAndLog('Smart Shield Healthchecks', `/zones/${z}/smart_shield/healthchecks`, () => api.listSmartShieldHealthchecks(sourceAuth, z),
      r => log(`  ✓ Smart Shield Healthchecks: ${r.length}`)),
    fetchAndLog('CT Alerting Subscription', `/zones/${z}/ct/alerting`, () => api.getCtAlerting(sourceAuth, z),
      r => log(r ? `  ✓ CT Alerting: ${r.enabled ? 'enabled' : 'disabled'}${r.emails?.length ? ` (${r.emails.length} recipient${r.emails.length === 1 ? '' : 's'})` : ''}` : `  ⏭ CT Alerting: not configured`)),
    fetchAndLog('Auto Origin TLS Key Exchange', `/zones/${z}/settings/auto_origin_tls_kex`, () => api.getAutoOriginTlsKex(sourceAuth, z),
      r => log(r ? `  ✓ Auto Origin TLS Key Exchange: ${r.enabled ? 'enabled' : 'disabled'}` : `  ⏭ Auto Origin TLS Key Exchange: not configured`)),
    fetchAndLog('Email Routing Settings', `/zones/${z}/email/routing`, () => api.getEmailRoutingSettings(sourceAuth, z),
      r => log(r ? `  ✓ Email Routing Settings: ${r.enabled ? 'enabled' : 'disabled'}${r.support_subaddress ? ' (sub-addressing on)' : ''}` : `  ⏭ Email Routing Settings: not configured`)),
  ]);

  // Fetch per-hostname IPFS content lists (sub-resource — only relevant
  // for hostnames with target=ipfs_universal_path). Each list is the
  // {action, entries[]} block-list that travels with its parent.
  const web3Hostnames: { id?: string; name: string; target: 'ethereum' | 'ipfs' | 'ipfs_universal_path'; description?: string; dnslink?: string; contentList?: { action: 'block'; entries: { content: string; type: 'cid' | 'content_path'; description?: string }[] } | null }[] = [];
  if (Array.isArray(web3HostnamesRaw) && web3HostnamesRaw.length > 0) {
    const enriched = await Promise.all(web3HostnamesRaw.map(async (h) => {
      const base = { id: h.id, name: h.name, target: h.target, description: h.description, dnslink: h.dnslink };
      if (h.target !== 'ipfs_universal_path' || !h.id) return { ...base, contentList: null };
      try {
        const entries = await api.listWeb3ContentListEntries(sourceAuth, z, h.id);
        if (!entries.length) return { ...base, contentList: null };
        return { ...base, contentList: { action: 'block' as const, entries: entries.map(e => ({ content: e.content, type: e.type, description: e.description })) } };
      } catch (e) {
        api.throwIfAuthError(e);
        return { ...base, contentList: null };
      }
    }));
    web3Hostnames.push(...enriched);
  }

  // Fetch per-operation schema-validation overrides (sub-resource of
  // api_gateway/operations). Keyed by the operation triple so the
  // migrate step can remap to the dest operation ID. Only operations
  // with a non-default mitigation_action are kept.
  const apiGatewayOperationSchemaValidation: { method: string; host: string; endpoint: string; mitigation_action?: string | null }[] = [];
  if (Array.isArray(apiGatewayOperations) && apiGatewayOperations.length > 0) {
    const perOp = await Promise.all(apiGatewayOperations.map(async (op) => {
      if (!op.operation_id) return null;
      try {
        const sv = await api.getApiGatewayOperationSchemaValidation(sourceAuth, z, op.operation_id);
        if (!sv || sv.mitigation_action === undefined || sv.mitigation_action === null) return null;
        return { method: op.method, host: op.host, endpoint: op.endpoint, mitigation_action: sv.mitigation_action };
      } catch (e) {
        api.throwIfAuthError(e);
        return null;
      }
    }));
    apiGatewayOperationSchemaValidation.push(...perOp.filter((x): x is NonNullable<typeof x> => x !== null));
  }

  // Fetch waiting-room events per room (sub-resource)
  const waitingRoomEvents: { roomName: string; events: { id?: string; name: string; event_start_time: string; event_end_time: string }[] }[] = [];
  if (Array.isArray(waitingRooms) && waitingRooms.length > 0) {
    const perRoom = await Promise.all(waitingRooms.map(async (room) => {
      try {
        const events = await api.listWaitingRoomEvents(sourceAuth, z, room.id!);
        return { roomName: room.name, events: events.map(e => ({
          id: e.id, name: e.name, event_start_time: e.event_start_time, event_end_time: e.event_end_time,
        })) };
      } catch (e) {
        api.throwIfAuthError(e);
        return { roomName: room.name, events: [] };
      }
    }));
    waitingRoomEvents.push(...perRoom.filter(r => r.events.length > 0));
  }

  // Fetch waiting-room override rules per room (sub-resource — separate
  // from events, captures per-room {action, expression, description?,
  // enabled?} rule overrides).
  const waitingRoomRules: { roomName: string; rules: { id?: string; action: string; expression: string; description?: string; enabled?: boolean }[] }[] = [];
  if (Array.isArray(waitingRooms) && waitingRooms.length > 0) {
    const perRoom = await Promise.all(waitingRooms.map(async (room) => {
      try {
        const rules = await api.listWaitingRoomRules(sourceAuth, z, room.id!);
        return { roomName: room.name, rules };
      } catch (e) {
        api.throwIfAuthError(e);
        return { roomName: room.name, rules: [] };
      }
    }));
    waitingRoomRules.push(...perRoom.filter(r => r.rules.length > 0));
  }

  // Fetch AI Gateway per-gateway provider configs (sub-resource of
  // ai-gateway/gateways). Each gateway can have provider-specific
  // overrides (e.g. fallback model, custom headers).
  const aiGatewayProviderConfigs: { gatewayId: string; configs: { id?: string; alias?: string; default_config?: boolean; provider_slug?: string; secret_id?: string; secret_preview?: string; rate_limit?: number; rate_limit_period?: number }[] }[] = [];
  // aiGateways is already fetched elsewhere; look it up from the outer
  // scope (it's added later in this function, so we re-fetch here).
  // For simplicity and to keep the diff contained, just re-fetch.
  try {
    const gws = await api.listAiGateways(sourceAuth, a);
    if (Array.isArray(gws) && gws.length > 0) {
      const perGw = await Promise.all(gws.map(async (gw) => {
        if (!gw.id) return { gatewayId: '', configs: [] };
        try {
          const cfgs = await api.listAiGatewayProviderConfigs(sourceAuth, a, gw.id);
          return { gatewayId: gw.id, configs: cfgs };
        } catch (e) {
          api.throwIfAuthError(e);
          return { gatewayId: gw.id, configs: [] };
        }
      }));
      aiGatewayProviderConfigs.push(...perGw.filter(g => g.configs.length > 0));
    }
  } catch (e) {
    api.throwIfAuthError(e);
    // AI Gateway not entitled — skip silently.
  }

  // Phase 1d: Account-scoped sub-resources (Access groups/tokens/IdPs, custom lists, queue consumers, D4 Access extensions)
  log('⏳ Fetching account-scoped sub-resources (Access groups, IdPs, lists, tags, bookmarks, custom pages, queue consumers)...');
  const [
    accessGroups,
    accessServiceTokensRaw,
    identityProvidersRaw,
    customLists,
    accessTags,
    accessBookmarks,
    accessCustomPagesList,
  ] = await Promise.all([
    fetchAndLog('Access Groups', `/accounts/${a}/access/groups`, () => api.listAccessGroups(sourceAuth, a),
      r => log(`  ✓ Access Groups: ${r.length}`)),
    fetchAndLog('Access Service Tokens', `/accounts/${a}/access/service_tokens`, () => api.listAccessServiceTokens(sourceAuth, a),
      r => log(`  ✓ Service Tokens: ${r.length}`)),
    fetchAndLog('Identity Providers', `/accounts/${a}/access/identity_providers`, () => api.listIdentityProviders(sourceAuth, a),
      r => log(`  ✓ Identity Providers: ${r.length}`)),
    fetchAndLog('Custom Lists', `/accounts/${a}/rules/lists`, () => api.listCustomLists(sourceAuth, a),
      r => log(`  ✓ Custom Lists: ${r.length}`)),
    // D4: Access tags
    fetchAndLog('Access Tags', `/accounts/${a}/access/tags`, () => api.listAccessTags(sourceAuth, a),
      r => log(`  ✓ Access Tags: ${r.length}`)),
    // D4: Access bookmarks
    fetchAndLog('Access Bookmarks', `/accounts/${a}/access/bookmarks`, () => api.listAccessBookmarks(sourceAuth, a),
      r => log(`  ✓ Access Bookmarks: ${r.length}`)),
    // D4: Access custom pages (list returns metadata; HTML fetched per-page below)
    fetchAndLog('Access Custom Pages', `/accounts/${a}/access/custom_pages`, () => api.listAccessCustomPages(sourceAuth, a),
      r => log(`  ✓ Access Custom Pages: ${r.length}`)),
  ]);

  // D4: fetch full HTML for each custom page (list only returns metadata).
  // Pages whose detail fetch fails are dropped from the export.
  const accessCustomPages: Array<{ uid?: string; name: string; type: 'identity_denied' | 'forbidden'; custom_html: string }> = [];
  if (Array.isArray(accessCustomPagesList) && accessCustomPagesList.length > 0) {
    const detailResults = await Promise.all(accessCustomPagesList.map(async (p) => {
      if (!p.uid) return null;
      try {
        const detail = await api.getAccessCustomPage(sourceAuth, a, p.uid);
        return {
          uid: detail.uid,
          name: detail.name,
          type: detail.type,
          custom_html: detail.custom_html || '',
        };
      } catch (e) {
        api.throwIfAuthError(e);
        log(`  ⚠ Access Custom Page ${p.name}: detail fetch failed (${(e as Error).message})`);
        return null;
      }
    }));
    accessCustomPages.push(...detailResults.filter((d): d is NonNullable<typeof d> => d !== null));
  }

  // Strip client_secret from service tokens.
  const accessServiceTokens = accessServiceTokensRaw.map(t => ({ id: t.id, name: t.name, duration: t.duration }));
  // IdP config: capture everything EXCEPT `client_secret` (and any
  // other write-only PRIVATE secret fields). The config is required
  // at apply time so the dest IdP can be recreated with auth_url /
  // token_url / certs_url / client_id / scopes / etc. preserved.
  // The user supplies the missing `client_secret` via the Step 2
  // inline fix-it form;
  // the migrator merges that with the captured config and POSTs to
  // dest.
  //
  // SAML scope:
  // `idp_public_certs` is the customer's SAML IdP signing certificate
  // — PUBLIC material the customer hands out to every relying party.
  // Cloudflare's API docs explicitly type it as a returnable field on
  // GET (https://developers.cloudflare.com/api/resources/zero_trust/subresources/identity_providers/methods/get/).
  // Stripping it as "secret-like" was overly defensive and the reason
  // SAML IdPs could not be auto-migrated. We keep the cert in the
  // export so SAML IdPs migrate the same as any other config-driven
  // IdP.
  //
  // SECURITY NOTE: This widens the export's data surface compared to
  // the prior "strip the whole config" policy. We deliberately filter
  // out fields whose names suggest PRIVATE secret material. If
  // Cloudflare adds new private-secret fields to IdP config in the
  // future, they MUST be added to this denylist.
  const SECRET_LIKE_CONFIG_FIELDS = new Set([
    'client_secret',
    'private_key',  // some SAML/OIDC providers (truly private)
  ]);
  const identityProviders = identityProvidersRaw.map(p => {
    const rawConfig = (p as { config?: Record<string, unknown> }).config;
    let safeConfig: Record<string, unknown> | undefined;
    if (rawConfig && typeof rawConfig === 'object') {
      safeConfig = {};
      for (const [k, v] of Object.entries(rawConfig)) {
        if (SECRET_LIKE_CONFIG_FIELDS.has(k)) continue;
        safeConfig[k] = v;
      }
    }
    return { id: p.id, name: p.name, type: p.type, config: safeConfig };
  });

  // Fetch list items for each custom list
  const customListItems: Record<string, unknown[]> = {};
  if (customLists.length > 0) {
    await Promise.all(customLists.map(async (list) => {
      try {
        const items = await api.listCustomListItems(sourceAuth, a, list.id!);
        customListItems[list.name] = items;
      } catch (e) { api.throwIfAuthError(e); /* skip */ }
    }));
  }

  // Fetch queue consumers per queue
  const queueConsumers: Record<string, { script_name: string; environment?: string; settings?: unknown }[]> = {};
  if (queues.length > 0) {
    await Promise.all(queues.map(async (q) => {
      try {
        const consumers = await api.listQueueConsumers(sourceAuth, a, q.queue_id);
        if (consumers.length > 0) queueConsumers[q.queue_name] = consumers;
      } catch (e) { api.throwIfAuthError(e); /* skip */ }
    }));
  }

  // Fetch per-R2-bucket configurations (CORS, lifecycle, managed domain).
  // These are separate endpoints under /accounts/{id}/r2/buckets/{name}/*.
  // Each is independently failable — a bucket with no CORS rules returns
  // an empty array (or 404 in older regions, handled by the list helpers).
  // Only emit a config entry when at least one sub-config has content;
  // otherwise migration would PUT empty configs on dest which is wasteful.
  const r2BucketConfigs: CFR2BucketConfig[] = [];
  if (r2Buckets.length > 0) {
    const configResults = await Promise.all(r2Buckets.map(async (b) => {
      const [cors, lifecycle, managedDomain, customDomains, lock] = await Promise.all([
        api.listR2BucketCors(sourceAuth, a, b.name).catch((e) => { api.throwIfAuthError(e); return []; }),
        api.listR2BucketLifecycle(sourceAuth, a, b.name).catch((e) => { api.throwIfAuthError(e); return []; }),
        api.getR2BucketManagedDomain(sourceAuth, a, b.name).catch((e) => { api.throwIfAuthError(e); return null; }),
        api.listR2BucketCustomDomains(sourceAuth, a, b.name).catch((e) => { api.throwIfAuthError(e); return []; }),
        api.getR2BucketLock(sourceAuth, a, b.name).catch((e) => { api.throwIfAuthError(e); return null; }),
      ]);
      const hasLock = lock && Array.isArray(lock.rules) && lock.rules.length > 0;
      const hasContent =
        (Array.isArray(cors) && cors.length > 0) ||
        (Array.isArray(lifecycle) && lifecycle.length > 0) ||
        (managedDomain && managedDomain.enabled === true) ||
        (Array.isArray(customDomains) && customDomains.length > 0) ||
        hasLock;
      if (!hasContent) return null;
      const cfg: CFR2BucketConfig = { bucketName: b.name };
      if (Array.isArray(cors) && cors.length > 0) cfg.cors = cors;
      if (Array.isArray(lifecycle) && lifecycle.length > 0) cfg.lifecycle = lifecycle;
      if (managedDomain && managedDomain.enabled === true) cfg.managedDomain = managedDomain;
      if (Array.isArray(customDomains) && customDomains.length > 0) cfg.customDomains = customDomains;
      if (hasLock) cfg.lock = lock;
      return cfg;
    }));
    for (const cfg of configResults) {
      if (cfg) r2BucketConfigs.push(cfg);
    }
    if (r2BucketConfigs.length > 0) {
      log(`  ✓ R2 Bucket Configs: ${r2BucketConfigs.length}/${r2Buckets.length} bucket(s) with CORS/lifecycle/managed-domain/custom-domain/lock settings`);
    }
  }

  // Phase 1.5: Identify workers tied to this zone
  // Workers are tied to a zone via:
  // 1. Worker Routes (zone-level, already filtered by sourceZoneId)
  // 2. Custom Domains that match this zone (zone_id matches sourceZoneId)
  const workerNamesFromRoutes = new Set(workerRoutes.map(r => r.script));
  const workerNamesFromCustomDomains = new Set(
    workerCustomDomains
      .filter(cd => cd.zone_id === sourceZoneId)
      .map(cd => cd.service)
  );
  
  // Track all zone-related worker names (will be expanded with service bindings and URL refs)
  const zoneRelatedWorkerNames = new Set([...workerNamesFromRoutes, ...workerNamesFromCustomDomains]);
  
  // Start with directly zone-tied workers
  let workers = allWorkers.filter(w => zoneRelatedWorkerNames.has(w.id));
  
  log(`  ✓ Workers (zone-tied): ${workers.length} of ${allWorkers.length} (via ${workerNamesFromRoutes.size} routes, ${workerNamesFromCustomDomains.size} custom domains)`);

  // Phase 2: Fetch dependent details in parallel (ruleset details + worker scripts + access policies)
  let fullRulesets = rulesets;
  let workersWithScripts = workers;
  let accessPolicies: Awaited<ReturnType<typeof api.listAccessPolicies>> = [];

  if (rulesets.length > 0) {
    log(`⏳ Fetching ${rulesets.length} ruleset details + ${workers.length} worker scripts + ${accessApps.length} access policies (parallel)...`);
  } else if (workers.length > 0 || accessApps.length > 0) {
    log(`⏳ Fetching ${workers.length} worker scripts + ${accessApps.length} access policies (parallel)...`);
  }

  // [C9] Log export warnings from Phase 1
  if (exportWarnings.length > 0) {
    log(`  ⚠ ${exportWarnings.length} resource type(s) failed to fetch:`);
    for (const w of exportWarnings) {
      log(`    - ${w}`);
    }
  }

  // All detail fetches run in parallel
  const [rulesetsResult, workersResult, policiesResult] = await Promise.all([
    // [W11] Ruleset details — log warning when detail fetch fails instead of silently using summary
    Promise.all(rulesets.map(rs => api.getRuleset(sourceAuth, sourceZoneId, rs.id).catch(e => {
      api.throwIfAuthError(e);
      log(`  ⚠ Ruleset ${rs.id} (${rs.name}): detail fetch failed (${(e as Error).message}), using summary`);
      return rs;
    }))),
    // [C10] Worker scripts and bindings — log warning when fetch fails instead of silently dropping
    Promise.all(workers.map(async (w) => {
      try {
        const [bundle, bindings] = await Promise.all([
          api.getWorkerScriptBundle(sourceAuth, sourceAccountId, w.id),
          api.getWorkerBindings(sourceAuth, sourceAccountId, w.id),
        ]);
        log(`  ✓ Worker: ${w.id}`);
        return {
          ...w,
          script: bundle.script,
          bindings,
          script_format: bundle.format,
          main_module: bundle.main_module,
          modules: bundle.modules,
        };
      } catch (e) {
        api.throwIfAuthError(e);
        log(`  ⚠ Worker ${w.id}: script fetch failed (${(e as Error).message}), skipping`);
        return w;
      }
    })),
    // [W12] Access policies — log warning per failed app instead of silently dropping
    Promise.all(accessApps.map(app =>
      api.listAccessPolicies(sourceAuth, sourceAccountId, app.id).catch(e => {
        api.throwIfAuthError(e);
        log(`  ⚠ Access app ${app.id} (${app.name}): policy fetch failed (${(e as Error).message})`);
        return [];
      })
    )).then(results => results.flat()),
  ]);

  fullRulesets = rulesetsResult;
  workersWithScripts = workersResult;

  // Discover and fetch account-level custom rulesets in two ways:
  //   1. Zone-level execute references — rules in this zone's rulesets that
  //      `execute` an account ruleset.
  //   2. Account-level phase entrypoint references — the canonical CF API
  //      path for deploying a custom account ruleset (kind: custom) across
  //      the account's zones. The CF API rejects zone-level execute rules
  //      pointing at custom-scope account rulesets (error 20230 "not
  //      possible to execute a ruleset of scope account at scope zone"),
  //      so users must deploy via the account-level phase entrypoint
  //      (kind: root). We enumerate every account-level root entrypoint
  //      and harvest its `execute` rules — these define which custom
  //      account rulesets are deployed for this account.
  //
  // Only the subset actually referenced is exported; we never download the
  // full account ruleset inventory because most of it is irrelevant.
  const allZoneExecuteIds = collectExecutedAccountRulesetIds(fullRulesets);
  const accountPhaseEntrypointReferences: Array<{
    phase: string;
    expression: string;
    description?: string;
    enabled?: boolean;
    sourceTargetId: string;
  }> = [];

  // Enumerate account-level rulesets to find root entrypoints. When this
  // succeeds it is AUTHORITATIVE: we know exactly which IDs are custom account
  // rulesets and which are not.
  let accountRulesetInventory: typeof fullRulesets = [];
  let inventoryEnumerated = false;
  try {
    accountRulesetInventory = await api.listAccountRulesets(sourceAuth, sourceAccountId);
    inventoryEnumerated = true;
  } catch (e) {
    api.throwIfAuthError(e);
    log(`  ⚠ Could not list account rulesets (${(e as Error).message}) — only zone-level execute references will be used`);
  }

  // For each account-level root entrypoint, fetch its rules and collect
  // execute targets pointing at custom-kind rulesets in the same inventory.
  const customRulesetIds = new Set(
    accountRulesetInventory.filter(r => r.kind === 'custom').map(r => r.id)
  );

  // Filter the zone-level execute references. Cloudflare REJECTS zone-level
  // execute rules that point at custom-scope account rulesets (error 20230),
  // so zone-level execute targets are, in practice, MANAGED rulesets (e.g. the
  // Cloudflare Managed Ruleset deployed via the http_request_firewall_managed
  // phase). Those use GLOBAL ruleset IDs that are already valid on the
  // destination — they are auto-provisioned, not migratable, and NOT stale
  // references. Fetching them as account custom rulesets 404s ("could not find
  // ruleset"), which previously produced a spurious "zone rules will reference
  // stale IDs" alarm. When the inventory is authoritative, keep only IDs that
  // are genuinely custom account rulesets; treat the rest as managed/global.
  let zoneExecuteIds: string[];
  if (inventoryEnumerated) {
    const { custom, managed } = partitionAccountRulesetReferences(allZoneExecuteIds, customRulesetIds);
    zoneExecuteIds = custom;
    if (managed.length > 0) {
      log(`  ℹ️ ${managed.length} zone execute reference(s) point at managed/global rulesets (auto-provisioned on destination, no migration needed): ${managed.join(', ')}`);
    }
  } else {
    // Inventory unreadable: we cannot pre-classify, so carry them forward and
    // let the per-ID fetch below decide (a 404 there is treated as managed).
    zoneExecuteIds = allZoneExecuteIds;
  }
  const rootRulesets = accountRulesetInventory.filter(r => r.kind === 'root');
  if (rootRulesets.length > 0) {
    log(`  Scanning ${rootRulesets.length} account-level phase entrypoint(s) for custom-ruleset execute rules...`);
    const rootDetails = await Promise.all(
      rootRulesets.map(rs =>
        api.getAccountRuleset(sourceAuth, sourceAccountId, rs.id)
          .then(r => ({ ok: true as const, ruleset: r }))
          .catch(e => {
            api.throwIfAuthError(e);
            log(`  ⚠ Account root ruleset ${rs.id} (${rs.phase}): detail fetch failed (${(e as Error).message})`);
            return { ok: false as const, error: (e as Error).message };
          })
      )
    );
    for (const rd of rootDetails) {
      if (!rd.ok) continue;
      const rs = rd.ruleset;
      for (const rule of (rs.rules || [])) {
        if (rule.action !== 'execute') continue;
        const ap = rule.action_parameters as Record<string, unknown> | undefined;
        const targetId = ap?.id;
        if (typeof targetId !== 'string') continue;
        // Only track targets that are custom rulesets on this account
        // (skip managed-ruleset deployments and references to rulesets
        // outside this account — those are out of scope).
        if (!customRulesetIds.has(targetId)) continue;
        accountPhaseEntrypointReferences.push({
          phase: rs.phase,
          expression: (rule as { expression?: string }).expression || 'true',
          description: (rule as { description?: string }).description,
          enabled: (rule as { enabled?: boolean }).enabled,
          sourceTargetId: targetId,
        });
      }
    }
    if (accountPhaseEntrypointReferences.length > 0) {
      log(`  Found ${accountPhaseEntrypointReferences.length} execute rule(s) on account phase entrypoints referencing custom account rulesets`);
    }
  }

  // Merge both discovery sources. Account-phase-entrypoint references are
  // already filtered to custom rulesets in the inventory, so they are known
  // genuine customs; zone-execute IDs are only here when the inventory was
  // unreadable (otherwise pre-filtered above).
  const entrypointIds = new Set(accountPhaseEntrypointReferences.map(r => r.sourceTargetId));
  let referencedAccountRulesetIds = [...new Set([
    ...zoneExecuteIds,
    ...entrypointIds,
  ])];
  let accountRulesets: typeof fullRulesets = [];
  if (referencedAccountRulesetIds.length > 0) {
    log(`⏳ Fetching ${referencedAccountRulesetIds.length} account-level custom ruleset(s)...`);
    const results = await Promise.all(
      referencedAccountRulesetIds.map(id =>
        api.getAccountRuleset(sourceAuth, sourceAccountId, id)
          .then(r => ({ ok: true as const, id, ruleset: r }))
          .catch(e => { api.throwIfAuthError(e); return { ok: false as const, id, error: (e as Error).message }; })
      )
    );
    accountRulesets = results.filter((r): r is { ok: true; id: string; ruleset: typeof fullRulesets[number] } => r.ok).map(r => r.ruleset);
    for (const r of accountRulesets) log(`  ✓ Account Ruleset: ${r.name} (${r.id})`);

    // Classify fetch failures. A not-found on an ID that is NOT a known custom
    // (entrypoint-sourced) ruleset is a managed/global ruleset — its ID is
    // already valid on the destination, so it is auto-provisioned, not a stale
    // reference. Drop it (don't carry it into the "could not migrate" gap).
    // Genuine custom rulesets we couldn't read (deleted / read-forbidden) stay
    // in the list so migrate emits an honest acknowledgment.
    const droppedManaged: string[] = [];
    for (const r of results) {
      if (r.ok) continue;
      const notFound = /could not find ruleset|not found|does not exist|404/i.test(r.error);
      if (notFound && !entrypointIds.has(r.id)) {
        droppedManaged.push(r.id);
      } else {
        log(`  ⚠ Account ruleset ${r.id}: fetch failed (${r.error})`);
      }
    }
    if (droppedManaged.length > 0) {
      referencedAccountRulesetIds = referencedAccountRulesetIds.filter(id => !droppedManaged.includes(id));
      log(`  ℹ️ ${droppedManaged.length} execute reference(s) resolve to managed/global rulesets (auto-provisioned on destination, no migration needed): ${droppedManaged.join(', ')}`);
    }
    // Remaining unfetched IDs are kept so migration can produce an
    // acknowledgment for the gap.
  }
  accessPolicies = policiesResult;

  // Notification policies that filter to this zone (D2).
  //
  // Policies live at /accounts/{id}/alerting/v3/policies. A policy is
  // considered zone-scoped when filters.zones[] contains this zone's ID.
  // We only export the matching subset and the destinations they reference
  // — webhook secrets are write-only and the user must rotate them on
  // dest. PagerDuty tokens are OAuth-bound and not exportable at all.
  let notificationPolicies: Awaited<ReturnType<typeof api.listNotificationPolicies>> = [];
  let notificationWebhooks: Awaited<ReturnType<typeof api.listNotificationWebhooks>> = [];
  let notificationPagerDuty: Awaited<ReturnType<typeof api.listNotificationPagerDuty>> = [];
  try {
    const allPolicies = await api.listNotificationPolicies(sourceAuth, a);
    notificationPolicies = allPolicies.filter(p => {
      const filters = p.filters as Record<string, unknown> | undefined;
      if (!filters) return false;
      const zones = filters.zones;
      return Array.isArray(zones) && zones.includes(z);
    });
    if (notificationPolicies.length > 0) {
      log(`  ✓ Notification Policies (zone-scoped): ${notificationPolicies.length} of ${allPolicies.length}`);
      // Collect the destination IDs the matched policies reference, then
      // fetch only the destinations that are actually used.
      const usedWebhookIds = new Set<string>();
      const usedPagerDutyIds = new Set<string>();
      for (const p of notificationPolicies) {
        for (const w of (p.mechanisms?.webhooks || [])) usedWebhookIds.add(w.id);
        for (const pd of (p.mechanisms?.pagerduty || [])) usedPagerDutyIds.add(pd.id);
      }
      if (usedWebhookIds.size > 0) {
        const allHooks = await api.listNotificationWebhooks(sourceAuth, a);
        notificationWebhooks = allHooks
          .filter(h => h.id && usedWebhookIds.has(h.id))
          // Strip the secret defensively — the API doesn't return it but
          // future schema changes shouldn't leak it through ZoneExport.
          .map(h => ({ id: h.id, name: h.name, type: h.type, url: h.url }));
      }
      if (usedPagerDutyIds.size > 0) {
        const allPd = await api.listNotificationPagerDuty(sourceAuth, a);
        notificationPagerDuty = allPd
          .filter(p => p.id && usedPagerDutyIds.has(p.id))
          .map(p => ({ id: p.id, name: p.name }));
      }
    }
  } catch (e) {
    api.throwIfAuthError(e);
    log(`  ⚠ Notification policies fetch failed (${(e as Error).message}) — proceeding without`);
  }

  // Account-scoped Logpush jobs that include this zone (D3).
  //
  // Account-scoped jobs at /accounts/{id}/logpush/jobs can include or
  // exclude specific zones via a `filter` JSON expression (e.g.
  // {"where":{"key":"zone.id","operator":"eq","value":"<src_zone_id>"}}).
  // We export only jobs whose filter references the source zone ID; the
  // remap to dest zone ID happens during migrate.
  let accountLogpushJobs: api.LogpushJob[] = [];
  try {
    const allJobs = await api.listAccountLogpushJobs(sourceAuth, a);
    accountLogpushJobs = allJobs.filter(job => {
      if (!job.filter) return false;
      // Filter is a JSON string; substring match is sufficient — the zone
      // ID is a 32-hex literal and won't collide with other identifiers.
      return typeof job.filter === 'string' && job.filter.includes(z);
    });
    if (accountLogpushJobs.length > 0) {
      log(`  ✓ Account Logpush Jobs (zone-filtered): ${accountLogpushJobs.length} of ${allJobs.length}`);
    }
  } catch (e) {
    api.throwIfAuthError(e);
    log(`  ⚠ Account Logpush fetch failed (${(e as Error).message}) — proceeding without`);
  }

  // Phase 2.5: Resolve service bindings to include referenced workers
  // Service bindings reference other workers that should also be migrated
  const serviceBindingWorkerNames = new Set<string>();
  for (const worker of workersWithScripts) {
    if (worker.bindings) {
      for (const binding of worker.bindings) {
        if (binding.type === 'service' && binding.service) {
          serviceBindingWorkerNames.add(binding.service);
        }
      }
    }
  }
  
  // Find workers referenced by service bindings that aren't already included
  const missingServiceWorkerNames = [...serviceBindingWorkerNames].filter(
    name => !workersWithScripts.some(w => w.id === name)
  );
  
  if (missingServiceWorkerNames.length > 0) {
    log(`⏳ Fetching ${missingServiceWorkerNames.length} workers referenced by service bindings...`);
    
    // Get the worker objects from allWorkers
    const serviceWorkers = allWorkers.filter(w => missingServiceWorkerNames.includes(w.id));
    
    // Fetch scripts and bindings for service workers
    const serviceWorkersWithScripts = await Promise.all(serviceWorkers.map(async (w) => {
      try {
        const [bundle, bindings] = await Promise.all([
          api.getWorkerScriptBundle(sourceAuth, sourceAccountId, w.id),
          api.getWorkerBindings(sourceAuth, sourceAccountId, w.id),
        ]);
        log(`  ✓ Service Worker: ${w.id}`);
        return {
          ...w,
          script: bundle.script,
          bindings,
          script_format: bundle.format,
          main_module: bundle.main_module,
          modules: bundle.modules,
        };
      } catch (e) {
        api.throwIfAuthError(e);
        return w;
      }
    }));
    
    // Add service workers to the list and track as zone-related
    workersWithScripts = [...workersWithScripts, ...serviceWorkersWithScripts];
    missingServiceWorkerNames.forEach(name => zoneRelatedWorkerNames.add(name));
    log(`  ✓ Workers (with service deps): ${workersWithScripts.length}`);
  }

  // Phase 2.6: Scan worker code for URL references to other workers
  // Workers may reference other workers by preview URL or custom domain
  const urlReferencedWorkerNames = new Set<string>();
  
  // Build lookup maps for URL pattern matching
  // Preview URLs: https://{worker-name}.{account-subdomain}.workers.dev
  // Custom domains: any hostname in workerCustomDomains
  const allWorkerNames = new Set(allWorkers.map(w => w.id));
  const customDomainToWorker = new Map<string, string>();
  for (const cd of workerCustomDomains) {
    customDomainToWorker.set(cd.hostname.toLowerCase(), cd.service);
  }
  
  for (const worker of workersWithScripts) {
    if (!worker.script) continue;
    
    // Search for preview URL patterns: worker-name.*.workers.dev
    // Match patterns like: https://my-worker.account.workers.dev or my-worker.subdomain.workers.dev
    const previewUrlRegex = /['"\`]https?:\/\/([a-z0-9-]+)\.[a-z0-9-]+\.workers\.dev/gi;
    let match;
    while ((match = previewUrlRegex.exec(worker.script)) !== null) {
      const workerName = match[1];
      if (allWorkerNames.has(workerName) && workerName !== worker.id) {
        urlReferencedWorkerNames.add(workerName);
      }
    }
    
    // Search for custom domain references
    for (const [hostname, serviceName] of customDomainToWorker) {
      if (worker.script.toLowerCase().includes(hostname) && serviceName !== worker.id) {
        urlReferencedWorkerNames.add(serviceName);
      }
    }
  }
  
  // Find workers referenced by URL that aren't already included
  const missingUrlWorkerNames = [...urlReferencedWorkerNames].filter(
    name => !workersWithScripts.some(w => w.id === name)
  );
  
  if (missingUrlWorkerNames.length > 0) {
    log(`⏳ Fetching ${missingUrlWorkerNames.length} workers referenced by URL in code...`);
    
    // Get the worker objects from allWorkers
    const urlWorkers = allWorkers.filter(w => missingUrlWorkerNames.includes(w.id));
    
    // Fetch scripts and bindings for URL-referenced workers
    const urlWorkersWithScripts = await Promise.all(urlWorkers.map(async (w) => {
      try {
        const [bundle, bindings] = await Promise.all([
          api.getWorkerScriptBundle(sourceAuth, sourceAccountId, w.id),
          api.getWorkerBindings(sourceAuth, sourceAccountId, w.id),
        ]);
        log(`  ✓ URL-referenced Worker: ${w.id}`);
        return {
          ...w,
          script: bundle.script,
          bindings,
          script_format: bundle.format,
          main_module: bundle.main_module,
          modules: bundle.modules,
        };
      } catch (e) {
        api.throwIfAuthError(e);
        return w;
      }
    }));
    
    // Add URL-referenced workers to the list and track as zone-related
    workersWithScripts = [...workersWithScripts, ...urlWorkersWithScripts];
    missingUrlWorkerNames.forEach(name => zoneRelatedWorkerNames.add(name));
    log(`  ✓ Workers (with URL deps): ${workersWithScripts.length}`);
  }

  // Phase 2.7: List account-level workers (not zone-related) without fetching scripts/bindings.
  // We only include names for informational display in the UI – scripts are NOT fetched
  // to avoid hundreds of unnecessary API calls on large accounts.
  const accountLevelWorkerNames = allWorkers
    .filter(w => !zoneRelatedWorkerNames.has(w.id))
    .map(w => w.id);
  
  const accountLevelWorkers = accountLevelWorkerNames.map(name => {
    const w = allWorkers.find(aw => aw.id === name)!;
    return { ...w, isAccountLevel: true } as typeof workersWithScripts[number] & { isAccountLevel: boolean };
  });
  
  if (accountLevelWorkerNames.length > 0) {
    log(`  ℹ️ ${accountLevelWorkerNames.length} account-level workers found (not fetched – not zone-related)`);
  }

  // Mark zone-related workers and combine
  const zoneRelatedWorkers = workersWithScripts.map(w => ({ ...w, isAccountLevel: false }));
  const allWorkersWithScripts = [...zoneRelatedWorkers, ...accountLevelWorkers];

  // Phase 3: Determine zone-relatedness for account-level resources
  // Extract storage resources used by zone-related workers
  const zoneRelatedKvIds = new Set<string>();
  const zoneRelatedR2Names = new Set<string>();
  const zoneRelatedD1Ids = new Set<string>();
  const zoneRelatedQueueIds = new Set<string>();
  const zoneRelatedDoClasses = new Set<string>();
  
  for (const worker of zoneRelatedWorkers) {
    if (!worker.bindings) continue;
    for (const binding of worker.bindings) {
      if (binding.type === 'kv_namespace' && binding.namespace_id) {
        zoneRelatedKvIds.add(binding.namespace_id);
      } else if (binding.type === 'r2_bucket' && binding.bucket_name) {
        zoneRelatedR2Names.add(binding.bucket_name);
      } else if (binding.type === 'd1' && binding.database_id) {
        zoneRelatedD1Ids.add(binding.database_id);
      } else if (binding.type === 'queue' && binding.queue_name) {
        // Find queue by name to get ID
        const queue = queues.find(q => q.queue_name === binding.queue_name);
        if (queue) zoneRelatedQueueIds.add(queue.queue_id);
      } else if (binding.type === 'durable_object_namespace' && binding.class_name) {
        zoneRelatedDoClasses.add(binding.class_name);
      }
    }
  }

  // Check if load balancers are zone-related (hostname matches zone or referenced in DNS)
  const zoneName = zone.name;
  const dnsTargets = new Set(dnsRecords.map(r => r.content?.toLowerCase()).filter(Boolean));
  
  const zoneRelatedLbIds = new Set<string>();
  const zoneRelatedPoolIds = new Set<string>();
  const zoneRelatedMonitorIds = new Set<string>();
  
  for (const lb of loadBalancers) {
    // LB is zone-related if its name ends with zone name or is referenced in DNS
    const lbHostname = lb.name?.toLowerCase() || '';
    if (lbHostname.endsWith(zoneName.toLowerCase()) || dnsTargets.has(lbHostname)) {
      zoneRelatedLbIds.add(lb.id);
      // Mark associated pools and monitors as zone-related
      if (lb.default_pools) lb.default_pools.forEach((pid: string) => zoneRelatedPoolIds.add(pid));
      if (lb.fallback_pool) zoneRelatedPoolIds.add(lb.fallback_pool);
    }
  }
  
  // Mark monitors used by zone-related pools
  for (const pool of pools) {
    if (zoneRelatedPoolIds.has(pool.id) && pool.monitor) {
      zoneRelatedMonitorIds.add(pool.monitor);
    }
  }

  // Check if Access apps are zone-related. A modern self-hosted app may have
  // an empty legacy `domain` and route entirely through self_hosted_domains[]
  // or destinations[], so check every hostname the app references — not just
  // `domain`. Otherwise such an app is wrongly dropped from the migration.
  const zoneRelatedAccessAppIds = new Set<string>();
  const zoneSuffix = zoneName.toLowerCase();
  for (const app of accessApps) {
    const isZoneRelated = accessAppHostnames(app).some(h => {
      const hostname = h.toLowerCase();
      // Strip path if present (e.g. "tunnel.rbj.me/secure" -> "tunnel.rbj.me")
      const bareHost = hostname.split('/')[0];
      return bareHost.endsWith(zoneSuffix) || hostname.endsWith(zoneSuffix);
    });
    if (isZoneRelated) {
      zoneRelatedAccessAppIds.add(app.id);
    }
  }

  // Check if Turnstile widgets are zone-related (hostname within zone)
  const zoneRelatedTurnstileIds = new Set<string>();
  for (const widget of turnstileWidgets) {
    const widgetDomains = widget.domains || [];
    if (widgetDomains.some((d: string) => d.toLowerCase().endsWith(zoneName.toLowerCase()))) {
      zoneRelatedTurnstileIds.add(widget.sitekey);
    }
  }

  // Create zone-relatedness maps to pass to UI
  const zoneRelatedness = {
    kvNamespaces: zoneRelatedKvIds,
    r2Buckets: zoneRelatedR2Names,
    d1Databases: zoneRelatedD1Ids,
    queues: zoneRelatedQueueIds,
    durableObjects: zoneRelatedDoClasses,
    loadBalancers: zoneRelatedLbIds,
    pools: zoneRelatedPoolIds,
    monitors: zoneRelatedMonitorIds,
    accessApps: zoneRelatedAccessAppIds,
    turnstileWidgets: zoneRelatedTurnstileIds,
  };

  // Summary stats
  const totalResources = dnsRecords.length + settings.length + pageRules.length + 
    fullRulesets.length + allWorkersWithScripts.length + workerRoutes.length +
    loadBalancers.length + pools.length + monitors.length + spectrumApps.length +
    customCertificates.length + customHostnames.length + accessApps.length +
    accessPolicies.length + firewallRules.length + rateLimits.length +
    emailRoutingRules.length + waitingRooms.length + turnstileWidgets.length +
    (zarazConfig ? 1 : 0);

  log('');
  log(`✅ Export complete! ${totalResources} resources found`);
  log(`   📊 DNS: ${dnsRecords.length} | Settings: ${settings.length} | Workers: ${zoneRelatedWorkers.length} zone + ${accountLevelWorkers.length} account`);
  log(`   📊 LBs: ${loadBalancers.length} | Pools: ${pools.length} | Rules: ${pageRules.length + fullRulesets.length}`);

  return {
    zone,
    dnsRecords,
    settings,
    pageRules,
    rulesets: fullRulesets,
    workers: allWorkersWithScripts,
    workerRoutes,
    workerCustomDomains,
    loadBalancers,
    pools,
    monitors,
    spectrumApps,
    customCertificates,
    customHostnames,
    accessApps,
    accessPolicies,
    firewallRules,
    rateLimits,
    emailRoutingRules,
    waitingRooms,
    zarazConfig,
    turnstileWidgets,
    // Separate-endpoint features
    argoSmartRouting: argoSmartRouting ? { value: argoSmartRouting.value } : null,
    argoTieredCaching: argoTieredCaching ? { value: argoTieredCaching.value } : null,
    botManagement: botManagement || null,
    // Newly-migrated zone-scoped resources
    managedHeaders: managedHeaders || null,
    cloudConnectorRules: Array.isArray(cloudConnectorRulesRaw) ? cloudConnectorRulesRaw : [],
    urlNormalization: urlNormalization || null,
    precursor: precursor || null,
    cacheReserve: cacheReserve ? { value: cacheReserve.value } : null,
    snippets,
    snippetRules: (snippetRulesRaw?.rules) || [],
    healthchecks: Array.isArray(healthchecksList) ? healthchecksList : [],
    // 100% coverage additions
    dnsSettings: dnsSettings || null,
    dnssecStatus: dnssecStatus ? { status: dnssecStatus.status } : null,
    regionalHostnames: Array.isArray(regionalHostnames) ? regionalHostnames : [],
    regionalTieredCache: regionalTieredCache || null,
    cacheVariants: cacheVariants || null,
    originPostQuantum: originPostQuantum || null,
    clientCertificates: Array.isArray(clientCertificates) ? clientCertificates : [],
    fraudDetectionSettings: fraudDetectionSettings || null,
    accessRules: Array.isArray(accessRules) ? accessRules : [],
    firewallLockdowns: Array.isArray(firewallLockdowns) ? firewallLockdowns : [],
    uaRules: Array.isArray(uaRules) ? uaRules : [],
    pageShieldSettings: pageShieldSettings || null,
    pageShieldPolicies: Array.isArray(pageShieldPolicies) ? pageShieldPolicies : [],
    logpushJobs: Array.isArray(logpushJobs) ? logpushJobs : [],
    schemaValidationSchemas: Array.isArray(schemaValidationSchemas) ? schemaValidationSchemas : [],
    schemaValidationSettings: schemaValidationSettings || null,
    tokenValidationConfigs: Array.isArray(tokenValidationConfigs) ? tokenValidationConfigs : [],
    tokenValidationRules: Array.isArray(tokenValidationRules) ? tokenValidationRules : [],
    certificatePacks: Array.isArray(certificatePacks) ? certificatePacks : [],
    acmTotalTls: acmTotalTls || null,
    apiGatewayOperations: Array.isArray(apiGatewayOperations) ? apiGatewayOperations : [],
    apiGatewaySchemas: Array.isArray(apiGatewaySchemas) ? apiGatewaySchemas : [],
    apiGatewayConfiguration: apiGatewayConfiguration || null,
    apiGatewayUserLabels: Array.isArray(apiGatewayUserLabels) ? apiGatewayUserLabels : [],
    apiGatewayOperationSchemaValidation,
    waitingRoomEvents,
    hostnameAssociations: hostnameAssociations || null,
    originTlsSettings: originTlsSettings || null,
    originTlsHostnames: Array.isArray(originTlsHostnames) ? originTlsHostnames : [],
    // Newer zone-level features (AGENTS.md Principle 7)
    customHostnameFallbackOrigin: customHostnameFallbackOrigin || null,
    aiSecuritySettings: aiSecuritySettings || null,
    aiSecurityCustomTopics: aiSecurityCustomTopics || null,
    workersObservabilityDestinations: Array.isArray(workersObservabilityDestinations) ? workersObservabilityDestinations : [],
    workersObservabilityQueries: Array.isArray(workersObservabilityQueries) ? workersObservabilityQueries : [],
    vectorizeIndexes: Array.isArray(vectorizeIndexes) ? vectorizeIndexes : [],
    waitingRoomSettings: waitingRoomSettings || null,
    contentUploadScanSettings: contentUploadScanSettings || null,
    ctAlerting: ctAlerting || null,
    autoOriginTlsKex: autoOriginTlsKex || null,
    emailRoutingSettings: emailRoutingSettings || null,
    cacheOriginCloudRegions: Array.isArray(cacheOriginCloudRegions) ? cacheOriginCloudRegions : [],
    leakedCredentialChecksStatus: leakedCredentialChecksStatus || null,
    leakedCredentialCustomDetections: Array.isArray(leakedCredentialCustomDetections) ? leakedCredentialCustomDetections : [],
    emailSendingSubdomains: Array.isArray(emailSendingSubdomains) ? emailSendingSubdomains : [],
    web3Hostnames,
    secondaryDnsAcls: Array.isArray(secondaryDnsAcls) ? secondaryDnsAcls : [],
    secondaryDnsPeers: Array.isArray(secondaryDnsPeers) ? secondaryDnsPeers : [],
    secondaryDnsTsigs: Array.isArray(secondaryDnsTsigs) ? secondaryDnsTsigs : [],
    secondaryDnsIncoming: secondaryDnsIncoming || null,
    secondaryDnsOutgoing: secondaryDnsOutgoing || null,
    loadBalancerMonitorGroups: Array.isArray(loadBalancerMonitorGroups) ? loadBalancerMonitorGroups : [],
    hyperdriveConfigs: Array.isArray(hyperdriveConfigs) ? hyperdriveConfigs : [],
    secretsStoreStores: Array.isArray(secretsStoreStores)
      ? secretsStoreStores.filter(s => s.name).map(s => ({ id: s.id, name: s.name! }))
      : [],
    customNameserversMetadata: customNameserversMetadata || null,
    payPerCrawlConfiguration: payPerCrawlConfiguration || null,
    googleTagGateway: googleTagGateway || null,
    smartShield: smartShield || null,
    smartShieldHealthchecks: Array.isArray(smartShieldHealthchecks) ? smartShieldHealthchecks : [],
    waitingRoomRules,
    aiGatewayCustomProviderCosts: Array.isArray(aiGatewayCustomProviderCosts) ? aiGatewayCustomProviderCosts : [],
    aiGatewayProviderConfigs,
    accessGroups,
    accessServiceTokens,
    identityProviders,
    customLists,
    customListItems,
    queueConsumers,
    accountRulesets,
    referencedAccountRulesetIds,
    accountPhaseEntrypointReferences,
    notificationPolicies,
    notificationWebhooks,
    notificationPagerDuty,
    accountLogpushJobs,
    accessTags: accessTags.map(t => ({ name: t.name })),
    accessBookmarks,
    accessCustomPages,
    // Storage resources (filtered to zone-related only)
    kvNamespaces: kvNamespaces.filter(kv => zoneRelatedKvIds.has(kv.id)),
    r2Buckets: r2Buckets.filter(b => zoneRelatedR2Names.has(b.name)),
    d1Databases: d1Databases.filter(d => zoneRelatedD1Ids.has(d.uuid)),
    queues: queues.filter(q => zoneRelatedQueueIds.has(q.queue_id)),
    durableObjectNamespaces, // Show all DOs - they're account-level and user can choose which to migrate
    // R2 bucket sub-configurations (CORS, lifecycle, managed-domain) —
    // filtered to zone-related buckets only (matches r2Buckets filter above).
    r2BucketConfigs: r2BucketConfigs.filter(c => zoneRelatedR2Names.has(c.bucketName)),
    // Developer-platform resources (account-scoped).
    // Pages projects: show all — users opt in via Step 2 selection.
    pagesProjects: Array.isArray(pagesProjectsRaw) ? pagesProjectsRaw : [],
    // AI Gateway: gateways + custom providers are account-scoped resources
    // that may be referenced by workers in this zone (hardcoded URLs).
    // The user opts in via Step 2 selection.
    aiGateways: Array.isArray(aiGatewaysRaw) ? aiGatewaysRaw : [],
    aiGatewayCustomProviders: Array.isArray(aiGatewayCustomProvidersRaw) ? aiGatewayCustomProvidersRaw : [],
    // Origin CA certificates (zone-scoped). Private keys not exportable —
    // Step 3 UI prompts the user to either re-issue with a new CSR or
    // skip and re-create manually on the destination.
    originCaCertificates: Array.isArray(originCaCertificatesRaw) ? originCaCertificatesRaw : [],
    // Zone-relatedness tracking
    zoneRelatedness: {
      kvNamespaces: [...zoneRelatedKvIds],
      r2Buckets: [...zoneRelatedR2Names],
      d1Databases: [...zoneRelatedD1Ids],
      queues: [...zoneRelatedQueueIds],
      durableObjects: [...zoneRelatedDoClasses],
      loadBalancers: [...zoneRelatedLbIds],
      pools: [...zoneRelatedPoolIds],
      monitors: [...zoneRelatedMonitorIds],
      accessApps: [...zoneRelatedAccessAppIds],
      turnstileWidgets: [...zoneRelatedTurnstileIds],
    },
  };
}
