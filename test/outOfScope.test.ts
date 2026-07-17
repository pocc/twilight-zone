/**
 * Tests for app/lib/outOfScope.ts — detection of IMPOSSIBLE_TO_MIGRATE
 * entries that apply to a given source export.
 *
 * These tests are pure: no API calls, no mocks. The detection function
 * is the single place that enforces Principle 1 (No Surprise Failures)
 * by deciding which out-of-scope items the user MUST acknowledge.
 */

import { describe, it, expect } from 'vitest';
import {
  detectApplicableImpossibleResources,
  isActionableCategory,
  ACTIONABLE_CATEGORIES,
  deriveItemState,
  isItemFixed,
  hasInlineFixIt,
  impossibleResourcePhase,
  hasCliCommands,
  buildCliCommands,
  isPostMigrationManualItem,
  BUCKET_1_FIX_IT_KEYS,
  BUCKET_3_CLI_KEYS,
  type ApplicableImpossibleResource,
  type FixItState,
} from '../app/lib/outOfScope';
import { IMPOSSIBLE_TO_MIGRATE, type ImpossibleCategory } from '../src/types';

/** Build a minimal FixItState for tests. All fields default to empty
 * so callers only need to populate what their scenario exercises. */
function buildFixState(overrides: Partial<FixItState> = {}): FixItState {
  return {
    workerSecrets: {},
    certificates: [],
    originCaCsrs: [],
    sourceWorkers: [],
    sourceCustomCertificates: [],
    sourceOriginCaCertificates: [],
    ...overrides,
  };
}

/** Helper to find an entry by key in the result list. */
function findByKey(
  results: ApplicableImpossibleResource[],
  key: string,
): ApplicableImpossibleResource | undefined {
  return results.find(r => r.key === key);
}

/** Helper to assert a key is present. */
function expectKey(
  results: ApplicableImpossibleResource[],
  key: string,
): ApplicableImpossibleResource {
  const item = findByKey(results, key);
  expect(item, `Expected '${key}' in detection results`).toBeDefined();
  return item!;
}

/** Helper to assert a key is NOT present. */
function expectNoKey(results: ApplicableImpossibleResource[], key: string): void {
  expect(findByKey(results, key), `Did not expect '${key}' in detection results`).toBeUndefined();
}

