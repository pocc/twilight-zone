import { CheckCircle, MinusCircle, XCircle, Info } from '@phosphor-icons/react';
import { coverageDetail } from '../../lib/coverageDetail';
import type { EndpointRecord, FeatureRecord } from '../../lib/coverageSummary';
import type { StatusFilter } from '../CoverageModal';

type MetricCardProps = {
  label: string;
  value: string;
  sub: string;
  /** Optional second sub-line, rendered gray (the informational share). */
  graySub?: string;
  tone: 'green' | 'yellow' | 'orange' | 'red' | 'gray';
  /** When provided, the card becomes a filter toggle button. */
  onSelect?: () => void;
  /** Whether this card's filter is currently active. */
  active?: boolean;
};

export function MetricCard({ label, value, sub, graySub, tone, onSelect, active = false }: MetricCardProps) {
  const toneClass = {
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    orange: 'text-orange-400',
    red: 'text-red-400',
    gray: 'text-gray-300',
  }[tone];

  const inner = (
    <>
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
      <div className={`text-2xl font-bold tabular-nums mt-0.5 ${toneClass}`}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-1">{sub}</div>
      {graySub && <div className="text-[11px] text-gray-600 tabular-nums mt-0.5">({graySub})</div>}
    </>
  );

  // Non-selectable cards (or zero-count filters) render as a static div.
  if (!onSelect) {
    return <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3">{inner}</div>;
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`text-left bg-gray-800/60 border rounded-lg p-3 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 ${
        active
          ? 'border-orange-500/70 ring-1 ring-orange-500/40 bg-gray-800'
          : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800'
      }`}
    >
      {inner}
    </button>
  );
}

export function toneForRate(rate: number | null): MetricCardProps['tone'] {
  if (rate === null) return 'gray';
  if (rate >= 75) return 'green';
  if (rate >= 50) return 'yellow';
  if (rate >= 25) return 'orange';
  return 'red';
}

type ExcludedReasonsSummaryProps = {
  features: FeatureRecord[];
  endpointsByFeature: Record<string, EndpointRecord[]>;
  openReason: string | null;
  setOpenReason: (reason: string | null) => void;
};

/**
 * Aggregates excluded-endpoint counts by reason across the category and
 * renders each reason with the canonical explanation from
 * coverageDetail.reasonDescriptions. Each reason is an accordion row,
 * controlled by openReason so clicking an endpoint's reason badge can
 * open + scroll to the matching explanation.
 */
