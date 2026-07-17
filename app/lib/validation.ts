// Pre-migration validation warnings

import type { AccountCapabilities } from './api';
import type {
  ZoneExport, CFWorkerBinding, CFRuleset, CFRulesetRule, CFWorkerScript,
  CFDNSRecord, CFZoneSetting,
} from '../../src/types';
import { findInZoneDnsTargets } from '../../src/migrate/transforms';

export interface ValidationWarning {
  // NOTE: the legacy 'warning' tier was removed - Step 2 renders these as
  // Errors / Licensing / Information only (see ScopeReview.tsx), and
  // generateValidationWarnings never emits 'warning'. The Step 1 yellow
  // "Warnings" card is a SEPARATE type (MigrationBlocker in src/api.ts),
  // not this one. Do not re-add 'warning' here without wiring a renderer.
  type: 'info' | 'error' | 'licensing';
  title: string;
  details: string;
  /** Optional grouping key - items with the same group are merged into one card */
  group?: string;
  /** Links to a capability key so the UI can show affected resource groups */
  capabilityKey?: string;
}

export function generateValidationWarnings(
  data: ZoneExport,
  capabilities?: AccountCapabilities | null,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // ── Per-worker checks ──────────────────────────────────────
  if (data.workers?.length > 0) {
    for (const worker of data.workers) {
      const wName = worker.id ?? (worker as { name?: string }).name ?? 'unknown';
      const wGroup = `worker:${wName}`;

      // Secrets - handled in Step 3 (secret input fields), no warning needed here

      const bindings = worker.bindings || [];
      const doBindings = bindings.filter((b: CFWorkerBinding) => b.type === 'durable_object_namespace');
      const r2Bindings = bindings.filter((b: CFWorkerBinding) => b.type === 'r2_bucket');
      const aeBindings = bindings.filter((b: CFWorkerBinding) => b.type === 'analytics_engine');

      // Durable Objects - namespaces are created; object state copies only
      // when the user configures DO migration (otherwise namespaces start
      // empty). Informational: surfaced so the user knows to configure it.
      if (doBindings.length > 0) {
        const names = doBindings.map((b: CFWorkerBinding) => b.name || b.class_name).filter(Boolean).join(', ');
        warnings.push({
          type: 'info', group: wGroup,
          title: `${doBindings.length} Durable Object binding(s)`,
          details: `DO namespaces are created on the destination. Object state is NOT copied unless you configure DO migration — otherwise the namespaces start empty. Bindings: ${names || 'unknown'}.`,
        });
      }

      // R2 - buckets created; data copied if S3 credentials provided
      if (r2Bindings.length > 0) {
        warnings.push({
          type: 'info', group: wGroup,
          title: `${r2Bindings.length} R2 binding(s)`,
          details: 'R2 buckets will be created. Provide S3 API credentials in the R2 Buckets section to also copy object data.',
        });
      }

      // Analytics Engine - licensing issue if unavailable, info if available
      if (aeBindings.length > 0) {
        const available = capabilities?.analyticsEngine?.available;
        if (available === false) {
          warnings.push({
            type: 'licensing', group: wGroup,
            title: `Analytics Engine (not available on destination)`,
            details: (capabilities?.analyticsEngine?.reason
              || 'Analytics Engine is not enabled on the destination account.')
              + ` ${capabilities?.analyticsEngine?.action || 'Enable it before migrating.'} Then use "Re-check" to verify.`,
          });
        } else {
          warnings.push({
            type: 'info', group: wGroup,
            title: `${aeBindings.length} Analytics Engine binding(s)`,
            details: 'Analytics Engine bindings will be re-created on the destination. Existing dataset data is not migrated.',
          });
        }
      }
    }
  }

  // ── Zone-level checks ──────────────────────────────────────

  // Custom cipher suites - requires ACM (licensing)
  const ciphersSetting = data.settings?.find((s: CFZoneSetting) => s.id === 'ciphers');
  if (ciphersSetting && Array.isArray(ciphersSetting.value) && ciphersSetting.value.length > 0) {
    warnings.push({
      type: 'licensing',
      title: 'Custom cipher suites require ACM',
      details: 'Custom cipher suites require Advanced Certificate Manager (ACM) on the destination zone. Ensure ACM is provisioned before migration or the setting will fail to apply.',
    });
  }

  // Custom certificates - handled in Step 3 (cert+key upload UI), no warning needed here

  // Large DNS record count - purely informational
  if (data.dnsRecords?.length > 200) {
    warnings.push({
      type: 'info',
      title: `${data.dnsRecords.length} DNS records to migrate`,
      details: 'Large record sets may take longer. Records are created in parallel for speed.',
    });
  }

  // In-zone self-referential DNS targets. The engine rewrites each record's NAME
  // onto the dest zone but passes CONTENT through verbatim — rewriting content
  // would corrupt external targets (MX→mail provider, CNAME→SaaS). Records that
  // point back INTO the source zone are the exception: after cutover their target
  // still names the OLD zone and must be repointed by hand. Surface them now so
  // the migrated zone's broken self-references aren't a post-cutover surprise.
  const zoneName = data.zone?.name || '';
  const selfRefs = findInZoneDnsTargets(data.dnsRecords, zoneName);
  if (selfRefs.length > 0) {
    const sample = selfRefs
      .slice(0, 10)
      .map(({ record, target }) => `${record.type} ${record.name} → ${target}`)
      .join('; ');
    const more = selfRefs.length > 10 ? ` (+${selfRefs.length - 10} more)` : '';
    warnings.push({
      type: 'info', group: 'dns-selfref',
      title: `${selfRefs.length} DNS record(s) point inside this zone`,
      details:
        `These records target a hostname within ${zoneName || 'the source zone'}. ` +
        `Their NAME is migrated to the destination zone, but their TARGET is copied as-is ` +
        `(intentionally — targets are never rewritten, to avoid corrupting external ` +
        `destinations like mail servers or SaaS hosts). After you change nameservers, ` +
        `these targets still resolve against the OLD zone, so repoint each one to the ` +
        `destination zone post-cutover: ${sample}${more}.`,
    });
  }

  // Spectrum apps - licensing items in checkPlanFeatures / checkCapabilityMismatches cover this

  // Plan-gated features, configuration issues, capability mismatches
  checkPlanFeatures(data, warnings);
  checkConfigurationIssues(data, warnings);
  checkCapabilityMismatches(data, warnings, capabilities);

  return warnings;
}

