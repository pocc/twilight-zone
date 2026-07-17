import { useState } from 'react';
import { CaretUp, CaretDown, ArrowSquareOut } from '@phosphor-icons/react';
import type { ReportSection, ReportItem, ValidationSection } from '../../../../src/types';
import { StatusIcon, type Status } from '../../StatusIcon';
import { buildDashLink, type DashLinkCtx } from '../../../lib/dashLinks';

// Per-section result cards for Step 4 (the Results page). Extracted verbatim
// from Step4Results.tsx — these are pure, prop-driven leaf components with no
// dependency on Step4's local state, so moving them out shrinks the parent
// file without any behavior change.

/**
 * Status-aware source + destination dashboard links for one result row.
 *
 * - source link: shown whenever we know the resource group; item-level when a
 *   source id is known, else the source section page. Helps eyeball the
 *   original next to the migrated copy.
 * - dest link: when the resource exists on the destination (verified /
 *   mismatched / success) → item-level (or dest section as fallback). When it
 *   should be there but isn't (missing / failed) → dest section page, i.e.
 *   "go create it here". Intentionally-skipped rows (acknowledged/skipped) get
 *   no dest link - there's nothing to look at and nothing to do.
 *
 * Renders nothing when no group key is attached (e.g. older reports), so it's
 * safe to drop into every row.
 */
export function Step4ItemLinks({
  item,
  sourceCtx,
  destCtx,
}: {
  item: { status: string; dashGroupKey?: string; sourceDashId?: string; destDashId?: string };
  sourceCtx: DashLinkCtx;
  destCtx: DashLinkCtx;
}) {
  const gk = item.dashGroupKey;
  if (!gk) return null;

  const destExists = ['verified', 'mismatched', 'success'].includes(item.status);
  const destActionable = ['missing', 'failed'].includes(item.status);

  const srcHref = buildDashLink(gk, item.sourceDashId ? { id: item.sourceDashId } : null, sourceCtx);
  const destHref = destExists
    ? buildDashLink(gk, item.destDashId ? { id: item.destDashId } : null, destCtx)
    : destActionable
      ? buildDashLink(gk, null, destCtx)
      : null;

  if (!srcHref && !destHref) return null;

  const linkClass =
    'inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide text-gray-500 hover:text-orange-400 transition-colors';
  return (
    <span className="flex items-center gap-2 shrink-0 ml-2">
      {srcHref && (
        <a href={srcHref} target="_blank" rel="noopener noreferrer" className={linkClass}
          title="Open the source resource in the dashboard">
          src <ArrowSquareOut size={11} weight="bold" aria-hidden="true" />
        </a>
      )}
      {destHref && (
        <a href={destHref} target="_blank" rel="noopener noreferrer" className={linkClass}
          title={destExists ? 'Open the migrated resource on the destination' : 'Open the destination section to create it'}>
          dest <ArrowSquareOut size={11} weight="bold" aria-hidden="true" />
        </a>
      )}
    </span>
  );
}

