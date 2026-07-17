# Changelog

All notable changes to Twilight Zone's migration coverage and engine are
recorded here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/). This file is the
completed-work history for Twilight Zone's migration coverage and engine.

Entries are grouped by the date the work landed. Within each date,
**Added** = new migrate-able resource types or engine features,
**Fixed** = bug fixes / correctness, **Changed** = relabels and
re-scoping with no behaviour change.

## 2026-06-07

CTO assurance work — **prove the tool migrates every zone setting a customer
cares about**, end-to-end. Verified by live Playwright e2e (`e01` omnibus and
`e07` plan-downgrade) against real Cloudflare accounts — both green (0 failed /
0 missing / 0 mismatched). `npm run typecheck` + `npm test` (full unit suite
green) clean.

### Added

- **Independent zone-settings verification across all three CF API shapes.**
  Three new evidence-based post-run assertions in
  `scripts/run-playwright-migrations.mjs`, wired into `e01` (and `e07`):
  - `assertZoneSettingsMatch` — source→dest value compare of every `editable`,
    non-read-only, non-blocked setting from the aggregate
    `GET /zones/{id}/settings`. Live `e01`: **all 37–48 editable settings
    verified** (37 on a Free source, 48 on an Enterprise source).
  - `assertDedicatedSettingsMatch` — per-field compare of the four object
    subsystems the aggregate omits (DNS settings, Origin mTLS, Fraud Detection,
    Schema Validation), checking exactly the fields the engine writes. Live
    `e01`: **10 fields verified**.
  - `assertDedicatedScalarSettingsMatch` — per-id `GET /settings/<id>` compare
    of the dedicated-endpoint scalar settings the aggregate hides (speed_brain,
    fonts, csam_scanner, origin_h2_max_streams, …), excluding non-editable
    settings. Live: **9–10 settings verified** (the count varies as
    non-editable settings like `nel` are skipped; `e07` showed 9 with
    `origin_h2_max_streams` allowed via acknowledgment).

  All three are acknowledgment-aware (Principle 2) and **fail on empty
  evidence** (no vacuous pass — AGENTS.md §8). Each validated with positive,
  negative-drift, and empty-evidence controls before wiring. Registered in the
  hook dispatch + `HOOKS_NEEDING_EVIDENCE`.
- **`capture-zone-state.mjs` now captures dedicated-endpoint scalar settings**
  into `settings_dedicated.json` (`{id, requestedId, value, editable}`). The id
  list is extracted from `src/fuzz.ts` `ZONE_SETTINGS` at runtime so it never
  drifts from the engine's own dedicated-settings list.
- **`test/dedicatedSettingAlias.test.ts`** — unit regression guard for the csam
  id-resolution fix below.

### Fixed

- **CSAM "false missing" on the Results page (Principle 1 violation).** The CF
  API serves CSAM third-party scanning at
  `/zones/{id}/settings/csam_scanner_third_party` but returns
  `result.id: "csam_scanner"`. Migrate stored/listed it under the runtime id
  `csam_scanner`, while the post-migrate verifier keyed its dedicated-endpoint
  fallback on the curated def id `csam_scanner_third_party` — so
  `resolveDestSetting('csam_scanner')` returned `undefined` and a
  successfully-migrated, disabled setting showed as **missing**. Fixed in
  `src/migrate/validate-postmigrate.ts` with an exported, unit-tested
  `DEDICATED_RUNTIME_ID_ALIASES` map + `dedicatedEndpointId()` helper.
  Live `e01`: **Missing 1 → 0**, csam now verifies. (Chose the verifier-side
  alias over renaming the `fuzz.ts` def id because that id is asserted in
  `test/fuzz.test.ts`.)
- **`assertDedicatedScalarSettingsMatch` false positive on non-editable
  settings.** The assertion compared `nel` (which is `editable: false` on most
  plans) and flagged the unavoidable value difference as a mismatch. Now the
  capture stores `editable` and the assertion skips non-editable settings,
  exactly as `assertZoneSettingsMatch` already does for the aggregate.
