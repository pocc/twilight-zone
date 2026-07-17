// Setup-step "does the destination zone already exist?" probe.
//
// The conflict-strategy (Skip / Overwrite) toggle is only meaningful when the
// destination zone is already present on the destination account — otherwise
// the flow creates the zone fresh and there is nothing to overwrite. Every flow
// (api / json / terraform / maxconfig / minconfig) now targets the destination
// account, whose zones are NOT loaded as a dropdown in Setup, so we resolve
// existence with a live /api/zones lookup here — the same call useDestDiff makes.
//
// Gating (cost): only runs when `enabled`. The lookup is debounced because the
// zone name is typed; each keystroke would otherwise hit /api/zones.
//
// Safety: purely advisory. Any failure (network, no auth, abort) resolves to
// `exists: false` and never throws — it can only show or hide the toggle, never
// affect what migrates.

import { useEffect, useState } from 'react';
import type { Credentials } from '../lib/api';

export type DestZoneStatus = 'idle' | 'loading' | 'done' | 'error';

interface UseDestZoneExistsParams {
  /** Only run when true (migration mode + dest auth + account + zone name). */
  enabled: boolean;
  creds: Partial<Credentials>;
  destAccountId: string;
  /** Zone name to look for. Caller should pass the normalized (lowercased,
   *  trailing-dot-stripped) name; the match is done case-insensitively. */
  zoneName: string;
  /** Debounce delay in ms before the lookup fires (default 500). */
  debounceMs?: number;
}

export function useDestZoneExists(params: UseDestZoneExistsParams): {
  exists: boolean;
  status: DestZoneStatus;
} {
  const { enabled, creds, destAccountId, zoneName, debounceMs = 500 } = params;
  const [exists, setExists] = useState(false);
  const [status, setStatus] = useState<DestZoneStatus>('idle');

  // Depend on primitives, not the (re-allocated-every-render) creds object.
  const { useApiKey, apiKey, apiEmail, destApiKey, destApiEmail, destToken, sourceToken } = creds;

  useEffect(() => {
    const normalized = zoneName.trim().toLowerCase().replace(/\.$/, '');
    if (!enabled || !destAccountId || !normalized) {
      setExists(false);
      setStatus('idle');
      return;
    }

    const ctrl = new AbortController();
    let stale = false;
    const destAuth: Record<string, unknown> = useApiKey
      ? { useApiKey: true, apiKey: destApiKey || apiKey, apiEmail: destApiEmail || apiEmail }
      : { token: destToken || sourceToken };

    const finish = (found: boolean, s: DestZoneStatus) => {
      if (stale) return;
      setExists(found);
      setStatus(s);
    };

    const timer = setTimeout(() => {
      (async () => {
        setStatus('loading');
        try {
          const res = await fetch('/api/zones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...destAuth, accountId: destAccountId }),
            signal: ctrl.signal,
          });
          if (!res.ok) return finish(false, 'done');
          const { zones } = (await res.json()) as { zones?: Array<{ id: string; name: string }> };
          const found = !!zones?.some((z) => z.name.toLowerCase().replace(/\.$/, '') === normalized);
          finish(found, 'done');
        } catch {
          // Aborts and network errors alike → treat as "not found" (toggle hidden).
          finish(false, 'error');
        }
      })();
    }, debounceMs);

    return () => {
      stale = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [
    enabled, destAccountId, zoneName, debounceMs,
    useApiKey, apiKey, apiEmail, destApiKey, destApiEmail, destToken, sourceToken,
  ]);

  return { exists, status };
}
