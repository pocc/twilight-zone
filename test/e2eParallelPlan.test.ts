import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain ESM planning module, no types needed.
import {
  isAccountScoped,
  partitionTests,
  perSlotRateLimit,
  ACCOUNT_SCOPED_SECTIONS,
} from '../scripts/e2e-parallel-plan.mjs';

describe('isAccountScoped', () => {
  it('true when metadata.selectAccountScoped is set', () => {
    expect(isAccountScoped({ metadata: { selectAccountScoped: true } })).toBe(true);
  });
  it('true when an account-scoped section has entries', () => {
    expect(isAccountScoped({ kv_namespaces: [{ title: 'x' }] })).toBe(true);
    expect(isAccountScoped({ access_apps: [{ name: 'a' }] })).toBe(true);
    expect(isAccountScoped({ workers: [{ name: 'w' }] })).toBe(true);
  });
  it('false for a zone-only config (DNS/settings)', () => {
    expect(isAccountScoped({ dns_records: [{ type: 'A' }], zone_settings: { ssl: 'full' } })).toBe(false);
  });
  it('treats empty account sections as not account-scoped', () => {
    expect(isAccountScoped({ kv_namespaces: [], workers: [] })).toBe(false);
  });
  it('all declared sections are non-empty strings', () => {
    for (const s of ACCOUNT_SCOPED_SECTIONS) expect(typeof s).toBe('string');
  });
});

describe('partitionTests', () => {
  const items = [
    { rank: 1, accountScoped: true },
    { rank: 2, accountScoped: true },
    { rank: 3, accountScoped: false },
    { rank: 4, accountScoped: false },
    { rank: 5, accountScoped: false },
  ];

  it('concurrency 1 → single bucket, ascending order (sequential)', () => {
    expect(partitionTests(items, 1)).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('places ALL account-scoped tests on slot 0 (shared-account safety)', () => {
    const buckets = partitionTests(items, 3);
    expect(buckets).toHaveLength(3);
    // account-scoped 1 & 2 must both be on slot 0 (serialized).
    expect(buckets[0]).toContain(1);
    expect(buckets[0]).toContain(2);
    // no account-scoped rank appears on any other slot.
    expect(buckets[1]).not.toContain(1);
    expect(buckets[1]).not.toContain(2);
    expect(buckets[2]).not.toContain(1);
    expect(buckets[2]).not.toContain(2);
  });

  it('fans zone-scoped tests across the non-account slots', () => {
    const buckets = partitionTests(items, 3);
    const zoneRanks = [...buckets[1], ...buckets[2]].sort();
    expect(zoneRanks).toEqual([3, 4, 5]);
    expect(buckets[0]).not.toContain(3);
  });

  it('uses all slots for zone tests when there are no account-scoped tests', () => {
    const zoneOnly = [
      { rank: 10, accountScoped: false },
      { rank: 11, accountScoped: false },
      { rank: 12, accountScoped: false },
    ];
    const buckets = partitionTests(zoneOnly, 3);
    const flat = buckets.flat().sort((a, b) => a - b);
    expect(flat).toEqual([10, 11, 12]);
    // round-robin across all 3 slots → one each.
    expect(buckets.every(b => b.length === 1)).toBe(true);
  });

  it('every input rank lands in exactly one bucket (no loss, no dupes)', () => {
    const buckets = partitionTests(items, 4);
    const flat = buckets.flat().sort((a, b) => a - b);
    expect(flat).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(flat).size).toBe(flat.length);
  });
});

describe('perSlotRateLimit', () => {
  it('divides the total budget across slots', () => {
    expect(perSlotRateLimit(1)).toBe(1000);
    expect(perSlotRateLimit(2)).toBe(500);
    expect(perSlotRateLimit(4)).toBe(250);
  });
  it('floors so a slot still progresses', () => {
    expect(perSlotRateLimit(10)).toBe(200); // 1000/10=100 < floor 200
  });
  it('respects a custom total', () => {
    expect(perSlotRateLimit(2, 1200)).toBe(600);
  });
});
