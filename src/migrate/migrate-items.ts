// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// migrateItems<T>() — the generic per-resource migration loop used by
// every phase module (Batch 1, Batch 2, Email, Storage, LB/Access,
// Pages, AI Gateway, Origin CA, Turnstile, etc.).
//
// Responsibilities:
//   • Run the per-item migrateFn in parallel via Promise.allSettled.
//   • Classify each per-item result into one of:
//       success / overwritten / conflict / manual / preAcknowledged / failed
//   • Surface each category into the right place on the report
//     (sections.items, report.conflicts, report.manualActions,
//     errors[], section.acknowledged).
//   • Apply analyzeError() to failed items so the report has
//     remediation suggestions + bucket categories.
//
// Status semantics (these are part of the product contract — Step 4
// reads them back through ReportSection.items[].status):
//
//   success         — migrateFn returned without throwing
//   overwritten     — overwriteFn was supplied and ran successfully
//                     after a conflict (counts as success on the
//                     section.items row but is annotated 'Overwritten
//                     (existed on destination)')
//   conflict        — already exists on dest, no overwriteFn supplied;
//                     skipped + pushed to report.conflicts
//   manual          — isManualActionError() matched; pushed to
//                     report.manualActions and counted as
//                     acknowledged (Principle 1: No Surprise Failures —
//                     entitlement gaps land as ack, not fail)
//   preAcknowledged — migrateFn threw with the 'ACKNOWLEDGED:' prefix;
//                     user accepted this skip pre-migration (e.g.
//                     forward to unverified email address). Counted
//                     as acknowledged.
//   failed          — everything else; pushed to errors[] with
//                     analyzeError-derived suggestion + category.

import type { MigrationError, MigrationReport, ReportSection } from '../types';
import type { LogFn } from '../migrate';
import { isManualActionError, isConflictError } from './errors';
import { analyzeError } from './errors-classification';
import { batchWithConcurrency } from '../api';

// Max in-flight per-item requests for a single phase. Mirrors KV_COPY_CONCURRENCY
// (10) and stays well under both the Workers 1000-subrequest/invocation cap and
// the CF API rate limit (1200 req / 5 min) even for large, multi-phase zones.
export const MIGRATE_ITEM_CONCURRENCY = 10;

