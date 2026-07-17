import { describe, it, expect } from 'vitest';
import {
  rewriteZoneDomain,
  rewriteAccessAppDomains,
  accessAppHostnames,
  isInZoneHostname,
  findInZoneDnsTargets,
} from '../src/migrate/transforms';
import type { CFAccessApp, CFDNSRecord } from '../src/types';

function makeRec(overrides: Partial<CFDNSRecord>): CFDNSRecord {
  return {
    id: 'rec-1',
    type: 'CNAME',
    name: 'www.source.com',
    content: 'app.source.com',
    ttl: 1,
    ...overrides,
  };
}

function makeApp(overrides: Partial<CFAccessApp>): CFAccessApp {
  return {
    id: 'app-1',
    name: 'Test App',
    domain: '',
    type: 'self_hosted',
    session_duration: '24h',
    allowed_idps: [],
    auto_redirect_to_identity: false,
    ...overrides,
  };
}

describe('rewriteZoneDomain (Access app domain remap)', () => {
  it('rewrites a self-hosted hostname onto the dest zone', () => {
    expect(rewriteZoneDomain('app.source.com', 'source.com', 'dest.com')).toBe('app.source.com'.replace('source.com', 'dest.com'));
    expect(rewriteZoneDomain('app.source.com', 'source.com', 'dest.com')).toBe('app.dest.com');
  });

  it('rewrites the apex hostname', () => {
    expect(rewriteZoneDomain('source.com', 'source.com', 'dest.com')).toBe('dest.com');
  });

  it('preserves any path suffix on the domain', () => {
    expect(rewriteZoneDomain('app.source.com/admin', 'source.com', 'dest.com')).toBe('app.dest.com/admin');
  });

  it('leaves domains that do not contain the source zone untouched (SaaS/bookmark apps)', () => {
    expect(rewriteZoneDomain('myapp.okta.com', 'source.com', 'dest.com')).toBe('myapp.okta.com');
  });

  it('is a no-op when source and dest zone names are identical', () => {
    expect(rewriteZoneDomain('app.source.com', 'source.com', 'source.com')).toBe('app.source.com');
  });

  it('returns non-string and empty inputs untouched', () => {
    // @ts-expect-error — runtime guard for optional/absent fields
    expect(rewriteZoneDomain(undefined, 'source.com', 'dest.com')).toBe(undefined);
    expect(rewriteZoneDomain('app.source.com', '', 'dest.com')).toBe('app.source.com');
    expect(rewriteZoneDomain('app.source.com', 'source.com', '')).toBe('app.source.com');
  });

  // Boundary-awareness regression (Check 1 #9): the zone name must be replaced
  // only at hostname boundaries, never as an arbitrary substring.
  it('does NOT rewrite a longer label that ends with the zone name', () => {
    // "example.com" is a suffix of the label "notexample.com" — must not match.
    expect(rewriteZoneDomain('notexample.com', 'example.com', 'dest.com')).toBe('notexample.com');
    expect(rewriteZoneDomain('mysource.com', 'source.com', 'dest.com')).toBe('mysource.com');
  });

  it('does NOT rewrite when the zone is a prefix label of a different host', () => {
    // "example.com" followed by ".evil.test" is NOT the registrable suffix.
    expect(rewriteZoneDomain('example.com.evil.test', 'example.com', 'dest.com')).toBe('example.com.evil.test');
  });

  it('rewrites deep subdomains and the zone inside a URL/expression', () => {
    expect(rewriteZoneDomain('a.b.source.com', 'source.com', 'dest.com')).toBe('a.b.dest.com');
    expect(rewriteZoneDomain('https://app.source.com/x?y=1', 'source.com', 'dest.com')).toBe('https://app.dest.com/x?y=1');
    expect(rewriteZoneDomain('http.host eq "app.source.com"', 'source.com', 'dest.com')).toBe('http.host eq "app.dest.com"');
  });

  it('rewrites a multi-label zone correctly without touching a colliding prefix', () => {
    expect(rewriteZoneDomain('api.shop.example.co.uk', 'shop.example.co.uk', 'dest.com')).toBe('api.dest.com');
    expect(rewriteZoneDomain('notshop.example.co.uk', 'shop.example.co.uk', 'dest.com')).toBe('notshop.example.co.uk');
  });
});

