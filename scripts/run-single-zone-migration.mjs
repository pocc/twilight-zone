#!/usr/bin/env node
/**
 * Single-zone Twilight Zone migration runner — Playwright/Chromium driver.
 *
 * Drives the live deployed Twilight Zone UI at $TZ_URL through one full
 * Setup → Scope → Migrate → Results migration for a single source zone,
 * and captures screenshots + per-step UI state into $EVIDENCE_DIR for
 * downstream verification by scripts/verify-checklist.mjs.
 *
 * Pairs with scripts/capture-zone-state.mjs (run before + after) to produce
 * the JSON snapshots the verifier reads.
 *
 * Env (required):
 *   CF_API_KEY                  Cloudflare Global API Key (used for BOTH accounts)
 *   CF_API_EMAIL                Cloudflare account email for the global key
 *   SRC_ACCOUNT_ID              Source account id
 *   DEST_ACCOUNT_ID             Destination account id
 *   SRC_ZONE_ID                 Source zone id
 *   ZONE_NAME                   Zone domain (e.g. example.com)
 *   EVIDENCE_DIR                Directory to write screenshots + extracted state
 *
 * Env (optional):
 *   TZ_URL                      Twilight Zone URL (default: https://twilight-zone.ross.gg)
 *   HEADLESS                    "1" for headless (default), "0" for headed
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// ── Env ──────────────────────────────────────────────────────────
const env = process.env;
const required = ['CF_API_KEY', 'CF_API_EMAIL', 'SRC_ACCOUNT_ID', 'DEST_ACCOUNT_ID', 'SRC_ZONE_ID', 'ZONE_NAME', 'EVIDENCE_DIR'];
for (const k of required) if (!env[k]) { console.error(`Missing required env: ${k}`); process.exit(1); }

const CF_API_KEY = env.CF_API_KEY;
const CF_API_EMAIL = env.CF_API_EMAIL;
const SRC_ACCOUNT_ID = env.SRC_ACCOUNT_ID;
const DEST_ACCOUNT_ID = env.DEST_ACCOUNT_ID;
const SRC_ZONE_ID = env.SRC_ZONE_ID;
const ZONE_NAME = env.ZONE_NAME;
const EVIDENCE_DIR = env.EVIDENCE_DIR;
const TZ_URL = env.TZ_URL ?? 'https://twilight-zone.ross.gg';
const HEADLESS = env.HEADLESS !== '0';

const SCREENSHOT_DIR = path.join(EVIDENCE_DIR, 'screenshots');
const STATE_FILE = path.join(EVIDENCE_DIR, 'migration-run.json');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── Logging ──────────────────────────────────────────────────────
const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  log(`🏁 Twilight Zone migration: ${ZONE_NAME}`);
  log(`   Tool URL:   ${TZ_URL}`);
  log(`   Source:     account ${SRC_ACCOUNT_ID} / zone ${SRC_ZONE_ID}`);
  log(`   Dest:       account ${DEST_ACCOUNT_ID}`);
  log(`   Headless:   ${HEADLESS}`);
  log(`   Evidence:   ${EVIDENCE_DIR}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const consoleLogs = [];
  const networkErrors = [];

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLogs.push(`[PAGE ERROR] ${err.message}`));
  page.on('response', async (res) => {
    if (!res.ok() && res.url().includes('/api/')) {
      networkErrors.push(`${res.status()} ${res.url()}`);
    }
  });

  const startTime = Date.now();
  let outcome = 'unknown';
  let stepResults = {};

  try {
    // ── Navigate ──────────────────────────────────────────────
    log('🌐 Opening Twilight Zone...');
    await page.goto(TZ_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00-landing.png'), fullPage: true });

    // ── Step 1: Credentials ──────────────────────────────────
    log('📝 Step 1: Filling credentials...');

    // Select "Migrate" mode
    await page.locator('button', { hasText: 'Migrate' }).first().click();
    await page.waitForTimeout(500);

    // Select "API" source mode (vs. JSON / Terraform / preset)
    const apiMode = page.locator('button', { hasText: 'API' }).first();
    if (await apiMode.count() > 0) {
      await apiMode.click();
      await page.waitForTimeout(300);
    }

    // Switch to "API Key" auth (vs Token)
    const apiKeyBtn = page.locator('button', { hasText: 'API Key' }).first();
    await apiKeyBtn.click();
    await page.waitForTimeout(300);

    // Ensure "Both Accounts" mode (the same key works for both)
    const bothBtn = page.locator('button', { hasText: 'Both Accounts' });
    if (await bothBtn.count() > 0) {
      await bothBtn.first().click();
      await page.waitForTimeout(200);
    }

    // Fill email + key
    await page.locator('input[type="email"]').first().fill(CF_API_EMAIL);
    await page.waitForTimeout(200);
    await page.locator('input[type="password"]').first().fill(CF_API_KEY);
    await page.waitForTimeout(500);

    // Wait for accounts dropdown to populate
    log('⏳ Waiting for accounts to load...');
    await page.waitForFunction(() => {
      const sels = document.querySelectorAll('select');
      return sels.length > 0 && sels[0].options.length > 1;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(500);

    // Select source account
    log(`📋 Source account = ${SRC_ACCOUNT_ID}`);
    await page.locator('select').first().selectOption(SRC_ACCOUNT_ID);
    await page.waitForTimeout(1500);

    // Wait for zones to load
    log('⏳ Waiting for zones to load...');
    await page.waitForFunction(() => {
      const sels = document.querySelectorAll('select');
      return sels.length > 1 && sels[1].options.length > 1;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(500);

    // Select source zone
    log(`📋 Source zone = ${SRC_ZONE_ID}`);
    await page.locator('select').nth(1).selectOption(SRC_ZONE_ID);
    await page.waitForTimeout(500);

    // Select dest account (3rd select)
    log(`📋 Dest account = ${DEST_ACCOUNT_ID}`);
    await page.waitForFunction(() => {
      const sels = document.querySelectorAll('select');
      return sels.length > 2 && sels[2].options.length > 1;
    }, null, { timeout: 15000 });
    await page.locator('select').nth(2).selectOption(DEST_ACCOUNT_ID);
    await page.waitForTimeout(500);

    // Domain name (often pre-filled from source zone but force-set anyway)
    const domainInput = page.locator('input[type="text"][placeholder="example.com"]');
    if (await domainInput.count() > 0) {
      await domainInput.fill(ZONE_NAME);
      await page.waitForTimeout(300);
    }

    // Select highest plan (Enterprise if available)
    const entBtn = page.locator('button', { hasText: /^Enterprise/ });
    if (await entBtn.count() > 0 && !(await entBtn.first().isDisabled())) {
      await entBtn.first().click();
      await page.waitForTimeout(200);
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-step1-credentials.png'), fullPage: true });
    log('📸 Step 1 saved');

    // ── Scope Migration → Step 2 (Account) ─────────────────
    // The wizard is a 5-step flow (Setup · Account · Zone · Apply · Results).
    // Account and Zone are select-only navigation; the migration runs from the
    // Apply step. Navigation mirrors scripts/run-playwright-migrations.mjs.
    log('🔄 Click Scope Migration → Account step');
    await page.locator('button', { hasText: 'Scope Migration' }).click();

    // Wait for the Account step's primary button (export must finish first).
    log('⏳ Waiting for export to complete...');
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('button')]
        .some(b => /Continue to Zone/i.test(b.textContent || ''));
    }, null, { timeout: 180000 });
    await page.waitForTimeout(1500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-step2-account.png'), fullPage: true });
    log('📸 Account step saved');

    // Capture scope state (resource counts shown on the Account step)
    stepResults.step2 = await page.evaluate(() => ({
      text: document.body.innerText.substring(0, 5000),
    }));

    const MIGRATION_TIMEOUT = 300000; // 5 min

    // ── Account → "Continue to Zone" (navigation only) → Zone step ──
    log('🔄 Click Continue to Zone → Zone step');
    await page.locator('button', { hasText: /Continue to Zone/i }).first().click();
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('button')]
        .some(b => /Continue to Apply/i.test(b.textContent || ''));
    }, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-step3-zone.png'), fullPage: true });
    log('📸 Zone step saved');

    // ── Zone → "Continue to Apply" (navigation only) → Apply step ──
    log('🔄 Click Continue to Apply → Apply step');
    await page.locator('button', { hasText: /Continue to Apply/i }).first().click();
    await page.waitForFunction(() => {
      return [...document.querySelectorAll('button')]
        .some(b => /Run migration/i.test(b.textContent || ''));
    }, null, { timeout: 30000 });
    await page.waitForTimeout(800);

    // ── Apply: confirm destination, then "Run migration" (both phases) ──
    await page.evaluate(() => {
      for (const sel of ['Confirm destination account', 'Confirm destination zone']) {
        const cb = document.querySelector(`input[aria-label="${sel}"]`);
        if (cb && !cb.checked) cb.click();
      }
    });
    await page.waitForTimeout(200);
    log('🚀 Click Run migration → account + zone phases');
    await page.locator('button', { hasText: /Run migration/i }).first().click();

    log('⏳ Waiting for migration (up to 5 min)...');
    const outcomeHandle = await page.waitForFunction(() => {
      const btns = [...document.querySelectorAll('button')];
      // Migration complete → the Apply step exposes "Continue to Results";
      // some flows surface Results affordances directly.
      const done = btns.some(b => /Continue to Results|Start New Migration|Migration Report|Start Over/i.test(b.textContent || ''));
      if (done) return 'done';
      if (document.body.innerText.includes('ERROR:')) return 'error';
      return null;
    }, null, { timeout: MIGRATION_TIMEOUT });

    outcome = await outcomeHandle.jsonValue();
    await page.waitForTimeout(1500);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-step4-cutover.png'), fullPage: true });
    log('📸 Apply (post-migration) saved');

    // ── Continue to Results → Step 5 (Results) ──────────────
    if (outcome !== 'error') {
      const toResults = page.locator('button', { hasText: 'Continue to Results' });
      if (await toResults.count() > 0) {
        log('🔄 Click Continue to Results → Step 5 (Results)');
        await toResults.first().click();
        await page.waitForTimeout(2000);
      }
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-step5-results.png'), fullPage: true });
      log('📸 Step 5 (Results) saved');
    }

    if (outcome === 'error') {
      const errorText = await page.evaluate(() => {
        const lines = document.body.innerText.split('\n').filter(l => l.includes('ERROR:'));
        return lines.join('; ') || 'unknown error';
      });
      log(`❌ Migration error: ${errorText}`);
      stepResults.error = errorText;
    } else {
      // Parse the Step 4 summary numbers
      stepResults.step4 = await page.evaluate(() => {
        const text = document.body.innerText;
        const num = (label) => {
          const m = text.match(new RegExp(`(\\d+)\\s*(?:\\n|\\r)\\s*${label}`, 'i'));
          return m ? parseInt(m[1]) : null;
        };
        // When a stat is 0, the UI sometimes elides the label — derive from "All resources verified!" success state
        const allVerified = /All resources verified on destination/.test(text);
        return {
          total: num('TOTAL'),
          success: num('SUCCESS'),
          failed: num('FAILED') ?? (allVerified ? 0 : null),
          skipped: num('SKIPPED') ?? (allVerified ? 0 : null),
          verified: num('VERIFIED'),
          missing: num('MISSING') ?? (allVerified ? 0 : null),
          mismatched: num('MISMATCHED') ?? (allVerified ? 0 : null),
          acknowledged: num('ACKNOWLEDGED'),
          allVerified,
          firstChunk: text.substring(0, 5000),
        };
      });
      log(`✅ Step 4 summary: ${JSON.stringify(stepResults.step4, null, 2)}`);
    }

    // Try to capture the migration report markdown via download
    try {
      const reportBtn = page.locator('button', { hasText: /Download.*Report|Migration Report|Export Report/i }).first();
      if (await reportBtn.count() > 0) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
          reportBtn.click().catch(() => null),
        ]);
        if (download) {
          const reportPath = path.join(EVIDENCE_DIR, 'migration-report.md');
          await download.saveAs(reportPath);
          log(`📝 Migration report saved → ${reportPath}`);
        }
      }
    } catch (e) {
      log(`⚠️ Could not capture migration report: ${e.message}`);
    }

  } catch (err) {
    outcome = 'thrown';
    log(`❌ Migration threw: ${err.message}`);
    stepResults.error = err.message;
    try { await page.screenshot({ path: path.join(SCREENSHOT_DIR, '99-failure.png'), fullPage: true }); } catch { /* */ }
  } finally {
    const elapsed = Date.now() - startTime;
    log(`⏱  Total elapsed: ${(elapsed / 1000).toFixed(1)}s`);

    fs.writeFileSync(STATE_FILE, JSON.stringify({
      ts: new Date().toISOString(),
      outcome,
      elapsedMs: elapsed,
      stepResults,
      consoleLogs,
      networkErrors,
      logLines,
    }, null, 2));
    log(`💾 Run state → ${STATE_FILE}`);

    await context.close();
    await browser.close();
  }

  process.exit(outcome === 'done' ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
