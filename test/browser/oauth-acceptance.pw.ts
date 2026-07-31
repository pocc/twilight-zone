import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const NONCE_KEY = 'twilight.oauth.tab-nonce';

type RoleState = {
  connected: boolean;
  expiresAt?: number;
  scopes?: string[];
};

type OAuthRoles = {
  source: RoleState;
  destination: RoleState;
};

const connected = (role: 'source' | 'destination', expiresAt = Date.now() + 60 * 60 * 1000): RoleState => ({
  connected: true,
  expiresAt,
  scopes: role === 'source' ? ['account:read', 'zone:read'] : ['account:read', 'zone:edit'],
});

const disconnectedRoles = (): OAuthRoles => ({
  source: { connected: false },
  destination: { connected: false },
});

const assertOAuthRequest = (headers: Record<string, string>): void => {
  expect(headers['x-twilight-auth']).toBe('oauth');
  expect(headers['x-twilight-oauth-nonce']).toMatch(/^[A-Za-z0-9_-]{43}$/);
};

const mockOAuthSession = async (page: Page, roles: OAuthRoles): Promise<void> => {
  await page.route('**/api/oauth/config', async (route) => {
    assertOAuthRequest(route.request().headers());
    await route.fulfill({ json: { enabled: true } });
  });
  await page.route('**/api/oauth/status', async (route) => {
    assertOAuthRequest(route.request().headers());
    await route.fulfill({ json: { roles } });
  });
};

const mockAccountLookups = async (page: Page): Promise<void> => {
  await page.route('**/api/accounts', async (route) => {
    const request = route.request();
    assertOAuthRequest(request.headers());
    const body = request.postDataJSON() as { oauthRole?: string };
    expect(body.oauthRole).toMatch(/^(source|destination)$/);
    const destination = body.oauthRole === 'destination';
    await route.fulfill({
      json: {
        accounts: [{
          id: destination ? 'dest-account' : 'source-account',
          name: destination ? 'Destination' : 'Source',
        }],
      },
    });
  });
  await page.route('**/api/zones', async (route) => {
    const request = route.request();
    assertOAuthRequest(request.headers());
    const body = request.postDataJSON() as { oauthRole?: string };
    await route.fulfill({
      json: {
        zones: body.oauthRole === 'source'
          ? [{ id: 'source-zone', name: 'source.example.com', status: 'active' }]
          : [],
      },
    });
  });
  await page.route('**/api/available-plans', (route) => route.fulfill({ json: { plans: [], planCounts: {} } }));
  await page.route('**/api/check-blockers', (route) => route.fulfill({ json: { blockers: [] } }));
};

const minimalExport = (withDurableObject = false) => ({
  zone: {
    id: 'source-zone',
    name: 'source.example.com',
    name_servers: [],
    status: 'active',
    account: { id: 'source-account', name: 'Source' },
    plan: { id: 'free', name: 'Free' },
  },
  dnsRecords: [],
  settings: [],
  pageRules: [],
  rulesets: [],
  workerRoutes: [],
  loadBalancers: [],
  spectrumApps: [],
  customCertificates: [],
  customHostnames: [],
  firewallRules: [],
  rateLimits: [],
  emailRoutingRules: [],
  waitingRooms: [],
  workers: [],
  pools: [],
  monitors: [],
  accessApps: [],
  accessPolicies: [],
  zarazConfig: null,
  turnstileWidgets: [],
  kvNamespaces: [],
  r2Buckets: [],
  d1Databases: [],
  queues: [],
  durableObjectNamespaces: withDurableObject
    ? [{ id: 'do-namespace', name: 'Counter', class: 'Counter', script: 'counter-worker' }]
    : [],
});

const wizardSnapshot = (step: number, withDurableObject = false) => ({
  v: 1,
  sourceMode: 'api',
  step,
  maxStepReached: step,
  exportData: minimalExport(withDurableObject),
  exportTimestamp: Date.now(),
  selections: {},
  conflictStrategy: 'skip',
  capabilities: null,
  existingTurnstileWidgets: [],
  doConfigs: {},
  d1Configs: {},
  acknowledgments: [],
  selectedPlan: null,
  report: null,
  accountReport: null,
  reportMarkdown: '',
  auditLog: [],
  accountAuditLog: [],
  migrationLogs: [],
});

