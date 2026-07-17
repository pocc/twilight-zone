#!/usr/bin/env node
/**
 * Extract the set of HTTP endpoints that Twilight Zone calls.
 *
 * Strategy:
 *   1. Parse src/api.ts to find every `cfFetch[All](auth, `<template>`, {
 *      method: 'X', ... })` call. Default method is GET if not specified.
 *      Each call is attributed to the enclosing function (so we can later
 *      check whether *that* function is reached from the migration code).
 *
 *   2. Parse src/migrate/*.ts and src/migrate.ts for `api.<fnName>(` calls.
 *      Any api function called from migrate code is considered "reachable
 *      from migration".
 *
 *   3. For each cfFetch call, record:
 *        - method, path_template, path_shape (positional placeholder form)
 *        - enclosing function name
 *        - reachable_from_migrate (boolean)
 *
 * Output: coverage/tz-coverage.generated.json (gitignored)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const API_TS = path.join(ROOT, 'src', 'api.ts');
const MIGRATE_TS = path.join(ROOT, 'src', 'migrate.ts');
const MIGRATE_DIR = path.join(ROOT, 'src', 'migrate');
const OUT_DIR = path.join(ROOT, 'coverage');
const OUT_PATH = path.join(OUT_DIR, 'tz-coverage.generated.json');

const apiSrc = fs.readFileSync(API_TS, 'utf8');

/**
 * Slice src/api.ts into top-level function blocks.
 * Pattern: `export async function fnName(` or `async function fnName(`.
 * Each block ends at the next function-level boundary or end-of-file.
 */
