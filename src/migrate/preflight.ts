// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Preflight helpers: pure functions used before and around the migration
// run to:
//   • Build acknowledgment sections for entitlement gaps and user
//     deselections (Principles 1 + 2 from AGENTS.md § 5).
//   • Filter the raw ZoneExport down to what the user selected in Step 2.
//   • Detect what the user deselected so we can emit per-group
//     acknowledgment sections (the alternative is silent omission from
//     the report, which violates No Surprise Failures).
//
// All five functions in this module are pure and unit-tested. They have
// no side effects, no I/O, no Cloudflare API calls. They run before the
// migrate engine starts and produce the data the engine consumes.

import type {
  ZoneExport, ReportSection, ReportItem, CFWorkerBinding,
} from '../types';
import {
  MANUAL_BINDING_TYPE_TO_KEY,
  MANUAL_BINDING_TYPES_REQUIRE_RECONFIG,
} from './constants';

// Build an acknowledgment ReportSection for worker bindings that reference
// source-account-specific resources. Called from both migrateZone and
// migrateAccountResources so the report wording is consistent.
//
/**
 * Build an acknowledgment section for a destination-account capability that
 * is unavailable. Used by the migrate flow when `capabilities.X.available
 * === false` — the section is surfaced to the user so they see explicitly
 * that the corresponding resources didn't migrate. This is the No Surprise
 * Failures principle (AGENTS.md § 5, Principle 1): user-visible, but not
 * counted as a failure.
 *
 * The section ALWAYS has at least one row, even when `items` is empty —
 * `generateReportMarkdown` drops sections with `total: 0`, and an empty
 * `exportData[field]` is still a case the user should see ("R2 is disabled
 * on dest, nothing to migrate"). Without this row the report has no record
 * of the capability gap at all (silent omission).
 *
 * Pure function — safe to unit-test without a full migrate run.
 */
export function buildCapabilityAcknowledgmentSection(
  label: string,
  fieldKey: string,
  cap: { available: boolean; reason?: string; action?: string },
  items: Array<{ name?: string; id?: string; title?: string }> | undefined | null,
): ReportSection {
  const reasonStr = `${label} not enabled on destination account${cap.reason ? `: ${cap.reason}` : ''}`;
  const reportItems: ReportItem[] = (items || []).map((item: { name?: string; id?: string; title?: string }) => ({
    name: item.name || item.id || item.title || 'unknown',
    status: 'acknowledged' as const,
    error: reasonStr,
  }));
  // When there are zero such resources in this zone, the capability gap is
  // real but affects nothing — there is nothing for the user to acknowledge.
  // Emitting a synthetic "(no X found to migrate)" acknowledged row is
  // busywork that asks the user to acknowledge the non-migration of zero
  // resources, and inflates the acknowledged count (Principle 4). Return an
  // empty (total:0) section instead; the renderer skips it, and the
  // capability gap is still disclosed via report.warnings (see zone-prelude).
  return {
    name: `${label} (${fieldKey})`,
    total: reportItems.length,
    success: 0,
    failed: 0,
    skipped: 0,
    acknowledged: reportItems.length,
    items: reportItems,
  };
}

// Returns null when there are no manual bindings in any worker (skip
// emitting an empty section).
export function buildManualBindingAcknowledgmentSection(
  workers: Array<{ id: string; bindings?: CFWorkerBinding[] }>,
): ReportSection | null {
  type ItemKey = `${string}::${string}::${string}`; // workerId::type::bindingName
  const seen = new Set<ItemKey>();
  const items: ReportItem[] = [];
  for (const w of workers) {
    if (!w.bindings) continue;
    for (const b of w.bindings) {
      const key = MANUAL_BINDING_TYPE_TO_KEY[b.type];
      if (!key) continue;
      const dedupKey = `${w.id}::${b.type}::${b.name}` as ItemKey;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const reason = MANUAL_BINDING_TYPES_REQUIRE_RECONFIG.has(b.type)
        ? `Binding references a source-account resource that must be reconfigured on the destination account.`
        : `Binding resolves automatically once the destination account has the required entitlement.`;
      items.push({
        name: `${w.id}: ${b.type} binding "${b.name}"`,
        status: 'acknowledged',
        error: reason,
      });
    }
  }
  if (items.length === 0) return null;
  return {
    name: 'Worker Bindings (Manual / Account-Tied)',
    total: items.length,
    success: 0,
    failed: 0,
    skipped: 0,
    acknowledged: items.length,
    items,
  };
}

