// Helper for one-shot "PUT entire config" migrations.
//
// Many Cloudflare zone/account features are exposed as a single endpoint
// that takes the entire feature config in one call: Managed Headers,
// Cloud Connector Rules, URL Normalization, Cache Reserve, DNS Settings,
// Regional Tiered Cache, Cache Variants, Origin Post-Quantum Encryption,
// Custom Nameservers, Fraud Detection, Page Shield, Schema Validation,
// ACM Total TLS, API Gateway Operations, Hostname Associations (mTLS),
// and Origin TLS Client Auth Settings — among others.
//
// For these, the "section of size 1" pattern is the right reporting
// shape: one row, status success/failed/acknowledged. This module owns
// that shape so migrateZone() doesn't have to define it as a closure.
//
// Failure classification follows the "No Surprise Failures" principle
// (AGENTS.md §5): errors recognized by `isAcknowledgeableSingletonError`
// (entitlement gaps, "feature not enabled", "read-only" etc.) land as
// `acknowledged`; genuinely unexpected errors land as `failed`.

import type { MigrationReport } from '../types';
import type { LogFn } from '../migrate';
import { throwIfAuthError } from '../api';
import { isAcknowledgeableSingletonError } from './errors';

export interface SingletonDeps {
  report: MigrationReport;
  log: LogFn;
  /** Advance the upstream `completedItems` progress counter. */
  onItemDone: () => void;
}

/**
 * Run a one-shot migration step that emits a single-item section into
 * the report. Resolves silently on `enabled === false` so call sites
 * can pass a feature-flag without an outer `if`.
 *
 * Behavior matches the original `migrateSingleton` closure in
 * migrateZone() exactly, with one trivial difference: the
 * `completedItems++` increment is now expressed through `onItemDone()`
 * rather than directly mutating a captured counter.
 */
export async function migrateSingleton(
  deps: SingletonDeps,
  name: string,
  enabled: boolean,
  endpoint: string,
  apiCall: () => Promise<unknown>,
): Promise<void> {
  if (!enabled) return;
  const { report, log, onItemDone } = deps;
  log(`⏳ Migrating ${name}...`);
  log(`  ${endpoint}`);
  try {
    await apiCall();
    onItemDone();
    log(`  ✓ ${name} migrated`);
    report.sections.push({
      name, total: 1, success: 1, failed: 0, skipped: 0,
      items: [{ name, status: 'success' }],
    });
  } catch (e: unknown) {
    throwIfAuthError(e);
    const err = e as Error;
    if (isAcknowledgeableSingletonError(err.message)) {
      log(`  🟡 ${name} acknowledged: ${err.message}`);
      report.sections.push({
        name, total: 1, success: 0, failed: 0, skipped: 0, acknowledged: 1,
        items: [{ name, status: 'acknowledged', error: err.message }],
      });
      report.summary.acknowledged = (report.summary.acknowledged || 0) + 1;
    } else {
      log(`  ❌ ${name} failed: ${err.message}`);
      report.sections.push({
        name, total: 1, success: 0, failed: 1, skipped: 0,
        items: [{ name, status: 'failed', error: err.message }],
      });
      report.errors.push({
        resource: name, name, error: err.message,
        suggestion: 'May require entitlement on destination or feature enablement.',
      });
    }
  }
}

/**
 * Convenience: bind `deps` once so call sites can use the closure with
 * the same shape as the original `migrateSingleton(name, enabled, endpoint, apiCall)`.
 * This keeps the diff at the call sites minimal when migrating older
 * code from the inline closure to the extracted helper.
 */
export function bindSingleton(deps: SingletonDeps) {
  return (name: string, enabled: boolean, endpoint: string, apiCall: () => Promise<unknown>) =>
    migrateSingleton(deps, name, enabled, endpoint, apiCall);
}
