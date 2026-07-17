import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from '../src/api';
import { deployWorkers } from '../src/migrate/workers-deploy';
import { createEmptyReport } from '../src/migrate/setup';
import type { ZoneExport, ReportSection, CFWorkerBinding } from '../src/types';

// Regression for e2e run 2026-06-08 #001/#002 (assertNoUnexpectedFailures):
// `maxconfig-zone-worker` landed as a FAILED row with CF code 10085
// "R2 bucket 'maxconfig-r2-bucket' not found" because the ACCOUNT-resources
// deploy path (deployWorkers) never called filterBindingsByCapGap. Only the
// zone-side path (batch2.ts) did. When R2 is a capability gap on dest, the R2
// binding must be dropped from the upload and acknowledged — not hard-fail.

function makeDeps(skipFields: Set<string>) {
  return {
    destAuth: 'token' as const,
    destAccountId: 'a'.repeat(32),
    skipFields,
    capabilities: null,
    kvIdMap: new Map<string, string>(),
    d1IdMap: new Map<string, string>(),
    hyperdriveIdMap: new Map<string, string>(),
    secretsStoreIdMap: new Map<string, string>(),
    workerSecrets: {},
    log: () => {},
    trackSection: (s: ReportSection) => s,
    onItemDone: () => {},
    bumpCompletedItems: () => {},
  };
}

function makeExport(bindings: CFWorkerBinding[]): ZoneExport {
  return {
    zone: { name: 'example.com' },
    workers: [{ id: 'maxconfig-zone-worker', script: 'export default {}', bindings }],
    r2Buckets: [],
    kvNamespaces: [],
    d1Databases: [],
    queues: [],
    workerRoutes: [],
  } as unknown as ZoneExport;
}

describe('deployWorkers — capability-gap worker bindings (account-resources path)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('drops a cap-gapped R2 binding before upload and acknowledges it (no 10085 failure)', async () => {
    let uploadedBindings: CFWorkerBinding[] | undefined;
    const uploadSpy = vi
      .spyOn(api, 'uploadWorkerScript')
      .mockImplementation(async (_auth, _acct, _id, _script, bindings) => {
        uploadedBindings = bindings as CFWorkerBinding[];
        return {} as never;
      });

    const report = createEmptyReport({ zone: { name: 'example.com' } }, 'example.com', 'a'.repeat(32));
    const exportData = makeExport([
      { name: 'BUCKET', type: 'r2_bucket', bucket_name: 'maxconfig-r2-bucket' } as CFWorkerBinding,
      { name: 'JSON', type: 'json', json: '{}' } as unknown as CFWorkerBinding,
    ]);

    await deployWorkers(exportData, report, makeDeps(new Set(['r2Buckets'])));

    // The worker uploaded successfully exactly once...
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    // ...WITHOUT the R2 binding (so CF never returns 10085).
    expect(uploadedBindings?.some(b => b.type === 'r2_bucket')).toBe(false);
    expect(uploadedBindings?.some(b => b.type === 'json')).toBe(true);

    // Workers section reports success, NOT a failure (Principle 1).
    const workersSec = report.sections.find(s => s.name === 'Workers')!;
    expect(workersSec.failed).toBe(0);
    expect(workersSec.success).toBe(1);

    // The dropped binding is surfaced as an acknowledged cap-gap row.
    const capGapSec = report.sections.find(s => s.name === 'Worker Bindings (Capability Gap)')!;
    expect(capGapSec).toBeDefined();
    expect(capGapSec.acknowledged).toBe(1);
    expect(capGapSec.items[0].status).toBe('acknowledged');
    expect(capGapSec.items[0].name).toContain('r2_bucket');
    expect(report.errors).toHaveLength(0);
  });

  it('keeps the R2 binding when R2 is NOT a capability gap (no over-stripping)', async () => {
    let uploadedBindings: CFWorkerBinding[] | undefined;
    vi.spyOn(api, 'uploadWorkerScript').mockImplementation(async (_auth, _acct, _id, _script, bindings) => {
      uploadedBindings = bindings as CFWorkerBinding[];
      return {} as never;
    });
    // R2 bucket exists on dest, so auto-create is attempted; stub it.
    vi.spyOn(api, 'createR2Bucket').mockResolvedValue({} as never);

    const report = createEmptyReport({ zone: { name: 'example.com' } }, 'example.com', 'a'.repeat(32));
    const exportData = makeExport([
      { name: 'BUCKET', type: 'r2_bucket', bucket_name: 'maxconfig-r2-bucket' } as CFWorkerBinding,
    ]);

    await deployWorkers(exportData, report, makeDeps(new Set()));

    expect(uploadedBindings?.some(b => b.type === 'r2_bucket')).toBe(true);
    expect(report.sections.find(s => s.name === 'Worker Bindings (Capability Gap)')).toBeUndefined();
  });
});
