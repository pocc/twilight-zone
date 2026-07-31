# Story 009: Logout and Session Clearing

## Summary
Implement role clearing, best-effort revocation, unconditional cookie cleanup, and nonce removal.

## Dependencies
- Depends on: #004, #007, #008

## Requirements
- Clear one role or logout both through same-origin POST routes.
- Attempt revocation independently and clear all cookies even on malformed grants or provider failure.
- Clear browser nonce after logout; add no persistent storage.

## Acceptance Criteria
1. **Given** two grants, **When** logout runs, **Then** both revocations are attempted and all cookies clear.
2. **Given** revocation failure, **When** logout completes, **Then** local cleanup still succeeds.
3. **Given** cross-origin clearing, **When** requested, **Then** no mutation occurs.
4. **Given** a malformed grant cookie, **When** logout runs, **Then** it emits no cookie content, clears that cookie, and still attempts revocation for the other valid role.

## Technical Notes
- **Files:** OAuth routes/provider, `useOAuthSession.ts`, lifecycle tests
- **APIs:** `POST /api/oauth/clear`, `POST /api/oauth/logout`
- **Patterns:** Best-effort remote action, unconditional local cleanup

## Estimated Complexity
Medium
