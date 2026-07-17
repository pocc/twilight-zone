import { useState } from 'react';
import { useMonitor } from '../hooks/MonitorContext';

interface UptimeMonitorCardProps {
  zoneName?: string;
}

/**
 * Pre-cutover uptime monitor. Lives in the Zone step. Paste a curl
 * targeting an endpoint on the zone being migrated; the browser pings it ~1/sec
 * via the host-locked Worker endpoint and shows a simple up/down indicator so the
 * user can confirm the endpoint stays reachable around cutover.
 *
 * The functional state (config + running + results) lives in `useUptimeMonitor`
 * at App level, so navigating to Apply/Results does NOT stop the monitor — the
 * header heartbeat keeps beating. This component is the configuration surface;
 * `open` is the only purely-local (presentational) state.
 *
 * Security: the target host is locked server-side to the migrating zone (the
 * Worker derives it from `sourceZoneId`); pasted credentials are sent per-ping
 * and never persisted/logged (AGENTS.md §7).
 */
export function UptimeMonitorCard({ zoneName }: UptimeMonitorCardProps) {
  const [open, setOpen] = useState(false);
  const monitor = useMonitor();
  const {
    curl, setCurl, url, setUrl, method, setMethod,
    expectedStatus, setExpectedStatus, headersText, setHeadersText,
    parseError, running, setRunning, last, history,
    canRun, disabledReason, applyCurl,
  } = monitor;

  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-gray-200">
          Pre-cutover uptime monitor <span className="text-gray-500 font-normal">(optional)</span>
        </span>
        <span className="flex items-center gap-2">
          {running && (
            <span className={`inline-flex items-center gap-1 text-xs ${last?.ok ? 'text-green-400' : 'text-red-400'}`}>
              <span className={`w-2 h-2 rounded-full ${last?.ok ? 'bg-green-500' : 'bg-red-500'}`} />
              {last ? (last.ok ? 'UP' : 'DOWN') : '…'}
            </span>
          )}
          <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-700/70 pt-3">
          <p className="text-xs text-gray-400">
            Paste a <code className="text-gray-300">curl</code> for an endpoint on{' '}
            <span className="text-gray-300">{zoneName || 'the migrating zone'}</span>. The target host is
            locked to that zone server-side. Pinged ~once/sec; it keeps running
            through Apply and Results (watch the heartbeat up top). Credentials are
            never stored.
          </p>
          <form className="contents" onSubmit={(e) => e.preventDefault()}>
            <textarea
              value={curl}
              onChange={(e) => setCurl(e.target.value)}
              placeholder={`curl 'https://${zoneName || 'zone.example'}/health'`}
              rows={2}
              aria-label="Health-check curl command"
              className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-xs font-mono text-gray-100 focus:border-orange-500 focus:outline-none"
            />
          </form>
          <div className="flex items-center gap-2">
            <button type="button" onClick={applyCurl}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded transition">
              Parse curl
            </button>
            {parseError && <span className="text-xs text-red-400">{parseError}</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://zone.example/health"
              aria-label="Health-check URL"
              className="bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-xs font-mono text-gray-100 focus:border-orange-500 focus:outline-none"
            />
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              aria-label="HTTP method"
              className="bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 focus:border-orange-500 focus:outline-none">
              {['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
              type="number"
              value={expectedStatus}
              onChange={(e) => setExpectedStatus(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="200"
              title="Expected status code (online = match)"
              className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-100 focus:border-orange-500 focus:outline-none"
            />
          </div>
          {headersText && (
            <textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              rows={Math.min(4, headersText.split('\n').length)}
              spellCheck={false}
              aria-label="Request headers (one per line, Name: value)"
              className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-xs font-mono text-gray-100 focus:border-orange-500 focus:outline-none"
            />
          )}

          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={!canRun && !running}
              onClick={() => setRunning(r => !r)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition ${
                running
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : canRun
                    ? 'bg-orange-500 hover:bg-orange-400 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              {running ? 'Stop' : 'Start monitoring'}
            </button>
            {!running && disabledReason ? (
              <span className="text-xs text-amber-400">{disabledReason}</span>
            ) : last && (
              <span className="text-xs text-gray-400">
                last: <span className={last.ok ? 'text-green-400' : 'text-red-400'}>{last.error ? last.error : `HTTP ${last.status}`}</span>
                {!last.error && <> · {last.latencyMs}ms</>}
              </span>
            )}
          </div>

          {history.length > 0 && (
            <div className="flex items-center gap-0.5" aria-label="recent uptime ticks">
              {history.map((up, i) => (
                <span key={i} className={`w-1.5 h-4 rounded-sm ${up ? 'bg-green-500' : 'bg-red-500'}`} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
