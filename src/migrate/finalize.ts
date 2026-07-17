// Final-pass steps that run after every per-resource section in migrateZone():
//
//   1. Re-tally the report summary (total/success/failed/skipped/acknowledged)
//      from scratch by summing section counters. The previous in-flight
//      summary numbers are discarded because the capability-skip blocks
//      above incremented them inline; redoing the sum here keeps the totals
//      authoritative against `report.sections`.
//   2. Reclassify failed items in user-acknowledged sections as 'acknowledged'
//      so they don't appear as failures on Step 4 (No Surprise Failures
//      principle — see AGENTS.md §5).
//
// The post-migration validation call lives in the orchestrator because it
// needs `destAuth`/`destZoneId`/`zoneName` directly and isn't shared with
// other phases. Keeping it inline avoids a wider context-passing surface.
//
// Pure mutation of the passed-in report. No I/O.

import type { MigrationConfig, MigrationReport } from '../types';
import type { LogFn } from '../migrate';

const ACK_SECTION_MAP: Record<string, string[]> = {
  rateLimiting: ['Rate Limits', 'Rate Limiting Rules'],
  loadBalancing: ['Load Balancers', 'Pools', 'Monitors'],
  zeroTrust: ['Access Applications'],
  workers: ['Workers', 'Worker Routes'],
  spectrum: ['Spectrum Apps'],
  r2: ['R2 Buckets'],
  queues: ['Queues'],
  d1: ['D1 Databases'],
  originRules: ['Origin Rules (host override)', 'Rulesets'],
};

export function retallySummary(report: MigrationReport): void {
  report.summary.total = 0;
  report.summary.success = 0;
  report.summary.failed = 0;
  report.summary.skipped = 0;
  report.summary.acknowledged = 0;
  for (const section of report.sections) {
    report.summary.total += section.total;
    report.summary.success += section.success;
    report.summary.failed += section.failed;
    report.summary.skipped += section.skipped;
    report.summary.acknowledged += section.acknowledged || 0;
  }
}

export function reclassifyAcknowledgedFailures(
  config: MigrationConfig,
  report: MigrationReport,
  log: LogFn,
): void {
  if (!config.acknowledgments || config.acknowledgments.length === 0) return;

  const acknowledgedSections = new Set<string>();
  for (const ackKey of config.acknowledgments) {
    const sectionNames = ACK_SECTION_MAP[ackKey];
    if (sectionNames) {
      for (const s of sectionNames) acknowledgedSections.add(s);
    }
  }
  if (acknowledgedSections.size === 0) return;

  let reclassified = 0;
  for (const section of report.sections) {
    if (!acknowledgedSections.has(section.name)) continue;
    for (const item of section.items) {
      if (item.status === 'failed') {
        item.status = 'acknowledged';
        section.failed--;
        section.acknowledged = (section.acknowledged || 0) + 1;
        report.summary.failed--;
        report.summary.acknowledged = (report.summary.acknowledged || 0) + 1;
        reclassified++;
      }
    }
  }
  if (reclassified > 0) {
    log(`📋 ${reclassified} failed item${reclassified !== 1 ? 's' : ''} reclassified as acknowledged (pre-approved by user)`);
  }
}