- **Migration report silently dropped per-item tables for sections with >50
  items.** `report-markdown.ts` only rendered the `<details>` item table when
  `items.length <= 50`; larger sections (notably **Zone Settings**, routinely
  57+ items) showed only summary counts and **no per-item rows at all**. This
  hid exactly the detail an auditor needs (Principle 8) and, critically, hid
  🟡 acknowledged / ❌ failed rows. The cap is removed — the table always renders
  (still wrapped in a collapsed `<details>`). Regression test added in
  `test/migrate.test.ts`. **This was the actual root cause of the
  `origin_h2_max_streams` "not acknowledged" symptom below** — the setting WAS
  acknowledged by the engine; the report just wasn't showing it.
- **`origin_h2_max_streams` "not acknowledged" on plan downgrade — root-caused
  to the report-truncation bug above, not an export gap.** Initial reading
  (Enterprise source value `1` → Free dest default `100`, absent from the
  report) suggested the setting never reached the migrate/acknowledge path. The
  real cause: it WAS plan-gated-rejected (code 1135) and acknowledged by
  `batch1`'s `isAcknowledgeableSingletonError` path, but lived in the 57-item
  Zone Settings section whose table the report suppressed (>50 cap). With the
  cap removed, the live `e07` report now shows
  `origin_h2_max_streams: 1 | 🟡 acknowledged`, and the acknowledgment-aware
  `assertDedicatedScalarSettingsMatch` correctly allows it. **`e07` now passes
  green** (all 4 post-run assertions). No export-path change was needed; the
  earlier export-path hypothesis was disproved by verifying before fixing.

### Test environment

- **`e07-plan-downgrade` now self-provisions an Enterprise source zone.** The
  shared source `twilight-maxconfig.user.com` was Free, so the Enterprise→lower
  downgrade could never be exercised (`assertEnterpriseFeaturesAcknowledged` had
  nothing to acknowledge). Added an idempotent `ensureSourceEnterprise` preRun
  hook (`scripts/run-playwright-migrations.mjs`) that subscribes the source zone
  to Enterprise via `POST /zones/{id}/subscription {"rate_plan":{"id":"enterprise"}}`
  (no-op if already Enterprise; errors clearly if the account lacks the
  entitlement or Enterprise is contract-managed and unassignable). Wired into
  `e07.metadata.preRun`. Live `e07` with the source Enterprise: the downgrade is
  exercised for the first time — **7** enterprise features land as 🟡 acknowledged
  (e.g. `long_lived_grpc`), 48 editable settings + 10 dedicated subsystem fields
  + 9 dedicated-scalar settings all verified, **0 failed / 0 missing /
  0 mismatched, test PASSED**. Note: this leaves the shared source zone on
  Enterprise, which other tests (`e01`, …) then also run against — a strictly
  richer baseline.
- **Why `e07` is not split for speed:** its ~4 min is dominated by one migration
  (~130s) + state capture (~85s source + ~30s dest), which are per-run costs.
  Splitting into N tests would run N migrations + 2N captures — N× the cost. The
  harness is intentionally "one migration, many cheap (ms) post-run assertions";
  the lever for speed is narrowing capture scope, not multiplying runs.

## 2026-06-06

A full `README.md` `## TODO` reconciliation + clear-out. Most items below were
already implemented in earlier work but never checked off; they were verified
against the code on 2026-06-06 and moved here. A second pass (maintainer
sign-off, same day) implemented #9 and all of #15 fresh, verified by live
Playwright e2e (`e06` Durable Objects, `e09` D1 + KV/R2 storage) against real
Cloudflare accounts — both 0 failed / 0 missing / 0 mismatched. All code changes
covered by `npm run typecheck` + `npm test` (632 passing).

### Added

