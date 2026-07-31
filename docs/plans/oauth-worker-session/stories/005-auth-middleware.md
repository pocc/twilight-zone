# Story 005: Shared OAuth Authentication Middleware

## Summary
Resolve validated cookies into typed source/destination `ApiAuth` context without manual fallback.

## Dependencies
- Depends on: #004

## Requirements
- Model public, manual-only, source, destination, both, and dynamic-role policies.
- Resolve OAuth only when explicitly selected and enforce origin, nonce, role, expiry, and lifetime.
- Clear invalid cookies before response headers commit.
- Inject the clock and enforce `remaining >= budget + 300000`, accepting the
  exact boundary and rejecting one millisecond below it.

## Acceptance Criteria
1. **Given** a valid required role, **When** middleware runs, **Then** typed bearer auth reaches the handler.
2. **Given** source authority on a destination route, **When** resolved, **Then** access is denied.
3. **Given** failed OAuth plus valid body credentials, **When** OAuth was selected, **Then** no fallback occurs.
4. **Given** manual mode, **When** called, **Then** existing body auth remains unchanged.
5. **Given** lifetime exactly at or below a route threshold, **When** evaluated, **Then** equality is accepted and one millisecond below is rejected.

## Technical Notes
- **Files:** `src/worker/oauth/middleware.ts`, `src/worker/index.ts`, middleware tests
- **APIs:** Hono typed variables, existing `ApiAuth`
- **Patterns:** Authentication/authorization before handlers

## Estimated Complexity
Large
