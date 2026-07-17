import { useMemo, useRef, useState } from 'react';
import { X, Info } from '@phosphor-icons/react';
import { coverageSummary } from '../lib/coverageSummary';
import { coverageDetail } from '../lib/coverageDetail';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useScrollLock } from '../hooks/useScrollLock';
import { MetricCard, toneForRate, ExcludedReasonsSummary, FeatureRow } from './coveragemodal/CoverageRows';

/**
 * Coverage modal - opened from a tile in CoverageTiles. Shows three sections:
 *
 *   1. Category-level rollup (impl rate, settled surface, counts)
 *   2. Per-feature list (within this category) - implementation rate per feature
 *   3. Per-endpoint detail (expand a feature to see every endpoint + status)
 *
 * The modal is keyboard-accessible: Esc closes, focus is trapped in the
 * card while open. Click outside (overlay) also closes.
 */
type CoverageModalProps = {
  categoryId: string;
  onClose: () => void;
};

/** Endpoint-status filter for the per-feature lists. */
export type StatusFilter = 'all' | 'implemented' | 'excluded' | 'gap';

export default function CoverageModal({ categoryId, onClose }: CoverageModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const category = coverageSummary.categories.find(c => c.id === categoryId);
  const features = useMemo(
    () => coverageDetail.features.filter(f => f.category === categoryId && f.in_scope),
    [categoryId],
  );

  // Features are expanded by default — clicking every single feature open to
  // see its endpoints is tedious when a category has several (e.g. Rules has
  // 6). We track only the features the user has explicitly COLLAPSED; anything
  // not in the set renders expanded. A status filter still forces every
  // visible row open (see the `expanded` predicate on FeatureRow below).
  const [collapsedFeatureIds, setCollapsedFeatureIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Endpoint status filter, driven by the metric cards at the top. 'all'
  // (the default) shows every endpoint; selecting Implemented / Excluded /
  // Real gaps narrows the per-feature lists to just that status. Clicking
  // the active filter again returns to 'all'.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const selectFilter = (target: Exclude<StatusFilter, 'all'>) =>
    setStatusFilter(prev => (prev === target ? 'all' : target));

  // Features visible under the current filter: 'all' shows every in-scope
  // feature; a status filter hides features that have no endpoint of that
  // status (so picking "Excluded" only lists features that exclude
  // something). Computed from the per-feature endpoint records.
  const visibleFeatures = useMemo(() => {
    if (statusFilter === 'all') return features;
    return features.filter(f =>
      (coverageDetail.endpointsByFeature[f.id] || []).some(e => e.status === statusFilter),
    );
  }, [features, statusFilter]);

  // Which excluded-reason explanation is open in the "Why some endpoints
  // are excluded" section. Clicking a reason badge on an endpoint opens
  // and scrolls to the matching explanation there.
  const [openReason, setOpenReason] = useState<string | null>(null);
  const handleReasonClick = (reason: string) => {
    setOpenReason(reason);
    requestAnimationFrame(() => {
      document.getElementById(`excluded-reason-${reason}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  };

  useFocusTrap(true, dialogRef, onClose);

  // Lock background scroll while open. This modal is only mounted while open,
  // so the lock is always active for its lifetime. Locks both `body` (base) and
  // the `.tvc-host--page` scroll box (twilight) — see useScrollLock.
  useScrollLock(true);

  if (!category) return null;

  const { implemented, excluded, gap } = category.counts;
  const total = implemented + excluded + gap;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="coverage-modal-title"
      tabIndex={-1}
      // This is a SECOND-level modal: it always opens from a CoverageTile
      // inside the Coverage InfoModal, which already paints a `bg-black/70`
      // scrim over the page. Painting our own scrim on top would stack two
      // 70% dims into a near-solid-black backdrop (most obvious in light
      // mode). So we render NO scrim of our own — the parent InfoModal's
      // scrim provides the single dim, matching the first-level modals
      // (About / Security / Coverage) in every theme. Our card is wider
      // (max-w-4xl vs the InfoModal's max-w-2xl) so it fully covers the
      // panel behind it; the transparent overlay still captures
      // click-outside-to-close.
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between p-5 border-b border-gray-700">
          <div>
            <h2 id="coverage-modal-title" className="text-xl font-bold text-orange-400">
              {category.name}
            </h2>
            <p className="text-sm text-gray-400 mt-1">{category.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-orange-400 transition cursor-pointer rounded"
            aria-label="Close"
          >
            <X size={20} weight="bold" aria-hidden="true" />
          </button>
        </header>

        {/* Body - scrollable */}
        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {/* Top-level metrics. The Implemented / Excluded / Real gaps cards
              double as a filter for the per-feature lists below; the green
              "Zone migratable" card resets the filter to show everything. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Zone migratable"
              value={category.implementation_rate_pct !== null
                ? `${Math.round(category.implementation_rate_pct)}%`
                : 'N/A'}
              sub={`${implemented} of ${implemented + gap} migratable`}
              graySub={category.in_scope_write_share_pct !== null
                ? `${Math.round(category.in_scope_write_share_pct)}% of in-scope writes`
                : undefined}
              tone={toneForRate(category.implementation_rate_pct)}
              active={statusFilter === 'all'}
              onSelect={() => setStatusFilter('all')}
            />
            <MetricCard
              label="Implemented"
              value={String(implemented)}
              sub="POST/PATCH/PUT endpoints we call"
              tone="green"
              active={statusFilter === 'implemented'}
              onSelect={implemented > 0 ? () => selectFilter('implemented') : undefined}
            />
            <MetricCard
              label="Excluded"
              value={String(excluded)}
              sub="Deliberately not migrated"
              tone="gray"
              active={statusFilter === 'excluded'}
              onSelect={excluded > 0 ? () => selectFilter('excluded') : undefined}
            />
            <MetricCard
              label="Real gaps"
              value={String(gap)}
              sub={gap === 0 ? 'No outstanding work' : 'Unimplemented endpoints'}
              tone={gap === 0 ? 'green' : 'red'}
              active={statusFilter === 'gap'}
              onSelect={gap > 0 ? () => selectFilter('gap') : undefined}
            />
          </div>

          {/* The active-filter hint bar was removed: the leftmost "Zone
              migratable" metric card already owns reset-to-all (it highlights
              when statusFilter === 'all') and the filtered feature count is
              shown in the section heading below ("Features in this category
              (N)"), so a separate "Show all" link + count was redundant. */}

          {/* Per-feature list (filtered by the active status filter) */}
          <section>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
              Features in this category ({visibleFeatures.length})
            </h3>
            {visibleFeatures.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                {features.length === 0
                  ? 'No in-scope features in this category.'
                  : `No ${statusFilter} endpoints in this category.`}
              </p>
            ) : (
              <ul className="space-y-2">
                {visibleFeatures.map(f => (
                  <FeatureRow
                    key={f.id}
                    feature={f}
                    endpoints={coverageDetail.endpointsByFeature[f.id] || []}
                    statusFilter={statusFilter}
                    expanded={statusFilter !== 'all' || !collapsedFeatureIds.has(f.id)}
                    onToggle={() => setCollapsedFeatureIds(prev => {
                      const next = new Set(prev);
                      if (next.has(f.id)) next.delete(f.id);
                      else next.add(f.id);
                      return next;
                    })}
                    onReasonClick={handleReasonClick}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Excluded-reasons explainer — placed AFTER the endpoint lists so
              the actual endpoints come first. Shown only when excluded
              endpoints are currently visible (filter 'all' or 'excluded'). */}
          {excluded > 0 && (statusFilter === 'all' || statusFilter === 'excluded') && (
            <ExcludedReasonsSummary
              features={features}
              endpointsByFeature={coverageDetail.endpointsByFeature}
              openReason={openReason}
              setOpenReason={setOpenReason}
            />
          )}

          {/* Footnote: how we count */}
          <p className="text-xs text-gray-500 leading-relaxed border-t border-gray-700 pt-3">
            <Info size={12} weight="fill" aria-hidden="true" className="inline align-text-bottom mr-1 text-gray-400" />
            <span className="font-medium text-gray-400">How we count:</span>{' '}
            The green <span className="text-gray-400">Zone migratable</span> rate is{' '}
            <code className="text-gray-400">implemented / (implemented + real gaps)</code>{' '}
            - the share of migratable resources we move. The gray{' '}
            <code className="text-gray-400">% of in-scope writes</code> is{' '}
            <code className="text-gray-400">implemented / (implemented + excluded + gap)</code>;
            excluded endpoints - runtime data ops, one-shot admin actions, and
            redundant variants - are in that denominator but not the green one.
            Total writes shown: {total}.
          </p>
        </div>
      </div>
    </div>
  );
}
