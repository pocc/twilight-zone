// ── Source-zone analytics export ──────────────────────────────────────
//
// SOURCE zone so a user can archive it before losing access to the source
// account. Analytics history is `data_ephemeral` in the IMPOSSIBLE_TO_MIGRATE
// catalogue (src/types.ts) — it cannot be recreated on the destination via
// any API. This exporter does not migrate anything; it pulls a read-only
// snapshot the user can download (offered on Step 4).
//
// Coverage strategy ("everything queryable", honestly):
//   1. Introspect the GraphQL `Zone` type to enumerate EVERY analytics dataset
//      the schema exposes (fields ending in `Groups`). That list is the
//      authoritative "what exists" manifest — it never lies about coverage.
//   2. Query a curated set of those datasets with known-good selections
//      (traffic, security, DNS, performance, load balancing, spectrum).
//   3. Pull a handful of REST analytics reports that have no GraphQL twin.
//   4. Record every dataset we DIDN'T pull (available - curated) in
//      `manifest.skippedDatasets` so the bundle is transparent about gaps.
//
// Every dataset/endpoint is best-effort: an entitlement/plan/permission error
// is captured per-item ({ error }) instead of aborting the whole export —
// the same tolerance posture as isExportTolerable() in src/api.ts.

import { AuthError, CF_API, getAuthHeaders, createAuth, throwIfCloudflareAuthResponse, type ApiAuth } from './api';
import type {
  AnalyticsExport, AnalyticsDatasetResult, AnalyticsRestResult,
  AnalyticsDatasetAvailability, AnalyticsProbeResult,
} from './types';

const ANALYTICS_TOOL_VERSION = '0.1.0-spike';

// Per-GraphQL-call timeout. GraphQL analytics queries can be slower than REST
// reads, so allow more headroom than cfFetch's 30s default.
const GRAPHQL_TIMEOUT_MS = 45_000;

// Cap rows returned per dataset. `limit` bounds GraphQL group cardinality so a
// busy zone can't produce a multi-hundred-MB bundle. Tunable per dataset.
const DEFAULT_GROUP_LIMIT = 1000;

export interface AnalyticsExportBody {
  sourceToken?: string;
  sourceZoneId: string;
  sourceAccountId: string;
  useApiKey?: boolean;
  apiKey?: string;
  apiEmail?: string;
  /** How many days back to query. Default 7. Clamped to [1, 365]. */
  lookbackDays?: number;
  /** Optional human-readable zone name for the bundle metadata. */
  zoneName?: string;
  /**
   * When provided and non-empty, capture ONLY these GraphQL datasets (by name)
   * — the per-dataset selection from the Step 2 "Archive source analytics"
   * section. Omitted/empty = capture every available dataset (the default).
   * Datasets the caller deselected appear in manifest.skippedDatasets.
   */
  datasets?: string[];
}

type LogFn = (message: string) => void;

interface GraphQLResponse {
  data?: Record<string, unknown> | null;
  errors?: { message: string }[];
}

function authFromBody(body: AnalyticsExportBody): ApiAuth {
  if (body.useApiKey && body.apiKey && body.apiEmail) {
    return createAuth('', body.apiKey, body.apiEmail);
  }
  return createAuth(body.sourceToken || '');
}

/**
 * POST a GraphQL query to the Cloudflare Analytics GraphQL endpoint.
 * Returns the raw { data, errors } envelope. Throws only when there is NO
 * data at all (transport failure or fully-failed query) — partial results
 * (data + errors) are returned so the caller can keep what succeeded.
 */
