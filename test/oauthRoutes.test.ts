import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { base64UrlEncode, decryptOAuthPayload, encryptOAuthPayload, fixedDigestEqual, generateGrantId, hashValue } from '../src/worker/oauth/crypto';
import {
  createGrantCookie,
  MAX_OAUTH_COOKIE_HEADER_BYTES,
  OAUTH_COOKIE_NAMES,
  parseCookieHeader,
  parseOAuthCookieValue,
} from '../src/worker/oauth/cookies';
import { createOAuthRoutes } from '../src/worker/oauth/routes';
import type { OAuthEnv } from '../src/worker/oauth/config';
import type { OAuthGrantPayload, OAuthRole, OAuthTransactionPayload } from '../src/worker/oauth/types';

const origin = 'https://twilight-zone.ross.gg';
const nonce = base64UrlEncode(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const env = (): OAuthEnv => ({
  OAUTH_ENABLED: 'true',
  OAUTH_CLIENT_ID: 'twilight.zone_client-1',
  OAUTH_COOKIE_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  OAUTH_COOKIE_KEY_ID: 'key_1',
  OAUTH_ALLOWED_ORIGIN: origin,
  OAUTH_REDIRECT_URI: `${origin}/api/oauth/callback`,
  OAUTH_SOURCE_SCOPES: '["account:read","zone:read"]',
  OAUTH_DESTINATION_SCOPES: '["account:read","zone:edit"]',
});

const createApp = (options: Parameters<typeof createOAuthRoutes>[0] = {}) => {
  const app = new Hono<{ Bindings: OAuthEnv }>();
  app.route('/api/oauth', createOAuthRoutes(options));
  return app;
};

const cookiePair = (setCookie: string): string => setCookie.split(';', 1)[0];
const cookieValue = (setCookie: string): string => decodeURIComponent(cookiePair(setCookie).split('=', 2)[1]);

const grantCookie = async (role: OAuthRole, accessToken = `${role}-access-token`): Promise<string> => {
  const config = await import('../src/worker/oauth/config').then(({ parseOAuthConfig }) => parseOAuthConfig(env()));
  if (!config.ok) throw new Error(config.error);
  const grant: OAuthGrantPayload = {
    version: 1, role, accessToken, tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000,
    scopes: role === 'source' ? ['account:read', 'zone:read'] : ['account:read', 'zone:edit'],
    nonceDigest: await hashValue(nonce), grantId: generateGrantId(),
  };
  const envelope = await encryptOAuthPayload(grant, config.config.cookieKey, {
    keyId: config.config.cookieKeyId, role, purpose: 'grant', origin,
  });
  return cookiePair(createGrantCookie(role, envelope));
};

describe('OAuth authorization routes', () => {
  it('starts only the requested role with exact PKCE and a fixed five-minute host cookie', async () => {
    const now = 1_700_000_000_000;
    const response = await createApp({ now: () => now }).request(`${origin}/api/oauth/start`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Twilight-OAuth-Nonce': nonce },
      body: JSON.stringify({ role: 'source' }),
    }, env());

    expect(response.status).toBe(200);
    const authorizationUrl = new URL((await response.json() as { authorizationUrl: string }).authorizationUrl);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe('https://dash.cloudflare.com/oauth2/auth');
    expect(authorizationUrl.searchParams.get('scope')).toBe('account:read zone:read');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(`${origin}/api/oauth/callback`);

    const setCookie = response.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain(`${OAUTH_COOKIE_NAMES.source.transaction}=`);
    expect(setCookie).toContain('Max-Age=300');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain('Domain=');

    const parsed = parseOAuthCookieValue(cookieValue(setCookie));
    const config = await import('../src/worker/oauth/config').then(({ parseOAuthConfig }) => parseOAuthConfig(env()));
    if (!config.ok) throw new Error(config.error);
    const transaction = await decryptOAuthPayload(parsed, config.config.cookieKey, {
      keyId: 'key_1', role: 'source', purpose: 'transaction', origin,
    }) as OAuthTransactionPayload;
    expect(transaction.role).toBe('source');
    expect(transaction.issuedAt).toBe(now);
    expect(fixedDigestEqual(transaction.nonceDigest, await hashValue(nonce))).toBe(true);
    expect(fixedDigestEqual(transaction.stateDigest, await hashValue(authorizationUrl.searchParams.get('state') ?? ''))).toBe(true);
  });

  it('keeps one fixed transaction cookie per role and replaces only the restarted role', async () => {
    const app = createApp();
    const start = (role: 'source' | 'destination', cookie?: string) => app.request(`${origin}/api/oauth/start`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Twilight-OAuth-Nonce': nonce,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ role }),
    }, env());
    const source1 = await start('source');
    const sourceCookie1 = cookiePair(source1.headers.get('Set-Cookie') ?? '');
    const destination = await start('destination', sourceCookie1);
    const destinationCookie = cookiePair(destination.headers.get('Set-Cookie') ?? '');
    const source2 = await start('source', `${sourceCookie1}; ${destinationCookie}`);
    const sourceCookie2 = cookiePair(source2.headers.get('Set-Cookie') ?? '');

    expect(sourceCookie1.startsWith(`${OAUTH_COOKIE_NAMES.source.transaction}=`)).toBe(true);
    expect(destinationCookie.startsWith(`${OAUTH_COOKIE_NAMES.destination.transaction}=`)).toBe(true);
    expect(sourceCookie2.startsWith(`${OAUTH_COOKIE_NAMES.source.transaction}=`)).toBe(true);
    expect(sourceCookie2).not.toBe(sourceCookie1);
    expect(source2.headers.get('Set-Cookie')).not.toContain(OAUTH_COOKIE_NAMES.destination.transaction);
  });

  it.each([
    [{ Origin: 'https://example.com', 'X-Twilight-OAuth-Nonce': nonce }, { role: 'source' }],
    [{ Origin: origin, 'X-Twilight-OAuth-Nonce': 'not-a-nonce' }, { role: 'source' }],
    [{ Origin: origin, 'X-Twilight-OAuth-Nonce': nonce }, { role: 'admin' }],
  ])('rejects invalid start boundaries without creating a transaction', async (headers, body) => {
    const response = await createApp().request(`${origin}/api/oauth/start`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, env());
    expect(response.status).toBe(400);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('reports disabled configuration without creating OAuth state', async () => {
    const response = await createApp().request(`${origin}/api/oauth/config`, {
      method: 'POST', headers: { Origin: origin },
    }, { ...env(), OAUTH_ENABLED: 'false' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, reason: 'oauth_disabled' });
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('OAuth callback and grants', () => {
  it('rejects replay through the real callback after the transaction is consumed', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'secret-access-token', token_type: 'Bearer', expires_in: 3600, scope: 'account:read zone:read',
    }), { status: 200 }));
    const app = createApp({ fetchImpl });
    const started = await app.request(`${origin}/api/oauth/start`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Twilight-OAuth-Nonce': nonce },
      body: JSON.stringify({ role: 'source' }),
    }, env());
    const authorizationUrl = new URL((await started.json() as { authorizationUrl: string }).authorizationUrl);
    const callbackUrl = `${origin}/api/oauth/callback?code=authorization-code&state=${authorizationUrl.searchParams.get('state')}`;
    const transactionCookie = cookiePair(started.headers.get('Set-Cookie') ?? '');

    const first = await app.request(callbackUrl, { headers: { Cookie: transactionCookie } }, env());
    expect(first.headers.get('Location')).toBe(`${origin}/?oauth_result=connected&oauth_role=source`);
    const establishedGrant = (first.headers.get('Set-Cookie') ?? '')
      .split(/, (?=__Host-)/)
      .find((value) => value.startsWith(OAUTH_COOKIE_NAMES.source.grant));
    if (!establishedGrant) throw new Error('grant cookie missing');

    const replay = await app.request(callbackUrl, { headers: { Cookie: cookiePair(establishedGrant) } }, env());
    expect(replay.status).toBe(303);
    expect(replay.headers.get('Location')).toBe(`${origin}/?oauth_result=error&oauth_reason=oauth_callback_invalid`);
    expect(replay.headers.get('Set-Cookie') ?? '').not.toContain(OAUTH_COOKIE_NAMES.source.grant);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('exchanges once, clears the transaction, creates only the role grant, and defers nonce disclosure', async () => {
    const now = 1_700_000_000_000;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'secret-access-token', token_type: 'Bearer', expires_in: 3600, scope: 'account:read zone:read',
    }), { status: 200 }));
    const app = createApp({ now: () => now, fetchImpl });
    const started = await app.request(`${origin}/api/oauth/start`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Twilight-OAuth-Nonce': nonce },
      body: JSON.stringify({ role: 'source' }),
    }, env());
    const authorizationUrl = new URL((await started.json() as { authorizationUrl: string }).authorizationUrl);
    const transactionCookie = cookiePair(started.headers.get('Set-Cookie') ?? '');

    const callback = await app.request(`${origin}/api/oauth/callback?code=authorization-code&state=${authorizationUrl.searchParams.get('state')}`, {
      headers: { Cookie: transactionCookie },
    }, env());
    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toBe(`${origin}/?oauth_result=connected&oauth_role=source`);
    expect(callback.headers.get('Cache-Control')).toBe('no-store');
    expect(callback.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const setCookie = callback.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain(`${OAUTH_COOKIE_NAMES.source.grant}=`);
    expect(setCookie).toContain(`${OAUTH_COOKIE_NAMES.source.transaction}=;`);
    expect(setCookie).not.toContain(OAUTH_COOKIE_NAMES.destination.grant);
    expect(setCookie).not.toContain('Max-Age=3600');
    expect(setCookie).not.toContain('Expires=');
    expect(new TextEncoder().encode(setCookie).byteLength).toBeLessThanOrEqual(3800);

    const grantCookie = setCookie.split(/, (?=__Host-)/).find((value) => value.startsWith(OAUTH_COOKIE_NAMES.source.grant));
    if (!grantCookie) throw new Error('grant cookie missing');
    const wrongStatus = await app.request(`${origin}/api/oauth/status`, {
      method: 'POST', headers: { Origin: origin, Cookie: cookiePair(grantCookie), 'X-Twilight-OAuth-Nonce': base64UrlEncode(new Uint8Array(32)) },
    }, env());
    expect(wrongStatus.status).toBe(401);
    expect(wrongStatus.headers.get('Set-Cookie')).toBeNull();
    expect(JSON.stringify(await wrongStatus.json())).not.toContain('source');

    const status = await app.request(`${origin}/api/oauth/status`, {
      method: 'POST', headers: { Origin: origin, Cookie: cookiePair(grantCookie), 'X-Twilight-OAuth-Nonce': nonce },
    }, env());
    expect(status.status).toBe(200);
    const statusBody = await status.json() as { roles: { source: { connected: boolean; expiresAt: number; scopes: string[]; grantId?: string } } };
    expect(statusBody.roles.source).toEqual({ connected: true, expiresAt: now + 3_600_000, scopes: ['account:read', 'zone:read'] });
    expect(statusBody.roles.source.grantId).toBeUndefined();
    expect(JSON.stringify(statusBody)).not.toContain('secret-access-token');
  });

  it.each([
    ['wrong-state', 0],
    ['expired', 301_000],
  ])('rejects %s callbacks to one fixed secret-free error redirect', async (kind, elapsed) => {
    const startedAt = 1_700_000_000_000;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'secret-access-token', token_type: 'Bearer', expires_in: 3600, scope: 'account:read zone:read',
    }), { status: 200 }));
    let now = startedAt;
    const app = createApp({ now: () => now, fetchImpl });
    const started = await app.request(`${origin}/api/oauth/start`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Twilight-OAuth-Nonce': nonce },
      body: JSON.stringify({ role: 'source' }),
    }, env());
    const authorizationUrl = new URL((await started.json() as { authorizationUrl: string }).authorizationUrl);
    now += elapsed;
    const state = kind === 'wrong-state' ? 'wrong-state' : authorizationUrl.searchParams.get('state');
    const callback = await app.request(`${origin}/api/oauth/callback?code=authorization-code&state=${state}&next=https://example.com`, {
      headers: { Cookie: cookiePair(started.headers.get('Set-Cookie') ?? '') },
    }, env());
    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toMatch(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\?oauth_result=error&oauth_reason=[a-z_]+$`));
    expect(callback.headers.get('Location')).not.toContain('example.com');
    expect(callback.headers.get('Location')).not.toContain('authorization-code');
    expect(callback.headers.get('Set-Cookie') ?? '').not.toContain(OAUTH_COOKIE_NAMES.source.grant);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a token lifetime whose millisecond expiry is not a safe integer', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'secret-access-token', token_type: 'Bearer', expires_in: Number.MAX_SAFE_INTEGER,
      scope: 'account:read zone:read',
    }), { status: 200 }));
    const app = createApp({ now: () => 1_700_000_000_000, fetchImpl });
    const started = await app.request(`${origin}/api/oauth/start`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Twilight-OAuth-Nonce': nonce },
      body: JSON.stringify({ role: 'source' }),
    }, env());
    const authorizationUrl = new URL((await started.json() as { authorizationUrl: string }).authorizationUrl);
    const callback = await app.request(`${origin}/api/oauth/callback?code=authorization-code&state=${authorizationUrl.searchParams.get('state')}`, {
      headers: { Cookie: cookiePair(started.headers.get('Set-Cookie') ?? '') },
    }, env());
    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toBe(`${origin}/?oauth_result=error&oauth_reason=oauth_provider_invalid_token`);
    expect(callback.headers.get('Set-Cookie') ?? '').not.toContain(OAUTH_COOKIE_NAMES.source.grant);
  });

  it('requires the callback request base URL to exactly match the configured redirect URI', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 }));
    const app = createApp({ fetchImpl });
    const started = await app.request(`${origin}/api/oauth/start`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Twilight-OAuth-Nonce': nonce },
      body: JSON.stringify({ role: 'source' }),
    }, env());
    const authorizationUrl = new URL((await started.json() as { authorizationUrl: string }).authorizationUrl);
    const callback = await app.request(`https://attacker.example/api/oauth/callback?code=authorization-code&state=${authorizationUrl.searchParams.get('state')}`, {
      headers: { Cookie: cookiePair(started.headers.get('Set-Cookie') ?? '') },
    }, env());

    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toBe(`${origin}/?oauth_result=error&oauth_reason=oauth_callback_invalid`);
    expect(callback.headers.get('Set-Cookie') ?? '').toContain(`${OAUTH_COOKIE_NAMES.source.transaction}=; Max-Age=0`);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('matches provider errors to transaction state, clears the transaction, and redirects to a fixed error', async () => {
    const fetchImpl = vi.fn();
    const app = createApp({ fetchImpl });
    const started = await app.request(`${origin}/api/oauth/start`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Twilight-OAuth-Nonce': nonce },
      body: JSON.stringify({ role: 'destination' }),
    }, env());
    const authorizationUrl = new URL((await started.json() as { authorizationUrl: string }).authorizationUrl);
    const transactionCookie = cookiePair(started.headers.get('Set-Cookie') ?? '');

    const callback = await app.request(`${origin}/api/oauth/callback?error=access_denied&state=${authorizationUrl.searchParams.get('state')}`, {
      headers: { Cookie: transactionCookie },
    }, env());
    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toBe(`${origin}/?oauth_result=error&oauth_reason=oauth_provider_rejected`);
    expect(callback.headers.get('Set-Cookie') ?? '').toContain(`${OAUTH_COOKIE_NAMES.destination.transaction}=; Max-Age=0`);
    expect(callback.headers.get('Set-Cookie') ?? '').not.toContain(OAUTH_COOKIE_NAMES.destination.grant);
    expect(fetchImpl).not.toHaveBeenCalled();

    const wrongState = await app.request(`${origin}/api/oauth/callback?error=access_denied&state=wrong-state`, {
      headers: { Cookie: transactionCookie },
    }, env());
    expect(wrongState.headers.get('Location')).toBe(`${origin}/?oauth_result=error&oauth_reason=oauth_callback_invalid`);
    expect(wrongState.headers.get('Set-Cookie')).toBeNull();
  });

  it('turns oversized grant cookies into a fixed 303 and clears the transaction', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'x'.repeat(5000), token_type: 'Bearer', expires_in: 3600, scope: 'account:read zone:read',
    }), { status: 200 }));
    const app = createApp({ fetchImpl });
    const started = await app.request(`${origin}/api/oauth/start`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Twilight-OAuth-Nonce': nonce },
      body: JSON.stringify({ role: 'source' }),
    }, env());
    const authorizationUrl = new URL((await started.json() as { authorizationUrl: string }).authorizationUrl);
    const callback = await app.request(`${origin}/api/oauth/callback?code=authorization-code&state=${authorizationUrl.searchParams.get('state')}`, {
      headers: { Cookie: cookiePair(started.headers.get('Set-Cookie') ?? '') },
    }, env());

    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toBe(`${origin}/?oauth_result=error&oauth_reason=oauth_callback_failed`);
    expect(callback.headers.get('Set-Cookie') ?? '').toContain(`${OAUTH_COOKIE_NAMES.source.transaction}=; Max-Age=0`);
    expect(callback.headers.get('Set-Cookie') ?? '').not.toContain(OAUTH_COOKIE_NAMES.source.grant);
  });

  it('turns grant encryption failure into a fixed 303 and clears the transaction', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'access-token', token_type: 'Bearer', expires_in: 3600, scope: 'account:read zone:read',
    }), { status: 200 }));
    const app = createApp({
      fetchImpl,
      encryptGrant: async () => { throw new Error('secret encryption detail'); },
    });
    const started = await app.request(`${origin}/api/oauth/start`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Twilight-OAuth-Nonce': nonce },
      body: JSON.stringify({ role: 'source' }),
    }, env());
    const authorizationUrl = new URL((await started.json() as { authorizationUrl: string }).authorizationUrl);
    const callback = await app.request(`${origin}/api/oauth/callback?code=authorization-code&state=${authorizationUrl.searchParams.get('state')}`, {
      headers: { Cookie: cookiePair(started.headers.get('Set-Cookie') ?? '') },
    }, env());

    expect(callback.status).toBe(303);
    expect(callback.headers.get('Location')).toBe(`${origin}/?oauth_result=error&oauth_reason=oauth_callback_failed`);
    expect(callback.headers.get('Set-Cookie') ?? '').toContain(`${OAUTH_COOKIE_NAMES.source.transaction}=; Max-Age=0`);
    expect(callback.headers.get('Location')).not.toContain('secret');
  });
});

