import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM helper used by the Playwright harness.
import { assertZoneSingletonSettingsMatch, assertNoUnexpectedFailures } from '../scripts/e2e-assertions.mjs';

function writeEnvelope(dir: string, name: string, result: unknown) {
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ result }, null, 2));
}

function makeEvidenceDir() {
  const root = mkdtempSync(path.join(tmpdir(), 'tz-e2e-assertions-'));
  const src = path.join(root, 'source-state-post-seed');
  const dst = path.join(root, 'dest-state-post-migrate');
  mkdirSync(src);
  mkdirSync(dst);
  return { root, src, dst };
}

describe('assertZoneSingletonSettingsMatch', () => {
  it('compares migrated singleton setting fields source-to-destination', () => {
    const { root, src, dst } = makeEvidenceDir();
    writeEnvelope(src, 'managed_headers', {
      managed_request_headers: [{ id: 'add_true_client_ip_headers', enabled: true }],
      managed_response_headers: [{ id: 'remove_x_powered_by_header', enabled: true }],
    });
    writeEnvelope(dst, 'managed_headers', {
      managed_request_headers: [{ id: 'add_true_client_ip_headers', enabled: true }],
      managed_response_headers: [{ id: 'remove_x_powered_by_header', enabled: true }],
    });
    writeEnvelope(src, 'url_normalization', { type: 'cloudflare', scope: 'incoming' });
    writeEnvelope(dst, 'url_normalization', { type: 'cloudflare', scope: 'incoming' });

    const result = assertZoneSingletonSettingsMatch(root);

    expect(result.passed).toBe(true);
    expect(result.reason).toContain('2 singleton setting subsystem(s)');
  });

  it('fails when a source singleton setting is missing on destination', () => {
    const { root, src, dst } = makeEvidenceDir();
    writeEnvelope(src, 'cache_reserve', { id: 'cache_reserve', value: 'on' });
    writeEnvelope(dst, 'cache_reserve', []);

    const result = assertZoneSingletonSettingsMatch(root);

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('MISSING');
    expect(result.reason).toContain('Cache Reserve');
  });

  it('allows an explicitly acknowledged plan-gated singleton mismatch', () => {
    const { root, src, dst } = makeEvidenceDir();
    writeEnvelope(src, 'smart_shield', { argo_smart_routing: true });
    writeEnvelope(dst, 'smart_shield', { argo_smart_routing: false });
    writeFileSync(path.join(root, 'migration-report.md'), 'Smart Shield Settings | 🟡 acknowledged | Upgrade Smart Shield to unlock argo_smart_routing.');

    const result = assertZoneSingletonSettingsMatch(root);

    expect(result.passed).toBe(true);
    expect(result.reason).toContain('acknowledged/plan-gated allowed');
  });

  it('fails when no singleton settings evidence exists', () => {
    const { root } = makeEvidenceDir();

    const result = assertZoneSingletonSettingsMatch(root);

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('no zone singleton settings captured');
  });

  it('fails when captured singleton evidence has no comparable migrated fields', () => {
    const { root, src, dst } = makeEvidenceDir();
    writeEnvelope(src, 'url_normalization', { unexpected_shape: true });
    writeEnvelope(dst, 'url_normalization', { unexpected_shape: true });

    const result = assertZoneSingletonSettingsMatch(root);

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('no comparable singleton setting fields');
  });
});

describe('assertNoUnexpectedFailures', () => {
  function writeReport(body: string) {
    const root = mkdtempSync(path.join(tmpdir(), 'tz-e2e-fail-'));
    writeFileSync(path.join(root, 'migration-report.md'), body);
    return root;
  }

  it('passes when no section reports failed rows', () => {
    const root = writeReport([
      '# Zone Migration Report',
      '### ✅ DNS Records',
      '- **Total:** 5',
      '- **Success:** 5',
      '- **Failed:** 0',
      '### ✅ Pages Projects',
      '- **Total:** 9',
      '- **Success:** 0',
      '- **Failed:** 0',
      '- **Acknowledged:** 9',
    ].join('\n'));
    const result = assertNoUnexpectedFailures(root);
    expect(result.passed).toBe(true);
  });

  it('fails and names sections that report FAILED rows (Principle 1)', () => {
    const root = writeReport([
      '# Zone Migration Report',
      '### ✅ DNS Records',
      '- **Total:** 5',
      '- **Failed:** 0',
      '### ⚠️ Pages Projects',
      '- **Total:** 9',
      '- **Failed:** 9',
    ].join('\n'));
    const result = assertNoUnexpectedFailures(root);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Pages Projects (9 failed)');
    expect(result.reason).not.toContain('DNS Records');
  });

  it('fails when the report is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tz-e2e-fail-none-'));
    const result = assertNoUnexpectedFailures(root);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('no migration-report.md');
  });
});