const seedWizard = async (page: Page, step: number, withDurableObject = false): Promise<void> => {
  await page.addInitScript(({ snapshot }) => {
    localStorage.setItem('tz-wizard-state-v1', JSON.stringify(snapshot));
    localStorage.setItem('tz_sourceAccountId', 'source-account');
    localStorage.setItem('tz_sourceZoneId', 'source-zone');
    localStorage.setItem('tz_destAccountId', 'dest-account');
    localStorage.setItem('tz_domainName', 'source.example.com');
  }, { snapshot: wizardSnapshot(step, withDurableObject) });
};

const clearContextCookies = async (context: BrowserContext): Promise<void> => {
  await context.clearCookies();
};

test('consumes callback result UI state and preserves the OAuth session across reload and back navigation', async ({ page }) => {
  const roles: OAuthRoles = {
    source: connected('source'),
    destination: { connected: false },
  };
  await mockOAuthSession(page, roles);

  const callbackResultUrl = '/?oauth_result=connected&oauth_role=source';
  await page.goto(callbackResultUrl);
  await expect(page.getByText('Source authorization')).toBeVisible();
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  const nonce = await page.evaluate((key) => sessionStorage.getItem(key), NONCE_KEY);
  expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);

  await page.reload();
  await expect(page.getByText('Source authorization')).toBeVisible();
  await expect(page.evaluate((key) => sessionStorage.getItem(key), NONCE_KEY)).resolves.toBe(nonce);

  await page.goto(callbackResultUrl);
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
  await page.goBack();
  await expect(page.getByText(/Connected until/).first()).toBeVisible();

  await page.goto(callbackResultUrl);
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
});

test('keeps the disconnected session control available', async ({ page }) => {
  await mockOAuthSession(page, disconnectedRoles());

  await page.goto('/?oauth_result=connected&oauth_role=source');
  await expect(page.getByRole('button', { name: 'Authorize source' })).toBeEnabled();
  await expect(page.getByText(/Connected until/)).toHaveCount(0);
});

test('keeps source and destination authorization transactions independent', async ({ page, baseURL }) => {
  await mockOAuthSession(page, disconnectedRoles());
  const pendingRoles = new Set<string>();
  await page.route('**/api/oauth/start', async (route) => {
    const request = route.request();
    assertOAuthRequest(request.headers());
    const body = request.postDataJSON() as { role?: string };
    expect(body.role).toMatch(/^(source|destination)$/);
    pendingRoles.add(body.role!);
    await route.fulfill({ json: { authorizationUrl: `${baseURL}/?pending_role=${body.role}` } });
  });

  await page.goto('/?oauth_result=connected&oauth_role=source');
  await page.getByRole('button', { name: 'Authorize source' }).click();
  await expect(page).toHaveURL(/pending_role=source/);
  await page.goBack();
  await page.getByRole('button', { name: 'Authorize destination' }).click();
  await expect(page).toHaveURL(/pending_role=destination/);

  expect([...pendingRoles].sort()).toEqual(['destination', 'source']);
});

test('rejects a different tab nonce while the originating tab remains connected', async ({ context, page }) => {
  let boundNonce = '';
  await context.route('**/api/oauth/config', async (route) => {
    assertOAuthRequest(route.request().headers());
    await route.fulfill({ json: { enabled: true } });
  });
  await context.route('**/api/oauth/status', async (route) => {
    const nonce = route.request().headers()['x-twilight-oauth-nonce'];
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (!boundNonce) boundNonce = nonce;
    if (nonce !== boundNonce) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'oauth_reauthorization_required', role: 'source' }),
      });
      return;
    }
    await route.fulfill({ json: { roles: { source: connected('source'), destination: { connected: false } } } });
  });

  await page.goto('/?oauth_result=connected&oauth_role=source');
  await expect(page.getByText(/Connected until/).first()).toBeVisible();

  const secondTab = await context.newPage();
  await secondTab.goto('/?oauth_result=connected&oauth_role=source');
  await expect(secondTab.getByRole('button', { name: 'Authorize source' })).toBeEnabled();
  await expect(secondTab.getByText(/Connected until/)).toHaveCount(0);
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
  expect(await secondTab.evaluate((key) => sessionStorage.getItem(key), NONCE_KEY)).not.toBe(boundNonce);
});

