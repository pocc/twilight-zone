# Security

Threat model, FedRAMP/NIST 800-53 gap analysis, and API token permissions for
Twilight Zone.

> **Audience.** Twilight Zone is designed for all Cloudflare customers and is
> intentionally publicly accessible. Authentication uses either Cloudflare API
> credentials provided by the user or the optional browser OAuth flow.

> **Cloudflare authorization is required.** Manual API tokens and API Key +
> Email remain supported. Browser OAuth is disabled by default and must be
> configured by the deployment operator.

---

## Threat model summary

- **No OAuth token persistence.** Tokens are never written to KV or another
  server-side store. Manual credentials arrive per request; OAuth access tokens
  are held only in encrypted, host-only `Secure`, `HttpOnly`, `SameSite=Lax`
  session cookies. All Cloudflare API calls are made from the Worker edge (no
  CORS exposure).
- **Browser-side persistence.** Sensitive credentials (API tokens, API keys)
  are stored in `sessionStorage`, which auto-clears when the tab closes
  (see `SESSION_KEYS` in `app/hooks/useCredentials.ts`). Non-sensitive values
  (account IDs, domain names, theme) stay in `localStorage` for convenience
  across sessions. Mitigation: explicit "Clear All Saved Data" button (clears
  both stores) + optional AES-256-GCM encrypted config export.
- **HTTPS-only.** Cloudflare Workers enforce HTTPS for all responses.
- **No persistent audit logging.** The per-API-call audit log lives only in
  the Worker's per-request module-level variable. Users can download a CSV of
  API calls for review.
