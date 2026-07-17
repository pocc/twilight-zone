// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Pre-batch setup for migrateZone(). Five sub-phases that run before
// any user-data resource is migrated:
//
//   1. createOrFindDestZone() — POST /zones; on failure, search dest
//      account for an existing zone of the same name. Hard-fails if no
//      safe fallback exists (see AGENTS.md: "Never mask or downgrade a
//      status/error" — silently writing to the wrong zone is a data-
//      corruption-class bug).
//   2. assignZonePlan() — pick the right plan tier for the dest zone.
//      Priority: user-selected > Enterprise > match source > highest
//      available > stay on current. Plan-dependent features will fail
//      to migrate later if the zone is left on Free, so this MUST run
//      before Batch 1.
//   3. probeCapabilitiesAndPopulateSkipFields() — check dest account
//      entitlements (R2, D1, Queues, Workers, Spectrum, Load Balancing,
//      Zero Trust, Rate Limiting). Missing entitlements are surfaced as
//      acknowledged sections (Principle 2: "Entitlement Gaps ->
//      Acknowledgment, Not Failure") and the relevant export fields
//      are zeroed so downstream batches don't try.
//   4. surfaceDeselectedGroups() — emit acknowledgment sections for
//      groups the user explicitly deselected in Step 2 (KV, R2,
//      Workers, etc.). Without this the deselected items would silently
//      vanish from the report (Principle 1: "No Surprise Failures").
//   5. probeAcm() — write a default `ciphers` value to detect whether
//      Advanced Certificate Manager is available on the dest zone. ACM
//      is zone-level (not account-level), so the account capability
//      probe can't catch it.
//
// Each sub-phase mutates `report` and may mutate `exportData` (for the
// capability-gap zeroing), returns whatever new state downstream phases
// need. Callers run them in sequence; no single "Prelude" result object
// because the state evolves between phases (destZoneId from #1 is read
// by #2, capabilities from #3 by #5, etc.).

import type {
  MigrationConfig, MigrationReport, ZoneExport, CFZone, ReportSection,
} from '../types';
import type { LogFn } from '../migrate';
import * as api from '../api';
import {
  buildCapabilityAcknowledgmentSection,
  buildDeselectedAcknowledgmentSection,
  computeDeselectedGroups,
} from '../migrate';
import { READ_ONLY_SETTINGS, BLOCKED_SETTINGS, isNoOpSetting } from './constants';

export interface CreateOrFindResult {
  newZone: CFZone;
  zoneWasCreated: boolean;
}

/**
 * Phase 1: create the dest zone or find an existing one in the dest account.
 *
 * Failure mode: if creation fails AND no zone of this name exists in the
 * destination account, throws. We deliberately do NOT fall back to a
 * zone visible in some other account (the source account, for instance,
 * when a single API key spans both) — that would silently migrate onto
 * the source zone.
 */
export async function createOrFindDestZone(
  destAuth: api.ApiAuth | string,
  destAccountId: string,
  zoneName: string,
  report: MigrationReport,
  log: LogFn,
): Promise<CreateOrFindResult> {
  log(`📝 Creating zone: ${zoneName}`);
  log(`  POST /zones`);
  let newZone: CFZone;
  let zoneWasCreated = false;
  try {
    newZone = await api.createZone(destAuth, destAccountId, zoneName);
    zoneWasCreated = true;
    report.createdResources!.zoneId = newZone.id;
    log(`✓ Zone created: ${newZone.id}`);
  } catch (e: unknown) {
    const err = e as Error;
    // Try to find an existing zone on creation failure (rate-limiting, subdomain
    // restrictions, race with another tool, "already exists", etc.). We must ONLY
    // accept a zone that lives in the destination account — falling back to a
    // zone the caller can see in another account (e.g. the source account, when
    // a single API key spans both) silently migrates onto the source zone, which
    // is a data-corruption-class bug.
    log(`⚠ Zone creation failed: ${err.message}`);
    log(`  Searching for existing zone "${zoneName}" in destination account ${destAccountId}...`);
    let destZones: CFZone[] = [];
    try {
      const zones = await api.listZones(destAuth, zoneName);
      destZones = zones.filter(z => z.account?.id === destAccountId && z.name === zoneName);
    } catch {
      // If listing also fails, surface the original creation error.
      throw e;
    }
    if (destZones.length === 0) {
      // No safe fallback. Fail loudly rather than silently writing to the source
      // zone or some other account's zone.
      throw new Error(
        `Zone creation failed and no existing zone "${zoneName}" found in destination ` +
        `account ${destAccountId}. If the source zone has a Cloudflare zone hold, ` +
        `the hold must be released by the current zone's owner before the zone can ` +
        `be created elsewhere. Original error: ${err.message}`,
      );
    }
    newZone = destZones[0];
    log(`✓ Using existing destination zone: ${newZone.id} (account ${newZone.account?.id})`);
    report.warnings.push(`Zone creation failed (${err.message}), using existing destination-account zone ${newZone.id}`);
  }
  // Always record the resolved destination zone id — created OR reused. The
  // post-migration verification keys off this (createdResources.zoneId is set
  // only in the create branch above, on purpose: rollback/stats treat it as
  // "a zone we created", so it must stay empty for a reused zone).
  report.destZoneId = newZone.id;
  report.newNameservers = newZone.name_servers;
  return { newZone, zoneWasCreated };
}

