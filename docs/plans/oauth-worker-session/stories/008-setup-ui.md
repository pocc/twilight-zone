# Story 008: OAuth Setup and Expiry UI

## Summary
Add OAuth mode with independent role status, operation-aware gates, and manual fallback.

## Dependencies
- Depends on: #006, #007

## Requirements
- Show source/destination authorization, scopes, expiry, and disabled configuration state.
- Require roles by source mode and enforce 35-minute start and 20-minute phase-two thresholds.
- Preserve existing desktop/mobile design and manual mode behavior.

## Acceptance Criteria
1. **Given** enabled OAuth, **When** setup renders, **Then** OAuth is available beside manual modes.
2. **Given** disabled OAuth, **When** rendered, **Then** manual modes remain usable.
3. **Given** destination-only import/preset mode, **When** destination is connected, **Then** source is not required.
4. **Given** insufficient or unknown expiry, **When** migration starts, **Then** it is blocked with reauthorization.
5. **Given** clock-injected values at each threshold, **When** readiness is calculated, **Then** equality passes and one millisecond below fails.
6. **Given** 390x844 and 1440x900 viewports, **When** setup renders, **Then** all OAuth and fallback controls are visible and operable without horizontal clipping.

## Technical Notes
- **Files:** `Step0Credentials.tsx`, `useCredentials.ts`, `useOAuthSession.ts`, `App.tsx`
- **APIs:** OAuth config/start/status routes
- **Patterns:** Explicit auth mode, role-aware readiness

## Estimated Complexity
Large
