#!/usr/bin/env node
/**
 * E2E Preflight — runs in ~5 seconds, validates every assumption the
 * Playwright harness needs before kicking off a 60+ minute test run.
 *
 * Exits 0 if all checks pass, exits 1 with a concrete fix on any failure.
 *
 * Checks (in order):
 *   1. All required env vars are set
 *   2. CF Global API Key is valid (curl /user → success)
 *   3. CF_API_KEY has access to CF_ZONE_ID
 *   4. CF_API_KEY has access to CF_ACCOUNT_ID
 *   5. CF_API_KEY has access to CF_TARGET_ACCOUNT_ID
 *   6. SOURCE_DOMAIN matches the zone we have access to
 *   7. DEV_SERVER_URL is reachable
 *
 * Usage: node scripts/preflight-e2e.mjs
 */

const env = process.env;
const REQUIRED = ['CF_API_KEY', 'CF_API_EMAIL', 'CF_ZONE_ID', 'CF_ACCOUNT_ID',
                  'CF_TARGET_ACCOUNT_ID', 'SOURCE_DOMAIN', 'DEST_DOMAIN'];

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';

let failed = 0;
function pass(label, detail = '') {
  console.log(`  ${GREEN}✓${RESET} ${label}${detail ? '  ' + detail : ''}`);
}
function fail(label, detail, fix) {
  failed++;
  console.log(`  ${RED}✗${RESET} ${label}`);
  if (detail) console.log(`      ${RED}${detail}${RESET}`);
  if (fix) console.log(`      ${YELLOW}fix:${RESET} ${fix}`);
}

async function cfGet(path) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: {
      'X-Auth-Email': env.CF_API_EMAIL,
      'X-Auth-Key': env.CF_API_KEY,
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.success, status: res.status, body };
}

console.log(`${BOLD}E2E Preflight${RESET}\n`);

// 1. env vars present
console.log(`${BOLD}1. Environment variables${RESET}`);
const missing = REQUIRED.filter(k => !env[k]);
if (missing.length) {
  fail('required env vars present',
    `missing: ${missing.join(', ')}`,
    `source .env in your shell: set -a; source .env; set +a`);
} else {
  pass('all 7 required env vars present');
}
console.log(`     CF_API_EMAIL    = ${env.CF_API_EMAIL || '<unset>'}`);
console.log(`     CF_ZONE_ID      = ${env.CF_ZONE_ID || '<unset>'}`);
console.log(`     CF_ACCOUNT_ID   = ${env.CF_ACCOUNT_ID || '<unset>'}`);
console.log(`     CF_TARGET_ACCT  = ${env.CF_TARGET_ACCOUNT_ID || '<unset>'}`);
console.log(`     SOURCE_DOMAIN   = ${env.SOURCE_DOMAIN || '<unset>'}`);
console.log(`     DEST_DOMAIN     = ${env.DEST_DOMAIN || '<unset>'}`);
console.log(`     DEV_SERVER_URL  = ${env.DEV_SERVER_URL || '(default: http://localhost:5173)'}`);

if (missing.length) {
  process.exit(1);
}

// 2. CF Global API Key valid
console.log(`\n${BOLD}2. Cloudflare authentication${RESET}`);
const userRes = await cfGet('/user');
if (!userRes.ok) {
  const code = userRes.body?.errors?.[0]?.code;
  const msg = userRes.body?.errors?.[0]?.message;
  fail('CF_API_KEY is a valid Global API Key',
    `${code}: ${msg}`,
    'check https://dash.cloudflare.com/profile/api-tokens → Global API Key → View, then update .env');
} else {
  pass(`CF_API_KEY valid for ${userRes.body.result.email}`);
}

if (failed > 0) {
  console.log(`\n${RED}${BOLD}Preflight failed.${RESET} No tests will be run.\n`);
  process.exit(1);
}

// 3. Zone access
console.log(`\n${BOLD}3. Resource access${RESET}`);
const zoneRes = await cfGet(`/zones/${env.CF_ZONE_ID}`);
if (!zoneRes.ok) {
  fail(`access to source zone ${env.CF_ZONE_ID}`,
    zoneRes.body?.errors?.[0]?.message || `HTTP ${zoneRes.status}`,
    'verify CF_ZONE_ID points to a zone your Global API Key can read');
} else {
  pass(`source zone access — ${zoneRes.body.result.name} (${zoneRes.body.result.plan.name})`);

  // 6. domain match (bundled with zone check)
  if (zoneRes.body.result.name !== env.SOURCE_DOMAIN) {
    fail('SOURCE_DOMAIN matches zone name',
      `SOURCE_DOMAIN=${env.SOURCE_DOMAIN} but zone is named ${zoneRes.body.result.name}`,
      `update SOURCE_DOMAIN in .env to "${zoneRes.body.result.name}"`);
  } else {
    pass(`SOURCE_DOMAIN matches zone name`);
  }

  // Verify zone is in source account
  if (zoneRes.body.result.account.id !== env.CF_ACCOUNT_ID) {
    fail('CF_ZONE_ID belongs to CF_ACCOUNT_ID',
      `zone is in account ${zoneRes.body.result.account.id}, not ${env.CF_ACCOUNT_ID}`,
      `update CF_ACCOUNT_ID in .env to "${zoneRes.body.result.account.id}"`);
  } else {
    pass(`zone is in source account`);
  }
}

// 4. Source account access
const acctRes = await cfGet(`/accounts/${env.CF_ACCOUNT_ID}`);
if (!acctRes.ok) {
  fail(`access to source account ${env.CF_ACCOUNT_ID}`,
    acctRes.body?.errors?.[0]?.message || `HTTP ${acctRes.status}`,
    'verify CF_ACCOUNT_ID is correct');
} else {
  pass(`source account access — ${acctRes.body.result.name}`);
}

// 5. Target account access
const targetRes = await cfGet(`/accounts/${env.CF_TARGET_ACCOUNT_ID}`);
if (!targetRes.ok) {
  fail(`access to target account ${env.CF_TARGET_ACCOUNT_ID}`,
    targetRes.body?.errors?.[0]?.message || `HTTP ${targetRes.status}`,
    'verify CF_TARGET_ACCOUNT_ID is correct');
} else {
  pass(`target account access — ${targetRes.body.result.name}`);
}

// 7. Dev server reachable
console.log(`\n${BOLD}4. Dev server${RESET}`);
const devUrl = env.DEV_SERVER_URL || 'http://localhost:5173';
try {
  const r = await fetch(devUrl, { signal: AbortSignal.timeout(3000) });
  if (r.ok || r.status < 500) {
    pass(`${devUrl} responds (HTTP ${r.status})`);
  } else {
    fail(`dev server at ${devUrl}`, `HTTP ${r.status}`,
      `start the dev server: npm run dev`);
  }
} catch (err) {
  fail(`dev server at ${devUrl}`, err.message,
    err.message.includes('ENOTFOUND') || err.message.includes('NAME_NOT_RESOLVED')
      ? `set DEV_SERVER_URL=http://localhost:5173 in .env, then run: npm run dev`
      : `start the dev server: npm run dev`);
}

console.log();
if (failed > 0) {
  console.log(`${RED}${BOLD}Preflight failed (${failed} check${failed > 1 ? 's' : ''}).${RESET} No tests will be run.\n`);
  process.exit(1);
}
console.log(`${GREEN}${BOLD}All preflight checks passed.${RESET} Safe to run the E2E suite.\n`);
process.exit(0);
