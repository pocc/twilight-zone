import { describe, it, expect } from 'vitest';
import { mergeReports } from '../src/migrate/merge-reports';
import type { MigrationReport } from '../src/types';

function makeReport(over: Partial<MigrationReport>): MigrationReport {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    sourceZone: 'src.example',
    destZone: 'dst.example',
    destAccountId: 'acct',
    summary: { total: 0, success: 0, failed: 0, skipped: 0 },
    sections: [],
    errors: [],
    conflicts: [],
    warnings: [],
    manualActions: [],
    newNameservers: [],
    ...over,
  };
}

describe('mergeReports', () => {
  it('returns the other report when one side is null', () => {
    const zone = makeReport({ destZone: 'z' });
    expect(mergeReports(null, zone)).toBe(zone);
    expect(mergeReports(zone, null)).toBe(zone);
    expect(mergeReports(null, null)).toBeNull();
  });

  it('adds summary counters across phases', () => {
    const account = makeReport({ summary: { total: 5, success: 4, failed: 1, skipped: 0 } });
    const zone = makeReport({ summary: { total: 10, success: 8, failed: 1, skipped: 1 } });
    const merged = mergeReports(account, zone)!;
    expect(merged.summary).toEqual({ total: 15, success: 12, failed: 2, skipped: 1 });
  });

  it('only emits acknowledged when a phase reported it', () => {
    const a = makeReport({ summary: { total: 1, success: 1, failed: 0, skipped: 0 } });
    const z = makeReport({ summary: { total: 1, success: 1, failed: 0, skipped: 0 } });
    expect('acknowledged' in mergeReports(a, z)!.summary).toBe(false);

    const z2 = makeReport({ summary: { total: 1, success: 0, failed: 0, skipped: 0, acknowledged: 1 } });
    expect(mergeReports(a, z2)!.summary.acknowledged).toBe(1);
  });

  it('concatenates sections/errors/conflicts/warnings and unions manualActions/nameservers', () => {
    const account = makeReport({
      sections: [{ name: 'Workers', total: 1, success: 1, failed: 0, skipped: 0, items: [] }],
      errors: [{ section: 'Workers', item: 'w1', error: 'boom' } as never],
      warnings: ['w-warn'],
      manualActions: ['copy KV data', 'shared step'],
      newNameservers: [],
    });
    const zone = makeReport({
      sections: [{ name: 'DNS', total: 2, success: 2, failed: 0, skipped: 0, items: [] }],
      conflicts: [{ section: 'DNS', item: 'a', error: 'exists' } as never],
      warnings: ['z-warn'],
      manualActions: ['change nameservers', 'shared step'],
      newNameservers: ['ns1.cf', 'ns2.cf'],
    });
    const merged = mergeReports(account, zone)!;
    expect(merged.sections.map(s => s.name)).toEqual(['Workers', 'DNS']);
    expect(merged.errors).toHaveLength(1);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.warnings).toEqual(['w-warn', 'z-warn']);
    // shared step deduped:
    expect(merged.manualActions).toEqual(['copy KV data', 'shared step', 'change nameservers']);
    expect(merged.newNameservers).toEqual(['ns1.cf', 'ns2.cf']);
  });

  it('merges createdResources (zoneId from zone, arrays unioned)', () => {
    const account = makeReport({
      createdResources: {
        workers: ['w1'], kvNamespaces: ['kv1'], r2Buckets: [], d1Databases: [], queues: [],
        doNamespaces: [], dnsRecords: [], pageRules: [], rulesets: [], accessApps: [],
        emailRules: [], customHostnames: [], turnstileWidgets: ['t1'],
      },
    });
    const zone = makeReport({
      createdResources: {
        zoneId: 'zone-123', workers: [], kvNamespaces: [], r2Buckets: [], d1Databases: [], queues: [],
        doNamespaces: [], dnsRecords: ['d1', 'd2'], pageRules: [], rulesets: ['r1'], accessApps: [],
        emailRules: [], customHostnames: [], turnstileWidgets: [],
      },
    });
    const merged = mergeReports(account, zone)!;
    expect(merged.createdResources!.zoneId).toBe('zone-123');
    expect(merged.createdResources!.workers).toEqual(['w1']);
    expect(merged.createdResources!.dnsRecords).toEqual(['d1', 'd2']);
    expect(merged.createdResources!.turnstileWidgets).toEqual(['t1']);
    expect(merged.createdResources!.rulesets).toEqual(['r1']);
  });

  it('prefers the zone phase for identity + validation', () => {
    const account = makeReport({ destZone: 'old', validation: undefined });
    const zone = makeReport({
      destZone: 'real.example',
      timestamp: '2026-02-02T00:00:00Z',
      validation: { sections: [], summary: { verified: 3, mismatched: 0, missing: 0, acknowledged: 0 } } as never,
    });
    const merged = mergeReports(account, zone)!;
    expect(merged.destZone).toBe('real.example');
    expect(merged.timestamp).toBe('2026-02-02T00:00:00Z');
    expect(merged.validation).toBeDefined();
  });
});
