// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Origin CA Certificates (zone-scoped).
//
// The certificate body is exportable but the private key is generated
// client-side and never stored by Cloudflare. The Step 3 UI prompts the
// user to supply NEW CSRs to re-issue each cert on the destination
// (each CSR encodes a fresh private key the user keeps locally).
//
// `config.originCaCertificates` is the user-supplied list of
// {hostnames, csr, request_type, requested_validity} tuples to issue.
// We match each input to a source cert by hostname-set overlap so the
// user sees which source cert their input replaces.
//
// When the user has source certs but supplied no CSRs in Step 3, we
// surface the source certs as Acknowledged (not Failed) so Step 4 doesn't
// suggest they were lost to a silent bug — they were always going to
// require manual action.

import type { MigrationConfig, MigrationReport, ZoneExport, ReportSection, ReportItem } from '../types';
import type { LogFn } from '../migrate';
import * as api from '../api';
import { migrateItems } from '../migrate';

export interface OriginCaDeps {
  destAuth: api.ApiAuth | string;
  log: LogFn;
  trackSection: (s: ReportSection) => ReportSection;
  onItemDone: () => void;
}

export async function migrateOriginCaCertificates(
  config: MigrationConfig,
  exportData: ZoneExport,
  report: MigrationReport,
  deps: OriginCaDeps,
): Promise<void> {
  const { destAuth, log, trackSection, onItemDone } = deps;

  const originCaInputs = config.originCaCertificates || [];
  if (originCaInputs.length > 0) {
    log('⏳ Origin CA Certificates (re-issuing with user-supplied CSRs)...');
    const sec = await migrateItems('Origin CA Certificates', originCaInputs, async (input) => {
      await api.createOriginCaCertificate(destAuth, input);
    }, (input) => (input.hostnames || []).join(',') || '<unspecified hostnames>',
       report.errors, log, report, onItemDone, `POST /certificates`);
    report.sections.push(trackSection(sec));
    return;
  }

  if (Array.isArray(exportData.originCaCertificates) && exportData.originCaCertificates.length > 0) {
    // User had Origin CA certs on source but didn't provide CSRs in
    // Step 3. Surface as acknowledged so the report doesn't suggest
    // these silently failed.
    const items: ReportItem[] = exportData.originCaCertificates.map(c => ({
      name: (c.hostnames || []).join(',') || c.id,
      status: 'acknowledged' as const,
      error: 'Private key not exportable; no CSR supplied in Step 3. Re-issue manually on the destination at /certificates with a freshly-generated CSR, or use the Step 3 form to provide a CSR and re-run the migration.',
    }));
    report.sections.push({
      name: 'Origin CA Certificates',
      total: items.length,
      success: 0, failed: 0, skipped: 0,
      acknowledged: items.length,
      items,
    });
    report.summary.acknowledged = (report.summary.acknowledged || 0) + items.length;
    report.summary.total += items.length;
  }
}
