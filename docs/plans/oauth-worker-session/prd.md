# OAuth Worker Session - Product Requirements Document

| Field | Value |
|-------|-------|
| **Project** | oauth-worker-session |
| **Date** | 2026-07-30 |
| **Status** | Proposed implementation |
| **Author** | Ross Jacobs |

---

## Problem Statement

Twilight Zone currently asks users to paste Cloudflare API tokens or a Global
API Key into a public web application. The credentials are scoped and retained
only in browser session storage, but the interaction creates justified concern:
users must create credentials manually, disclose them to application
JavaScript, and remember to revoke them afterward. This reduces adoption and
makes the Global API Key fallback especially unattractive.

Cloudflare now supports public OAuth clients using Authorization Code with
PKCE. Twilight Zone can use that flow to provide Cloudflare-hosted consent,
account selection, permission disclosure, and revocation while keeping bearer
tokens out of page JavaScript. Cloudflare's API does not permit the browser CORS
preflight required for direct API access, so authenticated API calls must still
pass through the Worker.

## Goals & Non-Goals

### Goals

- Make OAuth the safer and easier browser authentication option.
- Keep Cloudflare access tokens unavailable to application JavaScript.
- Preserve source-read and destination-write least privilege through separate
  authorization flows.
- Avoid server-side session databases and refresh-token retention.
- Preserve all existing API-token, API-key, and `/api/v1` behavior.
- Fail closed on malformed, expired, tampered, cross-origin, or misconfigured
  OAuth requests.
- Make authorization status and token expiry visible before migration begins.

### Non-Goals

- Removing manual API credentials.
- Adding OAuth to `/api/v1` or other non-browser automation.
- Supporting refresh tokens, `offline_access`, background sessions, or durable
  login across browser sessions.
- Making direct browser calls to `api.cloudflare.com`.
- Protecting an actively compromised browser from invoking actions the user can
  invoke through Twilight Zone.
- Creating or promoting the production OAuth client automatically.
- Performing optional Durable Object state copying in OAuth mode. That path
  temporarily instruments the source Worker and therefore requires elevated
  source write authority; it remains available only through explicit manual
  credentials and is disclosed as unavailable under read-only source OAuth.

## User Stories / Use Cases

- **As a** migration operator, **I want** to authorize Twilight Zone through a
  Cloudflare consent screen **so that** I do not paste a reusable credential
  into the page.
- **As a** security-conscious administrator, **I want** source and destination
  access authorized independently **so that** the source remains read-only.
- **As a** user whose account blocks public OAuth applications, **I want** the
  existing token flow to remain available **so that** I can still migrate.
- **As a** user, **I want** to see authorization expiry before applying changes
  **so that** an avoidable expiry does not interrupt migration.
- **As a** user, **I want** logout to revoke authorization and clear local
  session material **so that** the browser cannot continue using the grant.

## Requirements

### Functional Requirements

1. The setup UI must offer OAuth alongside API Token and API Key modes.
2. The browser must create a cryptographically random tab nonce and retain it
   only in `sessionStorage`.
3. Source and destination OAuth authorization must be initiated separately and
   request their configured read and write scope sets respectively.
4. The Worker must generate the OAuth state, PKCE verifier, and S256 challenge.
5. Temporary OAuth transaction state must be authenticated and encrypted in an
   `HttpOnly` cookie and expire after a short fixed callback window.
6. The callback must verify state, transaction age, role, redirect context, and
   Cloudflare token response before establishing a pending grant. Because a
   top-level callback cannot send the `sessionStorage` nonce header, nonce
   binding must be enforced before status is disclosed or the grant is used.
7. Access tokens and metadata must be encrypted with AES-256-GCM in separate
   source and destination host-only cookies with `HttpOnly`, `Secure`, and
   `SameSite=Lax` attributes and no persistent lifetime attributes.
8. OAuth cookies must be cryptographically bound to the tab nonce supplied in a
   dedicated request header. Before sending that header, each document must own
   an origin-scoped exclusive Web Lock for its `sessionStorage` nonce. A cloned
   tab must rotate a nonce whose lock is already owned. Browsers without Web
   Locks must disable OAuth with an explicit error while preserving manual auth.
9. JavaScript-visible APIs may return role, expiry, scope, and connection state,
   but must never return an authorization code, access token, PKCE verifier,
   cookie plaintext, or encryption key.
