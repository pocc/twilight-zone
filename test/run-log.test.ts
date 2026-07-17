import { describe, it, expect } from 'vitest';
import {
  redactPII,
  buildRunLogRecord,
  isSuccessfulZoneMigration,
  logMigrationRun,
  logPresetRun,
  readStats,
  RUN_LOG_SCHEMA_VERSION,
  ESTIMATED_HOURS_PER_MIGRATION,
  type RunLogBindings,
} from '../src/migrate/run-log';
import type { MigrationReport } from '../src/types';

// ── In-memory KV mock (get/put/list with metadata + cursor pagination) ──
function makeKV() {
  const store = new Map<string, { value: string; metadata?: Record<string, unknown> }>();
  const kv = {
    store,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, opts?: { metadata?: Record<string, unknown> }) {
      store.set(key, { value, metadata: opts?.metadata });
    },
    async list(opts?: { prefix?: string; limit?: number; cursor?: string }) {
      const prefix = opts?.prefix ?? '';
      const all = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, v]) => ({ name, metadata: v.metadata }));
      const limit = opts?.limit ?? 1000;
      const start = opts?.cursor ? parseInt(opts.cursor, 10) : 0;
      const page = all.slice(start, start + limit);
      const nextStart = start + limit;
      return nextStart >= all.length
        ? { keys: page, list_complete: true as const }
        : { keys: page, list_complete: false as const, cursor: String(nextStart) };
    },
  };
  return kv;
}

// A report seeded with PII in every free-text surface that survives the allowlist.
function reportWithPII(overrides: Partial<MigrationReport> = {}): MigrationReport {
  return {
    timestamp: '2026-05-30T12:34:56.000Z',
    sourceZone: 'source.example.com',
    destZone: 'dest.example.com',
    destAccountId: '0123456789abcdef0123456789abcdef',
    summary: { total: 3, success: 2, failed: 1, skipped: 0 },
    sections: [
      {
        name: 'Firewall Access Rules',
        total: 1,
        success: 0,
        failed: 1,
        skipped: 0,
        items: [
          {
            name: 'ip:1.2.3.4',
            status: 'failed',
            error: 'rule for 10.0.0.1 rejected by admin@corp.com',
            reason: 'blocked for ops@example.com',
            detail: 'see 192.168.1.1',
          },
        ],
      },
    ],
    errors: [{ resource: 'DNS', name: 'mail@example.com', error: 'failed for 203.0.113.7' }],
    conflicts: [],
    warnings: ['notify ops@example.com about 198.51.100.2'],
    manualActions: ['verify foo@corp.com and 2001:db8:85a3::8a2e:370:7334'],
    newNameservers: ['ns1.cloudflare.com'],
    ...overrides,
  };
}

describe('redactPII', () => {
  it('redacts email addresses', () => {
    expect(redactPII('contact admin@corp.com now')).toBe('contact [email] now');
  });

  it('redacts IPv4 addresses', () => {
    expect(redactPII('blocked 10.0.0.1 and 203.0.113.7')).toBe('blocked [ip] and [ip]');
  });

  it('redacts IPv6 addresses', () => {
    expect(redactPII('peer 2001:db8:85a3::8a2e:370:7334 down')).toBe('peer [ip] down');
  });

  it('does NOT redact HH:MM:SS timestamps as IPv6', () => {
    expect(redactPII('error at 12:34:56 today')).toBe('error at 12:34:56 today');
  });

  it('leaves zone names and account ids intact', () => {
    const s = 'zone dest.example.com acct 0123456789abcdef0123456789abcdef';
    expect(redactPII(s)).toBe(s);
  });

  it('returns empty/falsy input unchanged', () => {
    expect(redactPII('')).toBe('');
  });
});

