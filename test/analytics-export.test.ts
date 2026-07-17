import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  exportZoneAnalytics,
  parseMaxRangeHours, unwrapType, zoneDatasetFields, buildSelection,
  type SchemaMap,
} from '../src/analytics-export';

// ── Ref/type builders shared by the mock schema and the builder tests ──
const SC = (name: string) => ({ kind: 'SCALAR', name, ofType: null });
const OB = (name: string) => ({ kind: 'OBJECT', name, ofType: null });
const EN = (name: string) => ({ kind: 'ENUM', name, ofType: null });
const NN = (of: any) => ({ kind: 'NON_NULL', name: null, ofType: of });
const LI = (of: any) => ({ kind: 'LIST', name: null, ofType: of });

// Minimal GraphQL schema used by the integration mock: a `zone` type with two
// curated datasets, one generic dataset, one non-dataset field, plus the
// element + filter types the generic builder introspects.
const MOCK_SCHEMA_TYPES = [
  { kind: 'OBJECT', name: 'zone', inputFields: null, fields: [
    { name: 'httpRequests1dGroups', args: [{ name: 'limit', type: SC('uint64') }, { name: 'filter', type: OB('f_date') }], type: NN(LI(NN(OB('g1d')))) },
    { name: 'firewallEventsAdaptiveGroups', args: [{ name: 'limit', type: SC('uint64') }, { name: 'filter', type: OB('f_dt') }], type: NN(LI(NN(OB('gfw')))) },
    { name: 'someExtraAdaptiveGroups', args: [{ name: 'limit', type: SC('uint64') }, { name: 'filter', type: OB('f_dt') }], type: NN(LI(NN(OB('gx')))) },
    { name: 'notADataset', args: [], type: SC('string') },
  ] },
  { kind: 'INPUT_OBJECT', name: 'f_date', fields: null, inputFields: [
    { name: 'date_geq', type: SC('Date') }, { name: 'date_leq', type: SC('Date') },
  ] },
  { kind: 'INPUT_OBJECT', name: 'f_dt', fields: null, inputFields: [
    { name: 'datetime_geq', type: SC('Time') }, { name: 'datetime_leq', type: SC('Time') },
  ] },
  { kind: 'OBJECT', name: 'g1d', inputFields: null, fields: [{ name: 'count', args: [], type: SC('uint64') }] },
  { kind: 'OBJECT', name: 'gfw', inputFields: null, fields: [{ name: 'count', args: [], type: SC('uint64') }] },
  { kind: 'OBJECT', name: 'gx', inputFields: null, fields: [
    { name: 'count', args: [], type: SC('uint64') },
    { name: 'dimensions', args: [], type: OB('gxDims') },
  ] },
  { kind: 'OBJECT', name: 'gxDims', inputFields: null, fields: [{ name: 'k', args: [], type: SC('string') }] },
];

