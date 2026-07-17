// Ruleset helpers — collecting execute references, rewriting execute
// targets after ID remapping, and detecting managed (auto-enabled)
// rulesets that aren't user-modifiable.
//
// All functions here are pure; safe to unit-test without HTTP mocking.

// Walk a list of rulesets and collect every account-ruleset ID referenced
// by an `execute` action. The execute action has the shape:
//   { action: 'execute', action_parameters: { id: '<ruleset_uuid>', ... } }
// where the `id` is the ruleset to invoke. Used during export to determine
// which account-level rulesets must be fetched and migrated alongside the
// zone, and during migrate to know which references to remap.
//
// Returns a deduplicated array of ruleset IDs. Filters out anything that
// doesn't look like a uuid (defensive against weird payload shapes).
export function collectExecutedAccountRulesetIds(
  rulesets: Array<{ rules?: Array<{ action: string; action_parameters?: Record<string, unknown> }> }>,
): string[] {
  const ids = new Set<string>();
  // Loose uuid match — Cloudflare ruleset IDs are 32-char hex, not strict v4 uuids
  const UUID_LIKE = /^[a-f0-9]{32}$/i;
  for (const rs of rulesets) {
    if (!rs.rules) continue;
    for (const rule of rs.rules) {
      if (rule.action !== 'execute') continue;
      const ap = rule.action_parameters;
      if (!ap || typeof ap !== 'object') continue;
      const id = (ap as Record<string, unknown>).id;
      if (typeof id !== 'string') continue;
      if (!UUID_LIKE.test(id)) continue;
      ids.add(id);
    }
  }
  return [...ids];
}

// Rewrite `execute` action references in a list of rules to point at new
// (destination-account) ruleset IDs. Rules whose execute target is not in
// the map are left alone — the caller is responsible for emitting an
// acknowledgment for unmapped references.
//
// Pure function: returns a new array of rules without mutating the input.
export function rewriteExecuteActionTargets(
  rules: Array<{ action: string; action_parameters?: Record<string, unknown>; [key: string]: unknown }>,
  idMap: Map<string, string>,
): typeof rules {
  return rules.map(r => {
    if (r.action !== 'execute') return r;
    const ap = r.action_parameters;
    if (!ap || typeof ap !== 'object') return r;
    const id = (ap as Record<string, unknown>).id;
    if (typeof id !== 'string' || !idMap.has(id)) return r;
    return {
      ...r,
      action_parameters: { ...(ap as Record<string, unknown>), id: idMap.get(id)! },
    };
  });
}

// Partition zone-level `execute` target IDs into custom account rulesets we
// must migrate vs managed/global rulesets we must NOT.
//
// Cloudflare REJECTS zone-level execute rules that point at custom-scope
// account rulesets (error 20230), so in practice zone-level execute targets are
// MANAGED rulesets (e.g. the Cloudflare Managed Ruleset deployed via the
// http_request_firewall_managed phase). Those use GLOBAL ruleset IDs that are
// already valid on every account, so they're auto-provisioned on the
// destination — never migratable and never "stale". Fetching one as a custom
// account ruleset 404s, which previously produced a spurious "zone rules will
// reference stale IDs" alarm.
//
// `customRulesetIds` must be the authoritative set of custom account ruleset
// IDs (from listAccountRulesets). An ID present there is a genuine custom
// ruleset to migrate; anything else is managed/global.
export function partitionAccountRulesetReferences(
  zoneExecuteIds: string[],
  customRulesetIds: Set<string>,
): { custom: string[]; managed: string[] } {
  const custom: string[] = [];
  const managed: string[] = [];
  for (const id of zoneExecuteIds) {
    if (customRulesetIds.has(id)) custom.push(id);
    else managed.push(id);
  }
  return { custom, managed };
}

// Check if a ruleset is managed (auto-enabled, can't be migrated).
export function isManagedRuleset(rs: { kind: string; name: string }): boolean {
  return rs.kind === 'managed' ||
    rs.name.startsWith('Cloudflare ') ||
    rs.name.startsWith('DDoS ') ||
    rs.name.includes('Managed');
}
