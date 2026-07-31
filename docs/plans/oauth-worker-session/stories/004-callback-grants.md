# Story 004: Callback and Role Grants

## Summary
Validate callbacks, exchange codes once, establish encrypted role cookies, and expose nonce-bound status.

## Dependencies
- Depends on: #003

## Requirements
- Validate callback state, transaction age/context, token type, expiry, and exact returned scopes.
- Create only the requested role cookie and clear consumed transaction cookies.
- Include a new random 128-bit grant ID in each encrypted grant.
- Disclose role metadata only after tab nonce binding succeeds.
- Redirect only with HTTP 303 to the fixed setup result URLs defined by the PRD.

## Acceptance Criteria
1. **Given** a valid callback, **When** exchanged, **Then** the correct role cookie is created and transaction removed.
2. **Given** invalid state, age, scope, or payload, **When** handled, **Then** no grant is created.
3. **Given** mismatched nonce, **When** status is requested, **Then** no grant metadata is disclosed.
4. **Given** callback responses, **When** inspected, **Then** they are `no-store`, `no-referrer`, and secret-free.
5. **Given** malformed, replayed, back-navigation, or redirect-injection callbacks, **When** handled, **Then** they reach only the fixed allowlisted error destination and create no grant.
6. **Given** a successful grant, **When** `Set-Cookie` is inspected, **Then** it uses the fixed role `__Host-` name with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`, and omits `Domain`, `Max-Age`, and `Expires`.

## Technical Notes
- **Files:** `src/worker/oauth/grants.ts`, route tests
- **APIs:** `GET /api/oauth/callback`, `POST /api/oauth/status`
- **Patterns:** Deferred nonce verification before grant use

## Estimated Complexity
Large
