# Spec-Drift Monitor

How Twilight Zone keeps its migration coverage from silently falling behind
Cloudflare's API — and what to do when it alerts you.

> **TL;DR** — An hourly Worker cron diffs the live Cloudflare OpenAPI spec
> against a committed baseline. When Cloudflare ships a **new write endpoint**, it raises
> an in-app banner and pings Google Chat. A human then triages the endpoint
> (implement it, mark it out-of-scope, or — for a new zone setting — add it to
> the settings catalog), regenerates the baseline, and lets the CI coverage
> ratchet enforce zero in-scope gaps.

## Why this exists

The "What Gets Migrated" tables in the [README](../README.md) are only
trustworthy if they stay current. Two distinct things can go stale:

1. **New zone settings.** Most settings are migrated *dynamically* — the engine
   PATCHes back whatever the source zone's aggregate
   `GET /zones/{id}/settings` returns, so a setting Cloudflare adds to that
   response needs no code change. But some settings live **only** behind a
   *dedicated* endpoint (`PATCH /zones/{id}/settings/<id>`) and are **not**
   returned by the aggregate GET (e.g. `csam_scanner_third_party`, `speed_brain`,
   `fonts`, `rum`). Those must be listed in the `ZONE_SETTINGS` catalog
   ([`src/fuzz.ts`](../src/fuzz.ts)) or they are silently dropped.
2. **New endpoints / features.** A whole new resource type or write operation
   could appear that the tool doesn't implement.

The monitor catches both, because a new dedicated zone-setting endpoint and a
brand-new feature endpoint both show up as a **new write path** in the OpenAPI
spec.

## How it works

Source: [`src/worker/spec-monitor.ts`](../src/worker/spec-monitor.ts), scheduled
by the `crons` trigger in [`wrangler.toml`](../wrangler.toml) (hourly, on the
hour) via the `scheduled()` handler in [`src/worker/index.ts`](../src/worker/index.ts).

1. **Cheap ETag probe.** The cron issues a `HEAD` against the raw Cloudflare
   OpenAPI file. If the ETag is unchanged since the last successful check, it
   stops — no download, no parse. This is what makes hourly affordable: the spec
   changes ~15–20 days/month, so in the vast majority of hours the HEAD is the
   only work done. (Comparing the *write-endpoint set* rather than the file hash
   also keeps a naive alarm from firing on the many description/example-only
   commits that add no endpoints.)
2. **Diff the write-endpoint set.** If the ETag changed, it fetches (~10 MB) and
   parses only `.paths`, builds the set of write-endpoint keys (`METHOD path`
   for POST/PUT/PATCH/DELETE), and diffs that set against the committed baseline
   [`src/openapi-baseline.generated.json`](../src/openapi-baseline.generated.json).
3. **Alert only on genuinely new endpoints.** If — and only if — the live spec
   has write endpoints absent from the baseline, it:
   - raises the in-app banner (served via the public, unauthenticated
     `GET /api/spec-status`), and
   - posts to the Google Chat webhook in the `NEW_API_ENDPOINT_GCHAT_WEBHOOK`
     secret.
   The Chat ping is de-duped on the **set** of new endpoints, so a run of
   unrelated description-only edits (same new-endpoint set) doesn't re-spam; a
   genuinely new endpoint does.

The whole check is wrapped so a failure (GitHub 5xx, network blip, future spec
growth) degrades to an `error` state with the prior `lastSuccessfulCheck`
preserved, and never throws into the scheduled handler. The banner surfaces
staleness, so a silently-dead cron is itself visible.

### Status endpoint

`GET /api/spec-status` returns the last stored `SpecStatus` (read-only; the cron
is what performs the check and writes the KV record under `spec-monitor:status`).
Useful fields:

| Field | Meaning |
|---|---|
| `ok` | Last check completed without error |
| `lastSuccessfulCheck` | When the last successful check ran — the "last checked" date posted in the banner |
| `lastFullCoverageCheck` | Most recent zero-drift check (streak END) — the "last 100% coverage on {date}" the banner shows while drifting |
| `fullCoverageSince` | START of the current zero-drift streak (set on a drift→clean transition, preserved while clean, nulled on drift) — drives the header line's "100% coverage since {date}" |
| `liveCount` | Total write endpoints in the live spec — the "Y total endpoints" denominator |
| `manifestGeneratedAt` | When our committed baseline was generated ("code last updated") |
| `newEndpoints` | Live write endpoints absent from the baseline — the alarm payload |
| `drift` | `newEndpoints.length > 0` |
| `specCommitDate` | When the spec last changed upstream |

The status surfaces in the UI in two complementary places:

