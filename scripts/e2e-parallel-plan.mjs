// Pure planning logic for parallel E2E execution (L2/L3). No side effects, no
// network, no env — safe to import from the orchestrator and from unit tests.
//
// The hard correctness constraint: account-scoped resources (KV/R2/D1/Queues/
// Workers/Access/Turnstile/account-rulesets/custom-lists) live in ONE shared
// target account, and the harness's account-scoped cleanup sweep matches by
// resource-name prefix across the WHOLE account. So if two account-scoped tests
// ran concurrently, slot A's cleanup could delete slot B's resources mid-run.
//
// Until per-slot account-resource isolation exists, the safe invariant is:
// **at most one account-scoped test runs at any instant.** This planner enforces
// that by placing every account-scoped test in a single serialized bucket
// (slot 0) and fanning the zone-scoped tests (isolated by their own per-slot
// zone) across the remaining slots. Zone-scoped tests never collide because each
// slot owns a distinct source+dest zone from the zone pool.

const DEFAULT_TOTAL_RATE = 1000; // requests / 5 min (matches rate-limiter default)
const MIN_SLOT_RATE = 200;       // floor so a slot still makes progress

/**
 * Resource sections that imply account-scoped seeding (collide across the shared
 * target account). Used to classify a config when `selectAccountScoped` isn't
 * set explicitly.
 */
export const ACCOUNT_SCOPED_SECTIONS = [
  'kv_namespaces', 'r2_buckets', 'd1_databases', 'queues', 'workers',
  'access_apps', 'access_groups', 'turnstile', 'account_rulesets',
  'custom_lists', 'vectorize_indexes', 'hyperdrive_configs', 'secrets_store_stores',
  'dispatch_namespaces', 'pipelines', 'workflows',
];

/**
 * Decide whether a loaded config touches account-scoped resources.
 * @param {object} config a test config object
 * @returns {boolean}
 */
export function isAccountScoped(config) {
  if (!config || typeof config !== 'object') return false;
  if (config.metadata?.selectAccountScoped === true) return true;
  return ACCOUNT_SCOPED_SECTIONS.some(section => {
    const v = config[section];
    return Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' && Object.keys(v).length > 0;
  });
}

/**
 * Partition tests into per-slot buckets for parallel execution.
 *
 * @param {Array<{rank:number, accountScoped:boolean}>} items
 * @param {number} concurrency  number of parallel slots (>=1)
 * @returns {number[][]} buckets[slot] = ordered list of ranks for that slot
 *
 * Rules:
 *  - concurrency <= 1 → a single bucket with all ranks in ascending order
 *    (i.e. exactly the sequential order; the orchestrator is a no-op).
 *  - otherwise → all account-scoped ranks go to slot 0 (serialized, ascending);
 *    zone-scoped ranks round-robin across slots 1..N-1 (ascending within slot).
 *    If there's only the account bucket worth of work, higher slots are empty.
 */
export function partitionTests(items, concurrency) {
  const ranks = [...items].sort((a, b) => a.rank - b.rank);
  const n = Math.max(1, Math.floor(concurrency) || 1);
  if (n === 1) return [ranks.map(i => i.rank)];

  const buckets = Array.from({ length: n }, () => []);
  const account = ranks.filter(i => i.accountScoped).map(i => i.rank);
  const zone = ranks.filter(i => !i.accountScoped).map(i => i.rank);

  // All account-scoped tests serialized on slot 0 (shared-account safety).
  buckets[0].push(...account);

  // Zone-scoped tests fan out across the remaining slots (or all slots if there
  // are no account-scoped tests, so slot 0 isn't idle).
  const zoneSlots = account.length ? n - 1 : n;
  const offset = account.length ? 1 : 0;
  zone.forEach((rank, i) => {
    const slot = zoneSlots > 0 ? offset + (i % zoneSlots) : 0;
    buckets[slot].push(rank);
  });

  return buckets;
}

/**
 * Per-slot rate-limit budget so N concurrent slots stay within the per-user
 * Cloudflare API ceiling. Floors at MIN_SLOT_RATE so a slot still progresses.
 *
 * @param {number} concurrency
 * @param {number} [total=DEFAULT_TOTAL_RATE]
 * @returns {number} requests per window for ONE slot
 */
export function perSlotRateLimit(concurrency, total = DEFAULT_TOTAL_RATE) {
  const n = Math.max(1, Math.floor(concurrency) || 1);
  return Math.max(MIN_SLOT_RATE, Math.floor(total / n));
}

export const _internals = { DEFAULT_TOTAL_RATE, MIN_SLOT_RATE };
