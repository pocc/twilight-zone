# Scripts & npm aliases

Everything in [`scripts/`](../scripts) is a Node ESM (`.mjs`) tool. Most are
operational/test tooling rather than part of the deployed Worker. Scripts that
hit the Cloudflare API read credentials from the environment or `.env.test` (see
[TESTING.md](TESTING.md)); generator scripts are pure static analysis with no
network calls.

## npm aliases

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

## E2E / migration tooling

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

## Coverage / generator tooling

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

Supporting data files (not scripts): `coverage-overrides.json`,
`coverage-ratchet.json`, `feature-taxonomy.json`.
