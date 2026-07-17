// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Tests for createProgressTracker().setTotal — the server-side reconciliation
// that keeps the completion headline ("N/total successful") consistent with the
// live progress denominator. The upfront totalItems is only an ESTIMATE of
// write ops; acknowledgment-only sections (deselected groups, capability gaps,
// CNS pool, account-ruleset refs, secondary DNS) are added during the run and
// grow the real total. Without setTotal the run logged "97" upfront then
// "76/129" at the end — two contradictory denominators.

import { describe, it, expect } from 'vitest';
import { createProgressTracker } from '../src/migrate/setup';

describe('createProgressTracker', () => {
  it('reports the estimated total until setTotal reconciles it', () => {
    const lines: Array<{ msg: string; progress?: { current: number; total: number } }> = [];
    const log = (msg: string, progress?: { current: number; total: number }) =>
      lines.push({ msg, progress });

    const t = createProgressTracker(log, 97);
    t.onItemDone();
    t.logWithProgress('mid-run');
    expect(lines.at(-1)?.progress).toEqual({ current: 1, total: 97 });

    // Acknowledgment sections inflated the real total to 129. Reconcile.
    t.setTotal(129);
    t.logWithProgress('complete');
    expect(lines.at(-1)?.progress).toEqual({ current: 1, total: 129 });
  });

  it('setTotal can grow the denominator so current never exceeds total', () => {
    const seen: Array<{ current: number; total: number }> = [];
    const log = (_msg: string, p?: { current: number; total: number }) => {
      if (p) seen.push(p);
    };
    const t = createProgressTracker(log, 2);
    // Simulate more items completing than the upfront estimate.
    t.bumpCompletedItems(5);
    t.setTotal(5);
    t.logWithProgress('done');
    const last = seen.at(-1)!;
    expect(last.current).toBe(5);
    expect(last.total).toBe(5);
    expect(last.current).toBeLessThanOrEqual(last.total);
  });
});
