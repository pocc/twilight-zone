// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Hourly spec-drift monitor.
//
// Cloudflare's OpenAPI spec (github.com/cloudflare/api-schemas/openapi.json)
// changes ~15-20 days/month, but almost all of those commits are description /
// example edits that add NO new write endpoints. A raw file-hash alarm would
// therefore fire on most of those days — useless noise. So we compare the *set
// of write-endpoint keys* ("METHOD path"), not the file bytes:
//
//   1. The hourly cron HEADs the raw file for its ETag. If the ETag is
//      unchanged since the last successful check, we stop — no download, no
//      parse. This is why hourly is cheap: in the vast majority of hours the
//      spec hasn't changed, so the run is just one conditional HEAD request.
//   2. If the ETag changed, we fetch (~10 MB) and parse only `.paths`, build
//      the live write-key set, and diff it against the committed baseline
//      (src/openapi-baseline.generated.json, generated from the same snapshot
//      as the coverage manifest).
//   3. If — and only if — there are write endpoints in the live spec that are
//      absent from our baseline, we raise the in-app banner and ping the gchat
//      webhook. The gchat ping is de-duped on the SET of new endpoints, so a
//      run of unrelated description edits (same new-endpoint set) does not
//      re-spam; a genuinely new endpoint does.
//
// Measured cost of the parse path (only on the rare hours the spec actually
// changed): ~64 ms CPU, ~21 MB parsed heap for a 9.7 MB
// spec — comfortably inside the Worker's 30 s CPU / 128 MB limits. The whole
// check is wrapped so a failure (GitHub 5xx, network blip, future spec growth)
// degrades to an `error` state with the prior `lastSuccessfulCheck` preserved,
// and never throws into the scheduled handler. The banner surfaces staleness
// so a silently-dead cron is itself visible.

import baselineJson from '../openapi-baseline.generated.json';

const baseline = baselineJson as {
  generatedAt: string;
  apiVersion: string | null;
  writeKeyCount: number;
  writeKeys: string[];
};

const RAW_SPEC_URL = 'https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json';
const COMMITS_API_URL = 'https://api.github.com/repos/cloudflare/api-schemas/commits?path=openapi.json&per_page=1';
const KV_KEY = 'spec-monitor:status';
const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);
const USER_AGENT = 'twilight-zone-spec-monitor';
// Cap the list we send to gchat so a large baseline gap doesn't post a wall of
// text; the full list is always available via /api/spec-status.
const MAX_GCHAT_ENDPOINTS = 40;

/** Env subset the monitor needs. Both fields are optional so local `npm run
 *  dev` works without remote KV or the webhook secret. */
export type SpecMonitorEnv = {
  RUN_LOG?: KVNamespace;
  NEW_API_ENDPOINT_GCHAT_WEBHOOK?: string;
};

export type SpecStatus = {
  /** True when the last check completed without error. */
  ok: boolean;
  /** ISO timestamp of the most recent check attempt (success or failure). */
  checkedAt: string | null;
  /** ISO timestamp of the most recent SUCCESSFUL check. Drives staleness. */
  lastSuccessfulCheck: string | null;
  /** ISO timestamp of the most recent successful check that found ZERO drift
   *  (100% coverage). Lets the banner say "last 100% coverage on {date}" when
   *  drift is currently present. */
  lastFullCoverageCheck: string | null;
  /** ISO timestamp of the START of the current zero-drift streak — i.e. when
   *  coverage last *became* 100% and has held since. Set on a drift→clean
   *  transition (or first clean check), preserved across subsequent clean
   *  checks, and nulled the moment drift appears. Drives the banner's
   *  "100% coverage since {date}" line; distinct from lastFullCoverageCheck,
   *  which is the most recent clean check (streak end). */
  fullCoverageSince: string | null;
  /** When our committed baseline was generated — the "code last updated" date. */
  manifestGeneratedAt: string;
  /** Number of write endpoints in the committed baseline. */
  baselineCount: number;
  /** Number of write endpoints in the live spec (null if not yet fetched). */
  liveCount: number | null;
  /** ETag of the live spec at the last successful check. */
  specEtag: string | null;
  /** When the spec file last changed upstream (from the GitHub commits API). */
  specCommitDate: string | null;
  /** Live write endpoints absent from the baseline — the alarm payload. */
  newEndpoints: string[];
  /** Baseline write endpoints no longer present live (informational). */
  removedCount: number;
  /** Convenience: newEndpoints.length > 0. */
  drift: boolean;
  /** Signature of the new-endpoint set we last pinged gchat for (de-dupe). */
  notifiedSignature: string | null;
  /** Error message from the last failed check, else null. */
  error: string | null;
};

