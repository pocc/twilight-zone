# Twilight Zone

A Cloudflare Worker-based web application to migrate zones between Cloudflare accounts. Provides an interactive HTML UI for exporting, previewing, and executing zone migrations with support for secrets and certificates.

> ## ⚠️ Not a Cloudflare product — no warranty, no support
>
> Twilight Zone is **not an official Cloudflare product** and is **not
> supported by Cloudflare Support.** Do not open support tickets or
> escalations for it. It is an independent, best-effort tool authored and
> maintained independently; bugs and requests go to this repository's issue
> tracker or `twilight-zone[АТ]ross.gg`, not to Cloudflare.
>
> It is provided **"AS IS", WITHOUT WARRANTY OF ANY KIND**, per the
> [Apache License 2.0](LICENSE). You are solely responsible for verifying
> the result of any migration. Always confirm the destination zone before
> changing nameservers at your registrar. See also [NOTICE](NOTICE).

## Features

- **Interactive Web UI** - Step-by-step migration wizard
- **Complete zone export** - Export all configuration to JSON
- **Worker & Routes migration** - Migrates worker scripts and routes
- **Storage data migration** - Copies Workers KV key/value data and (with S3 credentials) R2 object data; creates D1 databases and Durable Object namespaces, with optional DO state migration
- **Load Balancer migration** - Pools, monitors, and LB configs
- **Secrets prompting** - Enter worker secrets that can't be read from source
- **Certificate upload** - Re-upload custom SSL certificates
- **Migration report** - Downloadable `migration_report.md` with full details

### What Gets Migrated

A feature-by-feature view of the Cloudflare API write surface and what Twilight Zone implements. For the full endpoint-by-endpoint matrix (POST/PATCH/PUT, 1,500+ write endpoints across 65+ features), see [`docs/COVERAGE.md`](docs/COVERAGE.md).

**Status legend**: ✅ Implemented · 🟡 Acknowledged (`IMPOSSIBLE_TO_MIGRATE`) · ❌ Gap (in-scope but unimplemented) · ⚪ Out of scope (account admin, Zero Trust, Magic, AI run, etc.).

#### Staying current with Cloudflare's API

Two guarantees keep the tables above from silently going stale:

1. **Zone settings migrate dynamically, not from a hand-maintained list.**
   Whatever the source zone's settings API reports is migrated as-is, so a
   setting Cloudflare adds needs no code change.
2. **An hourly Worker watches Cloudflare's API spec.** It diffs the live
   Cloudflare OpenAPI spec against our committed baseline and — the moment a new
   write endpoint appears (including a new dedicated zone-setting endpoint) —
   raises an in-app banner and pings our team in Google Chat, so drift is caught
   within the hour rather than by a customer. (An ETag HEAD probe means the
   hourly check only downloads/parses on the rare hours the spec actually
   changed.)

The monitor **alerts**; a human then triages the endpoint and the CI coverage
ratchet enforces zero in-scope gaps. For how it works under the hood and the
runbook for responding to a "new endpoint" alert, see
**[docs/SPEC_DRIFT_MONITOR.md](docs/SPEC_DRIFT_MONITOR.md)** (live status:
`GET /api/spec-status`).

#### Fully covered

These features have every write endpoint we need implemented and tested. Plan / add-on / entitlement columns list what the destination account needs.

| Feature | Plan · Add-on · Entitlement | Writes | Status |
|---|---|---:|---|
| Rules > Managed Transforms | Free | 1 | ✅ |
| Rules > URL Normalization | Free | 1 | ✅ |
| Rules > Cloud Connector | Pro | 1 | ✅ |
| Rules > Snippets | Free | 2 | ✅ |
| Security > Page Shield | Business | 3 | ✅ partial |
| Security > Bots | Enterprise · Bot Management | 3 | ✅ partial |
| Spectrum | Enterprise · Spectrum | 2 | ✅ partial |

#### Partially covered

Implementation exists, gaps remain. Most "gaps" are PATCH variants we don't need because we use PUT, or rarely-used sub-resources. See `docs/COVERAGE.md` for the per-endpoint detail.

| Feature | Plan · Add-on · Entitlement | Writes | ✅ Impl | ❌ Gap |
|---|---|---:|---:|---:|
| Caching | Free | 13 | 6 | 7 |
| DNS | Free | 10 | 3 | 7 |
| SSL/TLS | Free | 18 | 4 | 14 |
| Email > Email Routing | Free | 17 | 4 | 13 |
| Rules > WAF (Custom Rulesets) | Pro | 10 | 3 | 7 |
| Rules > Firewall Rules (legacy) | Free | 21 | 4 | 17 |
| Rules > Rate Limiting (legacy) | Advanced Rate Limiting for >1k rps | 2 | 1 | 1 |
| Rules > Page Rules (legacy) | Free | 3 | 1 | 2 |
| Zone Settings | Free | 14 | 1 | 13 |
| Zone Administration | Free | 17 | 1 | 16 |
| Traffic > Load Balancing | · Load Balancing | 19 | 4 | 15 |
| Traffic > Waiting Rooms | Business · Waiting Room | 12 | 2 | 10 |
| Workers & Pages > Workers | · · workers_paid | 47 | 2 | 45 |
| Workers KV | Free (Workers Paid for >1k keys/day) | 6 | 1 | 5 |
| R2 Object Storage | usage-based · · r2 | 17 | 4 | 13 |
| D1 Database | · · d1 | 8 | 1 | 7 |
| Queues | usage-based · · queues | 12 | 2 | 10 |
| Secrets Store | Free | 4 | 1 | 3 |
| Custom Hostnames / SSL for SaaS | Business · SSL for SaaS | 5 | 1 | 4 |
| Security > API Shield | Enterprise · API Shield | 35 | 6 | 29 |
| Zero Trust > Access | Free (50 users) · Zero Trust | 74 | 6 | 68 |
| AI > AI Gateway | usage-based | 20 | 2 | 18 |
| Logs > Logpush | Enterprise · Logpush | 23 | 2 | 21 |

