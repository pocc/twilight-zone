import { expect, test, type Page } from '@playwright/test';

import {
  emptyBrowserArtifactCategories,
  emptyBrowserArtifacts,
  scanSecretCanaries,
  type BrowserArtifacts,
} from '../helpers/secretCanary';

const providerOrigin = 'http://127.0.0.1:4174';
const oauthCookieNames = [
  '__Host-tz-oauth-source-transaction',
  '__Host-tz-oauth-source-grant',
  '__Host-tz-oauth-destination-transaction',
  '__Host-tz-oauth-destination-grant',
];
const accessTokenCanary = 'local-oauth-access-token-canary';

const emptyExport = {
  zone: {
    id: 'a'.repeat(32),
    name: 'source.example.com',
    name_servers: [],
    status: 'active',
    account: { id: 'b'.repeat(32), name: 'Source' },
    plan: { id: 'free', name: 'Free' },
  },
  dnsRecords: [], settings: [], pageRules: [], rulesets: [], workerRoutes: [], loadBalancers: [],
  spectrumApps: [], customCertificates: [], customHostnames: [], firewallRules: [], rateLimits: [],
  emailRoutingRules: [], waitingRooms: [], workers: [], pools: [], monitors: [], accessApps: [],
  accessPolicies: [], zarazConfig: null, turnstileWidgets: [], kvNamespaces: [], r2Buckets: [],
  d1Databases: [], queues: [], durableObjectNamespaces: [],
};

const collectBrowserArtifacts = (page: Page) => {
  const artifacts = emptyBrowserArtifacts();
  const pending: Promise<void>[] = [];
  let settled = 0;

  page.on('console', (message) => artifacts.logs.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => artifacts.errors.push(error.message));
  page.on('response', (response) => {
    if (!response.url().includes('/api/')) return;
    pending.push((async () => {
      let body = '';
      try { body = await response.text(); } catch { return; }
      const record = { url: response.url(), status: response.status(), body };
      const contentType = response.headers()['content-type'] ?? '';
      if (contentType.includes('text/event-stream')) artifacts.sse.push(record);
      if (response.url().includes('/api/analytics/')) artifacts.analytics.push(record);
      if (/\/api\/(?:migrate|rollback|diff\/stream)/.test(response.url())) artifacts.reports.push(record);
      if (!response.ok()) artifacts.errors.push(record);
    })());
  });
  page.on('download', (download) => {
    pending.push((async () => {
      const stream = await download.createReadStream();
      let body = '';
      if (stream) for await (const chunk of stream) body += String(chunk);
      artifacts.downloads.push({ name: download.suggestedFilename(), body });
    })());
  });

  return async (): Promise<BrowserArtifacts> => {
    while (settled < pending.length) {
      const batch = pending.slice(settled);
      settled = pending.length;
      await Promise.all(batch);
    }
    artifacts.storage = await page.evaluate(() => ({
      session: Object.fromEntries(Object.entries(sessionStorage)),
      local: Object.fromEntries(Object.entries(localStorage)),
    }));
    expect(scanSecretCanaries(artifacts, [accessTokenCanary])).toEqual([]);
    return artifacts;
  };
};

test.beforeEach(async ({ context, request }) => {
  await context.clearCookies();
  await request.post(`${providerOrigin}/test/reset`);
});