describe('isInZoneHostname (in-zone self-reference predicate)', () => {
  it('matches the apex', () => {
    expect(isInZoneHostname('example.com', 'example.com')).toBe(true);
  });

  it('matches a subdomain and a deep subdomain', () => {
    expect(isInZoneHostname('app.example.com', 'example.com')).toBe(true);
    expect(isInZoneHostname('a.b.example.com', 'example.com')).toBe(true);
  });

  it('is case-insensitive and tolerates a trailing dot (FQDN form)', () => {
    expect(isInZoneHostname('APP.Example.COM', 'example.com')).toBe(true);
    expect(isInZoneHostname('app.example.com.', 'example.com')).toBe(true);
  });

  it('does NOT match an external target', () => {
    expect(isInZoneHostname('assets.fastly.net', 'example.com')).toBe(false);
    expect(isInZoneHostname('aspmx.l.google.com', 'example.com')).toBe(false);
  });

  it('does NOT match a longer label that merely ends with the zone name', () => {
    // "example.com" is a suffix of the label "notexample.com" — boundary guard.
    expect(isInZoneHostname('notexample.com', 'example.com')).toBe(false);
    expect(isInZoneHostname('mysource.com', 'source.com')).toBe(false);
  });

  it('does NOT match when the zone is a prefix label of a different host', () => {
    expect(isInZoneHostname('example.com.evil.test', 'example.com')).toBe(false);
  });

  it('returns false for empty inputs', () => {
    expect(isInZoneHostname('', 'example.com')).toBe(false);
    expect(isInZoneHostname('app.example.com', '')).toBe(false);
  });
});

describe('findInZoneDnsTargets (DNS records whose target points back into the source zone)', () => {
  it('flags a CNAME whose target is in-zone, returning the matched target', () => {
    const recs = [makeRec({ type: 'CNAME', name: 'www.source.com', content: 'app.source.com' })];
    const hits = findInZoneDnsTargets(recs, 'source.com');
    expect(hits).toHaveLength(1);
    expect(hits[0].target).toBe('app.source.com');
    expect(hits[0].record.name).toBe('www.source.com');
  });

  it('ignores a CNAME pointing at an external target (the common, must-not-rewrite case)', () => {
    const recs = [makeRec({ type: 'CNAME', content: 'd111.cloudfront.net' })];
    expect(findInZoneDnsTargets(recs, 'source.com')).toHaveLength(0);
  });

  it('flags an MX pointing in-zone but ignores an external mail provider', () => {
    const recs = [
      makeRec({ type: 'MX', name: 'source.com', content: 'mail.source.com', priority: 10 }),
      makeRec({ type: 'MX', name: 'source.com', content: 'aspmx.l.google.com', priority: 1 }),
    ];
    const hits = findInZoneDnsTargets(recs, 'source.com');
    expect(hits).toHaveLength(1);
    expect(hits[0].target).toBe('mail.source.com');
  });

  it('ignores A/AAAA (IP content) and TXT (arbitrary content) even if they contain the zone string', () => {
    const recs = [
      makeRec({ type: 'A', name: 'source.com', content: '192.0.2.1' }),
      makeRec({ type: 'TXT', name: 'source.com', content: 'v=spf1 include:source.com ~all' }),
    ];
    expect(findInZoneDnsTargets(recs, 'source.com')).toHaveLength(0);
  });

  it('flags an SRV whose data.target is in-zone', () => {
    const recs = [
      makeRec({ type: 'SRV', name: '_sip._tcp.source.com', content: '', data: { target: 'sip.source.com', port: 5060 } }),
    ];
    const hits = findInZoneDnsTargets(recs, 'source.com');
    expect(hits).toHaveLength(1);
    expect(hits[0].target).toBe('sip.source.com');
  });

  it('respects the hostname boundary (notsource.com is not in source.com)', () => {
    const recs = [makeRec({ type: 'CNAME', content: 'x.notsource.com' })];
    expect(findInZoneDnsTargets(recs, 'source.com')).toHaveLength(0);
  });

  it('returns an empty array for an empty record set or empty zone name', () => {
    expect(findInZoneDnsTargets([], 'source.com')).toEqual([]);
    expect(findInZoneDnsTargets([makeRec({})], '')).toEqual([]);
  });
});

