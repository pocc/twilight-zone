import { describe, expect, it } from 'vitest';

import { base64UrlEncode, encryptOAuthPayload, generateGrantId, hashValue } from '../src/worker/oauth/crypto';
import { OAUTH_COOKIE_NAMES, serializeOAuthCookieValue } from '../src/worker/oauth/cookies';
import { parseOAuthConfig } from '../src/worker/oauth/config';
import { resolveOAuthAuth } from '../src/worker/oauth/middleware';
import type { OAuthEnv } from '../src/worker/oauth/config';
import type { OAuthGrantPayload, OAuthRole } from '../src/worker/oauth/types';

const origin = 'https://twilight-zone.ross.gg';
const nonce = base64UrlEncode(new Uint8Array(32).fill(7));
const now = 1_700_000_000_000;
const env: OAuthEnv = {
  OAUTH_ENABLED: 'true', OAUTH_CLIENT_ID: 'client',
  OAUTH_COOKIE_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8', OAUTH_COOKIE_KEY_ID: 'key_1',
  OAUTH_ALLOWED_ORIGIN: origin, OAUTH_REDIRECT_URI: `${origin}/api/oauth/callback`,
  OAUTH_SOURCE_SCOPES: '["account:read","zone:read"]', OAUTH_DESTINATION_SCOPES: '["account:read","zone:edit"]',
};

const grantCookie = async (role: OAuthRole, remaining: number, boundNonce = nonce) => {
  const result = await parseOAuthConfig(env);
  if (!result.ok) throw new Error(result.error);
  const scopes = role === 'source' ? ['account:read', 'zone:read'] : ['account:read', 'zone:edit'];
  const grant: OAuthGrantPayload = {
    version: 1, role, accessToken: `${role}-access-token`, tokenType: 'Bearer', expiresAt: now + remaining,
    scopes, nonceDigest: await hashValue(boundNonce), grantId: generateGrantId(),
  };
  const envelope = await encryptOAuthPayload(grant, result.config.cookieKey, {
    keyId: 'key_1', role, purpose: 'grant', origin,
  });
  return `${OAUTH_COOKIE_NAMES[role].grant}=${serializeOAuthCookieValue(envelope)}`;
};

const request = (cookies: string, headers: Record<string, string> = {}) => new Request(`${origin}/api/export`, {
  method: 'POST', headers: {
    Origin: origin, Cookie: cookies, 'Content-Type': 'application/json',
    'X-Twilight-Auth': 'oauth', 'X-Twilight-OAuth-Nonce': nonce, ...headers,
  }, body: '{}',
});

