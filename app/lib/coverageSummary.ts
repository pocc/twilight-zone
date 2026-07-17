// GENERATED FILE. DO NOT EDIT BY HAND.
// Source: scripts/generate-coverage-snapshot.mjs
// Generated: 2026-06-28T06:20:43.415Z
//
// Eagerly imported by the landing-page coverage tiles.
// For per-feature endpoint detail, lazy-import ./coverageDetail.

export type EndpointStatus = 'implemented' | 'excluded' | 'gap' | 'out_of_scope' | 'impossible' | 'na_delete';

export type EndpointRecord = {
  method: 'POST' | 'PATCH' | 'PUT';
  path: string;
  status: EndpointStatus;
  in_sdk: boolean;
  deprecated: boolean;
  reason?: string;
  notes?: string;
};

export type FeatureCounts = {
  implemented: number;
  excluded: number;
  gap: number;
  out_of_scope: number;
};

export type FeatureRecord = {
  id: string;
  name: string;
  category: string;
  in_scope: boolean;
  plan_required: string | null;
  addon_required: string | null;
  entitlement_required: string | null;
  dashboard_path: string;
  notes: string | null;
  counts: FeatureCounts;
  /** Green "% migratable" health metric: implemented / (implemented + gap) × 100, or null if no in-scope writes. */
  implementation_rate_pct: number | null;
  /** Gray informational share: implemented / (implemented + excluded + gap) × 100, or null if no in-scope writes. */
  in_scope_write_share_pct: number | null;
};

export type CategoryRecord = {
  id: string;
  name: string;
  icon: string;
  order: number;
  description: string;
  feature_ids: string[];
  in_scope_feature_count: number;
  out_of_scope_feature_count: number;
  counts: FeatureCounts;
  /** Green "% migratable" health metric: implemented / (implemented + gap) × 100, or null if no in-scope writes. */
  implementation_rate_pct: number | null;
  /** Gray informational share: implemented / (implemented + excluded + gap) × 100, or null if no in-scope writes. */
  in_scope_write_share_pct: number | null;
};

export type ReasonDescription = {
  label: string;
  summary: string;
  examples: string[];
};

export type CoverageSummary = {
  generated_at: string;
  openapi_version: string | null;
  sdk_version: string | null;
  totals: {
    in_scope_writes: number;
    implemented: number;
    excluded: number;
    gap: number;
    feature_count: number;
    category_count: number;
    implementation_rate_pct: number;
    settled_surface_pct: number;
    in_scope_write_share_pct: number;
  };
  categories: CategoryRecord[];
};

