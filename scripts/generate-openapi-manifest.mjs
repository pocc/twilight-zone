/**
 * Generate two artifacts from Cloudflare's OpenAPI spec. By default this
 * refreshes /tmp/api-schemas/openapi.json from the live api-schemas repo before
 * generating, so the committed baseline cannot silently lag behind the drift
 * monitor. Set CF_OPENAPI_PATH for a pinned local spec, or CF_OPENAPI_REFRESH=0
 * to reuse the default local cache intentionally.
 *
 * Outputs:
 *
 *   1. src/openapi-manifest.generated.ts          (committed, bundled into Worker)
 *      Contains GET operations only — used at runtime by openapi-export.ts.
 *
 *   2. coverage/openapi-writes.generated.json     (gitignored, build-time only)
 *      Contains POST/PATCH/PUT/DELETE operations — used by
 *      scripts/coverage-report.mjs to evaluate migration coverage at endpoint
 *      granularity.
 *
 * Keeping the write-ops out of the runtime manifest avoids bloating the Worker
 * bundle with ~1600 endpoints that the Worker itself never calls.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_OPENAPI_PATH = '/tmp/api-schemas/openapi.json';
const RAW_SPEC_URL = 'https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json';
const OPENAPI_PATH = process.env.CF_OPENAPI_PATH || DEFAULT_OPENAPI_PATH;
const OUT_GET_PATH = process.env.OUT_PATH || path.resolve('src/openapi-manifest.generated.ts');
// Writes manifest lives under src/ so it's checked in (same as the GET-only
// manifest). CI doesn't need the OpenAPI spec on disk; it just regenerates
// the SDK + TZ-coverage indices and runs the coverage check against the
// checked-in writes manifest.
const OUT_WRITES_PATH = process.env.OUT_WRITES_PATH || path.resolve('src/openapi-writes.generated.json');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function refreshDefaultOpenApiSpec() {
  if (process.env.CF_OPENAPI_PATH) return;
  if (process.env.CF_OPENAPI_REFRESH === '0') return;

  fs.mkdirSync(path.dirname(DEFAULT_OPENAPI_PATH), { recursive: true });
  const res = await fetch(RAW_SPEC_URL, { headers: { 'User-Agent': 'twilight-zone-openapi-generator' } });
  if (!res.ok) {
    fail(`OpenAPI download failed: HTTP ${res.status} from ${RAW_SPEC_URL}`);
  }
  fs.writeFileSync(DEFAULT_OPENAPI_PATH, await res.text(), 'utf8');
  console.log(`✓ Downloaded latest OpenAPI spec from ${RAW_SPEC_URL} to ${DEFAULT_OPENAPI_PATH}`);
}

await refreshDefaultOpenApiSpec();

if (!fs.existsSync(OPENAPI_PATH)) {
  fail(`OpenAPI file not found: ${OPENAPI_PATH}`);
}

const raw = fs.readFileSync(OPENAPI_PATH, 'utf8');
const spec = JSON.parse(raw);
const paths = spec.paths || {};

/**
 * Collect parameters from both the path-level and operation-level definitions.
 */
function collectParameters(pathLevelParams, opLevelParams) {
  const parameters = [];
  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const param of arr) {
      if (!param || typeof param !== 'object') continue;
      const name = param.name;
      const loc = param.in;
      if (typeof name !== 'string' || typeof loc !== 'string') continue;
      parameters.push({ name, in: loc, required: Boolean(param.required) });
    }
  };
  collect(pathLevelParams);
  collect(opLevelParams);
  return parameters;
}

const getOps = [];
const writeOps = [];

const writeMethods = new Set(['post', 'put', 'patch', 'delete']);

