import { Hono } from 'hono';

import { parseOAuthConfig, type OAuthEnv } from './config';
import {
  base64UrlDecode,
  createPkceChallenge,
  decryptOAuthPayload,
  encryptOAuthPayload,
  fixedDigestEqual,
  generateGrantId,
  generatePkceVerifier,
  generateState,
  hashValue,
} from './crypto';
import {
  allOAuthCookieNames,
  clearOAuthCookie,
  createGrantCookie,
  createTransactionCookie,
  OAUTH_COOKIE_NAMES,
  parseCookieHeader,
  parseOAuthCookieValue,
} from './cookies';
import { isGrantBoundToNonce, readRoleGrant } from './grants';
import { buildAuthorizationUrl, exchangeAuthorizationCode, revokeAccessToken, type OAuthFetch } from './provider';
import type { OAuthGrantPayload, OAuthRole, OAuthTransactionPayload } from './types';

type OAuthRouteOptions = {
  now?: () => number;
  fetchImpl?: OAuthFetch;
  encryptGrant?: typeof encryptOAuthPayload;
};

const isRole = (value: unknown): value is OAuthRole => value === 'source' || value === 'destination';
const isNonce = (value: string | undefined): value is string => {
  if (!value) return false;
  try {
    return base64UrlDecode(value).byteLength === 32;
  } catch {
    return false;
  }
};
const sameOrigin = (request: Request, allowedOrigin: string): boolean =>
  request.headers.get('Origin') === allowedOrigin && new URL(request.url).origin === allowedOrigin;
const requestOriginMatches = (request: Request): boolean =>
  request.headers.get('Origin') === new URL(request.url).origin;
const callbackHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const callbackErrorCodes = new Set([
  'oauth_callback_invalid', 'oauth_callback_expired', 'oauth_provider_rejected', 'oauth_provider_timeout',
  'oauth_provider_unavailable', 'oauth_provider_invalid_response', 'oauth_provider_invalid_token', 'oauth_config_invalid',
  'oauth_callback_failed',
]);

const appendCookies = (headers: Headers, cookies: string[]) => {
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
};

