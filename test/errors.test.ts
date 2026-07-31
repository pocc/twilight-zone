import { describe, it, expect } from 'vitest';
import {
  isAcknowledgeableSingletonError,
  isManualActionError,
  isConflictError,
  isPagesGitInstallationError,
  isMaxConfigAcknowledgeable,
} from '../src/migrate/errors';

describe('migrate/errors classifiers', () => {
  describe('isAcknowledgeableSingletonError — plan/edit-gated zone settings (B4)', () => {
    // Exact strings captured from maxconfig E2E runs (see saved-run reports).
    const ACK_GATED = [
      'Not allowed to edit setting for http2',
      'Not allowed to edit setting for long_lived_grpc',
      'Not allowed to edit zone setting origin_error_page_pass_thru',
      'Not allowed to edit zone setting prefetch_preload',
      'Not allowed to edit setting for proxy_read_timeout',
      'Not allowed to edit zone setting response_buffering',
      'Not allowed to edit zone setting sort_query_string_for_cache',
      'Not allowed to edit zone setting true_client_ip_header',
      'Not allowed to edit setting for webp',
      // Regional Tiered Cache singleton.
      'Sorry, this zone setting is read only type.',
      // Smart Shield plan gate.
      'Upgrade Smart Shield to unlock argo_smart_routing.',
    ];
    for (const msg of ACK_GATED) {
      it(`acknowledges: "${msg}"`, () => {
        expect(isAcknowledgeableSingletonError(msg)).toBe(true);
      });
    }

    it('still acknowledges the pre-existing entitlement-gap strings', () => {
      expect(isAcknowledgeableSingletonError('This feature is not available to this zone')).toBe(true);
      expect(isAcknowledgeableSingletonError('A subscription is required')).toBe(true);
      expect(isAcknowledgeableSingletonError('Account is not entitled to this feature')).toBe(true);
    });

    it('does NOT acknowledge genuine, user-fixable failures', () => {
      // These must remain `failed` so real problems surface.
      expect(isAcknowledgeableSingletonError('DNS record content is invalid')).toBe(false);
      expect(isAcknowledgeableSingletonError('Validation failed: name is too long')).toBe(false);
      expect(isAcknowledgeableSingletonError('Invalid value for parameter foo')).toBe(false);
      expect(isAcknowledgeableSingletonError('record already exists')).toBe(false);
    });
  });

  describe('isConflictError — same-named resource already present (B5)', () => {
    const CONFLICTS = [
      'A record with this name already exists',
      'group names must be unique',
      'access.api.error.invalid_request: group names must be unique',
      'name is already in use',
      'This is a duplicate',
      'value is already taken',
      // #15: overwrite/MaxConfig re-runs surface these for resources already
      // present as desired — must classify as conflict (→ on-target), not
      // failure.
      'An identical record already exists',
      'duplicate_of_existing',
      // Access Tags (and other Access account endpoints) return the
      // underscore form, which the space-form "already exists" pattern misses.
      // Account-scoped resources persist across runs, so a re-create hits this
      // and must be a conflict (skip), not a hard failure (Principle 1).
      'access.api.error.resource_already_exists',
    ];
    for (const msg of CONFLICTS) {
      it(`treats as conflict: "${msg}"`, () => {
        expect(isConflictError(msg)).toBe(true);
      });
    }

    it('does NOT treat unrelated errors as conflicts', () => {
      expect(isConflictError('Internal server error')).toBe(false);
      expect(isConflictError('Not allowed to edit setting for http2')).toBe(false);
    });
  });

  describe('isManualActionError — entitlement/enablement gaps', () => {
    it('flags feature-enable errors as manual action', () => {
      expect(isManualActionError('Access is not enabled')).toBe(true);
      expect(isManualActionError('enable R2 through the dashboard')).toBe(true);
    });
    it('does not flag opaque generic failures', () => {
      expect(isManualActionError('API request failed')).toBe(false);
    });
    // Regression for Check 4/HIGH-2: bare 'dashboard' / 'visit the' substrings
    // were downgrading genuine failures to acknowledged (gray), hiding real
    // errors on Step 4. These must surface as failures (Principle 1 & 9).
    it('does NOT downgrade genuine failures that merely mention the dashboard', () => {
      expect(isManualActionError('Internal error — check the dashboard for details')).toBe(false);
      expect(isManualActionError('Unexpected error. Visit the status page.')).toBe(false);
    });
    // But a specific enablement instruction is still a manual action.
    it('still flags explicit enablement instructions', () => {
      expect(isManualActionError('Please enable this feature on the destination')).toBe(true);
      expect(isManualActionError('enable R2 through the dashboard')).toBe(true);
    });
  });

  // Regression: account-scoped E2E runs surfaced 9-12 git-backed Pages
  // projects as red FAILED rows ("internal issue with your Cloudflare Pages
  // Git installation"). A git-backed project cannot be recreated via API on
  // an account lacking the source's Git connection — it is account-tied and
  // unavoidable, so it must land as acknowledged + manual action (Principle 1),
  // not failed.
  describe('isPagesGitInstallationError — git-backed Pages on an account without the Git connection', () => {
    it('flags the exact CF Pages Git-installation error', () => {
      expect(isPagesGitInstallationError(
        'There is an internal issue with your Cloudflare Pages Git installation. If this issue persists after reinstalling your installation, contact support: https://cfl.re/3WgEyrH.',
      )).toBe(true);
    });
    it('is case-insensitive', () => {
      expect(isPagesGitInstallationError('CLOUDFLARE PAGES GIT INSTALLATION problem')).toBe(true);
    });
    it('does NOT match unrelated git/pages errors (no silent downgrade)', () => {
      expect(isPagesGitInstallationError('git clone failed')).toBe(false);
      expect(isPagesGitInstallationError('Pages project build failed')).toBe(false);
      expect(isPagesGitInstallationError('API request failed')).toBe(false);
    });
  });

  // Regression: Enterprise→Free live migration of enttest.example.com surfaced
  // these as red FAILED rows in the API-direct (no-acknowledgments) path.
  // They are plan/entitlement/managed/already-present outcomes that the
  // product's own principles (1, 2, 6) require to land as acknowledged or
  // skipped — never failed. See /tmp/done log (2026-06-01 e2e-to-zero run).
  describe('rewrite e2e regression: plan/entitlement → acknowledged, not failed', () => {
    it('acknowledges plan-unavailable zone settings (origin_h2_max_streams, Regional Tiered Cache)', () => {
      const msg = 'Sorry, this zone setting is not available for your plan type.';
      expect(isAcknowledgeableSingletonError(msg)).toBe(true);
      expect(isManualActionError(msg)).toBe(true);
    });
    it('acknowledges the phase rule-count plan cap (23 out of 5 on Free)', () => {
      const msg = 'exceeded the maximum number of rules in the phase http_request_firewall_custom: 23 out of 5';
      expect(isManualActionError(msg)).toBe(true);
    });
    it('acknowledges Bot Management entitlement gap', () => {
      expect(isManualActionError('zone not entitled to enable likely automated bots ruleset')).toBe(true);
    });
    it('treats a duplicate page rule as an already-present conflict (→ skipped)', () => {
      expect(isConflictError('Your zone already has an existing page rule with that URL.')).toBe(true);
    });
    it('does NOT over-match a genuine rule-count validation error', () => {
      // A real "too many rules in one ruleset payload" bug should still fail;
      // only the specific plan-cap phrasing is acknowledged.
      expect(isManualActionError('rule expression exceeded the maximum length')).toBe(false);
    });
  });

  // Regression for e2e run 2026-06-08 #001/#002 (assertNoUnexpectedFailures):
  // AI Gateway `ishtar-gate` landed as a red FAILED row because its
  // log_management value exceeded the dest free-tier ceiling. This is a
  // plan/entitlement gap (Principle 2) the user cannot fix mid-migration, so
  // it must acknowledge, not fail.
  describe('AI Gateway plan-limit → acknowledged, not failed', () => {
    it('acknowledges the log_management free-tier ceiling error', () => {
      const msg = 'log_management 10000000 exceeds the free-tier ceiling of 100000. Upgrade your plan to increase this limit.';
      expect(isManualActionError(msg)).toBe(true);
    });
    it('matches either phrase independently', () => {
      expect(isManualActionError('value exceeds the free-tier ceiling of 100000')).toBe(true);
      expect(isManualActionError('Upgrade your plan to increase this limit.')).toBe(true);
    });
    it('does NOT over-match a generic validation failure', () => {
      // A real bad-value error must still fail loudly.
      expect(isManualActionError('log_management value must be a positive integer')).toBe(false);
    });
  });

  // Regression for the live maxconfig migration to twilight-maxconfig3.ross.gg:
  // Snippets, standalone Healthchecks, Firewall Lockdowns, and Smart Shield
  // Health Checks landed as red FAILED rows on Step 4 even though all four are
  // plan/entitlement gaps. They migrate via migrateItems(), whose only
  // acknowledged-vs-failed gate is isManualActionError() — and the three error
  // strings only existed in isMaxConfigAcknowledgeable (preset/fuzz), which is
  // deliberately NOT wired into the migrate engine. So the api/json/terraform
  // migrate path surfaced them as surprise failures (violates Principle 1/2).
  describe('migrate-engine entitlement gaps that were leaking as FAILED (P1/P2)', () => {
    it('acknowledges Snippets plan gate', () => {
      expect(isManualActionError('snippets are not allowed')).toBe(true);
    });
    it('acknowledges standalone Healthchecks entitlement gap', () => {
      expect(isManualActionError('health checks disabled for zone: validation failed')).toBe(true);
    });
    it('acknowledges Smart Shield Health Checks (same string as Healthchecks)', () => {
      expect(isManualActionError('health checks disabled for zone: validation failed')).toBe(true);
    });
    it('acknowledges Firewall Lockdowns underscore-form not_entitled code', () => {
      expect(isManualActionError('zonelockdown.api.not_entitled.max_rules')).toBe(true);
    });
    // The SINGLETON net (migrateSingleton → isAcknowledgeableSingletonError) must
    // also acknowledge these: Snippet Rules is a singleton PUT, so a plan that
    // disallows Snippets leaks there too unless the singleton classifier matches.
    it('singleton net acknowledges the same entitlement strings', () => {
      expect(isAcknowledgeableSingletonError('snippets are not allowed')).toBe(true);
      expect(isAcknowledgeableSingletonError('health checks disabled for zone: validation failed')).toBe(true);
      expect(isAcknowledgeableSingletonError('zonelockdown.api.not_entitled.max_rules')).toBe(true);
    });
    // Guardrails: the new patterns must not downgrade genuine, user-fixable
    // failures to a gray acknowledged row, on EITHER net.
    it('does NOT over-match unrelated health-check or snippet failures', () => {
      expect(isManualActionError('health check returned HTTP 500 from origin')).toBe(false);
      expect(isManualActionError('snippet code failed to compile: unexpected token')).toBe(false);
      expect(isManualActionError('entitled to nothing')).toBe(false);
      expect(isAcknowledgeableSingletonError('health check returned HTTP 500 from origin')).toBe(false);
      expect(isAcknowledgeableSingletonError('snippet code failed to compile: unexpected token')).toBe(false);
    });
  });

  // Regression for the maxconfig run on twilight-test5 (a low-tier zone): 8
  // entitlement/plan/zone-state rejections were being counted as ✗ failures.
  // They are EXPECTED for the zone's tier → acknowledged, not failed (P1/P2).
  describe('isMaxConfigAcknowledgeable — preset/fuzz entitlement & zone-state gaps', () => {
    const ACK = [
      'Access denied.',                                       // origin_max_http_version / origin_h2_max_streams (Enterprise)
      'not entitled to use the Origin Host override',         // http_request_origin ruleset
      'Active zone required',                                 // Email Routing on a pending zone
      'Zone not entitled to this functionality',              // Waiting Room
      'snippets are not allowed',                             // Snippets plan gate
      'zonelockdown.api.not_entitled.max_rules',              // firewall lockdown (underscore form)
      'Unable to purge. Unauthorized.',                       // Cache Purge token-scope gap
      'health checks disabled for zone: validation failed',   // Health Check
      // Inherited from isAcknowledgeableSingletonError:
      'not available for your plan',
      'Sorry, this zone setting is not available for your plan type.',
    ];
    for (const msg of ACK) {
      it(`acknowledges: ${msg}`, () => {
        expect(isMaxConfigAcknowledgeable(msg)).toBe(true);
      });
    }

    // These must still FAIL loudly — they are real defects/bugs, not gaps.
    const FAIL = [
      'invalid JSON: unknown field "enabled"',                // Content Upload Scan payload bug (now fixed)
      'unknown directive',                                    // Page Shield value payload bug (now fixed)
      'invalid ip provided to zonelockdown: 192.0.2.0/24',    // lockdown CIDR payload bug (now fixed)
      'Internal server error',
      'Bad Request',                                          // handled at the bot_management call site, not here
    ];
    for (const msg of FAIL) {
      it(`does NOT acknowledge (must fail loud): ${msg}`, () => {
        expect(isMaxConfigAcknowledgeable(msg)).toBe(false);
      });
    }
  });
});