describe('OAuth cookie byte limits', () => {
  const grantCookieWithCiphertext = (length: number): string => createGrantCookie('source', {
    version: 1,
    keyId: 'key-1',
    iv: 'iv',
    ciphertext: 'a'.repeat(length),
  });

  const cookieHeader = (bytes: number): string => {
    const prefix = `${OAUTH_COOKIE_NAMES.source.grant}=; ${OAUTH_COOKIE_NAMES.destination.grant}=`;
    return `${OAUTH_COOKIE_NAMES.source.grant}=${'a'.repeat(bytes - new TextEncoder().encode(prefix).byteLength)}; ${OAUTH_COOKIE_NAMES.destination.grant}=`;
  };

  it('includes cookie separators in the aggregate UTF-8 byte limit', () => {
    const atLimit = cookieHeader(MAX_OAUTH_COOKIE_HEADER_BYTES);
    expect(new TextEncoder().encode(atLimit).byteLength).toBe(MAX_OAUTH_COOKIE_HEADER_BYTES);
    expect(() => parseCookieHeader(atLimit)).not.toThrow();

    const overLimit = cookieHeader(MAX_OAUTH_COOKIE_HEADER_BYTES + 1);
    expect(new TextEncoder().encode(overLimit).byteLength).toBe(MAX_OAUTH_COOKIE_HEADER_BYTES + 1);
    expect(() => parseCookieHeader(overLimit)).toThrow('oauth_cookie_header_too_large');
  });

  it('rejects an oversized status cookie header with the explicit boundary error', async () => {
    const response = await createApp().request(`${origin}/api/oauth/status`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: cookieHeader(MAX_OAUTH_COOKIE_HEADER_BYTES + 1),
        'X-Twilight-OAuth-Nonce': nonce,
      },
    }, env());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'oauth_cookie_header_too_large' });
  });

  it('accepts a 3800-byte Set-Cookie value and rejects 3801 bytes', () => {
    const baseBytes = new TextEncoder().encode(grantCookieWithCiphertext(0)).byteLength;
    const atLimit = grantCookieWithCiphertext(3800 - baseBytes);
    expect(new TextEncoder().encode(atLimit).byteLength).toBe(3800);
    expect(() => grantCookieWithCiphertext(3801 - baseBytes)).toThrow('oauth_cookie_too_large');
  });
});

