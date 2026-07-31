# Story 013: Live Private-Client Production Gate

## Summary
Measure and verify the real provider contract before separately enabling production OAuth.

## Dependencies
- Depends on: #012

## Requirements
- Keep production OAuth disabled while validating exact scopes, callback, token lifetime, cookie sizes, and revocation.
- Exercise source listing/export and an isolated destination capability check/write.
- Prove source authority cannot perform destination writes and sanitize all evidence.
- Use only public documentation, runtime configuration, and sanitized measured evidence; repository artifacts must not request, cite, or depend on internal documentation.

## Acceptance Criteria
1. **Given** a private client, **When** both flows complete, **Then** exact callbacks and scope allowlists validate.
2. **Given** live tokens/cookies, **When** measured, **Then** lifetime and size satisfy documented limits.
3. **Given** source and destination operations, **When** exercised, **Then** correct roles succeed and source writes fail.
4. **Given** revocation, **When** grants are reused, **Then** Cloudflare rejects them and local state clears.
5. **Given** any failed criterion, **When** readiness is recorded, **Then** production OAuth remains disabled.
6. **Given** repository gate artifacts, **When** reviewed, **Then** they contain no internal documentation references or copied internal material.
7. **Given** measured live cookies, **When** UTF-8 sizes are calculated, **Then** every `Set-Cookie` is at most 3800 bytes and combined OAuth cookies are at most 12000 bytes, or production remains disabled.

## Technical Notes
- **Files:** Sanitized evidence template and optional repeatable validation script
- **APIs:** Registered private OAuth client and controlled Cloudflare resources
- **Patterns:** Measured evidence, secret redaction, separate enablement action

## Estimated Complexity
Medium
