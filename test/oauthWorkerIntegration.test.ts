import { afterEach, describe, expect, it, vi } from 'vitest';

import worker, { registeredUiRoutePaths } from '../src/worker/index';
import { createGrantCookie, OAUTH_COOKIE_NAMES } from '../src/worker/oauth/cookies';
import { parseOAuthConfig } from '../src/worker/oauth/config';
import { encryptOAuthPayload, generateGrantId, hashValue } from '../src/worker/oauth/crypto';
import { UI_ROUTE_POLICIES } from '../src/worker/oauth/route-policy';
import type { OAuthGrantPayload, OAuthRole } from '../src/worker/oauth/types';
import type { ZoneExport } from '../src/types';

const origin = 'https://twilight-zone.ross.gg';
const env = {
  ASSETS: { fetch: async () => new Response('asset') },
  OAUTH_ENABLED: 'false',
};
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const nonce = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const oauthEnv = {
  ...env,
  OAUTH_ENABLED: 'true',
  OAUTH_CLIENT_ID: 'client',
  OAUTH_COOKIE_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  OAUTH_COOKIE_KEY_ID: 'key_1',
  OAUTH_ALLOWED_ORIGIN: origin,
  OAUTH_REDIRECT_URI: `${origin}/api/oauth/callback`,
  OAUTH_SOURCE_SCOPES: '["account:read","zone:read"]',
  OAUTH_DESTINATION_SCOPES: '["account:read","zone:edit"]',
};

const roleCookie = async (role: OAuthRole): Promise<string> => {
  const parsed = await parseOAuthConfig(oauthEnv);
  if (!parsed.ok) throw new Error(parsed.error);
  const grant: OAuthGrantPayload = {
    version: 1,
    role,
    accessToken: `${role}-oauth-token`,
    tokenType: 'Bearer',
    expiresAt: Date.now() + 3_600_000,
    scopes: role === 'source' ? ['account:read', 'zone:read'] : ['account:read', 'zone:edit'],
    nonceDigest: await hashValue(nonce),
    grantId: generateGrantId(),
  };
  const envelope = await encryptOAuthPayload(grant, parsed.config.cookieKey, {
    keyId: parsed.config.cookieKeyId, role, purpose: 'grant', origin,
  });
  return createGrantCookie(role, envelope).split(';', 1)[0];
};

const oauthHeaders = (cookie: string): Record<string, string> => ({
  Origin: origin,
  Cookie: cookie,
  'Content-Type': 'application/json',
  'X-Twilight-Auth': 'oauth',
  'X-Twilight-OAuth-Nonce': nonce,
});

