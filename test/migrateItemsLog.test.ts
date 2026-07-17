// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Regression test for the migrateItems() per-section summary log line.
//
// Bug: items that land as `acknowledged` (manual-action / pre-acknowledged
// entitlement gaps) increment section.acknowledged but NOT success/failed/
// skipped. The summary line previously printed only ok/failed/skipped, so an
// entitlement-gated item read as "1 items ... 0 ok, 0 failed, 0 skipped" — the
// item appeared to vanish. That violates Principle 9 (fail loud / surface
// immediately) and looks like a silent drop. The summary line must surface the
// acknowledged count.

import { describe, it, expect } from 'vitest';
import { migrateItems } from '../src/migrate/migrate-items';
import type { MigrationError } from '../src/types';

describe('migrateItems summary log line', () => {
  it('surfaces acknowledged items in the summary line (no silent drop)', async () => {
    const lines: string[] = [];
    const log = (m: string) => lines.push(m);
    const errors: MigrationError[] = [];

    // A single item whose migrateFn throws an entitlement-gap error that
    // isManualActionError() matches → classified `manual` → acknowledged.
    const section = await migrateItems(
      'Healthchecks',
      [{ id: 'hc1' }],
      async () => {
        throw new Error('health checks disabled for zone: validation failed');
      },
      (it) => it.id,
      errors,
      log,
    );

    expect(section.acknowledged).toBe(1);
    expect(section.success).toBe(0);
    expect(section.failed).toBe(0);
    expect(section.skipped).toBe(0);
    expect(errors).toHaveLength(0);

    const summary = lines.find((l) => l.includes('Healthchecks:') && l.includes('ok'));
    expect(summary, 'summary line should exist').toBeDefined();
    // The headline must account for every item: 1 acknowledged must be shown.
    expect(summary).toContain('1 acknowledged');
    // Sanity: the misleading "0 ok, 0 failed, 0 skipped" with no acknowledged
    // mention must NOT be the whole story.
    expect(summary).toMatch(/0 ok, 1 acknowledged, 0 failed, 0 skipped/);
  });

  it('omits the acknowledged token when there are none (output unchanged)', async () => {
    const lines: string[] = [];
    const log = (m: string) => lines.push(m);
    const errors: MigrationError[] = [];

    const section = await migrateItems(
      'DNS Records',
      [{ id: 'a' }, { id: 'b' }],
      async () => {
        /* success */
      },
      (it) => it.id,
      errors,
      log,
    );

    expect(section.success).toBe(2);
    const summary = lines.find((l) => l.includes('DNS Records:') && l.includes('ok'));
    expect(summary).toBe('  ✓ DNS Records: 2 ok, 0 failed, 0 skipped');
    expect(summary).not.toContain('acknowledged');
  });
});
