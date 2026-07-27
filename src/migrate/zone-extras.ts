// Zone-scoped extras extracted from migrateZone() — Batch 3b + Batch 3c.
//
// This phase handles every zone-level feature that *doesn't* fit cleanly
// into the Phase 1/2 setup (DNS records, zone settings, rulesets, workers,
// access apps, storage). It runs after the main rulesets/workers loop but
// before the account-scoped sub-resources phase. The features it owns:
//
//   Batch 3b (PUT-entire-config singletons + Snippets + Healthchecks):
//     - Managed Headers
//     - Cloud Connector Rules
//     - URL Normalization
//     - Cache Reserve
//     - Snippets (parallel POSTs + Snippet Rules PUT)
//     - Healthchecks
//
//   Batch 3c (100% coverage migrations):
//     - DNS Settings (PATCH)
//     - DNSSEC (acknowledged — DS record at registrar is manual)
//     - Regional Hostnames
//     - Regional Tiered Cache, Cache Variants, Origin Post-Quantum
//     - Custom Nameservers (Biz+)
//     - Fraud Detection Settings
//     - Firewall Access Rules / Lockdowns / UA Rules
//     - Page Shield Settings + Policies
//     - Logpush Jobs (zone-scoped)
//     - Schema Validation Schemas + Settings
//     - Token Validation Configs + Rules
//     - SSL Certificate Packs (with dedupe — see comment inline)
//     - ACM Total TLS
//     - API Gateway Operations + Schemas
//     - Waiting Room Events (per-room sub-resource with name→id remap)
//     - Hostname Associations (mTLS) — AOP cert bundle acknowledged separately
//     - Origin TLS Client Auth Settings
//     - Client Certificates (acknowledged — private keys not exportable)
//
// The block is a literal move from migrate.ts lines 4675-5062 (pre-extract).
// All call sites use the `migrateSingleton` helper from src/migrate/singleton.ts
// (lifted from the original inline closure in commit 3396a22-successor),
// `migrateItems` (now exported from src/migrate.ts), and
// `dedupeCertificatePacks` from src/migrate/certs.ts.

import type { MigrationReport, ZoneExport, ReportSection } from '../types';
import * as api from '../api';
import { migrateItems, type LogFn } from '../migrate';
import { bindSingleton } from './singleton';
import { isAcknowledgeableSingletonError } from './errors';
import { partitionManagedHeaders } from './managed-headers';
import { dedupeCertificatePacks } from './certs';

/**
 * True only for the empty-envelope responses that genuinely signal an
 * unprovisioned Enterprise feature on the destination: a 4xx with NO error
 * body (tagged EmptyEnvelopeError). Deliberately EXCLUDES 401/403/429 — an
 * empty 401 (bad token), 403 (missing permission), or 429 (rate-limited) is an
 * operational failure the user must fix, not a feature gap, and acknowledging
 * it would hide a broken credential behind a calm status (AGENTS.md Debugging
 * Integrity). 5xx stays failed too: it's a real/transient server error.
 */
export function isEmptyEnvelopeEntitlementGap(e: unknown): boolean {
  return (
    e instanceof api.EmptyEnvelopeError &&
    e.status >= 400 && e.status < 500 &&
    e.status !== 401 && e.status !== 403 && e.status !== 429
  );
}

export interface ZoneExtrasDeps {
  exportData: ZoneExport;
  report: MigrationReport;
  destAuth: api.ApiAuth | string;
  destZoneId: string;
  /** Bucket 2.3: required when `aopMtlsBundles` is supplied, since
   * the upload endpoint is account-scoped. */
  destAccountId?: string;
  logWithProgress: LogFn;
  /** Advance the upstream `completedItems` progress counter by one. */
  onItemDone: () => void;
  /** Bucket 2.3: user-supplied AOP mTLS cert+key bundles. When
   * present, the migrator uploads each bundle to
   * /accounts/{id}/mtls_certificates, then uses the resulting cert
   * ID for the hostname-association PUT. When absent, the previous
   * acknowledgment-only behaviour is preserved. */
  aopMtlsBundles?: Array<{
    name: string;
    certificates: string;
    private_key: string;
    ca?: boolean;
  }>;
  /** Secondary DNS TSIG secrets, keyed by source TSIG name. The user
   * supplies these in Step 3 (mirror of workerSecrets) because the
   * secret bytes are write-only at create time. When a TSIG name has
   * no matching entry here, the TSIG is acknowledged via the
   * secondary_dns_tsig_secrets IMPOSSIBLE entry — peers referencing
   * that TSIG migrate with tsig_id stripped, and the user pastes the
   * secret in the dest dashboard post-migration. */
  tsigSecrets?: Record<string, string>;
}

/**
 * Run the zone-extras phase (Batch 3b + 3c). Mutates `deps.report` in place.
 * Returns when every applicable feature has been processed.
 */
