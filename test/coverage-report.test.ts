import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('coverage-report.mjs', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'generate:sdk-index'], { stdio: 'inherit' });
    execFileSync('npm', ['run', 'generate:tz-coverage'], { stdio: 'inherit' });
  }, 60_000);

  it('classifies every in-scope endpoint: no untriaged gaps or newer_subfeature placeholders remain', () => {
    const output = execFileSync('node', ['scripts/coverage-report.mjs', '--gaps'], {
      encoding: 'utf8',
    });

    // `newer_subfeature` is a "triaged but unsupported" placeholder that still
    // counts as a gap (see GAP_OVERRIDE_REASONS, asserted below). After the
    // 2026-05 triage every such endpoint was either implemented or given a
    // concrete exclusion reason, so none should linger.
    expect(output).not.toContain('newer_subfeature');
    // Every in-scope mutating endpoint is now implemented or formally excluded.
    expect(output).toContain('Real gaps:                      0');
  });

  it('does not keep override metadata on implemented endpoints', () => {
    const output = execFileSync('node', ['scripts/coverage-report.mjs', '--json'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const report = JSON.parse(output) as {
      endpoints: { status: string; override?: unknown; method: string; path: string }[];
    };

    const implementedWithOverrides = report.endpoints
      .filter(endpoint => endpoint.status === 'implemented' && endpoint.override)
      .map(endpoint => `${endpoint.method} ${endpoint.path}`);

    expect(implementedWithOverrides).toEqual([]);
  });

  it('does not document self-redirection for coverage override seeding', () => {
    const packageJson = readFileSync('package.json', 'utf8');
    const seeder = readFileSync('scripts/seed-coverage-overrides.mjs', 'utf8');

    expect(packageJson).not.toContain('> scripts/coverage-overrides.json');
    expect(seeder).not.toContain('> scripts/coverage-overrides.json');
  });

  it('keeps CLI and UI coverage generators aligned on gap override reasons', () => {
    const report = readFileSync('scripts/coverage-report.mjs', 'utf8');
    const snapshot = readFileSync('scripts/generate-coverage-snapshot.mjs', 'utf8');

    expect(report).toContain("new Set(['newer_subfeature'])");
    expect(snapshot).toContain("new Set(['newer_subfeature'])");
  });
});