// Filter export data based on user selections
export function filterExportData(
  data: ZoneExport,
  selections?: Record<string, Record<string, boolean>>
): ZoneExport {
  if (!selections) return data;

  const isSelected = (category: string, id: string): boolean => {
    const group = selections[category];
    if (!group) return false; // If category not in selections, exclude all (not shown in UI)
    return group[id] === true; // Only include if explicitly selected
  };

  // Workers can be in 'zoneWorkers' (route-linked) or 'workers' (account-level) groups
  const isWorkerSelected = (id: string): boolean =>
    isSelected('workers', id) || isSelected('zoneWorkers', id);

  return {
    ...data,
    settings: data.settings.filter(s => isSelected('settings', s.id)),
    dnsRecords: data.dnsRecords.filter(r => isSelected('dnsRecords', r.id)),
    pageRules: data.pageRules.filter(r => isSelected('pageRules', r.id)),
    rulesets: data.rulesets.filter(r => isSelected('rulesets', r.id)),
    workers: data.workers.filter(w => isWorkerSelected(w.id)),
    workerRoutes: data.workerRoutes.filter(r => isSelected('workerRoutes', r.id)),
    pools: data.pools.filter(p => isSelected('pools', p.id)),
    monitors: data.monitors.filter(m => isSelected('monitors', m.id)),
    loadBalancers: data.loadBalancers.filter(lb => isSelected('loadBalancers', lb.id)),
    customCertificates: data.customCertificates.filter(c => isSelected('customCertificates', c.id)),
    customHostnames: data.customHostnames.filter(h => isSelected('customHostnames', h.id)),
    accessApps: data.accessApps.filter(a => isSelected('accessApps', a.id)),
    // Access policies follow their parent app's selection (policy id format: appId/policyId)
    accessPolicies: data.accessPolicies.filter(p => {
      const appId = p.id?.split('/')[0];
      return appId ? isSelected('accessApps', appId) : false;
    }),
    firewallRules: data.firewallRules.filter(r => isSelected('firewallRules', r.id)),
    rateLimits: data.rateLimits.filter(r => isSelected('rateLimits', r.id)),
    spectrumApps: data.spectrumApps.filter(s => isSelected('spectrumApps', s.id)),
    emailRoutingRules: data.emailRoutingRules.filter(e => isSelected('emailRules', e.tag)),
    waitingRooms: data.waitingRooms.filter(w => isSelected('waitingRooms', w.id)),
    turnstileWidgets: data.turnstileWidgets.filter(t => isSelected('turnstileWidgets', t.sitekey)),
    // Storage resources
    kvNamespaces: data.kvNamespaces.filter(kv => isSelected('kvNamespaces', kv.id)),
    r2Buckets: data.r2Buckets.filter(b => isSelected('r2Buckets', b.name)),
    d1Databases: data.d1Databases.filter(d => isSelected('d1Databases', d.uuid)),
    queues: data.queues.filter(q => isSelected('queues', q.queue_id)),
    durableObjectNamespaces: data.durableObjectNamespaces.filter(d => d.script && isSelected('durableObjects', d.script)),
    // R2 bucket sub-configurations follow their parent bucket's selection.
    r2BucketConfigs: (data.r2BucketConfigs || []).filter(c => isSelected('r2Buckets', c.bucketName)),
    // Developer-platform resources — each has its own selection group.
    pagesProjects: (data.pagesProjects || []).filter(p => isSelected('pagesProjects', p.name)),
    aiGateways: (data.aiGateways || []).filter(g => isSelected('aiGateways', g.id)),
    aiGatewayCustomProviders: (data.aiGatewayCustomProviders || []).filter(p => isSelected('aiGatewayCustomProviders', p.slug)),
    // Origin CA certs — selected by their CF-issued ID.
    originCaCertificates: (data.originCaCertificates || []).filter(c => isSelected('originCaCertificates', c.id)),
    // Singleton resources — null out if group is unchecked
    zarazConfig: isSelected('zaraz', 'zaraz') ? data.zarazConfig : null,
    argoSmartRouting: isSelected('argoSmartRouting', 'smart_routing') ? data.argoSmartRouting : null,
    argoTieredCaching: isSelected('argoTieredCaching', 'tiered_caching') ? data.argoTieredCaching : null,
    botManagement: isSelected('botManagement', 'bot_management') ? data.botManagement : null,
  };
}

