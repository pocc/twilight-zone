import { ChartLine } from '@phosphor-icons/react';
import type { AnalyticsExport } from '../../src/types';
import { buildCharts, fmt, type ChartSpec } from '../lib/analyticsCharts';

// ── Step 4 "Analytics data exported" section ───────────────────────────
//
// Renders pretty, dependency-free SVG charts from the captured GraphQL
// analytics bundle. The extractors (buildCharts) live in lib/analyticsCharts.ts
// and are unit-tested; this file is presentation only. Only charts with data
// are shown. Analytics history can't be migrated (data_ephemeral) - this makes
// the archived snapshot legible before the user downloads it.

function BarList({ spec }: { spec: ChartSpec }) {
  const max = Math.max(...spec.data.map(d => d.value), 1);
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4">
      <h4 className="text-xs font-semibold text-gray-300 mb-3">{spec.title}</h4>
      <div className="space-y-1.5">
        {spec.data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate text-gray-400" title={d.label}>{d.label}</span>
            <div className="flex-1 bg-gray-900/60 rounded h-4 overflow-hidden">
              <div className="h-full rounded" style={{ width: `${Math.max((d.value / max) * 100, 2)}%`, backgroundColor: spec.color }} />
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-gray-300">{fmt(d.value, spec.unit)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AreaChart({ spec }: { spec: ChartSpec }) {
  const W = 600, H = 120, pad = 6;
  const n = spec.data.length;
  const max = Math.max(...spec.data.map(d => d.value), 1);
  const x = (i: number) => pad + (n <= 1 ? 0 : (i * (W - 2 * pad)) / (n - 1));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const pts = spec.data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`);
  const line = `M ${pts.join(' L ')}`;
  const area = `${line} L ${x(n - 1).toFixed(1)},${H - pad} L ${x(0).toFixed(1)},${H - pad} Z`;
  const gid = `g-${spec.title.replace(/\W/g, '')}`;
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-xs font-semibold text-gray-300">{spec.title}</h4>
        <span className="text-[11px] text-gray-500">peak {fmt(max, spec.unit)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none" role="img" aria-label={spec.title}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={spec.color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={spec.color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={spec.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-500 mt-1">
        <span>{spec.data[0]?.label}</span>
        <span>{spec.data[n - 1]?.label}</span>
      </div>
    </div>
  );
}

export function AnalyticsExportedSection({ status, analyticsExport, error, onDownload }: {
  status: 'idle' | 'running' | 'ready' | 'error';
  analyticsExport: AnalyticsExport | null;
  error: string;
  onDownload: () => void;
}) {
  if (status === 'idle') return null;

  if (status === 'running') {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-center gap-3">
        <span className="w-3 h-3 rounded-full bg-orange-400 animate-pulse shrink-0" aria-hidden="true" />
        <p className="text-sm text-gray-300">Exporting source-zone analytics… <span className="text-gray-500">(runs alongside the migration)</span></p>
      </div>
    );
  }

  if (status === 'error' || !analyticsExport) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <p className="text-sm text-gray-400"><span className="font-medium text-gray-300">Analytics export didn’t complete.</span> Analytics history can’t be migrated regardless - this archive is a best-effort convenience.</p>
        {error && <p className="text-xs text-gray-600 mt-1 font-mono break-all">{error}</p>}
      </div>
    );
  }

  const charts = buildCharts(analyticsExport);
  const withData = analyticsExport.graphql.filter(g => !g.error && g.rowCount > 0).length;
  const available = analyticsExport.manifest.availableZoneDatasets.length;
  const days = analyticsExport.meta.window.lookbackDays;
  const areas = charts.filter(c => c.kind === 'area');
  const bars = charts.filter(c => c.kind === 'bars');

  return (
    <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
          <ChartLine size={20} weight="fill" className="text-orange-400" aria-hidden="true" />
          Analytics data exported
        </h3>
        <button type="button" onClick={onDownload}
          className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg transition">
          Download Source Analytics (.json)
        </button>
      </div>
      <p className="text-xs text-gray-400">
        {withData} dataset{withData !== 1 ? 's' : ''} with data{available ? ` of ${available} available` : ''}
        {days ? ` · last ${days} day${days !== 1 ? 's' : ''}` : ''}. Analytics history can’t be migrated between accounts - this is your archive of the source zone.
      </p>

      {charts.length === 0 ? (
        <p className="text-xs text-gray-500">No chartable data in the selected window - the full dataset is still in the download.</p>
      ) : (
        <div className="space-y-3">
          {areas.length > 0 && (
            <div className={`grid gap-3 ${areas.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
              {areas.map((c, i) => <AreaChart key={i} spec={c} />)}
            </div>
          )}
          {bars.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {bars.map((c, i) => <BarList key={i} spec={c} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