describe('OAuth session clearing routes', () => {
  it.each([
    ['clear', { role: 'source' }, [OAUTH_COOKIE_NAMES.source.grant, OAUTH_COOKIE_NAMES.source.transaction]],
    ['logout', {}, [
      OAUTH_COOKIE_NAMES.source.grant,
      OAUTH_COOKIE_NAMES.source.transaction,
      OAUTH_COOKIE_NAMES.destination.grant,
      OAUTH_COOKIE_NAMES.destination.transaction,
    ]],
  ] as const)('clears local cookies through %s when OAuth is disabled', async (route, body, cookieNames) => {
    const fetchImpl = vi.fn();
    const response = await createApp({ fetchImpl }).request(`${origin}/api/oauth/${route}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, { ...env(), OAUTH_ENABLED: 'false' });

    expect(response.status).toBe(200);
    const setCookie = response.headers.get('Set-Cookie') ?? '';
    for (const name of cookieNames) expect(setCookie).toContain(`${name}=; Max-Age=0`);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('clears every local cookie when logout configuration is malformed without attempting revocation', async () => {
    const fetchImpl = vi.fn();
    const response = await createApp({ fetchImpl }).request(`${origin}/api/oauth/logout`, {
      method: 'POST', headers: { Origin: origin },
    }, { ...env(), OAUTH_COOKIE_KEY: 'invalid' });

    expect(response.status).toBe(200);
    for (const name of Object.values(OAUTH_COOKIE_NAMES).flatMap(({ grant, transaction }) => [grant, transaction])) {
      expect(response.headers.get('Set-Cookie') ?? '').toContain(`${name}=; Max-Age=0`);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled', { ...env(), OAUTH_ENABLED: 'false' }],
    ['malformed', { ...env(), OAUTH_COOKIE_KEY: 'invalid' }],
  ])('rejects cross-origin cleanup when OAuth configuration is %s', async (_kind, oauthEnv) => {
    const fetchImpl = vi.fn();
    const response = await createApp({ fetchImpl }).request(`${origin}/api/oauth/logout`, {
      method: 'POST', headers: { Origin: 'https://attacker.example' },
    }, oauthEnv);

    expect(response.status).toBe(403);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('clears only the requested role on clear', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const response = await createApp({ fetchImpl }).request(`${origin}/api/oauth/clear`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: await grantCookie('source') },
      body: JSON.stringify({ role: 'source' }),
    }, env());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, clearNonce: false });
    const setCookie = response.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain(`${OAUTH_COOKIE_NAMES.source.grant}=; Max-Age=0`);
    expect(setCookie).toContain(`${OAUTH_COOKIE_NAMES.source.transaction}=; Max-Age=0`);
    expect(setCookie).not.toContain(OAUTH_COOKIE_NAMES.destination.grant);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][1]?.body)).toContain('source-access-token');
  });

  it('clears every cookie and nonce even when revocation fails', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const response = await createApp({ fetchImpl }).request(`${origin}/api/oauth/logout`, {
      method: 'POST', headers: { Origin: origin },
    }, env());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, clearNonce: true });
    const setCookie = response.headers.get('Set-Cookie') ?? '';
    for (const role of ['source', 'destination'] as const) {
      expect(setCookie).toContain(`${OAUTH_COOKIE_NAMES[role].grant}=; Max-Age=0`);
      expect(setCookie).toContain(`${OAUTH_COOKIE_NAMES[role].transaction}=; Max-Age=0`);
    }
  });

  it('attempts both independent revocations and clears all cookies when the first revocation fails', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const source = String(init?.body).includes('source-access-token');
      if (source) throw new TypeError('network failed');
      return new Response(null, { status: 200 });
    });
    const response = await createApp({ fetchImpl }).request(`${origin}/api/oauth/logout`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: `${await grantCookie('source')}; ${await grantCookie('destination')}`,
      },
    }, env());

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const bodies = fetchImpl.mock.calls.map((call) => String(call[1]?.body));
    expect(bodies.some((body) => body.includes('source-access-token'))).toBe(true);
    expect(bodies.some((body) => body.includes('destination-access-token'))).toBe(true);
    expect(response.headers.get('Set-Cookie')).not.toContain('access-token');
    for (const role of ['source', 'destination'] as const) {
      expect(response.headers.get('Set-Cookie') ?? '').toContain(`${OAUTH_COOKIE_NAMES[role].grant}=; Max-Age=0`);
    }
  });

  it('clears a malformed role without emitting it and still revokes the other valid role', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const response = await createApp({ fetchImpl }).request(`${origin}/api/oauth/logout`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: `${OAUTH_COOKIE_NAMES.source.grant}=malformed-secret-cookie; ${await grantCookie('destination')}`,
      },
    }, env());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][1]?.body)).toContain('destination-access-token');
    expect(response.headers.get('Set-Cookie')).not.toContain('malformed-secret-cookie');
    expect(response.headers.get('Set-Cookie') ?? '').toContain(`${OAUTH_COOKIE_NAMES.source.grant}=; Max-Age=0`);
  });

  it('does not clear or revoke anything for a cross-origin logout', async () => {
    const fetchImpl = vi.fn();
    const response = await createApp({ fetchImpl }).request(`${origin}/api/oauth/logout`, {
      method: 'POST', headers: { Origin: 'https://attacker.example', Cookie: await grantCookie('source') },
    }, env());
    expect(response.status).toBe(403);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
