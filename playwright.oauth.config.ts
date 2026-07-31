import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  reporter: 'line',
  outputDir: 'test/e2e-migrations/oauth-step0-layout',
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
