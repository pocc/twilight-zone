#!/usr/bin/env node
/**
 * API v1 Test Script — Exercises the non-streaming JSON API endpoints.
 *
 * Usage:
 *   # Test against local dev server
 *   node scripts/api-test.mjs
 *
 *   # Test against production
 *   node scripts/api-test.mjs --base-url https://your-twilight-zone.example.com
 *
 *   # Run specific test suites
 *   node scripts/api-test.mjs --only auth,export
 *
 *   # Full migration test (requires all env vars)
 *   CF_API_KEY="..." CF_API_EMAIL="..." CF_ZONE_ID="..." \
 *     CF_ACCOUNT_ID="..." CF_TARGET_ACCOUNT_ID="..." \
 *     DEST_DOMAIN="..." \
 *     node scripts/api-test.mjs --only migrate
 *
 * Environment Variables:
 *   CF_API_KEY            — Cloudflare Global API Key
 *   CF_API_EMAIL          — Cloudflare account email
 *   CF_ZONE_ID            — Source zone ID (32-char hex)
 *   CF_ACCOUNT_ID         — Source account ID (32-char hex)
 *   CF_TARGET_ACCOUNT_ID  — Destination account ID (32-char hex)
 *   DEST_DOMAIN           — Domain name for migration destination
 *   BASE_URL              — API base URL (default: http://localhost:5173)
 */