export const createOAuthRoutes = (options: OAuthRouteOptions = {}) => {
  const app = new Hono<{ Bindings: OAuthEnv }>();
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const encryptGrant = options.encryptGrant ?? encryptOAuthPayload;

  app.post('/config', async (c) => {
    const result = await parseOAuthConfig(c.env);
    return result.ok
      ? c.json({ enabled: true })
      : c.json({ enabled: false, reason: result.error });
  });

  app.post('/start', async (c) => {
    const configResult = await parseOAuthConfig(c.env);
    if (!configResult.ok) return c.json({ error: configResult.error }, 503);
    if (!sameOrigin(c.req.raw, configResult.config.allowedOrigin)) return c.json({ error: 'oauth_origin_mismatch' }, 400);
    const nonce = c.req.header('X-Twilight-OAuth-Nonce');
    let body: { role?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'oauth_invalid_request' }, 400);
    }
    if (!isRole(body.role) || !isNonce(nonce)) return c.json({ error: 'oauth_invalid_request' }, 400);
    const state = generateState();
    const codeVerifier = generatePkceVerifier();
    const transaction: OAuthTransactionPayload = {
      version: 1,
      role: body.role,
      stateDigest: await hashValue(state),
      nonceDigest: await hashValue(nonce),
      codeVerifier,
      issuedAt: now(),
    };
    const envelope = await encryptOAuthPayload(transaction, configResult.config.cookieKey, {
      keyId: configResult.config.cookieKeyId,
      role: body.role,
      purpose: 'transaction',
      origin: configResult.config.allowedOrigin,
    });
    const scopes = body.role === 'source' ? configResult.config.sourceScopes : configResult.config.destinationScopes;
    const authorizationUrl = buildAuthorizationUrl(configResult.config, {
      scopes,
      state,
      codeChallenge: await createPkceChallenge(codeVerifier),
    });
    c.header('Set-Cookie', createTransactionCookie(body.role, envelope));
    return c.json({ authorizationUrl: authorizationUrl.href });
  });

  app.get('/callback', async (c) => {
    const configResult = await parseOAuthConfig(c.env);
    const config = configResult.ok ? configResult.config : undefined;
    const errorLocation = (reason: string): string => {
      const safeReason = callbackErrorCodes.has(reason) ? reason : 'oauth_callback_invalid';
      return config
        ? `${config.allowedOrigin}/?oauth_result=error&oauth_reason=${safeReason}`
        : `/?oauth_result=error&oauth_reason=${safeReason}`;
    };
    const redirect = (location: string, cookies: string[] = []) => {
      const headers = new Headers({ ...callbackHeaders, Location: location });
      appendCookies(headers, cookies);
      return new Response(null, { status: 303, headers });
    };
    if (!config) return redirect(errorLocation('oauth_config_invalid'));

    const url = new URL(c.req.url);
    const keys = [...url.searchParams.keys()];
    const state = url.searchParams.get('state');
    if (!state || state.length > 256) return redirect(errorLocation('oauth_callback_invalid'));

    let cookies: Map<string, string>;
    try {
      cookies = parseCookieHeader(c.req.header('Cookie') ?? null);
    } catch {
      return redirect(errorLocation('oauth_callback_invalid'));
    }
    let matched: { role: OAuthRole; transaction: OAuthTransactionPayload } | undefined;
    for (const role of ['source', 'destination'] as const) {
      const value = cookies.get(OAUTH_COOKIE_NAMES[role].transaction);
      if (!value) continue;
      try {
        const payload = await decryptOAuthPayload(parseOAuthCookieValue(value), config.cookieKey, {
          keyId: config.cookieKeyId, role, purpose: 'transaction', origin: config.allowedOrigin,
        });
        if ('codeVerifier' in payload && fixedDigestEqual(payload.stateDigest, await hashValue(state))) {
          if (matched) return redirect(errorLocation('oauth_callback_invalid'));
          matched = { role, transaction: payload };
        }
      } catch {
        // A different role's invalid transaction cannot authorize this callback.
      }
    }
    if (!matched) return redirect(errorLocation('oauth_callback_invalid'));
    const clearTransaction = clearOAuthCookie(OAUTH_COOKIE_NAMES[matched.role].transaction);
    const exactCallbackUrl = `${url.origin}${url.pathname}` === config.redirectUri;
    if (!exactCallbackUrl) return redirect(errorLocation('oauth_callback_invalid'), [clearTransaction]);
    const age = now() - matched.transaction.issuedAt;
    if (age < 0 || age > 300_000) return redirect(errorLocation('oauth_callback_expired'), [clearTransaction]);

    const providerError = url.searchParams.get('error');
    if (providerError) {
      const validErrorKeys = keys.length >= 2
        && keys.every((key) => key === 'error' || key === 'error_description' || key === 'state')
        && keys.filter((key) => key === 'error').length === 1
        && keys.filter((key) => key === 'state').length === 1;
      return validErrorKeys
        ? redirect(errorLocation('oauth_provider_rejected'), [clearTransaction])
        : redirect(errorLocation('oauth_callback_invalid'), [clearTransaction]);
    }

    const validSuccessKeys = keys.length === 2
      && keys.filter((key) => key === 'code').length === 1
      && keys.filter((key) => key === 'state').length === 1;
    const code = url.searchParams.get('code');
    if (!validSuccessKeys || !code || code.length > 2048) {
      return redirect(errorLocation('oauth_callback_invalid'), [clearTransaction]);
    }

    const scopes = matched.role === 'source' ? config.sourceScopes : config.destinationScopes;
    const exchanged = await exchangeAuthorizationCode(config, {
      code,
      codeVerifier: matched.transaction.codeVerifier,
      scopes,
    }, fetchImpl);
    if (!exchanged.ok) return redirect(errorLocation(exchanged.error), [clearTransaction]);
    const expiresAt = now() + exchanged.token.expiresIn * 1000;
    if (!Number.isSafeInteger(expiresAt)) {
      return redirect(errorLocation('oauth_provider_invalid_token'), [clearTransaction]);
    }
    const grant: OAuthGrantPayload = {
      version: 1,
      role: matched.role,
      accessToken: exchanged.token.accessToken,
      tokenType: exchanged.token.tokenType,
      expiresAt,
      scopes: [...exchanged.token.scopes],
      nonceDigest: matched.transaction.nonceDigest,
      grantId: generateGrantId(),
    };
    try {
      const grantEnvelope = await encryptGrant(grant, config.cookieKey, {
        keyId: config.cookieKeyId, role: matched.role, purpose: 'grant', origin: config.allowedOrigin,
      });
      return redirect(
        `${config.allowedOrigin}/?oauth_result=connected&oauth_role=${matched.role}`,
        [createGrantCookie(matched.role, grantEnvelope), clearTransaction],
      );
    } catch {
      await revokeAccessToken(config, exchanged.token.accessToken, fetchImpl).catch(() => undefined);
      return redirect(errorLocation('oauth_callback_failed'), [clearTransaction]);
    }
  });

  app.post('/status', async (c) => {
    const configResult = await parseOAuthConfig(c.env);
    if (!configResult.ok) return c.json({ error: configResult.error }, 503);
    if (!sameOrigin(c.req.raw, configResult.config.allowedOrigin)) return c.json({ error: 'oauth_origin_mismatch' }, 403);
    const nonce = c.req.header('X-Twilight-OAuth-Nonce');
    if (!isNonce(nonce)) return c.json({ error: 'oauth_reauthorization_required' }, 401);
    const roles: Record<OAuthRole, { connected: boolean; expiresAt?: number; scopes?: string[] }> = {
      source: { connected: false }, destination: { connected: false },
    };
    for (const role of ['source', 'destination'] as const) {
      let grant: OAuthGrantPayload | undefined;
      try {
        grant = await readRoleGrant(c.req.header('Cookie') ?? null, role, configResult.config);
      } catch (error) {
        if (error instanceof Error && error.message === 'oauth_cookie_header_too_large') {
          return c.json({ error: 'oauth_cookie_header_too_large' }, 400);
        }
        c.header('Set-Cookie', clearOAuthCookie(OAUTH_COOKIE_NAMES[role].grant), { append: true });
        return c.json({ error: 'oauth_reauthorization_required' }, 401);
      }
      if (!grant) continue;
      if (grant.expiresAt <= now()) {
        c.header('Set-Cookie', clearOAuthCookie(OAUTH_COOKIE_NAMES[role].grant), { append: true });
        return c.json({ error: 'oauth_reauthorization_required' }, 401);
      }
      if (!(await isGrantBoundToNonce(grant, nonce))) {
        return c.json({ error: 'oauth_reauthorization_required' }, 401);
      }
      roles[role] = { connected: true, expiresAt: grant.expiresAt, scopes: grant.scopes };
    }
    return c.json({ roles });
  });

  app.post('/clear', async (c) => {
    let body: { role?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: 'oauth_invalid_request' }, 400); }
    if (!isRole(body.role)) return c.json({ error: 'oauth_invalid_request' }, 400);
    if (!requestOriginMatches(c.req.raw)) return c.json({ error: 'oauth_origin_mismatch' }, 403);
    const configResult = await parseOAuthConfig(c.env);
    if (configResult.ok) {
      if (!sameOrigin(c.req.raw, configResult.config.allowedOrigin)) return c.json({ error: 'oauth_origin_mismatch' }, 403);
      try {
        const grant = await readRoleGrant(c.req.header('Cookie') ?? null, body.role, configResult.config);
        if (grant) await revokeAccessToken(configResult.config, grant.accessToken, fetchImpl);
      } catch {
        // Revocation is best-effort; local cleanup is unconditional.
      }
    }
    c.header('Set-Cookie', clearOAuthCookie(OAUTH_COOKIE_NAMES[body.role].grant), { append: true });
    c.header('Set-Cookie', clearOAuthCookie(OAUTH_COOKIE_NAMES[body.role].transaction), { append: true });
    return c.json({ ok: true, clearNonce: false });
  });

  app.post('/logout', async (c) => {
    if (!requestOriginMatches(c.req.raw)) return c.json({ error: 'oauth_origin_mismatch' }, 403);
    const configResult = await parseOAuthConfig(c.env);
    if (configResult.ok) {
      if (!sameOrigin(c.req.raw, configResult.config.allowedOrigin)) return c.json({ error: 'oauth_origin_mismatch' }, 403);
      await Promise.allSettled((['source', 'destination'] as const).map(async (role) => {
        const grant = await readRoleGrant(c.req.header('Cookie') ?? null, role, configResult.config);
        if (grant) await revokeAccessToken(configResult.config, grant.accessToken, fetchImpl);
      }));
    }
    for (const name of allOAuthCookieNames()) c.header('Set-Cookie', clearOAuthCookie(name), { append: true });
    return c.json({ ok: true, clearNonce: true });
  });

  return app;
};
