// Post-migration validation.
//
// GETs back resources from the destination zone/account after migrate
// finishes and produces a `ValidationResult` that the Step 4 Results page
// renders. This is the ground-truth check that turns each migration row
// into one of: ✅ verified / 🟡 acknowledged / 🟠 mismatched / ❌ missing.
//
// Verification design (per AGENTS.md Principle 1 — No Surprise Failures):
//
//   * Only run when `!config.dryRun && destZoneId` (caller-side guard).
//   * For each migration section that produced ≥1 success row, list the
//     dest-side resource via the CF API and compare against the migration
//     row names. Custom matcher per section type because the migration's
//     `getName` label format varies (e.g. DNS uses "A foo.zone", Rulesets
//     uses "Name (phase)", Worker Routes uses "pattern → script").
//   * Singleton phases (Tiered Caching, Bot Management, Argo Smart
//     Routing, Zaraz) verify via a single GET → on/off boolean.
//   * Acknowledged rows from the migration report are folded into the
//     validation result so the Results page sees one consolidated list
//     per resource type — verified + acknowledged + (rare) missing.
//
// Matching gotchas the inline comments below address:
//   - DNS: source has FQDN with source zone, dest has FQDN with dest
//     zone — strip both before comparing.
//   - Page Rules: URL patterns embed the zone name — replace the zone
//     with a sentinel before comparing.
//   - Zone Settings: migration row is "setting_id: value"; we extract
//     the bare ID and compare the actual setting value too (catches
//     read-only setting drift as 'mismatched' instead of 'verified').
//   - Rulesets: list endpoint omits rules, so we GET each ruleset by ID
//     and only verify rulesets that have ≥1 rule on dest.
//   - Email Routing catch-all rules have no `name` — reconstruct the
//     display label from matchers/actions.
//
// The block is a literal move from migrate.ts (was lines 3341-3833 pre-
// extract). Two intentional cleanups during extraction:
//   * `catch (e: any)` in `safeFetch` → `catch (e: unknown)` plus an
//     explicit message extraction. Tightens the `any` count without
//     changing behavior.
//   * `destEmail.map((r: any) => ...)` → typed as
//     `Pick<EmailRoutingRule, 'matchers' | 'actions' | 'name' | 'tag' | 'enabled'>`
//     using the api module's type. The runtime behavior is identical.

import type {
  MigrationReport,
  ZoneExport,
  ValidationResult,
  ValidationSection,
  ValidationItem,
} from '../types';
import * as api from '../api';
import type { LogFn } from '../migrate';
import { curatedSettingsAbsentFromAggregate } from '../fuzz';
import { DEDICATED_RUNTIME_ID_ALIASES, dedicatedEndpointId } from './dedicated-settings';

/**
 * Validation section display name → Step 2 resource group key, for Step 4
 * dashboard deep links (app/lib/dashLinks.ts). Every mapped section gets at
 * least a section-level source/dest link; item-level links are added per-row
 * when a dashboard id is resolvable (see the per-section `resolve` wiring and
 * the name-keyed post-pass below).
 */
export const VALIDATION_SECTION_GROUP: Record<string, string> = {
  'DNS Records': 'dnsRecords',
  'Zone Settings': 'settings',
  Rulesets: 'rulesets',
  'Page Rules': 'pageRules',
  Workers: 'workers',
  'Worker Routes': 'workerRoutes',
  'Email Routing Rules': 'emailRules',
  'KV Namespaces': 'kvNamespaces',
  'D1 Databases': 'd1Databases',
  'Load Balancers': 'loadBalancers',
  'Load Balancer Pools': 'pools',
  'Health Monitors': 'monitors',
  'Firewall Rules': 'firewallRules',
  'Rate Limits': 'rateLimits',
  'Tiered Caching': 'argoTieredCaching',
  'Bot Management': 'botManagement',
  'Argo Smart Routing': 'argoSmartRouting',
  'Access Applications': 'accessApps',
  'Turnstile Widgets': 'turnstileWidgets',
  Queues: 'queues',
  'R2 Buckets': 'r2Buckets',
  'Spectrum Apps': 'spectrumApps',
  'Custom Hostnames': 'customHostnames',
  'Custom Certificates': 'customCertificates',
  'Waiting Rooms': 'waitingRooms',
  'Zaraz Configuration': 'zaraz',
};

/** Group keys whose dashboard item id IS the display name (no separate id to
 * resolve) — so the row's `name` can be used directly for item-level links. */