/**
 * Phase 2: pick + assign a plan to the destination zone.
 *
 * Priority order:
 *   1. User explicitly selected a plan (config.targetPlan)
 *   2. Enterprise is subscribable on the destination account
 *   3. Source plan is subscribable on the destination account
 *   4. Highest available plan (Enterprise > Business > Pro)
 *   5. Nothing available → leave on current plan + warn
 *
 * On any error (most commonly "unknown or deprecated rate plan", which
 * actually means "not entitled on this account"), warns and leaves the
 * zone on whatever plan was assigned at zone-create time.
 */
export async function assignZonePlan(
  config: MigrationConfig,
  exportData: ZoneExport,
  newZone: CFZone,
  destZoneId: string,
  destAuth: api.ApiAuth | string,
  report: MigrationReport,
  log: LogFn,
): Promise<void> {
  const PLAN_TIER_ORDER = ['enterprise', 'business', 'pro', 'free'];
  const sourcePlanId = exportData.zone.plan.id?.toLowerCase() || 'free';
  const sourcePlanName = exportData.zone.plan.name || 'Free';
  const destPlanId = newZone.plan?.id?.toLowerCase() || 'free';
  const requestedPlanId = config.targetPlan?.toLowerCase() || null;

  log(`📋 Source zone plan: ${sourcePlanName} — setting up destination zone plan...`);
  try {
    const availablePlans = await api.getAvailablePlans(destAuth, destZoneId);
    const subscribable = availablePlans.filter(p => p.can_subscribe);

    const findPlan = (id: string) => subscribable.find(p =>
      p.id.toLowerCase() === id || p.legacy_id?.toLowerCase() === id
    );
    const bestAvailable = () => {
      for (const tier of PLAN_TIER_ORDER) {
        const match = subscribable.find(p =>
          p.id.toLowerCase() === tier || p.legacy_id?.toLowerCase() === tier
        );
        if (match) return match;
      }
      return null;
    };

    let chosenPlan: api.AvailableRatePlan | null | undefined = null;
    let choiceReason = '';

    if (requestedPlanId) {
      chosenPlan = findPlan(requestedPlanId);
      if (chosenPlan) {
        choiceReason = `user-selected plan "${chosenPlan.name}"`;
      } else {
        const found = availablePlans.find(p =>
          p.id.toLowerCase() === requestedPlanId || p.legacy_id?.toLowerCase() === requestedPlanId
        );
        if (found) {
          const msg = `Cannot subscribe to "${found.name}" plan on destination. The account may not have entitlement for this plan.`;
          report.warnings.push(msg);
          log(`⚠ ${msg}`);
        } else {
          const msg = `Selected plan "${requestedPlanId}" not found in available destination plans.`;
          report.warnings.push(msg);
          log(`⚠ ${msg}`);
        }
        // Fall through to auto-selection
      }
    }

    if (!chosenPlan) {
      const enterprise = findPlan('enterprise');
      if (enterprise) {
        chosenPlan = enterprise;
        choiceReason = 'Enterprise is available on the destination account';
      }
    }

    if (!chosenPlan) {
      const sourceMatch = findPlan(sourcePlanId);
      if (sourceMatch) {
        chosenPlan = sourceMatch;
        choiceReason = `matching source plan "${sourcePlanName}"`;
      }
    }

    if (!chosenPlan) {
      chosenPlan = bestAvailable();
      if (chosenPlan && chosenPlan.id.toLowerCase() !== 'free') {
        choiceReason = `highest available plan (source plan "${sourcePlanName}" not available)`;
      }
    }

    if (chosenPlan && chosenPlan.id.toLowerCase() !== destPlanId) {
      log(`📋 Assigning ${chosenPlan.name} plan to destination zone (${choiceReason})...`);
      log(`  PUT /zones/${destZoneId}/subscription`);
      await api.updateZoneSubscription(destAuth, destZoneId, chosenPlan.id);
      log(`✓ Zone plan set to ${chosenPlan.name}`);
    } else if (chosenPlan && chosenPlan.id.toLowerCase() === destPlanId) {
      log(`✓ Destination zone already on ${chosenPlan.name} plan`);
    } else if (!chosenPlan || subscribable.length === 0) {
      const msg = `No subscribable plans found for the destination zone. Zone will remain on ${newZone.plan?.name || 'Free'} plan. Some features may fail to migrate.`;
      report.warnings.push(msg);
      log(`⚠ ${msg}`);
    }
  } catch (e) {
    const err = e as Error;
    // The API often returns "unknown or deprecated rate plan: '<uuid>'"
    // when the destination account doesn't have entitlement for the
    // requested plan — the plan ID isn't actually deprecated, the dest
    // account just can't subscribe to it. Rewrite the message so the
    // user understands the actual cause (entitlement, not API drift).
    let humanMsg = err.message;
    const ratePlanMatch = err.message.match(/unknown or deprecated rate plan:\s*'?([a-f0-9]+)'?/i);
    if (ratePlanMatch) {
      humanMsg = `Plan ID '${ratePlanMatch[1]}' is not subscribable on the destination account. The destination account does not have entitlement for this plan tier; the zone will use whichever plan is the highest available on the dest account.`;
    }
    const msg = `Could not set zone plan: ${humanMsg} Zone will remain on ${newZone.plan?.name || 'Free'} plan. Some features may fail to migrate.`;
    report.warnings.push(msg);
    log(`⚠ ${msg}`);
  }
}