export async function migrateItems<T>(
  name: string,
  items: T[],
  migrateFn: (item: T, index: number) => Promise<void>,
  getName: (item: T, index: number) => string,
  errors: MigrationError[],
  log: LogFn = console.log,
  report?: MigrationReport,
  onItemDone?: () => void,
  /** Optional API endpoint pattern to log before processing (e.g. "POST /zones/{id}/dns_records") */
  endpoint?: string,
  /** When provided and a conflict ("already exists") is detected, call this instead of skipping.
   *  The function should delete/update the existing resource so the source version wins. */
  overwriteFn?: (item: T, index: number) => Promise<void>,
): Promise<ReportSection> {
  const section: ReportSection = {
    name,
    total: items.length,
    success: 0,
    failed: 0,
    skipped: 0,
    items: [],
  };

  if (items.length === 0) {
    log(`  ⏭ ${name}: 0 items, skipping`);
    return section;
  }

  if (endpoint) log(`  ${endpoint}`);
  log(`  ⏳ ${name}: ${items.length} items (parallel, ≤${MIGRATE_ITEM_CONCURRENCY} at a time)...`);

  // Process items in BOUNDED parallel batches via batchWithConcurrency (the
  // same limiter KV/R2 copy use). An unbounded Promise.allSettled over every
  // item — e.g. a zone with thousands of DNS records — blows the Workers
  // 1000-subrequest cap (migration dies mid-phase) and the CF API rate limit
  // (429 storm). Bounding to MIGRATE_ITEM_CONCURRENCY keeps each phase within
  // both ceilings. The per-item fn below never throws (it catches everything),
  // so every settled result is `fulfilled`; the rejected branch stays as
  // defensive belt-and-braces.
  const results = await batchWithConcurrency(
    items,
    async (item: T, i: number) => {
      const itemName = getName(item, i);
      try {
        await migrateFn(item, i);
        onItemDone?.();
        return { itemName, status: 'success' as const };
      } catch (e: unknown) {
        const err = e as Error;
        // Pre-acknowledged errors: the migrator can throw with the prefix
        // `ACKNOWLEDGED:` to signal that the user already accepted this
        // failure mode (e.g. forwarding to an address they chose to skip).
        // These land as `acknowledged` on the report, not `failed`.
        if (err.message.startsWith('ACKNOWLEDGED:')) {
          onItemDone?.();
          return { itemName, status: 'preAcknowledged' as const, error: err.message.slice('ACKNOWLEDGED:'.length).trim() };
        }
        // Check for conflict errors (already exists)
        if (isConflictError(err.message)) {
          // If an overwrite function is provided, try it instead of skipping
          if (overwriteFn) {
            try {
              await overwriteFn(item, i);
              onItemDone?.();
              return { itemName, status: 'overwritten' as const };
            } catch (oe: unknown) {
              onItemDone?.();
              return { itemName, status: 'failed' as const, error: `Overwrite failed: ${(oe as Error).message}` };
            }
          }
          onItemDone?.();
          return { itemName, status: 'conflict' as const, error: err.message };
        }
        onItemDone?.();
        // Check for manual action errors (enable feature/reach out to support)
        if (isManualActionError(err.message)) {
          return { itemName, status: 'manual' as const, error: err.message };
        }
        return { itemName, status: 'failed' as const, error: err.message };
      }
    },
    MIGRATE_ITEM_CONCURRENCY,
  );

  // Process results
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { itemName, status, error } = result.value;
      if (status === 'success') {
        section.success++;
        section.items.push({ name: itemName, status: 'success' });
      } else if (status === 'overwritten') {
        section.success++;
        section.items.push({ name: itemName, status: 'success', error: 'Overwritten (existed on destination)' });
      } else if (status === 'conflict') {
        // Conflicts go to their own category
        section.skipped++;
        const reason = `Already exists on destination — skipped to avoid duplicate`;
        section.items.push({ name: itemName, status: 'skipped', error: reason });
        report?.conflicts.push({
          resource: name,
          name: itemName,
          error: error || 'Resource already exists',
          suggestion: 'Resource was skipped because it already exists on the destination zone. Delete it first if you want to re-create it.',
        });
      } else if (status === 'manual') {
        // Manual action required (e.g. "Access is not enabled", "R2 is not
        // enabled"). The user can't fix this mid-migration — it's an
        // entitlement/feature-flag gap on the destination. Per the
        // "No Surprise Failures" UX principle, this lands as `acknowledged`,
        // not `failed`. The manualActions list still records what the user
        // needs to do to recover.
        section.acknowledged = (section.acknowledged || 0) + 1;
        section.items.push({ name: itemName, status: 'acknowledged', error });
        report?.manualActions.push(
          `⚠️ ${name}: ${itemName}\n${error}`
        );
      } else if (status === 'preAcknowledged') {
        // User accepted this skip pre-migration (e.g. forward to unverified
        // email address). Surface as acknowledged so the Results page shows
        // gray "skipped intentionally", not red error.
        section.acknowledged = (section.acknowledged || 0) + 1;
        section.items.push({ name: itemName, status: 'acknowledged', error: error || 'Pre-acknowledged by user' });
      } else {
        section.failed++;
        section.items.push({ name: itemName, status: 'failed', error });
        const analysis = analyzeError(name, error || '');
        errors.push({
          resource: name,
          name: itemName,
          error: error || 'Unknown error',
          suggestion: analysis.suggestion,
          category: analysis.category,
        });
      }
    } else {
      // Promise itself rejected (shouldn't happen with our try/catch)
      section.failed++;
      section.items.push({ name: 'unknown', status: 'failed', error: result.reason?.message || 'Unknown error' });
    }
  }

  // Acknowledged items (manual-action / pre-acknowledged entitlement gaps)
  // increment section.acknowledged but NOT success/failed/skipped. Omitting
  // them from this line made entitlement-gated items appear to vanish — e.g.
  // "1 items ... 0 ok, 0 failed, 0 skipped" — which reads as a silent drop and
  // violates Principle 9 (fail loud / surface immediately). Surface the count
  // whenever it's non-zero so every item is accounted for in the log.
  const ack = section.acknowledged || 0;
  log(
    ack > 0
      ? `  ✓ ${name}: ${section.success} ok, ${ack} acknowledged, ${section.failed} failed, ${section.skipped} skipped`
      : `  ✓ ${name}: ${section.success} ok, ${section.failed} failed, ${section.skipped} skipped`,
  );

  return section;
}