describe('shared OAuth authentication resolution', () => {
  it('resolves the required role into typed bearer auth and adapted legacy body fields', async () => {
    const result = await resolveOAuthAuth(request(await grantCookie('source', 1_200_000)), env, {
      kind: 'source', budgetMs: 120_000,
    }, {}, { now: () => now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.source?.auth).toEqual({ type: 'token', token: 'source-access-token' });
    expect(result.body).toMatchObject({ token: 'source-access-token', sourceToken: 'source-access-token', useApiKey: false });
  });

  it('denies source authority on a destination policy without manual fallback', async () => {
    const sourceOnly = request(await grantCookie('source', 1_200_000));
    const denied = await resolveOAuthAuth(sourceOnly, env, {
      kind: 'destination', budgetMs: 120_000,
    }, {}, { now: () => now });
    expect(denied).toMatchObject({ ok: false, status: 401, error: 'oauth_reauthorization_required' });

    const noFallback = await resolveOAuthAuth(sourceOnly, env, {
      kind: 'destination', budgetMs: 120_000,
    }, { token: 'manual-token-that-would-otherwise-work' }, { now: () => now });
    expect(noFallback).toMatchObject({ ok: false, status: 400, error: 'oauth_manual_credentials_forbidden' });
  });

  it('leaves manual requests and body credentials unchanged', async () => {
    const manualBody = { token: 'manual-token-value' };
    const manualRequest = new Request(`${origin}/api/export`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(manualBody),
    });
    const result = await resolveOAuthAuth(manualRequest, env, { kind: 'source', budgetMs: 120_000 }, manualBody, { now: () => now });
    expect(result).toEqual({ ok: true, mode: 'manual', body: manualBody });
  });

  it('accepts the exact lifetime threshold and rejects one millisecond below it', async () => {
    const threshold = 120_000 + 300_000;
    const accepted = await resolveOAuthAuth(request(await grantCookie('source', threshold)), env, {
      kind: 'source', budgetMs: 120_000,
    }, {}, { now: () => now });
    expect(accepted.ok).toBe(true);

    const rejected = await resolveOAuthAuth(request(await grantCookie('source', threshold - 1)), env, {
      kind: 'source', budgetMs: 120_000,
    }, {}, { now: () => now });
    expect(rejected).toMatchObject({ ok: false, status: 401, error: 'oauth_reauthorization_required' });
    if (rejected.ok) return;
    expect(rejected.clearCookies).toContain(OAUTH_COOKIE_NAMES.source.grant);
  });

  it('rejects cross-origin, wrong-nonce, oversized-cookie, and mixed credential requests', async () => {
    const source = await grantCookie('source', 1_200_000);
    const cases = [
      request(source, { Origin: 'https://example.com' }),
      request(source, { 'X-Twilight-OAuth-Nonce': base64UrlEncode(new Uint8Array(32)) }),
      request(`${source}; ${OAUTH_COOKIE_NAMES.destination.grant}=${'x'.repeat(12_000)}`),
    ];
    for (const candidate of cases) {
      const result = await resolveOAuthAuth(candidate, env, { kind: 'source', budgetMs: 120_000 }, {}, { now: () => now });
      expect(result.ok).toBe(false);
    }

    const unrelatedLargeCookie = request(`${source}; unrelated=${'x'.repeat(12_000)}`);
    const accepted = await resolveOAuthAuth(unrelatedLargeCookie, env, { kind: 'source', budgetMs: 120_000 }, {}, { now: () => now });
    expect(accepted.ok).toBe(true);
  });

  it('rejects a valid grant from another tab without clearing the shared grant cookie', async () => {
    const result = await resolveOAuthAuth(
      request(await grantCookie('source', 1_200_000), {
        'X-Twilight-OAuth-Nonce': base64UrlEncode(new Uint8Array(32)),
      }),
      env,
      { kind: 'source', budgetMs: 120_000 },
      {},
      { now: () => now },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 401,
      error: 'oauth_reauthorization_required',
      clearCookies: [],
      role: 'source',
    });
  });

  it('disables and discloses Durable Object state copy in OAuth mode', async () => {
    const cookies = `${await grantCookie('source', 2_400_000)}; ${await grantCookie('destination', 2_400_000)}`;
    const result = await resolveOAuthAuth(request(cookies), env, {
      kind: 'both', budgetMs: 1_800_000,
    }, { doMigration: [{ scriptName: 'worker' }] }, { now: () => now });
    expect(result).toMatchObject({ ok: false, status: 400, error: 'oauth_do_state_copy_unavailable' });
  });

  it.each(['json', 'terraform'])('requires only destination authority for %s migration mode', async (sourceMode) => {
    const destination = await grantCookie('destination', 2_400_000);
    const result = await resolveOAuthAuth(request(destination), env, {
      kind: 'migration' as never, budgetMs: 1_800_000,
    }, { sourceMode }, { now: () => now });
    expect(result.ok).toBe(true);
    if (!result.ok || result.mode !== 'oauth') return;
    expect(result.context.source).toBeUndefined();
    expect(result.context.destination?.auth).toEqual({ type: 'token', token: 'destination-access-token' });
  });

  it('resolves a destination-only prompt response with the exact declared role set', async () => {
    const destination = await grantCookie('destination', 2_400_000);
    const result = await resolveOAuthAuth(request(destination), env, {
      kind: 'prompt', budgetMs: 120_000,
    }, { oauthRoles: ['destination'] }, { now: () => now });

    expect(result.ok).toBe(true);
    if (!result.ok || result.mode !== 'oauth') return;
    expect(result.context.source).toBeUndefined();
    expect(result.context.destination?.auth).toEqual({ type: 'token', token: 'destination-access-token' });
  });

  it('lets destination authority reach a destination export policy without accepting source authority', async () => {
    const destination = await resolveOAuthAuth(request(await grantCookie('destination', 1_200_000)), env, {
      kind: 'dynamic', budgetMs: 900_000,
    }, { oauthRole: 'destination' }, { now: () => now });
    expect(destination.ok).toBe(true);
    if (destination.ok) expect(destination.body).not.toHaveProperty('sourceToken');

    const source = await resolveOAuthAuth(request(await grantCookie('source', 1_200_000)), env, {
      kind: 'dynamic', budgetMs: 900_000,
    }, { oauthRole: 'destination' }, { now: () => now });
    expect(source).toMatchObject({ ok: false, status: 401, role: 'destination' });
  });
});