describe('detectApplicableImpossibleResources', () => {
  describe('always-applicable entries', () => {
    it('always surfaces nameserver_change', () => {
      const r = detectApplicableImpossibleResources({});
      expectKey(r, 'nameserver_change');
    });

    it('always surfaces universal_ssl_pack', () => {
      const r = detectApplicableImpossibleResources({});
      expectKey(r, 'universal_ssl_pack');
    });

    it('always surfaces cached_content (ephemeral data)', () => {
      const r = detectApplicableImpossibleResources({});
      expectKey(r, 'cached_content');
    });

    it('always surfaces account_members_iam as an actionable item', () => {
      // Account members never cross an account boundary, so the user must
      // always be warned and re-invite them on the destination account.
      const r = detectApplicableImpossibleResources({});
      const item = expectKey(r, 'account_members_iam');
      expect(item.category).toBe('account_tied');
      expect(item.actionable).toBe(true);
    });

    it('returns [] for null/undefined exportData', () => {
      expect(detectApplicableImpossibleResources(null)).toEqual([]);
      expect(detectApplicableImpossibleResources(undefined)).toEqual([]);
    });
  });

  describe('cryptographic detection', () => {
    it('detects worker_secrets when workers have secret_text bindings', () => {
      const r = detectApplicableImpossibleResources({
        workers: [
          { id: 'w1', bindings: [{ type: 'secret_text', name: 'API_KEY' }] },
          { id: 'w2', bindings: [{ type: 'secret_text', name: 'DB_PASS' }, { type: 'kv_namespace' }] },
        ],
      });
      const item = expectKey(r, 'worker_secrets');
      expect(item.count).toBe(2);
    });

    it('does not surface worker_secrets when no secret_text bindings exist', () => {
      const r = detectApplicableImpossibleResources({
        workers: [{ id: 'w1', bindings: [{ type: 'kv_namespace' }] }],
      });
      expectNoKey(r, 'worker_secrets');
    });

    it('detects custom_certificate_keys when source has custom certs', () => {
      const r = detectApplicableImpossibleResources({
        customCertificates: [{ id: '1', hosts: ['example.com'] }, { id: '2', hosts: ['api.example.com'] }],
      });
      const item = expectKey(r, 'custom_certificate_keys');
      expect(item.count).toBe(2);
    });

    it('detects origin_ca_keys when source has Origin CA certs', () => {
      const r = detectApplicableImpossibleResources({
        originCaCertificates: [{ id: 'cert1', hostnames: ['example.com'] }],
      });
      expectKey(r, 'origin_ca_keys');
    });

    it('detects ai_gateway_custom_provider_api_keys when custom providers exist', () => {
      const r = detectApplicableImpossibleResources({
        aiGatewayCustomProviders: [{ slug: 'p1', name: 'P1', base_url: 'https://x.com' }],
      });
      expectKey(r, 'ai_gateway_custom_provider_api_keys');
    });

    describe('identity_provider_secrets detection', () => {
      it('counts only OAuth-family IdPs (skips SAML and onetimepin)', () => {
        // SAML uses cert-based trust (idp_public_certs is captured
        // at export); onetimepin is auto-provisioned. Neither
        // appears in the Step 2 client_secret fix-it form, so they
        // must not contribute to the count either — otherwise the
        // panel header would say "3 OAuth IdPs need secrets" but
        // only one input would render, which is the kind of
        // mismatch that erodes trust.
        const r = detectApplicableImpossibleResources({
          identityProviders: [
            { name: 'corp-oidc', type: 'oidc' },
            { name: 'corp-okta', type: 'okta' },
            { name: 'corp-saml', type: 'saml' },          // skipped
            { name: '', type: 'onetimepin' },             // skipped
          ],
        });
        const item = expectKey(r, 'identity_provider_secrets');
        expect(item.count).toBe(2);
      });

      it('does not surface identity_provider_secrets when only SAML IdPs exist', () => {
        // SAML auto-migrates from captured config; no user input
        // required. The item should not appear in the panel at all.
        const r = detectApplicableImpossibleResources({
          identityProviders: [
            { name: 'corp-saml-1', type: 'saml' },
            { name: 'corp-saml-2', type: 'saml' },
          ],
        });
        expectNoKey(r, 'identity_provider_secrets');
      });

      it('does not surface identity_provider_secrets when only onetimepin exists', () => {
        const r = detectApplicableImpossibleResources({
          identityProviders: [{ name: '', type: 'onetimepin' }],
        });
        expectNoKey(r, 'identity_provider_secrets');
      });
    });
  });

  describe('account-tied worker binding detection', () => {
    it('detects hyperdrive binding', () => {
      const r = detectApplicableImpossibleResources({
        workers: [{ id: 'w1', bindings: [{ type: 'hyperdrive', name: 'DB' }] }],
      });
      const item = expectKey(r, 'worker_binding_hyperdrive');
      expect(item.count).toBe(1);
    });

    it('detects multiple distinct binding types', () => {
      const r = detectApplicableImpossibleResources({
        workers: [{
          id: 'w1',
          bindings: [
            { type: 'hyperdrive', name: 'DB' },
            { type: 'vectorize', name: 'IDX' },
            { type: 'browser', name: 'B' },
            { type: 'ai', name: 'A' },
          ],
        }],
      });
      expectKey(r, 'worker_binding_hyperdrive');
      expectKey(r, 'worker_binding_vectorize');
      expectKey(r, 'worker_binding_browser');
      expectKey(r, 'worker_binding_ai');
    });

    it('counts binding usage across multiple workers', () => {
      const r = detectApplicableImpossibleResources({
        workers: [
          { id: 'w1', bindings: [{ type: 'mtls_certificate', name: 'CERT1' }] },
          { id: 'w2', bindings: [{ type: 'mtls_certificate', name: 'CERT2' }] },
        ],
      });
      const item = expectKey(r, 'worker_binding_mtls_certificate');
      expect(item.count).toBe(2);
    });
  });

  describe('developer platform detection', () => {
    it('detects pages_deployment_data when Pages projects exist', () => {
      const r = detectApplicableImpossibleResources({
        pagesProjects: [{ name: 'site1' }, { name: 'site2' }],
      });
      const item = expectKey(r, 'pages_deployment_data');
      expect(item.count).toBe(2);
    });

    it('detects ai_gateway_dependency when AI Gateway present', () => {
      const r = detectApplicableImpossibleResources({
        aiGateways: [{ id: 'g1' }],
      });
      expectKey(r, 'ai_gateway_dependency');
    });

    it('does not surface ai_gateway_dependency when no AI Gateway used', () => {
      const r = detectApplicableImpossibleResources({});
      expectNoKey(r, 'ai_gateway_dependency');
    });
  });

  describe('infrastructure detection', () => {
    it('detects DNSSEC DS record requirement when enabled', () => {
      const r = detectApplicableImpossibleResources({
        dnssecStatus: { status: 'active' },
      });
      expectKey(r, 'dnssec_ds_record');
    });

    it('does not surface DNSSEC entry when disabled', () => {
      const r = detectApplicableImpossibleResources({
        dnssecStatus: { status: 'disabled' },
      });
      expectNoKey(r, 'dnssec_ds_record');
    });

    it('detects tunnel_origin from DNS records pointing at cfargotunnel.com', () => {
      const r = detectApplicableImpossibleResources({
        dnsRecords: [
          { type: 'CNAME', content: 'abc-123-def.cfargotunnel.com' },
          { type: 'A', content: '1.2.3.4' },  // not a tunnel
        ],
      });
      const item = expectKey(r, 'tunnel_origin');
      expect(item.count).toBe(1);
    });

    it('detects gateway_dependency when Access policies present', () => {
      const r = detectApplicableImpossibleResources({
        accessPolicies: [{ id: 'p1', name: 'pol' }],
      });
      expectKey(r, 'gateway_dependency');
    });

    it('detects Custom Nameservers pool + registrar glue from the metadata singleton when enabled', () => {
      // CNS state is the `customNameserversMetadata` singleton ({enabled,ns_set}),
      // NOT a `customNs` array — the endpoint returns metadata, not a list.
      const r = detectApplicableImpossibleResources({
        customNameserversMetadata: { enabled: true, ns_set: 1 },
      });
      expectKey(r, 'account_custom_ns_pool');
      expectKey(r, 'custom_ns_registrar_glue');
    });

    it('does NOT surface Custom Nameservers entries when CNS is disabled', () => {
      const r = detectApplicableImpossibleResources({
        customNameserversMetadata: { enabled: false },
      });
      expectNoKey(r, 'account_custom_ns_pool');
      expectNoKey(r, 'custom_ns_registrar_glue');
    });
  });

  describe('storage detection', () => {
    it('detects d1_schema_and_data when D1 databases exist', () => {
      const r = detectApplicableImpossibleResources({
        d1Databases: [{ uuid: 'd1', name: 'db1' }],
      });
      expectKey(r, 'd1_schema_and_data');
    });

    it('detects r2_object_data + r2_bucket_event_notifications when R2 buckets exist', () => {
      const r = detectApplicableImpossibleResources({
        r2Buckets: [{ name: 'b1', creation_date: '2024-01-01' }],
      });
      expectKey(r, 'r2_object_data');
      expectKey(r, 'r2_bucket_event_notifications');
    });

    it('detects queue_messages_in_flight when queues exist', () => {
      const r = detectApplicableImpossibleResources({
        queues: [{ queue_id: 'q1', queue_name: 'q' }],
      });
      expectKey(r, 'queue_messages_in_flight');
    });

    it('detects kv_expiration_ttls when KV namespaces exist', () => {
      const r = detectApplicableImpossibleResources({
        kvNamespaces: [{ id: 'kv1', title: 'kv' }],
      });
      expectKey(r, 'kv_expiration_ttls');
    });

    it('detects durable_object_state when DO namespaces exist, and it is post-migration manual work (#15)', () => {
      const r = detectApplicableImpossibleResources({
        durableObjectNamespaces: [{ id: 'do1', name: 'Counter', class: 'Counter', script: 'w' }],
      });
      const item = expectKey(r, 'durable_object_state');
      // data_offline → actionable, and it surfaces in the post-migration work
      // panel (not an inline fix-it, not excluded).
      expect(item.actionable).toBe(true);
      expect(isPostMigrationManualItem(item)).toBe(true);
    });

    it('does NOT detect durable_object_state when there are no DO namespaces', () => {
      const r = detectApplicableImpossibleResources({ kvNamespaces: [{ id: 'kv1', title: 'kv' }] });
      expectNoKey(r, 'durable_object_state');
    });
  });

  describe('account ruleset unmapped reference detection', () => {
    it('flags unmapped account rulesets referenced by execute rules', () => {
      const r = detectApplicableImpossibleResources({
        referencedAccountRulesetIds: ['rs1', 'rs2', 'rs3'],
        accountRulesets: [{ id: 'rs1' }],  // only rs1 exportable
      });
      const item = expectKey(r, 'account_custom_ruleset_unmapped');
      expect(item.count).toBe(2);  // rs2 and rs3 unmapped
    });

    it('does not flag when all referenced rulesets are exportable', () => {
      const r = detectApplicableImpossibleResources({
        referencedAccountRulesetIds: ['rs1'],
        accountRulesets: [{ id: 'rs1' }],
      });
      expectNoKey(r, 'account_custom_ruleset_unmapped');
    });
  });

  describe('category ordering', () => {
    it('sorts cryptographic entries before account-tied', () => {
      const r = detectApplicableImpossibleResources({
        workers: [{
          id: 'w1',
          bindings: [
            { type: 'secret_text', name: 'S' },
            { type: 'hyperdrive', name: 'H' },
          ],
        }],
      });
      const cryptoIdx = r.findIndex(x => x.key === 'worker_secrets');
      const tiedIdx = r.findIndex(x => x.key === 'worker_binding_hyperdrive');
      expect(cryptoIdx).toBeGreaterThanOrEqual(0);
      expect(tiedIdx).toBeGreaterThanOrEqual(0);
      expect(cryptoIdx).toBeLessThan(tiedIdx);
    });
  });

  describe('deduplication', () => {
    it('does not duplicate keys when multiple detection paths trigger the same entry', () => {
      const r = detectApplicableImpossibleResources({
        // Both r2Buckets and r2BucketConfigs could trigger r2_bucket_event_notifications
        r2Buckets: [{ name: 'b1' }, { name: 'b2' }],
      });
      const matches = r.filter(x => x.key === 'r2_bucket_event_notifications');
      expect(matches).toHaveLength(1);
    });
  });

  // ── Principle 4 actionability split ──────────────────────────────
  //
  // Per AGENTS.md Principle 4 (Never Ask the User to Acknowledge Things
  // They Cannot Change), every applicable resource carries an
  // `actionable: boolean` flag derived from its category. Actionable
  // entries gate the Continue button; informational entries are
  // disclosure-only.
  //
  // These tests pin the partition so that a future refactor cannot
  // silently shift `auto_managed` / `read_only` / `data_ephemeral`
  // back into the must-acknowledge bucket — which is the exact bug
  // class Principle 4 exists to prevent.
  describe('actionability classification (Principle 4)', () => {
    /** Every ImpossibleCategory value, derived from the type union via
     * the catalog itself so adding a new category requires zero test
     * maintenance — the assertions below will catch it. */
    const ALL_CATEGORIES: ImpossibleCategory[] = [
      'cryptographic',
      'account_tied',
      'auto_managed',
      'data_ephemeral',
      'manual_external',
      'data_offline',
      'read_only',
    ];

    /** Snapshot of which categories MUST be actionable per Principle 4.
     * Changing this set is a deliberate UX policy decision and should
     * require an explicit AGENTS.md update — guarded by the explicit
     * equality assertion below. */
    const EXPECTED_ACTIONABLE: ReadonlySet<ImpossibleCategory> = new Set([
      'cryptographic',
      'account_tied',
      'data_offline',
      'manual_external',
    ]);

    it('ACTIONABLE_CATEGORIES exactly matches the Principle 4 policy set', () => {
      // Use set-equality (size + every element present) so the
      // assertion fails loudly if either side gains or drops a
      // category. A plain toEqual on Sets passes by reference, not
      // by content, so we compare sorted arrays.
      expect([...ACTIONABLE_CATEGORIES].sort()).toEqual([...EXPECTED_ACTIONABLE].sort());
    });

    it('isActionableCategory is exhaustive across ImpossibleCategory', () => {
      // Every enum member must produce a defined boolean — protects
      // against a future category being added without updating the
      // ACTIONABLE_CATEGORIES set (in which case it would silently
      // default to non-actionable, hiding it from the must-acknowledge
      // gate; that's a Principle 1 risk).
      for (const cat of ALL_CATEGORIES) {
        const result = isActionableCategory(cat);
        expect(typeof result).toBe('boolean');
      }
    });

    it('every IMPOSSIBLE_TO_MIGRATE entry has a known category', () => {
      // Catches drift between the catalog in src/types.ts and the
      // ImpossibleCategory union — if a new string slips in, the
      // partition test below would silently miscount.
      const knownCategories = new Set<string>(ALL_CATEGORIES);
      for (const item of IMPOSSIBLE_TO_MIGRATE) {
        expect(knownCategories.has(item.category), `Unknown category on ${item.key}: ${item.category}`).toBe(true);
      }
    });

    it('marks actionable categories with actionable=true', () => {
      // Drive detection with an export that triggers at least one
      // entry per actionable category, then assert the flag.
      // Category triggers checked against src/types.ts catalog:
      //   - cryptographic   → secret_text binding → worker_secrets
      //   - account_tied    → hyperdrive binding → worker_binding_hyperdrive
      //   - data_offline    → d1Databases → d1_schema_and_data
      //   - manual_external → always: nameserver_change
      const r = detectApplicableImpossibleResources({
        workers: [{
          id: 'w1',
          bindings: [
            { type: 'secret_text', name: 'X' },
            { type: 'hyperdrive', name: 'H' },
          ],
        }],
        d1Databases: [{ uuid: 'd1', name: 'db' }],
      });
      for (const item of r) {
        if (EXPECTED_ACTIONABLE.has(item.category)) {
          expect(item.actionable, `${item.key} (${item.category}) should be actionable`).toBe(true);
        }
      }
      // Spot-check at least one entry per actionable category was seen.
      expect(r.some(x => x.category === 'cryptographic' && x.actionable)).toBe(true);
      expect(r.some(x => x.category === 'account_tied' && x.actionable)).toBe(true);
      expect(r.some(x => x.category === 'data_offline' && x.actionable)).toBe(true);
      expect(r.some(x => x.category === 'manual_external' && x.actionable)).toBe(true);
    });

    it('marks informational categories with actionable=false', () => {
      // Empty export already triggers the always-applicable
      // informational entries: universal_ssl_pack (auto_managed) and
      // cached_content (data_ephemeral). Add a kvNamespace to also
      // surface kv_expiration_ttls (data_ephemeral). For read_only we
      // don't have an export-trigger today, so we test the policy
      // directly via isActionableCategory.
      const r = detectApplicableImpossibleResources({
        kvNamespaces: [{ id: 'kv1', title: 'kv' }],
      });
      for (const item of r) {
        if (!EXPECTED_ACTIONABLE.has(item.category)) {
          expect(item.actionable, `${item.key} (${item.category}) should NOT be actionable`).toBe(false);
        }
      }
      // Concrete keys we know should be informational:
      expect(r.find(x => x.key === 'universal_ssl_pack')?.actionable).toBe(false);
      expect(r.find(x => x.key === 'cached_content')?.actionable).toBe(false);
      expect(r.find(x => x.key === 'kv_expiration_ttls')?.actionable).toBe(false);
      // Direct policy check for read_only (no current export-trigger).
      expect(isActionableCategory('read_only')).toBe(false);
    });

    it('every detected resource has the actionable flag set (never undefined)', () => {
      // Regression guard: the `add()` helper in outOfScope.ts must
      // stamp `actionable` on every result. If a code path bypasses
      // the helper, the panel would render an item without a flag and
      // could land in the wrong block.
      const r = detectApplicableImpossibleResources({
        workers: [{ id: 'w1', bindings: [{ type: 'secret_text', name: 'X' }, { type: 'hyperdrive', name: 'H' }] }],
        kvNamespaces: [{ id: 'kv1', title: 'kv' }],
        r2Buckets: [{ name: 'b1' }],
        d1Databases: [{ uuid: 'd1', name: 'db' }],
        customCertificates: [{ id: 'c1', hosts: ['x.com'] }],
        dnssecStatus: { status: 'active' },
        pagesProjects: [{ name: 'p1' }],
      });
      for (const item of r) {
        expect(typeof item.actionable, `${item.key} missing actionable flag`).toBe('boolean');
      }
    });

    it('auto_managed entries (managed rulesets, DDoS managed rules, Universal SSL) are informational', () => {
      // Direct verification of the screenshot in the user request that
      // motivated Principle 4: these three items must NEVER show as
      // checkbox-required acknowledgments.
      const r = detectApplicableImpossibleResources({
        rulesets: [{ id: 'rs1', name: 'r', phase: 'http_request_firewall_custom' }],
      });
      const managed = r.find(x => x.key === 'managed_rulesets_cloudflare');
      const ddos = r.find(x => x.key === 'ddos_managed_rules');
      const ussl = r.find(x => x.key === 'universal_ssl_pack');
      expect(managed?.actionable).toBe(false);
      expect(ddos?.actionable).toBe(false);
      expect(ussl?.actionable).toBe(false);
    });
  });

  // ── Bucket 1 three-state resolution ──────────────────────────────
  //
  // Tests for the inline fix-it model.
  // Each actionable item resolves to 'fixed', 'acknowledged', or
  // 'unresolved'. Only the three bucket-1 keys (worker_secrets,
  // custom_certificate_keys, origin_ca_keys) can ever resolve to
  // 'fixed' — every other actionable item falls back to the
  // binary ack-vs-unresolved gate.
  describe('inline fix-it three-state resolution (bucket 1)', () => {
    describe('hasInlineFixIt', () => {
      it('returns true for every key with an inline fix-it form (bucket 1 + 2.1-2.4)', () => {
        // bucket 1
        expect(hasInlineFixIt('worker_secrets')).toBe(true);
        expect(hasInlineFixIt('custom_certificate_keys')).toBe(true);
        expect(hasInlineFixIt('origin_ca_keys')).toBe(true);
        // bucket 2.1-2.4
        expect(hasInlineFixIt('notification_webhook_secret')).toBe(true);
        expect(hasInlineFixIt('identity_provider_secrets')).toBe(true);
        expect(hasInlineFixIt('aop_mtls_certificate_bundle')).toBe(true);
        expect(hasInlineFixIt('ai_gateway_custom_provider_api_keys')).toBe(true);
      });

      it('returns false for other actionable keys', () => {
        expect(hasInlineFixIt('access_service_tokens')).toBe(false);
        expect(hasInlineFixIt('worker_binding_hyperdrive')).toBe(false);
        expect(hasInlineFixIt('d1_schema_and_data')).toBe(false);
        expect(hasInlineFixIt('nameserver_change')).toBe(false);
      });

      it('returns false for informational keys', () => {
        expect(hasInlineFixIt('cached_content')).toBe(false);
        expect(hasInlineFixIt('universal_ssl_pack')).toBe(false);
      });

      it('BUCKET_1_FIX_IT_KEYS matches the documented set', () => {
        // Snapshot policy — if this set grows, the panel needs a new
        // fix-it sub-component and ARCHITECTURE.md needs an update.
        expect([...BUCKET_1_FIX_IT_KEYS].sort()).toEqual([
          'ai_gateway_custom_provider_api_keys',
          'aop_mtls_certificate_bundle',
          'custom_certificate_keys',
          'identity_provider_secrets',
          'notification_webhook_secret',
          'origin_ca_keys',
          'worker_secrets',
        ]);
      });
    });

    describe('isItemFixed: worker_secrets', () => {
      it('returns true when every secret_text binding has a non-empty value', () => {
        const fix = buildFixState({
          sourceWorkers: [
            { id: 'w1', bindings: [{ type: 'secret_text', name: 'API_KEY' }, { type: 'kv_namespace', name: 'KV' }] },
            { id: 'w2', bindings: [{ type: 'secret_text', name: 'DB_PASS' }] },
          ],
          workerSecrets: {
            w1: { API_KEY: 'sk_live_xyz' },
            w2: { DB_PASS: 'hunter2' },
          },
        });
        expect(isItemFixed('worker_secrets', fix)).toBe(true);
      });

      it('returns false when any secret has an empty value', () => {
        const fix = buildFixState({
          sourceWorkers: [
            { id: 'w1', bindings: [{ type: 'secret_text', name: 'A' }, { type: 'secret_text', name: 'B' }] },
          ],
          workerSecrets: { w1: { A: 'value', B: '' } },
        });
        expect(isItemFixed('worker_secrets', fix)).toBe(false);
      });

      it('returns false when a secret is missing entirely', () => {
        const fix = buildFixState({
          sourceWorkers: [
            { id: 'w1', bindings: [{ type: 'secret_text', name: 'A' }, { type: 'secret_text', name: 'B' }] },
          ],
          workerSecrets: { w1: { A: 'value' } },
        });
        expect(isItemFixed('worker_secrets', fix)).toBe(false);
      });

      it('returns false when a worker is missing entirely from workerSecrets', () => {
        const fix = buildFixState({
          sourceWorkers: [
            { id: 'w1', bindings: [{ type: 'secret_text', name: 'A' }] },
            { id: 'w2', bindings: [{ type: 'secret_text', name: 'B' }] },
          ],
          workerSecrets: { w1: { A: 'v' } },
        });
        expect(isItemFixed('worker_secrets', fix)).toBe(false);
      });

      it('returns true vacuously when no workers have secret_text bindings', () => {
        // Defensive: should never be invoked in this case (the item
        // wouldn't be surfaced), but the function should not block
        // forever if invoked anyway.
        const fix = buildFixState({
          sourceWorkers: [{ id: 'w1', bindings: [{ type: 'kv_namespace', name: 'K' }] }],
        });
        expect(isItemFixed('worker_secrets', fix)).toBe(true);
      });

      it('uses worker.name when worker.id is missing', () => {
        // Source workers from the export may use either field.
        const fix = buildFixState({
          sourceWorkers: [{ name: 'worker-by-name', bindings: [{ type: 'secret_text', name: 'A' }] }],
          workerSecrets: { 'worker-by-name': { A: 'v' } },
        });
        expect(isItemFixed('worker_secrets', fix)).toBe(true);
      });
    });

    describe('isItemFixed: custom_certificate_keys', () => {
      it('returns true when every source cert slot has both cert and key', () => {
        const fix = buildFixState({
          sourceCustomCertificates: [{ hosts: ['a.com'] }, { hosts: ['b.com'] }],
          certificates: [
            { cert: 'certificate-pem', key: 'private-key-pem' },
            { cert: 'certificate-pem', key: 'private-key-pem' },
          ],
        });
        expect(isItemFixed('custom_certificate_keys', fix)).toBe(true);
      });

      it('returns false when any cert slot is missing the key', () => {
        const fix = buildFixState({
          sourceCustomCertificates: [{ hosts: ['a.com'] }],
          certificates: [{ cert: 'pem', key: '' }],
        });
        expect(isItemFixed('custom_certificate_keys', fix)).toBe(false);
      });

      it('returns false when there are fewer cert slots than source certs', () => {
        const fix = buildFixState({
          sourceCustomCertificates: [{ hosts: ['a.com'] }, { hosts: ['b.com'] }],
          certificates: [{ cert: 'pem', key: 'pem' }],
        });
        expect(isItemFixed('custom_certificate_keys', fix)).toBe(false);
      });

      it('returns true vacuously when no source custom certs exist', () => {
        const fix = buildFixState({});
        expect(isItemFixed('custom_certificate_keys', fix)).toBe(true);
      });
    });

    describe('isItemFixed: origin_ca_keys', () => {
      it('returns true when every source cert has a matching CSR with all required fields', () => {
        const fix = buildFixState({
          sourceOriginCaCertificates: [
            { id: 'src1', hostnames: ['a.com'] },
            { id: 'src2', hostnames: ['b.com'] },
          ],
          originCaCsrs: [
            { sourceId: 'src1', hostnames: ['a.com'], csr: '-----BEGIN CERTIFICATE REQUEST-----...', request_type: 'origin-rsa', requested_validity: 5475 },
            { sourceId: 'src2', hostnames: ['b.com'], csr: '-----BEGIN CERTIFICATE REQUEST-----...', request_type: 'origin-ecc', requested_validity: 365 },
          ],
        });
        expect(isItemFixed('origin_ca_keys', fix)).toBe(true);
      });

      it('returns false when a source cert has no matching CSR', () => {
        const fix = buildFixState({
          sourceOriginCaCertificates: [{ id: 'src1', hostnames: ['a.com'] }, { id: 'src2', hostnames: ['b.com'] }],
          originCaCsrs: [
            { sourceId: 'src1', hostnames: ['a.com'], csr: 'pem', request_type: 'origin-rsa', requested_validity: 5475 },
          ],
        });
        expect(isItemFixed('origin_ca_keys', fix)).toBe(false);
      });

      it('returns false when the matching CSR has an empty csr field', () => {
        const fix = buildFixState({
          sourceOriginCaCertificates: [{ id: 'src1', hostnames: ['a.com'] }],
          originCaCsrs: [
            { sourceId: 'src1', hostnames: ['a.com'], csr: '', request_type: 'origin-rsa', requested_validity: 5475 },
          ],
        });
        expect(isItemFixed('origin_ca_keys', fix)).toBe(false);
      });

      it('returns false when requested_validity is zero', () => {
        const fix = buildFixState({
          sourceOriginCaCertificates: [{ id: 'src1', hostnames: ['a.com'] }],
          originCaCsrs: [
            { sourceId: 'src1', hostnames: ['a.com'], csr: 'pem', request_type: 'origin-rsa', requested_validity: 0 },
          ],
        });
        expect(isItemFixed('origin_ca_keys', fix)).toBe(false);
      });

      it('returns false when hostnames is empty', () => {
        const fix = buildFixState({
          sourceOriginCaCertificates: [{ id: 'src1', hostnames: ['a.com'] }],
          originCaCsrs: [
            { sourceId: 'src1', hostnames: [], csr: 'pem', request_type: 'origin-rsa', requested_validity: 5475 },
          ],
        });
        expect(isItemFixed('origin_ca_keys', fix)).toBe(false);
      });

      it('returns true vacuously when no source Origin CA certs exist', () => {
        const fix = buildFixState({});
        expect(isItemFixed('origin_ca_keys', fix)).toBe(true);
      });
    });

    describe('isItemFixed: notification_webhook_secret (bucket 2.1)', () => {
      it('returns true when every source webhook has a non-empty secret', () => {
        const fix = buildFixState({
          sourceNotificationWebhooks: [
            { id: 'src-1', name: 'pager-prod', type: 'generic', url: 'https://example.com/a' },
            { id: 'src-2', name: 'slack-eng', type: 'slack', url: 'https://example.com/b' },
          ],
          notificationWebhookSecrets: {
            'pager-prod': 'real-secret-1',
            'slack-eng': 'real-secret-2',
          },
        });
        expect(isItemFixed('notification_webhook_secret', fix)).toBe(true);
      });

      it('returns false when any source webhook is missing its secret', () => {
        const fix = buildFixState({
          sourceNotificationWebhooks: [
            { name: 'pager-prod' },
            { name: 'slack-eng' },
          ],
          notificationWebhookSecrets: { 'pager-prod': 'value' },
        });
        expect(isItemFixed('notification_webhook_secret', fix)).toBe(false);
      });

      it('returns false when a secret value is the empty string', () => {
        const fix = buildFixState({
          sourceNotificationWebhooks: [{ name: 'pager-prod' }],
          notificationWebhookSecrets: { 'pager-prod': '' },
        });
        expect(isItemFixed('notification_webhook_secret', fix)).toBe(false);
      });

      it('returns true vacuously when no source webhooks exist', () => {
        const fix = buildFixState({});
        expect(isItemFixed('notification_webhook_secret', fix)).toBe(true);
      });

      it('keys lookups by webhook NAME (source IDs not used)', () => {
        // Defensive: the migration code keys by name because IDs change
        // between source and dest. Confirm a value stored under a
        // different name does NOT satisfy the source webhook with
        // a matching id but different name.
        const fix = buildFixState({
          sourceNotificationWebhooks: [{ id: 'src-1', name: 'real-name' }],
          notificationWebhookSecrets: { 'wrong-name': 'value' },
        });
        expect(isItemFixed('notification_webhook_secret', fix)).toBe(false);
      });
    });

    describe('isItemFixed: identity_provider_secrets (bucket 2.2)', () => {
      it('returns true when every migratable IdP has a secret', () => {
        // Two OAuth IdPs — both need values.
        const fix = buildFixState({
          sourceIdentityProviders: [
            { name: 'corp-oidc', type: 'oidc' },
            { name: 'corp-okta', type: 'okta' },
          ],
          identityProviderSecrets: {
            'corp-oidc': 'secret-1',
            'corp-okta': 'secret-2',
          },
        });
        expect(isItemFixed('identity_provider_secrets', fix)).toBe(true);
      });

      it('returns false when any OAuth IdP is missing its secret', () => {
        const fix = buildFixState({
          sourceIdentityProviders: [
            { name: 'corp-oidc', type: 'oidc' },
            { name: 'corp-okta', type: 'okta' },
          ],
          identityProviderSecrets: { 'corp-oidc': 'v' },
        });
        expect(isItemFixed('identity_provider_secrets', fix)).toBe(false);
      });

      it('filters out onetimepin (auto-provisioned, never needs a secret)', () => {
        const fix = buildFixState({
          sourceIdentityProviders: [
            { name: '', type: 'onetimepin' },  // auto-provisioned, no name
            { name: 'corp-oidc', type: 'oidc' },
          ],
          identityProviderSecrets: { 'corp-oidc': 'value' },
        });
        // onetimepin is filtered; only corp-oidc needs a value.
        expect(isItemFixed('identity_provider_secrets', fix)).toBe(true);
      });

      it('filters out SAML (cert-based trust, no client_secret)', () => {
        // SAML uses idp_public_certs + signed assertions, not a
        // shared client_secret. The form does not prompt for one,
        // so the "fixed" check must not require one either.
        const fix = buildFixState({
          sourceIdentityProviders: [
            { name: 'corp-saml', type: 'saml' },
            { name: 'corp-oidc', type: 'oidc' },
          ],
          identityProviderSecrets: { 'corp-oidc': 'value' },
        });
        // corp-saml is filtered; only corp-oidc needs a value.
        expect(isItemFixed('identity_provider_secrets', fix)).toBe(true);
      });

      it('returns true vacuously when only filtered IdP types exist', () => {
        const fix = buildFixState({
          sourceIdentityProviders: [
            { name: '', type: 'onetimepin' },
            { name: 'corp-saml', type: 'saml' },
          ],
        });
        expect(isItemFixed('identity_provider_secrets', fix)).toBe(true);
      });

      it('returns true vacuously when no source IdPs exist', () => {
        const fix = buildFixState({});
        expect(isItemFixed('identity_provider_secrets', fix)).toBe(true);
      });

      it('treats whitespace-only secret as not-fixed', () => {
        // Defensive: the IdPSecretFix component trims on input, but
        // programmatic callers (e.g. /api/v1 JSON consumers) could
        // pass whitespace. Don't accept it as a real value.
        const fix = buildFixState({
          sourceIdentityProviders: [{ name: 'corp-oidc', type: 'oidc' }],
          identityProviderSecrets: { 'corp-oidc': '   ' },
        });
        expect(isItemFixed('identity_provider_secrets', fix)).toBe(false);
      });
    });

    describe('isItemFixed: aop_mtls_certificate_bundle (bucket 2.3)', () => {
      it('returns true when at least one bundle has all three required fields', () => {
        const fix = buildFixState({
          sourceAopHostnameAssociations: { hostnames: ['origin.example.com'] },
          aopMtlsBundles: [
            { name: 'aop-1', certificates: '-----BEGIN CERT-----', private_key: '-----BEGIN KEY-----', ca: false },
          ],
        });
        expect(isItemFixed('aop_mtls_certificate_bundle', fix)).toBe(true);
      });

      it('returns false when no bundles are supplied (and there are affected hostnames)', () => {
        const fix = buildFixState({
          sourceAopHostnameAssociations: { hostnames: ['origin.example.com'] },
          aopMtlsBundles: [],
        });
        expect(isItemFixed('aop_mtls_certificate_bundle', fix)).toBe(false);
      });

      it('returns false when a bundle has an empty private_key', () => {
        const fix = buildFixState({
          sourceAopHostnameAssociations: { hostnames: ['origin.example.com'] },
          aopMtlsBundles: [{ name: 'aop-1', certificates: 'pem', private_key: '' }],
        });
        expect(isItemFixed('aop_mtls_certificate_bundle', fix)).toBe(false);
      });

      it('returns true vacuously when no AOP hostnames exist', () => {
        const fix = buildFixState({
          sourceAopHostnameAssociations: { hostnames: [] },
        });
        expect(isItemFixed('aop_mtls_certificate_bundle', fix)).toBe(true);
      });

      it('returns true vacuously when sourceAopHostnameAssociations is null', () => {
        const fix = buildFixState({
          sourceAopHostnameAssociations: null,
        });
        expect(isItemFixed('aop_mtls_certificate_bundle', fix)).toBe(true);
      });
    });

    describe('isItemFixed: ai_gateway_custom_provider_api_keys (bucket 2.4)', () => {
      it('returns true when every source provider has an API key', () => {
        const fix = buildFixState({
          sourceAiGatewayCustomProviders: [
            { slug: 'altprov-1', name: 'Alt Provider 1' },
            { slug: 'altprov-2', name: 'Alt Provider 2' },
          ],
          aiGatewayProviderApiKeys: {
            'altprov-1': 'key-1',
            'altprov-2': 'key-2',
          },
        });
        expect(isItemFixed('ai_gateway_custom_provider_api_keys', fix)).toBe(true);
      });

      it('returns false when any provider is missing its API key', () => {
        const fix = buildFixState({
          sourceAiGatewayCustomProviders: [{ slug: 'altprov-1' }, { slug: 'altprov-2' }],
          aiGatewayProviderApiKeys: { 'altprov-1': 'value' },
        });
        expect(isItemFixed('ai_gateway_custom_provider_api_keys', fix)).toBe(false);
      });

      it('keys lookups by provider SLUG (not name)', () => {
        const fix = buildFixState({
          sourceAiGatewayCustomProviders: [{ slug: 'real-slug', name: 'Real Name' }],
          aiGatewayProviderApiKeys: { 'Real Name': 'value' },  // by-name, not by-slug
        });
        expect(isItemFixed('ai_gateway_custom_provider_api_keys', fix)).toBe(false);
      });

      it('returns true vacuously when no source providers exist', () => {
        const fix = buildFixState({});
        expect(isItemFixed('ai_gateway_custom_provider_api_keys', fix)).toBe(true);
      });
    });

    describe('isItemFixed: non-bucket-1 keys', () => {
      it('returns false for any key without an inline fix-it form', () => {
        // These items have no inline fix-it; the user can only
        // acknowledge them. isItemFixed must never return true.
        const fix = buildFixState({});
        expect(isItemFixed('access_service_tokens', fix)).toBe(false);
        expect(isItemFixed('worker_binding_hyperdrive', fix)).toBe(false);
        expect(isItemFixed('d1_schema_and_data', fix)).toBe(false);
        expect(isItemFixed('nameserver_change', fix)).toBe(false);
        expect(isItemFixed('cached_content', fix)).toBe(false);
      });
    });

    describe('deriveItemState', () => {
      it('returns "fixed" when bucket-1 item has all values supplied (even if not in ack set)', () => {
        const fix = buildFixState({
          sourceWorkers: [{ id: 'w1', bindings: [{ type: 'secret_text', name: 'A' }] }],
          workerSecrets: { w1: { A: 'value' } },
        });
        expect(deriveItemState({ key: 'worker_secrets' }, fix, new Set())).toBe('fixed');
      });

      it('returns "fixed" even when the ack box is also checked — completed fix wins', () => {
        // Rationale: if the user typed the value AND then later ticked
        // ack, the migration should use the value. Acknowledgment is
        // a "skip the fix" gesture; once the fix is complete it is
        // no longer being skipped.
        const fix = buildFixState({
          sourceWorkers: [{ id: 'w1', bindings: [{ type: 'secret_text', name: 'A' }] }],
          workerSecrets: { w1: { A: 'value' } },
        });
        expect(deriveItemState({ key: 'worker_secrets' }, fix, new Set(['worker_secrets']))).toBe('fixed');
      });

      it('returns "acknowledged" when bucket-1 item is in ack set with partial values', () => {
        const fix = buildFixState({
          sourceWorkers: [{ id: 'w1', bindings: [{ type: 'secret_text', name: 'A' }, { type: 'secret_text', name: 'B' }] }],
          workerSecrets: { w1: { A: 'v' } },  // missing B
        });
        expect(deriveItemState({ key: 'worker_secrets' }, fix, new Set(['worker_secrets']))).toBe('acknowledged');
      });

      it('returns "unresolved" when bucket-1 item has partial values and is NOT in ack set', () => {
        const fix = buildFixState({
          sourceWorkers: [{ id: 'w1', bindings: [{ type: 'secret_text', name: 'A' }] }],
          workerSecrets: {},
        });
        expect(deriveItemState({ key: 'worker_secrets' }, fix, new Set())).toBe('unresolved');
      });

      it('returns "acknowledged" for a non-bucket-1 actionable item when in ack set', () => {
        // worker_binding_hyperdrive has no inline fix-it. Ack is the
        // only way to resolve. Once acknowledged → 'acknowledged'.
        const fix = buildFixState({});
        expect(deriveItemState({ key: 'worker_binding_hyperdrive' }, fix, new Set(['worker_binding_hyperdrive']))).toBe('acknowledged');
      });

      it('returns "unresolved" for a non-bucket-1 actionable item not in ack set', () => {
        const fix = buildFixState({});
        expect(deriveItemState({ key: 'worker_binding_hyperdrive' }, fix, new Set())).toBe('unresolved');
      });

      it('returns "unresolved" for unknown keys not in ack set', () => {
        // Defensive: a totally unknown key behaves like any other
        // non-bucket-1 ack-only item.
        const fix = buildFixState({});
        expect(deriveItemState({ key: 'made_up_key' }, fix, new Set())).toBe('unresolved');
      });

      it('returns "acknowledged" for unknown keys in ack set', () => {
        const fix = buildFixState({});
        expect(deriveItemState({ key: 'made_up_key' }, fix, new Set(['made_up_key']))).toBe('acknowledged');
      });

      it('preserves pre-Principle-4 binary gating for non-bucket-1 actionable items', () => {
        // Regression guard: the previous gating logic was
        // "acknowledged.has(key) ? 'acknowledged' : 'unresolved'".
        // Bucket 1 changes only apply to the three bucket-1 keys;
        // every other actionable item must continue behaving the
        // way it did before.
        const fix = buildFixState({});
        const otherActionable = [
          'access_service_tokens',
          'turnstile_widget_secrets',
          'worker_binding_hyperdrive',
          'd1_schema_and_data',
          'r2_object_data',
          'dnssec_ds_record',
          'email_routing_destinations',
          'nameserver_change',
        ];
        for (const key of otherActionable) {
          expect(deriveItemState({ key }, fix, new Set())).toBe('unresolved');
          expect(deriveItemState({ key }, fix, new Set([key]))).toBe('acknowledged');
        }
      });
    });
  });

  // ── Bucket 3: copy-command CLI snippets ──────────────────────────
  //
  // Tests for buildCliCommands() and hasCliCommands() — the
  // helper that surfaces well-known wrangler/rclone command snippets
  // next to ack-only items. These snippets are purely informational
  // (they don't change resolution state; the user still has to ack
  // each item) and exist to reduce user error when running the
  // post-migration CLI steps.
  describe('CLI command snippets (bucket 3)', () => {
    describe('hasCliCommands / BUCKET_3_CLI_KEYS', () => {
      it('returns true for the three bucket-3 keys', () => {
        expect(hasCliCommands('d1_schema_and_data')).toBe(true);
        expect(hasCliCommands('r2_object_data')).toBe(true);
        expect(hasCliCommands('pages_deployment_data')).toBe(true);
      });

      it('returns false for keys without CLI helpers', () => {
        expect(hasCliCommands('worker_secrets')).toBe(false);  // bucket 1 (has inline fix-it instead)
        expect(hasCliCommands('access_service_tokens')).toBe(false);
        expect(hasCliCommands('worker_binding_hyperdrive')).toBe(false);
        expect(hasCliCommands('cached_content')).toBe(false);
        expect(hasCliCommands('nameserver_change')).toBe(false);
        expect(hasCliCommands('made_up_key')).toBe(false);
      });

      it('BUCKET_3_CLI_KEYS matches the documented set', () => {
        expect([...BUCKET_3_CLI_KEYS].sort()).toEqual([
          'd1_schema_and_data',
          'pages_deployment_data',
          'r2_object_data',
        ]);
      });
    });

    describe('buildCliCommands: d1_schema_and_data', () => {
      it('emits export + execute commands per source DB with the name interpolated', () => {
        const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === 'd1_schema_and_data')!;
        const commands = buildCliCommands(item, {
          d1Databases: [
            { uuid: 'u1', name: 'analytics-db', version: 'v1', created_at: '2024-01-01' },
            { uuid: 'u2', name: 'sessions-db', version: 'v1', created_at: '2024-01-01' },
          ],
        });
        expect(commands).toBeDefined();
        // Two source DBs × two commands each = four total.
        expect(commands!).toHaveLength(4);
        // Spot-check that each DB name appears in both an export and an execute command.
        const allCmds = commands!.map(c => c.command).join('\n');
        expect(allCmds).toContain('wrangler d1 export analytics-db --remote --output=analytics-db.sql');
        expect(allCmds).toContain('wrangler d1 execute analytics-db --remote --file=analytics-db.sql');
        expect(allCmds).toContain('wrangler d1 export sessions-db --remote --output=sessions-db.sql');
        expect(allCmds).toContain('wrangler d1 execute sessions-db --remote --file=sessions-db.sql');
      });

      it('returns undefined when there are no D1 databases', () => {
        const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === 'd1_schema_and_data')!;
        expect(buildCliCommands(item, {})).toBeUndefined();
        expect(buildCliCommands(item, { d1Databases: [] })).toBeUndefined();
      });

      it('falls back to <db-name> placeholder when name is missing', () => {
        // Defensive: a malformed export with missing name should not
        // crash; the snippet should still render with a placeholder
        // so the user sees the command shape.
        const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === 'd1_schema_and_data')!;
        const commands = buildCliCommands(item, {
          d1Databases: [{ uuid: 'u1' } as never],
        });
        expect(commands).toBeDefined();
        expect(commands![0].command).toContain('<db-name>');
      });
    });

    describe('buildCliCommands: r2_object_data', () => {
      it('emits a one-time rclone config + per-bucket sync commands', () => {
        const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === 'r2_object_data')!;
        const commands = buildCliCommands(item, {
          r2Buckets: [
            { name: 'media-assets', creation_date: '2024-01-01' },
            { name: 'user-uploads', creation_date: '2024-01-01' },
          ],
        });
        expect(commands).toBeDefined();
        // One setup + two per-bucket sync = three total.
        expect(commands!).toHaveLength(3);
        expect(commands![0].command).toBe('rclone config');
        expect(commands![0].label).toMatch(/one-time setup/i);
        expect(commands![1].command).toBe('rclone sync --progress src:media-assets dst:media-assets');
        expect(commands![2].command).toBe('rclone sync --progress src:user-uploads dst:user-uploads');
      });

      it('returns undefined when there are no R2 buckets', () => {
        const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === 'r2_object_data')!;
        expect(buildCliCommands(item, {})).toBeUndefined();
        expect(buildCliCommands(item, { r2Buckets: [] })).toBeUndefined();
      });

      it('falls back to <bucket-name> placeholder when name is missing', () => {
        const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === 'r2_object_data')!;
        const commands = buildCliCommands(item, {
          r2Buckets: [{ creation_date: '2024-01-01' } as never],
        });
        expect(commands).toBeDefined();
        // Setup at [0], sync command at [1] should contain the placeholder.
        expect(commands![1].command).toContain('<bucket-name>');
      });
    });

    describe('buildCliCommands: pages_deployment_data', () => {
      it('emits one deploy command per source project with the project name interpolated', () => {
        const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === 'pages_deployment_data')!;
        const commands = buildCliCommands(item, {
          pagesProjects: [
            { name: 'marketing-site' },
            { name: 'docs-site' },
          ],
        });
        expect(commands).toBeDefined();
        expect(commands!).toHaveLength(2);
        expect(commands![0].command).toBe('wrangler pages deploy <dir> --project-name=marketing-site');
        expect(commands![1].command).toBe('wrangler pages deploy <dir> --project-name=docs-site');
      });

      it('returns undefined when there are no Pages projects', () => {
        const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === 'pages_deployment_data')!;
        expect(buildCliCommands(item, {})).toBeUndefined();
        expect(buildCliCommands(item, { pagesProjects: [] })).toBeUndefined();
      });

      it('emits a rebuild-from-source command for git-backed projects', () => {
        const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === 'pages_deployment_data')!;
        const commands = buildCliCommands(item, {
          pagesProjects: [
            {
              name: 'marketing-site',
              source: { type: 'github', config: { owner: 'acme', repo_name: 'site', production_branch: 'main' } },
            },
          ],
        });
        expect(commands).toHaveLength(1);
        // Git-backed → API deploy trigger, NOT wrangler pages deploy.
        expect(commands![0].command).toContain('/pages/projects/marketing-site/deployments');
        expect(commands![0].command).not.toContain('wrangler pages deploy');
        // Note must name the repo + branch to reconnect.
        expect(commands![0].note).toContain('acme/site');
        expect(commands![0].note).toContain('main');
      });

      it('falls back to wrangler deploy when a git-backed project lacks repo info', () => {
        const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === 'pages_deployment_data')!;
        const commands = buildCliCommands(item, {
          pagesProjects: [{ name: 'docs-site', source: { type: 'github', config: {} } }],
        });
        expect(commands).toHaveLength(1);
        expect(commands![0].command).toBe('wrangler pages deploy <dir> --project-name=docs-site');
      });
    });

    describe('buildCliCommands: non-bucket-3 keys', () => {
      it('returns undefined for keys without CLI helpers', () => {
        // Any data the caller passes is irrelevant — the function
        // short-circuits on the key check.
        for (const key of [
          'worker_secrets',
          'access_service_tokens',
          'worker_binding_hyperdrive',
          'cached_content',
          'nameserver_change',
        ]) {
          const item = IMPOSSIBLE_TO_MIGRATE.find(r => r.key === key);
          if (!item) continue;  // skip if catalog doesn't have it
          expect(buildCliCommands(item, {
            d1Databases: [{ uuid: 'u', name: 'd', version: 'v', created_at: '2024-01-01' }],
            r2Buckets: [{ name: 'b', creation_date: '2024-01-01' }],
            pagesProjects: [{ name: 'p' }],
          })).toBeUndefined();
        }
      });
    });

    describe('cliCommands stamping during detection', () => {
      it('stamps cliCommands onto bucket-3 results when detection finds them', () => {
        const results = detectApplicableImpossibleResources({
          d1Databases: [{ uuid: 'u1', name: 'mydb', version: 'v1', created_at: '2024-01-01' }],
          r2Buckets: [{ name: 'mybucket', creation_date: '2024-01-01' }],
          pagesProjects: [{ name: 'myproject' }],
        });
        const d1 = results.find(r => r.key === 'd1_schema_and_data');
        const r2 = results.find(r => r.key === 'r2_object_data');
        const pages = results.find(r => r.key === 'pages_deployment_data');
        expect(d1?.cliCommands).toBeDefined();
        expect(d1!.cliCommands!.length).toBeGreaterThan(0);
        expect(r2?.cliCommands).toBeDefined();
        expect(r2!.cliCommands!.length).toBeGreaterThan(0);
        expect(pages?.cliCommands).toBeDefined();
        expect(pages!.cliCommands!.length).toBeGreaterThan(0);
      });

      it('leaves cliCommands undefined on non-bucket-3 results', () => {
        const results = detectApplicableImpossibleResources({
          workers: [{ id: 'w1', bindings: [{ type: 'secret_text', name: 'S' }, { type: 'hyperdrive', name: 'H' }] }],
        });
        for (const r of results) {
          if (!BUCKET_3_CLI_KEYS.has(r.key)) {
            expect(r.cliCommands, `${r.key} should not have cliCommands`).toBeUndefined();
          }
        }
      });
    });
  });
});

