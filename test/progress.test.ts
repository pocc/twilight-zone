import { describe, it, expect } from 'vitest';
import { progressPct } from '../app/lib/progress';

describe('progressPct', () => {
  it('computes a normal percentage', () => {
    expect(progressPct(0, 100)).toBe(0);
    expect(progressPct(25, 100)).toBe(25);
    expect(progressPct(50, 200)).toBe(25);
    expect(progressPct(100, 100)).toBe(100);
  });

  it('rounds to the nearest integer', () => {
    expect(progressPct(1, 3)).toBe(33);
    expect(progressPct(2, 3)).toBe(67);
  });

  it('clamps above 100% — the 366% regression', () => {
    // current legitimately outruns the estimated total (account rulesets,
    // phase entrypoints, auto-created storage deps, acknowledged singletons).
    expect(progressPct(366, 100)).toBe(100);
    expect(progressPct(11, 3)).toBe(100);
  });

  it('clamps below 0%', () => {
    expect(progressPct(-5, 100)).toBe(0);
  });

  it('returns 0 for a zero or negative total', () => {
    expect(progressPct(0, 0)).toBe(0);
    expect(progressPct(5, 0)).toBe(0);
    expect(progressPct(5, -10)).toBe(0);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(progressPct(NaN, 100)).toBe(0);
    expect(progressPct(5, NaN)).toBe(0);
    expect(progressPct(Infinity, 100)).toBe(0);
  });
});