for (const [p, methods] of Object.entries(paths)) {
  if (!methods || typeof methods !== 'object') continue;
  for (const [method, op] of Object.entries(methods)) {
    const lower = String(method).toLowerCase();
    if (lower !== 'get' && !writeMethods.has(lower)) continue;
    if (!op || typeof op !== 'object') continue;

    const parameters = collectParameters(methods.parameters, op.parameters);
    const pathParams = [...new Set(parameters.filter(x => x.in === 'path').map(x => x.name))];
    const queryParams = [...new Set(parameters.filter(x => x.in === 'query').map(x => x.name))];

    const entry = {
      method: lower.toUpperCase(),
      path: p,
      operationId: typeof op.operationId === 'string' ? op.operationId : undefined,
      tags: Array.isArray(op.tags) ? op.tags.filter(t => typeof t === 'string') : undefined,
      pathParams,
      queryParams,
    };

    if (lower === 'get') {
      // Mirror previous shape exactly for backwards compatibility.
      getOps.push({
        method: 'GET',
        path: entry.path,
        operationId: entry.operationId,
        tags: entry.tags,
        pathParams: entry.pathParams,
        queryParams: entry.queryParams,
      });
    } else {
      // Write ops capture the same fields plus the (literal) HTTP method, plus
      // a deprecated flag from the OpenAPI op definition. Schema bodies are
      // intentionally omitted — coverage analysis only needs the surface.
      writeOps.push({
        ...entry,
        deprecated: Boolean(op.deprecated),
      });
    }
  }
}

getOps.sort((a, b) => a.path.localeCompare(b.path));
writeOps.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));

// ── Write the runtime (GET-only) manifest, TypeScript module ─────────
const tsOut = `// GENERATED FILE. DO NOT EDIT BY HAND.
// Source: ${OPENAPI_PATH}
// Generated: ${new Date().toISOString()}

export type OpenApiGetOperation = {
  method: 'GET';
  path: string;
  operationId?: string;
  tags?: string[];
  pathParams: string[];
  queryParams: string[];
};

export const OPENAPI_GET_OPERATIONS: OpenApiGetOperation[] = ${JSON.stringify(getOps, null, 2)};
`;

fs.mkdirSync(path.dirname(OUT_GET_PATH), { recursive: true });
fs.writeFileSync(OUT_GET_PATH, tsOut, 'utf8');

// ── Write the build-time (writes) manifest, JSON (gitignored) ────────
const writeCounts = {};
for (const op of writeOps) writeCounts[op.method] = (writeCounts[op.method] || 0) + 1;

const writesOut = {
  source: OPENAPI_PATH,
  generated_at: new Date().toISOString(),
  openapi_version: spec.openapi,
  api_version: spec.info && spec.info.version,
  counts: writeCounts,
  total: writeOps.length,
  operations: writeOps,
};

fs.mkdirSync(path.dirname(OUT_WRITES_PATH), { recursive: true });
fs.writeFileSync(OUT_WRITES_PATH, JSON.stringify(writesOut, null, 2), 'utf8');

// ── Write the compact baseline for the daily spec-drift monitor ──────
// src/worker/spec-monitor.ts imports this and diffs the LIVE spec's write-key
// set against it on a daily cron. New keys raise the in-app banner + ping the
// gchat webhook. Kept compact (just "METHOD path" strings) so it adds ~80 KB to
// the Worker bundle instead of the full ~1 MB writes manifest. Derived from the
// SAME writeOps as the writes manifest, so the two never drift.
const OUT_BASELINE_PATH = process.env.OUT_BASELINE_PATH || path.resolve('src/openapi-baseline.generated.json');
const baselineKeys = [...new Set(writeOps.map(o => `${o.method} ${o.path}`))].sort();
const baselineOut = {
  _comment: 'GENERATED. Compact baseline for the daily spec-drift monitor (src/worker/spec-monitor.ts). Regenerated alongside openapi-writes.generated.json — do not hand-edit.',
  generatedAt: writesOut.generated_at,
  apiVersion: writesOut.api_version || null,
  writeKeyCount: baselineKeys.length,
  writeKeys: baselineKeys,
};
fs.writeFileSync(OUT_BASELINE_PATH, JSON.stringify(baselineOut, null, 2) + '\n', 'utf8');

console.log(`✓ Wrote ${getOps.length} GET operations to ${OUT_GET_PATH}`);
console.log(`✓ Wrote ${baselineKeys.length} baseline write-keys to ${OUT_BASELINE_PATH}`);
console.log(`✓ Wrote ${writeOps.length} write operations to ${OUT_WRITES_PATH}`);
for (const [m, c] of Object.entries(writeCounts).sort()) {
  console.log(`    ${m.padEnd(7)} ${c}`);
}
