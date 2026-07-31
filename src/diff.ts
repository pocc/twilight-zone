import type { ZoneExport, CFDNSRecord, CFZoneSetting, CFPageRule, CFWorkerRoute } from './types';
import * as api from './api';

// =============================================================================
// DIFF MODE - Compare source and destination before migration
// =============================================================================

export type DiffAction = 'create' | 'update' | 'skip' | 'conflict';

export interface DiffItem<T = unknown> {
  action: DiffAction;
  resourceType: string;
  name: string;
  source?: T;
  destination?: T;
  reason?: string;
}

export interface DiffReport {
  timestamp: string;
  sourceZone: string;
  destZone: string;
  summary: {
    create: number;
    update: number;
    skip: number;
    conflict: number;
  };
  items: DiffItem[];
  warnings: string[];
}

// Compare two values for equality (deep comparison for objects)
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  
  if (aKeys.length !== bKeys.length) return false;
  
  return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
}

// Generate diff for DNS records.
//
// DNS RRsets are multi-valued: several A / MX / TXT records routinely share
// one type+name and differ only by content. Keying the dest map by
// `type:name` (as before) kept only the LAST dest record per key, so every
// source value in a multi-value RRset was compared against that single dest
// record — producing spurious `update` rows and false matches. We instead
// bucket dest records by `type:name` and match per-value by content, and
// CONSUME each matched dest record so two identical source values can't both
// match one dest record.
function diffDNSRecords(source: CFDNSRecord[], dest: CFDNSRecord[]): DiffItem<CFDNSRecord>[] {
  const items: DiffItem<CFDNSRecord>[] = [];
  const destBuckets = new Map<string, CFDNSRecord[]>();
  for (const r of dest) {
    const k = `${r.type}:${r.name}`;
    const bucket = destBuckets.get(k);
    if (bucket) bucket.push(r);
    else destBuckets.set(k, [r]);
  }

  for (const srcRecord of source) {
    const key = `${srcRecord.type}:${srcRecord.name}`;
    const bucket = destBuckets.get(key);

    if (!bucket || bucket.length === 0) {
      items.push({
        action: 'create',
        resourceType: 'DNS Record',
        name: `${srcRecord.type} ${srcRecord.name}`,
        source: srcRecord,
      });
      continue;
    }

    // Prefer an exact content match (consume it so it isn't reused); otherwise
    // fall back to any remaining record in the bucket as the update target.
    const exactIdx = bucket.findIndex(d => d.content === srcRecord.content);
    if (exactIdx !== -1) {
      const destRecord = bucket.splice(exactIdx, 1)[0];
      if (srcRecord.proxied === destRecord.proxied && srcRecord.ttl === destRecord.ttl) {
        items.push({
          action: 'skip',
          resourceType: 'DNS Record',
          name: `${srcRecord.type} ${srcRecord.name}`,
          source: srcRecord,
          destination: destRecord,
          reason: 'Already exists with same values',
        });
      } else {
        items.push({
          action: 'update',
          resourceType: 'DNS Record',
          name: `${srcRecord.type} ${srcRecord.name}`,
          source: srcRecord,
          destination: destRecord,
          reason: `Proxied/TTL differs (content matches "${srcRecord.content}")`,
        });
      }
    } else {
      const destRecord = bucket.shift()!;
      items.push({
        action: 'update',
        resourceType: 'DNS Record',
        name: `${srcRecord.type} ${srcRecord.name}`,
        source: srcRecord,
        destination: destRecord,
        reason: `Content differs: "${srcRecord.content}" vs "${destRecord.content}"`,
      });
    }
  }

  return items;
}

