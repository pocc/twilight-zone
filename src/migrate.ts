// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Top-level migration recipes. Two entry points:
//
//   migrateAccountResources(config, exportData)
//     Pre-deploys account-scoped resources (LB monitors+pools, Access,
//     storage, Pages, AI Gateway, Origin CA, Workers, Turnstile) to the
//     destination account. The wizard runs this first so the user can
//     fix entitlement gaps before zone cutover.
//
//   migrateZone(config, exportData)
//     Creates the destination zone and migrates everything zone-scoped:
//     DNS, settings, page rules, rulesets, LBs, workers + routes, certs,
//     hostnames, firewall, rate limits, email routing, waiting rooms,
//     and the various zone+account sub-resources.
//
// Each step in these two functions maps to one module under src/migrate/.
// Open that module for the API calls; this file is the playbook.

import type { MigrationConfig, MigrationReport, ZoneExport } from './types';
import { throwIfAuthError } from './api';

import { getSourceAuth, getDestAuth } from './migrate/auth';
import {
  createEmptyReport, createProgressTracker, passthroughTrackSection,
  createConflictResolver, countAccountResourceItems, countZoneMigrationItems,
  filterMigrateableRulesets, stripAccountResourcesAlreadyDeployed,
} from './migrate/setup';

// Step A — account-scoped resource modules
import { migrateLbAndAccess, migrateLoadBalancers } from './migrate/lb-access';
import { migrateStorage } from './migrate/storage';
import { migratePagesProjects } from './migrate/pages-projects';
import { migrateAiGateways } from './migrate/ai-gateway';
import { migrateOriginCaCertificates } from './migrate/origin-ca';
import { deployWorkers } from './migrate/workers-deploy';
import { migrateTurnstileWidgets } from './migrate/turnstile';

// Step B — zone-scoped preflight + migration phases
import {
  createOrFindDestZone, assignZonePlan, probeCapabilitiesAndPopulateSkipFields,
  surfaceDeselectedGroups, probeAcm, prefetchDestForOverwrite,
} from './migrate/zone-prelude';
import { migrateBatch1 } from './migrate/batch1';
import { migrateBatch2 } from './migrate/batch2';
import { migrateEmailAndWaitingRooms } from './migrate/email-and-waiting-rooms';
import { migrateZoneExtras } from './migrate/zone-extras';
import { migrateAccountSubResources } from './migrate/account-sub-resources';
import { migrateDurableObjects } from './migrate/durable-objects';
import { retallySummary, reclassifyAcknowledgedFailures } from './migrate/finalize';
import { validateMigration } from './migrate/validate-postmigrate';
import { mergeReports as _mergeReports } from './migrate/merge-reports';

// Re-exports for back-compat with src/worker/*, scripts/, tests.
// These names used to live here; consumers still import from "./migrate".
import { exportZone } from './migrate/export-zone';
import {
  analyzeError, getSuggestion as _getSuggestion, type ErrorAnalysis as _ErrorAnalysis,
} from './migrate/errors-classification';
import {
  generateDryRunPreview as _generateDryRunPreview, type DryRunPreview as _DryRunPreview,
} from './migrate/dry-run';
import { generateReportMarkdown as _generateReportMarkdown } from './migrate/report-markdown';
import { migrateItems } from './migrate/migrate-items';
import {
  buildCapabilityAcknowledgmentSection, buildManualBindingAcknowledgmentSection,
  filterExportData, computeDeselectedGroups, buildDeselectedAcknowledgmentSection,
} from './migrate/preflight';
import {
  READ_ONLY_SETTINGS, BLOCKED_SETTINGS, isNoOpSetting,
  MANUAL_BINDING_TYPE_TO_KEY, MANUAL_BINDING_TYPES_REQUIRE_RECONFIG,
} from './migrate/constants';
import { deepRewriteStrings, findEmbeddedReferences } from './migrate/transforms';
import {
  collectExecutedAccountRulesetIds, partitionAccountRulesetReferences,
  rewriteExecuteActionTargets, isManagedRuleset,
} from './migrate/rulesets';
import { dedupeCertificatePacks } from './migrate/certs';
import {
  sanitizeBindingsForUpload, filterBindingsByCapGap, buildAutoCreatedEmptySection,
  type WorkerWithBindings, type AutoCreatedEmptyResource,
} from './migrate/workers';