// ── Plan / licensing requirements ────────────────────────────
function checkPlanFeatures(data: ZoneExport, warnings: ValidationWarning[]) {
  if (data.spectrumApps?.length > 0) {
    warnings.push({
      type: 'licensing', group: 'spectrum', title: 'Spectrum requires Enterprise plan',
      details: 'Ensure the destination account has an Enterprise plan for Spectrum apps.',
    });
  }
  if (data.customCertificates?.length > 0) {
    warnings.push({
      type: 'licensing', title: 'Custom certificates require Business+ plan',
      details: 'Ensure the destination zone plan supports custom SSL certificates.',
    });
  }
  if (data.loadBalancers?.length > 0) {
    warnings.push({
      type: 'licensing', group: 'loadbalancing', title: 'Load Balancing is an add-on',
      details: 'Ensure Load Balancing is enabled on the destination account ($5/mo minimum).',
    });
  }
}

// ── Configuration issues (user action needed) ────────────────
function checkConfigurationIssues(data: ZoneExport, warnings: ValidationWarning[]) {
  // Workers with cron triggers
  if (data.workers?.some((w: CFWorkerScript & { cronTriggers?: unknown[] }) => (w.cronTriggers?.length ?? 0) > 0)) {
    warnings.push({
      type: 'info', title: 'Workers with Cron Triggers',
      details: 'Cron triggers will be recreated. Verify schedules are correct after migration.',
    });
  }

  // Turnstile widgets - handled in Step 3 (widget display + sitekey warning), no warning needed here

  // Email routing — INFORMATIONAL only. Rule migration is automatic (user has
  // no agency → Principle 4: disclose, don't alarm). The one actionable part,
  // destination-address re-verification, is owned by the
  // `email_routing_destinations` acknowledgement (outOfScope.ts) + the Step 2
  // EmailAddressVerificationCard, so we do NOT repeat "verify addresses" here.
  if (data.emailRoutingRules?.length > 0) {
    const zoneName = data.zone?.name || 'unknown';
    warnings.push({
      type: 'info', title: `${data.emailRoutingRules.length} email routing rule(s) on ${zoneName}`,
      details: 'Email routing will be auto-enabled and forwarding rules recreated on the destination. Destination-address verification is handled separately below.',
    });
  }

  // Access apps. NOTE: identity providers ARE migrated (see
  // src/migrate/account-sub-resources.ts createIdentityProvider + e08 IdP
  // remapping); only OAuth client_secrets need re-supply, which is owned by
  // the identity_provider_secrets acknowledgment. So this is informational,
  // not a "won't migrate" warning.
  if (data.accessApps?.length > 0) {
    warnings.push({
      type: 'info', title: `${data.accessApps.length} Access application(s)`,
      details: 'Access apps and policies are recreated on the destination, with identity-provider references remapped to the migrated IdPs. OAuth client secrets are re-supplied separately (prompted as an acknowledgment).',
    });
  }

  // Origin rules with host overrides - may require enterprise account type
  const originRulesets = data.rulesets?.filter((rs: CFRuleset) =>
    rs.phase === 'http_request_origin' && rs.rules?.some((r: CFRulesetRule) =>
      (r.action_parameters as { origin?: { host?: string } } | undefined)?.origin?.host
    )
  ) ?? [];
  if (originRulesets.length > 0) {
    const ruleCount = originRulesets.reduce((sum: number, rs: CFRuleset) =>
      sum + (rs.rules?.filter((r: CFRulesetRule) => (r.action_parameters as { origin?: { host?: string } } | undefined)?.origin?.host).length || 0), 0);
    warnings.push({
      type: 'info', title: `${ruleCount} origin host override rule(s)`,
      details: 'Origin rules with host overrides may require an enterprise account type on the destination. If the destination account is a standard type, the migrate engine acknowledges these rules automatically (they will not apply) — no action needed.',
    });
  }
}

