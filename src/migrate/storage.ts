// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Account-scoped storage: KV Namespaces, R2 Buckets (+ data copy + sub-configs),
// D1 Databases, and Queues.
//
// Storage resources are account-scoped, not zone-scoped, so they live in
// the migrateAccountResources() pre-deploy phase. The Workers block that
// runs later reads kvIdMap/d1IdMap from this module to rewrite worker
// binding namespace_ids / database_ids — that's the only reason this is
// not a "fire and forget" extraction.
//
// What this handles:
//   • KV: create namespace + list/copy all keys (with KV_COPY_CONCURRENCY
//     batching). Existing namespaces are mapped (source id -> dest id) so
//     worker bindings still resolve.
//   • R2: create bucket + apply CORS/lifecycle/managed-domain sub-configs.
//     If r2Credentials are provided in config, also bulk-copies bucket
//     objects via the migrateR2BucketData helper (S3 API path).
//   • D1: create database. Schema/data is NOT migrated here — that's
//     IMPOSSIBLE_TO_MIGRATE.data_offline and surfaces as a manual action.
//   • Queues: create queue. Messages in flight are ephemeral
//     (IMPOSSIBLE_TO_MIGRATE.data_ephemeral).
//
// All four sub-blocks respect `skipFields` so capability-gap acks
// (R2/D1/Queues not entitled on dest) elide the API calls cleanly.

import type {
  MigrationConfig, MigrationReport, ZoneExport, ReportSection,
} from '../types';
import type { LogFn } from '../migrate';
import * as api from '../api';
import { migrateItems } from '../migrate';
import { migrateR2BucketData } from '../r2-migrate';
import { KV_COPY_CONCURRENCY } from './constants';
import { isConflictError } from './errors';

export interface StorageDeps {
  destAuth: api.ApiAuth | string;
  destAccountId: string;
  sourceAuth: api.ApiAuth | string;
  sourceAccountId: string;
  skipFields: Set<string>;
  log: LogFn;
  trackSection: (s: ReportSection) => ReportSection;
  onItemDone: () => void;
  resolveConflict: (cat: string, name: string) => Promise<'overwrite' | 'skip'>;
}

export interface StorageResult {
  /**
   * Map of source KV namespace id -> destination KV namespace id. Read by
   * the Workers block to rewrite worker `kv_namespace` bindings.
   */
  kvIdMap: Map<string, string>;
  /**
   * Map of source D1 database uuid -> destination D1 database uuid. Read
   * by the Workers block to rewrite worker `d1` bindings.
   */
  d1IdMap: Map<string, string>;
  /**
   * Map of source Hyperdrive config id -> destination config id. Read by
   * the Workers block to rewrite worker `hyperdrive` bindings.
   */
  hyperdriveIdMap: Map<string, string>;
  /**
   * Map of source Secrets Store store id -> destination store id. Read by
   * the Workers block to rewrite worker `secrets_store_secrets` binding
   * `store_id` fields. Note: the secret VALUES inside each store are
   * write-only and don't migrate — the user must re-populate them on
   * the dest dashboard. See worker_binding_secrets_store IMPOSSIBLE entry.
   */
  secretsStoreIdMap: Map<string, string>;
}

