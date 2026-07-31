import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser-local',
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  outputDir: 'test/e2e-migrations/oauth-local-provider',
  use: { baseURL: 'http://localhost:5173', headless: true },
  webServer: [
    {
      command: 'node test/fixtures/oauth-local-provider.ts',
      url: 'http://127.0.0.1:4174/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --config vite.oauth-local.config.ts --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: 'chromium', use: { viewport: { width: 1440, height: 900 } } }],
});
