# API Reference

Twilight Zone's Worker exposes two API surfaces: the UI-facing `/api/*`
endpoints (used by the wizard) and the programmatic `/api/v1/*` API (pure JSON,
no SSE). All write endpoints are `POST` — see
[`src/worker/index.ts`](../src/worker/index.ts) for the routing table.

## UI-facing `/api/*` (streaming + JSON)

**Public read-only**

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/version` | Build version metadata |
| GET  | `/api/stats` | Aggregate run-log stats (drives the landing-page "N zones migrated" counter) |
| GET  | `/api/spec-status` | Hourly spec-drift monitor status: live Cloudflare OpenAPI write endpoints not yet in our baseline (see [SPEC_DRIFT_MONITOR.md](SPEC_DRIFT_MONITOR.md)) |
| GET  | `/favicon.svg` / `/favicon.ico` | App icon |

**Export endpoints** (read-only against source)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/export` | Synchronous: full zone export as JSON |
| POST | `/api/export/stream` | SSE: same export with live progress |
| POST | `/api/export/troubleshooting` | Synchronous: support-bundle export |
| POST | `/api/export/troubleshooting/stream` | SSE: support bundle with progress |
| POST | `/api/export/openapi` | Synchronous: "everything via OpenAPI" dump |
| POST | `/api/export/openapi/stream` | SSE: same with progress |
| POST | `/api/analytics/export` | Synchronous: source-analytics archive export |
| POST | `/api/analytics/export/stream` | SSE: source-analytics archive with progress (Step 3 "Archive source analytics") |
| POST | `/api/analytics/probe/stream` | SSE: per-dataset analytics access probe (drives the archive section's availability check) |

**Migration endpoints** (write to destination)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/migrate` | Synchronous: full migration in a single response |
| POST | `/api/migrate/stream` | SSE: full migration with live progress + `prompt` events |
| POST | `/api/migrate/account-resources` | SSE: pre-deploy account-scoped resources (LBs, KV, R2, D1, Access, Workers, Turnstile) |
| POST | `/api/migrate/respond` | Resolve a `prompt` event from `/api/migrate/stream` (e.g. supply a worker secret value) |
| POST | `/api/rollback` | Undo a partial migration on the destination (delete created resources) |
| POST | `/api/validate` | Dry-run validation: export source + validate against destination **without writing** |

**Terraform output**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/terraform/export` | Synchronous: emit Terraform HCL from source config |
| POST | `/api/terraform/export/stream` | SSE: same with progress |
| POST | `/api/terraform/import/stream` | SSE: generate `terraform import` script for existing dest resources |

**Pre-flight checks + utilities**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/validate-token` | Token shape + permission validation |
| POST | `/api/check-blockers` | Pre-migration blocker list (plan mismatch, etc.) |
| POST | `/api/check-capabilities` | Account capability probe (drives Step 2 entitlement UI) |
| POST | `/api/email-routing/send-verification` | Kick off email destination verification on dest |
| POST | `/api/email-routing/check-verification` | Poll verification status |
| POST | `/api/zones` | List zones for an account |
| POST | `/api/accounts` | List accounts visible to a token |
| POST | `/api/rdap` | Registrar / nameserver lookup |
| POST | `/api/available-plans` | Plans assignable to a zone |
| POST | `/api/diff/stream` | SSE: source↔destination diff (feeds the Scope "already identical" graying) |
| POST | `/api/monitor/ping` | Pre-cutover uptime monitor: one host-locked, SSRF-guarded ping (browser drives the 1/sec cadence) |
| ALL  | `/api/webhook-sink` | No-op `{ ok: true }` sink — test/diagnostic target for notification-webhook + monitor checks |

**Test fixture generation** (used by the fuzz harness)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/fuzz/stream` | SSE: fuzz a zone with random configuration |
| POST | `/api/maxconfig/stream` | SSE: apply MaxConfig (every feature on) |
| POST | `/api/minconfig/stream` | SSE: apply MinConfig (defaults) |

## Programmatic `/api/v1/*`

A pure JSON mirror of the same operations, with no SSE streaming. Useful for
scripting migrations without driving the UI. See
[`src/worker/api-v1.ts`](../src/worker/api-v1.ts) for the full route list.

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/v1` | API metadata + endpoint list |
| GET  | `/api/v1/docs` | Inline API documentation |
| POST | `/api/v1/*` | All v1 operations are POST. Mirrors `/api/*` minus SSE. |

## Example: full migration

```json
POST /api/migrate
{
  "sourceToken": "source-api-token",
  "destToken": "dest-api-token",
  "sourceAccountId": "source-account-id",
  "sourceZoneId": "zone-id",
  "destAccountId": "dest-account-id",
  "domainName": "optional-override.com",
  "dryRun": false,
  "workerSecrets": {
    "worker-name": { "SECRET_KEY": "secret-value" }
  },
  "customCertificates": [
    {
      "certificate": "-----BEGIN CERTIFICATE-----...",
      "privateKey": "-----BEGIN PRIVATE KEY-----..."
    }
  ],
  "acknowledgments": {
    "worker_secrets": true,
    "custom_certificate_keys": true
  }
}
```

## Example: export only

```json
POST /api/export
{
  "sourceToken": "your-api-token",
  "sourceAccountId": "account-id",
  "sourceZoneId": "zone-id"
}
```

## API token permissions

The full, canonical permission matrix — including the exact endpoint each
permission maps to — lives in
[`SECURITY.md` § API token permissions](SECURITY.md#api-token-permissions).

Twilight Zone migrates 30+ resource types, so the token needs more than the
DNS/zone basics. A token scoped only to the core permissions will hit
`forbidden` on R2, D1, KV, Turnstile, Email Routing, etc. — which surfaces as
failures mid-migration. Grant the full set below.

### Source account token (read-only)
- Zone:Read, Zone Settings:Read (Zone)
- DNS:Read (Zone)
- Page Rules:Read (Zone)
- Zone WAF:Read (Zone)
- Firewall Services:Read (Zone)
- Workers Routes:Read (Zone), Workers Scripts:Read (Account)
- Queues:Read (Account)
- Load Balancing: Monitors and Pools:Read (Account), Load Balancers:Read (Zone)
- SSL and Certificates:Read (Zone)
- Access: Apps and Policies:Read (Account)
- Email Routing Rules:Read (Zone)
- Waiting Room:Read (Zone)
- Zaraz:Read (Zone)
- Turnstile:Read (Account)

### Destination account token (read + write)
Same coverage as the source token, but with `Edit` instead of `Read`. Most
notably:
- Zone:Edit (create the new zone)
- Zone Settings:Edit, DNS:Edit, Page Rules:Edit, Zone WAF:Edit, Firewall Services:Edit (Zone)
- Workers Scripts:Edit, Workers KV Storage:Edit, Workers R2 Storage:Edit, D1:Edit, Queues:Edit (Account)
- Load Balancing: Monitors and Pools:Edit (Account), Load Balancers:Edit (Zone)
- SSL and Certificates:Edit (Zone)
- Access: Apps and Policies:Edit (Account)
- Email Routing Rules:Edit (Zone)
- Turnstile:Edit (Account)
