// Error classifiers for the migrate engine.
//
// These functions inspect Cloudflare API error messages and route them to
// one of four outcomes:
//   - acknowledgeable singleton (PUT call → entitlement gap, user knows)
//   - manual action (requires user to enable/configure on dest)
//   - conflict (resource already exists; honour conflictStrategy)
//   - real error (transient or user-fixable; surface as failed)
//
// Pure, isolated, safe to unit-test without HTTP mocking.

// Detect errors that should land as acknowledgeable items on singleton
// (non-list) settings. These are entitlement gaps the user knows about
// (e.g. "ACM not enabled on this zone" when migrating `ciphers`) — they
// should not be surfaced as failures.
export function isAcknowledgeableSingletonError(error: string): boolean {
  const patterns = [
    'not available to this account',
    'not available to this zone',
    'not granted for this zone',
    'access to configure this resource has not been granted',
    'not enabled',
    'is not enabled',
    'feature is available with',
    'requires the',           // "requires the Advanced Certificate Manager"
    'subscription required',
    'subscription is required',   // "A fraud detection subscription is required"
    'requires a subscription',
    'contact support',
    'plan does not',
    // Plan-gated settings on a lower-tier dest return "Sorry, this zone
    // setting is not available for your plan type." (e.g. origin_h2_max_streams,
    // Regional Tiered Cache when migrating Enterprise→Free). The dest zone
    // gets whatever its plan allows; acknowledging is the correct outcome.
    'not available for your plan',
    'not entitled',
    'not entitled to',
    // Underscore form of the entitlement code (e.g.
    // "zonelockdown.api.not_entitled.max_rules"). The space-form 'not entitled'
    // above does not match the underscore. Kept in lockstep with the same
    // pattern in isManualActionError so BOTH migrate-engine nets (singleton via
    // migrateSingleton, list via migrateItems) acknowledge it. A singleton can
    // hit this too — e.g. the Snippet Rules PUT below is a singleton.
    'not_entitled',
    // Plan-gated entitlement strings that also surface on SINGLETON migrations,
    // not just list items. Snippet Rules is a migrateSingleton call, so a
    // plan that disallows Snippets makes it throw "snippets are not allowed";
    // health-check singletons can throw the disabled-for-zone validation error.
    // Mirrors the additions in isManualActionError (the list-path net) so the
    // two engine nets stay consistent (Principle 1/2).
    'snippets are not allowed',
    'health checks disabled for zone',
    'feature not available',
    'this feature requires',
    // Plan/entitlement-gated zone settings return one of these. The dest
    // zone gets whatever value its plan dictates; the user cannot change
    // this by acknowledging. Surface as acknowledged (Principle 1), not
    // failed. Verified strings from maxconfig runs:
    //   - "Not allowed to edit setting for http2"
    //   - "Not allowed to edit zone setting long_lived_grpc"  (etc.)
    //   - Regional Tiered Cache: "Sorry, this zone setting is read only type."
    //   - Smart Shield: "Upgrade Smart Shield to unlock argo_smart_routing."
    'not allowed to edit',
    'zone setting is read only',
    'to unlock',
  ];
  const lower = error.toLowerCase();
  return patterns.some(p => lower.includes(p));
}

// Detect MaxConfig/preset/fuzz outcomes that are entitlement, plan-tier,
// zone-state, or credential-scope gaps the operator cannot fix mid-run on the
// target zone — they must surface as ACKNOWLEDGED (⏭), not as FAILED (✗).
//
// MaxConfig deliberately drives every request-affecting setting/subsystem to
// its maximum on whatever zone it's pointed at. On a non-Enterprise (or
// otherwise unentitled / still-pending) zone, a large share of those writes
// come back as a plan/entitlement/zone-state rejection. Counting those as
// failures contradicts Principle 1 (No Surprise Failures) and Principle 2
// (entitlement gaps → acknowledgment, not failure): they are EXPECTED for the
// zone's tier, not defects in the tool.
//
// This is a superset of isAcknowledgeableSingletonError (which the migrate
// engine uses for singleton settings) plus the additional verified strings
// MaxConfig/fuzz surface from the broader subsystem + action endpoints:
//   - "Access denied."                              (Enterprise-only zone
//     settings origin_max_http_version / origin_h2_max_streams on a lower tier)
//   - "Active zone required"                        (Email Routing enable on a
//     still-pending zone — zone state, not a tool defect)
//   - "snippets are not allowed"                    (Snippets plan gate)
//   - "zonelockdown.api.not_entitled.max_rules"     (underscore variant of
//     "not entitled" that the space-form pattern below would miss)
//   - "Unable to purge. ... Unauthorized."          (token lacks the Cache
//     Purge permission — a credential-scope gap the operator fixes by editing
//     their token, not a MaxConfig defect; surfaced honestly with its reason
//     rather than a fake success or an inflated failure)
//
// Scoped to the preset/fuzz flows on purpose — it is NOT wired into the
// migrate engine, so the broad-but-context-safe 'access denied' / 'unable to
// purge' substrings here can never silently downgrade a real account-to-account
// migration failure. Bare generic statuses (e.g. a plain "Bad Request" from
// Super Bot Fight Mode on an unentitled zone) are intentionally NOT matched
// here — they're handled at their specific call site so this classifier can
// never blanket-mask an unrelated 400.
export function isMaxConfigAcknowledgeable(error: string): boolean {
  if (isAcknowledgeableSingletonError(error)) return true;
  const lower = error.toLowerCase();
  const maxConfigPatterns = [
    'access denied',
    'active zone required',
    'snippets are not allowed',
    'not_entitled',
    'unable to purge',
    'health checks disabled for zone',
  ];
  return maxConfigPatterns.some(p => lower.includes(p));
}