function extractFunctionBlocks(src) {
  const blocks = [];
  const fnRe = /^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[<(]/gm;
  const headers = [...src.matchAll(fnRe)];
  for (let i = 0; i < headers.length; i++) {
    const name = headers[i][1];
    const start = headers[i].index;
    const end = i + 1 < headers.length ? headers[i + 1].index : src.length;
    blocks.push({ name, body: src.slice(start, end), start });
  }
  return blocks;
}

const fnBlocks = extractFunctionBlocks(apiSrc);

/**
 * Find every cfFetch call. The shape we accept is:
 *   cfFetch[All]<...>?\(<auth-or-token>, `<template>`(, <options-obj>)?\)
 *
 * The template can span multiple lines if it has nested `${}`. We match the
 * simplest common case (single-line template literal) and handle multi-line
 * by looking for the closing backtick within a reasonable window.
 */
function extractCfFetchCalls(body, enclosingFn) {
  const calls = [];
  // Anchor at `cfFetch` or `cfFetchAll`. Skip the optional `<Type>` generic.
  // Capture from the opening `(` until the closing `)` of the args list,
  // matching nested braces carefully. A simpler heuristic: capture from
  // backtick template to next `)` that follows on the same call line.
  const re = /\bcfFetch(?:All)?\s*(?:<[^>]+>)?\s*\(\s*[^,]+,\s*`([^`]+)`(?:\s*,\s*\{([^}]*)\})?/gms;
  let m;
  while ((m = re.exec(body)) !== null) {
    const rawTemplate = m[1];
    const optionsBlock = m[2] || '';
    // Method extraction: look for `method: 'X'` in the options block.
    const methodMatch = /\bmethod\s*:\s*['"]([A-Z]+)['"]/.exec(optionsBlock);
    const method = methodMatch ? methodMatch[1] : 'GET';

    // Normalize template literal to OpenAPI-style path. `${zoneId}` →
    // `{zoneId}`. Strip query strings (anything after `?`).
    const pathOnly = rawTemplate.split('?')[0];
    const pathTemplate = pathOnly.replace(/\$\{([^}]+)\}/g, (_, expr) => {
      // Use the bare identifier if it's a simple variable; otherwise
      // collapse to a generic `{param}`.
      const simple = expr.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
      return simple ? `{${simple[1]}}` : '{param}';
    });
    const pathShape = pathTemplate.replace(/\{[^}]+\}/g, '{}');

    calls.push({
      enclosing_fn: enclosingFn,
      method,
      path_template: pathTemplate,
      path_shape: pathShape,
    });
  }
  return calls;
}

const allCalls = [];
for (const fn of fnBlocks) {
  for (const c of extractCfFetchCalls(fn.body, fn.name)) {
    allCalls.push(c);
  }
}

// ── Find which api.ts functions are called from migrate code ─────────
function collectFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectFiles(full));
    else if (ent.isFile() && ent.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const migrateFiles = [MIGRATE_TS, ...collectFiles(MIGRATE_DIR)];
const allMigrateSrc = migrateFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

// Match identifiers imported from api.ts and called as functions.
// Conservative: any `<word>(` token whose `<word>` is the name of a function
// exported from api.ts.
const apiExports = new Set();
for (const fn of fnBlocks) {
  if (apiSrc.includes(`export async function ${fn.name}(`) ||
      apiSrc.includes(`export function ${fn.name}(`)) {
    apiExports.add(fn.name);
  }
}

const calledFromMigrate = new Set();
for (const name of apiExports) {
  // Word-boundary token followed by `(` — captures all call sites regardless
  // of import alias quirks (we expect direct re-imports).
  const re = new RegExp(`\\b${name}\\s*\\(`);
  if (re.test(allMigrateSrc)) calledFromMigrate.add(name);
}

// Mark every cfFetch call with whether its enclosing fn is reached from migrate.
for (const c of allCalls) {
  c.reachable_from_migrate = calledFromMigrate.has(c.enclosing_fn);
}

// ── Build a method+shape index of endpoints TZ implements ────────────
const endpointsImplemented = new Map();  // "POST /zones/{}/dns_records" → [calls]
for (const c of allCalls) {
  const key = `${c.method} ${c.path_shape}`;
  if (!endpointsImplemented.has(key)) endpointsImplemented.set(key, []);
  endpointsImplemented.get(key).push(c);
}

const endpointsReachableFromMigrate = new Map();
for (const c of allCalls) {
  if (!c.reachable_from_migrate) continue;
  const key = `${c.method} ${c.path_shape}`;
  if (!endpointsReachableFromMigrate.has(key)) endpointsReachableFromMigrate.set(key, []);
  endpointsReachableFromMigrate.get(key).push(c);
}

// ── Summary ──────────────────────────────────────────────────────────
const methodCounts = {};
const reachableMethodCounts = {};
for (const c of allCalls) {
  methodCounts[c.method] = (methodCounts[c.method] || 0) + 1;
  if (c.reachable_from_migrate) {
    reachableMethodCounts[c.method] = (reachableMethodCounts[c.method] || 0) + 1;
  }
}

const output = {
  generated_at: new Date().toISOString(),
  api_ts: 'src/api.ts',
  migrate_root: 'src/migrate.ts + src/migrate/',
  total_cf_fetch_calls: allCalls.length,
  calls_by_method: methodCounts,
  reachable_from_migrate_calls_by_method: reachableMethodCounts,
  api_exports_count: apiExports.size,
  api_exports_called_from_migrate: [...calledFromMigrate].sort(),
  endpoints_implemented_keys: [...endpointsImplemented.keys()].sort(),
  endpoints_reachable_from_migrate_keys: [...endpointsReachableFromMigrate.keys()].sort(),
  all_calls: allCalls,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));

console.log(`✓ Scanned ${fnBlocks.length} functions in src/api.ts`);
console.log(`✓ Found ${allCalls.length} cfFetch[All] calls`);
console.log(`✓ ${apiExports.size} exported api functions; ${calledFromMigrate.size} reached from migrate code`);
console.log(`✓ ${endpointsImplemented.size} unique (method, path_shape) endpoints implemented`);
console.log(`✓ ${endpointsReachableFromMigrate.size} unique endpoints reachable from migrate code`);
console.log(`  By method (all):`);
for (const [m, c] of Object.entries(methodCounts).sort()) {
  console.log(`    ${m.padEnd(7)} ${c}`);
}
console.log(`  By method (reachable from migrate):`);
for (const [m, c] of Object.entries(reachableMethodCounts).sort()) {
  console.log(`    ${m.padEnd(7)} ${c}`);
}
console.log(`✓ Wrote ${OUT_PATH}`);