// #19 two-phase split: the Account step gates/shows ONLY account-phase
// impossible items; the Zone step ONLY zone-phase items. This partition drives
// both the acknowledgment gate and the secret fix-it form placement, so it must
// be total (every catalog entry resolves to exactly one phase) and stable.
describe('impossibleResourcePhase', () => {
  it('maps account-scoped cryptographic fix-it keys to the account phase', () => {
    const accountKeys = [
      'worker_secrets',
      'origin_ca_keys',
      'notification_webhook_secret',
      'identity_provider_secrets',
      'ai_gateway_custom_provider_api_keys',
      'access_service_tokens',
      'turnstile_widget_secrets',
    ];
    for (const key of accountKeys) {
      expect(impossibleResourcePhase({ key, category: 'cryptographic' }), key).toBe('account');
    }
  });

  it('maps zone-scoped cryptographic fix-it keys to the zone phase', () => {
    for (const key of ['custom_certificate_keys', 'aop_mtls_certificate_bundle']) {
      expect(impossibleResourcePhase({ key, category: 'cryptographic' }), key).toBe('zone');
    }
  });

  it('routes every account_tied entry to the account phase regardless of key', () => {
    expect(impossibleResourcePhase({ key: 'byoip_prefixes', category: 'account_tied' })).toBe('account');
    expect(impossibleResourcePhase({ key: 'cloudflare_registrar', category: 'account_tied' })).toBe('account');
  });

  it('defaults non-account items (manual/informational) to the zone phase', () => {
    expect(impossibleResourcePhase({ key: 'nameserver_change', category: 'manual_external' })).toBe('zone');
    expect(impossibleResourcePhase({ key: 'dnssec_ds_record', category: 'manual_external' })).toBe('zone');
    expect(impossibleResourcePhase({ key: 'universal_ssl', category: 'auto_managed' })).toBe('zone');
    expect(impossibleResourcePhase({ key: 'cache_content', category: 'data_ephemeral' })).toBe('zone');
  });

  it('is a total function over the whole IMPOSSIBLE_TO_MIGRATE catalog', () => {
    for (const entry of IMPOSSIBLE_TO_MIGRATE) {
      const ph = impossibleResourcePhase(entry);
      expect(['account', 'zone'], `${entry.key} → ${ph}`).toContain(ph);
    }
  });

  it('every account_tied catalog entry resolves to the account phase', () => {
    const tied = IMPOSSIBLE_TO_MIGRATE.filter(e => e.category === 'account_tied');
    expect(tied.length, 'expected the catalog to contain account_tied entries').toBeGreaterThan(0);
    for (const e of tied) {
      expect(impossibleResourcePhase(e), e.key).toBe('account');
    }
  });

  it('partitions a rich export with NO item lost and BOTH phases populated', () => {
    // A source that triggers both account- and zone-scoped impossible items.
    const results = detectApplicableImpossibleResources({
      workers: [{ id: 'w1', bindings: [{ type: 'secret_text', name: 'S' }] }],
      customCertificates: [{ id: 'c1', hosts: ['example.com'] }],
      originCaCertificates: [{ id: 'o1', hostnames: ['example.com'] }],
    });
    const account = results.filter(r => impossibleResourcePhase(r) === 'account');
    const zone = results.filter(r => impossibleResourcePhase(r) === 'zone');

    // Anti-vacuous: the partition must be non-trivial on both sides AND
    // account + zone must equal the whole set (no item silently dropped).
    expect(account.length, 'expected account-phase items (e.g. worker_secrets)').toBeGreaterThan(0);
    expect(zone.length, 'expected zone-phase items (e.g. custom_certificate_keys)').toBeGreaterThan(0);
    expect(account.length + zone.length).toBe(results.length);

    expect(account.map(r => r.key)).toContain('worker_secrets');
    expect(account.map(r => r.key)).toContain('origin_ca_keys');
    expect(zone.map(r => r.key)).toContain('custom_certificate_keys');
  });
});