10. Existing UI API handlers must resolve source and destination OAuth grants
    into the existing `ApiAuth` bearer representation when OAuth is selected.
11. Body credentials must continue to work unchanged and take precedence only
    when the request explicitly selects a manual authentication mode.
12. `/api/v1` must ignore OAuth cookies. Its migration operations continue
    requiring body credentials; public `GET /api/v1` and `GET /api/v1/docs`
    remain public documentation endpoints.
13. OAuth-authenticated mutating requests must validate that `Origin` exactly
    matches the request URL origin.
14. Expired, tampered, or authentication-rejected grants must clear the affected
    cookie and return a reauthorization-required response. A valid grant
    presented with another document's nonce must be rejected without clearing
    the shared cookie, so the owning document remains connected.
15. Logout must attempt revocation for source and destination grants, clear all
    OAuth cookies even when revocation fails, and instruct the browser to clear
    its tab nonce.
16. The UI must show each role's connected state and expiry and must prevent a
    migration from starting when either required grant has insufficient known
    remaining lifetime.
17. Missing OAuth bindings must disable only OAuth controls and routes, with a
    clear configuration message; manual authentication must remain operational.
18. OAuth transaction cookies must use fixed role-specific names plus `__Host-`,
    `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and a five-minute `Max-Age`.
    At most one source and one destination transaction may exist; restarting a
    role replaces only that role's transaction.
19. The Worker must use the exact configured `OAUTH_REDIRECT_URI` and
    `OAUTH_ALLOWED_ORIGIN`; forwarded host values must not influence either.
20. Returned OAuth scopes must contain every requested role scope and no scope
    outside that role's configured allowlist. A source grant must never resolve
    for a destination route.
21. OAuth authorization, token exchange, and revocation fetches must use an
    explicit 10-second timeout and must not retry non-idempotent code exchange.
22. OAuth must have an `OAUTH_ENABLED` kill switch that defaults off and is
    covered by tests.
23. Synchronous and SSE routes must validate the required grant before response
    headers are committed. Mid-stream authentication rejection must emit a
    typed `reauthorization_required` event, after which the browser calls a
    same-origin cookie-clearing endpoint.
24. OAuth errors must use stable machine-readable reason codes without secret
    values.
25. The browser transport must use `X-Twilight-Auth: oauth` and
    `X-Twilight-OAuth-Nonce: <nonce>`. OAuth requests must omit all manual
    credential fields and must await nonce-lock ownership before sending.
26. Callback completion must always return HTTP 303 to the fixed same-origin
    path `/?oauth_result=connected&oauth_role=<source|destination>` or
    `/?oauth_result=error&oauth_reason=<allowlisted-code>`. No user-controlled
    return URI or arbitrary query value may influence the redirect.
27. Pending migration prompts must be bound to a hash of the OAuth grant IDs,
    nonce hash, required roles, and source/destination account IDs. Responses
    from another tab, grant, role set, account pair, or migration must fail.
28. Grant IDs and migration IDs must be independently generated 128-bit random
    base64url values. Prompt context comparisons must use a fixed-length digest
    and non-early-exit comparison.
29. Each serialized OAuth `Set-Cookie` header must be at most 3800 UTF-8 bytes.
    Combined OAuth cookie pairs in an incoming `Cookie` header must be at most
    12000 UTF-8 bytes. Values above either limit fail closed before parsing.

### Non-Functional Requirements

1. OAuth credentials, authorization codes, verifiers, state, cookie values, and
   tab nonces must never enter logs, reports, analytics, downloaded files, SSE
   events, or error details.
2. Cryptographic comparisons of state and nonce hashes must avoid ordinary
   early-exit string comparison where practical.
3. Cookie encryption must use Web Crypto AES-256-GCM with unique random IVs,
   authenticated version/role context, and strict payload validation.
4. OAuth code paths must not weaken the existing request body size, UUID,
   domain, error classification, security header, or audit behavior.
5. The implementation must work in the Workers runtime and local Vitest
   environment without Node-only cryptographic APIs.
6. The setup page must remain usable on desktop and mobile and retain the
   existing visual language.
7. OAuth must add no Durable Object, D1, KV, R2, or other persistence binding.
8. The source and destination cookies plus request headers must remain below
   platform and browser limits measured during live validation.
9. OAuth dependencies must be injected into pure boundary functions so tests do
   not require module-level mocks.

## Architecture & Design

```text
Browser tab                           Twilight Zone Worker             Cloudflare
-----------                           --------------------             ----------
sessionStorage nonce  -- header -->   nonce binding
                       -- start -->   state + PKCE transaction cookie
                                      ---------------- redirect ---------------->
                                      <--------------- callback ----------------
                                      code exchange ---------------------------->
