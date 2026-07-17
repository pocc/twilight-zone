# AGENTS.md

Project context for AI assistants working on this codebase. The product, the
constraints, the conventions, and the test infrastructure — in one place.

## 1. What this project is

**Twilight Zone** is a web tool that migrates a Cloudflare zone from one
Cloudflare account to another. It exports DNS records, zone settings,
rulesets, workers, load balancers, access policies, and 30+ other resource
types from a source zone and recreates them on a destination account.

The wizard is a Setup landing (**step 0**) plus **four numbered steps (1–4)**,
mirroring the engine's two migration phases (`migrateAccountResources` pre-zone,
then `migrateZone`). One numbering is used everywhere — the wizard strip, App's
`step` state, the component file names, and this doc all agree:

- **Step 0 — Setup** (`Step0Credentials.tsx`) — pick source/dest accounts + zone,
  choose auth mode (API token or API key + email). This is the landing screen, so
  it carries no numbered circle in the wizard strip.
- **Step 1 — Account** (`Step1Account.tsx` → renders the shared `ScopeReview`
  with `phase="account"`) — auditable review of ONLY account-scoped resources
  (Workers, KV/R2/D1, Queues, Hyperdrive, Secrets Store, LB pools/monitors,
  Access apps + IdPs, Turnstile, Pages, AI Gateway, Origin CA) plus the
  account-scoped secret inputs. Account-scoped groups default OFF because they
  affect billing; surface entitlement gaps / plan limits / missing emails and
  require acknowledgment. **The migration no longer runs here** — this step is
  select-only review; its primary button is **"Continue to Zone →"** (plain
  navigation, no write). The account-scoped secret/cert fix-it inputs and their
  acknowledgement gates still live here (they're consumed at migrate time), so
  they must be resolved before continuing.
- **Step 2 — Zone** (`Step2Zone.tsx` → `ScopeReview` with `phase="zone"`) —
  auditable review of ONLY zone-scoped resources
  (DNS, settings, rulesets, page rules, firewall, rate limits, worker routes,
  custom hostnames, email routing, etc.) plus zone-scoped secret inputs (custom
  SSL cert+key, AOP mTLS). **Also select-only navigation** — its primary button
  is **"Continue to Apply →"** (no write). Secondary action: **Download script**
  (Part D — the planned WRITE calls from
  `/api/validate`, emitted as a TS/curl/Python/Go/Terraform scaffold that reads
  `CF_API_TOKEN` from env, never embedding creds — `DownloadScriptButton.tsx`).
  It lives here, not at the Account step, because the script captures the FULL
  planned write set and is only meaningful once every setting is finalized.
  Also hosts the
  optional pre-cutover uptime monitor (`UptimeMonitorCard.tsx`, api mode only) —
  its state lives in the App-level `useUptimeMonitor` hook so the once-per-second
  ping loop survives the move to Apply and Results, driving the header heartbeat
  (`MonitorHeartbeat.tsx`) the whole way through.
- **Step 3 — Apply** (`Step3Apply.tsx`) — the single "do it" step, with three
  parts: (1) a **collapsed, read-only "Review Plan"** recap (`PlanSummary.tsx`)
  of everything selected on the Account/Zone steps — the selections were already
  made and audited there, so it's a re-check affordance, not the primary
  content; (2) **run the migration** — confirm the destination
  (`DestinationConfirm.tsx`) then **"Run migration →"** (`handleRunMigration` in
  App), which streams `POST /api/migrate/account-resources` then
  `POST /api/migrate/stream` (`skipAccountResources: true`) back-to-back and
  merges the two phase reports; (3) once the run completes (`report` is set), the
  interactive **post-migration checklist** (registrar nameserver change, DNSSEC
  DS, email-routing verification, Turnstile sitekey updates, KV/R2/D1 data copies
  via wrangler/rclone, worker-secret / cert reminders), each with a per-item
  "done" affordance. While the run streams, App shows the live log in place of
  the component. The label is **"Apply"** in every mode. ("Apply" is the wizard
  strip label in `MIGRATION_STEPS` and `PRESET_STEPS`; the component
  (`Step3Apply`), its heading, and this doc all use it consistently.)
- **Step 4 — Results** (`Step4Results.tsx`) — strictly read-only verification of
  the MERGED account ⊕ zone report:
  ✅ Verified, 🟡 Acknowledged, 🟠 Mismatched, 🔴 Missing, ❌ Failed. Offer
  download of `migration_report.md`.

> **One numbering, everywhere.** `0 = Setup · 1 = Account · 2 = Zone · 3 = Apply
> · 4 = Results`. The wizard strip (`MIGRATION_STEPS`) shows the four numbered
> steps (1–4); Setup is the unnumbered landing (step 0). App's `step` state uses
> the SAME values, so `StepIndicator` needs no offset (`currentStep={step}`). The
> component files match too — `Step3Apply` = step 3, `Step4Results` = step 4 —
> with one structural note: **Account (1) and Zone (2) are two steps that share a
> single rendering component, `ScopeReview`**, parameterised by `phase`.
> `Step1Account.tsx` / `Step2Zone.tsx` are the thin step entry points that bind
> the phase. The Apply step renders its own components — `Step3Apply` (normal
> migration) or `PresetApplyStep` (presets) — each showing a collapsed read-only
> `PlanSummary` recap rather than re-rendering the selectable `ScopeReview`.

**Source modes:** `api` (live export → migrate) and `json`/`terraform` import
run the full two-phase flow. `preset` (MaxConfig/MinConfig) is NOT a migration —
it applies a canned config to a single target zone (either an existing zone or a
brand-new one provisioned via the Step 0 "New" zone toggle, which POSTs
`/api/zones/create` before the preview/apply flow). Presets still walk the
Account and Zone review steps (they are navigable, not greyed —
`PRESET_DISABLED_STEPS` is empty) so the user can audit account- and zone-scoped
changes, then land on the Apply step (`PresetApplyStep`): **Setup → Account (1)
→ Zone (2) → Apply (3) → Results (4)**.

**Deployed at:** https://your-twilight-zone.example.com

**Audience:** Cloudflare Customer Success Engineers (CSEs) and customers
running account-to-account migrations (mergers, reorgs, billing changes,
moving from a partner-managed account to a customer-owned account).

## 2. Stack & deploy

- **Runtime**: Cloudflare Workers (workerd) for backend
- **Frontend**: React 19 SPA, Tailwind CSS v4, Vite 7
- **Backend**: `src/worker/index.ts` — ~35 API route handlers (dispatch
  table) plus `/api/version`, `/api/stats`, `/api/webhook-sink` and the
  `/api/v1` mirror, mix of synchronous JSON (`/api/*`) and SSE streaming
  (`/api/*/stream`)
- **Build**: `@cloudflare/vite-plugin` bundles SPA + worker together
- **Config**: `wrangler.toml` (read by both the Vite plugin and the
  wrangler CLI directly)
- **Language**: TypeScript strict mode required for all new code

### Build & deploy

- `npm run dev` — local dev server (Vite + Worker)
- `npm run build` — production build (frontend into `dist/`)
- `npm run deploy` — `vite build && wrangler deploy`
- `npm test` — vitest run (unit tests)
- `npm run typecheck` — `tsc --noEmit`
- Pushing to `main` triggers a Cloudflare Workers build that runs
  `npx wrangler deploy` directly

### Deploy gotcha

The Cloudflare build runs `npx wrangler deploy` directly (not
`npm run deploy`), so `vite build` does NOT run in CI. This means:

1. `wrangler.toml` must be independently valid — wrangler parses it
   without Vite's plugin preprocessing.
2. The `assets.directory` field is **required** by wrangler 4.x. Without
   it, deploy fails: `✘ [ERROR] The 'assets' property in your
   configuration is missing the required 'directory' property.`
3. If the deploy command ever changes to `npm run deploy`, Vite will build
   the frontend into `dist/` first, but currently assets must exist at
   deploy time.

## 3. Project structure

```
app/                                # React SPA (client-side, Vite)
  main.tsx                          # React entry point
  App.tsx                           # Root component with wizard state
  index.css                         # Tailwind directives + custom styles
  components/
    Layout.tsx                      # Header, footer, theme toggle
    StepIndicator.tsx               # Wizard progress bar
    LogPanel.tsx                    # Streaming log viewer
    Toast.tsx                       # Error/success notifications
    EmailAddressVerificationCard.tsx # Step 2 per-address Send/Check/Skip card
    CoverageModal.tsx               # API-coverage detail modal
    CoverageTiles.tsx               # Coverage summary tiles
    OutOfScopePanel.tsx             # Informational out-of-scope notice
    DashLink.tsx                    # Deep-link to a resource in the dashboard
    InfoModal.tsx, StatusIcon.tsx   # Shared UI primitives
    Step4IdPTestSection.tsx         # Step 4 Access IdP login test
    UptimeMonitorCard.tsx           # Zone-step pre-cutover uptime monitor (config UI)
    MonitorHeartbeat.tsx            # Header heartbeat — beats 1/sec while monitoring
    DownloadScriptButton.tsx        # "Download planned API calls as a script"
    PostMigrationWorkPanel.tsx      # Disclosure-only manual post-migration work
    AnalyticsArchiveSection.tsx     # "Archive source analytics" card (+ AnalyticsCharts.tsx)
    fixit/                          # Account/Zone inline "fix-it" secret/cert actions
    steps/
      Step0Credentials.tsx          # Step 0 — Setup / landing
      Step1Account.tsx              # Step 1 — Account (binds ScopeReview phase="account")
      Step2Zone.tsx                 # Step 2 — Zone (binds ScopeReview phase="zone")
      Step3Apply.tsx                # Step 3 — Apply (review plan → run → post-migration)
      PresetApplyStep.tsx           # Step 3 — Apply for presets (review plan + apply)
      PlanSummary.tsx               # Collapsed read-only "Review Plan" recap
      DestinationConfirm.tsx        # Apply-step destination confirmation checkboxes
      Step4Results.tsx              # Step 4 — Read-only Results
      ScopeReview.tsx               # Shared Account+Zone scope view (phase prop, select-only)
      step0/                        # Setup sub-components (token link, file drop, modes)
      scope/                        # Shared scope sub-components (groups, collapsible, …)
      step4/                        # Results sub-components (section cards)
    # (component list is representative; see app/components/ for the full set)
  hooks/                            # React hooks
    useAccounts.ts, useBlockerCheck.ts, useCredentials.ts,
    useStreamRequest.ts, useTheme.ts, useUptimeMonitor.ts, useScrollLock.ts
  lib/
    api.ts                          # Client wrappers for /api/*
    crypto.ts                       # Config encrypt/decrypt (AES-GCM)
    codegen.ts                      # Code generators (TS, curl, Python, Go, TF)
    validation.ts                   # Pre-migration warning generators
    constants.ts                    # Storage keys, phase names
    dashLinks.ts                    # Resource → dashboard URL builder
    outOfScope.ts                   # Out-of-scope resource derivation
    coverageDetail.ts, coverageSummary.ts # API-coverage views
    idpLoginUrl.ts, idpTestReport.ts # Access IdP login test helpers

src/
  worker/
    index.ts                        # Worker entry — ~27 API route handlers + SSE
    api-v1.ts                       # /api/v1/* — pure-JSON programmatic API
  migrate.ts                        # Thin orchestration entry (re-exports migrate/)
  migrate/                          # Export + migrate engine, split by concern:
                                    #   export-zone.ts, migrate-items.ts,
                                    #   singleton.ts, report-markdown.ts,
                                    #   run-log.ts (beta run logging + stats),
                                    #   errors-classification.ts, preflight.ts,
                                    #   workers.ts, storage.ts, rulesets.ts,
                                    #   certs.ts, lb-access.ts, + ~20 more
  api.ts                            # Cloudflare API client (40+ endpoints)
  types.ts                          # All TypeScript interfaces, incl.
                                    # IMPOSSIBLE_TO_MIGRATE catalog
  validator.ts                      # Dependency graph + ID remapping
  diff.ts                           # Source vs dest diff
  fuzz.ts                           # MaxConfig/MinConfig: maximum safe
                                    # request-affecting zone/account config
                                    # + ruleset definitions used by tests
  maxconfig-preview.ts              # MaxConfig preview generation
  terraform.ts                      # Terraform HCL generation + import
  do-migrate.ts                     # Durable Object data migration
  r2-migrate.ts                     # R2 object migration via S3 API
  openapi-export.ts                 # OpenAPI everything-export
  troubleshooting-export.ts         # Troubleshooting bundle
  openapi-manifest.generated.ts     # Generated from Cloudflare OpenAPI spec
  openapi-writes.generated.json     # Generated write-op manifest
  utils.ts                          # Auth parsing helpers

scripts/                            # Operational + test tooling
  run-playwright-migrations.mjs     # E2E test harness (Playwright + UI)
  capture-zone-state.mjs            # Snapshot source/dest state for assertions
  verify-checklist.mjs              # Per-resource verification report
  zone-apply.mjs                    # CLI: apply a config to a zone
  run-single-zone-migration.mjs     # CLI: drive one migration without UI
  generate-openapi-manifest.mjs     # Regenerate openapi-manifest.generated.ts
  rate-limiter.mjs                  # Shared CF API rate-limit helper
  api-test.mjs                      # API surface integration tests
  coverage-report.mjs               # Tool-coverage vs CF API surface

docs/                               # Reference documentation (see §9)
  ARCHITECTURE.md                   # System design, data flow, ID remapping
  SECURITY.md                       # FedRAMP/NIST gap analysis + token permissions
  MIGRATION_GUIDE.md                # Official process, blockers, edge cases
  WORKER_BINDINGS.md                # Every Workers binding type and handling
  MAXCONFIG.md                      # MaxConfig/MinConfig payload reference
  EXPORTS.md                        # Export formats (JSON, Terraform, OpenAPI)
  COVERAGE.md                       # Tool coverage vs CF API surface
  dash-deep-link-paths.md           # Verified dashboard deep-link slugs
  test_configs/                     # E2E test fixtures (e01–e15, see §6)

test/                               # Unit tests (vitest) — representative subset;
  api.test.ts                       #   see test/ for the full ~37-file set
  codegenClient.test.ts
  diff.test.ts
  fuzz.test.ts
  migrate.test.ts
  merge-reports.test.ts
  outOfScope.test.ts
  validator.test.ts
  monitor.test.ts                   # uptime-monitor SSRF/curl-parser guards
  itemDetail.test.ts                # Step 2 per-resource detail formatters
  identicalItems.test.ts            # "already identical on destination" graying
  e2e-migrations/                   # E2E run output (gitignored)
    saved-runs/                     # Preserved historical runs
```

## 4. Key files & types

- `wrangler.toml` — worker name, compatibility date, assets config,
  the `RUN_LOG` KV binding (beta run logging — see `src/migrate/run-log.ts`)
- `vite.config.ts` — `@cloudflare/vite-plugin` with
  `configPath: "./wrangler.toml"` and Tailwind plugin
- `src/worker/index.ts` — all API route handlers; SSE_HEADERS export +
  `text/event-stream` for streaming endpoints
- `src/types.ts` — single source of truth for cross-module shapes:
  - `MigrationConfig` — wire format for `/api/migrate`
  - `ZoneExport` — full export shape consumed by migrate
  - `MigrationReport` — output of migrate, drives Step 4 + the .md file
  - `AccountCapabilities` — capability probe results, see §5
  - `ImpossibleResource` + `IMPOSSIBLE_TO_MIGRATE` — see §5
- `src/migrate.ts` — `exportZone()`, `migrateZone()`,
  `migrateAccountResources()`, `migrateSingleton()` helper,
  `migrateItems()` helper, error classifiers
- `src/api.ts` — `cfFetch<T>()` central client with rate-limit retry,
  `checkAccountCapabilities()`, every resource's typed list/get/create/update

## 5. Product principles (the things that matter)

### Principle 1: No Surprise Failures

The Results page (Step 4) must never show unexpected failures. When a user
sees the results, every item should be one of:

1. **Verified** — confirmed on destination via GET
2. **Acknowledged** — user was warned before migration and chose to proceed
   anyway (or knew it couldn't migrate)
3. **Mismatched** — migrated but value differs (e.g. read-only setting)
4. **Missing** — expected on the destination but not found on the
   post-migration GET-back (verification ran, the resource wasn't there).
   Distinct from Failed: no migrate-time error was raised, yet the resource
   is absent. Goal: zero of these.
5. **Failed** — genuine unexpected error raised during migration (goal: zero
   of these)

If a migration shows 50 "missing" resources, it looks like a catastrophe —
even when the migration actually succeeded and the missing items were always
going to be unverifiable. That destroys user trust.

**Results page categories:**

| Status | Meaning | Visual |
|--------|---------|--------|
| Verified | Confirmed on destination via GET | Green check |
| Acknowledged | User knew this wouldn't migrate | Gray/muted, not alarming |
| Mismatched | Migrated but value differs | Yellow warning |
| Missing | Expected on destination, absent on GET-back (no migrate-time error) | Red error |
| Failed | Unexpected failure raised during migration | Red error |

**Summary numbers must reflect reality:**
- Total = items actually attempted
- Verified = confirmed via GET
- Acknowledged = items user accepted won't migrate (shown separately, NOT
  counted as failures)
- Missing = expected on destination but not found on GET-back (should be 0;
  distinct from Failed — no migrate-time error was raised)
- Failed = genuine unexpected errors (should be 0 in a healthy migration)

### Principle 2: Entitlement Gaps → Acknowledgment, Not Failure

When a destination account is missing an entitlement (Load Balancing, R2,
D1, Queues, Workers, Spectrum, Vectorize, Zero Trust, Rate Limiting, Email
Routing, etc.), the affected resources must surface as **acknowledged** in
Step 2 before migration begins. The user has two paths:

1. **Accept** — "I understand this feature isn't moving over." Migration
   skips those resources cleanly; they appear as acknowledged in the
   report.
2. **Fix and recheck** — "I'll talk to my account team on this call and
   have them add the entitlement, then re-probe capabilities." Step 2
   provides a recheck control so the user can re-run the capability probe
   without restarting the wizard.

This is implemented via:

- `checkAccountCapabilities()` in `src/api.ts` probes each feature with a
  minimal API call; an error like "not enabled" / "not entitled" /
  "subscription required" marks the capability as `available: false` with
  a human-readable `reason` and `action` (e.g. "Dashboard → R2 → Get
  Started").
- `CAPABILITY_GROUP_MAP` in `scope/groups.ts` (consumed by `ScopeReview.tsx`)
  maps capability keys to resource group keys. Disabled groups display a red banner with the
  reason and a checkbox to acknowledge.
- `capabilityResourceMap` in `src/migrate/zone-prelude.ts` zeros out the corresponding
  `exportData[field]` arrays at migrate time and emits acknowledged
  sections in the report.

### Principle 3: Pre-Migration Acknowledgment Flow

Before migration executes, the tool must:

1. **Detect** what will fail or be unverifiable (plan mismatches, missing
   entitlements, read-only settings, domain-specific rules, unverified
   email destinations, missing worker secret values).
2. **Surface** these issues clearly with fix-it actions where possible
   (e.g. "Enable Load Balancing on dest account → $5/mo").
3. **Require acknowledgment** — the user must explicitly accept that these
   items won't migrate. No silent failures.
4. **Track** which items were acknowledged. `MigrationConfig.acknowledgments`
   and `MigrationConfig.skippedEmailAddresses` carry the choices into the
   migrate step.

What should trigger an acknowledgment prompt:

- Source zone plan > dest zone plan (Enterprise → Free: many settings don't
  apply)
- Missing account-level entitlements (rate limits, load balancing, R2,
  D1, etc.)
- Page rules with domain-specific patterns that can't be rewritten
- Features that require manual setup (Workers secrets, custom certificates)
- Email Routing forward rules where the destination address isn't verified
  on the dest account
- Resources that can only be exported, not imported (KV data, R2 objects,
  D1 data) — these surface as manual-action items in Step 3

### Principle 4: Never Ask the User to Acknowledge Things They Cannot Change

Acknowledgment is a tool for transferring *responsibility*, not for
reporting *facts*. If a user cannot affect, prevent, fix, or work
around an item, do not put a checkbox next to it and do not block
"Continue" on it. Forcing a click on something the user has zero
agency over is busywork — it teaches the user that acknowledgments
are a meaningless ritual, which corrodes the value of the
acknowledgments that DO matter (worker secrets, registrar changes,
manual data copies).

**Categories that require acknowledgment (user has agency):**

- `cryptographic` — user must re-supply secrets / re-upload private keys.
- `account_tied` — user must contact account team / re-provision on dest.
- `data_offline` — user must run wrangler / rclone / S3 commands.
- `manual_external` — user must update registrar / verify email / etc.

**Categories that are informational only (user has NO agency):**

- `auto_managed` — Cloudflare auto-provisions Universal SSL, managed
  rulesets, DDoS managed rules. Nothing for the user to do, ever.
- `read_only` — Settings like `cname_flattening`, `plan_level`,
  `orange_to_orange`, `advanced_ddos` are server-side immutable; the
  dest zone gets whatever value its plan dictates. The user cannot
  change source-side or dest-side behaviour by acknowledging this.
- `data_ephemeral` — Cache, analytics history, audit logs, in-flight
  queue messages, KV absolute-expiry timestamps. These are volatile
  by design; no user action can preserve them across an account
  boundary.

Informational items should still be **disclosed** (users genuinely
want to know "my cache will be cold" and "Cloudflare will provision
SSL automatically"). Render them as a compact, read-only notice — no
checkboxes, no required interaction, not counted toward the
"Continue" gate. The `actionable: boolean` field on
`ApplicableImpossibleResource` (derived from category in
`app/lib/outOfScope.ts`) is the single switch that decides which side
of this principle a resource falls on; new categories must declare
their actionability there, not invent a new code path.

**Framing for actionable items: lead with the consequence, not the
politeness.** "Will Not Migrate — You Must Act" is honest;
"acknowledge you understand the manual steps required" buries the
real message. The acknowledgment block should make clear that the
destination zone will be **broken in a specific way** (auth will
fail, data will be missing, DNS will not resolve, mail will be
dropped) until the user performs the action listed. The acknowledgment
is not a polite "I read it" checkbox — it is the user assuming
responsibility for a known-broken outcome.

**Placement in Step 2: acknowledgment block at the bottom, above the
Continue button.** Surface immediate-value content (export summary,
warnings, resource list) at the top so the user gets oriented
quickly. The acknowledgment block sits just above the Continue
button so it is the last thing the user sees before proceeding —
adjacent to the gate it controls. Pushing it to the top of the page
front-loads friction and hides the resource preview that users
actually came to see.

This principle is consistent with Principle 1 (No Surprise Failures):
informational items are *expected* outcomes, not failures and not
user-acknowledged risks — they are properties of the migration that
the user is being kept informed about.

### Principle 5: Verification Must Match Migration

The verification step (GET-back from destination) must use the same
identifiers as the migration step. When adding new resource types to
migration, always verify that the `getName` label used in `migrateItems()`
can be matched against the verification GET response. Test this by running
a migration and checking that verified count > 0.

Known matching rules:
- Zone Settings: migration stores names as `"setting_id: value"` —
  verification extracts the bare `setting_id` for API matching.
- Rulesets: migration stores `"Name (phase)"` — verification fuzzy-matches
  against dest `name` or `phase`.
- Email Routing: catch-all rules have no `name` field — verification
  reconstructs the display name from matchers/actions.

### Principle 6: IMPOSSIBLE_TO_MIGRATE is the single source of truth

`src/types.ts` defines `IMPOSSIBLE_TO_MIGRATE: readonly ImpossibleResource[]`
— a typed catalog of resources that **cannot** be migrated automatically
between Cloudflare accounts, organised by category:

- `cryptographic` — worker secrets, Access service token client secrets,
  Turnstile secret keys, custom certificate private keys, Origin CA /
  Keyless SSL private keys.
- `account_tied` — Cloudflare Registrar, BYOIP prefixes, Aegis IPs, Magic
  Transit/WAN/Firewall, China Network, FedRAMP environment, Network
  Interconnect.
- `auto_managed` — Universal SSL pack, Cloudflare/OWASP Managed Rulesets,
  DDoS L3/L4/L7 managed rules, Smart Tiered Caching, SSL Recommender,
  WAF Attack Score, Backup Certificates.
- `read_only` — `cname_flattening`, `plan_level`, `orange_to_orange`,
  `advanced_ddos` zone settings.
- `data_ephemeral` — cache content, web/security analytics history, audit
  logs, queue messages in flight, KV expiration TTLs.
- `data_offline` — D1 schema/data (wrangler CLI), R2 bulk object data
  (rclone), Logpush buffered batches, Durable Object stored state (created
  empty by default; copied only when DO migration is configured).
- `manual_external` — DNSSEC DS record at registrar, email routing
  destination address verification, nameserver change at registrar,
  custom hostname SSL validation, SSL-for-SaaS verification.

Every entry has `key`, `name`, `category`, `reason`, optional
`manualAction`, optional `docsUrl`. The pre-migration acknowledgment flow
consumes this catalog so users see one consistent list — and so new
contributors only need to add resources in one place.

### Principle 7: The "Would I Lose Functionality?" Test

Single test for deciding whether an endpoint or sub-feature is
in-scope: **"After migrating, would the user notice this feature
missing on the destination?"**

- **Yes** → in-scope. Either implement it in `src/migrate.ts` or, if
  the data can't be transferred via API (private keys, ephemeral
  state, registrar action), add an `IMPOSSIBLE_TO_MIGRATE` entry.
- **No** → out-of-scope. Add a `coverage-overrides.json` entry with
  the right reason code (`admin_only`, `data_plane`,
  `dual_scope_covered`, `redundant_with_*`, etc.).

**Account-level ≠ out-of-scope.** Many features have account-scoped
APIs but are zone-experience features (Workers observability,
Workers for Platforms dispatch, Access controls, Pipelines, etc.).
If the user touches them from the zone they're migrating, the
feature is in-scope even though its CRUD lives at
`/accounts/{id}/...`.

**Anti-pattern: stashing unimplemented features in
`IMPOSSIBLE_TO_MIGRATE`.** That conflates "we haven't built it" with
"it physically cannot move" and degrades the catalog. Unimplemented
in-scope features belong in `coverage-overrides.json` with `reason:
null` (a tracked gap), not in the impossible list.

### Principle 8: Scope Must Be Auditable — Show the Data, Not a Summary

Step 2 (Scope) exists so a human can **verify, before anything is
written, exactly what will and won't be migrated.** Its job is
verification, not just collecting toggles.

**The bar:** an IT admin who is familiar with the zone should be able
to scan the Scope view and notice if something is **missing, wrong, or
unexpected** — using only what's on screen, without opening browser
dev tools or a raw-JSON blob. If a savvy admin couldn't catch an
omission by reading the page, the page isn't doing its job.

**What that requires:** show the real, identifying detail of each
resource — not just its name, but the values that define it:
- DNS: type · name · content/target · TTL · proxied flag
- Zone setting: `id = value`
- Ruleset rule: expression + action (+ phase)
- Load Balancer pool: origins + monitor reference
- …and the equivalent identifying fields for every other type.

**Anti-patterns (do NOT do these in the Scope view):**
- Truncation / ellipses that hide identifying text (`maxconfig-lb.entt…`).
- Opaque, unclickable counts ("87 resources") with no way to see the
  underlying list.
- Name-only rows that omit the values an admin would actually check.
- Burying the real data behind a raw-JSON toggle as the *only* way to
  see it.

**Corollaries:** prefer full-width, per-type tables/lists over cramped
truncated chips — use the horizontal space. Collapsibles are fine, but
expanding must reveal **complete** detail, not a second layer of
summary.

This is the Step-2 sibling of Principle 1 (No Surprise Failures):
Principle 1 says Step 4 must not surprise the user with *failures*;
Principle 8 says Step 2 must not surprise the user with *omissions*.
Trust is built by showing the data up front.

### Principle 9: Surface Issues As Early As Possible (Fail Loud, Fail Fast)

The moment the tool knows something will or did go wrong, tell the
user — do not batch problems to the end of a phase or the end of the
run. Latency between "the tool knows" and "the user sees it" should be
as close to zero as possible.

- **Pre-flight:** surface blockers, entitlement gaps, and plan
  mismatches in Step 1/2, *before* any write (this is the timing half
  of Principle 3).
- **During migration:** the SSE streaming architecture exists
  precisely so each resource's outcome (✓ / ✗ / already-present)
  appears **live, as it happens**, with the specific error inline —
  never a silent spinner that resolves into a wall of failures only
  at the end.
- **Be specific at the point of failure:** include the resource
  identifier and the actual API error message in the stream, at the
  moment the operation fails — not a generic "some items failed"
  rollup after the fact.
- **Never trade visibility for a tidy run.** Do not suppress, defer,
  or aggregate-away an error to make the migration "look smooth."
  Immediate, honest visibility beats a clean-looking summary (ties to
  the Debugging-integrity rule in §7 and to Principle 1).

This is the temporal complement to Principle 1: Principle 1 governs
how the final results are *categorized*; Principle 9 governs how
*quickly* — and how close to the triggering operation — those problems
reach the user.

## 6. API surface

The worker exposes two API surfaces:

### Streaming (SSE) — used by the UI

`text/event-stream` responses carrying typed events
(`{ type: 'log' | 'progress' | 'prompt' | 'complete' | 'error', ... }`)
used by the React app's `useStreamRequest` hook:

- `POST /api/export/stream` — streamed zone export
- `POST /api/migrate/stream` — streamed full migration
- `POST /api/migrate/account-resources` — streamed account-resource
  pre-deployment (workers, storage, LB monitors/pools, Access, Turnstile)
- `POST /api/migrate/respond` — answer a `prompt` event from a streaming
  migration (e.g. provide a worker secret value mid-flight)
- `POST /api/export/troubleshooting/stream` — streamed support-bundle
  export
- `POST /api/export/openapi/stream` — streamed "everything via OpenAPI"
  export
- `POST /api/terraform/export/stream` — streamed Terraform HCL generation
- `POST /api/terraform/import/stream` — streamed Terraform `import` script
  generation
- `POST /api/maxconfig/stream` — streamed "All Features On" preset apply
- `POST /api/minconfig/stream` — streamed "All Features Off" preset reset
- `POST /api/fuzz/stream` — streamed fuzz run over zone settings/rulesets
- `POST /api/analytics/export/stream` — streamed source-analytics archive
  export (the Step 3 "Archive source analytics" card)
- `POST /api/analytics/probe/stream` — per-dataset analytics access probe that
  drives the "Archive source analytics" section's availability check
- `POST /api/diff/stream` — streamed source↔destination diff (feeds the Scope
  "already identical on destination" graying)

### Synchronous JSON — utilities + programmatic access

- `POST /api/export` — non-streaming export
- `POST /api/migrate` — non-streaming migrate
- `POST /api/export/troubleshooting` — bundle
- `POST /api/export/openapi` — everything dump
- `POST /api/terraform/export` — HCL output
- `POST /api/validate-token` — token shape + permissions
- `POST /api/check-blockers` — pre-migration blocker list
- `POST /api/check-capabilities` — capability probe (drives Step 2 UI)
- `POST /api/validate` — dry-run validation (export source + validate
  against dest without writing); returns result, phases, export summary
- `POST /api/rollback` — delete resources created on the destination
  (zone, workers, KV, R2, D1, queues) from a created-resources manifest
- `POST /api/email-routing/send-verification` — kick off email
  verification on dest
- `POST /api/email-routing/check-verification` — poll verification status
- `POST /api/zones` — list zones for an account
- `POST /api/accounts` — list accounts
- `POST /api/rdap` — registrar/nameserver lookup
- `POST /api/available-plans` — plans available to assign to a zone
- `POST /api/analytics/export` — non-streaming source-analytics archive export
- `POST /api/monitor/ping` — pre-cutover uptime monitor: a single, host-locked,
  SSRF-guarded ping (see `src/monitor.ts`); the browser drives the 1/sec cadence
- `GET  /api/version` — build/version info
- `GET  /api/stats` — aggregate run-log stats (drives the landing-page
  "N zones migrated" counter; see `src/migrate/run-log.ts`)
- `ALL  /api/webhook-sink` — no-op `{ ok: true }` sink used as a test/diagnostic
  target for notification-webhook + monitor checks
- `GET  /api/v1`, `GET /api/v1/docs`, plus `/api/v1/*` POSTs — pure-JSON
  programmatic API mirror (no streaming). Useful for scripting migrations
  without driving the UI. See `src/worker/api-v1.ts`.

## 7. Conventions

### TypeScript

- Strict mode enabled. No plain `.js` files.
- Prefer `type` over `interface`. Prefer `MyType[]` over `Array<MyType>`.
- Never use `Function` as a type — define explicit signatures.
- Run `wrangler types` after changing bindings to regenerate the `Env` type.
- Import order: third-party → `cloudflare:*` / `@cloudflare/*` → `@/`
  absolute → `./` relative.

### React

- Functional components only. No class components.
- Explicit boolean props: `booleanProp={true}` not just `booleanProp`.
- Implicit returns where possible: `() => (<div />)`.
- Keep components under ~150 lines. Extract sub-components when trees get
  deep. (`ScopeReview.tsx` is the historical exception; it should be
  carved up further over time.)
- Prefix hooks with `use`. Do not use `use` for non-hook functions.
- Use `cn()` (clsx + tailwind-merge) for conditional classes. Avoid inline
  styles.

### Tailwind CSS

- Use Tailwind v4 with `@tailwindcss/vite`. No PostCSS config needed.
- Prefer utility classes in JSX. Use `@apply` sparingly.

### Worker backend

- Streaming routes write SSE events to a `TransformStream.writable` and
  return `new Response(sse.readable, { headers: SSE_HEADERS })`. The
  same flow drives both UI streaming and programmatic clients that can
  read SSE.
- Use prepared statements for any future D1 queries. Never concatenate
  SQL strings.
- Never hardcode secrets. Use `wrangler secret put` or env vars.
- The worker is **stateless** between requests except for an in-memory
  prompt-resolution map (see `handleMigrateRespond`) and a short-lived
  per-isolate stats cache (`getStatsCached` in `src/migrate/run-log.ts`).
  Don't rely on worker-local state for anything else. The only durable
  server-side data is the PII-stripped, credential-free run log in the
  `RUN_LOG` KV namespace (90-day TTL) — credentials are never logged.

### Configuration

- Keep `compatibility_date` current.
- Use `not_found_handling: "single-page-application"` for the React SPA.

### MaxConfig safety model

- MaxConfig's goal is the maximum possible configuration that can affect
  requests to the selected zone, covering both zone settings and account-level
  resources when they are attached to that zone's traffic path.
- Default MaxConfig must protect other zones in the same account. Do not add
  default writes that can change traffic behavior for unrelated zones or mutate
  shared account-wide behavior.
- Account-wide, billing-changing, registrar/external-DNS, or private-key-
  dependent MaxConfig writes must be behind an explicit opt-in option that is
  default off. The current opt-in is
  `includeUnsafeAccountWideTrafficSettings` on `/api/maxconfig/stream`.
- Prefer narrow host/path expressions such as `maxconfig-*.<zone>` and
  `/maxconfig-*` so test traffic is isolated from normal customer traffic.

### Debugging integrity

- **Never mask or downgrade a status/error to work around a suspected
  upstream bug.** If an API returns a status that contradicts observed
  behavior, investigate the root cause — read the source, add logging,
  reproduce the discrepancy. Do not "treat X as Y" to make the UI look
  right. False negatives are preferable to silent lies.

### Security

- **Never downgrade security to fix a bug.** If an authenticated endpoint
  isn't reachable, fix the auth — don't make the endpoint unauthenticated.
  If a feature requires WARP/VPN and the user doesn't have it, fail
  clearly — don't bypass the security requirement. Always strongly
  recommend against any solution that weakens authentication, authorization,
  or access controls, even when it would be easier. **"Last resort" is
  not an exception** — if every other approach has failed and the only
  remaining option is a security downgrade, the correct answer is to fail
  clearly and tell the user what to do, not to lower the security bar.
  Before proposing any fallback or workaround, verify it does not weaken
  security. If it does, don't propose it.

### Test integrity

- **Never relax a test assertion to make a red test green when the
  failure is real.** If an assertion fails because the system under test
  isn't doing what the assertion expects, the answer is to fix the
  system, fix the upstream test setup, or — if the test is genuinely
  wrong — *rename the assertion to honestly reflect what it now
  verifies*. Silently lowering the bar under the original name is a
  lie: the test's name promises one invariant, the code verifies
  another, and a future regression in the original invariant will go
  uncaught. If you find yourself writing comments like "skip this check
  when X fails" or "vacuously pass when there's nothing to check," stop
  and audit what you're really doing.
- **Anti-pattern: "evidence-missing → pass anyway."** An assertion that
  reads evidence (capture-zone-state JSON, migration report sections,
  DOM state) and returns `passed: true` when the evidence is empty is
  almost always wrong. Examples:
    - `if (!srcLBs.length) return { passed: true, reason: 'vacuously satisfied' }`
      → masks source-side seeding failures.
    - `if (dstApps.length === 0) return { passed: true, reason: 'no apps to check' }`
      → masks destination-side migration failures or empty captures.
    - `if (!migratedTitles.has(title)) skip; return passed: true` when no
      titles were checked → masks harness Step 2 selection bugs.
  Empty evidence means the assertion cannot prove what it claims; the
  correct response is `passed: false` with a reason that surfaces the
  gap (e.g. "no dest apps captured — IdP remap cannot be verified").
- **Legitimate vacuous pass: explicit positive evidence from the
  migration report.** When the migration tool emits an explicit
  acknowledgement section (e.g. `R2 (r2Buckets) 🟡 acknowledged`,
  `Load Balancing.*not enabled on destination`), that's a positive
  signal that the tool made a deliberate, user-acknowledged decision
  not to migrate something — and post-run assertions that verify
  those resources should short-circuit to pass. This is governed by
  the No Surprise Failures principle (Principle 1 in §5). The
  `isCapabilityAcknowledged(testDir, label)` helper in
  `scripts/run-playwright-migrations.mjs` is the canonical check; do
  not invent ad-hoc vacuous-pass branches.
- **Test renaming over test relaxing.** If a test's scope is genuinely
  too ambitious (e.g. `assertDoStateMigrated` was written when DO
  state copy was expected to be automatic, but the tool's real scope
  is namespace creation), the right move is to rename and split:
  `assertDoNamespaceCreated` (what the tool does) + a separate, opt-in
  `assertDoStateMigrated` (gated on the harness configuring DO
  migration via Step 3). Renaming under the same name to test a
  weaker invariant is the antipattern.
- **Audit before relaxing.** Before changing any post-run assertion,
  search the harness for other instances of the same pattern (`grep
  -nE "passed: true.*(vacuous|skip|no .* to check|no .* found)"
  scripts/run-playwright-migrations.mjs`). The 2026-05-13 audit found
  four instances at once; relaxing them individually would have
  compounded the problem.

### Verification honesty — report coverage, not vibes

- **Lead with what you did NOT test, not what passed.** Any verification
  summary must open with the scenarios that were NOT exercised and the
  resulting blind spots. A green result is meaningless until the reader
  knows its scope. Caveats go at the TOP, adjacent to the verdict — never
  buried at the bottom.
- **Never say "nothing broken," "works," "passing," "all green," or "0
  failures" for a scenario you did not actually execute.** Those words are
  reserved for paths you ran end-to-end and observed. For everything else,
  say "not exercised" or "unverified." Distinguish explicitly between
  "verified by running X" and "assumed from unit tests / build / code
  reading."
- **Identify the POINT of the task and confirm the primary scenario was
  run.** For a test request, the single most important sentence is whether
  the scenario the user actually cares about was exercised. If the test
  exists to prove X (e.g. account-scoped resources migrate, billable
  resources are created, the destructive path completes), then not running
  X means the test did not run — regardless of how many adjacent checks
  passed.
- **Do not silently narrow scope to avoid cost, time, billing, or
  destructive operations.** Skipping the expensive/slow/billable/dangerous
  part is almost always skipping the point. If the canonical test is
  costly or destructive, either (a) run it, or (b) STOP and ask for
  explicit approval, naming the cost — never substitute a cheaper proxy
  and present it as the test. Flags like `skipAccountResources`,
  `--dry-run`, reduced row counts, mocked endpoints, or "I tested the
  engine via the API instead of the UI" are all scope reductions that must
  be surfaced as such, loudly, before any verdict.
- **The headline must match the weakest link.** If the core scenario was
  not run, the headline is "I did not run the core test," not "all checks
  passed." Strong adjacent results (typecheck, unit tests, build, UI
  render) never upgrade a missing core test to "passing."
- **Use a coverage table for any non-trivial test/QA report**, with one row
  per scenario the user cares about: `scenario | executed? (yes/no) |
  result | evidence`. "no" rows are findings, not footnotes.
- **When you catch yourself about to write a reassuring verdict, re-read
  the original request and ask: did I run the thing they asked for?** If
  the answer is "I ran something cheaper/safer/adjacent," rewrite the
  verdict to say that first.

### Git

- Feature branches off `main`. Conventional commits (`feat:`, `fix:`,
  `chore:`, `test:`, `docs:`).
- Atomic commits — one logical change each. Rebase, don't merge.
- Commit messages explain *why*, not just *what*.
- Never add AI-attribution metadata to commits. No `-m` flags or trailers
  like `Co-authored-by:` for AI tools, and no `Ultraworked with [Sisyphus]`
  signatures.

### Adding endpoints — what "add these endpoints" means

When the user asks to **"add"** one or more Cloudflare API endpoints (e.g.
from the spec-drift monitor / coverage-triage prompt), the default
expectation is **full migration functionality**, not just coverage
bookkeeping. The zero-input loop is scripted — `npm run triage:endpoints`
(refresh + compare spec↔code + classify gaps + emit scaffolds) then
`npm run verify:gates` (the 5 gates below); see the `migrate-new-endpoints`
skill. The steps each script automates are:

1. **Regenerate the manifest** (`npm run generate:openapi-manifest`) so the
   endpoint enters the baseline + writes manifest.
2. **Implement the migration end-to-end** when at all possible — the same
   layers every other resource touches:
   - `src/api.ts`: typed `get*` / `update*` (or `create*`) wrappers, with a
     write-body normalizer if the GET result carries read-only/envelope
     fields (Principle 1 — no surprise failed rows).
   - `src/types.ts`: the field on `ZoneExport` (and `IMPOSSIBLE_TO_MIGRATE`
     only if it genuinely cannot move — never as a parking spot for
     unimplemented work, per Principle 7).
   - `src/migrate/export-zone.ts`: export it (destructure + `fetchAndLog` +
     return object).
   - `src/migrate/zone-extras.ts` (or the right phase module): migrate it,
     usually via `migrateSingleton` / `migrateItems`.
   - A unit test (e.g. for the normalizer) and, where it fits the suite, an
     E2E assertion.
   Verify with `npm run typecheck`, `npm test`, and `npm run coverage:check`
   (the in-scope-gap ratchet must stay green because the endpoint is now
   implemented, not because of an override).
3. **If migration is NOT possible or NOT appropriate, log it — don't
   silently drop it.** "Log it" means record the decision in the right
   place with an honest reason:
   - genuinely un-migratable (cryptographic, account-tied, etc.) →
     `IMPOSSIBLE_TO_MIGRATE` in `src/types.ts`;
   - out of zone-migration scope (account-admin, Zero Trust org infra,
     data-plane, imperative action, redundant variant, etc.) → an entry in
     `scripts/coverage-overrides.json` with the correct reason code, or the
     owning feature's `in_scope:false` flag in
     `scripts/feature-taxonomy.json`.
   Either way, state the reason back to the user.
4. **If implementing the migration is difficult or ambiguous, STOP and ask
   first** — surface the specific blocker and the options, and give the user
   enough info to decide (e.g. "this needs a destination tunnel that doesn't
   exist yet — recreate it, acknowledge it, or skip?"). Don't guess at a
   half-implementation, and don't quietly downgrade it to an override to
   keep the ratchet green. Asking is correct over fast.

## 8. Test infrastructure

### Unit tests (vitest)

```bash
npm test                # one-shot
npm run test:watch      # watch mode
```

Files in `test/*.test.ts`. Coverage focuses on `migrate.ts` helpers
(error classifiers, dependency resolution, ID remapping),
`app/lib/codegen.ts` (output for every supported language, via
`codegenClient.test.ts`), `diff.ts`, and `validator.ts`.

> **Flaky parallel run?** Occasionally `npm test` reports `1 failed` with a
> *different* test each run (often the CPU-heavy `crypto.test.ts` large-payload
> case, sometimes a fast test starved past the 5s timeout). This is
> **load-induced parallel-worker flakiness, not a logic failure** — confirm with
> `npx vitest run --no-file-parallelism` (722/722 green single-threaded). Do not
> relax whichever assertion lost the scheduling race. See `docs/TESTING.md` for
> the full runbook and triage steps.

### E2E integration tests (Playwright)

`scripts/run-playwright-migrations.mjs` drives the full UI against real
Cloudflare accounts. It reads test configs from `docs/test_configs/`,
provisions source resources, runs the migration through the wizard, and
verifies the result.

**Required env:**
```
CF_API_KEY, CF_API_EMAIL, CF_ZONE_ID, CF_ACCOUNT_ID,
CF_TARGET_ACCOUNT_ID, SOURCE_DOMAIN, DEST_DOMAIN
DEV_SERVER_URL          (defaults to http://localhost:5173)
SLOW_MODE=1             (keep browser open 10 min on Results for inspection;
                         OFF by default — runs fast with a 5s pause)
VERBOSE=1               (extra logging)
```

**Run a single test:**
```bash
node scripts/run-playwright-migrations.mjs --only 105
```

**Run a range:**
```bash
node scripts/run-playwright-migrations.mjs --start 102 --end 105
```

**Source-zone model (per-run unique naming — the default).** The env
`SOURCE_DOMAIN`/`DEST_DOMAIN` (e.g. `twilight-maxconfig.user.com`) are NOT used
verbatim by default. At module load the harness derives the **parent** zone from
`SOURCE_DOMAIN` (drop the leading label → `user.com`) and rewrites *both* source
and dest to a per-run unique name `twilight-e2e-{runId}.user.com`. `CF_ZONE_ID` is
not authoritative — `main()` resolves the id from the (rewritten) `SOURCE_DOMAIN`
and reassigns it before any request.

Why: the old fixed-name reuse model kept tripping Cloudflare's ~3h **per-name**
zone-creation cooldown ("You attempted to add this domain too many times within
a short period") because teardown deleted the fixed zone and the next run
re-added the same name. A unique name per run is never re-added, so the cooldown
never fires.

- **Default (per-run unique):** source zone created fresh each run (subdomain +
  NS delegation in the parent + activation poll) and **deleted at teardown**
  (`sourceZoneTeardown`, runs on success *and* error via the top-level
  `.finally`). The dest zone (same unique name, created by the migration) is
  deleted at suite end. Both source and dest share the unique name, preserving
  the same-name production-fidelity flow and e03's "dest already exists"
  fallback.
- **Pin mode (`E2E_PIN_ZONE_NAME=1` or `--pin-zone-name`):** skip the rewrite
  and use the `SOURCE_DOMAIN`/`DEST_DOMAIN` env values verbatim, reusing a fixed
  zone across runs (the old Option A). Use it to target a specific existing
  zone — but back-to-back pinned runs that delete + re-add the same name can hit
  the 3h cooldown again. The parallel orchestrator
  (`scripts/run-e2e-parallel.mjs`) sets `E2E_PIN_ZONE_NAME=1` on its children so
  its deterministic per-slot zone names (`e2e-s{i}.<parent>`) are honored.

```bash
# Default: unique zone per run, no cooldown
node scripts/run-playwright-migrations.mjs --only 1
# Pin to the fixed env zone (reuse across runs)
node scripts/run-playwright-migrations.mjs --only 1 --pin-zone-name
```

`--fresh-source-zone` is now redundant (every default run is fresh) and kept
only as a harmless no-op alias.

A freshly POSTed subdomain zone is `pending` until the parent delegates NS to
it; the harness writes the NS records and polls for `active`. If it stays
pending it proceeds with a warning (SSL/custom-hostname features may not fully
apply on an inactive zone). The dest zone lives in a different Cloudflare account
that does not own the parent, so it cannot self-delegate NS and stays `pending`
regardless of name — unchanged by this model.

**Per-run unique names do NOT fix account-scoped leakage.** KV/R2/D1/Queues/
Workers/Access/Turnstile/custom-lists are account-scoped, not zone-scoped, so a
new zone name does nothing for them; the existing `cleanDestZone` account sweep
and per-run resource namespacing are still required (see the gotcha below).

### Test-infrastructure gotchas (read before running E2E)

These are real failure modes hit during recent test runs. Treat them as
known operational realities, not bugs to "fix" by retrying blindly.

- **Cloudflare zone-creation rate limit (~3h cooldown) — now avoided by
  default.** "You attempted to add this domain too many times within a
  short period. Wait at least 3 hours and try adding it again." This is a
  **per-name** cooldown. The default per-run unique naming
  (`twilight-e2e-{runId}.<parent>`) never re-adds a name, so it does not
  fire. It can still bite in **pin mode** (`--pin-zone-name` /
  `E2E_PIN_ZONE_NAME=1`) and in the parallel orchestrator's reused slot
  zones, because those delete + re-add fixed names across runs. In pin
  mode the harness silently falls back to the existing dest-account zone
  when creation is blocked — see
  `scripts/run-playwright-migrations.mjs:ensureDestZoneExists`. Test 103
  (e03) explicitly validates that fallback by pre-creating the run's zone
  name on the dest account first.

- **Account-scoped resource leakage between runs.** KV namespaces, R2
  buckets, D1 databases, Queues, Workers, Access apps, Turnstile widgets,
  and Custom Lists are **account-scoped**, not zone-scoped. They survive
  the dest-zone "clean" step and surface as "Already exists on
  destination — skipped to avoid duplicate" on subsequent runs. This
  undermines round-trip data tests (e.g. test 207 KV/R2 verification) if
  the prior namespace lingers with stale data. Mitigations:
    * Set `cleanDestAccountResources: true` in the config metadata to
      delete account-scoped resources before applying (slow, ~30s).
    * Namespace seed data per-run (e.g. `maxworker-kv-${runId}`) so each
      run gets a fresh resource.
    * Manually `npm run clean:dest` between runs (see `scripts/`).

- **Cloudflare API rate limit (1200 req / 5min per zone, 1200 / 5min per
  user).** The harness uses `scripts/rate-limiter.mjs` with a 1000 req /
  300s budget and a token-bucket capacity of 20. Symptoms when exceeded:
  HTTP 429, "Rate limited" in response body, intermittent capture-state
  failures. The rate-limiter retries with backoff up to 3 attempts but
  can't help if the source zone has 5000+ DNS records or the dest
  account is being hammered by another tester simultaneously. If you see
  429s outside the limiter's retry envelope, slow the run (`--start N
  --end N+2`) or check for concurrent test activity.

- **Cert backend transient failures vs duplicate cert packs.** Multiple
  POSTs of certificate_packs with the same `{hosts, type, CA}` return
  "Cloudflare's certificate service was temporarily unavailable" instead
  of a clean "duplicate" error. This is a Cloudflare-side quota guard,
  not a real outage. The migrate code dedupes by `{hosts, type, CA}`
  before POST (see `dedupeCertificatePacks` in `src/migrate/certs.ts`); if you
  see 10+ "transient" cert errors in a single run, check whether the
  source zone has multiple cert packs for the same hostname pair before
  filing a Cloudflare ticket.

- **Plan-subscription failures are silent.** If the dest account doesn't
  have the source zone's plan entitlement (e.g. source is Enterprise,
  dest is Free), the zone migration completes with a warning ("Cannot
  subscribe to X plan") but the resulting zone stays on whatever plan
  the dest account *can* assign. Plan-dependent features (Bot Management,
  Rate Limiting Advanced, Origin Rules host override, etc.) then fail to
  migrate and are acknowledged per Principle 2. The "unknown or
  deprecated rate plan" warning in older reports is misleading — it
  actually means "this plan ID is not subscribable on the dest account."

- **`selectAccountScoped: true` requires source seeding to have worked.**
  The harness logs `⚠ MISSING FROM UI` if a config seeded e.g.
  `kv_namespaces` but Step 2 doesn't show the KV group — most commonly
  caused by source seeding failing silently (worker upload failed, KV
  list call hit the wrong account, etc.). Always check the run log for
  this warning when a test reports zero items for its target resource.

- **Email Routing forward addresses survive across runs.** Verified
  destination addresses on the dest account stay verified between runs;
  unverified ones stay unverified. If a test expects "unverified → skip"
  behavior (test 104, 105) and someone verified the address manually,
  the test silently passes via "verified" rather than the intended
  "acknowledged" path. The harness can't detect this — check the
  dest-account email-routing settings if 104/105 behavior is surprising.

- **Headless mode is opt-in, not default.** `chromium.launch({headless:
  false})` is the harness default so a human can watch failures. Set
  `HEADLESS=1` (or run on a machine without a display) to force headless;
  most CI/automated runs should set this. The skill `playwright` and the
  `scripts/run-playwright-migrations.mjs` flag are the authoritative
  sources here.

### Test configs (`docs/test_configs/`)

Each config is a JSON file with a `metadata` block plus resource sections.
Key metadata fields:

- `rank` — sort order
- `domain` — display name (rewritten to `SOURCE_DOMAIN` at runtime)
- `preRun` — name of a hook in `run-playwright-migrations.mjs` to run
  before the UI migration (sets up dest state)
- `postRun` — name of a hook to run after migration completes (asserts
  test-specific invariants)
- `postRunAuthoritative` — when true, the post-run hook RESULT decides
  pass/fail (used when `mismatched ≥ 1` is the desired outcome, e.g. test
  104)
- `selectAccountScoped` — when true, the Playwright runner clicks all
  unchecked account-scope group checkboxes in Step 2 (LBs, KV, R2, D1,
  Workers, etc.). Required for tests that exercise account-scoped
  resources because those groups default to deselected in the UI.
- `emailAddressResolution` — `"skip-all"` makes the runner click Skip on
  every unverified email forwarding address surfaced in the Step 2
  verification card.

### Test suite (15 tests)

Each test targets a distinct edge case. All tests use
`postRunAuthoritative: true`. Run with
`node scripts/run-playwright-migrations.mjs --only <rank>` or
`--start N --end M` for a range.

| Rank | Config | Purpose | Asserts |
|------|--------|---------|---------|
| 1 | `e01-everything.json` | **Omnibus MaxConfig** — every migrate-able resource type. Stacks DNS proxied-flag + LB pool remap + ruleset overwrite checks on a single run, plus full independent zone-settings verification across all three CF API shapes (aggregate, dedicated object subsystems, dedicated scalar endpoints). If a new resource type is added to the engine, it MUST also be added here. | `assertProxiedFlagsMatch,assertLbPoolIdsRemapped,assertRulesetOverwrite,assertZoneSettingsMatch,assertDedicatedSettingsMatch,assertDedicatedScalarSettingsMatch` |
| 2 | `e02-maxworker-bindings.json` | **MaxWorker** — single worker with all 26 binding types (KV×2, R2, D1, Queue, DO, service×2, secret_text, AI, Analytics Engine, Browser, Vectorize, Send Email, Workflow, Dispatch Namespace, Pipelines, Version Metadata, Assets, Rate Limit, JSON, Plain Text, Hyperdrive, mTLS, Secrets Store, VPC Service). | `assertWorkerBindingsCompletelyMigrated,assertSecretsManualAction` |
| 3 | `e03-same-root-fallback.json` | Zone-creation fallback regression. `preRun: ensureDestZone` pre-creates dest zone in `CF_TARGET_ACCOUNT_ID` so migration hits "already exists" and must reuse the dest-account zone, not the source-account zone. | `assertDestZoneInTargetAccount` |
| 4 | `e04-email-routing.json` | Mixed email-routing actions — drop (no address needed) verifies, forward to unverified address is acknowledged. Validates per-action-type handling. | `assertEmailRoutingMixedOutcomes` |
| 5 | `e05-worker-service-binding-chain.json` | 3-worker service binding chain (A→B→C with RPC variant). Verifies upload order and per-binding name preservation across the chain. | `assertServiceBindingResolves` |
| 6 | `e06-do-state.json` | Durable Object namespace creation on the destination via the worker-deploy path (DO namespaces are freely selectable; state copy is opt-in via the DO config in the scope step). | `assertDoNamespaceCreated` |
| 7 | `e07-plan-downgrade.json` | Comprehensive Enterprise → Pro plan downgrade. Enterprise-only features (gRPC, ciphers, ddos_l7, bot_management.fight_mode, rate_limits with advanced expressions) should land as acknowledged, never failed. Directly validates "No Surprise Failures" (Principle 1). **Self-provisions an Enterprise source zone** via the idempotent `ensureSourceEnterprise` preRun (`POST /zones/{id}/subscription {"rate_plan":{"id":"enterprise"}}`) — without it the shared source may be Free and the downgrade can't be exercised. Also runs the full zone-settings assertion trio; plan-gated settings (e.g. `origin_h2_max_streams`) land as acknowledged and are allowed. | `assertEnterpriseFeaturesAcknowledged,assertZoneSettingsMatch,assertDedicatedSettingsMatch,assertDedicatedScalarSettingsMatch` (preRun: `ensureSourceEnterprise`) |
| 8 | `e08-access-idp-remapping.json` | Access apps with Identity Provider references — no source IdP IDs should leak into dest Access apps after remapping. | `assertAccessPolicyIdpRemapped` |
| 9 | `e09-storage-roundtrip.json` | KV bulk seed + R2 object copy + D1 schema + Queue + storage-binding worker. Verifies actual data round-trips across account boundaries (catches the class of bug where R2's on-demand object migration path hangs without surfacing an error). | `assertKvKeysCopied,assertR2ObjectsCopied` |
| 10 | `e10-account-ruleset-execute.json` | Account-level custom ruleset referenced by a zone ruleset via `execute` action. Verifies (1) account ruleset re-created on dest, (2) zone rule's execute target is rewritten to the NEW dest ID. | `assertAccountRulesetReferenceRemapped` |
| 11 | `e11-cert-pack-dedupe.json` | **Cert pack dedupe** — exercises `dedupeCertificatePacks` in `src/migrate/certs.ts`. Source zones routinely accumulate multiple cert packs for the same `{hosts, type, CA}` tuple; migrating duplicates verbatim hits a dest-side quota guard and surfaces as misleading "transient" errors. Asserts the Certificate Packs section has no transient-cert-error rows in volume (>=2 transient errors = regression). | `assertCertPackDedupe` |
| 12 | `e12-access-multidomain.json` | **Access multi-domain** — modern self-hosted Access app routing via `self_hosted_domains[]` + `destinations[]` rather than only the legacy single `domain`. Verifies both arrays survive migration AND every hostname/URI is source→dest zone-rewritten (`rewriteAccessAppDomains` in `src/migrate/transforms.ts`) so no source-zone hostname leaks onto the dest zone. Regression for the 2026-05-31 fix where Access app routing was sent un-rewritten. | `assertAccessMultiDomainMigrated` |
| 13 | `e13-analytics-archive.json` | **Analytics archive download** — the only test that KEEPS the Step 2 "Archive source analytics" add-on CHECKED (`metadata.keepAnalyticsArchive: true`; all others uncheck it). Exercises capture→Results→download end-to-end: the Account-phase capture must survive the Zone phase and surface on Results as a working "Download Source Analytics (.json)" button. The harness clicks it, saves the bundle, and asserts it's non-trivial with the expected `meta`+`graphql` shape and ≥1 dataset. Regression for the 2026-06-06 fix where `handleExecute` reset/aborted the Account-phase capture at the start of the Zone phase, so the download never appeared in the normal two-phase flow. | `assertAnalyticsArchiveDownloaded` |
| 14 | `e14-dns-breadth.json` | **DNS record-type + proxied-flag breadth** (L6). Widens DNS coverage beyond e01: 28 records spanning A/AAAA/CNAME (proxied + unproxied), MX priorities, TXT (SPF/DKIM/DMARC/verification), CAA, SRV, HTTPS. Reuses the validated `assertProxiedFlagsMatch` (no new hook). Catches record-type-specific migration regressions. ⚠️ Not yet run live. | `assertProxiedFlagsMatch` |
| 15 | `e15-settings-boundary.json` | **Zone settings at boundary/low values** (L6). Complements e01 (which drives every setting to MAX) by driving a representative set to LOW/opposite-of-default values (ssl=full, min_tls=1.0, security=essentially_off, brotli/0rtt/tls_1_3/http3/rocket_loader off, browser_cache_ttl=30). Catches value-coercion / default-substitution bugs a max-only test misses. Reuses the 3 independent settings assertions (no new hook). ⚠️ Not yet run live. | `assertZoneSettingsMatch,assertDedicatedSettingsMatch,assertDedicatedScalarSettingsMatch` |

**Pass criteria across all tests:**
- 0 failed rows
- Validation badges show VERIFIED / MISSING / MISMATCHED / ACKNOWLEDGED
- 0 missing, 0 mismatched
- Anything that can't migrate due to billing/entitlement/credential is
  pre-acknowledged (shown as acknowledged, not failed) per Principle 1.

**Seed-data top-level fields** (used by e01, e02, e09):
- `kv_seed_data: { [namespace_title]: [{ key, value, metadata?, expiration_ttl? }] }`
- `r2_seed_objects: { [bucket_name]: [{ key, content, contentType? }] }`
- `d1_seed_schema: { [db_name]: "CREATE TABLE ...; INSERT ..." }`
- `worker_secrets: { [worker_name]: { [SECRET_NAME]: "value" } }`

### Evidence capture

Post-run hooks that read live state (KV keys, R2 objects, DO instances,
LB pool refs, DNS flags) consume evidence JSON written by
`scripts/capture-zone-state.mjs`. The runner invokes it twice per test:

- After source seeding → `{testDir}/source-state-post-seed/{endpoint}.json`
- After dest migration → `{testDir}/dest-state-post-migrate/{endpoint}.json`

Capture takes ~85s/side, so it's gated by the `HOOKS_NEEDING_EVIDENCE`
set in `run-playwright-migrations.mjs` — only paid when the test's hook
actually needs it.

Persisted run outputs live in
`test/e2e-migrations/saved-runs/run-<date>-<label>/` with a
README describing the fixes that landed in that run. The
`e2e-migrations/` directory itself is gitignored.

## 9. Documentation map (`docs/`)

| File | When to read |
|------|--------------|
| `ARCHITECTURE.md` | System design, data flow, dependency resolution, ID remapping, error taxonomy, validation flow, worker zone discovery, user flows, design decisions |
| `TESTING.md` | How to run the unit (vitest) + E2E (Playwright) suites; triaging the load-induced parallel-worker flakiness (`--no-file-parallelism`) |
| `SECURITY.md` | FedRAMP/NIST 800-53 gap analysis + required API token permissions per operation |
| `MIGRATION_GUIDE.md` | End-to-end migration runbook — official Cloudflare process, three-phase model, pre-flight blockers, required entitlements, per-resource verification checklists, `IMPOSSIBLE_TO_MIGRATE` catalogue, cutover smoke tests, rollback plan. Covers both tool-driven and manual (`cf-terraforming`/`wrangler`) flows |
| `WORKER_BINDINGS.md` | Every Workers binding type (25+) and how it's handled — ID-referenced, name-referenced, class-referenced, account-global, config-only |
| `MAXCONFIG.md` | MaxConfig/MinConfig reference — all zone settings, ruleset payloads, subsystem configs |
| `EXPORTS.md` | Export formats — migration JSON (`ZoneExport`), troubleshooting bundle, OpenAPI everything, Terraform HCL (provider v5.17) |
| `COVERAGE.md` | Tool coverage vs the CF API write surface — the per-endpoint matrix behind the README "What Gets Migrated" tables |
| `CHANGELOG.md` | Completed-work history for the migration coverage and engine |
| `dash-deep-link-paths.md` | Verified dashboard deep-link slugs feeding `app/lib/dashLinks.ts` |

> **Generated artifacts (not under `docs/`):** `coverage/api-surface.md` is
> the auto-generated OpenAPI coverage matrix produced by
> `scripts/coverage-report.mjs --write-md`. The `coverage/` directory is
> gitignored; regenerate locally when you need a fresh report. CI gates the
> migration-coverage gap ratchet via `coverage-report.mjs --check`.
