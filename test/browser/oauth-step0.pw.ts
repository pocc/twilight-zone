import { expect, test } from '@playwright/test';

test('renders operable OAuth controls without page overflow', async ({ page, baseURL }) => {
  const startedRoles: string[] = [];
  await page.route('**/api/oauth/config', (route) => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/oauth/status', (route) => route.fulfill({
    json: { roles: { source: { connected: false }, destination: { connected: false } } },
  }));
  await page.route('**/api/oauth/start', async (route) => {
    const body = route.request().postDataJSON() as { role?: string };
    startedRoles.push(body.role ?? '');
    await route.fulfill({ json: { authorizationUrl: `${baseURL}/?oauth_probe=${body.role}` } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'OAuth' }).first().click();
  await expect(page.getByText('Source authorization')).toBeVisible();
  await expect(page.getByText('Destination authorization')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Authorize source' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Authorize destination' })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'Authorize source' }).click();
  await expect(page).toHaveURL(/oauth_probe=source/);
  expect(startedRoles).toEqual(['source']);

  await page.goto('/');
  await page.getByRole('button', { name: 'OAuth' }).first().click();
  await page.getByRole('button', { name: 'Authorize destination' }).click();
  await expect(page).toHaveURL(/oauth_probe=destination/);
  expect(startedRoles).toEqual(['source', 'destination']);
});

test('surfaces destination reauthorization from the existing-zone advisory probe', async ({ page }) => {
  let destinationZoneRequests = 0;
  await page.route('**/api/oauth/config', (route) => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/oauth/status', (route) => route.fulfill({
    json: {
      roles: {
        source: { connected: true, expiresAt: Date.now() + 3_600_000, scopes: ['account:read', 'zone:read'] },
        destination: { connected: true, expiresAt: Date.now() + 3_600_000, scopes: ['account:read', 'zone:edit'] },
      },
    },
  }));
  await page.route('**/api/accounts', async (route) => {
    const body = route.request().postDataJSON() as { oauthRole?: string };
    const destination = body.oauthRole === 'destination';
    await route.fulfill({ json: { accounts: [{ id: destination ? 'dest-account' : 'source-account', name: destination ? 'Destination' : 'Source' }] } });
  });
  await page.route('**/api/zones', async (route) => {
    const body = route.request().postDataJSON() as { oauthRole?: string };
    if (body.oauthRole === 'source') {
      await route.fulfill({ json: { zones: [{ id: 'source-zone', name: 'source.example.com', status: 'active' }] } });
      return;
    }
    destinationZoneRequests++;
    if (destinationZoneRequests === 1) {
      await route.fulfill({ json: { zones: [] } });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'oauth_reauthorization_required', role: 'destination' }),
    });
  });
  await page.route('**/api/available-plans', (route) => route.fulfill({ json: { plans: [], planCounts: {} } }));
  await page.route('**/api/check-blockers', (route) => route.fulfill({ json: { blockers: [] } }));

  await page.goto('/');
  await page.getByRole('button', { name: 'OAuth' }).first().click();
  await page.getByLabel('Account', { exact: true }).selectOption('source-account');
  await page.getByLabel('Zone', { exact: true }).first().selectOption('source-zone');
  await page.getByLabel('Destination Account').selectOption('dest-account');

  await expect(page.getByText('Destination authorization expired')).toBeVisible();
  expect(destinationZoneRequests).toBeGreaterThan(1);
});
