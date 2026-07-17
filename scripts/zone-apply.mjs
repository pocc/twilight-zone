#!/usr/bin/env node
/**
 * Zone Cleanup & Apply Utility
 *
 * Resets a Cloudflare zone to blank state, then applies a JSON config.
 *
 * Usage:
 *   node scripts/zone-apply.mjs clean                    # Clean zone only
 *   node scripts/zone-apply.mjs apply <config.json>      # Apply config (no clean)
 *   node scripts/zone-apply.mjs reset <config.json>      # Clean + apply
 *
 * Environment:
 *   CF_API_KEY, CF_API_EMAIL, CF_ZONE_ID, CF_ACCOUNT_ID
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRateLimitedFetcher } from './rate-limiter.mjs';

const env = process.env;
const zoneId = env.CF_ZONE_ID ?? '';
const accountId = env.CF_ACCOUNT_ID ?? '';
const apiKey = env.CF_API_KEY ?? '';
const apiEmail = env.CF_API_EMAIL ?? '';
const apiToken = env.CF_API_TOKEN ?? '';
const verbose = !!env.VERBOSE;

if (!zoneId) throw new Error('Missing CF_ZONE_ID');
if (!accountId) throw new Error('Missing CF_ACCOUNT_ID');
if (!apiKey && !apiToken) throw new Error('Missing CF_API_KEY (+ CF_API_EMAIL) or CF_API_TOKEN');

const authHeaders = apiToken
  ? { Authorization: `Bearer ${apiToken}` }
  : { 'X-Auth-Key': apiKey, 'X-Auth-Email': apiEmail };

const { cfRequest, getStats } = createRateLimitedFetcher({
  authHeaders,
  rateLimit: 1000,
  windowSec: 300,
  capacity: 20,
  maxRetries: 3,
  verbose,
  pathVars: { zone_id: zoneId, account_id: accountId },
});

// ── CLEAN: Delete all resources from zone ──────────────────────

async function cleanZone() {
  console.log(`\n🧹 Cleaning zone ${zoneId}...\n`);
  let totalDeleted = 0;

  // 1. DNS Records
  const dnsResult = await cfRequest('GET', '/zones/{zone_id}/dns_records?per_page=100');
  if (dnsResult.ok && Array.isArray(dnsResult.data?.result)) {
    const records = dnsResult.data.result;
    console.log(`  DNS Records: ${records.length} found`);
    for (const record of records) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/dns_records/${record.id}`);
      if (del.ok) totalDeleted++;
      else console.log(`    ⚠️  Failed to delete DNS ${record.type} ${record.name}: ${del.data?.errors?.[0]?.message || del.status}`);
    }
  }

  // 2. Page Rules
  const prResult = await cfRequest('GET', '/zones/{zone_id}/pagerules?per_page=100');
  if (prResult.ok && Array.isArray(prResult.data?.result)) {
    const rules = prResult.data.result;
    console.log(`  Page Rules: ${rules.length} found`);
    for (const rule of rules) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/pagerules/${rule.id}`);
      if (del.ok) totalDeleted++;
      else console.log(`    ⚠️  Failed to delete page rule ${rule.id}: ${del.data?.errors?.[0]?.message || del.status}`);
    }
  }

  // 3. Firewall Rules (legacy)
  const fwResult = await cfRequest('GET', '/zones/{zone_id}/firewall/rules?per_page=100');
  if (fwResult.ok && Array.isArray(fwResult.data?.result)) {
    const rules = fwResult.data.result;
    console.log(`  Firewall Rules: ${rules.length} found`);
    for (const rule of rules) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/firewall/rules/${rule.id}`);
      if (del.ok) totalDeleted++;
      else console.log(`    ⚠️  Failed to delete firewall rule ${rule.id}: ${del.data?.errors?.[0]?.message || del.status}`);
    }
  }

  // 4. Filters (associated with firewall rules)
  const filterResult = await cfRequest('GET', `/zones/${zoneId}/filters?per_page=100`);
  if (filterResult.ok && Array.isArray(filterResult.data?.result)) {
    const filters = filterResult.data.result;
    console.log(`  Filters: ${filters.length} found`);
    for (const filter of filters) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/filters/${filter.id}`);
      if (del.ok) totalDeleted++;
      else if (verbose) console.log(`    ⚠️  Failed to delete filter ${filter.id}`);
    }
  }

  // 5. Rate Limits
  const rlResult = await cfRequest('GET', '/zones/{zone_id}/rate_limits?per_page=100');
  if (rlResult.ok && Array.isArray(rlResult.data?.result)) {
    const limits = rlResult.data.result;
    console.log(`  Rate Limits: ${limits.length} found`);
    for (const limit of limits) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/rate_limits/${limit.id}`);
      if (del.ok) totalDeleted++;
      else console.log(`    ⚠️  Failed to delete rate limit ${limit.id}: ${del.data?.errors?.[0]?.message || del.status}`);
    }
  }

  // 6. Custom Rulesets (clear each phase)
  const phases = [
    'http_request_firewall_custom',
    'http_request_cache_settings',
    'http_ratelimit',
    'http_request_firewall_managed',
    'http_request_sbfm',
    'http_request_redirect',
    'http_request_origin',
    'http_request_late_transform',
    'http_request_transform',
    'http_response_headers_transform',
    'http_response_firewall_managed',
    'http_config_settings',
    'http_request_dynamic_redirect',
    'http_response_compression',
  ];
  console.log(`  Rulesets: clearing ${phases.length} phases`);
  for (const phase of phases) {
    const result = await cfRequest('PUT', `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, { rules: [] });
    if (result.ok) totalDeleted++;
    // Silently skip phases that don't exist or can't be cleared
    else if (verbose) console.log(`    ⚠️  Phase ${phase}: ${result.data?.errors?.[0]?.message || result.status}`);
  }

  // 7. Worker Routes
  const wrResult = await cfRequest('GET', '/zones/{zone_id}/workers/routes');
  if (wrResult.ok && Array.isArray(wrResult.data?.result)) {
    const routes = wrResult.data.result;
    console.log(`  Worker Routes: ${routes.length} found`);
    for (const route of routes) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/workers/routes/${route.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 8. Custom Hostnames
  const chResult = await cfRequest('GET', '/zones/{zone_id}/custom_hostnames?per_page=100');
  if (chResult.ok && Array.isArray(chResult.data?.result)) {
    const hostnames = chResult.data.result;
    console.log(`  Custom Hostnames: ${hostnames.length} found`);
    for (const hostname of hostnames) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/custom_hostnames/${hostname.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 9. Load Balancers
  const lbResult = await cfRequest('GET', '/zones/{zone_id}/load_balancers');
  if (lbResult.ok && Array.isArray(lbResult.data?.result)) {
    const lbs = lbResult.data.result;
    console.log(`  Load Balancers: ${lbs.length} found`);
    for (const lb of lbs) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/load_balancers/${lb.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 10. Waiting Rooms
  const waitResult = await cfRequest('GET', '/zones/{zone_id}/waiting_rooms');
  if (waitResult.ok && Array.isArray(waitResult.data?.result)) {
    const rooms = waitResult.data.result;
    console.log(`  Waiting Rooms: ${rooms.length} found`);
    for (const room of rooms) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/waiting_rooms/${room.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 11. Access Apps (account-level)
  const accessResult = await cfRequest('GET', '/accounts/{account_id}/access/apps');
  if (accessResult.ok && Array.isArray(accessResult.data?.result)) {
    const apps = accessResult.data.result;
    console.log(`  Access Apps: ${apps.length} found`);
    for (const app of apps) {
      const del = await cfRequest('DELETE', `/accounts/${accountId}/access/apps/${app.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 12. Spectrum Apps
  const spResult = await cfRequest('GET', '/zones/{zone_id}/spectrum/apps');
  if (spResult.ok && Array.isArray(spResult.data?.result)) {
    const apps = spResult.data.result;
    if (apps.length > 0) console.log(`  Spectrum Apps: ${apps.length} found`);
    for (const app of apps) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/spectrum/apps/${app.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 13. LB Pools (account-level — must be after zone LB deletes)
  const poolsResult = await cfRequest('GET', '/accounts/{account_id}/load_balancers/pools');
  if (poolsResult.ok && Array.isArray(poolsResult.data?.result)) {
    const pools = poolsResult.data.result;
    if (pools.length > 0) console.log(`  LB Pools: ${pools.length} found`);
    for (const pool of pools) {
      const del = await cfRequest('DELETE', `/accounts/${accountId}/load_balancers/pools/${pool.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 14. LB Monitors (account-level — must be after pool deletes)
  const monitorsResult = await cfRequest('GET', '/accounts/{account_id}/load_balancers/monitors');
  if (monitorsResult.ok && Array.isArray(monitorsResult.data?.result)) {
    const monitors = monitorsResult.data.result;
    if (monitors.length > 0) console.log(`  LB Monitors: ${monitors.length} found`);
    for (const monitor of monitors) {
      const del = await cfRequest('DELETE', `/accounts/${accountId}/load_balancers/monitors/${monitor.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 15. Standalone healthchecks
  const hcResult = await cfRequest('GET', '/zones/{zone_id}/healthchecks');
  if (hcResult.ok && Array.isArray(hcResult.data?.result)) {
    const hcs = hcResult.data.result;
    if (hcs.length > 0) console.log(`  Healthchecks: ${hcs.length} found`);
    for (const hc of hcs) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/healthchecks/${hc.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 16. Snippets
  const snResult = await cfRequest('GET', '/zones/{zone_id}/snippets');
  if (snResult.ok && Array.isArray(snResult.data?.result)) {
    const snippets = snResult.data.result;
    if (snippets.length > 0) console.log(`  Snippets: ${snippets.length} found`);
    for (const snip of snippets) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/snippets/${snip.snippet_name || snip.name}`);
      if (del.ok) totalDeleted++;
    }
  }
  // Clear snippet rules
  await cfRequest('PUT', `/zones/${zoneId}/snippets/snippet_rules`, { rules: [] });

  // 17. Cloud Connector rules
  await cfRequest('PUT', `/zones/${zoneId}/cloud_connector/rules`, []);

  // 18. Page Shield policies
  const psResult = await cfRequest('GET', `/zones/${zoneId}/page_shield/policies`);
  if (psResult.ok && Array.isArray(psResult.data?.result)) {
    for (const policy of psResult.data.result) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/page_shield/policies/${policy.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 19. Firewall Access Rules, Lockdowns, UA Rules
  for (const subpath of ['access_rules/rules', 'lockdowns', 'ua_rules']) {
    const r = await cfRequest('GET', `/zones/${zoneId}/firewall/${subpath}?per_page=100`);
    if (r.ok && Array.isArray(r.data?.result)) {
      for (const item of r.data.result) {
        const del = await cfRequest('DELETE', `/zones/${zoneId}/firewall/${subpath}/${item.id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // 20. Schema Validation schemas
  const svResult = await cfRequest('GET', `/zones/${zoneId}/schema_validation/schemas`);
  if (svResult.ok && Array.isArray(svResult.data?.result)) {
    for (const s of svResult.data.result) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/schema_validation/schemas/${s.schema_id || s.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 21. Token Validation configs + rules
  for (const sub of ['rules', 'config']) {
    const r = await cfRequest('GET', `/zones/${zoneId}/token_validation/${sub}`);
    if (r.ok && Array.isArray(r.data?.result)) {
      for (const item of r.data.result) {
        const del = await cfRequest('DELETE', `/zones/${zoneId}/token_validation/${sub}/${item.id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // 22. Logpush jobs
  const lpResult = await cfRequest('GET', `/zones/${zoneId}/logpush/jobs`);
  if (lpResult.ok && Array.isArray(lpResult.data?.result)) {
    for (const job of lpResult.data.result) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/logpush/jobs/${job.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 23. Account-level: Access Groups, Custom Lists (best-effort, only test-prefixed)
  const agResult = await cfRequest('GET', `/accounts/${accountId}/access/groups`);
  if (agResult.ok && Array.isArray(agResult.data?.result)) {
    for (const g of agResult.data.result) {
      if (/^maxconfig|^test|^lb-test|^secrets-test/i.test(g.name || '')) {
        const del = await cfRequest('DELETE', `/accounts/${accountId}/access/groups/${g.id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }
  const clResult = await cfRequest('GET', `/accounts/${accountId}/rules/lists`);
  if (clResult.ok && Array.isArray(clResult.data?.result)) {
    for (const list of clResult.data.result) {
      if (/^maxconfig/i.test(list.name || '')) {
        const del = await cfRequest('DELETE', `/accounts/${accountId}/rules/lists/${list.id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // ── 2026-05-26 Principle 7 audit cleanup — newer features ────────
  // Each block is best-effort: 4xx/5xx (incl. entitlement gaps and
  // empty collections) are silently ignored so the cleaner runs to
  // completion on free accounts.

  // 24. Web3 hostnames (zone-scoped, prefix-filtered)
  const w3 = await cfRequest('GET', `/zones/${zoneId}/web3/hostnames`);
  if (w3.ok && Array.isArray(w3.data?.result)) {
    for (const h of w3.data.result) {
      if (/^(ipfs|gateway|maxconfig|test)/i.test(h.name || '')) {
        const del = await cfRequest('DELETE', `/zones/${zoneId}/web3/hostnames/${h.id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // 25. Email Sending subdomains (zone-scoped, prefix-filtered)
  const es = await cfRequest('GET', `/zones/${zoneId}/email/sending/subdomains`);
  if (es.ok && Array.isArray(es.data?.result)) {
    for (const sub of es.data.result) {
      if (/^(mail|maxconfig|test)/i.test(sub.name || '')) {
        const del = await cfRequest('DELETE', `/zones/${zoneId}/email/sending/subdomains/${sub.tag || sub.id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // 26. Leaked Credential custom detections (zone-scoped)
  const lcd = await cfRequest('GET', `/zones/${zoneId}/leaked-credential-checks/detections`);
  if (lcd.ok && Array.isArray(lcd.data?.result)) {
    for (const det of lcd.data.result) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/leaked-credential-checks/detections/${det.id}`);
      if (del.ok) totalDeleted++;
    }
  }

  // 27. Cache Origin Cloud Regions (zone-scoped, bulk delete via batch)
  const ocrEnv = await cfRequest('GET', `/zones/${zoneId}/cache/origin_cloud_regions`);
  const ocrMappings = Array.isArray(ocrEnv.data?.result?.value) ? ocrEnv.data.result.value : [];
  if (ocrMappings.length > 0) {
    const ips = ocrMappings.map(m => m['origin-ip']).filter(Boolean);
    if (ips.length > 0) {
      const del = await cfRequest('DELETE', `/zones/${zoneId}/cache/origin_cloud_regions/batch`, ips);
      if (del.ok) totalDeleted += ips.length;
    }
  }

  // 28. Custom Hostname Fallback Origin (zone-scoped singleton)
  await cfRequest('DELETE', `/zones/${zoneId}/custom_hostnames/fallback_origin`);

  // 29. Secondary DNS (zone-scoped configs, then account-scoped peers/tsigs/acls)
  await cfRequest('DELETE', `/zones/${zoneId}/secondary_dns/incoming`);
  await cfRequest('DELETE', `/zones/${zoneId}/secondary_dns/outgoing`);
  for (const sub of ['peers', 'tsigs', 'acls']) {
    const r = await cfRequest('GET', `/accounts/${accountId}/secondary_dns/${sub}`);
    if (r.ok && Array.isArray(r.data?.result)) {
      for (const item of r.data.result) {
        if (/^(maxconfig|test)/i.test(item.name || '')) {
          const del = await cfRequest('DELETE', `/accounts/${accountId}/secondary_dns/${sub}/${item.id}`);
          if (del.ok) totalDeleted++;
        }
      }
    }
  }

  // 30. LB Monitor Groups (account-scoped, prefix-filtered)
  const mg = await cfRequest('GET', `/accounts/${accountId}/load_balancers/monitor_groups`);
  if (mg.ok && Array.isArray(mg.data?.result)) {
    for (const grp of mg.data.result) {
      if (/^maxconfig|^test/i.test(grp.description || '')) {
        const del = await cfRequest('DELETE', `/accounts/${accountId}/load_balancers/monitor_groups/${grp.id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // 31. Hyperdrive configs (account-scoped, prefix-filtered)
  const hd = await cfRequest('GET', `/accounts/${accountId}/hyperdrive/configs`);
  if (hd.ok && Array.isArray(hd.data?.result)) {
    for (const c of hd.data.result) {
      if (/^maxconfig|^test/i.test(c.name || '')) {
        const del = await cfRequest('DELETE', `/accounts/${accountId}/hyperdrive/configs/${c.id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // 32. Secrets Store stores (account-scoped, prefix-filtered, force-delete cascades secrets)
  const ss = await cfRequest('GET', `/accounts/${accountId}/secrets_store/stores`);
  if (ss.ok && Array.isArray(ss.data?.result)) {
    for (const s of ss.data.result) {
      if (/^maxconfig|^test|^secrets-test/i.test(s.name || '')) {
        const del = await cfRequest('DELETE', `/accounts/${accountId}/secrets_store/stores/${s.id}?force=true`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // 33. Vectorize indexes (account-scoped, prefix-filtered)
  const v = await cfRequest('GET', `/accounts/${accountId}/vectorize/v2/indexes`);
  if (v.ok && Array.isArray(v.data?.result)) {
    for (const idx of v.data.result) {
      if (/^maxconfig|^test/i.test(idx.name || '')) {
        const del = await cfRequest('DELETE', `/accounts/${accountId}/vectorize/v2/indexes/${idx.name}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // 34. Workers Observability destinations + queries (account-scoped, prefix-filtered)
  const wod = await cfRequest('GET', `/accounts/${accountId}/workers/observability/destinations`);
  if (wod.ok && Array.isArray(wod.data?.result)) {
    for (const d of wod.data.result) {
      if (/^maxconfig|^test/i.test(d.name || '') || /^maxconfig|^test/i.test(d.slug || '')) {
        const del = await cfRequest('DELETE', `/accounts/${accountId}/workers/observability/destinations/${d.id || d.slug}`);
        if (del.ok) totalDeleted++;
      }
    }
  }
  const woq = await cfRequest('GET', `/accounts/${accountId}/workers/observability/queries`);
  if (woq.ok && Array.isArray(woq.data?.result)) {
    for (const q of woq.data.result) {
      if (/^maxconfig|^test/i.test(q.name || '')) {
        const del = await cfRequest('DELETE', `/accounts/${accountId}/workers/observability/queries/${q.id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // ── 2026-05-26 21-gap-closure cleanup ───────────────────────────

  // 35. Custom Nameservers metadata (per-zone singleton; PUT with
  // enabled=false to reset)
  await cfRequest('PUT', `/zones/${zoneId}/custom_ns`, { enabled: false });

  // 36. Pay-per-Crawl configuration (per-zone singleton)
  // The DELETE endpoint may not exist; try GET first and only act if present.
  // (Idempotent: zone-apply will POST fresh on next run.)
  // No explicit cleanup — POST is upsert-like on re-apply.

  // 37. AI Gateway Custom Provider Costs (account-scoped, prefix-filtered)
  const ppc = await cfRequest('GET', `/accounts/${accountId}/ai-gateway/custom-providers/costs`);
  if (ppc.ok && Array.isArray(ppc.data?.result)) {
    for (const c of ppc.data.result) {
      if (/^maxconfig|^test/i.test(c.name || '')) {
        const del = await cfRequest('DELETE', `/accounts/${accountId}/ai-gateway/custom-providers/costs/${c.id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  // 38. AI Gateway per-gateway provider configs (per-gateway, best-effort)
  const aiGws = await cfRequest('GET', `/accounts/${accountId}/ai-gateway/gateways`);
  if (aiGws.ok && Array.isArray(aiGws.data?.result)) {
    for (const gw of aiGws.data.result) {
      if (!/^maxconfig|^test/i.test(gw.id || '')) continue;
      const pcfg = await cfRequest('GET', `/accounts/${accountId}/ai-gateway/gateways/${gw.id}/provider_configs`);
      if (pcfg.ok && Array.isArray(pcfg.data?.result)) {
        for (const c of pcfg.data.result) {
          const del = await cfRequest('DELETE', `/accounts/${accountId}/ai-gateway/gateways/${gw.id}/provider_configs/${c.id}`);
          if (del.ok) totalDeleted++;
        }
      }
    }
  }

  // ── 2026-05-26 API Shield iteration cleanup ─────────────────────

  // 39. API Shield user labels (prefix-filtered)
  const aslabels = await cfRequest('GET', `/zones/${zoneId}/api_gateway/labels`);
  if (aslabels.ok && Array.isArray(aslabels.data?.result)) {
    for (const l of aslabels.data.result) {
      if (l.managed) continue;
      if (/^maxconfig|^test/i.test(l.name || '') && l.label_id) {
        const del = await cfRequest('DELETE', `/accounts/${accountId}/api_gateway/labels/user/${l.label_id}`);
        // user labels delete is zone-scoped on some API versions; try zone too
        if (!del.ok) await cfRequest('DELETE', `/zones/${zoneId}/api_gateway/labels/user/${l.label_id}`);
        if (del.ok) totalDeleted++;
      }
    }
  }

  console.log(`\n  ✅ Cleaned ${totalDeleted} resources from zone\n`);
  return totalDeleted;
}

// ── APPLY: Apply a config JSON to zone ─────────────────────────

async function applyConfig(configPath) {
  const fullPath = path.resolve(configPath);
  if (!fs.existsSync(fullPath)) throw new Error(`Config file not found: ${fullPath}`);

  let configRaw = fs.readFileSync(fullPath, 'utf8');

  // Look up the actual zone domain and rewrite placeholder domains in the config.
  // Test configs use "test.example.com" as a placeholder — replace with the real zone name.
  const zoneResult = await cfRequest('GET', `/zones/${zoneId}`);
  const zoneName = zoneResult.data?.result?.name;
  if (zoneName) {
    const configDomain = JSON.parse(configRaw).metadata?.domain || 'test.example.com';
    // Replace the config placeholder domain with the actual zone domain
    const placeholderBase = configDomain.replace(/^[^.]+\./, ''); // e.g. "example.com" from "maxconfig.example.com"
    if (placeholderBase !== zoneName) {
      configRaw = configRaw.replaceAll(`test.${placeholderBase}`, zoneName);
      if (verbose) console.log(`  🔄 Rewrote "test.${placeholderBase}" → "${zoneName}" in config`);
    }
  }

  const config = JSON.parse(configRaw);
  console.log(`\n📋 Applying config: ${config.metadata?.company || 'unknown'} (${config.metadata?.profile || 'unknown'})\n`);

  let created = 0;
  let failed = 0;

  // 1. DNS Records
  if (config.dns_records?.length > 0) {
    console.log(`  DNS Records: creating ${config.dns_records.length}`);
    for (const record of config.dns_records) {
      const result = await cfRequest('POST', '/zones/{zone_id}/dns_records', record);
      if (result.ok) created++;
      else {
        const err = result.data?.errors?.[0]?.message || result.status;
        if (String(err).includes('already exists')) {
          if (verbose) console.log(`    ⏭️  DNS ${record.type} ${record.name} already exists`);
        } else {
          failed++;
          console.log(`    ❌ DNS ${record.type} ${record.name}: ${err}`);
        }
      }
    }
  }

  // 2. Zone Settings
  if (config.zone_settings && typeof config.zone_settings === 'object') {
    const settings = Object.entries(config.zone_settings);
    console.log(`  Zone Settings: applying ${settings.length}`);
    for (const [key, value] of settings) {
      const result = await cfRequest('PATCH', `/zones/${zoneId}/settings/${key}`, { value });
      if (result.ok) created++;
      else {
        failed++;
        if (verbose) console.log(`    ⚠️  Setting ${key}: ${result.data?.errors?.[0]?.message || result.status}`);
      }
    }
  }

  // 3. Page Rules
  if (config.page_rules?.length > 0) {
    console.log(`  Page Rules: creating ${config.page_rules.length}`);
    for (const rule of config.page_rules) {
      const result = await cfRequest('POST', '/zones/{zone_id}/pagerules', rule);
      if (result.ok) created++;
      else { failed++; console.log(`    ❌ Page Rule: ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 4. Firewall Rules
  if (config.firewall_rules?.length > 0) {
    console.log(`  Firewall Rules: creating ${config.firewall_rules.length}`);
    for (const rule of config.firewall_rules) {
      // Create filter + rule in one call
      const result = await cfRequest('POST', `/zones/${zoneId}/firewall/rules`, [{
        filter: { expression: rule.filter?.expression || rule.expression || '' },
        action: rule.action,
        description: rule.description || '',
        priority: rule.priority,
      }]);
      if (result.ok) created++;
      else { failed++; console.log(`    ❌ Firewall Rule "${rule.description || ''}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 5. Rate Limits (legacy or new key)
  const legacyRateLimits = config.rate_limits_legacy || config.rate_limits;
  if (legacyRateLimits?.length > 0) {
    console.log(`  Rate Limits (legacy): creating ${legacyRateLimits.length}`);
    for (const limit of legacyRateLimits) {
      const result = await cfRequest('POST', '/zones/{zone_id}/rate_limits', limit);
      if (result.ok) created++;
      else {
        const err = result.data?.errors?.[0]?.message || result.status;
        // Legacy rate limits API requires entitlement on some plans — log but don't fatally fail
        if (verbose) console.log(`    ⚠️  Rate Limit: ${err}`);
        else failed++;
      }
    }
  }

  // 6. Rulesets
  if (config.rulesets && typeof config.rulesets === 'object') {
    for (const [phase, rules] of Object.entries(config.rulesets)) {
      if (!Array.isArray(rules) || rules.length === 0) continue;
      console.log(`  Ruleset ${phase}: applying ${rules.length} rules`);

      // Clean rule objects for the API
      const cleanRules = rules.map(r => ({
        action: r.action,
        expression: r.expression,
        description: r.description || '',
        enabled: r.enabled !== false,
        ...(r.action_parameters ? { action_parameters: r.action_parameters } : {}),
        ...(r.ratelimit ? { ratelimit: r.ratelimit } : {}),
      }));

      const result = await cfRequest('PUT', `/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, { rules: cleanRules });
      if (result.ok) created++;
      else { failed++; console.log(`    ❌ Ruleset ${phase}: ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 7. Argo settings
  if (config.argo) {
    if (config.argo.smart_routing) {
      const result = await cfRequest('PATCH', `/zones/${zoneId}/argo/smart_routing`, { value: config.argo.smart_routing });
      if (result.ok) created++; else { failed++; if (verbose) console.log(`    ⚠️  Argo smart routing: ${result.data?.errors?.[0]?.message}`); }
    }
    if (config.argo.tiered_caching) {
      const result = await cfRequest('PATCH', `/zones/${zoneId}/argo/tiered_caching`, { value: config.argo.tiered_caching });
      if (result.ok) created++; else { failed++; if (verbose) console.log(`    ⚠️  Argo tiered caching: ${result.data?.errors?.[0]?.message}`); }
    }
  }

  // 8. Bot Management
  if (config.bot_management && typeof config.bot_management === 'object') {
    const result = await cfRequest('PUT', `/zones/${zoneId}/bot_management`, config.bot_management);
    if (result.ok) created++; else { failed++; if (verbose) console.log(`    ⚠️  Bot management: ${result.data?.errors?.[0]?.message}`); }
  }

  // 9. Waiting Rooms
  if (config.waiting_rooms?.length > 0) {
    console.log(`  Waiting Rooms: creating ${config.waiting_rooms.length}`);
    for (const room of config.waiting_rooms) {
      const result = await cfRequest('POST', `/zones/${zoneId}/waiting_rooms`, room);
      if (result.ok) created++;
      else { failed++; console.log(`    ❌ Waiting Room "${room.name || ''}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 10. Custom Hostnames
  if (config.custom_hostnames?.length > 0) {
    console.log(`  Custom Hostnames: creating ${config.custom_hostnames.length}`);
    for (const hostname of config.custom_hostnames) {
      const result = await cfRequest('POST', `/zones/${zoneId}/custom_hostnames`, hostname);
      if (result.ok) created++;
      else { failed++; console.log(`    ❌ Custom Hostname: ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 11. Zaraz config
  if (config.zaraz && typeof config.zaraz === 'object') {
    const result = await cfRequest('PUT', `/zones/${zoneId}/settings/zaraz/v2/config`, config.zaraz);
    if (result.ok) created++;
    else { failed++; if (verbose) console.log(`    ⚠️  Zaraz: ${result.data?.errors?.[0]?.message}`); }
  }

  // 12. Email Routing (enable + catch-all)
  if (config.email_routing) {
    console.log(`  Email Routing: configuring`);
    // Enable email routing first
    const enableResult = await cfRequest('POST', `/zones/${zoneId}/email/routing/enable`);
    if (enableResult.ok) { created++; if (verbose) console.log(`    ✅ Email Routing enabled`); }
    else if (verbose) console.log(`    ⚠️  Email Routing enable: ${enableResult.data?.errors?.[0]?.message}`);

    // Set catch-all rule if specified
    if (config.email_routing.catch_all) {
      const catchAll = config.email_routing.catch_all;
      const result = await cfRequest('PUT', `/zones/${zoneId}/email/routing/rules/catch_all`, {
        enabled: catchAll.enabled !== false,
        matchers: catchAll.matchers || [{ type: 'all' }],
        actions: catchAll.actions || [{ type: 'drop' }],
      });
      if (result.ok) created++;
      else { failed++; if (verbose) console.log(`    ⚠️  Email Routing catch-all: ${result.data?.errors?.[0]?.message}`); }
    }

    // Additional per-address rules (literal/regex matchers)
    if (Array.isArray(config.email_routing.rules) && config.email_routing.rules.length > 0) {
      console.log(`    Email Routing rules: creating ${config.email_routing.rules.length}`);
      for (const rule of config.email_routing.rules) {
        const result = await cfRequest('POST', `/zones/${zoneId}/email/routing/rules`, {
          name: rule.name,
          priority: rule.priority ?? 0,
          enabled: rule.enabled !== false,
          matchers: rule.matchers || [],
          actions: rule.actions || [],
        });
        if (result.ok) created++;
        else { failed++; if (verbose) console.log(`      ⚠️  Email rule "${rule.name}": ${result.data?.errors?.[0]?.message || result.status}`); }
      }
    }
  }

  // 13. Turnstile widgets (account-scoped)
  if (config.turnstile?.length > 0) {
    console.log(`  Turnstile: creating ${config.turnstile.length} widget(s)`);
    for (const widget of config.turnstile) {
      const result = await cfRequest('POST', `/accounts/${accountId}/challenges/widgets`, {
        name: widget.name,
        mode: widget.mode || 'managed',
        domains: widget.domains || [],
        region: widget.region || 'world',
      });
      if (result.ok) { created++; if (verbose) console.log(`    ✅ Turnstile: ${widget.name}`); }
      else { failed++; console.log(`    ❌ Turnstile "${widget.name}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 14. Access Applications (account-scoped)
  const accessAppIdMap = {};
  if (config.access_apps?.length > 0) {
    console.log(`  Access Apps: creating ${config.access_apps.length}`);
    for (const app of config.access_apps) {
      const result = await cfRequest('POST', `/accounts/${accountId}/access/apps`, {
        name: app.name,
        domain: app.domain,
        type: app.type || 'self_hosted',
        session_duration: app.session_duration || '24h',
        allowed_idps: app.allowed_idps || [],
        auto_redirect_to_identity: app.auto_redirect_to_identity || false,
      });
      if (result.ok) {
        created++;
        if (result.data?.result?.id) accessAppIdMap[app.name] = result.data.result.id;
        if (verbose) console.log(`    ✅ Access App: ${app.name}`);
      } else {
        failed++;
        console.log(`    ❌ Access App "${app.name}": ${result.data?.errors?.[0]?.message || result.status}`);
      }
    }
  }

  // 15. Access Policies (linked to apps by app_name)
  if (config.access_policies?.length > 0) {
    console.log(`  Access Policies: creating ${config.access_policies.length}`);
    for (const policy of config.access_policies) {
      const appId = accessAppIdMap[policy.app_name];
      if (!appId) {
        failed++;
        console.log(`    ❌ Access Policy "${policy.name}": no app found for "${policy.app_name}"`);
        continue;
      }
      const result = await cfRequest('POST', `/accounts/${accountId}/access/apps/${appId}/policies`, {
        name: policy.name,
        decision: policy.decision || 'allow',
        include: policy.include || [],
        exclude: policy.exclude || [],
        require: policy.require || [],
        precedence: policy.precedence || 1,
      });
      if (result.ok) { created++; if (verbose) console.log(`    ✅ Access Policy: ${policy.name}`); }
      else { failed++; console.log(`    ❌ Access Policy "${policy.name}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 16. KV Namespaces (account-scoped — BEFORE workers so bindings can reference them)
  const kvIdMap = {};
  if (config.kv_namespaces?.length > 0) {
    console.log(`  KV Namespaces: creating ${config.kv_namespaces.length}`);
    for (const kv of config.kv_namespaces) {
      const result = await cfRequest('POST', `/accounts/${accountId}/storage/kv/namespaces`, { title: kv.title });
      if (result.ok) {
        created++;
        if (result.data?.result?.id) kvIdMap[kv.title] = result.data.result.id;
        if (verbose) console.log(`    ✅ KV: ${kv.title} (${result.data?.result?.id})`);
      } else {
        const err = result.data?.errors?.[0]?.message || result.status;
        if (String(err).includes('already exists')) {
          // Look up existing namespace ID
          const listR = await cfRequest('GET', `/accounts/${accountId}/storage/kv/namespaces`);
          const existing = (listR.data?.result || []).find(ns => ns.title === kv.title);
          if (existing) {
            kvIdMap[kv.title] = existing.id;
            if (verbose) console.log(`    ⏭️  KV "${kv.title}" exists (${existing.id})`);
          }
        } else {
          failed++;
          console.log(`    ❌ KV "${kv.title}": ${err}`);
        }
      }
    }
  }

  // 17. D1 Databases (account-scoped)
  if (config.d1_databases?.length > 0) {
    console.log(`  D1 Databases: creating ${config.d1_databases.length}`);
    for (const db of config.d1_databases) {
      const result = await cfRequest('POST', `/accounts/${accountId}/d1/database`, { name: db.name });
      if (result.ok) { created++; if (verbose) console.log(`    ✅ D1: ${db.name}`); }
      else {
        const err = result.data?.errors?.[0]?.message || result.status;
        if (String(err).includes('already exists')) {
          if (verbose) console.log(`    ⏭️  D1 "${db.name}" already exists`);
        } else {
          failed++;
          console.log(`    ❌ D1 "${db.name}": ${err}`);
        }
      }
    }
  }

  // 18. Queues (account-scoped)
  if (config.queues?.length > 0) {
    console.log(`  Queues: creating ${config.queues.length}`);
    for (const q of config.queues) {
      const result = await cfRequest('POST', `/accounts/${accountId}/queues`, { queue_name: q.queue_name });
      if (result.ok) { created++; if (verbose) console.log(`    ✅ Queue: ${q.queue_name}`); }
      else {
        const err = result.data?.errors?.[0]?.message || result.status;
        if (String(err).includes('already exists') || String(err).includes('already taken')) {
          if (verbose) console.log(`    ⏭️  Queue "${q.queue_name}" already exists`);
        } else {
          failed++;
          console.log(`    ❌ Queue "${q.queue_name}": ${err}`);
        }
      }
    }
  }

  // 18a-bis. Vectorize indexes (account-scoped — BEFORE workers so bindings resolve)
  if (config.vectorize_indexes?.length > 0) {
    console.log(`  Vectorize indexes: creating ${config.vectorize_indexes.length}`);
    for (const idx of config.vectorize_indexes) {
      const result = await cfRequest('POST', `/accounts/${accountId}/vectorize/v2/indexes`, idx);
      if (result.ok) { created++; if (verbose) console.log(`    ✅ Vectorize: ${idx.name}`); }
      else {
        const err = result.data?.errors?.[0]?.message || result.status;
        if (String(err).toLowerCase().includes('exists') || String(err).toLowerCase().includes('already')) {
          if (verbose) console.log(`    ⏭️  Vectorize "${idx.name}" already exists`);
        } else {
          // Vectorize requires entitlement on some plans — log but don't fatally fail
          if (verbose) console.log(`    ⚠️  Vectorize "${idx.name}": ${err}`);
        }
      }
    }
  }

  // 18a-tris. Dispatch namespaces (Workers for Platforms)
  if (config.dispatch_namespaces?.length > 0) {
    console.log(`  Dispatch namespaces: creating ${config.dispatch_namespaces.length}`);
    for (const ns of config.dispatch_namespaces) {
      const result = await cfRequest('POST', `/accounts/${accountId}/workers/dispatch/namespaces`, { name: ns.name });
      if (result.ok) { created++; if (verbose) console.log(`    ✅ Dispatch NS: ${ns.name}`); }
      else {
        const err = result.data?.errors?.[0]?.message || result.status;
        if (String(err).toLowerCase().includes('exists') || String(err).toLowerCase().includes('already')) {
          if (verbose) console.log(`    ⏭️  Dispatch NS "${ns.name}" already exists`);
        } else if (verbose) console.log(`    ⚠️  Dispatch NS "${ns.name}": ${err}`);
      }
    }
  }

  // 18a-quater. Pipelines (account-scoped — Workers Platform pipelines)
  if (config.pipelines?.length > 0) {
    console.log(`  Pipelines: creating ${config.pipelines.length}`);
    for (const p of config.pipelines) {
      const result = await cfRequest('POST', `/accounts/${accountId}/pipelines`, p);
      if (result.ok) { created++; if (verbose) console.log(`    ✅ Pipeline: ${p.name}`); }
      else {
        const err = result.data?.errors?.[0]?.message || result.status;
        if (String(err).toLowerCase().includes('exists') || String(err).toLowerCase().includes('already')) {
          if (verbose) console.log(`    ⏭️  Pipeline "${p.name}" already exists`);
        } else if (verbose) console.log(`    ⚠️  Pipeline "${p.name}": ${err}`);
      }
    }
  }

  // 18b. R2 Buckets (account-scoped — BEFORE workers so bindings resolve)
  if (config.r2_buckets?.length > 0) {
    console.log(`  R2 Buckets: creating ${config.r2_buckets.length}`);
    for (const bucket of config.r2_buckets) {
      const result = await cfRequest('POST', `/accounts/${accountId}/r2/buckets`, { name: bucket.name });
      if (result.ok) { created++; if (verbose) console.log(`    ✅ R2 bucket: ${bucket.name}`); }
      else {
        const err = result.data?.errors?.[0]?.message || result.status;
        if (String(err).toLowerCase().includes('exists') || String(err).toLowerCase().includes('owned')) {
          if (verbose) console.log(`    ⏭️  R2 bucket "${bucket.name}" already exists`);
        } else {
          failed++;
          console.log(`    ❌ R2 bucket "${bucket.name}": ${err}`);
        }
      }
    }
  }

  // 18c. KV seed data (account-scoped, after KV namespaces exist)
  if (config.kv_seed_data && typeof config.kv_seed_data === 'object') {
    for (const [kvTitle, kvs] of Object.entries(config.kv_seed_data)) {
      const namespaceId = kvIdMap[kvTitle];
      if (!namespaceId) {
        if (verbose) console.log(`    ⚠️  KV seed: no namespace ID for "${kvTitle}"`);
        continue;
      }
      if (!Array.isArray(kvs) || kvs.length === 0) continue;
      console.log(`  KV seed for "${kvTitle}": ${kvs.length} keys`);
      // Use bulk write API for efficiency
      const bulkBody = kvs.map(kv => ({
        key: kv.key,
        value: typeof kv.value === 'string' ? kv.value : JSON.stringify(kv.value),
        ...(kv.metadata ? { metadata: kv.metadata } : {}),
        ...(kv.expiration_ttl ? { expiration_ttl: kv.expiration_ttl } : {}),
      }));
      const result = await cfRequest('PUT', `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`, bulkBody);
      if (result.ok) { created++; if (verbose) console.log(`    ✅ KV seed wrote ${kvs.length} keys`); }
      else { failed++; console.log(`    ❌ KV seed "${kvTitle}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 18d. R2 seed objects (account-scoped, after R2 buckets exist)
  // R2 PUT object uses the S3-compatible path: /accounts/{aid}/r2/buckets/{name}/objects/{key}
  if (config.r2_seed_objects && typeof config.r2_seed_objects === 'object') {
    for (const [bucketName, objs] of Object.entries(config.r2_seed_objects)) {
      if (!Array.isArray(objs) || objs.length === 0) continue;
      console.log(`  R2 seed for "${bucketName}": ${objs.length} objects`);
      for (const obj of objs) {
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects/${encodeURIComponent(obj.key)}`;
        try {
          const res = await fetch(url, {
            method: 'PUT',
            headers: { ...authHeaders, 'Content-Type': obj.contentType || 'application/octet-stream' },
            body: obj.content ?? '',
          });
          if (res.ok) { created++; if (verbose) console.log(`    ✅ R2 obj: ${obj.key}`); }
          else { failed++; const t = await res.text().catch(()=>''); console.log(`    ❌ R2 obj "${obj.key}": ${res.status} ${t.slice(0,120)}`); }
        } catch (e) {
          failed++;
          console.log(`    ❌ R2 obj "${obj.key}": ${e.message}`);
        }
      }
    }
  }

  // 18e. D1 schema seed (after D1 databases exist)
  if (config.d1_seed_schema && typeof config.d1_seed_schema === 'object') {
    // Resolve D1 database IDs by name (list once)
    const d1List = await cfRequest('GET', `/accounts/${accountId}/d1/database`);
    const d1IdMap = {};
    if (d1List.ok && Array.isArray(d1List.data?.result)) {
      for (const db of d1List.data.result) d1IdMap[db.name] = db.uuid || db.id;
    }
    for (const [dbName, sql] of Object.entries(config.d1_seed_schema)) {
      const dbId = d1IdMap[dbName];
      if (!dbId) {
        if (verbose) console.log(`    ⚠️  D1 seed: no DB ID for "${dbName}"`);
        continue;
      }
      console.log(`  D1 seed for "${dbName}": running schema`);
      const result = await cfRequest('POST', `/accounts/${accountId}/d1/database/${dbId}/query`, { sql });
      if (result.ok) { created++; if (verbose) console.log(`    ✅ D1 seed ran`); }
      else { failed++; console.log(`    ❌ D1 seed "${dbName}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 19. Patch worker bindings: replace __PLACEHOLDER_ID__ with actual KV namespace IDs and D1 DB IDs
  if (config.workers?.length > 0) {
    // Build D1 ID map for binding patching
    const d1List = await cfRequest('GET', `/accounts/${accountId}/d1/database`);
    const d1IdMap = {};
    if (d1List.ok && Array.isArray(d1List.data?.result)) {
      for (const db of d1List.data.result) d1IdMap[db.name] = db.uuid || db.id;
    }

    for (const worker of config.workers) {
      for (const binding of (worker.bindings || [])) {
        if (binding.type === 'kv_namespace' && binding.namespace_id?.startsWith('__')) {
          const kvTitle = (config.kv_namespaces || []).find(kv => {
            const placeholder = `__${kv.title.toUpperCase().replace(/-/g, '_')}_ID__`;
            return binding.namespace_id === placeholder;
          })?.title;
          if (kvTitle && kvIdMap[kvTitle]) {
            binding.namespace_id = kvIdMap[kvTitle];
            if (verbose) console.log(`    🔗 Patched KV binding ${binding.name} → ${kvIdMap[kvTitle]}`);
          }
        }
        if (binding.type === 'd1' && binding.database_id?.startsWith('__')) {
          const dbName = (config.d1_databases || []).find(db => {
            const placeholder = `__${db.name.toUpperCase().replace(/-/g, '_')}_ID__`;
            return binding.database_id === placeholder;
          })?.name;
          if (dbName && d1IdMap[dbName]) {
            binding.database_id = d1IdMap[dbName];
            if (verbose) console.log(`    🔗 Patched D1 binding ${binding.name} → ${d1IdMap[dbName]}`);
          }
        }
      }
    }
  }

  // 20. Workers (multipart upload — AFTER storage resources so bindings resolve)
  // Topologically sort: workers that are targets of a service binding must upload first.
  if (config.workers?.length > 0) {
    console.log(`  Workers: uploading ${config.workers.length}`);
    const allWorkerNames = new Set(config.workers.map(w => w.name));
    const referencedAsService = new Set();
    for (const w of config.workers) {
      for (const b of (w.bindings || [])) {
        if (b.type === 'service' && b.service && allWorkerNames.has(b.service)) {
          referencedAsService.add(b.service);
        }
      }
    }
    const orderedWorkers = [
      ...config.workers.filter(w => referencedAsService.has(w.name)),
      ...config.workers.filter(w => !referencedAsService.has(w.name)),
    ];
    for (const worker of orderedWorkers) {
      const script = worker.script || '';
      const isModules = worker.format === 'modules';
      const mainModule = worker.main_module || 'worker.js';
      const bindings = worker.bindings || [];

      // Build metadata — include migrations for DO bindings. Mirror the
      // product upload path (src/api.ts): prefer `new_sqlite_classes` (works on
      // BOTH free and paid Workers plans), fall back to `new_classes`
      // (KV-backed DOs, paid-only) if sqlite is rejected, then drop migrations
      // entirely if the class already exists on the account. Using
      // `new_classes`-only here meant DO-bearing workers silently failed to
      // seed a new class on a free-plan source account.
      const doBindings = bindings.filter(b => b.type === 'durable_object_namespace');
      const buildMetadata = (doMigration) => {
        const metadata = isModules
          ? { main_module: mainModule, bindings }
          : { body_part: 'script', bindings };
        if (doMigration !== 'none' && doBindings.length > 0) {
          metadata.migrations = {
            tag: 'v1',
            [doMigration]: doBindings.map(b => b.class_name),
          };
        }
        return metadata;
      };
      const buildForm = (doMigration) => {
        const form = new FormData();
        if (isModules) {
          form.append(mainModule, new Blob([script], { type: 'application/javascript+module' }), mainModule);
        } else {
          form.append('script', new Blob([script], { type: 'application/javascript' }), 'script');
        }
        form.append('metadata', JSON.stringify(buildMetadata(doMigration)));
        return form;
      };

      try {
        // sqlite-first → new_classes → none, capped at 3 attempts.
        let doMigration = doBindings.length > 0 ? 'new_sqlite_classes' : 'none';
        let res;
        let errText = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker.name}`, {
            method: 'PUT',
            headers: authHeaders,
            body: buildForm(doMigration),
          });
          if (res.ok) break;
          errText = await res.text();
          if (doMigration === 'new_sqlite_classes' && (errText.includes('new_classes') || errText.includes('migration'))) {
            if (verbose) console.log(`    🔄 new_sqlite_classes rejected, retrying with new_classes`);
            doMigration = 'new_classes';
            continue;
          }
          if (doMigration !== 'none' && (errText.includes('already depended on') || errText.includes('already exists'))) {
            if (verbose) console.log(`    🔄 DO class already exists, retrying without migrations`);
            doMigration = 'none';
            continue;
          }
          break; // non-recoverable error
        }
        if (res.ok) { created++; if (verbose) console.log(`    ✅ Worker: ${worker.name}`); }
        else {
          failed++;
          console.log(`    ❌ Worker "${worker.name}": ${errText}`);
        }
      } catch (err) {
        failed++;
        console.log(`    ❌ Worker "${worker.name}": ${err.message}`);
      }
    }
  }

  // 20b. Worker Secrets (after worker upload)
  if (config.worker_secrets && typeof config.worker_secrets === 'object') {
    for (const [workerName, secrets] of Object.entries(config.worker_secrets)) {
      if (!secrets || typeof secrets !== 'object') continue;
      const entries = Object.entries(secrets);
      if (entries.length === 0) continue;
      console.log(`  Worker secrets for "${workerName}": ${entries.length}`);
      for (const [name, value] of entries) {
        const result = await cfRequest('PUT', `/accounts/${accountId}/workers/scripts/${workerName}/secrets`, {
          name,
          text: value,
          type: 'secret_text',
        });
        if (result.ok) { created++; if (verbose) console.log(`    ✅ Secret: ${name}`); }
        else { failed++; console.log(`    ❌ Secret "${name}" on "${workerName}": ${result.data?.errors?.[0]?.message || result.status}`); }
      }
    }
  }

  // 21. Worker Routes (zone-level — AFTER workers exist)
  if (config.worker_routes?.length > 0) {
    console.log(`  Worker Routes: creating ${config.worker_routes.length}`);
    for (const route of config.worker_routes) {
      const result = await cfRequest('POST', '/zones/{zone_id}/workers/routes', {
        pattern: route.pattern,
        script: route.script,
      });
      if (result.ok) { created++; if (verbose) console.log(`    ✅ Worker Route: ${route.pattern}`); }
      else { failed++; console.log(`    ❌ Worker Route "${route.pattern}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 22. Worker Custom Domains (account-level — AFTER worker + DNS proxy record exists)
  if (config.worker_custom_domains?.length > 0) {
    console.log(`  Worker Custom Domains: creating ${config.worker_custom_domains.length}`);
    for (const cd of config.worker_custom_domains) {
      const result = await cfRequest('PUT', `/accounts/${accountId}/workers/domains`, {
        hostname: cd.hostname,
        service: cd.service,
        zone_id: zoneId,
        environment: cd.environment || 'production',
      });
      if (result.ok) { created++; if (verbose) console.log(`    ✅ Worker Custom Domain: ${cd.hostname}`); }
      else { failed++; console.log(`    ❌ Worker Custom Domain "${cd.hostname}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 23. LB Monitors (account-scoped) — before pools
  const monitorIdMap = {};
  if (config.lb_monitors?.length > 0) {
    console.log(`  LB Monitors: creating ${config.lb_monitors.length}`);
    for (const monitor of config.lb_monitors) {
      const result = await cfRequest('POST', `/accounts/${accountId}/load_balancers/monitors`, monitor);
      if (result.ok) {
        created++;
        if (result.data?.result?.id) monitorIdMap[monitor.name] = result.data.result.id;
        if (verbose) console.log(`    ✅ Monitor: ${monitor.name} (${result.data?.result?.id})`);
      } else { failed++; console.log(`    ❌ Monitor "${monitor.name}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 24. LB Pools (account-scoped) — references monitors by ID
  const poolIdMap = {};
  if (config.lb_pools?.length > 0) {
    console.log(`  LB Pools: creating ${config.lb_pools.length}`);
    for (const pool of config.lb_pools) {
      const body = { ...pool };
      if (pool.monitor_name && monitorIdMap[pool.monitor_name]) {
        body.monitor = monitorIdMap[pool.monitor_name];
      }
      delete body.monitor_name;
      const result = await cfRequest('POST', `/accounts/${accountId}/load_balancers/pools`, body);
      if (result.ok) {
        created++;
        if (result.data?.result?.id) poolIdMap[pool.name] = result.data.result.id;
        if (verbose) console.log(`    ✅ Pool: ${pool.name} (${result.data?.result?.id})`);
      } else { failed++; console.log(`    ❌ Pool "${pool.name}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 25. Load Balancers (zone-scoped) — references pools by ID
  if (config.load_balancers?.length > 0) {
    console.log(`  Load Balancers: creating ${config.load_balancers.length}`);
    for (const lb of config.load_balancers) {
      const body = { ...lb };
      if (Array.isArray(lb.default_pool_names)) {
        body.default_pools = lb.default_pool_names.map(n => poolIdMap[n]).filter(Boolean);
      }
      if (lb.fallback_pool_name && poolIdMap[lb.fallback_pool_name]) {
        body.fallback_pool = poolIdMap[lb.fallback_pool_name];
      }
      delete body.default_pool_names;
      delete body.fallback_pool_name;
      const result = await cfRequest('POST', `/zones/${zoneId}/load_balancers`, body);
      if (result.ok) { created++; if (verbose) console.log(`    ✅ LB: ${lb.name}`); }
      else { failed++; console.log(`    ❌ LB "${lb.name}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 26. Spectrum Apps (zone-scoped)
  if (config.spectrum_apps?.length > 0) {
    console.log(`  Spectrum Apps: creating ${config.spectrum_apps.length}`);
    for (const app of config.spectrum_apps) {
      const result = await cfRequest('POST', `/zones/${zoneId}/spectrum/apps`, app);
      if (result.ok) { created++; if (verbose) console.log(`    ✅ Spectrum: ${app.dns?.name}`); }
      else { failed++; console.log(`    ❌ Spectrum "${app.dns?.name}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 27. Managed Headers (zone-scoped)
  if (config.managed_headers && typeof config.managed_headers === 'object') {
    const result = await cfRequest('PUT', `/zones/${zoneId}/managed_headers`, config.managed_headers);
    if (result.ok) { created++; if (verbose) console.log(`    ✅ Managed Headers`); }
    else { failed++; if (verbose) console.log(`    ⚠️  Managed Headers: ${result.data?.errors?.[0]?.message || result.status}`); }
  }

  // 28. Cloud Connector rules (zone-scoped)
  if (config.cloud_connector_rules?.length > 0) {
    const result = await cfRequest('PUT', `/zones/${zoneId}/cloud_connector/rules`, config.cloud_connector_rules);
    if (result.ok) { created++; if (verbose) console.log(`    ✅ Cloud Connector rules: ${config.cloud_connector_rules.length}`); }
    else { failed++; if (verbose) console.log(`    ⚠️  Cloud Connector: ${result.data?.errors?.[0]?.message || result.status}`); }
  }

  // 29. URL Normalization (zone-scoped, single object)
  if (config.url_normalization && typeof config.url_normalization === 'object') {
    const result = await cfRequest('PUT', `/zones/${zoneId}/url_normalization`, config.url_normalization);
    if (result.ok) { created++; if (verbose) console.log(`    ✅ URL Normalization`); }
    else { failed++; if (verbose) console.log(`    ⚠️  URL Normalization: ${result.data?.errors?.[0]?.message || result.status}`); }
  }

  // 30. Cache Reserve (zone-scoped, single boolean wrapped in {value})
  if (config.cache_reserve && typeof config.cache_reserve === 'object') {
    const result = await cfRequest('PATCH', `/zones/${zoneId}/cache/cache_reserve`, config.cache_reserve);
    if (result.ok) { created++; if (verbose) console.log(`    ✅ Cache Reserve`); }
    else { failed++; if (verbose) console.log(`    ⚠️  Cache Reserve: ${result.data?.errors?.[0]?.message || result.status}`); }
  }

  // 31. Snippets (zone-scoped) — multipart upload, then bind via snippet_rules
  if (config.snippets?.length > 0) {
    console.log(`  Snippets: uploading ${config.snippets.length}`);
    for (const snip of config.snippets) {
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({ main_module: `${snip.snippet_name}.js` }));
      formData.append(`${snip.snippet_name}.js`, new Blob([snip.snippet_code], { type: 'application/javascript+module' }), `${snip.snippet_name}.js`);
      try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/snippets/${snip.snippet_name}`, {
          method: 'PUT',
          headers: authHeaders,
          body: formData,
        });
        if (res.ok) { created++; if (verbose) console.log(`    ✅ Snippet: ${snip.snippet_name}`); }
        else { failed++; const t = await res.text().catch(()=>''); console.log(`    ❌ Snippet "${snip.snippet_name}": ${res.status} ${t.slice(0,200)}`); }
      } catch (e) {
        failed++;
        console.log(`    ❌ Snippet "${snip.snippet_name}": ${e.message}`);
      }
    }
  }

  // 32. Snippet rules
  if (config.snippet_rules?.length > 0) {
    const result = await cfRequest('PUT', `/zones/${zoneId}/snippets/snippet_rules`, { rules: config.snippet_rules });
    if (result.ok) { created++; if (verbose) console.log(`    ✅ Snippet rules: ${config.snippet_rules.length}`); }
    else { failed++; if (verbose) console.log(`    ⚠️  Snippet rules: ${result.data?.errors?.[0]?.message || result.status}`); }
  }

  // 33. Healthchecks (zone-scoped, standalone — not LB)
  if (config.healthchecks?.length > 0) {
    console.log(`  Healthchecks: creating ${config.healthchecks.length}`);
    for (const hc of config.healthchecks) {
      const result = await cfRequest('POST', `/zones/${zoneId}/healthchecks`, hc);
      if (result.ok) { created++; if (verbose) console.log(`    ✅ Healthcheck: ${hc.name}`); }
      else { failed++; console.log(`    ❌ Healthcheck "${hc.name}": ${result.data?.errors?.[0]?.message || result.status}`); }
    }
  }

  // 34. DNS Settings (PATCH)
  if (config.dns_settings && typeof config.dns_settings === 'object') {
    const r = await cfRequest('PATCH', `/zones/${zoneId}/dns_settings`, config.dns_settings);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ DNS Settings`); }
    else { failed++; if (verbose) console.log(`    ⚠️  DNS Settings: ${r.data?.errors?.[0]?.message || r.status}`); }
  }

  // 35. Regional Tiered Cache
  if (config.regional_tiered_cache) {
    const r = await cfRequest('PATCH', `/zones/${zoneId}/cache/regional_tiered_cache`, { value: config.regional_tiered_cache });
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Regional Tiered Cache: ${config.regional_tiered_cache}`); }
    else { failed++; if (verbose) console.log(`    ⚠️  Regional Tiered Cache: ${r.data?.errors?.[0]?.message || r.status}`); }
  }

  // 36. Origin Post-Quantum Encryption
  if (config.origin_post_quantum_encryption) {
    const r = await cfRequest('PUT', `/zones/${zoneId}/cache/origin_post_quantum_encryption`, { value: config.origin_post_quantum_encryption });
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Origin PostQuantum: ${config.origin_post_quantum_encryption}`); }
    else { failed++; if (verbose) console.log(`    ⚠️  Origin PostQuantum: ${r.data?.errors?.[0]?.message || r.status}`); }
  }

  // 37. Firewall Access Rules (IP allow/block)
  if (config.firewall_access_rules?.length > 0) {
    console.log(`  Firewall Access Rules: creating ${config.firewall_access_rules.length}`);
    for (const rule of config.firewall_access_rules) {
      const r = await cfRequest('POST', `/zones/${zoneId}/firewall/access_rules/rules`, rule);
      if (r.ok) created++;
      else { failed++; if (verbose) console.log(`    ⚠️  Access rule: ${r.data?.errors?.[0]?.message || r.status}`); }
    }
  }

  // 38. Firewall Lockdowns
  if (config.firewall_lockdowns?.length > 0) {
    console.log(`  Firewall Lockdowns: creating ${config.firewall_lockdowns.length}`);
    for (const lock of config.firewall_lockdowns) {
      const r = await cfRequest('POST', `/zones/${zoneId}/firewall/lockdowns`, lock);
      if (r.ok) created++;
      else { failed++; if (verbose) console.log(`    ⚠️  Lockdown: ${r.data?.errors?.[0]?.message || r.status}`); }
    }
  }

  // 39. UA Rules
  if (config.ua_rules?.length > 0) {
    console.log(`  UA Rules: creating ${config.ua_rules.length}`);
    for (const rule of config.ua_rules) {
      const r = await cfRequest('POST', `/zones/${zoneId}/firewall/ua_rules`, rule);
      if (r.ok) created++;
      else { failed++; if (verbose) console.log(`    ⚠️  UA rule: ${r.data?.errors?.[0]?.message || r.status}`); }
    }
  }

  // 40. Page Shield settings + policies
  if (config.page_shield && typeof config.page_shield === 'object') {
    const r = await cfRequest('PUT', `/zones/${zoneId}/page_shield`, config.page_shield);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Page Shield Settings`); }
    else { failed++; if (verbose) console.log(`    ⚠️  Page Shield: ${r.data?.errors?.[0]?.message || r.status}`); }
  }
  if (config.page_shield_policies?.length > 0) {
    console.log(`  Page Shield Policies: creating ${config.page_shield_policies.length}`);
    for (const policy of config.page_shield_policies) {
      const r = await cfRequest('POST', `/zones/${zoneId}/page_shield/policies`, policy);
      if (r.ok) created++;
      else { failed++; if (verbose) console.log(`    ⚠️  Page Shield policy: ${r.data?.errors?.[0]?.message || r.status}`); }
    }
  }

  // 41. Schema Validation
  if (config.schema_validation_schemas?.length > 0) {
    console.log(`  Schema Validation Schemas: creating ${config.schema_validation_schemas.length}`);
    for (const schema of config.schema_validation_schemas) {
      const r = await cfRequest('POST', `/zones/${zoneId}/schema_validation/schemas`, schema);
      if (r.ok) created++;
      else { failed++; if (verbose) console.log(`    ⚠️  Schema: ${r.data?.errors?.[0]?.message || r.status}`); }
    }
  }
  if (config.schema_validation_settings) {
    const r = await cfRequest('PUT', `/zones/${zoneId}/schema_validation/settings`, config.schema_validation_settings);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Schema Validation Settings`); }
    else { failed++; if (verbose) console.log(`    ⚠️  Schema Validation Settings: ${r.data?.errors?.[0]?.message || r.status}`); }
  }

  // 42. Token Validation
  if (config.token_validation_configs?.length > 0) {
    console.log(`  Token Validation Configs: creating ${config.token_validation_configs.length}`);
    for (const cfg of config.token_validation_configs) {
      const r = await cfRequest('POST', `/zones/${zoneId}/token_validation/config`, cfg);
      if (r.ok) created++;
      else { failed++; if (verbose) console.log(`    ⚠️  Token config: ${r.data?.errors?.[0]?.message || r.status}`); }
    }
  }

  // 43. Logpush jobs
  if (config.logpush_jobs?.length > 0) {
    console.log(`  Logpush Jobs: creating ${config.logpush_jobs.length}`);
    for (const job of config.logpush_jobs) {
      const r = await cfRequest('POST', `/zones/${zoneId}/logpush/jobs`, job);
      if (r.ok) created++;
      else { failed++; if (verbose) console.log(`    ⚠️  Logpush job: ${r.data?.errors?.[0]?.message || r.status}`); }
    }
  }

  // 44. Access Groups (account-scoped)
  const accessGroupIdMap = {};
  if (config.access_groups?.length > 0) {
    console.log(`  Access Groups: creating ${config.access_groups.length}`);
    for (const group of config.access_groups) {
      const r = await cfRequest('POST', `/accounts/${accountId}/access/groups`, group);
      if (r.ok) {
        created++;
        if (r.data?.result?.id) accessGroupIdMap[group.name] = r.data.result.id;
      } else { failed++; if (verbose) console.log(`    ⚠️  Access group "${group.name}": ${r.data?.errors?.[0]?.message || r.status}`); }
    }
  }

  // 45. Custom Lists (account-scoped) + items
  const customListIdMap = {};
  if (config.custom_lists?.length > 0) {
    console.log(`  Custom Lists: creating ${config.custom_lists.length}`);
    for (const list of config.custom_lists) {
      const r = await cfRequest('POST', `/accounts/${accountId}/rules/lists`, list);
      if (r.ok) {
        created++;
        if (r.data?.result?.id) customListIdMap[list.name] = r.data.result.id;
      } else { failed++; if (verbose) console.log(`    ⚠️  Custom list "${list.name}": ${r.data?.errors?.[0]?.message || r.status}`); }
    }
  }
  if (config.custom_list_items && typeof config.custom_list_items === 'object') {
    for (const [listName, items] of Object.entries(config.custom_list_items)) {
      const listId = customListIdMap[listName];
      if (!listId || !Array.isArray(items) || items.length === 0) continue;
      const r = await cfRequest('POST', `/accounts/${accountId}/rules/lists/${listId}/items`, items);
      if (r.ok) { created++; if (verbose) console.log(`    ✅ Custom List items: ${listName} (+${items.length})`); }
      else { failed++; if (verbose) console.log(`    ⚠️  Custom list items "${listName}": ${r.data?.errors?.[0]?.message || r.status}`); }
    }
  }

  // 46. Queue consumers (per-queue, after queues created and workers uploaded)
  if (config.queue_consumers && typeof config.queue_consumers === 'object') {
    // Look up dest queue IDs by name
    const qList = await cfRequest('GET', `/accounts/${accountId}/queues`);
    const queueIdMap = {};
    if (qList.ok && Array.isArray(qList.data?.result)) {
      for (const q of qList.data.result) queueIdMap[q.queue_name] = q.queue_id;
    }
    for (const [queueName, consumers] of Object.entries(config.queue_consumers)) {
      const queueId = queueIdMap[queueName];
      if (!queueId || !Array.isArray(consumers)) continue;
      for (const consumer of consumers) {
        const r = await cfRequest('POST', `/accounts/${accountId}/queues/${queueId}/consumers`, consumer);
        if (r.ok) { created++; if (verbose) console.log(`    ✅ Queue consumer: ${queueName} → ${consumer.script_name}`); }
        else { failed++; if (verbose) console.log(`    ⚠️  Queue consumer "${queueName}": ${r.data?.errors?.[0]?.message || r.status}`); }
      }
    }
  }

  // ── 2026-05-26 Principle 7 audit — newer features ────────────────
  // Each block treats entitlement-not-available as non-fatal so the
  // omnibus test still runs on free/basic accounts. Errors that look
  // like "not enabled", "not entitled", "subscription required", or
  // 403/404 are logged as ⚠️ and skipped without bumping `failed`.
  const ENTITLEMENT_RE = /not enabled|not entitled|not available|subscription required|requires.*plan|forbidden|404|access denied/i;

  // 47. Custom Hostname Fallback Origin (SaaS feature)
  if (config.custom_hostname_fallback_origin?.origin) {
    const r = await cfRequest('PUT', `/zones/${zoneId}/custom_hostnames/fallback_origin`, { origin: config.custom_hostname_fallback_origin.origin });
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Custom Hostname Fallback Origin: ${config.custom_hostname_fallback_origin.origin}`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Custom Hostname Fallback Origin: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ Custom Hostname Fallback Origin: ${err}`); }
    }
  }

  // 48. AI Security settings (App Sec Advanced)
  if (config.ai_security_settings && typeof config.ai_security_settings === 'object') {
    const r = await cfRequest('PUT', `/zones/${zoneId}/ai-security/settings`, config.ai_security_settings);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ AI Security Settings`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  AI Security Settings: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ AI Security Settings: ${err}`); }
    }
  }
  if (config.ai_security_custom_topics && typeof config.ai_security_custom_topics === 'object') {
    const r = await cfRequest('PUT', `/zones/${zoneId}/ai-security/custom-topics`, config.ai_security_custom_topics);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ AI Security Custom Topics`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  AI Security Custom Topics: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ AI Security Custom Topics: ${err}`); }
    }
  }

  // 49. Workers Observability destinations + queries (account-scoped)
  if (Array.isArray(config.workers_observability_destinations) && config.workers_observability_destinations.length > 0) {
    for (const dest of config.workers_observability_destinations) {
      const r = await cfRequest('POST', `/accounts/${accountId}/workers/observability/destinations`, dest);
      if (r.ok) { created++; if (verbose) console.log(`    ✅ Workers Observability Destination: ${dest.name}`); }
      else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Workers Observability Destination "${dest.name}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ Workers Observability Destination "${dest.name}": ${err}`); }
      }
    }
  }
  if (Array.isArray(config.workers_observability_queries) && config.workers_observability_queries.length > 0) {
    for (const q of config.workers_observability_queries) {
      const r = await cfRequest('POST', `/accounts/${accountId}/workers/observability/queries`, q);
      if (r.ok) { created++; if (verbose) console.log(`    ✅ Workers Observability Query: ${q.name}`); }
      else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Workers Observability Query "${q.name}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ Workers Observability Query "${q.name}": ${err}`); }
      }
    }
  }

  // 50. Waiting Room zone-level settings (Business+)
  if (config.waiting_room_settings && typeof config.waiting_room_settings === 'object') {
    const r = await cfRequest('PUT', `/zones/${zoneId}/waiting_rooms/settings`, config.waiting_room_settings);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Waiting Room Settings`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Waiting Room Settings: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ Waiting Room Settings: ${err}`); }
    }
  }

  // 51. Content Upload Scan settings (App Sec Advanced)
  if (config.content_upload_scan_settings && typeof config.content_upload_scan_settings === 'object') {
    const { _comment: _c, ...body } = config.content_upload_scan_settings;
    const r = await cfRequest('PUT', `/zones/${zoneId}/content-upload-scan/settings`, body);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Content Upload Scan Settings`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Content Upload Scan Settings: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ Content Upload Scan Settings: ${err}`); }
    }
  }

  // 52. Cache Origin Cloud Regions (requires Tiered Cache enabled)
  if (Array.isArray(config.cache_origin_cloud_regions) && config.cache_origin_cloud_regions.length > 0) {
    const r = await cfRequest('PATCH', `/zones/${zoneId}/cache/origin_cloud_regions/batch`, config.cache_origin_cloud_regions);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Cache Origin Cloud Regions: ${config.cache_origin_cloud_regions.length} mappings`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err)) || /tiered cache/i.test(String(err))) console.log(`    ⚠️  Cache Origin Cloud Regions: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ Cache Origin Cloud Regions: ${err}`); }
    }
  }

  // 53. Leaked Credential Checks (status + custom detections)
  if (config.leaked_credential_checks_status && typeof config.leaked_credential_checks_status === 'object') {
    const r = await cfRequest('POST', `/zones/${zoneId}/leaked-credential-checks`, { enabled: !!config.leaked_credential_checks_status.enabled });
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Leaked Credential Checks Status: ${config.leaked_credential_checks_status.enabled ? 'enabled' : 'disabled'}`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Leaked Credential Checks Status: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ Leaked Credential Checks Status: ${err}`); }
    }
  }
  if (Array.isArray(config.leaked_credential_custom_detections) && config.leaked_credential_custom_detections.length > 0) {
    for (const det of config.leaked_credential_custom_detections) {
      const r = await cfRequest('POST', `/zones/${zoneId}/leaked-credential-checks/detections`, { username: det.username, password: det.password });
      if (r.ok) { created++; if (verbose) console.log(`    ✅ Leaked Credential Custom Detection`); }
      else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Leaked Credential Custom Detection: ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ Leaked Credential Custom Detection: ${err}`); }
      }
    }
  }

  // 54. Email Sending Subdomains
  if (Array.isArray(config.email_sending_subdomains) && config.email_sending_subdomains.length > 0) {
    for (const sub of config.email_sending_subdomains) {
      const r = await cfRequest('POST', `/zones/${zoneId}/email/sending/subdomains`, { name: sub.name });
      if (r.ok) { created++; if (verbose) console.log(`    ✅ Email Sending Subdomain: ${sub.name}`); }
      else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Email Sending Subdomain "${sub.name}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ Email Sending Subdomain "${sub.name}": ${err}`); }
      }
    }
  }

  // 55. Web3 Hostnames + IPFS content lists
  if (Array.isArray(config.web3_hostnames) && config.web3_hostnames.length > 0) {
    for (const h of config.web3_hostnames) {
      const createBody = { name: h.name, target: h.target };
      if (h.description) createBody.description = h.description;
      if (h.dnslink) createBody.dnslink = h.dnslink;
      const r = await cfRequest('POST', `/zones/${zoneId}/web3/hostnames`, createBody);
      if (!r.ok) {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Web3 Hostname "${h.name}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ Web3 Hostname "${h.name}": ${err}`); }
        continue;
      }
      created++; if (verbose) console.log(`    ✅ Web3 Hostname: ${h.name}`);
      const hostId = r.data?.result?.id;
      if (hostId && h.target === 'ipfs_universal_path' && h.content_list?.entries?.length > 0) {
        const listBody = {
          action: h.content_list.action || 'block',
          entries: h.content_list.entries.map(e => ({ content: e.content, type: e.type, description: e.description })),
        };
        const listR = await cfRequest('PUT', `/zones/${zoneId}/web3/hostnames/${hostId}/ipfs_universal_path/content_list`, listBody);
        if (listR.ok) { created++; if (verbose) console.log(`    ✅ Web3 Content List: ${h.name} (${listBody.entries.length} entries)`); }
        else { failed++; console.log(`    ❌ Web3 Content List "${h.name}": ${listR.data?.errors?.[0]?.message || listR.status}`); }
      }
    }
  }

  // 56. Secondary DNS (account ACLs/TSIGs/peers + zone incoming/outgoing).
  // TSIG secrets are write-only — seeded with a placeholder so the
  // structural test passes; the real migration prompts the user.
  const tsigIdMap = {};
  const secondaryPeerIdMap = {};
  if (Array.isArray(config.secondary_dns_acls) && config.secondary_dns_acls.length > 0) {
    for (const acl of config.secondary_dns_acls) {
      const r = await cfRequest('POST', `/accounts/${accountId}/secondary_dns/acls`, { name: acl.name, ip_range: acl.ip_range });
      if (r.ok) { created++; if (verbose) console.log(`    ✅ Secondary DNS ACL: ${acl.name}`); }
      else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Secondary DNS ACL "${acl.name}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ Secondary DNS ACL "${acl.name}": ${err}`); }
      }
    }
  }
  if (Array.isArray(config.secondary_dns_tsigs) && config.secondary_dns_tsigs.length > 0) {
    for (const tsig of config.secondary_dns_tsigs) {
      // Seed with a placeholder secret; the real one is supplied at
      // migrate time via MigrationConfig.tsigSecrets.
      const placeholderSecret = 'seed-placeholder-tsig-secret-base64-encoded-here==';
      const r = await cfRequest('POST', `/accounts/${accountId}/secondary_dns/tsigs`, { name: tsig.name, algo: tsig.algo, secret: placeholderSecret });
      if (r.ok) {
        created++;
        if (r.data?.result?.id) tsigIdMap[tsig.name] = r.data.result.id;
        if (verbose) console.log(`    ✅ Secondary DNS TSIG: ${tsig.name}`);
      } else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Secondary DNS TSIG "${tsig.name}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ Secondary DNS TSIG "${tsig.name}": ${err}`); }
      }
    }
  }
  if (Array.isArray(config.secondary_dns_peers) && config.secondary_dns_peers.length > 0) {
    for (const peer of config.secondary_dns_peers) {
      const body = { name: peer.name };
      if (peer.ip !== undefined) body.ip = peer.ip;
      if (peer.port !== undefined) body.port = peer.port;
      if (peer.ixfr_enable !== undefined) body.ixfr_enable = peer.ixfr_enable;
      if (peer._tsig_name_ref && tsigIdMap[peer._tsig_name_ref]) body.tsig_id = tsigIdMap[peer._tsig_name_ref];
      const r = await cfRequest('POST', `/accounts/${accountId}/secondary_dns/peers`, body);
      if (r.ok) {
        created++;
        if (r.data?.result?.id) secondaryPeerIdMap[peer.name] = r.data.result.id;
        if (verbose) console.log(`    ✅ Secondary DNS Peer: ${peer.name}`);
      } else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Secondary DNS Peer "${peer.name}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ Secondary DNS Peer "${peer.name}": ${err}`); }
      }
    }
  }
  if (config.secondary_dns_incoming && typeof config.secondary_dns_incoming === 'object') {
    const body = {};
    if (config.secondary_dns_incoming.name !== undefined) body.name = config.secondary_dns_incoming.name;
    if (config.secondary_dns_incoming.auto_refresh_seconds !== undefined) body.auto_refresh_seconds = config.secondary_dns_incoming.auto_refresh_seconds;
    if (Array.isArray(config.secondary_dns_incoming._peer_names)) {
      body.peers = config.secondary_dns_incoming._peer_names.map(n => secondaryPeerIdMap[n]).filter(Boolean);
    }
    const r = await cfRequest('POST', `/zones/${zoneId}/secondary_dns/incoming`, body);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Secondary DNS Incoming`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Secondary DNS Incoming: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ Secondary DNS Incoming: ${err}`); }
    }
  }
  if (config.secondary_dns_outgoing && typeof config.secondary_dns_outgoing === 'object') {
    const body = {};
    if (config.secondary_dns_outgoing.name !== undefined) body.name = config.secondary_dns_outgoing.name;
    if (Array.isArray(config.secondary_dns_outgoing._peer_names)) {
      body.peers = config.secondary_dns_outgoing._peer_names.map(n => secondaryPeerIdMap[n]).filter(Boolean);
    }
    const r = await cfRequest('POST', `/zones/${zoneId}/secondary_dns/outgoing`, body);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Secondary DNS Outgoing`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Secondary DNS Outgoing: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ Secondary DNS Outgoing: ${err}`); }
    }
  }

  // 57. LB Monitor Groups (depends on lb_monitors above for monitor IDs)
  if (Array.isArray(config.lb_monitor_groups) && config.lb_monitor_groups.length > 0) {
    for (const grp of config.lb_monitor_groups) {
      const members = (grp._member_names || []).map(n => monitorIdMap[n]).filter(Boolean).map(id => ({ monitor_id: id, enabled: true, monitoring_only: false, must_be_healthy: true }));
      const body = { description: grp.description, members };
      const r = await cfRequest('POST', `/accounts/${accountId}/load_balancers/monitor_groups`, body);
      if (r.ok) { created++; if (verbose) console.log(`    ✅ LB Monitor Group: ${grp.description}`); }
      else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  LB Monitor Group "${grp.description}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ LB Monitor Group "${grp.description}": ${err}`); }
      }
    }
  }

  // 58. Hyperdrive configs (Workers Paid)
  if (Array.isArray(config.hyperdrive_configs) && config.hyperdrive_configs.length > 0) {
    for (const hc of config.hyperdrive_configs) {
      const body = { name: hc.name, origin: hc.origin };
      if (hc.caching) body.caching = hc.caching;
      if (hc.mtls) body.mtls = hc.mtls;
      if (hc.origin_connection_limit !== undefined) body.origin_connection_limit = hc.origin_connection_limit;
      const r = await cfRequest('POST', `/accounts/${accountId}/hyperdrive/configs`, body);
      if (r.ok) { created++; if (verbose) console.log(`    ✅ Hyperdrive: ${hc.name}`); }
      else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Hyperdrive "${hc.name}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ Hyperdrive "${hc.name}": ${err}`); }
      }
    }
  }

  // 59. Secrets Store stores (Free)
  if (Array.isArray(config.secrets_store_stores) && config.secrets_store_stores.length > 0) {
    for (const s of config.secrets_store_stores) {
      const r = await cfRequest('POST', `/accounts/${accountId}/secrets_store/stores`, { name: s.name });
      if (r.ok) { created++; if (verbose) console.log(`    ✅ Secrets Store: ${s.name}`); }
      else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err)) || /already exists/i.test(String(err))) console.log(`    ⚠️  Secrets Store "${s.name}": ${err} (skipped)`);
        else { failed++; console.log(`    ❌ Secrets Store "${s.name}": ${err}`); }
      }
    }
  }

  // ── 2026-05-26 21-gap-closure features ──────────────────────────

  // 60. Custom Nameservers metadata (per-zone {enabled, ns_set} singleton)
  if (config.custom_nameservers_metadata && (config.custom_nameservers_metadata.enabled !== undefined || config.custom_nameservers_metadata.ns_set !== undefined)) {
    const { _comment: _c, ...body } = config.custom_nameservers_metadata;
    const r = await cfRequest('PUT', `/zones/${zoneId}/custom_ns`, body);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Custom Nameservers Metadata`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Custom Nameservers Metadata: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ Custom Nameservers Metadata: ${err}`); }
    }
  }

  // 61. Pay-per-Crawl configuration (singleton)
  if (config.pay_per_crawl_configuration && typeof config.pay_per_crawl_configuration === 'object') {
    const { _comment: _c, ...body } = config.pay_per_crawl_configuration;
    const r = await cfRequest('POST', `/zones/${zoneId}/pay-per-crawl/configuration`, body);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ Pay-per-Crawl Configuration`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Pay-per-Crawl Configuration: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ Pay-per-Crawl Configuration: ${err}`); }
    }
  }

  // 62. Waiting Room per-room rules. Look up dest room IDs by name from
  // the rooms created earlier in this run.
  if (Array.isArray(config.waiting_room_rules) && config.waiting_room_rules.length > 0) {
    const wrList = await cfRequest('GET', `/zones/${zoneId}/waiting_rooms`);
    const roomIdByName = {};
    if (wrList.ok && Array.isArray(wrList.data?.result)) {
      for (const room of wrList.data.result) if (room.name) roomIdByName[room.name] = room.id;
    }
    for (const r of config.waiting_room_rules) {
      const roomId = roomIdByName[r.roomName];
      if (!roomId) { if (verbose) console.log(`    ⏭ Waiting Room rules for '${r.roomName}': room not found, skipped`); continue; }
      const body = r.rules.map(rule => ({
        action: rule.action, expression: rule.expression,
        description: rule.description, enabled: rule.enabled !== false,
      }));
      const res = await cfRequest('PUT', `/zones/${zoneId}/waiting_rooms/${roomId}/rules`, body);
      if (res.ok) { created++; if (verbose) console.log(`    ✅ Waiting Room Rules: ${r.roomName} (${body.length} rules)`); }
      else {
        const err = res.data?.errors?.[0]?.message || res.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  Waiting Room Rules "${r.roomName}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ Waiting Room Rules "${r.roomName}": ${err}`); }
      }
    }
  }

  // 63. AI Gateway Custom Provider Costs (account-scoped list)
  if (Array.isArray(config.ai_gateway_custom_provider_costs) && config.ai_gateway_custom_provider_costs.length > 0) {
    for (const cost of config.ai_gateway_custom_provider_costs) {
      const r = await cfRequest('POST', `/accounts/${accountId}/ai-gateway/custom-providers/costs`, cost);
      if (r.ok) { created++; if (verbose) console.log(`    ✅ AI Gateway Custom Provider Cost: ${cost.name || cost.model}`); }
      else {
        const err = r.data?.errors?.[0]?.message || r.status;
        if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  AI Gateway Provider Cost "${cost.name || cost.model}": ${err} (entitlement gap, skipped)`);
        else { failed++; console.log(`    ❌ AI Gateway Provider Cost "${cost.name || cost.model}": ${err}`); }
      }
    }
  }

  // 64. AI Gateway per-gateway provider configs
  if (Array.isArray(config.ai_gateway_provider_configs) && config.ai_gateway_provider_configs.length > 0) {
    for (const g of config.ai_gateway_provider_configs) {
      if (!g.gatewayId || !Array.isArray(g.configs)) continue;
      for (const cfg of g.configs) {
        const { _comment: _c, ...settings } = cfg.settings || {};
        const body = { provider: cfg.provider, settings };
        const r = await cfRequest('POST', `/accounts/${accountId}/ai-gateway/gateways/${g.gatewayId}/provider_configs`, body);
        if (r.ok) { created++; if (verbose) console.log(`    ✅ AI Gateway Provider Config: ${g.gatewayId}/${cfg.provider}`); }
        else {
          const err = r.data?.errors?.[0]?.message || r.status;
          if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  AI Gateway Provider Config "${g.gatewayId}/${cfg.provider}": ${err} (entitlement gap, skipped)`);
          else { failed++; console.log(`    ❌ AI Gateway Provider Config "${g.gatewayId}/${cfg.provider}": ${err}`); }
        }
      }
    }
  }

  // ── 2026-05-26 API Shield iteration ─────────────────────────────

  // 65. API Shield zone-wide configuration (singleton)
  if (config.api_gateway_configuration && typeof config.api_gateway_configuration === 'object') {
    const body = { auth_id_characteristics: config.api_gateway_configuration.auth_id_characteristics || [] };
    const r = await cfRequest('PUT', `/zones/${zoneId}/api_gateway/configuration`, body);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ API Shield Configuration`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  API Shield Configuration: ${err} (entitlement gap, skipped)`);
      else { failed++; console.log(`    ❌ API Shield Configuration: ${err}`); }
    }
  }

  // 66. API Shield user labels (POST accepts an array)
  if (Array.isArray(config.api_gateway_user_labels) && config.api_gateway_user_labels.length > 0) {
    const body = config.api_gateway_user_labels.map(l => ({
      name: l.name,
      ...(l.description !== undefined && { description: l.description }),
      ...(l.metadata !== undefined && { metadata: l.metadata }),
    }));
    const r = await cfRequest('POST', `/zones/${zoneId}/api_gateway/labels/user`, body);
    if (r.ok) { created++; if (verbose) console.log(`    ✅ API Shield User Labels: ${body.length}`); }
    else {
      const err = r.data?.errors?.[0]?.message || r.status;
      if (ENTITLEMENT_RE.test(String(err)) || /already exists/i.test(String(err))) console.log(`    ⚠️  API Shield User Labels: ${err} (skipped)`);
      else { failed++; console.log(`    ❌ API Shield User Labels: ${err}`); }
    }
  }

  // 67. API Shield per-operation schema validation. Needs operations to
  // exist first; look up operation IDs by method|host|endpoint, then
  // bulk-PATCH. (Operations are seeded earlier via config.api_gateway_*
  // if present; if there are none, this is a no-op.)
  if (Array.isArray(config.api_gateway_operation_schema_validation) && config.api_gateway_operation_schema_validation.length > 0) {
    const opsR = await cfRequest('GET', `/zones/${zoneId}/api_gateway/operations?per_page=50`);
    if (opsR.ok && Array.isArray(opsR.data?.result)) {
      const opIdByKey = {};
      for (const op of opsR.data.result) opIdByKey[`${op.method}|${op.host}|${op.endpoint}`] = op.operation_id;
      const byOpId = {};
      let matched = 0;
      for (const sv of config.api_gateway_operation_schema_validation) {
        const id = opIdByKey[`${sv.method}|${sv.host}|${sv.endpoint}`];
        if (id) { byOpId[id] = { mitigation_action: sv.mitigation_action }; matched++; }
      }
      if (matched > 0) {
        const r = await cfRequest('PATCH', `/zones/${zoneId}/api_gateway/operations/schema_validation`, byOpId);
        if (r.ok) { created++; if (verbose) console.log(`    ✅ API Shield Operation Schema Validation: ${matched} ops`); }
        else {
          const err = r.data?.errors?.[0]?.message || r.status;
          if (ENTITLEMENT_RE.test(String(err))) console.log(`    ⚠️  API Shield Operation Schema Validation: ${err} (entitlement gap, skipped)`);
          else { failed++; console.log(`    ❌ API Shield Operation Schema Validation: ${err}`); }
        }
      } else if (verbose) {
        console.log(`    ⏭ API Shield Operation Schema Validation: no operations matched (seed operations first)`);
      }
    }
  }

  console.log(`\n  ✅ Applied: ${created} created, ${failed} failed\n`);
  return { created, failed };
}

// ── DELETE DEST ZONE ───────────────────────────────────────────

export async function deleteDestZone(domainName, targetAccountId) {
  const targetAuthHeaders = authHeaders; // same key for both accounts

  const { cfRequest: targetCfRequest } = createRateLimitedFetcher({
    authHeaders: targetAuthHeaders,
    rateLimit: 1000,
    windowSec: 300,
    capacity: 20,
    maxRetries: 3,
    verbose,
    pathVars: {},
  });

  // Find the zone in the target account
  const listResult = await targetCfRequest('GET', `/zones?name=${encodeURIComponent(domainName)}&account.id=${targetAccountId}`);
  if (!listResult.ok || !Array.isArray(listResult.data?.result) || listResult.data.result.length === 0) {
    console.log(`  ⚠️  No zone found for "${domainName}" in target account ${targetAccountId}`);
    return false;
  }

  const destZoneId = listResult.data.result[0].id;
  console.log(`  Deleting dest zone ${destZoneId} (${domainName})...`);
  const delResult = await targetCfRequest('DELETE', `/zones/${destZoneId}`);
  if (delResult.ok) {
    console.log(`  ✅ Dest zone deleted`);
    return true;
  } else {
    console.log(`  ❌ Failed to delete dest zone: ${delResult.data?.errors?.[0]?.message || delResult.status}`);
    return false;
  }
}

// ── EXPORTED FUNCTIONS ─────────────────────────────────────────

export { cleanZone, applyConfig, cfRequest, getStats };

// ── CLI ────────────────────────────────────────────────────────

const [,, command, configArg] = process.argv;

if (command === 'clean') {
  await cleanZone();
  const stats = getStats();
  console.log(`📊 Rate limiter: ${stats.totalRequests} requests, ${stats.throttleEvents} throttles, ${(stats.totalWaitMs / 1000).toFixed(1)}s total wait`);
} else if (command === 'apply' && configArg) {
  await applyConfig(configArg);
  const stats = getStats();
  console.log(`📊 Rate limiter: ${stats.totalRequests} requests, ${stats.throttleEvents} throttles, ${(stats.totalWaitMs / 1000).toFixed(1)}s total wait`);
} else if (command === 'reset' && configArg) {
  await cleanZone();
  await applyConfig(configArg);
  const stats = getStats();
  console.log(`📊 Rate limiter: ${stats.totalRequests} requests, ${stats.throttleEvents} throttles, ${(stats.totalWaitMs / 1000).toFixed(1)}s total wait`);
} else if (!command) {
  // Module-only mode — no CLI action, just exports
  // This allows: import { cleanZone, applyConfig } from './zone-apply.mjs';
} else {
  console.error(`Usage:
  node scripts/zone-apply.mjs clean                    # Clean zone only
  node scripts/zone-apply.mjs apply <config.json>      # Apply config
  node scripts/zone-apply.mjs reset <config.json>      # Clean + apply`);
  process.exitCode = 1;
}
