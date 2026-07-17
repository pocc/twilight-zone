import { describe, expect, it } from 'vitest';
import { buildMaxConfigPreview } from '../src/maxconfig-preview';

describe('buildMaxConfigPreview', () => {
  it('mirrors safe gap-analysis resources that default MaxConfig applies', () => {
    const preview = buildMaxConfigPreview('zone-id', 'example.com', 'account-id', 'Account');

    expect(preview.managedHeaders).toEqual({
      managed_request_headers: expect.arrayContaining([
        expect.objectContaining({ enabled: true }),
      ]),
      managed_response_headers: expect.arrayContaining([
        expect.objectContaining({ enabled: true }),
      ]),
    });
    expect(preview.urlNormalization).toEqual({ type: 'cloudflare', scope: 'incoming' });
    expect(preview.regionalTieredCache).toEqual({ value: 'on' });
    expect(preview.originPostQuantum).toEqual({ value: 'preferred' });
    expect(preview.acmTotalTls).toEqual({ enabled: true, certificate_authority: 'lets_encrypt' });
    expect(preview.contentUploadScanSettings).toEqual({ enabled: true });
    expect(preview.leakedCredentialChecksStatus).toEqual({ enabled: true });
    expect(preview.waitingRoomSettings).toMatchObject({ search_engine_crawler_bypass: true });
  });

  it('previews the persistent Page Rule created by the MaxConfig API endpoint pass', () => {
    const preview = buildMaxConfigPreview('zone-id', 'example.com', 'account-id', 'Account');

    expect(preview.pageRules).toEqual([
      expect.objectContaining({
        targets: [{ target: 'url', constraint: { operator: 'matches', value: '*fuzz-test.example.com/*' } }],
        actions: [{ id: 'browser_cache_ttl', value: 14400 }],
        status: 'active',
      }),
    ]);
  });
});
