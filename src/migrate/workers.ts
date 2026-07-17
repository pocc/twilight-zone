// Worker-binding helpers and dependency planning. All pure functions —
// no I/O, no shared mutable state. Safe to unit-test in isolation.
//
// Extracted from src/migrate.ts to keep the orchestrator focused on
// pipeline logic.

import type { CFWorkerBinding, ReportSection } from '../types';

export type WorkerWithBindings = { id: string; bindings?: CFWorkerBinding[] };

/**
 * A backing storage resource the migrator auto-created EMPTY because a
 * selected worker bound to it but the user did not select it for migration.
 * The resource exists on the destination so the worker uploads, but it
 * carries no data — the user acknowledged this in Step 2.
 */
export type AutoCreatedEmptyResource = {
  type: 'KV namespace' | 'R2 bucket' | 'D1 database' | 'Queue';
  name: string;
};

const AUTO_CREATED_EMPTY_REASON: Record<AutoCreatedEmptyResource['type'], string> = {
  'KV namespace': 'Created empty — keys are not copied automatically. Re-run and select the namespace in Step 2 to migrate its data, or reseed with `wrangler kv key put` / the bulk API.',
  'R2 bucket': 'Created empty — objects are not copied automatically. Re-run and select the bucket in Step 2 (with S3 credentials) to copy data, or use rclone / the S3 API.',
  'D1 database': 'Created empty — no schema or data, so queries fail until you apply a dump with `wrangler d1 execute <name> --remote --file=<dump>.sql`.',
  'Queue': 'Created empty — in-flight messages from the source queue are not replayed.',
};

/**
 * Build a Step 4 report section that REFLECTS the empty backing resources the
 * migrator auto-created (AGENTS.md Principle 1 — No Surprise Failures: the
 * outcome the user acknowledged in Step 2 must be visible on the Results
 * page). Pure: returns the section (or null when nothing was auto-created);
 * the caller pushes it and updates `report.summary`. Items are `acknowledged`
 * (not `success`) because the resource exists but its DATA was deliberately
 * not migrated — the honest status for "you knew this wouldn't fully migrate."
 */
export function buildAutoCreatedEmptySection(
  created: AutoCreatedEmptyResource[],
): ReportSection | null {
  if (created.length === 0) return null;
  const items = created.map(c => ({
    name: `${c.type} "${c.name}"`,
    status: 'acknowledged' as const,
    reason: AUTO_CREATED_EMPTY_REASON[c.type],
  }));
  return {
    name: 'Auto-Created Backing Resources (empty)',
    total: items.length,
    success: 0,
    failed: 0,
    skipped: 0,
    acknowledged: items.length,
    items,
  };
}

// Remove `service` bindings from a worker's binding list. Used when a
// worker must be deployed in a cycle: we strip outgoing service edges,
// upload the worker without them, then re-upload with the full bindings
// once the dependencies exist. See `planWorkerDeploymentLevels` for the
// cycle-detection logic that determines when to call this.
export function stripServiceBindings(bindings: CFWorkerBinding[]): CFWorkerBinding[] {
  return bindings.filter(b => b.type !== 'service');
}

/**
 * Strip server-set / read-only fields from bindings before uploading to dest.
 *
 * Some binding types are returned from the CF API with extra fields that the
 * dest upload API rejects. Known cases:
 *   - `browser` bindings come back with a `version: 2` field that the dest
 *     "binding ... of type browser cannot use version 2" with code 10021.
 *     The version is server-set, not a user choice — strip it.
 *
 * If you hit a new "cannot use" / "unknown field" error during worker upload,
 * add the offending field here (and a regression test in test/migrate.test.ts).
 *
 * Pure function — does not mutate the input.
 */
export function sanitizeBindingsForUpload(bindings: CFWorkerBinding[]): CFWorkerBinding[] {
  return bindings.map(b => {
    if (b.type === 'browser') {
      const { version: _version, ...rest } = b as CFWorkerBinding & { version?: number };
      return rest as CFWorkerBinding;
    }
    return b;
  });
}

