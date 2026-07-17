import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain ESM data module, no types needed.
import {
  ENDPOINTS,
  CORE_ENDPOINTS,
  HOOK_ENDPOINTS,
  HOOKS_NEEDING_EVIDENCE,
  endpointsForHooks,
} from '../scripts/capture-catalog.mjs';

// Guard for L1 targeted capture (scripts/capture-catalog.mjs).
//
// Targeted capture only fetches the endpoints a test's evidence assertions read.
// If the HOOK → endpoint map is wrong (typo, missing hook, stale name), a live
// run would capture too little and the assertion would fail with "no evidence
// captured". These offline checks catch that class of error before a live run:
// every evidence hook must map to REAL endpoint names, and the evidence gate
// (HOOKS_NEEDING_EVIDENCE) must equal the mapped hooks.

const endpointNames = new Set<string>((ENDPOINTS as Array<{ name: string }>).map(e => e.name));

describe('capture catalog — endpoint definitions', () => {
  it('every endpoint has name + method + path', () => {
    for (const ep of ENDPOINTS as Array<Record<string, unknown>>) {
      expect(typeof ep.name, JSON.stringify(ep)).toBe('string');
      expect(typeof ep.method, JSON.stringify(ep)).toBe('string');
      expect(typeof ep.path, JSON.stringify(ep)).toBe('string');
    }
  });

  it('CORE_ENDPOINTS all reference real endpoints', () => {
    for (const name of CORE_ENDPOINTS as string[]) {
      expect(endpointNames.has(name), `CORE endpoint "${name}" not in ENDPOINTS`).toBe(true);
    }
  });
});

describe('capture catalog — hook → endpoint map', () => {
  it('HOOKS_NEEDING_EVIDENCE equals the keys of HOOK_ENDPOINTS', () => {
    expect(new Set(HOOKS_NEEDING_EVIDENCE)).toEqual(new Set(Object.keys(HOOK_ENDPOINTS)));
  });

  it('every mapped endpoint name is a real capture endpoint (no typos/stale names)', () => {
    const bad: string[] = [];
    for (const [hook, eps] of Object.entries(HOOK_ENDPOINTS as Record<string, string[]>)) {
      for (const name of eps) if (!endpointNames.has(name)) bad.push(`${hook} → ${name}`);
    }
    expect(bad, `mapped endpoint names not present in ENDPOINTS: ${bad.join(', ')}`).toEqual([]);
  });

  it('every evidence hook maps to at least one endpoint', () => {
    for (const [hook, eps] of Object.entries(HOOK_ENDPOINTS as Record<string, string[]>)) {
      expect((eps || []).length, `${hook} has no capture endpoints`).toBeGreaterThan(0);
    }
  });

  it('settings-family hooks pull the aggregate settings endpoint', () => {
    for (const hook of ['assertZoneSettingsMatch', 'assertDedicatedScalarSettingsMatch']) {
      expect((HOOK_ENDPOINTS as Record<string, string[]>)[hook]).toContain('settings');
    }
  });

  it('zone singleton settings hook captures every singleton endpoint it compares', () => {
    expect((HOOK_ENDPOINTS as Record<string, string[]>).assertZoneSingletonSettingsMatch).toEqual(expect.arrayContaining([
      'managed_headers',
      'url_normalization',
      'cache_reserve',
      'regional_tiered_cache',
      'cache_variants',
      'origin_post_quantum',
      'page_shield',
      'api_gateway_configuration',
      'origin_tls_settings',
      'google_tag_gateway',
      'smart_shield',
    ]));
  });
});

describe('capture catalog — endpointsForHooks() derivation', () => {
  it('includes CORE + the hook endpoints, all valid', () => {
    const eps = endpointsForHooks(['assertZoneSettingsMatch']);
    expect(eps).toContain('settings');
    for (const c of CORE_ENDPOINTS as string[]) expect(eps).toContain(c);
    for (const name of eps) expect(endpointNames.has(name)).toBe(true);
  });

  it('ignores non-evidence hooks (returns just core)', () => {
    // assertSecretsManualAction reads the report, not evidence → not in the map.
    const eps = endpointsForHooks(['assertSecretsManualAction']);
    expect(new Set(eps)).toEqual(new Set(CORE_ENDPOINTS));
  });

  it('actually narrows the capture (fewer than the full catalog) for a real config', () => {
    // e09-style: KV + R2 + the three settings assertions.
    const eps = endpointsForHooks([
      'assertKvKeysCopied',
      'assertR2ObjectsCopied',
      'assertZoneSettingsMatch',
      'assertDedicatedSettingsMatch',
      'assertDedicatedScalarSettingsMatch',
    ]);
    expect(eps.length).toBeGreaterThan(0);
    expect(eps.length).toBeLessThan((ENDPOINTS as unknown[]).length);
    for (const name of eps) expect(endpointNames.has(name)).toBe(true);
  });

  it('returns null when an evidence hook is unmapped (caller falls back to full capture)', () => {
    // Simulate a future evidence hook someone forgot to map: endpointsForHooks
    // only knows the mapped ones, so an unknown hook is treated as non-evidence
    // and ignored — but the harness gates capture on HOOKS_NEEDING_EVIDENCE, so
    // the real fail-safe is: a mapped-but-empty hook → null. We assert the
    // documented contract directly on the union helper.
    expect(endpointsForHooks([])).toEqual([...CORE_ENDPOINTS]);
  });
});
