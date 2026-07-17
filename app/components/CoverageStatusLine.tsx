import React, { useEffect, useState } from 'react';
import { getSpecStatus, type SpecStatus } from '../lib/api';
import { coverageSummary } from '../lib/coverageSummary';
import { InfoModal, ModalSectionHeading } from './InfoModal';

// Compact, always-visible coverage line in the header, just below the
// About / Security / Coverage / maker links. It reports how many in-scope
// ("zone-affecting") writeable endpoints are SETTLED — i.e. each one is either
// implemented or deliberately excluded, with no unresolved gaps — out of the
// total in-scope set.
//
// DELIBERATELY UNDERSTATED. There is no check/X status icon and no red "below
// 100%" alarm: coverage drift (Cloudflare adding write endpoints not yet in our
// committed baseline) is a maintainer signal, not a user-actionable alarm. The
// migration works regardless, and the fix (regenerate the manifest + re-triage)
// is ours, not the user's. A red X in the header would erode trust in the
// platform over something the user can neither see the relevance of nor act on.
// Instead, the count itself is a quiet link: clicking it opens a calm modal
// that explains the numbers and lists any newly-added endpoints for the curious,
// without scaring the 99% for whom the raw drift data is noise.
//
// The static coverage snapshot (coverageSummary, frozen at build time) only
// knows the endpoints that existed at the last regen; the live monitor
// (/api/spec-status) knows whether Cloudflare has ADDED endpoints since. We fold
// the live drift count into the denominator: when the monitor reports drift,
// those new endpoints are untriaged and count as UNSETTLED, so the denominator
// grows by exactly the drift count (e.g. "493/545"). The shortfall is explained,
// not alarmed.
//
// NOTE on numbers (these are different denominators — don't conflate):
//   - implemented             : endpoints the migration actually writes.
//   - excluded                : IN-SCOPE but deliberately not migrated
//                               (data-plane, one-shot admin, redundant). NOT
//                               "out of scope" — they still count as in-scope.
//   - gap                     : in-scope, unresolved (neither done nor excluded).
//   = in_scope_writes         : implemented + excluded + gap. The base denominator.
//   settled = implemented + excluded = in_scope_writes − gap : the numerator.
//   - drift (live)            : new write endpoints in the live spec absent
//                               from our baseline — untriaged, so added to the
//                               denominator as unsettled until triaged.
//   - liveCount               : every writeable endpoint in the live spec — the
//                               full surface, shown only inside the modal.

const CF_OPENAPI_SPEC_URL = 'https://github.com/cloudflare/api-schemas/blob/main/openapi.json';

// "Settled / in-scope": every in-scope endpoint that's accounted for (coded or
// deliberately excluded) over the full in-scope set, from the static snapshot.
// SETTLED is the numerator; the denominator is widened at runtime by any live
// drift (see below), so these stay the build-time base values.
const SETTLED = coverageSummary.totals.in_scope_writes - coverageSummary.totals.gap;
const BASE_IN_SCOPE = coverageSummary.totals.in_scope_writes;