describe('buildRunLogRecord', () => {
  it('redacts PII in all free-text fields but keeps zone identity', () => {
    const rec = buildRunLogRecord(reportWithPII(), { kind: 'zone', toolVersion: '2.0.0' });

    // Zone identity kept verbatim.
    expect(rec.sourceZone).toBe('source.example.com');
    expect(rec.destZone).toBe('dest.example.com');
    expect(rec.destAccountId).toBe('0123456789abcdef0123456789abcdef');

    // Free-text redacted.
    const item = rec.sections[0].items[0];
    expect(item.name).toBe('ip:[ip]');
    expect(item.error).toBe('rule for [ip] rejected by [email]');
    expect(item.reason).toBe('blocked for [email]');
    expect(item.detail).toBe('see [ip]');
    expect(rec.errors[0].name).toBe('[email]');
    expect(rec.errors[0].error).toBe('failed for [ip]');
    expect(rec.warnings[0]).toBe('notify [email] about [ip]');
    expect(rec.manualActions[0]).toBe('verify [email] and [ip]');

    // No email '@' or raw dotted-quad survives anywhere in the record.
    const serialized = JSON.stringify(rec);
    expect(serialized).not.toContain('@');
    expect(serialized).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });

  it('excludes verification.destExport entirely', () => {
    const rec = buildRunLogRecord(
      reportWithPII({
        verification: {
          // A destExport carrying PII — must never appear in the record.
          destExport: { zone: { name: 'leak.example.com' } } as never,
          diff: { discrepancies: [] },
          timestamp: '2026-05-30T12:35:00.000Z',
        },
      }),
      { kind: 'zone', toolVersion: '2.0.0' },
    );
    expect('verification' in rec).toBe(false);
    expect(JSON.stringify(rec)).not.toContain('leak.example.com');
  });

  it('drops IdP display names, keeps dest id + type', () => {
    const rec = buildRunLogRecord(
      reportWithPII({ migratedIdentityProviders: [{ destId: 'idp-1', name: 'Acme Okta (secret)', type: 'okta' }] }),
      { kind: 'zone', toolVersion: '2.0.0' },
    );
    expect(rec.migratedIdentityProviders).toEqual([{ destId: 'idp-1', type: 'okta' }]);
    expect(JSON.stringify(rec)).not.toContain('Acme Okta');
  });

  it('redacts PII in createdResources string values', () => {
    const created = { workers: [], kvNamespaces: [], r2Buckets: [], d1Databases: [], queues: [], doNamespaces: [], dnsRecords: [], pageRules: [], rulesets: [], accessApps: [], emailRules: [], customHostnames: [], turnstileWidgets: [] };
    const rec = buildRunLogRecord(
      reportWithPII({
        createdResources: {
          zoneId: 'zone-abc',
          ...created,
          // An author-chosen bucket name that embeds an email — must be redacted.
          r2Buckets: ['backups for admin@corp.com', 'opaque-bucket-id'],
        },
      }),
      { kind: 'zone', toolVersion: '2.0.0' },
    );
    expect(rec.createdResources?.r2Buckets).toEqual(['backups for [email]', 'opaque-bucket-id']);
    expect(JSON.stringify(rec)).not.toContain('@');
  });

  it('redacts PII in doMigrationResults free-text (error/workerName/className)', () => {
    const rec = buildRunLogRecord(
      reportWithPII({
        doMigrationResults: [
          {
            workerName: 'worker ops@corp.com',
            className: 'Counter',
            sourceNamespaceId: 'src-ns',
            destNamespaceId: 'dst-ns',
            objectsSynced: 3,
            objectsFailed: 1,
            status: 'partial',
            error: 'sync to 203.0.113.7 failed for ops@example.com',
          },
        ],
      }),
      { kind: 'zone', toolVersion: '2.0.0' },
    );
    const r = rec.doMigrationResults![0];
    expect(r.workerName).toBe('worker [email]');
    expect(r.error).toBe('sync to [ip] failed for [email]');
    // Non-free-text fields are preserved.
    expect(r.objectsSynced).toBe(3);
    expect(r.status).toBe('partial');
    const serialized = JSON.stringify(rec);
    expect(serialized).not.toContain('@');
    expect(serialized).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });

  it('stamps schema version and metadata', () => {
    const rec = buildRunLogRecord(reportWithPII(), { kind: 'account-resources', toolVersion: '2.0.0', runId: 'fixed-id' });
    expect(rec.schemaVersion).toBe(RUN_LOG_SCHEMA_VERSION);
    expect(rec.runId).toBe('fixed-id');
    expect(rec.kind).toBe('account-resources');
    expect(rec.toolVersion).toBe('2.0.0');
  });
});

