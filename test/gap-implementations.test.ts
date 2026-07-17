import { describe, it, expect } from 'vitest';
import { filterExportData } from '../src/migrate/preflight';
import type { ZoneExport, CFR2BucketConfig } from '../src/types';

// Minimal ZoneExport stub — only the fields the assertions touch. The
// production shape is large; filterExportData spreads `...data` so unset
// fields pass through untouched, which is exactly what we're verifying.
function stubExport(overrides: Partial<ZoneExport>): ZoneExport {
  const empty = [] as never[];
  return {
    settings: empty, dnsRecords: empty, pageRules: empty, rulesets: empty,
    workers: empty, workerRoutes: empty, pools: empty, monitors: empty,
    loadBalancers: empty, customCertificates: empty, customHostnames: empty,
    accessApps: empty, accessPolicies: empty, firewallRules: empty,
    rateLimits: empty, spectrumApps: empty, emailRoutingRules: empty,
    waitingRooms: empty, turnstileWidgets: empty, kvNamespaces: empty,
    r2Buckets: empty, d1Databases: empty, queues: empty,
    durableObjectNamespaces: empty, zarazConfig: null,
    ...overrides,
  } as unknown as ZoneExport;
}

describe('gap implementations — bucket C wiring', () => {
  describe('zone-scoped singletons ride along with the zone (no Step 2 toggle)', () => {
    it('filterExportData preserves googleTagGateway / smartShield / smartShieldHealthchecks', () => {
      const gtg = { enabled: true, tagId: 'GTM-XXXX' };
      const ss = { enabled: true };
      const ssHc = [{ name: 'origin-1', address: 'origin.example.com' }];
      const data = stubExport({
        googleTagGateway: gtg,
        smartShield: ss,
        smartShieldHealthchecks: ssHc,
      });
      // Even with an explicit (non-empty) selection set, the singletons are
      // not selection-gated and must survive untouched.
      const filtered = filterExportData(data, { settings: {} });
      expect(filtered.googleTagGateway).toEqual(gtg);
      expect(filtered.smartShield).toEqual(ss);
      expect(filtered.smartShieldHealthchecks).toEqual(ssHc);
    });
  });

  describe('R2 bucket sub-config: custom domains + object lock follow bucket selection', () => {
    const cfg: CFR2BucketConfig = {
      bucketName: 'assets',
      customDomains: [{ domain: 'cdn.example.com', enabled: true }],
      lock: { rules: [{ id: 'r1', condition: { maxAgeDays: 30 } }] },
    };

    it('kept when the parent bucket is selected', () => {
      const data = stubExport({ r2BucketConfigs: [cfg] });
      const filtered = filterExportData(data, { r2Buckets: { assets: true } });
      expect(filtered.r2BucketConfigs).toHaveLength(1);
      expect(filtered.r2BucketConfigs?.[0].customDomains?.[0].domain).toBe('cdn.example.com');
      expect(filtered.r2BucketConfigs?.[0].lock?.rules).toHaveLength(1);
    });

    it('dropped when the parent bucket is not selected', () => {
      const data = stubExport({ r2BucketConfigs: [cfg] });
      const filtered = filterExportData(data, { r2Buckets: { other: true } });
      expect(filtered.r2BucketConfigs).toHaveLength(0);
    });
  });
});
