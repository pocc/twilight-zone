// Batch 1: DNS → Account-Custom-Rulesets → (Settings + Page Rules + Rulesets)
//
// This is the first migration batch executed by `migrateZone()` after the
// destination zone has been created and the source plan has been applied.
//
// Phase 1a — DNS records (sequential, via migrateItems)
//   Cloudflare's origin rulesets and waiting-rooms validate hostnames
//   against the zone's DNS records on POST/PUT, so DNS must land before
//   anything that can reference an origin host. We also rewrite each
//   record's name from `*.source-zone` → `*.dest-zone` and run an
//   overwrite path when the user has chosen `conflictStrategy === "overwrite"`.
//
// Pre-batch acknowledgments emitted between 1a and 1a.5:
//   - Cloudflare Tunnel origins (DNS records pointing at *.cfargotunnel.com)
//     are surfaced as acknowledged. The DNS record migrates but the tunnel
//     itself can't move between accounts; the user must recreate it.
//   - Custom Nameservers `ns_set` pool entries are acknowledged. The pool
//     lives at `/accounts/{id}/custom_ns` and isn't migrated by this tool;
//     the zone's CNS assignment (from the `customNameserversMetadata`
//     singleton) will fail until the dest account has an ns_set with the
//     same ID.
//
// Phase 1a.5 — Account-level custom rulesets (sequential)
//   When the source zone executes a custom account ruleset via an
//   `execute` action, that ruleset must exist on the dest account BEFORE
//   the zone-level Rulesets phase runs (otherwise the execute references
//   point at stale source-account IDs). We:
//     1. Deep-rewrite domain references and substitute the source account
//        ID with the destination account ID inside every rule's
//        `action_parameters` and `expression`.
//     2. Audit-scan for any remaining 32-hex IDs that look like Cloudflare
//        resource IDs (account/zone/worker IDs are all 32-hex) and warn so
//        the user can audit. These aren't auto-substituted — they could be
//        legitimate dest-account IDs already in place.
//     3. POST the rewritten ruleset to the dest account and record
//        `sourceId → destId` in `accountRulesetIdMap` for the zone rewrite
//        below.
//   Entitlement errors (phase not enabled on dest, requires Enterprise,
//   etc.) are surfaced as `acknowledged`, not `failed`, per the
//   "No Surprise Failures" principle.
//
//   We also replay account-level **phase entrypoint** execute rules: the
//   source account had `execute` rules in its root entrypoints pointing
//   at the custom rulesets above, and we add analogous entries to the
//   dest account's entrypoints. This is the CF-API-correct way to deploy
//   custom account rulesets — zone-level execute rules pointing at
//   custom-scope account rulesets are rejected by the API (error 20230
//   "not possible to execute a ruleset of scope account at scope zone").
//
//   Finally, any referenced account-ruleset ID we couldn't fetch from
//   source (read permission missing, deleted, etc.) is surfaced as an
//   acknowledgment so the user knows the dest zone rule will reference a
//   stale ID until they recreate the ruleset manually.
//
// Phase 1b — Settings + Page Rules + Rulesets (Promise.all)
//   Settings are applied **sequentially** in a dependency-aware order
//   (security_level → ssl → min_tls_version → tls_1_3 → 0rtt → privacy_pass,
//   with all other settings defaulting between them) because the CF API
//   rejects some PATCH combinations when set in the wrong order. Page
//   Rules and Rulesets run through `migrateItems`. Ruleset rules have
//   domain references deep-rewritten and `execute` action targets
//   remapped via `accountRulesetIdMap`. Within each ruleset, rules are
//   deduplicated on `{expression, action, description}` to defuse the
//   class of source-side duplicates Cloudflare creates when it mirrors
//   legacy rules into modern rulesets. Origin host overrides that the
//   dest account doesn't support are stripped and surfaced as
//   `acknowledged` instead of failing the whole ruleset.

import type {
  MigrationConfig,
  MigrationReport,
  ZoneExport,
  ReportSection,
  ReportItem,
} from '../types';
import * as api from '../api';
import { migrateItems, type LogFn } from '../migrate';
import {
  READ_ONLY_SETTINGS,
  BLOCKED_SETTINGS,
  isNoOpSetting,
} from './constants';
import { dedicatedEndpointId } from './dedicated-settings';
import {
  deepRewriteStrings,
  findEmbeddedReferences,
  findInZoneDnsTargets,
  rewriteZoneDomain,
} from './transforms';
import { rewriteExecuteActionTargets } from './rulesets';
import { isAcknowledgeableSingletonError } from './errors';

// Format a setting value for human-readable display in the report
// (on/off for booleans, truncate long strings/objects).
function formatSettingValue(value: unknown): string {
  if (value === 'on' || value === true) return 'on';
  if (value === 'off' || value === false) return 'off';
  if (typeof value === 'string') return value.length > 20 ? value.slice(0, 20) + '...' : value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && value !== null) {
    const str = JSON.stringify(value);
    return str.length > 30 ? str.slice(0, 30) + '...' : str;
  }
  return String(value);
}

