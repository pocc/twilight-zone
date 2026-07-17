import React, { useEffect, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { getSpecStatus, type SpecStatus } from '../lib/api';

/**
 * Monitor-health note, driven by the hourly spec-drift monitor
 * (/api/spec-status).
 *
 * Coverage *drift* — Cloudflare has added write endpoints not yet in our
 * committed baseline — is deliberately NOT surfaced as a loud red banner here.
 * Drift is a maintainer signal, not something an end user running a migration
 * can act on or needs to worry about: the migration works regardless, and the
 * fix (regenerate the manifest + re-triage) is ours, not theirs. It is surfaced
 * quietly by the always-visible header line (CoverageStatusLine), whose
 * fraction (e.g. "493/545") drops below full when out of sync and whose count
 * links to a calm modal explaining the shortfall — no status icon, no alarm.
 *
 * This component therefore stays silent in the healthy case AND in the drift
 * case. It only speaks up for a genuine monitor *error* — the drift check
 * itself never completed a successful run — which is an infra problem worth a
 * quiet amber note. Renders nothing otherwise.
 */
export function SpecDriftBanner() {
  const [status, setStatus] = useState<SpecStatus | null>(null);

  useEffect(() => {
    let alive = true;
    getSpecStatus()
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { /* endpoint unavailable (old deploy / local dev) — stay silent */ });
    return () => { alive = false; };
  }, []);

  if (!status) return null;

  // Only surface a genuine first-run monitor error (the drift check has never
  // completed a successful run). Drift itself is reported quietly by the
  // header CoverageStatusLine fraction + modal — see the note above — so we
  // never render a loud "endpoints missing" alarm that users can't act on.
  if (!status.lastSuccessfulCheck && !status.ok && status.error) {
    return (
      <div
        role="status"
        className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300 flex items-center gap-2"
      >
        <Warning size={18} weight="fill" aria-hidden="true" />
        <span>API endpoint monitor could not complete its first check — {status.error}.</span>
      </div>
    );
  }

  return null;
}
