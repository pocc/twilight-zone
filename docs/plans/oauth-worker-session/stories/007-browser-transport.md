# Story 007: Central Browser Request Transport

## Summary
Centralize JSON and SSE requests so OAuth mode consistently carries only the tab nonce.

## Dependencies
- Depends on: #005

## Requirements
- Generate and retain one nonce per page in `sessionStorage`, with exclusive
  origin-scoped Web Lock ownership held for the document lifetime.
- Attach nonce and explicit OAuth mode to all authenticated JSON, SSE, diff, zone, and prompt requests.
- Preserve manual/public behavior, cancellation, and parsing; eliminate direct authenticated fetches.
- Use `X-Twilight-Auth: oauth` and `X-Twilight-OAuth-Nonce`; omit every manual credential field in OAuth mode.

## Acceptance Criteria
1. **Given** first OAuth use, **When** requested, **Then** one nonce is created and attached.
2. **Given** a `window.open` tab with cloned `sessionStorage`, **When** its copied
   nonce lock is already owned, **Then** it rotates before any OAuth request and
   cannot use the original grant.
3. **Given** manual mode, **When** requested, **Then** no OAuth header is attached.
4. **Given** browser storage and payloads, **When** inspected, **Then** no provider secret appears.
5. **Given** an OAuth request, **When** inspected, **Then** it contains only the specified OAuth auth headers and no token, API key, email credential field, `Authorization`, `X-Auth-Key`, or `X-Auth-Email` header.

## Technical Notes
- **Files:** `app/lib/oauth.ts`, `app/lib/request.ts`, affected hooks and `app/lib/api.ts`
- **APIs:** `sessionStorage`, browser Web Crypto, `fetch`
- **Browser support:** Web Locks is required for OAuth. Unsupported browsers
  receive `oauth_browser_web_locks_unsupported`; manual auth remains available.
- **Patterns:** One authenticated transport

## Estimated Complexity
Large
