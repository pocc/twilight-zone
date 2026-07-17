// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Durable Objects migration orchestration.
//
// Two distinct paths:
//
//   1. User provided `config.doMigration` in Step 3 — perform full
//      data migration via doMigrate.migrateDurableObjects(). This
//      requires the source AND destination worker to expose the data-
//      export/import endpoints (see src/do-migrate.ts). Per-DO results
//      land on report.doMigrationResults.
//
//   2. User did NOT configure DO migration — push a manualActions
//      entry explaining how to do it later. DO namespaces are still
//      created automatically when workers deploy (the namespace is
//      created from the worker's `new_classes` migration), but DO
//      INSTANCES (per-object data) must be re-populated by the
//      application or via wrangler.
//
// See IMPOSSIBLE_TO_MIGRATE.data_offline in src/types.ts for why this
// is a user-action path, not an auto-migrate path.

import type { MigrationConfig, MigrationReport, ZoneExport } from '../types';
import type { LogFn } from '../migrate';
import type * as api from '../api';
import * as doMigrate from '../do-migrate';

export async function migrateDurableObjects(
  config: MigrationConfig,
  exportData: ZoneExport,
  sourceAuth: api.ApiAuth | string,
  destAuth: api.ApiAuth | string,
  sourceAccountId: string,
  destAccountId: string,
  report: MigrationReport,
  log: LogFn,
): Promise<void> {
  if (exportData.durableObjectNamespaces.length === 0) return;

  if (config.doMigration && config.doMigration.length > 0) {
    // User provided DO migration config - perform full migration
    log('⏳ Migrating Durable Objects...');

    for (const doConfig of config.doMigration) {
      try {
        const results = await doMigrate.migrateDurableObjects(
          sourceAuth,
          destAuth,
          sourceAccountId,
          destAccountId,
          doConfig.scriptName,
          doConfig.classNames,
          doConfig.objectNames,
          doConfig.sourceWorkerUrl,
          doConfig.destWorkerUrl,
          log,
        );

        // Record per-DO results + track created namespaces for the rollback list
        for (const result of results) {
          report.doMigrationResults!.push(result);
          if (result.destNamespaceId) {
            report.createdResources!.doNamespaces.push(result.destNamespaceId);
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log(`  ❌ DO migration failed for ${doConfig.scriptName}: ${errMsg}`);
        report.errors.push({
          resource: 'Durable Objects',
          name: doConfig.scriptName,
          error: errMsg,
          suggestion: 'Check worker URLs are accessible and object names are correct',
        });
      }
    }

    log('✓ Durable Objects migration complete');
    return;
  }

  // No DO migration config - surface a manual action notice.
  // Per AGENTS.md Principle 1 (No Surprise Failures): the user already
  // saw this in Step 2's pre-migration actions; this is a fallback so
  // the report still records what's needed.
  report.manualActions.push(
    `⚠️ ${exportData.durableObjectNamespaces.length} Durable Object namespace(s) detected.\n` +
    `To migrate DO data, provide doMigration config with:\n` +
    `  - scriptName: Worker script name\n` +
    `  - classNames: DO class names (e.g., ["MyDurableObject"])\n` +
    `  - objectNames: Names used with idFromName() for each DO instance\n` +
    `  - sourceWorkerUrl: Source worker URL (e.g., https://worker.account.workers.dev)\n` +
    `  - destWorkerUrl: Destination worker URL\n\n` +
    `Without this config, DO namespaces will be created when workers are deployed,\n` +
    `but DO data must be rebuilt by the application.`
  );
}
