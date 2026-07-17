// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Setup helpers shared by migrateZone() and migrateAccountResources().
//
// These functions handle the boilerplate that any migration entry point
// needs before the real work begins: creating an empty MigrationReport,
// wiring up the progress counter that powers the wizard's progress bar,
// and building the conflict-resolution helper that asks the user (or
// follows a pre-set strategy) what to do when a resource already exists
// on the destination.
//
// Pulling these out keeps the migrate.ts orchestration recipes readable —
// they can call setup helpers, then read like a sequence of named
// steps without scaffolding noise between them.

import type { LogFn, PromptFn } from '../migrate';
import type { MigrationConfig, MigrationReport, ZoneExport } from '../types';
import { READ_ONLY_SETTINGS, BLOCKED_SETTINGS, isNoOpSetting } from './constants';
import { isManagedRuleset } from './rulesets';

/**
 * Build an empty MigrationReport seeded with the zone names + account id
 * and an empty createdResources tracker (used by the rollback list and
 * the post-migration verification page).
 */
export function createEmptyReport(
  exportData: { zone: { name: string } },
  destZoneName: string,
  destAccountId: string,
): MigrationReport {
  return {
    timestamp: new Date().toISOString(),
    sourceZone: exportData.zone.name,
    destZone: destZoneName,
    destAccountId,
    summary: { total: 0, success: 0, failed: 0, skipped: 0, acknowledged: 0 },
    sections: [],
    errors: [],
    conflicts: [],
    warnings: [],
    manualActions: [],
    newNameservers: [],
    // Track every resource we create so the rollback flow can find them later
    createdResources: {
      zoneId: undefined,
      workers: [],
      kvNamespaces: [],
      r2Buckets: [],
      d1Databases: [],
      queues: [],
      doNamespaces: [],
      dnsRecords: [],
      pageRules: [],
      rulesets: [],
      accessApps: [],
      emailRules: [],
      customHostnames: [],
      turnstileWidgets: [],
    },
    doMigrationResults: [],
  };
}

/**
 * Build the progress tracker used by the wizard's progress bar.
 *
 * Returns:
 *   • `logWithProgress(msg)` — wraps `log()` to attach the current
 *     progress fraction to every log line so the UI can update.
 *   • `onItemDone()` — call once per migrated item to bump the counter.
 *   • `bumpCompletedItems(n)` — bump by an arbitrary count (used when
 *     we acknowledge a whole batch at once, e.g. capability gaps).
 *   • `setTotal(n)` — replace the denominator. The upfront `totalItems`
 *     is only an ESTIMATE of write operations; acknowledgment-only
 *     sections (deselected groups, capability gaps, CNS pool, account-
 *     ruleset references, secondary DNS) are added dynamically during the
 *     run and inflate the final report total. Reconciling at the end keeps
 *     the completion headline ("N/total successful") consistent with the
 *     progress denominator the user saw, instead of "97" vs "129".
 *
 * This is mutable state in closure form. Cleaner than a class for our
 * use case — the migration is a single linear pass and the counter
 * isn't read by anything outside this closure.
 */
export function createProgressTracker(log: LogFn, totalItems: number) {
  let completedItems = 0;
  let total = totalItems;
  const progress = () => ({ current: completedItems, total });
  return {
    logWithProgress: (msg: string) => log(msg, progress()),
    onItemDone: () => { completedItems++; },
    bumpCompletedItems: (n: number) => { completedItems += n; },
    /** Replace the running denominator (see doc above). */
    setTotal: (n: number) => { total = n; },
    /** Read the current count — only used by the inline capability-skip
     *  block, which needs to pre-bump for acknowledged items. */
    get completed() { return completedItems; },
  };
}

/**
 * No-op section pass-through. Downstream modules call `trackSection(s)`
 * before pushing onto `report.sections` so future code can wrap or
 * instrument every section without each module being aware.
 */
export const passthroughTrackSection = <T>(s: T): T => s;

/**
 * Build the conflict-resolution helper used when a resource already
 * exists on the destination. Resolution order:
 *
 *   1. Use the pre-set strategy from `config.conflictStrategy` (chosen
  *      by the user in Step 2's Scope screen).
 *   2. Fall back to the legacy interactive prompt (kept for API
 *      consumers that drive the migration programmatically without
 *      pre-selecting a strategy).
 *   3. Default to 'skip' — the safe choice; never overwrite without
 *      explicit user intent.
 */
/**
 * Count how many items the account-resources pre-deploy phase will touch.
 * Drives the wizard's "X of Y" progress bar.
 *
 * Only counts what migrateAccountResources() actually migrates: LB
 * monitors+pools, Access apps+policies, storage (KV/R2/D1/queues),
 * workers, and Turnstile widgets. Zone-level resources (DNS, settings,
 * rulesets, etc.) are counted separately by countZoneMigrationItems().
 */