const NAME_IS_DASH_ID = new Set(['workers', 'zoneWorkers', 'r2Buckets']);

export async function validateMigration(
  destAuth: api.ApiAuth | string,
  destAccountId: string,
  destZoneId: string,
  report: MigrationReport,
  exportData: ZoneExport,
  log: LogFn,
  sourceZoneName: string,
  destZoneName: string,
): Promise<ValidationResult> {
  log('🔍 Validating migration — reading back from destination...');
  const sections: ValidationSection[] = [];

  // Sentinel returned by `safeFetch` when the read-back GET itself FAILED
  // (token scope, transient 429/5xx) — as opposed to succeeding with an empty
  // list. A genuinely empty dest list is `[]` (→ rows are `missing`); a failed
  // fetch is this exact frozen reference (→ rows are `unverified`). Per
  // Principle 1 we must not claim "Not found on destination" for a check that
  // never actually ran. Identity is preserved across the `await`/assignment but
  // lost after `.map()`, so callers test the raw result with `isFetchFailed`
  // BEFORE mapping.
  const FETCH_FAILED: unknown[] = Object.freeze([]) as unknown as unknown[];
  const isFetchFailed = (arr: readonly unknown[]): boolean => arr === FETCH_FAILED;

  // Helper: create a validation section by comparing expected items against fetched items
  function validateSection(
    name: string,
    expectedNames: string[],
    fetchedNames: string[],
    matchFn?: (expected: string, fetched: string) => boolean,
    /** Dashboard deep-link wiring. `groupKey` tags every row so Step 4 can
     * render at least a section-level source/dest link. `resolve` optionally
     * returns the source/dest dashboard ids for an item to upgrade to
     * item-level links (only the verified row's dest id is used by the UI).
     * `fetchFailed` (set from `isFetchFailed(destList)`) marks every row
     * `unverified` rather than `missing` — the read-back GET errored, so we
     * cannot assert the resource is absent. */
    opts?: {
      groupKey?: string;
      resolve?: (expectedName: string, matchedFetchedName?: string) => { sourceDashId?: string; destDashId?: string };
      fetchFailed?: boolean;
    },
  ): ValidationSection {
    const matcher = matchFn || ((a: string, b: string) => a.toLowerCase() === b.toLowerCase());
    const items: ValidationItem[] = [];
    let verified = 0;
    let missing = 0;
    let unverified = 0;

    // CONSUME matched dest names so two expected rows can't both match the same
    // single dest record. Without this, a multi-value RRset (e.g. two
    // "A foo.zone" records) where only one actually landed would mark BOTH
    // expected rows `verified` — masking a genuine "missing" (Principle 1/5).
    const remaining = opts?.fetchFailed ? [] : fetchedNames.slice();

    for (const expectedName of expectedNames) {
      let matched: string | undefined;
      if (!opts?.fetchFailed) {
        const idx = remaining.findIndex(f => matcher(expectedName, f));
        if (idx !== -1) matched = remaining.splice(idx, 1)[0];
      }
      const ids = opts?.resolve?.(expectedName, matched) ?? {};
      const base = { dashGroupKey: opts?.groupKey, sourceDashId: ids.sourceDashId };
      if (opts?.fetchFailed) {
        items.push({ name: expectedName, status: 'unverified', detail: 'Could not verify — read-back from destination failed', ...base });
        unverified++;
      } else if (matched !== undefined) {
        items.push({ name: expectedName, status: 'verified', ...base, destDashId: ids.destDashId });
        verified++;
      } else {
        items.push({ name: expectedName, status: 'missing', detail: 'Not found on destination after migration', ...base });
        missing++;
      }
    }

    return {
      name,
      expected: expectedNames.length,
      verified,
      missing,
      mismatched: 0,
      unverified,
      items,
    };
  }

  // Helper: safely fetch with logging. Returns the result on success, the
  // FETCH_FAILED sentinel on error (NOT a plain `[]`, so callers can tell a
  // failed read-back apart from a genuinely empty destination list).
  async function safeFetch<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
    try {
      const result = await fn();
      log(`  GET ${label}: ${result.length} found`);
      return result;
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      const msg = (e as Error)?.message || 'failed';
      log(`  ⚠ GET ${label}: ${msg} — rows in this section will be reported as UNVERIFIED, not missing`);
      return FETCH_FAILED as unknown as T[];
    }
  }

  // Helper: build a single-row section for singleton phases (Tiered Caching,
  // Bot Management, Argo Smart Routing, Zaraz). On a failed read-back GET the
  // row is `unverified` (not mismatched/missing) per Principle 1. When
  // `mismatchDetail` is provided, a non-verified-but-fetched result is
  // `mismatched` (value drift); otherwise it is `missing` (presence-only).
  function singletonSection<T>(
    name: string,
    fetched: T[],
    isVerified: (v: T | undefined) => boolean,
    mismatchDetail?: (v: T | undefined) => string,
  ): ValidationSection {
    if (isFetchFailed(fetched)) {
      return {
        name, expected: 1, verified: 0, missing: 0, mismatched: 0, unverified: 1,
        items: [{ name, status: 'unverified', detail: 'Could not verify — read-back from destination failed' }],
      };
    }
    const verified = fetched.length > 0 && isVerified(fetched[0]);
    if (verified) {
      return { name, expected: 1, verified: 1, missing: 0, mismatched: 0, items: [{ name, status: 'verified' }] };
    }
    if (mismatchDetail) {
      return {
        name, expected: 1, verified: 0, missing: 0, mismatched: 1,
        items: [{ name, status: 'mismatched', detail: mismatchDetail(fetched[0]) }],
      };
    }
    return { name, expected: 1, verified: 0, missing: 1, mismatched: 0, items: [{ name, status: 'missing' }] };
  }

  // Helper: find which resource names from migration sections were successful
  function getSuccessfulNames(sectionName: string): string[] {
    const section = report.sections.find(s => s.name === sectionName);
    if (!section) return [];
    return section.items.filter(i => i.status === 'success').map(i => i.name);
  }

  // ── DNS Records ──
  // Migration getName stores source names like "A sub.source.com" but dest has "A sub.dest.com".
  // Strip the zone domain suffix from both sides and compare type + relative name.
  const migratedDns = getSuccessfulNames('DNS Records');
  if (migratedDns.length > 0) {
    const destDns = await safeFetch('DNS Records', () => api.listDNSRecords(destAuth, destZoneId));
    const destDnsLabels = destDns.map(r => `${r.type} ${r.name}`);
    // Domain-aware matcher: "A foo.source.com" should match "A foo.dest.com"
    const stripZone = (label: string, zone: string) => {
      // "A sub.zone.com" → "A sub" ; "A zone.com" → "A @"
      const spaceIdx = label.indexOf(' ');
      if (spaceIdx < 0) return label.toLowerCase();
      const type = label.slice(0, spaceIdx);
      const name = label.slice(spaceIdx + 1);
      if (name === zone) return `${type} @`.toLowerCase();
      if (name.endsWith('.' + zone)) return `${type} ${name.slice(0, -(zone.length + 1))}`.toLowerCase();
      return label.toLowerCase();
    };
    sections.push(validateSection('DNS Records', migratedDns, destDnsLabels,
      (expected, fetched) => {
        const expNorm = stripZone(expected, sourceZoneName);
        const fetchNorm = stripZone(fetched, destZoneName);
        return expNorm === fetchNorm;
      }, { fetchFailed: isFetchFailed(destDns) }));
  }

  // ── Zone Settings ──
  // Migration item names are formatted as "setting_id: value" — extract just the ID for matching.
  const migratedSettingNames = getSuccessfulNames('Zone Settings');
  if (migratedSettingNames.length > 0) {
    const destSettings = await safeFetch('Zone Settings', () => api.listZoneSettings(destAuth, destZoneId));
    const settingsFetchFailed = isFetchFailed(destSettings);
    // Dedicated-endpoint zone settings (speed_brain, fonts, origin_max_http_version,
    // ssl_automatic_mode, h2_prioritization, image_resizing, origin_h2_max_streams, …)
    // are NOT returned by the aggregate GET /zones/{id}/settings — the same reason
    // export-zone.ts Phase 1a fetches them individually. So absence from the aggregate
    // list is NOT proof they weren't applied; without this, every migrated dedicated
    // setting shows as a false "missing" on the Results page (violating Principle 1).
    // Fetch any migrated-but-absent dedicated setting via its dedicated endpoint
    // before judging it.
    const aggregateIds = new Set(destSettings.map(s => s.id));
    const dedicatedIds = new Set(curatedSettingsAbsentFromAggregate(aggregateIds).map(d => d.id));
    // Register runtime-id aliases (see DEDICATED_RUNTIME_ID_ALIASES above) so a
    // setting whose API-returned id differs from its curated endpoint def id
    // (e.g. csam_scanner ⇄ csam_scanner_third_party) is still recognized as
    // dedicated and resolved via its real endpoint instead of false-"missing".
    for (const runtimeId of Object.keys(DEDICATED_RUNTIME_ID_ALIASES)) dedicatedIds.add(runtimeId);
    const resolveDestSetting = async (settingId: string) => {
      const found = destSettings.find(s => s.id === settingId);
      if (found) return found;
      if (!dedicatedIds.has(settingId)) return undefined;
      try { return await api.getZoneSetting(destAuth, destZoneId, dedicatedEndpointId(settingId)); }
      catch (e) { api.throwIfAuthError(e); return undefined; }
    };
    const settingItems: ValidationItem[] = [];
    let verified = 0, missing = 0, mismatched = 0, unverified = 0;

    for (const itemName of migratedSettingNames) {
      // Extract bare setting ID: "tls_1_3: on" → "tls_1_3"
      const settingId = itemName.split(':')[0].trim();
      const destSetting = await resolveDestSetting(settingId);
      const sourceSetting = exportData.settings.find(s => s.id === settingId);
      if (!destSetting && settingsFetchFailed) {
        // The aggregate settings GET failed and this setting has no resolvable
        // dedicated endpoint — verification did not run, so we can't claim it's
        // missing. (Dedicated-endpoint settings can still resolve above even
        // when the aggregate failed, and are verified/mismatched normally.)
        settingItems.push({ name: itemName, status: 'unverified', detail: 'Could not verify — read-back from destination failed' });
        unverified++;
      } else if (!destSetting) {
        settingItems.push({ name: itemName, status: 'missing', detail: 'Setting not found on destination' });
        missing++;
      } else if (sourceSetting && JSON.stringify(destSetting.value) !== JSON.stringify(sourceSetting.value)) {
        settingItems.push({
          name: itemName,
          status: 'mismatched',
          detail: `Expected: ${JSON.stringify(sourceSetting.value)}, Got: ${JSON.stringify(destSetting.value)}`,
        });
        mismatched++;
      } else {
        settingItems.push({ name: itemName, status: 'verified' });
        verified++;
      }
    }

    sections.push({
      name: 'Zone Settings',
      expected: migratedSettingNames.length,
      verified,
      missing,
      mismatched,
      unverified,
      items: settingItems,
    });
  }

  // ── Rulesets ──
  const migratedRulesets = getSuccessfulNames('Rulesets');
  if (migratedRulesets.length > 0) {
    // listRulesets returns rulesets WITHOUT rules populated (list endpoint omits rules array),
    // so we can't filter by rs.rules.length. Instead fetch each migrated phase's entrypoint
    // to verify rules were actually written.
    const destRulesets = await safeFetch('Rulesets', () => api.listRulesets(destAuth, destZoneId));
    // For each dest ruleset, fetch it individually to check if rules are present.
    // The list endpoint omits the rules array, so we must fetch each one.
    const verifiedRulesetNames: string[] = [];
    for (const rs of destRulesets) {
      if (!rs.phase) continue;
      try {
        const full = await api.getRuleset(destAuth, destZoneId, rs.id);
        if ((full.rules?.length ?? 0) > 0) {
          // Add both the name and the phase so the fuzzy matcher can find it
          verifiedRulesetNames.push(full.name || full.phase || full.id);
        }
      } catch (e) { api.throwIfAuthError(e); /* skip rulesets we can't fetch */ }
    }
    // Migration names are "Name (phase)" — match against dest name, phase, or name substring
    sections.push(validateSection('Rulesets', migratedRulesets, verifiedRulesetNames,
      (expected, fetched) => {
        const lower = expected.toLowerCase();
        const fetchedLower = fetched.toLowerCase();
        // Direct match or one contains the other (handles "default (http_request_firewall_custom)" vs "default")
        return lower === fetchedLower || lower.includes(fetchedLower) || fetchedLower.includes(lower);
      }, { fetchFailed: isFetchFailed(destRulesets) }));
  }

  // ── Page Rules ──
  // Migration stores target URLs like "*source.example.com/login*" but dest has "*dest.example.com/login*".
  // Use domain-aware matching: strip the zone name and compare the path pattern.
  const migratedPageRules = getSuccessfulNames('Page Rules');
  if (migratedPageRules.length > 0) {
    const destPageRules = await safeFetch('Page Rules', () => api.listPageRules(destAuth, destZoneId));
    const destPrLabels = destPageRules.map(pr => pr.targets?.[0]?.constraint?.value || '');
    // Domain-aware matcher: strip zone name from URL patterns before comparing
    const stripZoneFromUrl = (pattern: string, zone: string): string => {
      return pattern.toLowerCase().replace(zone.toLowerCase(), '<<ZONE>>');
    };
    sections.push(validateSection('Page Rules', migratedPageRules, destPrLabels,
      (expected, fetched) => {
        const expNorm = stripZoneFromUrl(expected, sourceZoneName);
        const fetchNorm = stripZoneFromUrl(fetched, destZoneName);
        return expNorm === fetchNorm;
      }, { fetchFailed: isFetchFailed(destPageRules) }));
  }

  // ── Workers ──
  const migratedWorkers = getSuccessfulNames('Workers');
  if (migratedWorkers.length > 0) {
    const destWorkers = await safeFetch('Workers', () => api.listWorkerScripts(destAuth, destAccountId));
    const destWorkerNames = destWorkers.map(w => w.id);
    sections.push(validateSection('Workers', migratedWorkers, destWorkerNames, undefined, { fetchFailed: isFetchFailed(destWorkers) }));
  }

  // ── Worker Routes ──
  const migratedRoutes = getSuccessfulNames('Worker Routes');
  if (migratedRoutes.length > 0) {
    const destRoutes = await safeFetch('Worker Routes', () => api.listWorkerRoutes(destAuth, destZoneId));
    const destRoutePatterns = destRoutes.map(r => r.pattern);
    // Route names in the report are like "pattern → script", match on pattern prefix
    sections.push(validateSection('Worker Routes', migratedRoutes, destRoutePatterns,
      (expected, fetched) => expected.toLowerCase().includes(fetched.toLowerCase()) || fetched.toLowerCase().includes(expected.split(' ')[0]?.toLowerCase()),
      { fetchFailed: isFetchFailed(destRoutes) }));
  }

  // ── Email Routing Rules ──
  //
  // The validator's job is to confirm round-trip — a rule that was reported
  // successful by the migration step must read back from the destination.
  // Runtime delivery prerequisites (zone active, MX records, verified
  // destination addresses on dest account) are the user's responsibility AND
  // are surfaced pre-migration via Step 2's email-address verification card,
  // so the user has either (a) verified the addresses or (b) explicitly
  // skipped them (in which case the migration step marks those rules
  // acknowledged with a clear reason). Either way, by the time this validator
  // runs, the status assigned during migration is the truthful answer.
  const migratedEmail = getSuccessfulNames('Email Routing Rules');
  if (migratedEmail.length > 0) {
    // No inner try/catch here: let safeFetch's catch return the FETCH_FAILED
    // sentinel so a failed read-back surfaces as `unverified`, not `missing`.
    const destEmail = await safeFetch('Email Routing', () => api.listEmailRoutingRules(destAuth, destZoneId));
    type ListedEmailRule = {
      matchers?: Array<{ type?: string }>;
      actions?: Array<{ type?: string }>;
      name?: string;
      tag?: string;
      enabled?: boolean;
    };
    const destEmailNames = destEmail.map((r: ListedEmailRule) => {
      const isCatchAll = r.matchers?.length === 1 && r.matchers[0].type === 'all';
      if (isCatchAll) {
        const action = r.actions?.[0]?.type || 'drop';
        return `Catch-all (${action}${r.enabled === false ? ', disabled' : ''})`;
      }
      return r.name || r.tag || 'rule';
    });
    sections.push(validateSection('Email Routing Rules', migratedEmail, destEmailNames, undefined, { fetchFailed: isFetchFailed(destEmail) }));
  }

  // ── KV Namespaces ──
  const migratedKv = getSuccessfulNames('KV Namespaces');
  if (migratedKv.length > 0) {
    const destKv = await safeFetch('KV Namespaces', () => api.listKVNamespaces(destAuth, destAccountId));
    const destKvNames = destKv.map(kv => kv.title);
    const destKvIdByTitle = new Map(destKv.map(kv => [kv.title.toLowerCase(), kv.id]));
    const srcKvIdByTitle = new Map((exportData.kvNamespaces || []).map(kv => [kv.title.toLowerCase(), kv.id]));
    sections.push(validateSection('KV Namespaces', migratedKv, destKvNames, undefined, {
      groupKey: 'kvNamespaces',
      fetchFailed: isFetchFailed(destKv),
      resolve: (expected, matched) => ({
        sourceDashId: srcKvIdByTitle.get(expected.toLowerCase()),
        destDashId: matched ? destKvIdByTitle.get(matched.toLowerCase()) : undefined,
      }),
    }));
  }

  // ── D1 Databases ──
  const migratedD1 = getSuccessfulNames('D1 Databases');
  if (migratedD1.length > 0) {
    const destD1 = await safeFetch('D1 Databases', () => api.listD1Databases(destAuth, destAccountId));
    const destD1Names = destD1.map(d => d.name);
    const destD1IdByName = new Map(destD1.map(d => [d.name.toLowerCase(), d.uuid]));
    const srcD1IdByName = new Map((exportData.d1Databases || []).map(d => [d.name.toLowerCase(), d.uuid]));
    sections.push(validateSection('D1 Databases', migratedD1, destD1Names, undefined, {
      groupKey: 'd1Databases',
      fetchFailed: isFetchFailed(destD1),
      resolve: (expected, matched) => ({
        sourceDashId: srcD1IdByName.get(expected.toLowerCase()),
        destDashId: matched ? destD1IdByName.get(matched.toLowerCase()) : undefined,
      }),
    }));
  }

  // ── Load Balancers ──
  const migratedLbs = getSuccessfulNames('Load Balancers');
  if (migratedLbs.length > 0) {
    const destLbs = await safeFetch('Load Balancers', () => api.listLoadBalancers(destAuth, destZoneId));
    const destLbNames = destLbs.map(lb => lb.name);
    sections.push(validateSection('Load Balancers', migratedLbs, destLbNames, undefined, { fetchFailed: isFetchFailed(destLbs) }));
  }

  // ── Pools ──
  const migratedPools = getSuccessfulNames('Load Balancer Pools');
  if (migratedPools.length > 0) {
    const destPools = await safeFetch('Pools', () => api.listPools(destAuth, destAccountId));
    const destPoolNames = destPools.map(p => p.name);
    sections.push(validateSection('Load Balancer Pools', migratedPools, destPoolNames, undefined, { fetchFailed: isFetchFailed(destPools) }));
  }

  // ── Health Monitors ──
  const migratedMonitors = getSuccessfulNames('Health Monitors');
  if (migratedMonitors.length > 0) {
    const destMonitors = await safeFetch('Monitors', () => api.listMonitors(destAuth, destAccountId));
    const destMonitorNames = destMonitors.map(m => m.description || m.type);
    sections.push(validateSection('Health Monitors', migratedMonitors, destMonitorNames, undefined, { fetchFailed: isFetchFailed(destMonitors) }));
  }

  // ── Firewall Rules ──
  const migratedFw = getSuccessfulNames('Firewall Rules');
  if (migratedFw.length > 0) {
    const destFw = await safeFetch('Firewall Rules', () => api.listFirewallRules(destAuth, destZoneId));
    const destFwNames = destFw.map(f => f.description || f.action || f.id);
    sections.push(validateSection('Firewall Rules', migratedFw, destFwNames, undefined, { fetchFailed: isFetchFailed(destFw) }));
  }

  // ── Rate Limits ──
  const migratedRl = getSuccessfulNames('Rate Limits');
  if (migratedRl.length > 0) {
    const destRl = await safeFetch('Rate Limits', () => api.listRateLimits(destAuth, destZoneId));
    const destRlNames = destRl.map(r => r.description || r.id);
    sections.push(validateSection('Rate Limits', migratedRl, destRlNames, undefined, { fetchFailed: isFetchFailed(destRl) }));
  }

  // ── Tiered Caching ──
  const tieredSection = report.sections.find(s => s.name === 'Tiered Caching');
  if (tieredSection && tieredSection.success > 0) {
    const tc = await safeFetch('Tiered Caching', async () => {
      const v = await api.getArgoTieredCaching(destAuth, destZoneId);
      return v ? [v] : [];
    });
    sections.push(singletonSection('Tiered Caching', tc, v => v?.value === 'on',
      v => `Expected: on, Got: ${v?.value ?? 'unavailable'}`));
  }

  // ── Bot Management ──
  const botSection = report.sections.find(s => s.name === 'Bot Management');
  if (botSection && botSection.success > 0) {
    const bot = await safeFetch('Bot Management', async () => {
      const v = await api.getBotManagement(destAuth, destZoneId);
      return v ? [v] : [];
    });
    sections.push(singletonSection('Bot Management', bot, v => v != null));
  }

  // ── Argo Smart Routing ──
  const argoSection = report.sections.find(s => s.name === 'Argo Smart Routing');
  if (argoSection && argoSection.success > 0) {
    const sr = await safeFetch('Argo Smart Routing', async () => {
      const v = await api.getArgoSmartRouting(destAuth, destZoneId);
      return v ? [v] : [];
    });
    sections.push(singletonSection('Argo Smart Routing', sr, v => v?.value === 'on',
      v => `Expected: on, Got: ${v?.value ?? 'unavailable'}`));
  }

  // ── Access Applications ──
  const migratedAccess = getSuccessfulNames('Access Applications');
  if (migratedAccess.length > 0) {
    const destApps = await safeFetch('Access Applications', () => api.listAccessApps(destAuth, destAccountId));
    const destAppNames = destApps.map(a => a.name);
    sections.push(validateSection('Access Applications', migratedAccess, destAppNames, undefined, { fetchFailed: isFetchFailed(destApps) }));
  }

  // ── Turnstile Widgets ──
  const migratedTurnstile = getSuccessfulNames('Turnstile Widgets');
  if (migratedTurnstile.length > 0) {
    const destWidgets = await safeFetch('Turnstile Widgets', () => api.listTurnstileWidgets(destAuth, destAccountId));
    const destWidgetNames = destWidgets.map(w => w.name || w.sitekey);
    sections.push(validateSection('Turnstile Widgets', migratedTurnstile, destWidgetNames, undefined, { fetchFailed: isFetchFailed(destWidgets) }));
  }

  // ── Queues ──
  const migratedQueues = getSuccessfulNames('Queues');
  if (migratedQueues.length > 0) {
    const destQueues = await safeFetch('Queues', () => api.listQueues(destAuth, destAccountId));
    const destQueueNames = destQueues.map(q => q.queue_name);
    const destQIdByName = new Map(destQueues.map(q => [q.queue_name.toLowerCase(), q.queue_id]));
    const srcQIdByName = new Map((exportData.queues || []).map(q => [q.queue_name.toLowerCase(), q.queue_id]));
    sections.push(validateSection('Queues', migratedQueues, destQueueNames, undefined, {
      groupKey: 'queues',
      fetchFailed: isFetchFailed(destQueues),
      resolve: (expected, matched) => ({
        sourceDashId: srcQIdByName.get(expected.toLowerCase()),
        destDashId: matched ? destQIdByName.get(matched.toLowerCase()) : undefined,
      }),
    }));
  }

  // ── R2 Buckets ──
  const migratedR2 = getSuccessfulNames('R2 Buckets');
  if (migratedR2.length > 0) {
    const destR2 = await safeFetch('R2 Buckets', () => api.listR2Buckets(destAuth, destAccountId));
    const destR2Names = destR2.map(b => b.name);
    sections.push(validateSection('R2 Buckets', migratedR2, destR2Names, undefined, { fetchFailed: isFetchFailed(destR2) }));
  }

  // ── Spectrum Apps ──
  const migratedSpectrum = getSuccessfulNames('Spectrum Apps');
  if (migratedSpectrum.length > 0) {
    const destSpectrum = await safeFetch('Spectrum Apps', () => api.listSpectrumApps(destAuth, destZoneId));
    const destSpectrumNames = destSpectrum.map(s => s.dns?.name || s.protocol || s.id);
    sections.push(validateSection('Spectrum Apps', migratedSpectrum, destSpectrumNames, undefined, { fetchFailed: isFetchFailed(destSpectrum) }));
  }

  // ── Custom Hostnames ──
  const migratedCH = getSuccessfulNames('Custom Hostnames');
  if (migratedCH.length > 0) {
    const destCH = await safeFetch('Custom Hostnames', () => api.listCustomHostnames(destAuth, destZoneId));
    const destCHNames = destCH.map(h => h.hostname);
    sections.push(validateSection('Custom Hostnames', migratedCH, destCHNames, undefined, { fetchFailed: isFetchFailed(destCH) }));
  }

  // ── Custom Certificates ──
  const migratedCerts = getSuccessfulNames('Custom Certificates');
  if (migratedCerts.length > 0) {
    const destCerts = await safeFetch('Custom Certificates', () => api.listCustomCertificates(destAuth, destZoneId));
    const destCertNames = destCerts.map(c => c.hosts?.join(', ') || c.id);
    sections.push(validateSection('Custom Certificates', migratedCerts, destCertNames, undefined, { fetchFailed: isFetchFailed(destCerts) }));
  }

  // ── Waiting Rooms ──
  const migratedWR = getSuccessfulNames('Waiting Rooms');
  if (migratedWR.length > 0) {
    const destWR = await safeFetch('Waiting Rooms', () => api.listWaitingRooms(destAuth, destZoneId));
    const destWRNames = destWR.map(w => w.name);
    sections.push(validateSection('Waiting Rooms', migratedWR, destWRNames, undefined, { fetchFailed: isFetchFailed(destWR) }));
  }

  // ── Zaraz Configuration ──
  const zarazSection = report.sections.find(s => s.name === 'Zaraz Configuration');
  if (zarazSection && zarazSection.success > 0) {
    const zz = await safeFetch('Zaraz Configuration', async () => {
      const v = await api.getZarazConfig(destAuth, destZoneId);
      return v ? [v] : [];
    });
    sections.push(singletonSection('Zaraz Configuration', zz, v => v != null));
  }

  // ── Worker Custom Domains ──
  const migratedWCD = getSuccessfulNames('Worker Custom Domains');
  if (migratedWCD.length > 0) {
    const destWCD = await safeFetch('Worker Custom Domains', () => api.listWorkerCustomDomains(destAuth, destAccountId));
    const destWCDNames = destWCD.map(d => d.hostname);
    sections.push(validateSection('Worker Custom Domains', migratedWCD, destWCDNames, (expected, fetched) => {
      // Domain-aware: replace source zone with dest zone
      return expected.toLowerCase() === fetched.toLowerCase()
        || fetched.toLowerCase().includes(expected.toLowerCase().split('.')[0]);
    }, { fetchFailed: isFetchFailed(destWCD) }));
  }

  // Add acknowledged items from migration report into validation sections
  for (const migSection of report.sections) {
    const ackItems = migSection.items.filter(i => i.status === 'acknowledged');
    if (ackItems.length > 0) {
      // Find or create a matching validation section
      let valSection = sections.find(s => s.name === migSection.name);
      if (!valSection) {
        valSection = { name: migSection.name, expected: 0, verified: 0, missing: 0, mismatched: 0, items: [] };
        sections.push(valSection);
      }
      for (const item of ackItems) {
        valSection.items.push({
          name: item.name,
          status: 'acknowledged',
          detail: item.error || 'Pre-acknowledged by user — not migrated',
        });
        valSection.acknowledged = (valSection.acknowledged || 0) + 1;
      }
    }
  }

  // Dashboard deep-link post-pass: tag every item with its resource group
  // (section-level link floor), and for name-keyed types fill the item id from
  // the row name so verified/mismatched rows get item-level dest links. Items
  // whose id was already resolved per-section (KV/D1/Queues) are left as-is.
  for (const section of sections) {
    const groupKey = VALIDATION_SECTION_GROUP[section.name];
    if (!groupKey) continue;
    for (const item of section.items) {
      if (!item.dashGroupKey) item.dashGroupKey = groupKey;
      if (NAME_IS_DASH_ID.has(groupKey) && !item.sourceDashId) {
        item.sourceDashId = item.name;
        if (item.status === 'verified' || item.status === 'mismatched') {
          item.destDashId = item.name;
        }
      }
    }
  }

  // Calculate summary
  const summary = { total: 0, verified: 0, missing: 0, mismatched: 0, acknowledged: 0, unverified: 0 };
  for (const s of sections) {
    summary.total += s.expected + (s.acknowledged || 0);
    summary.verified += s.verified;
    summary.missing += s.missing;
    summary.mismatched += s.mismatched;
    summary.acknowledged += (s.acknowledged || 0);
    summary.unverified += (s.unverified || 0);
  }

  // `unverified` rows are NOT failures (the read-back GET errored, so we make
  // no claim) — they don't flip allGood to false, but we surface them clearly
  // and never print the "all verified" banner while any remain unconfirmed.
  const allGood = summary.missing === 0 && summary.mismatched === 0 && summary.unverified === 0;
  log(`🔍 Validation complete: ${summary.verified}/${summary.total} verified` +
    (summary.missing > 0 ? `, ${summary.missing} missing` : '') +
    (summary.mismatched > 0 ? `, ${summary.mismatched} mismatched` : '') +
    (summary.unverified > 0 ? `, ${summary.unverified} unverified (read-back failed)` : '') +
    (summary.acknowledged > 0 ? `, ${summary.acknowledged} acknowledged` : ''));
  if (allGood) log('✅ All migrated resources verified on destination!');

  return {
    timestamp: new Date().toISOString(),
    sections,
    summary,
  };
}
