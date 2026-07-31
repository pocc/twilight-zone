// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Load Balancer chain (Monitors -> Pools) and Access (Apps -> Policies)
// migration for the account-resources pre-deploy phase.
//
// Both flows have a parent -> child dependency that drives the call order:
//   • Pools reference monitors by id, so monitors must exist first and we
//     remap pool.monitor through monitorIdMap.
//   • Access policies reference Access apps via "{app_id}/{policy_id}"
//     compound keys; we remap to the new app id by splitting on '/' and
//     looking up in accessAppIdMap.
//
// Health monitors quantize their interval to the supported set
// {60, 120, 300, 600, 900, 1800, 3600}s — anything else is snapped to
// the nearest valid value rather than failing the create. This matches
// the dashboard's behavior and avoids spurious "interval not in range"
// errors for source zones on plans with stricter interval limits.
//
// The maps produced here are local to migrateAccountResources(). The
// zone-side LB / Access migrate path (run later from migrateZone()) keeps
// its own monitorIdMap/poolIdMap/accessAppIdMap.

import type { MigrationReport, ZoneExport, ReportSection, CFLBRule } from '../types';
import type { LogFn } from '../migrate';
import * as api from '../api';
import { migrateItems } from '../migrate';
import { rewriteAccessAppDomains } from './transforms';

export interface LbAccessDeps {
  destAuth: api.ApiAuth | string;
  destAccountId: string;
  skipFields: Set<string>;
  /** Source zone apex (e.g. "source.com") — used to rewrite Access app
   *  self-hosted domains onto the destination zone. */
  sourceZoneName: string;
  /** Destination zone apex (e.g. "dest.com"). */
  destZoneName: string;
  log: LogFn;
  trackSection: (s: ReportSection) => ReportSection;
  onItemDone: () => void;
}

export interface LbAccessResult {
  monitorIdMap: Map<string, string>;
  poolIdMap: Map<string, string>;
  accessAppIdMap: Map<string, string>;
}

