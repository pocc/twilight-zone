#!/usr/bin/env node
/**
 * Run the five gates that mark "new endpoint(s) fully integrated", in order,
 * stopping at the first failure.
 *
 *   node scripts/verify-coverage-gates.mjs
 *
 * Gates:
 *   1. generate:openapi-manifest  pull live spec → baseline + writes manifest
 *   2. typecheck                  tsc --noEmit
 *   3. test                       full unit suite
 *   4. coverage:check             ratchet gate (0 in-scope gaps)
 *   5. coverage:write             refresh docs/COVERAGE.md (committed)
 *
 * Exit 0 only if all five pass.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATES = [
  ['generate:openapi-manifest', 'npm run generate:openapi-manifest'],
  ['typecheck', 'npm run typecheck'],
  ['test', 'npm test'],
  ['coverage:check', 'npm run coverage:check'],
  ['coverage:write', 'npm run coverage:write'],
];

const skip = process.argv.slice(2).includes('--no-refresh') ? 'generate:openapi-manifest' : null;
const results = [];
for (const [name, cmd] of GATES) {
  if (name === skip) { results.push([name, 'skipped']); continue; }
  console.log(`\n──▶ Gate: ${name}  (${cmd})`);
  const r = spawnSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    results.push([name, 'FAILED']);
    console.error(`\n✗ Gate "${name}" failed (exit ${r.status}). Stopping.`);
    summarize(results);
    process.exit(1);
  }
  results.push([name, 'passed']);
}
summarize(results);
console.log('\n✓ All gates passed — new endpoint(s) are fully integrated and coverage is green.');

function summarize(rows) {
  console.log('\n── Gate summary ─────────────────────');
  for (const [name, status] of rows) {
    const mark = status === 'passed' ? '✓' : status === 'skipped' ? '–' : '✗';
    console.log(`  ${mark} ${name.padEnd(26)} ${status}`);
  }
}
