// Constants and small predicates used across the migrate engine.
// Split out from src/migrate.ts to keep the orchestrator focused on
// pipeline logic. Anything pure that doesn't touch I/O lives here.

// [R11] KV copy concurrency limit — controls how many keys are copied in
// parallel per namespace. Exported so callers and tests can reference it.
export const KV_COPY_CONCURRENCY = 10;

// [R2] Settings that are read-only or internal - cannot be migrated.
// These supplement the API's `editable` field as a safety net. The API's
// editable=false flag is the primary guard, but some settings are editable
// yet read-only in practice (e.g. quota fields, plan-level features).
export const READ_ONLY_SETTINGS = new Set([
  'advanced_ddos', 'plan_level', 'ssl_status', 'custom_certificate_quota',
  'page_rule_quota', 'cname_flattening', 'orange_to_orange',
]);

// Settings that fail due to plan limitations or being deprecated/internal.
export const BLOCKED_SETTINGS = new Set([
  'filter_logs_to_cloudflare',  // Internal setting, cannot be modified
  'log_to_cloudflare',          // Internal setting, cannot be modified
  'visitor_ip',                 // Enterprise-only feature
  'waf',                        // Deprecated setting
]);

// Settings that should be skipped when their value is the default (no-op).
// Setting these on the destination would fail due to entitlement requirements
// even though the source value is effectively "not configured".
export function isNoOpSetting(setting: { id: string; value: unknown }): boolean {
  // ciphers: [] requires ACM to write, but an empty array means "use defaults" —
  // there's nothing to migrate.
  if (setting.id === 'ciphers' && Array.isArray(setting.value) && setting.value.length === 0) {
    return true;
  }
  return false;
}

// Worker binding types that reference source-account-specific resources and
// cannot be auto-migrated. The value is the IMPOSSIBLE_TO_MIGRATE key used
// to look up the user-facing acknowledgment text (see src/types.ts).
//
// Two product principles drive this map:
//   1. "No Surprise Failures" — every binding listed here MUST appear as an
//      acknowledged item in Step 2 + the migration report, not as a silent
//      runtime failure after migration.
//   2. "Entitlement Gaps → Acknowledgment, Not Failure" — bindings whose
//      backing service is unavailable on dest (browser, ai, analytics_engine,
//      vectorize) are also classified here so the report classifies them
//      consistently with the rest of the acknowledgment system.
// NOTE on type-string forms: the binding `type` returned by the Workers
// settings API (GET .../scripts/{name}/settings, read by getWorkerBindings)
// is the SINGULAR `secrets_store_secret` and the PLURAL `pipelines` — these
// are distinct from the wrangler-config array keys (`secrets_store_secrets`,
// etc.). Repo fixtures (docs/test_configs/e02-maxworker-bindings.json) and
// app/lib/outOfScope.ts use the API forms. We register BOTH the API form and
// the historical wrangler-array form so a lookup by either matches and the
// store_id remap + acknowledgment always fire (Principles 1 & 6).
export const MANUAL_BINDING_TYPE_TO_KEY: Record<string, string> = {
  hyperdrive: 'worker_binding_hyperdrive',
  secrets_store_secret: 'worker_binding_secrets_store',
  secrets_store_secrets: 'worker_binding_secrets_store',
  vpc_service: 'worker_binding_vpc_service',
  dispatch_namespace: 'worker_binding_dispatch_namespace',
  workflow: 'worker_binding_workflow',
  pipelines: 'worker_binding_pipeline',
  pipeline: 'worker_binding_pipeline',
  browser: 'worker_binding_browser',
  ai: 'worker_binding_ai',
  mtls_certificate: 'worker_binding_mtls_certificate',
  vectorize: 'worker_binding_vectorize',
  analytics_engine: 'worker_binding_analytics_engine',
  send_email: 'worker_binding_send_email',
  assets: 'worker_binding_assets',
};

// Subset that should produce a per-binding warning in addition to the
// section-level acknowledgment. These references will fail at runtime if
// the user doesn't reconfigure them post-migration. The remaining bindings
// in MANUAL_BINDING_TYPE_TO_KEY auto-resolve once the dest account has the
// entitlement (ai, browser, analytics_engine, assets) and don't need a
// per-binding warning.
export const MANUAL_BINDING_TYPES_REQUIRE_RECONFIG = new Set([
  'hyperdrive',
  'secrets_store_secret',
  'secrets_store_secrets',
  'vpc_service',
  'dispatch_namespace',
  'workflow',
  'pipelines',
  'pipeline',
  'mtls_certificate',
  'vectorize',
  'send_email',
]);
