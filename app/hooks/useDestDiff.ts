// Step 2 "already identical on destination" support (#15 decision 6).
//
// When migrating in OVERWRITE mode against a destination account that already
// has a zone with the same name, some resources may already exist on the
// destination with identical values — overwriting them is a no-op. This hook
// resolves the destination zone, exports it, diffs it against the source
// export, and returns the set of identical resources so Step 2 can gray those
// rows as advisory no-ops.
//
// Gating (cost): only runs when `enabled` (conflictStrategy === 'overwrite')
// AND a destination zone with the same name actually exists. The common
// migration case (fresh destination zone) does zero extra work — the zone
// lookup returns no match and the hook resolves to an empty set.
//
// Safety: this is purely advisory. Any failure (network, no dest zone, abort)
// resolves to an empty set and never throws — so it can only add or omit a
// badge, never affect what migrates. Items stay selected regardless.

import { useEffect, useState } from 'react';
import { streamRequest, type Credentials } from '../lib/api';
import { buildIdenticalSet, type IdenticalResource } from '../components/steps/scope/identicalItems';
import type { ZoneExport } from '../../src/types';

export type DestDiffStatus = 'idle' | 'loading' | 'done' | 'error';

interface UseDestDiffParams {
  /** Only run when true (conflictStrategy === 'overwrite'). */
  enabled: boolean;
  creds: Partial<Credentials>;
  destAccountId: string;
  zoneName: string;
  sourceExport: ZoneExport | null;
}

export function useDestDiff(params: UseDestDiffParams): {
  identicalSet: Set<string>;
  status: DestDiffStatus;
} {
  const { enabled, creds, destAccountId, zoneName, sourceExport } = params;
  const [identicalSet, setIdenticalSet] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<DestDiffStatus>('idle');

  // Destructure the cred fields we use so the effect can depend on primitives
  // rather than the (newly-allocated-every-render) creds object.
  const { useApiKey, apiKey, apiEmail, destApiKey, destApiEmail, destToken, sourceToken } = creds;

  useEffect(() => {
    if (!enabled || !destAccountId || !zoneName || !sourceExport) {
      setIdenticalSet(new Set());
      setStatus('idle');
      return;
    }

    const ctrl = new AbortController();
    let stale = false;
    const destAuth: Record<string, unknown> = useApiKey
      ? { useApiKey: true, apiKey: destApiKey || apiKey, apiEmail: destApiEmail || apiEmail }
      : { token: destToken || sourceToken };

    const finish = (set: Set<string>, s: DestDiffStatus) => {
      if (stale) return;
      setIdenticalSet(set);
      setStatus(s);
    };

    (async () => {
      setStatus('loading');
      try {
        // 1. Resolve the destination zone by name. No match → fresh dest,
        //    nothing to gray.
        const zres = await fetch('/api/zones', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...destAuth, accountId: destAccountId }),
          signal: ctrl.signal,
        });
        if (!zres.ok) return finish(new Set(), 'done');
        const { zones } = (await zres.json()) as { zones?: Array<{ id: string; name: string }> };
        const destZone = zones?.find((z) => z.name === zoneName);
        if (!destZone) return finish(new Set(), 'done');

        // 2. Export the destination zone.
        let destExport: ZoneExport | null = null;
        await streamRequest(
          '/api/export/stream',
          { ...destAuth, sourceZoneId: destZone.id, sourceAccountId: destAccountId },
          {
            onLog: () => {},
            onDone: (data) => { destExport = (data.export as ZoneExport) ?? null; },
            onError: () => {},
          },
          ctrl.signal,
        );
        if (stale) return;
        if (!destExport) return finish(new Set(), 'done');

        // 3. Diff source vs destination; the `identical` list is the skip set.
        let identical: IdenticalResource[] = [];
        await streamRequest(
          '/api/diff/stream',
          { sourceExport, destExport },
          {
            onLog: () => {},
            onDone: (data) => { identical = (data.identical as IdenticalResource[]) ?? []; },
            onError: () => {},
          },
          ctrl.signal,
        );
        finish(buildIdenticalSet(identical), 'done');
      } catch {
        // Aborts and network errors alike → advisory feature stays silent.
        finish(new Set(), 'error');
      }
    })();

    return () => {
      stale = true;
      ctrl.abort();
    };
  }, [
    enabled, destAccountId, zoneName, sourceExport,
    useApiKey, apiKey, apiEmail, destApiKey, destApiEmail, destToken, sourceToken,
  ]);

  return { identicalSet, status };
}