// ── Capability mismatches (licensing - dest account lacks feature) ──
function checkCapabilityMismatches(
  data: ZoneExport,
  warnings: ValidationWarning[],
  capabilities?: AccountCapabilities | null,
) {
  if (!capabilities) return;

  const capChecks: Array<{
    condition: boolean;
    cap: { available: boolean; reason?: string; action?: string } | undefined;
    label: string;
    capKey: string;
    group?: string;
    fallbackReason: string;
  }> = [
    {
      condition: (data.spectrumApps?.length ?? 0) > 0,
      cap: capabilities.spectrum,
      label: 'Spectrum',
      capKey: 'spectrum',
      group: 'spectrum',
      fallbackReason: 'Spectrum is not enabled on the destination account.',
    },
    {
      condition: (data.loadBalancers?.length ?? 0) > 0,
      cap: capabilities.loadBalancing,
      label: 'Load Balancing',
      capKey: 'loadBalancing',
      group: 'loadbalancing',
      fallbackReason: 'Load Balancing add-on is not enabled on the destination account.',
    },
    {
      condition: (data.workers?.length ?? 0) > 0,
      cap: capabilities.workers,
      label: 'Workers',
      capKey: 'workers',
      fallbackReason: 'Workers is not enabled on the destination account.',
    },
    // (R2 covered by combined check below - top-level buckets OR worker bindings)
    {
      condition: (data.accessApps?.length ?? 0) > 0,
      cap: capabilities.zeroTrust,
      label: 'Zero Trust',
      capKey: 'zeroTrust',
      fallbackReason: 'Zero Trust / Access is not configured on the destination account.',
    },
    {
      condition: (data.rateLimits?.length ?? 0) > 0 ||
        (data.rulesets?.some((rs: CFRuleset) => rs.phase === 'http_ratelimit' && rs.rules?.length > 0) ?? false),
      cap: capabilities.rateLimiting,
      label: 'Rate Limiting',
      capKey: 'rateLimiting',
      group: 'ratelimiting',
      fallbackReason: 'Rate Limiting is not enabled on the destination account.',
    },
    {
      condition: (data.queues?.length ?? 0) > 0 ||
        (data.workers?.some((w: CFWorkerScript) => w.bindings?.some((b: CFWorkerBinding) =>
          b.type === 'queue' || b.type === 'queue_producer' || b.type === 'queue_consumer',
        )) ?? false),
      cap: capabilities.queues,
      label: 'Queues',
      capKey: 'queues',
      group: 'queues',
      fallbackReason: 'Queues is not enabled on the destination account.',
    },
    {
      condition: (data.d1Databases?.length ?? 0) > 0 ||
        (data.workers?.some((w: CFWorkerScript) => w.bindings?.some((b: CFWorkerBinding) => b.type === 'd1' || b.type === 'd1_database')) ?? false),
      cap: capabilities.d1,
      label: 'D1',
      capKey: 'd1',
      group: 'd1',
      fallbackReason: 'D1 is not enabled on the destination account.',
    },
    {
      condition: (data.r2Buckets?.length ?? 0) > 0 ||
        (data.workers?.some((w: CFWorkerScript) => w.bindings?.some((b: CFWorkerBinding) => b.type === 'r2_bucket')) ?? false),
      cap: capabilities.r2,
      label: 'R2',
      capKey: 'r2',
      group: 'r2',
      fallbackReason: 'R2 is not enabled on the destination account.',
    },
  ];

  for (const check of capChecks) {
    if (check.condition && check.cap && !check.cap.available) {
      const reason = check.cap.reason || check.fallbackReason;
      const action = check.cap.action || 'Enable on the destination account.';
      warnings.push({
        type: 'licensing',
        capabilityKey: check.capKey,
        ...(check.group ? { group: check.group } : {}),
        title: `${check.label} not available on destination`,
        details: `${reason} ${action} Then use "Re-check" to verify.`,
      });
    }
  }
}

export function generateMigrationInfo(data: ZoneExport): ValidationWarning[] {
  const info: ValidationWarning[] = [];

  if (data.dnsRecords?.some((r: CFDNSRecord) => r.proxied)) {
    info.push({
      type: 'info', title: 'Proxied DNS records detected',
      details: 'Records with orange cloud will be proxied through Cloudflare after migration.',
    });
  }

  const sslSetting = data.settings?.find((s: CFZoneSetting) => s.id === 'ssl');
  if (sslSetting) {
    info.push({
      type: 'info', title: `SSL mode: ${sslSetting.value}`,
      details: 'SSL mode will be set to match the source zone.',
    });
  }

  return info;
}

export function estimateDowntime(dnsRecords: CFDNSRecord[]): string {
  if (!dnsRecords?.length) return 'N/A';
  const criticalRecords = dnsRecords.filter((r) => ['A', 'AAAA', 'CNAME', 'MX'].includes(r.type));
  const maxTTL = Math.max(...criticalRecords.map((r) => r.ttl || 300));
  if (maxTTL <= 300) return '< 5 minutes';
  if (maxTTL <= 3600) return '< 1 hour';
  if (maxTTL <= 86400) return '< 24 hours';
  return '24-48 hours';
}
