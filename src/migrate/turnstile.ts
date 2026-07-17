// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Turnstile Widgets (account-scoped).
//
// Pre-flight dedupe by widget name (case-insensitive) — duplicates are
// pushed as a separate `skipped` section so the user sees what was
// already on the destination. The Turnstile *secret key* is not
// exportable; per IMPOSSIBLE_TO_MIGRATE the user is expected to update
// any client code that has the new sitekey/secretkey pair after
// migration. That acknowledgment is surfaced upstream by the
// Step 2 IMPOSSIBLE_TO_MIGRATE flow, not here.

import type { MigrationReport, ZoneExport, ReportSection } from '../types';
import type { LogFn } from '../migrate';
import * as api from '../api';
import { migrateItems } from '../migrate';

export interface TurnstileDeps {
  destAuth: api.ApiAuth | string;
  destAccountId: string;
  log: LogFn;
  trackSection: (s: ReportSection) => ReportSection;
  onItemDone: () => void;
  bumpCompletedItems: (n: number) => void;
}

export async function migrateTurnstileWidgets(
  exportData: ZoneExport,
  report: MigrationReport,
  deps: TurnstileDeps,
): Promise<void> {
  const { destAuth, destAccountId, log, trackSection, onItemDone, bumpCompletedItems } = deps;

  if (exportData.turnstileWidgets.length === 0) return;

  log('⏳ Turnstile Widgets...');
  // Check for existing widgets (duplicate detection)
  const existingWidgets = await api.listTurnstileWidgets(destAuth, destAccountId).catch(() => [] as Array<{ name?: string }>);
  const existingNames = new Set(existingWidgets.map((w) => (w.name || '').toLowerCase()));
  const newWidgets = exportData.turnstileWidgets.filter(w => !existingNames.has((w.name || '').toLowerCase()));
  const dups = exportData.turnstileWidgets.filter(w => existingNames.has((w.name || '').toLowerCase()));
  if (dups.length > 0) {
    report.sections.push({
      name: 'Turnstile Widgets (duplicates)', total: dups.length, success: 0, failed: 0, skipped: dups.length,
      items: dups.map(w => ({ name: w.name, status: 'skipped' as const, error: 'Widget already exists on destination' })),
    });
    bumpCompletedItems(dups.length);
  }
  if (newWidgets.length > 0) {
    const sec = await migrateItems('Turnstile Widgets', newWidgets, async (w) => {
      await api.createTurnstileWidget(destAuth, destAccountId, {
        name: w.name, domains: w.domains, mode: w.mode, region: w.region,
        bot_fight_mode: w.bot_fight_mode, offlabel: w.offlabel,
      });
    }, (w) => w.name, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/challenges/widgets`);
    report.sections.push(trackSection(sec));
  }
}