/**
 * Compute, for each user-facing group, the count of items present in the
 * raw export that were *not* selected by the user in Step 2. Used to emit
 * acknowledgment sections so the report always shows what the user
 * deselected (Principle 1: No Surprise Failures — if a category isn't in
 * the report at all, the user has no way to know whether it was
 * deliberately skipped or silently dropped).
 *
 * Returns an array of `{groupKey, label, deselectedCount, items}` where:
 *   - groupKey = the selections key (e.g. `kvNamespaces`)
 *   - label    = human-readable label for the report section
 *   - deselectedCount = how many items the user did not check
 *   - items    = the actual deselected items (name/id) for the report
 *
 * Only groups that had at least one item in the raw export AND have
 * `deselectedCount > 0` are returned. If `selections` is undefined the
 * function returns `[]` (no filtering happened, nothing to acknowledge).
 *
 * Pure function — safe to unit-test.
 */
export function computeDeselectedGroups(
  raw: ZoneExport,
  selections?: Record<string, Record<string, boolean>>,
): Array<{ groupKey: string; label: string; items: Array<{ name: string; id?: string }> }> {
  if (!selections) return [];

  const isSelected = (category: string, id: string): boolean => {
    const group = selections[category];
    if (!group) return false;
    return group[id] === true;
  };

  // Map: groupKey → { label, items[]→ {id, name} }
  const groups: Array<{
    groupKey: string;
    label: string;
    items: Array<{ name: string; id?: string }>;
  }> = [];

  const addGroup = <T>(
    groupKey: string,
    label: string,
    items: T[],
    getId: (item: T) => string | undefined,
    getName: (item: T) => string,
  ) => {
    if (!items.length) return;
    const deselected = items.filter(it => {
      const id = getId(it);
      return id ? !isSelected(groupKey, id) : true;
    });
    if (deselected.length === 0) return;
    groups.push({
      groupKey,
      label,
      items: deselected.map(it => ({ name: getName(it) || getId(it) || 'unknown', id: getId(it) })),
    });
  };

  addGroup('workers', 'Worker Scripts', raw.workers, w => w.id, w => w.id);
  addGroup('kvNamespaces', 'KV Namespaces', raw.kvNamespaces, kv => kv.id, kv => kv.title || kv.id);
  addGroup('r2Buckets', 'R2 Buckets', raw.r2Buckets, b => b.name, b => b.name);
  addGroup('d1Databases', 'D1 Databases', raw.d1Databases, d => d.uuid, d => d.name || d.uuid);
  addGroup('queues', 'Queues', raw.queues, q => q.queue_id, q => q.queue_name || q.queue_id);
  addGroup('loadBalancers', 'Load Balancers', raw.loadBalancers, lb => lb.id, lb => lb.name || lb.id || 'lb');
  addGroup('pools', 'Load Balancer Pools', raw.pools, p => p.id, p => p.name || p.id || 'pool');
  addGroup('monitors', 'Load Balancer Monitors', raw.monitors, m => m.id, m => m.description || m.id || 'monitor');
  addGroup('accessApps', 'Access Applications', raw.accessApps, a => a.id, a => a.name || a.id || 'app');
  addGroup('spectrumApps', 'Spectrum Apps', raw.spectrumApps, s => s.id, s => (s.dns?.name) || s.id || 'spectrum');
  addGroup('turnstileWidgets', 'Turnstile Widgets', raw.turnstileWidgets, t => t.sitekey, t => t.name || t.sitekey);
  addGroup('customHostnames', 'Custom Hostnames', raw.customHostnames, h => h.id, h => h.hostname || h.id || 'hostname');
  addGroup('customCertificates', 'Custom Certificates', raw.customCertificates, c => c.id, c => (c.hosts || []).join(',') || c.id || 'cert');
  addGroup('waitingRooms', 'Waiting Rooms', raw.waitingRooms, w => w.id, w => w.name || w.id || 'room');
  // Developer-platform resources (account-scoped). These default-OFF
  // in Step 2 like other account-scoped groups, so deselect detection
  // is especially important — otherwise the user has no record that
  // their Pages projects / AI Gateways were skipped.
  addGroup('pagesProjects', 'Pages Projects', raw.pagesProjects || [], p => p.name, p => p.name);
  addGroup('aiGateways', 'AI Gateways', raw.aiGateways || [], g => g.id, g => g.id);
  addGroup('aiGatewayCustomProviders', 'AI Gateway Custom Providers', raw.aiGatewayCustomProviders || [], p => p.slug, p => `${p.name} (${p.slug})`);
  // Origin CA certificates are zone-scoped but follow opt-in selection
  // because re-issuing requires user-supplied CSRs in Step 3.
  addGroup('originCaCertificates', 'Origin CA Certificates', raw.originCaCertificates || [], c => c.id, c => (c.hostnames || []).join(',') || c.id);
  // Note: durableObjectNamespaces, accessPolicies, workerRoutes, settings,
  // dnsRecords, pageRules, rulesets, firewallRules, rateLimits, emailRules
  // are intentionally excluded — they're tied to specific resources the
  // user can drill into, or they're zone-scoped defaults that always show.
  // R2 bucket sub-configs follow their parent bucket's selection so they
  // also don't need a separate deselect entry.

  return groups;
}