// Detect if error requires manual action (subscription/enablement required).
export function isManualActionError(error: string): boolean {
  const manualActionPatterns = [
    'not enabled',
    'enable access',
    'enable r2',
    'enable through',
    'reach out to support',
    'please enable',
    // NB: do NOT add bare 'dashboard' or 'visit the' here. They match
    // arbitrary errors ("internal error — check the dashboard", "visit the
    // docs") and would silently downgrade a genuine failure to a gray
    // "acknowledged" row, violating Principle 1 (No Surprise Failures) and
    // Principle 9 (fail loud). The specific enablement/entitlement phrases
    // below already catch real "enable it in the dashboard" entitlement gaps.
    // This mirrors the deliberate name-scoping of isConflictError below.
    'certificate manager',        // ACM-gated settings (e.g. ciphers)
    'you need to enable',         // Generic "enable X" errors (e.g. Analytics Engine)
    'subscription required',
    'subscription is required',   // "A fraud detection subscription is required"
    'requires a subscription',
    'not entitled',
    // Underscore form of the entitlement gate. CF returns coded errors like
    // "zonelockdown.api.not_entitled.max_rules" (Firewall Lockdowns on a plan
    // whose lockdown-rule cap is 0). The space-form 'not entitled' pattern
    // above does NOT match the underscore, so this row is required. Any
    // `not_entitled` code is by definition an entitlement gap → acknowledge,
    // don't fail (Principle 2). Previously only in isMaxConfigAcknowledgeable,
    // so the migrate engine surfaced it as a red FAILED row.
    'not_entitled',
    // Snippets plan gate: the dest zone's plan does not permit Snippets, so
    // createSnippet returns "snippets are not allowed". Plan-tier gap the user
    // cannot fix mid-migration — acknowledge (Principle 2). Was only matched by
    // isMaxConfigAcknowledgeable (preset/fuzz), never by the migrate engine.
    'snippets are not allowed',
    // Standalone Health Checks (and Smart Shield Health Checks) require a plan
    // entitlement; on a dest plan without it, createHealthcheck returns
    // "health checks disabled for zone: validation failed". Entitlement gap →
    // acknowledge. Specific enough that it cannot mask an unrelated failure.
    // (Note: 'not enabled' above does NOT match "disabled", so this is needed.)
    'health checks disabled for zone',
    'not available to this account',
    'not available to this zone',
    // Plan-gated zone setting on a lower-tier dest (e.g. origin_h2_max_streams
    // Enterprise→Free): "not available for your plan type". User can't change
    // it without a plan upgrade — acknowledge, don't fail.
    'not available for your plan',
    // Phase rule-count cap on a lower-tier dest plan: "exceeded the maximum
    // number of rules in the phase http_request_firewall_custom: 23 out of 5".
    // This is a plan limit (Free=5), not a user-fixable error — acknowledge it
    // rather than surfacing a red failure (Principle 2: entitlement→ack).
    'exceeded the maximum number of rules in the phase',
    // AI Gateway gateway-config value that exceeds the dest plan's ceiling,
    // e.g. "log_management 10000000 exceeds the free-tier ceiling of 100000.
    // Upgrade your plan to increase this limit." The source gateway was on a
    // paid tier; the dest is free. This is a plan/entitlement gap the user
    // cannot resolve mid-migration — acknowledge it (Principle 2), don't fail.
    'exceeds the free-tier ceiling',
    'upgrade your plan to increase this limit',
    'feature is available with',
    'plan does not',
    'this feature requires',
    // Transient cert-service backend errors after retries exhausted —
    // user can re-run the migration to retry. See src/api.ts:isTransientCertServiceError.
    'certificate service was temporarily unavailable',
    'is a transient backend issue',
    // Account-level Turnstile widget cap exceeded — user must delete unused widgets first.
    'reached the limit of widgets',
    // SSL-for-SaaS quota exhausted — user must contact CSM or upgrade.
    'no quota has been allocated for this zone',
    'no quota has been allocated for this account',
    // Custom hostname not attached to zone — config drift on dest, user action required.
    'host is not attached to this zone',
    // Spectrum: when the dest account doesn't have Spectrum entitlement,
    // CF returns errors that vary by which fields you send:
    //   - "the requested protocol is not available" (minimal body)
    //   - 'json: unknown field "tls"' / '"origin_dns"' / '"traffic_type"'
    //     (full body — CF's validator rejects fields the unentitled tier
    //     can't use, with a misleading "unknown field" message)
    // None of these are real validation errors; they all mean "Spectrum
    // isn't enabled on this account". Acknowledge them rather than fail.
    'the requested protocol is not available',
    'requested protocol is not available',
    // Spectrum strict-validation responses for unentitled accounts:
    'json: unknown field "tls"',
    'json: unknown field "origin_dns"',
    'json: unknown field "traffic_type"',
    'json: unknown field "origin_direct"',
    'json: unknown field "proxy_protocol"',
    'json: unknown field "ip_firewall"',
    'json: unknown field "edge_ips"',
  ];
  const lowerError = error.toLowerCase();
  return manualActionPatterns.some(pattern => lowerError.includes(pattern));
}

