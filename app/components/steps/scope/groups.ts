// Step 2 group construction. Pure data transformation: takes the raw
// export blob from `/api/export` and turns it into a list of
// `ResourceGroup`s for the UI to render. Each group has a flat list of
// `ResourceItem`s that the user can select/deselect.
//
// The disable-by-capability logic lives here as well: capabilities that
// gate an entire group (R2, D1, Workers, etc.) mark the group as disabled
// with a human-readable reason and an action hint. Per-item disables
// (e.g. Analytics Engine binding when AE is not enabled) are applied
// inline rather than promoted to the group level.
//
// Extracted from ScopeReview.tsx to keep the wizard component focused
// on state + rendering. Pure, no React, no I/O.

import { getRulesetDisplayName } from '../../../lib/constants';
import type { AccountCapabilities } from '../../../lib/api';
import type {
  ZoneExport, CFDNSRecord, CFZoneSetting, CFRuleset, CFPageRule,
  CFFirewallRule, CFRateLimit, CFWorkerRoute, CFWorkerScript,
  CFWorkerBinding, CFEmailRoutingRule, CFWaitingRoom, CFCustomHostname,
  CFCustomCertificate, CFLoadBalancer, CFPool, CFMonitor, CFAccessApp,
  CFSpectrumApp, CFTurnstileWidget, CFKVNamespace, CFR2Bucket,
  CFR2BucketConfig, CFPagesProject, CFAiGateway, CFAiGatewayCustomProvider,
  CFOriginCaCertificate, CFD1Database, CFDurableObjectNamespace,
  CFQueue,
} from '../../../../src/types';

export type ConflictStrategy = 'skip' | 'overwrite';

export interface DOConfig {
  enabled: boolean;
  objectNames: string;
  sourceUrl: string;
  destUrl: string;
}

export interface D1Config {
  acknowledged: boolean;
}

export interface ResourceItem {
  id: string;
  label: string;
  sublabel?: string;
  raw: unknown;
  /** Item-level disable (e.g. worker requires Analytics Engine but AE is not available) */
  disabled?: boolean;
  disabledReason?: string;
}

export interface ResourceGroup {
  key: string;
  label: string;
  icon: string;
  scope: 'zone' | 'account';
  items: ResourceItem[];
  /** Group is unavailable on the destination account */
  disabled?: boolean;
  /** Human-readable reason why the group is disabled */
  disabledReason?: string;
  /** Action the user can take to enable this feature */
  disabledAction?: string;
}

/**
 * Wizard phase that deploys a resource group (#19 two-phase model):
 *   - 'account' = the pre-zone `migrateAccountResources` phase (Account step)
 *   - 'zone'    = the `migrateZone` phase (Zone step)
 * Mostly mirrors `group.scope`, with one override: Origin CA certificates are
 * issued via the account/user `/certificates` endpoint in the pre-zone phase
 * (and their CSR input must be collected before that deploy runs), so they
 * belong to the Account phase even though their `scope` is 'zone'.
 */
export type WizardPhase = 'account' | 'zone';
export function groupPhase(group: { key: string; scope: 'zone' | 'account' }): WizardPhase {
  if (group.key === 'originCaCertificates') return 'account';
  return group.scope;
}

// Check if a DNS record is system-managed (read-only, should not be migrated).
// CFDNSRecord.meta is loosely typed at source (the CF API returns various
// shapes); we just check presence of the read-only flags we care about.
function isReadOnlyDnsRecord(r: CFDNSRecord): boolean {
  const meta = r.meta as Record<string, unknown> | undefined;
  if (meta?.read_only) return true;
  if (meta?.email_routing) return true;
  if (meta?.origin_worker_id) return true;
  return false;
}

// Check if a ruleset is Cloudflare-managed (auto-enabled, can't be migrated)
function isManagedRuleset(rs: CFRuleset): boolean {
  return rs.kind === 'managed' ||
    rs.name?.startsWith('Cloudflare ') ||
    rs.name?.startsWith('DDoS ') ||
    !!rs.name?.includes('Managed');
}

