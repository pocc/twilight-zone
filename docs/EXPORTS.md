# Exports

Twilight Zone supports multiple export flavors, depending on whether you want:

- A **migration-oriented** snapshot (stable shape, typed).
- A **troubleshooting-oriented** snapshot (LLM-friendly, reduced + reorganized).
- An **OpenAPI-derived everything** snapshot (endpoint-coverage-first).
- A **Terraform** configuration (Cloudflare provider v5.17).

## JSON export types

### 1) Migration export (`ZoneExport`)

- Endpoint: `POST /api/export` and `POST /api/export/stream`
- Shape: `ZoneExport` in `src/types.ts`
- Producer: `exportZone()` in `src/migrate.ts`
- Goal: high-signal, migratable configuration with the account-scoped
  dependencies needed for a successful migration

Notes:

- This export is curated (not OpenAPI-complete).
- It includes workers and the account-scoped dependencies that are needed
  for migration.

### 2) Troubleshooting export (LLM-friendly)

- Endpoint: `POST /api/export/troubleshooting` and
  `POST /api/export/troubleshooting/stream`
- Producer: `exportZoneTroubleshooting()` in `src/troubleshooting-export.ts`
- Goal: easy for large language models to read while troubleshooting
  Cloudflare product behavior

Properties:

- Organizes data into a small number of sections (`zone_overview`,
  `zone_settings`, `dns`, `workers_routing`, …)
- Samples very large collections to keep outputs readable
- Includes `endpoints_attempted` for quick "what did we actually fetch"
  debugging

### 3) OpenAPI everything export

- Endpoint: `POST /api/export/openapi` and `POST /api/export/openapi/stream`
- Producer: `exportZoneOpenApiEverything()` in `src/openapi-export.ts`
- Goal: maximize coverage of Cloudflare's OpenAPI GET surface area for a
  given zone/account

How it works:

- Uses a generated manifest of **all OpenAPI GET operations**
  (`src/openapi-manifest.generated.ts`).
- Attempts all GET operations that can be scoped with `zone_id` and/or
  `account_id`.
- Best-effort resolves common "detail" endpoints (paths ending in `/{id}`)
  by fetching the parent list endpoint, extracting IDs, then fetching
  details for discovered IDs.

Output structure:

- `curated`: a full `ZoneExport` (migration shape)
- `openapi.operations`: a map keyed by `"GET <path_template>"` with `calls`
  arrays (pagination produces multiple calls)
- `openapi.unresolved`: operations that require a deeper discovery graph
  (multi-ID or non-trailing path params)

Regenerating the manifest:

- Script: `npm run generate:openapi-manifest`
- Input (default): `/tmp/api-schemas/openapi.json`
- Output: `src/openapi-manifest.generated.ts`

The generated manifest is intentionally minimized (GET-only, parameter
names only) to keep the Worker bundle size reasonable.

For the OpenAPI coverage matrix (what's migrated vs captured vs
acknowledged across the full Cloudflare API surface), regenerate
`coverage/api-surface.md` with `node scripts/coverage-report.mjs
--write-md`. The output lives under the gitignored `coverage/` directory;
CI gates on the gap ratchet via `--check`.

---

## Terraform export

- Endpoint: `POST /api/terraform/export` and
  `POST /api/terraform/export/stream`
- Producer: `generateTerraformFiles()` in `src/terraform.ts`
- Provider target: `cloudflare/cloudflare = 5.17.0`

Additional entrypoints:

- `generateTerraformBundle()` in `src/terraform.ts` (full HCL bundle)
- `POST /api/terraform/import/stream` (Terraform 1.5+ `import` block
  generation)

### Key v5 mappings

| Resource | v4 | v5 |
|----------|----|----|
| DNS records | `cloudflare_record` | `cloudflare_dns_record` |
| Zone settings | `cloudflare_zone_settings_override` | `cloudflare_zone_setting` (one resource per `setting_id`) |
| Workers routing | `cloudflare_worker_route` | `cloudflare_workers_route` (`script` attribute) |
| Workers scripts | `cloudflare_worker_script` | `cloudflare_workers_script` (`script_name`, `content`, `bindings` list) |
| Zero Trust Access | `cloudflare_access_application`, `cloudflare_access_policy` | `cloudflare_zero_trust_access_application`, `cloudflare_zero_trust_access_policy` |

**Special case:** `cloudflare_zone_setting` with `setting_id = "ssl_recommender"`
uses `enabled = true/false` instead of `value`.

### Covered resources

**Zone-scoped:**

- `cloudflare_zone` (mainly for import/reference)
- `cloudflare_dns_record`
- `cloudflare_zone_setting`
- `cloudflare_page_rule`
- `cloudflare_ruleset`
- `cloudflare_workers_route`
- `cloudflare_load_balancer`
- `cloudflare_spectrum_application`
- `cloudflare_custom_ssl`
- `cloudflare_custom_hostname`
- `cloudflare_firewall_rule` (legacy; provider marks as deprecated)
- `cloudflare_rate_limit` (legacy; provider marks as deprecated)
- `cloudflare_email_routing_rule`
- `cloudflare_waiting_room`

**Account-scoped:**

- `cloudflare_workers_script`
- `cloudflare_workers_custom_domain`
- `cloudflare_load_balancer_pool`
- `cloudflare_load_balancer_monitor`
- `cloudflare_zero_trust_access_application`
- `cloudflare_zero_trust_access_policy`
- `cloudflare_turnstile_widget`
- `cloudflare_workers_kv_namespace`
- `cloudflare_r2_bucket`
- `cloudflare_d1_database`
- `cloudflare_queue`

### Known limitations

- Some resources require sensitive inputs that cannot be exported (private
  keys, worker secrets). The generator emits placeholders or omits those
  values.
- Some Cloudflare products are not represented by Terraform resources in
  provider v5.17 (example: Zaraz), even if JSON exports include them.
- The inline "Terraform import stream" endpoint is a convenience shim and
  does not implement full Terraform semantics.

### Provider docs source

The canonical schemas are the local provider docs at
`/tmp/terraform-provider-cloudflare/docs/resources/*.md`.

---

## Choosing an export

| Use case | Export |
|----------|--------|
| Run a migration into another account | Migration export (`ZoneExport`) |
| Back up a zone for later restore | Migration export |
| Share with a CSE / Support for troubleshooting | Troubleshooting export |
| Maximum-coverage snapshot for audit / archival | OpenAPI everything |
| Adopt the zone in Infrastructure-as-Code | Terraform export |
| Compare source vs destination after migration | Migration export of both, then `src/diff.ts` |

See [ARCHITECTURE.md § User flows](ARCHITECTURE.md#user-flows) for the UI
flows that produce each format.