test('switches between OAuth and manual modes without leaking either mode across the boundary', async ({ page }) => {
  await mockOAuthSession(page, {
    source: connected('source'),
    destination: connected('destination'),
  });
  await page.goto('/?oauth_result=connected&oauth_role=source');
  await expect(page.getByText('Source authorization')).toBeVisible();

  await page.getByRole('button', { name: 'API Token' }).first().click();
  await expect(page.getByLabel('Source API Token')).toBeVisible();
  await expect(page.getByText('Source authorization')).toHaveCount(0);
  await expect(page.evaluate(() => sessionStorage.getItem('tz_authMode'))).resolves.toBe('manual');

  await page.reload();
  await expect(page.getByLabel('Source API Token')).toBeVisible();
  await page.getByRole('button', { name: 'OAuth' }).first().click();
  await expect(page.getByText('Source authorization')).toBeVisible();
  await expect(page.getByLabel('Source API Token')).toHaveCount(0);
});

test('allows a destination-only preset flow without source authorization', async ({ page }) => {
  await mockOAuthSession(page, {
    source: { connected: false },
    destination: connected('destination'),
  });
  await mockAccountLookups(page);
  await page.goto('/?oauth_result=connected&oauth_role=destination');
  await page.getByRole('button', { name: 'All Features On' }).click();

  await expect(page.getByText('Source authorization')).toHaveCount(0);
  await expect(page.getByText('Destination authorization')).toBeVisible();
  await page.getByLabel('Destination Account').selectOption('dest-account');
  await page.getByLabel('Zone', { exact: true }).last().fill('new-zone.example.com');
  await expect(page.getByRole('button', { name: 'Scope Migration' })).toBeEnabled();
});

test('routes preset capability reauthorization before opening the scope review', async ({ page }) => {
  await mockOAuthSession(page, {
    source: { connected: false },
    destination: connected('destination'),
  });
  await mockAccountLookups(page);
  let clearRequests = 0;
  await page.route('**/api/oauth/clear', async (route) => {
    clearRequests++;
    expect(route.request().postDataJSON()).toEqual({ role: 'destination' });
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/check-capabilities', async (route) => {
    assertOAuthRequest(route.request().headers());
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'oauth_reauthorization_required', role: 'destination' }),
    });
  });

  await page.goto('/?oauth_result=connected&oauth_role=destination');
  await page.getByRole('button', { name: 'All Features On' }).click();
  await page.getByLabel('Destination Account').selectOption('dest-account');
  await page.getByLabel('Zone', { exact: true }).last().fill('new-zone.example.com');
  await page.getByRole('button', { name: 'Scope Migration' }).click();

  await expect(page.getByText('Destination authorization expired')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Account Resources/ })).toHaveCount(0);
  await expect.poll(() => clearRequests).toBe(1);
});

