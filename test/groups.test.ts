/**
 * Tests for app/components/steps/scope/groups.ts.
 *
 * `computeDefaultSelections` is the pure core of App.tsx's
 * `initDefaultSelections`. It builds the Step 2 groups and applies the
 * defaulting rule (zone-scoped checked, account-scoped unchecked, disabled
 * items off; `allOn` selects every non-disabled item for presets like
 * MaxConfig).
 *
 * Regression: MaxConfig sets conflictStrategy='overwrite', then expects `allOn`
 * to select everything. If computeDefaultSelections builds groups WITHOUT
 * threading conflictStrategy, a Turnstile widget whose name already exists on
 * the dest (disabled under 'skip') stays disabled, so `allOn` leaves it
 * unchecked even though MaxConfig applies it anyway (the "0/1 Turnstile" bug).
 * These tests fail if the threading regresses.
 *
 * (D1 databases used to be gated behind a per-db acknowledgement; #15 removed
 * that gate, so the D1 tests below assert D1 is freely selectable.)
 */

import { describe, it, expect } from 'vitest';
import { buildGroups, computeDefaultSelections } from '../app/components/steps/scope/groups';
import type { ZoneExport } from '../src/types';

/** Minimal ZoneExport carrying only the fields a test exercises. buildGroups
 * guards every section with `data.X?.length > 0`, so undefined sections are
 * skipped. */
function buildExport(overrides: Partial<ZoneExport> = {}): ZoneExport {
  return overrides as ZoneExport;
}

const turnstileWidget = {
  sitekey: 'maxconfig-turnstile-0',
  name: 'maxconfig-turnstile',
  domains: ['example.com'],
  mode: 'managed',
  region: 'world',
  bot_fight_mode: false,
  offlabel: false,
  created_on: '',
  modified_on: '',
};

const d1Db = { uuid: 'maxconfig-d1-0', name: 'maxconfig-d1', num_tables: 0 };

describe('buildGroups — item-level disable gating', () => {
  function turnstileItem(conflictStrategy: 'skip' | 'overwrite' | undefined) {
    const data = buildExport({ turnstileWidgets: [turnstileWidget] as any });
    // A widget with the SAME name already exists on the destination account.
    const groups = buildGroups(data, undefined, ['maxconfig-turnstile'], undefined, undefined, conflictStrategy);
    return groups.find((g) => g.key === 'turnstileWidgets')!.items[0];
  }

  it('disables a duplicate-named widget when strategy is undefined (init default)', () => {
    const item = turnstileItem(undefined);
    expect(item.disabled).toBe(true);
    expect(item.disabledReason).toMatch(/already exists/i);
  });

  it('disables a duplicate-named widget when strategy is "skip"', () => {
    expect(turnstileItem('skip').disabled).toBe(true);
  });

  it('does NOT disable a duplicate-named widget when strategy is "overwrite"', () => {
    expect(turnstileItem('overwrite').disabled).toBeFalsy();
  });
});

describe('computeDefaultSelections — MaxConfig (allOn) threading', () => {
  it('selects a duplicate-named Turnstile widget when allOn + overwrite (the fix)', () => {
    const data = buildExport({ turnstileWidgets: [turnstileWidget] as any });
    const sel = computeDefaultSelections(data, undefined, ['maxconfig-turnstile'], true, 'overwrite');
    expect(sel.turnstileWidgets['maxconfig-turnstile-0']).toBe(true);
  });

  it('does NOT select the duplicate widget under allOn when strategy is "skip" (the bug)', () => {
    // Reproduces the pre-fix symptom: init built groups with 'skip', so the
    // duplicate widget was disabled and allOn could not turn it on.
    const data = buildExport({ turnstileWidgets: [turnstileWidget] as any });
    const sel = computeDefaultSelections(data, undefined, ['maxconfig-turnstile'], true, 'skip');
    expect(sel.turnstileWidgets['maxconfig-turnstile-0']).toBe(false);
  });

  // #15: D1 databases are no longer gated behind a per-db "I understand schema
  // and data must be migrated manually" acknowledgement. They are freely
  // selectable and created empty; the schema/data copy is post-migration work
  // (Apply step). So `allOn` selects a D1 db whether or not any d1Configs ack
  // is supplied — the ack no longer affects the disabled state.
  it('selects a D1 db under allOn with no acknowledgement (D1 is no longer gated)', () => {
    const data = buildExport({ d1Databases: [d1Db] as any });
    const sel = computeDefaultSelections(data, undefined, undefined, true, 'overwrite');
    expect(sel.d1Databases['maxconfig-d1-0']).toBe(true);
  });

  it('still selects a D1 db under allOn when a (now-ignored) ack is passed', () => {
    const data = buildExport({ d1Databases: [d1Db] as any });
    const sel = computeDefaultSelections(data, undefined, undefined, true, 'overwrite', {
      'maxconfig-d1-0': { acknowledged: true },
    });
    expect(sel.d1Databases['maxconfig-d1-0']).toBe(true);
  });

  // #15: Durable Object namespaces are no longer gated behind "enable migration
  // + provide object names". The namespace is created when the worker deploys;
  // state migration config is optional. So `allOn` selects a DO item with no
  // config supplied.
  it('selects a Durable Object item under allOn with no config (DO is no longer gated)', () => {
    const data = buildExport({
      durableObjectNamespaces: [
        { id: 'do-0', name: 'Counter', class: 'Counter', script: 'maxworker' },
      ] as any,
    });
    const sel = computeDefaultSelections(data, undefined, undefined, true, 'overwrite');
    expect(sel.durableObjects['maxworker']).toBe(true);
  });

  it('defaults zone-scoped items on and account-scoped items off when not allOn', () => {
    const data = buildExport({
      dnsRecords: [{ id: 'dns1', type: 'A', name: 'a.example.com', content: '1.1.1.1', proxied: false }] as any,
      kvNamespaces: [{ id: 'kv1', title: 'ns' }] as any,
    });
    const sel = computeDefaultSelections(data, undefined, undefined, false);
    expect(sel.dnsRecords['dns1']).toBe(true);    // zone-scoped → on
    expect(sel.kvNamespaces['kv1']).toBe(false);  // account-scoped → off
  });
});