export interface CapabilityProbeResult {
  capabilities: api.AccountCapabilities | null;
  skipFields: Set<string>;
  /** Number of items pre-acknowledged (caller bumps completedItems by this). */
  acknowledgedItems: number;
}

/**
 * Phase 3: probe dest account capabilities and pre-acknowledge missing
 * entitlements. Mutates exportData (zeros relevant fields) and
 * migrateableRulesets (drops http_ratelimit phase when rate-limiting is
 * unavailable).
 *
 * The migrateableRulesets array IS mutated in-place — caller must pass
 * the same reference downstream batches will consume.
 */
export async function probeCapabilitiesAndPopulateSkipFields(
  destAuth: api.ApiAuth | string,
  destAccountId: string,
  exportData: ZoneExport,
  migrateableRulesets: ZoneExport['rulesets'],
  report: MigrationReport,
  log: LogFn,
): Promise<CapabilityProbeResult> {
  log('🔍 Checking destination account capabilities...');
  let capabilities: api.AccountCapabilities | null = null;
  try {
    capabilities = await api.checkAccountCapabilities(destAuth, destAccountId);
  } catch {
    log('  ⚠ Could not check capabilities — proceeding with all resources');
  }

  const skipFields = new Set<string>();
  let acknowledgedItems = 0;

  if (capabilities) {
    const capabilityResourceMap: Array<{
      cap: api.FeatureAvailability;
      label: string;
      fields: (keyof ZoneExport)[];
    }> = [
      { cap: capabilities.loadBalancing, label: 'Load Balancing', fields: ['loadBalancers', 'pools', 'monitors'] },
      { cap: capabilities.zeroTrust, label: 'Zero Trust / Access', fields: ['accessApps', 'accessPolicies'] },
      { cap: capabilities.r2, label: 'R2', fields: ['r2Buckets'] },
      { cap: capabilities.workers, label: 'Workers', fields: ['workers', 'workerRoutes'] },
      { cap: capabilities.spectrum, label: 'Spectrum', fields: ['spectrumApps'] },
      { cap: capabilities.queues, label: 'Queues', fields: ['queues'] },
      { cap: capabilities.d1, label: 'D1', fields: ['d1Databases'] },
      // Vectorize indexes are exported as a standalone account-phase array and
      // were previously migrated unconditionally — relying ONLY on the post-hoc
      // isManualActionError() string match to avoid a surprise red failure when
      // the dest lacks the entitlement. Add the proactive zeroing net so it
      // matches its sibling resources (R2/Queues/D1) and acknowledges cleanly
      // (Principle 2), instead of depending on an unverified upstream error
      // phrase.
      { cap: capabilities.vectorize, label: 'Vectorize', fields: ['vectorizeIndexes'] },
    ];

    for (const { cap, label, fields } of capabilityResourceMap) {
      if (cap && !cap.available) {
        log(`  ⛔ ${label}: not enabled on destination — acknowledging resources`);
        if (cap.reason) log(`     Reason: ${cap.reason}`);
        if (cap.action) log(`     To fix: ${cap.action}`);
        // Phrase the disclosure as "<label> not enabled on destination
        // account" so the capability gap stays visible (and machine-findable)
        // even when there are zero affected resources — the per-resource
        // acknowledged rows are no longer synthesized in that case (Principle 4),
        // so this warning is the single source of disclosure.
        report.warnings.push(`${label} not enabled on destination account. ${cap.reason || ''} ${cap.action || ''}`.trim());

        for (const f of fields) {
          const val = exportData[f];
          const items = Array.isArray(val) ? (val as Array<{ name?: string; id?: string; title?: string }>) : [];
          if (Array.isArray(val)) {
            (exportData as unknown as Record<string, unknown>)[f] = [];
          }
          skipFields.add(f as string);
          const section = buildCapabilityAcknowledgmentSection(label, String(f), cap, items);
          report.sections.push(section);
          report.summary.total += section.total;
          report.summary.acknowledged = (report.summary.acknowledged || 0) + (section.acknowledged || 0);
          acknowledgedItems += section.total;
        }
      }
    }

    // Filter out http_ratelimit ruleset phase when rate limiting is unavailable.
    // Advanced Rate Limiting (ruleset-based) requires the same entitlement as legacy rate limits.
    if (capabilities.rateLimiting && !capabilities.rateLimiting.available) {
      const rateLimitRulesets = migrateableRulesets.filter(rs => rs.phase === 'http_ratelimit');
      if (rateLimitRulesets.length > 0) {
        log('  ⛔ Rate Limiting Rules (http_ratelimit): not enabled on destination — skipping ruleset');
        const idxToRemove = new Set(rateLimitRulesets.map(rs => migrateableRulesets.indexOf(rs)));
        for (const idx of [...idxToRemove].sort((a, b) => b - a)) {
          migrateableRulesets.splice(idx, 1);
        }
        const totalRules = rateLimitRulesets.reduce((sum, rs) => sum + rs.rules.length, 0);
        report.sections.push({
          name: 'Rate Limiting Rules',
          total: rateLimitRulesets.length,
          success: 0,
          failed: 0,
          skipped: 0,
          acknowledged: rateLimitRulesets.length,
          items: rateLimitRulesets.map(rs => ({
            name: `${rs.name || 'default'} (${rs.phase})`,
            status: 'acknowledged' as const,
            error: `Rate Limiting not enabled on destination account. ${totalRules} rule${totalRules !== 1 ? 's' : ''} skipped.`,
          })),
        });
        report.summary.total += rateLimitRulesets.length;
        report.summary.acknowledged = (report.summary.acknowledged || 0) + rateLimitRulesets.length;
        acknowledgedItems += rateLimitRulesets.length;
      }
    }

    log('✓ Capability check complete');
  }

  return { capabilities, skipFields, acknowledgedItems };
}

