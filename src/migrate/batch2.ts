// Batch 2: Workers, Worker Routes, Spectrum, Custom Certs, Custom Hostnames,
//          Firewall Rules, Rate Limits.
//
// This phase runs *after* Batch 1 (which migrated DNS + zone settings +
// rulesets) and *before* Batch 3 (email routing + waiting rooms). Workers
// must come before Worker Routes (routes reference scripts) so the workers
// half runs sequentially across deployment levels; everything that doesn't
// depend on workers runs in parallel via `Promise.all`.
//
// The block is responsible for, in order:
//
//   1. Workers preflight:
//      - Filter workers to those that have a script (the only ones we can
//        upload).
//      - Surface Analytics-Engine-binding workers as acknowledged when the
//        dest account doesn't have AE enabled — they get pulled out of the
//        upload set so the upload doesn't fail with a binding error.
//      - Auto-create any R2 buckets / KV namespaces / D1 databases / Queues
//        referenced by a worker binding but missing from the export's
//        own resource selection. This is a No-Surprise-Failures convenience:
//        a worker that binds to `bucket: photos` shouldn't fail to upload
//        just because the user didn't tick the R2 group; we create the
//        backing resource, record the new ID in the running id-maps, and
//        the binding remap below points at the new resource.
//      - Emit the manual-binding acknowledgement section for binding types
//        the tool can never auto-migrate (service tokens, mTLS certs, etc.)
//
//   2. Workers upload:
//      - Plan a topological order over service bindings (cycle workers
//        bootstrap first without their service refs, then a normal level
//        pass).
//      - For each worker: sanitise bindings, drop bindings that point at
//        capabilities the dest account doesn't have (recorded in
//        `capGapDroppedBindings`), then upload script + bindings.
//        Worker secrets supplied through the Step 3 form are pushed
//        immediately after the script upload.
//
//   3. Parallel batch (`Promise.all`):
//      - Worker Routes (POST per zone) with source→dest hostname rewrite.
//      - Spectrum Apps (POST with traffic_type: 'direct' workaround).
//      - Custom Certificates (only when the user provided private keys).
//      - Custom Hostnames.
//      - Firewall Rules (skipped when a custom http_request_firewall_custom
//        ruleset will migrate them via the rulesets path instead).
//      - Rate Limits.
//
//   4. Capability-gap dropped-binding acknowledgement section, so the final
//      report tells the user exactly which (worker, type, name) triples got
//      dropped during upload.
//
// The block is a literal move from migrate.ts (Batch 2). Two intentional
// cleanups during extraction:
//   * Removed dead `perWorkerSecretsNeeded` map — it was populated inside
//     the workers upload callback but never read after Batch 2. The
//     account-resources flow has its own independent map; this one was a
//     leftover from an earlier draft of the missing-secrets pre-prompt.
//   * Renamed `i === 0 ? endpoint : undefined` log threshold left in place
//     (still useful to log the endpoint pattern once per deployment-level
//     loop).

import type {
  MigrationConfig,
  MigrationReport,
  ZoneExport,
  ReportSection,
  ReportItem,
  CFWorkerBinding,
  CFSpectrumApp,
} from '../types';
import * as api from '../api';
import {
  migrateItems,
  buildManualBindingAcknowledgmentSection,
  type LogFn,
} from '../migrate';
import {
  sanitizeBindingsForUpload,
  stripServiceBindings,
  filterBindingsByCapGap,
  planWorkerDeploymentLevels,
  buildAutoCreatedEmptySection,
  workerSecretManualActions,
  type AutoCreatedEmptyResource,
} from './workers';
import { MANUAL_BINDING_TYPES_REQUIRE_RECONFIG } from './constants';

