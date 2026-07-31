import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wrangler = readFileSync('wrangler.toml', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const security = readFileSync('docs/SECURITY.md', 'utf8');

describe('OAuth operations documentation', () => {
  it('ships disabled-by-default placeholder configuration without committing the cookie key as a variable', () => {
    expect(wrangler).toContain('OAUTH_ENABLED = "false"');
    expect(wrangler).toContain('OAUTH_CLIENT_ID = "replace-with-oauth-client-id"');
    expect(wrangler).toContain('OAUTH_REDIRECT_URI = "https://your-deployment.example.com/api/oauth/callback"');
    expect(wrangler).toContain('OAUTH_ALLOWED_ORIGIN = "https://your-deployment.example.com"');
    expect(wrangler).not.toMatch(/^OAUTH_COOKIE_KEY\s*=/m);
  });

  it('documents exact provider and Worker endpoints, variables, secret setup, session behavior, and v1 isolation', () => {
    for (const value of [
      'https://dash.cloudflare.com/oauth2/auth',
      'https://dash.cloudflare.com/oauth2/token',
      'https://dash.cloudflare.com/oauth2/revoke',
      '/api/oauth/config', '/api/oauth/start', '/api/oauth/callback', '/api/oauth/status',
      '/api/oauth/clear', '/api/oauth/logout', '/api/migrate/respond',
      'OAUTH_ENABLED', 'OAUTH_CLIENT_ID', 'OAUTH_COOKIE_KEY_ID', 'OAUTH_ALLOWED_ORIGIN',
      'OAUTH_REDIRECT_URI', 'OAUTH_SOURCE_SCOPES', 'OAUTH_DESTINATION_SCOPES',
      'npx wrangler secret put OAUTH_COOKIE_KEY',
      '/api/v1',
    ]) expect(readme).toContain(value);
    expect(readme).toMatch(/expir/i);
    expect(readme).toMatch(/key rotation/i);
    expect(readme).toMatch(/manual credentials/i);
    expect(security).toMatch(/OAuth session/i);
    expect(security).toMatch(/HttpOnly/i);
    expect(security).toMatch(/key rotation/i);
  });

  it('forbids OAuth enablement until every Story 013 live gate is recorded', () => {
    expect(readme).toContain('Do not set `OAUTH_ENABLED=true`');
    expect(readme).toContain('No real OAuth client has been validated');
    for (const requirement of [
      'Scopes:',
      'Callback registration:',
      'Callback query logging:',
      'Token lifetime:',
      'Cookie sizes:',
      'Revocation:',
      'Source reads and write denial:',
      'Destination reads and writes:',
      '/api/check-capabilities',
      'Expiry and reauthorization:',
      'Logout and revocation failure:',
    ]) expect(readme).toContain(requirement);
    expect(readme).toContain('3800 bytes');
    expect(readme).toContain('12000 bytes');
    for (const prohibitedEvidence of [
      'authorization code', 'state', 'PKCE verifier', 'PKCE challenge', 'access token',
      'nonce', 'cookie values', 'cookie headers', 'secrets',
    ]) expect(readme.toLowerCase()).toContain(prohibitedEvidence.toLowerCase());
    expect(readme).toContain('Sanitized evidence template');
  });
});