// Generate diff for zone settings
function diffSettings(source: CFZoneSetting[], dest: CFZoneSetting[]): DiffItem<CFZoneSetting>[] {
  const items: DiffItem<CFZoneSetting>[] = [];
  const destMap = new Map(dest.map(s => [s.id, s]));
  
  const readOnlySettings = new Set([
    'advanced_ddos', 'plan_level', 'ssl_status', 'custom_certificate_quota',
    'page_rule_quota', 'cname_flattening', 'orange_to_orange',
  ]);
  
  for (const srcSetting of source) {
    if (!srcSetting.editable || readOnlySettings.has(srcSetting.id)) continue;
    
    const destSetting = destMap.get(srcSetting.id);
    
    if (!destSetting) {
      items.push({
        action: 'create',
        resourceType: 'Zone Setting',
        name: srcSetting.id,
        source: srcSetting,
      });
    } else if (deepEqual(srcSetting.value, destSetting.value)) {
      items.push({
        action: 'skip',
        resourceType: 'Zone Setting',
        name: srcSetting.id,
        source: srcSetting,
        destination: destSetting,
        reason: 'Already set to same value',
      });
    } else {
      items.push({
        action: 'update',
        resourceType: 'Zone Setting',
        name: srcSetting.id,
        source: srcSetting,
        destination: destSetting,
        reason: `Value differs: ${JSON.stringify(srcSetting.value)} vs ${JSON.stringify(destSetting.value)}`,
      });
    }
  }
  
  return items;
}

// Generate diff for page rules
function diffPageRules(source: CFPageRule[], dest: CFPageRule[]): DiffItem<CFPageRule>[] {
  const items: DiffItem<CFPageRule>[] = [];
  const destMap = new Map(dest.map(r => [r.targets[0]?.constraint.value, r]));
  
  for (const srcRule of source) {
    const target = srcRule.targets[0]?.constraint.value;
    const destRule = destMap.get(target);
    
    if (!destRule) {
      items.push({
        action: 'create',
        resourceType: 'Page Rule',
        name: target || 'unknown',
        source: srcRule,
      });
    } else if (deepEqual(srcRule.actions, destRule.actions)) {
      items.push({
        action: 'skip',
        resourceType: 'Page Rule',
        name: target || 'unknown',
        source: srcRule,
        destination: destRule,
        reason: 'Already exists with same actions',
      });
    } else {
      items.push({
        action: 'conflict',
        resourceType: 'Page Rule',
        name: target || 'unknown',
        source: srcRule,
        destination: destRule,
        reason: 'Exists with different actions - manual review needed',
      });
    }
  }
  
  return items;
}

// Generate diff for worker routes
function diffWorkerRoutes(source: CFWorkerRoute[], dest: CFWorkerRoute[]): DiffItem<CFWorkerRoute>[] {
  const items: DiffItem<CFWorkerRoute>[] = [];
  const destMap = new Map(dest.map(r => [r.pattern, r]));
  
  for (const srcRoute of source) {
    const destRoute = destMap.get(srcRoute.pattern);
    
    if (!destRoute) {
      items.push({
        action: 'create',
        resourceType: 'Worker Route',
        name: srcRoute.pattern,
        source: srcRoute,
      });
    } else if (srcRoute.script === destRoute.script) {
      items.push({
        action: 'skip',
        resourceType: 'Worker Route',
        name: srcRoute.pattern,
        source: srcRoute,
        destination: destRoute,
        reason: 'Already exists with same script',
      });
    } else {
      items.push({
        action: 'update',
        resourceType: 'Worker Route',
        name: srcRoute.pattern,
        source: srcRoute,
        destination: destRoute,
        reason: `Script differs: "${srcRoute.script}" vs "${destRoute.script}"`,
      });
    }
  }
  
  return items;
}