/**
 * Phase 4: surface user-deselected groups as acknowledged sections.
 *
 * When the user unchecks an account-scoped group in Step 2 (e.g. KV,
 * R2, Load Balancers), `filterExportData` silently drops those items.
 * Without an explicit acknowledgment section, the user sees no record
 * of the deselected category in the report — a Principle 1 ("No
 * Surprise Failures") violation.
 *
 * Returns the number of items acknowledged (caller bumps completedItems).
 */
export function surfaceDeselectedGroups(
  config: MigrationConfig,
  rawExportDataForDeselectDiagnostics: ZoneExport | undefined,
  report: MigrationReport,
  log: LogFn,
): number {
  let acknowledgedItems = 0;
  if (rawExportDataForDeselectDiagnostics && config.selections) {
    const deselectedGroups = computeDeselectedGroups(
      rawExportDataForDeselectDiagnostics,
      config.selections,
    );
    if (deselectedGroups.length > 0) {
      log(`📋 ${deselectedGroups.length} group(s) deselected in Step 2 — surfacing as acknowledged:`);
      for (const group of deselectedGroups) {
        log(`     • ${group.label}: ${group.items.length} item(s) deselected`);
        const section = buildDeselectedAcknowledgmentSection(group);
        report.sections.push(section);
        report.summary.total += section.total;
        report.summary.acknowledged = (report.summary.acknowledged || 0) + (section.acknowledged || 0);
        acknowledgedItems += section.total;
      }
    }
  }
  return acknowledgedItems;
}

