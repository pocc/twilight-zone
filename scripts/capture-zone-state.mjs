#!/usr/bin/env node
/**
 * Snapshot zone + account state to JSON files for migration evidence.
 *
 * Captures the raw Cloudflare API responses (including the {result, success,
 * errors, messages} envelope) for every endpoint that scripts/verify-checklist.mjs
 * cares about. Files are written one-per-endpoint into the target directory.
 *
 * Run this twice per migration:
 *   1. After seeding the source zone   → $EVIDENCE_DIR/source-state-post-seed/
 *   2. After the migration completes   → $EVIDENCE_DIR/dest-state-post-migrate/
 *
 * Endpoints that 404 (feature not enabled / not entitled) or that depend on a
 * non-existent resource are recorded as an empty result array so the verifier
 * can distinguish "captured but absent" from "never captured".
 *
 * Usage:
 *   CF_API_KEY=<key> CF_API_EMAIL=you@example.com \
 *   CF_ZONE_ID=<zone_id> CF_ACCOUNT_ID=<account_id> \
 *   OUT_DIR=$EVIDENCE_DIR/source-state-post-seed \
 *   node scripts/capture-zone-state.mjs
 *
 *   # Token auth alternative:
 *   CF_API_TOKEN=<token> CF_ZONE_ID=... CF_ACCOUNT_ID=... OUT_DIR=... \
 *   node scripts/capture-zone-state.mjs
 *
 * Environment:
 *   Required: CF_ZONE_ID, CF_ACCOUNT_ID, OUT_DIR
 *             plus either (CF_API_KEY + CF_API_EMAIL) or CF_API_TOKEN
 *   Optional: VERBOSE=1 to print every request
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRateLimitedFetcher } from './rate-limiter.mjs';
import { ENDPOINTS } from './capture-catalog.mjs';

const env = process.env;
const zoneId = env.CF_ZONE_ID ?? '';
const accountId = env.CF_ACCOUNT_ID ?? '';
const outDir = env.OUT_DIR ?? '';
const apiKey = env.CF_API_KEY ?? '';
const apiEmail = env.CF_API_EMAIL ?? '';
const apiToken = env.CF_API_TOKEN ?? '';
const verbose = !!env.VERBOSE;

if (!zoneId) throw new Error('Missing CF_ZONE_ID');
if (!accountId) throw new Error('Missing CF_ACCOUNT_ID');
if (!outDir) throw new Error('Missing OUT_DIR');
if (!apiKey && !apiToken) throw new Error('Missing CF_API_KEY (+ CF_API_EMAIL) or CF_API_TOKEN');

const authHeaders = apiToken
  ? { Authorization: `Bearer ${apiToken}` }
  : { 'X-Auth-Key': apiKey, 'X-Auth-Email': apiEmail };

const { cfRequest } = createRateLimitedFetcher({
  authHeaders,
  rateLimit: 1000,
  windowSec: 300,
  capacity: 20,
  maxRetries: 3,
  verbose,
  pathVars: { zone_id: zoneId, account_id: accountId },
});

fs.mkdirSync(outDir, { recursive: true });

// ── Endpoint selection ──────────────────────────────────────────────
// The full endpoint catalog lives in capture-catalog.mjs (single source of
// truth, shared with the harness + guard test). By default we capture all of
// it. L1 (targeted capture): when CAPTURE_ONLY is set (comma-separated endpoint
// names, supplied by the harness under TARGETED_CAPTURE), we fetch only those —
// e.g. a settings-only test drops from ~78 endpoints to a handful. Unknown names
// in CAPTURE_ONLY are ignored; an empty/whitespace value falls back to full.
const captureOnly = (env.CAPTURE_ONLY ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const activeEndpoints = captureOnly.length
  ? ENDPOINTS.filter(ep => captureOnly.includes(ep.name))
  : ENDPOINTS;

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(`📸 Capturing zone state → ${outDir}`);
  console.log(`   zone:    ${zoneId}`);
  console.log(`   account: ${accountId}`);
  console.log(`   ${activeEndpoints.length}${captureOnly.length ? `/${ENDPOINTS.length} (targeted)` : ''} endpoints`);
  console.log('');

  let ok = 0;
  let optionalMissed = 0;
  let failed = 0;

  for (const ep of activeEndpoints) {
    const filePath = path.join(outDir, `${ep.name}.json`);
    const res = await cfRequest(ep.method, ep.path);

    if (res.ok) {
      fs.writeFileSync(filePath, JSON.stringify(res.data, null, 2));
      console.log(`  ✓ ${ep.name}`);
      ok++;
      continue;
    }

    if (ep.optional) {
      // Write an empty envelope so the verifier can read it deterministically.
      const empty = {
        result: [],
        success: false,
        errors: res.data?.errors ?? [{ code: res.status, message: `Optional endpoint unavailable (${res.status})` }],
        messages: res.data?.messages ?? [],
      };
      fs.writeFileSync(filePath, JSON.stringify(empty, null, 2));
      console.log(`  ⏭ ${ep.name} (optional: ${res.status})`);
      optionalMissed++;
      continue;
    }

    console.error(`  ✗ ${ep.name} (${res.status}): ${res.data?.errors?.[0]?.message || 'unknown error'}`);
    failed++;
  }

  // ── Enrich workers_account.json with per-worker bindings ──────────
  // The list endpoint returns only metadata; field-level binding verification
  // needs the actual bindings array per worker.
  try {
    const workersPath = path.join(outDir, 'workers_account.json');
    if (fs.existsSync(workersPath)) {
      const wAccount = JSON.parse(fs.readFileSync(workersPath, 'utf8'));
      const scripts = Array.isArray(wAccount?.result) ? wAccount.result : [];
      let enriched = 0;
      for (const script of scripts) {
        const scriptName = script.id || script.name;
        if (!scriptName) continue;
        const bRes = await cfRequest('GET', `/accounts/{account_id}/workers/scripts/${scriptName}/bindings`);
        if (bRes.ok && Array.isArray(bRes.data?.result)) {
          script.bindings = bRes.data.result;
          enriched++;
        }
      }
      if (enriched > 0) {
        fs.writeFileSync(workersPath, JSON.stringify(wAccount, null, 2));
        console.log(`  ✓ enriched ${enriched} workers with bindings`);
      }
    }
  } catch (e) {
    console.log(`  ⚠ worker bindings enrichment failed: ${e.message}`);
  }

  // ── Enrich queues.json with per-queue consumers ────────────────────
  try {
    const queuesPath = path.join(outDir, 'queues.json');
    if (fs.existsSync(queuesPath)) {
      const qAccount = JSON.parse(fs.readFileSync(queuesPath, 'utf8'));
      const queues = Array.isArray(qAccount?.result) ? qAccount.result : [];
      const consumersOut = {};
      for (const q of queues) {
        const queueId = q.queue_id;
        if (!queueId) continue;
        const cRes = await cfRequest('GET', `/accounts/{account_id}/queues/${queueId}/consumers`);
        if (cRes.ok && Array.isArray(cRes.data?.result)) {
          consumersOut[q.queue_name] = cRes.data.result;
        }
      }
      if (Object.keys(consumersOut).length > 0) {
        fs.writeFileSync(path.join(outDir, 'queue_consumers.json'), JSON.stringify({ result: consumersOut }, null, 2));
        console.log(`  ✓ captured consumers for ${Object.keys(consumersOut).length} queue(s)`);
      }
    }
  } catch (e) {
    console.log(`  ⚠ queue consumers enrichment failed: ${e.message}`);
  }

  // ── Enrich custom_lists with per-list items ────────────────────────
  try {
    const listsPath = path.join(outDir, 'rules_lists.json');
    if (fs.existsSync(listsPath)) {
      const ls = JSON.parse(fs.readFileSync(listsPath, 'utf8'));
      const lists = Array.isArray(ls?.result) ? ls.result : [];
      const itemsOut = {};
      for (const list of lists) {
        if (!list.id) continue;
        const iRes = await cfRequest('GET', `/accounts/{account_id}/rules/lists/${list.id}/items`);
        if (iRes.ok && Array.isArray(iRes.data?.result)) {
          itemsOut[list.name] = iRes.data.result;
        }
      }
      if (Object.keys(itemsOut).length > 0) {
        fs.writeFileSync(path.join(outDir, 'custom_list_items.json'), JSON.stringify({ result: itemsOut }, null, 2));
        console.log(`  ✓ captured items for ${Object.keys(itemsOut).length} custom list(s)`);
      }
    }
  } catch (e) {
    console.log(`  ⚠ custom list items enrichment failed: ${e.message}`);
  }

  // ── Enrich waiting_rooms with per-room events ──────────────────────
  try {
    const roomsPath = path.join(outDir, 'waiting_rooms.json');
    if (fs.existsSync(roomsPath)) {
      const rooms = JSON.parse(fs.readFileSync(roomsPath, 'utf8'));
      const list = Array.isArray(rooms?.result) ? rooms.result : [];
      const eventsOut = {};
      for (const room of list) {
        if (!room.id) continue;
        const eRes = await cfRequest('GET', `/zones/{zone_id}/waiting_rooms/${room.id}/events`);
        if (eRes.ok && Array.isArray(eRes.data?.result) && eRes.data.result.length > 0) {
          eventsOut[room.name] = eRes.data.result;
        }
      }
      if (Object.keys(eventsOut).length > 0) {
        fs.writeFileSync(path.join(outDir, 'waiting_room_events.json'), JSON.stringify({ result: eventsOut }, null, 2));
        console.log(`  ✓ captured events for ${Object.keys(eventsOut).length} waiting room(s)`);
      }
    }
  } catch (e) {
    console.log(`  ⚠ waiting room events enrichment failed: ${e.message}`);
  }

  // ── Capture dedicated-endpoint SCALAR zone settings ────────────────
  // The aggregate GET /zones/{id}/settings omits a set of settings that live
  // ONLY behind their own /settings/<id> endpoint (speed_brain, fonts,
  // origin_max_http_version, ssl_automatic_mode, h2_prioritization, rum,
  // csam_scanner_third_party, …). The migration engine backfills these via
  // export-zone.ts Phase 1a, but the aggregate `settings.json` captured above
  // does NOT contain them — so an independent settings comparison would miss
  // them entirely. Fetch each one individually here, into settings_dedicated.json,
  // so assertDedicatedScalarSettingsMatch can verify them source→dest.
  //
  // The id list is sourced from src/fuzz.ts ZONE_SETTINGS (single source of
  // truth — no hardcoded drift): every id absent from the aggregate is fetched
  // via its dedicated endpoint. We store the API-returned `result.id` (which can
  // differ from the request path — e.g. /settings/csam_scanner_third_party
  // returns id "csam_scanner") so the stored id matches what migrate uses.
  try {
    const aggPath = path.join(outDir, 'settings.json');
    const aggregateSettingIds = new Set();
    if (fs.existsSync(aggPath)) {
      const agg = JSON.parse(fs.readFileSync(aggPath, 'utf8'));
      for (const s of (Array.isArray(agg?.result) ? agg.result : [])) if (s?.id) aggregateSettingIds.add(s.id);
    }
    // Extract ZONE_SETTINGS ids from src/fuzz.ts. The array spans from the
    // declaration to its closing `];`; within that slice every `id: '...'` is a
    // setting def id (testValues entries use enabled/strict_transport_security/…,
    // never an `id:` key), so this regex is safe and stays in sync with the engine.
    const fuzzPath = new URL('../src/fuzz.ts', import.meta.url);
    const fuzzSrc = fs.readFileSync(fuzzPath, 'utf8');
    const declStart = fuzzSrc.indexOf('export const ZONE_SETTINGS');
    const sliceEnd = fuzzSrc.indexOf('\n];', declStart);
    const zsSlice = declStart >= 0 && sliceEnd > declStart ? fuzzSrc.slice(declStart, sliceEnd) : '';
    const allSettingIds = [...zsSlice.matchAll(/\bid:\s*'([^']+)'/g)].map(m => m[1]);
    const dedicatedIds = allSettingIds.filter(id => !aggregateSettingIds.has(id));

    const dedicatedOut = [];
    for (const reqId of dedicatedIds) {
      const r = await cfRequest('GET', `/zones/{zone_id}/settings/${reqId}`);
      // A real setting is a single object with an id; not-entitled/not-found are
      // skipped (best-effort, like export-zone.ts Phase 1a) so absence here means
      // "the source genuinely doesn't expose it", not "capture failed".
      const result = r.ok ? r.data?.result : null;
      if (result && typeof result === 'object' && !Array.isArray(result) && (result.id || reqId)) {
        // Store `editable` so the comparison assertion can exclude non-editable
        // settings (e.g. nel is editable:false on most plans) exactly like the
        // aggregate-settings comparison does — otherwise a server-managed
        // setting whose value legitimately can't be migrated is a false mismatch.
        dedicatedOut.push({ id: result.id || reqId, requestedId: reqId, value: result.value, editable: result.editable });
      }
    }
    fs.writeFileSync(path.join(outDir, 'settings_dedicated.json'), JSON.stringify({ result: dedicatedOut }, null, 2));
    console.log(`  ✓ settings_dedicated (${dedicatedOut.length}/${dedicatedIds.length} dedicated-endpoint setting(s) present)`);
  } catch (e) {
    console.log(`  ⚠ dedicated-scalar settings capture failed: ${e.message}`);
  }

  console.log('');
  console.log(`Summary: ${ok} captured, ${optionalMissed} optional-unavailable, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
