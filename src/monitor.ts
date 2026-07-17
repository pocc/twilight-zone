// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Pre-cutover uptime monitor: the user pastes a curl request
// targeting an endpoint on the zone being migrated; the browser pings it
// ~once/sec via the Worker (POST /api/monitor/ping) to confirm it stays up.
//
// SECURITY — this is the codebase's FIRST user-supplied-URL outbound fetch, so
// the SSRF guard here is load-bearing, not advisory (AGENTS.md security rules:
// fail closed, never relax). The target host is HOST-LOCKED to the zone being
// migrated (the canonical zone name is derived server-side from the source zone
// ID via an authenticated getZone call — never trusted from the client), and
// private/loopback/link-local/metadata targets are blocked as defense-in-depth.
//
// Pure functions only (no I/O) so the guard + parser are exhaustively unit
// tested, including negative tests proving off-zone and private-range URLs are
// rejected.

/** Result of validating a ping target against the migrating zone. */
export type PingTargetCheck =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: string };

/** Normalize a zone name for comparison: lowercase, strip a trailing dot. */
function normalizeZone(zoneName: string): string {
  return zoneName.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * True if `host` is a literal IP / special hostname that must never be the
 * target of a proxied fetch (private, loopback, link-local, CGNAT, cloud
 * metadata, *.internal/*.local, localhost). This is defense-in-depth on top of
 * the zone host-lock — a correct zone host-lock already excludes these, but we
 * block them explicitly so a misconfigured allowlist can't open an SSRF hole.
 */
export function isPrivateOrSpecialHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!h) return true;

  // Special hostnames.
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h === 'metadata' || h.endsWith('.metadata.google.internal') || h === 'metadata.google.internal') return true;

  // IPv4 literal (incl. IPv4-mapped IPv6 like ::ffff:169.254.169.254).
  const v4 = h.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4 && /^(\d{1,3}\.){3}\d{1,3}$/.test(h.replace(/^::ffff:/, ''))) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0) return true;                       // 0.0.0.0/8
    if (a === 127) return true;                     // loopback
    if (a === 10) return true;                      // RFC1918
    if (a === 192 && b === 168) return true;        // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 169 && b === 254) return true;        // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a >= 224) return true;                      // multicast/reserved
  }
  // Bare IPv4-mapped IPv6 forms also caught above via the trailing-v4 match.

  // IPv6 literals.
  if (h === '::1' || h === '::') return true;       // loopback / unspecified
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // link-local fe80::/10

  return false;
}

/**
 * Validate a user-supplied ping URL against the zone being migrated.
 *
 * @param rawUrl    the target URL (from the parsed curl)
 * @param zoneName  the canonical migrating-zone name (derived server-side from
 *                  the source zone ID — NOT a client-claimed allowlist)
 *
 * Allowed iff: scheme is http/https, the host is NOT private/special, AND the
 * host is the zone itself or a subdomain of it. Fails closed on anything else.
 */
export function validatePingTarget(rawUrl: string, zoneName: string): PingTargetCheck {
  const zone = normalizeZone(zoneName);
  if (!zone) return { ok: false, reason: 'No migrating-zone name available to lock the target to.' };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `Not a valid URL: ${rawUrl}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Only http/https targets are allowed (got ${url.protocol}).` };
  }

  const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (isPrivateOrSpecialHost(host)) {
    return { ok: false, reason: `Target host ${host} is a private/loopback/metadata address and is blocked.` };
  }
  if (host !== zone && !host.endsWith('.' + zone)) {
    return { ok: false, reason: `Target host ${host} is not the migrating zone (${zone}) or a subdomain of it.` };
  }
  return { ok: true, url: url.toString(), host };
}

/** HTTP methods the monitor will proxy (host-locked regardless). */
export const ALLOWED_MONITOR_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export type MonitorMethod = (typeof ALLOWED_MONITOR_METHODS)[number];

/** Header names we refuse to forward (would spoof the host-lock / hop-by-hop). */
const BLOCKED_FORWARD_HEADERS = new Set(['host', 'content-length', 'connection', 'cf-connecting-ip', 'x-forwarded-host']);

/** Strip headers that could spoof the allowlist or break the proxied request. */
export function sanitizeMonitorHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (!BLOCKED_FORWARD_HEADERS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}