/**
 * Filter out bindings that reference capability-gated resources the dest
 * account doesn't have. Returns `{ bindings, dropped }` where `dropped`
 * lists what was removed (so the caller can surface acknowledgments).
 *
 * Backing rationale: when R2, D1, Queues, KV, Workflows, Pipelines etc.
 * are unavailable on dest, the migrate flow empties `exportData[field]`
 * via the capability acknowledgment loop. But a worker's bindings still
 * reference the resource by name/id, and the dest API rejects the upload
 * with "X not found in your account". The right behaviour is to drop
 * the offending bindings from the upload (and acknowledge in the report),
 * not let the whole worker fail.
 *
 * @param bindings the worker's bindings (after `sanitizeBindingsForUpload`)
 * @param skipFields the set of `exportData` keys emptied by the cap-gap loop
 */
export function filterBindingsByCapGap(
  bindings: CFWorkerBinding[],
  skipFields: ReadonlySet<string>,
): { bindings: CFWorkerBinding[]; dropped: Array<{ type: string; name: string; reason: string }> } {
  // Map binding type → exportData field whose absence means the binding
  // is unusable. Keep in sync with `capabilityResourceMap` in migrate.ts.
  const BINDING_TO_FIELD: Record<string, string> = {
    r2_bucket: 'r2Buckets',
    kv_namespace: 'kvNamespaces',
    d1: 'd1Databases',
    queue: 'queues',
  };
  const dropped: Array<{ type: string; name: string; reason: string }> = [];
  const filtered = bindings.filter(b => {
    const field = BINDING_TO_FIELD[b.type];
    if (field && skipFields.has(field)) {
      dropped.push({
        type: b.type,
        name: b.name || (b as { bucket_name?: string }).bucket_name || (b as { namespace_id?: string }).namespace_id || 'unknown',
        reason: `${field} not available on destination account — binding dropped from worker upload`,
      });
      return false;
    }
    return true;
  });
  return { bindings: filtered, dropped };
}

// Build a map of worker id → list of service-binding-dependent worker ids.
// Only includes deps that are also in the input list (a worker may have a
// service binding to a worker outside the migration scope; we ignore those).
export function getWorkerServiceDeps(workers: WorkerWithBindings[]): Map<string, string[]> {
  const ids = new Set(workers.map(w => w.id));
  const deps = new Map<string, string[]>();
  for (const w of workers) {
    const set = new Set<string>();
    for (const b of w.bindings || []) {
      if (b.type === 'service' && b.service && ids.has(b.service)) {
        set.add(b.service);
      }
    }
    deps.set(w.id, [...set]);
  }
  return deps;
}

