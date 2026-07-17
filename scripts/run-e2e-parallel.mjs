#!/usr/bin/env node
// Parallel E2E orchestrator (L2/L3/L5) — OPT-IN, process-level.
//
// WHY THIS IS A SEPARATE SCRIPT (not a flag inside the harness):
// run-playwright-migrations.mjs has heavy global mutable state (a shared
// pathVars object, CF_ZONE_ID, one rate limiter). Making it run N zones
// concurrently in-process would be a deep, race-prone refactor. Instead we keep
// the existing harness 100% unchanged for a single run and parallelize at the
// PROCESS level: each slot is its own child process with its own globals, its
// own slot zone (distinct SOURCE_DOMAIN/DEST_DOMAIN), and its own slice of the
// API rate budget (E2E_RATE_LIMIT). The default `npm run` path is untouched.
//
// SAFETY MODEL (no harness cleanup surgery required):
//   Account-scoped resources (KV/R2/D1/Queues/Workers/Access/…) live in ONE
//   shared target account, and the harness's account cleanup sweep is
//   account-global. So we DO NOT overlap account-scoped tests with anything:
//     Phase A — account-scoped tests run SEQUENTIALLY (one child, full budget).
//     Phase B — zone-scoped tests run IN PARALLEL across slots (each on its own
//               slot zone, budget split N ways). Zone-scoped tests create no
//               account resources, so their account sweeps only redundantly
//               delete leftovers — safe to run concurrently.
//   Finer-grained overlap (account tests parallel too) needs per-slot account-
//   resource name isolation; that's future work.
//
// ⚠️  UNVALIDATED LIVE. The pure partition/budget logic is unit-tested
// (test/e2eParallelPlan.test.ts), but the live process orchestration + per-slot
// zone provisioning have NOT been run against real accounts from here. Validate
// with a small run before relying on it. First run may hit Cloudflare's
// account zone-add limit while creating slot zones — see PROVISIONING below.
//
// USAGE:
//   node scripts/run-e2e-parallel.mjs --concurrency 3 [--ranks 1,2,...] [--zone-parallel-only]
//   (env from .env.test, same as the harness; HEADLESS=1 recommended)
//
// PROVISIONING:
//   Each slot uses source+dest zone `e2e-s<i>.<parent>` (parent = the registrable
//   parent of SOURCE_DOMAIN). The child harness creates its slot zone on first
//   use (Option A). To avoid concurrent zone-creation hitting the account
//   zone-add limit, Phase B children are started with a short stagger.

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getE2eEnv } from './e2e-env.mjs';
import { partitionTests, perSlotRateLimit, isAccountScoped } from './e2e-parallel-plan.mjs';
import { ensureDevServer } from './dev-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'docs', 'test_configs');
const HARNESS = path.join(__dirname, 'run-playwright-migrations.mjs');

const args = process.argv.slice(2);
function argVal(flag, dflt) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const CONCURRENCY = Math.max(1, parseInt(argVal('--concurrency', '3'), 10) || 1);
const ONLY_RANKS = argVal('--ranks', null); // optional subset
const STAGGER_MS = parseInt(argVal('--stagger-ms', '8000'), 10) || 0;

// Load env (validates .env.test) and derive the slot parent domain.
const { values: envValues, missing } = getE2eEnv({ root: ROOT });
if (missing.length) {
  console.error(`Missing required E2E env: ${missing.join(', ')} (see .env.test).`);
  process.exit(1);
}
const sourceDomain = envValues.SOURCE_DOMAIN;
// Registrable parent: drop the leftmost label. e.g. twilight-maxconfig.example.com → example.com
const parent = sourceDomain.split('.').slice(1).join('.') || sourceDomain;
const slotDomain = (i) => `e2e-s${i}.${parent}`;

// Build the {rank, accountScoped, file} list from the configs.
function loadConfigs() {
  return fs.readdirSync(CONFIG_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const config = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, f), 'utf8'));
      return { file: f, rank: config.metadata?.rank ?? 0, accountScoped: isAccountScoped(config) };
    })
    .filter(c => c.rank > 0);
}

