# Story 006: Exhaustive UI Route Policy

## Summary
Apply one declarative authentication policy to every UI route while isolating `/api/v1`.

## Dependencies
- Depends on: #005

## Requirements
- Implement the PRD route matrix, including dynamic account/zone role and source-authenticated monitor ping.
- Bind prompt responses to their migration authorization context.
- Bind prompts to grant IDs, nonce hash, roles, account IDs, and migration ID.
- Generate a fresh 128-bit migration ID before migration starts; store a fixed-length context digest beside each pending prompt and compare response context without early exit.
- Include only opaque `migrationId` and `promptId` identifiers in each prompt
  event. The browser returns those identifiers plus the answer. The server looks
  up the pending prompt by both IDs and compares its stored digest against a new
  digest derived from the server-stored migration ID plus middleware-resolved
  grant IDs, nonce hash, roles, and account IDs. The returned migration ID is
  used only as an opaque lookup key; client-supplied context fields are never
  accepted as digest inputs.
- Classify OAuth status, clear/logout, manual token validation, and public API v1 documentation explicitly.
- Disable and disclose optional Durable Object state copy in OAuth mode because it writes temporary source instrumentation.
- Preserve guards, validation, headers, audit behavior, and body-only `/api/v1` auth.

## Acceptance Criteria
1. **Given** all registered UI routes, **When** exhaustiveness tests run, **Then** every route has one policy.
2. **Given** missing authority, **When** a protected route is called, **Then** no handler or stream starts.
3. **Given** OAuth cookies without `/api/v1` body credentials, **When** called, **Then** `/api/v1` rejects them.
4. **Given** monitor ping, **When** called, **Then** source authority still binds its canonical zone target.
5. **Given** a prompt response from another tab, grant, role, account pair, or migration, **When** submitted, **Then** it cannot resolve the pending prompt.
7. **Given** forged client role, grant, nonce, or account context fields, **When** a prompt response is submitted, **Then** those fields are ignored or rejected and cannot influence the server-derived comparison.
6. **Given** OAuth mode requests DO state copy, **When** scope is reviewed, **Then** it is disabled and disclosed; elevated manual auth remains supported.

## Technical Notes
- **Files:** `src/worker/index.ts`, `test/oauthRouteMatrix.test.ts`
- **APIs:** Existing Hono route table
- **Patterns:** Declarative path/method/handler/policy definitions

## Estimated Complexity
Large
