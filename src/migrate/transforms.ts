// Pure data transformations used across the migrate engine. Anything
// that walks a nested JSON value, rewrites string leaves, or dedupes
// arrays without I/O lives here.

import type { CFAccessApp, CFAccessDestination, CFDNSRecord } from '../types';

// Rewrite occurrences of the source zone name with the destination zone
// name inside a single string (hostname, hostname+path, URL, expression, …).
// Used for resources whose domain field references the source zone and must
// be re-pointed at the dest zone (page rules, Access app domains, ruleset
// expressions, redirect URLs, …).
//
// Boundary-aware: the zone name is replaced ONLY where it occurs as a whole
// hostname or hostname suffix — never as an arbitrary substring. A naive
// `replaceAll` corrupts collisions like:
//   - `notexample.com`        (zone `example.com` is a SUFFIX of a longer label)
//   - `example.com.evil.test` (zone is a PREFIX label of a different host)
// The lookbehind rejects a preceding hostname-label char (alnum or `-`) so a
// longer label like `not…` doesn't match; the lookahead rejects a following
// alnum / `-` / `.` so `example.com.evil.test` (followed by `.evil`) doesn't
// match while `app.example.com/path` (followed by `/`) and a bare apex do.
// Subdomains still rewrite correctly because a preceding `.` is allowed.
//
// Non-string input is returned untouched (callers pass optional fields).
// When source and dest zone names are identical, or either is empty, the
// value is returned unchanged. Strings without the source zone (e.g. a SaaS
// app domain like "myapp.okta.com") are left alone, so this is safe to apply
// unconditionally.
export function rewriteZoneDomain(
  value: string,
  sourceZoneName: string,
  destZoneName: string,
): string {
  if (typeof value !== 'string') return value;
  if (!sourceZoneName || !destZoneName || sourceZoneName === destZoneName) return value;
  const escaped = sourceZoneName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9.-])`, 'g');
  return value.replace(re, destZoneName);
}

// Boundary-aware predicate: is `target` a hostname that lives INSIDE `zoneName`
// (the zone apex itself, or any subdomain of it)? Mirrors the boundary rule used
// by rewriteZoneDomain / convertDnsName — `example.com` matches only as a full
// apex or as a dotted suffix, never as a bare substring, so `notexample.com` and
// `example.com.evil.test` are correctly rejected. Case-insensitive; a trailing
// dot (FQDN form, e.g. `app.example.com.`) is tolerated. Empty inputs → false.
export function isInZoneHostname(target: string, zoneName: string): boolean {
  if (!target || !zoneName) return false;
  const t = target.trim().replace(/\.$/, '').toLowerCase();
  const z = zoneName.trim().replace(/\.$/, '').toLowerCase();
  if (!t || !z) return false;
  return t === z || t.endsWith('.' + z);
}

// DNS record types whose `content` (or, for SRV, `data.target`) is a HOSTNAME
// that can reference another name. These are the only types where an "in-zone
// self-reference" is meaningful. A/AAAA hold IPs, TXT/CAA hold arbitrary text,
// so they are deliberately excluded — their content must never be matched as a
// hostname (that's the corruption the content-rewrite "fix" would have caused).
const HOSTNAME_TARGET_TYPES = new Set(['CNAME', 'ALIAS', 'MX', 'NS', 'PTR', 'SRV']);

// Extract the hostname a record points AT, or undefined if the type carries no
// hostname target. SRV stores its target in structured `data.target`.
function dnsHostnameTarget(record: CFDNSRecord): string | undefined {
  if (!HOSTNAME_TARGET_TYPES.has(record.type)) return undefined;
  if (record.type === 'SRV') {
    const t = (record.data as { target?: unknown } | undefined)?.target;
    return typeof t === 'string' && t ? t : undefined;
  }
  return typeof record.content === 'string' && record.content ? record.content : undefined;
}

// Find DNS records whose hostname target points back INTO `zoneName` (the source
// zone). The migration rewrites each record's NAME onto the dest zone but passes
// its CONTENT through verbatim (rewriting content would corrupt external targets
// like MX→mail-provider or CNAME→SaaS). The rare exception is a record that
// targets its own zone (e.g. `CNAME www → app.<sourcezone>`): post-cutover that
// target still references the OLD zone and must be repointed by hand. This
// surfaces those records so the user isn't silently surprised (Principles 3 & 9).
// Returns the matched records paired with the offending target string.
export function findInZoneDnsTargets(
  records: CFDNSRecord[] | undefined,
  zoneName: string,
): Array<{ record: CFDNSRecord; target: string }> {
  if (!records?.length || !zoneName) return [];
  const hits: Array<{ record: CFDNSRecord; target: string }> = [];
  for (const record of records) {
    const target = dnsHostnameTarget(record);
    if (target && isInZoneHostname(target, zoneName)) {
      hits.push({ record, target });
    }
  }
  return hits;
}

// Collect every zone-hostname candidate referenced by an Access app:
// the legacy `domain`, each `self_hosted_domains[]` entry, and each
// destination's `uri` (public) or `hostname` (private). Used by the export
// to decide whether an app is zone-related — a modern app may have an empty
// `domain` and route entirely through `destinations[]`, so checking `domain`
// alone would wrongly drop it from the migration. CIDRs, vnet IDs, and MCP
// server IDs are not hostnames and are excluded.
export function accessAppHostnames(app: CFAccessApp): string[] {
  const out: string[] = [];
  if (app.domain) out.push(app.domain);
  for (const d of app.self_hosted_domains || []) {
    if (typeof d === 'string' && d) out.push(d);
  }
  for (const dest of app.destinations || []) {
    if (dest.uri) out.push(dest.uri);
    if (dest.hostname) out.push(dest.hostname);
  }
  return out;
}

// Build the source→dest zone-rewritten subset of an Access app's
// routing fields for the create body. Rewrites the legacy `domain`, every
// `self_hosted_domains[]` hostname, and each destination's `uri`/`hostname`
// through rewriteZoneDomain (safe to apply unconditionally — only strings
// containing the source zone name change). `self_hosted_domains` /
// `destinations` are only present in the result when the source app had
// them, so we never send empty arrays that would override the legacy
// `domain` routing. Non-hostname destination fields (cidr, vnet_id,
// mcp_server_id, l4_protocol, port_range, type) are preserved verbatim.
export function rewriteAccessAppDomains(
  app: CFAccessApp,
  sourceZoneName: string,
  destZoneName: string,
): { domain: string; self_hosted_domains?: string[]; destinations?: CFAccessDestination[] } {
  const result: { domain: string; self_hosted_domains?: string[]; destinations?: CFAccessDestination[] } = {
    domain: rewriteZoneDomain(app.domain, sourceZoneName, destZoneName),
  };
  if (Array.isArray(app.self_hosted_domains) && app.self_hosted_domains.length > 0) {
    result.self_hosted_domains = app.self_hosted_domains.map(d =>
      rewriteZoneDomain(d, sourceZoneName, destZoneName),
    );
  }
  if (Array.isArray(app.destinations) && app.destinations.length > 0) {
    result.destinations = app.destinations.map(dest => {
      const next: CFAccessDestination = { ...dest };
      if (typeof dest.uri === 'string') next.uri = rewriteZoneDomain(dest.uri, sourceZoneName, destZoneName);
      if (typeof dest.hostname === 'string') next.hostname = rewriteZoneDomain(dest.hostname, sourceZoneName, destZoneName);
      return next;
    });
  }
  return result;
}

// Recursively walk a value, applying `rewrite` to every string leaf.
// Used for the source→dest account-id and zone-id substitution that runs
// across rulesets, page rules, and worker route patterns.
export function deepRewriteStrings(value: unknown, rewrite: (s: string) => string): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return rewrite(value);
  if (Array.isArray(value)) return value.map(v => deepRewriteStrings(v, rewrite));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepRewriteStrings(v, rewrite);
    }
    return out;
  }
  return value;
}

// Scan a JSON-shaped value for any string leaf matching a regex. Used to
// detect embedded source-account IDs inside action_parameters so we can
// emit a warning (the value will be migrated but may not resolve on dest).
//
// Returns the deduplicated array of matched strings. Empty if no matches.
export function findEmbeddedReferences(value: unknown, pattern: RegExp): string[] {
  const hits = new Set<string>();
  function walk(v: unknown): void {
    if (v == null) return;
    if (typeof v === 'string') {
      const m = v.match(pattern);
      if (m) for (const x of m) hits.add(x);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (typeof v === 'object') { for (const x of Object.values(v as Record<string, unknown>)) walk(x); }
  }
  walk(value);
  return [...hits];
}