test('stops between migration phases when OAuth lifetime falls below the phase-two budget', async ({ page }) => {
  const browserNow = new Date('2026-07-31T12:00:00Z');
  await page.clock.install({ time: browserNow });
  await seedWizard(page, 3);
  const expiresAt = browserNow.getTime() + 36 * 60 * 1000;
  await mockOAuthSession(page, {
    source: connected('source', expiresAt),
    destination: connected('destination', expiresAt),
  });
  await mockAccountLookups(page);

  let releaseAccountPhase: (() => void) | undefined;
  const accountPhaseHeld = new Promise<void>((resolve) => { releaseAccountPhase = resolve; });
  let accountPhaseRequests = 0;
  let zonePhaseRequests = 0;
  await page.route('**/api/migrate/account-resources', async (route) => {
    accountPhaseRequests++;
    assertOAuthRequest(route.request().headers());
    await accountPhaseHeld;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"done","report":{"summary":{"total":0,"verified":0,"failed":0}}}\n\n',
    });
  });
  await page.route('**/api/migrate/stream', async (route) => {
    zonePhaseRequests++;
    await route.fulfill({ status: 500, body: 'must not start' });
  });

  await page.goto('/?step=3&oauth_result=connected&oauth_role=source');
  await page.getByLabel('Confirm destination account').check();
  await page.getByLabel('Confirm destination zone').check();
  await page.getByRole('button', { name: 'Run migration' }).click();
  await expect.poll(() => accountPhaseRequests).toBe(1);
  await page.clock.fastForward(17 * 60 * 1000);
  releaseAccountPhase?.();

  await expect(page.getByText('Source authorization expired')).toBeVisible();
  expect(zonePhaseRequests).toBe(0);
});

test('handles a typed SSE reauthorization event by clearing the role and showing reconnect UI', async ({ page }) => {
  await mockOAuthSession(page, {
    source: connected('source'),
    destination: connected('destination'),
  });
  await mockAccountLookups(page);
  let clearRequests = 0;
  await page.route('**/api/oauth/clear', async (route) => {
    clearRequests++;
    assertOAuthRequest(route.request().headers());
    expect(route.request().postDataJSON()).toEqual({ role: 'source' });
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/export/stream', async (route) => {
    assertOAuthRequest(route.request().headers());
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"reauthorization_required","role":"source","reason":"oauth_reauthorization_required"}\n\n',
    });
  });

  await page.goto('/?oauth_result=connected&oauth_role=source');
  await page.getByLabel('Account', { exact: true }).selectOption('source-account');
  await page.getByLabel('Zone', { exact: true }).first().selectOption('source-zone');
  await page.getByRole('button', { name: 'Export Curated JSON' }).click();

  await expect(page.getByText('Source authorization expired')).toBeVisible();
  await expect.poll(() => clearRequests).toBe(1);
});

test('settles the analytics probe and reconnects source authorization on a typed SSE event', async ({ page }) => {
  await seedWizard(page, 1);
  await mockOAuthSession(page, {
    source: connected('source'),
    destination: connected('destination'),
  });
  let clearRequests = 0;
  await page.route('**/api/oauth/clear', async (route) => {
    clearRequests++;
    expect(route.request().postDataJSON()).toEqual({ role: 'source' });
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/analytics/probe/stream', async (route) => {
    assertOAuthRequest(route.request().headers());
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"reauthorization_required","role":"source","reason":"oauth_reauthorization_required"}\n\n',
    });
  });

  await page.goto('/?step=1&oauth_result=connected&oauth_role=source');
  await page.getByRole('button', { name: /Archive source analytics/ }).click();

  await expect(page.getByText('Source authorization expired')).toBeVisible();
  await expect(page.getByText(/Couldn.t detect datasets/)).toBeVisible();
  await expect.poll(() => clearRequests).toBe(1);
});

test('settles analytics capture and reconnects source authorization on a typed SSE event', async ({ page }) => {
  await seedWizard(page, 3);
  await mockOAuthSession(page, {
    source: connected('source'),
    destination: connected('destination'),
  });
  let clearRequests = 0;
  await page.route('**/api/oauth/clear', async (route) => {
    clearRequests++;
    expect(route.request().postDataJSON()).toEqual({ role: 'source' });
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/analytics/export/stream', async (route) => {
    assertOAuthRequest(route.request().headers());
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"reauthorization_required","role":"source","reason":"oauth_reauthorization_required"}\n\n',
    });
  });
  await page.route('**/api/migrate/account-resources', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: 'data: {"type":"done","report":{"summary":{"total":0,"verified":0,"failed":0}}}\n\n',
  }));

  await page.goto('/?step=3&oauth_result=connected&oauth_role=source');
  await page.getByLabel('Confirm destination account').check();
  await page.getByLabel('Confirm destination zone').check();
  await page.getByRole('button', { name: 'Run migration' }).click();

  await expect(page.getByText('Source authorization expired')).toBeVisible();
  await expect.poll(() => clearRequests).toBe(1);
});

