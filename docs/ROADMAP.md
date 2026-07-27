# Potential future features

## "Sign in with Cloudflare" (OAuth)

Today, credentials are supplied as an API token or API key + email (Step 0).
A nicer flow would be a **"Sign in with Cloudflare" button** that runs the
OAuth 2.0 authorization-code + PKCE flow — the same one `wrangler login`
uses (`https://dash.cloudflare.com/oauth2/auth` → `/oauth2/token`). The
returned access token is a normal `Bearer` token against
`api.cloudflare.com/client/v4`, so it would drop into the existing auth path.
This would let users grant scoped access in one consent click instead of
hand-building a token (the dashboard token form cannot be deep-linked with
pre-selected permissions — permission selection happens only through a
CSRF-protected authenticated POST).

**Shippable in this public repo:** yes. A browser app must use a public
PKCE client, which has **no client secret** — the `client_id` is public by
design (wrangler's is hardcoded in open source). Nothing secret would live
in the repo.

**Blocked on two things before it can be built:**

1. **A provisioned OAuth client.** Cloudflare does not offer public OAuth
   app registration. This needs an internal request to the dash/identity
   team for a dedicated `client_id` with redirect URI
   `https://your-twilight-zone.example.com/oauth/callback` (request a
   **public/PKCE** client, not a confidential one).
2. **Scope coverage confirmation.** The OAuth scope catalog is much coarser
   than the API-token permission-group system and, as visible today, appears
   Workers-centric (no generic zone-settings/DNS/ruleset/LB/etc. write
   scopes). It is unverified whether the OAuth server can express the full
   set of zone-config writes a migration needs. If it cannot, OAuth would
   only cover part of the migration surface and remain a partial solution.