function emptyStatus(): SpecStatus {
  return {
    ok: false,
    checkedAt: null,
    lastSuccessfulCheck: null,
    lastFullCoverageCheck: null,
    fullCoverageSince: null,
    manifestGeneratedAt: baseline.generatedAt,
    baselineCount: baseline.writeKeyCount ?? baseline.writeKeys.length,
    liveCount: null,
    specEtag: null,
    specCommitDate: null,
    newEndpoints: [],
    removedCount: 0,
    drift: false,
    notifiedSignature: null,
    error: null,
  };
}

/** Read the last stored status for the /api/spec-status endpoint. Never throws. */
export async function readSpecStatus(kv?: KVNamespace): Promise<SpecStatus> {
  if (!kv) return emptyStatus();
  try {
    const raw = await kv.get(KV_KEY);
    if (!raw) return emptyStatus();
    const stored = JSON.parse(raw) as Partial<SpecStatus>;
    const fresh = emptyStatus();
    // KV outlives Worker deploys. If a new deploy carries a regenerated
    // baseline, any persisted drift status was computed against the previous
    // key set and is no longer authoritative. Drop it rather than showing a
    // stale red banner until the next scheduled check refreshes KV.
    if (
      stored.manifestGeneratedAt !== fresh.manifestGeneratedAt ||
      stored.baselineCount !== fresh.baselineCount
    ) {
      return fresh;
    }
    return { ...fresh, ...stored };
  } catch {
    return emptyStatus();
  }
}

async function fetchSpecCommitDate(): Promise<string | null> {
  try {
    const res = await fetch(COMMITS_API_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ commit?: { committer?: { date?: string } } }>;
    return arr?.[0]?.commit?.committer?.date ?? null;
  } catch {
    return null;
  }
}

async function notifyGchat(webhook: string, status: SpecStatus): Promise<void> {
  const shown = status.newEndpoints.slice(0, MAX_GCHAT_ENDPOINTS).map(k => `• ${k}`).join('\n');
  const overflow = status.newEndpoints.length > MAX_GCHAT_ENDPOINTS
    ? `\n…and ${status.newEndpoints.length - MAX_GCHAT_ENDPOINTS} more`
    : '';
  const text =
    `*Twilight Zone — ${status.newEndpoints.length} new Cloudflare API write endpoint(s) detected*\n` +
    `Coverage baseline generated: ${status.manifestGeneratedAt}\n` +
    `Spec last changed upstream: ${status.specCommitDate ?? 'unknown'}\n` +
    `Not yet in the committed baseline — regenerate the manifest and re-triage coverage:\n` +
    `${shown}${overflow}`;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    // Best-effort: a failed notification must not fail the check itself.
  }
}

/**
 * Run the drift check. Safe to call from a scheduled handler via
 * ctx.waitUntil — it persists its own result to KV and never throws.
 */
