import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  generateDryRunPreview,
  generateReportMarkdown,
  getSuggestion,
  getSourceAuth,
  getDestAuth,
  buildManualBindingAcknowledgmentSection,
  buildCapabilityAcknowledgmentSection,
  sanitizeBindingsForUpload,
  filterBindingsByCapGap,
  buildAutoCreatedEmptySection,
  MANUAL_BINDING_TYPE_TO_KEY,
  MANUAL_BINDING_TYPES_REQUIRE_RECONFIG,
  collectExecutedAccountRulesetIds,
  partitionAccountRulesetReferences,
  rewriteExecuteActionTargets,
  deepRewriteStrings,
  findEmbeddedReferences,
  dedupeCertificatePacks,
  computeDeselectedGroups,
  buildDeselectedAcknowledgmentSection,
} from '../src/migrate';
import type { ZoneExport, MigrationReport } from '../src/types';
import { IMPOSSIBLE_TO_MIGRATE } from '../src/types';

describe('migrate.ts', () => {
  describe('export warnings', () => {
    it('surfaces Zone Settings export read failures instead of silently dropping settings', () => {
      const source = readFileSync(fileURLToPath(new URL('../src/migrate/export-zone.ts', import.meta.url)), 'utf8');
      expect(source).toMatch(/fetchAndLog\('Zone Settings'[\s\S]*exportWarnings\.push\(`Zone Settings:/);
    });

    it('surfaces dedicated zone-setting export read failures instead of silently dropping them', () => {
      const source = readFileSync(fileURLToPath(new URL('../src/migrate/export-zone.ts', import.meta.url)), 'utf8');
      expect(source).toMatch(/fetchAndLog\(`Zone Setting: \$\{def\.id\}`[\s\S]*exportWarnings\.push\(`Zone Setting \$\{def\.id\}:/);
    });
  });

  describe('generateDryRunPreview', () => {
    it('generates preview with zone creation', () => {
      const exportData: ZoneExport = {
        zone: { id: 'zone-123', name: 'example.com', name_servers: [], status: 'active', account: { id: 'acc-1', name: 'Test' }, plan: { id: 'free', name: 'Free' } },
        dnsRecords: [],
        settings: [],
        pageRules: [],
        rulesets: [],
        workerRoutes: [],
        loadBalancers: [],
        spectrumApps: [],
        customCertificates: [],
        customHostnames: [],
        firewallRules: [],
        rateLimits: [],
        emailRoutingRules: [],
        waitingRooms: [],
        workers: [],
        pools: [],
        monitors: [],
        accessApps: [],
        accessPolicies: [],
        zarazConfig: null,
        turnstileWidgets: [],
        kvNamespaces: [],
        r2Buckets: [],
        d1Databases: [],
        queues: [],
        durableObjectNamespaces: [],
      };

      const preview = generateDryRunPreview(exportData, 'account-123', 'example.com');
      
      expect(preview.apiCalls).toHaveLength(1);
      expect(preview.apiCalls[0].method).toBe('POST');
      expect(preview.apiCalls[0].endpoint).toBe('/zones');
      expect(preview.summary.total).toBe(1);
    });

    it('includes DNS records in preview', () => {
      const exportData: ZoneExport = {
        zone: { id: 'zone-123', name: 'example.com', name_servers: [], status: 'active', account: { id: 'acc-1', name: 'Test' }, plan: { id: 'free', name: 'Free' } },
        dnsRecords: [
          { id: '1', type: 'A', name: 'www', content: '192.0.2.1', ttl: 1, proxied: true },
          { id: '2', type: 'CNAME', name: 'mail', content: 'mail.example.com', ttl: 1, proxied: false },
        ],
        settings: [],
        pageRules: [],
        rulesets: [],
        workerRoutes: [],
        loadBalancers: [],
        spectrumApps: [],
        customCertificates: [],
        customHostnames: [],
        firewallRules: [],
        rateLimits: [],
        emailRoutingRules: [],
        waitingRooms: [],
        workers: [],
        pools: [],
        monitors: [],
        accessApps: [],
        accessPolicies: [],
        zarazConfig: null,
        turnstileWidgets: [],
        kvNamespaces: [],
        r2Buckets: [],
        d1Databases: [],
        queues: [],
        durableObjectNamespaces: [],
      };

      const preview = generateDryRunPreview(exportData, 'account-123', 'example.com');
      
      expect(preview.apiCalls.length).toBeGreaterThan(1);
      const dnsCall = preview.apiCalls.find(c => c.endpoint.includes('dns_records'));
      expect(dnsCall).toBeDefined();
      expect(dnsCall?.count).toBe(2);
    });

    it('skips read-only settings', () => {
      const exportData: ZoneExport = {
        zone: { id: 'zone-123', name: 'example.com', name_servers: [], status: 'active', account: { id: 'acc-1', name: 'Test' }, plan: { id: 'free', name: 'Free' } },
        dnsRecords: [],
        settings: [
          { id: 'advanced_ddos', value: 'on', editable: false }, // read-only
          { id: 'ssl', value: 'full', editable: true }, // editable
        ],
        pageRules: [],
        rulesets: [],
        workerRoutes: [],
        loadBalancers: [],
        spectrumApps: [],
        customCertificates: [],
        customHostnames: [],
        firewallRules: [],
        rateLimits: [],
        emailRoutingRules: [],
        waitingRooms: [],
        workers: [],
        pools: [],
        monitors: [],
        accessApps: [],
        accessPolicies: [],
        zarazConfig: null,
        turnstileWidgets: [],
        kvNamespaces: [],
        r2Buckets: [],
        d1Databases: [],
        queues: [],
        durableObjectNamespaces: [],
      };

      const preview = generateDryRunPreview(exportData, 'account-123', 'example.com');
      
      const settingsCall = preview.apiCalls.find(c => c.endpoint.includes('settings'));
      expect(settingsCall).toBeDefined();
      expect(settingsCall?.count).toBe(1); // Only the editable one
    });
  });

  describe('generateReportMarkdown', () => {
    it('generates markdown with summary', () => {
      const report: MigrationReport = {
        timestamp: '2026-02-03T00:00:00.000Z',
        sourceZone: 'source.com',
        destZone: 'dest.com',
        destAccountId: 'account-123',
        summary: { total: 10, success: 8, failed: 2, skipped: 0 },
        sections: [],
        errors: [],
        conflicts: [],
        warnings: [],
        manualActions: [],
        newNameservers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
      };

      const markdown = generateReportMarkdown(report);
      
      expect(markdown).toContain('# Zone Migration Report');
      expect(markdown).toContain('source.com');
      expect(markdown).toContain('dest.com');
      expect(markdown).toContain('ns1.cloudflare.com');
      expect(markdown).toContain('ns2.cloudflare.com');
    });

    it('includes errors in markdown', () => {
      const report: MigrationReport = {
        timestamp: '2026-02-03T00:00:00.000Z',
        sourceZone: 'source.com',
        destZone: 'dest.com',
        destAccountId: 'account-123',
        summary: { total: 10, success: 8, failed: 2, skipped: 0 },
        sections: [],
        errors: [
          { resource: 'DNS', name: 'www.example.com', error: 'Record already exists' },
        ],
        conflicts: [],
        warnings: [],
        manualActions: [],
        newNameservers: [],
      };

      const markdown = generateReportMarkdown(report);
      
      expect(markdown).toContain('Errors');
      expect(markdown).toContain('Record already exists');
    });

    it('renders cleanly when destAccessOrg and migratedIdentityProviders are present', () => {
      // Regression: the new
      // MigrationReport fields are purely for the Step 4 IdP test
      // workflow; they MUST NOT change the server-generated markdown
      // (the test subsection is appended client-side at download
      // time via appendIdpTestSubsection).
      const report: MigrationReport = {
        timestamp: '2026-05-25T00:00:00.000Z',
        sourceZone: 'source.com',
        destZone: 'dest.com',
        destAccountId: 'account-123',
        summary: { total: 1, success: 1, failed: 0, skipped: 0 },
        sections: [],
        errors: [],
        conflicts: [],
        warnings: [],
        manualActions: [],
        newNameservers: [],
        destAccessOrg: { auth_domain: 'acme', name: 'Acme Org' },
        migratedIdentityProviders: [
          { destId: 'idp-1', name: 'Corp OIDC', type: 'oidc' },
        ],
      };

      const markdown = generateReportMarkdown(report);

      // Standard summary still renders.
      expect(markdown).toContain('# Zone Migration Report');
      expect(markdown).toContain('source.com');
      // Server-generated markdown does NOT include the optional
      // verification subsection — that's appended client-side.
      expect(markdown).not.toContain('Optional verification');
      expect(markdown).not.toContain('Identity provider login tests');
      // No CRITICAL banner ever.
      expect(markdown).not.toContain('CRITICAL');
    });

    it('includes post-migration checklist', () => {
      const report: MigrationReport = {
        timestamp: '2026-02-03T00:00:00.000Z',
        sourceZone: 'source.com',
        destZone: 'dest.com',
        destAccountId: 'account-123',
        summary: { total: 0, success: 0, failed: 0, skipped: 0 },
        sections: [],
        errors: [],
        conflicts: [],
        warnings: [],
        manualActions: [],
        newNameservers: [],
      };

      const markdown = generateReportMarkdown(report);
      
      expect(markdown).toContain('Post-Migration Checklist');
      expect(markdown).toContain('Update nameservers');
    });

    it('renders Account Rulesets section with success items', () => {
      // Regression for Issue 9: account-scoped rulesets must surface in
      // their own report section so assertAccountRulesetReferenceRemapped
      // (and users) can see them independently of zone-scoped rulesets.
      const report: MigrationReport = {
        timestamp: '2026-02-03T00:00:00.000Z',
        sourceZone: 'source.com',
        destZone: 'dest.com',
        destAccountId: 'account-123',
        summary: { total: 1, success: 1, failed: 0, skipped: 0 },
        sections: [{
          name: 'Account Rulesets',
          total: 1,
          success: 1,
          failed: 0,
          skipped: 0,
          items: [{
            name: 'Twilight Zone Test (http_request_firewall_custom) [src-id-123 → dest-id-456]',
            status: 'success',
          }],
        }],
        errors: [],
        conflicts: [],
        warnings: [],
        manualActions: [],
        newNameservers: [],
      };

      const markdown = generateReportMarkdown(report);

      expect(markdown).toContain('Account Rulesets');
      expect(markdown).toContain('Twilight Zone Test');
      expect(markdown).toContain('src-id-123 → dest-id-456');
      // The assertAccountRulesetReferenceRemapped helper just regex-matches
      // /Account Ruleset/i — verify the literal phrase appears.
      expect(markdown).toMatch(/Account Ruleset/i);
    });
  });

  describe('getSuggestion', () => {
    it('returns permission suggestion for permission errors', () => {
      const suggestion = getSuggestion('DNS', 'Access denied: insufficient permission');
      expect(suggestion).toContain('API token');
      expect(suggestion).toContain('permissions');
    });

    it('returns permission suggestion for forbidden errors', () => {
      const suggestion = getSuggestion('DNS', 'forbidden: not allowed');
      expect(suggestion).toContain('permissions');
    });

    it('returns plan suggestion for plan errors', () => {
      const suggestion = getSuggestion('Workers', 'Feature not available on free plan');
      expect(suggestion).toContain('plan');
    });

    it('returns plan suggestion for not available errors', () => {
      const suggestion = getSuggestion('LoadBalancers', 'Load balancing not available');
      expect(suggestion).toContain('plan');
    });

    it('returns rate limit suggestion for rate limit errors', () => {
      const suggestion = getSuggestion('DNS', 'rate limit exceeded');
      expect(suggestion).toContain('Wait');
      expect(suggestion).toContain('retry');
    });

    it('returns secret suggestion for worker secret errors', () => {
      const suggestion = getSuggestion('Workers', 'Cannot read secret value');
      expect(suggestion).toContain('secret');
      expect(suggestion).toContain('manually');
    });

    it('returns undefined for unknown errors', () => {
      const suggestion = getSuggestion('DNS', 'Unknown error occurred');
      expect(suggestion).toBeUndefined();
    });

    it('does not return secret suggestion for non-Workers resources', () => {
      const suggestion = getSuggestion('DNS', 'Cannot read secret value');
      // Should not match Workers-specific rule
      expect(suggestion).toBeUndefined();
    });
  });

  describe('getSourceAuth', () => {
    it('returns key auth when useApiKey is true with apiKey and apiEmail', () => {
      const config = {
        sourceToken: 'source-token',
        destToken: 'dest-token',
        sourceZoneId: 'zone-1',
        sourceAccountId: 'acc-1',
        destAccountId: 'acc-2',
        dryRun: false,
        useApiKey: true,
        apiKey: 'my-api-key',
        apiEmail: 'user@example.com',
      };
      
      const auth = getSourceAuth(config);
      expect(auth).toEqual({ type: 'key', apiKey: 'my-api-key', email: 'user@example.com' });
    });

    it('returns sourceToken when useApiKey is false', () => {
      const config = {
        sourceToken: 'source-token',
        destToken: 'dest-token',
        sourceZoneId: 'zone-1',
        sourceAccountId: 'acc-1',
        destAccountId: 'acc-2',
        dryRun: false,
        useApiKey: false,
      };
      
      const auth = getSourceAuth(config);
      expect(auth).toBe('source-token');
    });

    it('returns sourceToken when apiKey is missing', () => {
      const config = {
        sourceToken: 'source-token',
        destToken: 'dest-token',
        sourceZoneId: 'zone-1',
        sourceAccountId: 'acc-1',
        destAccountId: 'acc-2',
        dryRun: false,
        useApiKey: true,
        apiEmail: 'user@example.com',
      };
      
      const auth = getSourceAuth(config);
      expect(auth).toBe('source-token');
    });
  });

  describe('getDestAuth', () => {
    it('returns key auth when useApiKey is true with apiKey and apiEmail', () => {
      const config = {
        sourceToken: 'source-token',
        destToken: 'dest-token',
        sourceZoneId: 'zone-1',
        sourceAccountId: 'acc-1',
        destAccountId: 'acc-2',
        dryRun: false,
        useApiKey: true,
        apiKey: 'my-api-key',
        apiEmail: 'user@example.com',
      };
      
      const auth = getDestAuth(config);
      expect(auth).toEqual({ type: 'key', apiKey: 'my-api-key', email: 'user@example.com' });
    });

    it('returns destToken when useApiKey is false', () => {
      const config = {
        sourceToken: 'source-token',
        destToken: 'dest-token',
        sourceZoneId: 'zone-1',
        sourceAccountId: 'acc-1',
        destAccountId: 'acc-2',
        dryRun: false,
        useApiKey: false,
      };
      
      const auth = getDestAuth(config);
      expect(auth).toBe('dest-token');
    });

    it('returns destToken when apiEmail is missing', () => {
      const config = {
        sourceToken: 'source-token',
        destToken: 'dest-token',
        sourceZoneId: 'zone-1',
        sourceAccountId: 'acc-1',
        destAccountId: 'acc-2',
        dryRun: false,
        useApiKey: true,
        apiKey: 'my-api-key',
      };
      
      const auth = getDestAuth(config);
      expect(auth).toBe('dest-token');
    });
  });

  describe('buildManualBindingAcknowledgmentSection', () => {
    it('returns null when no workers have manual bindings', () => {
      const result = buildManualBindingAcknowledgmentSection([
        { id: 'w1', bindings: [{ name: 'KV', type: 'kv_namespace', namespace_id: 'abc' }] },
        { id: 'w2', bindings: [{ name: 'DB', type: 'd1', database_id: 'xyz' }] },
      ]);
      expect(result).toBeNull();
    });

    it('returns null for workers with no bindings array', () => {
      const result = buildManualBindingAcknowledgmentSection([{ id: 'w1' }]);
      expect(result).toBeNull();
    });

    it('builds an acknowledgment section for hyperdrive binding', () => {
      const result = buildManualBindingAcknowledgmentSection([
        { id: 'my-worker', bindings: [{ name: 'DB', type: 'hyperdrive', id: 'src-hyper-id' }] },
      ]);
      expect(result).not.toBeNull();
      expect(result!.total).toBe(1);
      expect(result!.acknowledged).toBe(1);
      expect(result!.failed).toBe(0);
      expect(result!.items[0].status).toBe('acknowledged');
      expect(result!.items[0].name).toContain('my-worker');
      expect(result!.items[0].name).toContain('hyperdrive');
      expect(result!.items[0].name).toContain('"DB"');
    });

    it('classifies entitlement-only bindings differently from reconfig-required ones', () => {
      const result = buildManualBindingAcknowledgmentSection([
        { id: 'w-ai', bindings: [{ name: 'AI', type: 'ai' }] },
        { id: 'w-vec', bindings: [{ name: 'VEC', type: 'vectorize', index_name: 'foo' }] },
      ]);
      const ai = result!.items.find(i => i.name.includes('w-ai'));
      const vec = result!.items.find(i => i.name.includes('w-vec'));
      // ai: entitlement-only, resolves automatically
      expect(ai!.error).toContain('resolves automatically');
      // vectorize: requires manual reconfiguration of the binding
      expect(vec!.error).toContain('must be reconfigured');
    });

    it('deduplicates same worker+type+binding-name across calls', () => {
      const dupBinding = { name: 'X', type: 'hyperdrive', id: 'a' };
      const result = buildManualBindingAcknowledgmentSection([
        { id: 'w1', bindings: [dupBinding, dupBinding] },
      ]);
      expect(result!.total).toBe(1);
    });

    it('produces one item per distinct binding name on the same worker', () => {
      const result = buildManualBindingAcknowledgmentSection([
        {
          id: 'w1',
          bindings: [
            { name: 'A', type: 'hyperdrive', id: 'h1' },
            { name: 'B', type: 'hyperdrive', id: 'h2' },
          ],
        },
      ]);
      expect(result!.total).toBe(2);
    });

    it('ignores binding types that auto-migrate (kv, d1, do, queue, r2, service)', () => {
      const result = buildManualBindingAcknowledgmentSection([
        {
          id: 'w1',
          bindings: [
            { name: 'K', type: 'kv_namespace', namespace_id: 'x' },
            { name: 'D', type: 'd1', database_id: 'y' },
            { name: 'DO', type: 'durable_object_namespace', namespace_id: 'z' },
            { name: 'Q', type: 'queue', queue_name: 'q' },
            { name: 'R', type: 'r2_bucket', bucket_name: 'b' },
            { name: 'S', type: 'service', service: 's' },
            { name: 'T', type: 'plain_text', text: 'hello' },
            { name: 'J', type: 'json', text: '{}' },
            { name: 'V', type: 'version_metadata' },
          ],
        },
      ]);
      expect(result).toBeNull();
    });
  });

  describe('buildAutoCreatedEmptySection', () => {
    it('returns null when nothing was auto-created', () => {
      expect(buildAutoCreatedEmptySection([])).toBeNull();
    });

    it('builds an all-acknowledged section reflecting empty auto-created resources', () => {
      const section = buildAutoCreatedEmptySection([
        { type: 'KV namespace', name: 'MAXCONFIG_KV' },
        { type: 'R2 bucket', name: 'maxconfig-bucket' },
        { type: 'D1 database', name: 'app-db' },
        { type: 'Queue', name: 'jobs' },
      ]);
      expect(section).not.toBeNull();
      expect(section!.name).toBe('Auto-Created Backing Resources (empty)');
      expect(section!.total).toBe(4);
      expect(section!.acknowledged).toBe(4);
      // Never failures (Principle 1): the resource exists, only data is absent.
      expect(section!.failed).toBe(0);
      expect(section!.success).toBe(0);
      expect(section!.items).toHaveLength(4);
      // Every item is acknowledged (user accepted this in Step 2), never missing/failed.
      expect(section!.items.every(i => i.status === 'acknowledged')).toBe(true);
      // Item name embeds type + resource name; reason discloses the empty/data caveat.
      const kv = section!.items.find(i => i.name.includes('MAXCONFIG_KV'))!;
      expect(kv.name).toBe('KV namespace "MAXCONFIG_KV"');
      expect(kv.reason).toMatch(/empty/i);
      // D1's caveat must call out the schema/runtime consequence specifically.
      const d1 = section!.items.find(i => i.name.includes('app-db'))!;
      expect(d1.reason).toMatch(/schema/i);
    });
  });

  describe('buildCapabilityAcknowledgmentSection', () => {
    it('lists items when exportData field has entries', () => {
      const section = buildCapabilityAcknowledgmentSection(
        'R2',
        'r2Buckets',
        { available: false, reason: 'R2 not enabled' },
        [{ name: 'bucket-a' }, { name: 'bucket-b' }],
      );
      expect(section.name).toBe('R2 (r2Buckets)');
      expect(section.total).toBe(2);
      expect(section.acknowledged).toBe(2);
      expect(section.failed).toBe(0);
      expect(section.items).toHaveLength(2);
      expect(section.items[0]).toMatchObject({
        name: 'bucket-a',
        status: 'acknowledged',
      });
      expect(section.items[0].error).toContain('R2 not enabled on destination account');
      expect(section.items[0].error).toContain('R2 not enabled');
      expect(section.items[1].name).toBe('bucket-b');
    });

    it('emits an empty (total:0) section when no such resources exist', () => {
      // When the zone has zero resources of this kind, the capability gap
      // affects nothing — asking the user to acknowledge the non-migration
      // of zero resources is busywork that inflates the acknowledged count
      // (Principle 4). The section is empty; the gap is instead disclosed via
      // report.warnings (pushed by zone-prelude). No synthetic "(no X found)"
      // row is emitted.
      const section = buildCapabilityAcknowledgmentSection(
        'R2',
        'r2Buckets',
        { available: false, reason: 'R2 is not enabled on this account' },
        [],
      );
      expect(section.name).toBe('R2 (r2Buckets)');
      expect(section.total).toBe(0);
      expect(section.acknowledged).toBe(0);
      expect(section.items).toHaveLength(0);
    });

    it('handles null/undefined items as the empty case (total:0, no row)', () => {
      const section = buildCapabilityAcknowledgmentSection(
        'Load Balancing',
        'loadBalancers',
        { available: false, reason: 'degraded state' },
        null,
      );
      expect(section.total).toBe(0);
      expect(section.items).toHaveLength(0);
    });

    it('falls back to id then title when name is missing', () => {
      const section = buildCapabilityAcknowledgmentSection(
        'KV',
        'kvNamespaces',
        { available: false },
        [{ id: 'abc123' }, { title: 'my-namespace' }, {}],
      );
      expect(section.items[0].name).toBe('abc123');
      expect(section.items[1].name).toBe('my-namespace');
      expect(section.items[2].name).toBe('unknown');
    });

    it('omits cap.reason from error string when undefined', () => {
      const section = buildCapabilityAcknowledgmentSection(
        'Access',
        'accessApps',
        { available: false },
        [{ name: 'app-1' }],
      );
      expect(section.items[0].error).toBe('Access not enabled on destination account');
    });

    it('empty-items section is skipped by the renderer; the gap is disclosed via a warning', () => {
      // An empty capability section (total:0) is correctly NOT rendered as a
      // resource block — there are no resources to show. The capability gap
      // is instead disclosed via report.warnings (zone-prelude pushes
      // "<label> not enabled on destination account ..."), which still
      // renders and stays machine-findable for the e2e harness's
      // isCapabilityAcknowledged matcher (/R2.*not enabled on destination/).
      const section = buildCapabilityAcknowledgmentSection(
        'R2',
        'r2Buckets',
        { available: false, reason: 'not enabled' },
        [],
      );
      const report = {
        timestamp: 'now',
        sourceZone: 's',
        destZone: 'd',
        destAccountId: 'acc-1',
        summary: { total: 0, success: 0, failed: 0, skipped: 0, acknowledged: 0 },
        sections: [section],
        errors: [],
        conflicts: [],
        warnings: ['R2 not enabled on destination account. R2 is not enabled on this account'],
        manualActions: [],
        newNameservers: [],
      };
      const md = generateReportMarkdown(report);
      // The empty section produces no resource block...
      expect(md).not.toContain('🟡 acknowledged');
      // ...but the gap is still disclosed (and matchable) via the warning.
      expect(md).toMatch(/R2.*not enabled on destination/);
    });

    it('renders the item table for large sections (>50 items) — no silent truncation', () => {
      // Regression: generateReportMarkdown used to suppress the ENTIRE item
      // table for sections with >50 items (`items.length <= 50`). Zone Settings
      // routinely has 57+ items, so per-setting status — including plan-gated
      // 🟡 acknowledged rows like origin_h2_max_streams on a downgrade — was
      // hidden from the report (Principle 8) and from evidence-based assertions.
      const items = [];
      for (let i = 0; i < 56; i++) {
        items.push({ name: `setting_${i}: on`, status: 'success' as const });
      }
      // A plan-gated setting that the engine acknowledged — must be visible.
      items.push({
        name: 'origin_h2_max_streams: 1',
        status: 'acknowledged' as const,
        error: 'not available for your plan type',
      });
      const report: MigrationReport = {
        timestamp: 'now',
        sourceZone: 's',
        destZone: 'd',
        destAccountId: 'acc-1',
        summary: { total: 57, success: 56, failed: 0, skipped: 0, acknowledged: 1 },
        sections: [{ name: 'Zone Settings', total: 57, success: 56, failed: 0, skipped: 0, acknowledged: 1, items }],
        errors: [],
        conflicts: [],
        warnings: [],
        manualActions: [],
        newNameservers: [],
      };
      const md = generateReportMarkdown(report);
      expect(md).toContain('View 57 items');
      // The acknowledged plan-gated setting must appear with its status.
      expect(md).toContain('origin_h2_max_streams: 1');
      expect(md).toMatch(/origin_h2_max_streams: 1.*🟡 acknowledged/);
    });
  });

  describe('sanitizeBindingsForUpload', () => {
    it('strips read-only version field from browser bindings', () => {
      // Regression: CF API returns browser bindings with version: 2 but the
      // upload API rejects it with "binding ... of type browser cannot use
      // version 2" (code 10021). Strip the field before upload.
      const bindings = [
        { name: 'BROWSER', type: 'browser', version: 2 },
      ] as any;
      const cleaned = sanitizeBindingsForUpload(bindings);
      expect(cleaned).toHaveLength(1);
      expect(cleaned[0]).toEqual({ name: 'BROWSER', type: 'browser' });
      expect('version' in cleaned[0]).toBe(false);
    });

    it('passes browser bindings without version through unchanged', () => {
      const bindings = [
        { name: 'BROWSER', type: 'browser' },
      ] as any;
      const cleaned = sanitizeBindingsForUpload(bindings);
      expect(cleaned[0]).toEqual({ name: 'BROWSER', type: 'browser' });
    });

    it('does not modify other binding types', () => {
      const bindings = [
        { name: 'KV', type: 'kv_namespace', namespace_id: 'abc' },
        { name: 'AI', type: 'ai' },
        { name: 'SVC', type: 'service', service: 'other-worker', environment: 'production' },
      ] as any;
      const cleaned = sanitizeBindingsForUpload(bindings);
      expect(cleaned).toEqual(bindings);
    });

    it('does not mutate the input', () => {
      const bindings = [
        { name: 'BROWSER', type: 'browser', version: 2 },
        { name: 'KV', type: 'kv_namespace', namespace_id: 'abc' },
      ] as any;
      const original = JSON.parse(JSON.stringify(bindings));
      sanitizeBindingsForUpload(bindings);
      expect(bindings).toEqual(original);
    });

    it('handles empty array', () => {
      expect(sanitizeBindingsForUpload([])).toEqual([]);
    });
  });

  describe('filterBindingsByCapGap', () => {
    it('drops r2_bucket bindings when r2Buckets is in skipFields', () => {
      // Regression: worker uploads were failing with "R2 bucket X not found"
      // when R2 was cap-gapped on dest. Now we drop the binding before upload
      // and acknowledge it in the report.
      const bindings = [
        { name: 'R2', type: 'r2_bucket', bucket_name: 'my-bucket' },
        { name: 'KV', type: 'kv_namespace', namespace_id: 'abc' },
      ] as any;
      const skipFields = new Set(['r2Buckets']);
      const { bindings: filtered, dropped } = filterBindingsByCapGap(bindings, skipFields);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe('kv_namespace');
      expect(dropped).toHaveLength(1);
      expect(dropped[0]).toMatchObject({ type: 'r2_bucket', name: 'R2' });
      expect(dropped[0].reason).toContain('r2Buckets not available on destination');
    });

    it('drops kv_namespace, d1, queue bindings when their fields are skipped', () => {
      const bindings = [
        { name: 'KV', type: 'kv_namespace', namespace_id: 'abc' },
        { name: 'D1', type: 'd1', database_id: 'def' },
        { name: 'Q', type: 'queue', queue_name: 'my-queue' },
        { name: 'AI', type: 'ai' },
      ] as any;
      const skipFields = new Set(['kvNamespaces', 'd1Databases', 'queues']);
      const { bindings: filtered, dropped } = filterBindingsByCapGap(bindings, skipFields);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].type).toBe('ai');
      expect(dropped).toHaveLength(3);
      expect(dropped.map(d => d.type).sort()).toEqual(['d1', 'kv_namespace', 'queue']);
    });

    it('passes all bindings through when skipFields is empty', () => {
      const bindings = [
        { name: 'KV', type: 'kv_namespace', namespace_id: 'abc' },
        { name: 'R2', type: 'r2_bucket', bucket_name: 'b' },
      ] as any;
      const { bindings: filtered, dropped } = filterBindingsByCapGap(bindings, new Set());
      expect(filtered).toEqual(bindings);
      expect(dropped).toEqual([]);
    });

    it('does not drop bindings whose type is not in the BINDING_TO_FIELD map', () => {
      // dispatch_namespace, hyperdrive etc. are manual bindings — not in
      // the cap-gap map. They get acknowledged via a different path
      // (buildManualBindingAcknowledgmentSection).
      const bindings = [
        { name: 'HYP', type: 'hyperdrive', id: 'x' },
        { name: 'DISP', type: 'dispatch_namespace', namespace: 'y' },
      ] as any;
      const skipFields = new Set(['r2Buckets', 'kvNamespaces']);
      const { bindings: filtered, dropped } = filterBindingsByCapGap(bindings, skipFields);
      expect(filtered).toEqual(bindings);
      expect(dropped).toEqual([]);
    });

    it('uses bucket_name as fallback name for r2_bucket bindings missing .name', () => {
      const bindings = [
        { type: 'r2_bucket', bucket_name: 'my-bucket' },
      ] as any;
      const { dropped } = filterBindingsByCapGap(bindings, new Set(['r2Buckets']));
      expect(dropped[0].name).toBe('my-bucket');
    });

    it('does not mutate input', () => {
      const bindings = [
        { name: 'R2', type: 'r2_bucket', bucket_name: 'b' },
        { name: 'KV', type: 'kv_namespace', namespace_id: 'a' },
      ] as any;
      const original = JSON.parse(JSON.stringify(bindings));
      filterBindingsByCapGap(bindings, new Set(['r2Buckets']));
      expect(bindings).toEqual(original);
    });
  });

  describe('collectExecutedAccountRulesetIds', () => {
    it('returns empty array when no rules execute account rulesets', () => {
      const result = collectExecutedAccountRulesetIds([
        { rules: [{ action: 'block', action_parameters: {} }] },
        { rules: [{ action: 'log' }] },
      ]);
      expect(result).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      expect(collectExecutedAccountRulesetIds([])).toEqual([]);
    });

    it('collects single execute-action ruleset id', () => {
      const result = collectExecutedAccountRulesetIds([
        {
          rules: [
            { action: 'execute', action_parameters: { id: 'a'.repeat(32) } },
          ],
        },
      ]);
      expect(result).toEqual(['a'.repeat(32)]);
    });

    it('deduplicates references to the same account ruleset', () => {
      const id = 'b'.repeat(32);
      const result = collectExecutedAccountRulesetIds([
        { rules: [{ action: 'execute', action_parameters: { id } }] },
        { rules: [{ action: 'execute', action_parameters: { id } }] },
      ]);
      expect(result).toEqual([id]);
    });

    it('rejects non-uuid-shaped strings', () => {
      const result = collectExecutedAccountRulesetIds([
        {
          rules: [
            { action: 'execute', action_parameters: { id: 'not-a-uuid' } },
            { action: 'execute', action_parameters: { id: 'short' } },
            { action: 'execute', action_parameters: { id: 12345 as unknown as string } },
          ],
        },
      ]);
      expect(result).toEqual([]);
    });

    it('ignores rules with action_parameters but no id', () => {
      const result = collectExecutedAccountRulesetIds([
        { rules: [{ action: 'execute', action_parameters: { foo: 'bar' } }] },
        { rules: [{ action: 'execute' }] },
      ]);
      expect(result).toEqual([]);
    });

    it('handles rulesets without a rules array', () => {
      expect(collectExecutedAccountRulesetIds([{}, { rules: undefined as never }]))
        .toEqual([]);
    });
  });

  describe('partitionAccountRulesetReferences', () => {
    const custom1 = 'a'.repeat(32);
    const custom2 = 'b'.repeat(32);
    const managed1 = 'c'.repeat(32); // e.g. Cloudflare Managed Ruleset global ID

    it('keeps only IDs present in the custom-ruleset inventory; rest are managed', () => {
      const { custom, managed } = partitionAccountRulesetReferences(
        [custom1, managed1, custom2],
        new Set([custom1, custom2]),
      );
      expect(custom).toEqual([custom1, custom2]);
      expect(managed).toEqual([managed1]);
    });

    it('classifies every reference as managed when the custom inventory is empty', () => {
      // This is the managed-ruleset false-positive case: a zone executes the
      // Cloudflare Managed Ruleset (global ID), which must NOT be fetched as a
      // custom account ruleset (404) nor flagged as a stale reference.
      const { custom, managed } = partitionAccountRulesetReferences(
        [managed1],
        new Set(),
      );
      expect(custom).toEqual([]);
      expect(managed).toEqual([managed1]);
    });

    it('returns empty partitions for empty input', () => {
      expect(partitionAccountRulesetReferences([], new Set([custom1])))
        .toEqual({ custom: [], managed: [] });
    });
  });

  describe('rewriteExecuteActionTargets', () => {
    it('returns rules unchanged when map is empty', () => {
      const rules = [
        { action: 'execute', action_parameters: { id: 'src1' } },
        { action: 'block', action_parameters: {} },
      ];
      const result = rewriteExecuteActionTargets(rules, new Map());
      expect(result).toEqual(rules);
    });

    it('rewrites execute action id when in the map', () => {
      const idMap = new Map([['src-id', 'dest-id']]);
      const result = rewriteExecuteActionTargets(
        [{ action: 'execute', action_parameters: { id: 'src-id' } }],
        idMap,
      );
      expect(result[0].action_parameters).toEqual({ id: 'dest-id' });
    });

    it('preserves sibling action_parameters fields', () => {
      const idMap = new Map([['src-id', 'dest-id']]);
      const result = rewriteExecuteActionTargets(
        [
          {
            action: 'execute',
            action_parameters: {
              id: 'src-id',
              overrides: { categories: [{ category: 'wordpress', action: 'block' }] },
              version: 'latest',
            },
          },
        ],
        idMap,
      );
      expect(result[0].action_parameters).toEqual({
        id: 'dest-id',
        overrides: { categories: [{ category: 'wordpress', action: 'block' }] },
        version: 'latest',
      });
    });

    it('leaves unmapped execute targets alone', () => {
      const idMap = new Map([['src-A', 'dest-A']]);
      const result = rewriteExecuteActionTargets(
        [
          { action: 'execute', action_parameters: { id: 'src-A' } },
          { action: 'execute', action_parameters: { id: 'src-B' } },
        ],
        idMap,
      );
      expect(result[0].action_parameters).toEqual({ id: 'dest-A' });
      expect(result[1].action_parameters).toEqual({ id: 'src-B' });
    });

    it('does not mutate the input rules', () => {
      const rules = [{ action: 'execute', action_parameters: { id: 'x' } }];
      rewriteExecuteActionTargets(rules, new Map([['x', 'y']]));
      expect(rules[0].action_parameters).toEqual({ id: 'x' });
    });

    it('does not touch non-execute rules even if id field matches', () => {
      const idMap = new Map([['some-id', 'remapped']]);
      const result = rewriteExecuteActionTargets(
        [{ action: 'block', action_parameters: { id: 'some-id' } }],
        idMap,
      );
      expect(result[0].action_parameters).toEqual({ id: 'some-id' });
    });
  });

  describe('deepRewriteStrings', () => {
    const upper = (s: string) => s.toUpperCase();

    it('returns scalars unchanged', () => {
      expect(deepRewriteStrings(null, upper)).toBeNull();
      expect(deepRewriteStrings(undefined, upper)).toBeUndefined();
      expect(deepRewriteStrings(42, upper)).toBe(42);
      expect(deepRewriteStrings(true, upper)).toBe(true);
    });

    it('applies rewrite to a bare string', () => {
      expect(deepRewriteStrings('hello', upper)).toBe('HELLO');
    });

    it('walks arrays and rewrites string leaves', () => {
      expect(deepRewriteStrings(['a', 1, 'b'], upper)).toEqual(['A', 1, 'B']);
    });

    it('walks nested objects', () => {
      const input = { a: 'x', nested: { b: 'y', arr: ['z'] } };
      expect(deepRewriteStrings(input, upper)).toEqual({
        a: 'X',
        nested: { b: 'Y', arr: ['Z'] },
      });
    });

    it('does not mutate the input', () => {
      const input = { a: 'x' };
      deepRewriteStrings(input, upper);
      expect(input.a).toBe('x');
    });

    it('handles domain rewrite use case', () => {
      const rewrite = (s: string) => s.replaceAll('src.com', 'dst.com');
      const params = {
        url: 'https://src.com/path',
        nested: { origin: { host: 'origin.src.com' } },
      };
      expect(deepRewriteStrings(params, rewrite)).toEqual({
        url: 'https://dst.com/path',
        nested: { origin: { host: 'origin.dst.com' } },
      });
    });
  });

  describe('findEmbeddedReferences', () => {
    const HEX32 = /\b[a-f0-9]{32}\b/g;

    it('returns empty array when no matches', () => {
      expect(findEmbeddedReferences({ foo: 'bar' }, HEX32)).toEqual([]);
      expect(findEmbeddedReferences(null, HEX32)).toEqual([]);
      expect(findEmbeddedReferences(42, HEX32)).toEqual([]);
    });

    it('finds a single hex id in a string leaf', () => {
      const id = 'a'.repeat(32);
      expect(findEmbeddedReferences({ ref: `prefix-${id}-suffix` }, HEX32))
        .toEqual([id]);
    });

    it('walks nested structure', () => {
      const id1 = 'a'.repeat(32);
      const id2 = 'b'.repeat(32);
      const input = {
        rules: [
          { expression: `cf.account.${id1}.foo` },
          { action_parameters: { id: id2 } },
        ],
      };
      const hits = findEmbeddedReferences(input, HEX32).sort();
      expect(hits).toEqual([id1, id2].sort());
    });

    it('deduplicates matches', () => {
      const id = 'c'.repeat(32);
      const input = [`${id}`, `${id}`, { x: id }];
      expect(findEmbeddedReferences(input, HEX32)).toEqual([id]);
    });

    it('ignores hex-like strings shorter than 32 chars', () => {
      expect(findEmbeddedReferences({ s: 'abcdef' }, HEX32)).toEqual([]);
    });
  });

  describe('MANUAL_BINDING_TYPE_TO_KEY', () => {
    it('every key maps to an entry in IMPOSSIBLE_TO_MIGRATE', () => {
      const impossibleKeys = new Set(IMPOSSIBLE_TO_MIGRATE.map(r => r.key));
      for (const [bindingType, impossibleKey] of Object.entries(MANUAL_BINDING_TYPE_TO_KEY)) {
        expect(
          impossibleKeys.has(impossibleKey),
          `Binding type "${bindingType}" maps to "${impossibleKey}" but that key is not in IMPOSSIBLE_TO_MIGRATE`,
        ).toBe(true);
      }
    });

    it('covers every entry in MANUAL_BINDING_TYPES_REQUIRE_RECONFIG', () => {
      for (const t of MANUAL_BINDING_TYPES_REQUIRE_RECONFIG) {
        expect(
          MANUAL_BINDING_TYPE_TO_KEY[t],
          `MANUAL_BINDING_TYPES_REQUIRE_RECONFIG contains "${t}" but it has no MANUAL_BINDING_TYPE_TO_KEY entry`,
        ).toBeDefined();
      }
    });
  });

  describe('dedupeCertificatePacks', () => {
    it('keeps a single pack when there are no duplicates', () => {
      const packs = [
        { id: '1', hosts: ['a.example.com'], type: 'advanced', certificate_authority: 'lets_encrypt' },
        { id: '2', hosts: ['b.example.com'], type: 'advanced', certificate_authority: 'lets_encrypt' },
      ];
      const { unique, duplicates } = dedupeCertificatePacks(packs);
      expect(unique).toHaveLength(2);
      expect(duplicates).toHaveLength(0);
    });

    it('treats packs with identical hosts+type+CA as duplicates', () => {
      const packs = [
        { id: '1', hosts: ['a.example.com', 'b.example.com'], type: 'advanced', certificate_authority: 'lets_encrypt' },
        { id: '2', hosts: ['a.example.com', 'b.example.com'], type: 'advanced', certificate_authority: 'lets_encrypt' },
        { id: '3', hosts: ['b.example.com', 'a.example.com'], type: 'advanced', certificate_authority: 'lets_encrypt' },
      ];
      const { unique, duplicates } = dedupeCertificatePacks(packs);
      expect(unique).toHaveLength(1);
      expect(unique[0].id).toBe('1');
      expect(duplicates).toHaveLength(2);
      expect(duplicates.map(d => d.id)).toEqual(['2', '3']);
    });

    it('treats different CAs as distinct even when hosts match', () => {
      const packs = [
        { id: '1', hosts: ['a.example.com'], type: 'advanced', certificate_authority: 'lets_encrypt' },
        { id: '2', hosts: ['a.example.com'], type: 'advanced', certificate_authority: 'google' },
      ];
      const { unique, duplicates } = dedupeCertificatePacks(packs);
      expect(unique).toHaveLength(2);
      expect(duplicates).toHaveLength(0);
    });

    it('treats different types as distinct even when hosts and CA match', () => {
      const packs = [
        { id: '1', hosts: ['a.example.com'], type: 'advanced', certificate_authority: 'lets_encrypt' },
        { id: '2', hosts: ['a.example.com'], type: 'dedicated_custom', certificate_authority: 'lets_encrypt' },
      ];
      const { unique, duplicates } = dedupeCertificatePacks(packs);
      expect(unique).toHaveLength(2);
      expect(duplicates).toHaveLength(0);
    });

    it('normalises host casing when computing the dedupe key', () => {
      const packs = [
        { id: '1', hosts: ['A.example.com'], type: 'advanced', certificate_authority: 'lets_encrypt' },
        { id: '2', hosts: ['a.example.com'], type: 'advanced', certificate_authority: 'lets_encrypt' },
      ];
      const { unique, duplicates } = dedupeCertificatePacks(packs);
      expect(unique).toHaveLength(1);
      expect(duplicates).toHaveLength(1);
    });

    it('handles empty input', () => {
      expect(dedupeCertificatePacks([])).toEqual({ unique: [], duplicates: [] });
    });

    it('handles packs missing hosts/type/CA fields without throwing', () => {
      const packs = [
        { id: '1' },
        { id: '2' },  // both have all-empty key — duplicates
        { id: '3', hosts: ['a.example.com'] },
      ];
      const { unique, duplicates } = dedupeCertificatePacks(packs);
      expect(unique).toHaveLength(2);  // {empty} and {a.example.com,'',''}
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].id).toBe('2');
    });
  });

  describe('computeDeselectedGroups', () => {
    // Helper to build a minimal ZoneExport
    const minimal = (overrides: Partial<ZoneExport> = {}): ZoneExport => ({
      zone: { id: 'z', name: 'example.com', name_servers: [], status: 'active', account: { id: 'a', name: 'A' }, plan: { id: 'free', name: 'Free' } },
      dnsRecords: [], settings: [], pageRules: [], rulesets: [], workers: [],
      workerRoutes: [], loadBalancers: [], pools: [], monitors: [], spectrumApps: [],
      customCertificates: [], customHostnames: [], accessApps: [], accessPolicies: [],
      firewallRules: [], rateLimits: [], emailRoutingRules: [], waitingRooms: [],
      zarazConfig: null, turnstileWidgets: [], kvNamespaces: [], r2Buckets: [],
      d1Databases: [], queues: [], durableObjectNamespaces: [],
      ...overrides,
    });

    it('returns [] when selections is undefined', () => {
      const raw = minimal({ kvNamespaces: [{ id: 'k1', title: 'KV One' }] });
      expect(computeDeselectedGroups(raw, undefined)).toEqual([]);
    });

    it('returns [] when no groups have items', () => {
      expect(computeDeselectedGroups(minimal(), {})).toEqual([]);
    });

    it('flags a fully-deselected group (no selections provided for it)', () => {
      const raw = minimal({ kvNamespaces: [{ id: 'k1', title: 'KV One' }, { id: 'k2', title: 'KV Two' }] });
      const result = computeDeselectedGroups(raw, {});
      expect(result).toHaveLength(1);
      expect(result[0].groupKey).toBe('kvNamespaces');
      expect(result[0].label).toBe('KV Namespaces');
      expect(result[0].items).toHaveLength(2);
      expect(result[0].items.map(i => i.name)).toEqual(['KV One', 'KV Two']);
    });

    it('flags a partially-deselected group', () => {
      const raw = minimal({
        kvNamespaces: [
          { id: 'k1', title: 'KV One' },
          { id: 'k2', title: 'KV Two' },
          { id: 'k3', title: 'KV Three' },
        ],
      });
      const result = computeDeselectedGroups(raw, {
        kvNamespaces: { k1: true, k3: true },  // k2 deselected
      });
      expect(result).toHaveLength(1);
      expect(result[0].items).toHaveLength(1);
      expect(result[0].items[0].name).toBe('KV Two');
    });

    it('omits groups where everything was selected', () => {
      const raw = minimal({ kvNamespaces: [{ id: 'k1', title: 'KV One' }] });
      const result = computeDeselectedGroups(raw, {
        kvNamespaces: { k1: true },
      });
      expect(result).toEqual([]);
    });

    it('omits empty groups from raw', () => {
      const raw = minimal();  // no kvNamespaces
      const result = computeDeselectedGroups(raw, { kvNamespaces: {} });
      expect(result).toEqual([]);
    });

    it('handles multiple deselected groups', () => {
      const raw = minimal({
        kvNamespaces: [{ id: 'k1', title: 'KV One' }],
        r2Buckets: [{ name: 'r2-one', creation_date: '2024-01-01' }],
        loadBalancers: [{ id: 'lb1', name: 'LB One' } as any],
      });
      const result = computeDeselectedGroups(raw, {});
      expect(result.map(g => g.groupKey).sort()).toEqual(['kvNamespaces', 'loadBalancers', 'r2Buckets']);
    });

    it('falls back to id when title/name is missing', () => {
      const raw = minimal({ kvNamespaces: [{ id: 'k1' } as any] });
      const result = computeDeselectedGroups(raw, {});
      expect(result[0].items[0].name).toBe('k1');
    });
  });

  describe('buildDeselectedAcknowledgmentSection', () => {
    // Deselection is a group-level choice, so the section collapses to a
    // single representative acknowledged row (count carried in the row),
    // rather than one row per item — which would flood Results with noise
    // and inflate the acknowledged count (Principle 4).
    it('collapses a deselected group to a single acknowledged row carrying the count', () => {
      const section = buildDeselectedAcknowledgmentSection({
        groupKey: 'kvNamespaces',
        label: 'KV Namespaces',
        items: [{ name: 'KV One', id: 'k1' }, { name: 'KV Two', id: 'k2' }],
      });
      expect(section.name).toBe('KV Namespaces (deselected)');
      expect(section.total).toBe(1);
      expect(section.acknowledged).toBe(1);
      expect(section.success).toBe(0);
      expect(section.failed).toBe(0);
      expect(section.items).toHaveLength(1);
      expect(section.items[0].status).toBe('acknowledged');
      expect(section.items[0].name).toBe('2 KV Namespaces');
      expect(section.items[0].error).toMatch(/deselected/i);
      expect(section.items[0].error).toMatch(/2 item/);
    });

    it('handles an empty items list (still emits a 0-total section)', () => {
      const section = buildDeselectedAcknowledgmentSection({
        groupKey: 'kvNamespaces',
        label: 'KV Namespaces',
        items: [],
      });
      expect(section.total).toBe(0);
      expect(section.items).toEqual([]);
    });
  });

  describe('legacy firewall rule migration', () => {
    // Regression: legacy firewall rules with action "bypass" REQUIRE a
    // `products` array (which products to bypass: waf, rateLimit, uaBlock, …).
    // The migrate code used to build the create payload from a fixed field set
    // that dropped `products`, so every bypass rule failed on the destination
    // with "products must be specified for the 'bypass' action" — a Principle 1
    // (No Surprise Failures) violation seen in the 2026-06-08 e01 run.
    const batch2Src = readFileSync(
      fileURLToPath(new URL('../src/migrate/batch2.ts', import.meta.url)),
      'utf8',
    );

    it('carries the `products` field through to createFirewallRule (required for bypass action)', () => {
      // The createFirewallRule payload must spread `rule.products` when present.
      expect(batch2Src).toMatch(/rule\.products[\s\S]*?products:\s*rule\.products/);
    });

    it('exposes `products` on the CFFirewallRule type so it survives export', () => {
      const typesSrc = readFileSync(
        fileURLToPath(new URL('../src/types.ts', import.meta.url)),
        'utf8',
      );
      expect(typesSrc).toMatch(/interface CFFirewallRule[\s\S]*?products\?:\s*string\[\]/);
    });
  });
});
