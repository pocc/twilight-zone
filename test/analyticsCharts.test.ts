import { describe, it, expect } from 'vitest';
import { buildCharts, groupSum, formatBytes, formatNum } from '../app/lib/analyticsCharts';
import type { AnalyticsExport } from '../src/types';

// Synthetic bundle mirroring the real row shapes captured from a live zone.
function bundle(graphql: AnalyticsExport['graphql']): AnalyticsExport {
  return {
    meta: { zoneId: 'z', accountId: 'a', generatedAt: '', window: { since: '', until: '', lookbackDays: 7 }, toolVersion: 't', note: '' },
    manifest: { availableZoneDatasets: graphql.map(g => g.dataset), pulledDatasets: [], skippedDatasets: [] },
    graphql,
    rest: [],
  };
}

describe('groupSum', () => {
  it('aggregates by dimension and returns top N descending', () => {
    const rows = [
      { count: 5, dimensions: { action: 'block' } },
      { count: 3, dimensions: { action: 'log' } },
      { count: 2, dimensions: { action: 'block' } },
    ];
    expect(groupSum(rows, 'action', r => r.count || 0)).toEqual([
      { label: 'block', value: 7 },
      { label: 'log', value: 3 },
    ]);
  });
});

describe('buildCharts', () => {
  it('produces area + bar specs from real-shaped datasets', () => {
    const exp = bundle([
      { dataset: 'httpRequests1dGroups', scope: 'zone', rowCount: 2, rows: [
        { dimensions: { date: '2026-05-02' }, sum: { requests: 200, bytes: 2000 } },
        { dimensions: { date: '2026-05-01' }, sum: { requests: 100, bytes: 1000 } },
      ] },
      { dataset: 'firewallEventsAdaptiveGroups', scope: 'zone', rowCount: 2, rows: [
        { count: 10, dimensions: { action: 'block' } },
        { count: 4, dimensions: { action: 'log' } },
      ] },
      { dataset: 'dnsAnalyticsAdaptiveGroups', scope: 'zone', rowCount: 1, rows: [
        { count: 9, dimensions: { responseCode: 'NOERROR' } },
      ] },
      { dataset: 'httpRequestsAdaptiveGroups', scope: 'zone', rowCount: 2, rows: [
        { count: 7, dimensions: { clientCountryName: 'US', edgeResponseStatus: 200 } },
        { count: 2, dimensions: { clientCountryName: 'FR', edgeResponseStatus: 301 } },
      ] },
    ]);
    const charts = buildCharts(exp);
    const titles = charts.map(c => c.title);
    expect(titles).toContain('Requests per day');
    expect(titles).toContain('Data served per day');
    expect(titles).toContain('Firewall events by action');
    expect(titles).toContain('DNS queries by response code');
    expect(titles).toContain('Top client countries');
    expect(titles).toContain('HTTP responses by status');

    // Time series is sorted ascending by date.
    const req = charts.find(c => c.title === 'Requests per day')!;
    expect(req.kind).toBe('area');
    expect(req.data.map(d => d.label)).toEqual(['2026-05-01', '2026-05-02']);
    expect(req.data.map(d => d.value)).toEqual([100, 200]);
  });

  it('skips datasets that errored or have no rows', () => {
    const exp = bundle([
      { dataset: 'httpRequests1dGroups', scope: 'zone', rowCount: 0, error: 'not entitled' },
      { dataset: 'firewallEventsAdaptiveGroups', scope: 'zone', rowCount: 0, rows: [] },
    ]);
    expect(buildCharts(exp)).toEqual([]);
  });

  it('omits the requests area chart when all values are zero', () => {
    const exp = bundle([
      { dataset: 'httpRequests1dGroups', scope: 'zone', rowCount: 1, rows: [
        { dimensions: { date: '2026-05-01' }, sum: { requests: 0, bytes: 0 } },
      ] },
    ]);
    expect(buildCharts(exp)).toEqual([]);
  });
});

describe('formatters', () => {
  it('formatNum uses compact suffixes', () => {
    expect(formatNum(950)).toBe('950');
    expect(formatNum(12_300)).toBe('12.3k');
    expect(formatNum(2_000_000)).toBe('2.0M');
  });
  it('formatBytes scales to binary units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