function spawnChild({ ranks, slotDomainName, rateLimit, label }) {
  return new Promise((resolve) => {
    const childEnv = {
      ...process.env,
      SOURCE_DOMAIN: slotDomainName,
      DEST_DOMAIN: slotDomainName, // same-name model, dest in target account
      // PIN the slot name: the orchestrator owns slot-zone naming (stable
      // e2e-s{i} zones reused across runs — Option A). Without this the child
      // harness would rewrite SOURCE_DOMAIN/DEST_DOMAIN to its own per-run
      // unique name and silently ignore the slot assignment, breaking per-slot
      // isolation. (Single-process runs keep the per-run unique default.)
      E2E_PIN_ZONE_NAME: '1',
      E2E_RATE_LIMIT: String(rateLimit),
      HEADLESS: process.env.HEADLESS ?? '1',
      TARGETED_CAPTURE: process.env.TARGETED_CAPTURE ?? '1', // L1 on by default in parallel
    };
    const child = spawn('node', [HARNESS, '--ranks', ranks.join(',')], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tag = `[${label}]`;
    child.stdout.on('data', d => process.stdout.write(`${tag} ${d}`.replace(/\n(?!$)/g, `\n${tag} `)));
    child.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));
    child.on('close', code => {
      console.log(`${tag} exited code=${code}`);
      resolve({ label, ranks, code });
    });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let configs = loadConfigs();
  if (ONLY_RANKS) {
    const wanted = new Set(ONLY_RANKS.split(',').map(s => Number(s.trim())));
    configs = configs.filter(c => wanted.has(c.rank));
  }
  configs.sort((a, b) => a.rank - b.rank);

  const account = configs.filter(c => c.accountScoped).map(c => c.rank);
  const zone = configs.filter(c => !c.accountScoped).map(c => c.rank);

  console.log(`\n🧵 Parallel E2E orchestrator`);
  console.log(`   concurrency: ${CONCURRENCY}`);
  console.log(`   account-scoped (Phase A, sequential): ${account.join(', ') || '(none)'}`);
  console.log(`   zone-scoped   (Phase B, parallel):    ${zone.join(', ') || '(none)'}`);
  console.log(`   slot parent domain: ${parent}\n`);

  // Start ONE shared dev server (or reuse a running one) and hand its URL to
  // every child via the inherited env. Without this, parallel children would
  // each auto-start their own and race on port 5173.
  let devStop = () => {};
  try {
    const dev = await ensureDevServer(process.env.DEV_SERVER_URL || 'http://localhost:5173', {
      outDir: path.join(ROOT, 'test', 'e2e-migrations'),
    });
    process.env.DEV_SERVER_URL = dev.url; // children inherit this → they reuse it
    devStop = dev.stop;
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const results = [];

  // ── Phase A: account-scoped tests, sequential, full budget, on slot 0. ──
  if (account.length) {
    console.log(`\n══ Phase A — ${account.length} account-scoped test(s), sequential ══`);
    results.push(await spawnChild({
      ranks: account,
      slotDomainName: slotDomain(0),
      rateLimit: 1000,
      label: 'A:s0',
    }));
  }

  // ── Phase B: zone-scoped tests, parallel across slots, split budget. ──
  if (zone.length) {
    const n = Math.min(CONCURRENCY, zone.length);
    // Partition zone ranks across n slots (round-robin via the shared planner,
    // treating them all as zone-scoped so they fan out evenly).
    const buckets = partitionTests(zone.map(r => ({ rank: r, accountScoped: false })), n)
      .filter(b => b.length);
    const rate = perSlotRateLimit(n);
    console.log(`\n══ Phase B — ${zone.length} zone-scoped test(s) across ${buckets.length} slot(s), ${rate} req/5min each ══`);
    const running = buckets.map(async (bucket, slot) => {
      if (STAGGER_MS && slot > 0) await sleep(STAGGER_MS * slot); // stagger zone creation
      return spawnChild({
        ranks: bucket,
        slotDomainName: slotDomain(slot + 1), // +1 so we don't reuse slot 0's zone live
        rateLimit: rate,
        label: `B:s${slot + 1}`,
      });
    });
    results.push(...await Promise.all(running));
  }

  const failed = results.filter(r => r.code !== 0);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Parallel run complete: ${results.length} child process(es), ${failed.length} failed.`);
  for (const r of results) {
    console.log(`  ${r.code === 0 ? '✅' : '❌'} ${r.label} ranks=${r.ranks.join(',')} (code ${r.code})`);
  }
  console.log('Per-test pass/fail detail is in each child\'s output above and in test/e2e-migrations/<slug>/.');
  try { devStop(); } catch { /* ignore */ } // stop the shared server if we started it
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