export interface Batch1Deps {
  exportData: ZoneExport;
  report: MigrationReport;
  config: MigrationConfig;
  destAuth: api.ApiAuth | string;
  destAccountId: string;
  destZoneId: string;
  /** Destination zone apex name (e.g. "dest.example.com"). */
  zoneName: string;
  /**
   * The list of source rulesets that this run should attempt to migrate,
   * after upstream filtering (e.g. rate-limit rulesets removed when the
   * dest plan doesn't support them).
   */
  migrateableRulesets: ZoneExport['rulesets'];
  /**
   * True iff the dest plan/account has ACM (Advanced Certificate Manager)
   * enabled. Controls whether the `ciphers` setting is included in the
   * editable-settings filter.
   */
  acmAvailable: boolean;
  /**
   * Pre-fetched destination DNS records when `conflictStrategy === "overwrite"`,
   * otherwise an empty array. Used to find existing records by type+name to
   * update/delete during overwrite mode.
   */
  destDnsRecords: Awaited<ReturnType<typeof api.listDNSRecords>>;
  logWithProgress: LogFn;
  /** Called once per migrated item to bump the wizard's progress counter. */
  onItemDone: () => void;
}

/**
 * Run Batch 1 of the migration: DNS records, account-level custom rulesets
 * (and their phase entrypoints), then in parallel — Zone Settings, Page
 * Rules and zone-level Rulesets.
 *
 * Mutates `deps.report` (sections, summary, errors, warnings, manualActions)
 * and calls `deps.onItemDone()` per item. Returns nothing.
 */