// Map from capability key to the resource group keys it gates. Not every
// capability gates a group - `analyticsEngine` is item-level, `emailRouting`
// is per-address (handled separately via the Step 2 verification card).
export const CAPABILITY_GROUP_MAP: Partial<Record<keyof AccountCapabilities, string[]>> = {
  zeroTrust: ['accessApps'],
  r2: ['r2Buckets'],
  loadBalancing: ['loadBalancers', 'pools', 'monitors'],
  workers: ['workers', 'zoneWorkers', 'workerRoutes'],
  spectrum: ['spectrumApps'],
  // Analytics Engine doesn't disable an entire group - individual workers
  // with analytics_engine bindings are marked disabled at the item level.
  analyticsEngine: [],
  rateLimiting: ['rateLimits'],
  queues: ['queues'],
  d1: ['d1Databases'],
  vectorize: ['vectorizeIndexes'],
};

// Reverse map: resource group key → capability key (for acknowledgment wiring)
export const GROUP_TO_CAPABILITY: Record<string, string> = {};
for (const [capKey, groupKeys] of Object.entries(CAPABILITY_GROUP_MAP)) {
  for (const gk of groupKeys) {
    GROUP_TO_CAPABILITY[gk] = capKey;
  }
}

// Compute the default Step 2 selection map. Pure: builds the groups, then
// applies the defaulting rule (zone-scoped checked, account-scoped unchecked,
// disabled items off; `allOn` selects every non-disabled item for presets like
// MaxConfig).
//
// CRITICAL: this builds groups with the SAME `conflictStrategy` and `d1Configs`
// the live Step 2 view passes. If they diverge, item-level disable computations
// differ and `allOn` cannot select items that are disabled-at-init but
// selectable in the live view (e.g. a duplicate-named Turnstile widget under
// 'overwrite', or an acknowledged D1 db) — the MaxConfig "0/1 unchecked but
// still migrated" cosmetic bug. Keep the argument list in lockstep with the
// `buildGroups` call in ScopeReview.tsx.
export function computeDefaultSelections(
  data: ZoneExport,
  capabilities?: AccountCapabilities,
  existingTurnstileWidgets?: string[],
  allOn = false,
  conflictStrategy: ConflictStrategy = 'skip',
  d1Configs?: Record<string, D1Config>,
): Record<string, Record<string, boolean>> {
  const groups = buildGroups(data, capabilities, existingTurnstileWidgets, undefined, d1Configs, conflictStrategy);
  const defaults: Record<string, Record<string, boolean>> = {};
  for (const group of groups) {
    const groupSel: Record<string, boolean> = {};
    for (const item of group.items) {
      // Disabled groups/items (unavailable on dest) are always deselected
      if (group.disabled || item.disabled) {
        groupSel[item.id] = false;
      } else {
        groupSel[item.id] = allOn ? true : group.scope === 'zone';
      }
    }
    defaults[group.key] = groupSel;
  }
  return defaults;
}