export function ExcludedReasonsSummary({ features, endpointsByFeature, openReason, setOpenReason }: ExcludedReasonsSummaryProps) {
  const reasonCounts = new Map<string, number>();
  for (const f of features) {
    const eps = endpointsByFeature[f.id] || [];
    for (const ep of eps) {
      if (ep.status === 'excluded' && ep.reason) {
        reasonCounts.set(ep.reason, (reasonCounts.get(ep.reason) || 0) + 1);
      }
    }
  }
  if (reasonCounts.size === 0) return null;
  const rows = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
        Why some endpoints are excluded
      </h3>
      <p className="text-xs text-gray-500 mb-3 leading-relaxed">
        These endpoints exist in the Cloudflare API but Twilight Zone deliberately
        doesn&apos;t call them. Each exclusion has a stated reason.
      </p>
      <div className="space-y-2">
        {rows.map(([reason, count]) => {
          const desc = coverageDetail.reasonDescriptions[reason];
          if (!desc) {
            return (
              <div key={reason} id={`excluded-reason-${reason}`} className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 text-xs text-gray-400">
                <code>{reason}</code> · {count} endpoint{count === 1 ? '' : 's'}
              </div>
            );
          }
          return (
            <details
              key={reason}
              id={`excluded-reason-${reason}`}
              open={openReason === reason}
              onToggle={(e) => {
                if (e.currentTarget.open) setOpenReason(reason);
                else if (openReason === reason) setOpenReason(null);
              }}
              className="bg-gray-800/60 border border-gray-700 rounded-lg overflow-hidden group scroll-mt-2"
            >
              <summary className="cursor-pointer list-none p-3 hover:bg-gray-800/80 transition flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-200">{desc.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{count} endpoint{count === 1 ? '' : 's'}</div>
                </div>
                <div className="text-gray-500 group-open:rotate-90 transition transform pt-0.5">▸</div>
              </summary>
              <div className="px-3 pb-3 pt-1 border-t border-gray-700 bg-gray-900/40">
                <p className="text-xs text-gray-400 leading-relaxed mb-2">{desc.summary}</p>
                {desc.examples.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Examples</div>
                    <ul className="text-[11px] text-gray-500 font-mono space-y-0.5">
                      {desc.examples.map(ex => <li key={ex}>{ex}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

type FeatureRowProps = {
  feature: FeatureRecord;
  endpoints: EndpointRecord[];
  statusFilter: StatusFilter;
  expanded: boolean;
  onToggle: () => void;
  onReasonClick: (reason: string) => void;
};

export function FeatureRow({ feature, endpoints, statusFilter, expanded, onToggle, onReasonClick }: FeatureRowProps) {
  // Endpoints to show when expanded: drop DELETEs, then narrow to the active
  // status filter (when not 'all').
  const writes = endpoints.filter(e =>
    e.status !== 'na_delete' && (statusFilter === 'all' || e.status === statusFilter),
  );
  const { implemented, excluded, gap } = feature.counts;
  const inScopeWrites = implemented + gap;
  const rate = feature.implementation_rate_pct;
  const rateColorClass = rate === null ? 'text-gray-500'
    : toneForRate(rate) === 'green' ? 'text-green-400'
      : toneForRate(rate) === 'yellow' ? 'text-yellow-400'
        : toneForRate(rate) === 'orange' ? 'text-orange-400'
          : toneForRate(rate) === 'red' ? 'text-red-400' : 'text-gray-400';
  const requirements = [
    feature.plan_required && feature.plan_required !== 'Free' ? feature.plan_required : null,
    feature.addon_required,
    feature.entitlement_required,
  ].filter(Boolean).join(' · ');

  return (
    <li className="bg-gray-800/60 border border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-3 hover:bg-gray-800/90 transition flex items-start gap-3 cursor-pointer focus:outline-none focus-visible:bg-gray-800/90"
        aria-expanded={expanded}
      >
        {/* Left third: title on top, metrics immediately below it. */}
        <div className="w-1/3 shrink-0 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-200">{feature.name}</span>
            {requirements && (
              <span className="text-[10px] text-orange-400/70 bg-orange-500/10 px-1.5 py-0.5 rounded font-mono">
                {requirements}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs tabular-nums">
            <span className={rateColorClass}>
              {inScopeWrites > 0 && rate !== null ? `${Math.round(rate)}%` : '-'}
            </span>
            <span className="text-gray-500">
              <span className="text-green-400">{implemented}</span>/
              <span className="text-gray-400">{implemented + gap}</span>
              {excluded > 0 && <span className="text-gray-600 ml-1">(+{excluded})</span>}
            </span>
          </div>
        </div>
        {/* Right two-thirds: description. */}
        <div className="flex-1 min-w-0 text-[11px] text-gray-500 leading-relaxed">
          {feature.notes || ''}
        </div>
        <span className="text-gray-500 transform transition shrink-0 mt-0.5" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
      </button>
      {expanded && (
        <div className="border-t border-gray-700 bg-gray-900/40">
          {writes.length === 0 ? (
            <p className="text-xs text-gray-500 italic p-3">
              {statusFilter === 'all'
                ? 'No write endpoints in this feature.'
                : `No ${statusFilter} endpoints in this feature.`}
            </p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {writes.sort(compareEndpoints).map(ep => (
                <EndpointRow key={`${ep.method} ${ep.path}`} endpoint={ep} onReasonClick={onReasonClick} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function compareEndpoints(a: EndpointRecord, b: EndpointRecord): number {
  // Implemented first (most positive signal), then gaps, then excluded.
  const statusOrder: Record<EndpointRecord['status'], number> = {
    implemented: 0,
    gap: 1,
    excluded: 2,
    out_of_scope: 3,
    impossible: 4,
    na_delete: 5,
  };
  const sa = statusOrder[a.status] ?? 99;
  const sb = statusOrder[b.status] ?? 99;
  if (sa !== sb) return sa - sb;
  return (a.path + a.method).localeCompare(b.path + b.method);
}

function EndpointRow({ endpoint, onReasonClick }: { endpoint: EndpointRecord; onReasonClick: (reason: string) => void }) {
  const StatusIcon =
    endpoint.status === 'implemented' ? CheckCircle
      : endpoint.status === 'excluded' ? MinusCircle
        : XCircle;
  const statusColor =
    endpoint.status === 'implemented' ? 'text-green-400'
      : endpoint.status === 'excluded' ? 'text-gray-500'
        : 'text-red-400';
  const reasonBadge = endpoint.reason
    ? coverageDetail.reasonDescriptions[endpoint.reason]?.label || endpoint.reason
    : null;
  return (
    <li className="px-3 py-2 flex items-start gap-3 text-xs">
      <StatusIcon size={14} weight="fill" aria-hidden="true" className={`${statusColor} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-gray-300 break-all">
          <span className="text-gray-500">{endpoint.method}</span> {endpoint.path}
        </div>
        {(reasonBadge || endpoint.notes) && (
          <div className="text-[10px] text-gray-500 mt-0.5">
            {reasonBadge && endpoint.reason && (
              <button
                type="button"
                onClick={() => onReasonClick(endpoint.reason!)}
                className="inline-flex items-center gap-1 bg-gray-800 text-gray-400 hover:text-orange-400 hover:bg-gray-700 px-1.5 py-0.5 rounded mr-1.5 cursor-pointer transition"
                title={`Why is this excluded? - ${reasonBadge}`}
              >
                {reasonBadge}
                <Info size={9} weight="bold" aria-hidden="true" className="opacity-70" />
              </button>
            )}
            {endpoint.notes && <span>{endpoint.notes}</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-gray-600 shrink-0 mt-0.5">
        {endpoint.in_sdk && <span title="In public Cloudflare SDK">SDK</span>}
        {endpoint.deprecated && <span title="Deprecated" className="text-yellow-600">DEP</span>}
      </div>
    </li>
  );
}
