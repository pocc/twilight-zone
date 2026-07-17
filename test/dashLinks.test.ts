/**
 * Tests for app/lib/dashLinks.ts — dashboard deep-link construction.
 *
 * Pure, no network. Section slugs + item templates are verified against the
 * live dashboard nav (see docs/dash-deep-link-paths.md); these tests lock in
 * the URL-construction contract so a refactor can't silently change the form
 * or drop the cross-account-safe explicit account-id path.
 */

import { describe, it, expect } from 'vitest';
import { buildDashLink, hasDashLink } from '../app/lib/dashLinks';
import { VALIDATION_SECTION_GROUP } from '../src/migrate/validate-postmigrate';

const ACCT = '0123456789abcdef0123456789abcdef';
const ZONE = 'example.com';
const ctx = { accountId: ACCT, zoneName: ZONE };

describe('buildDashLink — URL form', () => {
  it('builds zone-scoped section links with the explicit account-id path', () => {
    expect(buildDashLink('dnsRecords', null, ctx)).toBe(
      `https://dash.cloudflare.com/${ACCT}/${ZONE}/dns/records`,
    );
  });

  it('builds account-scoped section links without the zone segment', () => {
    expect(buildDashLink('r2Buckets', null, ctx)).toBe(
      `https://dash.cloudflare.com/${ACCT}/r2/overview`,
    );
  });

  it('does NOT use the ?to=/:account redirect form (ambiguous across accounts)', () => {
    const url = buildDashLink('dnsRecords', null, ctx)!;
    expect(url).not.toContain('?to=');
    expect(url).not.toContain(':account');
  });
});

describe('buildDashLink — item-level deep links', () => {
  it('links a worker by script name to its service view', () => {
    expect(buildDashLink('workers', { id: 'my-worker' }, ctx)).toBe(
      `https://dash.cloudflare.com/${ACCT}/workers/services/view/my-worker/production`,
    );
  });

  it('links a D1 database by uuid', () => {
    expect(buildDashLink('d1Databases', { id: 'abc-123' }, ctx)).toBe(
      `https://dash.cloudflare.com/${ACCT}/workers/d1/databases/abc-123`,
    );
  });

  it('links a queue by id', () => {
    expect(buildDashLink('queues', { id: 'q1' }, ctx)).toBe(
      `https://dash.cloudflare.com/${ACCT}/workers/queues/q1`,
    );
  });

  it('links an R2 bucket by name', () => {
    expect(buildDashLink('r2Buckets', { id: 'my-bucket' }, ctx)).toBe(
      `https://dash.cloudflare.com/${ACCT}/r2/default/buckets/my-bucket`,
    );
  });

  it('links a KV namespace by id', () => {
    expect(buildDashLink('kvNamespaces', { id: 'ns123' }, ctx)).toBe(
      `https://dash.cloudflare.com/${ACCT}/workers/kv/namespaces/ns123`,
    );
  });

  it('links a rate-limit rule by id (zone-scoped)', () => {
    expect(buildDashLink('rateLimits', { id: 'rl1' }, ctx)).toBe(
      `https://dash.cloudflare.com/${ACCT}/${ZONE}/security/security-rules/rate-limiting-rules/rl1`,
    );
  });

  it('encodes ids/names with URL-unsafe characters', () => {
    expect(buildDashLink('workers', { id: 'a b/c' }, ctx)).toBe(
      `https://dash.cloudflare.com/${ACCT}/workers/services/view/a%20b%2Fc/production`,
    );
  });

  it('falls back to the section when no item id is supplied', () => {
    expect(buildDashLink('d1Databases', { id: undefined }, ctx)).toBe(
      `https://dash.cloudflare.com/${ACCT}/workers/d1`,
    );
  });
});

describe('buildDashLink — overview fallback (no feature-exact slug)', () => {
  it('links zone-overview for groups without a verified subpage', () => {
    for (const key of ['settings', 'argoSmartRouting', 'botManagement']) {
      expect(buildDashLink(key, null, ctx)).toBe(`https://dash.cloudflare.com/${ACCT}/${ZONE}`);
    }
  });
});

describe('buildDashLink — guard rails', () => {
  it('returns null for an unmapped group key', () => {
    expect(buildDashLink('nonsense', null, ctx)).toBeNull();
    expect(hasDashLink('nonsense')).toBe(false);
    expect(hasDashLink('dnsRecords')).toBe(true);
  });

  it('every Step 4 validation-section group key is a known dash link group', () => {
    // Guards against drift between validate-postmigrate.ts and dashLinks.ts:
    // a section mapped to a group key dashLinks doesn't recognise would
    // silently render no link in Step 4.
    for (const groupKey of Object.values(VALIDATION_SECTION_GROUP)) {
      expect(hasDashLink(groupKey), `unmapped group key: ${groupKey}`).toBe(true);
    }
  });

  it('returns null when accountId is missing', () => {
    expect(buildDashLink('dnsRecords', null, { accountId: null, zoneName: ZONE })).toBeNull();
  });

  it('returns null for a zone-scoped link when zoneName is missing', () => {
    expect(buildDashLink('dnsRecords', null, { accountId: ACCT, zoneName: null })).toBeNull();
  });

  it('still builds account-scoped links when zoneName is missing', () => {
    expect(buildDashLink('r2Buckets', null, { accountId: ACCT, zoneName: null })).toBe(
      `https://dash.cloudflare.com/${ACCT}/r2/overview`,
    );
  });
});
