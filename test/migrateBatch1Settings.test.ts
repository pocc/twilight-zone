import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    updateZoneSetting: vi.fn(async () => ({ id: 'csam_scanner', value: { enabled: false }, editable: true })),
  };
});

import * as api from '../src/api';
import { migrateBatch1 } from '../src/migrate/batch1';
import type { MigrationReport, ZoneExport } from '../src/types';

function minimalExportData(): ZoneExport {
  return {
    zone: { id: 'source-zone', name: 'source.example.com', name_servers: [], status: 'active', account: { id: 'source-account', name: 'Source' }, plan: { id: 'free', name: 'Free' } },
    dnsRecords: [],
    settings: [{ id: 'csam_scanner', value: { enabled: false }, editable: true }],
    pageRules: [],
    rulesets: [],
    workerRoutes: [],
    loadBalancers: [],
    spectrumApps: [],
    customCertificates: [],
    customHostnames: [],
    firewallRules: [],
    rateLimits: [],
    emailRoutingRules: [],
    waitingRooms: [],
    workers: [],
    pools: [],
    monitors: [],
    accessApps: [],
    accessPolicies: [],
    zarazConfig: null,
    turnstileWidgets: [],
    kvNamespaces: [],
    r2Buckets: [],
    d1Databases: [],
    queues: [],
    durableObjectNamespaces: [],
  };
}

function minimalReport(): MigrationReport {
  return {
    timestamp: '2026-06-07T00:00:00.000Z',
    sourceZone: 'source.example.com',
    destZone: 'dest.example.com',
    destAccountId: 'dest-account',
    summary: { total: 0, success: 0, failed: 0, skipped: 0 },
    sections: [],
    errors: [],
    conflicts: [],
    warnings: [],
    manualActions: [],
    newNameservers: [],
  };
}

describe('migrateBatch1 zone settings', () => {
  it('PATCHes dedicated settings through their endpoint id, not runtime id', async () => {
    await migrateBatch1({
      exportData: minimalExportData(),
      report: minimalReport(),
      config: { sourceApiToken: 'src', destApiToken: 'dst', sourceAccountId: 'source-account', destAccountId: 'dest-account', sourceZoneId: 'source-zone' },
      destAuth: 'dest-token',
      destAccountId: 'dest-account',
      destZoneId: 'dest-zone',
      zoneName: 'dest.example.com',
      migrateableRulesets: [],
      acmAvailable: true,
      destDnsRecords: [],
      logWithProgress: () => undefined,
      onItemDone: () => undefined,
    });

    expect(api.updateZoneSetting).toHaveBeenCalledWith('dest-token', 'dest-zone', 'csam_scanner_third_party', { enabled: false });
  });
});