// Tarjan's strongly-connected-components algorithm. Used to detect cycles
// in the worker service-binding graph so we know which workers need the
// strip → upload → re-upload dance.
export function stronglyConnectedComponents(nodes: string[], edges: Map<string, string[]>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const result: string[][] = [];

  const visit = (v: string) => {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of edges.get(v) || []) {
      if (!indices.has(w)) {
        visit(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp: string[] = [];
      while (true) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      result.push(comp);
    }
  };

  for (const n of nodes) {
    if (!indices.has(n)) visit(n);
  }

  return result;
}

/**
 * Plan worker deployment order so dependencies upload first.
 *
 * Returns:
 *   - `levels`: ordered list of "deployment levels". All workers in level N
 *     can deploy in parallel; level N+1 must wait until level N completes
 *     (because workers in N+1 have service bindings into N).
 *   - `cycleWorkerIds`: set of worker ids that participate in a cycle (either
 *     in a multi-worker SCC or as a single-worker self-loop). The caller
 *     should deploy these without service bindings first, then re-upload
 *     with bindings after the cycle is satisfied.
 */
export function planWorkerDeploymentLevels<T extends WorkerWithBindings>(workers: T[]): {
  levels: T[][];
  cycleWorkerIds: Set<string>;
} {
  if (workers.length === 0) return { levels: [], cycleWorkerIds: new Set() };

  const byId = new Map<string, T>(workers.map(w => [w.id, w]));
  const orderIndex = new Map<string, number>(workers.map((w, i) => [w.id, i]));
  const edges = getWorkerServiceDeps(workers);
  const nodes = workers.map(w => w.id);

  const comps = stronglyConnectedComponents(nodes, edges);
  const compIndex = new Map<string, number>();
  for (let i = 0; i < comps.length; i++) {
    for (const n of comps[i]) compIndex.set(n, i);
  }

  const compIsCycle = new Array(comps.length).fill(false);
  for (let i = 0; i < comps.length; i++) {
    const comp = comps[i];
    if (comp.length > 1) {
      compIsCycle[i] = true;
      continue;
    }
    const only = comp[0];
    const selfLoop = (edges.get(only) || []).includes(only);
    if (selfLoop) compIsCycle[i] = true;
  }

  const cycleWorkerIds = new Set<string>();
  for (let i = 0; i < comps.length; i++) {
    if (compIsCycle[i]) {
      for (const n of comps[i]) cycleWorkerIds.add(n);
    }
  }

  // Build condensation graph between components.
  const compEdges = new Map<number, Set<number>>();
  const indegree = new Array(comps.length).fill(0);
  for (let i = 0; i < comps.length; i++) compEdges.set(i, new Set());

  // Note: edges are worker -> dependency. For deployment ordering we need
  // dependency -> dependent so prerequisites deploy first.
  for (const [from, tos] of edges.entries()) {
    const dependentComp = compIndex.get(from)!;
    for (const to of tos) {
      const dependencyComp = compIndex.get(to)!;
      if (dependentComp === dependencyComp) continue;
      const set = compEdges.get(dependencyComp)!;
      if (!set.has(dependentComp)) {
        set.add(dependentComp);
        indegree[dependentComp]++;
      }
    }
  }

  const compOrderKey = (compId: number): number => {
    let min = Infinity;
    for (const n of comps[compId]) {
      const idx = orderIndex.get(n);
      if (idx !== undefined) min = Math.min(min, idx);
    }
    return min === Infinity ? compId : min;
  };

  const remaining = new Set<number>(Array.from({ length: comps.length }, (_, i) => i));
  const levels: T[][] = [];

  while (remaining.size > 0) {
    const zeros = [...remaining].filter(id => indegree[id] === 0);
    // Condensation graph is a DAG; this should never be empty.
    if (zeros.length === 0) break;
    zeros.sort((a, b) => compOrderKey(a) - compOrderKey(b));

    const levelWorkers: T[] = [];
    for (const compId of zeros) {
      remaining.delete(compId);
      // Keep worker order stable within a level.
      const ns = [...comps[compId]].sort((a, b) => (orderIndex.get(a)! - orderIndex.get(b)!));
      for (const n of ns) {
        const w = byId.get(n);
        if (w) levelWorkers.push(w);
      }
      for (const next of compEdges.get(compId) || []) {
        indegree[next]--;
      }
    }
    if (levelWorkers.length > 0) levels.push(levelWorkers);
  }

  return { levels, cycleWorkerIds };
}

/**
 * Manual actions for worker secret_text bindings whose values were NOT supplied
 * via workerSecrets. secret_text VALUES are write-only — they cannot be read
 * from the source account, so an unset one lands EMPTY on the destination and
 * the worker is silently broken (env.SECRET undefined) until the user re-adds
 * it. Surfacing this is required by Principle 1 (no surprise failures) and
 * Principle 3/4 (secrets need a manual action). Pure + exported for unit testing
 * (test/workerSecrets.test.ts); used by BOTH worker-deploy paths
 * (workers-deploy.ts and batch2.ts) so neither can silently drop a secret.
 */
export function workerSecretManualActions(
  workers: Array<{ id: string; bindings?: Array<{ type?: string; name?: string }> }>,
  workerSecrets?: Record<string, Record<string, string>>,
): string[] {
  const needing: string[] = [];
  for (const w of workers) {
    const unset = (w.bindings || [])
      .filter(b => b.type === 'secret_text')
      .map(b => b.name || '')
      .filter(name => name && !workerSecrets?.[w.id]?.[name]);
    if (unset.length) needing.push(`${w.id} (${unset.join(', ')})`);
  }
  if (needing.length === 0) return [];
  return [
    `Re-add worker secret values that could not be migrated — secret_text values are write-only and cannot be read from the source account, so these landed empty on the destination: ${needing.join('; ')}. Provide secret values in Step 3 of the migration wizard, or run \`wrangler secret put <NAME>\` on each worker.`,
  ];
}
