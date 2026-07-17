# Worker Bindings

Per-binding-type migration strategy for Cloudflare Workers between accounts.

See also: [ARCHITECTURE.md § Dependency resolution](ARCHITECTURE.md#dependency-resolution)
for how ID remapping and auto-creation fit into the overall migration flow.

## Complete Binding Type Inventory

As of March 2026, Cloudflare Workers support 25+ binding types. Each requires a specific migration strategy depending on whether it references account-specific IDs, names, or is globally available.

### Binding Categories

> **Note on `type` string forms.** The binding `type` value returned by the
> Workers settings API (and consumed by the migrate engine) is **not** always
> the same as the wrangler-config array key. Authoritative API `type` values:
> `secrets_store_secret` (singular; wrangler array is `secrets_store_secrets`),
> `pipelines` (plural), and `ratelimit` (no underscore; the wrangler key is
> `ratelimit`). Some descriptive cells/headings below still use the
> wrangler-style names for readability — when matching `b.type` in code, use the
> API forms above.

| Category | Description | Example Types |
|----------|-------------|---------------|
| **ID-referenced** | Contains account-specific IDs that must be remapped | `kv_namespace`, `d1`, `hyperdrive`, `vectorize`, `mtls_certificate`, `dispatch_namespace`, `secrets_store_secret` |
| **Name-referenced** | References resources by name; must exist on dest | `r2_bucket`, `queue`, `service`, `pipeline` |
| **Class-referenced** | References code classes within the same or other workers | `durable_object_namespace`, `workflow` |
| **Account-global** | No external resource reference; just needs to exist | `ai`, `analytics_engine`, `browser`, `images`, `rate_limit`, `version_metadata` |
| **Config-only** | Inline values, no external dependency | `plain_text`, `secret_text`, `json`, `vars` |

---

## Current State (what Twilight Zone handles today)

### Fully Handled (ID remapping + auto-creation)

| Binding Type | API `type` value | Key Field | Migration Action |
|---|---|---|---|
| KV Namespace | `kv_namespace` | `namespace_id` | Create on dest, remap ID via `kvIdMap` |
| D1 Database | `d1` | `database_id` | Create on dest, remap ID via `d1IdMap` |
| R2 Bucket | `r2_bucket` | `bucket_name` | Create on dest by name (no ID remap) |
| Durable Objects | `durable_object_namespace` | `namespace_id`, `class_name` | Strip `namespace_id`, deploy with DO migration metadata |

### Partially Handled (special logic, no ID remap needed)

| Binding Type | API `type` value | Migration Action |
|---|---|---|
| Service Binding | `service` | Dependency resolution, cycle detection, stripped for bootstrap deploy |
| Secret Text | `secret_text` | Filtered before upload, set separately via `PUT /secrets` |
| Plain Text | `plain_text` | Passthrough (inline value) |
| Analytics Engine | `analytics_engine` | Skip worker if AE unavailable on dest |
| Queue | `queue` | Auto-create by name (zone migration only, missing in account migration) |

### Not Handled (passthrough only - may produce broken bindings)

| Binding Type | API `type` value | Key Field | Risk Level |
|---|---|---|---|
| Hyperdrive | `hyperdrive` | `id` (config ID) | **HIGH** - source config ID won't exist on dest |
| Vectorize | `vectorize` | `index_name` | **MEDIUM** - name-based but index must exist |
| mTLS Certificate | `mtls_certificate` | `certificate_id` | **HIGH** - source cert ID won't exist on dest |
| Workflow | `workflow` | `class_name`, `workflow_name` | **MEDIUM** - class in same worker is fine, cross-worker needs resolution |
| Pipeline | `pipeline` | `pipeline` (name) | **MEDIUM** - pipeline must exist on dest |
| Dispatch Namespace | `dispatch_namespace` | `namespace` | **HIGH** - WFP namespace ID won't exist on dest |
| Browser Rendering | `browser` | (none) | **LOW** - account-global, just needs feature enabled |
| Images | `images` | (none) | **LOW** - account-global, just needs subscription |
| Rate Limit | `rate_limit` | `namespace_id`, `simple` config | **MEDIUM** - config is inline but feature must be enabled |
| AI | `ai` | (none) | **LOW** - passthrough works if feature enabled |
| Version Metadata | `version_metadata` | (none) | **NONE** - runtime-only, no migration needed |
| Secrets Store | `secrets_store_secret` | `store_id`, `secret_name` | **HIGH** - store ID is account-specific |
| VPC Service | `vpc_service` | `service_id` | **HIGH** - VPC service ID is account-specific |
| Dynamic Worker Loader | `dynamic_worker` | (none) | **LOW** - account-global |
| Assets | `assets` | (none) | **NONE** - handled by worker upload, not a binding |
| Log Forwarding | `logfwdr` | `destination` | **MEDIUM** - destination config is account-specific |
| Send Email | `send_email` | `destination_address` | **LOW** - address is config, not ID-based |

---

## Migration Strategy Per Binding Type

### Tier 1: Must Fix (broken bindings on dest)

#### 1. Hyperdrive (`hyperdrive`)

**Problem:** Binding has `id` field pointing to source account's Hyperdrive config. Config contains DB connection string with credentials.

**API Endpoints:**
- `GET /accounts/{account_id}/hyperdrive/configs` - list configs
- `GET /accounts/{account_id}/hyperdrive/configs/{config_id}` - get config (connection string redacted)
- `POST /accounts/{account_id}/hyperdrive/configs` - create config

**Migration Strategy:**
1. Export: Read Hyperdrive config from source (name, caching settings). Connection string is redacted by API.
2. Pre-migration: Flag as requiring manual re-creation (user must provide connection string).
3. Deploy: Record as "acknowledged" - user must manually create Hyperdrive config on dest with same name, then update binding ID.
4. Alternative: Create a placeholder config on dest with same name, store mapping in `hyperdriveIdMap`. Worker will fail at runtime until user updates connection string.

**Recommendation:** Acknowledge-only. Hyperdrive configs contain secrets (DB passwords) that can't be read from the API. Warn user pre-migration.

#### 2. mTLS Certificate (`mtls_certificate`)

**Problem:** Binding has `certificate_id` pointing to source account's uploaded cert. Private key material can't be read back from API.

**API Endpoints:**
- `GET /accounts/{account_id}/mtls_certificates` - list certs
- `GET /accounts/{account_id}/mtls_certificates/{cert_id}` - get cert metadata
- `POST /accounts/{account_id}/mtls_certificates` - upload cert (requires PEM cert + key)

**Migration Strategy:**
1. Export: Read cert metadata (name, issuer, expiry) from source.
2. Pre-migration: Flag as requiring manual re-upload (user must provide cert + private key PEM files).
3. Deploy: Acknowledge - cannot migrate private key material.

**Recommendation:** Acknowledge-only. Private keys never leave the API.

#### 3. Vectorize (`vectorize`)

**Problem:** Binding references `index_name`. Index must exist on dest with same name and compatible dimensions/metric.

**API Endpoints:**
- `GET /accounts/{account_id}/vectorize/v2/indexes` - list indexes
- `GET /accounts/{account_id}/vectorize/v2/indexes/{index_name}` - get index config
- `POST /accounts/{account_id}/vectorize/v2/indexes` - create index

**Migration Strategy:**
1. Export: Read index config (name, dimensions, metric) from source.
2. Auto-create: Create empty index on dest with same name, dimensions, metric.
3. Deploy: Binding uses `index_name` (name-based), so no ID remap needed.
4. Caveat: Vector data is NOT migrated (would require listing all vectors and reinserting).

**Recommendation:** Auto-create index structure. Add `vectorizeIndexMap` for tracking. Warn that vector data is not migrated.

#### 4. Dispatch Namespace (`dispatch_namespace`)

**Problem:** Binding references WFP (Workers for Platforms) `namespace` name. The dispatch namespace must exist on dest.

**API Endpoints:**
- `GET /accounts/{account_id}/workers/dispatch/namespaces` - list namespaces
- `POST /accounts/{account_id}/workers/dispatch/namespaces` - create namespace

**Migration Strategy:**
1. Export: Read namespace name from binding.
2. Auto-create: Create dispatch namespace on dest with same name.
3. Deploy: Binding uses name, no ID remap needed.
4. Caveat: User workers within the dispatch namespace are NOT migrated.

**Recommendation:** Auto-create namespace. Warn about user workers.

#### 5. Secrets Store (`secrets_store_secret`)

**Problem:** Binding has `store_id` (account-specific) and `secret_name`. Store ID won't exist on dest.

**API Endpoints:**
- `GET /accounts/{account_id}/secrets_store/stores` - list stores
- `POST /accounts/{account_id}/secrets_store/stores` - create store
- `GET /accounts/{account_id}/secrets_store/stores/{store_id}/secrets` - list secrets (values redacted)
- `POST /accounts/{account_id}/secrets_store/stores/{store_id}/secrets` - create secret

**Migration Strategy:**
1. Export: Read store name and secret names (values are redacted).
2. Pre-migration: Flag as requiring manual secret value input.
3. Deploy: Create store on dest, remap `store_id` via `secretsStoreIdMap`. User must manually set secret values.

**Recommendation:** Auto-create store + placeholder secrets. Acknowledge that values need manual entry.

#### 6. VPC Service (`vpc_service`)

**Problem:** Binding has `service_id` referencing a VPC service configuration.

**Migration Strategy:** Acknowledge-only. VPC service configurations involve Tunnel + Access application setup that can't be automatically migrated. Warn user.

### Tier 2: Should Handle (functional but degraded without)

#### 7. Pipeline (`pipeline`)

**Problem:** Binding references pipeline by name. Pipeline must exist on dest.

**API Endpoints:**
- `GET /accounts/{account_id}/pipelines` - list pipelines
- `POST /accounts/{account_id}/pipelines` - create pipeline

**Migration Strategy:**
1. Export: Read pipeline config from source (name, R2 destination bucket, batch settings).
2. Auto-create: Create pipeline on dest with same config (requires R2 bucket to exist first).
3. Deploy: Binding uses pipeline name, no remap needed.

**Recommendation:** Auto-create if R2 bucket exists. Otherwise acknowledge.

#### 8. Workflow (`workflow`)

**Problem:** Binding references `class_name` (the Workflow class) and `workflow_name` (the workflow definition name). If the Workflow class is in the same worker, it migrates automatically. If cross-worker, needs dependency resolution.

**Migration Strategy:**
1. Same-worker: No action needed - class deploys with the worker.
2. Cross-worker: Add to service binding dependency graph (same as `service` bindings).
3. Deploy: Workflows are auto-registered when the worker with the class is deployed.

**Recommendation:** Treat like Durable Objects - class-based, auto-created on deploy.

#### 9. Queue Auto-Creation (fix existing gap)

**Problem:** Queue auto-creation exists in `migrateZone()` but NOT in `migrateAccountResources()`.

**API Endpoints:**
- `GET /accounts/{account_id}/queues` - list queues
- `POST /accounts/{account_id}/queues` - create queue

**Migration Strategy:** Add queue auto-creation to `migrateAccountResources()` matching the logic in `migrateZone()`.

### Tier 3: Low Risk (passthrough works, but should validate)

#### 10. AI (`ai`)

**Status:** Passthrough works. No external resource reference.

**Validation:** Check that Workers AI is enabled on dest account. If not, warn user.

#### 11. Analytics Engine (`analytics_engine`)

**Status:** Already handled - workers with AE bindings are skipped if AE unavailable on dest.

**Improvement:** Instead of skipping the entire worker, deploy without the AE binding and acknowledge.

#### 12. Browser Rendering (`browser`)

**Status:** Passthrough works. No external resource reference.

**Validation:** Check that Browser Rendering is enabled on dest account (paid feature).

#### 13. Images (`images`)

**Status:** Passthrough works. No external resource reference.

**Validation:** Check that Images (Paid) subscription exists on dest account.

#### 14. Rate Limit (`rate_limit`)

**Status:** Passthrough works. Config is inline (`simple: { limit, period }`).

**Validation:** Rate Limiting binding requires the feature to be enabled on the dest account.

#### 15. Send Email (`send_email`)

**Status:** Passthrough works. References `destination_address` (an email address, not an ID).

**Validation:** Email Workers must be enabled on dest account. The destination address must be verified.

#### 16. Version Metadata (`version_metadata`)

**Status:** Runtime-only binding. No migration needed. Passthrough is correct.

#### 17. Log Forwarding (`logfwdr`)

**Status:** Legacy binding type. Passthrough may work but log destination configs are account-specific.

**Recommendation:** Acknowledge - user must manually configure log destination on dest.

#### 18. Dynamic Worker Loader (`dynamic_worker`)

**Status:** Passthrough works. Account-global feature.

---

## Implementation Plan

### Phase 1: Fix Critical Gaps (Tier 1)

**Priority: Immediate**

1. **Update `CFWorkerBinding` type** in `src/types.ts`:
   ```typescript
   export interface CFWorkerBinding {
     name: string;
     type: string;
     text?: string;
     namespace_id?: string;
     bucket_name?: string;
     database_id?: string;
     database_name?: string;
     service?: string;
     environment?: string;
     class_name?: string;
     script_name?: string;
     queue_name?: string;
     // NEW fields for additional binding types
     id?: string;              // hyperdrive config ID
     index_name?: string;      // vectorize index name
     certificate_id?: string;  // mtls_certificate
     dataset?: string;         // analytics_engine
     pipeline?: string;        // pipeline name
     namespace?: string;       // dispatch_namespace
     workflow_name?: string;   // workflow
     store_id?: string;        // secrets_store_secret
     secret_name?: string;     // secrets_store_secret
     service_id?: string;      // vpc_service
     destination_address?: string; // send_email
     simple?: Record<string, unknown>; // rate_limit inline config
     entrypoint?: string;      // service binding entrypoint
   }
   ```

2. **Add ID remapping** in `updateBindingsWithNewIds()` for:
   - `hyperdrive` → `hyperdriveIdMap` (if we auto-create placeholder configs)
   - `vectorize` → no remap needed (name-based)
   - `secrets_store_secret` → `secretsStoreIdMap`

3. **Add auto-creation** for:
   - Vectorize indexes (empty, same dimensions/metric)
   - Dispatch namespaces (empty)
   - Pipelines (if dest R2 bucket exists)
   - Queues in `migrateAccountResources()` (fix existing gap)

4. **Add acknowledge-only handling** for:
   - Hyperdrive configs (connection strings contain secrets)
   - mTLS certificates (private keys can't be exported)
   - Secrets Store secrets (values are redacted)
   - VPC Services (complex tunnel + access setup)

### Phase 2: Capability Checks (Tier 3)

**Priority: Medium**

Add destination capability probes for:
- Workers AI: `GET /accounts/{id}/ai/models` (any 200 = enabled)
- Browser Rendering: Check dashboard feature flag or attempt binding
- Images: `GET /accounts/{id}/images/v1/stats` (any 200 = enabled)
- Rate Limiting binding: Feature must be available
- Queues: `GET /accounts/{id}/queues` (any 200 = enabled)
- Pipelines: `GET /accounts/{id}/pipelines` (any 200 = enabled)
- Vectorize: `GET /accounts/{id}/vectorize/v2/indexes` (any 200 = enabled)

For each, if unavailable:
- Strip the binding from the worker deploy
- Record as "acknowledged" in migration results
- Don't fail the entire worker migration

### Phase 3: Comprehensive Binding Validation

**Priority: Low**

Add a pre-migration binding audit that:
1. Scans all worker bindings across all workers to be migrated
2. Groups by binding type
3. For each type, checks if dest has the required feature/entitlement
4. Presents a summary to user before migration:
   ```
   Workers to migrate: 5
   Bindings detected:
     KV Namespaces: 3 (will auto-create)
     D1 Databases: 1 (will auto-create)
     R2 Buckets: 2 (will auto-create)
     Durable Objects: 1 (will auto-create on deploy)
     Service Bindings: 2 (dependency-aware deploy)
     Secrets: 4 (user must provide values)
     Hyperdrive: 1 (REQUIRES MANUAL SETUP - contains DB credentials)
     mTLS Certs: 1 (REQUIRES MANUAL SETUP - private key needed)
   ```

---

## Binding Type Quick Reference

### How the Workers API returns bindings

When you `GET /accounts/{id}/workers/scripts/{name}`, the response metadata includes a `bindings` array. Each binding object has a `type` field and type-specific properties:

```json
{
  "bindings": [
    { "type": "kv_namespace", "name": "KV", "namespace_id": "abc123" },
    { "type": "d1", "name": "DB", "database_id": "def456", "database_name": "mydb" },
    { "type": "r2_bucket", "name": "BUCKET", "bucket_name": "my-bucket" },
    { "type": "durable_object_namespace", "name": "DO", "class_name": "MyDO", "namespace_id": "ghi789" },
    { "type": "service", "name": "SVC", "service": "other-worker", "entrypoint": "default" },
    { "type": "queue", "name": "Q", "queue_name": "my-queue" },
    { "type": "hyperdrive", "name": "DB_POOL", "id": "jkl012" },
    { "type": "vectorize", "name": "INDEX", "index_name": "my-index" },
    { "type": "ai", "name": "AI" },
    { "type": "analytics_engine", "name": "AE", "dataset": "my-dataset" },
    { "type": "browser", "name": "BROWSER" },
    { "type": "images", "name": "IMAGES" },
    { "type": "mtls_certificate", "name": "CERT", "certificate_id": "mno345" },
    { "type": "secret_text", "name": "API_KEY" },
    { "type": "plain_text", "name": "ENV_VAR", "text": "production" },
    { "type": "ratelimit", "name": "LIMITER", "namespace_id": "pqr678", "simple": { "limit": 100, "period": 60 } },
    { "type": "dispatch_namespace", "name": "DISPATCH", "namespace": "my-platform" },
    { "type": "workflow", "name": "WF", "class_name": "MyWorkflow", "workflow_name": "my-workflow" },
    { "type": "pipelines", "name": "PIPE", "pipeline": "my-pipeline" },
    { "type": "send_email", "name": "EMAIL", "destination_address": "user@example.com" },
    { "type": "logfwdr", "name": "LOG", "destination": "my-log-dest" },
    { "type": "secrets_store_secret", "name": "STORE_SECRET", "store_id": "stu901", "secret_name": "my-secret" },
    { "type": "vpc_service", "name": "VPC", "service_id": "vwx234" },
    { "type": "version_metadata", "name": "VERSION" },
    { "type": "dynamic_worker", "name": "LOADER" }
  ]
}
```

### Decision Matrix: What happens during migration

```
Binding Type              → Create on Dest?  → Remap ID?  → Data Migrated?  → Manual Step?
─────────────────────────────────────────────────────────────────────────────────────────────
kv_namespace              → Yes (auto)       → Yes        → No (empty)      → No
d1                        → Yes (auto)       → Yes        → No (empty)      → No
r2_bucket                 → Yes (auto)       → No (name)  → No (empty)      → No
durable_object_namespace  → Yes (on deploy)  → Strip ID   → No              → No
service                   → N/A (ref only)   → No         → N/A             → No
queue                     → Yes (auto)       → No (name)  → N/A             → No
secret_text               → Set via API      → No         → ONLY if user provides → Yes
plain_text                → Passthrough      → No         → Yes (inline)    → No
analytics_engine          → Skip if unavail  → No         → No (streaming)  → No
ai                        → Passthrough      → No         → N/A             → No
browser                   → Passthrough      → No         → N/A             → Check feature
images                    → Passthrough      → No         → N/A             → Check subscription
hyperdrive                → Acknowledge      → N/A        → No (has secrets)→ Yes (recreate config)
vectorize                 → Yes (auto)       → No (name)  → No (empty)      → No
mtls_certificate          → Acknowledge      → N/A        → No (private key)→ Yes (re-upload cert)
rate_limit                → Passthrough      → No         → Yes (inline)    → Check feature
dispatch_namespace        → Yes (auto)       → No (name)  → No (user workers)→ No
workflow                  → Yes (on deploy)  → No         → No              → No
pipeline                  → Yes (auto)       → No (name)  → No (config only)→ No
send_email                → Passthrough      → No         → N/A             → Verify address
logfwdr                   → Acknowledge      → N/A        → No (dest config)→ Yes
secrets_store_secret     → Create store     → Yes        → No (values)     → Yes (set values)
vpc_service               → Acknowledge      → N/A        → No (complex)    → Yes
version_metadata          → Passthrough      → No         → N/A             → No
dynamic_worker            → Passthrough      → No         → N/A             → No
```

---

## Risk Assessment

### What breaks silently with current passthrough behavior

1. **Hyperdrive** - Worker deploys successfully but all DB queries fail at runtime (config ID doesn't exist on dest)
2. **mTLS Certificate** - Worker deploys but TLS connections to mTLS-protected origins fail (cert ID doesn't exist)
3. **Secrets Store** - Worker deploys but secret lookups return errors (store ID doesn't exist)
4. **VPC Service** - Worker deploys but private network connections fail (service ID doesn't exist)
5. **Dispatch Namespace** - Worker deploys but dynamic dispatch calls fail (namespace doesn't exist)

### What fails loudly

The Cloudflare API typically validates binding references at deploy time for `kv_namespace`, `d1`, and `r2_bucket`. But newer binding types like `hyperdrive`, `vectorize`, and `mtls_certificate` may pass validation at deploy time and only fail at runtime.

---

## Testing Strategy

### MaxConfig Test Expansion

The `e02-maxworker-bindings.json` test config includes a worker with ALL binding types to verify migration handles each correctly:

```json
{
  "workers": [{
    "name": "maxconfig-worker",
    "bindings": [
      { "type": "kv_namespace", "name": "KV", "namespace_id": "__MAXCONFIG_KV_STORE_ID__" },
      { "type": "d1", "name": "DB", "database_id": "__MAXCONFIG_D1_ID__" },
      { "type": "r2_bucket", "name": "R2", "bucket_name": "maxconfig-r2-bucket" },
      { "type": "durable_object_namespace", "name": "DO", "class_name": "MaxConfigDO" },
      { "type": "queue", "name": "QUEUE", "queue_name": "maxconfig-queue" },
      { "type": "ai", "name": "AI" },
      { "type": "analytics_engine", "name": "AE", "dataset": "maxconfig_analytics" },
      { "type": "plain_text", "name": "ENV", "text": "production" },
      { "type": "service", "name": "SVC", "service": "maxconfig-helper" },
      { "type": "vectorize", "name": "INDEX", "index_name": "maxconfig-index" },
      { "type": "browser", "name": "BROWSER" },
      { "type": "images", "name": "IMAGES" },
      { "type": "ratelimit", "name": "LIMITER", "simple": { "limit": 100, "period": 60 } }
    ]
  }]
}
```

Binding types that require manual setup (Hyperdrive, mTLS, Secrets Store, VPC Service) should be tested separately with pre-acknowledged expectations.
