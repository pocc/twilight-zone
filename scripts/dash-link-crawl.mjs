#!/usr/bin/env node
// Dashboard deep-link path crawler.
//
// Scrapes dash.cloudflare.com's OWN navigation to capture the canonical
// section slugs + item-level anchor templates that feed app/lib/dashLinks.ts
// and docs/dash-deep-link-paths.md. We scrape the dash's real hrefs instead
// of hand-writing paths so the map stays honest when the dashboard IA changes.
//
// Auth: the dashboard UI is behind SSO; an API token will NOT work. You must
// supply a logged-in browser session. cf_clearance / __cf_bm are bound to the
// browser's IP+UA, so REPLAYING cookies from a different host gets the session
// invalidated after the first request. Run this on the SAME machine where you
// captured the session.
//
// Usage:
//   DASH_COOKIE="$(pbpaste)" \            # full Cookie: header from a dash XHR
//   DASH_ATOK="1780...-ATOK..." \          # x-atok header from the same XHR
//   DASH_ACCOUNT=<account_id> \
//   DASH_ZONE=<zone_name> \
//   node scripts/dash-link-crawl.mjs > dash-nav.json
//
// Never commit the cookie/atok values. This script reads them from env only.

import { chromium } from 'playwright';

const ACCT = process.env.DASH_ACCOUNT;
const ZONE = process.env.DASH_ZONE;
const COOKIE = process.env.DASH_COOKIE;
const ATOK = process.env.DASH_ATOK;
const UA =
  process.env.DASH_UA ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

if (!ACCT || !ZONE || !COOKIE) {
  console.error('Set DASH_ACCOUNT, DASH_ZONE, DASH_COOKIE (and ideally DASH_ATOK). See file header.');
  process.exit(2);
}

const cookies = COOKIE.split('; ').map((c) => {
  const i = c.indexOf('=');
  return { name: c.slice(0, i), value: c.slice(i + 1), domain: '.cloudflare.com', path: '/', secure: true, sameSite: 'Lax' };
});

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: UA,
  viewport: { width: 1440, height: 1000 },
  extraHTTPHeaders: { 'x-cross-site-security': 'dash', ...(ATOK ? { 'x-atok': ATOK } : {}) },
});
await ctx.addCookies(cookies);
const page = await ctx.newPage();

async function nav(path) {
  const url = `https://dash.cloudflare.com${path}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    return { path, error: String(e).slice(0, 160) };
  }
  await page.waitForTimeout(6000); // let the React nav render
  const finalUrl = page.url();
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')).filter(Boolean));
  return { path, finalUrl, login: finalUrl.includes('/login'), hrefs };
}

const out = {
  capturedAt: new Date().toISOString(),
  account: ACCT,
  zone: ZONE,
  zoneOverview: await nav(`/${ACCT}/${ZONE}`),
  accountHome: await nav(`/${ACCT}/home/domains`),
};
await browser.close();

if (out.zoneOverview.login || out.accountHome.login) {
  console.error('⚠ Redirected to /login — session is expired or not accepted from this host/IP.');
}
process.stdout.write(JSON.stringify(out, null, 2));
