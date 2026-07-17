import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkSpecDrift, readSpecStatus, type SpecStatus } from '../src/worker/spec-monitor';
import baselineJson from '../src/openapi-baseline.generated.json';

// The drift monitor diffs the SET of write-endpoint keys ("METHOD path") in the
// live Cloudflare OpenAPI spec against the committed baseline. These tests pin
// the lastFullCoverageCheck tracking that drives the banner's
// "last 100% coverage on {date}" line — without it the banner can't tell the
// user when coverage was last complete.

const baseline = baselineJson as { generatedAt: string; writeKeys: string[] };

// Build an OpenAPI-shaped `.paths` object from a list of "METHOD /path" keys.
function pathsFromKeys(keys: string[]): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const key of keys) {
    const sp = key.indexOf(' ');
    const method = key.slice(0, sp).toLowerCase();
    const path = key.slice(sp + 1);
    paths[path] ??= {};
    paths[path][method] = {};
  }
  return paths;
}

// In-memory KVNamespace stub — only get/put are exercised.
function makeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
  } as unknown as KVNamespace;
}

// Route fetch by method + URL: HEAD → etag only, GET raw spec → the paths body,
// commits API → a fixed commit date.
function stubFetch(opts: { etag: string; liveKeys: string[] }) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers: { etag: opts.etag } });
    }
    if (u.includes('api.github.com')) {
      return new Response(JSON.stringify([{ commit: { committer: { date: '2026-01-01T00:00:00Z' } } }]), { status: 200 });
    }
    // GET raw spec
    return new Response(JSON.stringify({ paths: pathsFromKeys(opts.liveKeys) }), { status: 200 });
  });
}

