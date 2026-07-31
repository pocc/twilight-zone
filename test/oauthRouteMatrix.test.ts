import { describe, expect, it } from 'vitest';

import { base64UrlEncode, fixedDigestEqual, generateGrantId, generateMigrationId } from '../src/worker/oauth/crypto';
import { createPromptContextDigest } from '../src/worker/oauth/prompt-context';
import { UI_ROUTE_POLICIES, type OAuthRoutePolicyKind } from '../src/worker/oauth/route-policy';

const expected: Record<string, OAuthRoutePolicyKind> = {
  '/api/v1': 'api-v1-public',
  '/api/v1/': 'api-v1-public',
  '/api/v1/docs': 'api-v1-public',
  '/api/v1/*': 'api-v1-manual',
  '/api/version': 'public',
  '/api/stats': 'public',
  '/api/spec-status': 'public',
  '/api/webhook-sink': 'public',
  '/api/oauth/config': 'public',
  '/api/oauth/start': 'public',
  '/api/oauth/callback': 'public',
  '/api/oauth/status': 'status',
  '/api/oauth/clear': 'session',
  '/api/oauth/logout': 'session',
  '/api/feedback': 'public',
  '/api/migrate/stream': 'migration',
  '/api/migrate/account-resources': 'migration',
  '/api/migrate/respond': 'prompt',
  '/api/migrate': 'migration',
  '/api/export/stream': 'dynamic',
  '/api/export': 'source',
  '/api/export/troubleshooting/stream': 'source',
  '/api/export/troubleshooting': 'source',
  '/api/export/openapi/stream': 'source',
  '/api/export/openapi': 'source',
  '/api/analytics/export/stream': 'source',
  '/api/analytics/export': 'source',
  '/api/analytics/probe/stream': 'source',
  '/api/terraform/export': 'source',
  '/api/terraform/export/stream': 'source',
  '/api/terraform/import/stream': 'destination',
  '/api/validate-token': 'manual-only',
  '/api/check-blockers': 'both',
  '/api/check-capabilities': 'destination',
  '/api/monitor/ping': 'source',
  '/api/email-routing/send-verification': 'destination',
  '/api/email-routing/check-verification': 'destination',
  '/api/zones': 'dynamic',
  '/api/zones/create': 'destination',
  '/api/accounts': 'dynamic',
  '/api/rdap': 'public',
  '/api/available-plans': 'destination',
  '/api/validate': 'both',
  '/api/rollback': 'destination',
  '/api/fuzz/stream': 'destination',
  '/api/maxconfig/stream': 'destination',
  '/api/minconfig/stream': 'destination',
  '/api/diff/stream': 'both',
};

describe('UI OAuth route policy matrix', () => {
  it('classifies every registered UI route exactly once', () => {
    const actual = Object.fromEntries(UI_ROUTE_POLICIES
      .filter(({ policy }) => policy.kind !== 'method-not-allowed')
      .map(({ path, policy }) => [path, policy.kind]));
    expect(actual).toEqual(expected);
    expect(new Set(UI_ROUTE_POLICIES.map(({ method, path }) => `${method} ${path}`))).toHaveLength(UI_ROUTE_POLICIES.length);
  });

  it('uses the PRD operation budgets for synchronous, stream, and full migration routes', () => {
    const policies = Object.fromEntries(UI_ROUTE_POLICIES.map(({ path, policy }) => [path, policy]));
    expect(policies['/api/export'].budgetMs).toBe(120_000);
    expect(policies['/api/export/stream'].budgetMs).toBe(900_000);
    expect(policies['/api/migrate/account-resources'].budgetMs).toBe(1_800_000);
    expect(policies['/api/migrate/stream'].budgetMs).toBe(900_000);
  });

  it('binds prompt digests to opaque migration, grants, nonce, roles, and account pair', async () => {
    const base = {
      migrationId: generateMigrationId(),
      sourceGrantId: generateGrantId(),
      destinationGrantId: generateGrantId(),
      nonceDigest: base64UrlEncode(new Uint8Array(32).fill(3)),
      roles: ['source', 'destination'] as const,
      sourceAccountId: 'a'.repeat(32),
      destinationAccountId: 'b'.repeat(32),
    };
    const digest = await createPromptContextDigest(base);
    expect(fixedDigestEqual(digest, await createPromptContextDigest(base))).toBe(true);
    const mutations = [
      { migrationId: generateMigrationId() },
      { sourceGrantId: generateGrantId() },
      { destinationGrantId: generateGrantId() },
      { nonceDigest: base64UrlEncode(new Uint8Array(32).fill(4)) },
      { roles: ['source'] as const },
      { sourceAccountId: 'c'.repeat(32) },
      { destinationAccountId: 'd'.repeat(32) },
    ];
    for (const mutation of mutations) {
      expect(fixedDigestEqual(digest, await createPromptContextDigest({ ...base, ...mutation }))).toBe(false);
    }
  });
});