/**
 * Phase 5: probe Advanced Certificate Manager availability.
 *
 * ACM is zone-level (not account-level), so we couldn't check it during
 * the account capability scan. Writing *any* value to the `ciphers`
 * setting (even the default `[]`) requires ACM. We use this no-op write
 * as a probe.
 *
 * Returns `acmAvailable` — false ONLY when the API responds with a
 * "certificate manager" error. Other errors (rate limit, transient
 * 500s) leave acmAvailable=true so the real migration path can re-try
 * the setting with the actual value.
 */
export async function probeAcm(
  destAuth: api.ApiAuth | string,
  destZoneId: string,
  exportData: ZoneExport,
  report: MigrationReport,
  log: LogFn,
): Promise<boolean> {
  let acmAvailable = true;
  const hasCiphersSetting = exportData.settings.some(
    s => s.id === 'ciphers' && s.editable && !READ_ONLY_SETTINGS.has(s.id) && !BLOCKED_SETTINGS.has(s.id) && !isNoOpSetting(s),
  );
  if (hasCiphersSetting) {
    try {
      await api.updateZoneSetting(destAuth, destZoneId, 'ciphers', []);
      // Succeeded — ACM is available (we just wrote the default, harmless)
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message.toLowerCase().includes('certificate manager')) {
        acmAvailable = false;
        log('  ⛔ Advanced Certificate Manager: not available — ciphers setting will be skipped');
        report.warnings.push('Advanced Certificate Manager is not enabled on the destination zone. The ciphers setting will be skipped.');
      }
      // Any other error (e.g. rate limit) — assume ACM is available, let migration handle it
    }
  }
  // acmAvailable is computed but not currently read by downstream batches — the
  // ciphers write is its own probe and the failure is logged. Returning the
  // flag so future code paths can branch on it without re-probing.
  return acmAvailable;
}

/**
 * Phase 6: pre-fetch dest DNS + worker routes for overwrite mode.
 *
 * Only runs when `config.conflictStrategy === 'overwrite'`. Returns
 * empty arrays otherwise. Batch 2's Worker Routes section reads
 * destWorkerRoutes to compute the overwrite list.
 */
export async function prefetchDestForOverwrite(
  config: MigrationConfig,
  destAuth: api.ApiAuth | string,
  destZoneId: string,
  log: LogFn,
): Promise<{
  destDnsRecords: Awaited<ReturnType<typeof api.listDNSRecords>>;
  destWorkerRoutes: Awaited<ReturnType<typeof api.listWorkerRoutes>>;
}> {
  if (config.conflictStrategy !== 'overwrite') {
    return { destDnsRecords: [], destWorkerRoutes: [] };
  }
  log('🔍 Pre-fetching destination resources for overwrite...');
  const [destDnsRecords, destWorkerRoutes] = await Promise.all([
    api.listDNSRecords(destAuth, destZoneId).catch(() => []),
    api.listWorkerRoutes(destAuth, destZoneId).catch(() => []),
  ]);
  log(`  ✓ Found ${destDnsRecords.length} DNS records, ${destWorkerRoutes.length} worker routes on destination`);
  return { destDnsRecords, destWorkerRoutes };
}

// Re-export ReportSection so callers (and unused-import linters) don't trip.
export type { ReportSection };