- **Five-step two-phase wizard** (`Setup · Account · Zone · Clone · Results`),
  surfacing the engine's `migrateAccountResources` (account phase) then
  `migrateZone` (zone phase). Account/Zone are the auditable scope split;
  `StepClone.tsx` is the interactive post-migration step; Results is read-only.
  Preset mode (MaxConfig/MinConfig) greys steps 2–3 and labels step 4 "Apply".
  Added `mergeReports` (account ⊕ zone). [#19]
- **Browser/mouse Back & Forward** wizard navigation via the History API
  (`popstate`), clamped to `maxStepReached`, inert during a running stream.
- **Pre-cutover uptime monitor** — `POST /api/monitor/ping` (host-locked,
  SSRF-guarded, single ping; browser drives the 1/sec cadence), a curl parser,
  and a header heartbeat (`MonitorHeartbeat`) that survives step navigation.
- **"Download planned API calls as a script"** button (`DownloadScriptButton`)
  — emits the planned WRITE calls from the dry-run `/api/validate` plan as
  TS/curl/Python/Go/Terraform that reads `CF_API_TOKEN` from env (never embeds
  creds). [#19 Part D]
- **Dedicated-endpoint zone-settings export** — `export-zone.ts` now backfills
  the settings the aggregate `GET /zones/{}/settings` omits (`speed_brain`,
  `fonts`, `origin_max_http_version`, `ssl_automatic_mode`,
  `origin_h2_max_streams`, `rum`, `aegis`) so they flow through migrate + verify.
- **`rum` (Web Analytics) zone setting** in MaxConfig (plain `on`/`off` toggle).
- **`durable_object_state` `IMPOSSIBLE_TO_MIGRATE` entry** (`data_offline`) so
  "DO stored state isn't copied automatically" surfaces in
  `PostMigrationWorkPanel` + the Clone step.

### Fixed

- **"Already in the desired state" is on-target success, not failure.**
  `src/fuzz.ts` adds an `alreadyPresent` outcome counted with `success` (never
  ✗), and fuzz/MaxConfig now emit a real structured summary instead of
  `0/0/0/0`. Scope grays items already identical on the destination
  (`identicalItems.ts`). [Principle 1 sibling]
- **Twilight modals no longer clipped by the TV cabinet** — twilight-only
  `z-index` override lifts modal overlays above the cabinet frame; background
  scroll-lock fixed in twilight via a shared `useScrollLock` hook (locks both
  `body` and `.tvc-host--page`).
- **Silenced the "[DOM] Password field is not contained in a form" advisory** —
  credential/secret inputs wrapped in non-submitting `<form>` elements.

### Changed

- **#9 — manual-action gates → non-blocking disclosures.** The `requiresAck`
  gates `missing-storage-deps` and `enterprise-plan-settings`
  (`preMigrationActions.tsx`) no longer block "Continue"; they stay loud
  warnings with a Deselect affordance, and the deferrable work surfaces on the
  Clone step + `PostMigrationWorkPanel`. No §5 wording change needed (Principle 3
  is a customer-facing "no silent failures" promise; relocating a *disclosed*
  acknowledgment to the Clone step preserves it — Principle 4).
- **#15 — removed the redundant inline gated D1 card; de-gated D1 and Durable
  Objects.** D1/DO namespaces are freely selectable (created empty / via worker
  deploy); the DO state-migration config is kept (optional); the D1
  post-migration `wrangler d1` commands carry source/dest `--account-id`.
  Verified live (`e06`, `e09`).
- **Step 2 "Preview" → "Scope"; step-4 component "Cutover" → "Clone"** across
  code (`Step2Scope.tsx`, `StepClone.tsx`) and docs.
- **Step 2 Scope shows full per-resource detail** (per-type formatters in
  `itemDetail.ts`) instead of truncated chips. [Principle 8]
- **Removed informational notice blocks from the old Step 3** — `Step3Setup.tsx`
  deleted in the renumber; genuine secret/cert inputs relocated to the
  Account/Zone scope steps, the Turnstile sitekey notice flows to the Clone step.
- **Removed the duplicate EXPORT block from Step 2** and moved the live "Export
  Summary" terminal to the top of Step 2.
- **Coverage modal** — removed the redundant "Show all" hint bar; expand
  zone-migratable features by default.
- **About modal overhaul** — added "why this exists" + the product principles;
  fixed "15+" → "30+" and the step names.
- **Attention styling** — "conflict strategy" + "Archive source analytics" cards
  are yellow; "Open in Dash" links got a persistent orange-underline affordance;
  "⏸ Cannot continue" blockers are red + bold; added an "I understand…" line to
  `PostMigrationWorkPanel`.
- **Hover-to-exit dwell** (twilight → base) lengthened 5s → 20s (enter stays 5s).
- **Twilight TV cabinet** — dropped the RCA Victor variant + the multi-TV
  style-toggle system (Sears-only), and gave the Sears tuner numbered VHF/UHF
  dials (rotate-ring / fixed-pointer). Verified visually by the maintainer.
- **Step-indicator** — an experimental pinned strip + condense-on-scroll mini
  door was added then reverted per maintainer; the indicator lives back in the
  header's right column. The durable `useScrollLock` fix from that work was kept.
- **Docs** — reconciled AGENTS.md / README against the code (5-step flow, the
  full route list incl. `/api/analytics/*`, `/api/diff/stream`, `/api/stats`,
  `/api/monitor/ping`, `/api/webhook-sink`, the docs map, and stale file/test
  inventories).

## 2026-05-31

### Added

- **Access app `self_hosted_domains[]` + `destinations[]` migration.**
  `CFAccessApp` (`src/types.ts`) previously modelled only the single
  legacy `domain` field, so modern self-hosted Access apps that route via
  `self_hosted_domains[]` (array of public hostnames) or `destinations[]`
  (array of `{type, uri}` public hostnames and/or `{type, cidr, hostname,
  …}` private-network targets) migrated with empty/stale routing and lost
  their reachability on the destination. Now:
  - `CFAccessApp` gains `self_hosted_domains?: string[]` and
    `destinations?: CFAccessDestination[]`; `CFAccessDestination` models
    the public/private/`via_mcp_server_portal` union.
  - New pure helper `rewriteAccessAppDomains()`
    (`src/migrate/transforms.ts`) rewrites the legacy `domain`, every
    `self_hosted_domains[]` entry, and each destination's `uri`/`hostname`
    through `rewriteZoneDomain()` (source→dest zone remap). Non-hostname
    destination fields (`cidr`, `vnet_id`, `mcp_server_id`, `l4_protocol`,
    `port_range`) are preserved verbatim. Empty arrays are never emitted,
    so legacy single-`domain` apps are unaffected.
  - New helper `accessAppHostnames()` collects every hostname an app
    references; the export's zone-relatedness scoring
    (`src/migrate/export-zone.ts`) now uses it so a modern app with an
    empty `domain` is no longer wrongly dropped from the migration.
  - `migrateLbAndAccess()` (`src/migrate/lb-access.ts`) sends both arrays
    on create and surfaces the first real hostname in the acknowledge
    message when a hostname genuinely doesn't belong to a dest zone
    (Principle 1 + 4).
  - Unit tests in `test/transforms.test.ts`; end-to-end regression in
    `docs/test_configs/e12-access-multidomain.json` with assertion
    `assertAccessMultiDomainMigrated` (verifies both arrays survive and
    no source-zone hostname leaks onto the dest zone).

### Fixed

Code review findings (2026-05-31, codex) against RFC 009 (TypeScript
Practices), RFC 010 (Resilience), RFC 012 (Observability), and AGENTS.md
§5.

- **S1 — transient 5xx misclassified as `acknowledged`.** In
  `ackSecondaryDnsZoneConfig` (`src/migrate/zone-extras.ts`) the
  `'api request failed'` substring also caught `"API request failed after
  retries"` (transient 5xx exhaustion), masking real outages as
  entitlement gaps. Fixed at the boundary: `cfFetch` now throws a tagged
  `EmptyEnvelopeError(path, status)` for the bare `{success:false, no
  errors[], no messages[]}` response (`src/api.ts`), and the consumer
  acknowledges ONLY `e instanceof api.EmptyEnvelopeError && e.status <
  500`. Regression test in `test/api.test.ts`. Live-confirmed against a
  free-plan zone: `POST .../secondary_dns/outgoing` returns `HTTP 401`
  with an empty envelope (→ acknowledged) while `incoming` with a bad peer
  returns `HTTP 400` with a populated `errors[]` (→ stays failed).
- **S2 — unguarded `(e as Error).message` in two new catches.** Zone
  Settings catch (`src/migrate/batch1.ts`) and Managed Headers catch
  (`src/migrate/zone-extras.ts`) switched to the RFC 009/012 idiom
  `e instanceof Error ? e.message : String(e)`, so a non-`Error` throw can
  no longer crash the step via `undefined.toLowerCase()`. (The same idiom
  was also applied to the Access app catch in `src/migrate/lb-access.ts`
  during the 2026-05-31 Access work.)
- **S3 — `isConflictError` `'already in use'` pattern too broad.**
  (`src/migrate/errors.ts`) Dropped the bare `'already in use'` (it would
  silently skip genuine "IP/port already in use" failures); kept the
  NAME-scoped `'must be unique'` + `'name is already in use'`.
- **N1 — `createAiGatewayProviderConfig` only exercised by tests.**
  (`src/api.ts`) Added a doc comment noting the migrate engine
  intentionally does NOT call it (BYOK secret is write-only →
  acknowledged), kept correct for the api-v1 surface.
- **N2 — comment referenced an ephemeral `/tmp` path.**
  (`app/components/Layout.tsx`, RetroTvCabinet bezel) Reworded to describe
  the self-contained `.bezel-vector` SVG paths.

## 2026-05-26 (and follow-ups)

Audit of `scripts/coverage-overrides.json` + `IMPOSSIBLE_TO_MIGRATE`
(`src/types.ts`) against AGENTS.md Principle 7 ("after migration, would
the user notice this feature missing?"). The 2026-05-26 commit shipped 4
features (Custom Hostnames Fallback Origin, AI Security settings +
custom-topics, Workers Observability destinations + queries, Vectorize
indexes); the items below landed across that commit and its follow-ups,
driving the in-SDK coverage gap to **0**.

### Added

- **Waiting Room zone-level settings** (`PUT
  /zones/{}/waiting_rooms/settings`).
- **Content Upload Scan settings** (`PUT
  /zones/{}/content-upload-scan/settings`); `waf_content_upload_scan`
  removed from `IMPOSSIBLE_TO_MIGRATE`.
- **Cache `origin_cloud_regions`** (`PATCH
  /zones/{}/cache/origin_cloud_regions/batch`). IP-to-cloud-region
  mappings (AWS/Azure/GCP/OCI) for Tiered Cache upper-tier routing;
  implemented as an idempotent batch PATCH chunked at 100/call.
- **Custom Leaked Credential Detections + zone-wide toggle** (`POST
  /zones/{}/leaked-credential-checks`, `.../detections`). The
  `leaked_credential_detection` IMPOSSIBLE entry was scoped to
  AUTO-managed default detections only; user-supplied customs now migrate
  via `leakedCredentialCustomDetections`.
- **Email Routing DNS records + Email Sending subdomains.** Switched
  `enableEmailRouting()` from the deprecated `POST /email/routing/enable`
  to the modern `POST /email/routing/dns` (enables Email Routing and
  auto-locks the required MX/SPF records). Added
  `listEmailSendingSubdomains` + `createEmailSendingSubdomain` for
  outbound transactional sending domains.
- **Web3 hostnames (IPFS gateway).** Removed `web3_gateway` from
  `IMPOSSIBLE_TO_MIGRATE` (the API is fully zone-scoped). Parent hostname
  migrates via `POST /zones/{}/web3/hostnames`; the IPFS Universal Path
  content block-list migrates via the full-replace `PUT .../content_list`.
- **Secondary DNS incoming + outgoing.** Removed
  `secondary_dns_incoming` / `secondary_dns_outgoing` IMPOSSIBLE entries
  (the manual coordination was customer-side, not CF-side). Added
  `secondary_dns_tsig_secrets` IMPOSSIBLE entry (cryptographic) plus
  `MigrationConfig.tsigSecrets`. Source→dest ID remapping is keyed by
  NAME; peers referencing TSIGs whose secrets weren't supplied migrate
  with `tsig_id` stripped + a per-item acknowledgment.
- **LB monitor_groups.** Account-scoped list inside `migrateLbAndAccess`
  right after monitors; each member's `monitor_id` is remapped through
  `monitorIdMap`. Members whose source monitor wasn't migrated are dropped
  (the API rejects unknown monitor IDs).
- **Hyperdrive configs.** Migrates in the storage phase alongside KV/D1,
  returning a `hyperdriveIdMap` consumed by workers-deploy/batch2 to remap
  Worker `hyperdrive` binding ids. Added `hyperdrive_origin_credentials`
  IMPOSSIBLE entry (cryptographic) + `MigrationConfig.hyperdriveOriginCredentials`.
  Ratchet: `max_in_scope_gaps_in_sdk` 2→1, `max_in_scope_gaps` 98→97.
- **Secrets Store stores** — the LAST in-SDK gap. Store metadata migrates
  inside `migrateStorage` returning a `secretsStoreIdMap` consumed to
  remap Worker `secrets_store_secrets` binding `store_id` fields. Secret
  VALUES stay write-only (acknowledged via re-scoped
  `worker_binding_secrets_store`). Ratchet: `max_in_scope_gaps_in_sdk`
  1→0, `max_in_scope_gaps` 97→96.
- **API Shield surface** — three high-value pieces: `PUT
  /api_gateway/configuration` (zone-wide `auth_id_characteristics`), `POST
  /api_gateway/labels/user` (user-defined operation labels), and `PATCH
  /api_gateway/operations/schema_validation` (per-operation
  schema-validation overrides, remapped via the stable
  `method|host|endpoint` triple). Added `api_shield_token_validation_credentials`
  IMPOSSIBLE entry (JWT JWKS keys are write-only). Tracked follow-up
  (still `newer_subfeature`): label→operation attachment.

### Changed

Override relabels — `scripts/coverage-overrides.json` +
`scripts/seed-coverage-overrides.mjs` (seed rules so re-seeds stay
sticky). After the implementations above landed, related overrides
auto-flipped `newer_subfeature` → `implemented`. Remaining honest
relabels:

- Added reason codes `redundant_with_bundle_put`,
  `redundant_with_record_post`, `redundant_with_ruleset_put` (plus
  `redundant_with_collection_put`) with their own seed rules.
- 13 Workers script-aspect endpoints (`content`, `tails`, `versions`,
  `deployments`, `schedules`, `subdomain`, `script-settings`, `settings`,
  `assets-upload-session`, + 4 `workers/workers/*`) →
  `redundant_with_bundle_put`.
- 2 DNS bulk endpoints (`dns_records/batch`, `dns_records/import`) →
  `redundant_with_record_post`.
- 4 ruleset per-rule endpoints (POST/PATCH `rulesets/{}/rules{/{}}`,
  account + zone scope) → `redundant_with_ruleset_put`.
- 11 PUT/PATCH endpoints we POST fresh (logpush PUT, page_shield policy
  PUT, dnssec PATCH, api_gateway discovery/labels/user_schemas PATCH,
  schema_validation/schemas PATCH, waiting_room events PUT+PATCH) →
  `updated_via_post`.
- `PUT /accounts/{}/storage/kv/namespaces/{}/values/{}` → `data_plane`.
- `POST /zones/{}/access/service_tokens` → `dual_scope_covered`.
- Email Routing: legacy `/enable` POST → `redundant_with_post_dns`;
  `PATCH /email/routing/dns` → `imperative_action`. Web3 per-entry
  POST/PUT → `redundant_with_put`; parent PATCH → `updated_via_post`.
  Leaked-credential PUT-per-id → `updated_via_post`. API Shield: legacy
  schema_validation PUT+PATCH → `dual_scope_covered`; operations/item POST
  + single-op schema_validation + new schema_validation/settings/operations
  → `redundant_with_put`; token_validation/config PATCH → `updated_via_post`.

In-scope-but-not-yet-implemented entries (Workers Dispatch, Pipelines,
Access AI Controls, Zone Environments, Access Bookmarks, R2
sippy/lock/custom-domains, AI Gateway advanced features, Zaraz
workflow/Google Tag Gateway/Token Validation credentials, Web3
content_list nested entries) keep `reason: null` (real gap) so the
ratchet keeps pressure on.