describe('accessAppHostnames (zone-relatedness candidates)', () => {
  it('returns the legacy domain when present', () => {
    expect(accessAppHostnames(makeApp({ domain: 'app.source.com' }))).toEqual(['app.source.com']);
  });

  it('collects self_hosted_domains[] entries', () => {
    const app = makeApp({ domain: '', self_hosted_domains: ['a.source.com', 'b.source.com'] });
    expect(accessAppHostnames(app)).toEqual(['a.source.com', 'b.source.com']);
  });

  it('collects destination uri (public) and hostname (private), skipping cidr/vnet/mcp', () => {
    const app = makeApp({
      domain: '',
      destinations: [
        { type: 'public', uri: 'public.source.com/admin' },
        { type: 'private', hostname: 'private.source.com', cidr: '10.0.0.0/8', vnet_id: 'vnet-x' },
        { type: 'via_mcp_server_portal', mcp_server_id: 'mcp-123' },
      ],
    });
    expect(accessAppHostnames(app)).toEqual(['public.source.com/admin', 'private.source.com']);
  });

  it('merges domain + self_hosted_domains + destinations together', () => {
    const app = makeApp({
      domain: 'apex.source.com',
      self_hosted_domains: ['shd.source.com'],
      destinations: [{ type: 'public', uri: 'dest.source.com' }],
    });
    expect(accessAppHostnames(app)).toEqual(['apex.source.com', 'shd.source.com', 'dest.source.com']);
  });

  it('returns an empty array when an app has no hostnames at all', () => {
    expect(accessAppHostnames(makeApp({ domain: '' }))).toEqual([]);
  });
});

describe('rewriteAccessAppDomains (Access app routing remap)', () => {
  it('rewrites the legacy domain', () => {
    const out = rewriteAccessAppDomains(makeApp({ domain: 'app.source.com' }), 'source.com', 'dest.com');
    expect(out.domain).toBe('app.dest.com');
    expect(out.self_hosted_domains).toBeUndefined();
    expect(out.destinations).toBeUndefined();
  });

  it('rewrites every self_hosted_domains[] entry', () => {
    const out = rewriteAccessAppDomains(
      makeApp({ domain: '', self_hosted_domains: ['a.source.com', 'b.source.com/path'] }),
      'source.com',
      'dest.com',
    );
    expect(out.self_hosted_domains).toEqual(['a.dest.com', 'b.dest.com/path']);
  });

  it('rewrites destination uri and hostname while preserving non-hostname fields', () => {
    const out = rewriteAccessAppDomains(
      makeApp({
        domain: '',
        destinations: [
          { type: 'public', uri: 'public.source.com/admin' },
          { type: 'private', hostname: 'private.source.com', cidr: '10.0.0.0/8', l4_protocol: 'tcp', port_range: '22', vnet_id: 'vnet-x' },
          { type: 'via_mcp_server_portal', mcp_server_id: 'mcp-123' },
        ],
      }),
      'source.com',
      'dest.com',
    );
    expect(out.destinations).toEqual([
      { type: 'public', uri: 'public.dest.com/admin' },
      { type: 'private', hostname: 'private.dest.com', cidr: '10.0.0.0/8', l4_protocol: 'tcp', port_range: '22', vnet_id: 'vnet-x' },
      { type: 'via_mcp_server_portal', mcp_server_id: 'mcp-123' },
    ]);
  });

  it('leaves SaaS/off-zone hostnames untouched', () => {
    const out = rewriteAccessAppDomains(
      makeApp({ domain: 'myapp.okta.com', self_hosted_domains: ['other.example.org'] }),
      'source.com',
      'dest.com',
    );
    expect(out.domain).toBe('myapp.okta.com');
    expect(out.self_hosted_domains).toEqual(['other.example.org']);
  });

  it('does not emit empty arrays that would override legacy domain routing', () => {
    const out = rewriteAccessAppDomains(
      makeApp({ domain: 'app.source.com', self_hosted_domains: [], destinations: [] }),
      'source.com',
      'dest.com',
    );
    expect(out).toEqual({ domain: 'app.dest.com' });
    expect('self_hosted_domains' in out).toBe(false);
    expect('destinations' in out).toBe(false);
  });
});
