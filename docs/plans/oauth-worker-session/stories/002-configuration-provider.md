# Story 002: Configuration and Provider Boundary

## Summary
Create fail-closed OAuth configuration and injectable authorization, token, and revocation clients.

## Dependencies
- Depends on: #001

## Requirements
- Parse `OAUTH_ENABLED`, `OAUTH_CLIENT_ID`, `OAUTH_COOKIE_KEY`,
  `OAUTH_COOKIE_KEY_ID`, `OAUTH_ALLOWED_ORIGIN`, `OAUTH_REDIRECT_URI`,
  `OAUTH_SOURCE_SCOPES`, and `OAUTH_DESTINATION_SCOPES`; enable only when the
  kill switch is exactly `true`.
- Parse each scope binding as a JSON array of unique non-empty strings; reject
  invalid JSON, non-arrays, duplicates, empty entries, and empty role sets with
  `oauth_config_invalid_scopes`.
- Require every scope to equal its untrimmed value and match the RFC 6749
  single-token ASCII range `^[\x21\x23-\x5B\x5D-\x7E]+$`; whitespace and
  control characters are invalid.
- Require client ID to match `[A-Za-z0-9._-]{1,200}`, key ID to match
  `[A-Za-z0-9_-]{1,32}`, and allowed origin to be canonical with no path, query,
  fragment, credentials, or non-default trailing slash. Require HTTPS except
  loopback development origins using `http://localhost[:1-65535]` or
  `http://127.0.0.1[:1-65535]`.
- Return `oauth_disabled`, `oauth_config_missing`, `oauth_config_invalid_key`,
  `oauth_config_invalid_client`, `oauth_config_invalid_origin`,
  `oauth_config_invalid_redirect`, or `oauth_config_invalid_scopes` for the
  corresponding malformed boundary.
- Keep role scope allowlists separate and validate exact origin/redirect values.
- Fix authorization to `GET https://dash.cloudflare.com/oauth2/auth` with `response_type=code`, `client_id`, exact `redirect_uri`, space-delimited `scope`, `state`, `code_challenge`, and `code_challenge_method=S256`.
- Fix token exchange to `POST https://dash.cloudflare.com/oauth2/token` as `application/x-www-form-urlencoded` with `grant_type=authorization_code`, `client_id`, `code`, exact `redirect_uri`, and `code_verifier`; send no client secret. Validate non-empty `access_token`, case-insensitive `Bearer` token type, positive integer `expires_in`, exact scope set, and reject refresh tokens.
- Fix revocation to `POST https://dash.cloudflare.com/oauth2/revoke` as `application/x-www-form-urlencoded` with `client_id`, `token`, and `token_type_hint=access_token`; only 2xx succeeds.
- Require the redirect URI to share the allowed origin, use exact path `/api/oauth/callback`, and contain no query or fragment.
- Parse provider responses once and apply a 10-second timeout without retrying code exchange.

## Acceptance Criteria
1. **Given** complete configuration, **When** parsed, **Then** every binding is present in a non-optional typed result and role scopes are normalized sets.
2. **Given** disabled or malformed configuration, **When** parsed, **Then** OAuth fails closed while manual auth remains available.
3. **Given** timeout or malformed provider JSON, **When** called, **Then** a stable non-secret error is returned.
4. **Given** captured provider requests, **When** inspected, **Then** method, URL, content type, parameters, scope encoding, and absence of client secret match the contract.

## Technical Notes
- **Files:** `src/worker/oauth/config.ts`, `src/worker/oauth/provider.ts`, focused tests
- **APIs:** Worker `Env`, injected `fetch`, `AbortSignal.timeout`
- **Patterns:** Dependency injection, discriminated errors

## Estimated Complexity
Medium