test('completes PKCE callback, status, replay rejection, back navigation, and logout through real routes', async ({ page, request }) => {
  const assertNoSecretCanary = collectBrowserArtifacts(page);
  let callbackUrl = '';
  let callbackResultUrl = '';
  const navigationUrls: string[] = [];
  page.on('request', (outgoing) => {
    if (outgoing.isNavigationRequest()) navigationUrls.push(outgoing.url());
    if (outgoing.url().includes('/api/oauth/callback?')) callbackUrl = outgoing.url();
    if (outgoing.url().includes('oauth_result=')) callbackResultUrl = outgoing.url();
  });
  await page.route('**/api/accounts', (route) => route.fulfill({ json: { accounts: [] } }));

  await page.goto('/');
  await page.getByRole('button', { name: 'OAuth' }).first().click();
  const nonceBeforeCallback = await page.evaluate(() => sessionStorage.getItem('twilight.oauth.tab-nonce'));
  expect(nonceBeforeCallback).toBeTruthy();
  await page.getByRole('button', { name: 'Authorize source' }).click();
  await expect.poll(() => callbackUrl).not.toBe('');
  await expect.poll(() => callbackResultUrl, { message: navigationUrls.join('\n'), timeout: 15_000 }).not.toBe('');
  expect(callbackResultUrl).toContain('oauth_result=connected');
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('twilight.oauth.tab-nonce'))).toBe(nonceBeforeCallback);
  expect(callbackUrl).toContain('/api/oauth/callback?code=');

  const grantCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === '__Host-tz-oauth-source-grant',
  );
  expect(grantCookie?.value).toBeTruthy();
  expect(grantCookie?.value).not.toContain('local-oauth-access-token-canary');
  await assertNoSecretCanary();

  await page.reload();
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('twilight.oauth.tab-nonce'))).toBe(nonceBeforeCallback);
  callbackResultUrl = '';
  await page.goto(callbackUrl);
  await expect.poll(() => callbackResultUrl).toContain('oauth_result=error&oauth_reason=oauth_callback_invalid');
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
  await page.goBack();
  await expect(page.getByText(/Connected until/).first()).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Log out of OAuth session' }).click();
  await expect(page.getByRole('button', { name: 'Authorize source' })).toBeEnabled();
  await expect.poll(async () => {
    const response = await request.get(`${providerOrigin}/test/state`);
    return (await response.json() as { revocations: number }).revocations;
  }).toBe(1);
  await assertNoSecretCanary();
});