export type LogFn = (message: string, progress?: { current: number; total: number }) => void;
export type PromptFn = (question: string, options: { value: string; label: string }[]) => Promise<string>;

export { getSourceAuth, getDestAuth, exportZone, analyzeError, migrateItems };
export const getSuggestion = _getSuggestion;
export type ErrorAnalysis = _ErrorAnalysis;
export const generateDryRunPreview = _generateDryRunPreview;
export type DryRunPreview = _DryRunPreview;
export const generateReportMarkdown = _generateReportMarkdown;
export const mergeReports = _mergeReports;
export {
  buildCapabilityAcknowledgmentSection, buildManualBindingAcknowledgmentSection,
  filterExportData, computeDeselectedGroups, buildDeselectedAcknowledgmentSection,
  READ_ONLY_SETTINGS, BLOCKED_SETTINGS, isNoOpSetting,
  MANUAL_BINDING_TYPE_TO_KEY, MANUAL_BINDING_TYPES_REQUIRE_RECONFIG,
  deepRewriteStrings, findEmbeddedReferences,
  collectExecutedAccountRulesetIds, partitionAccountRulesetReferences,
  rewriteExecuteActionTargets, isManagedRuleset,
  dedupeCertificatePacks, sanitizeBindingsForUpload, filterBindingsByCapGap,
  buildAutoCreatedEmptySection,
};
export type { WorkerWithBindings, AutoCreatedEmptyResource };


/**
 * Pre-deploy account-scoped resources to the destination account.
 *
 * Runs everything that doesn't need a zone: LB monitors+pools, Access
 * apps+policies, storage (KV/R2/D1/Queues), Pages projects, AI
 * Gateways, Origin CA certs, Workers, Turnstile widgets. The wizard
 * runs this before migrateZone() so the user can fix any entitlement
 * gaps (R2 not enabled, Zero Trust not set up, etc.) before zone
 * cutover.
 */
export async function migrateAccountResources(
  config: MigrationConfig,
  exportData: ZoneExport,
  log: LogFn = console.log,
  promptUser?: PromptFn,
): Promise<MigrationReport> {
  const sourceAuth = getSourceAuth(config);
  const destAuth = getDestAuth(config);
  const { sourceAccountId, destAccountId, workerSecrets } = config;

  const totalItems = countAccountResourceItems(exportData);
  const { logWithProgress, onItemDone, bumpCompletedItems, setTotal } = createProgressTracker(log, totalItems);
  const trackSection = passthroughTrackSection;
  const resolveConflict = createConflictResolver(config, promptUser);
  const report = createEmptyReport(exportData, config.domainName || exportData.zone.name, destAccountId);

  logWithProgress('🚀 Deploying account-level resources...');
  // Estimate; capability-gap acknowledgments added during the run grow the
  // final total. setTotal() reconciles it before the completion headline.
  log(`📊 Total account-level items (estimated): ${totalItems}`, { current: 0, total: totalItems });

  // Pre-acknowledge any dest-account entitlement gaps (R2/D1/Workers/etc.)
  // so they surface in the report instead of failing later.
  const { capabilities, skipFields, acknowledgedItems } =
    await probeCapabilitiesAndPopulateSkipFields(
      destAuth, destAccountId, exportData, /* migrateableRulesets */ [],
      report, logWithProgress,
    );
  bumpCompletedItems(acknowledgedItems);

  // LB monitors → pools, Access apps → policies (parent-child chains).
  await migrateLbAndAccess(exportData, report, {
    destAuth, destAccountId, skipFields,
    sourceZoneName: exportData.zone.name,
    destZoneName: config.domainName || exportData.zone.name,
    log: logWithProgress, trackSection, onItemDone,
  });

  // Storage. Returns id maps consumed by deployWorkers() below to
  // rewrite worker bindings from source → destination ids.
  const { kvIdMap, d1IdMap, hyperdriveIdMap, secretsStoreIdMap } = await migrateStorage(config, exportData, report, {
    destAuth, destAccountId, sourceAuth, sourceAccountId, skipFields,
    log: logWithProgress, trackSection, onItemDone, resolveConflict,
  });

  await migratePagesProjects(exportData, report, {
    destAuth, destAccountId,
    log: logWithProgress, trackSection, onItemDone, resolveConflict,
  });

  await migrateAiGateways(exportData, report, {
    destAuth, destAccountId,
    log: logWithProgress, trackSection, onItemDone, resolveConflict,
    aiGatewayProviderApiKeys: config.aiGatewayProviderApiKeys,
  });

  await migrateOriginCaCertificates(config, exportData, report, {
    destAuth, log: logWithProgress, trackSection, onItemDone,
  });

  await deployWorkers(exportData, report, {
    destAuth, destAccountId, skipFields, capabilities,
    kvIdMap, d1IdMap, hyperdriveIdMap, secretsStoreIdMap, workerSecrets,
    log: logWithProgress, trackSection, onItemDone, bumpCompletedItems,
  });

  await migrateTurnstileWidgets(exportData, report, {
    destAuth, destAccountId,
    log: logWithProgress, trackSection, onItemDone, bumpCompletedItems,
  });

  // Re-tally because the capability-skip block bumped summary inline.
  retallySummary(report);
  // Reconcile the live progress denominator with the real final total.
  setTotal(report.summary.total);

  const ok = report.summary.success + report.summary.skipped;
  const parts = [`${report.summary.success} created`];
  if (report.summary.skipped > 0) parts.push(`${report.summary.skipped} already existed`);
  if ((report.summary.acknowledged || 0) > 0) parts.push(`${report.summary.acknowledged} acknowledged`);
  if (report.summary.failed > 0) parts.push(`${report.summary.failed} failed`);
  logWithProgress(`✅ Account resources deployed! ${ok}/${report.summary.total} ready (${parts.join(', ')})`);

  return report;
}


