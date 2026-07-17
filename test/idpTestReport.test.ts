/**
 * Tests for app/lib/idpTestReport.ts — appends the optional
 * "Identity provider login tests" subsection to migration_report.md
 * at download time when the user has clicked at least one IdP test
 * outcome button on Step 4.
 *
 * Rules under test:
 *   • Zero IdPs migrated → subsection omitted.
 *   • IdPs migrated, zero tests clicked → subsection omitted
 *     (testing is opt-in extra credit, not a requirement).
 *   • Any test clicked → full subsection rendered with every
 *     migrated IdP listed and its outcome.
 *   • Untested IdPs render as 🟡 not tested (not as a failure).
 *   • The original markdown is returned unchanged when the
 *     subsection is omitted (no extra whitespace, no stray newline).
 */

import { describe, it, expect } from 'vitest';
import { appendIdpTestSubsection } from '../app/lib/idpTestReport';
import type { MigrationReport } from '../src/types';

function makeReport(
  overrides: Partial<MigrationReport> = {},
): MigrationReport {
  // Minimal MigrationReport — only the fields appendIdpTestSubsection
  // actually reads. Real reports have many more fields but the helper
  // is pure-data-in / pure-string-out.
  return {
    timestamp: '2026-05-25T00:00:00.000Z',
    sourceZone: 'src.example.com',
    destZone: 'dst.example.com',
    destAccountId: 'acc-1',
    summary: { total: 0, success: 0, failed: 0, skipped: 0 },
    sections: [],
    errors: [],
    conflicts: [],
    warnings: [],
    manualActions: [],
    newNameservers: [],
    ...overrides,
  };
}

const BASE_MARKDOWN = '# Zone Migration Report\n\n## Summary\n\nWhatever.\n';

describe('appendIdpTestSubsection', () => {
  it('returns the original markdown unchanged when report is null', () => {
    const out = appendIdpTestSubsection(BASE_MARKDOWN, null, {});
    expect(out).toBe(BASE_MARKDOWN);
  });

  it('returns the original markdown when no IdPs were migrated', () => {
    const report = makeReport();
    // Note: even with test results in state (somehow), no migrated
    // IdPs means there's nothing to test against.
    const out = appendIdpTestSubsection(BASE_MARKDOWN, report, { 'stale-id': 'ok' });
    expect(out).toBe(BASE_MARKDOWN);
  });

  it('returns the original markdown when IdPs migrated but no tests clicked', () => {
    const report = makeReport({
      migratedIdentityProviders: [
        { destId: 'id-1', name: 'My OIDC IdP', type: 'oidc' },
      ],
    });
    const out = appendIdpTestSubsection(BASE_MARKDOWN, report, {});
    expect(out).toBe(BASE_MARKDOWN);
    // Belt-and-suspenders: no "Optional verification" should appear.
    expect(out).not.toContain('Optional verification');
  });

  it('appends the subsection when at least one IdP was tested', () => {
    const report = makeReport({
      migratedIdentityProviders: [
        { destId: 'id-1', name: 'My OIDC IdP', type: 'oidc' },
      ],
    });
    const out = appendIdpTestSubsection(BASE_MARKDOWN, report, { 'id-1': 'ok' });
    expect(out).toContain('## Optional verification');
    expect(out).toContain('### Identity provider login tests');
    expect(out).toContain('**My OIDC IdP** (oidc): ✅ login tested OK');
  });

  it('marks failed IdPs with a clear re-supply hint', () => {
    const report = makeReport({
      migratedIdentityProviders: [
        { destId: 'id-1', name: 'Broken IdP', type: 'oidc' },
      ],
    });
    const out = appendIdpTestSubsection(BASE_MARKDOWN, report, { 'id-1': 'failed' });
    expect(out).toContain('❌ login failed');
    expect(out).toContain('re-supply');
  });

  it('marks untested IdPs as 🟡 not tested (not as failure) when subsection is rendered', () => {
    // Two IdPs migrated, only one tested. The untested one must
    // appear in the list as "not tested" — it would be misleading
    // to omit it. Important: 🟡 not ❌. Untested != failed.
    const report = makeReport({
      migratedIdentityProviders: [
        { destId: 'id-1', name: 'Tested IdP', type: 'oidc' },
        { destId: 'id-2', name: 'Untested IdP', type: 'okta' },
      ],
    });
    const out = appendIdpTestSubsection(BASE_MARKDOWN, report, { 'id-1': 'ok' });
    expect(out).toContain('**Tested IdP** (oidc): ✅ login tested OK');
    expect(out).toContain('**Untested IdP** (okta): 🟡 not tested');
    // Untested is not failed.
    expect(out).not.toContain('**Untested IdP** (okta): ❌');
  });

  it('handles a mix of ok, failed, and untested in one subsection', () => {
    const report = makeReport({
      migratedIdentityProviders: [
        { destId: 'a', name: 'A', type: 'oidc' },
        { destId: 'b', name: 'B', type: 'okta' },
        { destId: 'c', name: 'C', type: 'azureAD' },
      ],
    });
    const out = appendIdpTestSubsection(BASE_MARKDOWN, report, {
      a: 'ok',
      b: 'failed',
      // c not tested
    });
    expect(out).toContain('**A** (oidc): ✅');
    expect(out).toContain('**B** (okta): ❌');
    expect(out).toContain('**C** (azureAD): 🟡 not tested');
  });

  it('preserves the original markdown content above the subsection', () => {
    const report = makeReport({
      migratedIdentityProviders: [{ destId: 'id-1', name: 'X', type: 'oidc' }],
    });
    const out = appendIdpTestSubsection(BASE_MARKDOWN, report, { 'id-1': 'ok' });
    expect(out.startsWith('# Zone Migration Report')).toBe(true);
    // Original Summary section still present.
    expect(out).toContain('## Summary');
    // New subsection comes AFTER everything original.
    const optIdx = out.indexOf('## Optional verification');
    const sumIdx = out.indexOf('## Summary');
    expect(optIdx).toBeGreaterThan(sumIdx);
  });

  it('does not introduce a CRITICAL banner regardless of test outcome mix', () => {
    // Principle 1 / design contract: the report's top-level summary
    // is unchanged by test state. No CRITICAL warning is ever added,
    // even with all-failed tests.
    const report = makeReport({
      migratedIdentityProviders: [
        { destId: 'a', name: 'A', type: 'oidc' },
        { destId: 'b', name: 'B', type: 'okta' },
      ],
    });
    const out = appendIdpTestSubsection(BASE_MARKDOWN, report, {
      a: 'failed',
      b: 'failed',
    });
    expect(out).not.toContain('CRITICAL');
  });
});
