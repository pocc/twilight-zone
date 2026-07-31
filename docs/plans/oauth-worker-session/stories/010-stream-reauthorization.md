# Story 010: Streaming Reauthorization

## Summary
Handle authorization loss before and during SSE without masking other failures.

## Dependencies
- Depends on: #006, #007, #009

## Requirements
- Resolve required grants before opening streams.
- Emit one typed `reauthorization_required` event for mid-stream bearer rejection.
- Clear the role through the browser endpoint and never retry with weaker credentials.

## Acceptance Criteria
1. **Given** invalid preflight auth, **When** SSE is requested, **Then** no stream headers commit.
2. **Given** mid-stream bearer rejection, **When** detected, **Then** one role-specific typed event is emitted.
3. **Given** entitlement failure, **When** detected, **Then** it is not misclassified as reauthorization.
4. **Given** the event, **When** handled, **Then** the role clears and reconnect UI appears.

## Technical Notes
- **Files:** streaming handlers, `useStreamRequest.ts`, `App.tsx`, tests
- **APIs:** Typed SSE event union
- **Patterns:** Fail visibly, no fallback or status downgrade

## Estimated Complexity
Large