describe('checkSpecDrift — lastFullCoverageCheck tracking', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('ignores a persisted status computed against an older bundled baseline', async () => {
    const kv = makeKV();
    const stale: SpecStatus = {
      ...(await readSpecStatus()),
      ok: true,
      checkedAt: '2026-01-01T00:00:00.000Z',
      lastSuccessfulCheck: '2026-01-01T00:00:00.000Z',
      lastFullCoverageCheck: '2026-01-01T00:00:00.000Z',
      manifestGeneratedAt: '2000-01-01T00:00:00.000Z',
      baselineCount: baseline.writeKeys.length,
      drift: true,
      newEndpoints: ['POST /accounts/{account_id}/stale_drift_from_old_deploy'],
    };
    await kv.put('spec-monitor:status', JSON.stringify(stale));

    const status = await readSpecStatus(kv);

    expect(status.manifestGeneratedAt).toBe(baseline.generatedAt);
    expect(status.lastSuccessfulCheck).toBeNull();
    expect(status.drift).toBe(false);
    expect(status.newEndpoints).toEqual([]);
  });

  it('sets lastFullCoverageCheck on a clean (zero-drift) check', async () => {
    vi.stubGlobal('fetch', stubFetch({ etag: 'v1', liveKeys: baseline.writeKeys }));
    const kv = makeKV();

    const status = await checkSpecDrift({ RUN_LOG: kv });

    expect(status.ok).toBe(true);
    expect(status.drift).toBe(false);
    expect(status.newEndpoints).toEqual([]);
    expect(status.lastFullCoverageCheck).toBe(status.lastSuccessfulCheck);
    expect(status.lastFullCoverageCheck).not.toBeNull();
    // First-ever clean check starts the zero-drift streak.
    expect(status.fullCoverageSince).toBe(status.lastSuccessfulCheck);
  });

  it('preserves the prior full-coverage date when drift appears', async () => {
    const kv = makeKV();
    // First run: clean → records a full-coverage date.
    vi.stubGlobal('fetch', stubFetch({ etag: 'v1', liveKeys: baseline.writeKeys }));
    const clean = await checkSpecDrift({ RUN_LOG: kv });
    const fullDate = clean.lastFullCoverageCheck;
    expect(fullDate).not.toBeNull();

    // Second run: a new endpoint appears (and the etag changes so we re-parse).
    vi.unstubAllGlobals();
    const NEW = 'POST /accounts/{account_id}/twilight_zone_brand_new_endpoint';
    expect(baseline.writeKeys).not.toContain(NEW);
    vi.stubGlobal('fetch', stubFetch({ etag: 'v2', liveKeys: [...baseline.writeKeys, NEW] }));

    const drifted = await checkSpecDrift({ RUN_LOG: kv });

    expect(drifted.drift).toBe(true);
    expect(drifted.newEndpoints).toEqual([NEW]);
    // The "last 100% coverage" date must point back at the clean run, not now.
    expect(drifted.lastFullCoverageCheck).toBe(fullDate);
    // The zero-drift streak is broken → "since" is nulled.
    expect(drifted.fullCoverageSince).toBeNull();
    // liveCount is the "Y total endpoints" denominator.
    expect(drifted.liveCount).toBe(baseline.writeKeys.length + 1);
  });

  it('advances lastFullCoverageCheck but PRESERVES the streak start on the clean ETag fast-path', async () => {
    const kv = makeKV();
    // Seed a prior clean status: streak began long ago, last checked long ago.
    const streakStart = '2020-01-01T00:00:00.000Z';
    const seed: SpecStatus = {
      ...(await readSpecStatus()),
      ok: true,
      checkedAt: streakStart,
      lastSuccessfulCheck: streakStart,
      lastFullCoverageCheck: streakStart,
      fullCoverageSince: streakStart,
      specEtag: 'stable-etag',
      liveCount: baseline.writeKeys.length,
      drift: false,
      newEndpoints: [],
    };
    await kv.put('spec-monitor:status', JSON.stringify(seed));

    // HEAD returns the same etag → fast-path, no GET/parse.
    const fetchSpy = stubFetch({ etag: 'stable-etag', liveKeys: baseline.writeKeys });
    vi.stubGlobal('fetch', fetchSpy);

    const status = await checkSpecDrift({ RUN_LOG: kv });

    expect(status.drift).toBe(false);
    // The most-recent-clean-check date advances to now …
    expect(status.lastFullCoverageCheck).toBe(status.lastSuccessfulCheck);
    expect(new Date(status.lastFullCoverageCheck!).getTime()).toBeGreaterThan(new Date(streakStart).getTime());
    // … but the streak START must NOT move — "since" should stay anchored, not
    // creep forward to today every day the monitor runs.
    expect(status.fullCoverageSince).toBe(streakStart);
    // Fast-path must not have fetched the body — only the HEAD probe ran.
    const getCalls = fetchSpy.mock.calls.filter(([, init]) => (init?.method ?? 'GET').toUpperCase() === 'GET');
    expect(getCalls.length).toBe(0);
  });

  it('preserves the full-coverage date on the ETag fast-path while drifting', async () => {
    const kv = makeKV();
    const fullDate = '2025-06-01T00:00:00.000Z';
    const seed: SpecStatus = {
      ...(await readSpecStatus()),
      ok: true,
      checkedAt: '2025-06-02T00:00:00.000Z',
      lastSuccessfulCheck: '2025-06-02T00:00:00.000Z',
      lastFullCoverageCheck: fullDate,
      specEtag: 'drift-etag',
      drift: true,
      newEndpoints: ['POST /accounts/{account_id}/something_new'],
    };
    await kv.put('spec-monitor:status', JSON.stringify(seed));

    vi.stubGlobal('fetch', stubFetch({ etag: 'drift-etag', liveKeys: baseline.writeKeys }));
    const status = await checkSpecDrift({ RUN_LOG: kv });

    // Still drifting (etag unchanged), so the full-coverage date is frozen.
    expect(status.drift).toBe(true);
    expect(status.lastFullCoverageCheck).toBe(fullDate);
    // Streak stays broken while drifting.
    expect(status.fullCoverageSince).toBeNull();
  });

  it('restarts the streak on a drift→clean transition (not the original streak)', async () => {
    const kv = makeKV();
    // Prior state: drifting, so no active streak.
    const oldStreak = '2024-01-01T00:00:00.000Z';
    const seed: SpecStatus = {
      ...(await readSpecStatus()),
      ok: true,
      checkedAt: '2025-01-01T00:00:00.000Z',
      lastSuccessfulCheck: '2025-01-01T00:00:00.000Z',
      lastFullCoverageCheck: oldStreak,
      fullCoverageSince: null, // streak was broken by the drift
      specEtag: 'drifting-etag',
      liveCount: baseline.writeKeys.length + 1,
      drift: true,
      newEndpoints: ['POST /accounts/{account_id}/since_resolved'],
    };
    await kv.put('spec-monitor:status', JSON.stringify(seed));

    // Drift is now resolved (baseline regenerated) → live matches baseline, and
    // the etag changed so we re-parse.
    vi.stubGlobal('fetch', stubFetch({ etag: 'clean-again-etag', liveKeys: baseline.writeKeys }));
    const status = await checkSpecDrift({ RUN_LOG: kv });

    expect(status.drift).toBe(false);
    // A NEW streak starts now — it must not resurrect the pre-drift date.
    expect(status.fullCoverageSince).toBe(status.lastSuccessfulCheck);
    expect(status.fullCoverageSince).not.toBe(oldStreak);
  });
});
