import { describe, it, expect } from 'vitest';
import { generateReportMarkdown } from '../src/migrate/report-markdown';
import type { MigrationReport } from '../src/types';

function makeReport(over: Partial<MigrationReport>): MigrationReport {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    sourceZone: 'src.example',
    destZone: 'dst.example',
    destAccountId: 'acct',
    summary: { total: 0, success: 0, failed: 0, skipped: 0 },
    sections: [],
    errors: [],
    conflicts: [],
    warnings: [],
    manualActions: [],
    newNameservers: [],
    ...over,
  };
}

describe('generateReportMarkdown', () => {
  // Bug 4: the on-screen Results page leads with the verification (read-back)
  // numbers, but the downloaded report previously showed ONLY the migration
  // summary — so the two artifacts disagreed on the totals. The report must
  // now include both reckonings, clearly labelled.
  describe('verification (read-back) summary — Bug 4', () => {
    it('renders the validation summary table when validation is present', () => {
      const md = generateReportMarkdown(makeReport({
        summary: { total: 266, success: 106, failed: 12, skipped: 14, acknowledged: 134 },
        validation: {
          timestamp: 'now',
          sections: [],
          summary: { total: 219, verified: 80, missing: 0, mismatched: 0, acknowledged: 127, unverified: 0 },
        },
      }));
      expect(md).toContain('## Verification (read-back from destination)');
      // Both reckonings appear, so the report and UI no longer disagree silently.
      expect(md).toMatch(/\| Total Resources \| 266 \|/);   // migration summary
      expect(md).toMatch(/\| Checked \| 219 \|/);            // verification summary
      expect(md).toMatch(/\| Verified \| 80 \|/);
      expect(md).toMatch(/\| Acknowledged \| 127 \|/);
      expect(md).toMatch(/\| Unverified \(read-back failed\) \| 0 \|/);
    });

    it('omits the verification section entirely when no validation ran', () => {
      const md = generateReportMarkdown(makeReport({}));
      expect(md).not.toContain('## Verification (read-back from destination)');
    });
  });

  // C3: a systemic failure (e.g. 9 git-backed Pages projects returning the
  // identical error) used to render as 9 near-identical blocks. They must
  // collapse into ONE block that enumerates the affected items.
  describe('error grouping/dedupe — C3', () => {
    it('collapses errors sharing a resource + message into a single block listing all names', () => {
      const sameError = 'There is an internal issue with your Cloudflare Pages Git installation.';
      const md = generateReportMarkdown(makeReport({
        summary: { total: 3, success: 0, failed: 3, skipped: 0 },
        errors: [
          { resource: 'Pages Projects', name: 'ross-gg', error: sameError, suggestion: 'Reconnect repo', category: 'api' },
          { resource: 'Pages Projects', name: 'tshark-dev', error: sameError, suggestion: 'Reconnect repo', category: 'api' },
          { resource: 'Pages Projects', name: 'har2html', error: sameError, suggestion: 'Reconnect repo', category: 'api' },
        ],
      }));
      // Exactly one block, with a count and an enumerated Affected list.
      const blockCount = (md.match(/### Pages Projects \(3\)/g) || []).length;
      expect(blockCount).toBe(1);
      expect(md).toContain('**Affected (3):** ross-gg, tshark-dev, har2html');
      // The error message itself appears once, not three times.
      expect((md.match(/internal issue with your Cloudflare Pages Git installation/g) || []).length).toBe(1);
    });

    it('keeps distinct errors as separate blocks', () => {
      const md = generateReportMarkdown(makeReport({
        summary: { total: 2, success: 0, failed: 2, skipped: 0 },
        errors: [
          { resource: 'Workers', name: 'w1', error: 'error A', category: 'api' },
          { resource: 'Workers', name: 'w2', error: 'error B', category: 'api' },
        ],
      }));
      expect(md).toContain('error A');
      expect(md).toContain('error B');
      // Two distinct messages → two single-item blocks (not collapsed).
      expect(md).toContain('### Workers: w1');
      expect(md).toContain('### Workers: w2');
    });
  });
});