export async function migrateBatch1(deps: Batch1Deps): Promise<void> {
  const {
    exportData,
    report,
    config,
    destAuth,
    destAccountId,
    destZoneId,
    zoneName,
    migrateableRulesets,
    acmAvailable,
    destDnsRecords,
    logWithProgress,
    onItemDone,
  } = deps;

  // Batch 1a: DNS first (rulesets with origin rules depend on DNS records existing)
  // Batch 1b: Settings, Page Rules, Rulesets in parallel after DNS
  logWithProgress('⏳ Migrating DNS, Settings, Page Rules, Rulesets...');

  const editableSettings = exportData.settings.filter(s =>
    s.editable
    && !READ_ONLY_SETTINGS.has(s.id)
    && !BLOCKED_SETTINGS.has(s.id)
    && !isNoOpSetting(s)
    && !(s.id === 'ciphers' && !acmAvailable),
  );
  const rulesetsWithRules = migrateableRulesets;
  const sourceZoneName = exportData.zone.name;

  // Convert DNS record FQDN from source zone to destination zone.
  // The Cloudflare API expects a relative name (e.g., "www") or the zone apex name.
  // Exported records have FQDNs like "www.source.com" which must be converted to
  // "www.dest.com" (or just "www" since the API appends the zone name).
  const convertDnsName = (fqdn: string): string => {
    if (fqdn === sourceZoneName) {
      // Apex record: use the destination zone name
      return zoneName;
    }
    if (fqdn.endsWith('.' + sourceZoneName)) {
      // Subdomain: strip source zone suffix and append destination zone
      const relative = fqdn.slice(0, -(sourceZoneName.length + 1));
      return `${relative}.${zoneName}`;
    }
    // Record name doesn't match source zone (shouldn't happen, but pass through)
    return fqdn;
  };

  // Rewrite domain references in arbitrary strings (page rules, forwarding URLs, etc.)
  // Delegates to the boundary-aware rewriteZoneDomain so the source zone name is
  // replaced only at hostname boundaries — never as an arbitrary substring (which
  // would corrupt `notexample.com` / `example.com.evil.test`-style collisions).
  // Also guards non-string input: callers pass optional fields (e.g. a ruleset
  // rule's `expression`, absent on default/skip rules); rewriteZoneDomain returns
  // non-strings untouched so a bare `undefined.replaceAll()` can't crash the step.
  const rewriteDomain = (value: string): string => rewriteZoneDomain(value, sourceZoneName, zoneName);

  const shouldOverwrite = config.conflictStrategy === 'overwrite';

  // Batch 1a: DNS records first (origin rulesets validate hostnames against zone DNS)
  const dnsSection = await migrateItems(
    'DNS Records',
    exportData.dnsRecords,
    async (record) => {
      await api.createDNSRecord(destAuth, destZoneId, {
        type: record.type,
        name: convertDnsName(record.name),
        content: record.content,
        ttl: record.ttl,
        proxied: record.proxied,
        priority: record.priority,
        data: record.data,
      });
    },
    (r) => `${r.type} ${r.name}`,
    report.errors,
    logWithProgress,
    report,
    onItemDone,
    `POST /zones/${destZoneId}/dns_records`,
    // Overwrite: find the existing record by type+name on destination and PUT to update it
    shouldOverwrite ? async (record) => {
      const destName = convertDnsName(record.name);
      // Match by type + name (+ content for multi-value types like A, MX, TXT)
      const multiValueTypes = new Set(['A', 'AAAA', 'MX', 'TXT', 'NS', 'SRV']);
      const match = destDnsRecords.find(d =>
        d.type === record.type &&
        d.name === destName &&
        (!multiValueTypes.has(record.type) || d.content === record.content)
      );
      if (match) {
        await api.updateDNSRecord(destAuth, destZoneId, match.id, {
          type: record.type,
          name: destName,
          content: record.content,
          ttl: record.ttl,
          proxied: record.proxied,
          priority: record.priority,
          data: record.data,
        });
      } else {
        // No exact match found — try deleting by type+name then creating fresh
        const partialMatches = destDnsRecords.filter(d =>
          d.type === record.type && d.name === destName
        );
        for (const pm of partialMatches) {
          await api.deleteDNSRecord(destAuth, destZoneId, pm.id);
        }
        await api.createDNSRecord(destAuth, destZoneId, {
          type: record.type,
          name: destName,
          content: record.content,
          ttl: record.ttl,
          proxied: record.proxied,
          priority: record.priority,
          data: record.data,
        });
      }
    } : undefined,
  );

  // In-zone self-referential DNS targets: records whose target points back into
  // the SOURCE zone (e.g. CNAME www → app.<sourcezone>). Their name migrates to
  // the dest zone but their target is copied verbatim (content is never rewritten
  // — that would corrupt external MX/CNAME targets). Post-cutover those targets
  // still name the old zone, so flag them as a manual repoint action rather than
  // leaving the user with a silently broken self-reference (Principles 3 & 9).
  const dnsSelfRefs = findInZoneDnsTargets(exportData.dnsRecords, sourceZoneName);
  if (dnsSelfRefs.length > 0) {
    const sample = dnsSelfRefs
      .slice(0, 10)
      .map(({ record, target }) => `${record.type} ${convertDnsName(record.name)} → ${target}`)
      .join('; ');
    const more = dnsSelfRefs.length > 10 ? ` (+${dnsSelfRefs.length - 10} more)` : '';
    report.manualActions.push(
      `Repoint ${dnsSelfRefs.length} in-zone DNS target(s) to ${zoneName}: their targets still ` +
      `reference the old zone "${sourceZoneName}" and were copied as-is (targets are never ` +
      `rewritten, to avoid breaking external destinations). Update each post-cutover: ${sample}${more}.`,
    );
  }

  // Pre-batch acknowledgments: detect zone-affecting account dependencies
  // that we don't auto-migrate. These show up as acknowledgments (per
  // "No Surprise Failures") rather than silently leaving the user with a
  // broken zone.
  //
  // Cloudflare Tunnel origins: any DNS record whose content/target points
  // at *.cfargotunnel.com depends on a tunnel on the source account.
  // Tunnels can't be moved between accounts.
  {
    const tunnelRecords = exportData.dnsRecords.filter(r => {
      const target = (r.content || (r.data as Record<string, unknown> | undefined)?.target || '') as string;
      return typeof target === 'string' && /\.cfargotunnel\.com$/i.test(target);
    });
    if (tunnelRecords.length > 0) {
      logWithProgress(`  ⚠ ${tunnelRecords.length} DNS record(s) point at a Cloudflare Tunnel — origin must be re-created on destination`);
      report.sections.push({
        name: 'Cloudflare Tunnel Origins',
        total: tunnelRecords.length,
        success: 0, failed: 0, skipped: 0,
        acknowledged: tunnelRecords.length,
        items: tunnelRecords.map(r => ({
          name: `${r.type} ${r.name} → ${r.content}`,
          status: 'acknowledged' as const,
          error: 'DNS target is a Cloudflare Tunnel on the source account. The DNS record migrates but the underlying tunnel does not — create a new tunnel on the destination and update this record to point at the new <tunnel-uuid>.cfargotunnel.com.',
        })),
      });
      report.summary.total += tunnelRecords.length;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + tunnelRecords.length;
      report.manualActions.push(`Recreate ${tunnelRecords.length} Cloudflare Tunnel(s) on the destination account and update the corresponding DNS records to point at the new tunnel UUIDs.`);
    }
  }

  // Custom Nameservers: the zone exports its CNS state as the
  // `customNameserversMetadata` singleton ({enabled, ns_set}). The underlying
  // `ns_set` pool lives at /accounts/{id}/custom_ns and isn't migrated by this
  // tool, so the zone's CNS assignment will fail unless the dest account
  // already has the same ns_set ID. Surface that as an acknowledgment + manual
  // action so the omission is never silent (Principle 8).
  const cnsMeta = exportData.customNameserversMetadata;
  if (cnsMeta?.enabled && cnsMeta.ns_set !== undefined) {
    const setId = cnsMeta.ns_set;
    report.sections.push({
      name: 'Custom Nameservers Pool (account-level)',
      total: 1,
      success: 0, failed: 0, skipped: 0,
      acknowledged: 1,
      items: [{
        name: `ns_set ${setId}`,
        status: 'acknowledged' as const,
        error: 'Custom Nameservers ns_set is account-scoped. The destination account must have an ns_set with the same ID (or you must update the zone after migration to use the dest set ID) before zone-level Custom NS assignment will succeed. Registrar glue records also need updating.',
      }],
    });
    report.summary.total += 1;
    report.summary.acknowledged = (report.summary.acknowledged || 0) + 1;
    report.manualActions.push(`Recreate the Custom Nameservers ns_set ${setId} on the destination account and update registrar glue records.`);
  }

  // Batch 1a.5: Account-level custom rulesets that the zone references via
  // execute actions. These must exist on the destination account BEFORE the
  // zone's own rulesets are migrated, so the execute references can be
  // remapped to the new IDs. References to rulesets we couldn't fetch (or
  // failed to recreate) become acknowledgments — the zone rule still gets
  // migrated but will no-op on dest until the user creates the ruleset.
  const accountRulesetIdMap = new Map<string, string>();
  const accountRulesetSectionItems: ReportItem[] = [];
  let accountRulesetSuccessCount = 0;
  let accountRulesetFailedCount = 0;
  let accountRulesetAcknowledgedCount = 0;
  if (exportData.accountRulesets && exportData.accountRulesets.length > 0) {
    logWithProgress(`⏳ Migrating ${exportData.accountRulesets.length} account-level custom ruleset(s) referenced by this zone...`);

    // Cross-org account ID detection (D1).
    //
    // Account ruleset rules may embed source-account references inside
    // action_parameters (e.g. categorized expressions like
    // `cf.account.<source_account_id>.foo`, custom-list slugs, embedded
    // worker.script names). We:
    //   1. Apply the existing domain rewrite to every string leaf so
    //      page-rule-style URLs and origin hostnames land on dest.
    //   2. Substitute the source account ID with the dest account ID
    //      wherever it appears verbatim — handles the common case where
    //      a customer hard-coded the account ID in a rule expression or
    //      action_parameters payload.
    //   3. After both rewrites, scan for any remaining 32-char hex strings
    //      that look like Cloudflare resource IDs (account/zone/worker
    //      IDs are all 32-hex) and warn so the user can audit. We
    //      deliberately don't auto-substitute these — they could be
    //      legitimate dest-account IDs the user already put in place.
    const sourceAccountId = config.sourceAccountId;
    const rewriteScalar = (s: string): string => {
      // Account-ruleset rules can carry optional/absent string fields (e.g. a
      // skip rule has no `expression`). Pass non-strings through untouched so
      // the rewrite never throws on undefined (see rewriteDomain note above).
      if (typeof s !== 'string') return s;
      let out = rewriteDomain(s);
      if (sourceAccountId && destAccountId && sourceAccountId !== destAccountId) {
        out = out.replaceAll(sourceAccountId, destAccountId);
      }
      return out;
    };
    const HEX_ID_RE = /\b[a-f0-9]{32}\b/g;
    const knownIds = new Set<string>([sourceAccountId, destAccountId, exportData.zone.id].filter(Boolean) as string[]);

    for (const src of exportData.accountRulesets) {
      try {
        // Cloudflare-managed account rulesets (OWASP Core, Cloudflare Managed,
        // Managed Free, Exposed Credentials Check) are auto-provisioned on
        // every account under stable, GLOBAL ruleset IDs (Principle 6:
        // auto_managed). They cannot be recreated via the API — POSTing one
        // fails with "'' is not a valid value for shareable_entitlement_name
        // because required for managed rulesets" — and they don't need to be:
        // the dest account already has them under the same IDs, so any zone
        // `execute` rule that targets them resolves without remapping. Skip
        // and acknowledge rather than emitting a red failure.
        if (src.kind && src.kind !== 'custom') {
          logWithProgress(`  🟡 Account Ruleset ${src.name} (${src.kind}): managed ruleset auto-provisioned on dest — skipping`);
          accountRulesetAcknowledgedCount++;
          accountRulesetSectionItems.push({
            name: `${src.name} (${src.phase})`,
            status: 'acknowledged',
            error: `Cloudflare-managed ruleset (kind="${src.kind}") is auto-provisioned on the destination account under the same global ID; it cannot be (and need not be) recreated via API.`,
          });
          continue;
        }
        const cleanRules = (src.rules || []).map(r => ({
          action: r.action,
          action_parameters: deepRewriteStrings(r.action_parameters, rewriteScalar) as typeof r.action_parameters,
          expression: rewriteScalar(r.expression),
          description: r.description,
          enabled: r.enabled,
          ...(r.ratelimit ? { ratelimit: r.ratelimit } : {}),
        }));

        // Audit pass: surface any remaining hex IDs that may be stale.
        const suspiciousIds = new Set<string>();
        for (const rule of cleanRules) {
          const found = findEmbeddedReferences(
            { expression: rule.expression, action_parameters: rule.action_parameters },
            HEX_ID_RE,
          );
          for (const id of found) {
            if (!knownIds.has(id)) suspiciousIds.add(id);
          }
        }
        if (suspiciousIds.size > 0) {
          report.warnings.push(
            `Account ruleset "${src.name}" contains ${suspiciousIds.size} hex ID(s) that may reference source-account resources: ${[...suspiciousIds].slice(0, 5).join(', ')}${suspiciousIds.size > 5 ? '…' : ''}. Audit manually before relying on this ruleset on dest.`,
          );
        }

        const created = await api.createAccountRuleset(destAuth, destAccountId, {
          name: src.name,
          description: src.description,
          kind: src.kind,
          phase: src.phase,
          rules: cleanRules,
        });
        accountRulesetIdMap.set(src.id, created.id);
        logWithProgress(`  ✓ Account Ruleset: ${src.name} (${src.id} → ${created.id})`);
        accountRulesetSuccessCount++;
        accountRulesetSectionItems.push({
          name: `${src.name} (${src.phase}) [${src.id} → ${created.id}]`,
          status: 'success',
        });
      } catch (e) {
        api.throwIfAuthError(e);
        const msg = (e as Error).message || '';
        // Entitlement / phase-not-enabled errors from the dest API are
        // acknowledged (yellow) rather than failed (red). The user can't
        // fix this with the migration tool — they need to enable the
        // phase entitlement on the dest account. Treat as a known
        // limitation per the No Surprise Failures principle.
        const isEntitlementError =
          /not entitled to use the phase/i.test(msg) ||
          /not entitled/i.test(msg) ||
          /not enabled on this account/i.test(msg) ||
          /requires an enterprise/i.test(msg);
        if (isEntitlementError) {
          logWithProgress(`  ⛔ Account Ruleset ${src.name}: acknowledged (${msg})`);
          accountRulesetAcknowledgedCount++;
          accountRulesetSectionItems.push({
            name: `${src.name} (${src.phase})`,
            status: 'acknowledged',
            error: `Destination account is not entitled to use phase "${src.phase}" — the ruleset cannot be recreated. ${msg}`,
          });
          report.warnings.push(
            `Account ruleset "${src.name}" (phase ${src.phase}) could not be migrated: destination account lacks the entitlement for that phase. ${msg}`.trim(),
          );
        } else {
          logWithProgress(`  ✗ Account Ruleset ${src.name}: ${msg}`);
          report.errors.push({
            resource: 'Account Ruleset',
            name: src.name,
            error: msg,
          });
          accountRulesetFailedCount++;
          accountRulesetSectionItems.push({
            name: `${src.name} (${src.phase})`,
            status: 'failed',
            error: msg,
          });
        }
      }
    }

    // Emit a dedicated "Account Rulesets" report section so users (and
    // post-run assertions) can see the account-scoped ruleset migration
    // result independent of the zone-scoped Rulesets section. Account
    // rulesets live on the destination account and are referenced by
    // zone rulesets via execute actions; surfacing them separately makes
    // ID-remap diagnostics traceable.
    const totalAccountRulesets = accountRulesetSectionItems.length;
    if (totalAccountRulesets > 0) {
      report.sections.push({
        name: 'Account Rulesets',
        total: totalAccountRulesets,
        success: accountRulesetSuccessCount,
        failed: accountRulesetFailedCount,
        skipped: 0,
        acknowledged: accountRulesetAcknowledgedCount,
        items: accountRulesetSectionItems,
      });
      report.summary.total += totalAccountRulesets;
      report.summary.success += accountRulesetSuccessCount;
      report.summary.failed += accountRulesetFailedCount;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + accountRulesetAcknowledgedCount;
      for (let i = 0; i < totalAccountRulesets; i++) onItemDone();
    }
  }

  // Replay account-level phase entrypoint execute rules on the dest. The
  // source account had `execute` rules in its phase entrypoints
  // (kind: root) pointing at custom account rulesets; on the dest we add
  // analogous rules pointing at the newly-created custom ruleset IDs.
  //
  // This is the CF-API-correct way to deploy custom account rulesets:
  // zone-level execute rules pointing at custom-scope account rulesets are
  // rejected by the API (error 20230 "not possible to execute a ruleset of
  // scope account at scope zone"); the canonical path is via account-level
  // root entrypoints.
  if (exportData.accountPhaseEntrypointReferences && exportData.accountPhaseEntrypointReferences.length > 0) {
    // Group rules by phase so we can do one PUT per phase.
    const byPhase = new Map<string, typeof exportData.accountPhaseEntrypointReferences>();
    for (const ref of exportData.accountPhaseEntrypointReferences) {
      if (!byPhase.has(ref.phase)) byPhase.set(ref.phase, []);
      byPhase.get(ref.phase)!.push(ref);
    }
    const entrypointItems: ReportItem[] = [];
    let entrypointSuccessCount = 0;
    let entrypointFailedCount = 0;
    let entrypointAckCount = 0;
    for (const [phase, refs] of byPhase) {
      // Remap source ruleset IDs to dest IDs. Skip references whose target
      // wasn't successfully migrated (caller already emitted an
      // acknowledgment for those via the unmapped-references section).
      const newRules = refs
        .filter(r => accountRulesetIdMap.has(r.sourceTargetId))
        .map(r => ({
          action: 'execute',
          action_parameters: { id: accountRulesetIdMap.get(r.sourceTargetId)! },
          expression: r.expression,
          description: r.description || '',
          enabled: r.enabled !== false,
        }));
      if (newRules.length === 0) continue;

      try {
        // Get the dest account's existing entrypoint (if any) so we
        // append rather than replace user-owned rules.
        const existing = await api.getAccountPhaseEntrypoint(destAuth, destAccountId, phase);
        const existingRules = (existing?.rules || []).map(r => {
          // Strip server-set fields the CF API rejects on PUT
          const { id: _id, version: _v, last_updated: _lu, ref: _ref, ...rest } = r as unknown as Record<string, unknown>;
          return rest;
        });
        // Avoid duplicates: skip new rules whose execute target ID is
        // already present on dest.
        const existingExecuteTargets = new Set<string>();
        for (const er of existingRules) {
          if ((er as { action?: string }).action === 'execute') {
            const ap = (er as { action_parameters?: Record<string, unknown> }).action_parameters;
            const id = ap?.id;
            if (typeof id === 'string') existingExecuteTargets.add(id);
          }
        }
        const filteredNewRules = newRules.filter(r => {
          const id = r.action_parameters.id;
          return typeof id === 'string' && !existingExecuteTargets.has(id);
        });
        if (filteredNewRules.length === 0) {
          logWithProgress(`  ✓ Account phase entrypoint "${phase}": ${newRules.length} rule(s) already present on dest`);
          for (const r of newRules) {
            entrypointSuccessCount++;
            entrypointItems.push({
              name: `${phase}: execute ${r.action_parameters.id} (already present)`,
              status: 'success',
            });
          }
          continue;
        }
        const merged = [...existingRules, ...filteredNewRules];
        await api.putAccountPhaseEntrypoint(destAuth, destAccountId, phase, { rules: merged as Array<Record<string, unknown>> });
        logWithProgress(`  ✓ Account phase entrypoint "${phase}": added ${filteredNewRules.length} execute rule(s)`);
        for (const r of filteredNewRules) {
          entrypointSuccessCount++;
          entrypointItems.push({
            name: `${phase}: execute ${r.action_parameters.id}`,
            status: 'success',
          });
        }
      } catch (e) {
        api.throwIfAuthError(e);
        const msg = (e as Error).message || '';
        const isEntitlementError =
          /not entitled to use the phase/i.test(msg) ||
          /not entitled/i.test(msg) ||
          /not enabled on this account/i.test(msg);
        if (isEntitlementError) {
          logWithProgress(`  ⛔ Account phase entrypoint "${phase}": acknowledged (${msg})`);
          for (const r of newRules) {
            entrypointAckCount++;
            entrypointItems.push({
              name: `${phase}: execute ${r.action_parameters.id}`,
              status: 'acknowledged',
              error: `Destination account is not entitled to use phase "${phase}". ${msg}`,
            });
          }
          report.warnings.push(
            `Account phase entrypoint "${phase}" execute rules could not be deployed: destination account lacks the entitlement for that phase. ${msg}`.trim(),
          );
        } else {
          logWithProgress(`  ✗ Account phase entrypoint "${phase}": ${msg}`);
          for (const r of newRules) {
            entrypointFailedCount++;
            entrypointItems.push({
              name: `${phase}: execute ${r.action_parameters.id}`,
              status: 'failed',
              error: msg,
            });
          }
          report.errors.push({
            resource: 'Account Phase Entrypoint',
            name: phase,
            error: msg,
          });
        }
      }
    }
    if (entrypointItems.length > 0) {
      report.sections.push({
        name: 'Account Phase Entrypoints',
        total: entrypointItems.length,
        success: entrypointSuccessCount,
        failed: entrypointFailedCount,
        skipped: 0,
        acknowledged: entrypointAckCount,
        items: entrypointItems,
      });
      report.summary.total += entrypointItems.length;
      report.summary.success += entrypointSuccessCount;
      report.summary.failed += entrypointFailedCount;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + entrypointAckCount;
      for (let i = 0; i < entrypointItems.length; i++) onItemDone();
    }
  }

  // Any referenced ruleset ID we couldn't fetch from source (read forbidden,
  // deleted, etc.) becomes an acknowledgment. The zone rule that executes
  // it will be migrated with the original (stale) ID and will no-op on dest.
  //
  // Only IDs that were NEVER FETCHED count here. An ID that WAS fetched but
  // could not be recreated for a known reason (e.g. dest not entitled to the
  // phase, or a managed ruleset auto-provisioned on dest) is already reported
  // in the Account Rulesets section above — re-listing it here as a "stale
  // reference" would double-report the same item under two contradictory
  // explanations.
  if (exportData.referencedAccountRulesetIds && exportData.referencedAccountRulesetIds.length > 0) {
    const fetchedIds = new Set((exportData.accountRulesets || []).map(r => r.id));
    const unrecoverable = exportData.referencedAccountRulesetIds.filter(
      id => !accountRulesetIdMap.has(id) && !fetchedIds.has(id),
    );
    if (unrecoverable.length > 0) {
      // Build a reverse index: which zone rulesets reference each unmapped ID?
      // This makes the manual-action message actionable instead of mysterious
      // (the user otherwise has no way to find which rule executes the stale ID).
      const refsByUnmappedId = new Map<string, string[]>();
      for (const rs of exportData.rulesets || []) {
        for (const rule of rs.rules || []) {
          if (rule.action !== 'execute') continue;
          const ap = rule.action_parameters as { id?: string } | undefined;
          if (!ap?.id || !unrecoverable.includes(ap.id)) continue;
          const refs = refsByUnmappedId.get(ap.id) || [];
          refs.push(`${rs.name || rs.id} (phase ${rs.phase})`);
          refsByUnmappedId.set(ap.id, refs);
        }
      }

      logWithProgress(`  ⚠ ${unrecoverable.length} account ruleset reference(s) could not be migrated — zone rules will reference stale IDs`);
      report.sections.push({
        name: 'Account Ruleset References (unmapped)',
        total: unrecoverable.length,
        success: 0,
        failed: 0,
        skipped: 0,
        acknowledged: unrecoverable.length,
        items: unrecoverable.map(id => {
          const refs = refsByUnmappedId.get(id) || [];
          const refText = refs.length > 0 ? ` Referenced by: ${refs.join(', ')}.` : '';
          return {
            name: `account ruleset ${id}`,
            status: 'acknowledged' as const,
            error: `Referenced by an execute action in a zone ruleset but could not be exported from the source account (read permission missing, deleted, or fetch failed). The migrated rule will no-op on dest until you recreate the ruleset on the destination account.${refText} Fix: grant the source API token "Account Rulesets: Read" permission and re-run.`,
          };
        }),
      });
      report.summary.total += unrecoverable.length;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + unrecoverable.length;
      for (const id of unrecoverable) {
        const refs = refsByUnmappedId.get(id) || [];
        const refText = refs.length > 0 ? ` (referenced by ${refs.join(', ')})` : '';
        report.manualActions.push(`Recreate account ruleset ${id}${refText} on the destination account and update the dest zone's execute rules to reference the new ID. To avoid this in future, grant the source API token "Account Rulesets: Read" permission before migrating.`);
      }
    }
  }

  // Batch 1b: Settings, Page Rules, Rulesets in parallel (after DNS so origin hostnames exist)
  const [settingsSection, pageRulesSection, rulesetsSection] = await Promise.all([
    // Zone Settings — applied sequentially in dependency order to avoid conflicts
    // (e.g. 0rtt requires tls_1_3 to be set first, privacy_pass conflicts with security_level='under_attack')
    (async (): Promise<ReportSection> => {
      const SETTING_ORDER: Record<string, number> = {
        // Phase 1: Security mode (must come before privacy_pass)
        security_level: 0,
        // Phase 2: TLS settings. tls_1_3 must be ENABLED before min_tls_version,
        // because enforcing a minimum of TLS 1.3 while TLS 1.3 is still off is
        // incoherent — Cloudflare rejects `min_tls_version=1.3` in that state with
        // an opaque internal error (#-88560). Applying tls_1_3=on first lets the
        // 1.3 floor stick. tls_1_3 must also precede 0rtt.
        ssl: 10,
        tls_1_3: 11,
        min_tls_version: 12,
        // Phase 3: Settings that depend on TLS
        '0rtt': 20,
        // Phase 4: Settings that depend on security_level
        privacy_pass: 30,
      };
      const DEFAULT_ORDER = 15; // Most settings have no dependencies
      const orderedSettings = [...editableSettings].sort((a, b) =>
        (SETTING_ORDER[a.id] ?? DEFAULT_ORDER) - (SETTING_ORDER[b.id] ?? DEFAULT_ORDER)
      );
      const section: ReportSection = {
        name: 'Zone Settings',
        total: orderedSettings.length,
        success: 0,
        failed: 0,
        skipped: 0,
        items: [],
      };
      if (orderedSettings.length === 0) {
        logWithProgress('  ⏭ Zone Settings: 0 items, skipping');
        return section;
      }
      logWithProgress(`  PATCH /zones/${destZoneId}/settings/{setting}`);
      logWithProgress(`  ⏳ Zone Settings: ${orderedSettings.length} items (sequential, dependency-ordered)...`);
      for (const setting of orderedSettings) {
        const itemName = `${setting.id}: ${formatSettingValue(setting.value)}`;
        try {
          await api.updateZoneSetting(destAuth, destZoneId, dedicatedEndpointId(setting.id), setting.value);
          onItemDone();
          section.success++;
          section.items.push({ name: itemName, status: 'success' });
        } catch (e: unknown) {
          api.throwIfAuthError(e);
          const msg = e instanceof Error ? e.message : String(e);
          onItemDone();
          // Plan/entitlement-gated and server-side read-only settings
          // (http2, long_lived_grpc, webp, etc. on a lower-tier dest plan)
          // return "Not allowed to edit ...", "this zone setting is read
          // only", or "Upgrade ... to unlock ...". The user cannot change
          // this by acknowledging — the dest zone gets whatever its plan
          // dictates. Per Principle 1 (No Surprise Failures) these land as
          // `acknowledged`, NOT `failed`, and are not pushed to errors[].
          if (isAcknowledgeableSingletonError(msg)) {
            section.acknowledged = (section.acknowledged || 0) + 1;
            section.items.push({ name: itemName, status: 'acknowledged', error: msg });
          } else {
            section.failed++;
            section.items.push({ name: itemName, status: 'failed', error: msg });
            report.errors.push({ resource: 'Zone Settings', name: itemName, error: msg });
          }
        }
      }
      logWithProgress(`  ✓ Zone Settings: ${section.success} ok, ${section.acknowledged || 0} acknowledged, ${section.failed} failed`);
      return section;
    })(),
    migrateItems(
      'Page Rules',
      exportData.pageRules,
      async (rule) => {
        // Rewrite domain references in page rule URL patterns
        const rewrittenTargets = rule.targets.map(t => ({
          ...t,
          constraint: {
            ...t.constraint,
            value: rewriteDomain(t.constraint.value),
          },
        }));
        // Rewrite domain references in forwarding URL actions
        const rewrittenActions = rule.actions.map(a => {
          if (a.id === 'forwarding_url' && a.value && typeof a.value === 'object' && 'url' in a.value && typeof (a.value as { url: unknown }).url === 'string') {
            const v = a.value as { url: string; [k: string]: unknown };
            return { ...a, value: { ...v, url: rewriteDomain(v.url) } };
          }
          return a;
        });
        await api.createPageRule(destAuth, destZoneId, {
          targets: rewrittenTargets,
          actions: rewrittenActions,
          priority: rule.priority,
          status: rule.status,
        });
      },
      (r) => r.targets[0]?.constraint.value || 'unknown',
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      `POST /zones/${destZoneId}/pagerules`,
    ),
    migrateItems(
      'Rulesets',
      rulesetsWithRules,
      async (ruleset) => {
        // Deep-rewrite domain references in action_parameters (origin hostnames, redirect URLs, etc.)
        function rewriteActionParams(params: unknown): unknown {
          if (params == null) return params;
          if (typeof params === 'string') return rewriteDomain(params);
          if (Array.isArray(params)) return params.map(rewriteActionParams);
          if (typeof params === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
              out[k] = rewriteActionParams(v);
            }
            return out;
          }
          return params;
        }

        const cleanRulesPreRewrite = ruleset.rules.map(r => ({
          action: r.action,
          action_parameters: rewriteActionParams(r.action_parameters) as typeof r.action_parameters,
          expression: r.expression,
          description: r.description,
          enabled: r.enabled,
          ...(r.ratelimit ? { ratelimit: r.ratelimit } : {}),
        }));
        // Rewrite `execute` action targets so they reference the new
        // destination-account ruleset IDs created above. Rules whose target
        // wasn't mapped are left untouched (already acknowledged separately).
        const cleanRules = accountRulesetIdMap.size > 0
          ? rewriteExecuteActionTargets(cleanRulesPreRewrite as Array<{ action: string; action_parameters?: Record<string, unknown>; [key: string]: unknown }>, accountRulesetIdMap) as typeof cleanRulesPreRewrite
          : cleanRulesPreRewrite;
        // Deduplicate rules within each ruleset to prevent duplicates from
        // source zones where Cloudflare mirrored legacy rules into modern rulesets.
        // Two rules are duplicates only if they share expression + action +
        // description AND identical action_parameters. The action_parameters
        // MUST be in the key: a managed phase (e.g. http_request_firewall_managed)
        // commonly has several `execute` rules with the SAME trigger
        // (expression "true", action "execute", empty description) that differ
        // ONLY in action_parameters.id (the target ruleset). Omitting it
        // collapsed those into one, deploying a single managed ruleset where
        // the source had several — and dropping exactly the execute targets
        // just remapped above.
        const seen = new Set<string>();
        const dedupedRules = cleanRules.filter(r => {
          const key = `${r.expression}|${r.action}|${r.description || ''}|${JSON.stringify(r.action_parameters ?? null)}`;
          if (seen.has(key)) {
            logWithProgress(`  ⚠ Skipping duplicate rule in ${ruleset.phase}: "${r.description || r.expression}"`);
            return false;
          }
          seen.add(key);
          return true;
        });
        try {
          await api.updateRuleset(destAuth, destZoneId, ruleset.phase, dedupedRules);
        } catch (e) {
          api.throwIfAuthError(e);
          const msg = (e as Error).message || '';
          // Origin host overrides may fail when dest account type doesn't support them
          // (e.g. standard vs enterprise account). Strip host-override rules and retry.
          if (msg.includes('does not belong to') && ruleset.phase === 'http_request_origin') {
            const hostRules = dedupedRules.filter(r => {
              const ap = r.action_parameters as Record<string, unknown> | undefined;
              return ap && typeof ap === 'object' && ap.origin &&
                typeof ap.origin === 'object' && (ap.origin as Record<string, unknown>).host;
            });
            const nonHostRules = dedupedRules.filter(r => !hostRules.includes(r));
            if (nonHostRules.length > 0) {
              logWithProgress(`  ⚠ Origin host override not supported on dest account — migrating ${nonHostRules.length} rules without host overrides`);
              await api.updateRuleset(destAuth, destZoneId, ruleset.phase, nonHostRules);
            }
            if (hostRules.length > 0) {
              logWithProgress(`  ⛔ ${hostRules.length} origin host override rule(s) cannot be migrated (dest account does not support origin host overrides)`);
              // Add these as acknowledged items
              report.sections.push({
                name: 'Origin Rules (host override)',
                total: hostRules.length,
                success: 0,
                failed: 0,
                skipped: 0,
                acknowledged: hostRules.length,
                items: hostRules.map(r => ({
                  name: r.description || r.expression || 'origin host rule',
                  status: 'acknowledged' as const,
                  error: 'Origin host override not supported on destination account. Requires enterprise account type.',
                })),
              });
              report.summary.total += hostRules.length;
              report.summary.acknowledged = (report.summary.acknowledged || 0) + hostRules.length;
            }
            return; // Don't rethrow — this is a handled acknowledged failure
          }
          throw e; // Re-throw other errors
        }
      },
      (rs) => `${rs.name} (${rs.phase})`,
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      `PUT /zones/${destZoneId}/rulesets/phases/{phase}/entrypoint`,
    ),
  ]);
  report.sections.push(dnsSection, settingsSection, pageRulesSection, rulesetsSection);
  logWithProgress(`✓ Batch 1 complete`);
}