- **Migration run logging (beta).** A PII-stripped summary of each completed
  migration is persisted to a KV namespace (`RUN_LOG`) for troubleshooting
  while the tool is in beta (90-day TTL). Credentials are never logged (see
  [§ Migration run logging](#migration-run-logging-beta--data-collection)).
- **Bounded OAuth sessions.** The provider's token lifetime is authoritative.
  Each protected route also requires enough remaining lifetime for its route
  budget plus a five-minute safety margin. Per-role clear and full logout
  revoke best-effort and always remove local cookies.

---

## FedRAMP / NIST 800-53 checklist

Status against **FedRAMP High** baseline controls. This is relevant only for
organizations adhering to strict compliance standards.

### P1 - High priority

| Status | Control | Notes |
|--------|---------|-------|
| ✅ Done | **IA-5 / SC-28** - Use `sessionStorage` for credentials | Implemented: sensitive credentials (API tokens/keys) use `sessionStorage` (auto-cleared on tab close) via `SESSION_KEYS` in `useCredentials.ts`; only non-sensitive values (account IDs, domains, theme) remain in `localStorage`. |
| 🟡 Partial | **AU-2 / AU-3** - Persistent audit logging (R2 / Logpush / SIEM) | The tool emits a **complete** call record on the producer side: a downloadable "API Call Log (.csv)" of every call it made (Step 4) plus a downloadable script of every planned WRITE (Step 1). SIEM **ingestion/retention with integrity** is the operator's responsibility by design and is corroborated by Cloudflare's own [Account Audit Logs](https://developers.cloudflare.com/fundamentals/account/account-security/review-audit-logs/) (independent, server-side, actor+timestamp, 18-month retention, Logpush-able). Migration outcomes are additionally persisted PII-stripped to the `RUN_LOG` KV namespace (no credentials, 90-day TTL) - see [§ Audit logging](#audit-logging-au-2-au-3-au-6-au-9). |
| 🟡 Partial | **SC-8 / SC-18** - Security headers (CSP, HSTS, X-Frame-Options, …) | `SECURITY_HEADERS` (X-Content-Type-Options, Referrer-Policy, Cache-Control: no-store) is applied to every `/api/*` response via global middleware - see [§ Security headers](#security-headers-sc-8-sc-18---partial). CSP, HSTS, and X-Frame-Options are **not** set in the Worker yet (expected at the CF edge); static asset responses are unheadered. |
| ✅ Done | **AC-12 / SC-10** - OAuth session timeout / logout | OAuth grants honor provider expiry, protected routes reserve a five-minute safety margin, and per-role clear plus full logout remove local cookies even if provider revocation fails. Manual credentials remain tab-scoped in `sessionStorage`. |

### P2 - Medium priority

| Status | Control | Notes |
|--------|---------|-------|
| ℹ️ External | **SC-5** - Rate limit `/api/*` | Requires Cloudflare Rate Limiting Rules on the zone (recommend 100 req/min per IP), not code changes. |
| ✅ Done | **SI-10** - Input validation (UUIDs, domains, body size limits) | `isValidCfId()`, `isValidDomain()`, `isBodySizeValid()` in `utils.ts`; 10 MB body limit on POST endpoints. |
| ✅ Done | **MP-6** - Secure disposal ("Clear all data") | `clearAllData()` clears all localStorage keys, form fields, reloads page. Button in footer. |

### P3 - Low priority

| Status | Control | Notes |
|--------|---------|-------|
| ⚠️ Deferred | **SI-11** - Sanitize error messages | Verbose errors are intentional - users need detailed context to debug migrations. Sanitizing would reduce supportability. |
| ✅ Done | **SC-28** - Optional encryption for exported configs | AES-256-GCM via Web Crypto API; PBKDF2 600k iterations (OWASP 2026); export prompts for optional password. |
| ⚠️ Blocked | **SA-9 / SR-4** - SRI hashes for CDN resources | Tailwind v4 is bundled locally via `@tailwindcss/vite` (no CDN). N/A. |
| ℹ️ External | **IR-4 / IR-6** - Incident response | Requires SIEM integration. The tool holds no per-customer state beyond PII-stripped run logs (90-day TTL); detect via CF dashboard logs. |
| ℹ️ Manual | **CM-6** - Move account ID out of `wrangler.toml` | Deployment-process change; use `CLOUDFLARE_ACCOUNT_ID` env var. |
| ✅ Done | **PL-4** - Security/privacy notice | "Privacy & security" panel explains data handling, including beta migration run logging and the credentials-never-logged guarantee. Also disclosed in the Step 4 report and `migration_report.md` footer. |
| ✅ Done | **CM-3 / SI-2** - Version visibility | `APP_VERSION` constant; version displayed in footer. |

---

## High-priority gaps in detail

### Credential storage in the browser (IA-5, SC-28)

**Status:** mitigated

Sensitive credentials (API tokens/keys) are kept in `sessionStorage`, which is
cleared automatically when the tab closes; only non-sensitive values (account
IDs, domains, theme) use `localStorage`. Browser storage is still accessible to
same-origin JavaScript and thus vulnerable to XSS, but the credential exposure
window is now bounded to the tab session.

**Mitigations in place:**

- Sensitive credentials in `sessionStorage` (auto-cleared on tab close);
  `SESSION_KEYS` in `app/hooks/useCredentials.ts`.
- Tokens never sent to server-side storage (stateless Worker).
- Tokens excluded from exported config JSON.
- Optional AES-256-GCM encryption on exported configs (PBKDF2 600k
  iterations, OWASP 2026).
- "Clear All Saved Data" button (clears both `sessionStorage` and
  `localStorage`).

### Browser OAuth sessions

Browser OAuth uses authorization code with PKCE. The public client ID and role
scope arrays are Worker variables; the 32-byte `OAUTH_COOKIE_KEY` is a Worker
secret. Source and destination grants use separate encrypted `HttpOnly`
cookies, and a per-tab nonce binds both grants to the browser tab that initiated
authorization. The callback accepts only the configured
`/api/oauth/callback` URI on the configured origin.

Nonce uniqueness is enforced with an origin-scoped exclusive Web Lock held for
the page lifetime. This closes the `window.open`/duplicated-tab behavior that can
clone `sessionStorage`: a child rotates the copied nonce before any OAuth request
and therefore cannot use the opener's grant. Callback navigation and reload keep
the nonce because the previous document releases the lock before the replacement
document reacquires it. OAuth fails closed with
`oauth_browser_web_locks_unsupported` when Web Locks is unavailable; API Token
and API Key authentication remain available.

The OAuth routes are `/api/oauth/config`, `/api/oauth/start`,
`/api/oauth/callback`, `/api/oauth/status`, `/api/oauth/clear`, and
`/api/oauth/logout`. In-flight prompt answers use `/api/migrate/respond` with
only opaque migration and prompt identifiers; roles, account IDs, grant IDs,
and the nonce digest remain server-owned. No OAuth persistence binding is
required.

Key rotation intentionally invalidates every active OAuth session. Install a
new `OAUTH_COOKIE_KEY` secret and deploy a new `OAUTH_COOKIE_KEY_ID` together;
old cookies cannot be decrypted and users must authorize both roles again.
There is no old-key fallback. `/api/v1` remains isolated from browser OAuth and
requires manual credentials in the request body.

### Audit logging (AU-2, AU-3, AU-6, AU-9)

**Status:** producer side implemented; SIEM ingestion is the operator's
responsibility (by design).

Twilight Zone is a stateless tool that acts purely on the operator's own
Cloudflare credentials. It emits a complete record of what it does, and the
operator decides how to retain/ingest it. There are three independent layers:

1. **Tool-emitted call log (after the fact).** Every request through the
   central `cfFetch` client is recorded by `logApiCall` (`src/api.ts`) —
   method, path, status (`success`/`error`/`retry`), HTTP status code, error
   text, and duration — for success, error, and retry alike. Step 4 exposes
   this as **"API Call Log (.csv)"** (`buildAuditCsv` in
   `Step4Results.tsx`). This is the full list of every API call made on the
   operator's behalf, ready to copy into their own SIEM/ticket/change record.
2. **Tool-emitted plan (before the fact).** Step 1 offers **"Download planned
   API calls as a script"** (`DownloadScriptButton.tsx`) — every planned WRITE
   rendered as runnable TS/curl/Python/Go/Terraform that reads `CF_API_TOKEN`
   from env (never embedding credentials). The operator can review/keep the
   exact writes before anything executes.
3. **Independent server-side record (authoritative).** Cloudflare's own
   [Account Audit Logs](https://developers.cloudflare.com/fundamentals/account/account-security/review-audit-logs/)
   record every zone-configuration change tied to the token/actor (with
   timestamp, queryable via dashboard + API, CSV export, 18-month retention,
   and Logpush to an external SIEM). This is the tamper-evident, out-of-band
   trail an auditor relies on — and it exists regardless of the tool.

**Why this is a responsibility split, not a tool gap.** The tool cannot and
should not ship logs into a customer's SIEM: it holds no customer
infrastructure, no SIEM endpoint, and no retention mandate — those live inside
the operator's compliance boundary. The correct posture is: the tool produces
a complete, accurate, copyable record (layers 1–2) and the operator ingests it
into their SIEM, corroborated by Cloudflare's independent Account Audit Logs
(layer 3, which already provides source-side integrity and retention).

**Honest limitation.** Layer 1 (the tool's CSV) is self-reported by the same
process making the calls — it has no source IP and is not cryptographically
signed, so it is a convenience record, not independent evidence. For strict
AU-9 (audit integrity), layer 3 (Cloudflare Account Audit Logs / Logpush) is
the authoritative source. The tool's call log is capped at
`MAX_AUDIT_LOG_SIZE` (5000 entries) per `api.ts`; migrations exceeding that
truncate the oldest entries in the CSV — the CF Account Audit Logs remain
complete.

### Migration run logging (beta) - data collection

**Status:** implemented (beta)

To find and fix bugs while Twilight Zone is in beta, the Worker persists a
PII-stripped summary of each completed migration to the `RUN_LOG` KV namespace
(`src/migrate/run-log.ts`). Writes are best-effort and fire-and-forget
(`ctx.waitUntil`): a KV failure never affects a migration. Dry-runs are not
logged. Retention is a 90-day KV TTL.

**Credentials are never logged.** API tokens, API keys, worker secrets,
certificate private keys, and mTLS bundles live only on `MigrationConfig`,
which this module never reads. Only a projection of `MigrationReport` is
logged.

**What is logged** (allowlist - `buildRunLogRecord`):

- Run metadata: schema version, run id, timestamp, kind
  (`zone` | `account-resources`), tool version.
- Zone identity (kept deliberately, to make errors actionable): source/dest
  zone names, destination account id.
- Summary counts and per-section / per-item statuses.
- Error, warning, and manual-action text - for troubleshooting.
- Created-resource ids/names, new nameservers, DO/IdP result ids.

**What is excluded:**

- The entire `verification.destExport` `ZoneExport` (DNS/origin IPs,
  email-routing addresses) - not needed to see what failed.
- Any `MigrationConfig` field (all credentials/secrets).

**PII redaction (defense-in-depth):** every free-text field that survives the
allowlist is run through `redactPII()`, which replaces email addresses and
IPv4/IPv6 literals with `[email]` / `[ip]`. This covers error strings, item
names, warnings, and manual actions, **and** the values nested inside
`createdResources` (author-chosen resource names/ids) and `doMigrationResults`
(the upstream `error` text plus `workerName` / `className`) — both of which are
projected through the same redactor rather than copied verbatim. The allowlist
is the primary control; redaction is the backstop for PII that leaks in from
Cloudflare API error bodies. Zone names and account ids are intentionally
**not** redacted (they are the thing being migrated, and make errors
actionable).

**Landing-page counter.** `GET /api/stats` (public, unauthenticated, aggregate
only) reports the number of successful zone migrations - derived by counting
logged run entries flagged countable in their KV metadata (no separate mutable
counter), plus an estimated hours-saved figure (`zones × 4h`, labelled as an
estimate). No per-customer data is exposed.

**Disclosure (PL-4):** the in-app "Privacy & security" panel, the Step 4
results page, and the `migration_report.md` footer all describe this logging
and the credentials-never-logged guarantee.

**Access:** inspect via `wrangler kv key list --binding RUN_LOG --prefix run:`
and `wrangler kv key get`, or the KV dashboard. No in-app admin endpoint.

### Security headers (SC-8, SC-18) - partial

`SECURITY_HEADERS` is applied to **every `/api/*` response** (JSON and SSE
alike) by the global Hono middleware in `src/worker/index.ts`, so no individual
handler can forget them. This is what keeps sensitive payloads (zone exports,
analytics archives, migration reports) out of browser/intermediary caches:

```typescript
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};
```

Static assets (HTML/JS/CSS) are served by the Workers `ASSETS` binding and do
**not** currently receive these headers. The richer response headers a
hardened deployment also wants — `Content-Security-Policy`,
`Strict-Transport-Security` (HSTS), `X-Frame-Options`, `Permissions-Policy` —
are **not yet set** in the Worker and remain future work; in production they
are expected to be supplied at the Cloudflare edge (Transform Rules / managed
HSTS) in front of the asset responses.

### No application-layer rate limiting (SC-5)

**Status:** external

The app tracks Cloudflare API rate limits but `/api/*` has no per-IP limit.
Recommended: deploy with a Cloudflare Rate Limiting Rule (100 req/min per IP
on the zone) and WAF custom rules for additional input validation.

### No session management (AC-12, SC-10)

**Status:** missing

No session tokens, no timeouts, no concurrent-session limits. Deferred
because auto-logout would interrupt long migrations. Mitigation: explicit
"Clear All Saved Data" button.

### Input validation (SI-10) - implemented

- `isValidCfId()` - UUID-shaped Cloudflare IDs.
- `isValidDomain()` - domain syntax.
- `isBodySizeValid()` - 10 MB body size cap on POST endpoints.

### Verbose error messages (SI-11) - deferred

Detailed errors are intentional: users need them to debug failed migrations.
Sanitizing would harm supportability.

### Account ID in `wrangler.toml` (CM-6) - manual

Not highly sensitive but recommended to move to env var at deploy:

```toml
# wrangler.toml - placeholder
account_id = "<set via CLOUDFLARE_ACCOUNT_ID at deploy time>"
```

---

## Moderate gaps

### Data encryption at rest (SC-28) - export implemented

Optional password protection for downloads via Web Crypto API. A toggle on the
Results step (default off) adds a required password; when enabled, every file the
page produces is encrypted instead of written as plaintext:

- AES-256-GCM
- PBKDF2, 600,000 iterations, SHA-256 (OWASP 2026)
- Applies to all Results downloads: curated config JSON, migration report (.md),
  audit log (.csv), generated API code, and analytics export
- Each encrypted file is a self-describing `_encrypted: true` JSON envelope
  (saved with a `.enc` extension) carrying the algorithm, KDF parameters, and
  original filename alongside the base64 ciphertext
- Decryption: the envelope is self-describing so it can be decrypted out-of-band;
  in-app auto-detect/decrypt on import is **not yet wired** (tracked gap, not a
  shipped capability)

### Incident response (IR-4, IR-6) - external

Tool is stateless; incidents detected via Cloudflare dashboard logs. SIEM
integration would be deployment-side configuration.

### Third-party dependency risk (SA-9, SR-4) - addressed

Tailwind v4 bundles locally via `@tailwindcss/vite`. No CDN dependencies. CI
should run dependency scanning (`npm audit`).

### Secure disposal (MP-6) - implemented

`clearAllData()` button in footer:

- Clears all localStorage keys
- Clears form fields
- Reloads the page

`Cache-Control: no-store` applied to sensitive responses.

---

## Current security controls (✅ implemented)

| Control | Implementation |
|---------|----------------|
| Token masking in logs | Tokens masked as `cf_***...***` in console output |
| Tokens excluded from exports | Config JSON exports never include API tokens |
| Server-side API calls | All CF API calls made from Worker, not browser |
| Token validation endpoint | `/api/validate-token` verifies credentials before use |
| Dry-run mode | Preview all API calls without executing |
| Permission pre-check | Verify required permissions before migration |
| HTTPS only | Cloudflare Workers enforce HTTPS |
| No server-side token storage | Stateless Worker never persists tokens |
| API key rotation reminder | UI prominently reminds users to rotate keys after migration |
| Audit log download | Users can download API call log for review |
| Security headers | X-Content-Type-Options, Referrer-Policy, Cache-Control: no-store on all `/api/*` responses (CSP/HSTS/X-Frame-Options are future work / edge-supplied) |
| Body size limit | 10 MB on POST endpoints |
| Input validation | UUID + domain + body checks in `utils.ts` |
| Encrypted config export | AES-256-GCM, PBKDF2, optional password |
| Clear All Data | Explicit secure disposal in footer |

---

## Recommended deployment configuration

For improved security posture, deploy with:

```toml
# wrangler.toml
name = "twilight-zone"
main = "src/worker/index.ts"
compatibility_date = "2026-07-31"
# account_id set via CLOUDFLARE_ACCOUNT_ID at deploy time
```

Then configure on the deployment zone:

1. **Rate Limiting Rule** - e.g. 100 req/min per IP.
2. **Logpush** to an external logging service for audit trails (if persistent
   logging is required).
3. **WAF Custom Rules** for additional input validation.

---

## API token permissions

Twilight Zone calls 40+ Cloudflare API endpoints. Each requires a specific
permission. If an operation fails with `forbidden`, check that your token has
the required permission.

### Minimum required permissions

#### Source account token (read-only)

| Permission | Scope | Purpose |
|------------|-------|---------|
| Zone:Read | Zone | Read zone details and settings |
| Zone Settings:Read | Zone | Read zone settings |
| DNS:Read | Zone | Export DNS records |
| Page Rules:Read | Zone | Export page rules |
| Zone WAF:Read | Zone | Export WAF rulesets |
| Workers Routes:Read | Zone | Export worker routes |
| Workers Scripts:Read | Account | Export worker scripts + bindings |
| Load Balancing: Monitors And Pools:Read | Account | Export pools and monitors |
| Load Balancers:Read | Zone | Export load balancers |
| SSL and Certificates:Read | Zone | List custom certificates / hostnames |
| Access: Apps and Policies:Read | Account | Export Access configuration |
| Firewall Services:Read | Zone | Export firewall rules |
| Email Routing Rules:Read | Zone | Export email routing rules |
| Waiting Room:Read | Zone | Export waiting rooms |
| Zaraz:Read | Zone | Export Zaraz configuration |
| Turnstile:Read | Account | Export Turnstile widgets |
| Queues:Read | Account | Export queues and their consumers |

#### Destination account token (read + write)

Same as source, but with `Edit` instead of `Read`. Most notably:

| Permission | Scope | Purpose |
|------------|-------|---------|
| Zone:Edit | Account | Create new zone |
| Zone Settings:Edit | Zone | Update zone settings |
| DNS:Edit | Zone | Create DNS records |
| Zone WAF:Edit | Zone | Create WAF rulesets |
| Workers Scripts:Edit | Account | Upload worker scripts |
| Workers KV Storage:Edit | Account | Create KV namespaces |
| Workers R2 Storage:Edit | Account | Create R2 buckets |
| D1:Edit | Account | Create D1 databases |
| Queues:Edit | Account | Create queues and their consumers |
| Load Balancing: Monitors And Pools:Edit | Account | Create pools and monitors |
| Load Balancers:Edit | Zone | Create load balancers |
| SSL and Certificates:Edit | Zone | Upload certs, create hostnames |
| Access: Apps and Policies:Edit | Account | Create Access apps + policies |
| Email Routing Rules:Edit | Zone | Create email routing rules |
| Turnstile:Edit | Account | Create Turnstile widgets |

### API operations by endpoint

#### Zone-level

| API operation | Endpoint | Permission |
|--------------|----------|------------|
| Get Zone | `GET /zones/:id` | Zone:Read |
| Create Zone | `POST /zones` | Zone:Edit |
| List DNS Records | `GET /zones/:id/dns_records` | DNS:Read |
| Create DNS Record | `POST /zones/:id/dns_records` | DNS:Edit |
| List Zone Settings | `GET /zones/:id/settings` | Zone Settings:Read |
| Update Zone Setting | `PATCH /zones/:id/settings/:id` | Zone Settings:Edit |
| List Page Rules | `GET /zones/:id/pagerules` | Page Rules:Read |
| Create Page Rule | `POST /zones/:id/pagerules` | Page Rules:Edit |
| List Rulesets | `GET /zones/:id/rulesets` | Zone WAF:Read |
| Update Ruleset | `PUT /zones/:id/rulesets/phases/:phase/entrypoint` | Zone WAF:Edit |
| List Worker Routes | `GET /zones/:id/workers/routes` | Workers Routes:Read |
| Create Worker Route | `POST /zones/:id/workers/routes` | Workers Routes:Edit |
| List Load Balancers | `GET /zones/:id/load_balancers` | Load Balancers:Read |
| Create Load Balancer | `POST /zones/:id/load_balancers` | Load Balancers:Edit |
| List Spectrum Apps | `GET /zones/:id/spectrum/apps` | Zone:Read |
| Create Spectrum App | `POST /zones/:id/spectrum/apps` | Zone:Edit |
| List Custom Certificates | `GET /zones/:id/custom_certificates` | SSL and Certificates:Read |
| Upload Custom Certificate | `POST /zones/:id/custom_certificates` | SSL and Certificates:Edit |
| List Custom Hostnames | `GET /zones/:id/custom_hostnames` | SSL and Certificates:Read |
| Create Custom Hostname | `POST /zones/:id/custom_hostnames` | SSL and Certificates:Edit |
| List Firewall Rules | `GET /zones/:id/firewall/rules` | Firewall Services:Read |
| Create Firewall Rule | `POST /zones/:id/firewall/rules` | Firewall Services:Edit |
| List Rate Limits | `GET /zones/:id/rate_limits` | Zone:Read |
| Create Rate Limit | `POST /zones/:id/rate_limits` | Zone:Edit |
| List Email Routing Rules | `GET /zones/:id/email/routing/rules` | Email Routing Rules:Read |
| Create Email Routing Rule | `POST /zones/:id/email/routing/rules` | Email Routing Rules:Edit |
| List Waiting Rooms | `GET /zones/:id/waiting_rooms` | Waiting Room:Read |
| Create Waiting Room | `POST /zones/:id/waiting_rooms` | Waiting Room:Edit |
| Get Zaraz Config | `GET /zones/:id/zaraz/config` | Zaraz:Read |
| Update Zaraz Config | `PUT /zones/:id/zaraz/config` | Zaraz:Edit |

#### Account-level

| API operation | Endpoint | Permission |
|--------------|----------|------------|
| List Workers | `GET /accounts/:id/workers/scripts` | Workers Scripts:Read |
| Upload Worker | `PUT /accounts/:id/workers/scripts/:name` | Workers Scripts:Edit |
| Set Worker Secret | `PUT /accounts/:id/workers/scripts/:name/secrets` | Workers Scripts:Edit |
| List Pools | `GET /accounts/:id/load_balancers/pools` | Load Balancing: Monitors And Pools:Read |
| Create Pool | `POST /accounts/:id/load_balancers/pools` | Load Balancing: Monitors And Pools:Edit |
| List Monitors | `GET /accounts/:id/load_balancers/monitors` | Load Balancing: Monitors And Pools:Read |
| Create Monitor | `POST /accounts/:id/load_balancers/monitors` | Load Balancing: Monitors And Pools:Edit |
| List Access Apps | `GET /accounts/:id/access/apps` | Access: Apps and Policies:Read |
| Create Access App | `POST /accounts/:id/access/apps` | Access: Apps and Policies:Edit |
| List Turnstile Widgets | `GET /accounts/:id/challenges/widgets` | Turnstile:Read |
| Create Turnstile Widget | `POST /accounts/:id/challenges/widgets` | Turnstile:Edit |

### MaxConfig / MinConfig - additional permissions

The "all features on/off" presets exercise more API surface than a normal
migration. Additional permissions:

#### Zone-level

| Permission | Purpose |
|------------|---------|
| Zone:Edit | DNSSEC, Argo settings |
| DNS:Edit | DNSSEC DS records, edge-case record types (LOC/HTTPS/SVCB/…) |
| Snippets:Edit | Create/delete snippets |
| Email Routing Rules:Edit | Enable email routing |
| Firewall Services:Edit | Legacy firewall, access rules, lockdowns, UA rules |
| Page Shield:Edit | Enable + create/delete Page Shield policies |
| API Gateway:Edit | Update API Gateway schema validation |
| Cache Purge:Edit | Purge cache action endpoint |
| SSL and Certificates:Edit | Create/delete custom hostnames (SSL for SaaS) |
| Spectrum:Edit | Create/delete Spectrum apps (Enterprise) |

#### Account-level

| Permission | Purpose |
|------------|---------|
| Workers Scripts:Edit | Create/delete `maxconfig-worker` |
| Workers KV Storage:Edit | Create/delete `MAXCONFIG_KV` namespace |
| Workers R2 Storage:Edit | Create/delete `maxconfig-bucket` |
| D1:Edit | Create/delete `MAXCONFIG_DB` database |
| Billing:Edit | Zone subscription/plan mutation (very risky - only if contract permits) |

See [MAXCONFIG.md](MAXCONFIG.md) for the full MaxConfig permission list.

---

## Common permission errors and fixes

| Error message | Missing permission | Fix |
|---------------|-------------------|-----|
| `Authentication error [code: 10000]` | N/A | Invalid token or wrong account ID |
| `forbidden` on `/zones` | Zone:Edit | Add Zone:Edit to account scope |
| `forbidden` on `/dns_records` | DNS:Edit | Add DNS:Edit to zone scope |
| `forbidden` on `/workers/scripts` | Workers Scripts:Edit | Add Workers Scripts:Edit to account scope |
| `forbidden` on `/load_balancers/pools` | Load Balancing: Monitors And Pools:Edit | Add to account scope |
| `forbidden` on `/access/apps` | Access: Apps and Policies:Edit | Add to account scope |
| `forbidden` on `/zaraz/config` | Zaraz:Edit | Add Zaraz:Edit to zone scope |
| `forbidden` on `/challenges/widgets` | Turnstile:Edit | Add Turnstile:Edit to account scope |
| `forbidden` on `/email/routing/rules` | Email Routing Rules:Edit | Add to zone scope |
| `forbidden` on `/waiting_rooms` | Waiting Room:Edit | Add to zone scope |
| `not_entitled` | N/A | Feature not available on plan |
| `rate_limited` | N/A | Wait 60s and retry (automatic with backoff) |

---

## Token security best practices

1. **Never commit tokens** to version control.
2. **Use short expiration** for migration tokens (1–7 days).
3. **Revoke immediately** after migration completes.
4. **Different tokens** for source (read) and destination (write) where
   possible.
5. **Scope narrowly** to specific accounts/zones where possible.
6. **API Key + Email** is the super-admin path - convenient for migrations
   across multiple accounts, but rotate immediately after.

---

## Quick setup

### Option 1 - separate source/destination tokens (recommended)

**Source token** - `Read` permission:

- **Account:** Workers Scripts, Load Balancing: Monitors And Pools,
  Access: Apps and Policies, Turnstile
- **Zone:** Zone, Zone Settings, DNS, Page Rules, Zone WAF, Workers Routes,
  Load Balancers, SSL and Certificates, Firewall Services,
  Email Routing Rules, Waiting Room, Zaraz

**Destination token** - same scopes with `Edit` instead of `Read`.

### Option 2 - Global API Key (super admin)

Use the Global API Key from **My Profile → API Tokens → API Keys**. Requires
your account email address. Has full permissions to all accounts you're a
member of. Rotate immediately after migration.

---

## References

- [NIST SP 800-53 Rev 5](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final)
- [FedRAMP High Baseline](https://www.fedramp.gov/baselines/)
- [Cloudflare Security Headers](https://developers.cloudflare.com/workers/examples/security-headers/)
- [Cloudflare Rate Limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)