// Main diff function - compare source export with destination zone
export async function generateDiff(
  sourceExport: ZoneExport,
  destAuth: api.ApiAuth | string,
  destZoneId: string,
  destZoneName: string
): Promise<DiffReport> {
  const items: DiffItem[] = [];
  const warnings: string[] = [];
  
  try {
    // [W14] Fetch destination data — log warnings instead of silently returning empty arrays
    const [destDns, destSettings, destPageRules, destRoutes] = await Promise.all([
      api.listDNSRecords(destAuth, destZoneId).catch((e) => {
        api.throwIfAuthError(e);
        warnings.push(`Failed to fetch destination DNS records: ${(e as Error).message}`);
        return [] as CFDNSRecord[];
      }),
      api.listZoneSettings(destAuth, destZoneId).catch((e) => {
        api.throwIfAuthError(e);
        warnings.push(`Failed to fetch destination zone settings: ${(e as Error).message}`);
        return [] as CFZoneSetting[];
      }),
      api.listPageRules(destAuth, destZoneId).catch((e) => {
        api.throwIfAuthError(e);
        warnings.push(`Failed to fetch destination page rules: ${(e as Error).message}`);
        return [] as CFPageRule[];
      }),
      api.listWorkerRoutes(destAuth, destZoneId).catch((e) => {
        api.throwIfAuthError(e);
        warnings.push(`Failed to fetch destination worker routes: ${(e as Error).message}`);
        return [] as CFWorkerRoute[];
      }),
    ]);
    
    // Generate diffs
    items.push(...diffDNSRecords(sourceExport.dnsRecords, destDns));
    items.push(...diffSettings(sourceExport.settings, destSettings));
    items.push(...diffPageRules(sourceExport.pageRules, destPageRules));
    items.push(...diffWorkerRoutes(sourceExport.workerRoutes, destRoutes));
    
    // Add create items for resources that don't have comparison (always create)
    for (const worker of sourceExport.workers) {
      items.push({
        action: 'create',
        resourceType: 'Worker Script',
        name: worker.id,
      });
    }
    
    for (const lb of sourceExport.loadBalancers) {
      items.push({
        action: 'create',
        resourceType: 'Load Balancer',
        name: lb.name,
      });
    }
    
    // Warnings for resources that need manual attention
    if (sourceExport.customHostnames.length > 0) {
      warnings.push(`${sourceExport.customHostnames.length} Custom Hostnames require SSL validation after migration`);
    }
    
    const workersWithSecrets = sourceExport.workers.filter(w => 
      w.bindings?.some(b => b.type === 'secret_text')
    );
    if (workersWithSecrets.length > 0) {
      warnings.push(`${workersWithSecrets.length} Workers have secrets that must be provided manually`);
    }
    
  } catch (e) {
    api.throwIfAuthError(e);
    warnings.push(`Could not fetch destination zone data: ${(e as Error).message}`);
    // Fall back to treating everything as create
    for (const record of sourceExport.dnsRecords) {
      items.push({
        action: 'create',
        resourceType: 'DNS Record',
        name: `${record.type} ${record.name}`,
        source: record,
      });
    }
  }
  
  // Calculate summary
  const summary = {
    create: items.filter(i => i.action === 'create').length,
    update: items.filter(i => i.action === 'update').length,
    skip: items.filter(i => i.action === 'skip').length,
    conflict: items.filter(i => i.action === 'conflict').length,
  };
  
  return {
    timestamp: new Date().toISOString(),
    sourceZone: sourceExport.zone.name,
    destZone: destZoneName,
    summary,
    items,
    warnings,
  };
}

// Pure source-vs-destination comparison over two already-fetched ZoneExports.
//
// Unlike generateDiff (which fetches the destination live), this performs no
// I/O — both sides are supplied by the caller. It powers the Step 4 "Verify
// against destination" action (the client exports the dest zone, then asks the
// worker to diff the two exports) and the Step 2 "already identical on
// destination" graying (decision 6), which keys off the `skip` items.
//
// Only the four types with real comparison logic are included (DNS, zone
// settings, page rules, worker routes). Resources we can't compare are
// deliberately omitted rather than reported as blanket "missing" — a false
// "missing" on the verify page would violate No Surprise Failures (Principle 1).
export function diffExports(sourceExport: ZoneExport, destExport: ZoneExport): DiffReport {
  const items: DiffItem[] = [
    ...diffDNSRecords(sourceExport.dnsRecords, destExport.dnsRecords),
    ...diffSettings(sourceExport.settings, destExport.settings),
    ...diffPageRules(sourceExport.pageRules, destExport.pageRules),
    ...diffWorkerRoutes(sourceExport.workerRoutes, destExport.workerRoutes),
  ];

  const summary = {
    create: items.filter(i => i.action === 'create').length,
    update: items.filter(i => i.action === 'update').length,
    skip: items.filter(i => i.action === 'skip').length,
    conflict: items.filter(i => i.action === 'conflict').length,
  };

  return {
    timestamp: new Date().toISOString(),
    sourceZone: sourceExport.zone.name,
    destZone: destExport.zone.name,
    summary,
    items,
    warnings: [],
  };
}