describe('isSuccessfulZoneMigration', () => {
  const created = { workers: [], kvNamespaces: [], r2Buckets: [], d1Databases: [], queues: [], doNamespaces: [], dnsRecords: [], pageRules: [], rulesets: [], accessApps: [], emailRules: [], customHostnames: [], turnstileWidgets: [] };

  it('true for a zone run that created a new zone', () => {
    const r = reportWithPII({ createdResources: { zoneId: 'new-zone', ...created } });
    expect(isSuccessfulZoneMigration(r, 'zone')).toBe(true);
  });

  it('false when no new zone was created', () => {
    expect(isSuccessfulZoneMigration(reportWithPII(), 'zone')).toBe(false);
    const r = reportWithPII({ createdResources: { ...created } });
    expect(isSuccessfulZoneMigration(r, 'zone')).toBe(false);
  });

  it('false for account-resources runs even with a zoneId', () => {
    const r = reportWithPII({ createdResources: { zoneId: 'new-zone', ...created } });
    expect(isSuccessfulZoneMigration(r, 'account-resources')).toBe(false);
  });
});

describe('logMigrationRun', () => {
  const created = { workers: [], kvNamespaces: [], r2Buckets: [], d1Databases: [], queues: [], doNamespaces: [], dnsRecords: [], pageRules: [], rulesets: [], accessApps: [], emailRules: [], customHostnames: [], turnstileWidgets: [] };

  it('no-ops when the binding is absent', async () => {
    // Must not throw when env is undefined or RUN_LOG missing.
    await expect(logMigrationRun(undefined, undefined, reportWithPII(), { kind: 'zone', toolVersion: '2.0.0' })).resolves.toBeUndefined();
    await expect(logMigrationRun({}, undefined, reportWithPII(), { kind: 'zone', toolVersion: '2.0.0' })).resolves.toBeUndefined();
  });

  it('writes a run: key with countable metadata for a successful zone migration', async () => {
    const kv = makeKV();
    const env: RunLogBindings = { RUN_LOG: kv as never };
    await logMigrationRun(env, undefined, reportWithPII({ createdResources: { zoneId: 'z', ...created } }), { kind: 'zone', toolVersion: '2.0.0' });
    const entries = [...kv.store.entries()];
    expect(entries).toHaveLength(1);
    const [key, val] = entries[0];
    expect(key.startsWith('run:')).toBe(true);
    expect(val.metadata?.counts).toBe(true);
    // Stored value is the redacted record — no PII.
    expect(val.value).not.toContain('@');
  });

  it('flags counts:false for runs without a new zone', async () => {
    const kv = makeKV();
    await logMigrationRun({ RUN_LOG: kv as never }, undefined, reportWithPII(), { kind: 'zone', toolVersion: '2.0.0' });
    expect([...kv.store.values()][0].metadata?.counts).toBe(false);
  });

  it('uses ctx.waitUntil when provided', async () => {
    const kv = makeKV();
    const promises: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { promises.push(p); } };
    await logMigrationRun({ RUN_LOG: kv as never }, ctx, reportWithPII(), { kind: 'zone', toolVersion: '2.0.0' });
    expect(promises).toHaveLength(1);
    await Promise.all(promises);
    expect(kv.store.size).toBe(1);
  });

  it('never throws when KV.put rejects', async () => {
    const badKv = { put: () => Promise.reject(new Error('kv down')), get: async () => null, list: async () => ({ keys: [], list_complete: true as const }) };
    await expect(logMigrationRun({ RUN_LOG: badKv as never }, undefined, reportWithPII(), { kind: 'zone', toolVersion: '2.0.0' })).resolves.toBeUndefined();
  });
});

