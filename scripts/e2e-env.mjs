import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_E2E_ENV = [
  'CF_API_KEY',
  'CF_API_EMAIL',
  'CF_ZONE_ID',
  'CF_ACCOUNT_ID',
  'CF_TARGET_ACCOUNT_ID',
  'SOURCE_DOMAIN',
  'DEST_DOMAIN',
];

export function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return parseEnvFile(fs.readFileSync(filePath, 'utf8'));
}

export function formatMissingE2eEnvMessage(missing, envFilePath) {
  return [
    'Missing required e2e environment variables:',
    ...missing.map(name => `  - ${name}`),
    '',
    `Set them in your shell or in ${envFilePath}.`,
    'The Playwright migration harness needs Cloudflare API credentials plus source/destination account and zone context before it can run.',
  ].join('\n');
}

export function getE2eEnv({ env = process.env, root = process.cwd(), envFile = '.env.test' } = {}) {
  const envFilePath = path.join(root, envFile);
  const fileEnv = loadEnvFile(envFilePath);
  const merged = { ...fileEnv, ...env };
  const missing = REQUIRED_E2E_ENV.filter(name => !String(merged[name] ?? '').trim());

  return {
    values: merged,
    missing,
    envFilePath,
  };
}