#### Acknowledged (cannot migrate via API)

These resources are listed in [`IMPOSSIBLE_TO_MIGRATE`](src/types.ts) and surfaced to the user in Step 2 of the wizard. The user acknowledges them explicitly before migration runs.

| Category | Examples |
|---|---|
| **Cryptographic** (write-only material) | Worker secrets, Access service-token client secrets, Turnstile widget secrets, custom certificate private keys, Origin CA private keys, Keyless SSL private keys |
| **Account-tied** (provisioned per-account by Cloudflare) | Cloudflare Registrar, BYOIP prefixes, Aegis IPs, Magic Transit/WAN/Firewall, China Network, FedRAMP environment, CNI peering |
| **Auto-managed** (Cloudflare provisions automatically) | Universal SSL pack, Managed Rulesets (Cloudflare/OWASP), DDoS L3/L4/L7 managed rules, Smart Tiered Caching, WAF Attack Score, Backup Certificates |
| **Read-only** (settings exposed but immutable) | `cname_flattening`, `plan_level`, `orange_to_orange`, `advanced_ddos` |
| **Data-ephemeral** (volatile by design) | Cache content, analytics history, security events history, audit logs, in-flight queue messages, KV expiration TTLs |
| **Data-offline** (bulk-copy required) | D1 schema and rows (wrangler), R2 bulk object data (rclone), Logpush buffered batches, Durable Object stored state (created empty unless DO migration is configured) |
| **Manual external** (action required outside Cloudflare) | DNSSEC DS record update at registrar, email-routing destination verification, registrar nameserver change, custom hostname SSL validation |

#### Not in scope for zone migration

These features exist on the Cloudflare API but aren't part of zone migration. They have their own admin surfaces and most are inherently per-account, not per-zone.

| Feature group | Endpoints | Reason |
|---|---:|---|
| Account Administration (IAM, billing, registrar, tokens, alerts, etc.) | 93 | Per-account, not per-zone |
| Zero Trust > Gateway / WARP / DLP / DEX / Risk Scoring | 110 | Per-organization Zero Trust admin |
| Magic Networking (Transit / WAN / Firewall) | 100 | Account-tied + dedicated onboarding |
| AI > Workers AI (`/ai/run`) | 105 | Model invocation, no config to migrate |
| AI > AI Search / AutoRAG | 25 | Separate data lifecycle |
| Realtime / Calls / MoQ | 33 | Beta, no per-zone config |
| Stream / Images / Pages | 35 | Separate product migrations |
| Security > CloudForce One / Brand Protection / Intel | 110 | Account-level intel |
| Email Security | 23 | Account-level mail policy |
| Networks > Tunnels (Cloudflared / CNI) | 8 | Per-organization tunnel infrastructure |
| Browser Rendering REST API | 11 | Worker binding covered separately |
| Containers | 1 | Beta, separate migration path |
| User Profile (`/user/*`) | 17 | Per-user, not per-account |
| System / Internal | 17 | Internal endpoints |

**Important**: "out of scope" means *this tool doesn't migrate it*. It does NOT mean Cloudflare can't help you replicate the configuration - most of these have their own migration paths via the dashboard, Terraform, or vendor-specific tooling. Use the relevant Cloudflare product documentation or your normal account-support channel.

## Prefer to migrate manually?

Twilight Zone is one of several ways to migrate a zone between Cloudflare accounts. If you can't or don't want to use this tool - for compliance reasons, because you don't have cross-account API tokens, because you're in a FedRAMP environment, or because you simply want to do it yourself with official Cloudflare tooling like `cf-terraforming` and `wrangler` - follow the [Migration Guide](docs/MIGRATION_GUIDE.md) instead. It walks through the same end-to-end migration step-by-step (with or without the wizard) and doubles as a "trust but verify" checklist if you do use Twilight Zone.

## Installation

```bash
cd twilight-zone
npm install
```

### Configuration

