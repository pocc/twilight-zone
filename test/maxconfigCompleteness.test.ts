import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ZONE_SETTINGS, shouldSkipMaxConfigSetting } from '../src/fuzz';

// Guard tests for the omnibus E2E config (e01-everything.json).
//
// e01's stated job is to exercise EVERY migrate-able zone setting — i.e. every
// setting MaxConfig applies. Historically it seeded only 19 of the ~55, so 36
// settings carried no changed-value signal: assertZoneSettingsMatch compared
// them but they sat at their defaults on both sides and trivially matched.
//
// These tests pin two invariants so the gap cannot silently reappear:
//   1. e01 seeds EVERY setting MaxConfig applies (no under-testing).
//   2. e01 seeds NOTHING MaxConfig does NOT apply (no deprecated/read-only/
//      blocked/unsupported settings, and no typo'd ids) — "if it isn't in
//      MaxConfig, it's a bug" (the user's framing).
//
// The canonical "what MaxConfig applies" set is derived from the SAME source of
// truth the engine uses (ZONE_SETTINGS + shouldSkipMaxConfigSetting in
// src/fuzz.ts), so adding a setting to the catalog automatically tightens this
// test — when someone adds a ZONE_SETTINGS entry, this test fails with the exact
// id to add to e01, and when someone adds a deprecated/skip setting to e01 it
// fails with the id to remove. No hand-maintained second list.

// Mirror src/migrate/constants.ts. Kept inline (not imported) so a change to the
// engine's read-only/blocked policy must be reflected here deliberately, with a
// failing test pointing at the divergence — these sets define what MaxConfig is
// ALLOWED to write, so they are part of the contract this test guards.
const MAXCONFIG_APPLIED_IDS = ZONE_SETTINGS
  .filter(def => !def.deprecated && !shouldSkipMaxConfigSetting(def.id))
  .map(def => def.id);

const CATALOG_IDS = new Set(ZONE_SETTINGS.map(d => d.id));

function e01ZoneSettings(): Record<string, unknown> {
  const p = fileURLToPath(new URL('../docs/test_configs/e01-everything.json', import.meta.url));
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  expect(cfg.zone_settings, 'e01 must have a zone_settings block').toBeTruthy();
  return cfg.zone_settings as Record<string, unknown>;
}

describe('e01 omnibus config — zone-settings completeness', () => {
  it('seeds EVERY setting MaxConfig applies (no under-testing)', () => {
    const seeded = new Set(Object.keys(e01ZoneSettings()));
    const missing = MAXCONFIG_APPLIED_IDS.filter(id => !seeded.has(id));
    expect(
      missing,
      `e01-everything.json is missing ${missing.length} MaxConfig setting(s). ` +
        `Add them to "zone_settings" (omnibus must exercise every migrate-able setting): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('seeds NOTHING outside the MaxConfig set (no deprecated/read-only/blocked/unsupported/typos)', () => {
    const applied = new Set(MAXCONFIG_APPLIED_IDS);
    const extra = Object.keys(e01ZoneSettings()).filter(id => !applied.has(id));
    const explain = (id: string) =>
      !CATALOG_IDS.has(id)
        ? `${id} (not a known ZONE_SETTINGS id — typo?)`
        : `${id} (deprecated or read-only/blocked/unsupported — MaxConfig never applies it)`;
    expect(
      extra,
      `e01-everything.json seeds ${extra.length} setting(s) MaxConfig does not apply — remove them: ` +
        extra.map(explain).join('; '),
    ).toEqual([]);
  });

  it('e01 zone_settings is EXACTLY the MaxConfig applied set', () => {
    expect(new Set(Object.keys(e01ZoneSettings()))).toEqual(new Set(MAXCONFIG_APPLIED_IDS));
  });
});

describe('MaxConfig applied set sanity', () => {
  it('is non-trivial and excludes deprecated/skip settings', () => {
    // Catches a catalog regression that would empty out the set (which would
    // make the e01 tests vacuously pass).
    expect(MAXCONFIG_APPLIED_IDS.length).toBeGreaterThan(40);
    for (const id of MAXCONFIG_APPLIED_IDS) {
      expect(shouldSkipMaxConfigSetting(id), `${id} should not be a skipped setting`).toBe(false);
    }
    // Known deprecated ids must never appear.
    for (const dep of ['waf', 'auto_minify']) {
      expect(MAXCONFIG_APPLIED_IDS).not.toContain(dep);
    }
  });
});