function jsonResponse(body: unknown, status = 200) {
  return { status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function datasetNameFromQuery(query: string): string | null {
  const m = query.match(/zones\(filter:[^)]*\)\s*\{\s*(\w+)/);
  return m ? m[1] : null;
}

function installFetchMock() {
  const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
    if (url.endsWith('/graphql')) {
      const { query } = JSON.parse(String(opts?.body || '{}')) as { query: string };
      if (query.includes('__schema')) {
        return jsonResponse({ data: { __schema: { types: MOCK_SCHEMA_TYPES } } });
      }
      const ds = datasetNameFromQuery(query);
      if (ds === 'firewallEventsAdaptiveGroups') {
        return jsonResponse({ errors: [{ message: 'not entitled' }] }); // entitlement-gated
      }
      if (ds === 'httpRequests1dGroups') {
        return jsonResponse({ data: { viewer: { zones: [{ httpRequests1dGroups: [{ dimensions: { date: '2026-05-01' }, sum: { requests: 10 } }] }] } } });
      }
      if (ds) {
        return jsonResponse({ data: { viewer: { zones: [{ [ds]: [{ count: 1 }] }] } } });
      }
      return jsonResponse({ data: { viewer: { zones: [{}] } } });
    }
    if (url.includes('/dns_analytics/report/bytime')) {
      return jsonResponse({ success: true, result: { rows: 1, data: [] } });
    }
    return jsonResponse({ success: false, errors: [{ message: 'not found' }] }, 404); // other REST fail
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ZONE = 'a'.repeat(32);
const ACCOUNT = 'b'.repeat(32);
const baseBody = { sourceToken: 'test-token', sourceZoneId: ZONE, sourceAccountId: ACCOUNT };

describe('exportZoneAnalytics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('enumerates every *Groups dataset and attempts them all (nothing skipped)', async () => {
    installFetchMock();
    const out = await exportZoneAnalytics({ ...baseBody, lookbackDays: 7 });

    expect(out.manifest.availableZoneDatasets).toEqual(
      ['firewallEventsAdaptiveGroups', 'httpRequests1dGroups', 'someExtraAdaptiveGroups'],
    );
    expect(out.manifest.availableZoneDatasets).not.toContain('notADataset');
    // Every available dataset is attempted, so nothing is left skipped.
    expect(out.manifest.skippedDatasets).toEqual([]);
    expect(out.manifest.pulledDatasets.length).toBe(out.manifest.availableZoneDatasets.length);
    expect(out.graphql.length).toBe(3);
  });

  it('captures entitlement-gated datasets as errors and pulls the rest', async () => {
    installFetchMock();
    const out = await exportZoneAnalytics({ ...baseBody, lookbackDays: 7 });

    const fw = out.graphql.find(g => g.dataset === 'firewallEventsAdaptiveGroups');
    expect(fw?.error).toBe('not entitled');
    expect(fw?.rowCount).toBe(0);

    const http = out.graphql.find(g => g.dataset === 'httpRequests1dGroups');
    expect(http?.error).toBeUndefined();
    expect(http?.rowCount).toBe(1);

    // The generic (non-curated) dataset was built from introspection and pulled.
    const extra = out.graphql.find(g => g.dataset === 'someExtraAdaptiveGroups');
    expect(extra?.error).toBeUndefined();
    expect(extra?.rowCount).toBe(1);
  });

  it('records REST report success and failure without aborting', async () => {
    installFetchMock();
    const out = await exportZoneAnalytics(baseBody);
    expect(out.rest.find(r => r.endpoint === 'dns_analytics/report/bytime')?.ok).toBe(true);
    expect(out.rest.filter(r => !r.ok).length).toBeGreaterThanOrEqual(1);
  });

  it('clamps lookbackDays into [1, 365]', async () => {
    installFetchMock();
    const big = await exportZoneAnalytics({ ...baseBody, lookbackDays: 9999 });
    expect(big.meta.window.lookbackDays).toBe(365);
    const small = await exportZoneAnalytics({ ...baseBody, lookbackDays: 0 });
    expect(small.meta.window.lookbackDays).toBe(7);
  });

  it('falls back to the curated set when schema introspection fails', async () => {
    // Schema query throws (no data + errors) → exporter falls back to curated.
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      if (url.endsWith('/graphql')) {
        const { query } = JSON.parse(String(opts?.body || '{}')) as { query: string };
        if (query.includes('__schema')) return jsonResponse({ errors: [{ message: 'introspection disabled' }] });
        const ds = datasetNameFromQuery(query);
        return jsonResponse({ data: { viewer: { zones: [{ [ds!]: [] }] } } });
      }
      return jsonResponse({ success: false, errors: [{ message: 'nope' }] }, 404);
    }));
    const out = await exportZoneAnalytics(baseBody);
    // Curated fallback set is the 6 hand-tuned datasets.
    expect(out.graphql.length).toBe(6);
    expect(out.manifest.availableZoneDatasets).toEqual([]);
  });
});