/** Post-migration verification discrepancy, matching the
 * `MigrationReport.verification.diff.discrepancies` shape consumed by Step 4. */
export interface VerificationDiscrepancy {
  path: string;
  type: 'missing' | 'extra' | 'mismatched';
  reason?: string;
  resource?: string;
  source?: unknown;
  dest?: unknown;
}

// Map a source→dest DiffReport into the post-migration verification view.
// `create` (in source, absent on dest) → missing; `update`/`conflict`
// (present but differing) → mismatched; `skip` (identical) is not a
// discrepancy and is omitted. There is no `extra` here because the per-type
// helpers iterate the source side only.
export function diffReportToDiscrepancies(report: DiffReport): VerificationDiscrepancy[] {
  const out: VerificationDiscrepancy[] = [];
  for (const item of report.items) {
    if (item.action === 'skip') continue;
    out.push({
      path: item.name,
      type: item.action === 'create' ? 'missing' : 'mismatched',
      reason: item.reason ?? (item.action === 'create' ? 'Present in source, missing on destination' : undefined),
      resource: item.resourceType,
      source: item.source,
      dest: item.destination,
    });
  }
  return out;
}

/** A resource that already exists on the destination with identical values
 * (a `skip` item). Surfaced to Step 2 so it can gray the row as "already
 * identical on destination" (#15 decision 6). */
export interface IdenticalResource {
  resource: string;
  name: string;
}

// The `skip` items from a source→dest diff: resources already present on the
// destination with identical values. Step 2 uses this to mark no-op rows.
export function diffReportIdentical(report: DiffReport): IdenticalResource[] {
  return report.items
    .filter(i => i.action === 'skip')
    .map(i => ({ resource: i.resourceType, name: i.name }));
}

// Format diff report as readable text
export function formatDiffReport(report: DiffReport): string {
  const lines: string[] = [
    '# Migration Diff Report',
    '',
    `Source: ${report.sourceZone}`,
    `Destination: ${report.destZone}`,
    `Generated: ${report.timestamp}`,
    '',
    '## Summary',
    '',
    `- 🆕 Create: ${report.summary.create}`,
    `- 📝 Update: ${report.summary.update}`,
    `- ⏭️ Skip: ${report.summary.skip}`,
    `- ⚠️ Conflict: ${report.summary.conflict}`,
    '',
  ];
  
  if (report.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const warning of report.warnings) {
      lines.push(`- ⚠️ ${warning}`);
    }
    lines.push('');
  }
  
  // Group items by action
  const byAction: Record<DiffAction, DiffItem[]> = {
    create: [],
    update: [],
    skip: [],
    conflict: [],
  };
  
  for (const item of report.items) {
    byAction[item.action].push(item);
  }
  
  if (byAction.create.length > 0) {
    lines.push('## Will Create', '');
    for (const item of byAction.create) {
      lines.push(`- [CREATE] ${item.resourceType}: ${item.name}`);
    }
    lines.push('');
  }
  
  if (byAction.update.length > 0) {
    lines.push('## Will Update', '');
    for (const item of byAction.update) {
      lines.push(`- [UPDATE] ${item.resourceType}: ${item.name}`);
      if (item.reason) lines.push(`  Reason: ${item.reason}`);
    }
    lines.push('');
  }
  
  if (byAction.conflict.length > 0) {
    lines.push('## Conflicts (Manual Review)', '');
    for (const item of byAction.conflict) {
      lines.push(`- [CONFLICT] ${item.resourceType}: ${item.name}`);
      if (item.reason) lines.push(`  Reason: ${item.reason}`);
    }
    lines.push('');
  }
  
  if (byAction.skip.length > 0) {
    lines.push('## Will Skip (Already Exists)', '');
    for (const item of byAction.skip) {
      lines.push(`- [SKIP] ${item.resourceType}: ${item.name}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}