Set your Cloudflare account ID in your shell before running `dev` or
`deploy`:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
```

Wrangler reads this automatically. Alternatively, pin it in
`wrangler.toml` by uncommenting the `account_id` line.

## Usage

### Local Development

```bash
npm run dev
# Open http://localhost:5173
```

### Deploy to Cloudflare

```bash
npm run deploy
```

### Using the Web UI

The wizard is a Setup landing (**step 0**) plus four numbered steps (1–4),
mirroring the engine's `migrateAccountResources` then `migrateZone` phases:

- **Step 0 — Setup** - Provide API tokens (or API key + email) and pick source/dest accounts + zone (the landing screen; not a numbered circle in the strip)
- **Step 1 — Account** - Audit account-scoped resources (Workers, KV/R2/D1, Queues, LB pools/monitors, Access, Turnstile, …) and supply account-scoped secrets. Select-only review — nothing is written here; primary action is **Continue to Zone →**
- **Step 2 — Zone** - Audit zone-scoped resources (DNS, settings, rulesets, page rules, email routing, …) and supply zone-scoped secrets (custom SSL cert+key, AOP mTLS); optional **Download script** and pre-cutover uptime monitor. Still select-only — primary action is **Continue to Apply →**
- **Step 3 — Apply** - The single "do it" step: review the plan, confirm the destination, then **Run migration →** (streams the account-resource phase then the zone phase). Once it completes, work the interactive post-migration checklist (registrar nameserver change, DNSSEC DS, email verification, Turnstile sitekeys, KV/R2/D1 data copies)
- **Step 4 — Results** - Read-only verification of the merged report; download `migration_report.md`

(MaxConfig/MinConfig presets are not migrations: they still walk the Account
and Zone review steps (navigable, not greyed), then land on step 3 — the
**Apply** run.)

## Scripts

Everything in `scripts/` is a Node ESM (`.mjs`) tool. Most are operational/test
tooling rather than part of the deployed Worker. Scripts that hit the Cloudflare
API read credentials from the environment or `.env.test` (see the E2E section);
generator scripts are pure static analysis with no network calls.

### npm aliases

| Command | Runs | What it does |
|---------|------|--------------|
| `npm run dev` | `vite dev` | Local dev server (SPA + Worker) at http://localhost:5173 |
| `npm run build` | `vite build` | Production build into `dist/` |
| `npm run deploy` | `vite build && wrangler deploy` | Build then deploy the Worker |
| `npm run typecheck` | `tsc --noEmit` | Type-check the whole project |
| `npm test` / `npm run test:watch` | `vitest` | Unit tests (one-shot / watch) |
| `npm run delete:maxconfig-zone` | `scripts/delete-maxconfig-zone.mjs` | Delete a MaxConfig/test config from a zone + account |
| `npm run generate:openapi-manifest` | `scripts/generate-openapi-manifest.mjs` | Regenerate `src/openapi-manifest.generated.ts` from the CF OpenAPI spec |
| `npm run generate:sdk-index` | `scripts/extract-sdk-index.mjs` | Flat index of cloudflare-typescript SDK endpoints (coverage input) |
| `npm run generate:tz-coverage` | `scripts/extract-tz-coverage.mjs` | Set of CF endpoints Twilight Zone actually calls (coverage input) |
| `npm run generate:coverage-snapshot` | `scripts/generate-coverage-snapshot.mjs` | Build `app/lib/coverageData.ts` for the landing-page tiles |
| `npm run generate:coverage-inputs` | (manifest + sdk-index + tz-coverage) | Regenerate all three coverage inputs |
| `npm run coverage` / `coverage:write` | `scripts/coverage-report.mjs` | Tool-coverage report vs the CF API surface (`--write-md` writes `coverage/api-surface.md`) |
| `npm run coverage:check` | `scripts/coverage-report.mjs --check` | CI gate: ratchet the migration-coverage gap |
| `npm run coverage:uncategorized` | `scripts/coverage-report.mjs --uncategorized` | List endpoints with no coverage override yet |
| `npm run coverage:overrides:seed` | `scripts/seed-coverage-overrides.mjs --write` | Seed `coverage-overrides.json` from the current gap set |
| `npm run coverage:all` | (inputs + write + snapshot) | Full coverage regeneration pipeline |

### E2E / migration tooling

| Script | Purpose |
|--------|---------|
| `run-playwright-migrations.mjs` | The E2E test harness. Drives the full wizard UI against real Cloudflare accounts for each `docs/test_configs/e*.json` config: seeds source resources, runs the two-phase migration, captures state, and runs post-run assertions. `--only N`, `--start N --end M`; `SLOW_MODE=1` keeps the browser open 10 min on Results (off by default). |
| `run-single-zone-migration.mjs` | Playwright driver for ONE migration against the live deployed UI (`$TZ_URL`), capturing per-step screenshots/state into `$EVIDENCE_DIR` for the verifier. |
| `capture-zone-state.mjs` | Snapshots a zone's live state (DNS, settings, rulesets, KV keys, R2 objects, LB refs, …) to JSON. The harness runs it before source seeding and after dest migration to feed evidence-based assertions. Also writes `settings_dedicated.json` — the dedicated-endpoint scalar settings the aggregate `GET /zones/{id}/settings` omits (speed_brain, fonts, csam_scanner, origin_h2_max_streams, …), fetched per-id with their `editable` flag — so the settings comparison covers settings the aggregate can't see. The id list is sourced from `src/fuzz.ts` `ZONE_SETTINGS` at runtime (no drift). |
| `verify-checklist.mjs` | Per-resource verification report comparing captured source vs dest state across all 30+ resource types. |
| `zone-apply.mjs` | CLI to apply (or clean) a config against a single zone without the UI — used to provision MaxConfig/test state directly. |
| `delete-maxconfig-zone.mjs` | Tear-down for a MaxConfig/test config: resets a zone wholesale and sweeps test-prefixed account-scoped resources (workers, KV, R2, D1, queues, LB pools/monitors, Access, Turnstile, …). Interactive account/zone pickers when flags are omitted; `--dry-run` to preview, `--force-delete` to execute, `--skip-maxconfig-check` to bypass the safety pre-flight. |
| `preflight-e2e.mjs` | ~5s validation of every assumption the Playwright harness needs (env vars, API-key validity, account/zone access, domain match) before a long run. Exits non-zero with a concrete fix on failure. |
| `api-test.mjs` | Exercises the non-streaming `/api/v1/*` JSON endpoints (`--base-url`, `--only auth,export`). |
| `rate-limiter.mjs` | Shared module: leaky-bucket CF API rate limiter + `createRateLimitedFetcher`. Imported by the harness and `delete-maxconfig-zone.mjs`, not run directly. |
| `e2e-env.mjs` | Shared module: loads/validates required E2E env vars from `.env.test`. Not run directly. |
| `debug-step2.mjs` / `inspect-step2.mjs` | Diagnostics that walk the wizard to Step 2 and dump console/HTML/row state when export-stream waits time out or capability rows fail to acknowledge. |

### Coverage / generator tooling

| Script | Purpose |
|--------|---------|
| `coverage-report.mjs` | Computes Twilight Zone's coverage of the CF API surface; `--check` (CI ratchet), `--write-md`, `--uncategorized`. |
| `extract-sdk-index.mjs` | Static parse of `node_modules/cloudflare` into a flat SDK endpoint index → `coverage/sdk-index.generated.json`. |
| `extract-tz-coverage.mjs` | Static parse of `src/api.ts` + `src/migrate/*` to find which endpoints the tool calls and which are reachable from migration. |
| `generate-openapi-manifest.mjs` | Regenerates the OpenAPI manifest the coverage tooling cross-checks against. |
| `generate-coverage-snapshot.mjs` | Builds the typed `app/lib/coverageData.ts` snapshot from the generated inputs + taxonomy + overrides. |
| `seed-coverage-overrides.mjs` | Seeds `coverage-overrides.json` with categorical reason codes (`data_plane`, `imperative_action`, `redundant_with_put`, `dual_scope_covered`, …). |
| `add-feature-categories.mjs` | One-shot, re-runnable migration that adds a `category` field to every feature in `feature-taxonomy.json` (hand-edits preserved). |
| `dash-link-crawl.mjs` | Crawls dash.cloudflare.com's own navigation to capture canonical section slugs/anchors that feed `app/lib/dashLinks.ts` and `docs/dash-deep-link-paths.md`. Requires a logged-in browser session (SSO; API tokens don't work). |

Supporting data files (not scripts): `coverage-overrides.json`, `coverage-ratchet.json`,
`feature-taxonomy.json`.

## API Endpoints

Twilight Zone's Worker exposes two API surfaces: the UI-facing `/api/*` endpoints (used by the wizard) and the programmatic `/api/v1/*` API (pure JSON, no SSE). All write endpoints are `POST` - see `src/worker/index.ts` for the routing table.

### UI-facing `/api/*` (streaming + JSON)

**Public read-only**

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/version` | Build version metadata |
| GET  | `/api/stats` | Aggregate run-log stats (drives the landing-page "N zones migrated" counter) |
| GET  | `/api/spec-status` | Hourly spec-drift monitor status: live Cloudflare OpenAPI write endpoints not yet in our baseline (see [docs/SPEC_DRIFT_MONITOR.md](docs/SPEC_DRIFT_MONITOR.md)) |
| GET  | `/favicon.svg` / `/favicon.ico` | App icon |

**Export endpoints** (read-only against source)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/export` | Synchronous: full zone export as JSON |
| POST | `/api/export/stream` | SSE: same export with live progress |
| POST | `/api/export/troubleshooting` | Synchronous: support-bundle export |
| POST | `/api/export/troubleshooting/stream` | SSE: support bundle with progress |
| POST | `/api/export/openapi` | Synchronous: "everything via OpenAPI" dump |
| POST | `/api/export/openapi/stream` | SSE: same with progress |
| POST | `/api/analytics/export` | Synchronous: source-analytics archive export |
| POST | `/api/analytics/export/stream` | SSE: source-analytics archive with progress (Step 3 "Archive source analytics") |
| POST | `/api/analytics/probe/stream` | SSE: per-dataset analytics access probe (drives the archive section's availability check) |

**Migration endpoints** (write to destination)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/migrate` | Synchronous: full migration in a single response |
| POST | `/api/migrate/stream` | SSE: full migration with live progress + `prompt` events |
| POST | `/api/migrate/account-resources` | SSE: pre-deploy account-scoped resources (LBs, KV, R2, D1, Access, Workers, Turnstile) |
| POST | `/api/migrate/respond` | Resolve a `prompt` event from `/api/migrate/stream` (e.g. supply a worker secret value) |
| POST | `/api/rollback` | Undo a partial migration on the destination (delete created resources) |
| POST | `/api/validate` | Dry-run validation: export source + validate against destination **without writing** |

**Terraform output**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/terraform/export` | Synchronous: emit Terraform HCL from source config |
| POST | `/api/terraform/export/stream` | SSE: same with progress |
| POST | `/api/terraform/import/stream` | SSE: generate `terraform import` script for existing dest resources |

**Pre-flight checks + utilities**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/validate-token` | Token shape + permission validation |
| POST | `/api/check-blockers` | Pre-migration blocker list (plan mismatch, etc.) |
| POST | `/api/check-capabilities` | Account capability probe (drives Step 2 entitlement UI) |
| POST | `/api/email-routing/send-verification` | Kick off email destination verification on dest |
| POST | `/api/email-routing/check-verification` | Poll verification status |
| POST | `/api/zones` | List zones for an account |
| POST | `/api/accounts` | List accounts visible to a token |
| POST | `/api/rdap` | Registrar / nameserver lookup |
| POST | `/api/available-plans` | Plans assignable to a zone |
| POST | `/api/diff/stream` | SSE: source↔destination diff (feeds the Scope "already identical" graying) |
| POST | `/api/monitor/ping` | Pre-cutover uptime monitor: one host-locked, SSRF-guarded ping (browser drives the 1/sec cadence) |
| ALL  | `/api/webhook-sink` | No-op `{ ok: true }` sink — test/diagnostic target for notification-webhook + monitor checks |

**Test fixture generation** (used by the fuzz harness)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/fuzz/stream` | SSE: fuzz a zone with random configuration |
| POST | `/api/maxconfig/stream` | SSE: apply MaxConfig (every feature on) |
| POST | `/api/minconfig/stream` | SSE: apply MinConfig (defaults) |

### Programmatic `/api/v1/*`

A pure JSON mirror of the same operations, with no SSE streaming. Useful for scripting migrations without driving the UI. See [`src/worker/api-v1.ts`](src/worker/api-v1.ts) for the full route list.

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/v1` | API metadata + endpoint list |
| GET  | `/api/v1/docs` | Inline API documentation |
| POST | `/api/v1/*` | All v1 operations are POST. Mirrors `/api/*` minus SSE. |

### Example: full migration

```json
POST /api/migrate
{
  "sourceToken": "source-api-token",
  "destToken": "dest-api-token",
  "sourceAccountId": "source-account-id",
  "sourceZoneId": "zone-id",
  "destAccountId": "dest-account-id",
  "domainName": "optional-override.com",
  "dryRun": false,
  "workerSecrets": {
    "worker-name": { "SECRET_KEY": "secret-value" }
  },
  "customCertificates": [
    {
      "certificate": "-----BEGIN CERTIFICATE-----...",
      "privateKey": "-----BEGIN PRIVATE KEY-----..."
    }
  ],
  "acknowledgments": {
    "worker_secrets": true,
    "custom_certificate_keys": true
  }
}
```

### Example: export only

```json
POST /api/export
{
  "sourceToken": "your-api-token",
  "sourceAccountId": "account-id",
  "sourceZoneId": "zone-id"
}
```

## API Token Permissions

> The full, canonical permission matrix - including the exact endpoint each
> permission maps to - lives in
> [`docs/SECURITY.md` § API token permissions](docs/SECURITY.md#api-token-permissions).
> The lists below mirror it; if they ever disagree, SECURITY.md wins.

Twilight Zone migrates 30+ resource types, so the token needs more than the
DNS/zone basics. A token scoped only to the core permissions will hit
`forbidden` on R2, D1, KV, Turnstile, Email Routing, etc. - which surfaces as
failures mid-migration. Grant the full set below.

### Source Account Token (read-only)
- Zone:Read, Zone Settings:Read (Zone)
- DNS:Read (Zone)
- Page Rules:Read (Zone)
- Zone WAF:Read (Zone)
- Firewall Services:Read (Zone)
- Workers Routes:Read (Zone), Workers Scripts:Read (Account)
- Queues:Read (Account)
- Load Balancing: Monitors and Pools:Read (Account), Load Balancers:Read (Zone)
- SSL and Certificates:Read (Zone)
- Access: Apps and Policies:Read (Account)
- Email Routing Rules:Read (Zone)
- Waiting Room:Read (Zone)
- Zaraz:Read (Zone)
- Turnstile:Read (Account)

### Destination Account Token (read + write)
Same coverage as the source token, but with `Edit` instead of `Read`. Most notably:
- Zone:Edit (create the new zone)
- Zone Settings:Edit, DNS:Edit, Page Rules:Edit, Zone WAF:Edit, Firewall Services:Edit (Zone)
- Workers Scripts:Edit, Workers KV Storage:Edit, Workers R2 Storage:Edit, D1:Edit, Queues:Edit (Account)
- Load Balancing: Monitors and Pools:Edit (Account), Load Balancers:Edit (Zone)
- SSL and Certificates:Edit (Zone)
- Access: Apps and Policies:Edit (Account)
- Email Routing Rules:Edit (Zone)
- Turnstile:Edit (Account)

## Migration Report

After migration, a detailed `migration_report.md` is generated containing:

- **Summary** - Total/success/failed/skipped counts
- **New Nameservers** - Update these at your registrar
- **Section details** - Per-resource breakdown
- **Errors** - Failed items with suggestions
- **Manual actions** - Things that need user attention
- **Post-migration checklist** - Verification steps

## Data Collection (Beta)

Twilight Zone is in beta and still has bugs. To help find and fix them, a
**non-secret, non-PII** summary of each completed migration is logged
server-side (to a KV namespace, 90-day retention): resource names, per-resource
statuses, error messages (with email addresses and IP addresses removed), and
the source/destination zone and account identifiers.

- **Your credentials are never logged.** API tokens, API keys, worker secrets,
  and private keys exist only for the duration of each API call and are never
  stored, logged, or persisted server-side.
- The full zone configuration (DNS records, etc.) is **not** logged - only the
  migration outcome.
- The landing-page counter ("_N_ zones migrated") is an aggregate derived 
  from these logs.

See [docs/SECURITY.md § Migration run logging](docs/SECURITY.md) for the full
allowlist, redaction, and retention details.

## Migration Verification Checklist

A post-migration checklist for verifying the most common resource types
Twilight Zone (or any other migration approach) moves between Cloudflare
accounts. Work through each section after the migration completes - if you
used Twilight Zone, the **Results** step already verifies most of these
automatically (via GET-back), so treat this as the manual "trust but verify"
pass.

> **Not exhaustive.** Twilight Zone migrates 65+ feature areas; this checklist
> covers the high-traffic ones. Newer types it also migrates — Snippets, Cloud
> Connector, Managed Transforms, URL Normalization, Page Shield, API Shield,
> Leaked-Credential Checks, Content Upload Scan, Cache Reserve / Tiered Cache,
> Health Checks, Hyperdrive, Secrets Store, Vectorize, Workers Observability,
> Web3 hostnames, Secondary DNS, Email Sending Subdomains, Pages projects, AI
> Gateway, Origin CA certs, Custom Lists, Access sub-resources (groups, service
> tokens, IdPs, tags, bookmarks, custom pages), Authenticated Origin Pulls,
> Notification policies, Logpush jobs, and more — are not individually listed
> here. See the "What Gets Migrated" tables above and
> [`docs/COVERAGE.md`](docs/COVERAGE.md) for the authoritative per-endpoint
> matrix.

### Automated zone-settings verification (E2E)

The omnibus E2E test (`e01-everything`, run via
`node scripts/run-playwright-migrations.mjs --only 1`) does more than trust the
tool's own GET-back. After migrating a maximally-configured zone to a separate
account, it **independently** re-reads the destination's settings and
byte-compares them to the source, across all three shapes the Cloudflare API
uses to expose settings:

| Assertion | Covers | How |
|-----------|--------|-----|
| `assertZoneSettingsMatch` | Aggregate editable settings (`GET /zones/{id}/settings`) | source→dest value compare of every `editable`, non-read-only, non-blocked setting |
| `assertDedicatedSettingsMatch` | Object subsystems: DNS settings, Origin mTLS, Fraud Detection, Schema Validation | per-field compare of the exact fields the engine writes |
| `assertDedicatedScalarSettingsMatch` | Dedicated-endpoint scalar settings the aggregate omits (speed_brain, fonts, csam_scanner, origin_h2_max_streams, …) | per-id `GET /settings/<id>` compare, excluding non-editable |

All three are acknowledgment-aware (a difference the migration report flags as a
plan/entitlement gap is allowed, per Principle 2) and **fail on empty evidence**
(an assertion that read nothing cannot prove anything). Each was validated with
positive, negative (injected drift), and empty-evidence controls.

**The one-sentence CTO claim you can make:** *"Our omnibus end-to-end test
migrates a maximally-configured zone to a separate account, then — independently
of the migration engine — reads back every zone setting on the destination
(aggregate, dedicated subsystems, and dedicated-endpoint scalars) and
byte-compares it to the source, failing on any unacknowledged difference."*

**Completeness questions this lets you answer:**
- *All settings, or just seeded ones?* All `editable` settings present on the
  source, not just the test's seeds.
- *What's excluded, and is that defensible?* Read-only (`plan_level`,
  `cname_flattening`, …), blocked/deprecated, and no-op settings — server-side
  immutable or non-migratable by design.
- *Settings the aggregate API hides?* Covered by the dedicated-subsystem and
  dedicated-scalar assertions.
- *Plan downgrade (Enterprise→lower)?* Exercised by `e07-plan-downgrade`, which
  self-provisions an Enterprise source (idempotent `ensureSourceEnterprise`
  preRun) so enterprise-only features (gRPC, ciphers, SBFM, plan-gated settings
  like `origin_h2_max_streams`, …) land as **acknowledged**, not failed. Live
  `e07`: 7 enterprise features acknowledged, all settings verified, test green.

> **Fixed while building this (2026-06-07):** the migration report used to
> suppress the per-item table for any section with >50 items, so Zone Settings
> (57+ items) showed only summary counts — hiding per-setting status, including
> 🟡 acknowledged plan-gated rows like `origin_h2_max_streams`. This briefly
> looked like a migration gap; it was a report-rendering bug (verified before
> fixing). The cap is removed (table always renders, collapsed), so the report
> now shows every setting's status. See [docs/CHANGELOG.md](docs/CHANGELOG.md).

### 1. Zone Fundamentals
- [ ] Zone exists in destination account with the correct name
- [ ] Zone type matches (full / partial / CNAME setup)
- [ ] Zone status is acceptable (active / pending)
- [ ] Zone plan matches expectation (Free / Pro / Business / Enterprise)
- [ ] All plan-gated features available on destination plan
- [ ] Nameservers noted for registrar cutover
- [ ] DNSSEC status matches

### 2. DNS Records
- [ ] Record count roughly matches source
- [ ] Apex records (A/AAAA/CNAME at root) correct
- [ ] MX records and priorities match
- [ ] SPF/DKIM/DMARC TXT records match
- [ ] CAA records match
- [ ] SRV/HTTPS/SVCB records match
- [ ] Proxied vs DNS-only flags match
- [ ] TTL values match
- [ ] No unintended duplicates
- [ ] FQDN name rewriting correct
- [ ] System-managed records excluded

### 3. Zone Settings
- [ ] SSL/TLS mode matches
- [ ] Minimum TLS version matches
- [ ] TLS 1.3 / 0-RTT matches
- [ ] HSTS settings match
- [ ] Always Use HTTPS matches
- [ ] Automatic HTTPS Rewrites matches
- [ ] Compression (Brotli/gzip) matches
- [ ] Browser Cache TTL matches
- [ ] Caching Level matches
- [ ] Security Level matches
- [ ] Early Hints / HTTP2 / HTTP3 match
- [ ] WebSockets matches
- [ ] Custom cipher suites + ACM verified
- [ ] Enterprise settings (orange_to_orange, etc.) checked

### 4. Page Rules
- [ ] Page rule count matches
- [ ] Target URL patterns match
- [ ] Actions match
- [ ] Priority ordering matches
- [ ] Enabled/disabled state matches

### 5. Rulesets
- [ ] Custom ruleset count matches
- [ ] Managed rulesets excluded
- [ ] Each ruleset phase is correct
- [ ] Rules match (expressions, actions, parameters)
- [ ] Rules deduplicated correctly
- [ ] Phase entrypoint merging verified

### 6. Firewall Rules
- [ ] Rule count matches
- [ ] Filter expressions match
- [ ] Actions match
- [ ] Paused/active state matches
- [ ] Priority ordering matches

### 7. Rate Limits
- [ ] Rate limit count matches
- [ ] Threshold, period, and action match
- [ ] Match criteria match
- [ ] Disabled state matches

### 8. Workers
- [ ] All worker scripts exist
- [ ] ES Module / Service Worker format correct
- [ ] Script content matches (spot-check)
- [ ] Route count and patterns match
- [ ] KV bindings remapped correctly
- [ ] R2 bindings correct
- [ ] D1 bindings remapped correctly
- [ ] Service bindings present
- [ ] Queue bindings correct
- [ ] DO bindings correct
- [ ] Secret text bindings set
- [ ] Analytics Engine bindings handled
- [ ] Service binding dependency chain complete
- [ ] Runtime smoke tests pass

### 9. KV Namespaces
- [ ] All namespaces exist
- [ ] Titles match
- [ ] Key counts roughly match
- [ ] Spot-check keys/values
- [ ] Worker bindings point to NEW namespace IDs
- [ ] Expiration TTLs acknowledged as lost

### 10. R2 Buckets
- [ ] All buckets exist
- [ ] Names match
- [ ] Data copied (if S3 credentials provided)
- [ ] Worker R2 bindings correct
- [ ] CORS / lifecycle / managed-domain / custom-domain rules migrated (automatic)

### 11. D1 Databases
- [ ] All databases exist
- [ ] Names match
- [ ] Schema manually applied
- [ ] Data row counts match
- [ ] Worker D1 bindings point to NEW database IDs

### 12. Queues
- [ ] All queues exist
- [ ] Names match
- [ ] Consumer/producer bindings correct
- [ ] Publish/consume roundtrip works
- [ ] DLQ / retry config matches

### 13. Durable Objects
- [ ] DO namespaces exist
- [ ] Worker DO bindings correct
- [ ] DO data migrated (if applicable)
- [ ] Alarms/scheduled operations working

### 14. Load Balancers
- [ ] Monitor count, settings, and intervals match
- [ ] Pool count, origins, and monitor refs match
- [ ] LB count, hostnames, and pool refs match
- [ ] Steering policy and session affinity match
- [ ] Health checks passing

### 15. Spectrum Apps
- [ ] App count matches
- [ ] Protocol and DNS config match
- [ ] Origin DNS/port match

### 16. Custom SSL Certificates
- [ ] Certificate count matches
- [ ] Host coverage (SANs) matches
- [ ] Private keys provided and certs active
- [ ] Bundle method matches

### 17. Custom Hostnames
- [ ] Hostname count matches
- [ ] SSL method/type/status match
- [ ] Custom origin server settings match

### 18. Access (Zero Trust)
- [ ] Access app count and settings match
- [ ] Policy count, decisions, and rules match
- [ ] IdP references valid on destination
- [ ] End-to-end auth flow works

### 19. Email Routing
- [ ] Email routing enabled
- [ ] Rule count and matchers match
- [ ] Actions and priorities match
- [ ] Catch-all rule matches
- [ ] Destination addresses verified

### 20. Waiting Rooms
- [ ] Room count and names match
- [ ] Host/path match
- [ ] Limits match
- [ ] Custom page HTML present

### 21. Turnstile
- [ ] Widget count and names match
- [ ] Domains and mode match
- [ ] NEW sitekeys updated in frontend code
- [ ] Challenge flow verified

### 22. Zaraz
- [ ] Config present on destination
- [ ] Tools/triggers/variables match

### 23. Argo Smart Routing
- [ ] Value matches (on/off)
- [ ] Entitlement exists on destination

### 24. Argo Tiered Caching
- [ ] Value matches

### 25. Bot Management
- [ ] Config matches source
- [ ] All fields checked
- [ ] Plan availability confirmed

### 26. Worker Custom Domains
- [ ] Manually configured on destination

### 27. Never-Migrate Items
- [ ] Billing/subscriptions handled
- [ ] API tokens created separately
- [ ] Account-level (org-wide) settings configured
- [ ] Analytics / log *retention* windows and buffered Logpush batches (the Logpush **jobs** themselves DO migrate; only buffered/historical data is lost)
- [ ] Tunnel (cloudflared) configurations set up
- [ ] Dashboard/SSO IdPs for account login (note: **Access** IdPs DO migrate — see §18 — with re-supplied secrets)

> Note: **Notification policies**, **Logpush jobs**, and **Access IdPs** are NOT
> never-migrate items — Twilight Zone migrates them. Verify them where their
> data lives (notification policies + webhooks on the dest account; Logpush jobs
> per zone; Access IdPs in §18).

### 28. Conflict Strategy
- [ ] Skip/Overwrite behavior verified for all resource types

### 29. Dependency Chain
- [ ] No resources failed due to missing dependencies

### 30. ID Remapping
- [ ] KV namespace IDs remapped
- [ ] D1 database IDs remapped
- [ ] LB monitor IDs remapped
- [ ] LB pool IDs remapped
- [ ] Access app IDs remapped

### 31. Observability
- [ ] Logging configured
- [ ] Analytics collecting
- [ ] Alert policies configured
- [ ] Audit log reviewed
- [ ] Rollback plan documented
- [ ] Monitoring dashboards ready

### 32. Final Cutover
- [ ] Origin allowlists updated
- [ ] Origin certs / mTLS configured
- [ ] Cache behavior verified
- [ ] Redirects/rewrites no loops
- [ ] API endpoints working
- [ ] WebSocket/gRPC/streaming verified
- [ ] Error pages render correctly
- [ ] Rate limiting / bot management not false-positive
- [ ] Update nameservers at your domain registrar
- [ ] Wait for DNS propagation (`dig NS yourdomain.com`)
- [ ] Delete source zone only after full verification

## Limitations

1. **Nameserver change required** - Zone must be re-verified with new nameservers
2. **Worker secrets** - Cannot be read from source; must be provided by user
3. **Private keys** - Cannot be read from source; must be provided by user
4. **Some settings are plan-dependent** - Features may not transfer if plans differ
5. **Durable Object state** - The DO namespace (binding) is always created on the destination; stored object **state** is copied only when you configure object names + source/destination worker URLs in the Durable Objects group of the scope step. Without that configuration the namespace starts empty.
6. **KV namespaces** - Created automatically, and key/value data is copied when you select the namespace for migration. Only per-key *absolute expiration TTLs* reset on the destination.
7. **R2 object data** - Buckets (plus CORS, lifecycle, and managed/custom domains) migrate automatically; bulk **object data** copies only when you supply S3 API credentials for both accounts.

## Architecture

```
app/                 # React SPA (Vite) - wizard UI
src/
├── worker/index.ts  # Worker entry point + API routing
├── worker/api-v1.ts # Programmatic /api/v1/* JSON API
├── types.ts         # TypeScript interfaces + IMPOSSIBLE_TO_MIGRATE
├── api.ts           # Cloudflare API client functions
├── migrate.ts       # Migration orchestration entry (re-exports migrate/)
└── migrate/         # Export + migrate engine, split by concern
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system design.

## Potential future features

### "Sign in with Cloudflare" (OAuth)

Today, credentials are supplied as an API token or API key + email (Step 1).
A nicer flow would be a **"Sign in with Cloudflare" button** that runs the
OAuth 2.0 authorization-code + PKCE flow - the same one `wrangler login`
uses (`https://dash.cloudflare.com/oauth2/auth` → `/oauth2/token`). The
returned access token is a normal `Bearer` token against
`api.cloudflare.com/client/v4`, so it would drop into the existing auth path.
This would let users grant scoped access in one consent click instead of
hand-building a token (the dashboard token form cannot be deep-linked with
pre-selected permissions - permission selection happens only through a
CSRF-protected authenticated POST).

**Shippable in this public repo:** yes. A browser app must use a public
PKCE client, which has **no client secret** - the `client_id` is public by
design (wrangler's is hardcoded in open source). Nothing secret would live
in the repo.

**Blocked on two things before it can be built:**

1. **A provisioned OAuth client.** Cloudflare does not offer public OAuth
   app registration. This needs an internal request to the dash/identity
   team for a dedicated `client_id` with redirect URI
   `https://your-twilight-zone.example.com/oauth/callback` (request a
   **public/PKCE** client, not a confidential one).
2. **Scope coverage confirmation.** The OAuth scope catalog is much coarser
   than the API-token permission-group system and, as visible today, appears
   Workers-centric (no generic zone-settings/DNS/ruleset/LB/etc. write
   scopes). It is unverified whether the OAuth server can express the full
   set of zone-config writes a migration needs. If it cannot, OAuth would
   only cover part of the migration surface and remain a partial solution.

## License

Apache-2.0