export async function migrateStorage(
  config: MigrationConfig,
  exportData: ZoneExport,
  report: MigrationReport,
  deps: StorageDeps,
): Promise<StorageResult> {
  const {
    destAuth, destAccountId, sourceAuth, sourceAccountId, skipFields,
    log, trackSection, onItemDone, resolveConflict,
  } = deps;

  const kvIdMap = new Map<string, string>();
  const d1IdMap = new Map<string, string>();
  const hyperdriveIdMap = new Map<string, string>();
  const secretsStoreIdMap = new Map<string, string>();

  if (exportData.kvNamespaces.length > 0) {
    log('⏳ KV Namespaces...');
    const sec = await migrateItems('KV Namespaces', exportData.kvNamespaces, async (kv) => {
      log(`    ⏳ Creating namespace "${kv.title}"...`);
      let newId: string;
      try {
        const n = await api.createKVNamespace(destAuth, destAccountId, kv.title);
        newId = n.id;
        report.createdResources!.kvNamespaces.push(newId);
        log(`    ✓ Created "${kv.title}" (${newId.slice(0, 8)}...)`);
      } catch (e: unknown) {
        const msg = (e as Error).message || '';
        if (msg.toLowerCase().includes('already exists')) {
          const strategy = await resolveConflict('storage', kv.title);
          log(`    ⚠️ "${kv.title}" already exists — looking up ID...`);
          const existing = (await api.listKVNamespaces(destAuth, destAccountId)).find(ns => ns.title === kv.title);
          if (!existing) throw e;
          newId = existing.id;
          kvIdMap.set(kv.id, newId);
          log(`    ✓ Mapped existing "${kv.title}" (${newId.slice(0, 8)}...)`);
          if (strategy === 'skip') throw e;
        } else throw e;
      }
      kvIdMap.set(kv.id, newId);
      // Copy KV data
      log(`    ⏳ Listing keys in "${kv.title}"...`);
      const keys = await api.listKVKeys(sourceAuth, sourceAccountId, kv.id, (fetched) => {
        log(`    📦 "${kv.title}": fetched ${fetched} key names so far...`);
      });
      log(`    ✓ Found ${keys.length} keys`);
      if (keys.length === 0) return;
      let copied = 0, failed = 0;
      const startTime = Date.now();
      for (let i = 0; i < keys.length; i += KV_COPY_CONCURRENCY) {
        const batch = keys.slice(i, i + KV_COPY_CONCURRENCY);
        const results = await Promise.allSettled(batch.map(async (key) => {
          const value = await api.getKVValue(sourceAuth, sourceAccountId, kv.id, key.name);
          await api.putKVValue(destAuth, destAccountId, newId, key.name, value, key.metadata);
        }));
        for (const r of results) r.status === 'fulfilled' ? copied++ : failed++;
      }
      log(`    ✓ Copied ${copied}/${keys.length} keys${failed > 0 ? ` (${failed} failed)` : ''} in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    }, (kv) => kv.title, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/storage/kv/namespaces`);
    report.sections.push(trackSection(sec));
  }

  if (!skipFields.has('r2Buckets') && exportData.r2Buckets.length > 0) {
    log('⏳ R2 Buckets...');
    const r2BucketsReady: string[] = []; // track buckets that are ready for data copy
    const sec = await migrateItems('R2 Buckets', exportData.r2Buckets, async (b) => {
      try {
        await api.createR2Bucket(destAuth, destAccountId, b.name, b.location);
        report.createdResources!.r2Buckets.push(b.name);
        r2BucketsReady.push(b.name);
      } catch (e: unknown) {
        const msg = (e as Error).message || '';
        if (msg.toLowerCase().includes('already exists')) {
          const strategy = await resolveConflict('storage', b.name);
          if (strategy === 'skip') throw e;
          log(`    ✓ R2 bucket "${b.name}" already exists`);
          r2BucketsReady.push(b.name); // existing bucket can still receive data
          return;
        }
        throw e;
      }
    }, (b) => b.name, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/r2/buckets`);
    report.sections.push(trackSection(sec));

    // Copy R2 object data if S3 credentials were provided
    const r2Creds = config.r2Credentials;
    if (r2Creds?.source && r2Creds?.dest && r2BucketsReady.length > 0) {
      log(`⏳ Copying R2 object data (${r2BucketsReady.length} bucket${r2BucketsReady.length !== 1 ? 's' : ''})...`);
      for (const bucketName of r2BucketsReady) {
        try {
          const r2Result = await migrateR2BucketData(
            sourceAccountId, destAccountId,
            r2Creds.source, r2Creds.dest,
            bucketName, log,
          );
          if (r2Result.failed > 0) {
            report.warnings.push(`R2 "${bucketName}": ${r2Result.copied}/${r2Result.totalObjects} objects copied (${r2Result.failed} failed)`);
          }
        } catch (e: unknown) {
          const errMsg = (e as Error).message || String(e);
          log(`    ❌ R2 data copy for "${bucketName}" failed: ${errMsg}`);
          report.errors.push({ resource: 'R2 Data', name: bucketName, error: errMsg });
        }
      }
    } else if (!r2Creds?.source || !r2Creds?.dest) {
      log('    ℹ️ R2 S3 credentials not provided — skipping data copy (buckets created empty)');
    }

    // R2 bucket sub-configurations — apply CORS, lifecycle, and managed-domain
    // settings AFTER each bucket has been created. Each is independently
    // failable; failure of one bucket's config shouldn't abort the others.
    // Buckets that already exist on dest still get their config re-applied
    // (the PUT endpoints are idempotent).
    if (Array.isArray(exportData.r2BucketConfigs) && exportData.r2BucketConfigs.length > 0) {
      const cfgsToApply = exportData.r2BucketConfigs.filter(c =>
        // Only apply configs for buckets that exist on dest (ready or already-existing).
        r2BucketsReady.includes(c.bucketName)
      );
      if (cfgsToApply.length > 0) {
        log(`⏳ R2 Bucket Configs (${cfgsToApply.length} bucket${cfgsToApply.length !== 1 ? 's' : ''})...`);
        const sec: ReportSection = {
          name: 'R2 Bucket Configurations',
          total: 0, success: 0, failed: 0, skipped: 0, acknowledged: 0,
          items: [],
        };
        for (const cfg of cfgsToApply) {
          // Apply each sub-config independently
          if (cfg.cors && cfg.cors.length > 0) {
            sec.total++;
            try {
              await api.putR2BucketCors(destAuth, destAccountId, cfg.bucketName, cfg.cors);
              sec.success++;
              sec.items.push({ name: `${cfg.bucketName} (cors)`, status: 'success' });
            } catch (e: unknown) {
              const err = (e as Error).message || String(e);
              sec.failed++;
              sec.items.push({ name: `${cfg.bucketName} (cors)`, status: 'failed', error: err });
              report.errors.push({ resource: 'R2 Bucket CORS', name: cfg.bucketName, error: err });
            }
          }
          if (cfg.lifecycle && cfg.lifecycle.length > 0) {
            sec.total++;
            try {
              await api.putR2BucketLifecycle(destAuth, destAccountId, cfg.bucketName, cfg.lifecycle);
              sec.success++;
              sec.items.push({ name: `${cfg.bucketName} (lifecycle)`, status: 'success' });
            } catch (e: unknown) {
              const err = (e as Error).message || String(e);
              sec.failed++;
              sec.items.push({ name: `${cfg.bucketName} (lifecycle)`, status: 'failed', error: err });
              report.errors.push({ resource: 'R2 Bucket Lifecycle', name: cfg.bucketName, error: err });
            }
          }
          if (cfg.managedDomain && cfg.managedDomain.enabled === true) {
            sec.total++;
            try {
              await api.putR2BucketManagedDomain(destAuth, destAccountId, cfg.bucketName, cfg.managedDomain);
              sec.success++;
              sec.items.push({ name: `${cfg.bucketName} (managed-domain enabled)`, status: 'success' });
            } catch (e: unknown) {
              const err = (e as Error).message || String(e);
              sec.failed++;
              sec.items.push({ name: `${cfg.bucketName} (managed-domain)`, status: 'failed', error: err });
              report.errors.push({ resource: 'R2 Managed Domain', name: cfg.bucketName, error: err });
            }
          }
          // Custom domains: attach each, then apply settings (enabled/minTLS).
          // The domain's zone must exist on the dest account for the cert to
          // come up — otherwise the attach succeeds but stays "pending".
          if (Array.isArray(cfg.customDomains)) {
            for (const cd of cfg.customDomains) {
              sec.total++;
              try {
                await api.addR2BucketCustomDomain(destAuth, destAccountId, cfg.bucketName, cd);
                if (cd.enabled === false || cd.minTLS) {
                  await api.updateR2BucketCustomDomain(destAuth, destAccountId, cfg.bucketName, cd);
                }
                sec.success++;
                sec.items.push({ name: `${cfg.bucketName} → ${cd.domain} (custom domain)`, status: 'success' });
              } catch (e: unknown) {
                const err = (e as Error).message || String(e);
                if (err.toLowerCase().includes('already exists') || err.toLowerCase().includes('duplicate')) {
                  sec.success++;
                  sec.items.push({ name: `${cfg.bucketName} → ${cd.domain} (custom domain, exists)`, status: 'success' });
                } else {
                  sec.failed++;
                  sec.items.push({ name: `${cfg.bucketName} → ${cd.domain} (custom domain)`, status: 'failed', error: err });
                  report.errors.push({ resource: 'R2 Custom Domain', name: `${cfg.bucketName}/${cd.domain}`, error: err });
                }
              }
            }
          }
          // Object-lock rules (immutability/retention).
          if (cfg.lock && Array.isArray(cfg.lock.rules) && cfg.lock.rules.length > 0) {
            sec.total++;
            try {
              await api.putR2BucketLock(destAuth, destAccountId, cfg.bucketName, cfg.lock);
              sec.success++;
              sec.items.push({ name: `${cfg.bucketName} (object lock: ${cfg.lock.rules.length} rule${cfg.lock.rules.length !== 1 ? 's' : ''})`, status: 'success' });
            } catch (e: unknown) {
              const err = (e as Error).message || String(e);
              sec.failed++;
              sec.items.push({ name: `${cfg.bucketName} (object lock)`, status: 'failed', error: err });
              report.errors.push({ resource: 'R2 Object Lock', name: cfg.bucketName, error: err });
            }
          }
        }
        if (sec.total > 0) {
          report.sections.push(trackSection(sec));
        }
      }
    }
  }

  if (!skipFields.has('d1Databases') && exportData.d1Databases.length > 0) {
    log('⏳ D1 Databases...');
    const sec = await migrateItems('D1 Databases', exportData.d1Databases, async (db) => {
      let newId: string;
      try {
        const n = await api.createD1Database(destAuth, destAccountId, db.name);
        newId = n.uuid;
        report.createdResources!.d1Databases.push(newId);
      } catch (e: unknown) {
        const msg = (e as Error).message || '';
        if (msg.toLowerCase().includes('already exists')) {
          const strategy = await resolveConflict('storage', db.name);
          log(`    ⚠️ D1 "${db.name}" already exists — looking up ID...`);
          const existing = (await api.listD1Databases(destAuth, destAccountId)).find((d: { name: string; uuid: string }) => d.name === db.name);
          if (!existing) throw e;
          newId = existing.uuid;
          d1IdMap.set(db.uuid, newId);
          log(`    ✓ Mapped existing "${db.name}" (${newId.slice(0, 8)}...)`);
          if (strategy === 'skip') throw e;
        } else throw e;
      }
      d1IdMap.set(db.uuid, newId);
    }, (db) => db.name, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/d1/database`);
    report.sections.push(trackSection(sec));
  }

  if (!skipFields.has('queues') && exportData.queues.length > 0) {
    log('⏳ Queues...');
    const sec = await migrateItems('Queues', exportData.queues, async (q) => {
      try {
        const n = await api.createQueue(destAuth, destAccountId, q.queue_name);
        report.createdResources!.queues.push(n.queue_id);
      } catch (e: unknown) {
        const msg = (e as Error).message || '';
        if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('already taken')) {
          const strategy = await resolveConflict('storage', q.queue_name);
          if (strategy === 'skip') throw e;
          log(`    ✓ Queue "${q.queue_name}" already exists`);
          return;
        }
        throw e;
      }
    }, (q) => q.queue_name, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/queues`);
    report.sections.push(trackSection(sec));
  }

  // ── Hyperdrive configs ──────────────────────────────────────────
  // Connection pools for upstream Postgres / MySQL / Workers-VPC
  // databases. The `password` and `access_client_secret` fields are
  // write-only — the user supplies them via
  // MigrationConfig.hyperdriveOriginCredentials (keyed by source
  // config name). Configs without supplied credentials are
  // acknowledged via the hyperdrive_origin_credentials IMPOSSIBLE
  // entry; their bindings will surface a per-worker manual-reconfig
  // warning (preserved behaviour for the no-credentials case).
  if (Array.isArray(exportData.hyperdriveConfigs) && exportData.hyperdriveConfigs.length > 0) {
    log('⏳ Hyperdrive Configs...');
    const supplied = config.hyperdriveOriginCredentials || {};
    const withCreds = exportData.hyperdriveConfigs.filter(h => supplied[h.name]?.password || supplied[h.name]?.access_client_secret);
    const withoutCreds = exportData.hyperdriveConfigs.filter(h => !supplied[h.name]?.password && !supplied[h.name]?.access_client_secret);

    if (withCreds.length > 0) {
      const sec = await migrateItems('Hyperdrive Configs', withCreds, async (h) => {
        const creds = supplied[h.name] || {};
        const origin: api.HyperdriveOrigin = { ...h.origin };
        if (creds.password) origin.password = creds.password;
        if (creds.access_client_secret) origin.access_client_secret = creds.access_client_secret;
        const created = await api.createHyperdriveConfig(destAuth, destAccountId, {
          name: h.name, origin, caching: h.caching, mtls: h.mtls,
          origin_connection_limit: h.origin_connection_limit,
        });
        if (h.id && created.id) hyperdriveIdMap.set(h.id, created.id);
      }, (h) => h.name, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/hyperdrive/configs`);
      report.sections.push(trackSection(sec));
    }
    for (const h of withoutCreds) {
      log(`  🟡 Hyperdrive '${h.name}': origin credentials not supplied — acknowledged via hyperdrive_origin_credentials. Worker bindings referencing this config will surface a manual-reconfig warning.`);
    }
  }

  // ── Secrets Store stores ────────────────────────────────────────
  // Only store METADATA migrates (just {name}); the secret VALUES
  // inside each store are write-only at create time and remain
  // acknowledged via worker_binding_secrets_store. The user must
  // re-populate each secret on the dest dashboard after migration.
  // The binding's `secret_name` is preserved, so once secrets are
  // re-added the binding works without further changes.
  if (Array.isArray(exportData.secretsStoreStores) && exportData.secretsStoreStores.length > 0) {
    log('⏳ Secrets Store Stores...');
    // Cloudflare caps the number of Secrets Stores per account (commonly a
    // single `default` store). A fresh dest account already has one, so
    // POSTing another fails with `maximum_stores_exceeded`. Rather than
    // failing (Principle 1), reuse an existing dest store: the binding
    // remap only needs source-store-id → SOME-dest-store-id so worker
    // `secrets_store_secrets` bindings resolve. Secret VALUES are
    // write-only and acknowledged separately, so which store holds them is
    // immaterial as long as the user re-populates them post-migration.
    let existingDestStores: api.SecretsStoreStore[] = [];
    try {
      existingDestStores = await api.listSecretsStoreStores(destAuth, destAccountId);
    } catch {
      existingDestStores = [];
    }
    const sec = await migrateItems('Secrets Store Stores', exportData.secretsStoreStores, async (s) => {
      try {
        const created = await api.createSecretsStoreStore(destAuth, destAccountId, { name: s.name });
        if (s.id && created.id) secretsStoreIdMap.set(s.id, created.id);
        if (created.id) existingDestStores.push(created);
      } catch (e: unknown) {
        const msg = (e as Error).message || '';
        const lower = msg.toLowerCase();
        if (lower.includes('maximum_stores_exceeded') || lower.includes('maximum number of stores') || isConflictError(msg)) {
          // Reuse an existing store: prefer a same-name match, else the
          // first available (typically `default`).
          const reuse = existingDestStores.find(d => d.name === s.name) || existingDestStores[0];
          if (reuse?.id) {
            if (s.id) secretsStoreIdMap.set(s.id, reuse.id);
            throw new Error(
              `ACKNOWLEDGED: Destination account already has the maximum number of Secrets Stores; ` +
              `reusing existing store "${reuse.name || reuse.id}". Worker bindings were remapped to it — ` +
              `re-add the secret values on the destination dashboard.`,
            );
          }
        }
        throw e;
      }
    }, (s) => s.name, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/secrets_store/stores`);
    report.sections.push(trackSection(sec));
  }

  return { kvIdMap, d1IdMap, hyperdriveIdMap, secretsStoreIdMap };
}