export const coverageSummary: CoverageSummary = {
  "generated_at": "2026-06-28T06:20:43.415Z",
  "openapi_version": "4.0.0",
  "sdk_version": "6.3.0",
  "totals": {
    "in_scope_writes": 504,
    "implemented": 114,
    "excluded": 390,
    "gap": 0,
    "feature_count": 71,
    "category_count": 16,
    "implementation_rate_pct": 100,
    "settled_surface_pct": 100,
    "in_scope_write_share_pct": 22.6
  },
  "categories": [
    {
      "id": "dns",
      "name": "DNS",
      "icon": "Globe",
      "order": 1,
      "description": "Records, settings, DNSSEC, secondary DNS, custom nameservers.",
      "feature_ids": [
        "dns",
        "dnssec",
        "secondary_dns"
      ],
      "in_scope_feature_count": 3,
      "out_of_scope_feature_count": 0,
      "counts": {
        "implemented": 9,
        "excluded": 16,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 36
    },
    {
      "id": "ssl_tls",
      "name": "SSL/TLS",
      "icon": "Lock",
      "order": 2,
      "description": "Certificates, custom hostnames, SSL configuration.",
      "feature_ids": [
        "ssl_tls",
        "keyless_ssl",
        "custom_hostnames"
      ],
      "in_scope_feature_count": 2,
      "out_of_scope_feature_count": 1,
      "counts": {
        "implemented": 8,
        "excluded": 15,
        "gap": 0,
        "out_of_scope": 2
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 34.8
    },
    {
      "id": "security",
      "name": "Security",
      "icon": "ShieldCheck",
      "order": 3,
      "description": "WAF, Bot Management, Page Shield, API Shield, rate limits.",
      "feature_ids": [
        "rules_waf",
        "rules_firewall",
        "rules_rate_limits",
        "bot_management",
        "page_shield",
        "api_shield",
        "smart_shield",
        "leaked_credentials",
        "content_upload_scan",
        "ai_security",
        "security_center",
        "brand_protection",
        "cloudforce_one",
        "intel"
      ],
      "in_scope_feature_count": 10,
      "out_of_scope_feature_count": 4,
      "counts": {
        "implemented": 28,
        "excluded": 60,
        "gap": 0,
        "out_of_scope": 120
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 31.8
    },
    {
      "id": "rules",
      "name": "Rules",
      "icon": "Sliders",
      "order": 4,
      "description": "Page rules, transform rules, origin rules, snippets.",
      "feature_ids": [
        "rules_pagerules",
        "managed_headers",
        "snippets",
        "cloud_connector",
        "url_normalization",
        "origin_rules"
      ],
      "in_scope_feature_count": 6,
      "out_of_scope_feature_count": 0,
      "counts": {
        "implemented": 5,
        "excluded": 5,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 50
    },
    {
      "id": "caching",
      "name": "Caching",
      "icon": "Stack",
      "order": 5,
      "description": "Cache rules, tiered cache, Argo Smart Routing.",
      "feature_ids": [
        "caching"
      ],
      "in_scope_feature_count": 1,
      "out_of_scope_feature_count": 0,
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
      "id": "traffic",
      "name": "Traffic",
      "icon": "ArrowsClockwise",
      "order": 6,
      "description": "Load balancing, Spectrum, waiting rooms.",
      "feature_ids": [
        "load_balancing",
        "spectrum",
        "waiting_rooms"
      ],
      "in_scope_feature_count": 3,
      "out_of_scope_feature_count": 0,
      "counts": {
        "implemented": 10,
        "excluded": 23,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 30.3
    },
    {
      "id": "workers_pages",
      "name": "Workers & Pages",
      "icon": "Code",
      "order": 7,
      "description": "Worker scripts, routes, bindings, Pages projects.",
      "feature_ids": [
        "workers",
        "flagship",
        "pages"
      ],
      "in_scope_feature_count": 1,
      "out_of_scope_feature_count": 2,
      "counts": {
        "implemented": 2,
        "excluded": 36,
        "gap": 0,
        "out_of_scope": 13
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 5.3
    },
    {
      "id": "storage",
      "name": "Storage",
      "icon": "Database",
      "order": 8,
      "description": "R2, KV, D1, Queues, Vectorize, Hyperdrive, Workflows.",
      "feature_ids": [
        "r2",
        "kv",
        "d1",
        "queues",
        "vectorize",
        "hyperdrive",
        "workflows",
        "pipelines",
        "secrets_store",
        "containers"
      ],
      "in_scope_feature_count": 9,
      "out_of_scope_feature_count": 1,
      "counts": {
        "implemented": 15,
        "excluded": 63,
        "gap": 0,
        "out_of_scope": 5
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 19.2
    },
    {
      "id": "email",
      "name": "Email",
      "icon": "Envelope",
      "order": 9,
      "description": "Email Routing, Email Security.",
      "feature_ids": [
        "email_routing",
        "email_security"
      ],
      "in_scope_feature_count": 1,
      "out_of_scope_feature_count": 1,
      "counts": {
        "implemented": 6,
        "excluded": 15,
        "gap": 0,
        "out_of_scope": 25
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 28.6
    },
    {
      "id": "logs",
      "name": "Logs & Analytics",
      "icon": "ChartBar",
      "order": 10,
      "description": "Logpush, Speed Observatory.",
      "feature_ids": [
        "logs_logpush",
        "workers_observability",
        "speed_api"
      ],
      "in_scope_feature_count": 3,
      "out_of_scope_feature_count": 0,
      "counts": {
        "implemented": 4,
        "excluded": 31,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 11.4
    },
    {
      "id": "zero_trust",
      "name": "Zero Trust",
      "icon": "UserCircle",
      "order": 11,
      "description": "Access, Gateway, WARP, DLP, DEX.",
      "feature_ids": [
        "access",
        "gateway",
        "warp_devices",
        "dlp",
        "dex",
        "zt_risk_scoring",
        "tunnels"
      ],
      "in_scope_feature_count": 1,
      "out_of_scope_feature_count": 6,
      "counts": {
        "implemented": 6,
        "excluded": 69,
        "gap": 0,
        "out_of_scope": 130
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 8
    },
    {
      "id": "ai",
      "name": "AI",
      "icon": "Cpu",
      "order": 12,
      "description": "Workers AI, AI Gateway, AI Search, Browser Rendering.",
      "feature_ids": [
        "ai_run",
        "ai_gateway",
        "ai_search",
        "browser_rendering"
      ],
      "in_scope_feature_count": 1,
      "out_of_scope_feature_count": 3,
      "counts": {
        "implemented": 3,
        "excluded": 17,
        "gap": 0,
        "out_of_scope": 144
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 15
    },
    {
      "id": "magic",
      "name": "Magic Networking",
      "icon": "Lightning",
      "order": 13,
      "description": "Magic Transit, WAN, Firewall.",
      "feature_ids": [
        "magic_networking"
      ],
      "in_scope_feature_count": 0,
      "out_of_scope_feature_count": 1,
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
      "id": "media",
      "name": "Media",
      "icon": "PlayCircle",
      "order": 14,
      "description": "Stream, Images, Realtime.",
      "feature_ids": [
        "stream",
        "images",
        "realtime"
      ],
      "in_scope_feature_count": 0,
      "out_of_scope_feature_count": 3,
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 60
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    },
    {
      "id": "zone_ops",
      "name": "Zone Operations",
      "icon": "GearSix",
      "order": 15,
      "description": "Zone settings, admin, Web3 gateways.",
      "feature_ids": [
        "zone_settings",
        "web3",
        "zone_admin"
      ],
      "in_scope_feature_count": 3,
      "out_of_scope_feature_count": 0,
      "counts": {
        "implemented": 11,
        "excluded": 34,
        "gap": 0,
        "out_of_scope": 0
      },
      "implementation_rate_pct": 100,
      "in_scope_write_share_pct": 24.4
    },
    {
      "id": "account_admin",
      "name": "Account Admin",
      "icon": "UsersThree",
      "order": 99,
      "description": "Account-wide administration (out of zone migration scope).",
      "feature_ids": [
        "abuse_reports",
        "account_admin",
        "system",
        "user",
        "integrations"
      ],
      "in_scope_feature_count": 0,
      "out_of_scope_feature_count": 5,
      "counts": {
        "implemented": 0,
        "excluded": 0,
        "gap": 0,
        "out_of_scope": 146
      },
      "implementation_rate_pct": null,
      "in_scope_write_share_pct": null
    }
  ]
};
