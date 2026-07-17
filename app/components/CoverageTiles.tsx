import { useState, lazy, Suspense } from 'react';
import {
  Globe, Lock, ShieldCheck, Sliders, Stack, ArrowsClockwise,
  Code, Database, Envelope, ChartBar, UserCircle, Cpu,
  Lightning, PlayCircle, GearSix, UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import { coverageSummary, type CategoryRecord } from '../lib/coverageSummary';

const CoverageModal = lazy(() => import('./CoverageModal'));

/**
 * Static map from icon name (as declared in feature-taxonomy.json's
 * _categories metadata) to the Phosphor icon component. Listed
 * explicitly so tree-shaking can drop unused icons - `import *` from
 * phosphor-react pulls 3,000+ icons into the bundle, which inflated
 * the main chunk by ~5 MB.
 */
const ICON_BY_NAME: Record<string, Icon> = {
  Globe, Lock, ShieldCheck, Sliders, Stack, ArrowsClockwise,
  Code, Database, Envelope, ChartBar, UserCircle, Cpu,
  Lightning, PlayCircle, GearSix, UsersThree,
};

type CoverageTilesProps = {
  /**
   * Compact mode for rendering inside an InfoModal. Drops the outer
   * section heading + description paragraph (the modal supplies its
   * own `title` / `eyebrow`) and removes the max-width / top-margin
   * cap that's used on the standalone landing-page render.
   *
   * Defaults to false to keep any other caller unaffected.
   */
  compact?: boolean;
};

/**
 * Coverage tiles. Each tile shows a dashboard top-level category (DNS,
 * SSL/TLS, Security, …) with an implementation-rate percentage. Clicking
 * a tile opens a modal with the per-feature and per-endpoint detail
 * (lazy-loaded - see CoverageModal).
 *
 * The big green metric on each tile is migration completeness
 * (implemented / (implemented + real gaps)) - the share of migratable
 * resources actually moved. The smaller gray number in parentheses
 * (lower-right) is the in-scope write-endpoint share (implemented /
 * (implemented + excluded + gap)): of every write endpoint in the
 * category, how many the tool calls. Excluded endpoints are in that
 * denominator but not the green one - they're deliberately not migrated
 * and the modal explains why per reason category. The gray number is
 * informational only (neither good nor bad), so it never drives color.
 *
 * Categories with no in-scope features (Magic, Account Admin, etc.)
 * are filtered out so users only see things relevant to zone migration.
 */
export function CoverageTiles({ compact = false }: CoverageTilesProps = {}) {
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);

  // Filter to categories with at least one in-scope feature. Account-only
  // categories (Magic Networking, Account Admin) are hidden - they're not
  // part of zone migration and showing 0%/0% tiles would be misleading.
  const tiles = coverageSummary.categories.filter(
    c => c.in_scope_feature_count > 0,
  );

  return (
    <section
      aria-label="Cloudflare API coverage by category"
      className={compact ? 'w-full' : 'w-full max-w-5xl mx-auto mt-8'}
    >
      {!compact && (
        <>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3 text-left">
            Coverage by category
          </h2>
          <p className="text-xs text-gray-500 mb-4 text-left max-w-3xl">
            Big green number: migration completeness - the share of
            <em> migratable</em> resources Twilight Zone moves. Smaller gray
            number in parentheses: the share of <em>all</em> in-scope write
            endpoints (POST/PATCH/PUT) the tool calls - the rest are
            deliberately excluded (data-plane, imperative actions, redundant
            variants) and aren&apos;t a measure of quality. Click any tile for
            the per-endpoint breakdown.
          </p>
        </>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {tiles.map(category => (
          <CoverageTile
            key={category.id}
            category={category}
            onClick={() => setOpenCategoryId(category.id)}
          />
        ))}
      </div>

      {openCategoryId && (
        <Suspense fallback={<ModalLoadingFallback onClose={() => setOpenCategoryId(null)} />}>
          <CoverageModal
            categoryId={openCategoryId}
            onClose={() => setOpenCategoryId(null)}
          />
        </Suspense>
      )}
    </section>
  );
}

type CoverageTileProps = {
  category: CategoryRecord;
  onClick: () => void;
};

function CoverageTile({ category, onClick }: CoverageTileProps) {
  const rate = category.implementation_rate_pct;
  const share = category.in_scope_write_share_pct;
  const { implemented, excluded, gap } = category.counts;
  const colorClass = rateColor(rate);
  const IconComponent = resolveIcon(category.icon);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col text-left bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-orange-500/50 hover:bg-gray-800/80 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60"
      aria-label={`${category.name}: ${rate !== null ? `${rate}% of migratable resources covered` : 'no in-scope endpoints'}${share !== null ? `, ${share}% of in-scope write endpoints` : ''}, ${implemented} implemented, ${excluded} excluded, ${gap} real gaps. Click for details.`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="text-orange-400 group-hover:text-orange-300 transition">
          {IconComponent ? <IconComponent size={20} weight="duotone" aria-hidden="true" /> : null}
        </div>
        <div className={`text-2xl font-bold tabular-nums ${colorClass}`}>
          {rate !== null ? `${Math.round(rate)}%` : '-'}
        </div>
      </div>
      <div className="text-sm font-semibold text-gray-200 mb-0.5">{category.name}</div>
      {/* Two stacked lines so the clause never wraps mid-phrase out of the
          tile. Line 1: migratable writes + the in-scope write share (the %
          is a coverage-of-writes figure, so it sits next to the writes
          count, not the excluded count). Line 2: excluded count. The share
          is informational only and never drives the tile color. */}
      <div className="text-[11px] text-gray-500 tabular-nums">
        {implemented} of {implemented + gap} writes
        {share !== null && <span className="ml-1 text-gray-600">({Math.round(share)}%)</span>}
      </div>
      {excluded > 0 && (
        <div className="text-[11px] text-gray-600 tabular-nums">
          +{excluded} excluded
        </div>
      )}
    </button>
  );
}

/** Implementation-rate colour mapping. */
function rateColor(rate: number | null): string {
  if (rate === null) return 'text-gray-500';
  if (rate >= 75) return 'text-green-400';
  if (rate >= 50) return 'text-yellow-400';
  if (rate >= 25) return 'text-orange-400';
  return 'text-red-400';
}

/**
 * Look up the icon by name from the explicit ICON_BY_NAME map. Returns
 * undefined if the icon isn't registered (the tile renders without an
 * icon). Add new icons to ICON_BY_NAME if you extend the category list.
 */
function resolveIcon(name: string): Icon | undefined {
  return ICON_BY_NAME[name];
}

function ModalLoadingFallback({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Loading coverage detail"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 text-gray-300">
        Loading coverage detail…
      </div>
    </div>
  );
}