test('rejects an oversized cookie request and accepts the same UI flow after cookie cleanup', async ({ context, page }) => {
  const oauthCookieNames = [
    '__Host-tz-oauth-source-transaction',
    '__Host-tz-oauth-source-grant',
    '__Host-tz-oauth-destination-transaction',
    '__Host-tz-oauth-destination-grant',
  ];
  await context.addCookies(oauthCookieNames.map((name) => ({
    name,
    value: 'x'.repeat(3500),
    url: 'https://127.0.0.1:5173',
    secure: true,
  })));
  await page.route('**/api/oauth/config', (route) => route.fulfill({ json: { enabled: true } }));
  let rejectedOversized = false;
  await page.route('**/api/oauth/status', async (route) => {
    const oauthCookies = (route.request().headers().cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => oauthCookieNames.some((name) => part.startsWith(`${name}=`)))
      .join('; ');
    const cookieBytes = new TextEncoder().encode(oauthCookies).byteLength;
    if (cookieBytes > 12_000) {
      rejectedOversized = true;
      await route.fulfill({ status: 400, json: { error: 'oauth_cookie_header_too_large' } });
      return;
    }
    await route.fulfill({ json: { roles: { source: connected('source'), destination: { connected: false } } } });
  });

  await page.goto('/?oauth_result=connected&oauth_role=source');
  await expect(page.getByRole('button', { name: 'Authorize source' })).toBeEnabled();
  expect(rejectedOversized).toBe(true);

  await clearContextCookies(context);
  await page.reload();
  await expect(page.getByText(/Connected until/).first()).toBeVisible();
});

test('clears browser session state when provider revocation fails during logout', async ({ page }) => {
  await mockOAuthSession(page, {
    source: connected('source'),
    destination: connected('destination'),
  });
  let logoutRequests = 0;
  await page.route('**/api/oauth/logout', async (route) => {
    logoutRequests++;
    assertOAuthRequest(route.request().headers());
    await route.fulfill({ status: 503, json: { error: 'oauth_revocation_failed' } });
  });

  await page.goto('/?oauth_result=connected&oauth_role=source');
  await expect(page.evaluate((key) => sessionStorage.getItem(key), NONCE_KEY)).resolves.toBeTruthy();
  await page.getByRole('button', { name: 'Log out of OAuth session' }).click();

  await expect(page.getByRole('button', { name: 'Authorize source' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Authorize destination' })).toBeEnabled();
  await expect(page.evaluate((key) => sessionStorage.getItem(key), NONCE_KEY)).resolves.toBeNull();
  expect(logoutRequests).toBe(1);
});

test('discloses that Durable Object state copying requires explicit manual credentials in OAuth mode', async ({ page }) => {
  await seedWizard(page, 1, true);
  await mockOAuthSession(page, {
    source: connected('source'),
    destination: connected('destination'),
  });
  await mockAccountLookups(page);

  await page.goto('/?step=1&oauth_result=connected&oauth_role=source');
  await expect(page.getByText('Durable Objects', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Expand Durable Objects' }).click();
  await expect(page.getByText(/Durable Object state copying requires elevated source write access/)).toBeVisible();
  await expect(page.getByText(/Use explicit manual credentials to copy stored state/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Enable data migration' })).toBeDisabled();

  await page.evaluate(() => sessionStorage.setItem('tz_authMode', 'manual'));
  await page.reload();
  await page.getByRole('button', { name: 'Expand Durable Objects' }).click();
  await expect(page.getByText(/Durable Object state copying requires elevated source write access/)).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Enable data migration' })).toBeEnabled();
});