describe('readStats', () => {
  it('returns zeroes when the binding is absent', async () => {
    expect(await readStats(undefined)).toEqual({ zonesMigrated: 0, hoursSaved: 0, hoursPerMigration: ESTIMATED_HOURS_PER_MIGRATION });
  });

  it('counts only countable run entries and derives hours', async () => {
    const kv = makeKV();
    await kv.put('run:a', '{}', { metadata: { counts: true } });
    await kv.put('run:b', '{}', { metadata: { counts: false } });
    await kv.put('run:c', '{}', { metadata: { counts: true } });
    await kv.put('other:x', '{}', { metadata: { counts: true } }); // wrong prefix, ignored
    const stats = await readStats(kv as never);
    expect(stats.zonesMigrated).toBe(2);
    expect(stats.hoursSaved).toBe(2 * ESTIMATED_HOURS_PER_MIGRATION);
    expect(stats.hoursPerMigration).toBe(ESTIMATED_HOURS_PER_MIGRATION);
  });

  it('never counts a preset apply (only api/json/terraform migrations are clones)', async () => {
    const kv = makeKV();
    // A preset that created a new zone still does NOT count — it's not a clone.
    await logPresetRun({ RUN_LOG: kv as never }, undefined, {
      kind: 'maxconfig', destZone: 'new.example.com', createdNewZone: true, failed: 0, toolVersion: '2.0.0',
    });
    await logPresetRun({ RUN_LOG: kv as never }, undefined, {
      kind: 'maxconfig', destZone: 'existing.example.com', createdNewZone: false, failed: 0, toolVersion: '2.0.0',
    });
    await logPresetRun({ RUN_LOG: kv as never }, undefined, {
      kind: 'minconfig', destZone: 'existing.example.com', createdNewZone: false, failed: 0, toolVersion: '2.0.0',
    });
    const stats = await readStats(kv as never);
    expect(stats.zonesMigrated).toBe(0); // presets never count toward "zones cloned"
  });
});

describe('logPresetRun', () => {
  it('no-ops without a binding (never throws)', async () => {
    await expect(logPresetRun(undefined, undefined, {
      kind: 'maxconfig', destZone: 'z', createdNewZone: true, failed: 0, toolVersion: '2.0.0',
    })).resolves.toBeUndefined();
    await expect(logPresetRun({}, undefined, {
      kind: 'minconfig', destZone: 'z', createdNewZone: false, failed: 0, toolVersion: '2.0.0',
    })).resolves.toBeUndefined();
  });

  it('writes a troubleshooting run: entry flagged non-counting, with a redacted destZone', async () => {
    const kv = makeKV();
    await logPresetRun({ RUN_LOG: kv as never }, undefined, {
      kind: 'maxconfig', destZone: 'admin@corp.com.example.com', createdNewZone: true, failed: 2, toolVersion: '2.0.0',
    });
    const entries = [...kv.store.entries()];
    expect(entries).toHaveLength(1);
    const [key, { value, metadata }] = entries[0];
    expect(key.startsWith('run:')).toBe(true);
    // Logged for troubleshooting, but counts:false so it never inflates the total.
    expect(metadata).toMatchObject({ kind: 'maxconfig', counts: false, failed: 2 });
    const rec = JSON.parse(value);
    expect(rec.kind).toBe('maxconfig');
    expect(rec.schemaVersion).toBe(RUN_LOG_SCHEMA_VERSION);
    // destZone is run through redactPII (the leading token here looks like an email).
    expect(rec.destZone).not.toContain('admin@corp.com');
  });

  it('routes a KV put rejection into a swallowed no-throw', async () => {
    const badKv = { put: () => Promise.reject(new Error('kv down')), get: async () => null, list: async () => ({ keys: [], list_complete: true as const }) };
    await expect(logPresetRun({ RUN_LOG: badKv as never }, undefined, {
      kind: 'minconfig', destZone: 'z', createdNewZone: true, failed: 0, toolVersion: '2.0.0',
    })).resolves.toBeUndefined();
  });
});