const cfSuccess = (result: unknown): Response => new Response(JSON.stringify({
  success: true,
  result,
  result_info: { total_pages: 1 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const cfAuthFailure = (): Response => new Response(JSON.stringify({
  success: false,
  result: null,
  errors: [{ code: 9109, message: 'Invalid access token' }],
}), { status: 401, headers: { 'Content-Type': 'application/json' } });

const importedExport = (): ZoneExport => ({
  zone: {
    id: 'a'.repeat(32), name: 'source.example.com', name_servers: [], status: 'active',
    account: { id: 'b'.repeat(32), name: 'Source' }, plan: { id: 'free', name: 'Free' },
  },
  dnsRecords: [], settings: [], pageRules: [], rulesets: [], workerRoutes: [], loadBalancers: [],
  spectrumApps: [], customCertificates: [], customHostnames: [], firewallRules: [], rateLimits: [],
  emailRoutingRules: [], waitingRooms: [], workers: [], pools: [], monitors: [], accessApps: [],
  accessPolicies: [], zarazConfig: null, turnstileWidgets: [], kvNamespaces: [], r2Buckets: [],
  d1Databases: [], queues: [], durableObjectNamespaces: [],
});

afterEach(() => vi.unstubAllGlobals());

describe('Worker OAuth integration', () => {
  it('mounts the modular OAuth routes before the generic API fallback', async () => {
    const response = await worker.fetch(new Request(`${origin}/api/oauth/config`, {
      method: 'POST', headers: { Origin: origin },
    }), env, ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, reason: 'oauth_disabled' });
  });

  it('keeps registered UI routes and declarative policies exhaustive', () => {
    expect([...registeredUiRoutePaths].sort()).toEqual([...new Set(UI_ROUTE_POLICIES.map(({ path }) => path))].sort());
  });

  it('keeps public API v1 documentation isolated from OAuth cookies', async () => {
    const response = await worker.fetch(new Request(`${origin}/api/v1/docs`, {
      headers: { Cookie: '__Host-tz-oauth-source-grant=forged', 'X-Twilight-Auth': 'oauth' },
    }), env, ctx);
    expect(response.status).toBe(200);
  });

  it('preserves callback no-store and no-referrer headers through global middleware', async () => {
    const response = await worker.fetch(new Request(`${origin}/api/oauth/callback?code=x&state=y`), oauthEnv, ctx);
    expect(response.status).toBe(303);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it.each(['/api/v1', '/api/v1/', '/api/v1/docs'])('serves %s documentation by GET only', async (path) => {
    const get = await worker.fetch(new Request(`${origin}${path}`), env, ctx);
    const post = await worker.fetch(new Request(`${origin}${path}`, { method: 'POST' }), env, ctx);
    expect(get.status).toBe(200);
    expect(post.status).toBe(405);
  });

  it('does not accept OAuth cookies on protected v1 routes but still accepts body credentials', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer manual-api-token');
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'a'.repeat(32), name: 'Manual account' }],
        result_info: { total_pages: 1 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const forgedCookie = `${OAUTH_COOKIE_NAMES.source.grant}=forged`;
    const denied = await worker.fetch(new Request(`${origin}/api/v1/accounts`, {
      method: 'POST',
      headers: { Cookie: forgedCookie, 'X-Twilight-Auth': 'oauth', 'Content-Type': 'application/json' },
      body: '{}',
    }), env, ctx);
    expect(denied.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();

    const accepted = await worker.fetch(new Request(`${origin}/api/v1/accounts`, {
      method: 'POST',
      headers: { Cookie: forgedCookie, 'X-Twilight-Auth': 'oauth', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'manual-api-token' }),
    }), env, ctx);
    expect(accepted.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('lets valid OAuth reach a real handler with bearer auth', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer source-oauth-token');
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'a'.repeat(32), name: 'OAuth account' }],
        result_info: { total_pages: 1 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const response = await worker.fetch(new Request(`${origin}/api/accounts`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('source')),
      body: JSON.stringify({ oauthRole: 'source' }),
    }), oauthEnv, ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accounts: [{ id: 'a'.repeat(32), name: 'OAuth account' }] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('translates a synchronous upstream OAuth rejection into role-specific reauthorization and clears that grant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      result: null,
      errors: [{ code: 9109, message: 'Invalid access token' }],
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })));

    const response = await worker.fetch(new Request(`${origin}/api/accounts`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('source')),
      body: JSON.stringify({ oauthRole: 'source' }),
    }), oauthEnv, ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'oauth_reauthorization_required', role: 'source' });
    expect(response.headers.get('Set-Cookie') ?? '').toContain(`${OAUTH_COOKIE_NAMES.source.grant}=; Max-Age=0`);
  });

  it('preserves reauthorization when duplicate email-address recovery loses destination auth', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: false,
        result: null,
        errors: [{ code: 1001, message: 'Email address already exists' }],
      }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(cfAuthFailure());
    vi.stubGlobal('fetch', fetchImpl);

    const response = await worker.fetch(new Request(`${origin}/api/email-routing/send-verification`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('destination')),
      body: JSON.stringify({
        destAccountId: 'a'.repeat(32),
        email: 'recipient@example.com',
      }),
    }), oauthEnv, ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'oauth_reauthorization_required',
      role: 'destination',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('lets valid OAuth start a real stream and blocks invalid OAuth before the stream starts', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { __schema: { types: [] } } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchImpl);
    const body = JSON.stringify({ sourceZoneId: 'a'.repeat(32), sourceAccountId: 'b'.repeat(32) });
    const valid = await worker.fetch(new Request(`${origin}/api/analytics/probe/stream`, {
      method: 'POST', headers: oauthHeaders(await roleCookie('source')), body,
    }), oauthEnv, ctx);
    expect(valid.status).toBe(200);
    expect(valid.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await valid.text()).toContain('"type":"done"');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    fetchImpl.mockClear();
    const invalid = await worker.fetch(new Request(`${origin}/api/analytics/probe/stream`, {
      method: 'POST', headers: oauthHeaders(`${OAUTH_COOKIE_NAMES.source.grant}=forged`), body,
    }), oauthEnv, ctx);
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('Content-Type')).toContain('application/json');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['json', 'terraform'])('runs the account migration phase for %s imports with destination OAuth only', async (sourceMode) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true, result: [], result_info: { total_pages: 1 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchImpl);
    const response = await worker.fetch(new Request(`${origin}/api/migrate/account-resources`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('destination')),
      body: JSON.stringify({
        sourceMode,
        exportData: importedExport(),
        destAccountId: 'c'.repeat(32),
        domainName: 'source.example.com',
      }),
    }), oauthEnv, ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await response.text()).toContain('"type":"done"');
  });

  it('accepts destination OAuth for destination export and requires both roles for diff', async () => {
    const destinationCookie = await roleCookie('destination');
    const exportResponse = await worker.fetch(new Request(`${origin}/api/export/stream`, {
      method: 'POST',
      headers: oauthHeaders(destinationCookie),
      body: JSON.stringify({ oauthRole: 'destination', sourceZoneId: 'bad', sourceAccountId: 'bad' }),
    }), oauthEnv, ctx);
    expect(exportResponse.status).toBe(400);
    expect(await exportResponse.json()).toMatchObject({ error: expect.stringContaining('sourceZoneId') });

    const sourceExport = importedExport();
    const destinationOnly = await worker.fetch(new Request(`${origin}/api/diff/stream`, {
      method: 'POST',
      headers: oauthHeaders(destinationCookie),
      body: JSON.stringify({ sourceExport, destExport: sourceExport }),
    }), oauthEnv, ctx);
    expect(destinationOnly.status).toBe(401);
    expect(await destinationOnly.json()).toEqual({
      error: 'oauth_reauthorization_required',
      role: 'source',
    });

    const bothCookies = `${await roleCookie('source')}; ${destinationCookie}`;
    const diffResponse = await worker.fetch(new Request(`${origin}/api/diff/stream`, {
      method: 'POST',
      headers: oauthHeaders(bothCookies),
      body: JSON.stringify({ sourceExport, destExport: sourceExport }),
    }), oauthEnv, ctx);
    expect(diffResponse.status).toBe(200);
    expect(await diffResponse.text()).toContain('"type":"done"');
  });

  it('adapts destination advisory export OAuth to the export handler sourceToken contract', async () => {
    let upstreamCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamCalls++;
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer destination-oauth-token');
      if (upstreamCalls === 1) {
        return cfSuccess({
          id: 'a'.repeat(32), name: 'destination.example.com', status: 'active', name_servers: [],
          account: { id: 'b'.repeat(32), name: 'Destination' }, plan: { id: 'free', name: 'Free' },
        });
      }
      return cfAuthFailure();
    }));

    const response = await worker.fetch(new Request(`${origin}/api/export/stream`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('destination')),
      body: JSON.stringify({
        oauthRole: 'destination',
        sourceZoneId: 'a'.repeat(32),
        sourceAccountId: 'b'.repeat(32),
      }),
    }), oauthEnv, ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    const body = await response.text();
    expect(upstreamCalls).toBeGreaterThan(1);
    expect(body).toContain('"type":"reauthorization_required"');
    expect(body).toContain('"role":"destination"');
  });

  it('emits one role-specific reauthorization event when OAuth bearer auth is rejected after streaming starts', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      result: null,
      errors: [{ code: 9109, message: 'Invalid access token' }],
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchImpl);
    const response = await worker.fetch(new Request(`${origin}/api/analytics/probe/stream`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('source')),
      body: JSON.stringify({ sourceZoneId: 'a'.repeat(32), sourceAccountId: 'b'.repeat(32) }),
    }), oauthEnv, ctx);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body.match(/"type":"reauthorization_required"/g)).toHaveLength(1);
    expect(body).toContain('"role":"source"');
    expect(body).not.toContain('source-oauth-token');
  });

  it('reauthorizes destination OAuth when a later capability probe rejects the bearer token', async () => {
    let upstreamCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      upstreamCalls++;
      if (String(input).includes('/r2/buckets')) return cfAuthFailure();
      return cfSuccess([]);
    }));

    const response = await worker.fetch(new Request(`${origin}/api/check-capabilities`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('destination')),
      body: JSON.stringify({ destAccountId: 'b'.repeat(32) }),
    }), oauthEnv, ctx);

    expect(upstreamCalls).toBeGreaterThan(2);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'oauth_reauthorization_required', role: 'destination' });
  });

  it('reauthorizes destination OAuth when the late existing-zone blocker lookup rejects the bearer token', async () => {
    const sourceCookie = await roleCookie('source');
    const destinationCookie = await roleCookie('destination');
    let upstreamCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      upstreamCalls++;
      if (upstreamCalls === 1) {
        return cfSuccess({
          id: 'a'.repeat(32), name: 'source.example.com', status: 'active', name_servers: [],
          account: { id: 'b'.repeat(32), name: 'Source' }, plan: { id: 'free', name: 'Free' },
        });
      }
      if (upstreamCalls === 2) return cfSuccess([{ id: 'c'.repeat(32) }]);
      if (upstreamCalls === 3) return cfAuthFailure();
      return cfSuccess({ status: 'disabled' });
    }));

    const response = await worker.fetch(new Request(`${origin}/api/check-blockers`, {
      method: 'POST',
      headers: oauthHeaders(`${sourceCookie}; ${destinationCookie}`),
      body: JSON.stringify({
        sourceZoneId: 'a'.repeat(32), sourceAccountId: 'b'.repeat(32),
        destAccountId: 'c'.repeat(32), domainName: 'source.example.com',
      }),
    }), oauthEnv, ctx);

    expect(upstreamCalls).toBe(3);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'oauth_reauthorization_required', role: 'destination' });
  });

  it('reauthorizes source OAuth when the monitor zone lookup rejects the bearer token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => cfAuthFailure()));

    const response = await worker.fetch(new Request(`${origin}/api/monitor/ping`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('source')),
      body: JSON.stringify({ sourceZoneId: 'a'.repeat(32), url: 'https://source.example.com/health' }),
    }), oauthEnv, ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'oauth_reauthorization_required', role: 'source' });
  });

  it('reauthorizes source OAuth when a later export request rejects the bearer token', async () => {
    let upstreamCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      upstreamCalls++;
      if (upstreamCalls === 1) {
        return cfSuccess({
          id: 'a'.repeat(32), name: 'source.example.com', status: 'active', name_servers: [],
          account: { id: 'b'.repeat(32), name: 'Source' }, plan: { id: 'free', name: 'Free' },
        });
      }
      return cfAuthFailure();
    }));

    const response = await worker.fetch(new Request(`${origin}/api/export/stream`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('source')),
      body: JSON.stringify({ oauthRole: 'source', sourceZoneId: 'a'.repeat(32), sourceAccountId: 'b'.repeat(32) }),
    }), oauthEnv, ctx);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(upstreamCalls).toBeGreaterThan(1);
    expect(body).toContain('"type":"reauthorization_required"');
    expect(body).toContain('"role":"source"');
    expect(body).not.toContain('"type":"done"');
  });

  it('reauthorizes destination OAuth when a later migration prelude request rejects the bearer token', async () => {
    let upstreamCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamCalls++;
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/zones')) {
        return cfSuccess({
          id: 'd'.repeat(32), name: 'source.example.com', status: 'pending', name_servers: [],
          account: { id: 'c'.repeat(32), name: 'Destination' }, plan: { id: 'free', name: 'Free' },
        });
      }
      if (url.endsWith(`/zones/${'d'.repeat(32)}/available_plans`)) return cfAuthFailure();
      return cfSuccess([]);
    }));

    const response = await worker.fetch(new Request(`${origin}/api/migrate/stream`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('destination')),
      body: JSON.stringify({
        sourceMode: 'json', exportData: importedExport(), destAccountId: 'c'.repeat(32),
        domainName: 'source.example.com', conflictStrategy: 'skip', skipAccountResources: true,
      }),
    }), oauthEnv, ctx);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(upstreamCalls).toBeGreaterThan(1);
    expect(body).toContain('"type":"reauthorization_required"');
    expect(body).toContain('"role":"destination"');
    expect(body).not.toContain('"type":"done"');
  });

  it('does not misclassify a streamed entitlement denial as reauthorization', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: false,
      result: null,
      errors: [{ code: 1001, message: 'Feature not enabled on this plan' }],
    }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchImpl);
    const response = await worker.fetch(new Request(`${origin}/api/analytics/probe/stream`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('source')),
      body: JSON.stringify({ sourceZoneId: 'a'.repeat(32), sourceAccountId: 'b'.repeat(32) }),
    }), oauthEnv, ctx);

    const body = await response.text();
    expect(body).toContain('Feature not enabled on this plan');
    expect(body).not.toContain('reauthorization_required');
  });

  it('does not swallow destination OAuth rejection inside Terraform resource import catches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      result: null,
      errors: [{ code: 9109, message: 'Invalid access token' }],
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })));

    const response = await worker.fetch(new Request(`${origin}/api/terraform/import/stream`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('destination')),
      body: JSON.stringify({
        destAccountId: 'b'.repeat(32),
        destZoneId: 'c'.repeat(32),
        tfContent: [
          'resource "cloudflare_dns_record" "test" {',
          '  name = "test"',
          '  type = "A"',
          '  content = "192.0.2.1"',
          '}',
        ].join('\n'),
      }),
    }), oauthEnv, ctx);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"reauthorization_required"');
    expect(body).toContain('"role":"destination"');
    expect(body).not.toContain('"type":"done"');
  });

  it('does not swallow destination OAuth rejection inside rollback item catches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      result: null,
      errors: [{ code: 9109, message: 'Invalid access token' }],
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })));

    const response = await worker.fetch(new Request(`${origin}/api/rollback`, {
      method: 'POST',
      headers: oauthHeaders(await roleCookie('destination')),
      body: JSON.stringify({
        destAccountId: 'b'.repeat(32),
        createdResources: { workers: ['oauth-rollback-worker'] },
      }),
    }), oauthEnv, ctx);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'oauth_reauthorization_required', role: 'destination' });
    expect(response.headers.get('Set-Cookie') ?? '').toContain(`${OAUTH_COOKIE_NAMES.destination.grant}=; Max-Age=0`);
  });
});
