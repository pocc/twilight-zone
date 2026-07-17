/**
 * Step 4 "Test Configuration" card for end-to-end IdP login validation.
 *
 * Cloudflare cannot validate an OAuth `client_secret` synchronously
 * via the API - the only way to know a secret actually works is for
 * a real user to log in against the dest team domain and have the
 * IdP exchange the authorization code for a token using that secret.
 *
 * This section mirrors the Cloudflare dashboard's "Test" button next
 * to each IdP at Zero Trust → Integrations → Identity providers
 * (https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/#test-idps-in-cloudflare-one).
 * For each IdP the migration tool created on dest, we render:
 *
 *   - A "Test login ↗" button that opens the dest team's Access SSO
 *     URL in a new tab. The user authenticates against their IdP;
 *     Cloudflare Access redirects back to a Cloudflare-served page
 *     on success, or shows an error page on failure.
 *   - "Worked" / "Failed" buttons for the user to self-attest the
 *     outcome after returning to Twilight Zone.
 *
 * The card is COLLAPSED by default. The user clicks "Test
 * Configuration" to expand it. This honours Principle 4: don't force
 * users to interact with something they may not have time/access to
 * do right now. The Step 4 main results table already shows IdPs as
 * ✅ Verified; this section is purely additive.
 *
 * Test state lives at the wizard root in `app/App.tsx` as
 * `idpTestResults: Record<destIdpId, 'ok' | 'failed'>` - in-memory
 * only, cleared on page reload. The report download includes test
 * results as an optional subsection (see `appendIdpTestSubsection`
 * in `app/lib/idpTestReport.ts`).
 *
 * Edge cases:
 *   - No IdPs migrated → component renders nothing.
 *   - IdPs migrated but dest account has no Access org (no
 *     `auth_domain` available) → renders a fallback message instead
 *     of the test buttons. The user is told to set up a team domain
 *     before testing.
 */

import React, { useState } from 'react';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { buildIdpLoginUrl } from '../lib/idpLoginUrl';
import type { MigrationReport } from '../../src/types';
import type { IdpTestResult, IdpTestResults } from '../lib/idpTestReport';

interface Step4IdPTestSectionProps {
  /** Populated by the migration: which IdPs were actually created
   * on dest, plus the dest team's auth_domain. */
  report: MigrationReport | null;
  /** Per-destIdpId user attestations. Lives at wizard root. */
  idpTestResults: IdpTestResults;
  setIdpTestResults: React.Dispatch<React.SetStateAction<IdpTestResults>>;
}

export function Step4IdPTestSection({
  report,
  idpTestResults,
  setIdpTestResults,
}: Step4IdPTestSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const migrated = report?.migratedIdentityProviders ?? [];
  // Nothing to test if no IdPs were created.
  if (migrated.length === 0) return null;

  const authDomain = report?.destAccessOrg?.auth_domain;
  const hasTeamDomain = typeof authDomain === 'string' && authDomain.length > 0;

  function setOutcome(destId: string, outcome: IdpTestResult) {
    setIdpTestResults((prev) => ({ ...prev, [destId]: outcome }));
  }

  return (
    <section
      aria-labelledby="idp-test-section-heading"
      className="mt-8 border border-gray-700 rounded-lg bg-gray-800/50"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="idp-test-section-body"
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/70 transition-colors"
      >
        <div>
          <h2
            id="idp-test-section-heading"
            className="text-base font-medium text-gray-100"
          >
            Optional: verify end-to-end IdP logins
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            Cloudflare cannot verify your <code className="text-gray-300">client_secret</code>{' '}
            values without a real login attempt. Test now if you have time;
            otherwise test before your production cutover.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-medium text-orange-400">
            {expanded ? 'Hide' : 'Test Configuration'}
          </span>
          {expanded ? <CaretUp size={16} /> : <CaretDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div id="idp-test-section-body" className="px-4 pb-4 pt-1">
          {!hasTeamDomain ? (
            <p className="text-sm text-yellow-300 bg-yellow-900/20 border border-yellow-800/50 rounded p-3">
              Destination account does not have an Access team domain
              configured. Set one up at Zero Trust → Settings → Custom
              Pages before testing logins.
            </p>
          ) : (
            <div className="space-y-2">
              {migrated.map((idp) => {
                const url = buildIdpLoginUrl({
                  authDomain: authDomain!,
                  idpType: idp.type,
                  idpId: idp.destId,
                });
                const outcome = idpTestResults[idp.destId];
                return (
                  <div
                    key={idp.destId}
                    className="flex items-center gap-3 p-2 rounded bg-gray-900/40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-100 truncate">
                        {idp.name}
                      </div>
                      <div className="text-xs text-gray-500 uppercase">
                        {idp.type}
                      </div>
                    </div>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-orange-400 hover:text-orange-300 underline whitespace-nowrap"
                      >
                        Test login ↗
                      </a>
                    ) : (
                      <span className="text-xs text-gray-500">
                        (cannot build URL)
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setOutcome(idp.destId, 'ok')}
                        aria-pressed={outcome === 'ok'}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          outcome === 'ok'
                            ? 'bg-green-900/40 border-green-700 text-green-200'
                            : 'border-gray-700 text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        ✓ Worked
                      </button>
                      <button
                        type="button"
                        onClick={() => setOutcome(idp.destId, 'failed')}
                        aria-pressed={outcome === 'failed'}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          outcome === 'failed'
                            ? 'bg-red-900/40 border-red-700 text-red-200'
                            : 'border-gray-700 text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        ✗ Failed
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
