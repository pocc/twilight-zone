/**
 * Step 2 "Archive source analytics" section.
 *
 * Analytics history is data_ephemeral — it cannot be migrated between accounts
 * (IMPOSSIBLE_TO_MIGRATE). The value-add is archiving a read-only snapshot of
 * the SOURCE zone's analytics before the user loses access to the source
 * account. Per the confirmed IA, this is NOT a third destination: it's a
 * pre-checked, opt-out parallel add-on inside the Zone-migration flow. The
 * capture runs in parallel with the migration (App.startAnalyticsCapture) and
 * the bundle downloads on the Results step.
 *
 * This section is the single source of capture config (replacing the old
 * execute-time AnalyticsCaptureModal):
 *   - master checkbox (pre-checked) — capture on/off
 *   - time window — numeric, 1–90 days, default 90
 *   - per-dataset selection — lazily probed on first expand (only datasets the
 *     source credentials can actually read are shown; selection seeds to all)
 *
 * Degrades gracefully: if the user never expands (or the probe fails),
 * selectedDatasets stays null and the capture pulls every available dataset.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChartLine, CaretDown, CaretRight } from '@phosphor-icons/react';
import { startAnalyticsProbe } from '../lib/api';
import type { Credentials } from '../lib/api';
import type { OAuthRole } from '../lib/oauth';
import type { AnalyticsProbeResult } from '../../src/types';

export interface AnalyticsArchiveConfig {
  creds: Partial<Credentials>;
  sourceZoneId: string;
  sourceAccountId: string;
  zoneName?: string;
  capture: boolean;
  setCapture: (v: boolean) => void;
  lookbackDays: number;
  setLookbackDays: (n: number) => void;
  /** Per-dataset selection. null = capture all available datasets (no filter). */
  selectedDatasets: string[] | null;
  setSelectedDatasets: (d: string[] | null) => void;
  onReauthorizationRequired: (role: OAuthRole) => void;
}

type ProbeStatus = 'idle' | 'running' | 'done' | 'error';

