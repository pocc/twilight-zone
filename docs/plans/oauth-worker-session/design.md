# OAuth Worker Session Design

## Goal

Add a safer, user-friendly Cloudflare OAuth option without removing the existing
API token, API key, or `/api/v1` authentication paths.

## Architecture

- Use OAuth 2.0 Authorization Code with PKCE and no client secret.
- Do not request `offline_access` or retain refresh tokens.
- Run separate authorization flows for the read-only source role and the
  write-enabled destination role.
- Encrypt each access token with AES-256-GCM before placing it in a separate
  `HttpOnly`, `Secure`, `SameSite=Lax`, host-only cookie.
- Bind each encrypted cookie to a random nonce held only in that tab's
  `sessionStorage`. The browser sends the nonce in a custom request header, but
  JavaScript never receives an access token.
- Keep the existing bearer-token implementation in `src/api.ts` as the sole
  Cloudflare API authorization mechanism after credentials are resolved.

No Durable Object, D1 database, KV namespace, client secret, refresh token, or
server-side session record is required.

## Authorization Flow

1. The browser creates a cryptographically random tab nonce in
   `sessionStorage` and acquires an origin-scoped exclusive Web Lock for that
   nonce before sending an OAuth request. A `window.open` clone that inherits an
   already-owned nonce rotates to a fresh nonce before continuing.
2. The browser starts authorization for either the source or destination role.
3. The Worker creates a PKCE verifier and challenge plus a high-entropy OAuth
   state value.
4. The Worker encrypts temporary transaction state containing the verifier,
   state, role, tab-nonce hash, and issue time into a short-lived, role-specific
   `HttpOnly` cookie. One source and one destination transaction may coexist;
   restarting a role replaces only that role's transaction.
5. Cloudflare authenticates the user and redirects to the registered callback.
6. The Worker validates the transaction cookie, state, role, age, and callback
   parameters. The callback cannot read `sessionStorage`; nonce binding is
   therefore enforced before status is disclosed or the grant is used, not in
   the top-level callback request.
7. The Worker exchanges the code at Cloudflare's token endpoint and rejects
   unexpected token types or malformed expiry data.
8. The Worker encrypts the access token and its metadata into the role-specific
   cookie, clears the temporary transaction cookie, and redirects back to the
   setup page.

## Request Authentication

- The browser sends the tab nonce in a dedicated header on UI API requests.
- The central browser transport asynchronously establishes page-lifetime nonce
  ownership before any OAuth config, start, status, JSON, SSE, or prompt request.
  Browsers without Web Locks fail closed with an explicit unsupported-browser
  reason; manual authentication does not use this gate.
- Existing handlers continue accepting API tokens and API keys in request
  bodies.
- When body credentials are absent and OAuth is explicitly selected, a shared
  resolver decrypts the required source or destination cookie, verifies the
  nonce binding and expiry, and returns the existing `ApiAuth` bearer shape.
- Migration handlers resolve both roles before constructing
  `MigrationConfig`.
- `/api/v1` remains body-credential-only and never accepts browser cookies.
- OAuth-authenticated state-changing requests require a matching same-origin
  `Origin` header. This supplements `SameSite=Lax` CSRF protection.
- OAuth authentication and role authorization run in Hono middleware and place
  a typed `ResolvedAuthContext` in request context. Handlers do not parse OAuth
  cookies independently.
- Every UI route is classified declaratively as public, source, destination, or
  both. Absence of the required role fails closed and never falls through to
  manual authentication.

## Session Lifecycle

- Cookies have no `Expires` or `Max-Age` attribute.
- Closing a tab removes the nonce from `sessionStorage`, making retained or
  browser-restored cookies unusable from that tab.
- Closing a tab cannot reliably notify the Worker or revoke authorization.
- Logout sends both available access tokens to Cloudflare's revocation endpoint,
  clears all OAuth cookies, and clears the tab nonce.
- Expired tokens, rejected bearer tokens, and invalid cookies clear the affected
  cookie and require reauthorization. A nonce mismatch requires reauthorization
  without clearing the valid shared cookie, preserving the owning document.
- SSE routes validate cookies before committing stream headers. A bearer token
  rejected after streaming begins emits a typed `reauthorization_required`
  event; the browser then calls a same-origin session-clearing endpoint because
  an opened stream can no longer add `Set-Cookie`.
- There is no refresh behavior. The UI displays known expiry and prevents a
  migration from starting when the remaining lifetime is insufficient.

## Configuration

- `OAUTH_CLIENT_ID`: public OAuth client identifier.
- `OAUTH_COOKIE_KEY`: 32-byte encryption key supplied as a Worker secret.
- `OAUTH_SOURCE_SCOPES`: registered read-only scopes.
- `OAUTH_DESTINATION_SCOPES`: registered read/write scopes.
- `OAUTH_REDIRECT_URI`: exact registered callback URI.
- `OAUTH_ALLOWED_ORIGIN`: exact browser origin accepted for initiation,
  finalization, session clearing, logout, and OAuth-authenticated mutations.
- `OAUTH_ENABLED`: explicit kill switch; OAuth fails closed when it is not
  exactly `true`.
- Provider authorization, token, and revocation endpoints are fixed to the
  publicly documented `https://dash.cloudflare.com/oauth2/*` endpoints and are
  not configurable from requests.
- Missing or malformed OAuth configuration disables OAuth routes with explicit
  errors while leaving manual credentials operational.

## Error Handling

- OAuth callback errors are rendered as a safe redirect status; authorization
  codes, tokens, verifiers, cookies, and nonce values are never logged.
- State mismatch, transaction expiry, nonce mismatch, malformed token response,
  and invalid cookie authentication all fail closed.
- Cloudflare authorization, token, and revocation calls use explicit timeouts.
- Cloudflare API authentication failures invalidate the corresponding OAuth
  role without reclassifying authorization or entitlement errors.
- A token expiring during migration remains a visible migration failure; the
  system does not mask or silently retry it with weaker credentials.

## Testing

- Unit tests cover PKCE generation, AES-GCM round trips and tamper rejection,
  cookie attributes, transaction expiry, nonce binding, origin validation,
  role isolation, and token-response validation.
- Worker route tests cover authorization redirects, callback rejection paths,
  session status, logout, missing configuration, and manual-auth compatibility.
- Integration tests exercise middleware and actual Hono routes with real Worker
  bindings where practical; dependencies are injected rather than module-mocked.
- Client tests verify that OAuth mode sends only the tab nonce and never exposes
  token material.
- Existing typecheck, unit tests, build, and coverage gates remain required.
- A live private OAuth-client test must confirm scope names, token size, token
  lifetime, callback registration, source reads, and destination writes before
  enabling OAuth in production.

## Known Constraints

- `api.cloudflare.com` does not currently permit the required browser CORS
  preflight, so Cloudflare API calls must continue through the Worker.
- A malicious extension with sufficient page and cookie privileges may invoke
  authenticated application operations while the tab nonce is available.
  Encryption prevents extraction of a directly usable Cloudflare bearer token;
  it does not make an actively compromised browser trustworthy.
- Access-token lifetime and encrypted cookie size require validation with the
  registered OAuth client.