encrypted HttpOnly role cookie <----  AES-GCM(access token + metadata)
API request + nonce ---------------->  decrypt + validate
                                      Authorization: Bearer token -------------->
```

The browser stores only encrypted cookies and a tab-specific nonce. The Worker
stores no session state between requests. A temporary encrypted transaction
cookie carries the PKCE verifier through the authorization redirect. Following
the callback, source and destination role cookies independently carry encrypted
access-token payloads.

A shared OAuth middleware adapts validated cookie payloads to a typed
`ResolvedAuthContext` stored in Hono request variables. Handlers continue to
call the existing Cloudflare API layer rather than introducing an OAuth-specific
transport or re-parsing cookies.

The callback validates provider state and creates the encrypted role cookie,
but that cookie remains unusable until a same-origin request supplies the tab
nonce whose hash is authenticated inside the cookie. This is deferred nonce
verification, not a weaker callback comparison that the browser cannot perform.

## Technical Approach

- Add a focused Worker OAuth module for PKCE, AES-GCM envelopes, cookie parsing
  and serialization, configuration validation, transaction handling, role grant
  resolution, origin checks, and revocation.
- Add a modular Hono OAuth sub-application for configuration/status,
  authorization start, callback, role clearing, and logout. Callback remains a
  browser GET; all other operations are same-origin POST operations.
- Parse callback parameters, decrypted envelopes, and provider JSON exactly once
  at their boundaries into discriminated types.
- Add an explicit UI authentication mode rather than inferring OAuth from the
  presence of cookies.
- Add a client OAuth utility that owns the tab nonce and automatically attaches
  its header to OAuth-mode `/api/*` requests.
- Refactor shared worker authentication parsing minimally so handlers can await
  OAuth resolution without changing the Cloudflare API client.
- Keep source and destination cookies and scope configuration distinct.
- Use a versioned encrypted envelope so incompatible future payload changes fail
  closed instead of being interpreted ambiguously.
- Do not request refresh scopes. Once expiry is reached, require a new grant.
- Decode `OAUTH_COOKIE_KEY` from canonical base64url, require exactly 32 bytes,
  include a key identifier in each envelope, and intentionally invalidate
  existing sessions when the configured key identifier changes.
- Use a unique CSPRNG-generated 96-bit IV for every AES-GCM envelope and include
  version, role, cookie purpose, and production origin as authenticated data.

### Route Authentication Matrix

| Route group | Required OAuth role |
|-------------|---------------------|
| Version, stats, spec status, feedback, webhook sink, OAuth config/start/callback | Public; start still requires exact origin and nonce |
| OAuth status | OAuth role cookies optional; disclose connected metadata only after nonce binding |
| OAuth clear/logout | Same-origin OAuth session mutation |
| Validate token | Manual body credentials only |
| Accounts/zones listing | Explicit source or destination selected by request |
| Standard export, troubleshooting export, OpenAPI export, Terraform export, analytics export/probe | Source |
| `/api/export/stream` destination advisory read | Source by default; destination only when the request explicitly declares `oauthRole: destination`, used to inspect an existing destination zone during preset review. This exception is read-only and does not grant destination authority to any other source export route. |
| Capabilities, available plans, destination zone creation, email verification, rollback, Terraform import, presets, fuzz | Destination |
| Validate, blocker check, destination diff, account migration, zone migration | Both |
| Migration prompt response | Same authorized migration context established before stream |
| Monitor ping | Source |
| RDAP | Public utility; no Cloudflare bearer authority |
| `/api/v1/*` | Body credentials only; OAuth cookies ignored |
| `GET /api/v1`, `GET /api/v1/docs` | Public documentation |

### Mode Requirements

| Source mode | Required roles |
|-------------|----------------|
| API migration | Source and destination |
| JSON/Terraform import | Destination |
| Preset | Destination |
| Source export/download only | Source |

### Expiry Policy

- Compute `remaining = expiresAtMs - nowMs`; accept only when
  `remaining >= operationBudgetMs + 300000`. Equality is accepted.
- Use a 30-minute budget for a full two-phase migration, producing a 35-minute
  threshold; recheck the 15-minute zone stream at a 20-minute threshold.
- Use a 15-minute budget for other SSE routes (20-minute threshold) and a
  two-minute budget for synchronous routes (seven-minute threshold).
- If the provider omits a usable expiry, OAuth migration is denied rather than
  assuming an unlimited session.

Alternatives rejected:

- Durable Objects and D1 add persistence and coordination that are unnecessary
  without refresh tokens.
- KV is eventually consistent and unnecessary for a stateless encrypted-cookie
  design.
- Raw access-token cookies expose a directly usable Cloudflare bearer token to
  privileged browser tooling and extensions.
- JavaScript-held tokens recreate the exposure this project is intended to
  remove and still cannot call the Cloudflare API because of CORS.

## Security & Privacy Considerations

- The OAuth client is public and uses PKCE S256; no client secret exists.
- AES-GCM protects token confidentiality and cookie integrity. The 32-byte key
  is supplied only through `OAUTH_COOKIE_KEY` as a Worker secret.
- State prevents login CSRF; nonce binding limits retained-cookie use to the
  originating tab context; `SameSite=Lax` and exact origin validation protect
  application operations from cross-site requests.
- Host-only cookies omit `Domain`. Production cookie names use the `__Host-`
  prefix and `Path=/`.
- Tokens remain bearer credentials inside the Worker request. They must be
  scoped narrowly and never copied into errors or observability fields.
- An extension that controls the page while the tab nonce exists may invoke
  authenticated Twilight Zone actions. The design prevents extracting a token
  for direct Cloudflare API use but cannot make a compromised browser safe.
- Browser tab closure cannot reliably trigger revocation. Loss of the
  `sessionStorage` nonce makes retained cookies unusable through the app;
  Cloudflare authorization remains until token expiry or explicit revocation.
- Authentication and authorization denials emit structured reason codes and a
  request identifier but never token, code, verifier, state, nonce, cookie,
  account name, or email values. Platform-level URL logging of callback query
  parameters must be verified before production enablement.
- Callback responses use `Referrer-Policy: no-referrer` and `Cache-Control:
  no-store`.

## Testing Strategy

- Unit-test PKCE verifier/challenge generation against deterministic vectors.
- Unit-test encryption round trips, unique IVs, authenticated role/version data,
  wrong keys, malformed envelopes, and tamper rejection.
- Unit-test cookie attributes and clearing behavior.
- Unit-test transaction age, state, nonce, role, origin, and token-response
  validation with positive and negative controls.
- Route-test start, callback, status, logout, missing configuration, callback
  errors, and revocation failure behavior.
- Regression-test manual token/API-key handlers and `/api/v1` with OAuth cookies
  present to prove compatibility and isolation.
- Client-test tab nonce creation, reuse, clearing, and header attachment while
  asserting that token-shaped values never enter browser state.
- Run typecheck, all unit tests, production build, and coverage checks.
- Add Playwright coverage for redirect completion, back/reload behavior,
  concurrent role transactions, cross-tab nonce rejection, manual/OAuth mode
  switching, JSON/preset destination-only flows, expiry between phases, typed
  SSE reauthorization, cookie-size rejection, and logout when revocation fails.
- Verify the fixed 303 callback destinations and reject malformed callbacks,
  replay/back navigation, and open-redirect attempts.
- Verify OAuth mode disables and discloses optional Durable Object state copy,
  while an explicitly elevated manual source credential retains that path.
- Every negative security test must include a positive control proving the test
  can distinguish an accepted valid request from the rejected case.
- Before production enablement, run a live private-client test that exercises
  source account listing/export and destination capability/write operations.
  Record actual scope identifiers, token lifetime, encrypted cookie sizes, and
  revocation behavior.

## Open Questions

None block implementation. Production enablement remains gated on live OAuth
client validation of registered scopes, token lifetime, and cookie size.


## Success Criteria

- A user can independently authorize source and destination access and complete
  the normal migration wizard without entering an API token or API key.
- Browser JavaScript never receives Cloudflare access tokens.
- Source OAuth access cannot be used as destination write access.
- Tampered, expired, cross-tab, and cross-origin requests are rejected by tests.
- Logout clears all OAuth cookies and attempts revocation of both grants.
- Manual UI authentication and `/api/v1` pass their existing regression suites.
- No new persistent storage binding is introduced.
- OAuth remains disabled in production until the complete live validation gate
  succeeds.