export function buildGroups(data: ZoneExport, capabilities?: AccountCapabilities, existingTurnstileWidgets?: string[], doConfigs?: Record<string, DOConfig>, d1Configs?: Record<string, D1Config>, conflictStrategy?: ConflictStrategy, destAccountLabel?: string): ResourceGroup[] {
  const groups: ResourceGroup[] = [];

  // Collect worker names that are zone-scoped.
  // A worker is zone-scoped if ANY of these are true:
  //   1. It has a route pattern on this zone (workerRoutes)
  //   2. It has a custom domain on this zone (workerCustomDomains)
  //   3. Its export metadata says isAccountLevel: false
  const routeLinkedWorkers = new Set<string>();
  if (data.workerRoutes?.length > 0) {
    for (const r of data.workerRoutes) {
      if (r.script) routeLinkedWorkers.add(r.script);
    }
  }
  if ((data.workerCustomDomains?.length ?? 0) > 0) {
    for (const cd of data.workerCustomDomains!) {
      if (cd.service) routeLinkedWorkers.add(cd.service);
    }
  }
  if (data.workers?.length > 0) {
    for (const w of data.workers) {
      // `isAccountLevel` is added by src/migrate.ts after fetching but isn't
      // declared on CFWorkerScript. Read defensively.
      const acctLevel = (w as { isAccountLevel?: boolean }).isAccountLevel;
      if (acctLevel === false) routeLinkedWorkers.add(w.id);
    }
  }

  // ── Zone-scoped resources ──────────────────────────────────

  // DNS Records (filter out system-managed read-only records)
  if (data.dnsRecords?.length > 0) {
    const items = data.dnsRecords
      .filter((r: CFDNSRecord) => !isReadOnlyDnsRecord(r))
      .map((r: CFDNSRecord) => ({
        id: r.id,
        label: `${r.type} ${r.name}`,
        sublabel: r.proxied ? `${r.content} (proxied)` : r.content,
        raw: r,
      }));
    if (items.length > 0) {
      groups.push({ key: 'dnsRecords', label: 'DNS Records', icon: '\u{1F310}', scope: 'zone', items });
    }
  }

  // Zone Settings
  if (data.settings?.length > 0) {
    const items = data.settings
      .filter((s: CFZoneSetting) => s.editable)
      .map((s: CFZoneSetting) => {
        const item: ResourceItem = {
          id: s.id,
          label: s.id.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          sublabel: String(s.value),
          raw: s,
        };
        // ciphers requires Advanced Certificate Manager - warn the user.
        // Empty arrays are skipped during migration (no-op), but non-empty
        // values will fail if ACM is not enabled on the destination zone.
        if (s.id === 'ciphers' && Array.isArray(s.value) && s.value.length > 0) {
          item.sublabel = `${String(s.value)}  (requires Advanced Certificate Manager)`;
        }
        return item;
      });
    if (items.length > 0) {
      groups.push({ key: 'settings', label: 'Zone Settings', icon: '\u2699\uFE0F', scope: 'zone', items });
    }
  }

  // Rulesets (filter out Cloudflare-managed rulesets - DDoS, WAF Managed, Normalization)
  if (data.rulesets?.length > 0) {
    const items = data.rulesets
      .filter((rs: CFRuleset) => (rs.rules?.length ?? 0) > 0 && !isManagedRuleset(rs))
      .map((rs: CFRuleset) => ({
        id: rs.id,
        label: getRulesetDisplayName(rs),
        sublabel: `${rs.rules.length} rule${rs.rules.length !== 1 ? 's' : ''}`,
        raw: rs,
      }));
    if (items.length > 0) {
      groups.push({ key: 'rulesets', label: 'Rulesets', icon: '\u{1F6E1}\uFE0F', scope: 'zone', items });
    }
  }

  // Page Rules
  if (data.pageRules?.length > 0) {
    const items = data.pageRules.map((pr: CFPageRule) => ({
      id: pr.id,
      label: pr.targets?.[0]?.constraint?.value || `Rule #${pr.priority}`,
      sublabel: pr.actions?.map((a) => a.id).join(', '),
      raw: pr,
    }));
    groups.push({ key: 'pageRules', label: 'Page Rules', icon: '\u{1F4C4}', scope: 'zone', items });
  }

  // Firewall Rules (WAF custom rules)
  if (data.firewallRules?.length > 0) {
    const items = data.firewallRules.map((fr: CFFirewallRule) => ({
      id: fr.id,
      label: fr.description || fr.action,
      sublabel: fr.action,
      raw: fr,
    }));
    groups.push({ key: 'firewallRules', label: 'Firewall Rules', icon: '\u{1F6E1}\uFE0F', scope: 'zone', items });
  }

  // Rate Limits
  if (data.rateLimits?.length > 0) {
    const items = data.rateLimits.map((rl: CFRateLimit) => ({
      id: rl.id,
      label: rl.description || rl.match?.request?.url || 'Rule',
      sublabel: `${rl.threshold} req/${rl.period}s`,
      raw: rl,
    }));
    groups.push({ key: 'rateLimits', label: 'Rate Limits', icon: '\u23F1\uFE0F', scope: 'zone', items });
  }

  // Worker Routes (zone-scoped - triggers on this domain)
  // Filter out routes with no script - they're orphaned/disabled on the source and have nothing to migrate
  if (data.workerRoutes?.length > 0) {
    const items = data.workerRoutes
      .filter((r: CFWorkerRoute) => !!r.script) // Exclude orphaned routes (no worker attached)
      .map((r: CFWorkerRoute) => ({
        id: r.id,
        label: `Route: ${r.pattern}`,
        sublabel: `\u2192 ${r.script}`,
        raw: r,
      }));
    if (items.length > 0) {
      groups.push({ key: 'workerRoutes', label: 'Worker Routes', icon: '\u{1F6A6}', scope: 'zone', items });
    }
  }

   // Zone Workers - worker scripts tied to this zone (via route, custom domain, or isAccountLevel flag)
  if (data.workers?.length > 0 && routeLinkedWorkers.size > 0) {
    const aeUnavailable = capabilities && !capabilities.analyticsEngine.available;
    const zoneWorkerItems = data.workers
      .filter((w: CFWorkerScript) => routeLinkedWorkers.has(w.id))
      .map((w: CFWorkerScript) => {
        const bindingCount = w.bindings?.length || 0;
        const hasAeBinding = (w.bindings || []).some((b: CFWorkerBinding) => b.type === 'analytics_engine');
        const item: ResourceItem = {
          id: w.id,
          label: w.id,
          sublabel: bindingCount > 0 ? `${bindingCount} binding${bindingCount !== 1 ? 's' : ''}` : undefined,
          raw: w,
        };
        if (hasAeBinding && aeUnavailable) {
          item.disabled = true;
          item.disabledReason = capabilities!.analyticsEngine.reason || 'Analytics Engine not enabled';
        }
        return item;
      });
    if (zoneWorkerItems.length > 0) {
      groups.push({ key: 'zoneWorkers', label: 'Zone Workers', icon: '\u{1F477}', scope: 'zone', items: zoneWorkerItems });
    }
  }

  // Email Routing (backend key: emailRules, ID: tag)
  if (data.emailRoutingRules?.length > 0) {
    const items = data.emailRoutingRules.map((r: CFEmailRoutingRule) => {
      const isCatchAll = r.matchers?.length === 1 && r.matchers[0].type === 'all';
      const actionType = r.actions?.[0]?.type || 'drop';
      const label = r.name || (isCatchAll ? 'Catch-all rule' : r.tag);
      const sublabel = isCatchAll
        ? `${actionType}${r.enabled === false ? ' (disabled)' : ''}`
        : r.matchers?.[0]?.value;
      return { id: r.tag || r.id, label, sublabel, raw: r };
    });
    groups.push({ key: 'emailRules', label: 'Email Routing', icon: '\u{1F4E7}', scope: 'zone', items });
  }

  // Waiting Rooms
  if (data.waitingRooms?.length > 0) {
    const items = data.waitingRooms.map((wr: CFWaitingRoom) => ({
      id: wr.id,
      label: wr.name,
      sublabel: `${wr.host}${wr.path}`,
      raw: wr,
    }));
    groups.push({ key: 'waitingRooms', label: 'Waiting Rooms', icon: '\u{1F6CB}\uFE0F', scope: 'zone', items });
  }

  // Custom Hostnames
  if (data.customHostnames?.length > 0) {
    const items = data.customHostnames.map((ch: CFCustomHostname) => ({
      id: ch.id,
      label: ch.hostname,
      sublabel: ch.ssl?.method,
      raw: ch,
    }));
    groups.push({ key: 'customHostnames', label: 'Custom Hostnames', icon: '\u{1F517}', scope: 'zone', items });
  }

  // Custom Certificates
  if (data.customCertificates?.length > 0) {
    const items = data.customCertificates.map((cc: CFCustomCertificate) => ({
      id: cc.id,
      label: cc.hosts?.[0] || cc.id,
      sublabel: `expires ${cc.expires_on?.split('T')[0] || 'unknown'}`,
      raw: cc,
    }));
    groups.push({ key: 'customCertificates', label: 'SSL Certificates', icon: '\u{1F510}', scope: 'zone', items });
  }

  // Zaraz
  if (data.zarazConfig) {
    const toolCount = Object.keys(data.zarazConfig.tools || {}).length;
    if (toolCount > 0) {
      groups.push({
        key: 'zaraz',
        label: 'Zaraz',
        icon: '\u{1F4CA}',
        scope: 'zone',
        items: [{
          id: 'zaraz',
          label: 'Zaraz Configuration',
          sublabel: `${toolCount} tool${toolCount !== 1 ? 's' : ''}`,
          raw: data.zarazConfig,
        }],
      });
    }
  }

  // Argo Smart Routing
  if (data.argoSmartRouting?.value === 'on') {
    groups.push({
      key: 'argoSmartRouting',
      label: 'Smart Routing',
      icon: '\u{1F6E4}\uFE0F',
      scope: 'zone',
      items: [{
        id: 'smart_routing',
        label: 'Argo Smart Routing',
        sublabel: data.argoSmartRouting.value,
        raw: data.argoSmartRouting,
      }],
    });
  }

  // Argo Tiered Caching
  if (data.argoTieredCaching?.value) {
    groups.push({
      key: 'argoTieredCaching',
      label: 'Tiered Caching',
      icon: '\u{1F5C4}\uFE0F',
      scope: 'zone',
      items: [{
        id: 'tiered_caching',
        label: 'Tiered Caching',
        sublabel: data.argoTieredCaching.value,
        raw: data.argoTieredCaching,
      }],
    });
  }

  // Bot Management
  if (data.botManagement && (data.botManagement.fight_mode || data.botManagement.enable_js)) {
    groups.push({
      key: 'botManagement',
      label: 'Bot Management',
      icon: '\u{1F916}',
      scope: 'zone',
      items: [{
        id: 'bot_management',
        label: 'Bot Management Config',
        sublabel: [
          data.botManagement.fight_mode ? 'fight mode' : null,
          data.botManagement.enable_js ? 'JS detection' : null,
        ].filter(Boolean).join(', '),
        raw: data.botManagement,
      }],
    });
  }

  // ── Account-scoped resources ───────────────────────────────

  // Worker Scripts (account-level, only those NOT linked to zone routes)
  if (data.workers?.length > 0) {
    const aeUnavailable = capabilities && !capabilities.analyticsEngine.available;
    const accountWorkers = data.workers.filter((w: CFWorkerScript) => !routeLinkedWorkers.has(w.id));
    if (accountWorkers.length > 0) {
      const items = accountWorkers.map((w: CFWorkerScript) => {
        const bindingCount = w.bindings?.length || 0;
        const hasAeBinding = (w.bindings || []).some((b: CFWorkerBinding) => b.type === 'analytics_engine');
        const item: ResourceItem = {
          id: w.id,
          label: w.id,
          sublabel: bindingCount > 0 ? `${bindingCount} binding${bindingCount !== 1 ? 's' : ''}` : undefined,
          raw: w,
        };
        if (hasAeBinding && aeUnavailable) {
          item.disabled = true;
          item.disabledReason = capabilities!.analyticsEngine.reason || 'Analytics Engine not enabled';
        }
        return item;
      });
      groups.push({ key: 'workers', label: 'Worker Scripts', icon: '\u{1F477}', scope: 'account', items });
    }
  }

  // Load Balancers
  if (data.loadBalancers?.length > 0) {
    const items = data.loadBalancers.map((lb: CFLoadBalancer) => ({
      id: lb.id,
      label: lb.name,
      sublabel: lb.steering_policy ? `steering: ${lb.steering_policy}` : undefined,
      raw: lb,
    }));
    groups.push({ key: 'loadBalancers', label: 'Load Balancers', icon: '\u2696\uFE0F', scope: 'account', items });
  }

  // LB Pools
  if (data.pools?.length > 0) {
    const items = data.pools.map((p: CFPool) => ({
      id: p.id,
      label: p.name,
      sublabel: `${p.origins?.length || 0} origin${(p.origins?.length || 0) !== 1 ? 's' : ''}`,
      raw: p,
    }));
    groups.push({ key: 'pools', label: 'LB Pools', icon: '\u{1F3CA}', scope: 'account', items });
  }

  // LB Monitors
  if (data.monitors?.length > 0) {
    const items = data.monitors.map((m: CFMonitor) => ({
      id: m.id,
      label: m.description || m.type,
      sublabel: `${m.type} every ${m.interval}s`,
      raw: m,
    }));
    groups.push({ key: 'monitors', label: 'LB Health Monitors', icon: '\u{1F4DF}', scope: 'account', items });
  }

  // Access Apps
  if (data.accessApps?.length > 0) {
    const items = data.accessApps.map((a: CFAccessApp) => ({
      id: a.id,
      label: a.name,
      sublabel: `${a.type} \u2014 ${a.domain}`,
      raw: a,
    }));
    groups.push({ key: 'accessApps', label: 'Access Applications', icon: '\u{1F512}', scope: 'account', items });
  }

  // Spectrum Apps
  if (data.spectrumApps?.length > 0) {
    const items = data.spectrumApps.map((s: CFSpectrumApp) => {
      // origin_direct is set on some Spectrum responses but not declared on
      // CFSpectrumApp. Read defensively.
      const od = (s as { origin_direct?: string[] }).origin_direct;
      return {
        id: s.id,
        label: s.dns?.name || s.protocol,
        sublabel: `${s.protocol} → ${Array.isArray(od) ? od[0] : s.origin_dns?.name || 'origin'}`,
        raw: s,
      };
    });
    groups.push({ key: 'spectrumApps', label: 'Spectrum Apps', icon: '\u{1F310}', scope: 'account', items });
  }

  // Queues
  if (data.queues?.length > 0) {
    const items = data.queues.map((q: CFQueue) => {
      // `producers` is set by the CF Queues API response but isn't declared
      // on CFQueue. Read defensively.
      const producers = (q as { producers?: unknown[] }).producers;
      return {
        id: q.queue_id,
        label: q.queue_name,
        sublabel: producers?.length ? `${producers.length} producer${producers.length !== 1 ? 's' : ''}` : undefined,
        raw: q,
      };
    });
    groups.push({ key: 'queues', label: 'Queues', icon: '\u{1F4EC}', scope: 'account', items });
  }

  // Turnstile Widgets (backend key: turnstileWidgets, ID: sitekey)
  // Filter to only zone-related widgets (whose domains include the migrated zone)
  if (data.turnstileWidgets?.length > 0) {
    const relatedSitekeys = data.zoneRelatedness?.turnstileWidgets;
    const relatedWidgets = relatedSitekeys
      ? data.turnstileWidgets.filter((tw: CFTurnstileWidget) => relatedSitekeys.includes(tw.sitekey))
      : data.turnstileWidgets;
    // Only show the group if there are zone-related widgets after filtering
    if (relatedWidgets.length > 0) {
      const existingNames = new Set((existingTurnstileWidgets || []).map((n: string) => n.toLowerCase()));
      // Account widget count check: Free tier is capped at 20 widgets per
      // account (https://developers.cloudflare.com/turnstile/plans/). Surface
      // this as a per-item warning when migrating would push over the cap,
      // so it acknowledges in Step 2 rather than failing in Step 4.
      const TURNSTILE_FREE_LIMIT = 20;
      const existingCount = existingTurnstileWidgets?.length ?? 0;
      const newWidgetsNeeded = relatedWidgets.filter((tw: CFTurnstileWidget) =>
        !existingNames.has((tw.name || '').toLowerCase())
      ).length;
      const projectedTotal = existingCount + newWidgetsNeeded;
      const wouldExceedCap = projectedTotal > TURNSTILE_FREE_LIMIT;

      const items = relatedWidgets.map((tw: CFTurnstileWidget) => {
        const item: ResourceItem = {
          id: tw.sitekey,
          label: tw.name,
          sublabel: `mode: ${tw.mode}`,
          raw: tw,
        };
        const isNewWidget = !existingNames.has((tw.name || '').toLowerCase());
        if (existingNames.has((tw.name || '').toLowerCase()) && conflictStrategy !== 'overwrite') {
          item.disabled = true;
          item.disabledReason = `Widget with this name already exists${destAccountLabel ? ` on ${destAccountLabel}` : ''} (set conflict strategy to Overwrite to enable)`;
        } else if (wouldExceedCap && isNewWidget) {
          // Hitting the account cap. Mark as disabled with an actionable
          // reason: free tier accounts max out at 20 widgets, and creating
          // more will fail with "reached the limit of widgets".
          item.disabled = true;
          item.disabledReason =
            `Destination account has ${existingCount}/${TURNSTILE_FREE_LIMIT} Turnstile widgets (Free tier cap). ` +
            `Migrating this widget would exceed the cap. ` +
            `Fix: delete unused widgets on the destination, or upgrade to Enterprise Turnstile to raise the cap.`;
        }
        return item;
      });
      groups.push({ key: 'turnstileWidgets', label: 'Turnstile Widgets', icon: '\u{1F504}', scope: 'account', items });
    }
  }

  // KV Namespaces
  if (data.kvNamespaces?.length > 0) {
    const items = data.kvNamespaces.map((kv: CFKVNamespace) => ({
      id: kv.id,
      label: kv.title,
      raw: kv,
    }));
    groups.push({ key: 'kvNamespaces', label: 'KV Namespaces', icon: '\u{1F5C3}\uFE0F', scope: 'account', items });
  }

  // R2 Buckets
  if (data.r2Buckets?.length > 0) {
    const items = data.r2Buckets.map((b: CFR2Bucket) => {
      // If this bucket has CORS/lifecycle/managed-domain settings, show them
      // in the sublabel so the user knows additional config will migrate.
      const cfg = (data.r2BucketConfigs || []).find((c: CFR2BucketConfig) => c.bucketName === b.name);
      const cfgBits: string[] = [];
      if (cfg?.cors?.length) cfgBits.push(`${cfg.cors.length} CORS rule${cfg.cors.length === 1 ? '' : 's'}`);
      if (cfg?.lifecycle?.length) cfgBits.push(`${cfg.lifecycle.length} lifecycle rule${cfg.lifecycle.length === 1 ? '' : 's'}`);
      if (cfg?.managedDomain?.enabled) cfgBits.push('public r2.dev domain');
      const createdLabel = b.creation_date ? `created ${b.creation_date.split('T')[0]}` : undefined;
      const sublabel = cfgBits.length > 0
        ? [createdLabel, cfgBits.join(', ')].filter(Boolean).join(' · ')
        : createdLabel;
      return {
        id: b.name,
        label: b.name,
        sublabel,
        raw: b,
      };
    });
    groups.push({ key: 'r2Buckets', label: 'R2 Buckets', icon: '\u{1FAA3}', scope: 'account', items });
  }

  // Pages Projects (account-scoped)
  if ((data.pagesProjects?.length ?? 0) > 0) {
    const items = data.pagesProjects!.map((p: CFPagesProject) => ({
      id: p.name,
      label: p.name,
      sublabel: p.production_branch ? `branch: ${p.production_branch}` : undefined,
      raw: p,
    }));
    groups.push({ key: 'pagesProjects', label: 'Pages Projects', icon: '\u{1F4C4}', scope: 'account', items });
  }

  // AI Gateways (account-scoped)
  if ((data.aiGateways?.length ?? 0) > 0) {
    const items = data.aiGateways!.map((g: CFAiGateway) => {
      const bits: string[] = [];
      if (g.cache_ttl) bits.push(`cache ${g.cache_ttl}s`);
      if (g.rate_limiting_limit) bits.push(`${g.rate_limiting_limit}/${g.rate_limiting_interval}s`);
      if (g.authentication) bits.push('auth');
      return {
        id: g.id,
        label: g.id,
        sublabel: bits.length > 0 ? bits.join(' · ') : undefined,
        raw: g,
      };
    });
    groups.push({ key: 'aiGateways', label: 'AI Gateways', icon: '\u{1F916}', scope: 'account', items });
  }

  // AI Gateway Custom Providers
  if ((data.aiGatewayCustomProviders?.length ?? 0) > 0) {
    const items = data.aiGatewayCustomProviders!.map((p: CFAiGatewayCustomProvider) => ({
      id: p.slug,
      label: p.name || p.slug,
      sublabel: p.base_url,
      raw: p,
    }));
    groups.push({ key: 'aiGatewayCustomProviders', label: 'AI Gateway Custom Providers', icon: '\u{1F50C}', scope: 'account', items });
  }

  // Origin CA Certificates (zone-scoped) - selection determines which
  // certs will be re-issued on dest via Step 3 user-supplied CSRs.
  if ((data.originCaCertificates?.length ?? 0) > 0) {
    const items = data.originCaCertificates!.map((c: CFOriginCaCertificate) => ({
      id: c.id,
      label: (c.hostnames || []).join(', ') || c.id,
      sublabel: `${c.request_type} · ${c.requested_validity}d · expires ${c.expires_on?.slice(0, 10) || 'N/A'}`,
      raw: c,
    }));
    groups.push({ key: 'originCaCertificates', label: 'Origin CA Certificates', icon: '\u{1F510}', scope: 'zone', items });
  }

  // D1 Databases - freely selectable (#15). The database is created on the
  // destination; schema + data are copied as post-migration work (wrangler,
  // surfaced in PostMigrationWorkPanel + the Apply step), so there is no
  // inline acknowledgement gate here. The old per-db ack card was a redundant
  // duplicate of that post-migration list.
  if (data.d1Databases?.length > 0) {
    const items: ResourceItem[] = data.d1Databases.map((d: CFD1Database) => ({
      id: d.uuid,
      label: d.name,
      sublabel: d.num_tables != null ? `${d.num_tables} table${d.num_tables !== 1 ? 's' : ''}` : undefined,
      raw: d,
    }));
    groups.push({ key: 'd1Databases', label: 'D1 Databases', icon: '\u{1F4BE}', scope: 'account', items });
  }

  // Durable Objects - items are workers that own DO namespaces, grouped by
  // script. Freely selectable (#15): the namespace is created when the worker
  // deploys, regardless of whether state migration is configured. The per-item
  // DO config (enable + object names + source/dest worker URLs) is OPTIONAL and
  // drives the in-tool state copy; stored state that isn't copied is surfaced as
  // post-migration work (the `durable_object_state` IMPOSSIBLE_TO_MIGRATE entry).
  if (data.durableObjectNamespaces?.length > 0) {
    // Group namespaces by script name
    const byScript = new Map<string, { classes: string[]; namespaces: any[] }>();
    for (const d of data.durableObjectNamespaces) {
      const script = d.script || 'unknown';
      if (!byScript.has(script)) byScript.set(script, { classes: [], namespaces: [] });
      const entry = byScript.get(script)!;
      entry.classes.push(d.class || d.name || d.id);
      entry.namespaces.push(d);
    }
    const items: ResourceItem[] = [...byScript.entries()].map(([script, { classes, namespaces }]) => ({
      id: script,
      label: script,
      sublabel: classes.join(', '),
      raw: namespaces,
    }));
    groups.push({
      key: 'durableObjects',
      label: 'Durable Objects',
      icon: '\u{1F4A0}',
      scope: 'account',
      items,
    });
  }

  // Mark groups as disabled if the destination account lacks the required capability
  if (capabilities) {
    const acctSuffix = destAccountLabel ? ` on ${destAccountLabel}` : ' on the destination account';
    // Build a reverse map: groupKey -> capability info
    const disabledGroups = new Map<string, { reason: string; action: string }>();
    for (const [capKey, groupKeys] of Object.entries(CAPABILITY_GROUP_MAP)) {
      const cap = capabilities[capKey as keyof AccountCapabilities];
      // Only FeatureAvailability-shaped capabilities gate groups. Non-FA caps
      // (e.g. `emailRouting` carrying destinationAddresses) aren't in
      // CAPABILITY_GROUP_MAP, but the type system can't see that, so we
      // explicitly skip them here.
      if (!cap || !('available' in cap)) continue;
      if (!cap.available && groupKeys) {
        for (const gk of groupKeys) {
          // Replace generic "on this account" with specific account label
          const reason = cap.reason
            ? cap.reason.replace(/on this account$/i, acctSuffix).replace(/not enabled$/i, `not enabled${acctSuffix}`)
            : `${capKey} is not available${acctSuffix}`;
          disabledGroups.set(gk, {
            reason,
            action: cap.action
              ? `${cap.action} Then re-check above.`
              : 'Enable this feature on the destination account and re-check.',
          });
        }
      }
    }
    for (const group of groups) {
      const info = disabledGroups.get(group.key);
      if (info) {
        group.disabled = true;
        group.disabledReason = info.reason;
        group.disabledAction = info.action;
      }
    }
  }

  // NOTE: We intentionally do NOT promote group.disabled when all items are
  // individually disabled.  Group-level "Unavailable" should only appear when
  // the destination account lacks a capability (handled above).  Per-item
  // disables (e.g. AE-bound workers, Turnstile duplicates) are shown inline
  // with "Skipped" badges when the group is expanded - the group itself stays
  // interactive so the user can still inspect the items.

  // Sort: zone groups first, then account groups (preserving order within each)
  const zoneGroups = groups.filter(g => g.scope === 'zone');
  const accountGroups = groups.filter(g => g.scope === 'account');
  return [...zoneGroups, ...accountGroups];
}
