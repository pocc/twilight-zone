// Pure helpers for the Step 4 "Analytics data exported" charts. No JSX/React
// here so they're cheap to unit-test. The component in
// components/AnalyticsCharts.tsx renders these specs.
import type { AnalyticsExport } from '../../src/types';

export type ChartSpec = {
  kind: 'area' | 'bars';
  title: string;
  data: { label: string; value: number }[];
  color: string;
  unit?: 'bytes' | 'count';
};

type Row = { count?: number; dimensions?: Record<string, unknown>; sum?: Record<string, number>; uniq?: Record<string, number> };

function rowsOf(exp: AnalyticsExport, dataset: string): Row[] {
  const g = exp.graphql.find(d => d.dataset === dataset && !d.error);
  return Array.isArray(g?.rows) ? (g!.rows as Row[]) : [];
}

/** Group rows by a dimension value, summing a metric; return top N desc. */
export function groupSum(rows: Row[], dimKey: string, valueOf: (r: Row) => number, topN = 8): { label: string; value: number }[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    const dv = r.dimensions?.[dimKey];
    if (dv === undefined || dv === null) continue;
    const label = String(dv);
    acc.set(label, (acc.get(label) || 0) + (valueOf(r) || 0));
  }
  return [...acc.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

/** Build the ordered list of chart specs from the export. Pure + testable. */
export function buildCharts(exp: AnalyticsExport): ChartSpec[] {
  const specs: ChartSpec[] = [];

  // Daily traffic time-series (curated httpRequests1dGroups: dimensions.date + sum.*).
  const daily = rowsOf(exp, 'httpRequests1dGroups')
    .filter(r => r.dimensions?.date)
    .sort((a, b) => String(a.dimensions!.date).localeCompare(String(b.dimensions!.date)));
  const reqSeries = daily.map(r => ({ label: String(r.dimensions!.date), value: r.sum?.requests || 0 }));
  if (reqSeries.some(d => d.value > 0)) specs.push({ kind: 'area', title: 'Requests per day', data: reqSeries, color: '#f97316', unit: 'count' });
  const byteSeries = daily.map(r => ({ label: String(r.dimensions!.date), value: r.sum?.bytes || 0 }));
  if (byteSeries.some(d => d.value > 0)) specs.push({ kind: 'area', title: 'Data served per day', data: byteSeries, color: '#3b82f6', unit: 'bytes' });

  // Categorical breakdowns (bar lists).
  const fw = groupSum(rowsOf(exp, 'firewallEventsAdaptiveGroups'), 'action', r => r.count || 0);
  if (fw.length) specs.push({ kind: 'bars', title: 'Firewall events by action', data: fw, color: '#ef4444', unit: 'count' });

  const dns = groupSum(rowsOf(exp, 'dnsAnalyticsAdaptiveGroups'), 'responseCode', r => r.count || 0);
  if (dns.length) specs.push({ kind: 'bars', title: 'DNS queries by response code', data: dns, color: '#a855f7', unit: 'count' });

  const countries = groupSum(rowsOf(exp, 'httpRequestsAdaptiveGroups'), 'clientCountryName', r => r.count || 0);
  if (countries.length) specs.push({ kind: 'bars', title: 'Top client countries', data: countries, color: '#22c55e', unit: 'count' });

  const status = groupSum(rowsOf(exp, 'httpRequestsAdaptiveGroups'), 'edgeResponseStatus', r => r.count || 0);
  if (status.length) specs.push({ kind: 'bars', title: 'HTTP responses by status', data: status, color: '#eab308', unit: 'count' });

  return specs;
}

export function formatNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}
export function formatBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
export const fmt = (v: number, unit?: string) => (unit === 'bytes' ? formatBytes(v) : formatNum(v));
