// Certificate-pack helpers.

/**
 * Deduplicate certificate packs by their natural key: hosts (sorted) + type
 * + certificate_authority. Cloudflare's source zones routinely accumulate
 * multiple `certificate_packs` entries for the same hostname pair because
 * each pinned certificate gets its own pack record. Migrating these
 * verbatim causes 1 successful POST followed by N-1 "transient cert service
 * unavailable" errors (the dest backend guards against duplicate packs and
 * returns a misleading 4xx instead of a clean conflict). A run with many
 * accumulated duplicates produces a wall of misleading "transient" failures
 * that are actually duplicate-rejects.
 *
 * Pure function: returns `{unique, duplicates}` where `unique` is the
 * first occurrence of each tuple in input order, and `duplicates` is
 * everything else (preserved so the caller can surface them as skipped).
 */
export function dedupeCertificatePacks<T extends { hosts?: string[]; type?: string; certificate_authority?: string; id?: string }>(
  packs: T[],
): { unique: T[]; duplicates: T[] } {
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const p of packs) {
    const hosts = [...(p.hosts || [])].map(h => h.toLowerCase()).sort().join(',');
    const type = (p.type || '').toLowerCase();
    const ca = (p.certificate_authority || '').toLowerCase();
    const key = `${hosts}|${type}|${ca}`;
    if (seen.has(key)) {
      duplicates.push(p);
    } else {
      seen.add(key);
      unique.push(p);
    }
  }
  return { unique, duplicates };
}
