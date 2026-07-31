# Story 003: Role-Specific Authorization Start

## Summary
Add configuration and same-origin authorization-start routes with isolated PKCE transactions.

## Dependencies
- Depends on: #001, #002

## Requirements
- Require role, allowed origin, and tab nonce; request only that role's scopes.
- Store verifier, state, role, nonce hash, and issue time in one fixed cookie per role.
- Apply `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and five-minute `Max-Age`.

## Acceptance Criteria
1. **Given** a valid role request, **When** started, **Then** the URL uses S256, exact redirect URI, and only role scopes.
2. **Given** concurrent source and destination starts, **When** cookies are set, **Then** both coexist; restarting one role replaces only that role and never creates a third transaction cookie.
3. **Given** invalid origin, nonce, role, or config, **When** started, **Then** no transaction is created.

## Technical Notes
- **Files:** `src/worker/oauth/routes.ts`, route tests
- **APIs:** `POST /api/oauth/config`, `POST /api/oauth/start`
- **Patterns:** Modular Hono sub-app, exact-origin checks

## Estimated Complexity
Medium
