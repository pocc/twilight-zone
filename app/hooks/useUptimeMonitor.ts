import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCurl } from '../lib/parseCurl';
import { monitorPing, type Credentials, type MonitorPingResult } from '../lib/api';
import { validatePingTarget } from '../../src/monitor';

export function headersToText(h: Record<string, string>): string {
  return Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n');
}
export function textToHeaders(t: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of t.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

interface UseUptimeMonitorArgs {
  creds: Partial<Credentials>;
  /** Source credentials present (the Worker re-checks + host-locks server-side). */
  hasAuth: boolean;
  /** Source zone being migrated — the Worker host-locks the ping target to it. */
  sourceZoneId: string;
  /** Canonical zone name (resolved from the authenticated account's zone list). */
  zoneName: string;
  /** Whether monitoring is applicable in the current mode (api source only). */
  enabled: boolean;
}

/**
 * Pre-cutover uptime monitor state, lifted to App level so the once-per-second
 * ping loop survives wizard step changes. Started from the Zone step's
 * UptimeMonitorCard, it keeps beating through Apply and Results and drives the
 * header heartbeat. Config + running + results live here (not in the card) so
 * unmounting the card never interrupts an active monitor.
 *
 * Security: the target host is host-locked server-side to the migrating zone;
 * `validatePingTarget` mirrors that lock client-side so the UI can only start an
 * on-zone target. Credentials are sent per-ping and never persisted.
 */
export function useUptimeMonitor({ creds, hasAuth, sourceZoneId, zoneName, enabled }: UseUptimeMonitorArgs) {
  const [curl, setCurl] = useState('');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [expectedStatus, setExpectedStatus] = useState<number | ''>(200);
  const [headersText, setHeadersText] = useState('');
  const [requestBody, setRequestBody] = useState('');
  const [parseError, setParseError] = useState('');
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<MonitorPingResult | null>(null);
  const [history, setHistory] = useState<boolean[]>([]); // recent up/down ticks
  const [beat, setBeat] = useState(0);                   // increments each tick (drives the pulse)
  const inFlight = useRef(false);

  const applyCurl = useCallback(() => {
    setParseError('');
    const parsed = parseCurl(curl);
    if (!parsed) { setParseError('Could not find a URL in that curl command.'); return; }
    setUrl(parsed.url);
    setMethod(parsed.method);
    setHeadersText(headersToText(parsed.headers));
    setRequestBody(parsed.body ?? '');
  }, [curl]);

  const tick = useCallback(async () => {
    if (inFlight.current || !url) return;
    inFlight.current = true;
    try {
      const res = await monitorPing(creds, sourceZoneId, {
        url,
        method,
        headers: textToHeaders(headersText),
        requestBody: requestBody || undefined,
        expectedStatus: expectedStatus === '' ? undefined : Number(expectedStatus),
      });
      setLast(res);
      setHistory(prev => [...prev.slice(-29), res.ok]);
    } catch (e: unknown) {
      const res: MonitorPingResult = { status: 0, ok: false, latencyMs: 0, error: (e as Error)?.message || 'request failed' };
      setLast(res);
      setHistory(prev => [...prev.slice(-29), false]);
    } finally {
      inFlight.current = false;
      setBeat(b => b + 1);
    }
  }, [creds, sourceZoneId, url, method, headersText, requestBody, expectedStatus]);

  useEffect(() => {
    if (!running) return;
    void tick();
    const id = window.setInterval(() => { void tick(); }, 1000);
    return () => window.clearInterval(id);
  }, [running, tick]);

  // Mirror the server-side host-lock client-side so the "locked to <zone>" claim
  // is enforced in the UI, not just discovered via a failed ping. Start requires:
  // monitoring enabled for this mode, a URL, the source zone, credentials, and an
  // on-zone target.
  const target = url ? validatePingTarget(url, zoneName || '') : null;
  const onZone = target?.ok === true;
  const canRun = enabled && !!url && !!sourceZoneId && hasAuth && onZone;

  let disabledReason = '';
  if (url && !hasAuth) disabledReason = 'Enter source credentials to start monitoring.';
  else if (target && !target.ok) disabledReason = target.reason;

  // If the monitor is running and the inputs stop being valid (creds cleared,
  // zone changed, URL edited off-zone, mode switched), stop the loop rather than
  // spinning on requests the Worker will reject.
  useEffect(() => {
    if (running && !canRun) {
      setRunning(false);
      setHistory([]);
      setLast(null);
    }
  }, [running, canRun]);

  return {
    // config
    curl, setCurl,
    url, setUrl,
    method, setMethod,
    expectedStatus, setExpectedStatus,
    headersText, setHeadersText,
    requestBody, setRequestBody,
    parseError,
    // runtime
    running, setRunning,
    last, history, beat,
    zoneName,
    // derived
    canRun, disabledReason, onZone,
    // actions
    applyCurl,
  };
}

export type UptimeMonitor = ReturnType<typeof useUptimeMonitor>;
