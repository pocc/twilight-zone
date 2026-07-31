// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Workers deploy phase — runs inside migrateAccountResources() after
// LB/Access + Storage have populated their id maps. Distinct from the
// zone-side Workers block in Batch 2 (src/migrate/batch2.ts), which
// deploys workers referenced by zone-scoped worker routes; the
// account-side path here deploys ALL workers selected for migration.
//
// Phases inside this module:
//   1. Filter exportData.workers to those with scripts.
//   2. Acknowledge workers requiring Analytics Engine when AE is not
//      entitled on dest (Principle 1 — surface, don't fail silently).
//   3. Auto-create storage dependencies the user didn't include in
//      their selection (R2 buckets / KV namespaces / D1 / Queues that
//      worker bindings reference). Respects skipFields so capability-
//      gap acks pass through untouched.
//   4. Emit a single per-worker acknowledgment section for manual
//      bindings (Secrets Store, mTLS certs, Hyperdrive, Vectorize,
//      AI Gateway, etc. — anything that references a source-account
//      resource the engine can't auto-port).
//   5. Plan deployment levels (topological sort by service-binding
//      dependency) + bootstrap service-binding cycles by uploading
//      worker bodies WITHOUT their cyclic service bindings first.
//   6. Upload each level via migrateItems, rewriting bindings to the
//      dest namespace_id / database_id values, and apply secrets from
//      config.workerSecrets when provided.
//
// Workers in cycle bootstraps are uploaded twice: once with
// stripServiceBindings (to break the cycle) and once again as part of
// their real level (with full bindings). The second upload is what
// counts; the bootstrap is a service-creation pre-step.

import type {
  MigrationReport, ZoneExport, ReportSection, ReportItem,
  CFWorkerBinding,
} from '../types';
import type { LogFn } from '../migrate';
import * as api from '../api';
import { migrateItems } from './migrate-items';
import {
  sanitizeBindingsForUpload, stripServiceBindings,
  planWorkerDeploymentLevels,
  buildAutoCreatedEmptySection,
  workerSecretManualActions,
  filterBindingsByCapGap,
  type AutoCreatedEmptyResource,
} from './workers';
import { buildManualBindingAcknowledgmentSection } from './preflight';
import { MANUAL_BINDING_TYPES_REQUIRE_RECONFIG } from './constants';

export interface WorkersDeployDeps {
  destAuth: api.ApiAuth | string;
  destAccountId: string;
  skipFields: Set<string>;
  capabilities: api.AccountCapabilities | null;
  kvIdMap: Map<string, string>;
  d1IdMap: Map<string, string>;
  /** Map source Hyperdrive config id → dest config id, for rewriting
   *  worker `hyperdrive` binding ids. Configs without supplied origin
   *  credentials are absent from this map (see
   *  hyperdrive_origin_credentials IMPOSSIBLE entry); their bindings
   *  still get a manual-reconfig warning. */
  hyperdriveIdMap?: Map<string, string>;
  /** Map source Secrets Store store id → dest store id, for rewriting
   *  worker `secrets_store_secrets` binding `store_id` fields. Even
   *  with the store_id remapped, the binding still surfaces a
   *  manual-reconfig warning because the secret VALUES inside the
   *  store don't migrate — the user must re-populate each secret on
   *  the dest dashboard. The binding's `secret_name` is preserved so
   *  no further changes are needed once the value is in place. */
  secretsStoreIdMap?: Map<string, string>;
  workerSecrets?: Record<string, Record<string, string>>;
  log: LogFn;
  trackSection: (s: ReportSection) => ReportSection;
  onItemDone: () => void;
  bumpCompletedItems: (n: number) => void;
}