// Detect the "Pages Git installation" error CF returns when you try to
// create a git-backed Pages project on a destination account that does not
// have the source account's Git (GitHub/GitLab) integration:
//
//   "There is an internal issue with your Cloudflare Pages Git installation.
//    If this issue persists after reinstalling your installation, contact
//    support: https://cfl.re/3WgEyrH."
//
// This is NOT a transient/user-fixable failure: a git-backed Pages project
// physically cannot be recreated via the API on an account that lacks the
// repo connection — the user must reconnect the repo on the destination
// (Dashboard → Workers & Pages → Create → Pages → Connect to Git). It is
// account-tied, predictable, and unavoidable, so per Principle 1 (No
// Surprise Failures) it must surface as an acknowledged manual action, not
// a red FAILED row. Matched specifically (not via a bare 'git'/'pages'
// substring) so it can never silently downgrade an unrelated failure.
export function isPagesGitInstallationError(error: string): boolean {
  return error.toLowerCase().includes('cloudflare pages git installation');
}

// Detect if error is a conflict (resource already exists).
export function isConflictError(error: string): boolean {
  const conflictPatterns = [
    'already exists',
    // Underscore variant returned by several Access account endpoints
    // (e.g. Access Tags: "access.api.error.resource_already_exists"). The
    // space-form "already exists" pattern above doesn't match the underscore
    // form, so a same-named tag/resource that already exists on the dest
    // (common with account-scoped resources that persist across runs) was
    // being recorded as a hard FAILURE instead of an already-present conflict
    // (skip). Treating it as a conflict makes these account-scoped creates
    // idempotent — re-creating a tag that's already there is on-target, not a
    // failure (Principle 1: No Surprise Failures).
    'already_exists',
    'already taken',
    'duplicate',
    'is already taken',
    // A same-named resource is already present on the destination. Access
    // Groups/Tags surface this as "group names must be unique" rather than
    // "already exists"; treat it as a conflict (skip) not a hard failure.
    // NB: keep these NAME-scoped — a bare 'already in use' would also match
    // genuine failures like "this IP address is already in use" / "port
    // already in use" and silently skip them.
    'must be unique',
    'name is already in use',
    // Page Rules report a duplicate as "Your zone already has an existing
    // page rule with that URL." (CF's retry-on-5xx can re-POST a rule that
    // the first attempt already created). The rule IS present on the dest,
    // so this is an already-present conflict → skip, not a failure.
    'existing page rule',
  ];
  const lowerError = error.toLowerCase();
  return conflictPatterns.some(pattern => lowerError.includes(pattern));
}
