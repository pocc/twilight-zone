import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const envModule = await import('../scripts/e2e-env.mjs');

describe('e2e-env', () => {
  it('loads required Playwright credentials from .env.test', () => {
    const root = mkdtempSync(join(tmpdir(), 'tz-env-test-'));
    try {
      writeFileSync(join(root, '.env.test'), [
        'CF_API_KEY=key-from-file',
        'CF_API_EMAIL=user@example.com',
        'CF_ZONE_ID=zone-id',
        'CF_ACCOUNT_ID=source-account',
        'CF_TARGET_ACCOUNT_ID=target-account',
        'SOURCE_DOMAIN=enttest.example.com',
        'DEST_DOMAIN=enttest.example.com',
      ].join('\n'));

      const result = envModule.getE2eEnv({ env: {}, root });

      expect(result.missing).toEqual([]);
      expect(result.values.CF_API_KEY).toBe('key-from-file');
      expect(result.values.CF_ACCOUNT_ID).toBe('source-account');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lets shell environment values override .env.test values', () => {
    const root = mkdtempSync(join(tmpdir(), 'tz-env-test-'));
    try {
      writeFileSync(join(root, '.env.test'), [
        'CF_API_KEY=key-from-file',
        'CF_API_EMAIL=user@example.com',
        'CF_ZONE_ID=zone-id',
        'CF_ACCOUNT_ID=source-account',
        'CF_TARGET_ACCOUNT_ID=target-account',
        'SOURCE_DOMAIN=enttest.example.com',
        'DEST_DOMAIN=enttest.example.com',
      ].join('\n'));

      const result = envModule.getE2eEnv({ env: { CF_API_KEY: 'key-from-shell' }, root });

      expect(result.missing).toEqual([]);
      expect(result.values.CF_API_KEY).toBe('key-from-shell');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports every missing required value and points to .env.test', () => {
    const result = envModule.getE2eEnv({ env: {}, root: '/repo' });
    const message = envModule.formatMissingE2eEnvMessage(result.missing, result.envFilePath);

    expect(result.missing).toContain('CF_API_KEY');
    expect(result.missing).toContain('CF_TARGET_ACCOUNT_ID');
    expect(message).toContain('Missing required e2e environment variables:');
    expect(message).toContain('  - CF_API_KEY');
    expect(message).toContain('/repo/.env.test');
  });
});
