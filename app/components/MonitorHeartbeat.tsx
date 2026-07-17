import { useMonitor } from '../hooks/MonitorContext';

interface MonitorHeartbeatProps {
  /** Jump back to the Zone step where the monitor can be managed/stopped. */
  onManage: () => void;
}

/**
 * Compact, always-visible heartbeat shown beside the wizard step strip while the
 * pre-cutover uptime monitor is running. It "beats" once per ping (keyed off
 * `monitor.beat`, which re-mounts the dot so the CSS pulse animation restarts),
 * so the user gets a live, between-sections signal that the source zone is being
 * health-checked every second — all the way through Apply and Results.
 *
 * Renders nothing when the monitor isn't running.
 */
export function MonitorHeartbeat({ onManage }: MonitorHeartbeatProps) {
  const { running, last, beat, zoneName } = useMonitor();
  if (!running) return null;

  const up = last?.ok ?? null;          // null = first ping in flight
  const color = up === null ? 'amber' : up ? 'green' : 'red';
  const dotClass =
    color === 'green' ? 'bg-green-500' : color === 'red' ? 'bg-red-500' : 'bg-amber-400';
  const textClass =
    color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : 'text-amber-400';
  const label = up === null ? '…' : up ? 'UP' : 'DOWN';

  return (
    <button
      type="button"
      onClick={onManage}
      title={`Pre-cutover monitor — ${zoneName || 'source zone'} is ${label}. Click to manage.`}
      aria-label={`Uptime monitor: ${zoneName || 'source zone'} is ${label}. Click to manage.`}
      className="tz-heartbeat group inline-flex items-center gap-2 rounded-full border border-gray-700/70 bg-gray-900/60 px-2.5 py-1 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:bg-gray-800/80"
    >
      <span className="tz-heartbeat-dot relative inline-flex h-2.5 w-2.5 items-center justify-center">
        {/* Re-mounted each beat (key) so the expanding ring + pulse restart in
            sync with the actual once-per-second ping. */}
        <span key={beat} className={`tz-heartbeat-ping absolute inline-flex h-2.5 w-2.5 rounded-full ${dotClass}`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotClass}`} />
      </span>
      <span className="hidden sm:inline text-gray-400">monitor</span>
      <span className={textClass}>{label}</span>
      {last && !last.error && <span className="hidden sm:inline text-gray-500">{last.latencyMs}ms</span>}
    </button>
  );
}