async function cfGraphQL(
  auth: ApiAuth,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphQLResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GRAPHQL_TIMEOUT_MS);
  try {
    const res = await fetch(`${CF_API}/graphql`, {
      method: 'POST',
      signal: controller.signal,
      headers: { ...getAuthHeaders(auth), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    await throwIfCloudflareAuthResponse(res, auth);
    let json: GraphQLResponse;
    try {
      json = (await res.json()) as GraphQLResponse;
    } catch {
      const snippet = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Non-JSON GraphQL response (HTTP ${res.status}): ${snippet}`);
    }
    if ((!json.data || Object.keys(json.data).length === 0) && json.errors?.length) {
      const message = json.errors.map(e => e.message).join('; ');
      throw new Error(message);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

/** GET a REST analytics report. Returns the CF `result` payload or throws. */
async function cfRestGet<T = unknown>(auth: ApiAuth, path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GRAPHQL_TIMEOUT_MS);
  try {
    const res = await fetch(`${CF_API}${path}`, {
      headers: { ...getAuthHeaders(auth), 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    await throwIfCloudflareAuthResponse(res, auth);
    const data = (await res.json()) as { success: boolean; result: T; errors?: { message: string }[] };
    if (!data.success) {
      const message = (data.errors || []).map(e => e.message).join('; ') || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Curated GraphQL dataset catalogue ──────────────────────────────────
//
// Each entry pairs a dataset name with a query template. `timeScalar`
// selects which filter the dataset uses: 'date' (YYYY-MM-DD, daily rollups)
// or 'datetime' (RFC3339, adaptive/raw). The query MUST select the dataset
// under viewer.zones[0].<dataset> so extraction is uniform.
interface DatasetSpec {
  dataset: string;
  timeScalar: 'date' | 'datetime';
  query: string;
}

function zoneQuery(dataset: string, scalar: 'date' | 'datetime', selection: string): string {
  const scalarType = scalar === 'date' ? 'Date' : 'Time';
  const filter = scalar === 'date'
    ? 'date_geq: $since, date_leq: $until'
    : 'datetime_geq: $since, datetime_leq: $until';
  return `query($zoneTag: String!, $since: ${scalarType}!, $until: ${scalarType}!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      ${dataset}(limit: ${DEFAULT_GROUP_LIMIT}, filter: { ${filter} }) {
        ${selection}
      }
    }
  }
}`;
}

const CURATED_DATASETS: DatasetSpec[] = [
  {
    dataset: 'httpRequests1dGroups',
    timeScalar: 'date',
    query: zoneQuery('httpRequests1dGroups', 'date', `
        dimensions { date }
        sum { requests bytes cachedRequests cachedBytes threats pageViews }
        uniq { uniques }`),
  },
  {
    dataset: 'httpRequestsAdaptiveGroups',
    timeScalar: 'datetime',
    query: zoneQuery('httpRequestsAdaptiveGroups', 'datetime', `
        count
        dimensions { clientCountryName clientRequestHTTPHost edgeResponseStatus }
        sum { edgeResponseBytes visits }`),
  },
  {
    dataset: 'firewallEventsAdaptiveGroups',
    timeScalar: 'datetime',
    query: zoneQuery('firewallEventsAdaptiveGroups', 'datetime', `
        count
        dimensions { action source clientCountryName ruleId }`),
  },
  {
    dataset: 'dnsAnalyticsAdaptiveGroups',
    timeScalar: 'datetime',
    query: zoneQuery('dnsAnalyticsAdaptiveGroups', 'datetime', `
        count
        dimensions { queryName responseCode queryType coloName }`),
  },
  {
    dataset: 'healthCheckEventsAdaptiveGroups',
    timeScalar: 'datetime',
    query: zoneQuery('healthCheckEventsAdaptiveGroups', 'datetime', `
        count
        dimensions { healthStatus region fqdn }`),
  },
  {
    dataset: 'loadBalancingRequestsAdaptiveGroups',
    timeScalar: 'datetime',
    query: zoneQuery('loadBalancingRequestsAdaptiveGroups', 'datetime', `
        count
        dimensions { lbName selectedPoolName selectedPoolHealthy }`),
  },
];

// ── REST analytics endpoints (no GraphQL twin / legacy) ─────────────────
interface RestSpec {
  endpoint: (zoneId: string, sinceIso: string, untilIso: string) => string;
  label: string;
}

const REST_REPORTS: RestSpec[] = [
  {
    label: 'dns_analytics/report/bytime',
    endpoint: (z, since, until) =>
      `/zones/${z}/dns_analytics/report/bytime?metrics=queryCount&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&time_delta=hour`,
  },
  {
    label: 'spectrum/analytics/aggregate/current',
    endpoint: (z) => `/zones/${z}/spectrum/analytics/aggregate/current`,
  },
  {
    // Deprecated zone analytics dashboard — Enterprise / older zones only.
    label: 'analytics/dashboard',
    endpoint: (z) => `/zones/${z}/analytics/dashboard?since=-10080&until=0`,
  },
];

// ── Generic dataset coverage via schema introspection ──────────────────
//
// The curated specs above hand-tune the highest-value datasets (and keep them
// graph-friendly). For the long tail, we introspect the full GraphQL schema
// once and AUTO-GENERATE a selection for every remaining `*Groups` dataset the
// `zone` type exposes — so coverage is "everything queryable", not a fixed list.
//
// Real-world constraints discovered against a live zone, all handled below:
//   - CF caps a query at 30 selected fields           → MAX_SELECTION_FIELDS budget
//   - some fields are add-on gated (fraud/WAF intel)  → GATED_FIELD_RE + drop-and-retry
//   - minutely datasets cap the time range (e.g. 15h) → parse + shrink window + retry
//   - some datasets are entirely un-entitled          → captured as a per-dataset error

export type SchemaRef = { kind: string; name: string | null; ofType?: SchemaRef | null };
export type SchemaField = { name: string; args: { name: string; type: SchemaRef }[]; type: SchemaRef };
export type SchemaTypeDef = { kind: string; name: string; fields: SchemaField[] | null; inputFields: { name: string; type: SchemaRef }[] | null };
export type SchemaMap = Map<string, SchemaTypeDef>;

const SCHEMA_INTROSPECTION = `query { __schema { types {
  kind name
  fields(includeDeprecated: true) { name args { name type { ...R } } type { ...R } }
  inputFields { name type { ...R } }
} } }
fragment R on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }`;

// Field-name patterns gated behind add-on entitlements (Bot Management / Fraud
// detection / WAF intelligence). Selecting them errors the whole query, so skip
// proactively. The runner additionally drops any other gated field surfaced at
// query time, so this is a fast-path optimisation, not the only safeguard.
const GATED_FIELD_RE = /fraud|attacksignature|leakedcredential/i;

// CF GraphQL caps a query at 30 selected fields (object wrappers included).
const MAX_SELECTION_FIELDS = 28;

async function fetchSchemaMap(auth: ApiAuth): Promise<SchemaMap> {
  const res = await cfGraphQL(auth, SCHEMA_INTROSPECTION, {});
  const types = (res.data?.__schema as { types?: SchemaTypeDef[] } | undefined)?.types || [];
  const map: SchemaMap = new Map();
  for (const t of types) map.set(t.name, t);
  return map;
}

/**
 * Parse a CF "time range wider than X" limit into hours. The limit is written
 * with mixed units, e.g. "15h", "1d", "3d", "1d1h", "90m". Returns 0 if nothing
 * parses (caller then treats the error as unrecoverable).
 */
export function parseMaxRangeHours(s: string): number {
  let hours = 0;
  for (const m of s.matchAll(/(\d+)\s*([dhm])/g)) {
    const n = Number(m[1]);
    hours += m[2] === 'd' ? n * 24 : m[2] === 'h' ? n : n / 60;
  }
  return hours;
}

/** Follow NON_NULL/LIST wrappers to the underlying named type. */
export function unwrapType(ref: SchemaRef): { kind: string; name: string | null } {
  let r: SchemaRef | null | undefined = ref;
  while (r && (r.kind === 'NON_NULL' || r.kind === 'LIST')) r = r.ofType;
  return { kind: r?.kind || 'SCALAR', name: r?.name ?? null };
}

/** Names of every `*Groups` dataset field on the `zone` type. */
export function zoneDatasetFields(map: SchemaMap): SchemaField[] {
  const zone = map.get('zone');
  return (zone?.fields || []).filter(f => /Groups$/.test(f.name));
}

/**
 * Build a GraphQL selection for a group type: scalar/enum leaves plus one or
 * two levels of object expansion (sum/avg/dimensions/…). Bounded by a field
 * budget (CF's 30-field cap, wrappers included) and a deny set (gated fields).
 */
export function buildSelection(typeName: string | null, map: SchemaMap, depth: number, deny: Set<string>, budget: { n: number }): string {
  if (!typeName || budget.n <= 0) return '';
  const t = map.get(typeName);
  if (!t || !t.fields) return '';
  const scalars: string[] = [];
  const objects: { name: string; type: string | null }[] = [];
  for (const f of t.fields) {
    if (deny.has(f.name) || GATED_FIELD_RE.test(f.name)) continue;
    if (f.args?.some(a => a.type.kind === 'NON_NULL')) continue; // needs required args
    const u = unwrapType(f.type);
    if (u.kind === 'SCALAR' || u.kind === 'ENUM') scalars.push(f.name);
    else if (u.kind === 'OBJECT') objects.push({ name: f.name, type: u.name });
  }
  const parts: string[] = [];
  for (const s of scalars) { if (budget.n <= 0) break; parts.push(s); budget.n--; }
  for (const o of objects) {
    if (budget.n <= 1 || depth <= 0) break;
    budget.n--; // the wrapper itself counts toward CF's field cap
    const sub = buildSelection(o.type, map, depth - 1, deny, budget);
    if (sub) parts.push(`${o.name} { ${sub} }`); else budget.n++;
  }
  return parts.join(' ');
}

/**
 * Run one auto-generated dataset query with adaptive retry on recoverable
 * errors. Returns a best-effort result (rows XOR error) — never throws.
 */
async function runGenericDataset(
  auth: ApiAuth, field: SchemaField, map: SchemaMap, zoneTag: string, untilMs: number, initialWindowH: number,
): Promise<AnalyticsDatasetResult> {
  const dataset = field.name;
  const elem = unwrapType(field.type).name;
  const filterArg = field.args.find(a => a.name === 'filter');
  const filterType = filterArg ? map.get(unwrapType(filterArg.type).name || '') : undefined;
  const inputNames = new Set((filterType?.inputFields || []).map(i => i.name));
  const hasLimit = field.args.some(a => a.name === 'limit');
  const prefix: 'datetime' | 'date' | null =
    inputNames.has('datetime_geq') && inputNames.has('datetime_leq') ? 'datetime'
    : inputNames.has('date_geq') && inputNames.has('date_leq') ? 'date' : null;
  const scalarType = prefix
    ? (unwrapType(filterType!.inputFields!.find(i => i.name === `${prefix}_geq`)!.type).name || 'Time')
    : null;

  const deny = new Set<string>();
  let cap = MAX_SELECTION_FIELDS;
  let windowH = Math.max(1, initialWindowH);
  let lastError = 'no selection could be built for this dataset';

  for (let attempt = 0; attempt < 24; attempt++) {
    const selection = buildSelection(elem, map, 2, deny, { n: cap });
    if (!selection) return { dataset, scope: 'zone', rowCount: 0, error: lastError };

    const until = new Date(untilMs).toISOString();
    const since = new Date(untilMs - windowH * 3600 * 1000).toISOString();
    const args: string[] = [];
    if (hasLimit) args.push(`limit: ${DEFAULT_GROUP_LIMIT}`);
    let query: string; let variables: Record<string, unknown>;
    if (prefix) {
      args.push(`filter: { ${prefix}_geq: $since, ${prefix}_leq: $until }`);
      query = `query($zoneTag: String!, $since: ${scalarType}!, $until: ${scalarType}!) { viewer { zones(filter: { zoneTag: $zoneTag }) { ${dataset}(${args.join(', ')}) { ${selection} } } } }`;
      variables = { zoneTag, since: prefix === 'date' ? since.slice(0, 10) : since, until: prefix === 'date' ? until.slice(0, 10) : until };
    } else {
      query = `query($zoneTag: String!) { viewer { zones(filter: { zoneTag: $zoneTag }) { ${dataset}(${args.join(', ')}) { ${selection} } } } }`;
      variables = { zoneTag };
    }

    try {
      const res = await cfGraphQL(auth, query, variables);
      const zones = (res.data?.viewer as { zones?: Record<string, unknown>[] } | undefined)?.zones;
      const rows = zones && zones[0] ? zones[0][dataset] : [];
      const result: AnalyticsDatasetResult = { dataset, scope: 'zone', rowCount: countRows(rows), rows };
      if (res.errors?.length) result.warning = res.errors.map(e => e.message).join('; ');
      return result;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      const msg = (e as Error).message;
      lastError = msg;
      const fieldM = msg.match(/access to the field '([^']+)'/);
      const timeM = msg.match(/wider than ([^,]+)/);
      if (fieldM) { deny.add(fieldM[1]); continue; }                                  // drop gated field, retry
      if (timeM) {                                                                    // shrink to the dataset's max window
        const maxH = parseMaxRangeHours(timeM[1]);
        if (maxH > 0) { windowH = Math.max(1, Math.floor(maxH * 0.9)); continue; }
      }
      if (/more than 30/.test(msg)) { cap = Math.max(6, cap - 6); continue; }          // trim selection
      return { dataset, scope: 'zone', rowCount: 0, error: msg };                      // unrecoverable (e.g. not entitled)
    }
  }
  return { dataset, scope: 'zone', rowCount: 0, error: lastError };
}

function clampLookback(days: number | undefined): number {
  if (!days || !Number.isFinite(days)) return 7;
  return Math.max(1, Math.min(365, Math.floor(days)));
}

/** Count groups in a dataset payload (array → length; else 0). */
function countRows(payload: unknown): number {
  return Array.isArray(payload) ? payload.length : 0;
}

/**
 * Export all queryable analytics for the source zone. Best-effort: every
 * dataset and REST report is independently fault-tolerant.
 */
export async function exportZoneAnalytics(
  body: AnalyticsExportBody,
  log: LogFn = () => {},
): Promise<AnalyticsExport> {
  const auth = authFromBody(body);
  const zoneTag = body.sourceZoneId;
  const lookbackDays = clampLookback(body.lookbackDays);

  const until = new Date();
  const since = new Date(until.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const untilIso = until.toISOString();
  const sinceIso = since.toISOString();
  const untilDate = untilIso.slice(0, 10);
  const sinceDate = sinceIso.slice(0, 10);

  log(`Capturing source-zone analytics over the last ${lookbackDays} day(s)…`);

  // 1. Introspect the full schema once — gives the authoritative dataset list
  //    AND the type graph used to auto-generate long-tail selections.
  let schemaMap: SchemaMap | null = null;
  let availableZoneDatasets: string[] = [];
  try {
    schemaMap = await fetchSchemaMap(auth);
    availableZoneDatasets = zoneDatasetFields(schemaMap).map(f => f.name).sort();
    log(`GraphQL schema exposes ${availableZoneDatasets.length} zone analytics dataset(s).`);
  } catch (e) {
    if (e instanceof AuthError) throw e;
    log(`Schema introspection failed (falling back to curated set only): ${(e as Error).message}`);
  }

  const curatedByName = new Map(CURATED_DATASETS.map(s => [s.dataset, s]));

  // Run a curated (hand-tuned) dataset spec → result.
  const runCurated = async (spec: DatasetSpec): Promise<AnalyticsDatasetResult> => {
    const variables = spec.timeScalar === 'date'
      ? { zoneTag, since: sinceDate, until: untilDate }
      : { zoneTag, since: sinceIso, until: untilIso };
    try {
      const res = await cfGraphQL(auth, spec.query, variables);
      const zones = (res.data?.viewer as { zones?: Record<string, unknown>[] } | undefined)?.zones;
      const rows = zones && zones[0] ? zones[0][spec.dataset] : [];
      const result: AnalyticsDatasetResult = { dataset: spec.dataset, scope: 'zone', rowCount: countRows(rows), rows };
      if (res.errors?.length) result.warning = res.errors.map(e => e.message).join('; ');
      return result;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      return { dataset: spec.dataset, scope: 'zone', rowCount: 0, error: (e as Error).message };
    }
  };

  // 2. Pull EVERY available dataset: curated spec when we have one, otherwise an
  //    auto-generated selection. Sequential to stay gentle on rate limits.
  // Per-dataset selection (Step 2). When provided, only the named datasets are
  // pulled; the rest land in manifest.skippedDatasets (user deselected them).
  const requested = (body.datasets && body.datasets.length > 0) ? new Set(body.datasets) : null;

  const graphql: AnalyticsDatasetResult[] = [];
  const attempted = new Set<string>();
  if (schemaMap && availableZoneDatasets.length > 0) {
    const fieldsByName = new Map(zoneDatasetFields(schemaMap).map(f => [f.name, f]));
    for (const name of availableZoneDatasets) {
      if (requested && !requested.has(name)) continue; // user deselected this dataset
      attempted.add(name);
      log(`Querying ${name}…`);
      const curated = curatedByName.get(name);
      const result = curated
        ? await runCurated(curated)
        : await runGenericDataset(auth, fieldsByName.get(name)!, schemaMap, zoneTag, until.getTime(), lookbackDays * 24);
      graphql.push(result);
      log(`  ${name}: ${result.error ? 'skipped — ' + result.error : result.rowCount + ' group(s)' + (result.warning ? ' (with warnings)' : '')}.`);
    }
  } else {
    // Introspection unavailable → fall back to the curated set only.
    for (const spec of CURATED_DATASETS) {
      attempted.add(spec.dataset);
      log(`Querying ${spec.dataset}…`);
      const result = await runCurated(spec);
      graphql.push(result);
      log(`  ${spec.dataset}: ${result.error ? 'skipped — ' + result.error : result.rowCount + ' group(s)'}.`);
    }
  }

  // 3. REST analytics reports (best-effort).
  const rest: AnalyticsRestResult[] = [];
  for (const spec of REST_REPORTS) {
    const path = spec.endpoint(zoneTag, sinceIso, untilIso);
    try {
      log(`Fetching REST report ${spec.label}…`);
      const data = await cfRestGet(auth, path);
      rest.push({ endpoint: spec.label, ok: true, data });
    } catch (e) {
      if (e instanceof AuthError) throw e;
      rest.push({ endpoint: spec.label, ok: false, error: (e as Error).message });
      log(`  ${spec.label}: skipped — ${(e as Error).message}`);
    }
  }

  // 4. Coverage manifest. We now attempt every available dataset, so skipped
  //    should be empty — but keep it computed for transparency if any dataset
  //    was unexpectedly not attempted (e.g. schema/curated mismatch).
  const pulledDatasets = Array.from(attempted).sort();
  const skippedDatasets = availableZoneDatasets.filter(d => !attempted.has(d));

  const pulledOk = graphql.filter(g => !g.error).length;
  log(`Analytics capture complete: ${pulledOk}/${graphql.length} GraphQL dataset(s), ${rest.filter(r => r.ok).length}/${rest.length} REST report(s).`);

  return {
    meta: {
      zoneId: zoneTag,
      zoneName: body.zoneName,
      accountId: body.sourceAccountId,
      generatedAt: new Date().toISOString(),
      window: { since: sinceIso, until: untilIso, lookbackDays },
      toolVersion: ANALYTICS_TOOL_VERSION,
      note: 'Read-only analytics snapshot of the SOURCE zone. Analytics history cannot be migrated between accounts (data_ephemeral) — archive this before decommissioning the source.',
    },
    manifest: {
      availableZoneDatasets,
      pulledDatasets,
      skippedDatasets,
    },
    graphql,
    rest,
  };
}

// ── Per-dataset access probe (Step 2 "Archive source analytics") ────────
//
// Lightweight pre-flight: introspect the zone's analytics schema, then probe
// EACH dataset with a minimal 1-hour query to determine whether the source
// credentials/plan can actually read it. The Step 2 section uses this to list
// only datasets the user can download (hiding entitlement-gated ones), and to
// seed the per-dataset selection. This does NOT pull a usable snapshot — it
// discards rows and only records accessible/not. Best-effort and fault-
// tolerant: a schema-introspection failure returns an empty list rather than
// throwing, so the UI can fall back to "capture all" gracefully.
// (AnalyticsDatasetAvailability / AnalyticsProbeResult live in src/types.ts.)

// Short window for the probe — just enough to confirm the query is allowed.
const PROBE_WINDOW_HOURS = 1;

export async function probeZoneAnalytics(
  body: AnalyticsExportBody,
  log: LogFn = () => {},
): Promise<AnalyticsProbeResult> {
  const auth = authFromBody(body);
  const zoneTag = body.sourceZoneId;
  const meta = { zoneId: zoneTag, accountId: body.sourceAccountId, generatedAt: new Date().toISOString() };

  log('Detecting available analytics datasets…');
  let schemaMap: SchemaMap;
  let fields: SchemaField[];
  try {
    schemaMap = await fetchSchemaMap(auth);
    fields = zoneDatasetFields(schemaMap).sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    if (e instanceof AuthError) throw e;
    log(`Schema introspection failed: ${(e as Error).message}`);
    return { meta, datasets: [] };
  }
  log(`Schema exposes ${fields.length} zone dataset(s); probing access…`);

  const datasets: AnalyticsDatasetAvailability[] = [];
  const now = Date.now();
  for (const field of fields) {
    log(`Probing ${field.name}…`);
    // runGenericDataset returns rows XOR a per-item error; an entitlement/plan
    // error means the dataset isn't accessible. A 1h window keeps it cheap.
    const result = await runGenericDataset(auth, field, schemaMap, zoneTag, now, PROBE_WINDOW_HOURS);
    const accessible = !result.error;
    datasets.push({ name: field.name, accessible, ...(result.error ? { error: result.error } : {}) });
    log(`  ${field.name}: ${accessible ? 'available' : 'not available'}`);
  }

  const ok = datasets.filter(d => d.accessible).length;
  log(`Probe complete: ${ok}/${datasets.length} dataset(s) available.`);
  return { meta, datasets };
}
