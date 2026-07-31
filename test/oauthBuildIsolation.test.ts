import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const fixtureCookieKey = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

const build = (extraEnv: NodeJS.ProcessEnv = {}, args: string[] = []) =>
  spawnSync('npm', ['run', 'build', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });

const readTree = (directory: string): string =>
  readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? readTree(path) : readFileSync(path, 'utf8');
    })
    .join('\n');

describe('production OAuth build isolation', () => {
  it('rejects the local-provider config override in a production build', () => {
    const result = build({ OAUTH_E2E_CONFIG: './test/fixtures/wrangler.oauth-local.toml' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'OAUTH_E2E_CONFIG is test-only; use vite.oauth-local.config.ts',
    );
  }, 120_000);

  it('rejects production builds through the dedicated local-provider config', () => {
    const result = build({}, ['--', '--config', 'vite.oauth-local.config.ts']);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'vite.oauth-local.config.ts is restricted to the local OAuth dev server',
    );
  }, 120_000);

  it('keeps the local-provider cookie key out of normal production artifacts', () => {
    const result = build();

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readTree(join(process.cwd(), 'dist'))).not.toContain(fixtureCookieKey);
  }, 120_000);
});