/**
 * Create the destination zone and migrate every zone-scoped resource.
 *
 * If the caller already ran migrateAccountResources() and set
 * `config.skipAccountResources`, the account-scoped slices of
 * `exportData` are zeroed out before migration so we only handle zone
 * wiring. Otherwise this function handles both layers.
 *
 * `rawExportDataForDeselectDiagnostics` (optional) is the unfiltered
 * export. When supplied, the prelude emits acknowledgment sections for
 * groups the user unchecked in Step 2 — without it those items just
 * silently disappear from the report.
 */
export async function migrateZone(
  config: MigrationConfig,
  inputExportData: ZoneExport,
  log: LogFn = console.log,
  promptUser?: PromptFn,
  rawExportDataForDeselectDiagnostics?: ZoneExport,
): Promise<MigrationReport> {
  const sourceAuth = getSourceAuth(config);
  const destAuth = getDestAuth(config);
  const { sourceAccountId, destAccountId, domainName, workerSecrets, customCertificates: certInputs } = config;
  const zoneName = domainName || inputExportData.zone.name;

  const exportData = config.skipAccountResources
    ? stripAccountResourcesAlreadyDeployed(inputExportData, log)
    : inputExportData;

  const migrateableRulesets = filterMigrateableRulesets(exportData.rulesets);
  const totalItems = countZoneMigrationItems(exportData, migrateableRulesets, certInputs?.length || 0);
  const { logWithProgress, onItemDone, bumpCompletedItems, setTotal } = createProgressTracker(log, totalItems);
  const trackSection = passthroughTrackSection;
  const resolveConflict = createConflictResolver(config, promptUser);
  const report = createEmptyReport(exportData, zoneName, destAccountId);

  logWithProgress('🚀 Starting migration...');
  // Estimate of write operations. Acknowledgment-only sections (deselected
  // groups, capability gaps, CNS pool, account-ruleset refs, secondary DNS)
  // are added during the run and grow the final total; setTotal() reconciles
  // it before the completion headline so the two numbers agree.
  log(`📊 Total items to migrate (estimated): ${totalItems}`, { current: 0, total: totalItems });

  // ─── Prelude: zone creation + plan + capability probes ───
  const { newZone } = await createOrFindDestZone(destAuth, destAccountId, zoneName, report, logWithProgress);
  bumpCompletedItems(1);
  const destZoneId = newZone.id;

  await assignZonePlan(config, exportData, newZone, destZoneId, destAuth, report, logWithProgress);

  const { capabilities, skipFields, acknowledgedItems: capAck } =
    await probeCapabilitiesAndPopulateSkipFields(
      destAuth, destAccountId, exportData, migrateableRulesets,
      report, logWithProgress,
    );
  bumpCompletedItems(capAck);

  const deselectedAck = surfaceDeselectedGroups(
    config, rawExportDataForDeselectDiagnostics, report, logWithProgress,
  );
  bumpCompletedItems(deselectedAck);

  const acmAvailable = await probeAcm(destAuth, destZoneId, exportData, report, logWithProgress);
  const { destDnsRecords, destWorkerRoutes } = await prefetchDestForOverwrite(
    config, destAuth, destZoneId, logWithProgress,
  );
  const shouldOverwrite = config.conflictStrategy === 'overwrite';

  // ─── Batch 1: DNS → account rulesets → settings/page rules/rulesets ───
  await migrateBatch1({
    exportData, report, config,
    destAuth, destAccountId, destZoneId, zoneName,
    migrateableRulesets, acmAvailable, destDnsRecords,
    logWithProgress, onItemDone,
  });

  // ─── LB chain (monitors → pools → load balancers) + Access ───
  const { poolIdMap } = await migrateLbAndAccess(exportData, report, {
    destAuth, destAccountId, skipFields,
    sourceZoneName: exportData.zone.name,
    destZoneName: zoneName,
    log: logWithProgress, trackSection, onItemDone,
  });
  await migrateLoadBalancers(exportData, poolIdMap, report, {
    destAuth, destZoneId, log: logWithProgress, trackSection, onItemDone,
  });

  // ─── Storage (must run before Batch 2 — Workers needs id maps) ───
  const { kvIdMap, d1IdMap, hyperdriveIdMap, secretsStoreIdMap } = await migrateStorage(config, exportData, report, {
    destAuth, destAccountId, sourceAuth, sourceAccountId, skipFields,
    log: logWithProgress, trackSection, onItemDone, resolveConflict,
  });

  // ─── Batch 2: workers + routes, Spectrum, certs, hostnames, firewall, rate limits ───
  await migrateBatch2({
    exportData, report, config,
    destAuth, destAccountId, destZoneId, zoneName,
    migrateableRulesets, capabilities, skipFields,
    kvIdMap, d1IdMap, hyperdriveIdMap, secretsStoreIdMap, workerSecrets, certInputs,
    destWorkerRoutes, shouldOverwrite,
    logWithProgress, onItemDone, trackSection, bumpCompletedItems,
  });

  // ─── Batch 3: email routing + waiting rooms ───
  await migrateEmailAndWaitingRooms({
    exportData, report, config,
    destAuth, destAccountId, destZoneId, zoneName,
    logWithProgress, onItemDone,
  });

  // ─── Zone extras (managed headers, snippets, healthchecks, cert packs, ...) ───
  await migrateZoneExtras({
    exportData, report, destAuth, destZoneId, destAccountId,
    logWithProgress, onItemDone,
    aopMtlsBundles: config.aopMtlsBundles,
    tsigSecrets: config.tsigSecrets,
  });

  // ─── Account sub-resources (Access IdPs, custom lists, Zaraz, Argo, Bot Mgmt, ...) ───
  await migrateAccountSubResources({
    exportData, report,
    destAuth, destAccountId, destZoneId,
    logWithProgress, onItemDone, shouldOverwrite,
    notificationWebhookSecrets: config.notificationWebhookSecrets,
    identityProviderSecrets: config.identityProviderSecrets,
  });

  // ─── Durable Objects (data copy is opt-in via config.doMigration) ───
  await migrateDurableObjects(
    config, exportData, sourceAuth, destAuth,
    sourceAccountId, destAccountId, report, logWithProgress,
  );

  // ─── Finalize ───
  retallySummary(report);
  reclassifyAcknowledgedFailures(config, report, logWithProgress);
  // Reconcile the live progress denominator with the real final total (the
  // upfront number was only an estimate of write ops) so the headline below and
  // the progress bar agree.
  setTotal(report.summary.total);
  logWithProgress(`✅ Migration complete! ${report.summary.success}/${report.summary.total} successful`);

  // Post-migration GET-back validation drives Step 4's badge counts.
  if (!config.dryRun && destZoneId) {
    try {
      report.validation = await validateMigration(
        destAuth, destAccountId, destZoneId, report, exportData, logWithProgress,
        exportData.zone.name, zoneName,
      );
    } catch (e: unknown) {
      throwIfAuthError(e);
      logWithProgress(`⚠ Validation failed: ${(e as Error)?.message || String(e)}`);
    }
  }

  return report;
}