export async function migrateLbAndAccess(
  exportData: ZoneExport,
  report: MigrationReport,
  deps: LbAccessDeps,
): Promise<LbAccessResult> {
  const { destAuth, destAccountId, skipFields, sourceZoneName, destZoneName, log, trackSection, onItemDone } = deps;

  // ── LB chain: Monitors → Pools ────────────────────────────
  const monitorIdMap = new Map<string, string>();
  if (!skipFields.has('monitors') && exportData.monitors.length > 0) {
    log('⏳ Health Monitors...');
    const sec = await migrateItems('Health Monitors', exportData.monitors, async (m) => {
      const validIntervals = [60, 120, 300, 600, 900, 1800, 3600];
      let interval = m.interval || 60;
      if (!validIntervals.includes(interval)) interval = validIntervals.reduce((p, c) => Math.abs(c - interval) < Math.abs(p - interval) ? c : p);
      const n = await api.createMonitor(destAuth, destAccountId, {
        description: m.description, type: m.type, method: m.method, path: m.path,
        port: m.port, timeout: m.timeout || 5, retries: m.retries || 2, interval,
        expected_codes: m.expected_codes || '200', expected_body: m.expected_body,
        follow_redirects: m.follow_redirects, allow_insecure: m.allow_insecure, header: m.header,
      });
      monitorIdMap.set(m.id, n.id);
    }, (m) => m.description || m.id, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/load_balancers/monitors`);
    report.sections.push(trackSection(sec));
  }

  // Monitor Groups — depend on monitors only. Each group has a `members`
  // array of {monitor_id, enabled, monitoring_only, must_be_healthy}; the
  // monitor_id values are source IDs that get remapped through
  // monitorIdMap. Members whose source monitor wasn't migrated (no entry
  // in monitorIdMap, e.g. the monitor lives in another zone) are silently
  // dropped — the API rejects unknown monitor IDs.
  if (!skipFields.has('monitors') && Array.isArray(exportData.loadBalancerMonitorGroups) && exportData.loadBalancerMonitorGroups.length > 0) {
    log('⏳ LB Monitor Groups...');
    const sec = await migrateItems('LB Monitor Groups', exportData.loadBalancerMonitorGroups, async (g) => {
      const remappedMembers = (g.members || [])
        .map(m => {
          const destMonitorId = monitorIdMap.get(m.monitor_id);
          if (!destMonitorId) return null;
          return {
            monitor_id: destMonitorId,
            enabled: m.enabled,
            monitoring_only: m.monitoring_only,
            must_be_healthy: m.must_be_healthy,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      await api.createLoadBalancerMonitorGroup(destAuth, destAccountId, {
        description: g.description,
        members: remappedMembers,
      });
    }, (g) => g.description || g.id || 'monitor-group', report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/load_balancers/monitor_groups`);
    report.sections.push(trackSection(sec));
  }

  const poolIdMap = new Map<string, string>();
  if (!skipFields.has('pools') && exportData.pools.length > 0) {
    log('⏳ Load Balancer Pools...');
    const sec = await migrateItems('LB Pools', exportData.pools, async (p) => {
      const mid = p.monitor ? monitorIdMap.get(p.monitor) : undefined;
      const n = await api.createPool(destAuth, destAccountId, {
        name: p.name, description: p.description, enabled: p.enabled,
        origins: p.origins, monitor: mid, notification_email: p.notification_email,
        minimum_origins: p.minimum_origins,
      });
      poolIdMap.set(p.id, n.id);
    }, (p) => p.name, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/load_balancers/pools`);
    report.sections.push(trackSection(sec));
  }

  // ── Access Apps → Policies ─────────────────────────────────
  const accessAppIdMap = new Map<string, string>();
  if (!skipFields.has('accessApps') && exportData.accessApps.length > 0) {
    log('⏳ Access Applications...');
    const sec = await migrateItems('Access Applications', exportData.accessApps, async (a) => {
      // Self-hosted Access apps reference a hostname on the SOURCE zone
      // (e.g. "app.source.com"). The dest account doesn't control that
      // hostname, so the create fails with "domain does not belong to
      // zone". Re-point every routing field — the legacy `domain`, the
      // modern `self_hosted_domains[]`, and each `destinations[]`
      // uri/hostname — at the destination zone. SaaS/bookmark apps whose
      // hostnames aren't on the source zone are left untouched.
      const { domain: rewrittenDomain, self_hosted_domains, destinations } =
        rewriteAccessAppDomains(a, sourceZoneName, destZoneName);
      try {
        const n = await api.createAccessApp(destAuth, destAccountId, {
          name: a.name, domain: rewrittenDomain, type: a.type,
          session_duration: a.session_duration, allowed_idps: a.allowed_idps,
          auto_redirect_to_identity: a.auto_redirect_to_identity,
          ...(self_hosted_domains ? { self_hosted_domains } : {}),
          ...(destinations ? { destinations } : {}),
        });
        accessAppIdMap.set(a.id, n.id);
      } catch (e: unknown) {
        api.throwIfAuthError(e);
        const msg = e instanceof Error ? e.message : String(e);
        // Even after rewriting, an app may reference a hostname the dest
        // account genuinely doesn't control (cross-zone app, SaaS domain,
        // or a hostname not present on the dest zone). The user can't make
        // the tool own an arbitrary domain — acknowledge with a manual
        // action rather than a surprise failure (Principle 1 + 4).
        if (msg.toLowerCase().includes('does not belong to')) {
          // A modern self-hosted app may have an empty legacy `domain` and
          // route entirely through self_hosted_domains/destinations — show
          // the first real hostname so the manual action is actionable.
          const routingLabel = rewrittenDomain
            || self_hosted_domains?.[0]
            || destinations?.find(d => d.uri || d.hostname)?.uri
            || destinations?.find(d => d.hostname)?.hostname
            || a.name;
          report.manualActions.push(
            `Access Application "${a.name}": hostname "${routingLabel}" is not on an active zone in the destination account, ` +
            `so the app could not be created. Cloudflare only attaches a self-hosted Access app to a hostname on an ACTIVE zone — and a freshly-migrated destination zone stays pending until its nameservers are moved at cutover. Once the hostname is on an active destination zone, re-create the Access app and its policies.`,
          );
          throw new Error(
            `ACKNOWLEDGED: Access app hostname "${routingLabel}" is not on an active destination zone (a migrated zone stays pending until cutover); ` +
            `re-create the app once the hostname is on an active dest zone.`,
          );
        }
        throw e;
      }
    }, (a) => a.name, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/access/apps`);
    report.sections.push(trackSection(sec));
  }
  if (!skipFields.has('accessPolicies') && exportData.accessPolicies.length > 0) {
    log('⏳ Access Policies...');
    const sec = await migrateItems('Access Policies', exportData.accessPolicies, async (p) => {
      // A policy can only be created under an app that actually migrated.
      // If the parent app was acknowledged/failed (no entry in
      // accessAppIdMap), creating the policy against the stale SOURCE app
      // id would be a guaranteed failure — acknowledge it instead so the
      // Results page stays honest (the user re-creates app + policies
      // together).
      const parentSourceId = p.id.split('/')[0];
      const newAppId = accessAppIdMap.get(parentSourceId);
      if (!newAppId) {
        throw new Error(
          `ACKNOWLEDGED: parent Access app was not migrated to the destination; ` +
          `re-create this policy after creating its Access app.`,
        );
      }
      await api.createAccessPolicy(destAuth, destAccountId, newAppId, {
        name: p.name, decision: p.decision, include: p.include,
        exclude: p.exclude, require: p.require, precedence: p.precedence,
      });
    }, (p) => p.name, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/access/apps/{app_id}/policies`);
    report.sections.push(trackSection(sec));
  }

  return { monitorIdMap, poolIdMap, accessAppIdMap };
}

/**
 * Zone-scoped Load Balancer creation. Runs AFTER migrateLbAndAccess()
 * has populated poolIdMap. Load balancers reference pools by id —
 * default_pools and fallback_pool both get remapped through poolIdMap.
 *
 * Kept separate from migrateLbAndAccess() because LBs are zone-scoped
 * while monitors+pools are account-scoped. The account-resources
 * pre-deploy path only does monitors+pools; the zone migrate path
 * does all three.
 */
export async function migrateLoadBalancers(
  exportData: ZoneExport,
  poolIdMap: Map<string, string>,
  report: MigrationReport,
  deps: {
    destAuth: api.ApiAuth | string;
    destZoneId: string;
    log: LogFn;
    trackSection: (s: ReportSection) => ReportSection;
    onItemDone: () => void;
  },
): Promise<void> {
  const { destAuth, destZoneId, log, trackSection, onItemDone } = deps;
  if (exportData.loadBalancers.length === 0) return;

  const remapId = (id: string): string => poolIdMap.get(id) || id;
  const remapPoolMap = (m?: Record<string, string[]>): Record<string, string[]> | undefined =>
    m ? Object.fromEntries(Object.entries(m).map(([k, ids]) => [k, ids.map(remapId)])) : undefined;
  // An LB rule's `overrides` can itself carry pool references (default_pools,
  // fallback_pool, pop_pools, region_pools) when the rule rewrites steering.
  // Those are source-account pool IDs and must be remapped too, or the rule
  // steers to a non-existent/foreign pool on the destination (Principle 1: a
  // silently-broken LB rule is a surprise failure). Remap any pool-shaped keys
  // we recognise and pass everything else through unchanged.
  const remapRuleOverrides = (rules?: CFLBRule[]): CFLBRule[] | undefined =>
    rules?.map(rule => {
      if (!rule.overrides || typeof rule.overrides !== 'object') return rule;
      const ov = { ...(rule.overrides as Record<string, unknown>) };
      if (Array.isArray(ov.default_pools)) ov.default_pools = (ov.default_pools as string[]).map(remapId);
      if (typeof ov.fallback_pool === 'string') ov.fallback_pool = remapId(ov.fallback_pool);
      if (ov.pop_pools && typeof ov.pop_pools === 'object') ov.pop_pools = remapPoolMap(ov.pop_pools as Record<string, string[]>);
      if (ov.region_pools && typeof ov.region_pools === 'object') ov.region_pools = remapPoolMap(ov.region_pools as Record<string, string[]>);
      return { ...rule, overrides: ov };
    });

  const sec = await migrateItems(
    'Load Balancers',
    exportData.loadBalancers,
    async (lb) => {
      await api.createLoadBalancer(destAuth, destZoneId, {
        name: lb.name,
        description: lb.description,
        default_pools: lb.default_pools.map(remapId),
        fallback_pool: remapId(lb.fallback_pool),
        // Geo-steering pool maps — previously dropped entirely, silently
        // losing per-PoP/per-region routing on the destination.
        pop_pools: remapPoolMap(lb.pop_pools),
        region_pools: remapPoolMap(lb.region_pools),
        proxied: lb.proxied,
        ttl: lb.ttl,
        steering_policy: lb.steering_policy,
        session_affinity: lb.session_affinity,
        session_affinity_ttl: lb.session_affinity_ttl,
        rules: remapRuleOverrides(lb.rules),
      });
    },
    (lb) => lb.name,
    report.errors,
    log,
    report,
    onItemDone,
    `POST /zones/${destZoneId}/load_balancers`,
  );
  report.sections.push(trackSection(sec));
}
