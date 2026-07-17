// GENERATED FILE. DO NOT EDIT BY HAND.
// Source: scripts/generate-coverage-snapshot.mjs
// Generated: 2026-06-28T06:20:43.415Z
//
// Lazy-imported by the coverage modal. Do NOT eagerly import this from
// the landing page — it inflates the initial bundle by ~50 KB minified.

import type { EndpointRecord, FeatureRecord, ReasonDescription } from './coverageSummary';

export type CoverageDetail = {
  generated_at: string;
  reasonDescriptions: Record<string, ReasonDescription>;
  features: FeatureRecord[];
  endpointsByFeature: Record<string, EndpointRecord[]>;
};

export const coverageDetail: CoverageDetail = {
  "generated_at": "2026-06-28T06:20:43.415Z",
  "reasonDescriptions": {
    "data_plane": {
      "label": "Data plane",
      "summary": "Runtime data operations — these endpoints handle data flowing through your services after migration. Your application calls them at request time, not your migration tool.",
      "examples": [
        "POST .../queues/{}/messages/ack",
        "PUT .../r2/buckets/{}/objects/{}",
        "POST .../vectorize/v2/indexes/{}/insert"
      ]
    },
    "imperative_action": {
      "label": "Imperative action",
      "summary": "One-shot admin actions, not persistent state. Things like \"purge cache\", \"rotate a token\", or \"validate a config\". There's no resulting state to migrate.",
      "examples": [
        "POST /zones/{}/purge_cache",
        "POST .../service_tokens/{}/rotate",
        "POST /zones/{}/ssl/analyze"
      ]
    },
    "redundant_with_put": {
      "label": "Redundant with PUT",
      "summary": "PATCH variant of an endpoint where we use PUT. PUT does a full overwrite, which is what we want for fresh migration.",
      "examples": [
        "PATCH /zones/{}/dns_records/{} (we use PUT /zones/{}/dns_records/{})"
      ]
    },
    "dual_scope_covered": {
      "label": "Dual scope",
      "summary": "Same resource is addressable at both account and zone scope. We use one consistently.",
      "examples": [
        "POST /zones/{}/access/apps (we use POST /accounts/{}/access/apps)"
      ]
    },
    "updated_via_post": {
      "label": "Created fresh on destination",
      "summary": "Twilight Zone creates these resources brand-new on the destination. We don't update existing resources — we POST a fresh one. The PUT/PATCH endpoint isn't relevant to a fresh-migration tool.",
      "examples": [
        "PUT /accounts/{}/access/apps/{}",
        "PUT /accounts/{}/queues/{}",
        "PUT /zones/{}/load_balancers/{}"
      ]
    },
    "newer_subfeature": {
      "label": "Newer sub-feature",
      "summary": "Recently-shipped Cloudflare sub-feature that Twilight Zone has not yet added support for. These are real candidates for future implementation; we just haven't prioritized them yet.",
      "examples": [
        "Access AI Controls (MCP)",
        "Zaraz config",
        "Page Shield policies",
        "Web3 IPFS content lists"
      ]
    },
    "admin_only": {
      "label": "Account-wide admin",
      "summary": "Account-level administration sub-resources that don't belong in a per-zone migration tool. Things like org-level Access settings, Workers account settings, or account-wide certificate management.",
      "examples": [
        "POST .../access/keys/rotate",
        "PUT .../workers/account-settings",
        "PATCH .../ssl/universal/settings"
      ]
    },
    "redundant_with_post": {
      "label": "Created via collection POST",
      "summary": "A per-item or alternative create endpoint that's covered by a collection POST we already call. We create the whole set in one place rather than item-by-item via these variants.",
      "examples": [
        "POST .../api_gateway/operations/item (we use the bulk operations POST)",
        "POST .../token_validation/rules/bulk (we use the per-rule POST)"
      ]
    },
    "redundant_with_settings_loop": {
      "label": "Covered by zone-settings migration",
      "summary": "An individual zone-setting endpoint. Twilight Zone migrates settings generically — it reads every value from GET /zones/{}/settings and PATCHes each one — so these dedicated per-setting endpoints are already covered.",
      "examples": [
        "PATCH /zones/{}/settings/speed_brain",
        "PATCH /zones/{}/settings/rum",
        "PATCH /zones/{}/settings (bulk)"
      ]
    },
    "out_of_scope_subfeature": {
      "label": "Out-of-scope sub-feature",
      "summary": "Part of an in-scope product, but this specific capability is outside zone migration: advanced/experimental config (AI Gateway dynamic routing, eval datasets), a separate product surface (Log Explorer, Workers for Platforms dispatch, Pipelines, Vectorize, Zone Environments, Workers Observability/Logs), or an auto-managed/legacy variant (managed WAF packages, Cloudflare-managed API Shield labels). Runtime telemetry like Workers Observability is offered for capture via the analytics snapshot, not migrated as config.",
      "examples": [
        "POST .../ai-gateway/gateways/{}/routes",
        "POST .../pipelines/v1/pipelines",
        "POST .../vectorize/indexes",
        "POST .../logs/explorer/datasets"
      ]
    },
    "impossible_cryptographic": {
      "label": "Cryptographic — cannot export",
      "summary": "Write-only secret or key material (JWKS signing keys, CSR private keys). The API never returns the bytes, so it cannot be exported or migrated. You're asked to re-supply it on the destination. Tracked in the IMPOSSIBLE_TO_MIGRATE catalog.",
      "examples": [
        "PUT /zones/{}/token_validation/config/{}/credentials"
      ]
    }
  },
  "features": [
    {
      "id": "dns",
      "name": "DNS",
      "category": "dns",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "DNS > Records",
      "notes": "Records, zone-level DNS settings, custom nameservers.",
      "counts": {
        "implemented": 4,
        "excluded": 6,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 40
    },
    {
      "id": "dnssec",
      "name": "DNSSEC",
      "category": "dns",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "DNS > Settings > DNSSEC",
      "notes": "DNSSEC requires DS record update at registrar — flagged as manual_external in IMPOSSIBLE_TO_MIGRATE.",
      "counts": {
        "implemented": 0,
        "excluded": 1,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": 0
    },
    {
      "id": "secondary_dns",
      "name": "Secondary DNS",
      "category": "dns",
      "in_scope": true,
      "plan_required": "Enterprise",
      "addon_required": null,
      "entitlement_required": "secondary_dns",
      "dashboard_path": "DNS > Settings > Secondary DNS",
      "notes": "Enterprise-only; requires hidden master coordination.",
      "counts": {
        "implemented": 5,
        "excluded": 9,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 35.7
    },
    {
      "id": "zone_settings",
      "name": "Zone Settings",
      "category": "zone_ops",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Various (SSL/TLS, Speed, Caching, Network)",
      "notes": "Single endpoint covers 100+ settings; read-only ones flagged in IMPOSSIBLE_TO_MIGRATE.",
      "counts": {
        "implemented": 4,
        "excluded": 14,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 22.2
    },
    {
      "id": "ssl_tls",
      "name": "SSL/TLS",
      "category": "ssl_tls",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "SSL/TLS",
      "notes": "Custom cert private keys are write-only — flagged in IMPOSSIBLE_TO_MIGRATE.",
      "counts": {
        "implemented": 6,
        "excluded": 12,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 33.3
    },
    {
      "id": "keyless_ssl",
      "name": "Keyless SSL",
      "category": "ssl_tls",
      "in_scope": false,
      "plan_required": "Enterprise",
      "addon_required": "Keyless SSL",
      "entitlement_required": "keyless_ssl",
      "dashboard_path": "SSL/TLS > Custom Certificates > Keyless SSL",
      "notes": "Cryptographic — private keys live on customer key servers. Acknowledged-only.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 2
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "custom_hostnames",
      "name": "Custom Hostnames / SSL for SaaS",
      "category": "ssl_tls",
      "in_scope": true,
      "plan_required": "Business",
      "addon_required": "SSL for SaaS",
      "entitlement_required": "custom_hostnames",
      "dashboard_path": "SSL/TLS > Custom Hostnames",
      "notes": "SaaS hostname certificates require DCV validation at each customer's DNS.",
      "counts": {
        "implemented": 2,
        "excluded": 3,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 40
    },
    {
      "id": "rules_waf",
      "name": "Rules > WAF (Custom Rulesets)",
      "category": "security",
      "in_scope": true,
      "plan_required": "Pro",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Security > WAF",
      "notes": "Custom rulesets (WAF, transform, redirect, origin, cache, snippets, exec). Account-level rulesets referenced by zone rulesets via execute action.",
      "counts": {
        "implemented": 3,
        "excluded": 7,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 30
    },
    {
      "id": "rules_pagerules",
      "name": "Rules > Page Rules (legacy)",
      "category": "rules",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Rules > Page Rules",
      "notes": "Legacy. Cloudflare is migrating these to phased rulesets.",
      "counts": {
        "implemented": 1,
        "excluded": 2,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 33.3
    },
    {
      "id": "rules_firewall",
      "name": "Rules > Firewall Rules (legacy)",
      "category": "security",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Security > WAF > Firewall Rules (legacy)",
      "notes": "Legacy Firewall Rules + IP/User Agent/Zone Lockdown. Account-level access rules apply to all zones in account.",
      "counts": {
        "implemented": 4,
        "excluded": 17,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 19
    },
    {
      "id": "rules_rate_limits",
      "name": "Rules > Rate Limiting (legacy)",
      "category": "security",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": "Advanced Rate Limiting (for >1000 rps)",
      "entitlement_required": null,
      "dashboard_path": "Security > WAF > Rate limiting rules (legacy)",
      "notes": "Legacy endpoint. New rate limiting is via rulesets/rate_limit phase.",
      "counts": {
        "implemented": 1,
        "excluded": 1,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 50
    },
    {
      "id": "managed_headers",
      "name": "Rules > Managed Transforms",
      "category": "rules",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Rules > Transform Rules > Managed Transforms",
      "notes": null,
      "counts": {
        "implemented": 1,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 100
    },
    {
      "id": "snippets",
      "name": "Rules > Snippets",
      "category": "rules",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Rules > Snippets",
      "notes": null,
      "counts": {
        "implemented": 1,
        "excluded": 1,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 50
    },
    {
      "id": "cloud_connector",
      "name": "Rules > Cloud Connector",
      "category": "rules",
      "in_scope": true,
      "plan_required": "Pro",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Rules > Cloud Connector",
      "notes": null,
      "counts": {
        "implemented": 1,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 100
    },
    {
      "id": "url_normalization",
      "name": "Rules > URL Normalization",
      "category": "rules",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Rules > Settings > URL Normalization",
      "notes": null,
      "counts": {
        "implemented": 1,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 100
    },
    {
      "id": "origin_rules",
      "name": "Rules > Origin Rules",
      "category": "rules",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Rules > Origin Rules",
      "notes": "Origin host header overrides, SNI overrides.",
      "counts": {
        "implemented": 0,
        "excluded": 2,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": 0
    },
    {
      "id": "bot_management",
      "name": "Security > Bots",
      "category": "security",
      "in_scope": true,
      "plan_required": "Enterprise",
      "addon_required": "Bot Management",
      "entitlement_required": "bot_management",
      "dashboard_path": "Security > Bots",
      "notes": "Enterprise add-on. Subscription differs by feature tier (Standalone, Pro, Business).",
      "counts": {
        "implemented": 2,
        "excluded": 1,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 66.7
    },
    {
      "id": "page_shield",
      "name": "Security > Page Shield",
      "category": "security",
      "in_scope": true,
      "plan_required": "Business",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Security > Page Shield",
      "notes": null,
      "counts": {
        "implemented": 2,
        "excluded": 1,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 66.7
    },
    {
      "id": "api_shield",
      "name": "Security > API Shield",
      "category": "security",
      "in_scope": true,
      "plan_required": "Enterprise",
      "addon_required": "API Shield",
      "entitlement_required": "api_shield",
      "dashboard_path": "Security > API Shield",
      "notes": null,
      "counts": {
        "implemented": 9,
        "excluded": 26,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 25.7
    },
    {
      "id": "smart_shield",
      "name": "Security > Smart Shield",
      "category": "security",
      "in_scope": true,
      "plan_required": "Enterprise",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Security > Smart Shield",
      "notes": null,
      "counts": {
        "implemented": 2,
        "excluded": 3,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 40
    },
    {
      "id": "leaked_credentials",
      "name": "Security > Leaked Credentials Check",
      "category": "security",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Security > Settings > Leaked Credentials",
      "notes": null,
      "counts": {
        "implemented": 2,
        "excluded": 1,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 66.7
    },
    {
      "id": "content_upload_scan",
      "name": "Security > Content Upload Scan",
      "category": "security",
      "in_scope": true,
      "plan_required": "Enterprise",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Security > Settings > Content Upload Scan",
      "notes": null,
      "counts": {
        "implemented": 1,
        "excluded": 3,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 25
    },
    {
      "id": "ai_security",
      "name": "Security > AI Crawl Control",
      "category": "security",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Security > AI Crawl Control",
      "notes": null,
      "counts": {
        "implemented": 2,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 100
    },
    {
      "id": "caching",
      "name": "Caching",
      "category": "caching",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Caching > Configuration",
      "notes": "Cached content itself is data_ephemeral; only configuration migrates.",
      "counts": {
        "implemented": 7,
        "excluded": 6,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 53.8
    },
    {
      "id": "workers",
      "name": "Workers & Pages > Workers",
      "category": "workers_pages",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": "workers_paid",
      "dashboard_path": "Workers & Pages",
      "notes": "Workers Paid required for >100k req/day or any binding usage. Worker secrets are cryptographic — values entered in Step 3.",
      "counts": {
        "implemented": 2,
        "excluded": 36,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 5.3
    },
    {
      "id": "r2",
      "name": "R2 Object Storage",
      "category": "storage",
      "in_scope": true,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": "r2",
      "dashboard_path": "R2",
      "notes": "Buckets are created by Twilight Zone; bulk object data is data_offline (rclone copy).",
      "counts": {
        "implemented": 7,
        "excluded": 10,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 41.2
    },
    {
      "id": "kv",
      "name": "Workers KV",
      "category": "storage",
      "in_scope": true,
      "plan_required": "Free (with Workers Paid for >1000 keys/day)",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Workers & Pages > KV",
      "notes": "Namespaces created; key data round-tripped via bulk API. Expiration TTLs are data_ephemeral.",
      "counts": {
        "implemented": 1,
        "excluded": 5,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 16.7
    },
    {
      "id": "d1",
      "name": "D1 Database",
      "category": "storage",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": "d1",
      "dashboard_path": "Workers & Pages > D1",
      "notes": "Database created; schema and data are data_offline (wrangler d1 backup/restore).",
      "counts": {
        "implemented": 1,
        "excluded": 7,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 12.5
    },
    {
      "id": "queues",
      "name": "Queues",
      "category": "storage",
      "in_scope": true,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": "queues",
      "dashboard_path": "Workers & Pages > Queues",
      "notes": "Queue created; in-flight messages are data_ephemeral.",
      "counts": {
        "implemented": 2,
        "excluded": 10,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 16.7
    },
    {
      "id": "vectorize",
      "name": "Vectorize",
      "category": "storage",
      "in_scope": true,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": "vectorize",
      "dashboard_path": "AI > Vectorize",
      "notes": "Index created; vectors data_offline.",
      "counts": {
        "implemented": 1,
        "excluded": 14,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 6.7
    },
    {
      "id": "hyperdrive",
      "name": "Hyperdrive",
      "category": "storage",
      "in_scope": true,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": "hyperdrive",
      "dashboard_path": "Workers & Pages > Hyperdrive",
      "notes": "Config object migrated; origin DB credentials must be re-supplied.",
      "counts": {
        "implemented": 1,
        "excluded": 2,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 33.3
    },
    {
      "id": "workflows",
      "name": "Workflows",
      "category": "storage",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": "workflows",
      "dashboard_path": "Workers & Pages > Workflows",
      "notes": null,
      "counts": {
        "implemented": 0,
        "excluded": 6,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": 0
    },
    {
      "id": "pipelines",
      "name": "Pipelines",
      "category": "storage",
      "in_scope": true,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": "pipelines",
      "dashboard_path": "R2 > Pipelines",
      "notes": null,
      "counts": {
        "implemented": 0,
        "excluded": 7,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": 0
    },
    {
      "id": "flagship",
      "name": "Flagship (Feature Flags)",
      "category": "workers_pages",
      "in_scope": false,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": "flagship",
      "dashboard_path": "Flagship",
      "notes": "Out of scope — account-scoped feature-flag service (public beta 2026-05-26). Flag config (apps/flags) is evaluated INSIDE a customer's Worker via a binding (env.FLAGS.getBooleanValue(...)); it is not a zone setting applied to traffic by the Cloudflare edge, so a zone-to-account migration does not change flag behavior on its own. Documented as its own developer-platform product surface rather than left to the broad /accounts catch-all. Revisit as in-scope (like Vectorize/Hyperdrive) if/when Twilight Zone adds Flagship worker-binding support — at that point the apps/flags would need re-creating on the destination so the migrated binding resolves.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 4
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "secrets_store",
      "name": "Secrets Store",
      "category": "storage",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Workers & Pages > Secrets Store",
      "notes": "Secret references migrated; values cryptographic — user re-supplies.",
      "counts": {
        "implemented": 2,
        "excluded": 2,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 50
    },
    {
      "id": "containers",
      "name": "Containers",
      "category": "storage",
      "in_scope": false,
      "plan_required": "Free (beta)",
      "addon_required": null,
      "entitlement_required": "containers",
      "dashboard_path": "Workers & Pages > Containers",
      "notes": "Out of scope for v1 — separate Container migration workflow.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 5
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "load_balancing",
      "name": "Traffic > Load Balancing",
      "category": "traffic",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": "Load Balancing",
      "entitlement_required": "load_balancing",
      "dashboard_path": "Traffic > Load Balancing",
      "notes": "Pools+monitors+LBs+healthchecks. Subscription required.",
      "counts": {
        "implemented": 5,
        "excluded": 14,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 26.3
    },
    {
      "id": "spectrum",
      "name": "Spectrum",
      "category": "traffic",
      "in_scope": true,
      "plan_required": "Enterprise",
      "addon_required": "Spectrum",
      "entitlement_required": "spectrum",
      "dashboard_path": "Spectrum",
      "notes": null,
      "counts": {
        "implemented": 1,
        "excluded": 1,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 50
    },
    {
      "id": "waiting_rooms",
      "name": "Traffic > Waiting Rooms",
      "category": "traffic",
      "in_scope": true,
      "plan_required": "Business",
      "addon_required": "Waiting Room",
      "entitlement_required": null,
      "dashboard_path": "Traffic > Waiting Rooms",
      "notes": null,
      "counts": {
        "implemented": 4,
        "excluded": 8,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 33.3
    },
    {
      "id": "email_routing",
      "name": "Email > Email Routing",
      "category": "email",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Email > Email Routing",
      "notes": "Forward addresses require verification at destination — manual_external.",
      "counts": {
        "implemented": 6,
        "excluded": 15,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 28.6
    },
    {
      "id": "logs_logpush",
      "name": "Logs > Logpush",
      "category": "logs",
      "in_scope": true,
      "plan_required": "Enterprise",
      "addon_required": "Logpush",
      "entitlement_required": "logpush",
      "dashboard_path": "Analytics & Logs > Logs",
      "notes": "Buffered batches in-flight are data_ephemeral.",
      "counts": {
        "implemented": 2,
        "excluded": 21,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 8.7
    },
    {
      "id": "workers_observability",
      "name": "Logs > Workers Observability",
      "category": "logs",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Workers & Pages > Observability",
      "notes": "Workers Observability (Workers Logs / telemetry) is runtime observability data, not configuration. Its history is data_ephemeral and is offered for capture via the analytics snapshot modal (Step 1/3/4), not migrated as config. The deeper /workers/observability prefix wins over the broad workers feature so these endpoints are organized under Logs & Analytics.",
      "counts": {
        "implemented": 2,
        "excluded": 8,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 20
    },
    {
      "id": "web3",
      "name": "Web3 Gateways",
      "category": "zone_ops",
      "in_scope": true,
      "plan_required": "Free (beta)",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Web3 (legacy)",
      "notes": null,
      "counts": {
        "implemented": 2,
        "excluded": 3,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 40
    },
    {
      "id": "zone_admin",
      "name": "Zone Administration",
      "category": "zone_ops",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Overview / Settings",
      "notes": "Zone create/edit + hold + subscription + tags + zone-pay settings. Twilight Zone handles zone creation via its own flow rather than the bare POST /zones endpoint.",
      "counts": {
        "implemented": 5,
        "excluded": 17,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 22.7
    },
    {
      "id": "speed_api",
      "name": "Speed > Observatory",
      "category": "logs",
      "in_scope": true,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Speed > Observatory",
      "notes": null,
      "counts": {
        "implemented": 0,
        "excluded": 2,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": 0
    },
    {
      "id": "security_center",
      "name": "Security > Security Center",
      "category": "security",
      "in_scope": false,
      "plan_required": "Enterprise",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Security > Security Center",
      "notes": "Read-only/auto-managed dashboard; no configuration migrates.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 7
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "access",
      "name": "Zero Trust > Access",
      "category": "zero_trust",
      "in_scope": true,
      "plan_required": "Free (50 users)",
      "addon_required": "Zero Trust",
      "entitlement_required": "access",
      "dashboard_path": "Zero Trust > Access",
      "notes": "Apps, policies, IdPs, service tokens (service token client_secret cryptographic).",
      "counts": {
        "implemented": 6,
        "excluded": 69,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 8
    },
    {
      "id": "gateway",
      "name": "Zero Trust > Gateway",
      "category": "zero_trust",
      "in_scope": false,
      "plan_required": "Free (Zero Trust)",
      "addon_required": "Zero Trust",
      "entitlement_required": "gateway",
      "dashboard_path": "Zero Trust > Gateway",
      "notes": "Out of scope for zone migration — Zero Trust admin surface.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 25
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "warp_devices",
      "name": "Zero Trust > Settings > WARP Client",
      "category": "zero_trust",
      "in_scope": false,
      "plan_required": "Free (Zero Trust)",
      "addon_required": "Zero Trust",
      "entitlement_required": "warp",
      "dashboard_path": "Zero Trust > Settings",
      "notes": "Out of scope — device enrollment is per-organization.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 37
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "dlp",
      "name": "Zero Trust > DLP",
      "category": "zero_trust",
      "in_scope": false,
      "plan_required": "Enterprise",
      "addon_required": "DLP",
      "entitlement_required": "dlp",
      "dashboard_path": "Zero Trust > DLP",
      "notes": "Out of scope — Zero Trust admin.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 45
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "dex",
      "name": "Zero Trust > DEX",
      "category": "zero_trust",
      "in_scope": false,
      "plan_required": "Enterprise",
      "addon_required": "DEX",
      "entitlement_required": "dex",
      "dashboard_path": "Zero Trust > Analytics > DEX",
      "notes": "Out of scope — Zero Trust observability.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 5
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "zt_risk_scoring",
      "name": "Zero Trust > Risk Scoring",
      "category": "zero_trust",
      "in_scope": false,
      "plan_required": "Enterprise (Zero Trust)",
      "addon_required": "Zero Trust",
      "entitlement_required": "zt_risk_scoring",
      "dashboard_path": "Zero Trust > Risk Scoring",
      "notes": "Out of scope — Zero Trust admin.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 10
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "tunnels",
      "name": "Networks > Tunnels",
      "category": "zero_trust",
      "in_scope": false,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Networks > Tunnels",
      "notes": "Out of scope — tunnel endpoints are per-organization.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 8
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "magic_networking",
      "name": "Magic Networking",
      "category": "magic",
      "in_scope": false,
      "plan_required": "Enterprise",
      "addon_required": "Magic Transit/WAN/Firewall",
      "entitlement_required": "magic_*",
      "dashboard_path": "Magic > Transit / WAN / Firewall",
      "notes": "Out of scope — account-tied per IMPOSSIBLE_TO_MIGRATE.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 108
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "ai_run",
      "name": "AI > Workers AI",
      "category": "ai",
      "in_scope": false,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": "workers_ai",
      "dashboard_path": "AI > Workers AI",
      "notes": "Out of scope — model invocation, no per-account configuration to migrate.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 108
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "ai_gateway",
      "name": "AI > AI Gateway",
      "category": "ai",
      "in_scope": true,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "AI > AI Gateway",
      "notes": "Gateways and their config can be migrated.",
      "counts": {
        "implemented": 3,
        "excluded": 17,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 15
    },
    {
      "id": "ai_search",
      "name": "AI > AI Search",
      "category": "ai",
      "in_scope": false,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": "ai_search",
      "dashboard_path": "AI > AI Search",
      "notes": "Out of scope for v1.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 25
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "browser_rendering",
      "name": "Browser Rendering",
      "category": "ai",
      "in_scope": false,
      "plan_required": "Free (beta)",
      "addon_required": null,
      "entitlement_required": "browser_rendering",
      "dashboard_path": "Workers & Pages > Browser Rendering",
      "notes": "Worker binding migrated; standalone REST API out of scope.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 11
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "stream",
      "name": "Stream",
      "category": "media",
      "in_scope": false,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": "stream",
      "dashboard_path": "Stream",
      "notes": "Out of scope for v1 — separate Stream migration workflow.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 21
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "images",
      "name": "Images",
      "category": "media",
      "in_scope": false,
      "plan_required": "N/A (usage-based)",
      "addon_required": null,
      "entitlement_required": "images",
      "dashboard_path": "Images",
      "notes": "Out of scope for v1.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 6
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "pages",
      "name": "Workers & Pages > Pages",
      "category": "workers_pages",
      "in_scope": false,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Workers & Pages > Pages",
      "notes": "Out of scope — separate Pages migration workflow.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 9
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "realtime",
      "name": "Realtime / Calls / MoQ",
      "category": "media",
      "in_scope": false,
      "plan_required": "N/A (beta)",
      "addon_required": null,
      "entitlement_required": "realtime",
      "dashboard_path": "Realtime",
      "notes": "Out of scope for v1.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 33
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "email_security",
      "name": "Email > Email Security",
      "category": "email",
      "in_scope": false,
      "plan_required": "Enterprise",
      "addon_required": "Email Security",
      "entitlement_required": "email_security",
      "dashboard_path": "Email > Email Security",
      "notes": "Out of scope — account-level mail security policy.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 25
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "brand_protection",
      "name": "Security > Brand Protection",
      "category": "security",
      "in_scope": false,
      "plan_required": "Enterprise",
      "addon_required": "Brand Protection",
      "entitlement_required": "brand_protection",
      "dashboard_path": "Security Center > Brand Protection",
      "notes": "Out of scope — account-level intel.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 17
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "cloudforce_one",
      "name": "Security > CloudForce One",
      "category": "security",
      "in_scope": false,
      "plan_required": "Enterprise",
      "addon_required": "CloudForce One",
      "entitlement_required": "cloudforce_one",
      "dashboard_path": "Security Center > CloudForce One",
      "notes": "Out of scope — account-level threat intel.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 73
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "intel",
      "name": "Security > Investigate (Intel)",
      "category": "security",
      "in_scope": false,
      "plan_required": "Enterprise",
      "addon_required": null,
      "entitlement_required": "intel",
      "dashboard_path": "Security Center > Investigate",
      "notes": "Out of scope — account-level intel queries.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 23
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "abuse_reports",
      "name": "Account > Abuse Reports",
      "category": "account_admin",
      "in_scope": false,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Account > Manage Account > Abuse Reports",
      "notes": "Out of scope — account-level safety queue.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 2
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "account_admin",
      "name": "Account Administration",
      "category": "account_admin",
      "in_scope": false,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Manage Account",
      "notes": "Out of scope — account-level admin surfaces (IAM, billing, registrar, account-pay-per-crawl, etc.). These are managed independently of any zone migration.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 105
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "system",
      "name": "System / Internal",
      "category": "account_admin",
      "in_scope": false,
      "plan_required": null,
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "(none)",
      "notes": "Internal/non-customer-facing endpoints + top-level /zones and /accounts/{id} CRUD that Twilight Zone handles via its own zone creation flow (not via OpenAPI). Acknowledged.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 18
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "user",
      "name": "User Profile",
      "category": "account_admin",
      "in_scope": false,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Account > Profile",
      "notes": "User-level (not account-level) endpoints. Out of scope for zone migration.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 17
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "integrations",
      "name": "Integrations",
      "category": "account_admin",
      "in_scope": false,
      "plan_required": "Free",
      "addon_required": null,
      "entitlement_required": null,
      "dashboard_path": "Integrations",
      "notes": "Top-level org/account Integrations management (connect/pause/resume/delete third-party integrations). Not a zone-scoped, traffic-affecting resource — out of scope for a zone-to-account migration.",
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 4
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    }
  ],
  "endpointsByFeature": {
    "access": [
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/ai-controls/mcp/portals/{id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/ai-controls/mcp/portals",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/ai-controls/mcp/servers/{id}/sync",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/ai-controls/mcp/servers/{id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/ai-controls/mcp/servers",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/apps/{app_id}/ca",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/apps/{app_id}/policies/{policy_id}/make_reusable",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/apps/{app_id}/policies/{policy_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/apps/{app_id}/policies",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/apps/{app_id}/revoke_tokens",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/access/apps/{app_id}/settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/apps/{app_id}/settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/apps/{app_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/apps",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/bookmarks/{bookmark_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/bookmarks/{bookmark_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/certificates/{certificate_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/certificates/settings",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/certificates",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/custom_pages/{custom_page_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/custom_pages",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/gateway_ca",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/groups/{group_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/groups",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/identity_providers/{identity_provider_id}/saml_certificate",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/identity_providers/{identity_provider_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/identity_providers",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/idp_federation_grants",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only",
        "notes": "Account/org-level Access identity-federation grant (federates a whole Zero Trust org with another). Not a per-zone resource and does not affect how the migrating zone serves traffic; lives under the account, outside per-zone migration scope."
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/keys/rotate",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/keys",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/organizations/doh",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/organizations/revoke_user",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/organizations",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/organizations",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/policies/{policy_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/policies",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/policy-tests",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/saml_certificates/{saml_cert_set_id}/rotate",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/access/seats",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/service_tokens/{service_token_id}/refresh",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/service_tokens/{service_token_id}/rotate",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/service_tokens/{service_token_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/service_tokens",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/tags/{tag_name}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/tags",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/access/users/{user_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/access/users",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/scim/v2/Groups/{group_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/scim/v2/Groups",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/scim/v2/Users/{user_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/scim/v2/Users/{user_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/scim/v2/Users",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/sso_connectors/{sso_connector_id}/begin_verification",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/sso_connectors/{sso_connector_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/sso_connectors",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/access/apps/{app_id}/ca",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/access/apps/{app_id}/policies/{policy_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/access/apps/{app_id}/policies",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "dual_scope_covered"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/access/apps/{app_id}/revoke_tokens",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/access/apps/{app_id}/settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/access/apps/{app_id}/settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/access/apps/{app_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/access/apps",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "dual_scope_covered"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/access/certificates/{certificate_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/access/certificates/settings",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/access/certificates",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/access/groups/{group_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/access/groups",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "dual_scope_covered"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/access/identity_providers/{identity_provider_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/access/identity_providers",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "dual_scope_covered"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/access/organizations/revoke_user",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/access/organizations",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/access/organizations",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/access/service_tokens/{service_token_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/access/service_tokens",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      }
    ],
    "ai_gateway": [
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/billing/spending-limit",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/billing/topup/config",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/billing/topup/status",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/billing/topup",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/ai-gateway/custom-providers/{id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/ai-gateway/custom-providers/costs/{id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/custom-providers/costs",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/custom-providers",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/datasets/{id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/datasets",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/evaluations",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs/{id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/provider_configs/{id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/provider_configs",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "impossible_cryptographic",
        "notes": "BYOK provider config references a write-only `secret` (unreadable from source) plus a source-account `secret_id`, so the migrate engine acknowledges it rather than recreating (see src/migrate/zone-extras.ts; AiGatewayProviderConfig in src/api.ts). createAiGatewayProviderConfig is kept correct for the api-v1 surface but is intentionally never called by migrate."
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/routes/{id}/deployments",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/routes/{id}/versions",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/routes/{id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/routes",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/ai-gateway/gateways/{id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/ai-gateway/gateways",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "d1": [
      {
        "method": "POST",
        "path": "/accounts/{account_id}/d1/database/{database_id}/export",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/d1/database/{database_id}/import",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/d1/database/{database_id}/query",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/d1/database/{database_id}/raw",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/d1/database/{database_id}/time_travel/restore",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/d1/database/{database_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/d1/database/{database_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/d1/database",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "email_routing": [
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/email/routing/addresses/{destination_address_identifier}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/email/routing/addresses",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/email/routing/suppression",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/email/sending/send_raw",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/email/sending/send",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/email/sending/suppression",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/email/routing/disable",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/email/routing/dns",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_post_dns"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/email/routing/dns",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/email/routing/enable",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "redundant_with_post_dns"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/email/routing/rules/{rule_identifier}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/email/routing/rules/catch_all",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/email/routing/rules",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/email/routing/suppression",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/email/routing/unlock",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/email/routing",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/email/routing",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_put"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/email/sending/subdomains/{subdomain_id}/dns",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/email/sending/subdomains/preview",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/email/sending/subdomains",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/email/sending/suppression",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      }
    ],
    "rules_firewall": [
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/firewall/access_rules/rules/{rule_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/firewall/access_rules/rules",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "dual_scope_covered"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/filters/{filter_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/filters",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/filters",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/firewall/access_rules/rules/{rule_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/firewall/access_rules/rules",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/firewall/lockdowns/{lock_downs_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/firewall/lockdowns",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/firewall/rules/{rule_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/firewall/rules/{rule_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/firewall/rules",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/firewall/rules",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": true
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/firewall/rules",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/firewall/ua_rules/{ua_rule_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/firewall/ua_rules",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/firewall/waf/overrides/{overrides_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/firewall/waf/overrides",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/firewall/waf/packages/{package_id}/groups/{group_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/firewall/waf/packages/{package_id}/rules/{rule_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/firewall/waf/packages/{package_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "out_of_scope_subfeature"
      }
    ],
    "hyperdrive": [
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/hyperdrive/configs/{hyperdrive_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/hyperdrive/configs/{hyperdrive_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/hyperdrive/configs",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "load_balancing": [
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/load_balancers/monitor_groups/{monitor_group_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/load_balancers/monitor_groups/{monitor_group_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/load_balancers/monitor_groups",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/load_balancers/monitors/{monitor_id}/preview",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/load_balancers/monitors/{monitor_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/load_balancers/monitors/{monitor_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/load_balancers/monitors",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/load_balancers/pools/{pool_id}/preview",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/load_balancers/pools/{pool_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/load_balancers/pools/{pool_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/load_balancers/pools",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/load_balancers/pools",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/healthchecks/{healthcheck_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/healthchecks/{healthcheck_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/healthchecks/preview",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/healthchecks",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/load_balancers/{load_balancer_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/load_balancers/{load_balancer_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/load_balancers",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "logs_logpush": [
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/logpush/jobs/{job_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/logpush/jobs",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/logpush/ownership/validate",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/logpush/ownership",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/logpush/validate/destination/exists",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/logpush/validate/destination",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/logpush/validate/origin",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/logs/control/cmb/config",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/logs/explorer/datasets/{dataset_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/logs/explorer/datasets",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/logs/explorer/query/sql",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/logpush/edge/jobs",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/logpush/jobs/{job_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/logpush/jobs",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/logpush/ownership/validate",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/logpush/ownership",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/logpush/validate/destination/exists",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/logpush/validate/destination",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/logpush/validate/origin",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/logs/control/retention/flag",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/logs/explorer/datasets/{dataset_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/logs/explorer/datasets",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/logs/explorer/query/sql",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      }
    ],
    "pipelines": [
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/pipelines/{pipeline_name}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/pipelines/v1/pipelines",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/pipelines/v1/sinks",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/pipelines/v1/streams/{stream_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/pipelines/v1/streams",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/pipelines/v1/validate_sql",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/pipelines",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "out_of_scope_subfeature"
      }
    ],
    "queues": [
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/queues/{queue_id}/consumers/{consumer_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/queues/{queue_id}/consumers",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/queues/{queue_id}/messages/ack",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/queues/{queue_id}/messages/batch",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/queues/{queue_id}/messages/preview/ack",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/queues/{queue_id}/messages/preview",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/queues/{queue_id}/messages/pull",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/queues/{queue_id}/messages",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/queues/{queue_id}/purge",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/queues/{queue_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/queues/{queue_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/queues",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "r2": [
      {
        "method": "POST",
        "path": "/accounts/{account_id}/r2-catalog/{bucket_name}/credential",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/r2-catalog/{bucket_name}/disable",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/r2-catalog/{bucket_name}/enable",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/r2-catalog/{bucket_name}/maintenance-configs",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/r2-catalog/{bucket_name}/namespaces/{namespace}/tables/{table_name}/maintenance-configs",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/cors",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom/{domain}",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/domains/custom",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/domains/managed",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/lifecycle",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/local-uploads",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/lock",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/objects/{object_key}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/r2/buckets/{bucket_name}/sippy",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/r2/buckets/{bucket_name}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/r2/buckets",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/r2/temp-access-credentials",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      }
    ],
    "rules_waf": [
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/rulesets/{ruleset_id}/rules/{rule_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_ruleset_put"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/rulesets/{ruleset_id}/rules",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_ruleset_put"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/rulesets/{ruleset_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/rulesets/phases/{ruleset_phase}/entrypoint",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/rulesets",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/rulesets/{ruleset_id}/rules/{rule_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_ruleset_put"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/rulesets/{ruleset_id}/rules",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_ruleset_put"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/rulesets/{ruleset_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/rulesets/phases/{ruleset_phase}/entrypoint",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/rulesets",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "dual_scope_covered"
      }
    ],
    "secondary_dns": [
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/secondary_dns/acls/{acl_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/secondary_dns/acls",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/secondary_dns/peers/{peer_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/secondary_dns/peers",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/secondary_dns/tsigs/{tsig_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/secondary_dns/tsigs",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/secondary_dns/force_axfr",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/secondary_dns/incoming",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/secondary_dns/incoming",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/secondary_dns/outgoing/disable",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/secondary_dns/outgoing/enable",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/secondary_dns/outgoing/force_notify",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/secondary_dns/outgoing",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/secondary_dns/outgoing",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      }
    ],
    "secrets_store": [
      {
        "method": "POST",
        "path": "/accounts/{account_id}/secrets_store/stores/{store_id}/secrets/{secret_id}/duplicate",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/secrets_store/stores/{store_id}/secrets/{secret_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/secrets_store/stores/{store_id}/secrets",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/secrets_store/stores",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "kv": [
      {
        "method": "POST",
        "path": "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/bulk/delete",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/bulk/get",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/bulk",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key_name}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/storage/kv/namespaces/{namespace_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/storage/kv/namespaces",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "vectorize": [
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/indexes/{index_name}/delete-by-ids",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/indexes/{index_name}/get-by-ids",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/indexes/{index_name}/insert",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/indexes/{index_name}/query",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/indexes/{index_name}/upsert",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "data_plane"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/vectorize/indexes/{index_name}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/indexes",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}/delete_by_ids",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}/get_by_ids",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}/insert",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}/metadata_index/create",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}/metadata_index/delete",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}/query",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/v2/indexes/{index_name}/upsert",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/vectorize/v2/indexes",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "workers": [
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/account-settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/assets/upload",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/assets-upload-session",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/content",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/secrets-bulk",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/secrets",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/tags/{tag}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}/tags",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}/scripts/{script_name}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_namespace}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/dispatch/namespaces",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/domains",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/assets-upload-session",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/content",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/deployments",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/schedules",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/script-settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/secrets-bulk",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/secrets",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/subdomain",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/tails",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/usage-model",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}/versions",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/scripts/{script_name}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/services/{service_name}/environments/{environment_name}/content",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/services/{service_name}/environments/{environment_name}/settings",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/subdomain",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/workers/{worker_id}/versions/latest",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/workers/{worker_id}/versions",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/workers/{worker_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workers/workers/{worker_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/workers",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_bundle_put"
      },
      {
        "method": "POST",
        "path": "/workers/builds/deploy_hooks/{deploy_hook_uuid}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/workers/routes/{route_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/workers/routes",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "workers_observability": [
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/observability/destinations/{slug}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/observability/destinations",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workers/observability/queries/{queryId}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/observability/queries",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/observability/shared/query",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/observability/telemetry/keys",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/observability/telemetry/live-tail/heartbeat",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/observability/telemetry/live-tail",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/observability/telemetry/query",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workers/observability/telemetry/values",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      }
    ],
    "workflows": [
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workflows/{workflow_name}/instances/{instance_id}/events/{event_type}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/accounts/{account_id}/workflows/{workflow_name}/instances/{instance_id}/status",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workflows/{workflow_name}/instances/batch/terminate",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workflows/{workflow_name}/instances/batch",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/accounts/{account_id}/workflows/{workflow_name}/instances",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/accounts/{account_id}/workflows/{workflow_name}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      }
    ],
    "ssl_tls": [
      {
        "method": "POST",
        "path": "/zones/{zone_id}/acm/custom_trust_store",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/acm/total_tls",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/certificate_authorities/hostname_associations",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/client_certificates/{client_certificate_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/client_certificates",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/custom_certificates/{custom_certificate_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/custom_certificates/prioritize",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/custom_certificates",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/custom_csrs",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/origin_tls_client_auth/hostnames/certificates",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/origin_tls_client_auth/hostnames",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/origin_tls_client_auth/settings",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/origin_tls_client_auth",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/ssl/analyze",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/ssl/certificate_packs/{certificate_pack_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/ssl/certificate_packs/order",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/ssl/universal/settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/ssl/verification/{certificate_pack_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      }
    ],
    "zone_admin": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/activation_check",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/addressing/regional_hostnames/{hostname}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post",
        "notes": "Regional Hostnames are re-created fresh on the destination via POST /zones/{zone_id}/addressing/regional_hostnames (createRegionalHostname, migrated in src/migrate/zone-extras.ts). Migration never patches a regional hostname in place, so this PATCH is covered by the POST."
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/addressing/regional_hostnames",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/ct/alerting",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/devices/policy/certificates",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/email/auth/dmarc-reports",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/environments/{environment_id}/purge_cache",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/environments/{environment_id}/rollback",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/environments",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/environments",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/environments",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/hold",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/hold",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/intel/sinkholes/{sinkhole_id}/ingresses/{ingress_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature",
        "notes": "Zone Intel sinkhole ingress rule (threat-intel DNS sinkholing telemetry). Does not affect how the zone serves normal traffic, and the parent sinkhole resource is not migrated; sub-feature out of zone-migration scope."
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/intel/sinkholes/{sinkhole_id}/ingresses",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature",
        "notes": "Zone Intel sinkhole ingress rule (threat-intel DNS sinkholing telemetry). Does not affect how the zone serves normal traffic, and the parent sinkhole resource is not migrated; sub-feature out of zone-migration scope."
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/pay-per-crawl/configuration",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/pay-per-crawl/configuration",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/subscription",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/subscription",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/tags",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "admin_only"
      },
      {
        "method": "POST",
        "path": "/zones",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      }
    ],
    "ai_security": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/ai-security/custom-topics",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/ai-security/settings",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "api_shield": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/api_gateway/configuration",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/api_gateway/discovery/operations/{discovery_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/api_gateway/discovery/operations",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/api_gateway/expression-template/fallthrough",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/api_gateway/labels/managed/{name}/resources/operation",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/api_gateway/labels/user/{name}/resources/operation",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_put"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/api_gateway/labels/user/{name}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/api_gateway/labels/user/{name}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/api_gateway/labels/user",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/api_gateway/operations/{operation_id}/labels",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/api_gateway/operations/{operation_id}/labels",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/api_gateway/operations/{operation_id}/schema_validation",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "redundant_with_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/api_gateway/operations/item",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/api_gateway/operations/labels",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/api_gateway/operations/labels",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_post"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/api_gateway/operations/schema_validation",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": true
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/api_gateway/operations",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/api_gateway/settings/schema_validation",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "redundant_with_put"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/api_gateway/settings/schema_validation",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "redundant_with_put"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/api_gateway/user_schemas/{schema_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/api_gateway/user_schemas",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": true
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/schema_validation/schemas/{schema_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/schema_validation/schemas",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/schema_validation/settings/operations/{operation_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_post"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/schema_validation/settings/operations",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_post"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/schema_validation/settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_put"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/schema_validation/settings",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/token_validation/config/{config_id}/credentials",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "impossible_cryptographic"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/token_validation/config/{config_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/token_validation/config",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/token_validation/rules/{rule_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/token_validation/rules/bulk",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/token_validation/rules/bulk",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/token_validation/rules/preview",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/token_validation/rules",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "caching": [
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/argo/smart_routing",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/argo/tiered_caching",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/cache/cache_reserve_clear",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/cache/cache_reserve",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/cache/origin_cloud_regions/batch",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": true
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/cache/origin_cloud_regions",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "redundant_with_put"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/cache/origin_cloud_regions",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "redundant_with_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/cache/origin_post_quantum_encryption",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": true
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/cache/regional_tiered_cache",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/cache/tiered_cache_smart_topology_enable",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/cache/tiered_cache_smart_topology_enable",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/cache/variants",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/purge_cache",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      }
    ],
    "bot_management": [
      {
        "method": "POST",
        "path": "/zones/{zone_id}/bot_management/feedback",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/bot_management",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/fraud_detection/settings",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "cloud_connector": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/cloud_connector/rules",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      }
    ],
    "content_upload_scan": [
      {
        "method": "POST",
        "path": "/zones/{zone_id}/content-upload-scan/disable",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/content-upload-scan/enable",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/content-upload-scan/payloads",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "data_plane"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/content-upload-scan/settings",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "custom_hostnames": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/custom_hostnames/{custom_hostname_id}/certificate_pack/{certificate_pack_id}/certificates/{certificate_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/custom_hostnames/{custom_hostname_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/custom_hostnames/fallback_origin",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/custom_hostnames",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/hostnames/settings/{setting_id}/{hostname}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      }
    ],
    "dns": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/custom_ns",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": true
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/dns_records/{dns_record_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_put"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/dns_records/{dns_record_id}",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/dns_records/batch",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_record_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/dns_records/import",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_record_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/dns_records/scan/review",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/dns_records/scan/trigger",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/dns_records/scan",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/dns_records",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/dns_settings",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "dnssec": [
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/dnssec",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      }
    ],
    "leaked_credentials": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/leaked-credential-checks/detections/{detection_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/leaked-credential-checks/detections",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/leaked-credential-checks",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "managed_headers": [
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/managed_headers",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "origin_rules": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/origin/cloud_regions/{origin_ip}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/origin/cloud_regions/batch",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "out_of_scope_subfeature"
      }
    ],
    "page_shield": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/page_shield/policies/{policy_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/page_shield/policies",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/page_shield",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "rules_pagerules": [
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/pagerules/{pagerule_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/pagerules/{pagerule_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/pagerules",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "rules_rate_limits": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/rate_limits/{rate_limit_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": true,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/rate_limits",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": true
      }
    ],
    "zone_settings": [
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/{setting_id}",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/aegis",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "impossible_account_tied",
        "notes": "Aegis is an account-tied/paid feature (dedicated egress IPs), acknowledged in IMPOSSIBLE_TO_MIGRATE alongside BYOIP. It is NOT in the curated ZONE_SETTINGS list, so the export-zone dedicated-endpoint backfill deliberately skips it — not covered by the settings loop, excluded as account-tied rather than redundant."
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/auto_origin_tls_kex",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/csam_scanner_third_party",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_settings_loop",
        "notes": "Dedicated zone-setting endpoint (absent from the aggregate GET /zones/{id}/settings). Now migrated by TZ's generic settings loop, fed by the curated dedicated-endpoint backfill added to ZONE_SETTINGS in src/fuzz.ts."
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/fonts",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_settings_loop",
        "notes": "Dedicated-endpoint setting omitted by the aggregate GET; export-zone now backfills it via getZoneSetting and the settings loop PATCHes it via the same /settings/fonts URL, so it is genuinely covered."
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/settings/google-tag-gateway/config",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/origin_h2_max_streams",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_settings_loop",
        "notes": "Dedicated-endpoint setting omitted by the aggregate GET; export-zone now backfills it via getZoneSetting and the settings loop PATCHes it via the same /settings/origin_h2_max_streams URL, so it is genuinely covered."
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/origin_max_http_version",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_settings_loop",
        "notes": "Dedicated-endpoint setting omitted by the aggregate GET; export-zone now backfills it via getZoneSetting and the settings loop PATCHes it via the same /settings/origin_max_http_version URL, so it is genuinely covered."
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/origin_tls_compliance_modes",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_settings_loop"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/settings/origin_tls_compliance_modes",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_settings_loop"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/rum",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_settings_loop",
        "notes": "Dedicated-endpoint setting omitted by the aggregate GET. rum's PATCH value shape was verified live (2026-06-02): a plain on/off string. It is now in the curated ZONE_SETTINGS list, so export-zone backfills it via getZoneSetting and the settings loop PATCHes it via the same /settings/rum URL — genuinely covered."
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/speed_brain",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_settings_loop",
        "notes": "Dedicated-endpoint setting omitted by the aggregate GET; export-zone now backfills it via getZoneSetting and the settings loop PATCHes it via the same /settings/speed_brain URL, so it is genuinely covered."
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings/ssl_automatic_mode",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_settings_loop",
        "notes": "Dedicated-endpoint setting omitted by the aggregate GET; export-zone now backfills it via getZoneSetting and the settings loop PATCHes it via the same /settings/ssl_automatic_mode URL, so it is genuinely covered."
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/settings/zaraz/config",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/settings/zaraz/history",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/settings/zaraz/publish",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/settings/zaraz/workflow",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/settings",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": true,
        "reason": "redundant_with_settings_loop"
      }
    ],
    "smart_shield": [
      {
        "method": "POST",
        "path": "/zones/{zone_id}/smart_shield/cache_reserve_clear",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/smart_shield/healthchecks/{healthcheck_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/smart_shield/healthchecks/{healthcheck_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/smart_shield/healthchecks",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/smart_shield",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      }
    ],
    "snippets": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/snippets/{snippet_name}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/snippets/snippet_rules",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "spectrum": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/spectrum/apps/{app_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/spectrum/apps",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "speed_api": [
      {
        "method": "POST",
        "path": "/zones/{zone_id}/speed_api/pages/{url}/tests",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/speed_api/schedule/{url}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      }
    ],
    "url_normalization": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/url_normalization",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "waiting_rooms": [
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/events/{event_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/events/{event_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/events",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/rules/{rule_id}",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_put"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/rules",
        "status": "excluded",
        "in_sdk": false,
        "deprecated": false,
        "reason": "redundant_with_put"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}/rules",
        "status": "implemented",
        "in_sdk": false,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/waiting_rooms/{waiting_room_id}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/waiting_rooms/preview",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "imperative_action"
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/waiting_rooms/settings",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_put"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/waiting_rooms/settings",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/waiting_rooms",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ],
    "web3": [
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/web3/hostnames/{identifier}/ipfs_universal_path/content_list/entries/{content_list_entry_identifier}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_put"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/web3/hostnames/{identifier}/ipfs_universal_path/content_list/entries",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "redundant_with_put"
      },
      {
        "method": "PUT",
        "path": "/zones/{zone_id}/web3/hostnames/{identifier}/ipfs_universal_path/content_list",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      },
      {
        "method": "PATCH",
        "path": "/zones/{zone_id}/web3/hostnames/{identifier}",
        "status": "excluded",
        "in_sdk": true,
        "deprecated": false,
        "reason": "updated_via_post"
      },
      {
        "method": "POST",
        "path": "/zones/{zone_id}/web3/hostnames",
        "status": "implemented",
        "in_sdk": true,
        "deprecated": false
      }
    ]
  }
};
