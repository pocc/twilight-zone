import { describe, it, expect } from 'vitest';
import { formatDiffReport, diffExports, diffReportToDiscrepancies, type DiffReport, type DiffItem } from '../src/diff';
import type { ZoneExport } from '../src/types';

// Minimal ZoneExport stub — diffExports only reads zone.name + the four
// compared arrays, so we cast a partial rather than fill 30+ fields.
function makeExport(name: string, over: Partial<ZoneExport> = {}): ZoneExport {
  return {
    zone: { name },
    dnsRecords: [],
    settings: [],
    pageRules: [],
    workerRoutes: [],
    ...over,
  } as unknown as ZoneExport;
}

describe('diff.ts', () => {
  describe('formatDiffReport', () => {
    it('formats a basic diff report', () => {
      const report: DiffReport = {
        timestamp: '2026-02-05T00:00:00.000Z',
        sourceZone: 'source.example.com',
        destZone: 'dest.example.com',
        summary: { create: 2, update: 1, skip: 1, conflict: 0 },
        items: [
          { action: 'create', resourceType: 'DNS Record', name: 'A www' },
          { action: 'create', resourceType: 'DNS Record', name: 'CNAME api' },
          { action: 'update', resourceType: 'Zone Setting', name: 'ssl', reason: 'Value differs' },
          { action: 'skip', resourceType: 'Page Rule', name: 'example.com/*' },
        ],
        warnings: [],
      };

      const formatted = formatDiffReport(report);

      expect(formatted).toContain('# Migration Diff Report');
      expect(formatted).toContain('Source: source.example.com');
      expect(formatted).toContain('Destination: dest.example.com');
      expect(formatted).toContain('🆕 Create: 2');
      expect(formatted).toContain('📝 Update: 1');
      expect(formatted).toContain('⏭️ Skip: 1');
      expect(formatted).toContain('⚠️ Conflict: 0');
      expect(formatted).toContain('## Will Create');
      expect(formatted).toContain('[CREATE] DNS Record: A www');
      expect(formatted).toContain('## Will Update');
      expect(formatted).toContain('[UPDATE] Zone Setting: ssl');
      expect(formatted).toContain('## Will Skip');
    });

    it('includes warnings when present', () => {
      const report: DiffReport = {
        timestamp: '2026-02-05T00:00:00.000Z',
        sourceZone: 'source.example.com',
        destZone: 'dest.example.com',
        summary: { create: 0, update: 0, skip: 0, conflict: 0 },
        items: [],
        warnings: ['5 Custom Hostnames require SSL validation', '2 Workers have secrets'],
      };

      const formatted = formatDiffReport(report);

      expect(formatted).toContain('## Warnings');
      expect(formatted).toContain('5 Custom Hostnames require SSL validation');
      expect(formatted).toContain('2 Workers have secrets');
    });

    it('includes conflict section when conflicts exist', () => {
      const report: DiffReport = {
        timestamp: '2026-02-05T00:00:00.000Z',
        sourceZone: 'source.example.com',
        destZone: 'dest.example.com',
        summary: { create: 0, update: 0, skip: 0, conflict: 1 },
        items: [
          {
            action: 'conflict',
            resourceType: 'Page Rule',
            name: 'example.com/api/*',
            reason: 'Exists with different actions - manual review needed',
          },
        ],
        warnings: [],
      };

      const formatted = formatDiffReport(report);

      expect(formatted).toContain('## Conflicts (Manual Review)');
      expect(formatted).toContain('[CONFLICT] Page Rule: example.com/api/*');
      expect(formatted).toContain('Reason: Exists with different actions');
    });

    it('shows update reasons', () => {
      const report: DiffReport = {
        timestamp: '2026-02-05T00:00:00.000Z',
        sourceZone: 'source.example.com',
        destZone: 'dest.example.com',
        summary: { create: 0, update: 1, skip: 0, conflict: 0 },
        items: [
          {
            action: 'update',
            resourceType: 'DNS Record',
            name: 'A www',
            reason: 'Content differs: "192.0.2.1" vs "192.0.2.2"',
          },
        ],
        warnings: [],
      };

      const formatted = formatDiffReport(report);

      expect(formatted).toContain('Reason: Content differs');
    });

    it('handles empty report gracefully', () => {
      const report: DiffReport = {
        timestamp: '2026-02-05T00:00:00.000Z',
        sourceZone: 'empty-source.com',
        destZone: 'empty-dest.com',
        summary: { create: 0, update: 0, skip: 0, conflict: 0 },
        items: [],
        warnings: [],
      };

      const formatted = formatDiffReport(report);

      expect(formatted).toContain('# Migration Diff Report');
      expect(formatted).toContain('🆕 Create: 0');
      expect(formatted).not.toContain('## Will Create');
      expect(formatted).not.toContain('## Will Update');
      expect(formatted).not.toContain('## Warnings');
    });
  });

  describe('DiffItem types', () => {
    it('supports all diff actions', () => {
      const actions: DiffItem['action'][] = ['create', 'update', 'skip', 'conflict'];
      
      for (const action of actions) {
        const item: DiffItem = {
          action,
          resourceType: 'Test Resource',
          name: 'test-name',
        };
        expect(item.action).toBe(action);
      }
    });

    it('supports optional source and destination fields', () => {
      const itemWithSource: DiffItem<{ id: string }> = {
        action: 'create',
        resourceType: 'DNS Record',
        name: 'test',
        source: { id: 'src-123' },
      };

      const itemWithBoth: DiffItem<{ id: string }> = {
        action: 'update',
        resourceType: 'DNS Record',
        name: 'test',
        source: { id: 'src-123' },
        destination: { id: 'dst-456' },
        reason: 'Values differ',
      };

      expect(itemWithSource.source?.id).toBe('src-123');
      expect(itemWithBoth.destination?.id).toBe('dst-456');
    });
  });

  describe('DiffReport structure', () => {
    it('has correct summary structure', () => {
      const report: DiffReport = {
        timestamp: new Date().toISOString(),
        sourceZone: 'test.com',
        destZone: 'test2.com',
        summary: { create: 10, update: 5, skip: 20, conflict: 2 },
        items: [],
        warnings: [],
      };

      expect(report.summary.create).toBe(10);
      expect(report.summary.update).toBe(5);
      expect(report.summary.skip).toBe(20);
      expect(report.summary.conflict).toBe(2);
    });
  });

  describe('diffExports (pure source-vs-dest, no I/O)', () => {
    const dns = (over: Record<string, unknown>) =>
      ({ type: 'A', name: 'www', content: '192.0.2.1', ttl: 1, proxied: false, ...over }) as never;

    it('identical exports produce only skip items (no create/update)', () => {
      const src = makeExport('s.com', { dnsRecords: [dns({})], settings: [{ id: 'ssl', value: 'full', editable: true } as never] });
      const dest = makeExport('d.com', { dnsRecords: [dns({})], settings: [{ id: 'ssl', value: 'full', editable: true } as never] });
      const report = diffExports(src, dest);
      expect(report.summary.create).toBe(0);
      expect(report.summary.update).toBe(0);
      expect(report.summary.skip).toBe(2);
    });

    it('flags a record present in source but missing on dest as create', () => {
      const src = makeExport('s.com', { dnsRecords: [dns({})] });
      const dest = makeExport('d.com', { dnsRecords: [] });
      const report = diffExports(src, dest);
      expect(report.summary.create).toBe(1);
    });

    it('flags a differing value as update', () => {
      const src = makeExport('s.com', { dnsRecords: [dns({ content: '192.0.2.1' })] });
      const dest = makeExport('d.com', { dnsRecords: [dns({ content: '192.0.2.9' })] });
      const report = diffExports(src, dest);
      expect(report.summary.update).toBe(1);
    });
  });

  describe('diffReportToDiscrepancies', () => {
    it('maps create→missing, update/conflict→mismatched, and omits skip', () => {
      const report: DiffReport = {
        timestamp: '', sourceZone: 's', destZone: 'd',
        summary: { create: 1, update: 1, skip: 1, conflict: 1 },
        items: [
          { action: 'create', resourceType: 'DNS Record', name: 'A www', source: { x: 1 } },
          { action: 'update', resourceType: 'Zone Setting', name: 'ssl', reason: 'differs', source: 'full', destination: 'flexible' },
          { action: 'conflict', resourceType: 'Page Rule', name: 'p/*' },
          { action: 'skip', resourceType: 'Worker Route', name: 'r/*' },
        ] as DiffItem[],
        warnings: [],
      };
      const d = diffReportToDiscrepancies(report);
      expect(d).toHaveLength(3); // skip omitted
      expect(d.find(x => x.path === 'A www')?.type).toBe('missing');
      expect(d.find(x => x.path === 'ssl')?.type).toBe('mismatched');
      expect(d.find(x => x.path === 'ssl')?.dest).toBe('flexible');
      expect(d.find(x => x.path === 'p/*')?.type).toBe('mismatched');
      expect(d.some(x => x.path === 'r/*')).toBe(false);
    });

    it('supplies a default reason for missing (create) entries', () => {
      const report: DiffReport = {
        timestamp: '', sourceZone: 's', destZone: 'd',
        summary: { create: 1, update: 0, skip: 0, conflict: 0 },
        items: [{ action: 'create', resourceType: 'DNS Record', name: 'A www' }] as DiffItem[],
        warnings: [],
      };
      expect(diffReportToDiscrepancies(report)[0].reason).toMatch(/missing on destination/i);
    });
  });
});
