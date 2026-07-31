import { readFileSync } from 'node:fs';

import { afterEach, describe, it, expect, vi } from 'vitest';
import { ZONE_SETTINGS, ZONE_API_ENDPOINTS, MAXIMUM_CONFIG_RULES, summarizePresetReports, countAlreadyPresent, countAcknowledged, curatedSettingsAbsentFromAggregate, shouldSkipMaxConfigSetting, fuzzAuthenticatedFetch } from '../src/fuzz';
import { createMaximumConfig } from '../src/fuzz';
import * as api from '../src/api';
import { ENTERPRISE_GATED_ZONE_SETTINGS } from '../src/types';

function responseForMaxConfigUrl(url: string): Record<string, unknown> {
  if (url.includes('/rulesets/phases/')) {
    return { success: true, result: { id: 'ruleset-id', rules: [{ id: 'rule-id-1' }, { id: 'rule-id-2' }, { id: 'rule-id-3' }] } };
  }
  if (url.includes('/rulesets')) {
    return { success: true, result: [] };
  }
  if (url.includes('/snippets/snippet_rules')) {
    return { success: true, result: { rules: [] } };
  }
  if (url.includes('/zones/zone-id/dns_records?')) {
    return { success: true, result: [] };
  }
  if (url.includes('/zones/zone-id/dns_records')) {
    return { success: true, result: { id: 'dns-id' } };
  }
  return { success: true, result: { id: 'resource-id', rules: [], enabled: true } };
}

