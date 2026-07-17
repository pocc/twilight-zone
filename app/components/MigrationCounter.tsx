import { useEffect, useState } from 'react';
import type { MigrationStats } from '../../src/types';
import { getStats } from '../lib/api';

// Social-proof counter. Reads the public, aggregate /api/stats endpoint
// (zones migrated, derived from logged runs) and renders an inline fragment
// "· X zones cloned" that sits right after the version in the header subtitle.
//
// Renders nothing until there is at least one migration, so the beta never
// shows an empty "0 zones cloned" line.
export function MigrationCounter() {
  const [stats, setStats] = useState<MigrationStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStats()
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => {/* counter is best-effort; stay hidden on error */});
    return () => { cancelled = true; };
  }, []);

  if (!stats || stats.zonesMigrated < 1) return null;

  const zones = stats.zonesMigrated.toLocaleString();

  return (
    <>
      {' '}
      <span className="text-gray-600">·</span>{' '}
      <span
        className="text-gray-500"
        title={`Estimate: ~${stats.hoursSaved.toLocaleString()} hours of manual work saved (${stats.hoursPerMigration}h per migration)`}
      >
        <span className="font-bold text-gray-400">{zones}</span>{' '}
        {stats.zonesMigrated === 1 ? 'zone' : 'zones'} cloned
      </span>
    </>
  );
}