- **Header line** (`app/components/CoverageStatusLine.tsx`) — an always-visible
  line under the header links. It falls back to the **static, build-time**
  coverage % (from `coverageSummary`) so the number is never absent, even before
  the monitor has ever run on a deployment. Once the live monitor has reported it
  enriches the line: green *"{pct}%: … 100% coverage since {date}, re-verified
  hourly"* (date = `fullCoverageSince`, the streak start), amber *"Divergence:
  coverage drift of X of Y …"* when drift appears, and amber *"last verified
  {date} — hourly check overdue"* if `lastSuccessfulCheck` is stale (no run in
  >6h), so a silently-dead cron is visible. The header `Coverage` link itself is
  just an entry to the per-category modal.
- **Drift banner** (`app/components/SpecDriftBanner.tsx`) — a loud, dismissible
  red alert that appears **only on drift**, with the expandable list of new
  `METHOD path`s and a link to the live
  [Cloudflare OpenAPI spec](https://github.com/cloudflare/api-schemas/blob/main/openapi.json).
  It stays silent in the healthy case (the header line covers that), so 100%
  isn't shown twice. It also surfaces a first-run monitor error.

### What it does NOT do

The monitor **alerts**; it does not auto-remediate and it is not the CI gate.
- It will not edit `ZONE_SETTINGS`, implement an endpoint, or add a coverage
  override for you.
- The blocking CI gate — `npm run coverage:check`, the zero-gap ratchet in
  [`scripts/coverage-ratchet.json`](../scripts/coverage-ratchet.json) — runs
  against the **committed** baseline, so it won't see live drift until you
  regenerate the baseline (the step below).

## Runbook: you got a "new API endpoint detected" ping

The Chat message lists one or more `METHOD /path` endpoints. For each one:

### 1. Triage: is it in scope?

Apply the **"Would I Lose Functionality?" test** (README / AGENTS Principle 7):
*after migrating, would the user notice this missing on the destination?*

- **No** → out of scope. Add an entry to
  [`scripts/coverage-overrides.json`](../scripts/coverage-overrides.json) with
  the right reason code (`admin_only`, `data_plane`, `imperative_action`,
  `redundant_with_put`, `out_of_scope_subfeature`, …). See
  [docs/COVERAGE.md](COVERAGE.md) for the reason-code catalog.
- **Yes** → in scope. Continue.

### 2. Implement (in-scope endpoints)

- **If it's a new zone setting** (`PATCH /zones/{id}/settings/<id>`): add it to
  the `ZONE_SETTINGS` catalog in [`src/fuzz.ts`](../src/fuzz.ts) with its `id`,
  `type`, and `testValues`. This single edit wires it into export-backfill,
  MaxConfig, the independent E2E settings assertion, and the omnibus test
  (`docs/test_configs/e01-everything.json`). Add the new id to e01's
  `zone_settings` too (the `maxconfig-completeness` unit test will tell you to).
- **If it's a new resource/operation**: implement the client call in
  [`src/api.ts`](../src/api.ts) and wire it into the migrate engine
  ([`src/migrate/`](../src/migrate/)) so it's reachable from a migration.
- **If it physically cannot move** (write-only key material, account-tied,
  registrar action): add an `IMPOSSIBLE_TO_MIGRATE` entry in
  [`src/types.ts`](../src/types.ts) instead. Do **not** stash unimplemented
  in-scope features there (Principle 7 anti-pattern).

### 3. Regenerate the baseline + coverage inputs

```bash
npm run generate:openapi-manifest   # refreshes the baseline the monitor diffs against
npm run coverage:all                # regenerate coverage inputs + COVERAGE.md
```

Regenerating the baseline is what clears the banner/ping on the next cron run
(the new endpoint is now "known").

### 4. Verify the gate is green

```bash
npm run coverage:check              # CI ratchet: 0 in-scope gaps
npm test                            # includes the maxconfig-completeness guard test
```

If `coverage:check` fails, you either implemented the endpoint, added an
override, or (with reviewer approval) must update the ratchet. The ratchet only
ever decreases — see the `_comment` in `scripts/coverage-ratchet.json`.

### 5. Ship

Commit and merge. Pushing to `main` triggers the Cloudflare Workers build
(`npx wrangler deploy`), which deploys the updated baseline along with the
Worker, so the next hourly run diffs against your new baseline.

## Operational notes

- **Secrets/bindings required for alerts:** the `RUN_LOG` KV binding (stores
  `spec-monitor:status`) and the `NEW_API_ENDPOINT_GCHAT_WEBHOOK` secret. Both
  are optional for local `npm run dev`; without them the monitor still runs but
  can't persist status or post to Chat.
- **A dead cron is visible.** Because the header line reports
  `lastSuccessfulCheck` and flags it stale after >6h with no successful run, a
  monitor that has stopped running shows as stale rather than silently passing.
