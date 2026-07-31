# Story 012: Regression and Security Verification

## Summary
Prove OAuth behavior, rejection controls, browser lifecycle, and compatibility across the application.

## Dependencies
- Depends on: #001 through #011

## Requirements
- Add integration-heavy route tests and Playwright flows for callback, tabs, modes, expiry, streams, and logout.
- Pair each rejection test with a valid positive control.
- Verify canary secrets never enter storage, logs, errors, SSE, reports, analytics, or downloads.
- Cover fixed callback redirects, replay/back navigation, malformed and oversized cookies, both specified viewports, and complete API/import/preset/export mode combinations.
- Verify OAuth disables DO state copying and elevated manual auth preserves it.
- Run typecheck, unit tests, build, and coverage gates.

## Acceptance Criteria
1. **Given** every security rejection, **When** tested, **Then** its valid control succeeds and invalid case fails.
2. **Given** OAuth cookies on manual and `/api/v1` requests, **When** tested, **Then** existing body auth is unchanged.
3. **Given** secret canaries, **When** all artifacts are searched, **Then** none are present.
4. **Given** verification commands, **When** run, **Then** each succeeds.
5. **Given** UTF-8 `Set-Cookie` fixtures of 3800 and 3801 bytes, **When** validated, **Then** 3800 passes and 3801 fails; combined OAuth cookie pairs at 12000 bytes pass and 12001 bytes fail before parsing.

## Technical Notes
- **Files:** Focused `test/oauth*.test.ts` and Playwright coverage
- **APIs:** Hono test client, Vitest, Playwright
- **Patterns:** No evidence-missing passes

## Estimated Complexity
Large