export function SectionCard({ section, sourceCtx, destCtx }: { section: ReportSection; sourceCtx: DashLinkCtx; destCtx: DashLinkCtx }) {
  const [expanded, setExpanded] = useState(true);
  const allSuccess = section.failed === 0 && section.skipped === 0;

  // Border color based on status
  const borderColor = section.failed > 0
    ? 'border-red-700/50'
    : allSuccess
      ? 'border-green-700/30'
      : 'border-yellow-700/30';

  return (
    <div className={`bg-gray-800 rounded-lg border ${borderColor} overflow-hidden`}>
      {/* Header - always visible */}
      <button type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/50 transition text-left"
        style={{ backgroundColor: expanded ? 'rgb(38, 42, 51)' : undefined }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-200 truncate">{section.name}</span>
          <span className="text-xs text-gray-500">({section.total})</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs">
          {section.success > 0 && (
            <span className="text-green-400">{section.success} ok</span>
          )}
          {section.failed > 0 && (
            <span className="text-red-400">{section.failed} failed</span>
          )}
          {section.skipped > 0 && (
            <span className="text-gray-500">{section.skipped} skipped</span>
          )}
          {(section.acknowledged ?? 0) > 0 && (
            <span className="text-gray-500">{section.acknowledged} ack'd</span>
          )}
          {expanded ? <CaretUp size={12} className="text-gray-600" aria-hidden="true" /> : <CaretDown size={12} className="text-gray-600" aria-hidden="true" />}
        </div>
      </button>

      {/* Items - collapsed by default unless there are failures */}
      {expanded && (
        <div className="border-t border-gray-700 px-4 py-2 max-h-[300px] overflow-y-auto">
          <ul className="space-y-0.5">
            {section.items.map((item: ReportItem, ii: number) => (
              <li key={ii} className={`flex items-start gap-2 text-xs py-0.5 ${item.status === 'acknowledged' ? 'opacity-80' : ''}`}>
                <span className="shrink-0 mt-0.5">
                  <StatusIcon status={item.status as Status} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className={`truncate block ${item.status === 'acknowledged' ? 'text-gray-400 line-through' : 'text-gray-400'}`} title={item.name || item.description}>
                    {item.name || item.description}
                  </span>
                  {item.status === 'acknowledged' && item.error && (
                    <span className="block truncate text-gray-500" title={item.error}>
                      {item.error}
                    </span>
                  )}
                  {item.error && (item.status === 'skipped' || item.status === 'failed') && (
                    <span className={`block truncate ${item.status === 'failed' ? 'text-red-400/70' : 'text-gray-500'}`} title={item.error}>
                      {item.error}
                    </span>
                  )}
                </div>
                <Step4ItemLinks item={item} sourceCtx={sourceCtx} destCtx={destCtx} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ── Validation Section Card (shows GET-back verification results) ── */
export function ValidationSectionCard({ section, sourceCtx, destCtx }: { section: ValidationSection; sourceCtx: DashLinkCtx; destCtx: DashLinkCtx }) {
  const [expanded, setExpanded] = useState(true);
  const unverified = section.unverified ?? 0;
  const allVerified = section.missing === 0 && section.mismatched === 0 && unverified === 0 && section.verified > 0;

  // unverified rows are neutral (read-back failed) — no red border for them.
  const borderColor = section.missing > 0
    ? 'border-red-700/50'
    : section.mismatched > 0
      ? 'border-yellow-700/30'
      : unverified > 0
        ? 'border-blue-700/30'
        : allVerified
          ? 'border-green-700/30'
          : 'border-gray-700';

  return (
    <div className={`bg-gray-800 rounded-lg border ${borderColor} overflow-hidden`}>
      <button type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/50 transition text-left"
        style={{ backgroundColor: expanded ? 'rgb(38, 42, 51)' : undefined }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-200 truncate">{section.name}</span>
          <span className="text-xs text-gray-500">({section.expected})</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs">
          {section.verified > 0 && (
            <span className="text-green-400">{section.verified} verified</span>
          )}
          {section.missing > 0 && (
            <span className="text-red-400">{section.missing} missing</span>
          )}
          {section.mismatched > 0 && (
            <span className="text-yellow-400">{section.mismatched} mismatched</span>
          )}
          {unverified > 0 && (
            <span className="text-blue-400">{unverified} unverified</span>
          )}
          {(section.acknowledged ?? 0) > 0 && (
            <span className="text-gray-500">{section.acknowledged} ack'd</span>
          )}
          {expanded ? <CaretUp size={12} className="text-gray-600" aria-hidden="true" /> : <CaretDown size={12} className="text-gray-600" aria-hidden="true" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-700 px-4 py-2 max-h-[300px] overflow-y-auto">
          <ul className="space-y-0.5">
            {section.items.map((item, ii: number) => (
              <li key={ii} className={`flex items-start gap-2 text-xs py-0.5 ${item.status === 'acknowledged' ? 'opacity-80' : ''}`}>
                <span className="shrink-0 mt-0.5">
                  <StatusIcon status={item.status as Status} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className={`truncate block ${item.status === 'acknowledged' ? 'text-gray-400 line-through' : 'text-gray-400'}`} title={item.name}>
                    {item.name}
                  </span>
                  {item.status === 'acknowledged' && item.detail && (
                    <span className="block truncate text-gray-500" title={item.detail}>
                      {item.detail}
                    </span>
                  )}
                  {item.detail && item.status !== 'verified' && item.status !== 'acknowledged' && (
                    <span className={`block truncate ${item.status === 'missing' ? 'text-red-400/70' : item.status === 'unverified' ? 'text-blue-400/70' : 'text-yellow-400/70'}`} title={item.detail}>
                      {item.detail}
                    </span>
                  )}
                </div>
                <Step4ItemLinks item={item} sourceCtx={sourceCtx} destCtx={destCtx} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function StatBadge({
  label,
  value,
  color,
  bg,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className={`${bg} rounded-lg px-3 py-2`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
    </div>
  );
}
