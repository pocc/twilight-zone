# Architecture

System design, data flow, dependency resolution, error handling, validation,
and UI flows for Twilight Zone.

## Mission

Enable Cloudflare zone migrations between accounts with as much configuration
preservation as the public API allows, no surprise failures, and a transparent
audit trail of what did and did not move.

### Core principles

| Principle | How |
|-----------|-----|
| **No surprise failures** | Every Step 4 result must be Verified, Acknowledged, Mismatched, or Failed - and Failed should be zero in a healthy run. Unmigratable resources are acknowledged in Step 2 before they fail. |
| **Speed** | Parallel API calls, SSE streaming feedback, minimal round-trips, export-once caching. |
| **Usability** | Zero install (open a URL), persistent inputs via localStorage, 4-step wizard, dry-run preview, code export. |
| **Clarity** | Live log viewer, color-coded results, detailed markdown report, transparent limitations. |

### Non-goals

- Source zone deletion (users delete manually after verification).
- DNS propagation timing (tool migrates config, not traffic cutover).
- Stateful data migration of KV data, DO data, R2 objects (out of scope by
  default; some flows offer best-effort copy).
- Atomic cross-account zone moves - Cloudflare does not expose this via public
  API today.

---

## System overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   React SPA (Vite + Tailwind v4)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Step Wizard │  │  Log Viewer  │  │  Results Dashboard   │  │
│  │  (4 steps)   │  │  (SSE stream)│  │  (Report renderer)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│              localStorage persistence (config + UI state)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ fetch() + SSE → /api/*
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Cloudflare Worker (edge)                      │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ worker/index.ts  │  │  migrate.ts  │  │      api.ts      │  │
│  │ (19 SSE routes,  │──│ (orchestrate)│──│ (CF API client)  │  │
│  │  /api/v1/* JSON) │  │              │  │                  │  │
│  └──────────────────┘  └──────────────┘  └──────────────────┘  │
│             Static asset serving (SPA mode, wrangler.toml)      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ REST API calls
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare API (v4)                          │
│  Source Account ◄──────────────────────► Destination Account    │
└─────────────────────────────────────────────────────────────────┘
```

For the full file structure see [AGENTS.md § 3](../AGENTS.md#3-project-structure).

---

## Data flow

### Export phase

```
1. User enters source credentials
2. POST /api/export/stream
3. Worker streams logs via SSE as it fetches:
   ├── Zone info
   ├── Phase 1 (19 parallel): zone-level + account-level + Zaraz
   │   ├── Zone-level (13): DNS, Settings, Page Rules, Rulesets, Routes, …
   │   ├── Account-level (5): Workers, Pools, Monitors, Access, Turnstile
   │   └── Zaraz config
   └── Phase 2 (all parallel): Ruleset details + Worker scripts/bindings +
                                Access policies
4. Complete export JSON sent as the final SSE message
```

### Migration phase

```
1. User reviews scope (Step 2), acknowledges unmigratables
2. User provides secrets / certs in Step 3
3. POST /api/migrate/stream
4. Worker creates the destination zone, then streams logs:
   ├── Create destination zone + apply plan
   ├── Batch 1 (parallel): DNS, Settings, Page Rules, Rulesets
   ├── Sequential chain: Monitors → Pools → Load Balancers
   ├── Sequential chain: Access Apps → Access Policies
   ├── Storage (sequential): KV → R2 → D1 → Queues  (BEFORE Workers)
   ├── Auto-create missing storage dependencies for Worker bindings
   ├── Batch 2 (parallel): Workers, Routes, Spectrum, Certs, Hostnames,
   │                        Firewall, Rate Limits
   ├── Batch 3 (parallel): Email Routing, Waiting Rooms
   ├── Batch 4: Turnstile widgets
   └── Batch 5 (entitlement-checked): Argo, Tiered Caching, Bot Management
 5. Migration report sent as the final SSE message
 6. PII-stripped run-log summary written to the RUN_LOG KV namespace
    (best-effort, ctx.waitUntil; non-dry-run only - see SECURITY.md
    § "Migration run logging")
```

### Parallelization strategy

| Phase | Strategy | Reason |
|-------|----------|--------|
| Export Phase 1 | 19 parallel | All independent resource lists |
| Export Phase 2 | All parallel | Per-ruleset details, per-worker scripts, per-app policies |
| Migrate Batch 1 | 4 parallel | DNS, Settings, Page Rules, Rulesets - independent |
| Monitors → Pools → LBs | Sequential | ID mapping required at each step |
| Access Apps → Policies | Sequential | App ID required to create policies |
| Migrate Batch 2 | 7 parallel | Independent zone-level resources |
| Items within section | All parallel | `Promise.allSettled` |

---

## Dependency resolution

Workers have bindings that reference other resources by ID or name. When
migrating to a new account those IDs change; some bindings reference resources
that may not be in the selected export set. Twilight Zone uses a three-layer
defense.

### Binding identifier types

| Binding type | References | Identifier | ID changes on dest? |
|--------------|-----------|------------|---------------------|
| `kv_namespace` | KV Namespace | `namespace_id` (UUID) | Yes |
| `r2_bucket` | R2 Bucket | `bucket_name` (string) | No (name-based) |
| `d1` | D1 Database | `database_id` (UUID) | Yes |
| `queue` | Queue | `queue_name` (string) | No (name-based) |
| `durable_object_namespace` | DO Namespace | `class_name`, `namespace_id` | Strip `namespace_id`, deploy with DO migration metadata |
| `service` | Another Worker | `service` (script name) | No (name-based) |
| `analytics_engine` | AE Dataset | `dataset` (string) | No |

Newer binding types (Hyperdrive, Vectorize, mTLS, Dispatch Namespace, Secrets
Store, VPC Service, …) have their own strategies - see
[WORKER_BINDINGS.md](WORKER_BINDINGS.md) for the full per-binding table.

### Layer 1: migration ordering

Resources are migrated in strict dependency order. Storage (KV/R2/D1/Queues)
always completes before Workers; LB stack and Access stack run as sequential
chains; everything else parallelizes.

### Layer 2: ID mapping

UUID-based resources are tracked in maps so worker bindings can be rewritten:

| Resource | Map | Used by |
|----------|-----|---------|
| KV Namespace | `kvIdMap` | Worker `kv_namespace` bindings |
| D1 Database | `d1IdMap` | Worker `d1` bindings |
| Health Monitor | (inline) | LB Pool `monitor` field |
| LB Pool | (inline) | Load Balancer `default_pools[]`, `fallback_pool` |
| Access App | (inline) | Access Policy parent endpoint |

`updateBindingsWithNewIds()` in `src/migrate/workers-deploy.ts` (and the
batch variant in `src/migrate/batch2.ts`) rewrites all worker bindings
just before upload.

### Layer 3: auto-creation of missing dependencies

Even with proper ordering, a worker may reference resources that weren't in
the selected export set (deselected in Step 2 or not detected by the
zone-relatedness filter). Before the worker upload phase, the migration scans
all worker bindings and auto-creates anything missing:

```
1. Collect selected storage identifiers (R2 names, KV/D1 IDs, Queue names).
2. For each worker, for each binding: if the referenced resource is missing
   AND not yet in the ID map, add to the missing set.
3. Auto-create each missing resource; store new IDs in kvIdMap / d1IdMap.
4. Each creation handles "already exists" gracefully.
5. Failures log a warning but don't block the migration.
```

The Step 2 scope view also surfaces a warning card for unselected dependencies
so the user can opt in explicitly before auto-creation runs.

### Full creation order

Account resources first (so Workers can bind to them), then zone resources.
When `skipAccountResources: true`, account resources are skipped *except*
Monitors/Pools/Workers, which the LB/Routes chains still need.

| Order | Resource | Depends on | Produces |
|-------|----------|-----------|----------|
| 1 | Zone creation | - | `destZoneId` |
| 1b | Zone plan assignment | Zone | |
| 1c | Capability check | Zone | `AccountCapabilities` |
| 1d | ACM probe | Zone | Whether ciphers can be written |
| **Parallel batch 1** | | | |
| 2a | DNS Records | Zone | FQDN conversion source→dest |
| 2b | Zone Settings | Zone + ACM | Read-only / blocked filtered |
| 2c | Page Rules | Zone | |
| 2d | Rulesets | Zone | Managed rulesets filtered |
| **LB chain (sequential)** | | | |
| 3 | Health Monitors | - | `monitorIdMap` |
| 4 | LB Pools | Monitors | `poolIdMap` |
| 5 | Load Balancers | Pools + Zone | rewrites `default_pools[]` |
| **Access chain (sequential)** | | | |
| 6 | Access Apps | - | `accessAppIdMap` |
| 7 | Access Policies | Access Apps | uses parent app ID |
| **Storage before workers** | | | |
| 8 | KV Namespaces + data | - | `kvIdMap` |
| 9 | R2 Buckets + data | - | (name-based) |
| 10 | D1 Databases (shell) | - | `d1IdMap` |
| 11 | Queues | - | (name-based) |
| 12 | Auto-create missing deps | - | Fills binding gaps |
| **Parallel batch 2** | | | |
| 13a | Workers | KV, R2, D1, Queues | bindings rewritten |
| 13b | Worker Routes | Workers + Zone | pattern source→dest |
| 13c | Spectrum Apps | Zone (Enterprise) | |
| 13d | Custom Certificates | Zone + user keys | |
| 13e | Custom Hostnames | Zone | |
| 13f | Firewall Rules | Zone | skipped if rulesets cover same phase |
| 13g | Rate Limits | Zone | |
| **Parallel batch 3** | | | |
| 14a | Email Routing Rules | Zone | auto-enables routing |
| 14b | Waiting Rooms | Zone | |
| **Batch 4** | | | |
| 15 | Turnstile Widgets | - | new sitekeys |
| **Batch 5 (entitlement-gated)** | | | |
| 16 | Argo Smart Routing | Zone + entitlement | GET probe before PATCH |
| 17 | Tiered Caching | Zone + entitlement | GET probe before PATCH |
| 18 | Bot Management | Zone + entitlement | GET probe before PUT |
| **Post-workers** | | | |
| 19 | Durable Objects | Workers deployed | auto-created at deploy |
| 20 | Zaraz Config | Zone | single PUT |
| **Validation** | | | |
| 21 | Post-migration checks | All | NS comparison, resource counts |

### Capability gates

When the destination account lacks a capability, all gated resources are
acknowledged (per **No Surprise Failures**) rather than attempted-and-failed:

| Capability | Gated resources | Detection |
|-----------|----------------|-----------|
| Zero Trust | Access Apps, Access Policies | `GET /accounts/{id}/access/apps` |
| R2 | R2 Buckets | `GET /accounts/{id}/r2/buckets` |
| Load Balancing | Monitors, Pools, LBs | Monitor creation probe |
| Workers | Workers, Worker Routes | `GET /accounts/{id}/workers/scripts` |
| Spectrum | Spectrum Apps | Enterprise plan check |
| Analytics Engine | Workers with AE bindings | `POST /accounts/{id}/analytics_engine/sql` |
| ACM | Custom cipher suites setting | Write probe on `ciphers: []` |
| Argo / Tiered Caching / Bot Management | Per-zone settings | GET returns null if unentitled |

The Step 2 UI shows disabled groups with a red banner explaining the gap and a
"recheck capabilities" control so the user can have their account team enable
the entitlement mid-flight.

### Conflict resolution

Per-resource behavior when something already exists on the destination:

| Strategy | Behavior |
|----------|----------|
| `skip` (default) | Preserve dest resource, record as skipped, map ID if needed |
| `overwrite` | Delete → recreate, or PUT to update |

Selected per-migration in Step 2, stored as `config.conflictStrategy`. Specific
overwrite implementations:

| Resource | Overwrite method |
|----------|-----------------|
| DNS Records | PUT to update existing match, or delete+create |
| Workers | Delete script → re-upload with bindings → re-set secrets |
| Worker Routes | Delete by pattern → recreate |
| KV / D1 | Map to existing ID, copy data into it |
| R2 / Queues | Use existing |
| Turnstile | Delete by sitekey → recreate (new sitekey) |

### Resource dependency graph

```
                           ┌─────────────┐
                           │    Zone      │
                           │  Creation    │
                           └──────┬───────┘
                                  │
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
     ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐
     │ DNS Records │      │Zone Settings│      │  Page Rules  │
     │  Rulesets   │      │  (+ ACM)    │      │  Rate Limits │
     └─────────────┘      └─────────────┘      └──────────────┘

  ┌──────────────┐     ┌──────────────┐
  │   Monitors   │     │  Access Apps │
  └──────┬───────┘     └──────┬───────┘
         │                    │
  ┌──────▼───────┐     ┌──────▼───────┐
  │   LB Pools   │     │Access Polices│
  └──────┬───────┘     └──────────────┘
         │
  ┌──────▼───────┐
  │Load Balancers│←── Zone
  └──────────────┘

  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │KV Namespaces │  │  R2 Buckets  │  │ D1 Databases │  │    Queues    │
  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
         │                 │                 │                 │
         └────────┬────────┴────────┬────────┘                 │
                  │                 │                          │
           ┌──────▼─────────────────▼──────────────────────────▼──┐
           │                    Workers                            │
           └──────┬────────────────┬───────────────────────────────┘
                  │                │
           ┌──────▼──────┐  ┌─────▼──────────┐
           │Worker Routes│  │Durable Objects │
           │(zone-level) │  │ (auto-created) │
           └─────────────┘  └────────────────┘
```

### Known limitations

1. **Service binding ordering.** Workers referencing other workers via
   `service` bindings upload in the same parallel batch. There is no
   topological sort - A may fail if B hasn't finished. `planWorkerDeploymentLevels`
   (Tarjan SCC) in `src/migrate/workers.ts` does compute deploy levels and is
   invoked by `migrateZone()`; cyclic deps are tracked separately.
2. **D1 data.** Only empty shells are created. Schema/data migrate manually
   via `wrangler d1 export` / `wrangler d1 execute`.
3. **Durable Object data.** Namespaces auto-create; state requires
   application-level migration (see `src/do-migrate.ts` for a reference
   "sandwich" pattern).
4. **Custom certificate private keys.** Cannot be read from the source API;
   user must provide cert+key PEM pairs in Step 3.
5. **Turnstile sitekeys.** New sitekeys are generated on the destination;
   frontend code must be updated.
6. **IdP configs.** Access apps recreate but Identity Provider configurations
   (Okta, Azure AD, OAuth client secrets, SAML certificates) do not - they
   re-onboard on the destination.

---

## Worker zone discovery

Workers are account-level resources, not zone-level - but only a subset of
workers are tied to any given zone. Twilight Zone filters workers per zone to
keep the UI useful and the migration scoped.

### Zone-worker relationships

A worker can be tied to a zone via:

1. **Worker Routes (zone-level)** - `GET /zones/{zone_id}/workers/routes`
   maps URL patterns to worker scripts; naturally zone-scoped.
2. **Custom Domains (account-level with `zone_id`)** -
   `GET /accounts/{account_id}/workers/domains` returns each custom domain's
   `zone_id`; filter to the source zone.
3. **Service bindings (indirect)** - if Worker A is zone-tied and has a
   service binding to Worker B, Worker B is included.

### Discovery algorithm

```
1. Fetch all Worker Routes for the zone
2. Fetch all Worker Custom Domains for the account; filter by zone_id
3. Combine → "directly zone-tied" workers
4. Fetch scripts + bindings for those workers
5. Resolve service bindings (one level deep)
6. Scan worker code for URL references:
   - Preview URLs: https://{worker-name}.*.workers.dev
   - Custom domain hostnames in the account
7. Final list = zone-tied + service bindings + URL references
```

### Storage zone-relatedness

Account-level storage is filtered via zone-related worker bindings:

| Resource | Zone-related if… |
|----------|------------------|
| KV Namespaces | Bound to a zone-related worker |
| R2 Buckets | Bound to a zone-related worker |
| D1 Databases | Bound to a zone-related worker |
| Queues | Bound to a zone-related worker |
| Load Balancers | Hostname matches zone or referenced in DNS |
| Pools / Monitors | Associated with zone-related LB |
| Access Apps | Domain ends with zone name |
| Turnstile Widgets | Domains list includes zone domain |
| Durable Objects | Shown unfiltered (users know which DOs belong) |

### Edge cases

1. **Orphaned workers** (no routes, no custom domains) are not migrated by
   default - intentional.
2. **Cross-zone service bindings** - a zone-tied worker referencing a
   different-zone worker pulls the referenced worker in.
3. **Workers with multiple zone ties** - included if tied to the migrating
   zone.
4. **Storage without zone workers** - if no zone workers exist, storage
   isn't surfaced; the user migrates manually.

---

## Error handling

Every migration error is classified into one of four categories by
`analyzeError()` in `src/migrate.ts`. This determines how the error is grouped
in the report and what guidance the user sees.

| Category | Meaning | User action |
|----------|---------|-------------|
| `billing` | Feature requires a paid subscription, add-on, or plan upgrade | Enable in Dashboard or contact Support |
| `manual_setup` | Feature must be enabled in Dashboard before migration | Complete setup in Cloudflare Dashboard |
| `permission` | API token lacks required permissions | Create new token; see [SECURITY.md](SECURITY.md) |
| `api` | General API error (rate limit, validation, transient) | Fix input, wait+retry, or accept partial migration |

### Common error patterns

#### Manual setup (`manual_setup`)

| Pattern | Resource | Fix |
|---------|----------|-----|
| `access.api.error.not_enabled` / `access is not enabled` | Access | Dashboard → Zero Trust → Get Started |
| `queues` + `enable` (code 11002) | Workers | Dashboard → Workers → Queues → Enable |
| `not enabled` / `enable email` | Email Routing | Dashboard → Email → Email Routing → Enable |
| `no valid actions` / `destination` | Email Routing | Verify destination address |

#### Billing / entitlement (`billing`)

| Pattern | Resource | Fix |
|---------|----------|-----|
| `enable r2 through` | R2 | Dashboard → R2 → Get Started |
| `1002` / `access failed` / `internal error` | LB stack | Dashboard → Traffic → Load Balancing → Enable ($5/mo) |
| `plan` / `not available` / `upgrade` | Any | Upgrade dest plan |
| `interval` + `not in range` | Health Monitors | Upgrade plan or adjust interval |
| Any Spectrum error | Spectrum | Requires Enterprise |

#### Permission (`permission`)

| Pattern | Fix |
|---------|-----|
| `permission` / `forbidden` / `unauthorized` (code 10000) | See [SECURITY.md § API permissions](SECURITY.md#api-token-permissions) |

#### API / validation (`api`)

| Pattern | Code | Resource | Fix |
|---------|------|----------|-----|
| `rate limit` | 429 | Any | Automatic retry with backoff; if persistent, wait and re-run |
| `secret` | - | Workers | Provide values in Step 3 |
| `kv namespace` + `not found` | 10041 | Workers | Select the KV namespace; auto-creation handles |
| `durable object namespace` + `not found` | 10061 | Workers | DO classes must be defined in the worker |
| `syntaxerror` / `referenceerror` | 10021 | Workers | Format mismatch (ESM vs Service Worker) |
| `ai` + `es module` | 100329 | Workers | AI binding requires ES module syntax |
| `r2 bucket` + `not found` | 10085 | Workers | Auto-creation handles |
| `no valid matchers` | - | Email Routing | Matchers auto-sanitized |

### Retry with backoff

Rate limit and transient errors automatically retry (`src/api.ts`):

| Retry | Delay | Condition |
|-------|-------|-----------|
| 1 | 1s | HTTP 429 or 5xx |
| 2 | 2s | HTTP 429 or 5xx |
| 3 | 4s | HTTP 429 or 5xx |
| Fail | - | After 3 retries |

### Per-item error handling

Every resource migrates inside a `try/catch`. Failures log + add to the
report, but never stop the migration. The pattern:

```
migrateItems(name, items, callback, …)
  → Promise.allSettled over all items
  → Each failure: log + add to report.errors
  → Continue with next item
```

"Already exists" errors are *not* failures; they're handled per
`conflictStrategy` (skip vs overwrite).

### Settings filtering

Three layers prevent avoidable errors on `PATCH /zones/{id}/settings/{id}`:

1. **`READ_ONLY_SETTINGS`** (`src/migrate/constants.ts`) - settings where `editable=true`
   but value is server-managed: `advanced_ddos`, `plan_level`, `ssl_status`,
   `custom_certificate_quota`, `page_rule_quota`, `cname_flattening`,
   `orange_to_orange`.
2. **`BLOCKED_SETTINGS`** (`src/migrate/constants.ts`) - deprecated or internal:
   `filter_logs_to_cloudflare`, `log_to_cloudflare`, `visitor_ip`, `waf`.
3. **`isNoOpSetting()`** - values that mean "not configured" and would fail
   if written: e.g. `ciphers: []`.

Plus: **managed rulesets** (kind=`managed`, name starts with `Cloudflare `,
`DDoS `, or contains `Managed`) are skipped - Cloudflare auto-enables them.

---

## Validation & pre-checks

```
Step 1 (Setup)
  ├── Token validation         → /api/validate-token
  ├── Account/zone loading     → /api/accounts, /api/zones
  ├── Migration blockers       → /api/check-blockers
  └── Plan/license detection   → /api/available-plans

Step 2 (Scope)
  ├── Capability checks        → /api/check-capabilities
  ├── Validation warnings      → generateValidationWarnings()
  ├── Pre-migration actions    → detectPreMigrationActions()
  └── Out-of-scope panel       → detectApplicableImpossibleResources()

Step 3 (Migrate)
  └── Dry-run mode             → preview all API calls without executing

Step 4 (Results)
  └── Verification diff        → export dest zone, compare against source
```

### Step 1: migration blockers

Auto-runs when source zone + destination account are both selected.

| Severity | UI | Meaning |
|----------|----|---------|
| `error` | Red panel | Migration cannot proceed |
| `warning` | Yellow panel | Migration can proceed with caveats |

Checks:

| Check | Severity | Detection | Resolution |
|-------|----------|-----------|------------|
| Source zone accessible | error | `GET /zones/{id}` fails | Verify token (Zone:Read) |
| Dest account accessible | error | `GET /accounts/{id}` fails | Verify token |
| Zone already exists in dest | warning | Lookup | Migrate into existing zone |
| DNSSEC enabled | warning | `GET /zones/{id}/dnssec` active | Disable DNSSEC, remove DS at registrar, wait for TTL |
| Workers with secrets | warning | Bindings have `secret_text` | Provide values in Step 3 |
| Custom certificates | warning | `customCertificates.length > 0` | Provide cert+key in Step 3 |
| Enterprise feature on lower plan | warning | Source plan vs dest capability | Upgrade or accept feature loss |
| Zone hold on source | error | Add-zone returns hold error | Contact domain owner or Support |
| Domain not registered | error | Add-zone returns "not a registered domain" | Register the domain first |
| Pending zone deletion | error | `Zone is pending deletion` | Wait up to 24h |
| Cloudflare Registrar domain | warning | Registered with CF Registrar | Transfer registration separately |
| Partner/reseller zone | warning | Tenancy detected | Coordinate with partner |

### Step 2: capability checks

| Capability | Endpoint | Detects |
|------------|---------|---------|
| `zeroTrust` | `GET /accounts/{id}/access/apps` | Not enabled |
| `r2` | `GET /accounts/{id}/r2/buckets` | Not enabled |
| `loadBalancing` | `GET /accounts/{id}/load_balancers/pools` | Sub missing |
| `workers` | `GET /accounts/{id}/workers/scripts` | Not enabled |
| `spectrum` | Zone plan check | Not Enterprise |
| `analyticsEngine` | Account features | Not enabled |

`AccountCapabilities` shape (`src/types.ts`):

```typescript
interface AccountCapabilities {
  zeroTrust:       { available: boolean; reason?: string; action?: string };
  r2:              { available: boolean; reason?: string; action?: string };
  loadBalancing:   { available: boolean; reason?: string; action?: string };
  workers:         { available: boolean; reason?: string; action?: string };
  spectrum:        { available: boolean; reason?: string; action?: string };
  analyticsEngine: { available: boolean; reason?: string; action?: string };
}
```

### Step 2: validation warnings

Generated by `generateValidationWarnings()` (`app/lib/validation.ts`).

| Type | Color | Meaning |
|------|-------|---------|
| `error` | Red | Will definitely fail |
| `warning` | Yellow | Likely issue |
| `info` | Blue | Be aware |

Common checks (full list in `app/lib/validation.ts`):

- **Worker bindings** - secrets, KV, DO, R2, Analytics Engine (with/without
  capability)
- **Settings** - custom cipher suites (needs ACM)
- **Resource counts** - custom certs, large DNS counts, Spectrum apps
- **Plan-gated features** - Spectrum (Enterprise), custom certs (Business+),
  LBs (add-on)
- **Configuration issues** - cron triggers, Turnstile sitekey regeneration,
  email routing destination addresses, Access IdP configs
- **Capability mismatches** - error severity when destination lacks a
  capability that the source uses

### Step 2: pre-migration actions

`detectPreMigrationActions()` shows interactive cards that need
acknowledgment before "Continue to Migration" enables:

| ID | Severity | Condition | User action |
|----|----------|-----------|-------------|
| `d1-schema` | warning | D1 selected | Run `wrangler d1 export/import` |
| `r2-data` | warning | R2 selected | Run `rclone sync` |
| `analytics-engine` | warning | AE workers + AE unavailable | Enable AE on dest |
| `do-data` | info | DO selected | App-level migration |
| `custom-certs` | info | Certs selected | Provide PEM in Step 3 |
| `worker-secrets` | info | Workers with secrets | Provide values in Step 3 |
| `missing-storage-deps` | warning | Workers reference unselected storage | Select missing or let auto-create |

### Step 2: out-of-scope panel

`OutOfScopePanel` (`app/components/OutOfScopePanel.tsx`) renders every
applicable entry from `IMPOSSIBLE_TO_MIGRATE` in `src/types.ts`. Detection
is pure (`detectApplicableImpossibleResources` in `app/lib/outOfScope.ts`)
- it walks the source export and decides which entries apply, stamping
each result with an `actionable: boolean` derived from category.

The panel renders two distinct blocks (AGENTS.md Principle 4 - Never Ask
the User to Acknowledge Things They Cannot Change):

**Actionable block** ("Will Not Migrate - You Must Act") - items the
user has agency over. Each must be acknowledged before "Continue to
Migration" is enabled. Framing leads with the consequence (auth will
fail, data will be missing, DNS will not resolve, mail will be dropped),
not the polite "please understand the manual steps." The acknowledgment
is the user assuming responsibility for a known-broken outcome.

| Category | User action |
|----------|-------------|
| `cryptographic` | Re-supply secrets / re-upload private keys (worker secrets, custom cert keys, Access service tokens, Turnstile, Origin CA / Keyless SSL, IdP client secrets, AOP mTLS, notification webhook signing secrets, AI Gateway provider API keys) |
| `account_tied` | Re-provision on dest account / contact account team (Cloudflare Registrar, BYOIP, Aegis IPs, Magic Transit/WAN/Firewall, China Network, FedRAMP, Network Interconnect, Hyperdrive / VPC Service / Dispatch Namespace / Workflow / Pipeline bindings, Pages deployment data, account custom NS pool, account custom ruleset references, R2 bucket event notifications, tunnel origins, Gateway / AI Gateway dependencies) |
| `data_offline` | Run wrangler / rclone / S3 commands (D1 schema and data, R2 bulk object data, Logpush buffered batches) |
| `manual_external` | Update registrar / verify email / external action (DNSSEC DS record, email routing destinations, NS change at registrar, custom hostname SSL DCV, cert pack DCV, Custom Nameservers glue) |

**Informational block** ("Other notes about this migration") - items the
user has NO agency over. Disclosure only, collapsed by default, no
checkboxes, never gates Continue. These represent expected outcomes of
any account migration that the user is being kept informed about.

| Category | Why informational |
|----------|-------------------|
| `auto_managed` | Cloudflare auto-provisions on the destination zone (Universal SSL, Cloudflare/OWASP Managed Rulesets, DDoS L3/L4/L7 managed rules, Smart Tiered Caching, SSL Recommender, WAF Attack Score, Backup Certificates) |
| `read_only` | Server-side immutable, derived from plan/account (`cname_flattening`, `plan_level`, `orange_to_orange`, `advanced_ddos`) |
| `data_ephemeral` | Volatile by design; no user action can preserve across an account boundary (cache content, web analytics history, security events history, audit logs, queue messages in flight, KV absolute-expiry timestamps) |

The `ACTIONABLE_CATEGORIES` set in `app/lib/outOfScope.ts` is the single
source of truth for which side of the split a category lands on. Adding
a new `ImpossibleCategory` MUST update that set explicitly.

**Three-state resolution model (bucket 1 of inline fix-it).** Within the
actionable block, each item resolves to one of three states:

| State | Meaning | UI |
|-------|---------|----|
| `fixed` | User supplied all required values via the inline fix-it form; the migration tool will set them on the destination. | Green ✅ FIXED badge; the "Skip and acknowledge" toggle is shown as ignored. |
| `acknowledged` | User explicitly checked "Skip and acknowledge" - they accept the destination will be broken in the documented way. | Amber 🟡 ACK badge. |
| `unresolved` | Default. Blocks "Continue to Migration". | Gray ⚪ OPEN badge. |

Both `fixed` and `acknowledged` unblock Continue. The completeness rule
("everything is supplied") for `fixed` lives in `isItemFixed()` in
`app/lib/outOfScope.ts` and is pure - it inspects the relevant state
slice (`workerSecrets`, `certificates`, or `originCaCsrs`) against the
source rows from `exportData` to decide whether every required input
has a non-empty value.

**Inline fix-it support.** Three
IMPOSSIBLE_TO_MIGRATE keys have an inline fix-it form that appears
inside the panel row, eliminating the need for the user to navigate to
Step 3 just to supply the value:

| Key | Bucket | Fix-it form | State slice |
|-----|--------|-------------|-------------|
| `worker_secrets` | 1 | Per-worker, per-secret password input | `workerSecrets` |
| `custom_certificate_keys` | 1 | Per-source-cert cert + private key PEM textareas | `certificates` |
| `origin_ca_keys` | 1 | Per-source-cert CSR textarea (+ openssl command snippet) | `originCaCsrs` |
| `notification_webhook_secret` | 2.1 | Per-source-webhook password input (name + URL shown) | `notificationWebhookSecrets` (keyed by source webhook name) |
| `identity_provider_secrets` | 2.2 | Per-source-IdP password input. `onetimepin` IdPs filtered out (auto-provisioned). Export now captures IdP `config` minus secret-like fields so dest IdPs can be created with the supplied `client_secret`. | `identityProviderSecrets` (keyed by source IdP name) |
| `aop_mtls_certificate_bundle` | 2.3 | One or more cert + private_key PEM textareas with `ca` flag. Affected hostnames displayed for orientation. Migration uploads to `/accounts/{id}/mtls_certificates` and uses the returned cert ID for the hostname-association PUT. Implements list-by-name fallback for the API's misleading JSON-decode-but-success quirk. | `aopMtlsBundles` (array; first valid bundle used for hostname assoc) |
| `ai_gateway_custom_provider_api_keys` | 2.4 | Per-source-provider password input (slug shown). Migration writes to Cloudflare Secrets Store (`scopes: ["ai_gateway"]`, name `ai_gateway_<slug>`) - NOT a field on the provider itself. User code referencing providers via `cf-aig-authorization` headers must be updated; manual-action message emitted. | `aiGatewayProviderApiKeys` (keyed by source slug) |

The fix-it forms live in `app/components/fixit/` and are shared between
Step 2 (via `<InlineFixItForm>` inside `OutOfScopePanel`) and Step 3
(via `<Step3Setup>`). Both mount sites pass the same wizard-root state
slices, so values entered in either step persist across navigation.
`BUCKET_1_FIX_IT_KEYS` in `outOfScope.ts` is the single source of truth
for which keys have fix-it support; future buckets must extend that
set and add a corresponding sub-component. (The set name retains the
"BUCKET_1_" prefix for back-compat with bucket 1's commit history; it
now spans bucket 1 + bucket 2.1.)

Every other actionable item retains the binary checkbox UX (ack vs
unresolved) because there is no textbox-shaped fix available.

**Copy-command snippets.** For
ack-only items whose "fix" is a known external CLI command (wrangler /
rclone), the panel renders a copy-to-clipboard snippet beneath the
item with source identifiers (D1 database name, R2 bucket name, Pages
project name) already interpolated. The ack checkbox still gates
Continue - the snippet is informational. Three keys currently have
helpers:

| Key | Snippet(s) |
|-----|------------|
| `d1_schema_and_data` | `wrangler d1 export <name> --remote --output=<name>.sql` then `wrangler d1 execute <name> --remote --file=<name>.sql` (one pair per source DB) |
| `r2_object_data` | One-time `rclone config` setup + per-bucket `rclone sync --progress src:<bucket> dst:<bucket>` |
| `pages_deployment_data` | `wrangler pages deploy <dir> --project-name=<name>` (one per source project) |

Snippets are stamped onto `ApplicableImpossibleResource.cliCommands` at
detection time by `buildCliCommands()` in `app/lib/outOfScope.ts`.
`BUCKET_3_CLI_KEYS` is the single source of truth for which keys get
snippets; future keys must extend that set and add a branch to
`buildCliCommands`. The `<CliCommandList>` / `<CliCommandSnippet>`
components in `app/components/fixit/` render the affordance.

**Placement.** The panel sits just above the "Continue to Migration"
button - the last thing the user sees before proceeding, adjacent to the
gate it controls. Per Principle 4, surface immediate-value content
(export summary, warnings, resource list) at the top of Step 2 so the
user gets oriented quickly; front-loading the acknowledgment block hides
the resource preview users actually came to see.

### Plan/license validation

When a dest account is selected, the tool fetches plan counts:

```typescript
planCounts: { free: 12, pro: 3, business: 1, enterprise: 7 }
```

Step 1 shows them as pill tabs: `Free(∞) | Pro(3) | Business(1) | Enterprise(7)`.

| Rule | Behavior |
|------|----------|
| Auto-select | Highest tier with count > 0 |
| Disabled plans | Plans with 0 zones grayed out |
| Free always available | Shows `(∞)` |

Priority order for the actual subscription request (`src/migrate.ts`):

1. User-selected plan (from picker)
2. Enterprise if available
3. Match source zone plan
4. Highest available plan
5. Proceed with warning if no match

### Dry-run mode

Step 3 toggle: generate all API call code without executing.

| Format | Output |
|--------|--------|
| TypeScript | `fetch()` with `async/await` |
| curl | shell script |
| Python | `requests` library |
| Go | `net/http` |
| Terraform | equivalent `cloudflare_*` resources |

### Post-migration verification

Step 4 "Verify Now" button: exports dest zone, diffs against source, shows
discrepancies categorized.

| Discrepancy | Common reason | Action |
|-------------|--------------|--------|
| Missing in dest | Migration error, or capability gap (acknowledged) | Check errors |
| Different IDs | Expected - new IDs on dest | None |
| Missing secrets | Write-only by API | Expected |
| Extra managed rulesets | Cloudflare auto-creates | Expected |
| Normalized setting values | Server-side canonicalization | Expected |

---

## User flows

Twilight Zone supports five primary user flows, all starting from the same
Step 1 screen. The decisions are: **what to do** (Export or Migrate) and
**where the source data is** (Live API, JSON file, or Terraform file).

### Wizard steps

| Step | Name | Purpose |
|------|------|---------|
| 1 | **Setup** | Auth, mode, source/dest pickers, zone plan |
| 2 | **Scope** | Unified resource list, conflict strategy, pre-migration actions, out-of-scope panel |
| 3 | **Migrate** | Worker secrets, custom certs, Turnstile info, dry-run, execute, streaming log |
| 4 | **Results** | Status banner, per-resource cards, verification, report downloads |

Previously, Steps 2/3 were split into "Account Resources" and "Zone Resources"
with a separate deploy. This was consolidated because the backend
`migrateZone()` already deploys account resources before zone resources in
dependency order.

### Flow matrix

| Source | Export JSON | Export TF | Migrate |
|--------|:-----------:|:---------:|:-------:|
| **Live API** | keys + export | keys + export | keys + scope + configure + execute |
| **JSON File** | n/a | n/a | upload + scope + configure + execute |
| **Terraform** | n/a | n/a | upload + scope + configure + execute |

#### Flow 1 - Live API → Export JSON

Backup / version-control snapshot.
```
Step 1 → "Export" → Live API → creds → account → zone → JSON →
  download {zone}-export-{date}.json
```

#### Flow 2 - Live API → Export Terraform

IaC adoption.
```
Step 1 → "Export" → Live API → creds → account → zone → Terraform →
  download zone-export.tf
```

#### Flow 3 - Live API → Migrate

Direct account-to-account.
```
Step 1 (Setup) → "Migrate" → Live API → src creds → src account/zone →
  dest account/domain → plan → "Scope Migration"
Step 2 (Scope) → select resources → ack pre-migration actions →
  ack out-of-scope items → conflict strategy → "Continue"
Step 3 (Migrate) → secrets → certs → Turnstile info → dry-run? → "Execute" →
  streaming log → auto-advance
Step 4 (Results) → status → cards → "Verify Now" → download report
```

#### Flow 4 - JSON File → Migrate

Re-run from previously exported JSON.
```
Step 1 → "Migrate" → JSON File → drop/browse → dest creds → "Scope Migration"
Steps 2–4 same as Flow 3.
```

#### Flow 5 - Terraform File → Migrate

Migrate from Terraform state.
```
Step 1 → "Migrate" → Terraform → drop/browse → dest creds → "Scope Migration"
Steps 2–4 same as Flow 3.
```

### Verification flow (post-migration)

After any migration, Step 4 includes "Verify Now":

```
Step 4 → "Verify Now"
  → Export dest zone via API
  → Diff source export vs dest export
  → Inline display:
    - Missing in dest (red)
    - Extra in dest (blue)
    - Different (yellow)
  → Each discrepancy includes a reason
```

Round-trip use cases:
- **Import JSON → Migrate → Verify** - compares the original imported JSON
  against what the dest zone actually has (reveals what the migration
  couldn't replicate: secrets, entitlement-gated features, normalized
  values).
- **Import TF → Migrate → Verify** - same with Terraform as source of truth.

---

## API endpoints

Two surfaces: streaming (SSE) for the UI, synchronous JSON for utilities and
programmatic clients. See [AGENTS.md § 6](../AGENTS.md#6-api-surface) for the
full list.

| Class | Endpoint | Description |
|-------|----------|-------------|
| Stream | `POST /api/export/stream` | Streamed export |
| Stream | `POST /api/migrate/stream` | Streamed full migration |
| Stream | `POST /api/migrate/account-resources` | Account resources only |
| Stream | `POST /api/migrate/respond` | Answer a mid-flight prompt |
| Stream | `POST /api/export/troubleshooting/stream` | Troubleshooting bundle |
| Stream | `POST /api/export/openapi/stream` | "Everything via OpenAPI" |
| Stream | `POST /api/terraform/export/stream` | Terraform HCL |
| Stream | `POST /api/terraform/import/stream` | Terraform import block |
| JSON | `POST /api/export` | Non-streaming export |
| JSON | `POST /api/migrate` | Non-streaming migrate |
| JSON | `POST /api/check-blockers` | Blocker checks |
| JSON | `POST /api/check-capabilities` | Capability probe |
| JSON | `POST /api/validate-token` | Token shape + permissions |
| JSON | `POST /api/zones`, `/api/accounts`, `/api/available-plans` | Picker data |
| JSON | `POST /api/email-routing/send-verification` | Verification kickoff |
| JSON | `POST /api/email-routing/check-verification` | Poll status |
| JSON | `POST /api/rdap` | Registrar / NS lookup |
| JSON | `GET  /api/version` | Build info |
| JSON | `GET  /api/v1`, `/api/v1/docs`, `POST /api/v1/*` | Programmatic API mirror |

---

## Code generation

Dry-run and Step 3 generate API call code in multiple formats:

| Format | Extension | Description |
|--------|-----------|-------------|
| TypeScript | `.ts` | Fetch with async/await |
| curl | `.sh` | Shell with curl |
| Python | `.py` | `requests` |
| Go | `.go` | `net/http` |
| Terraform | `.tf` | `cloudflare_*` resources |

Producers: `app/lib/codegen.ts` (client-side), `src/codegen.ts` (server-side
for API mirror), `src/terraform.ts` (HCL).

---

## Design decisions

### Why a Cloudflare Worker?

| Alternative | Rejected because |
|-------------|------------------|
| CLI tool (Go/Node) | Requires install, runtime, dependencies |
| Desktop app | Heavyweight, platform-specific builds |
| Terraform | Requires HCL, state management, provider setup |
| cf-terraforming | Exports only; doesn't handle import or secrets |

**Worker advantages:** zero install, no CORS (calls from edge), instant
updates, any browser.

### Why Server-Sent Events?

| Alternative | Rejected because |
|-------------|------------------|
| WebSockets | Overkill for one-way streaming |
| Long polling | Higher latency, less efficient |
| Single JSON response | No progress; bad UX for long ops |

**SSE advantages:** native browser support, simple text protocol,
auto-reconnection.

### Why parallel + sequential hybrid?

Pure parallelization causes dependency failures (can't create a Pool
referencing a Monitor that doesn't exist yet). Solution: topological ordering
with priority-based phases; within each phase, `Promise.allSettled` for max
parallelism.

### Why localStorage for form persistence?

| Alternative | Rejected because |
|-------------|------------------|
| Cookies | Size limits, sent with every request |
| IndexedDB | Overkill for a handful of text fields |
| Server-side session | Requires per-user state; the Worker keeps none (the only server-side persistence is the PII-stripped, credential-free run log - never tokens) |
| URL parameters | Exposes tokens in browser history |

Tradeoff: persistent credentials across tabs. Mitigated with explicit "Clear
All Data" button. See [SECURITY.md](SECURITY.md) for FedRAMP context.

### Why not delete the source zone?

Explicit non-goal. Deletion is irreversible, users need to verify before
cutover, the old zone must serve traffic during DNS propagation, and tools
should not destroy data.

### Why unified Step 2 instead of account/zone split?

The original design split preview into two screens with a "Deploy Account
Resources" intermediate step. Consolidated because:

1. Users didn't understand the split.
2. The backend already deploys account → zone in dependency order.
3. Fewer clicks; review everything at once.
4. Mental model: "what is this zone?" then "what does it depend on?".

### Why conflict strategy in scope, not migration?

`conflictStrategy` (Skip vs Overwrite) is set in Step 2, not mid-flight. Keeps
the migration step non-interactive - once Execute is clicked, it runs to
completion. The scope view shows which resources will be affected.

### Why operation mode (Export vs Migrate) first?

Determines which UI sections appear. Quick exports don't need a destination
panel; reduces cognitive load.

---

## Tradeoffs accepted

| Tradeoff | Reason |
|----------|--------|
| No automatic rollback by default | Complexity; partial migrations are still useful. (`handleRollback` in `src/worker/index.ts:156` does exist for explicit rollback.) |
| Enterprise assumption | Simplifies feature detection; lower plans get acknowledged feature gaps |
| Browser-only UI | Workers don't support stdin/stdout for CLI; the `/api/v1` JSON API mirror covers scripting |
| English-only | i18n adds complexity |
| No automatic zone deletion | Safety; deletion should be explicit user action |
| Show all DOs regardless of zone | DOs are account-level; users know which ones belong |
| Pre-flight checks are async | Can't block export; checks happen after data loads |