// ── Generic builder unit tests (schema-introspection-driven) ───────────
function fakeSchema(): SchemaMap {
  const m: SchemaMap = new Map();
  m.set('zone', { kind: 'OBJECT', name: 'zone', inputFields: null, fields: [
    { name: 'httpRequestsAdaptiveGroups', args: [{ name: 'limit', type: SC('uint64') as any }, { name: 'filter', type: OB('httpFilter') as any }], type: NN(LI(NN(OB('zoneHttp')))) as any },
    { name: 'somethingElse', args: [], type: SC('string') as any },
  ] });
  m.set('zoneHttp', { kind: 'OBJECT', name: 'zoneHttp', inputFields: null, fields: [
    { name: 'count', args: [], type: SC('uint64') as any },
    { name: 'sum', args: [], type: OB('zoneHttpSum') as any },
    { name: 'dimensions', args: [], type: OB('zoneHttpDims') as any },
    { name: 'fraudScore', args: [], type: SC('float') as any },
    { name: 'needsArg', args: [{ name: 'x', type: NN(SC('String')) as any }], type: SC('string') as any },
  ] });
  m.set('zoneHttpSum', { kind: 'OBJECT', name: 'zoneHttpSum', inputFields: null, fields: [
    { name: 'requests', args: [], type: SC('uint64') as any },
    { name: 'bytes', args: [], type: SC('uint64') as any },
  ] });
  m.set('zoneHttpDims', { kind: 'OBJECT', name: 'zoneHttpDims', inputFields: null, fields: [
    { name: 'date', args: [], type: SC('string') as any },
    { name: 'country', args: [], type: EN('Country') as any },
  ] });
  return m;
}

describe('parseMaxRangeHours', () => {
  it('parses mixed day/hour/minute limits', () => {
    expect(parseMaxRangeHours('15h')).toBe(15);
    expect(parseMaxRangeHours('1d')).toBe(24);
    expect(parseMaxRangeHours('3d')).toBe(72);
    expect(parseMaxRangeHours('1d1h')).toBe(25);
    expect(parseMaxRangeHours('90m')).toBe(1.5);
    expect(parseMaxRangeHours('nonsense')).toBe(0);
  });
});

describe('unwrapType', () => {
  it('peels NON_NULL/LIST wrappers to the named type', () => {
    expect(unwrapType(NN(LI(NN(OB('zoneHttp')))) as any)).toEqual({ kind: 'OBJECT', name: 'zoneHttp' });
    expect(unwrapType(SC('uint64') as any)).toEqual({ kind: 'SCALAR', name: 'uint64' });
  });
});

describe('zoneDatasetFields', () => {
  it('returns only *Groups fields on the zone type', () => {
    expect(zoneDatasetFields(fakeSchema()).map(f => f.name)).toEqual(['httpRequestsAdaptiveGroups']);
  });
});

describe('buildSelection', () => {
  it('includes scalars + expands objects, skipping gated and required-arg fields', () => {
    const sel = buildSelection('zoneHttp', fakeSchema(), 2, new Set(), { n: 28 });
    expect(sel).toContain('count');
    expect(sel).toContain('sum { requests bytes }');
    expect(sel).toContain('dimensions { date country }'); // enum leaf included
    expect(sel).not.toContain('fraudScore');
    expect(sel).not.toContain('needsArg');
  });

  it('honours an explicit deny set', () => {
    const sel = buildSelection('zoneHttp', fakeSchema(), 2, new Set(['bytes']), { n: 28 });
    expect(sel).toContain('requests');
    expect(sel).not.toContain('bytes');
  });

  it('respects the field budget (CF 30-field cap)', () => {
    const sel = buildSelection('zoneHttp', fakeSchema(), 2, new Set(), { n: 1 });
    expect(sel).toBe('count');
  });
});