export async function migrateZoneExtras(deps: ZoneExtrasDeps): Promise<void> {
  const {
    exportData,
    report,
    destAuth,
    destZoneId,
    destAccountId,
    logWithProgress,
    onItemDone,
    aopMtlsBundles,
    tsigSecrets,
  } = deps;

  // Bind the singleton helper once per phase invocation.
  const migrateSingleton = bindSingleton({ report, log: logWithProgress, onItemDone });

  // No-op identity preserved from the original `trackSection` closure in
  // migrateZone(). Kept as a local for symmetry with the other phases.
  const trackSection = <T>(section: T) => section;

  // ── Batch 3b: Extended zone-scoped resources ─────────────────────────────
  // These all have simple PUT semantics — most are single-object updates.

  // Managed Headers (Managed Transforms) — PATCH config, but only with
  // rules the DESTINATION zone actually supports.
  //
  // The set of available managed-transform rules depends on the dest
  // zone's plan/entitlements. PATCHing a rule the dest doesn't expose
  // fails the WHOLE request with e.g. "rule 'add_true_client_ip_headers'
  // is not found in the phase http_request_late_transform_managed",
  // taking the valid rules down with it.
  //
  // Fix (Principle 1 + Principle 5): GET the dest catalog first, send
  // only the intersection, and surface source rules that were ENABLED
  // but aren't available on the dest as `acknowledged` (the user can't
  // do anything about a rule their plan doesn't offer). Disabled source
  // rules that are missing on dest are no-ops and dropped silently.
  if (exportData.managedHeaders) {
    const src = exportData.managedHeaders;
    let destCatalog: api.ManagedHeadersConfig | null = null;
    try {
      destCatalog = await api.getManagedHeaders(destAuth, destZoneId);
    } catch {
      destCatalog = null;
    }

    if (!destCatalog) {
      // Couldn't read the dest catalog — fall back to the prior behaviour
      // (attempt the full PATCH; entitlement errors land as acknowledged
      // via isAcknowledgeableSingletonError).
      await migrateSingleton(
        'Managed Headers',
        true,
        `PATCH /zones/${destZoneId}/managed_headers`,
        () => api.updateManagedHeaders(destAuth, destZoneId, src),
      );
    } else {
      const { keptRequest: keptReq, keptResponse: keptRes, dropped } =
        partitionManagedHeaders(src, destCatalog);

      logWithProgress(`⏳ Migrating Managed Headers...`);
      logWithProgress(`  PATCH /zones/${destZoneId}/managed_headers`);
      const section: ReportSection = {
        name: 'Managed Headers',
        total: keptReq.length + keptRes.length + dropped.length,
        success: 0, failed: 0, skipped: 0, acknowledged: 0, items: [],
      };
      // Only PATCH when there's at least one supported rule to apply.
      // If every source rule was dropped, the PATCH would be a no-op.
      if (keptReq.length + keptRes.length > 0) {
        try {
          await api.updateManagedHeaders(destAuth, destZoneId, {
            managed_request_headers: keptReq,
            managed_response_headers: keptRes,
          });
          onItemDone();
          section.success = keptReq.length + keptRes.length;
          for (const h of [...keptReq, ...keptRes]) {
            section.items.push({ name: h.id, status: 'success' });
          }
          logWithProgress(`  ✓ Managed Headers: ${section.success} applied, ${dropped.length} unavailable on dest`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          // The intersection PATCH still failed — classify rather than
          // hard-fail the whole section.
          if (isAcknowledgeableSingletonError(msg)) {
            section.acknowledged = (section.acknowledged || 0) + (keptReq.length + keptRes.length);
            for (const h of [...keptReq, ...keptRes]) {
              section.items.push({ name: h.id, status: 'acknowledged', error: msg });
            }
          } else {
            section.failed = keptReq.length + keptRes.length;
            for (const h of [...keptReq, ...keptRes]) {
              section.items.push({ name: h.id, status: 'failed', error: msg });
            }
            report.errors.push({ resource: 'Managed Headers', name: 'managed_headers', error: msg });
          }
          logWithProgress(`  🟡 Managed Headers PATCH did not apply cleanly: ${msg}`);
        }
      }

      // Enabled source rules the dest plan doesn't expose → acknowledged.
      for (const h of dropped) {
        section.acknowledged = (section.acknowledged || 0) + 1;
        section.items.push({
          name: h.id,
          status: 'acknowledged',
          error: `Managed transform "${h.id}" is not available on the destination zone's plan and was skipped.`,
        });
      }
      if (dropped.length > 0) {
        report.manualActions.push(
          `Managed Headers: ${dropped.length} managed transform${dropped.length !== 1 ? 's' : ''} ` +
          `(${dropped.map(h => h.id).join(', ')}) ${dropped.length !== 1 ? 'are' : 'is'} not available on the ` +
          `destination zone's plan and could not be enabled. Upgrade the destination plan if you need ${dropped.length !== 1 ? 'them' : 'it'}.`,
        );
      }
      trackSection(section);
      report.sections.push(section);
    }
  }

  // Cloud Connector — replace all rules
  if (Array.isArray(exportData.cloudConnectorRules) && exportData.cloudConnectorRules.length > 0) {
    await migrateSingleton(
      'Cloud Connector Rules',
      true,
      `PUT /zones/${destZoneId}/cloud_connector/rules (${exportData.cloudConnectorRules.length} rules)`,
      () => api.updateCloudConnectorRules(destAuth, destZoneId, exportData.cloudConnectorRules!),
    );
  }

  // URL Normalization
  if (exportData.urlNormalization) {
    await migrateSingleton(
      'URL Normalization',
      true,
      `PUT /zones/${destZoneId}/url_normalization`,
      () => api.updateUrlNormalization(destAuth, destZoneId, exportData.urlNormalization!),
    );
  }

  // Precursor — zone enforcement config. Only migrate when meaningfully
  // configured (a non-default mode or at least one rule); the GET always
  // returns a default `{ default_mode: 'off', enforcement_rules: [] }`, and
  // re-writing that default would be a noisy no-op row for every zone.
  if (
    exportData.precursor &&
    ((exportData.precursor.default_mode && exportData.precursor.default_mode !== 'off') ||
      (exportData.precursor.enforcement_rules?.length ?? 0) > 0)
  ) {
    await migrateSingleton(
      'Precursor',
      true,
      `PUT /zones/${destZoneId}/precursor`,
      () => api.updatePrecursor(destAuth, destZoneId, exportData.precursor!),
    );
  }

  // Cache Reserve — entitlement-gated, log+continue
  if (exportData.cacheReserve) {
    await migrateSingleton(
      'Cache Reserve',
      true,
      `PATCH /zones/${destZoneId}/cache/cache_reserve`,
      () => api.updateCacheReserve(destAuth, destZoneId, exportData.cacheReserve!.value),
    );
  }

  // Snippets — each is a separate multipart upload, then snippet_rules is a single PUT
  if (Array.isArray(exportData.snippets) && exportData.snippets.length > 0) {
    const snippetSection = await migrateItems(
      'Snippets',
      exportData.snippets,
      async (snippet) => {
        await api.createSnippet(destAuth, destZoneId, snippet.snippet_name, snippet.code);
      },
      (s) => s.snippet_name,
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      `PUT /zones/${destZoneId}/snippets/{name}`,
    );
    trackSection(snippetSection);
    report.sections.push(snippetSection);

    // Snippet rules in one PUT (skip if no rules)
    if (Array.isArray(exportData.snippetRules) && exportData.snippetRules.length > 0) {
      await migrateSingleton(
        'Snippet Rules',
        true,
        `PUT /zones/${destZoneId}/snippets/snippet_rules (${exportData.snippetRules.length} rules)`,
        () => api.updateSnippetRules(destAuth, destZoneId, exportData.snippetRules!),
      );
    }
  }

  // Healthchecks (standalone — not LB monitors)
  if (Array.isArray(exportData.healthchecks) && exportData.healthchecks.length > 0) {
    const hcSection = await migrateItems(
      'Healthchecks',
      exportData.healthchecks,
      async (hc) => {
        await api.createHealthcheck(destAuth, destZoneId, hc);
      },
      (hc) => hc.name,
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      `POST /zones/${destZoneId}/healthchecks`,
    );
    trackSection(hcSection);
    report.sections.push(hcSection);
  }

  // ── Batch 3c: 100% coverage migrations ────────────────────────────
  // DNS Settings (PATCH)
  if (exportData.dnsSettings) {
    await migrateSingleton('DNS Settings', true,
      `PATCH /zones/${destZoneId}/dns_settings`,
      () => api.updateDnsSettings(destAuth, destZoneId, exportData.dnsSettings as Record<string, unknown>));
  }

  // DNSSEC — flag only, surface as acknowledgment if active on source
  if (exportData.dnssecStatus?.status === 'active') {
    report.sections.push({
      name: 'DNSSEC',
      total: 1, success: 0, failed: 0, skipped: 0, acknowledged: 1,
      items: [{
        name: 'DNSSEC active on source',
        status: 'acknowledged',
        error: 'DS record at registrar is a manual external step — disable on source pre-migration, re-enable on dest post-migration.',
      }],
    });
    report.summary.acknowledged = (report.summary.acknowledged || 0) + 1;
  }

  // Regional Hostnames
  if (Array.isArray(exportData.regionalHostnames) && exportData.regionalHostnames.length > 0) {
    const sec = await migrateItems('Regional Hostnames', exportData.regionalHostnames,
      async (rh) => { await api.createRegionalHostname(destAuth, destZoneId, rh); },
      (rh) => rh.hostname,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/addressing/regional_hostnames`);
    trackSection(sec); report.sections.push(sec);
  }

  // Regional Tiered Cache (PATCH)
  if (exportData.regionalTieredCache) {
    await migrateSingleton('Regional Tiered Cache', true,
      `PATCH /zones/${destZoneId}/cache/regional_tiered_cache`,
      () => api.updateRegionalTieredCache(destAuth, destZoneId, exportData.regionalTieredCache!.value));
  }

  // Cache Variants (PATCH)
  if (exportData.cacheVariants) {
    await migrateSingleton('Cache Variants', true,
      `PATCH /zones/${destZoneId}/cache/variants`,
      () => api.updateCacheVariants(destAuth, destZoneId, exportData.cacheVariants!.value as api.CacheVariants));
  }

  // Origin Post-Quantum (PUT). Accept the bare value or the full GET result
  // object; skip when the source value is missing/invalid so a malformed
  // payload never lands as a surprise failed row (Principle 1).
  if (exportData.originPostQuantum) {
    const pqeValue = api.normalizeOriginPostQuantumValue(
      exportData.originPostQuantum.value ?? exportData.originPostQuantum);
    if (pqeValue) {
      await migrateSingleton('Origin Post-Quantum Encryption', true,
        `PUT /zones/${destZoneId}/cache/origin_post_quantum_encryption`,
        () => api.updateOriginPostQuantum(destAuth, destZoneId, pqeValue));
    }
  }

  // Custom Nameservers are enabled on the destination via the
  // `customNameserversMetadata` singleton PUT (see below), not a separate
  // PATCH-array call — `/zones/{id}/custom_ns` is a metadata endpoint, not a
  // list.

  // Fraud Detection Settings
  if (exportData.fraudDetectionSettings) {
    await migrateSingleton('Fraud Detection Settings', true,
      `PUT /zones/${destZoneId}/fraud_detection/settings`,
      () => api.updateFraudDetectionSettings(destAuth, destZoneId, exportData.fraudDetectionSettings as Record<string, unknown>));
  }

  // Firewall Access Rules (IP allow/block)
  if (Array.isArray(exportData.accessRules) && exportData.accessRules.length > 0) {
    const sec = await migrateItems('Firewall Access Rules', exportData.accessRules,
      async (rule) => { await api.createAccessRule(destAuth, destZoneId, rule as api.AccessRule); },
      (r) => `${r.configuration.target}:${r.configuration.value}`,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/firewall/access_rules/rules`);
    trackSection(sec); report.sections.push(sec);
  }

  // Firewall Lockdowns
  if (Array.isArray(exportData.firewallLockdowns) && exportData.firewallLockdowns.length > 0) {
    const sec = await migrateItems('Firewall Lockdowns', exportData.firewallLockdowns,
      async (lock) => { await api.createFirewallLockdown(destAuth, destZoneId, lock as api.FirewallLockdown); },
      (l) => l.description || (l.urls?.[0] || 'lockdown'),
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/firewall/lockdowns`);
    trackSection(sec); report.sections.push(sec);
  }

  // UA Rules
  if (Array.isArray(exportData.uaRules) && exportData.uaRules.length > 0) {
    const sec = await migrateItems('UA Rules', exportData.uaRules,
      async (rule) => { await api.createUaRule(destAuth, destZoneId, rule as api.UaRule); },
      (r) => r.description || r.configuration.value,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/firewall/ua_rules`);
    trackSection(sec); report.sections.push(sec);
  }

  // Page Shield settings + policies
  if (exportData.pageShieldSettings) {
    await migrateSingleton('Page Shield Settings', true,
      `PUT /zones/${destZoneId}/page_shield`,
      () => api.updatePageShieldSettings(destAuth, destZoneId, exportData.pageShieldSettings!));
  }
  if (Array.isArray(exportData.pageShieldPolicies) && exportData.pageShieldPolicies.length > 0) {
    const sec = await migrateItems('Page Shield Policies', exportData.pageShieldPolicies,
      async (policy) => { await api.createPageShieldPolicy(destAuth, destZoneId, policy); },
      (p) => p.description || p.expression,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/page_shield/policies`);
    trackSection(sec); report.sections.push(sec);
  }

  // Logpush jobs (Enterprise — re-uploaded with rewritten destination_conf)
  if (Array.isArray(exportData.logpushJobs) && exportData.logpushJobs.length > 0) {
    const sec = await migrateItems('Logpush Jobs', exportData.logpushJobs,
      async (job) => { await api.createLogpushJob(destAuth, destZoneId, job); },
      (j) => j.name || j.dataset || 'logpush-job',
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/logpush/jobs`);
    trackSection(sec); report.sections.push(sec);
  }

  // Schema Validation (new API)
  if (Array.isArray(exportData.schemaValidationSchemas) && exportData.schemaValidationSchemas.length > 0) {
    const sec = await migrateItems('Schema Validation Schemas', exportData.schemaValidationSchemas,
      async (schema) => { await api.createSchemaValidationSchema(destAuth, destZoneId, schema); },
      (s) => s.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/schema_validation/schemas`);
    trackSection(sec); report.sections.push(sec);
  }
  if (exportData.schemaValidationSettings) {
    await migrateSingleton('Schema Validation Settings', true,
      `PUT /zones/${destZoneId}/schema_validation/settings`,
      () => api.updateSchemaValidationSettings(destAuth, destZoneId, exportData.schemaValidationSettings as api.SchemaValidationSettings));
  }

  // Token Validation
  if (Array.isArray(exportData.tokenValidationConfigs) && exportData.tokenValidationConfigs.length > 0) {
    const sec = await migrateItems('Token Validation Configs', exportData.tokenValidationConfigs,
      async (cfg) => { await api.createTokenValidationConfig(destAuth, destZoneId, cfg); },
      (c) => c.name || c.id || 'token-config',
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/token_validation/config`);
    trackSection(sec); report.sections.push(sec);
  }
  if (Array.isArray(exportData.tokenValidationRules) && exportData.tokenValidationRules.length > 0) {
    const sec = await migrateItems('Token Validation Rules', exportData.tokenValidationRules,
      async (rule) => { await api.createTokenValidationRule(destAuth, destZoneId, rule); },
      (r) => r.description || r.expression,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/token_validation/rules`);
    trackSection(sec); report.sections.push(sec);
  }

  // SSL Certificate Packs (advanced ACM)
  //
  // Dedupe before migrating: source zones routinely accumulate multiple
  // certificate_packs for the same {hosts, type, certificate_authority}
  // tuple — these are legitimate on the source (CF keeps the historical
  // entries pinned to specific certificates) but POSTing N identical packs
  // to the dest yields N-1 "transient" errors from the cert backend that
  // look like a service outage. The right behaviour is to migrate one of
  // each tuple and mark the rest as skipped (deduplicated). Empirical:
  // run-2026-05-14 ran 13 POSTs for the same hostname pair and 12 of them
  // failed with "Cloudflare's certificate service was temporarily
  // unavailable" — the dest had already accepted the first POST and the
  // duplicates hit a quota guard that returns a misleading message.
  if (Array.isArray(exportData.certificatePacks) && exportData.certificatePacks.length > 0) {
    const { unique: uniquePacks, duplicates: duplicatePacks } =
      dedupeCertificatePacks(exportData.certificatePacks);
    const sec = await migrateItems('Certificate Packs', uniquePacks,
      async (pack) => { await api.createCertificatePack(destAuth, destZoneId, pack as Partial<api.CertificatePack>); },
      (p) => (p.hosts || []).join(',') || p.id || 'cert-pack',
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/ssl/certificate_packs`);
    if (duplicatePacks.length > 0) {
      const dupName = `Certificate Packs (duplicates)`;
      logWithProgress(`  ↪ Skipped ${duplicatePacks.length} duplicate certificate pack(s) — same {hosts, type, CA} already in batch`);
      sec.items.push(...duplicatePacks.map(p => ({
        name: (p.hosts || []).join(',') || p.id || 'cert-pack',
        status: 'skipped' as const,
        error: 'Duplicate certificate pack on source (same hosts + type + CA as another pack already migrated). Re-creating duplicates is not supported by the destination certificate API.',
      })));
      sec.total += duplicatePacks.length;
      sec.skipped += duplicatePacks.length;
      // Logged as deduped, not as a separate section, to keep the report
      // concise. The skipped count is reflected in the section summary.
      void dupName;
    }
    trackSection(sec); report.sections.push(sec);
  }

  // ACM Total TLS
  if (exportData.acmTotalTls) {
    await migrateSingleton('ACM Total TLS', true,
      `POST /zones/${destZoneId}/acm/total_tls`,
      () => api.updateAcmTotalTls(destAuth, destZoneId, exportData.acmTotalTls!));
  }

  // API Gateway operations + schemas (legacy API)
  if (Array.isArray(exportData.apiGatewayOperations) && exportData.apiGatewayOperations.length > 0) {
    await migrateSingleton('API Gateway Operations', true,
      `POST /zones/${destZoneId}/api_gateway/operations (${exportData.apiGatewayOperations.length} ops)`,
      () => api.createApiGatewayOperation(destAuth, destZoneId, exportData.apiGatewayOperations!));
  }
  if (Array.isArray(exportData.apiGatewaySchemas) && exportData.apiGatewaySchemas.length > 0) {
    const sec = await migrateItems('API Gateway Schemas', exportData.apiGatewaySchemas,
      async (schema) => { await api.createApiGatewaySchema(destAuth, destZoneId, schema as api.ApiGatewaySchema); },
      (s) => s.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/api_gateway/user_schemas`);
    trackSection(sec); report.sections.push(sec);
  }

  // API Shield zone-wide configuration (auth_id_characteristics singleton)
  if (exportData.apiGatewayConfiguration?.auth_id_characteristics &&
      exportData.apiGatewayConfiguration.auth_id_characteristics.length > 0) {
    await migrateSingleton('API Shield Configuration', true,
      `PUT /zones/${destZoneId}/api_gateway/configuration`,
      () => api.updateApiGatewayConfiguration(destAuth, destZoneId, exportData.apiGatewayConfiguration!));
  }

  // API Shield user labels (user-defined operation tags; attach by name)
  if (Array.isArray(exportData.apiGatewayUserLabels) && exportData.apiGatewayUserLabels.length > 0) {
    const sec = await migrateItems('API Shield User Labels', exportData.apiGatewayUserLabels,
      async (label) => { await api.createApiGatewayUserLabel(destAuth, destZoneId, label); },
      (l) => l.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/api_gateway/labels/user`);
    trackSection(sec); report.sections.push(sec);
  }

  // Per-operation schema-validation overrides. Operations were just
  // re-created on the dest via the bulk POST above; re-list them to
  // build a (method|host|endpoint) → dest operation_id map, then
  // bulk-PATCH the mitigation actions. The operation triple is stable
  // across accounts so no fragile ordering dependency.
  if (Array.isArray(exportData.apiGatewayOperationSchemaValidation) &&
      exportData.apiGatewayOperationSchemaValidation.length > 0) {
    // Per No Surprise Failures (Principle 1), this security-relevant setting
    // must ALWAYS produce a report section. Each source override ends as
    // exactly one of: success (applied), acknowledged (no matching dest
    // operation, or the dest can't be queried), or failed (the PATCH itself
    // errored). It must never just vanish into a log line.
    const svList = exportData.apiGatewayOperationSchemaValidation;
    const secName = 'API Shield Operation Schema Validation';
    const opKey = (o: { method: string; host: string; endpoint: string }) => `${o.method}|${o.host}|${o.endpoint}`;
    const svLabel = (sv: { method: string; host: string; endpoint: string }) => `${sv.method} ${sv.host}${sv.endpoint}`;
    const section: ReportSection = { name: secName, total: svList.length, success: 0, failed: 0, skipped: 0, items: [] };
    logWithProgress(`⏳ Migrating ${secName}...`);

    let destOpIdByKey: Map<string, string> | null = null;
    let listError = '';
    try {
      const destOps = await api.listApiGatewayOperations(destAuth, destZoneId);
      destOpIdByKey = new Map<string, string>();
      for (const o of destOps) {
        if (o.operation_id) destOpIdByKey.set(opKey(o), o.operation_id);
      }
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
    }

    if (destOpIdByKey) {
      const byOperationId: Record<string, { mitigation_action?: string | null }> = {};
      const matchedSv: typeof svList = [];
      const unmatchedSv: typeof svList = [];
      for (const sv of svList) {
        const destId = destOpIdByKey.get(opKey(sv));
        if (destId) { byOperationId[destId] = { mitigation_action: sv.mitigation_action }; matchedSv.push(sv); }
        else unmatchedSv.push(sv);
      }

      let patchError = '';
      if (matchedSv.length > 0) {
        logWithProgress(`  PATCH /zones/${destZoneId}/api_gateway/operations/schema_validation (${matchedSv.length} ops)`);
        try {
          await api.bulkSetApiGatewayOperationSchemaValidation(destAuth, destZoneId, byOperationId);
        } catch (e) {
          patchError = e instanceof Error ? e.message : String(e);
        }
      }

      for (const sv of matchedSv) {
        onItemDone();
        if (patchError) {
          section.failed++;
          section.items.push({ name: svLabel(sv), status: 'failed', error: patchError });
          report.errors.push({ resource: secName, name: svLabel(sv), error: patchError });
        } else {
          section.success++;
          section.items.push({ name: svLabel(sv), status: 'success' });
        }
      }
      for (const sv of unmatchedSv) {
        onItemDone();
        section.acknowledged = (section.acknowledged || 0) + 1;
        section.items.push({
          name: svLabel(sv), status: 'acknowledged',
          error: 'No matching operation on the destination (the operation was not re-created, or differs by method|host|endpoint); schema-validation override skipped. Re-create the operation, then re-apply the override.',
        });
      }
    } else {
      // Couldn't even list dest operations (commonly API Shield not entitled
      // on the destination). Acknowledge every override with the real reason
      // rather than dropping them or hard-failing the section.
      for (const sv of svList) {
        onItemDone();
        section.acknowledged = (section.acknowledged || 0) + 1;
        section.items.push({
          name: svLabel(sv), status: 'acknowledged',
          error: `Could not list destination API Shield operations to map this override (${listError}). Verify API Shield is enabled on the destination, then re-apply.`,
        });
      }
    }
    trackSection(section); report.sections.push(section);
  }

  // Waiting Room Events (per-room sub-resource — need to map source roomName→dest roomId)
  if (Array.isArray(exportData.waitingRoomEvents) && exportData.waitingRoomEvents.length > 0) {
    // List dest waiting rooms once to map name→id
    let destRoomMap = new Map<string, string>();
    try {
      const destRooms = await api.listWaitingRooms(destAuth, destZoneId);
      destRoomMap = new Map(destRooms.map(r => [r.name, r.id!]));
    } catch {/* skip */}

    const flatEvents = exportData.waitingRoomEvents.flatMap(per => per.events.map(e => ({ ...e, _roomName: per.roomName })));
    if (flatEvents.length > 0) {
      const sec = await migrateItems('Waiting Room Events', flatEvents,
        async (event) => {
          const roomId = destRoomMap.get(event._roomName);
          if (!roomId) throw new Error(`Destination waiting room "${event._roomName}" not found`);
          const { _roomName: _omit, ...evBody } = event;
          await api.createWaitingRoomEvent(destAuth, destZoneId, roomId, evBody as api.WaitingRoomEvent);
        },
        (e) => `${e._roomName}/${e.name}`,
        report.errors, logWithProgress, report, onItemDone,
        `POST /zones/${destZoneId}/waiting_rooms/{room_id}/events`);
      trackSection(sec); report.sections.push(sec);
    }
  }

  // Certificate Authority hostname associations (Authenticated Origin Pulls)
  //
  // AOP associations reference a `mtls_certificate_id` that lives at
  // /accounts/{id}/mtls_certificates. The cert bundle includes a private
  // key that is not exportable.
  //
  // When the user supplies cert + private_key via the Step 2 inline
  // fix-it form, we upload
  // each bundle to /accounts/{id}/mtls_certificates and use the
  // returned cert ID for the hostname-association PUT. When no
  // bundles are supplied, fall back to the acknowledgment-only path
  // (previous behaviour).
  //
  // Spike quirk to handle: the upload endpoint can return a HTTP
  // 400 with `code 1400 "Unable to decode the JSON request body"`
  // while the upload actually succeeded server-side. After a POST
  // failure we list-by-name to verify whether the cert is in fact
  // present, before reporting as failed.
  if (exportData.hostnameAssociations && (exportData.hostnameAssociations.hostnames?.length || 0) > 0) {
    const sourceCertId = exportData.hostnameAssociations.mtls_certificate_id;
    let destCertId: string | undefined;

    if (aopMtlsBundles && aopMtlsBundles.length > 0 && destAccountId) {
      // User supplied at least one bundle — upload each and pick
      // the first successful upload as the cert to associate.
      // Multiple bundles aren't typical for a single zone's AOP
      // setup, but we upload them all so the dest account has the
      // same options the source did.
      type BundleItem = { name: string; status: 'success' | 'failed'; error?: string; certId?: string };
      const bundleItems: BundleItem[] = [];
      let bundleSuccessCount = 0;
      let bundleFailedCount = 0;

      for (const bundle of aopMtlsBundles) {
        try {
          const created = await api.uploadMtlsCertificate(destAuth, destAccountId, {
            name: bundle.name,
            certificates: bundle.certificates,
            private_key: bundle.private_key,
            ca: bundle.ca,
          });
          const newId = created.id;
          if (newId) {
            bundleItems.push({ name: bundle.name, status: 'success', certId: newId });
            bundleSuccessCount++;
            if (!destCertId) destCertId = newId;
          } else {
            bundleItems.push({ name: bundle.name, status: 'failed', error: 'Upload returned no cert ID' });
            bundleFailedCount++;
          }
        } catch (err) {
          const msg = (err as Error).message || String(err);
          // Spike quirk: the API may return a JSON decode error
          // (code 1400) while the cert was actually created. Verify
          // by listing certs and matching by name.
          let recovered = false;
          try {
            const certs = await api.listMtlsCertificates(destAuth, destAccountId);
            const match = certs.find(c => c.name === bundle.name);
            if (match && match.id) {
              bundleItems.push({
                name: bundle.name,
                status: 'success',
                certId: match.id,
                // Document the recovery in the success item so the
                // user knows the upload succeeded despite the
                // misleading error.
                error: `(server returned a JSON-decode error but the upload succeeded; recovered via list-by-name)`,
              });
              bundleSuccessCount++;
              if (!destCertId) destCertId = match.id;
              recovered = true;
            }
          } catch {
            // List failed too — treat the original error as
            // authoritative.
          }
          if (!recovered) {
            bundleItems.push({ name: bundle.name, status: 'failed', error: msg });
            bundleFailedCount++;
            report.errors.push({
              resource: 'aop_mtls_certificate',
              name: bundle.name,
              error: msg,
              suggestion: 'Verify the cert + key are valid PEM, and that the key matches the cert. For a self-signed CA, set `ca: true` and ensure the cert has the required basicConstraints + keyUsage extensions.',
            });
          }
        }
        onItemDone();
      }

      report.sections.push({
        name: 'AOP mTLS Certificate Bundles',
        total: aopMtlsBundles.length,
        success: bundleSuccessCount,
        failed: bundleFailedCount,
        skipped: 0,
        items: bundleItems.map(b => ({ name: b.name, status: b.status, error: b.error })),
      });
      report.summary.total += aopMtlsBundles.length;
    } else if (sourceCertId) {
      // No user-supplied bundles — fall back to acknowledgment.
      report.sections.push({
        name: 'AOP mTLS Certificate Bundle',
        total: 1,
        success: 0, failed: 0, skipped: 0,
        acknowledged: 1,
        items: [{
          name: `mtls_certificate_id ${sourceCertId}`,
          status: 'acknowledged',
          error: 'AOP mTLS bundle private keys are not exportable. Supply cert + private key via the Step 2 fix-it form, OR re-upload manually at Dashboard → SSL/TLS → Origin Server → Authenticated Origin Pulls and recreate the hostname associations.',
        }],
      });
      report.summary.total += 1;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + 1;
      report.manualActions.push(
        `Re-upload AOP mTLS certificate ${sourceCertId} (with private key) on the destination account before AOP will protect the listed hostnames.`,
      );
    }

    // PUT the hostname associations. If we successfully uploaded a
    // bundle, use the new dest cert ID; otherwise use the source
    // ID (which will fail unless the user pre-uploaded the cert
    // with the same ID — rare but the old behaviour).
    const assocBody: api.HostnameAssociation = {
      mtls_certificate_id: destCertId || sourceCertId,
      hostnames: exportData.hostnameAssociations.hostnames,
    };
    await migrateSingleton('Hostname Associations (mTLS)', true,
      `PUT /zones/${destZoneId}/certificate_authorities/hostname_associations`,
      () => api.updateHostnameAssociations(destAuth, destZoneId, assocBody));
  }

  // Origin TLS Client Auth (settings + hostname-level)
  if (exportData.originTlsSettings?.enabled !== undefined) {
    await migrateSingleton('Origin TLS Client Auth Settings', true,
      `PUT /zones/${destZoneId}/origin_tls_client_auth/settings`,
      () => api.updateOriginTlsSettings(destAuth, destZoneId, { enabled: exportData.originTlsSettings!.enabled! }));
  }

  // Per-hostname origin TLS client auth (cert assignments). Source
  // cert_id values reference per-hostname certs that may have been
  // re-uploaded on dest via aopMtlsBundles; without a remap table
  // for those, we PUT the source cert_id values through and let the
  // dest API fail per-entry if the cert isn't present. This is
  // intentional: the hostname/enabled bits are what matter for
  // traffic; cert IDs will be corrected when the user supplies AOP
  // mTLS bundles in Step 3.
  if (Array.isArray(exportData.originTlsHostnames) && exportData.originTlsHostnames.length > 0) {
    const configs = exportData.originTlsHostnames.map(h => ({
      hostname: h.hostname,
      cert_id: h.cert_id,
      enabled: h.enabled,
    })).filter(c => c.hostname);
    if (configs.length > 0) {
      await migrateSingleton('Origin TLS Hostnames (per-hostname)', true,
        `PUT /zones/${destZoneId}/origin_tls_client_auth/hostnames`,
        () => api.updateOriginTlsHostnames(destAuth, destZoneId, configs));
    }
  }

  // Client Certificates (public cert only — log as acknowledged for the privkey part)
  if (Array.isArray(exportData.clientCertificates) && exportData.clientCertificates.length > 0) {
    report.sections.push({
      name: 'Client Certificates (mTLS)',
      total: exportData.clientCertificates.length,
      success: 0, failed: 0, skipped: 0,
      acknowledged: exportData.clientCertificates.length,
      items: exportData.clientCertificates.map((_, i) => ({
        name: `Client Certificate ${i + 1}`,
        status: 'acknowledged',
        error: 'Public cert exported; private keys cannot be read via API — re-upload via API Shield > Client Certificates if needed.',
      })),
    });
    report.summary.acknowledged = (report.summary.acknowledged || 0) + exportData.clientCertificates.length;
  }

  // ── Newer zone-level features (AGENTS.md Principle 7) ────────────────
  // Each of these would change destination behaviour if missing, and the
  // API supports moving them. All implemented as singletons.

  // Custom Hostnames Fallback Origin (SaaS feature)
  if (exportData.customHostnameFallbackOrigin?.origin) {
    await migrateSingleton('Custom Hostname Fallback Origin', true,
      `PUT /zones/${destZoneId}/custom_hostnames/fallback_origin`,
      () => api.updateCustomHostnameFallbackOrigin(destAuth, destZoneId, exportData.customHostnameFallbackOrigin!));
  }

  // AI Security settings (App Sec Advanced bundle on Enterprise)
  if (exportData.aiSecuritySettings && Object.keys(exportData.aiSecuritySettings).length > 0) {
    await migrateSingleton('AI Security Settings', true,
      `PUT /zones/${destZoneId}/ai-security/settings`,
      () => api.updateAiSecuritySettings(destAuth, destZoneId, exportData.aiSecuritySettings!));
  }
  if (exportData.aiSecurityCustomTopics && Object.keys(exportData.aiSecurityCustomTopics).length > 0) {
    await migrateSingleton('AI Security Custom Topics', true,
      `PUT /zones/${destZoneId}/ai-security/custom-topics`,
      () => api.updateAiSecurityCustomTopics(destAuth, destZoneId, exportData.aiSecurityCustomTopics!));
  }

  // Waiting Room zone-level settings — singleton complementing per-room
  // config that migrates via `waitingRooms`.
  if (exportData.waitingRoomSettings && Object.keys(exportData.waitingRoomSettings).length > 0) {
    await migrateSingleton('Waiting Room Settings', true,
      `PUT /zones/${destZoneId}/waiting_rooms/settings`,
      () => api.updateWaitingRoomSettings(destAuth, destZoneId, exportData.waitingRoomSettings!));
  }

  // WAF Content Upload Scan settings (App Sec Advanced bundle).
  // Entitlement gating is surfaced as an acknowledgment via the
  // capability probe (Principle 2); the migration itself is a PUT.
  if (exportData.contentUploadScanSettings && Object.keys(exportData.contentUploadScanSettings).length > 0) {
    await migrateSingleton('Content Upload Scan Settings', true,
      `PUT /zones/${destZoneId}/content-upload-scan/settings`,
      () => api.updateContentUploadScanSettings(destAuth, destZoneId, exportData.contentUploadScanSettings!));
  }

  // Certificate Transparency (CT) Monitoring alerting subscription
  // (SSL/TLS → Edge Certificates → Certificate Transparency Monitoring).
  // PATCH /zones/{}/ct/alerting with { enabled, emails? }. `emails` only
  // applies to Business/Enterprise zones; a plan-gated rejection on the dest
  // is classified as acknowledged (Principle 2), never a surprise failure.
  if (exportData.ctAlerting) {
    await migrateSingleton('CT Alerting Subscription', true,
      `PATCH /zones/${destZoneId}/ct/alerting`,
      () => api.updateCtAlerting(destAuth, destZoneId, exportData.ctAlerting!));
  }

  // Automatic Origin TLS Key Exchange (SSL/TLS → Origin Server). Dedicated
  // Origin-TLS singleton with a { enabled } body. A plan-gated/entitlement
  // rejection on the dest is acknowledged (Principle 2), never a failed row.
  if (exportData.autoOriginTlsKex && typeof exportData.autoOriginTlsKex.enabled === 'boolean') {
    await migrateSingleton('Auto Origin TLS Key Exchange', true,
      `PATCH /zones/${destZoneId}/settings/auto_origin_tls_kex`,
      () => api.updateAutoOriginTlsKex(destAuth, destZoneId, exportData.autoOriginTlsKex!.enabled));
  }

  // Google Tag Gateway — server-side gtag/GTM loading config (zone singleton).
  if (exportData.googleTagGateway && Object.keys(exportData.googleTagGateway).length > 0) {
    await migrateSingleton('Google Tag Gateway', true,
      `PUT /zones/${destZoneId}/settings/google-tag-gateway/config`,
      () => api.updateGoogleTagGatewayConfig(destAuth, destZoneId, exportData.googleTagGateway!));
  }

  // Smart Shield (Enterprise) — protection settings singleton + health checks.
  // Settings is a PATCH; the dest derives its own healthcheck IDs from the
  // POSTed bodies (server-managed fields are stripped by the API client).
  if (exportData.smartShield && Object.keys(exportData.smartShield).length > 0) {
    await migrateSingleton('Smart Shield Settings', true,
      `PATCH /zones/${destZoneId}/smart_shield`,
      () => api.updateSmartShield(destAuth, destZoneId, exportData.smartShield!));
  }
  if (Array.isArray(exportData.smartShieldHealthchecks) && exportData.smartShieldHealthchecks.length > 0) {
    const sec = await migrateItems('Smart Shield Health Checks', exportData.smartShieldHealthchecks,
      async (hc) => { await api.createSmartShieldHealthcheck(destAuth, destZoneId, hc); },
      (hc) => String(hc.name || hc.id || hc.address || 'healthcheck'),
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/smart_shield/healthchecks`);
    trackSection(sec); report.sections.push(sec);
  }

  // Cache Origin Cloud Regions — list of IP-to-cloud-region mappings
  // routing Tiered Cache through the upper-tier colo co-located with
  // the origin's cloud provider. Migrated as a single batch PATCH
  // (idempotent upsert, up to 100 per call; chunked by the API client
  // for zones with more). Requires Tiered Cache to be enabled on the
  // destination zone — the API returns a clear error if not, which the
  // migrateSingleton wrapper surfaces normally.
  if (Array.isArray(exportData.cacheOriginCloudRegions) && exportData.cacheOriginCloudRegions.length > 0) {
    await migrateSingleton('Cache Origin Cloud Regions', true,
      `PATCH /zones/${destZoneId}/cache/origin_cloud_regions/batch`,
      () => api.batchUpdateCacheOriginCloudRegions(destAuth, destZoneId, exportData.cacheOriginCloudRegions!));
  }

  // Leaked Credential Checks — has two migrate-able pieces. (1) The
  // zone-wide on/off toggle (POST /leaked-credential-checks): copy the
  // source's `enabled` value to the dest so detections aren't silently
  // disabled. (2) User-defined custom detection patterns (POST per item
  // /detections): re-create each on the dest. The default detections
  // shipped with the WAF managed ruleset are auto-managed and covered
  // by the `leaked_credential_detection` IMPOSSIBLE entry; only the
  // user-supplied customs migrate here.
  if (exportData.leakedCredentialChecksStatus && typeof exportData.leakedCredentialChecksStatus.enabled === 'boolean') {
    await migrateSingleton('Leaked Credential Checks Status', true,
      `POST /zones/${destZoneId}/leaked-credential-checks`,
      () => api.setLeakedCredentialChecksStatus(destAuth, destZoneId, exportData.leakedCredentialChecksStatus!));
  }
  if (Array.isArray(exportData.leakedCredentialCustomDetections) && exportData.leakedCredentialCustomDetections.length > 0) {
    const sec = await migrateItems('Leaked Credential Custom Detections', exportData.leakedCredentialCustomDetections,
      async (detection) => { await api.createLeakedCredentialCustomDetection(destAuth, destZoneId, detection); },
      (d) => d.id || `${d.username || ''}:${d.password || ''}`,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/leaked-credential-checks/detections`);
    trackSection(sec); report.sections.push(sec);
  }

  // Email Sending Subdomains — outbound transactional sending domains
  // (e.g. mail.example.com). Each one is created by POST with just the
  // `name`; CF auto-provisions DKIM selector and return-path domain.
  // Distinct from Email Routing rules (inbound forwarding) which migrate
  // separately under email-and-waiting-rooms.ts.
  if (Array.isArray(exportData.emailSendingSubdomains) && exportData.emailSendingSubdomains.length > 0) {
    const sec = await migrateItems('Email Sending Subdomains', exportData.emailSendingSubdomains,
      async (sub) => { await api.createEmailSendingSubdomain(destAuth, destZoneId, sub); },
      (s) => s.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/email/sending/subdomains`);
    trackSection(sec); report.sections.push(sec);
  }

  // Web3 Gateway Hostnames — IPFS / IPFS Universal Path / Ethereum
  // gateways exposed via a CNAME on the zone. Removed from
  // IMPOSSIBLE_TO_MIGRATE in the 2026-05-26 audit (the old "slugs are
  // unique per-account" reason was incorrect — the API is fully
  // zone-scoped and POSTs cleanly with {name, target, description?,
  // dnslink?}). The IPFS Universal Path content block-list, when
  // present, migrates via PUT after the parent hostname is created on
  // the dest (server assigns a new hostname id; we need it before the
  // content list PUT).
  if (Array.isArray(exportData.web3Hostnames) && exportData.web3Hostnames.length > 0) {
    // Track created hostnames so we can PUT their content lists after.
    const createdByName = new Map<string, string>(); // sourceName → destId
    const hostnameSec = await migrateItems('Web3 Hostnames', exportData.web3Hostnames,
      async (h) => {
        const created = await api.createWeb3Hostname(destAuth, destZoneId, h);
        if (created.id) createdByName.set(h.name, created.id);
      },
      (h) => h.name,
      report.errors, logWithProgress, report, onItemDone,
      `POST /zones/${destZoneId}/web3/hostnames`);
    trackSection(hostnameSec); report.sections.push(hostnameSec);

    // Phase 2: PUT each non-empty content list on the dest using the
    // newly-assigned dest hostname id. Only ipfs_universal_path
    // hostnames have content lists.
    const withLists = exportData.web3Hostnames.filter(h => h.contentList && h.contentList.entries.length > 0);
    if (withLists.length > 0) {
      const listSec = await migrateItems('Web3 IPFS Content Lists', withLists,
        async (h) => {
          const destId = createdByName.get(h.name);
          if (!destId) throw new Error(`Web3 hostname '${h.name}' not created on dest; cannot apply content list`);
          await api.updateWeb3ContentList(destAuth, destZoneId, destId, h.contentList!);
        },
        (h) => `${h.name} (${h.contentList!.entries.length} entries)`,
        report.errors, logWithProgress, report, onItemDone,
        `PUT /zones/${destZoneId}/web3/hostnames/{}/ipfs_universal_path/content_list`);
      trackSection(listSec); report.sections.push(listSec);
    }
  }

  // ── Secondary DNS (Enterprise) ───────────────────────────────────────
  // Removed from IMPOSSIBLE_TO_MIGRATE in the 2026-05-26 audit.
  // Account-scoped pieces (ACLs, peers, TSIGs) migrate first because the
  // zone-scoped incoming/outgoing configs reference peer IDs which
  // reference TSIG IDs. ID remapping is keyed by NAME (the user-supplied
  // identifier preserved across accounts):
  //   - TSIG secret bytes are write-only; only TSIGs with a matching
  //     entry in MigrationConfig.tsigSecrets get migrated. Peers
  //     referencing missing-secret TSIGs migrate WITHOUT tsig_id (the
  //     user pastes it post-migration via the dashboard).
  //   - Source ACLs / peers / TSIGs already on the dest account (same
  //     name) are reused — the API rejects duplicate names.
  const hasSecondaryDns =
    (Array.isArray(exportData.secondaryDnsAcls) && exportData.secondaryDnsAcls.length > 0) ||
    (Array.isArray(exportData.secondaryDnsPeers) && exportData.secondaryDnsPeers.length > 0) ||
    (Array.isArray(exportData.secondaryDnsTsigs) && exportData.secondaryDnsTsigs.length > 0) ||
    exportData.secondaryDnsIncoming ||
    exportData.secondaryDnsOutgoing;
  if (hasSecondaryDns) {
    if (!destAccountId) {
      logWithProgress('  ⚠ Secondary DNS: destAccountId not supplied — skipping account-scoped sub-resources.');
    } else {
      // ── ACLs (no deps) ───────────────────────────────────────────
      if (Array.isArray(exportData.secondaryDnsAcls) && exportData.secondaryDnsAcls.length > 0) {
        const sec = await migrateItems('Secondary DNS ACLs', exportData.secondaryDnsAcls,
          async (acl) => { await api.createSecondaryDnsAcl(destAuth, destAccountId, acl); },
          (a) => a.name,
          report.errors, logWithProgress, report, onItemDone,
          `POST /accounts/${destAccountId}/secondary_dns/acls`);
        trackSection(sec); report.sections.push(sec);
      }

      // ── TSIGs (require user-supplied secret bytes) ───────────────
      // Map source TSIG id → dest TSIG id by name. TSIGs without a
      // supplied secret are recorded as acknowledged in the report.
      const tsigIdMap = new Map<string, string>(); // source id → dest id
      const acknowledgedTsigNames = new Set<string>();
      if (Array.isArray(exportData.secondaryDnsTsigs) && exportData.secondaryDnsTsigs.length > 0) {
        const tsigsWithSecret = exportData.secondaryDnsTsigs.filter(t => tsigSecrets && tsigSecrets[t.name]);
        const tsigsWithoutSecret = exportData.secondaryDnsTsigs.filter(t => !tsigSecrets || !tsigSecrets[t.name]);
        if (tsigsWithSecret.length > 0) {
          const sec = await migrateItems('Secondary DNS TSIGs', tsigsWithSecret,
            async (tsig) => {
              const created = await api.createSecondaryDnsTsig(destAuth, destAccountId, {
                name: tsig.name, algo: tsig.algo, secret: tsigSecrets![tsig.name],
              });
              if (tsig.id && created.id) tsigIdMap.set(tsig.id, created.id);
            },
            (t) => t.name,
            report.errors, logWithProgress, report, onItemDone,
            `POST /accounts/${destAccountId}/secondary_dns/tsigs`);
          trackSection(sec); report.sections.push(sec);
        }
        for (const t of tsigsWithoutSecret) {
          acknowledgedTsigNames.add(t.name);
          logWithProgress(`  🟡 Secondary DNS TSIG '${t.name}': secret not supplied — acknowledged via secondary_dns_tsig_secrets.`);
        }
      }

      // ── Peers (reference TSIG IDs) ───────────────────────────────
      // Map source peer id → dest peer id by name. Peers referencing
      // an acknowledged TSIG migrate with tsig_id stripped.
      const peerIdMap = new Map<string, string>(); // source id → dest id
      // Lookup table: source TSIG id → source TSIG name (for the
      // "stripped because acknowledged" check).
      const sourceTsigNameById = new Map<string, string>();
      for (const t of exportData.secondaryDnsTsigs || []) {
        if (t.id) sourceTsigNameById.set(t.id, t.name);
      }
      if (Array.isArray(exportData.secondaryDnsPeers) && exportData.secondaryDnsPeers.length > 0) {
        const sec = await migrateItems('Secondary DNS Peers', exportData.secondaryDnsPeers,
          async (peer) => {
            const remapped: api.SecondaryDnsPeer = {
              name: peer.name, ip: peer.ip, port: peer.port, ixfr_enable: peer.ixfr_enable,
            };
            if (peer.tsig_id) {
              const destTsigId = tsigIdMap.get(peer.tsig_id);
              if (destTsigId) {
                remapped.tsig_id = destTsigId;
              } else {
                const sourceTsigName = sourceTsigNameById.get(peer.tsig_id);
                if (sourceTsigName && acknowledgedTsigNames.has(sourceTsigName)) {
                  // The peer authenticates its zone transfer with this TSIG,
                  // but its secret was not supplied (acknowledged above).
                  // Creating the peer WITHOUT tsig_id would silently downgrade
                  // an authenticated transfer to an unauthenticated one while
                  // reporting success — a security regression and a surprise
                  // failure. Acknowledge the peer instead (migrateItems turns
                  // the ACKNOWLEDGED: prefix into a 🟡 row, not a ❌), telling
                  // the user exactly how to land it.
                  throw new Error(
                    `ACKNOWLEDGED: Peer "${peer.name}" authenticates with TSIG "${sourceTsigName}", ` +
                    `whose secret was not supplied. Creating it without the key would silently downgrade ` +
                    `the zone transfer to unauthenticated, so it was skipped. Re-run with the TSIG secret ` +
                    `(secondary_dns_tsig_secrets["${sourceTsigName}"]) to migrate this peer with authentication.`,
                  );
                }
                // else: orphan reference (TSIG not present in the source
                // export at all) — nothing to authenticate against, so create
                // the peer without it.
              }
            }
            const created = await api.createSecondaryDnsPeer(destAuth, destAccountId, remapped);
            if (peer.id && created.id) peerIdMap.set(peer.id, created.id);
          },
          (p) => p.name,
          report.errors, logWithProgress, report, onItemDone,
          `POST /accounts/${destAccountId}/secondary_dns/peers`);
        trackSection(sec); report.sections.push(sec);
      }

      // ── Zone incoming / outgoing (reference peer IDs) ────────────
      //
      // These two singletons fail in ways the user cannot fix mid-
      // migration:
      //   • If no peers were migrated to the dest, the zone config has
      //     nothing to reference — it can't be created at all.
      //   • Secondary DNS is an Enterprise / account-tied feature that
      //     also requires the dest zone to be provisioned for it; an
      //     unentitled dest returns a bare `{success:false, errors:[]}`
      //     which surfaces as the generic "API request failed".
      // Per Principle 1/2 both cases land as `acknowledged` (with the
      // real reason preserved for transparency), never `failed`. A
      // genuinely unexpected error (specific message) still fails.
      const ackSecondaryDnsZoneConfig = async (
        name: string,
        endpoint: string,
        remappedPeers: string[],
        apiCall: () => Promise<unknown>,
      ): Promise<void> => {
        if (remappedPeers.length === 0) {
          logWithProgress(`  🟡 ${name} acknowledged: no peers were migrated to the destination, so the zone config cannot be created.`);
          const section: ReportSection = {
            name, total: 1, success: 0, failed: 0, skipped: 0, acknowledged: 1,
            items: [{ name, status: 'acknowledged', error: 'No Secondary DNS peers were migrated to the destination; the zone configuration cannot reference any peer.' }],
          };
          report.sections.push(section);
          onItemDone();
          return;
        }
        logWithProgress(`⏳ Migrating ${name}...`);
        logWithProgress(`  ${endpoint}`);
        try {
          await apiCall();
          onItemDone();
          logWithProgress(`  ✓ ${name} migrated`);
          const section: ReportSection = {
            name, total: 1, success: 1, failed: 0, skipped: 0,
            items: [{ name, status: 'success' }],
          };
          report.sections.push(section);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          // Acknowledge ONLY a real entitlement signal: a known entitlement
          // string, OR the bare empty-envelope response (tagged
          // EmptyEnvelopeError) that an unprovisioned Enterprise feature
          // returns. A 5xx/transient failure — including retry-exhaustion,
          // which also stringifies to "API request failed after retries" —
          // must stay `failed` so real outages surface (AGENTS.md Debugging
          // Integrity; never downgrade a status).
          //
          // We also EXCLUDE 401/403/429 from the entitlement gate (see
          // isEmptyEnvelopeEntitlementGap): an empty 401/403/429 is an
          // operational failure the user must fix, NOT an Enterprise-feature
          // gap — acknowledging it would hide a broken credential or throttling
          // behind a calm "Secondary DNS is gated" message. The genuine
          // unprovisioned-feature response is a 400.
          if (isAcknowledgeableSingletonError(msg) || isEmptyEnvelopeEntitlementGap(e)) {
            onItemDone();
            logWithProgress(`  🟡 ${name} acknowledged: ${msg}`);
            const section: ReportSection = {
              name, total: 1, success: 0, failed: 0, skipped: 0, acknowledged: 1,
              items: [{ name, status: 'acknowledged', error: `${msg} — Secondary DNS is an Enterprise feature and must be provisioned on the destination zone before this config can be created.` }],
            };
            report.sections.push(section);
            report.manualActions.push(
              `${name}: could not be created on the destination (Secondary DNS is Enterprise-gated and requires the dest zone to be configured for it). Re-create it manually after enabling Secondary DNS.`,
            );
          } else {
            onItemDone();
            logWithProgress(`  ❌ ${name} failed: ${msg}`);
            const section: ReportSection = {
              name, total: 1, success: 0, failed: 1, skipped: 0,
              items: [{ name, status: 'failed', error: msg }],
            };
            report.sections.push(section);
            report.errors.push({ resource: name, name, error: msg });
          }
        }
      };

      if (exportData.secondaryDnsIncoming) {
        const incoming = exportData.secondaryDnsIncoming;
        const remappedPeers = (incoming.peers || []).map(srcId => peerIdMap.get(srcId)).filter((x): x is string => Boolean(x));
        await ackSecondaryDnsZoneConfig('Secondary DNS Incoming',
          `POST /zones/${destZoneId}/secondary_dns/incoming`, remappedPeers,
          () => api.createSecondaryDnsIncoming(destAuth, destZoneId, {
            name: incoming.name,
            auto_refresh_seconds: incoming.auto_refresh_seconds,
            peers: remappedPeers,
          }));
      }

      if (exportData.secondaryDnsOutgoing) {
        const outgoing = exportData.secondaryDnsOutgoing;
        const remappedPeers = (outgoing.peers || []).map(srcId => peerIdMap.get(srcId)).filter((x): x is string => Boolean(x));
        await ackSecondaryDnsZoneConfig('Secondary DNS Outgoing',
          `POST /zones/${destZoneId}/secondary_dns/outgoing`, remappedPeers,
          () => api.createSecondaryDnsOutgoing(destAuth, destZoneId, {
            name: outgoing.name,
            peers: remappedPeers,
          }));
      }
    }
  }

  // ── 2026-05-26 Principle 7 audit follow-up — 21-gap closure ──────
  // Singletons + lists landed to close the remaining traffic-affecting
  // gaps. Each is best-effort: entitlement-gated features will
  // surface as failed in the report if the dest account lacks them,
  // which the user has already acknowledged via capability probe.

  // Custom Nameservers metadata (per-zone {enabled, ns_set} singleton)
  if (exportData.customNameserversMetadata?.enabled !== undefined ||
      exportData.customNameserversMetadata?.ns_set !== undefined) {
    await migrateSingleton('Custom Nameservers Metadata', true,
      `PUT /zones/${destZoneId}/custom_ns`,
      () => api.updateCustomNameserversMetadata(destAuth, destZoneId, exportData.customNameserversMetadata!));
  }

  // Pay-per-Crawl configuration (singleton)
  if (exportData.payPerCrawlConfiguration?.enabled !== undefined) {
    await migrateSingleton('Pay-per-Crawl Configuration', true,
      `POST /zones/${destZoneId}/pay-per-crawl/configuration`,
      () => api.createPayPerCrawlConfiguration(destAuth, destZoneId, exportData.payPerCrawlConfiguration!));
  }

  // Waiting Room per-room rules. After per-room migration succeeds, look
  // up dest room IDs by NAME and PUT the full rule list for each.
  if (Array.isArray(exportData.waitingRoomRules) && exportData.waitingRoomRules.length > 0) {
    // Look up dest rooms by name (TZ migrates rooms in earlier email-
    // and-waiting-rooms phase; their IDs differ from source).
    let destRooms: { id?: string; name?: string }[] = [];
    try { destRooms = await api.listWaitingRooms(destAuth, destZoneId); }
    catch { /* ignore — rules section will skip */ }
    const destRoomByName = new Map(destRooms.filter(r => r.id && r.name).map(r => [r.name!, r.id!]));
    for (const r of exportData.waitingRoomRules) {
      const destRoomId = destRoomByName.get(r.roomName);
      if (!destRoomId) {
        logWithProgress(`  ⚠ Waiting Room Rules for '${r.roomName}': room not found on dest — skipping ${r.rules.length} rule(s).`);
        continue;
      }
      await migrateSingleton(`Waiting Room Rules (${r.roomName})`, true,
        `PUT /zones/${destZoneId}/waiting_rooms/${destRoomId}/rules`,
        () => api.replaceWaitingRoomRules(destAuth, destZoneId, destRoomId, r.rules));
    }
  }

  // AI Gateway Custom Provider Costs (account-scoped list)
  if (destAccountId && Array.isArray(exportData.aiGatewayCustomProviderCosts) && exportData.aiGatewayCustomProviderCosts.length > 0) {
    const sec = await migrateItems('AI Gateway Custom Provider Costs', exportData.aiGatewayCustomProviderCosts,
      async (cost) => { await api.createAiGatewayCustomProviderCost(destAuth, destAccountId, cost); },
      (c) => c.name || `${c.provider || 'provider'}/${c.model || 'model'}`,
      report.errors, logWithProgress, report, onItemDone,
      `POST /accounts/${destAccountId}/ai-gateway/custom-providers/costs`);
    trackSection(sec); report.sections.push(sec);
  }

  // AI Gateway per-gateway provider configs (BYOK provider→secret
  // bindings). These CANNOT be re-created automatically across accounts:
  // the create API requires a write-only `secret` (the provider API key,
  // never readable from source) AND a `secret_id` that points at a
  // SOURCE-account Secrets Store secret which does not exist on the dest.
  // Attempting the POST always failed with "Required" (the old code also
  // sent the wrong field names entirely).
  //
  // Per Principle 1 (No Surprise Failures) + Principle 6 (cryptographic
  // material is impossible to migrate), surface each provider config as
  // `acknowledged` with a manual-action telling the user to re-create the
  // BYOK binding on the dest gateway with a freshly-stored key.
  if (destAccountId && Array.isArray(exportData.aiGatewayProviderConfigs) && exportData.aiGatewayProviderConfigs.length > 0) {
    for (const g of exportData.aiGatewayProviderConfigs) {
      if (!g.gatewayId || g.configs.length === 0) continue;
      const section: ReportSection = {
        name: `AI Gateway Provider Configs (${g.gatewayId})`,
        total: g.configs.length,
        success: 0, failed: 0, skipped: 0, acknowledged: g.configs.length,
        items: g.configs.map((c) => ({
          name: c.alias || c.provider_slug || c.id || 'provider-config',
          status: 'acknowledged' as const,
          error: 'BYOK provider config references a write-only secret that cannot be read from the source account; re-create it on the destination with a freshly-stored API key.',
        })),
      };
      for (const c of g.configs) onItemDone();
      trackSection(section); report.sections.push(section);
      report.manualActions.push(
        `AI Gateway Provider Config(s) on gateway "${g.gatewayId}": ` +
        `${g.configs.map(c => c.alias || c.provider_slug || c.id || 'provider-config').join(', ')}. ` +
        `Re-create the provider→key binding on the destination at Dashboard → AI → AI Gateway → "${g.gatewayId}" → Provider Configs, ` +
        `supplying the provider API key (it is write-only and could not be exported).`,
      );
    }
  }

  // Custom Certificates priority — runs LAST (after cert packs landed
  // on dest) so source cert IDs can be remapped. We don't have a
  // cert-ID map currently; the migrate code POSTs cert packs fresh and
  // dest assigns new IDs. For now, look up dest certs by `hosts` (the
  // SANs list, which is preserved) and rebuild the priority list.
  // Skip if source had no explicit prioritization.
  if (Array.isArray(exportData.certificatePacks) && exportData.certificatePacks.length > 1) {
    try {
      const destCerts = await api.listCertificatePacks(destAuth, destZoneId);
      // Build dest-cert-id map keyed by sorted hosts string
      const destIdByHosts = new Map<string, string>();
      for (const c of destCerts) {
        if (c.id && Array.isArray(c.hosts)) {
          const key = [...c.hosts].sort().join('|');
          destIdByHosts.set(key, c.id);
        }
      }
      // Build remapped priority list from source order
      const remapped: { id: string; priority: number }[] = [];
      for (let i = 0; i < exportData.certificatePacks.length; i++) {
        const sourceCert = exportData.certificatePacks[i];
        if (!Array.isArray(sourceCert.hosts)) continue;
        const key = [...sourceCert.hosts].sort().join('|');
        const destId = destIdByHosts.get(key);
        if (destId) remapped.push({ id: destId, priority: i + 1 });
      }
      if (remapped.length > 1) {
        await migrateSingleton('Custom Certificates Priority', true,
          `PUT /zones/${destZoneId}/custom_certificates/prioritize`,
          () => api.prioritizeCustomCertificates(destAuth, destZoneId, remapped));
      }
    } catch (e) {
      // listCertificatePacks may fail on free zones — skip silently.
      logWithProgress(`  ⏭ Custom Certificates Priority: ${(e as Error).message}`);
    }
  }
}
