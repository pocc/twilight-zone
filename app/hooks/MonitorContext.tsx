import { createContext, useContext, type ReactNode } from 'react';
import { useUptimeMonitor, type UptimeMonitor } from './useUptimeMonitor';
import type { Credentials } from '../lib/api';
import type { OAuthRole } from '../lib/oauth';

const MonitorContext = createContext<UptimeMonitor | null>(null);

interface MonitorProviderProps {
  creds: Partial<Credentials>;
  /** Source credentials present (the Worker re-checks + host-locks server-side). */
  hasAuth: boolean;
  /** Source zone being migrated — the Worker host-locks the ping target to it. */
  sourceZoneId: string;
  /** Canonical zone name (resolved from the authenticated account's zone list). */
  zoneName: string;
  /** Whether monitoring is applicable in the current mode (api source only). */
  enabled: boolean;
  onReauthorizationRequired?: (role: OAuthRole) => void;
  children: ReactNode;
}

/**
 * Holds the pre-cutover uptime-monitor state (the once-per-second ping loop) in a
 * DEDICATED provider so its high-frequency ticks re-render ONLY the heartbeat and
 * card consumers — never the whole App tree.
 *
 * Why this exists (perf isolation): the monitor's `beat`/`last`/`history` state
 * updates ~1×/sec while running. If that state lived in App (which it used to),
 * every beat re-rendered App's entire render output, including the active wizard
 * step. The heaviest step, ScopeReview, is NOT wrapped in React.memo and is
 * re-built fresh by App's `renderScope` each render, so a large zone's full
 * Step-2 resource tables were reconciled once per second for the whole duration
 * of monitoring (Zone → Apply → Results).
 *
 * The fix is the standard "lift volatile state into a provider + pass children
 * through" pattern: App builds the wizard tree once and hands it to this provider
 * as `children`. When the monitor ticks, only THIS component re-renders; the
 * `children` element reference is unchanged, so React bails out of reconciling
 * the wizard subtree. Context propagation still re-renders the two consumers
 * (MonitorHeartbeat, UptimeMonitorCard) wherever they sit in that subtree, which
 * is exactly what should update at 1 Hz.
 *
 * Lifting to App level (above the steps) is still required so the ping loop
 * survives unmounting the Zone-step card and keeps beating through Apply and
 * Results — this provider preserves that lifetime while removing the re-render
 * cost.
 */
export function MonitorProvider({ children, ...args }: MonitorProviderProps) {
  const monitor = useUptimeMonitor(args);
  return <MonitorContext.Provider value={monitor}>{children}</MonitorContext.Provider>;
}

/** Read the active uptime monitor. Must be called within a <MonitorProvider>. */
export function useMonitor(): UptimeMonitor {
  const ctx = useContext(MonitorContext);
  if (!ctx) throw new Error('useMonitor must be used within a <MonitorProvider>');
  return ctx;
}