/** "httpRequestsAdaptiveGroups" → "Http Requests Adaptive". */
function humanizeDataset(name: string): string {
  return name
    .replace(/Groups$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

export function AnalyticsArchiveSection({
  creds, sourceZoneId, sourceAccountId,
  capture, setCapture, lookbackDays, setLookbackDays,
  selectedDatasets, setSelectedDatasets, onReauthorizationRequired,
}: AnalyticsArchiveConfig) {
  const [expanded, setExpanded] = useState(false);
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>('idle');
  const [probeLog, setProbeLog] = useState('');
  const [available, setAvailable] = useState<string[]>([]); // accessible dataset names
  const [probeError, setProbeError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const runProbe = () => {
    abortRef.current?.abort();
    setProbeStatus('running');
    setProbeError('');
    setProbeLog('');
    const controller = new AbortController();
    abortRef.current = controller;
    startAnalyticsProbe(creds, sourceZoneId, sourceAccountId, {
      onLog: (m) => setProbeLog(m),
      onDone: (data) => {
        const probe = (data as { probe?: AnalyticsProbeResult }).probe;
        const names = (probe?.datasets ?? []).filter(d => d.accessible).map(d => d.name);
        setAvailable(names);
        // Seed selection to all accessible datasets (null when none detected →
        // capture falls back to "all available").
        setSelectedDatasets(names.length > 0 ? names : null);
        setProbeStatus('done');
      },
      onError: (e) => { setProbeError(e); setProbeStatus('error'); },
      onReauthorizationRequired: (role, reason) => {
        setProbeError(reason);
        setProbeStatus('error');
        onReauthorizationRequired(role);
      },
    }, controller.signal).catch((e) => {
      if (controller.signal.aborted) { setProbeStatus('idle'); return; }
      setProbeError(e instanceof Error ? e.message : String(e));
      setProbeStatus('error');
    });
  };

  // Lazily probe the first time the section is expanded with capture on — never
  // on Step 2 load (the probe is ~N sequential GraphQL calls).
  useEffect(() => {
    if (expanded && capture && probeStatus === 'idle' && sourceZoneId) runProbe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, capture]);

  // Abort any in-flight probe on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const selected = new Set(selectedDatasets ?? available);

  // Master checkbox ↔ dataset selection stay coherent: "capture on" must mean
  // "capturing ≥1 dataset". Re-enabling with an empty selection (e.g. after the
  // user deselected every dataset) restores all available datasets rather than
  // leaving the incoherent "on but nothing selected" state.
  const handleToggleCapture = (checked: boolean) => {
    setCapture(checked);
    if (checked && selected.size === 0) {
      setSelectedDatasets(available.length > 0 ? available : null);
    }
  };

  const toggleDataset = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedDatasets([...next]);
    // Deselecting the last dataset is equivalent to turning the archive off —
    // keep the master checkbox in sync (all unselected → top-level unselected).
    if (next.size === 0) setCapture(false);
  };

  return (
    <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
      <div className="flex items-start gap-3 p-4">
        <input
          type="checkbox"
          checked={capture}
          onChange={(e) => handleToggleCapture(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-700 text-orange-500 focus:ring-orange-500 cursor-pointer"
          aria-label="Archive source analytics alongside the migration"
        />
        <button type="button" onClick={() => setExpanded(x => !x)} className="flex-1 text-left" aria-expanded={expanded}>
          <div className="flex items-center gap-2">
            <ChartLine size={18} weight="fill" className="text-orange-400 shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold text-gray-100">Archive source analytics</span>
            <span className="text-xs text-gray-500">(optional)</span>
            {expanded
              ? <CaretDown size={14} className="text-gray-500" aria-hidden="true" />
              : <CaretRight size={14} className="text-gray-500" aria-hidden="true" />}
          </div>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            <span className="font-medium text-gray-300">Analytics can&rsquo;t be migrated</span> &mdash; history stays
            with the source account. This archives a downloadable snapshot of your source-zone analytics (traffic,
            security, DNS, performance, and more) <span className="font-medium text-gray-300">in parallel</span> with
            the migration &mdash; it won&rsquo;t slow it down, and it downloads on the Results step. Expand to set the
            window and pick datasets.
          </p>
        </button>
      </div>

      {expanded && (
        <div className={`px-4 pb-4 pl-11 space-y-3 ${capture ? '' : 'opacity-40 pointer-events-none'}`}>
          {/* Time window */}
          <div>
            <label htmlFor="analytics-lookback" className="block text-xs uppercase tracking-wide text-gray-500 mb-1">
              Time window
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Last</span>
              <input
                id="analytics-lookback"
                type="number"
                min={1}
                max={90}
                value={lookbackDays}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value));
                  setLookbackDays(Number.isFinite(n) ? Math.max(1, Math.min(90, n)) : 90);
                }}
                className="w-20 bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-sm text-gray-200 focus:border-orange-500 focus:outline-none"
              />
              <span className="text-sm text-gray-400">days <span className="text-gray-600">(1&ndash;90)</span></span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Daily rollups cover the full window; high-resolution adaptive datasets return what your plan&rsquo;s
              retention allows.
            </p>
          </div>

          {/* Datasets */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs uppercase tracking-wide text-gray-500">Datasets to capture</label>
              {probeStatus === 'done' && (
                <button type="button" onClick={runProbe} className="text-xs text-orange-400 hover:text-orange-300">
                  Re-detect
                </button>
              )}
            </div>
            {probeStatus === 'running' && (
              <p className="text-xs text-gray-400">
                Detecting available datasets&hellip; <span className="text-gray-500">{probeLog}</span>
              </p>
            )}
            {probeStatus === 'error' && (
              <p className="text-xs text-yellow-400/90">
                Couldn&rsquo;t detect datasets ({probeError}). All available analytics will be captured.
              </p>
            )}
            {probeStatus === 'done' && available.length === 0 && (
              <p className="text-xs text-yellow-400/90">
                No queryable datasets detected. All available analytics will be captured.
              </p>
            )}
            {probeStatus === 'done' && available.length > 0 && (
              <div className="max-h-48 overflow-y-auto border border-gray-700/60 rounded-md bg-gray-900/40 p-2 space-y-1">
                {available.map(name => (
                  <label key={name} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(name)}
                      onChange={() => toggleDataset(name)}
                      className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-gray-300">{humanizeDataset(name)}</span>
                    <span className="text-gray-600 font-mono">{name}</span>
                  </label>
                ))}
                <p className="text-[11px] text-gray-500 pt-1">{selected.size}/{available.length} selected</p>
              </div>
            )}
            {probeStatus === 'idle' && (
              <p className="text-xs text-gray-500">Detecting which datasets your account can export&hellip;</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