// Local-timezone stamp: 3-letter month + non-padded day + local HH:mm +
// local timezone abbreviation (e.g. "Jun 7 17:00 CST").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Short timezone name for the viewer's locale (e.g. "CST", "GMT+2"); empty
// string if the runtime can't resolve one.
function localTzAbbrev(d: Date): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d);
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}
function fmtLocalStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const p = (n: number) => String(n).padStart(2, '0');
  const tz = localTzAbbrev(d);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}${tz ? ` ${tz}` : ''}`;
}

export function CoverageStatusLine() {
  const [status, setStatus] = useState<SpecStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getSpecStatus()
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { /* endpoint unavailable — fall back to the snapshot date */ });
    return () => { alive = false; };
  }, []);

  // "Last checked" = the hourly spec-drift monitor's most recent successful run
  // (the thing that verifies Cloudflare hasn't added endpoints that would create
  // new gaps); before it has run, fall back to when the coverage snapshot was
  // generated. The base numbers are static (from the snapshot) so the line
  // renders immediately; once the monitor's status arrives, live drift widens
  // the denominator below.
  const checked = fmtLocalStamp(status?.lastSuccessfulCheck ?? coverageSummary.generated_at);

  // Fold live drift into the count. Untriaged new endpoints are unsettled, so
  // they grow the denominator by exactly the drift count. Before the monitor
  // responds (status null), drift is 0 and we show the static snapshot verdict.
  const newEndpoints = status?.drift ? status.newEndpoints : [];
  const driftCount = newEndpoints.length;
  const inScope = BASE_IN_SCOPE + driftCount;

  // Newline-joined list the maintainer can paste straight into a triage session
  // (mirrors the old spec-drift banner's copyable endpoint list).
  const endpointList = newEndpoints.join('\n');
  const copyEndpoints = () => {
    navigator.clipboard?.writeText(endpointList).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => { /* clipboard blocked — the list is still selectable in the block */ },
    );
  };

  return (
    <p className="mt-1 text-[10px] leading-tight text-gray-400">
      {/* The count itself is the only affordance — a quiet link, no status icon,
          no colour alarm. Clicking opens the explanation modal. Styled to match
          the adjacent "Cloudflare OpenAPI Spec" link. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-orange-400/70 hover:text-orange-400 underline underline-offset-2 transition cursor-pointer"
        aria-label={`${SETTLED} of ${inScope} in-scope endpoints settled — open coverage detail`}
      >
        {SETTLED}/{inScope}
      </button>{' '}in-scope{' '}
      <a
        href={CF_OPENAPI_SPEC_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-orange-400/70 hover:text-orange-400 underline underline-offset-2 transition"
      >
        Cloudflare OpenAPI Spec
      </a>{' '}
      endpoints as of {checked}

      <InfoModal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Coverage"
        title="Cloudflare OpenAPI spec coverage"
      >
        <p>
          Twilight Zone tracks the{' '}
          <strong className="text-gray-100">{inScope}</strong> Cloudflare OpenAPI
          write endpoints that can change how a zone&apos;s traffic is served. Of
          those, <strong className="text-gray-100">{SETTLED}</strong> are{' '}
          <em>settled</em> — either implemented by the migration or deliberately
          out of scope for an account-to-account move (account administration,
          Zero Trust, Magic Transit, AI inference, one-shot actions, and the
          like).
        </p>

        {driftCount > 0 && (
          <div>
            <ModalSectionHeading>Endpoints to triage ({driftCount})</ModalSectionHeading>
            <p>
              Cloudflare has added{' '}
              <strong className="text-gray-100">{driftCount}</strong> write
              endpoint{driftCount === 1 ? '' : 's'} since this build&apos;s
              baseline. They&apos;re queued for triage and don&apos;t affect any
              migration you run today. As the maintainer, copy the list below and
              run <code className="text-gray-200">npm run triage:endpoints</code>{' '}
              to classify and scaffold them.
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
              <dt className="text-gray-500">Baseline generated</dt>
              <dd>{fmtLocalStamp(status!.manifestGeneratedAt)}</dd>
              {status?.specCommitDate && (
                <>
                  <dt className="text-gray-500">Spec last changed upstream</dt>
                  <dd>{fmtLocalStamp(status.specCommitDate)}</dd>
                </>
              )}
              {typeof status?.liveCount === 'number' && (
                <>
                  <dt className="text-gray-500">Drift</dt>
                  <dd>{driftCount} of {status.liveCount} total write endpoints</dd>
                </>
              )}
            </dl>
            <div className="relative mt-2">
              <button
                type="button"
                onClick={copyEndpoints}
                className="absolute right-1.5 top-1.5 rounded border border-gray-700 bg-gray-900/80 px-1.5 py-0.5 text-[10px] text-gray-300 hover:text-orange-400 hover:border-orange-400/50 transition cursor-pointer"
                aria-label="Copy endpoint list to clipboard"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <pre className="max-h-60 overflow-auto rounded border border-gray-700 bg-gray-950/40 p-2 pr-14 font-mono text-[11px] text-gray-400 whitespace-pre">
                {endpointList}
              </pre>
            </div>
          </div>
        )}

        {typeof status?.liveCount === 'number' && (
          <p className="text-gray-400">
            The full spec defines{' '}
            <strong className="text-gray-300">{status.liveCount}</strong> write
            endpoints in total; the remainder are account- or data-plane
            operations outside the scope of a zone migration.
          </p>
        )}

        <p className="text-gray-400">
          Source:{' '}
          <a
            href={CF_OPENAPI_SPEC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400/80 hover:text-orange-400 underline underline-offset-2 transition"
          >
            cloudflare/api-schemas
          </a>
          {' '}· checked {checked}.
        </p>
      </InfoModal>
    </p>
  );
}
