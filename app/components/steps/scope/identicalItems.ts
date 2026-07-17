// Pure matching layer for the Step 2 "already identical on destination"
// graying (#15 decision 6).
//
// The /api/diff/stream endpoint returns an `identical` list — the resources
// that already exist on the destination with identical values (the diff's
// `skip` items), each shaped { resource, name }. Step 2 needs to decide, per
// rendered item, whether it is one of those no-ops. Both sides derive their
// key from the same source field definitions, so the match is exact.
//
// Only the four types diff.ts compares are matchable (DNS records, zone
// settings, page rules, worker routes). Items in any other group are never
// "identical" (we have no comparison for them) and always render normally.
//
// IMPORTANT (safety): this is advisory only. A matched item is still selected
// and still migrated — an overwrite that writes an identical value is a
// harmless no-op. So a missed or spurious match can only add/remove an
// advisory badge; it can never cause a resource to silently not migrate.

import type { CFDNSRecord, CFZoneSetting, CFPageRule, CFWorkerRoute } from '../../../../src/types';

export interface IdenticalResource {
  resource: string;
  name: string;
}

/** Stable key combining the diff resourceType with the per-type name. */
export function identicalKey(resource: string, name: string): string {
  return `${resource}||${name}`;
}

/** Build the lookup set from the endpoint's `identical` list. */
export function buildIdenticalSet(identical: IdenticalResource[] | undefined | null): Set<string> {
  const set = new Set<string>();
  for (const i of identical ?? []) {
    if (i && typeof i.resource === 'string' && typeof i.name === 'string') {
      set.add(identicalKey(i.resource, i.name));
    }
  }
  return set;
}

// Map a Step 2 group key + raw resource to the (resourceType, name) the diff
// engine used, so we can look it up in the identical set. Returns null for
// groups diff.ts doesn't compare (so they never gray). Mirrors the per-type
// helpers in src/diff.ts — keep these in lock-step.
function diffIdentity(groupKey: string, raw: unknown): { resource: string; name: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  switch (groupKey) {
    case 'dnsRecords': {
      const r = raw as CFDNSRecord;
      if (!r.type || !r.name) return null;
      return { resource: 'DNS Record', name: `${r.type} ${r.name}` };
    }
    case 'settings': {
      const s = raw as CFZoneSetting;
      if (!s.id) return null;
      return { resource: 'Zone Setting', name: s.id };
    }
    case 'pageRules': {
      const p = raw as CFPageRule;
      const target = p.targets?.[0]?.constraint?.value;
      if (!target) return null;
      return { resource: 'Page Rule', name: target };
    }
    case 'workerRoutes': {
      const r = raw as CFWorkerRoute;
      if (!r.pattern) return null;
      return { resource: 'Worker Route', name: r.pattern };
    }
    default:
      return null;
  }
}

/** True when this Step 2 item already exists identically on the destination. */
export function isItemIdentical(
  identicalSet: Set<string>,
  groupKey: string,
  raw: unknown,
): boolean {
  if (identicalSet.size === 0) return false;
  const id = diffIdentity(groupKey, raw);
  if (!id) return false;
  return identicalSet.has(identicalKey(id.resource, id.name));
}