test('rejects another tab nonce without clearing the valid shared grant', async ({ context, page }) => {
  await page.route('**/api/accounts', (route) => route.fulfill({ json: { accounts: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'OAuth' }).first().click();
  await page.getByRole('button', { name: 'Authorize source' }).click();
  await expect(page.getByText(/Connected until/).first()).toBeVisible();

  const otherTab = await context.newPage();
  await otherTab.goto('/');
  const unauthorized = await otherTab.evaluate(async () => {
    const nonce = sessionStorage.getItem('twilight.oauth.tab-nonce') ?? '';
    const response = await fetch('/api/accounts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Twilight-Auth': 'oauth',
        'X-Twilight-OAuth-Nonce': nonce,
      },
      body: JSON.stringify({ oauthRole: 'source' }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(unauthorized).toEqual({
    status: 401,
    body: { error: 'oauth_reauthorization_required', role: 'source' },
  });

  const originalStatus = await page.evaluate(async () => {
    const nonce = sessionStorage.getItem('twilight.oauth.tab-nonce') ?? '';
    const response = await fetch('/api/oauth/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Twilight-Auth': 'oauth',
        'X-Twilight-OAuth-Nonce': nonce,
      },
      body: '{}',
    });
    return { status: response.status, body: await response.json() };
  });
  expect(originalStatus.status).toBe(200);
  expect(originalStatus.body).toMatchObject({ roles: { source: { connected: true } } });
  await otherTab.close();
});

test('rotates a window.open sessionStorage clone before the child can use the shared grant', async ({ context, page }) => {
  await context.route('**/api/accounts', (route) => route.fulfill({ json: { accounts: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'OAuth' }).first().click();
  await page.getByRole('button', { name: 'Authorize source' }).click();
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
  const originalNonce = await page.evaluate(() => sessionStorage.getItem('twilight.oauth.tab-nonce'));
  expect(originalNonce).toBeTruthy();

  const childStartupNonces: (string | undefined)[] = [];
  let openingChild = true;
  context.on('request', (request) => {
    if (openingChild && request.url().includes('/api/oauth/') && request.method() === 'POST') {
      childStartupNonces.push(request.headers()['x-twilight-oauth-nonce']);
    }
  });
  const opened = context.waitForEvent('page');
  await page.evaluate(() => window.open('/', '_blank'));
  const child = await opened;
  await child.waitForLoadState('domcontentloaded');
  await expect.poll(() => child.evaluate(() => sessionStorage.getItem('twilight.oauth.tab-nonce')))
    .not.toBe(originalNonce);
  const childNonce = await child.evaluate(() => sessionStorage.getItem('twilight.oauth.tab-nonce'));
  expect(childNonce).toBeTruthy();
  expect(childNonce).not.toBe(originalNonce);
  openingChild = false;
  expect(childStartupNonces.length).toBeGreaterThan(0);
  expect(childStartupNonces.every((nonce) => nonce === childNonce)).toBe(true);

  const status = async (target: Page) => target.evaluate(async () => {
    const nonce = sessionStorage.getItem('twilight.oauth.tab-nonce') ?? '';
    const response = await fetch('/api/oauth/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Twilight-Auth': 'oauth',
        'X-Twilight-OAuth-Nonce': nonce,
      },
      body: '{}',
    });
    return { status: response.status, body: await response.json() };
  });

  expect(await status(child)).toEqual({ status: 401, body: { error: 'oauth_reauthorization_required' } });
  expect(await status(page)).toMatchObject({ status: 200, body: { roles: { source: { connected: true } } } });
  await child.close();
});

test('scans substantive artifacts from deterministic local OAuth operations', async ({ page }) => {
  const collectArtifacts = collectBrowserArtifacts(page);
  await page.route('**/api/accounts', (route) => route.fulfill({ json: { accounts: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'OAuth' }).first().click();
  await page.getByRole('button', { name: 'Authorize source' }).click();
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Authorize destination' }).click();
  await expect(page.getByText(/Connected until/)).toHaveCount(2);

  const downloadStarted = page.waitForEvent('download');
  const operation = await page.evaluate(async (exportData) => {
    const nonce = sessionStorage.getItem('twilight.oauth.tab-nonce') ?? '';
    const headers = {
      'Content-Type': 'application/json',
      'X-Twilight-Auth': 'oauth',
      'X-Twilight-OAuth-Nonce': nonce,
    };
    localStorage.setItem('oauth-local-artifact-run', JSON.stringify({ operation: 'destination-diff' }));
    const report = await fetch('/api/diff/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sourceExport: exportData,
        destExport: exportData,
      }),
    });
    const reportBody = await report.text();
    console.info(`Local OAuth destination diff completed with HTTP ${report.status}`);

    const analytics = await fetch('/api/analytics/probe/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceZoneId: 'invalid', sourceAccountId: 'invalid' }),
    });
    await analytics.text();

    const done = reportBody.split('\n').find((line) => line.startsWith('data: ') && line.includes('"type":"done"'));
    const reportJson = done ? JSON.stringify(JSON.parse(done.slice(6)), null, 2) : '';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([reportJson], { type: 'application/json' }));
    link.download = 'destination_diff.json';
    link.click();
    URL.revokeObjectURL(link.href);
    return { reportStatus: report.status, reportBody, analyticsStatus: analytics.status, reportJson };
  }, emptyExport);
  await downloadStarted;

  expect(operation.reportStatus).toBe(200);
  expect(operation.analyticsStatus).toBe(400);
  expect(operation.reportJson, operation.reportBody).toContain('"type": "done"');
  const artifacts = await collectArtifacts();
  expect(emptyBrowserArtifactCategories(artifacts)).toEqual([]);
});

test('rejects malformed and oversized OAuth cookies, then recovers after cleanup', async ({ context, page }) => {
  const assertNoSecretCanary = collectBrowserArtifacts(page);
  const malformed = await context.request.post('/api/oauth/status', {
    headers: {
      Origin: 'http://localhost:5173',
      Cookie: '__Host-tz-oauth-source-grant=forged',
      'X-Twilight-Auth': 'oauth',
      'X-Twilight-OAuth-Nonce': 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
    },
  });
  expect(malformed.status()).toBe(401);

  const oversizedCookie = oauthCookieNames.map((name) => `${name}=${'x'.repeat(3500)}`).join('; ');
  const oversized = await context.request.post('/api/oauth/status', {
    headers: {
      Origin: 'http://localhost:5173',
      Cookie: oversizedCookie,
      'X-Twilight-Auth': 'oauth',
      'X-Twilight-OAuth-Nonce': 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
    },
  });
  expect(oversized.status()).toBe(400);
  await expect(oversized.json()).resolves.toMatchObject({ error: 'oauth_cookie_header_too_large' });

  await context.clearCookies();
  await page.route('**/api/accounts', (route) => route.fulfill({ json: { accounts: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'OAuth' }).first().click();
  await page.getByRole('button', { name: 'Authorize source' }).click();
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
  await assertNoSecretCanary();
});