/**
 * Build an acknowledgment section for a user-deselected group. Mirrors
 * `buildCapabilityAcknowledgmentSection` but with a "you deselected this"
 * reason instead of an entitlement-gap reason. Surfaces in the report so
 * the user sees explicitly what didn't migrate, per Principle 1.
 */
export function buildDeselectedAcknowledgmentSection(
  group: { groupKey: string; label: string; items: Array<{ name: string; id?: string }> },
): ReportSection {
  const n = group.items.length;
  if (n === 0) {
    return { name: `${group.label} (deselected)`, total: 0, success: 0, failed: 0, skipped: 0, acknowledged: 0, items: [] };
  }
  // Deselection is a GROUP-level choice (the user toggles one checkbox in
  // Step 2), so the natural unit of acknowledgment is the group, not each
  // item. Emitting one acknowledged row per item drowns the Results page in
  // noise (e.g. 203 unrelated account Worker Scripts) and inflates the
  // "acknowledged" count ~6x, diluting the acknowledgments that actually
  // demand user action (Principle 4). Collapse to a single representative
  // row that discloses the count; the user deselected the whole group
  // deliberately, so a per-item list adds no auditable signal.
  const reason = `You deselected this group in Step 2 — ${n} item(s) intentionally not migrated.`;
  return {
    name: `${group.label} (deselected)`,
    total: 1,
    success: 0,
    failed: 0,
    skipped: 0,
    acknowledged: 1,
    items: [{ name: `${n} ${group.label}`, status: 'acknowledged' as const, error: reason }],
  };
}

