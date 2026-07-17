#!/usr/bin/env node
/**
 * Zero-input triage for new Cloudflare write endpoints.
 *
 *   node scripts/triage-new-endpoints.mjs            # refresh + report + scaffold
 *   node scripts/triage-new-endpoints.mjs --no-refresh
 *   node scripts/triage-new-endpoints.mjs --no-scaffold
 *   node scripts/triage-new-endpoints.mjs --json
 *
 * What it does (all deterministic, no judgment):
 *   1. Refresh: regenerate the OpenAPI manifest (downloads the live spec) and
 *      the coverage inputs (sdk-index + tz-coverage) so "what code implements"
 *      is current. Skip with --no-refresh.
 *   2. Compare spec → committed baseline: list ADDED / REMOVED write endpoints
 *      (vs HEAD's src/openapi-writes.generated.json).
 *   3. Compare spec → code: list every in-scope GAP (in-scope feature, not
 *      implemented, no override) — these are the endpoints that need work.
 *   4. For each in-scope gap: classify kind (singleton/list/unknown), dump the
 *      writable request contract from the spec, and (default) print the
 *      ready-to-apply 5-layer scaffold.
 *
 * Exit code: 0 if there are no in-scope gaps, 1 if any remain (so it doubles as
 * a precheck and can gate CI alongside coverage:check).
 *
 * The ONLY non-scriptable step is the Principle-7 in-scope decision; this tool
 * surfaces every candidate and its contract so that decision is one keystroke.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, classifyKind, writableContract, renderSingletonScaffold } from './lib/endpoint-scaffold.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const noRefresh = args.includes('--no-refresh');
const noScaffold = args.includes('--no-scaffold');
const wantJson = args.includes('--json');

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
}
function log(...a) { if (!wantJson) console.log(...a); }

// ── 1. Refresh ───────────────────────────────────────────────────────
if (!noRefresh) {
  log('▶ Refreshing manifest + coverage inputs (live spec download)…');
  run('npm run --silent generate:openapi-manifest');
  run('npm run --silent generate:sdk-index');
  run('npm run --silent generate:tz-coverage');
}

// ── 2. Spec → committed baseline diff ────────────────────────────────
const keyset = (j) => new Set(
  j.operations.filter((x) => x.method !== 'DELETE')
    .map((x) => `${x.method} ${x.path.replace(/\{[^}]+\}/g, '{}')}`),
);
const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/openapi-writes.generated.json'), 'utf8'));
let added = [], removed = [];
try {
  const oldRaw = execSync('git show HEAD:src/openapi-writes.generated.json', { cwd: ROOT }).toString();
  const ko = keyset(JSON.parse(oldRaw));
  const kn = keyset(current);
  added = [...kn].filter((k) => !ko.has(k)).sort();
  removed = [...ko].filter((k) => !kn.has(k)).sort();
} catch {
  log('⚠ Could not read HEAD baseline (new file?). Skipping add/remove diff.');
}

// ── 3. Spec → code: in-scope gaps ────────────────────────────────────
const report = JSON.parse(run('node scripts/coverage-report.mjs --json'));
const gaps = report.endpoints.filter((e) => e.status === 'gap' && e.in_scope);

// ── 4. Per-gap classification + contract + scaffold ──────────────────
let spec = null;
const triaged = gaps.map((g) => {
  let kind = 'unknown', contract = null;
  try {
    spec ||= loadSpec();
    kind = classifyKind(spec, g.path, g.method);
    contract = writableContract(spec, g.path, g.method);
  } catch { /* spec not on disk; leave nulls */ }
  return { method: g.method, path: g.path, feature: g.feature_id, in_sdk: g.in_sdk, kind, contract };
});

if (wantJson) {
  process.stdout.write(JSON.stringify({
    summary: report.summary,
    added, removed,
    in_scope_gaps: triaged,
  }, null, 2) + '\n');
  process.exit(gaps.length ? 1 : 0);
}

// ── Human report ─────────────────────────────────────────────────────
log('');
log('═══ New-Endpoint Triage ═══════════════════════════════════════════════');
log(`spec ${current.api_version || '?'} (generated ${current.generated_at?.slice(0, 10)})`);
log('');
log(`ADDED write endpoints vs HEAD (${added.length}):`);
added.forEach((k) => log(`  + ${k}`));
if (removed.length) { log(`REMOVED (${removed.length}):`); removed.forEach((k) => log(`  - ${k}`)); }
log('');
log(`In-scope GAPS needing action (${gaps.length}):`);
if (!gaps.length) {
  log('  ✓ none — every in-scope write endpoint is implemented or formally excluded.');
} else {
  for (const t of triaged) {
    log(`  ❌ ${t.method} ${t.path}`);
    log(`       feature=${t.feature}  in_sdk=${t.in_sdk}  kind=${t.kind}`);
    if (t.contract?.properties?.length) {
      const ap = t.contract.additionalPropertiesFalse ? ' (additionalProperties:false)' : '';
      log(`       writable${ap}: ${t.contract.properties.map((p) => p.name + (p.required ? '*' : '')).join(', ')}`);
    } else if (t.contract && !t.contract.hasBody) {
      log('       writable: (no JSON body / opaque)');
    }
  }
  log('');
  log('Decide each (Principle 7 — "would the user notice it missing on the dest?"):');
  log('  • in-scope + movable  → implement (scaffold below; run scaffold-endpoint.mjs to re-emit)');
  log('  • out of scope        → scripts/feature-taxonomy.json (in_scope:false) or coverage-overrides.json');
  log('  • impossible          → IMPOSSIBLE_TO_MIGRATE in src/types.ts');
  log('  • difficult/ambiguous → STOP and ask the user');

  if (!noScaffold && spec) {
    for (const t of triaged) {
      if (t.kind === 'singleton') log(renderSingletonScaffold(spec, t.path, t.method));
      else log(`\n(no auto-scaffold for ${t.method} ${t.path} — kind=${t.kind}; see existing list-migration patterns / ask)`);
    }
  }
}
log('');
log(`Next: implement/log each gap, then \`node scripts/verify-coverage-gates.mjs\` must pass.`);
process.exit(gaps.length ? 1 : 0);
