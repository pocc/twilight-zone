import { describe, expect, it, vi } from 'vitest';

import { parseOAuthConfig } from '../src/worker/oauth/config';
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  revokeAccessToken,
} from '../src/worker/oauth/provider';
import type { OAuthFetch } from '../src/worker/oauth/provider';

const validEnv = () => ({
  OAUTH_ENABLED: 'true',
  OAUTH_CLIENT_ID: 'twilight.zone_client-1',
  OAUTH_COOKIE_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  OAUTH_COOKIE_KEY_ID: 'key_1',
  OAUTH_ALLOWED_ORIGIN: 'https://twilight-zone.ross.gg',
  OAUTH_REDIRECT_URI: 'https://twilight-zone.ross.gg/api/oauth/callback',
  OAUTH_SOURCE_SCOPES: '["account:read","zone:read"]',
  OAUTH_DESTINATION_SCOPES: '["account:read","zone:edit"]',
});

const config = async () => {
  const result = await parseOAuthConfig(validEnv());
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

describe('OAuth configuration', () => {
  it('enables only for the exact true kill-switch value', async () => {
    await expect(parseOAuthConfig({ ...validEnv(), OAUTH_ENABLED: 'TRUE' }))
      .resolves.toEqual({ ok: false, error: 'oauth_disabled' });
    await expect(parseOAuthConfig({ ...validEnv(), OAUTH_ENABLED: ' true' }))
      .resolves.toEqual({ ok: false, error: 'oauth_disabled' });
  });

  it('returns a complete typed config with separate role scope sets', async () => {
    const result = await parseOAuthConfig(validEnv());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.clientId).toBe('twilight.zone_client-1');
    expect(result.config.cookieKey).toBeInstanceOf(CryptoKey);
    expect(result.config.sourceScopes).toEqual(new Set(['account:read', 'zone:read']));
    expect(result.config.destinationScopes).toEqual(new Set(['account:read', 'zone:edit']));
  });

  it.each([
    [{ OAUTH_CLIENT_ID: undefined }, 'oauth_config_missing'],
    [{ OAUTH_COOKIE_KEY: 'not-base64url' }, 'oauth_config_invalid_key'],
    [{ OAUTH_CLIENT_ID: 'contains space' }, 'oauth_config_invalid_client'],
    [{ OAUTH_COOKIE_KEY_ID: 'bad.key' }, 'oauth_config_invalid_key'],
    [{ OAUTH_ALLOWED_ORIGIN: 'https://example.com/' }, 'oauth_config_invalid_origin'],
    [{ OAUTH_ALLOWED_ORIGIN: 'http://example.com' }, 'oauth_config_invalid_origin'],
    [{ OAUTH_ALLOWED_ORIGIN: 'http://localhost:0' }, 'oauth_config_invalid_origin'],
    [{ OAUTH_REDIRECT_URI: 'https://twilight-zone.ross.gg/api/oauth/callback?next=x' }, 'oauth_config_invalid_redirect'],
    [{ OAUTH_REDIRECT_URI: 'https://twilight-zone.ross.gg/api/oauth/callback?' }, 'oauth_config_invalid_redirect'],
    [{ OAUTH_REDIRECT_URI: 'https://twilight-zone.ross.gg/api/oauth/callback#' }, 'oauth_config_invalid_redirect'],
    [{ OAUTH_REDIRECT_URI: 'https://example.com/api/oauth/callback' }, 'oauth_config_invalid_redirect'],
    [{ OAUTH_SOURCE_SCOPES: 'not-json' }, 'oauth_config_invalid_scopes'],
    [{ OAUTH_SOURCE_SCOPES: '{}' }, 'oauth_config_invalid_scopes'],
    [{ OAUTH_SOURCE_SCOPES: '[]' }, 'oauth_config_invalid_scopes'],
    [{ OAUTH_SOURCE_SCOPES: '["zone:read", "zone:read"]' }, 'oauth_config_invalid_scopes'],
    [{ OAUTH_SOURCE_SCOPES: '["zone:read", ""]' }, 'oauth_config_invalid_scopes'],
    [{ OAUTH_SOURCE_SCOPES: '[" zone:read"]' }, 'oauth_config_invalid_scopes'],
    [{ OAUTH_SOURCE_SCOPES: '["zone read"]' }, 'oauth_config_invalid_scopes'],
    [{ OAUTH_SOURCE_SCOPES: '["zone\\u005cread"]' }, 'oauth_config_invalid_scopes'],
  ] as const)('rejects malformed boundary %# with a stable code', async (change, error) => {
    await expect(parseOAuthConfig({ ...validEnv(), ...change })).resolves.toEqual({ ok: false, error });
  });

  it('permits canonical loopback HTTP development origins', async () => {
    const env = {
      ...validEnv(),
      OAUTH_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
      OAUTH_REDIRECT_URI: 'http://127.0.0.1:5173/api/oauth/callback',
    };
    expect((await parseOAuthConfig(env)).ok).toBe(true);
  });

  it('accepts an all-loopback local provider only for a loopback app origin', async () => {
    const result = await parseOAuthConfig({
      ...validEnv(),
      OAUTH_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
      OAUTH_REDIRECT_URI: 'http://127.0.0.1:5173/api/oauth/callback',
      OAUTH_AUTHORIZATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/auth',
      OAUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:4174/oauth2/token',
      OAUTH_REVOCATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/revoke',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.authorizationEndpoint).toBe('http://127.0.0.1:4174/oauth2/auth');
    expect(result.config.tokenEndpoint).toBe('http://127.0.0.1:4174/oauth2/token');
    expect(result.config.revocationEndpoint).toBe('http://127.0.0.1:4174/oauth2/revoke');
  });

  it.each([
    { OAUTH_AUTHORIZATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/auth' },
    {
      OAUTH_AUTHORIZATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/auth',
      OAUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:4174/oauth2/token',
      OAUTH_REVOCATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/revoke',
    },
    {
      OAUTH_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
      OAUTH_REDIRECT_URI: 'http://127.0.0.1:5173/api/oauth/callback',
      OAUTH_AUTHORIZATION_ENDPOINT: 'http://169.254.169.254/oauth2/auth',
      OAUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:4174/oauth2/token',
      OAUTH_REVOCATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/revoke',
    },
    {
      OAUTH_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
      OAUTH_REDIRECT_URI: 'http://127.0.0.1:5173/api/oauth/callback',
      OAUTH_AUTHORIZATION_ENDPOINT: 'http://127.0.0.1.attacker.example:4174/oauth2/auth',
      OAUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:4174/oauth2/token',
      OAUTH_REVOCATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/revoke',
    },
    {
      OAUTH_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
      OAUTH_REDIRECT_URI: 'http://127.0.0.1:5173/api/oauth/callback',
      OAUTH_AUTHORIZATION_ENDPOINT: 'https://127.0.0.1:4174/oauth2/auth',
      OAUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:4174/oauth2/token',
      OAUTH_REVOCATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/revoke',
    },
    {
      OAUTH_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
      OAUTH_REDIRECT_URI: 'http://127.0.0.1:5173/api/oauth/callback',
      OAUTH_AUTHORIZATION_ENDPOINT: 'http://user@127.0.0.1:4174/oauth2/auth',
      OAUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:4174/oauth2/token',
      OAUTH_REVOCATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/revoke',
    },
    {
      OAUTH_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
      OAUTH_REDIRECT_URI: 'http://127.0.0.1:5173/api/oauth/callback',
      OAUTH_AUTHORIZATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/auth?next=http://attacker.example',
      OAUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:4174/oauth2/token',
      OAUTH_REVOCATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/revoke',
    },
  ])('rejects unsafe or incomplete local provider override %#', async (change) => {
    await expect(parseOAuthConfig({ ...validEnv(), ...change })).resolves.toEqual({
      ok: false,
      error: 'oauth_config_invalid_provider',
    });
  });
});

describe('Cloudflare OAuth provider boundary', () => {
  it('builds the exact public authorization request', async () => {
    const url = buildAuthorizationUrl(await config(), {
      scopes: new Set(['account:read', 'zone:read']),
      state: 'state-value',
      codeChallenge: 'challenge-value',
    });
    expect(url.origin + url.pathname).toBe('https://dash.cloudflare.com/oauth2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'twilight.zone_client-1',
      redirect_uri: 'https://twilight-zone.ross.gg/api/oauth/callback',
      scope: 'account:read zone:read',
      state: 'state-value',
      code_challenge: 'challenge-value',
      code_challenge_method: 'S256',
    });
  });

  it('exchanges a code once using the exact form contract and validates the response', async () => {
    const fetchImpl = vi.fn<OAuthFetch>(async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({
        access_token: 'access-token', token_type: 'bearer', expires_in: 3600, scope: 'zone:read account:read',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const result = await exchangeAuthorizationCode(await config(), {
      code: 'authorization-code', codeVerifier: 'verifier', scopes: new Set(['account:read', 'zone:read']),
    }, fetchImpl);

    expect(result).toEqual({
      ok: true,
      token: { accessToken: 'access-token', tokenType: 'Bearer', expiresIn: 3600, scopes: new Set(['zone:read', 'account:read']) },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0];
    expect(input).toBe('https://dash.cloudflare.com/oauth2/token');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      grant_type: 'authorization_code',
      client_id: 'twilight.zone_client-1',
      code: 'authorization-code',
      redirect_uri: 'https://twilight-zone.ross.gg/api/oauth/callback',
      code_verifier: 'verifier',
    });
    expect(String(init?.body)).not.toContain('client_secret');
  });

  it.each([
    [{ access_token: '', token_type: 'Bearer', expires_in: 3600, scope: 'account:read zone:read' }, 'oauth_provider_invalid_token'],
    [{ access_token: 'token', token_type: 'MAC', expires_in: 3600, scope: 'account:read zone:read' }, 'oauth_provider_invalid_token'],
    [{ access_token: 'token', token_type: 'Bearer', expires_in: 0, scope: 'account:read zone:read' }, 'oauth_provider_invalid_token'],
    [{ access_token: 'token', token_type: 'Bearer', expires_in: 1.5, scope: 'account:read zone:read' }, 'oauth_provider_invalid_token'],
    [{ access_token: 'token', token_type: 'Bearer', expires_in: Number.MAX_SAFE_INTEGER + 1, scope: 'account:read zone:read' }, 'oauth_provider_invalid_token'],
    [{ access_token: 'token', token_type: 'Bearer', expires_in: 3600, scope: 'account:read' }, 'oauth_provider_invalid_token'],
    [{ access_token: 'token', token_type: 'Bearer', expires_in: 3600, scope: 'account:read zone:read extra' }, 'oauth_provider_invalid_token'],
    [{ access_token: 'token', token_type: 'Bearer', expires_in: 3600, scope: 'account:read zone:read', refresh_token: 'forbidden' }, 'oauth_provider_invalid_token'],
  ])('rejects malformed token response %#', async (body, error) => {
    const fetchImpl = vi.fn<OAuthFetch>(async () => new Response(JSON.stringify(body), { status: 200 }));
    await expect(exchangeAuthorizationCode(await config(), {
      code: 'code', codeVerifier: 'verifier', scopes: new Set(['account:read', 'zone:read']),
    }, fetchImpl)).resolves.toEqual({ ok: false, error });
  });

  it('returns stable errors for malformed JSON, provider rejection, and timeout', async () => {
    const args = { code: 'code', codeVerifier: 'verifier', scopes: new Set(['account:read', 'zone:read']) };
    await expect(exchangeAuthorizationCode(await config(), args, async () => new Response('{', { status: 200 })))
      .resolves.toEqual({ ok: false, error: 'oauth_provider_invalid_response' });
    await expect(exchangeAuthorizationCode(await config(), args, async () => new Response('denied', { status: 400 })))
      .resolves.toEqual({ ok: false, error: 'oauth_provider_rejected' });
    await expect(exchangeAuthorizationCode(await config(), args, async () => {
      throw new DOMException('timed out with secret', 'TimeoutError');
    })).resolves.toEqual({ ok: false, error: 'oauth_provider_timeout' });
  });

  it('aborts provider fetch at exactly 10 seconds', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    const fetchImpl = vi.fn<OAuthFetch>(async (_input, init) => {
      signal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
      });
    });

    try {
      const result = exchangeAuthorizationCode(await config(), {
        code: 'code', codeVerifier: 'verifier', scopes: new Set(['account:read', 'zone:read']),
      }, fetchImpl);
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({ ok: false, error: 'oauth_provider_timeout' });
      expect(signal?.aborted).toBe(true);
    } finally {
      timeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('revokes at the fixed endpoint and accepts only 2xx', async () => {
    const fetchImpl = vi.fn<OAuthFetch>(async () => new Response(null, { status: 204 }));
    await expect(revokeAccessToken(await config(), 'access-token', fetchImpl)).resolves.toEqual({ ok: true });
    const [input, init] = fetchImpl.mock.calls[0];
    expect(input).toBe('https://dash.cloudflare.com/oauth2/revoke');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      client_id: 'twilight.zone_client-1', token: 'access-token', token_type_hint: 'access_token',
    });

    await expect(revokeAccessToken(await config(), 'access-token', async () => new Response(null, { status: 300 })))
      .resolves.toEqual({ ok: false, error: 'oauth_provider_rejected' });
  });

  it('uses the validated local provider endpoints for authorization, exchange, and revocation', async () => {
    const parsed = await parseOAuthConfig({
      ...validEnv(),
      OAUTH_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
      OAUTH_REDIRECT_URI: 'http://127.0.0.1:5173/api/oauth/callback',
      OAUTH_AUTHORIZATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/auth',
      OAUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:4174/oauth2/token',
      OAUTH_REVOCATION_ENDPOINT: 'http://127.0.0.1:4174/oauth2/revoke',
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const fetchImpl = vi.fn<OAuthFetch>(async (input) => new Response(
      String(input).endsWith('/token')
        ? JSON.stringify({ access_token: 'local-token', token_type: 'Bearer', expires_in: 3600, scope: 'account:read zone:read' })
        : null,
      { status: String(input).endsWith('/token') ? 200 : 204 },
    ));

    expect(buildAuthorizationUrl(parsed.config, {
      scopes: new Set(['account:read', 'zone:read']), state: 'state', codeChallenge: 'challenge',
    }).origin).toBe('http://127.0.0.1:4174');
    await exchangeAuthorizationCode(parsed.config, {
      code: 'code', codeVerifier: 'verifier', scopes: new Set(['account:read', 'zone:read']),
    }, fetchImpl);
    await revokeAccessToken(parsed.config, 'local-token', fetchImpl);

    expect(fetchImpl.mock.calls.map(([input]) => input)).toEqual([
      'http://127.0.0.1:4174/oauth2/token',
      'http://127.0.0.1:4174/oauth2/revoke',
    ]);
  });
});