describe('fuzz.ts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('authenticated raw fetch propagation', () => {
    it.each([
      ['bare HTTP 401', new Response('', { status: 401 })],
      ['Cloudflare code 9109', new Response(JSON.stringify({
        success: false,
        errors: [{ code: 9109, message: 'Invalid access token' }],
      }), { status: 403, headers: { 'Content-Type': 'application/json' } })],
    ])('throws a token-bound AuthError for %s', async (_name, response) => {
      vi.stubGlobal('fetch', vi.fn(async () => response));

      await expect(fuzzAuthenticatedFetch('expired-token', 'https://api.cloudflare.com/client/v4/zones')).rejects.toSatisfy(
        (error: unknown) => error instanceof api.AuthError && error.matchesBearer('expired-token'),
      );
    });

    it('routes every MaxConfig raw fetch scope through the authenticated wrapper', () => {
      const fuzzSource = readFileSync(new URL('../src/fuzz.ts', import.meta.url), 'utf8');
      expect(fuzzSource.match(/const fetch = createFuzzFetch\(auth\);/g)).toHaveLength(3);
    });

    it('rethrows AuthError before every broad fuzz catch handles ordinary failures', () => {
      const fuzzSource = readFileSync(new URL('../src/fuzz.ts', import.meta.url), 'utf8');
      const broadCatches = [...fuzzSource.matchAll(/catch \(e(?:: unknown)?\) \{\s*([^\n]+)/g)];
      const nonPropagating = broadCatches
        .filter(([, firstStatement]) => !firstStatement.trim().startsWith('api.throwIfAuthError(e);'))
        .map(match => fuzzSource.slice(0, match.index).split('\n').length);
      expect(nonPropagating).toEqual([]);
    });
  });

  describe('curatedSettingsAbsentFromAggregate (dedicated-endpoint fallback)', () => {
    it('returns curated settings whose IDs are absent from the aggregate GET', () => {
      // Simulate a real aggregate GET that omits the dedicated-endpoint settings
      // (verified absent across all 17 captured fixtures).
      const aggregate = new Set(ZONE_SETTINGS.map(s => s.id).filter(id =>
        !['speed_brain', 'fonts', 'origin_max_http_version', 'ssl_automatic_mode', 'origin_h2_max_streams', 'rum', 'csam_scanner_third_party'].includes(id),
      ));
      const absent = curatedSettingsAbsentFromAggregate(aggregate).map(s => s.id);
      for (const id of ['speed_brain', 'fonts', 'origin_max_http_version', 'ssl_automatic_mode', 'origin_h2_max_streams', 'rum', 'csam_scanner_third_party']) {
        expect(absent).toContain(id);
      }
    });

    it('excludes settings already present in the aggregate GET', () => {
      const aggregate = new Set(ZONE_SETTINGS.map(s => s.id)); // everything present
      expect(curatedSettingsAbsentFromAggregate(aggregate)).toHaveLength(0);
    });

    it('the three previously-dead curated settings are in the curated catalog', () => {
      const ids = new Set(ZONE_SETTINGS.map(s => s.id));
      // Regression: these were curated but never applied (not in aggregate GET).
      expect(ids.has('speed_brain')).toBe(true);
      expect(ids.has('fonts')).toBe(true);
      expect(ids.has('origin_max_http_version')).toBe(true);
      // Newly added dedicated-endpoint settings (verified value shapes).
      expect(ids.has('ssl_automatic_mode')).toBe(true);
      expect(ids.has('origin_h2_max_streams')).toBe(true);
      // `rum` value shape verified live (2026-06-02): plain on/off string.
      expect(ids.has('rum')).toBe(true);
      // CSAM Scanner: dedicated-only setting flagged by the spec-drift monitor
      // (2026-06-06). Absent from the aggregate GET, so it was being silently
      // dropped until added to the curated catalog. Regression guard.
      expect(ids.has('csam_scanner_third_party')).toBe(true);
    });

    it('excludes known read-only/internal/unsupported settings from dedicated fallback', () => {
      const aggregate = new Set(ZONE_SETTINGS.map(s => s.id).filter(id =>
        !['origin_dns_name', 'sha1_support'].includes(id),
      ));
      const absent = curatedSettingsAbsentFromAggregate(aggregate).map(s => s.id);
      expect(absent).not.toContain('origin_dns_name');
      expect(absent).not.toContain('sha1_support');
    });
  });

  describe('shouldSkipMaxConfigSetting', () => {
    it('skips settings that the API reports editable but rejects as internal/read-only', () => {
      for (const id of [
        'filter_logs_to_cloudflare',
        'log_to_cloudflare',
        'orange_to_orange',
        'tls_1_2_only',
        'visitor_ip',
        'sha1_support',
        'origin_dns_name',
        'nel',
      ]) {
        expect(shouldSkipMaxConfigSetting(id), id).toBe(true);
      }
    });

    it('does not skip ordinary editable settings', () => {
      for (const id of ['ssl', 'http3', 'browser_cache_ttl']) {
        expect(shouldSkipMaxConfigSetting(id), id).toBe(false);
      }
    });
  });

  describe('countAlreadyPresent (shared conflict classifier, #15 dec 3)', () => {
    it('flags conflict failures and returns the count, leaving genuine failures alone', () => {
      const results = [
        { success: true },
        { success: false, error: 'An identical record already exists.' },
        { success: false, error: 'workers.api.error.duplicate_of_existing' },
        { success: false, error: 'Internal server error' },
      ];
      const n = countAlreadyPresent(results);
      expect(n).toBe(2);
      expect(results[1].alreadyPresent).toBe(true);
      expect(results[2].alreadyPresent).toBe(true);
      expect((results[3] as { alreadyPresent?: boolean }).alreadyPresent).toBeUndefined();
    });

    it('never touches successes and tolerates missing error strings', () => {
      const results = [{ success: true }, { success: false }];
      expect(countAlreadyPresent(results)).toBe(0);
      expect((results[0] as { alreadyPresent?: boolean }).alreadyPresent).toBeUndefined();
    });

    it('does not match genuine "already in use" failures (name-scoped, not blind substring)', () => {
      // isConflictError must not swallow real errors like IP-in-use.
      const results = [{ success: false, error: 'IP address already in use by another account' }];
      const n = countAlreadyPresent(results);
      // This is intentionally asserting isConflictError's guard: if it ever
      // starts matching this string, the count would be 1 and this fails.
      expect(n).toBe(0);
    });
  });

  describe('summarizePresetReports', () => {
    it('folds settings + rules + api counters into one summary', () => {
      const out = summarizePresetReports([
        { zoneName: 'example.com', timestamp: '2026-01-01T00:00:00Z', totalTests: 10, successful: 8, failed: 2 },
        { totalRules: 5, successful: 5, failed: 0 },
        { totalTests: 4, successful: 1, failed: 0, alreadyPresent: 3 },
      ]);
      expect(out.summary.total).toBe(19); // 10 + 5 + 4
      expect(out.summary.success).toBe(17); // 8 + 5 + (1 + 3 alreadyPresent)
      expect(out.summary.failed).toBe(2);
      expect(out.summary.skipped).toBe(0);
    });

    it('counts alreadyPresent as success, never as failure (Principle 1)', () => {
      const out = summarizePresetReports([
        { totalTests: 6, successful: 0, failed: 0, alreadyPresent: 6 },
      ]);
      expect(out.summary.success).toBe(6);
      expect(out.summary.failed).toBe(0);
    });

    it('derives header zone + timestamp from the first report that has them', () => {
      const out = summarizePresetReports([
        undefined,
        { zoneName: 'z.example', timestamp: '2026-02-02T00:00:00Z', totalRules: 1, successful: 1, failed: 0 },
      ]);
      expect(out.sourceZone).toBe('z.example');
      expect(out.destZone).toBe('z.example');
      expect(out.timestamp).toBe('2026-02-02T00:00:00Z');
    });

    it('tolerates null/undefined/empty reports without throwing', () => {
      const out = summarizePresetReports([null, undefined]);
      expect(out.summary).toEqual({ total: 0, success: 0, failed: 0, skipped: 0, acknowledged: 0 });
      expect(out.sourceZone).toBe('');
      expect(typeof out.timestamp).toBe('string'); // falls back to now()
    });

    it('folds acknowledged (plan/entitlement) into skipped + acknowledged, never failed', () => {
      const out = summarizePresetReports([
        { totalRules: 10, successful: 4, failed: 1, acknowledged: 5 },
        { totalTests: 3, successful: 1, failed: 0, acknowledged: 2 },
      ]);
      expect(out.summary.success).toBe(5); // 4 + 1
      expect(out.summary.failed).toBe(1); // genuine failures only
      expect(out.summary.acknowledged).toBe(7); // 5 + 2 entitlement gaps
      expect(out.summary.skipped).toBe(7); // acknowledged surfaced under skipped
    });
  });

  describe('countAcknowledged (plan/entitlement reclassifier, mirrors countAlreadyPresent)', () => {
    it('flags entitlement/plan/zone-state gaps and leaves genuine failures alone', () => {
      const results = [
        { success: true },
        { success: false, error: 'Access denied.' },                        // Enterprise setting on lower tier
        { success: false, error: 'not entitled to use the Origin Host override' },
        { success: false, error: 'Active zone required' },
        { success: false, error: 'snippets are not allowed' },
        { success: false, error: 'zonelockdown.api.not_entitled.max_rules' },
        { success: false, error: 'Unable to purge. Unauthorized.' },
        { success: false, error: 'Internal server error' },                 // genuine failure
        { success: false, error: 'invalid JSON: unknown field "enabled"' },  // genuine payload bug
      ];
      const n = countAcknowledged(results);
      expect(n).toBe(6);
      expect((results[7] as { acknowledged?: boolean }).acknowledged).toBeUndefined();
      expect((results[8] as { acknowledged?: boolean }).acknowledged).toBeUndefined();
    });

    it('does not double-flag results already marked alreadyPresent', () => {
      const results = [
        { success: false, error: 'not entitled', alreadyPresent: true },
      ];
      expect(countAcknowledged(results)).toBe(0);
      expect((results[0] as { acknowledged?: boolean }).acknowledged).toBeUndefined();
    });

    it('never touches successes', () => {
      const results = [{ success: true }, { success: true, error: '' }];
      expect(countAcknowledged(results)).toBe(0);
    });
  });

  describe('ZONE_SETTINGS', () => {
    it('has settings defined', () => {
      expect(ZONE_SETTINGS.length).toBeGreaterThan(0);
    });

    it('all settings have required fields', () => {
      for (const setting of ZONE_SETTINGS) {
        expect(setting.id).toBeDefined();
        expect(setting.description).toBeDefined();
        expect(setting.type).toBeDefined();
        expect(setting.testValues).toBeDefined();
        expect(setting.testValues.length).toBeGreaterThan(0);
      }
    });

    it('on_off settings have valid test values', () => {
      const onOffSettings = ZONE_SETTINGS.filter(s => s.type === 'on_off');
      expect(onOffSettings.length).toBeGreaterThan(0);
      
      for (const setting of onOffSettings) {
        for (const value of setting.testValues) {
          expect(['on', 'off', 'zrt', 'custom']).toContain(value);
        }
      }
    });

    it('includes common settings', () => {
      const settingIds = ZONE_SETTINGS.map(s => s.id);
      expect(settingIds).toContain('ssl');
      expect(settingIds).toContain('always_use_https');
      expect(settingIds).toContain('http3');
      expect(settingIds).toContain('min_tls_version');
    });

    it('marks deprecated settings', () => {
      const wafSetting = ZONE_SETTINGS.find(s => s.id === 'waf');
      expect(wafSetting?.deprecated).toBe(true);
    });

    it('marks enterprise settings with planRequired', () => {
      const enterpriseSettings = ZONE_SETTINGS.filter(s => s.planRequired === 'enterprise');
      expect(enterpriseSettings.length).toBeGreaterThan(0);
      
      const enterpriseSettingIds = enterpriseSettings.map(s => s.id);
      expect(enterpriseSettingIds).toContain('origin_error_page_pass_thru');
      expect(enterpriseSettingIds).toContain('tls_client_auth');
    });

    // Drift guard: ENTERPRISE_GATED_ZONE_SETTINGS (src/types.ts) is a hand-
    // maintained copy of the enterprise-gated ids so the client bundle
    // doesn't import the whole fuzz catalogue. It MUST match fuzz.ts exactly
    // — the Step 2 enterprise acknowledgment gate keys off it.
    it('ENTERPRISE_GATED_ZONE_SETTINGS matches fuzz.ts planRequired:enterprise set', () => {
      const fromFuzz = ZONE_SETTINGS
        .filter(s => s.planRequired === 'enterprise')
        .map(s => s.id)
        .sort();
      const fromTypes = [...ENTERPRISE_GATED_ZONE_SETTINGS].sort();
      expect(fromTypes).toEqual(fromFuzz);
    });
  });

  describe('ZONE_API_ENDPOINTS', () => {
    it('has endpoints defined', () => {
      expect(ZONE_API_ENDPOINTS.length).toBeGreaterThan(0);
    });

    it('all endpoints have required fields', () => {
      for (const endpoint of ZONE_API_ENDPOINTS) {
        expect(endpoint.name).toBeDefined();
        expect(endpoint.method).toBeDefined();
        expect(endpoint.path).toBeDefined();
        expect(endpoint.description).toBeDefined();
        expect(endpoint.testPayloads).toBeDefined();
        expect(endpoint.testPayloads.length).toBeGreaterThan(0);
      }
    });

    it('includes DNS record endpoints', () => {
      const dnsEndpoints = ZONE_API_ENDPOINTS.filter(e => e.path.includes('dns_records'));
      expect(dnsEndpoints.length).toBeGreaterThan(0);
    });

    it('includes page rules endpoint', () => {
      const pageRulesEndpoint = ZONE_API_ENDPOINTS.find(e => e.path.includes('pagerules'));
      expect(pageRulesEndpoint).toBeDefined();
      expect(pageRulesEndpoint?.method).toBe('POST');
    });

    it('does not include legacy write endpoints that are rejected in MaxConfig runs', () => {
      const paths = ZONE_API_ENDPOINTS.map(e => e.path);
      expect(paths).not.toContain('/zones/{zone_id}/firewall/rules');
      expect(paths).not.toContain('/zones/{zone_id}/rate_limits');
    });

    it('all paths contain zone_id or account_id placeholder', () => {
      // ZONE_API_ENDPOINTS may contain a few account-scoped paths (e.g. Turnstile
      // widgets) that MaxConfig creates alongside zone resources. Every entry
      // must still be parameterised by either zone_id or account_id so the
      // codegen pass can substitute IDs cleanly.
      for (const endpoint of ZONE_API_ENDPOINTS) {
        const hasZoneOrAccount = endpoint.path.includes('{zone_id}') || endpoint.path.includes('{account_id}');
        expect(hasZoneOrAccount, `endpoint ${endpoint.name} (${endpoint.path}) must be parameterised`).toBe(true);
      }
    });

    it('DNS test payloads cover the standard record types', () => {
      // MaxConfig intentionally covers the full Cloudflare DNS surface
      // (LOC/SRV/URI/NAPTR/CAA/SSHFP/TLSA/SMIMEA/OPENPGPKEY/HTTPS/SVCB) in
      // addition to the common A/AAAA/CNAME/TXT/MX set. Assert membership in
      // the broader Cloudflare-supported set so this stays honest as new
      // edge-case types are added.
      const VALID_DNS_TYPES = new Set([
        'A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'PTR', 'SOA',
        'LOC', 'SRV', 'URI', 'NAPTR', 'CAA', 'CERT', 'DNSKEY', 'DS',
        'SSHFP', 'TLSA', 'SMIMEA', 'OPENPGPKEY', 'HTTPS', 'SVCB',
      ]);
      const dnsEndpoints = ZONE_API_ENDPOINTS.filter(e => e.name.includes('DNS'));
      for (const endpoint of dnsEndpoints) {
        for (const payload of endpoint.testPayloads) {
          expect(VALID_DNS_TYPES, `DNS payload type ${String(payload.type)} on ${endpoint.name}`).toContain(payload.type);
        }
      }
    });
  });

  describe('MAXIMUM_CONFIG_RULES', () => {
    it('does not require Bot Management fields to create baseline custom rules', () => {
      const expressions = MAXIMUM_CONFIG_RULES.map(rule => rule.rule.expression);
      expect(expressions.some(expression => expression.includes('cf.bot_management.'))).toBe(false);
    });

    it('does not route origin traffic to a hostname outside the selected zone', () => {
      const originHosts = MAXIMUM_CONFIG_RULES
        .map(rule => rule.rule.action_parameters?.origin)
        .filter((origin): origin is { host?: string } => !!origin && typeof origin === 'object')
        .map(origin => origin.host);
      expect(originHosts).not.toContain('api-origin.example.com');
      expect(originHosts).toContain('maxconfig-origin.{zone_name}');
    });
  });

  describe('createMaximumConfig safety options', () => {
    it('does not mutate billing or external DNSSEC state by default', async () => {
      vi.spyOn(api, 'getZone').mockResolvedValue({ name: 'example.com' } as any);
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return new Response(JSON.stringify(responseForMaxConfigUrl(url)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await createMaximumConfig('token', 'zone-id', () => {});

      const urls = fetchMock.mock.calls.map(call => String(call[0]));
      expect(urls.some(url => url.includes('/zones/zone-id/subscription'))).toBe(false);
      expect(urls.some(url => url.includes('/zones/zone-id/dnssec'))).toBe(false);
    });

    it('mutates billing and external DNSSEC state only with explicit unsafe opt-in', async () => {
      vi.spyOn(api, 'getZone').mockResolvedValue({ name: 'example.com' } as any);
      vi.spyOn(api, 'getAvailablePlans').mockResolvedValue([{ id: 'enterprise-plan', name: 'Enterprise', can_subscribe: true, price: 1000, frequency: 'monthly', currency: 'USD' }] as any);
      vi.spyOn(api, 'updateZoneSubscription').mockResolvedValue({} as any);
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return new Response(JSON.stringify(responseForMaxConfigUrl(url)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await createMaximumConfig('token', 'zone-id', () => {}, { includeUnsafeAccountWideTrafficSettings: true });

      const urls = fetchMock.mock.calls.map(call => String(call[0]));
      expect(api.updateZoneSubscription).toHaveBeenCalledWith('token', 'zone-id', 'enterprise-plan', 'monthly');
      expect(urls.some(url => url.includes('/zones/zone-id/dnssec'))).toBe(true);
    });
  });
});