export function countAccountResourceItems(exportData: {
  monitors: unknown[];
  pools: unknown[];
  accessApps: unknown[];
  accessPolicies: unknown[];
  kvNamespaces?: unknown[];
  r2Buckets?: unknown[];
  d1Databases?: unknown[];
  queues?: unknown[];
  workers: unknown[];
  turnstileWidgets: unknown[];
}): number {
  return (
    exportData.monitors.length +
    exportData.pools.length +
    exportData.accessApps.length +
    exportData.accessPolicies.length +
    (exportData.kvNamespaces?.length || 0) +
    (exportData.r2Buckets?.length || 0) +
    (exportData.d1Databases?.length || 0) +
    (exportData.queues?.length || 0) +
    exportData.workers.length +
    exportData.turnstileWidgets.length
  );
}

/**
 * Filter rulesets down to those we'll actually migrate. Three rules:
 *   • Skip rulesets with no rules in them (empty placeholders).
 *   • Skip managed rulesets — Cloudflare ships these enabled by
 *     default; we can't (and shouldn't) re-create them on the dest.
 *
 * Used by both the totals counter and the migrate engine itself so the
 * progress bar matches what actually runs.
 */
export function filterMigrateableRulesets(rulesets: ZoneExport['rulesets']): ZoneExport['rulesets'] {
  return rulesets.filter(rs => rs.rules && rs.rules.length > 0 && !isManagedRuleset(rs));
}

/**
 * Count how many items the zone-side migration will touch.
 *
 * "Zone-side" = everything in migrateZone(): DNS, settings, page rules,
 * rulesets, LB chain, workers + routes, certs/hostnames, firewall +
 * rate limits, email + waiting rooms, storage, etc. The +1 at the
 * start is for zone creation itself.
 */
export function countZoneMigrationItems(
  exportData: ZoneExport,
  migrateableRulesets: ZoneExport['rulesets'],
  certInputsCount: number,
): number {
  const editableSettingsCount = exportData.settings.filter(s =>
    s.editable && !READ_ONLY_SETTINGS.has(s.id) && !BLOCKED_SETTINGS.has(s.id) && !isNoOpSetting(s)
  ).length;

  return 1 + // zone creation
    exportData.dnsRecords.length +
    editableSettingsCount +
    exportData.pageRules.length +
    migrateableRulesets.length +
    exportData.monitors.length +
    exportData.pools.length +
    exportData.loadBalancers.length +
    exportData.workers.length +
    exportData.workerRoutes.length +
    exportData.spectrumApps.length +
    certInputsCount +
    exportData.customHostnames.length +
    exportData.accessApps.length +
    exportData.accessPolicies.length +
    exportData.firewallRules.length +
    exportData.rateLimits.length +
    exportData.emailRoutingRules.length +
    exportData.waitingRooms.length +
    (exportData.zarazConfig ? 1 : 0) +
    exportData.turnstileWidgets.length +
    (exportData.kvNamespaces?.length || 0) +
    (exportData.r2Buckets?.length || 0) +
    (exportData.d1Databases?.length || 0) +
    (exportData.queues?.length || 0) +
    (exportData.durableObjectNamespaces?.length || 0);
}

/**
 * When the user pre-deployed account-level resources via
 * migrateAccountResources(), zero them out in the export so the zone
 * migration only handles zone-level bindings.
 *
 * IMPORTANT: monitors, pools, loadBalancers form a dependency chain
 * (monitors -> pools -> LBs are zone-level). We do NOT zero these out
 * even though monitors+pools are account-scoped — the LB step needs
 * the ID mapping chain. Workers are also kept because zone-scoped
 * worker routes reference them. Pre-existing resources get handled by
 * the conflict-resolution strategy.
 */
export function stripAccountResourcesAlreadyDeployed(
  inputExportData: ZoneExport,
  log: LogFn,
): ZoneExport {
  log('ℹ️ Account-level resources already deployed — skipping standalone account resources in zone migration');
  return {
    ...inputExportData,
    accessApps: [],
    accessPolicies: [],
    kvNamespaces: [],
    r2Buckets: [],
    d1Databases: [],
    queues: [],
    turnstileWidgets: [],
    durableObjectNamespaces: [],
  };
}

export function createConflictResolver(
  config: MigrationConfig,
  promptUser?: PromptFn,
): (category: string, resourceName: string) => Promise<'overwrite' | 'skip'> {
  return async (_category: string, resourceName: string) => {
    if (config.conflictStrategy) return config.conflictStrategy;
    if (promptUser) {
      const answer = await promptUser(
        `"${resourceName}" already exists on the destination. How should conflicts be handled?`,
        [
          { value: 'overwrite', label: 'Overwrite — replace destination data with source' },
          { value: 'skip', label: 'Skip — keep existing destination data' },
        ],
      );
      return answer === 'overwrite' ? 'overwrite' : 'skip';
    }
    return 'skip';
  };
}
