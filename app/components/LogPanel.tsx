import React, { useState, useEffect, useRef } from 'react';
import { Copy, CaretUp, CaretDown } from '@phosphor-icons/react';
import type { LogLine } from '../hooks/useStreamRequest';
import { progressPct } from '../lib/progress';

export interface LogPanelProps {
  logs: LogLine[];
  title: string;
  /** Shows spinner in header, progress bar, and percentage badge */
  isLive?: boolean;
  /** Progress bar and header percentage badge (requires isLive) */
  progress?: { current: number; total: number };
  /** Elapsed timer in footer (shown whenever provided) */
  startTime?: number | null;
  /** Cancel button in footer */
  onCancel?: () => void;
  /** Header becomes a toggle button; log area hidden by default */
  collapsible?: boolean;
  /** When collapsible, start expanded instead of collapsed (toggle still works) */
  defaultExpanded?: boolean;
  /** CSS max-height for the log scroll area (e.g. "300px", "400px") */
  maxHeight?: string;
}

export function LogPanel({
  logs,
  title,
  isLive,
  progress,
  startTime,
  onCancel,
  collapsible,
  defaultExpanded,
  maxHeight,
}: LogPanelProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded ?? !collapsible);

  // Auto-scroll to bottom as new logs arrive
  useEffect(() => {
    if (logRef.current && expanded) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs.length, expanded]);

  // Elapsed timer
  useEffect(() => {
    if (startTime == null) { setElapsed(0); return; }
    const interval = setInterval(() => {
      setElapsed((Date.now() - startTime) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);

  // progressPct clamps to [0, 100] — the engine's progress denominator is an
  // estimate the numerator can outrun (see app/lib/progress.ts), which is how
  // the bar previously showed an impossible 366%.
  const pct = progress ? progressPct(progress.current, progress.total) : 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(logs.map((l) => l.message).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copyButton = (
    <button
      type="button"
      onClick={handleCopy}
      className="text-gray-500 hover:text-gray-300 transition p-0.5 cursor-pointer"
      title="Copy log to clipboard"
      aria-label="Copy log to clipboard"
    >
      {copied ? (
        <span className="text-green-400 text-[10px] font-medium" role="status">Copied!</span>
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
    </button>
  );

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/50 transition text-left cursor-pointer"
        >
          <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>{logs.length} messages</span>
            {expanded
              ? <CaretUp size={12} aria-hidden="true" />
              : <CaretDown size={12} aria-hidden="true" />}
          </div>
        </button>
      ) : (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-3">
            {isLive && (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-orange-500 border-t-transparent" />
            )}
            <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
          </div>
          {isLive && progress && (
            <span className="text-orange-400 font-mono text-xs">{pct}%</span>
          )}
        </div>
      )}

      {/* Progress bar (live + non-collapsible only) */}
      {isLive && progress && !collapsible && (
        <div className="w-full bg-gray-700 h-1.5">
          <div
            className="bg-orange-500 h-1.5 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Log output + footer (collapsible: only when expanded) */}
      {expanded && (
        <>
          {/* role="log" + aria-live="polite" makes screen readers
              announce streaming log lines as they arrive. "polite" (not
              "assertive") so progress messages don't interrupt other
              announcements - error lines stand out via colour, not
              urgency. aria-atomic="false" announces only the new lines,
              not the whole log on each update. */}
          <div
            ref={logRef}
            role="log"
            aria-label={`${title} output`}
            aria-live={isLive ? 'polite' : 'off'}
            aria-atomic="false"
            className="bg-[#0d1117] text-[#c9d1d9] p-3 font-mono text-xs leading-relaxed border-t border-[#30363d]"
            style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
          >
            {logs.map((line, i) => (
              <div key={i} className={`my-0.5 log-line ${line.type}`}>
                {line.message}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span>{logs.length} messages</span>
              {copyButton}
            </div>
            <div className="flex items-center gap-4">
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded font-medium transition cursor-pointer"
                >
                  Cancel &amp; Rollback
                </button>
              )}
              {startTime != null && (
                <span className="font-mono tabular-nums" aria-label={`Elapsed time: ${elapsed.toFixed(1)} seconds`}>
                  {elapsed.toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
