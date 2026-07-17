import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM helper used by the Playwright harness.
import { preserveE2eEvidence } from '../scripts/e2e-evidence.mjs';

describe('preserveE2eEvidence', () => {
  it('copies latest-run suite artifacts into a timestamped evidence bundle', () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'tz-e2e-output-'));
    const testDir = path.join(outputDir, 'e15-settings-boundary');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({ results: [{ rank: 15, company: 'SettingsBoundary' }] }));
    writeFileSync(path.join(outputDir, 'report.md'), '# report');
    writeFileSync(path.join(outputDir, 'run-log.txt'), 'log');
    writeFileSync(path.join(testDir, 'source-config.json'), '{"metadata":{"rank":15}}');
    writeFileSync(path.join(testDir, 'migration-report.md'), '# migration');

    const bundleDir = preserveE2eEvidence({
      outputDir,
      timestamp: '2026-06-07T15:40:26.867Z',
    });

    expect(bundleDir).toBe(path.join(outputDir, 'evidence', 'run-2026-06-07T15-40-26-867Z'));
    expect(existsSync(path.join(bundleDir, 'summary.json'))).toBe(true);
    expect(existsSync(path.join(bundleDir, 'report.md'))).toBe(true);
    expect(existsSync(path.join(bundleDir, 'run-log.txt'))).toBe(true);
    expect(existsSync(path.join(bundleDir, 'e15-settings-boundary', 'source-config.json'))).toBe(true);
    expect(existsSync(path.join(bundleDir, 'e15-settings-boundary', 'migration-report.md'))).toBe(true);
  });

  it('does not copy stale per-test directories from previous runs', () => {
    const outputDir = mkdtempSync(path.join(tmpdir(), 'tz-e2e-output-'));
    const currentDir = path.join(outputDir, 'e15-settings-boundary');
    const staleDir = path.join(outputDir, 'e01-everything');
    mkdirSync(currentDir, { recursive: true });
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({ results: [{ rank: 15, company: 'SettingsBoundary' }] }));
    writeFileSync(path.join(outputDir, 'report.md'), '# report');
    writeFileSync(path.join(outputDir, 'run-log.txt'), 'log');
    writeFileSync(path.join(currentDir, 'migration-report.md'), '# current');
    writeFileSync(path.join(staleDir, 'migration-report.md'), '# stale');

    const bundleDir = preserveE2eEvidence({
      outputDir,
      timestamp: '2026-06-07T15:40:26.867Z',
    });

    expect(existsSync(path.join(bundleDir, 'e15-settings-boundary', 'migration-report.md'))).toBe(true);
    expect(existsSync(path.join(bundleDir, 'e01-everything', 'migration-report.md'))).toBe(false);
  });
});