export interface Batch2Deps {
  exportData: ZoneExport;
  report: MigrationReport;
  config: MigrationConfig;
  destAuth: api.ApiAuth | string;
  destAccountId: string;
  destZoneId: string;
  /** Destination zone apex name (e.g. "dest.example.com"). */
  zoneName: string;
  /**
   * The post-filter list of zone rulesets that will be migrated. Used here
   * only to decide whether a custom http_request_firewall_custom ruleset
   * will own the firewall-rules migration (in which case we skip the
   * legacy Firewall Rules endpoint to avoid double-creating them).
   */
  migrateableRulesets: ZoneExport['rulesets'];
  /**
   * Probed destination-account capabilities. `null` when capability probing
   * itself failed (in which case we skip the Analytics-Engine guard and
   * trust the upload path to surface any real binding errors).
   */
  capabilities: api.AccountCapabilities | null;
  /**
   * Set of `ZoneExport` field names that the dest account is NOT entitled
   * to migrate (e.g. "r2Buckets", "d1Databases"). Used to skip auto-create
   * for backing resources we couldn't create anyway, and to drop worker
   * bindings that point at capabilities the dest account lacks.
   */
  skipFields: Set<string>;
  /**
   * Old → new ID maps populated upstream by the account-sub-resources
   * phase. This batch may add more entries when it auto-creates backing
   * resources referenced by worker bindings.
   */
  kvIdMap: Map<string, string>;
  d1IdMap: Map<string, string>;
  /**
   * Map source Hyperdrive config id → dest config id. Populated by the
   * storage phase when the user supplied origin credentials in
   * MigrationConfig.hyperdriveOriginCredentials. Used here to rewrite
   * worker `hyperdrive` binding ids.
   */
  hyperdriveIdMap?: Map<string, string>;
  /**
   * Map source Secrets Store store id → dest store id. Populated by
   * the storage phase. Used here to rewrite worker
   * `secrets_store_secrets` binding `store_id` fields. The bindings
   * still surface a manual-reconfig warning because the secret VALUES
   * inside the store don't migrate.
   */
  secretsStoreIdMap?: Map<string, string>;
  /**
   * Per-worker secret values keyed by `workerId` → `{ secretName: value }`
   * collected from Step 3. Each entry is set as a Workers secret right
   * after the script upload.
   */
  workerSecrets: Record<string, Record<string, string>> | undefined;
  /**
   * Custom certificate {cert, privateKey, bundleMethod} tuples collected
   * from Step 3. Custom Certificates with no key are surfaced as `skipped`
   * with a manual-action message.
   */
  certInputs: Array<{ certificate: string; privateKey: string; bundleMethod?: string }> | undefined;
  /**
   * Pre-fetched destination Worker Routes used during `conflictStrategy ===
   * "overwrite"` to find an existing route by pattern, delete it, then
   * recreate.
   */
  destWorkerRoutes: Awaited<ReturnType<typeof api.listWorkerRoutes>>;
  shouldOverwrite: boolean;
  logWithProgress: LogFn;
  onItemDone: () => void;
  /**
   * Identity-function wrapper for report sections, kept symmetric with the
   * rest of `migrateZone()`. The batch calls it on every section it
   * appends so future hooks (telemetry, dry-run mode) only need to be
   * added in one place.
   */
  trackSection: (section: ReportSection) => ReportSection;
  /**
   * Counter callback for the auto-created storage section. Each
   * auto-created KV / D1 / R2 / Queue increments the wizard's progress
   * counter once.
   */
  bumpCompletedItems: (n: number) => void;
}

/**
 * Run Batch 2 of the migration. Mutates `deps.report`, `deps.kvIdMap`,
 * `deps.d1IdMap`. Calls `deps.onItemDone()` per migrated item.
 */
