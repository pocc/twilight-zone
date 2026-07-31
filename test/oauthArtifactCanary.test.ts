import { describe, expect, it } from 'vitest';

import {
  emptyBrowserArtifactCategories,
  emptyBrowserArtifacts,
  scanSecretCanaries,
  type BrowserArtifacts,
} from './helpers/secretCanary';

const canary = 'local-oauth-access-token-canary';

describe('OAuth browser artifact secret canary scanner', () => {
  it.each([
    ['storage.session', (artifacts: BrowserArtifacts) => { artifacts.storage.session.token = canary; }],
    ['storage.local', (artifacts: BrowserArtifacts) => { artifacts.storage.local.token = canary; }],
    ['logs', (artifacts: BrowserArtifacts) => { artifacts.logs.push({ nested: [canary] }); }],
    ['errors', (artifacts: BrowserArtifacts) => { artifacts.errors.push(`failed: ${canary}`); }],
    ['sse', (artifacts: BrowserArtifacts) => { artifacts.sse.push({ data: { token: canary } }); }],
    ['reports', (artifacts: BrowserArtifacts) => { artifacts.reports.push({ rows: [{ detail: canary }] }); }],
    ['analytics', (artifacts: BrowserArtifacts) => { artifacts.analytics.push({ graphql: { value: canary } }); }],
    ['downloads', (artifacts: BrowserArtifacts) => { artifacts.downloads.push({ name: 'report.json', body: canary }); }],
  ] as const)('detects a nested canary in %s artifacts', (category, inject) => {
    const artifacts = emptyBrowserArtifacts();
    inject(artifacts);

    const findings = scanSecretCanaries(artifacts, [canary]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toContain(category);
    expect(findings[0]?.canary).toBe(canary);
  });

  it('reports no findings for recursively clean artifacts', () => {
    const artifacts = emptyBrowserArtifacts();
    artifacts.logs.push({ nested: ['safe'] });
    artifacts.reports.push({ rows: [{ detail: 'redacted' }] });

    expect(scanSecretCanaries(artifacts, [canary])).toEqual([]);
  });

  it('identifies every artifact category that lacks browser evidence', () => {
    expect(emptyBrowserArtifactCategories(emptyBrowserArtifacts())).toEqual([
      'storage.session',
      'storage.local',
      'logs',
      'errors',
      'sse',
      'reports',
      'analytics',
      'downloads',
    ]);
  });

  it('accepts substantive evidence in every artifact category', () => {
    const artifacts = emptyBrowserArtifacts();
    artifacts.storage.session.nonce = 'safe-session-value';
    artifacts.storage.local.wizard = 'safe-wizard-state';
    artifacts.logs.push({ type: 'info', text: 'migration completed' });
    artifacts.errors.push({ status: 400, body: 'validated rejection' });
    artifacts.sse.push({ body: 'data: {"type":"done"}' });
    artifacts.reports.push({ report: { verified: 1 } });
    artifacts.analytics.push({ status: 400, body: 'invalid zone id' });
    artifacts.downloads.push({ name: 'migration_report.md', body: '# Migration Report' });

    expect(emptyBrowserArtifactCategories(artifacts)).toEqual([]);
  });
});