export async function deployWorkers(
  exportData: ZoneExport,
  report: MigrationReport,
  deps: WorkersDeployDeps,
): Promise<void> {
  const {
    destAuth, destAccountId, skipFields, capabilities,
    kvIdMap, d1IdMap, hyperdriveIdMap, secretsStoreIdMap, workerSecrets, log, trackSection, onItemDone,
    bumpCompletedItems,
  } = deps;

  if (skipFields.has('workers') || exportData.workers.length === 0) return;

  let workersWithScripts = exportData.workers.filter(w => w.script);

  // ── Phase 2: Skip AE-bound workers when AE not available ──
  if (capabilities && !capabilities.analyticsEngine.available) {
    const aeWorkers = workersWithScripts.filter(w => (w.bindings || []).some(b => b.type === 'analytics_engine'));
    if (aeWorkers.length > 0) {
      log(`  ⛔ Skipping ${aeWorkers.length} worker(s) requiring Analytics Engine`);
      report.sections.push({
        name: 'Workers (Analytics Engine)', total: aeWorkers.length, success: 0, failed: 0, skipped: 0, acknowledged: aeWorkers.length,
        items: aeWorkers.map(w => ({ name: w.id, status: 'acknowledged' as const, error: 'Analytics Engine not enabled on destination account' })),
      });
      report.summary.total += aeWorkers.length;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + aeWorkers.length;
      bumpCompletedItems(aeWorkers.length);
      const ids = new Set(aeWorkers.map(w => w.id));
      workersWithScripts = workersWithScripts.filter(w => !ids.has(w.id));
    }
  }

  // ── Phase 3: Auto-create missing storage deps ──
  {
    const selR2 = new Set(exportData.r2Buckets.map(b => b.name));
    const selKv = new Set(exportData.kvNamespaces.map(kv => kv.id));
    const selD1 = new Set(exportData.d1Databases.map(d => d.uuid));
    const selQueues = new Set(exportData.queues?.map(q => q.queue_name) || []);
    const missingR2 = new Set<string>();
    const missingKv = new Map<string, string>();
    const missingD1 = new Map<string, string>();
    const missingQueues = new Set<string>();
    for (const w of workersWithScripts) {
      for (const b of w.bindings || []) {
        if (b.type === 'r2_bucket' && b.bucket_name && !selR2.has(b.bucket_name)) missingR2.add(b.bucket_name);
        if (b.type === 'kv_namespace' && b.namespace_id && !selKv.has(b.namespace_id) && !kvIdMap.has(b.namespace_id)) missingKv.set(b.namespace_id, b.name || b.namespace_id);
        if (b.type === 'd1' && b.database_id && !selD1.has(b.database_id) && !d1IdMap.has(b.database_id)) missingD1.set(b.database_id, b.name || b.database_id);
        if (b.type === 'queue' && b.queue_name && !selQueues.has(b.queue_name)) missingQueues.add(b.queue_name);
      }
    }
    const totalMissing = missingR2.size + missingKv.size + missingD1.size + missingQueues.size;
    // Track freshly auto-created (empty) resources so Step 4 reflects the
    // outcome the user acknowledged in Step 2 (AGENTS.md Principle 1).
    const autoCreatedEmpty: AutoCreatedEmptyResource[] = [];
    if (totalMissing > 0) {
      log(`  🔧 Auto-creating ${totalMissing} missing storage dependencies...`);
      // Skip auto-creation when the dest account lacks the entitlement —
      // workers referencing those bindings will be acknowledged via the
      // manual-action classifier in migrateItems.
      if (skipFields.has('r2Buckets')) {
        if (missingR2.size > 0) log(`    ⛔ R2 not enabled on destination — ${missingR2.size} bucket(s) skipped`);
      } else {
        for (const name of missingR2) {
          try { await api.createR2Bucket(destAuth, destAccountId, name); report.createdResources!.r2Buckets.push(name); autoCreatedEmpty.push({ type: 'R2 bucket', name }); log(`    ✓ R2 "${name}"`); }
          catch (e: unknown) { api.throwIfAuthError(e); if ((e as Error).message?.toLowerCase().includes('already exists')) log(`    ✓ R2 "${name}" exists`); else log(`    ✗ R2 "${name}": ${(e as Error).message}`); }
        }
      }
      for (const [oldId, title] of missingKv) {
        try { const n = await api.createKVNamespace(destAuth, destAccountId, title); kvIdMap.set(oldId, n.id); report.createdResources!.kvNamespaces.push(n.id); autoCreatedEmpty.push({ type: 'KV namespace', name: title }); log(`    ✓ KV "${title}"`); }
        catch (e: unknown) {
          api.throwIfAuthError(e);
          if ((e as Error).message?.toLowerCase().includes('already exists')) {
            const existing = (await api.listKVNamespaces(destAuth, destAccountId)).find(ns => ns.title === title);
            if (existing) { kvIdMap.set(oldId, existing.id); log(`    ✓ KV "${title}" exists`); }
          } else log(`    ✗ KV "${title}": ${(e as Error).message}`);
        }
      }
      if (skipFields.has('d1Databases')) {
        if (missingD1.size > 0) log(`    ⛔ D1 not enabled on destination — ${missingD1.size} database(s) skipped`);
      } else {
        for (const [oldId, name] of missingD1) {
          try { const n = await api.createD1Database(destAuth, destAccountId, name); d1IdMap.set(oldId, n.uuid); report.createdResources!.d1Databases.push(n.uuid); autoCreatedEmpty.push({ type: 'D1 database', name }); log(`    ✓ D1 "${name}"`); }
          catch (e: unknown) {
            api.throwIfAuthError(e);
            if ((e as Error).message?.toLowerCase().includes('already exists')) {
              const existing = (await api.listD1Databases(destAuth, destAccountId)).find((d: { name: string; uuid: string }) => d.name === name);
              if (existing) { d1IdMap.set(oldId, existing.uuid); log(`    ✓ D1 "${name}" exists`); }
            } else log(`    ✗ D1 "${name}": ${(e as Error).message}`);
          }
        }
      }
      if (skipFields.has('queues')) {
        if (missingQueues.size > 0) log(`    ⛔ Queues not enabled on destination — ${missingQueues.size} queue(s) skipped`);
      } else {
        for (const queueName of missingQueues) {
          try { const nq = await api.createQueue(destAuth, destAccountId, queueName); report.createdResources!.queues.push(nq.queue_id); autoCreatedEmpty.push({ type: 'Queue', name: queueName }); log(`    ✓ Queue "${queueName}"`); }
          catch (e: unknown) {
            api.throwIfAuthError(e);
            if ((e as Error).message?.toLowerCase().includes('already exists')) log(`    ✓ Queue "${queueName}" exists`);
            else { log(`    ✗ Queue "${queueName}": ${(e as Error).message}`); report.warnings.push(`Could not auto-create queue "${queueName}" — workers referencing it may fail`); }
          }
        }
      }
    }

    // Reflect the empty auto-created resources on the Step 4 report (No
    // Surprise Failures — the user acknowledged this in Step 2).
    const emptySection = buildAutoCreatedEmptySection(autoCreatedEmpty);
    if (emptySection) {
      report.sections.push(emptySection);
      report.summary.total += emptySection.total;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + (emptySection.acknowledged ?? 0);
    }
  }

  log('⏳ Workers...');

  // Rewrite worker bindings to point at dest-account resources.
  // - KV / D1: substitute mapped ids when we know the dest id.
  // - DO namespaces: strip namespace_id so the API auto-creates the namespace.
  // - Manual-reconfig bindings: surface a per-binding warning (the
  //   acknowledgment section below covers all bindings; the warning
  //   here gives users a per-worker pointer when reading logs).
  const updateBindingsWithNewIds = (bindings: CFWorkerBinding[], workerName?: string): CFWorkerBinding[] => {
    return bindings.map((b: CFWorkerBinding) => {
      if (b.type === 'kv_namespace' && b.namespace_id && kvIdMap.has(b.namespace_id)) return { ...b, namespace_id: kvIdMap.get(b.namespace_id)! };
      if (b.type === 'd1' && b.database_id && d1IdMap.has(b.database_id)) return { ...b, database_id: d1IdMap.get(b.database_id)! };
      if (b.type === 'durable_object_namespace' && b.namespace_id) { const { namespace_id: _ignored, ...rest } = b; return rest; }
      // Hyperdrive bindings: remap binding's `id` field when the source
      // config was migrated successfully (i.e. user supplied credentials).
      // The Hyperdrive binding shape uses `id` (not namespace_id /
      // database_id) per the CF Workers API. When the source config
      // wasn't migrated (no credentials supplied), fall through to the
      // manual-reconfig warning so the user knows to fix it.
      if (b.type === 'hyperdrive' && (b as { id?: string }).id && hyperdriveIdMap?.has((b as { id: string }).id)) {
        return { ...b, id: hyperdriveIdMap.get((b as { id: string }).id)! };
      }
      // Secrets Store bindings: remap `store_id` when the source store
      // was created on dest. The secret VALUES inside the store don't
      // migrate, so the binding STILL needs a manual-reconfig warning
      // (the user must re-populate each secret on the dest dashboard
      // after migration). To preserve that warning, remap store_id but
      // also fall through to the warn check below.
      if ((b.type === 'secrets_store_secret' || b.type === 'secrets_store_secrets') && (b as { store_id?: string }).store_id && secretsStoreIdMap?.has((b as { store_id: string }).store_id)) {
        const remapped = { ...b, store_id: secretsStoreIdMap.get((b as { store_id: string }).store_id)! };
        // Don't early-return — let the manual-reconfig warning still
        // fire since secret VALUES weren't migrated.
        if (MANUAL_BINDING_TYPES_REQUIRE_RECONFIG.has(b.type) && workerName) {
          report.warnings.push(`Worker "${workerName}" has ${b.type} binding "${b.name}" — store_id remapped to dest store, but the secret VALUE was not migrated. Re-add secret "${(b as { secret_name?: string }).secret_name || b.name}" on the dest dashboard.`);
        }
        return remapped;
      }
      if (MANUAL_BINDING_TYPES_REQUIRE_RECONFIG.has(b.type) && workerName) {
        report.warnings.push(`Worker "${workerName}" has ${b.type} binding "${b.name}" — this references a source-account resource and must be manually reconfigured on destination`);
      }
      return b;
    });
  };

  // ── Phase 4: Emit a single ack section for manual bindings ──
  {
    const ack = buildManualBindingAcknowledgmentSection(workersWithScripts);
    if (ack) {
      report.sections.push(ack);
      report.summary.total += ack.total;
      report.summary.acknowledged = (report.summary.acknowledged || 0) + ack.total;
    }
  }

  // Track bindings dropped from worker uploads because the dest account
  // doesn't have the backing capability (R2, D1, Queues, etc.). Surfaced in
  // the report as a final acknowledgment section so the user knows their
  // worker is missing functionality on dest — NOT a hard failure. Mirrors the
  // zone-side handling in batch2.ts. See `filterBindingsByCapGap`.
  const capGapDroppedBindings: Array<{ worker: string; type: string; name: string; reason: string }> = [];

  // ── Phase 5: Plan deployment levels + bootstrap service-binding cycles ──
  const { levels, cycleWorkerIds } = planWorkerDeploymentLevels(workersWithScripts);

  if (cycleWorkerIds.size > 0) {
    const cycleWorkers = workersWithScripts.filter(w => cycleWorkerIds.has(w.id));
    log(`  🔁 Detected ${cycleWorkers.length} worker(s) in service-binding cycle(s) — bootstrapping without service bindings...`);
    const bootstrapResults = await Promise.allSettled(
      cycleWorkers.map(async (w) => {
        try {
          const sanitized = sanitizeBindingsForUpload(stripServiceBindings(updateBindingsWithNewIds(w.bindings || [])));
          const { bindings: bindingsSansService, dropped } = filterBindingsByCapGap(sanitized, skipFields);
          for (const d of dropped) capGapDroppedBindings.push({ worker: w.id, ...d });
          await api.uploadWorkerScript(destAuth, destAccountId, w.id, w.script!, bindingsSansService, {
            format: w.script_format,
            main_module: w.main_module,
            modules: w.modules,
          });
        } catch (e: unknown) {
          api.throwIfAuthError(e);
          log(`    ⚠️ Bootstrap worker ${w.id} failed: ${(e as Error).message}`);
        }
      })
    );
    for (const result of bootstrapResults) {
      if (result.status === 'rejected') api.throwIfAuthError(result.reason);
    }
  }

  // ── Phase 6: Upload each level + apply secrets ──
  const combined: ReportSection = {
    name: 'Workers', total: 0, success: 0, failed: 0, skipped: 0, items: [],
  };
  for (let i = 0; i < levels.length; i++) {
    const batch = levels[i];
    const sec = await migrateItems(
      'Workers',
      batch,
      async (w) => {
        const sanitized = sanitizeBindingsForUpload(updateBindingsWithNewIds(w.bindings || []));
        const { bindings: updatedBindings, dropped } = filterBindingsByCapGap(sanitized, skipFields);
        for (const d of dropped) capGapDroppedBindings.push({ worker: w.id, ...d });
        await api.uploadWorkerScript(destAuth, destAccountId, w.id, w.script!, updatedBindings, {
          format: w.script_format,
          main_module: w.main_module,
          modules: w.modules,
        });
        report.createdResources!.workers.push(w.id);
        // Apply secrets
        const secretBindings = updatedBindings.filter(b => b.type === 'secret_text');
        if (secretBindings.length > 0 && workerSecrets?.[w.id]) {
          for (const sb of secretBindings) {
            const name = sb.name || '';
            const val = workerSecrets[w.id]?.[name];
            if (val) {
              try { await api.setWorkerSecret(destAuth, destAccountId, w.id, name, val); }
              catch (e) { api.throwIfAuthError(e); log(`    ⚠️ Secret "${name}" on ${w.id}: ${(e as Error).message}`); }
            }
          }
        }
      },
      (w) => w.id,
      report.errors,
      log,
      report,
      onItemDone,
      i === 0 ? `PUT /accounts/${destAccountId}/workers/scripts/{name}` : undefined,
    );
    combined.total += sec.total;
    combined.success += sec.success;
    combined.failed += sec.failed;
    combined.skipped += sec.skipped;
    combined.items.push(...sec.items);
  }
  report.sections.push(trackSection(combined));

  // Emit acknowledgement section for bindings dropped during worker upload
  // because the dest account lacks the backing capability (R2/D1/Queues).
  // The worker itself uploaded successfully; these specific bindings are
  // unusable until the entitlement is added. Without this, the upload would
  // hard-fail (e.g. code 10085 "R2 bucket not found") — a Principle 1
  // surprise failure. Mirrors batch2.ts.
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

  // Worker secret_text VALUES are write-only — they cannot be read from the
  // source account, so any secret_text binding whose value wasn't supplied via
  // workerSecrets lands EMPTY on the destination and the worker is silently
  // broken until the user re-adds it. Surface a manual action (Principle 1/3/4)
  // mirroring the IMPOSSIBLE_TO_MIGRATE "Worker Secrets" guidance. (Step 2 shows
  // this pre-migration too; the report must also carry it so the post-migration
  // record is honest about what still needs doing.)
  report.manualActions.push(...workerSecretManualActions(workersWithScripts, workerSecrets));
}