export async function migrateBatch2(deps: Batch2Deps): Promise<void> {
  const {
    exportData,
    report,
    destAuth,
    destAccountId,
    destZoneId,
    zoneName,
    migrateableRulesets,
    capabilities,
    skipFields,
    kvIdMap,
    d1IdMap,
    hyperdriveIdMap,
    secretsStoreIdMap,
    workerSecrets,
    certInputs,
    destWorkerRoutes,
    shouldOverwrite,
    logWithProgress,
    onItemDone,
    trackSection,
    bumpCompletedItems,
  } = deps;

  // Parallel batch 2: Workers, Routes, Spectrum, Certs, Hostnames, Firewall, Rate Limits
  logWithProgress('⏳ Migrating Workers, Routes, Spectrum, Certs, Hostnames, Firewall, Rate Limits (parallel)...');

  let workersWithScripts = exportData.workers.filter(w => w.script);

  // Skip workers with analytics_engine bindings if Analytics Engine isn't available
  if (capabilities && !capabilities.analyticsEngine.available) {
    const aeWorkers = workersWithScripts.filter(w =>
      (w.bindings || []).some(b => b.type === 'analytics_engine')
    );
    if (aeWorkers.length > 0) {
      const names = aeWorkers.map(w => w.id).join(', ');
      logWithProgress(`  ⛔ Skipping ${aeWorkers.length} worker(s) with Analytics Engine bindings: ${names}`);
      logWithProgress(`     Reason: ${capabilities.analyticsEngine.reason || 'Analytics Engine not enabled'}`);
      if (capabilities.analyticsEngine.action) logWithProgress(`     To fix: ${capabilities.analyticsEngine.action}`);
      report.warnings.push(
        `Workers with Analytics Engine bindings skipped: ${names}. ${capabilities.analyticsEngine.reason || ''} ${capabilities.analyticsEngine.action || ''}`.trim()
      );
      report.sections.push({
        name: 'Workers (Analytics Engine)',
        total: aeWorkers.length,
        success: 0,
        failed: 0,
        skipped: 0,
        acknowledged: aeWorkers.length,
        items: aeWorkers.map(w => ({
          name: w.id,
          status: 'acknowledged' as const,
          error: 'Has Analytics Engine bindings — enable Analytics Engine on the destination account first',
        })),
      });
      report.summary.total += aeWorkers.length;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + aeWorkers.length;
      bumpCompletedItems(aeWorkers.length);
      const aeWorkerIds = new Set(aeWorkers.map(w => w.id));
      workersWithScripts = workersWithScripts.filter(w => !aeWorkerIds.has(w.id));
    }
  }

  // ── Auto-create missing storage dependencies ──────────────────────────
  // Workers may reference R2 buckets, KV namespaces, D1 databases, or queues
  // that were not in the selected export set. Create them now so the worker
  // upload doesn't fail with "not found" errors.
  {
    const selectedR2Names = new Set(exportData.r2Buckets.map(b => b.name));
    const selectedKvIds = new Set(exportData.kvNamespaces.map(kv => kv.id));
    const selectedD1Ids = new Set(exportData.d1Databases.map(d => d.uuid));
    const selectedQueueNames = new Set(exportData.queues.map(q => q.queue_name));

    const missingR2 = new Set<string>();
    const missingKv = new Map<string, string>(); // namespace_id -> binding name (for title)
    const missingD1 = new Map<string, string>(); // database_id -> binding name
    const missingQueues = new Set<string>();

    for (const worker of workersWithScripts) {
      for (const b of worker.bindings || []) {
        if (b.type === 'r2_bucket' && b.bucket_name && !selectedR2Names.has(b.bucket_name)) {
          missingR2.add(b.bucket_name);
        }
        if (b.type === 'kv_namespace' && b.namespace_id && !selectedKvIds.has(b.namespace_id) && !kvIdMap.has(b.namespace_id)) {
          missingKv.set(b.namespace_id, b.name || b.namespace_id);
        }
        if (b.type === 'd1' && b.database_id && !selectedD1Ids.has(b.database_id) && !d1IdMap.has(b.database_id)) {
          missingD1.set(b.database_id, b.name || b.database_id);
        }
        if (b.type === 'queue' && b.queue_name && !selectedQueueNames.has(b.queue_name)) {
          missingQueues.add(b.queue_name);
        }
      }
    }

    const totalMissing = missingR2.size + missingKv.size + missingD1.size + missingQueues.size;
    // Track resources we actually create here so Step 4 can reflect them as
    // empty (AGENTS.md Principle 1). Only freshly-created ones are recorded —
    // "already exists" resources are left alone (their data state is unknown).
    const autoCreatedEmpty: AutoCreatedEmptyResource[] = [];
    if (totalMissing > 0) {
      logWithProgress(`  🔧 Auto-creating ${totalMissing} missing storage dependenc${totalMissing === 1 ? 'y' : 'ies'} referenced by worker bindings...`);

      // Skip auto-creation when the dest account lacks the entitlement —
      // workers referencing those bindings will be acknowledged via the
      // manual-action classifier in migrateItems (AGENTS.md principle 2).
      if (skipFields.has('r2Buckets')) {
        if (missingR2.size > 0) logWithProgress(`    ⛔ R2 not enabled on destination — ${missingR2.size} bucket(s) acknowledged`);
      } else {
        for (const bucketName of missingR2) {
          try {
            await api.createR2Bucket(destAuth, destAccountId, bucketName);
            report.createdResources!.r2Buckets.push(bucketName);
            autoCreatedEmpty.push({ type: 'R2 bucket', name: bucketName });
            logWithProgress(`    ✓ Auto-created R2 bucket "${bucketName}"`);
          } catch (e: unknown) {
            api.throwIfAuthError(e);
            const msg = (e as Error).message || '';
            if (msg.toLowerCase().includes('already exists')) {
              logWithProgress(`    ✓ R2 bucket "${bucketName}" already exists on destination`);
            } else {
              logWithProgress(`    ✗ Failed to auto-create R2 bucket "${bucketName}": ${msg}`);
              report.warnings.push(`Could not auto-create R2 bucket "${bucketName}" — workers referencing it may fail`);
            }
          }
        }
      }

      for (const [oldId, title] of missingKv) {
        try {
          const newKv = await api.createKVNamespace(destAuth, destAccountId, title);
          kvIdMap.set(oldId, newKv.id);
          report.createdResources!.kvNamespaces.push(newKv.id);
          autoCreatedEmpty.push({ type: 'KV namespace', name: title });
          logWithProgress(`    ✓ Auto-created KV namespace "${title}"`);
        } catch (e: unknown) {
          api.throwIfAuthError(e);
          const msg = (e as Error).message || '';
          if (msg.toLowerCase().includes('already exists')) {
            // Look up existing namespace to get the dest ID for binding remapping
            const existing = (await api.listKVNamespaces(destAuth, destAccountId)).find(ns => ns.title === title);
            if (existing) { kvIdMap.set(oldId, existing.id); }
            logWithProgress(`    ✓ KV namespace "${title}" already exists on destination`);
          } else {
            logWithProgress(`    ✗ Failed to auto-create KV namespace "${title}": ${msg}`);
            report.warnings.push(`Could not auto-create KV namespace "${title}" — workers referencing it may fail`);
          }
        }
      }

      if (skipFields.has('d1Databases')) {
        if (missingD1.size > 0) logWithProgress(`    ⛔ D1 not enabled on destination — ${missingD1.size} database(s) acknowledged`);
      } else {
        for (const [oldId, name] of missingD1) {
          try {
            const newDb = await api.createD1Database(destAuth, destAccountId, name);
            d1IdMap.set(oldId, newDb.uuid);
            report.createdResources!.d1Databases.push(newDb.uuid);
            autoCreatedEmpty.push({ type: 'D1 database', name });
            logWithProgress(`    ✓ Auto-created D1 database "${name}"`);
          } catch (e: unknown) {
            api.throwIfAuthError(e);
            const msg = (e as Error).message || '';
            if (msg.toLowerCase().includes('already exists')) {
              // Look up existing database to get the dest ID for binding remapping
              const existing = (await api.listD1Databases(destAuth, destAccountId)).find((d: { name: string; uuid: string }) => d.name === name);
              if (existing) { d1IdMap.set(oldId, existing.uuid); }
              logWithProgress(`    ✓ D1 database "${name}" already exists on destination`);
            } else {
              logWithProgress(`    ✗ Failed to auto-create D1 database "${name}": ${msg}`);
              report.warnings.push(`Could not auto-create D1 database "${name}" — workers referencing it may fail`);
            }
          }
        }
      }

      if (skipFields.has('queues')) {
        if (missingQueues.size > 0) logWithProgress(`    ⛔ Queues not enabled on destination — ${missingQueues.size} queue(s) acknowledged`);
      } else {
        for (const queueName of missingQueues) {
          try {
            const newQueue = await api.createQueue(destAuth, destAccountId, queueName);
            report.createdResources!.queues.push(newQueue.queue_id);
            autoCreatedEmpty.push({ type: 'Queue', name: queueName });
            logWithProgress(`    ✓ Auto-created queue "${queueName}"`);
          } catch (e: unknown) {
            api.throwIfAuthError(e);
            const msg = (e as Error).message || '';
            if (msg.toLowerCase().includes('already exists')) {
              logWithProgress(`    ✓ Queue "${queueName}" already exists on destination`);
            } else {
              logWithProgress(`    ✗ Failed to auto-create queue "${queueName}": ${msg}`);
              report.warnings.push(`Could not auto-create queue "${queueName}" — workers referencing it may fail`);
            }
          }
        }
      }
    }

    // Reflect the empty auto-created resources on the Step 4 report so the
    // user sees the outcome they acknowledged in Step 2 (No Surprise Failures).
    const emptySection = buildAutoCreatedEmptySection(autoCreatedEmpty);
    if (emptySection) {
      report.sections.push(emptySection);
      report.summary.total += emptySection.total;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + (emptySection.acknowledged ?? 0);
    }
  }

  // Track bindings dropped from worker uploads because the dest account
  // doesn't have the backing capability (R2, KV, D1, etc.). Surfaced in the
  // report as a final acknowledgment section so the user knows their worker
  // is missing functionality on dest. See `filterBindingsByCapGap`.
  const capGapDroppedBindings: Array<{ worker: string; type: string; name: string; reason: string }> = [];

  // Helper to update bindings with new resource IDs.
  // Manual / account-tied binding types are centralised in
  // MANUAL_BINDING_TYPE_TO_KEY at the top of this file; here we only emit
  // per-binding warnings for the subset that genuinely needs user action.
  // The full acknowledgment section is emitted further down.
  const updateBindingsWithNewIds = (bindings: CFWorkerBinding[], workerName?: string): CFWorkerBinding[] => {
    return bindings.map(b => {
      if (b.type === 'kv_namespace' && b.namespace_id && kvIdMap.has(b.namespace_id)) {
        return { ...b, namespace_id: kvIdMap.get(b.namespace_id)! };
      }
      if (b.type === 'd1' && b.database_id && d1IdMap.has(b.database_id)) {
        return { ...b, database_id: d1IdMap.get(b.database_id)! };
      }
      // DO bindings: remove the source namespace_id so the API auto-creates the namespace
      // on the destination account. The class_name + script_name are sufficient.
      if (b.type === 'durable_object_namespace' && b.namespace_id) {
        const { namespace_id: _, ...rest } = b;
        return rest;
      }
      // Hyperdrive bindings: remap binding's `id` to the dest config id
      // when the source config was migrated (user supplied credentials).
      // Configs without supplied credentials don't enter the map; their
      // bindings fall through to the manual-reconfig warning.
      if (b.type === 'hyperdrive' && (b as { id?: string }).id && hyperdriveIdMap?.has((b as { id: string }).id)) {
        return { ...b, id: hyperdriveIdMap.get((b as { id: string }).id)! };
      }
      // Secrets Store bindings: remap store_id but keep the warning
      // because secret VALUES don't migrate.
      if ((b.type === 'secrets_store_secret' || b.type === 'secrets_store_secrets') && (b as { store_id?: string }).store_id && secretsStoreIdMap?.has((b as { store_id: string }).store_id)) {
        const remapped = { ...b, store_id: secretsStoreIdMap.get((b as { store_id: string }).store_id)! };
        if (MANUAL_BINDING_TYPES_REQUIRE_RECONFIG.has(b.type) && workerName) {
          report.warnings.push(`Worker "${workerName}" has ${b.type} binding "${b.name}" — store_id remapped to dest store, but the secret VALUE was not migrated. Re-add secret "${(b as { secret_name?: string }).secret_name || b.name}" on the dest dashboard.`);
        }
        return remapped;
      }
      // R2 buckets, Queues, Vectorize indexes, Pipelines, Dispatch
      // namespaces all use name (not ID) so no mapping needed.
      // Per-binding warning for types that require manual reconfiguration.
      if (MANUAL_BINDING_TYPES_REQUIRE_RECONFIG.has(b.type) && workerName) {
        report.warnings.push(`Worker "${workerName}" has ${b.type} binding "${b.name}" — this references a source-account resource and must be manually reconfigured on destination`);
      }
      return b;
    });
  };

  // Emit acknowledgment section for manual/account-tied worker bindings.
  // Same shape as in migrateZone() — see comment there for the rationale.
  {
    const ack = buildManualBindingAcknowledgmentSection(workersWithScripts);
    if (ack) {
      report.sections.push(ack);
      report.summary.total += ack.total;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + ack.total;
    }
  }

  // Workers must be deployed before their routes and before any service bindings that reference them.
  const { levels, cycleWorkerIds } = planWorkerDeploymentLevels(workersWithScripts);
  if (cycleWorkerIds.size > 0) {
    const cycleWorkers = workersWithScripts.filter(w => cycleWorkerIds.has(w.id));
    logWithProgress(`  🔁 Detected ${cycleWorkers.length} worker(s) in service-binding cycle(s) — bootstrapping without service bindings...`);
    const bootstrapResults = await Promise.allSettled(
      cycleWorkers.map(async (w) => {
        try {
          const sanitized = sanitizeBindingsForUpload(stripServiceBindings(updateBindingsWithNewIds(w.bindings || [])));
          const { bindings: bindingsSansService, dropped } = filterBindingsByCapGap(sanitized, skipFields);
          for (const d of dropped) {
            capGapDroppedBindings.push({ worker: w.id, ...d });
          }
          await api.uploadWorkerScript(destAuth, destAccountId, w.id, w.script!, bindingsSansService, {
            format: w.script_format,
            main_module: w.main_module,
            modules: w.modules,
          });
        } catch (e: unknown) {
          api.throwIfAuthError(e);
          logWithProgress(`    ⚠️ Bootstrap worker ${w.id} failed: ${(e as Error).message}`);
        }
      })
    );
    for (const result of bootstrapResults) {
      if (result.status === 'rejected') api.throwIfAuthError(result.reason);
    }
  }

  let workersSection: ReportSection = { name: 'Workers', total: 0, success: 0, failed: 0, skipped: 0, items: [] };
  for (let i = 0; i < levels.length; i++) {
    const batch = levels[i];
    const sec = await migrateItems(
      'Workers',
      batch,
      async (worker) => {
        if (!worker.script) throw new Error('No script content');
        const originalBindings = worker.bindings || [];
        const sanitized = sanitizeBindingsForUpload(updateBindingsWithNewIds(originalBindings));
        const { bindings, dropped } = filterBindingsByCapGap(sanitized, skipFields);
        for (const d of dropped) {
          capGapDroppedBindings.push({ worker: worker.id, ...d });
        }

        await api.uploadWorkerScript(destAuth, destAccountId, worker.id, worker.script, bindings, {
          format: worker.script_format,
          main_module: worker.main_module,
          modules: worker.modules,
        });

        if (workerSecrets?.[worker.id]) {
          const secretEntries = Object.entries(workerSecrets[worker.id]);
          await Promise.all(
            secretEntries.map(([name, value]) =>
              api.setWorkerSecret(destAuth, destAccountId, worker.id, name, value)
            )
          );
        }

        report.createdResources!.workers.push(worker.id);
      },
      (w) => w.id,
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      i === 0 ? `PUT /accounts/${destAccountId}/workers/scripts/{script_name}` : undefined,
      shouldOverwrite ? async (worker) => {
        if (!worker.script) throw new Error('No script content');
        await api.deleteWorker(destAuth, destAccountId, worker.id).catch((e) => {
          api.throwIfAuthError(e);
          // Ignore delete failures (script may have been partially created)
        });
        const originalBindings = worker.bindings || [];
        const sanitized = sanitizeBindingsForUpload(updateBindingsWithNewIds(originalBindings));
        const { bindings, dropped } = filterBindingsByCapGap(sanitized, skipFields);
        for (const d of dropped) {
          capGapDroppedBindings.push({ worker: worker.id, ...d });
        }
        await api.uploadWorkerScript(destAuth, destAccountId, worker.id, worker.script, bindings, {
          format: worker.script_format,
          main_module: worker.main_module,
          modules: worker.modules,
        });
        if (workerSecrets?.[worker.id]) {
          const secretEntries = Object.entries(workerSecrets[worker.id]);
          await Promise.all(
            secretEntries.map(([name, value]) =>
              api.setWorkerSecret(destAuth, destAccountId, worker.id, name, value)
            )
          );
        }
        report.createdResources!.workers.push(worker.id);
      } : undefined,
    );
    workersSection = {
      ...workersSection,
      total: workersSection.total + sec.total,
      success: workersSection.success + sec.success,
      failed: workersSection.failed + sec.failed,
      skipped: workersSection.skipped + sec.skipped,
      items: [...workersSection.items, ...sec.items],
    };
  }

  // secret_text values are write-only and can't be migrated; any binding whose
  // value wasn't supplied via workerSecrets lands empty on the dest. Surface a
  // manual action so the worker isn't silently broken (Principle 1/3/4). Mirrors
  // the same guard in workers-deploy.ts via the shared helper.
  report.manualActions.push(...workerSecretManualActions(workersWithScripts, workerSecrets));

  const [
    routesSection,
    spectrumSection,
    certsSection,
    hostnamesSection,
    firewallSection,
    rateLimitsSection,
  ] = await Promise.all([
    migrateItems(
      'Worker Routes',
      exportData.workerRoutes.filter(r => r.script),
      async (route) => {
        const sourceZoneName = exportData.zone.name;
        let newPattern = route.pattern;
        if (sourceZoneName !== zoneName && route.pattern.includes(sourceZoneName)) {
          newPattern = route.pattern.replace(sourceZoneName, zoneName);
        }
        await api.createWorkerRoute(destAuth, destZoneId, newPattern, route.script);
      },
      (r) => {
        // Use rewritten destination pattern for getName so verification can match
        const sourceZoneName = exportData.zone.name;
        const destPattern = (sourceZoneName !== zoneName && r.pattern.includes(sourceZoneName))
          ? r.pattern.replace(sourceZoneName, zoneName) : r.pattern;
        return `${destPattern} -> ${r.script}`;
      },
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      `POST /zones/${destZoneId}/workers/routes`,
      shouldOverwrite ? async (route) => {
        const sourceZoneName = exportData.zone.name;
        let newPattern = route.pattern;
        if (sourceZoneName !== zoneName && route.pattern.includes(sourceZoneName)) {
          newPattern = route.pattern.replace(sourceZoneName, zoneName);
        }
        const match = destWorkerRoutes.find(r => r.pattern === newPattern);
        if (match) {
          await api.deleteWorkerRoute(destAuth, destZoneId, match.id);
        }
        await api.createWorkerRoute(destAuth, destZoneId, newPattern, route.script);
      } : undefined,
    ),
    migrateItems(
      'Spectrum Apps',
      exportData.spectrumApps,
      async (app) => {
        // Cloudflare's modern Spectrum POST endpoint rejects bodies
        // without `traffic_type: 'direct'`. The export shape from GET
        // /spectrum/apps doesn't include `traffic_type` — it's required
        // on POST and the only valid value is 'direct' for both
        // origin_dns+origin_port and origin_direct[] flavours (the API
        // returns traffic_type: 'direct' on GET regardless of which
        // origin field was used to create the app).
        //
        // Empirical: probing with `traffic_type: 'dns'` returns
        // "Failed to parse request JSON" (code 10005); omitting
        // `traffic_type` returns "json: unknown field 'tls'" or
        // "Unexpected internal server error" depending on which optional
        // fields are present. Setting `traffic_type: 'direct'` makes
        // both flavours work.
        //
        // See ESCALATION analysis 2026-05-20 e01 run report: 1 failed
        // Spectrum row with "json: unknown field 'origin_dns'" / "json:
        // unknown field 'tls'".
        type SpectrumAppPost = CFSpectrumApp & {
          origin_direct?: string[];
          traffic_type?: 'direct';
        };
        const appExt = app as SpectrumAppPost;
        const body: Partial<SpectrumAppPost> = {
          protocol: app.protocol,
          dns: app.dns,
          tls: app.tls,
          proxy_protocol: app.proxy_protocol,
          ip_firewall: app.ip_firewall,
          edge_ips: app.edge_ips,
          traffic_type: 'direct',
        };
        if (Array.isArray(appExt.origin_direct) && appExt.origin_direct.length > 0) {
          body.origin_direct = appExt.origin_direct;
        } else if (app.origin_dns?.name) {
          body.origin_dns = app.origin_dns;
          body.origin_port = app.origin_port;
        }
        await api.createSpectrumApp(destAuth, destZoneId, body);
      },
      (a) => `${a.protocol}://${a.dns.name}`,
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      `POST /zones/${destZoneId}/spectrum/apps`,
    ),
    (async () => {
      if (exportData.customCertificates.length > 0) {
        if (certInputs && certInputs.length > 0) {
          return migrateItems(
            'Custom Certificates',
            certInputs,
            async (cert) => {
              await api.uploadCustomCertificate(destAuth, destZoneId, cert.certificate, cert.privateKey, cert.bundleMethod);
            },
            (_, i) => `Certificate ${i + 1}`,
            report.errors,
            logWithProgress,
            report,
            onItemDone,
            `POST /zones/${destZoneId}/custom_certificates`,
          );
        }
        logWithProgress(`  ⚠ Custom Certificates: ${exportData.customCertificates.length} skipped (no keys provided)`);
        return {
          name: 'Custom Certificates',
          total: exportData.customCertificates.length,
          success: 0,
          failed: 0,
          skipped: exportData.customCertificates.length,
          items: exportData.customCertificates.map(c => ({
            name: c.hosts.join(', '),
            status: 'skipped' as const,
            error: 'Private key not provided — upload certificate and key manually in the Cloudflare dashboard',
          })),
        } as ReportSection;
      }
      return { name: 'Custom Certificates', total: 0, success: 0, failed: 0, skipped: 0, items: [] } as ReportSection;
    })(),
    migrateItems(
      'Custom Hostnames',
      exportData.customHostnames,
      async (hostname) => {
        await api.createCustomHostname(destAuth, destZoneId, {
          hostname: hostname.hostname,
          ssl: hostname.ssl,
          custom_origin_server: hostname.custom_origin_server,
        });
      },
      (h) => h.hostname,
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      `POST /zones/${destZoneId}/custom_hostnames`,
    ),
    (() => {
      const hasCustomFirewallRuleset = migrateableRulesets.some(
        rs => rs.phase === 'http_request_firewall_custom'
      );
      const firewallRulesToMigrate = hasCustomFirewallRuleset ? [] : exportData.firewallRules;
      if (hasCustomFirewallRuleset && exportData.firewallRules.length > 0) {
        logWithProgress(`  ⏭ Firewall Rules: skipped (migrated via rulesets http_request_firewall_custom phase)`);
      }
      return migrateItems(
        'Firewall Rules',
        firewallRulesToMigrate,
        async (rule) => {
          await api.createFirewallRule(destAuth, destZoneId, {
            paused: rule.paused,
            description: rule.description,
            action: rule.action,
            priority: rule.priority,
            // `bypass` rules require `products`; carry it through so the dest
            // create call doesn't fail with "products must be specified for
            // the 'bypass' action". Harmless for other actions.
            ...(rule.products && rule.products.length > 0 ? { products: rule.products } : {}),
            filter: { expression: rule.filter.expression, paused: rule.filter.paused },
          });
        },
        (r) => r.description || r.id,
        report.errors,
        logWithProgress,
        report,
        onItemDone,
        `POST /zones/${destZoneId}/firewall/rules`,
      );
    })(),
    migrateItems(
      'Rate Limits',
      exportData.rateLimits,
      async (rateLimit) => {
        await api.createRateLimit(destAuth, destZoneId, {
          disabled: rateLimit.disabled,
          description: rateLimit.description,
          match: rateLimit.match,
          threshold: rateLimit.threshold,
          period: rateLimit.period,
          action: rateLimit.action,
        });
      },
      (r) => r.description || r.id,
      report.errors,
      logWithProgress,
      report,
      onItemDone,
      `POST /zones/${destZoneId}/rate_limits`,
    ),
  ]);

  [workersSection, routesSection, spectrumSection, certsSection, hostnamesSection, firewallSection, rateLimitsSection].forEach(trackSection);
  report.sections.push(workersSection, routesSection, spectrumSection, certsSection, hostnamesSection, firewallSection, rateLimitsSection);

  // Emit acknowledgement section for bindings we dropped during worker
  // upload because the dest account lacks the backing capability. Each
  // entry is a (worker, type, name) triple so the user can see which
  // bindings were skipped. The worker itself uploaded successfully but
  // these specific bindings are unusable until the entitlement is added.
  if (capGapDroppedBindings.length > 0) {
    const items: ReportItem[] = capGapDroppedBindings.map(d => ({
      name: `${d.worker}: ${d.type} binding "${d.name}"`,
      status: 'acknowledged' as const,
      error: d.reason,
    }));
    const ackSection: ReportSection = {
      name: 'Worker Bindings (Capability Gap)',
      total: items.length,
      success: 0,
      failed: 0,
      skipped: 0,
      acknowledged: items.length,
      items,
    };
    report.sections.push(ackSection);
    report.summary.total += items.length;
    report.summary.acknowledged = (report.summary.acknowledged || 0) + items.length;
    bumpCompletedItems(items.length);
  }

  logWithProgress(`✓ Batch 2 complete`);
}
