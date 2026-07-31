# Twilight Zone

A Cloudflare Worker that migrates a zone from one Cloudflare account to another.
It exports DNS, zone settings, rulesets, Workers, load balancers, Access
policies, and 30+ other resource types from a source zone and recreates them on
a destination account through an interactive, auditable wizard. Live version
available at https://twilight-zone.ross.gg

A live instance is deployed at **[twilight-zone.ross.gg](https://twilight-zone.ross.gg)**.

![Twilight Zone migration wizard](media/screenshot-setup.webp)

## Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pocc/twilight-zone)

One click clones this repo into your GitHub/GitLab account, provisions the
`RUN_LOG` KV namespace, and deploys the Worker to your account. This is the same
button surfaced on the tool's landing page; the canonical build is deployed at
[twilight-zone.ross.gg](https://twilight-zone.ross.gg). Or run it locally:

```bash
npm install
npm run dev              # http://localhost:5173
npm run deploy           # vite build && wrangler deploy
```

Set your account ID before `dev`/`deploy` (wrangler reads it automatically), or
pin it in `wrangler.toml`:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
```

### Optional browser OAuth

OAuth is disabled by default, so deployments continue to use manual API tokens
or API Key + Email. **Do not set `OAUTH_ENABLED=true` until the complete live
validation gate below has been executed against the deployment's real private
client and the sanitized results have been recorded.** Mocked tests, local
development, placeholder replacement, and a successful deployment do not
satisfy this gate.

No real OAuth client has been validated by this repository's automated test
suite. Register an OAuth 2.0 authorization-code client with PKCE and configure
these exact provider endpoints:

- Authorization: `https://dash.cloudflare.com/oauth2/auth`
- Token exchange: `https://dash.cloudflare.com/oauth2/token`
- Revocation: `https://dash.cloudflare.com/oauth2/revoke`
- Redirect URI: `https://your-deployment.example.com/api/oauth/callback`

Set the non-secret Worker variables in `wrangler.toml`:

| Variable | Value |
|---|---|
| `OAUTH_ENABLED` | Must remain `false` until every item in the live validation gate below is recorded as passing. |
| `OAUTH_CLIENT_ID` | Public client identifier issued for this deployment. |
| `OAUTH_COOKIE_KEY_ID` | Operator-chosen identifier for the active cookie-encryption key. |
| `OAUTH_ALLOWED_ORIGIN` | Exact deployment origin, with no path or trailing slash. HTTP is accepted only for `localhost` or `127.0.0.1`. |
| `OAUTH_REDIRECT_URI` | Exact allowed origin plus `/api/oauth/callback`; no query or fragment. |
| `OAUTH_SOURCE_SCOPES` | JSON array of the exact read scopes provisioned for the source role. |
| `OAUTH_DESTINATION_SCOPES` | JSON array of the exact read/write scopes provisioned for the destination role. |

Do not put `OAUTH_COOKIE_KEY` in `[vars]`. Generate a 32-byte base64url key and
store it as a Worker secret:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
npx wrangler secret put OAUTH_COOKIE_KEY
```

For local development, place the same variables and `OAUTH_COOKIE_KEY` in the
gitignored `.dev.vars` file, use `http://localhost:5173` as
`OAUTH_ALLOWED_ORIGIN`, and register
`http://localhost:5173/api/oauth/callback` as the local redirect URI.

#### Required live validation gate

`OAUTH_ENABLED=true` is forbidden until a sanitized validation record contains
evidence for every item below. If any item fails or lacks evidence, leave OAuth
disabled and continue using manual authentication.

- **Scopes:** Record the exact source and destination scopes returned by the
  provider. Confirm the source allowlist contains only required read scopes and
  the destination allowlist contains the required destination read/write
  scopes. Confirm no returned scope falls outside its configured role allowlist.
- **Callback registration:** Record the provider-registered callback and confirm
  it exactly equals `OAUTH_REDIRECT_URI`, including scheme, hostname, path, and
  absence of a query or fragment.
- **Callback query logging:** Complete successful and failed callbacks, then
  inspect application, Worker, edge, and provider-visible logs available to the
  operator. Record that authorization codes, state, PKCE values, callback query
  strings, access tokens, and cookie values were not logged.
- **Token lifetime:** Measure the provider's real `expires_in` and effective
  expiry. Record that the UI's 35-minute migration gate and 20-minute phase-two
  gate leave sufficient time for the measured token lifetime.
- **Cookie sizes:** Measure UTF-8 bytes for every OAuth `Set-Cookie` header and
  the combined incoming OAuth `Cookie` header. Record that each `Set-Cookie` is
  at most 3800 bytes and the combined OAuth cookies are at most 12000 bytes.
- **Revocation:** Revoke each real role grant, attempt to reuse it, and record
  that the provider rejects reuse and Twilight Zone clears local role state.
- **Source reads and write denial:** Record successful source account/zone
  listing and source export. Attempt an isolated destination-style write with
  source authority and record that it is denied without changing the resource.
- **Destination reads and writes:** Record successful destination account/zone
  reads, a successful `/api/check-capabilities` probe, and one isolated,
  reversible destination write using destination authority, including
  verification and cleanup of the test resource.
- **Expiry and reauthorization:** Exercise preflight expiry and a controlled
  mid-stream rejection. Record role-specific reconnect UI, affected-cookie
  clearing, no weaker-credential fallback, and successful continuation only
  after a new authorization.
- **Logout and revocation failure:** Record both normal logout and an induced
  provider revocation failure. Confirm both role cookies and the tab nonce clear
  locally in either case, while the revocation failure remains visible in the
  validation evidence.

##### Sanitized evidence template

Create one record using this structure. Include measured values, timestamps,
HTTP status codes, and pass/fail outcomes, but never include an authorization
code, state, PKCE verifier, PKCE challenge, access token, nonce, cookie values,
cookie headers, secrets, or callback query strings.

```text
Deployment origin:
Validation date/time (UTC):
OAuth client identifier:
Source scopes returned:
Destination scopes returned:
Registered callback URI:
Callback query logging review (systems checked and result):
Token expires_in and measured effective lifetime:
Set-Cookie UTF-8 byte measurements (one size per header):
Combined OAuth Cookie UTF-8 byte measurement:
Revocation and rejected-reuse result:
Source account/zone reads and export result:
Source-authority write-denial result and unchanged-resource verification:
Destination account/zone reads result:
/api/check-capabilities result:
Destination reversible write, verification, and cleanup result:
Preflight-expiry result:
Mid-stream rejection, reconnect UI, cookie clearing, and retry result:
Normal logout result:
Induced revocation-failure result and local-cleanup verification:
Overall gate: PASS or FAIL
Operator notes (sanitized):
```

The local acceptance criteria are documented in
[`docs/plans/oauth-worker-session/stories/013-live-production-gate.md`](docs/plans/oauth-worker-session/stories/013-live-production-gate.md),
but the checklist above is the enablement authority and is intentionally
self-contained.

The browser-facing Worker routes are:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/oauth/config` | Report whether OAuth is enabled. |
| `POST` | `/api/oauth/start` | Start source or destination authorization. |
| `GET` | `/api/oauth/callback` | Validate state/PKCE and establish the role grant. |
| `POST` | `/api/oauth/status` | Read source and destination connection status. |
| `POST` | `/api/oauth/clear` | Revoke and clear one role. |
| `POST` | `/api/oauth/logout` | Revoke both roles and clear all OAuth state. |
| `POST` | `/api/migrate/respond` | Answer an in-flight migration prompt using opaque prompt identifiers. |

Access tokens are encrypted in host-only, `Secure`, `HttpOnly`, `SameSite=Lax`
session cookies; they are not returned to JavaScript or persisted in KV. The
provider's `expires_in` controls grant expiry. Protected operations reject a
grant unless its remaining lifetime covers the route's execution budget plus a
five-minute safety margin, at which point the UI requires role-specific
reauthorization. OAuth transaction cookies expire after five minutes.

`/api/oauth/clear` and `/api/oauth/logout` attempt provider revocation, but local
cookie deletion still completes if revocation is unavailable. Key rotation is
intentionally session-invalidating: generate and install a new
`OAUTH_COOKIE_KEY`, change `OAUTH_COOKIE_KEY_ID`, deploy both changes together,
and require every connected user to authorize again. The application does not
retain an old decryption key.

Browser OAuth is deliberately isolated from `/api/v1`. Programmatic `/api/v1`
routes ignore OAuth cookies and continue to require manual credentials in each
request body.

## Features

- **Interactive wizard** — step-by-step, select-only review before any write
- **Complete zone export** — all configuration to JSON (also Terraform / OpenAPI)
- **Workers & Routes** — scripts, routes, and all 26 binding types
- **Storage data** — copies KV key/values and (with S3 credentials) R2 objects; creates D1 databases and Durable Object namespaces, with optional DO state migration
- **Load Balancers** — pools, monitors, and LB configs (with ID remapping)
- **Secrets & certificates** — prompts for worker secrets and custom SSL certs that can't be read from source
- **Migration report** — downloadable `migration_report.md` with per-resource status

## How it works

The wizard is a Setup landing (**step 0**) plus four numbered steps (1–4),
mirroring the engine's `migrateAccountResources` then `migrateZone` phases:

- **0 · Setup** — provide API tokens (or API key + email) and pick source/dest accounts + zone
- **1 · Account** — audit account-scoped resources (Workers, KV/R2/D1, Queues, LB, Access, Turnstile, …) and supply account-scoped secrets. Select-only — **Continue to Zone →**
- **2 · Zone** — audit zone-scoped resources (DNS, settings, rulesets, page rules, email routing, …) and supply zone-scoped secrets. Optional **Download script** and pre-cutover uptime monitor. Select-only — **Continue to Apply →**
- **3 · Apply** — the single "do it" step: review the plan, confirm the destination, then **Run migration →**. When it completes, work the interactive post-migration checklist (registrar nameserver change, DNSSEC, email verification, Turnstile sitekeys, KV/R2/D1 data copies)
- **4 · Results** — read-only verification of the merged report; download `migration_report.md`

The `migration_report.md` contains a summary (total / verified / acknowledged /
mismatched / failed), new nameservers to set at your registrar, per-section
detail, errors with suggestions, and a post-migration checklist.

(MaxConfig / MinConfig presets are not migrations — they apply a canned config
to a single zone, but still walk the Account and Zone review steps.)

## What gets migrated

Twilight Zone covers the Cloudflare API write surface across 65+ feature areas.
Rather than a hand-maintained list, two mechanisms keep coverage honest:

1. **Zone settings migrate dynamically** — whatever the source zone's settings
   API reports is migrated as-is, so a new setting needs no code change.
2. **An hourly Worker watches Cloudflare's OpenAPI spec** and raises an in-app
   banner + Google Chat ping the moment a new write endpoint appears, so drift
   is caught within the hour (live status: `GET /api/spec-status`; see
   [docs/SPEC_DRIFT_MONITOR.md](docs/SPEC_DRIFT_MONITOR.md)).

Some resources **cannot** move via API and are surfaced in Step 1/2 for explicit
acknowledgment before migration:

| Category | Examples |
|---|---|
| **Cryptographic** | Worker secrets, Access service-token secrets, Turnstile secrets, custom cert / Origin CA / Keyless SSL private keys |
| **Account-tied** | Registrar, BYOIP, Aegis IPs, Magic Transit/WAN/Firewall, China Network, FedRAMP, CNI |
| **Auto-managed** | Universal SSL, Managed Rulesets, DDoS managed rules, Smart Tiered Caching, Backup Certificates |
| **Read-only** | `cname_flattening`, `plan_level`, `orange_to_orange`, `advanced_ddos` |
| **Data-ephemeral** | Cache content, analytics history, audit logs, in-flight queue messages, KV TTLs |
| **Data-offline** | D1 rows (wrangler), R2 bulk objects (rclone), buffered Logpush, DO stored state |
| **Manual external** | DNSSEC DS at registrar, email-routing verification, nameserver change, custom hostname validation |

For the authoritative per-endpoint matrix (1,500+ write endpoints, feature
status, plan/entitlement requirements) see **[docs/COVERAGE.md](docs/COVERAGE.md)**.
"Out of scope" means *this tool doesn't migrate it* — most such features still
have their own migration paths via the dashboard, Terraform, or vendor tooling.

## Prefer to migrate manually?

Twilight Zone is one of several ways to migrate a zone. If you can't or don't
want to use it — for compliance reasons, a FedRAMP environment, no cross-account
API tokens, or you just want official tooling like `cf-terraforming` and
`wrangler` — follow the [Migration Guide](docs/MIGRATION_GUIDE.md) instead. It
walks the same end-to-end migration step-by-step and doubles as a "trust but
verify" checklist if you do use the tool.

## Limitations

1. **Nameserver change required** — the zone must be re-verified with new nameservers at your registrar.
2. **Worker secrets & private keys** — can't be read from source; you must provide them.
3. **Plan-dependent settings** — features may not transfer if source and destination plans differ (surfaced as acknowledged, not failed).
4. **Durable Object state** — the namespace is always created; stored **state** is copied only when you configure object names + source/dest worker URLs.
5. **KV & R2 data** — namespaces/buckets migrate automatically; KV values copy when you select the namespace, R2 **object data** only when you supply S3 credentials for both accounts.

## Data collection

*The website at https://twilight-zone.success.cloudflare.dev/ collects data to improve.
If you deploy this to your worker, you will get the logs instead.*

A **non-secret, non-PII** summary of each completed migration is logged
server-side (KV, 90-day retention): resource names, per-resource statuses, and
redacted error messages. **Credentials are never logged** — API tokens, keys,
worker secrets, and private keys exist only for the duration of each API call.
The landing-page "_N_ zones migrated" counter is derived from these logs. Full
allowlist, redaction, and retention details in
[docs/SECURITY.md](docs/SECURITY.md).

## Architecture

```
app/                 # React SPA (Vite) — wizard UI
src/
├── worker/index.ts  # Worker entry point + API routing
├── worker/api-v1.ts # Programmatic /api/v1/* JSON API
├── types.ts         # TypeScript interfaces + IMPOSSIBLE_TO_MIGRATE
├── api.ts           # Cloudflare API client functions
├── migrate.ts       # Migration orchestration entry (re-exports migrate/)
└── migrate/         # Export + migrate engine, split by concern
```

## ⚠️ Not a Cloudflare product; potential for LOSS OF DATA

> Twilight Zone is provided **"AS IS", WITHOUT WARRANTY OF ANY KIND**, per the
> [Apache License 2.0](LICENSE). It is an independent, best-effort tool.
> Bugs and requests go to this repository's issue tracker.
>
> You are solely responsible for verifying the
> result of any migration. Always confirm the destination zone before changing
> nameservers at your registrar. See also [NOTICE](NOTICE).

## Documentation

| Doc | What's in it |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, dependency resolution, ID remapping |
| [API.md](docs/API.md) | Full `/api/*` + `/api/v1/*` endpoint reference, request examples, token permissions |
| [SCRIPTS.md](docs/SCRIPTS.md) | Every npm alias and `scripts/*.mjs` tool |
| [MIGRATION_GUIDE.md](docs/MIGRATION_GUIDE.md) | End-to-end runbook, blockers, `IMPOSSIBLE_TO_MIGRATE` catalogue, manual flows |
| [VERIFICATION.md](docs/VERIFICATION.md) | Automated E2E settings verification + manual "trust but verify" checklist |
| [COVERAGE.md](docs/COVERAGE.md) | Tool coverage vs the CF API write surface (per-endpoint matrix) |
| [SECURITY.md](docs/SECURITY.md) | FedRAMP/NIST gap analysis, token permissions, run-logging details |
| [WORKER_BINDINGS.md](docs/WORKER_BINDINGS.md) | Every Workers binding type and how it's handled |
| [MAXCONFIG.md](docs/MAXCONFIG.md) | MaxConfig/MinConfig reference |
| [EXPORTS.md](docs/EXPORTS.md) | Export formats (JSON, Terraform, OpenAPI) |
| [SPEC_DRIFT_MONITOR.md](docs/SPEC_DRIFT_MONITOR.md) | Hourly spec-drift monitor + new-endpoint runbook |
| [TESTING.md](docs/TESTING.md) | Running the unit (vitest) + E2E (Playwright) suites |
| [ROADMAP.md](docs/ROADMAP.md) | Potential future features |
| [CHANGELOG.md](docs/CHANGELOG.md) | Completed-work history |

## License

Apache-2.0
