/**
 * Renders the optional "Identity provider login tests" subsection
 * appended to migration_report.md at download time when the user has
 * clicked at least one IdP Test button on Step 4.
 *
 * The main migration report is generated server-side in
 * `src/migrate/report-markdown.ts` immediately after the migration
 * completes - before the user has any chance to test logins. The test
 * results are user-attested via the Step 4 "Test Configuration" card
 * and live only in browser state (see `idpTestResults` in
 * `app/App.tsx`).
 *
 * This module bridges the two: at download time, we take the
 * server-generated markdown and the in-browser test state, and emit
 * a final report that includes test outcomes.
 *
 * Rules:
 *   • If zero IdPs were migrated → no subsection (nothing to test).
 *   • If at least one IdP migrated but zero tests clicked → no
 *     subsection. We don't want to nag the user with a "you didn't
 *     test" warning; the report stays clean.
 *   • If any test was clicked → render a subsection listing every
 *     migrated IdP with its outcome (`tested OK`, `failed`, or
 *     `not tested` for IdPs the user didn't get to).
 *
 * Pure function. No DOM, no I/O. Easy to unit-test.
 */

import type { MigrationReport } from '../../src/types';

export type IdpTestResult = 'ok' | 'failed';
export type IdpTestResults = Record<string, IdpTestResult>;

/**
 * Append the optional IdP test subsection to a pre-generated
 * markdown report. Returns the original markdown unchanged when
 * there's nothing to append.
 */
export function appendIdpTestSubsection(
  reportMarkdown: string,
  report: MigrationReport | null,
  testResults: IdpTestResults,
): string {
  if (!report) return reportMarkdown;
  const migrated = report.migratedIdentityProviders ?? [];
  if (migrated.length === 0) return reportMarkdown;

  // Did the user click at least one test result button? If not, omit
  // the section entirely - testing is opt-in.
  const clicked = Object.keys(testResults).length;
  if (clicked === 0) return reportMarkdown;

  const lines: string[] = [
    '',
    '## Optional verification',
    '',
    '### Identity provider login tests',
    '',
    'The migration tool cannot validate OAuth `client_secret` values',
    'without a real login attempt. The outcomes below are user-attested',
    'after clicking the per-IdP Test login button on Step 4.',
    '',
  ];

  for (const idp of migrated) {
    const outcome = testResults[idp.destId];
    let icon: string;
    let label: string;
    if (outcome === 'ok') {
      icon = '✅';
      label = 'login tested OK';
    } else if (outcome === 'failed') {
      icon = '❌';
      label = 'login failed - re-supply client_secret and re-migrate this IdP';
    } else {
      icon = '🟡';
      label = 'not tested';
    }
    lines.push(`- **${idp.name}** (${idp.type}): ${icon} ${label}`);
  }
  lines.push('');

  // Trim trailing whitespace on the original to make the join clean.
  return reportMarkdown.trimEnd() + '\n' + lines.join('\n');
}