const args = process.argv.slice(2);
function argVal(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

const BASE_URL = argVal('--base-url') || process.env.BASE_URL || 'http://localhost:5173';
const ONLY = argVal('--only')?.split(',') || null;
const API = `${BASE_URL}/api/v1`;

const CF_API_KEY = process.env.CF_API_KEY || '';
const CF_API_EMAIL = process.env.CF_API_EMAIL || '';
const CF_ZONE_ID = process.env.CF_ZONE_ID || '';
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '';
const CF_TARGET_ACCOUNT_ID = process.env.CF_TARGET_ACCOUNT_ID || '';
const DEST_DOMAIN = process.env.DEST_DOMAIN || '';

// Auth body (API key mode)
const authBody = CF_API_KEY
  ? { useApiKey: true, apiKey: CF_API_KEY, apiEmail: CF_API_EMAIL }
  : {};

const hasAuth = !!(CF_API_KEY && CF_API_EMAIL);
const hasMigrateEnv = hasAuth && CF_ZONE_ID && CF_ACCOUNT_ID && CF_TARGET_ACCOUNT_ID;

// ── Helpers ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;

async function post(path, body = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function get(path) {
  const url = `${API}${path}`;
  const res = await fetch(url);
  const data = await res.json();
  return { status: res.status, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(suite, name, fn) {
  if (ONLY && !ONLY.includes(suite)) return;
  const label = `[${suite}] ${name}`;
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${label}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${label}: ${e.message}`);
  }
}

function skip(suite, name, reason) {
  if (ONLY && !ONLY.includes(suite)) return;
  skipped++;
  console.log(`  SKIP  [${suite}] ${name} — ${reason}`);
}

// ── Test Suites ──────────────────────────────────────────────────

async function runTests() {
  console.log(`\nTwilight Zone API v1 Tests`);
  console.log(`Base URL: ${API}`);
  console.log(`Auth: ${hasAuth ? 'API Key' : 'none (set CF_API_KEY + CF_API_EMAIL for live tests)'}`);
  console.log('');

  // ── docs ──────────────────────────────────────────────────────

  await test('docs', 'GET /docs returns API documentation', async () => {
    const { status, data } = await get('/docs');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.name === 'Twilight Zone API', `Expected name, got ${data.name}`);
    assert(Array.isArray(data.endpoints), 'Expected endpoints array');
    assert(data.endpoints.length > 10, `Expected >10 endpoints, got ${data.endpoints.length}`);
    assert(data.examples, 'Expected examples');
  });

  await test('docs', 'GET / redirects to docs', async () => {
    const { status, data } = await get('/');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.name === 'Twilight Zone API', `Expected docs response`);
  });

  // ── validation errors ─────────────────────────────────────────

  await test('errors', 'POST /validate-token with no body returns error', async () => {
    const { data } = await post('/validate-token', {});
    assert(data.valid === false || data.error, 'Expected validation failure');
  });

  await test('errors', 'POST /zones without accountId returns 400', async () => {
    const { status } = await post('/zones', { ...authBody });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('errors', 'POST /export without IDs returns 400', async () => {
    const { status } = await post('/export', { ...authBody });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('errors', 'POST /migrate without IDs returns 400', async () => {
    const { status } = await post('/migrate', { ...authBody });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  await test('errors', 'POST /check-blockers without IDs returns 400', async () => {
    const { status } = await post('/check-blockers', { ...authBody });
    assert(status === 400, `Expected 400, got ${status}`);
  });

  // ── auth (live) ───────────────────────────────────────────────

  if (hasAuth) {
    await test('auth', 'POST /validate-token validates API key', async () => {
      const { data } = await post('/validate-token', authBody);
      assert(data.valid === true, `Expected valid=true, got ${JSON.stringify(data)}`);
      assert(data.authType === 'api_key', `Expected authType=api_key`);
    });

    await test('auth', 'POST /accounts lists accounts', async () => {
      const { status, data } = await post('/accounts', authBody);
      assert(status === 200, `Expected 200, got ${status}`);
      assert(Array.isArray(data.accounts), 'Expected accounts array');
      assert(data.accounts.length > 0, 'Expected at least 1 account');
    });
  } else {
    skip('auth', 'live auth tests', 'No CF_API_KEY + CF_API_EMAIL set');
  }

  // ── zones (live) ──────────────────────────────────────────────

  if (hasAuth && CF_ACCOUNT_ID) {
    await test('zones', 'POST /zones lists zones', async () => {
      const { status, data } = await post('/zones', { ...authBody, accountId: CF_ACCOUNT_ID });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(Array.isArray(data.zones), 'Expected zones array');
    });
  } else {
    skip('zones', 'list zones', 'No CF_ACCOUNT_ID set');
  }

  // ── export (live) ─────────────────────────────────────────────

  if (hasAuth && CF_ZONE_ID && CF_ACCOUNT_ID) {
    await test('export', 'POST /export returns zone data', async () => {
      const { status, data } = await post('/export', {
        ...authBody,
        sourceZoneId: CF_ZONE_ID,
        sourceAccountId: CF_ACCOUNT_ID,
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(data.export, 'Expected export object');
      assert(data.export.zone, 'Expected zone in export');
      assert(data.export.zone.name, 'Expected zone name');
      assert(Array.isArray(data.export.dnsRecords), 'Expected dnsRecords array');
      assert(Array.isArray(data.logs), 'Expected logs array');
      console.log(`         Zone: ${data.export.zone.name}, DNS: ${data.export.dnsRecords.length}, Settings: ${data.export.settings.length}`);
    });
  } else {
    skip('export', 'live export', 'No CF_ZONE_ID + CF_ACCOUNT_ID set');
  }

  // ── capabilities (live) ───────────────────────────────────────

  if (hasAuth && CF_TARGET_ACCOUNT_ID) {
    await test('capabilities', 'POST /check-capabilities returns features', async () => {
      const { status, data } = await post('/check-capabilities', {
        ...authBody,
        destAccountId: CF_TARGET_ACCOUNT_ID,
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(data.capabilities, 'Expected capabilities object');
    });
  } else {
    skip('capabilities', 'check capabilities', 'No CF_TARGET_ACCOUNT_ID set');
  }

  // ── migrate dry-run (live) ────────────────────────────────────

  if (hasMigrateEnv) {
    await test('migrate', 'POST /migrate dry-run returns preview', async () => {
      const { status, data } = await post('/migrate', {
        ...authBody,
        sourceToken: '', destToken: '',
        sourceZoneId: CF_ZONE_ID,
        sourceAccountId: CF_ACCOUNT_ID,
        destAccountId: CF_TARGET_ACCOUNT_ID,
        domainName: DEST_DOMAIN || undefined,
        dryRun: true,
        conflictStrategy: 'skip',
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(data.success === true, `Expected success=true`);
      assert(data.dryRun === true, `Expected dryRun=true`);
      assert(data.preview, 'Expected preview object');
      assert(Array.isArray(data.logs), 'Expected logs array');
      console.log(`         API calls: ${data.preview.summary.total}, Resource types: ${data.preview.summary.resourceTypes}`);
    });
  } else {
    skip('migrate', 'dry-run migration', 'Missing required env vars');
  }

  // ── terraform (live) ──────────────────────────────────────────

  if (hasAuth && CF_ZONE_ID && CF_ACCOUNT_ID) {
    await test('terraform', 'POST /terraform/export returns HCL bundle', async () => {
      const { status, data } = await post('/terraform/export', {
        ...authBody,
        sourceZoneId: CF_ZONE_ID,
        sourceAccountId: CF_ACCOUNT_ID,
      });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(data.bundle || data.files, 'Expected bundle or files');
      assert(data.summary, 'Expected summary');
      assert(Array.isArray(data.logs), 'Expected logs array');
      console.log(`         Resources: ${data.summary.totalResources}, Files: ${data.summary.files?.length || 'bundle'}`);
    });
  } else {
    skip('terraform', 'terraform export', 'No CF_ZONE_ID + CF_ACCOUNT_ID set');
  }

  // ── Summary ───────────────────────────────────────────────────

  console.log('');
  console.log('─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('─'.repeat(50));

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test runner error:', e);
  process.exit(1);
});
