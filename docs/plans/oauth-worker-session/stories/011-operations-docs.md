# Story 011: Safe Configuration and Operations

## Summary
Document bindings, key rotation, deployment, local development, and the disabled-by-default production gate.

## Dependencies
- Depends on: #002, #009, #010

## Requirements
- Document variables versus secrets, exact URIs, role scopes, expiry, logout, and `/api/v1` isolation.
- Keep `OAUTH_ENABLED` off by default and commit no real identifiers or secrets.
- Document intentional session invalidation on cookie-key rotation.

## Acceptance Criteria
1. **Given** no OAuth configuration, **When** deployed, **Then** OAuth is disabled and manual auth works.
2. **Given** repository examples, **When** scanned, **Then** no real OAuth secret or identifier exists.
3. **Given** final bindings, **When** inspected, **Then** no persistence binding was added.

## Technical Notes
- **Files:** `wrangler.toml`, `README.md`, `docs/SECURITY.md`
- **APIs:** Worker variables and secrets
- **Patterns:** Disabled by default, placeholders only

## Estimated Complexity
Small
