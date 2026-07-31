import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getAuditLog,
  clearAuditLog,
  getRateLimitInfo,
  createAuth,
  getAuthHeaders,
  isRetryableError,
  batchWithConcurrency,
  classifyLoadBalancingProbeError,
  isTransientCertServiceError,
  listPagesProjects,
  deleteWorker,
  deleteZone,
  createAiGatewayProviderConfig,
  createAiGatewayCustomProvider,
  listApiGatewayUserLabels,
  addR2BucketCustomDomain,
  EmptyEnvelopeError,
  AuthError,
  humanizeAuthError,
  getZone,
  createZone,
  createZoneWithDelegation,
  listAccounts,
  isExportTolerable,
  getWorkerScriptBundle,
  putKVValue,
  cfRequestEnvelope,
} from '../src/api';

describe('api.ts', () => {
  describe('Audit Log', () => {
    beforeEach(() => {
      clearAuditLog();
    });

    it('getAuditLog returns empty array initially', () => {
      const log = getAuditLog();
      expect(log).toEqual([]);
    });

    it('clearAuditLog clears the audit log', () => {
      // The log starts empty, clearing should keep it empty
      clearAuditLog();
      expect(getAuditLog()).toEqual([]);
    });

    it('getAuditLog returns a copy, not the original', () => {
      const log1 = getAuditLog();
      const log2 = getAuditLog();
      expect(log1).not.toBe(log2); // Different array instances
      expect(log1).toEqual(log2); // Same content
    });
  });

  describe('Rate Limit Info', () => {
    it('getRateLimitInfo returns rate limit info', () => {
      const info = getRateLimitInfo();
      expect(info).toHaveProperty('remaining');
      expect(info).toHaveProperty('limit');
      expect(info).toHaveProperty('reset');
      expect(info).toHaveProperty('lastUpdated');
    });

    it('getRateLimitInfo returns a copy, not the original', () => {
      const info1 = getRateLimitInfo();
      const info2 = getRateLimitInfo();
      expect(info1).not.toBe(info2); // Different object instances
    });
  });

  describe('createAuth', () => {
    it('creates token auth when only token provided', () => {
      const auth = createAuth('my-token');
      expect(auth).toEqual({ type: 'token', token: 'my-token' });
    });

    it('creates key auth when apiKey and email provided', () => {
      const auth = createAuth('', 'my-api-key', 'user@example.com');
      expect(auth).toEqual({ type: 'key', apiKey: 'my-api-key', email: 'user@example.com' });
    });

    it('prefers key auth over token when both provided', () => {
      const auth = createAuth('my-token', 'my-api-key', 'user@example.com');
      expect(auth.type).toBe('key');
    });
  });

  describe('getAuthHeaders', () => {
    it('returns Bearer header for token auth', () => {
      const headers = getAuthHeaders({ type: 'token', token: 'my-token' });
      expect(headers).toEqual({ 'Authorization': 'Bearer my-token' });
    });

    it('returns X-Auth headers for key auth', () => {
      const headers = getAuthHeaders({ type: 'key', apiKey: 'my-key', email: 'user@example.com' });
      expect(headers).toEqual({
        'X-Auth-Key': 'my-key',
        'X-Auth-Email': 'user@example.com',
      });
    });
  });

  describe('isRetryableError', () => {
    it('returns true for 429 rate limit status', () => {
      expect(isRetryableError(429, '')).toBe(true);
    });

    it('returns true for 500 server error', () => {
      expect(isRetryableError(500, '')).toBe(true);
    });

    it('returns true for 502 bad gateway', () => {
      expect(isRetryableError(502, '')).toBe(true);
    });

    it('returns true for 503 service unavailable', () => {
      expect(isRetryableError(503, '')).toBe(true);
    });

    it('returns false for 599 (edge of server error range)', () => {
      expect(isRetryableError(599, '')).toBe(true);
    });

    it('returns false for 600 (outside server error range)', () => {
      expect(isRetryableError(600, '')).toBe(false);
    });

    it('returns true for error message containing "rate limit"', () => {
      expect(isRetryableError(400, 'rate limit exceeded')).toBe(true);
    });

    it('returns true for error message containing "too many requests"', () => {
      expect(isRetryableError(400, 'too many requests')).toBe(true);
    });

    it('returns false for 400 with generic error', () => {
      expect(isRetryableError(400, 'invalid request')).toBe(false);
    });

    it('returns false for 401 unauthorized', () => {
      expect(isRetryableError(401, 'unauthorized')).toBe(false);
    });

    it('returns false for 403 forbidden', () => {
      expect(isRetryableError(403, 'forbidden')).toBe(false);
    });

    it('returns false for 404 not found', () => {
      expect(isRetryableError(404, 'not found')).toBe(false);
    });
  });

  describe('isExportTolerable', () => {
    it('does not treat a bare forbidden response as feature absence', () => {
      expect(isExportTolerable('forbidden')).toBe(false);
      expect(isExportTolerable('forbidden: missing permission zone settings read')).toBe(false);
      expect(isExportTolerable('forbidden: zone settings read permission not enabled')).toBe(false);
      expect(isExportTolerable('permission not enabled for this token')).toBe(false);
    });

    it('still treats entitlement and plan-gated feature absence as tolerable', () => {
      expect(isExportTolerable('not entitled (forbidden)')).toBe(true);
      expect(isExportTolerable('your plan does not include this feature')).toBe(true);
      expect(isExportTolerable('feature not enabled on this plan')).toBe(true);
    });

    it('treats "could not route to" / invalid-object-identifier as not-applicable (not an outage)', () => {
      // Cloudflare returns this when a sub-feature endpoint isn't applicable to
      // the zone (e.g. cache/origin_cloud_regions). Should be a benign ⏭ skip,
      // not a scary ⚠ warning.
      expect(isExportTolerable(
        'could not route to /zones/abc/cache/origin_cloud_regions, perhaps your object identifier is invalid?'
      )).toBe(true);
      expect(isExportTolerable('the object identifier is invalid')).toBe(true);
    });

    it('treats secondary-DNS "not been linked to a peer" as tolerable (not configured)', () => {
      expect(isExportTolerable(
        'the zone has not been linked to a peer. please make a call to post zones/:identifier/secondary_dns/incoming'
      )).toBe(true);
    });
  });

  describe('batchWithConcurrency', () => {
    it('processes all items', async () => {
      const items = [1, 2, 3, 4, 5];
      const results = await batchWithConcurrency(items, async (n) => n * 2);
      
      expect(results).toHaveLength(5);
      const values = results.map(r => r.status === 'fulfilled' ? r.value : null);
      expect(values).toEqual([2, 4, 6, 8, 10]);
    });

    it('respects concurrency limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      
      const items = [1, 2, 3, 4, 5, 6];
      await batchWithConcurrency(items, async (n) => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(r => setTimeout(r, 10));
        concurrent--;
        return n;
      }, 2);
      
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('handles failures gracefully', async () => {
      const items = [1, 2, 3];
      const results = await batchWithConcurrency(items, async (n) => {
        if (n === 2) throw new Error('fail');
        return n;
      });
      
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
    });

    it('handles empty array', async () => {
      const results = await batchWithConcurrency([], async (n) => n);
      expect(results).toEqual([]);
    });
  });

  describe('classifyLoadBalancingProbeError', () => {
    // Class 1: classic "no LB subscription" — range [0, 0]
    it('detects "no subscription" via [0, 0] range', () => {
      const result = classifyLoadBalancingProbeError('interval is not in range [0, 0]: validation failed');
      expect(result).not.toBeNull();
      expect(result?.available).toBe(false);
      expect(result?.reason).toMatch(/not enabled/i);
      expect(result?.action).toMatch(/Dashboard.*Load Balancing/i);
    });

    it('detects "no subscription" via [0,0] without spaces', () => {
      const result = classifyLoadBalancingProbeError('interval is not in range [0,0]: validation failed');
      expect(result?.available).toBe(false);
    });

    // Class 2: degraded entitlement — range [1, 1] (interval clamp bug)
    it('detects degraded entitlement via [1, 1] range', () => {
      const result = classifyLoadBalancingProbeError('interval is not in range [1, 1]: validation failed');
      expect(result).not.toBeNull();
      expect(result?.available).toBe(false);
      expect(result?.reason).toMatch(/degraded state/i);
      expect(result?.reason).toMatch(/\[1, 1\]/);
      expect(result?.action).toMatch(/Cloudflare Support/);
    });

    it('detects degraded entitlement via [1,1] without spaces', () => {
      const result = classifyLoadBalancingProbeError('interval is not in range [1,1]: validation failed');
      expect(result?.available).toBe(false);
      expect(result?.reason).toMatch(/degraded state/i);
    });

    // Class 3: textual signals
    it('detects "not enabled" textual signal', () => {
      const result = classifyLoadBalancingProbeError('Load Balancing is not enabled on this account');
      expect(result?.available).toBe(false);
    });

    it('detects "subscription" textual signal', () => {
      const result = classifyLoadBalancingProbeError('A Load Balancing subscription is required');
      expect(result?.available).toBe(false);
    });

    it('detects "access failed" textual signal', () => {
      const result = classifyLoadBalancingProbeError('access failed for Load Balancing');
      expect(result?.available).toBe(false);
    });

    // Healthy: field-level errors mean LB IS available
    it('returns null for "expected_codes is required" (healthy LB)', () => {
      const result = classifyLoadBalancingProbeError('expected_codes is required: validation failed');
      expect(result).toBeNull();
    });

    it('returns null for "path is required" (healthy LB)', () => {
      const result = classifyLoadBalancingProbeError('path is required');
      expect(result).toBeNull();
    });

    // Healthy: real plan ceiling — Pro is [60, 3600] — DO NOT flag as broken
    it('returns null for "[60, 3600]" range (real Pro plan limit)', () => {
      const result = classifyLoadBalancingProbeError('interval is not in range [60, 3600]: validation failed');
      expect(result).toBeNull();
    });

    it('returns null for "[10, 3600]" range (real Enterprise limit)', () => {
      const result = classifyLoadBalancingProbeError('interval is not in range [10, 3600]: validation failed');
      expect(result).toBeNull();
    });

    // Degenerate but min != max: NOT flagged (different bug class, not entitlement)
    it('returns null for asymmetric degenerate range like "[0, 60]"', () => {
      const result = classifyLoadBalancingProbeError('interval is not in range [0, 60]');
      expect(result).toBeNull();
    });

    // Edge: empty / missing input
    it('returns null for empty error message', () => {
      expect(classifyLoadBalancingProbeError('')).toBeNull();
    });

    it('handles undefined-like input gracefully', () => {
      // @ts-expect-error — testing runtime robustness
      expect(classifyLoadBalancingProbeError(undefined)).toBeNull();
    });

    // Case-insensitivity
    it('matches range pattern case-insensitively', () => {
      const result = classifyLoadBalancingProbeError('Interval Is Not In Range [1, 1]: Validation Failed');
      expect(result?.available).toBe(false);
    });
  });

  describe('isTransientCertServiceError', () => {
    it('detects the exact cert-service backend error', () => {
      expect(isTransientCertServiceError('Error while requesting from certificate service')).toBe(true);
    });

    it('detects case-insensitively', () => {
      expect(isTransientCertServiceError('ERROR while requesting from CERTIFICATE service')).toBe(true);
    });

    it('detects "certificate service unavailable"', () => {
      expect(isTransientCertServiceError('certificate service unavailable')).toBe(true);
    });

    it('detects "certificate service timeout"', () => {
      expect(isTransientCertServiceError('certificate service timeout')).toBe(true);
    });

    it('returns false for real validation errors', () => {
      expect(isTransientCertServiceError('Validity can only be specified for dedicated certificates')).toBe(false);
      expect(isTransientCertServiceError('You must complete DCV before placing an order')).toBe(false);
    });

    it('returns false for unrelated errors', () => {
      expect(isTransientCertServiceError('rate limit exceeded')).toBe(false);
      expect(isTransientCertServiceError('zone not found')).toBe(false);
    });

    it('handles empty / null input gracefully', () => {
      expect(isTransientCertServiceError('')).toBe(false);
      // @ts-expect-error — runtime safety
      expect(isTransientCertServiceError(undefined)).toBe(false);
      // @ts-expect-error — runtime safety
      expect(isTransientCertServiceError(null)).toBe(false);
    });
  });

  // Regression: the Pages projects list endpoint rejects page/per_page with
  // "Invalid list options provided. Review the `page` or `per_page`
  // parameter." (found via e2e export against a live account). It must be
  // fetched WITHOUT pagination params.
  describe('delete builders encode dynamic path segments (F-2)', () => {
    it('encodeURIComponent-wraps a traversal-laden script name so it cannot escape the path', async () => {
      const calls: string[] = [];
      const orig = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL) => {
        calls.push(String(url));
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ success: true, result: {} }) } as unknown as Response;
      }) as typeof fetch;
      try {
        await deleteWorker('test-token', 'a'.repeat(32), '../../../zones/victim/settings');
      } finally {
        globalThis.fetch = orig;
      }
      expect(calls).toHaveLength(1);
      // The "/" and ".." are percent-encoded, so the URL keeps a single
      // workers/scripts/<segment> path — no traversal to /zones/...
      expect(calls[0]).toContain('/workers/scripts/..%2F..%2F..%2Fzones%2Fvictim%2Fsettings');
      expect(calls[0]).not.toContain('/zones/victim/settings');
    });

    it('leaves legitimate ids/names unchanged', async () => {
      const calls: string[] = [];
      const orig = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL) => {
        calls.push(String(url));
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ success: true, result: {} }) } as unknown as Response;
      }) as typeof fetch;
      try {
        await deleteZone('test-token', 'b'.repeat(32));
        await deleteWorker('test-token', 'a'.repeat(32), 'my-worker_name');
      } finally {
        globalThis.fetch = orig;
      }
      expect(calls[0]).toContain(`/zones/${'b'.repeat(32)}`);
      expect(calls[1]).toContain('/workers/scripts/my-worker_name');
    });
  });

  describe('listPagesProjects', () => {
    it('requests /pages/projects without page/per_page params', async () => {
      const calls: string[] = [];
      const orig = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL) => {
        calls.push(String(url));
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ success: true, result: [] }),
        } as unknown as Response;
      }) as typeof fetch;
      try {
        const result = await listPagesProjects('test-token', 'acct123');
        expect(result).toEqual([]);
      } finally {
        globalThis.fetch = orig;
      }
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('/accounts/acct123/pages/projects');
      expect(calls[0]).not.toMatch(/[?&]page=/);
      expect(calls[0]).not.toContain('per_page=');
    });
  });

  describe('createZone (preset new-zone provisioning)', () => {
    it('POSTs to /zones with the account id, name, and full type', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let captured: Record<string, unknown> = {};
      const orig = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedMethod = init?.method || 'GET';
        captured = init?.body ? JSON.parse(String(init.body)) : {};
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ success: true, result: { id: 'zone123', name: 'new.example.com', status: 'pending' } }),
        } as unknown as Response;
      }) as typeof fetch;
      let result;
      try {
        result = await createZone('test-token', 'acct123', 'new.example.com');
      } finally {
        globalThis.fetch = orig;
      }
      expect(capturedMethod).toBe('POST');
      expect(capturedUrl).toContain('/zones');
      expect(captured).toEqual({
        name: 'new.example.com',
        account: { id: 'acct123' },
        type: 'full',
      });
      expect(result).toEqual({ id: 'zone123', name: 'new.example.com', status: 'pending' });
    });
  });

  describe('createZoneWithDelegation (preset new-zone + NS delegation)', () => {
    // Route a mocked fetch by method+path to drive the create → (getZone) →
    // createDNSRecord orchestration, capturing the NS records POSTed to parent.
    function installMock(opts: {
      createNameServers?: string[];      // name_servers on the create response
      getNameServers?: string[];         // name_servers on the re-GET response
      dnsRecordStatus?: number;          // status for dns_records POSTs (default 200)
    }) {
      const calls = { create: 0, get: 0, dnsPosts: [] as Record<string, unknown>[] };
      const orig = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method || 'GET';
        if (method === 'POST' && /\/dns_records$/.test(u)) {
          calls.dnsPosts.push(init?.body ? JSON.parse(String(init.body)) : {});
          const status = opts.dnsRecordStatus ?? 200;
          return {
            ok: status >= 200 && status < 300,
            status,
            headers: new Headers(),
            json: async () => status >= 200 && status < 300
              ? { success: true, result: { id: `rec${calls.dnsPosts.length}` } }
              : { success: false, errors: [{ message: 'An identical record already exists' }] },
          } as unknown as Response;
        }
        if (method === 'POST' && /\/zones$/.test(u)) {
          calls.create++;
          return {
            ok: true, status: 200, headers: new Headers(),
            json: async () => ({ success: true, result: { id: 'zoneNEW', name: 'sub.parent.com', status: 'pending', name_servers: opts.createNameServers ?? [] } }),
          } as unknown as Response;
        }
        if (method === 'GET' && /\/zones\/zoneNEW$/.test(u)) {
          calls.get++;
          return {
            ok: true, status: 200, headers: new Headers(),
            json: async () => ({ success: true, result: { id: 'zoneNEW', name: 'sub.parent.com', status: 'pending', name_servers: opts.getNameServers ?? [] } }),
          } as unknown as Response;
        }
        throw new Error(`unexpected fetch ${method} ${u}`);
      }) as typeof fetch;
      return { calls, restore: () => { globalThis.fetch = orig; } };
    }

    it('delegates: creates one NS record per nameserver in the parent zone', async () => {
      const mock = installMock({ createNameServers: ['ns1.cf.com', 'ns2.cf.com'] });
      let result;
      try {
        result = await createZoneWithDelegation('test-token', 'acct123', 'sub.parent.com', 'parentZid');
      } finally { mock.restore(); }
      expect(mock.calls.create).toBe(1);
      expect(mock.calls.get).toBe(0); // name_servers present on create → no re-GET
      expect(mock.calls.dnsPosts).toEqual([
        { type: 'NS', name: 'sub.parent.com', content: 'ns1.cf.com', ttl: 3600 },
        { type: 'NS', name: 'sub.parent.com', content: 'ns2.cf.com', ttl: 3600 },
      ]);
      expect(result.delegated).toBe(true);
      expect(result.nameServers).toEqual(['ns1.cf.com', 'ns2.cf.com']);
      expect(result.delegationError).toBeUndefined();
    });

    it('re-GETs the zone when the create response has no nameservers', async () => {
      const mock = installMock({ createNameServers: [], getNameServers: ['ns1.cf.com'] });
      let result;
      try {
        result = await createZoneWithDelegation('test-token', 'acct123', 'sub.parent.com', 'parentZid');
      } finally { mock.restore(); }
      expect(mock.calls.get).toBe(1); // empty NS on create → re-GET
      expect(mock.calls.dnsPosts).toHaveLength(1);
      expect(result.delegated).toBe(true);
    });

    it('does NOT delegate when no parentZoneId is given', async () => {
      const mock = installMock({ createNameServers: ['ns1.cf.com'] });
      let result;
      try {
        result = await createZoneWithDelegation('test-token', 'acct123', 'apex.example.com');
      } finally { mock.restore(); }
      expect(mock.calls.dnsPosts).toHaveLength(0);
      expect(mock.calls.get).toBe(0);
      expect(result.delegated).toBe(false);
      expect(result.delegationError).toBeUndefined();
    });

    it('reports a non-fatal delegationError when no nameservers ever appear', async () => {
      const mock = installMock({ createNameServers: [], getNameServers: [] });
      let result;
      try {
        result = await createZoneWithDelegation('test-token', 'acct123', 'sub.parent.com', 'parentZid');
      } finally { mock.restore(); }
      expect(result.delegated).toBe(false);
      expect(mock.calls.dnsPosts).toHaveLength(0);
      expect(result.delegationError).toMatch(/not available/i);
    });

    it('captures a delegationError when NS record creation fails (zone still created)', async () => {
      const mock = installMock({ createNameServers: ['ns1.cf.com'], dnsRecordStatus: 400 });
      let result;
      try {
        result = await createZoneWithDelegation('test-token', 'acct123', 'sub.parent.com', 'parentZid');
      } finally { mock.restore(); }
      expect(result.zone.id).toBe('zoneNEW'); // creation succeeded
      expect(result.delegated).toBe(false);
      expect(result.delegationError).toBeTruthy();
    });
  });

  describe('createAiGatewayProviderConfig (B6)', () => {
    it('sends the real provider-config fields, not the bogus provider/settings', async () => {
      // Regression: the create body used {provider, settings} which the API
      // does not accept, so the POST body was effectively empty → "Required".
      // The correct fields are alias/default_config/provider_slug/secret/secret_id.
      let captured: Record<string, unknown> = {};
      const orig = globalThis.fetch;
      globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
        captured = init?.body ? JSON.parse(String(init.body)) : {};
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ success: true, result: { id: 'pc1' } }),
        } as unknown as Response;
      }) as typeof fetch;
      try {
        await createAiGatewayProviderConfig('test-token', 'acct123', 'my-gateway', {
          alias: 'primary-openai',
          default_config: true,
          provider_slug: 'openai',
          secret: 'sk-xyz',
          secret_id: 'sec_abc',
          rate_limit: 100,
          rate_limit_period: 60,
        });
      } finally {
        globalThis.fetch = orig;
      }
      expect(captured).toEqual({
        alias: 'primary-openai',
        default_config: true,
        provider_slug: 'openai',
        secret: 'sk-xyz',
        secret_id: 'sec_abc',
        rate_limit: 100,
        rate_limit_period: 60,
      });
      // The old, wrong field names must NOT be present.
      expect(captured).not.toHaveProperty('provider');
      expect(captured).not.toHaveProperty('settings');
    });
  });

  // Regression (S1): the bare empty-envelope response ({success:false, no
  // errors[], no messages[]}) that an unprovisioned/unentitled feature
  // returns must throw a TAGGED EmptyEnvelopeError carrying the HTTP status —
  // so callers can distinguish a 4xx entitlement gap (acknowledge) from a
  // 5xx/transient failure (must stay failed), instead of substring-matching
  // the generic "API request failed" string (which also matches the
  // retry-exhaustion message and would mask real outages).
  //
  // HTTP 401 is classified as credential rejection before envelope handling.
  // Other empty 4xx envelopes remain tagged so callers can distinguish
  // entitlement gaps from populated rejects and server failures.
  describe('EmptyEnvelopeError (S1)', () => {
    for (const status of [400, 403, 404]) {
      it(`cfFetch throws a tagged EmptyEnvelopeError (status ${status}) on a ${status} empty envelope`, async () => {
        const orig = globalThis.fetch;
        globalThis.fetch = (async () => ({
          ok: false,
          status,
          headers: new Headers(),
          json: async () => ({ success: false, errors: [], messages: [] }),
        } as unknown as Response)) as typeof fetch;
        let caught: unknown;
        try {
          await createAiGatewayProviderConfig('test-token', 'acct123', 'gw1', { alias: 'x' });
        } catch (e) {
          caught = e;
        } finally {
          globalThis.fetch = orig;
        }
        expect(caught).toBeInstanceOf(EmptyEnvelopeError);
        expect((caught as EmptyEnvelopeError)._tag).toBe('EmptyEnvelopeError');
        expect((caught as EmptyEnvelopeError).status).toBe(status);
        expect((caught as Error).message).toBe('API request failed'); // preserved for report display
        // Consumer gate: every 4xx empty envelope is acknowledged.
        expect((caught as EmptyEnvelopeError).status < 500).toBe(true);
      });
    }

    it('does NOT tag a populated 4xx reject as an empty envelope (it stays a plain Error → failed)', async () => {
      // Live shape: incoming + bad peer → HTTP 400 with a specific errors[]
      // message. errors[] is non-empty, so this is a real failure, not an
      // entitlement gap — must NOT become an EmptyEnvelopeError.
      const orig = globalThis.fetch;
      globalThis.fetch = (async () => ({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({ success: false, errors: [{ code: 400, message: 'Did not find peer 0000' }], messages: [] }),
      } as unknown as Response)) as typeof fetch;
      let caught: unknown;
      try {
        await createAiGatewayProviderConfig('test-token', 'acct123', 'gw1', { alias: 'x' });
      } catch (e) {
        caught = e;
      } finally {
        globalThis.fetch = orig;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(EmptyEnvelopeError);
      expect((caught as Error).message).toBe('Did not find peer 0000');
    });

    it('a 5xx instance is excluded by the consumer "status < 500" entitlement gate', () => {
      // The zone-extras acknowledge path keys on `e.status < 500`, so a
      // server-side empty envelope (5xx) is NOT acknowledged — it stays failed.
      expect(new EmptyEnvelopeError('/x', 503).status < 500).toBe(false);
      expect(new EmptyEnvelopeError('/x', 500).status < 500).toBe(false);
    });
  });

  // Regression (#10): managed API Shield labels must be excluded from export.
  // The list endpoint returns both user and managed labels; POSTing a managed
  // label to the user-label endpoint always fails, so any managed marker —
  // the SDK `source:'managed'` field, a legacy `managed` boolean, or the
  // reserved `cf-` name prefix — must filter the label out.
  describe('listApiGatewayUserLabels managed-label filtering', () => {
    it('keeps user labels and drops managed ones by source / managed flag / cf- prefix', async () => {
      const orig = globalThis.fetch;
      globalThis.fetch = (async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          success: true,
          result: [
            { label_id: '1', name: 'team-a', source: 'user' },
            { label_id: '2', name: 'managed-by-source', source: 'managed' },
            { label_id: '3', name: 'legacy-managed', managed: true },
            { label_id: '4', name: 'cf-managed-thing' },
            { label_id: '5', name: 'team-b' },
          ],
        }),
      } as unknown as Response)) as typeof fetch;
      try {
        const labels = await listApiGatewayUserLabels('test-token', 'zone123');
        expect(labels.map(l => l.name).sort()).toEqual(['team-a', 'team-b']);
      } finally {
        globalThis.fetch = orig;
      }
    });
  });

  // Auth-error humanization. The raw Cloudflare envelopes below are LIVE-
  // VERIFIED against api.cloudflare.com/client/v4 (2026-06): a bad token, a
  // bad Global API Key, and a bad email ALL surface the same useless generic
  // top-level "Invalid request headers" (code 6003) — the real cause is only
  // in error_chain. humanizeAuthError must translate each into a clear,
  // auth-mode-correct message so the user knows what to fix.
  describe('humanizeAuthError', () => {
    // ── token mode ──────────────────────────────────────────────
    it('token: malformed (6003 → chain 6111) → "Invalid API token … malformed"', () => {
      const msg = humanizeAuthError(
        [{ code: 6003, message: 'Invalid request headers', error_chain: [{ code: 6111, message: 'Invalid format for Authorization header' }] }],
        'token',
      );
      expect(msg).toMatch(/invalid api token/i);
      expect(msg).toMatch(/malformed/i);
      expect(msg).toMatch(/API Tokens/);
      expect(msg).not.toMatch(/invalid request headers/i); // jargon gone
    });

    it('token: wrong value on /accounts (9109 "Invalid access token") → rejected/expired/revoked', () => {
      const msg = humanizeAuthError([{ code: 9109, message: 'Invalid access token' }], 'token');
      expect(msg).toMatch(/invalid api token/i);
      expect(msg).toMatch(/incorrect, expired, or revoked/i);
    });

    it('token: wrong value on /user/tokens/verify (1000 "Invalid API Token")', () => {
      const msg = humanizeAuthError([{ code: 1000, message: 'Invalid API Token' }], 'token');
      expect(msg).toMatch(/invalid api token/i);
      expect(msg).toMatch(/incorrect, expired, or revoked/i);
    });

    // ── key mode ────────────────────────────────────────────────
    it('key: malformed key (6003 → chain 6103) → "Invalid API key … malformed"', () => {
      const msg = humanizeAuthError(
        [{ code: 6003, message: 'Invalid request headers', error_chain: [{ code: 6103, message: 'Invalid format for X-Auth-Key header' }] }],
        'key',
      );
      expect(msg).toMatch(/invalid api key/i);
      expect(msg).toMatch(/malformed/i);
      expect(msg).toMatch(/Global API Key/);
    });

    it('key: malformed email (6003 → chain 6102) → "Invalid account email"', () => {
      const msg = humanizeAuthError(
        [{ code: 6003, message: 'Invalid request headers', error_chain: [{ code: 6102, message: 'Invalid format for X-Auth-Email header' }] }],
        'key',
      );
      expect(msg).toMatch(/invalid account email/i);
    });

    it('key: malformed email AND key (chain 6102 + 6103) → names both', () => {
      const msg = humanizeAuthError(
        [{ code: 6003, message: 'Invalid request headers', error_chain: [{ code: 6102, message: '…' }, { code: 6103, message: '…' }] }],
        'key',
      );
      expect(msg).toMatch(/email/i);
      expect(msg).toMatch(/api key/i);
    });

    it('key: wrong key/email (9103 "Unknown X-Auth-Key or X-Auth-Email") → "Invalid API key or email"', () => {
      const msg = humanizeAuthError([{ code: 9103, message: 'Unknown X-Auth-Key or X-Auth-Email' }], 'key');
      expect(msg).toMatch(/invalid api key or email/i);
      expect(msg).not.toMatch(/X-Auth/); // header jargon gone
    });

    it('key: missing email (9106) and missing key (9107)', () => {
      expect(humanizeAuthError([{ code: 9106, message: 'Missing X-Auth-Email header' }], 'key')).toMatch(/missing account email/i);
      expect(humanizeAuthError([{ code: 9107, message: 'Missing X-Auth-Key header' }], 'key')).toMatch(/missing api key/i);
    });

    // ── non-auth / edge cases ───────────────────────────────────
    it('returns null for a non-auth error (so the raw message is used)', () => {
      expect(humanizeAuthError([{ code: 81057, message: 'Record already exists.' }], 'token')).toBeNull();
      expect(humanizeAuthError([{ code: 81057, message: 'Record already exists.' }], 'key')).toBeNull();
    });

    it('returns null for empty / missing errors', () => {
      expect(humanizeAuthError([], 'token')).toBeNull();
      expect(humanizeAuthError(undefined, 'key')).toBeNull();
      expect(humanizeAuthError([{ message: 'no code here' }], 'token')).toBeNull();
    });
  });

  // End-to-end through the fetch layer: a malformed-token / bad-key envelope
  // must throw a tagged AuthError carrying the humanized message — NOT the
  // raw "Invalid request headers" the user was previously shown.
  describe('cfFetch / cfFetchAll surface AuthError (not raw CF jargon)', () => {
    function mockFetch(envelope: unknown, status = 400) {
      globalThis.fetch = (async () => ({
        ok: false,
        status,
        headers: new Headers(),
        json: async () => envelope,
      } as unknown as Response)) as typeof fetch;
    }

    const TOKEN_MALFORMED = { success: false, messages: [], result: null, errors: [{ code: 6003, message: 'Invalid request headers', error_chain: [{ code: 6111, message: 'Invalid format for Authorization header' }] }] };
    const KEY_MALFORMED = { success: false, messages: [], result: null, errors: [{ code: 6003, message: 'Invalid request headers', error_chain: [{ code: 6103, message: 'Invalid format for X-Auth-Key header' }] }] };
    const KEY_UNKNOWN = { success: false, messages: [], result: null, errors: [{ code: 9103, message: 'Unknown X-Auth-Key or X-Auth-Email' }] };

    let orig: typeof fetch;
    beforeEach(() => { orig = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = orig; });

    it('cfFetch (token auth) throws AuthError with humanized token message', async () => {
      mockFetch(TOKEN_MALFORMED);
      let caught: unknown;
      try {
        await getZone({ type: 'token', token: 'bad' }, 'a'.repeat(32));
      } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(AuthError);
      expect((caught as Error).message).toMatch(/invalid api token/i);
      expect((caught as Error).message).not.toMatch(/invalid request headers/i);
    });

    it('cfFetch (key auth) throws AuthError with humanized key message', async () => {
      mockFetch(KEY_MALFORMED);
      let caught: unknown;
      try {
        await getZone({ type: 'key', apiKey: 'bad', email: 'x@y.z' }, 'a'.repeat(32));
      } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(AuthError);
      expect((caught as Error).message).toMatch(/invalid api key/i);
    });

    it('cfFetchAll (listAccounts) throws AuthError on an unknown key/email (9103)', async () => {
      mockFetch(KEY_UNKNOWN);
      let caught: unknown;
      try {
        await listAccounts({ type: 'key', apiKey: 'invalid-test-key', email: 'x@y.z' });
      } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(AuthError);
      expect((caught as Error).message).toMatch(/invalid api key or email/i);
    });

    it('cfFetch classifies an empty HTTP 401 envelope before empty-envelope handling', async () => {
      globalThis.fetch = (async () => new Response(JSON.stringify({
        success: false, result: null, errors: [], messages: [],
      }), { status: 401, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

      const request = getZone('expired-token', 'a'.repeat(32));

      await expect(request).rejects.toSatisfy(
        (error: unknown) => error instanceof AuthError && error.matchesBearer('expired-token'),
      );
    });

    it('cfFetch classifies a non-JSON HTTP 401 before body parsing', async () => {
      globalThis.fetch = (async () => new Response('Unauthorized', { status: 401 })) as typeof fetch;

      const request = getZone('expired-token', 'a'.repeat(32));

      await expect(request).rejects.toSatisfy(
        (error: unknown) => error instanceof AuthError && error.matchesBearer('expired-token'),
      );
    });

    it('cfFetchAll classifies a status-only HTTP 401 before pagination parsing', async () => {
      globalThis.fetch = (async () => new Response('', { status: 401 })) as typeof fetch;

      const request = listAccounts('expired-token');

      await expect(request).rejects.toSatisfy(
        (error: unknown) => error instanceof AuthError && error.matchesBearer('expired-token'),
      );
    });

    it.each([
      ['cfFetch', () => getZone('expired-token', 'a'.repeat(32))],
      ['cfFetchAll', () => listAccounts('expired-token')],
    ])('%s preserves code 9109 as a token-bound AuthError', async (_name, request) => {
      globalThis.fetch = (async () => new Response(JSON.stringify({
        success: false,
        result: null,
        errors: [{ code: 9109, message: 'Invalid access token' }],
      }), { status: 403, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

      await expect(request()).rejects.toSatisfy(
        (error: unknown) => error instanceof AuthError && error.matchesBearer('expired-token'),
      );
    });
  });

  describe('raw Cloudflare responses surface AuthError', () => {
    const token = 'expired-token';
    let orig: typeof fetch;

    beforeEach(() => { orig = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = orig; });

    it('classifies an HTTP 401 before reading a Worker script body', async () => {
      globalThis.fetch = (async () => new Response('Unauthorized', { status: 401 })) as typeof fetch;

      const request = getWorkerScriptBundle(token, 'account-id', 'worker-name');

      await expect(request).rejects.toSatisfy(
        (error: unknown) => error instanceof AuthError && error.matchesBearer(token),
      );
    });

    it('does not clone and JSON-parse successful raw Worker script bodies', async () => {
      const response = new Response('export default { fetch() {} }', {
        status: 200,
        headers: { 'Content-Type': 'application/javascript' },
      });
      const clone = vi.spyOn(response, 'clone');
      globalThis.fetch = (async () => response) as typeof fetch;

      await expect(getWorkerScriptBundle(token, 'account-id', 'worker-name')).resolves.toMatchObject({
        format: 'service_worker',
      });
      expect(clone).not.toHaveBeenCalled();
    });

    it('classifies code 9109 before accepting a raw KV write response', async () => {
      globalThis.fetch = (async () => new Response(JSON.stringify({
        success: false,
        result: null,
        errors: [{ code: 9109, message: 'Invalid access token' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

      const request = putKVValue(token, 'account-id', 'namespace-id', 'key', 'value');

      await expect(request).rejects.toSatisfy(
        (error: unknown) => error instanceof AuthError && error.matchesBearer(token),
      );
    });

    it('classifies code 9109 before returning a raw API envelope', async () => {
      globalThis.fetch = (async () => new Response(JSON.stringify({
        success: false,
        result: null,
        errors: [{ code: 9109, message: 'Invalid access token' }],
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

      const request = cfRequestEnvelope(token, '/zones');

      await expect(request).rejects.toSatisfy(
        (error: unknown) => error instanceof AuthError && error.matchesBearer(token),
      );
    });
  });

  // Regression (#8): R2 custom-domain attach must NOT forward the exported
  // (source-account) zoneId to the destination account — that id is invalid
  // there. Cloudflare resolves the owning zone from the domain instead.
  describe('addR2BucketCustomDomain', () => {
    it('omits the source zoneId from the attach body', async () => {
      let captured: Record<string, unknown> = {};
      const orig = globalThis.fetch;
      globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
        captured = init?.body ? JSON.parse(String(init.body)) : {};
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ success: true, result: {} }),
        } as unknown as Response;
      }) as typeof fetch;
      try {
        await addR2BucketCustomDomain('test-token', 'destAcct', 'my-bucket', {
          domain: 'cdn.example.com',
          enabled: true,
          zoneId: 'SOURCE_ZONE_ID',
          minTLS: '1.2',
        });
      } finally {
        globalThis.fetch = orig;
      }
      expect(captured.domain).toBe('cdn.example.com');
      expect(captured.enabled).toBe(true);
      expect(captured.minTLS).toBe('1.2');
      expect(captured).not.toHaveProperty('zoneId');
    });
  });

  // Regression for e2e run 2026-06-08 #001/#002: AI Gateway custom provider
  // `maxconfig-aig-custom-provider` landed as a FAILED row with "Expected
  // string, received null". The list endpoint returns optional fields as null
  // when unset; CF's create schema rejects an explicit null for a typed field.
  // createAiGatewayCustomProvider must strip null/undefined (and the
  // server-generated read-only fields) before POST.
  describe('createAiGatewayCustomProvider strips null/undefined + read-only fields', () => {
    it('omits null/undefined-valued fields so CF schema validation passes', async () => {
      let captured: Record<string, unknown> = {};
      const orig = globalThis.fetch;
      globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
        captured = init?.body ? JSON.parse(String(init.body)) : {};
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ success: true, result: {} }),
        } as unknown as Response;
      }) as typeof fetch;
      try {
        await createAiGatewayCustomProvider('test-token', 'destAcct', {
          name: 'Custom Provider Test',
          slug: 'maxconfig-aig-custom-provider',
          base_url: 'https://api.custom-ai-provider.test',
          // Read-only / server-generated fields that come back on GET:
          id: 'src-id-123',
          logo: 'https://logos.example/p.png',
          // Optional field the list endpoint returned as null:
          description: null as unknown as string,
        });
      } finally {
        globalThis.fetch = orig;
      }
      // Writable fields survive.
      expect(captured.name).toBe('Custom Provider Test');
      expect(captured.slug).toBe('maxconfig-aig-custom-provider');
      expect(captured.base_url).toBe('https://api.custom-ai-provider.test');
      // The explicit null is stripped (root cause of "Expected string, received null").
      expect(captured).not.toHaveProperty('description');
      // Read-only/server-generated fields are stripped.
      expect(captured).not.toHaveProperty('id');
      expect(captured).not.toHaveProperty('logo');
    });
  });
});