export async function checkSpecDrift(env: SpecMonitorEnv): Promise<SpecStatus> {
  const kv = env.RUN_LOG;
  const prev = await readSpecStatus(kv);
  const now = new Date().toISOString();
  const baseKeys = new Set(baseline.writeKeys);

  try {
    // 1. Cheap ETag probe (no body transfer).
    const head = await fetch(RAW_SPEC_URL, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    const etag = head.headers.get('etag');

    // 2. Unchanged since last good check → just refresh liveness, skip the parse.
    if (etag && prev.ok && etag === prev.specEtag) {
      const status: SpecStatus = {
        ...prev,
        checkedAt: now,
        lastSuccessfulCheck: now,
        // Spec is byte-identical to the last good check, so coverage is whatever
        // it was then. If that was full (no drift), 100% coverage holds as of now;
        // if it was drifting, the prior full-coverage date is unchanged.
        lastFullCoverageCheck: prev.drift ? prev.lastFullCoverageCheck : now,
        // Zero-drift streak continues uninterrupted; keep its start (or seed it
        // if a prior clean state somehow lacked one). Frozen/null while drifting.
        fullCoverageSince: prev.drift ? prev.fullCoverageSince : (prev.fullCoverageSince ?? now),
        error: null,
      };
      if (kv) await kv.put(KV_KEY, JSON.stringify(status));
      return status;
    }

    // 3. Changed (or first run): fetch + parse `.paths` only.
    const res = await fetch(RAW_SPEC_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`spec fetch failed: HTTP ${res.status}`);
    const spec = (await res.json()) as { paths?: Record<string, Record<string, unknown>> };

    const live = new Set<string>();
    for (const [p, methods] of Object.entries(spec.paths ?? {})) {
      if (!methods || typeof methods !== 'object') continue;
      for (const method of Object.keys(methods)) {
        if (WRITE_METHODS.has(method.toLowerCase())) live.add(`${method.toUpperCase()} ${p}`);
      }
    }

    const newEndpoints = [...live].filter(k => !baseKeys.has(k)).sort();
    let removedCount = 0;
    for (const k of baseKeys) if (!live.has(k)) removedCount++;

    const specCommitDate = await fetchSpecCommitDate();
    const signature = newEndpoints.join('\u0000');

    const status: SpecStatus = {
      ok: true,
      checkedAt: now,
      lastSuccessfulCheck: now,
      lastFullCoverageCheck: newEndpoints.length === 0 ? now : prev.lastFullCoverageCheck,
      // Streak start: keep the existing streak if still clean, start a new one on
      // a drift→clean (or first-ever-clean) transition, null it out while drifting.
      fullCoverageSince: newEndpoints.length === 0 ? (prev.fullCoverageSince ?? now) : null,
      manifestGeneratedAt: baseline.generatedAt,
      baselineCount: baseKeys.size,
      liveCount: live.size,
      specEtag: etag ?? null,
      specCommitDate,
      newEndpoints,
      removedCount,
      drift: newEndpoints.length > 0,
      notifiedSignature: prev.notifiedSignature ?? null,
      error: null,
    };

    // 4. Ping gchat only when the SET of new endpoints changed (de-dupe across
    //    unrelated description-only edits), and only when there's something new.
    const webhook = env.NEW_API_ENDPOINT_GCHAT_WEBHOOK;
    if (status.drift) {
      if (webhook && signature !== prev.notifiedSignature) {
        await notifyGchat(webhook, status);
        status.notifiedSignature = signature;
      }
    } else {
      // Drift cleared (baseline regenerated, or endpoints removed) → reset so a
      // later reappearance pings again.
      status.notifiedSignature = null;
    }

    if (kv) await kv.put(KV_KEY, JSON.stringify(status));
    return status;
  } catch (e) {
    // Preserve the prior good state's lastSuccessfulCheck; surface the error.
    const status: SpecStatus = {
      ...prev,
      ok: false,
      checkedAt: now,
      error: e instanceof Error ? e.message : String(e),
    };
    if (kv) await kv.put(KV_KEY, JSON.stringify(status));
    return status;
  }
}
