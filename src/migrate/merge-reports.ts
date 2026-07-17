// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Merge the two phase reports of the two-phase wizard (#19) into one
// MigrationReport for the read-only Results step + the downloadable
// migration_report.md.
//
// The Account step runs `migrateAccountResources` (pre-zone: workers, storage,
// LB, Access, Turnstile, AI Gateway, Origin CA) and the Zone step runs
// `migrateZone` with `skipAccountResources: true` (zone creation + DNS,
// settings, rulesets, certs, email, …). Each returns its own MigrationReport
// over disjoint resource types, so merging is mostly concatenation: section
// lists and error/warning lists append, summary counters add, and the
// scalar/identity fields prefer the zone report (it carries the real dest zone
// identity, nameservers and the post-zone GET-back validation).

import type { MigrationReport } from '../types';

/** Concatenate two arrays of strings, dropping duplicates (order-preserving). */
function unionStrings(a: string[] = [], b: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...a, ...b]) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Merge the two `createdResources` rollback manifests (array union per kind). */
function mergeCreatedResources(
  a: MigrationReport['createdResources'],
  b: MigrationReport['createdResources'],
): MigrationReport['createdResources'] {
  if (!a && !b) return undefined;
  const x = a ?? ({} as NonNullable<MigrationReport['createdResources']>);
  const y = b ?? ({} as NonNullable<MigrationReport['createdResources']>);
  return {
    // zoneId only ever comes from the zone phase; prefer whichever is set.
    zoneId: y.zoneId ?? x.zoneId,
    workers: unionStrings(x.workers, y.workers),
    kvNamespaces: unionStrings(x.kvNamespaces, y.kvNamespaces),
    r2Buckets: unionStrings(x.r2Buckets, y.r2Buckets),
    d1Databases: unionStrings(x.d1Databases, y.d1Databases),
    queues: unionStrings(x.queues, y.queues),
    doNamespaces: unionStrings(x.doNamespaces, y.doNamespaces),
    dnsRecords: unionStrings(x.dnsRecords, y.dnsRecords),
    pageRules: unionStrings(x.pageRules, y.pageRules),
    rulesets: unionStrings(x.rulesets, y.rulesets),
    accessApps: unionStrings(x.accessApps, y.accessApps),
    emailRules: unionStrings(x.emailRules, y.emailRules),
    customHostnames: unionStrings(x.customHostnames, y.customHostnames),
    turnstileWidgets: unionStrings(x.turnstileWidgets, y.turnstileWidgets),
  };
}

/**
 * Merge an account-phase report and a zone-phase report into a single report
 * for the Results step. Disjoint section/error/warning lists are concatenated;
 * summary counters add; identity, nameservers and validation prefer the zone
 * report (which has the real dest zone). Either argument may be undefined (e.g.
 * the zone phase hasn't run yet) — in that case the other is returned as-is.
 */
export function mergeReports(
  account: MigrationReport | null | undefined,
  zone: MigrationReport | null | undefined,
): MigrationReport | null {
  if (!account) return zone ?? null;
  if (!zone) return account;

  const sumKeys = ['total', 'success', 'failed', 'skipped', 'acknowledged'] as const;
  const summary = {} as MigrationReport['summary'];
  for (const k of sumKeys) {
    const v = (account.summary[k] ?? 0) + (zone.summary[k] ?? 0);
    // Only emit `acknowledged` when at least one side had it (it's optional).
    if (k === 'acknowledged' && account.summary.acknowledged == null && zone.summary.acknowledged == null) continue;
    summary[k] = v;
  }

  return {
    // Identity + timing: the zone phase is authoritative / later.
    timestamp: zone.timestamp || account.timestamp,
    sourceZone: zone.sourceZone || account.sourceZone,
    destZone: zone.destZone || account.destZone,
    destZoneId: zone.destZoneId || account.destZoneId,
    destAccountId: zone.destAccountId || account.destAccountId,

    summary,
    sections: [...account.sections, ...zone.sections],
    errors: [...account.errors, ...zone.errors],
    conflicts: [...account.conflicts, ...zone.conflicts],
    warnings: [...account.warnings, ...zone.warnings],
    manualActions: unionStrings(account.manualActions, zone.manualActions),
    newNameservers: unionStrings(account.newNameservers, zone.newNameservers),
    createdResources: mergeCreatedResources(account.createdResources, zone.createdResources),

    // DO state copy + IdP metadata currently come from the zone phase, but
    // concatenate defensively so either phase can contribute.
    doMigrationResults: [
      ...(account.doMigrationResults ?? []),
      ...(zone.doMigrationResults ?? []),
    ].length
      ? [...(account.doMigrationResults ?? []), ...(zone.doMigrationResults ?? [])]
      : undefined,
    destAccessOrg: zone.destAccessOrg ?? account.destAccessOrg,
    migratedIdentityProviders: [
      ...(account.migratedIdentityProviders ?? []),
      ...(zone.migratedIdentityProviders ?? []),
    ].length
      ? [...(account.migratedIdentityProviders ?? []), ...(zone.migratedIdentityProviders ?? [])]
      : undefined,

    // GET-back validation only runs in the zone phase today; the Apply step's
    // re-verify augments `verification` later. Prefer zone, fall back to account.
    validation: zone.validation ?? account.validation,
    verification: zone.verification ?? account.verification,
  };
}
