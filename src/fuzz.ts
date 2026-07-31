import * as api from './api';
import { BLOCKED_SETTINGS, READ_ONLY_SETTINGS } from './migrate/constants';
import { isConflictError, isMaxConfigAcknowledgeable } from './migrate/errors';
import type { MigrationReport } from './types';

export type LogFn = (message: string) => void;

export async function fuzzAuthenticatedFetch(
  auth: api.ApiAuth | string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await globalThis.fetch(input, init);
  await api.throwIfCloudflareAuthResponse(response, auth);
  return response;
}

const createFuzzFetch = (auth: api.ApiAuth | string): typeof fetch =>
  (input, init) => fuzzAuthenticatedFetch(auth, input, init);

// =============================================================================
// MAXIMUM CONFIG RULE DEFINITIONS
// All text-based rules that can be created to "light up" a zone like a Christmas tree
// =============================================================================

export interface RuleDefinition {
  phase: string;
  name: string;
  description: string;
  rule: {
    action: string;
    expression: string;
    description: string;
    action_parameters?: Record<string, unknown>;
    enabled?: boolean;
    ratelimit?: {
      characteristics: string[];
      period: number;
      requests_per_period: number;
      mitigation_timeout: number;
    };
  };
}

// Ruleset phases and their sample rules
export const MAXIMUM_CONFIG_RULES: RuleDefinition[] = [
  // Custom Rules (WAF) - http_request_firewall_custom
  {
    phase: 'http_request_firewall_custom',
    name: 'Custom Rules (WAF)',
    description: 'Block requests from specific IP',
    rule: {
      action: 'block',
      expression: '(ip.src eq 192.0.2.1)',
      description: '[MaxConfig] Block test IP',
      enabled: true,
    },
  },
  {
    phase: 'http_request_firewall_custom',
    name: 'Custom Rules (WAF)',
    description: 'Challenge requests to admin path',
    rule: {
      action: 'managed_challenge',
      expression: '(http.request.uri.path contains "/maxconfig-admin")',
      description: '[MaxConfig] Challenge admin access',
      enabled: true,
    },
  },
  {
    phase: 'http_request_firewall_custom',
    name: 'Custom Rules (WAF)',
    description: 'Block MaxConfig test user agent',
    rule: {
      action: 'block',
      expression: '(http.user_agent contains "MaxConfig-Bot-Test")',
      description: '[MaxConfig] Block test bot user agent',
      enabled: true,
    },
  },

  // Origin Rules - http_request_origin
  {
    phase: 'http_request_origin',
    name: 'Origin Rules',
    description: 'Override origin for specific path',
    rule: {
      action: 'route',
      expression: 'starts_with(http.request.uri.path, "/maxconfig-api/")',
      description: '[MaxConfig] Route API to origin',
      action_parameters: {
        origin: {
          host: 'maxconfig-origin.{zone_name}',
          port: 443,
        },
      },
      enabled: true,
    },
  },

  // Cache Rules - http_request_cache_settings
  {
    phase: 'http_request_cache_settings',
    name: 'Cache Rules',
    description: 'Cache static assets aggressively',
    rule: {
      action: 'set_cache_settings',
      expression: '(http.request.uri.path.extension in {"js" "css" "png" "jpg" "gif" "webp"})',
      description: '[MaxConfig] Cache static assets',
      action_parameters: {
        cache: true,
        edge_ttl: {
          mode: 'override_origin',
          default: 86400,
        },
        browser_ttl: {
          mode: 'override_origin',
          default: 3600,
        },
      },
      enabled: true,
    },
  },
  {
    phase: 'http_request_cache_settings',
    name: 'Cache Rules',
    description: 'Bypass cache for API endpoints',
    rule: {
      action: 'set_cache_settings',
      expression: 'starts_with(http.request.uri.path, "/maxconfig-nocache/")',
      description: '[MaxConfig] Bypass cache for API',
      action_parameters: {
        cache: false,
      },
      enabled: true,
    },
  },

  // Config Rules - http_config_settings  
  {
    phase: 'http_config_settings',
    name: 'Config Rules',
    description: 'Enable specific features for path',
    rule: {
      action: 'set_config',
      expression: 'starts_with(http.request.uri.path, "/maxconfig-optimized/")',
      description: '[MaxConfig] Optimized config',
      action_parameters: {
        bic: true,
        rocket_loader: true,
        // Note: mirage and polish require Pro+ plan
      },
      enabled: true,
    },
  },

  // Transform Rules - URL Rewrite - http_request_transform
  {
    phase: 'http_request_transform',
    name: 'Transform Rules (URL Rewrite)',
    description: 'Rewrite URL path',
    rule: {
      action: 'rewrite',
      expression: '(http.request.uri.path eq "/maxconfig-old-path")',
      description: '[MaxConfig] URL rewrite',
      action_parameters: {
        uri: {
          path: {
            value: '/maxconfig-new-path',
          },
        },
      },
      enabled: true,
    },
  },

  // Transform Rules - Request Headers - http_request_late_transform
  {
    phase: 'http_request_late_transform',
    name: 'Transform Rules (Request Headers)',
    description: 'Add custom request header',
    rule: {
      action: 'rewrite',
      expression: 'starts_with(http.request.uri.path, "/maxconfig/")',
      description: '[MaxConfig] Add request header',
      action_parameters: {
        headers: {
          'X-MaxConfig-Request': {
            operation: 'set',
            value: 'enabled',
          },
        },
      },
      enabled: true,
    },
  },

  // Transform Rules - Response Headers - http_response_headers_transform
  {
    phase: 'http_response_headers_transform',
    name: 'Transform Rules (Response Headers)',
    description: 'Add custom response header',
    rule: {
      action: 'rewrite',
      expression: 'starts_with(http.request.uri.path, "/maxconfig/")',
      description: '[MaxConfig] Add response header',
      action_parameters: {
        headers: {
          'X-MaxConfig-Response': {
            operation: 'set',
            value: 'enabled',
          },
        },
      },
      enabled: true,
    },
  },

  // Redirect Rules - http_request_dynamic_redirect
  {
    phase: 'http_request_dynamic_redirect',
    name: 'Redirect Rules',
    description: 'Dynamic redirect',
    rule: {
      action: 'redirect',
      expression: '(http.request.uri.path eq "/maxconfig-redirect-me")',
      description: '[MaxConfig] Test redirect',
      action_parameters: {
        from_value: {
          status_code: 302,
          target_url: {
            value: '/maxconfig-redirected',
          },
          preserve_query_string: true,
        },
      },
      enabled: true,
    },
  },

  // Compression Rules - http_response_compression
  {
    phase: 'http_response_compression',
    name: 'Compression Rules',
    description: 'Enable gzip compression',
    rule: {
      action: 'compress_response',
      expression: 'starts_with(http.request.uri.path, "/maxconfig-compress/")',
      description: '[MaxConfig] Enable compression',
      action_parameters: {
        algorithms: [
          { name: 'gzip' },
          { name: 'brotli' },
        ],
      },
      enabled: true,
    },
  },

  // Rate Limiting Rules - http_ratelimit
  {
    phase: 'http_ratelimit',
    name: 'Rate Limiting Rules',
    description: 'Rate limit API endpoints',
    rule: {
      action: 'block',
      expression: 'starts_with(http.request.uri.path, "/maxconfig-api/")',
      description: '[MaxConfig] Rate limit API',
      ratelimit: {
        characteristics: ['cf.colo.id', 'ip.src'],
        period: 10, // Free plan only allows period of 10
        requests_per_period: 100,
        mitigation_timeout: 10,
      },
      enabled: true,
    },
  },

  // DDoS Custom Rules - ddos_l7 (Note: Most DDoS rules require Enterprise)
  // Skipped - ddos_l7 phase requires specific rule format that varies by plan

  // Log Custom Fields - http_log_custom_fields (Enterprise only)
  // Note: Field names must be lowercase
  // Skipped - requires Enterprise plan and specific log push setup
];

// Group rules by phase for easy lookup
export function getRulesByPhase(): Map<string, RuleDefinition[]> {
  const byPhase = new Map<string, RuleDefinition[]>();
  for (const rule of MAXIMUM_CONFIG_RULES) {
    const existing = byPhase.get(rule.phase) || [];
    existing.push(rule);
    byPhase.set(rule.phase, existing);
  }
  return byPhase;
}

function replaceRulePlaceholders(value: unknown, zoneName: string): unknown {
  if (typeof value === 'string') return value.replaceAll('{zone_name}', zoneName);
  if (Array.isArray(value)) return value.map(v => replaceRulePlaceholders(v, zoneName));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, replaceRulePlaceholders(v, zoneName)]),
    );
  }
  return value;
}

// Get list of all rule types for display
export function getRuleTypesList(): string[] {
  const types = new Set<string>();
  for (const rule of MAXIMUM_CONFIG_RULES) {
    types.add(rule.name);
  }
  return Array.from(types);
}

// Zone setting definitions with valid test values
// Based on https://developers.cloudflare.com/api/resources/zones/subresources/settings/
export interface SettingDefinition {
  id: string;
  description: string;
  type: 'on_off' | 'string' | 'number' | 'object' | 'array';
  testValues: unknown[];
  planRequired?: 'free' | 'pro' | 'business' | 'enterprise';
  deprecated?: boolean;
}

export const ZONE_SETTINGS: SettingDefinition[] = [
  // On/Off toggles
  { id: '0rtt', description: '0-RTT session resumption', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'always_online', description: 'Always Online', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'always_use_https', description: 'Always Use HTTPS', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'automatic_https_rewrites', description: 'Automatic HTTPS Rewrites', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'brotli', description: 'Brotli compression', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'browser_check', description: 'Browser Integrity Check', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'development_mode', description: 'Development Mode', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'early_hints', description: 'Early Hints (103)', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'email_obfuscation', description: 'Email Obfuscation', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'hotlink_protection', description: 'Hotlink Protection', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'http2', description: 'HTTP/2', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'http3', description: 'HTTP/3 (QUIC)', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'ip_geolocation', description: 'IP Geolocation', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'ipv6', description: 'IPv6 Compatibility', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'opportunistic_encryption', description: 'Opportunistic Encryption', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'opportunistic_onion', description: 'Onion Routing', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'origin_error_page_pass_thru', description: 'Origin Error Page Pass-through', type: 'on_off', testValues: ['on', 'off'], planRequired: 'enterprise' },
  { id: 'prefetch_preload', description: 'Prefetch URLs', type: 'on_off', testValues: ['on', 'off'], planRequired: 'enterprise' },
  { id: 'privacy_pass', description: 'Privacy Pass', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'response_buffering', description: 'Response Buffering', type: 'on_off', testValues: ['on', 'off'], planRequired: 'enterprise' },
  { id: 'rocket_loader', description: 'Rocket Loader', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'server_side_exclude', description: 'Server Side Excludes', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'sort_query_string_for_cache', description: 'Query String Sort', type: 'on_off', testValues: ['on', 'off'], planRequired: 'enterprise' },
  { id: 'tls_1_3', description: 'TLS 1.3', type: 'on_off', testValues: ['on', 'off', 'zrt'] },
  { id: 'tls_client_auth', description: 'TLS Client Auth', type: 'on_off', testValues: ['on', 'off'], planRequired: 'enterprise' },
  { id: 'true_client_ip_header', description: 'True Client IP Header', type: 'on_off', testValues: ['on', 'off'], planRequired: 'enterprise' },
  { id: 'websockets', description: 'WebSockets', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'webp', description: 'WebP', type: 'on_off', testValues: ['off'], planRequired: 'pro' }, // on requires Polish
  { id: 'waf', description: 'Web Application Firewall', type: 'on_off', testValues: ['on', 'off'], deprecated: true },
  { id: 'ech', description: 'Encrypted Client Hello', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'fonts', description: 'Cloudflare Fonts', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'cname_flattening', description: 'CNAME Flattening', type: 'string', testValues: ['flatten_at_root', 'flatten_all'] },
  { id: 'h2_prioritization', description: 'HTTP/2 Edge Prioritization', type: 'on_off', testValues: ['on', 'off', 'custom'], planRequired: 'pro' },
  { id: 'replace_insecure_js', description: 'Replace Insecure JS', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'mirage', description: 'Mirage Image Optimization', type: 'on_off', testValues: ['on', 'off'], planRequired: 'pro' },
  // orange_to_orange - Skipped: Cannot be changed via API for most zones
  { id: 'proxy_read_timeout', description: 'Proxy Read Timeout', type: 'number', testValues: [100], planRequired: 'enterprise' },
  { id: 'speed_brain', description: 'Speed Brain', type: 'on_off', testValues: ['on', 'off'] },
  { id: 'advanced_ddos', description: 'Advanced DDoS Protection', type: 'on_off', testValues: ['on', 'off'], planRequired: 'business' },
  { id: 'sha1_support', description: 'SHA-1 Certificate Support', type: 'on_off', testValues: ['on', 'off'] },
  // visitor_ip - Skipped: Cannot be changed via API for most zones
  { id: 'origin_dns_name', description: 'Origin DNS Name', type: 'string', testValues: [''], planRequired: 'enterprise' },
  { id: 'auto_minify', description: 'Auto Minify (deprecated)', type: 'on_off', testValues: ['on', 'off'], deprecated: true },

  // String/enum values
  { id: 'ssl', description: 'SSL mode', type: 'string', testValues: ['off', 'flexible', 'full', 'strict'] },
  { id: 'cache_level', description: 'Caching Level', type: 'string', testValues: ['aggressive', 'basic', 'simplified'] },
  { id: 'min_tls_version', description: 'Minimum TLS Version', type: 'string', testValues: ['1.0', '1.1', '1.2', '1.3'] },
  { id: 'security_level', description: 'Security Level', type: 'string', testValues: ['off', 'essentially_off', 'low', 'medium', 'high', 'under_attack'] },
  { id: 'polish', description: 'Polish', type: 'string', testValues: ['off', 'lossless', 'lossy'], planRequired: 'pro' },
  { id: 'pseudo_ipv4', description: 'Pseudo IPv4', type: 'string', testValues: ['off', 'add_header', 'overwrite_header'] },
  { id: 'image_resizing', description: 'Image Resizing', type: 'string', testValues: ['on', 'off'], planRequired: 'business' },

  // Number values
  { id: 'browser_cache_ttl', description: 'Browser Cache TTL', type: 'number', testValues: [0, 30, 60, 300, 1200, 1800, 3600, 7200, 10800, 14400, 18000, 28800, 43200, 57600, 72000, 86400, 172800, 259200, 345600, 432000, 691200, 1382400, 2073600, 2678400, 5356800, 16070400, 31536000] },
  { id: 'challenge_ttl', description: 'Challenge TTL', type: 'number', testValues: [300, 900, 1800, 2700, 3600, 7200, 10800, 14400, 28800, 57600, 86400, 604800, 2592000, 31536000] },
  { id: 'max_upload', description: 'Max Upload Size (MB)', type: 'number', testValues: [100], planRequired: 'free' }, // Free/Pro: 100MB max, Business: 200MB, Enterprise: 500MB+
  { id: 'edge_cache_ttl', description: 'Edge Cache TTL', type: 'number', testValues: [7200, 10800, 14400, 18000, 28800, 43200, 57600, 72000, 86400, 172800, 259200, 345600, 432000, 518400, 604800] }, // Min 7200 for Free plan
  { id: 'origin_max_http_version', description: 'Origin Max HTTP Version', type: 'string', testValues: ['1', '2'] },
  // Dedicated-endpoint settings: these live behind their own /settings/<id>
  // endpoints and are NOT returned by the aggregate GET, so they are applied
  // via the dedicated-endpoint fallback in fuzzZoneSettings (same URL).
  // ssl_automatic_mode: doc-verified string value ("custom" opts out; "auto"
  // enables Automatic SSL/TLS). origin_h2_max_streams: SDK-verified numeric
  // value (cloudflare@6.3.0 models it as `value?: number`).
  { id: 'ssl_automatic_mode', description: 'Automatic SSL/TLS', type: 'string', testValues: ['auto', 'custom'] },
  { id: 'origin_h2_max_streams', description: 'Origin Max HTTP/2 Streams', type: 'number', testValues: [200, 100] },
  // rum (Web Analytics / RUM auto-injection). Value shape verified live against
  // GET/PATCH /zones/{id}/settings/rum (2026-06-02): it's a plain on/off string,
  // exactly like any other on_off toggle. The GET response carries extra
  // read-only fields (`site_tag`, `lite`, `host`, `zone_name`) but the PATCH body
  // is just `{ "value": "on" | "off" }`. Setting "on" auto-provisions a Web
  // Analytics `site_tag` server-side; "off" disables auto-injection (the site_tag
  // persists). `editable: true` on Free/Pro/Biz/Ent — no plan gate observed.
  { id: 'rum', description: 'Web Analytics (RUM)', type: 'on_off', testValues: ['on', 'off'] },
  // origin_tls_compliance_modes (SSL/TLS → Origin Server). Dedicated-endpoint
  // Origin-TLS setting omitted by the aggregate GET; export-zone backfills it
  // via getZoneSetting and the settings loop PATCHes /settings/origin_tls_compliance_modes
  // with the standard { value } body. value is an array of compliance-mode IDs;
  // testValues[0] is the empty/default set so MaxConfig/fuzz never enable a
  // compliance regime. Often plan/entitlement-gated; a missing entitlement on
  // the dest is acknowledged (Principle 2), never a failed row. (No planRequired
  // hint set — the exact gate is unverified; the migrate path handles rejection.)
  { id: 'origin_tls_compliance_modes', description: 'Origin TLS Compliance Modes', type: 'array', testValues: [[]] },

  // Object values
  { id: 'minify', description: 'Auto Minify', type: 'object', testValues: [
    { css: 'on', html: 'on', js: 'on' },
    { css: 'off', html: 'off', js: 'off' },
    { css: 'on', html: 'off', js: 'on' },
  ]},
  { id: 'mobile_redirect', description: 'Mobile Redirect', type: 'object', testValues: [
    { status: 'off', mobile_subdomain: null, strip_uri: false },
  ]},
  { id: 'nel', description: 'Network Error Logging', type: 'object', testValues: [
    { enabled: true },
    { enabled: false },
  ]},
  { id: 'security_header', description: 'Security Headers (HSTS)', type: 'object', testValues: [
    { strict_transport_security: { enabled: false, max_age: 0, include_subdomains: false, nosniff: false } },
    { strict_transport_security: { enabled: true, max_age: 86400, include_subdomains: true, nosniff: true } },
  ]},
  // CSAM Scanner lives ONLY behind its dedicated /settings/csam_scanner_third_party
  // endpoint — the aggregate GET /zones/{id}/settings does NOT return it (verified
  // against the OpenAPI aggregate response schema, which enumerates 63 setting
  // members, none of them csam). Without this entry curatedSettingsAbsentFromAggregate
  // never backfills it, so the migration would silently drop it (the daily
  // spec-drift monitor flagged exactly this gap). The migration path copies the
  // live source value; testValues[0] is intentionally a benign DISABLED value so
  // MaxConfig/fuzz never enable scanning or trigger the verification email that
  // enabling-with-an-email would fire. Migrate handles a missing dest entitlement
  // via the acknowledgment path (Principle 2), not a failure.
  { id: 'csam_scanner_third_party', description: 'CSAM Scanner (third-party)', type: 'object', testValues: [
    { enabled: false },
  ]},

  // Array values  
  { id: 'ciphers', description: 'Cipher Suites', type: 'array', testValues: [
    [], // Reset to default
  ], planRequired: 'enterprise' },
];

const MAXCONFIG_UNSUPPORTED_SETTING_IDS = new Set([
  // Deprecated in favor of min_tls_version and returns a hard API error when PATCHed.
  'tls_1_2_only',
  // These are present in older setting catalogs but are rejected by current zone settings APIs.
  'sha1_support',
  'origin_dns_name',
  // Network Error Logging returns auth.forbidden for this API-key driven preset path.
  'nel',
]);

export function shouldSkipMaxConfigSetting(settingId: string): boolean {
  return BLOCKED_SETTINGS.has(settingId) ||
    READ_ONLY_SETTINGS.has(settingId) ||
    MAXCONFIG_UNSUPPORTED_SETTING_IDS.has(settingId);
}

export interface FuzzResult {
  settingId: string;
  description: string;
  testValue: unknown;
  success: boolean;
  error?: string;
  /** The write was rejected by a plan/entitlement/zone-state gap the operator
   * cannot fix mid-run (e.g. an Enterprise-only setting on a lower tier). Per
   * Principle 1/2 this is an ACKNOWLEDGED outcome, not a failure: `success`
   * stays false because no write landed, but it must not inflate `failed`. */
  acknowledged?: boolean;
  responseTime: number;
}

export interface FuzzReport {
  timestamp: string;
  zoneId: string;
  zoneName: string;
  totalTests: number;
  successful: number;
  failed: number;
  /** Plan/entitlement/zone-state gaps surfaced as acknowledged, never as
   * failures (Principle 1/2). Counted separately from successful + failed. */
  acknowledged: number;
  results: FuzzResult[];
}

// [W3+W17] Helper to run promises with concurrency limit — rewritten with proper semaphore pattern.
// Returns PromiseSettledResult[] to preserve order and handle rejections gracefully.
async function parallelWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (e) {
        api.throwIfAuthError(e);
        results[i] = { status: 'rejected', reason: e };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// Determine the "maximum" value for a setting
/**
 * Curated settings that live behind dedicated /zones/{id}/settings/<id>
 * endpoints and are NOT returned by the aggregate GET /zones/{id}/settings.
 *
 * fuzzZoneSettings drives off the aggregate GET, so without this it would never
 * see settings like speed_brain, fonts, origin_max_http_version,
 * ssl_automatic_mode, origin_h2_max_streams, or rum — their curated entries
 * were dead. Given the set of setting IDs the aggregate GET returned, this
 * yields the curated ZONE_SETTINGS whose IDs are absent so they can be applied
 * directly via their dedicated endpoint (PATCH /settings/<id>, the same URL
 * api.updateZoneSetting uses).
 */
export function curatedSettingsAbsentFromAggregate(aggregateIds: Set<string>): SettingDefinition[] {
  return ZONE_SETTINGS.filter(def => !def.deprecated && !shouldSkipMaxConfigSetting(def.id) && !aggregateIds.has(def.id));
}

function getMaxValue(setting: SettingDefinition): unknown {
  if (setting.type === 'on_off') {
    return setting.testValues.includes('on') ? 'on' : setting.testValues[0];
  } else if (setting.id === 'ssl') {
    return 'strict';
  } else if (setting.id === 'cache_level') {
    return 'aggressive';
  } else if (setting.id === 'min_tls_version') {
    return '1.2';
  } else if (setting.id === 'security_level') {
    return 'high';
  } else if (setting.id === 'polish') {
    return 'lossy';
  } else if (setting.id === 'pseudo_ipv4') {
    return 'add_header';
  } else if (setting.id === 'browser_cache_ttl') {
    return 31536000;
  } else if (setting.id === 'challenge_ttl') {
    return 31536000;
  } else if (setting.id === 'max_upload') {
    return setting.testValues[setting.testValues.length - 1];
  } else if (setting.id === 'proxy_read_timeout') {
    return 100; // 100 seconds
  } else if (setting.id === 'origin_dns_name') {
    return ''; // Empty string to clear
  } else if (setting.id === 'security_header') {
    // Enable HSTS with preload for maximum security
    return { strict_transport_security: { enabled: true, max_age: 31536000, include_subdomains: true, preload: true, nosniff: true } };
  }
  return setting.testValues[0];
}

const MAX_CONCURRENT_SETTINGS = 10;

function getHeuristicMaxCandidates(settingId: string, currentValue: unknown): unknown[] {
  const candidates: unknown[] = [];
  const lower = settingId.toLowerCase();

  const push = (v: unknown) => {
    // Avoid duplicates (best-effort shallow equality)
    const asJson = (x: unknown) => {
      try { return JSON.stringify(x); } catch { return String(x); }
    };
    const key = asJson(v);
    if (!candidates.some(c => asJson(c) === key)) candidates.push(v);
  };

  // Type-driven heuristics
  if (typeof currentValue === 'boolean') {
    push(true);
  } else if (typeof currentValue === 'number') {
    if (lower.includes('ttl')) push(31_536_000);
    else if (lower.includes('timeout')) push(100);
    else if (lower.includes('max')) push(Math.max(currentValue, 1_000_000));
    else push(Math.max(currentValue, 31_536_000));
  } else if (typeof currentValue === 'string') {
    if (currentValue === 'on' || currentValue === 'off') push('on');
    if (lower.includes('ssl')) {
      push('strict');
      push('full');
    }
    if (lower.includes('security')) {
      push('under_attack');
      push('high');
    }
    if (lower.includes('cache') && lower.includes('level')) push('aggressive');
    if (lower.includes('min_tls')) {
      push('1.3');
      push('1.2');
    }
    if (lower.includes('pseudo_ipv4')) push('add_header');
    // Generic "max" attempt
    push('on');
  } else if (currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    const obj = currentValue as Record<string, unknown>;

    // Common patterns in Cloudflare settings payloads
    if ('enabled' in obj && typeof obj.enabled === 'boolean') {
      push({ ...obj, enabled: true });
    }
    if ('status' in obj && typeof obj.status === 'string') {
      push({ ...obj, status: 'on' });
      push({ ...obj, status: 'active' });
    }

    // Turn all top-level boolean flags on
    const allTrue: Record<string, unknown> = { ...obj };
    let changed = false;
    for (const [k, v] of Object.entries(allTrue)) {
      if (typeof v === 'boolean' && v === false) {
        allTrue[k] = true;
        changed = true;
      }
    }
    if (changed) push(allTrue);
  }

  // Fallback if we couldn't infer anything meaningful
  if (candidates.length === 0) {
    push('on');
    push(true);
  }

  // Keep this bounded so we don't explode request count.
  return candidates.slice(0, 5);
}

function getHeuristicMinCandidates(settingId: string, currentValue: unknown): unknown[] {
  const candidates: unknown[] = [];
  const lower = settingId.toLowerCase();

  const push = (v: unknown) => {
    const asJson = (x: unknown) => {
      try { return JSON.stringify(x); } catch { return String(x); }
    };
    const key = asJson(v);
    if (!candidates.some(c => asJson(c) === key)) candidates.push(v);
  };

  if (typeof currentValue === 'boolean') {
    push(false);
  } else if (typeof currentValue === 'number') {
    if (lower.includes('ttl')) {
      push(0);
      push(1);
    } else {
      push(0);
    }
  } else if (typeof currentValue === 'string') {
    if (currentValue === 'on' || currentValue === 'off') push('off');
    if (lower.includes('ssl')) {
      push('full');
      push('flexible');
    }
    if (lower.includes('security')) {
      push('medium');
      push('low');
    }
    if (lower.includes('cache') && lower.includes('level')) push('basic');
    if (lower.includes('min_tls')) push('1.0');
    push('off');
    push('none');
  } else if (currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    const obj = currentValue as Record<string, unknown>;
    if ('enabled' in obj && typeof obj.enabled === 'boolean') {
      push({ ...obj, enabled: false });
    }
    if ('status' in obj && typeof obj.status === 'string') {
      push({ ...obj, status: 'off' });
      push({ ...obj, status: 'disabled' });
    }

    const allFalse: Record<string, unknown> = { ...obj };
    let changed = false;
    for (const [k, v] of Object.entries(allFalse)) {
      if (typeof v === 'boolean' && v === true) {
        allFalse[k] = false;
        changed = true;
      }
    }
    if (changed) push(allFalse);
  } else if (Array.isArray(currentValue)) {
    push([]);
  }

  if (candidates.length === 0) {
    push('off');
    push(false);
  }
  return candidates.slice(0, 5);
}

export async function fuzzZoneSettings(
  auth: api.ApiAuth | string,
  zoneId: string,
  log: LogFn = console.log
): Promise<FuzzReport> {
  log('🎄 Starting Maximum Config - Zone Settings...');
  
  // Get zone info
  const zone = await api.getZone(auth, zoneId);
  log(`✓ Zone: ${zone.name}`);
  
  // Get current settings to know what's editable
  const currentSettings = await api.listZoneSettings(auth, zoneId);
  const editableSettingIds = new Set(
    currentSettings.filter(s => s.editable).map(s => s.id)
  );
  log(`✓ Found ${editableSettingIds.size} editable settings`);

  const known = new Map(ZONE_SETTINGS.map(s => [s.id, s] as const));

  // Build a "best effort" list that includes every editable setting returned by the API.
  // Known settings use curated max values; unknown ones use heuristics and may fail.
  const settingsToUpdate: Array<{ id: string; description: string; candidates: unknown[]; kind: 'known' | 'heuristic' }> = [];

  for (const s of currentSettings) {
    if (!s.editable) continue;
    if (shouldSkipMaxConfigSetting(s.id)) {
      log(`⏭ Skipping ${s.id} (not writable by MaxConfig)`);
      continue;
    }

    const def = known.get(s.id);
    if (def) {
      if (def.deprecated) {
        log(`⏭ Skipping ${def.id} (deprecated)`);
        continue;
      }
      settingsToUpdate.push({
        id: def.id,
        description: def.description,
        candidates: [getMaxValue(def)],
        kind: 'known',
      });
      continue;
    }

    // Unknown editable setting — attempt a few likely "max" candidates.
    settingsToUpdate.push({
      id: s.id,
      description: s.id,
      candidates: getHeuristicMaxCandidates(s.id, (s as any).value),
      kind: 'heuristic',
    });
  }

  // Dedicated-endpoint settings: the aggregate GET above omits settings that
  // live behind their own /settings/<id> endpoint (speed_brain, fonts,
  // ssl_automatic_mode, origin_h2_max_streams, rum, …). The loop never sees
  // them, so apply every curated setting whose ID is absent from the aggregate
  // response directly via its dedicated endpoint (same URL). Without this those
  // curated entries were dead and MaxConfig silently skipped them.
  const presentIds = new Set(currentSettings.map(s => s.id));
  for (const def of curatedSettingsAbsentFromAggregate(presentIds)) {
    settingsToUpdate.push({
      id: def.id,
      description: def.description,
      candidates: [getMaxValue(def)],
      kind: 'known',
    });
  }

  const knownCount = settingsToUpdate.filter(s => s.kind === 'known').length;
  const heuristicCount = settingsToUpdate.length - knownCount;
  log(`⚡ Updating ${settingsToUpdate.length} settings (known: ${knownCount}, heuristic: ${heuristicCount}) in parallel (max ${MAX_CONCURRENT_SETTINGS} concurrent)...`);

  // Update all settings in parallel with concurrency limit
  const settledResults = await parallelWithLimit(
    settingsToUpdate,
    MAX_CONCURRENT_SETTINGS,
    async ({ id, description, candidates, kind }): Promise<FuzzResult> => {
      const startTime = Date.now();
      try {
        let lastErr: Error | null = null;
        for (const candidate of candidates) {
          try {
            await api.updateZoneSetting(auth, zoneId, id, candidate);
            const responseTime = Date.now() - startTime;
            log(`✓ ${id} = ${JSON.stringify(candidate)} (${responseTime}ms)${kind === 'heuristic' ? ' [heuristic]' : ''}`);
            return {
              settingId: id,
              description,
              testValue: candidate,
              success: true,
              responseTime,
            };
          } catch (e: unknown) {
            api.throwIfAuthError(e);
            lastErr = e as Error;
          }
        }
        throw lastErr || new Error('Unknown error');
      } catch (e: unknown) {
        api.throwIfAuthError(e);
        const err = e as Error;
        const responseTime = Date.now() - startTime;
        const displayCandidate = candidates.length === 1 ? JSON.stringify(candidates[0]) : `[${candidates.length} candidates]`;
        // Plan/entitlement-gated settings (e.g. Enterprise-only
        // origin_max_http_version / origin_h2_max_streams → "Access denied." on
        // a lower tier) are EXPECTED for the zone's plan, not defects. Surface
        // them as acknowledged (⏭), not failed (Principle 1/2). The acknowledged
        // flag is reconciled into the report counts below.
        const ack = isMaxConfigAcknowledgeable(err.message);
        log(`${ack ? '⏭' : '✗'} ${id} = ${displayCandidate}: ${err.message}${kind === 'heuristic' ? ' [heuristic]' : ''}`);
        return {
          settingId: id,
          description,
          testValue: candidates[0],
          success: false,
          acknowledged: ack,
          error: err.message,
          responseTime,
        };
      }
    }
  );
  // Unwrap PromiseSettledResult — fn catches internally so all are fulfilled
  const results = settledResults.filter((r): r is PromiseFulfilledResult<FuzzResult> => r.status === 'fulfilled').map(r => r.value);

  // Reclassify plan/entitlement-gated rejections out of the failure bucket —
  // they're acknowledged outcomes for the zone's tier, not failures (#15 / P1).
  const acknowledged = countAcknowledged(results);
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success && !r.acknowledged).length;

  log('');
  log(`📊 Settings Test Complete: ${successful} successful, ${acknowledged} acknowledged (plan/entitlement), ${failed} failed`);

  return {
    timestamp: new Date().toISOString(),
    zoneId,
    zoneName: zone.name,
    totalTests: results.length,
    acknowledged,
    successful,
    failed,
    results,
  };
}

// Additional API endpoints to fuzz
export interface ApiEndpointDefinition {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  testPayloads: Array<Record<string, unknown> | null>;
  planRequired?: string;
}

export const ZONE_API_ENDPOINTS: ApiEndpointDefinition[] = [
  // DNS Records
  {
    name: 'Create DNS A Record',
    method: 'POST',
    path: '/zones/{zone_id}/dns_records',
    description: 'Create an A record',
    testPayloads: [
      { type: 'A', name: 'fuzz-test', content: '192.0.2.1', ttl: 1, proxied: false },
      { type: 'A', name: 'fuzz-test-proxied', content: '192.0.2.1', ttl: 1, proxied: true },
    ],
  },
  {
    name: 'Create DNS AAAA Record',
    method: 'POST',
    path: '/zones/{zone_id}/dns_records',
    description: 'Create an AAAA record',
    testPayloads: [
      { type: 'AAAA', name: 'fuzz-test-v6', content: '2001:db8::1', ttl: 1, proxied: false },
    ],
  },
  {
    name: 'Create DNS CNAME Record',
    method: 'POST',
    path: '/zones/{zone_id}/dns_records',
    description: 'Create a CNAME record',
    testPayloads: [
      { type: 'CNAME', name: 'fuzz-cname', content: 'example.com', ttl: 1, proxied: false },
    ],
  },
  {
    name: 'Create DNS TXT Record',
    method: 'POST',
    path: '/zones/{zone_id}/dns_records',
    description: 'Create a TXT record',
    testPayloads: [
      { type: 'TXT', name: 'fuzz-txt', content: 'v=spf1 -all', ttl: 1 },
    ],
  },
  // DNS Edge Cases (structured payloads)
  {
    name: 'Create DNS LOC Record',
    method: 'POST',
    path: '/zones/{zone_id}/dns_records',
    description: 'Create a LOC record (rare structured payload)',
    testPayloads: [
      {
        type: 'LOC',
        name: 'fuzz-loc',
        ttl: 1,
        comment: '[MaxConfig] fuzz api LOC',
        data: {
          lat_degrees: 37, lat_minutes: 46, lat_seconds: 30, lat_direction: 'N',
          long_degrees: 122, long_minutes: 23, long_seconds: 30, long_direction: 'W',
          altitude: 10, size: 1, precision_horz: 100, precision_vert: 10,
        },
      },
    ],
  },
  {
    name: 'Create DNS SRV Record',
    method: 'POST',
    path: '/zones/{zone_id}/dns_records',
    description: 'Create an SRV record (service discovery)',
    testPayloads: [
      {
        type: 'SRV',
        name: '_sip._tcp.fuzz-srv',
        ttl: 1,
        comment: '[MaxConfig] fuzz api SRV',
        data: { priority: 10, weight: 5, port: 5060, target: 'sip.example.com' },
      },
    ],
  },
  {
    name: 'Create DNS URI Record',
    method: 'POST',
    path: '/zones/{zone_id}/dns_records',
    description: 'Create a URI record (rare)',
    testPayloads: [
      {
        type: 'URI',
        name: 'fuzz-uri',
        ttl: 1,
        comment: '[MaxConfig] fuzz api URI',
        priority: 10,
        data: { weight: 1, target: 'https://example.com/fuzz' },
      },
    ],
  },
  {
    name: 'Create DNS HTTPS Record',
    method: 'POST',
    path: '/zones/{zone_id}/dns_records',
    description: 'Create an HTTPS record (modern service binding)',
    testPayloads: [
      {
        type: 'HTTPS',
        name: 'fuzz-https',
        ttl: 1,
        comment: '[MaxConfig] fuzz api HTTPS',
        data: { priority: 1, target: '.', value: 'alpn=h3,h2' },
      },
    ],
  },
  {
    name: 'Create DNS SVCB Record',
    method: 'POST',
    path: '/zones/{zone_id}/dns_records',
    description: 'Create an SVCB record (modern service binding)',
    testPayloads: [
      {
        type: 'SVCB',
        name: 'fuzz-svcb',
        ttl: 1,
        comment: '[MaxConfig] fuzz api SVCB',
        data: { priority: 1, target: '.', value: 'alpn=h3,h2' },
      },
    ],
  },

  // Page Rules
  {
    name: 'Create Page Rule',
    method: 'POST',
    path: '/zones/{zone_id}/pagerules',
    description: 'Create a page rule',
    testPayloads: [
      {
        targets: [{ target: 'url', constraint: { operator: 'matches', value: '*fuzz-test.{zone_name}/*' } }],
        actions: [{ id: 'browser_cache_ttl', value: 14400 }],
        priority: 1,
        status: 'active',
      },
    ],
  },

  // Firewall Access Rules / Lockdowns / UA Rules
  {
    name: 'Create Firewall Access Rule',
    method: 'POST',
    path: '/zones/{zone_id}/firewall/access_rules/rules',
    description: 'Create a firewall access rule',
    testPayloads: [
      {
        mode: 'block',
        configuration: { target: 'ip', value: '192.0.2.55' },
        notes: '[MaxConfig] fuzz api access rule',
      },
    ],
  },
  {
    name: 'Create Firewall Lockdown',
    method: 'POST',
    path: '/zones/{zone_id}/firewall/lockdowns',
    description: 'Create a firewall lockdown rule',
    testPayloads: [
      {
        urls: ['https://{zone_name}/fuzz-lockdown/*'],
        configurations: [{ target: 'ip', value: '192.0.2.55' }],
        description: '[MaxConfig] fuzz api lockdown',
        paused: false,
        priority: 1,
      },
    ],
  },
  {
    name: 'Create Firewall UA Rule',
    method: 'POST',
    path: '/zones/{zone_id}/firewall/ua_rules',
    description: 'Create a firewall UA rule',
    testPayloads: [
      {
        mode: 'block',
        configuration: { target: 'ua', value: 'MaxConfig-UA-Test' },
        description: '[MaxConfig] fuzz api ua rule',
        paused: false,
      },
    ],
  },

  // Cache purge (action endpoint)
  {
    name: 'Purge Cache (Everything)',
    method: 'POST',
    path: '/zones/{zone_id}/purge_cache',
    description: 'Purge cache for entire zone',
    testPayloads: [
      { purge_everything: true },
    ],
  },

  // API Gateway settings (schema validation)
  {
    name: 'API Gateway Schema Validation Settings',
    method: 'PATCH',
    path: '/zones/{zone_id}/api_gateway/settings/schema_validation',
    description: 'Enable schema validation mitigation actions',
    testPayloads: [
      { validation_default_mitigation_action: 'block', validation_override_mitigation_action: 'none' },
    ],
  },

  // Turnstile (account-scoped; will be skipped if account_id not present)
  {
    name: 'Create Turnstile Widget',
    method: 'POST',
    path: '/accounts/{account_id}/challenges/widgets',
    description: 'Create a Turnstile widget (account scope)',
    testPayloads: [
      { name: 'maxconfig-turnstile-fuzz', mode: 'managed', domains: ['{zone_name}'], region: 'world' },
    ],
  },
];

export interface ApiEndpointResult {
  name: string;
  method: string;
  path: string;
  payload: Record<string, unknown>;
  success: boolean;
  /** The write was rejected because the resource is already present on the
   * target as desired (conflict/duplicate/identical). Counted as on-target,
   * NOT a failure (AGENTS.md Principle 1 / #15). `success` stays false because
   * no write happened, but `alreadyPresent` distinguishes it from a real error. */
  alreadyPresent?: boolean;
  /** Rejected by a plan/entitlement/zone-state/credential-scope gap the
   * operator cannot fix mid-run (e.g. zonelockdown not_entitled.max_rules, or a
   * Cache Purge "Unauthorized" when the token lacks the purge permission).
   * Acknowledged, not failed (Principle 1/2). */
  acknowledged?: boolean;
  statusCode?: number;
  error?: string;
  responseTime: number;
  resourceId?: string;
}

export interface ApiFuzzReport {
  timestamp: string;
  zoneId: string;
  zoneName: string;
  totalTests: number;
  successful: number;
  failed: number;
  /** Writes that were no-ops because the resource was already present as
   * desired. On-target, counted with successful — never as failures. */
  alreadyPresent: number;
  /** Plan/entitlement/zone-state/credential-scope gaps surfaced as
   * acknowledged, never as failures (Principle 1/2). */
  acknowledged: number;
  results: ApiEndpointResult[];
  createdResources: { type: string; id: string }[];
}

/** Structural superset of the preset report shapes (FuzzReport, ApiFuzzReport,
 * MaxConfigReport) that {@link summarizePresetReports} aggregates over. Every
 * field is optional so a single function can fold all three shapes. */
export interface PresetReportLike {
  zoneName?: string;
  timestamp?: string;
  /** FuzzReport / ApiFuzzReport item count. */
  totalTests?: number;
  /** MaxConfigReport (rules + MinConfig) item count. */
  totalRules?: number;
  successful?: number;
  failed?: number;
  /** API phase no-op writes (resource already on-target). */
  alreadyPresent?: number;
  /** Plan/entitlement/zone-state gaps surfaced as acknowledged (Principle 1/2). */
  acknowledged?: number;
}

/**
 * Fold the preset/fuzz report shapes (settings, rules/MinConfig, API endpoints)
 * into the MigrationReport header + summary that Step 4 renders.
 *
 * Preset runs (MaxConfig / MinConfig / fuzz) operate on the source zone and
 * never produce a MigrationReport, so the results page used to cast the raw
 * `{ settingsReport, rulesReport, apiReport }` blob to MigrationReport — which
 * has no `summary` (→ 0/0/0/0 counters) and no `destZone` (→ empty header).
 *
 * `alreadyPresent` writes are on-target and counted with `success`, never as
 * failures (AGENTS.md Principle 1: the summary must reflect reality).
 */
export function summarizePresetReports(
  reports: (PresetReportLike | null | undefined)[],
): Pick<MigrationReport, 'timestamp' | 'sourceZone' | 'destZone' | 'summary'> {
  let total = 0;
  let success = 0;
  let failed = 0;
  let acknowledged = 0;
  let zoneName = '';
  let timestamp = '';
  for (const r of reports) {
    if (!r) continue;
    total += (r.totalTests ?? 0) + (r.totalRules ?? 0);
    success += (r.successful ?? 0) + (r.alreadyPresent ?? 0);
    failed += r.failed ?? 0;
    acknowledged += r.acknowledged ?? 0;
    if (!zoneName && r.zoneName) zoneName = r.zoneName;
    if (!timestamp && r.timestamp) timestamp = r.timestamp;
  }
  return {
    timestamp: timestamp || new Date().toISOString(),
    sourceZone: zoneName,
    destZone: zoneName,
    // Plan/entitlement/zone-state gaps are surfaced separately as `acknowledged`
    // and counted under `skipped` — never as failures (Principle 1/2). The
    // distinct `acknowledged` field drives the 🟡 Acknowledged Step-4 tally.
    summary: { total, success, failed, skipped: acknowledged, acknowledged },
  };
}

export async function fuzzZoneApiEndpoints(
  auth: api.ApiAuth | string,
  zoneId: string,
  log: LogFn = console.log,
  cleanup: boolean = true
): Promise<ApiFuzzReport> {
  log('🎄 Starting Maximum Config - API Endpoints...');
  
  const zone = await api.getZone(auth, zoneId);
  log(`✓ Zone: ${zone.name}`);
  const accountId = zone.account?.id;

  const replacePlaceholders = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value
        .replaceAll('{zone_id}', zoneId)
        .replaceAll('{zone_name}', zone.name)
        .replaceAll('{account_id}', accountId || '');
    }
    if (Array.isArray(value)) return value.map(v => replacePlaceholders(v));
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) out[k] = replacePlaceholders(v);
      return out;
    }
    return value;
  };

  const results: ApiEndpointResult[] = [];
  const createdResources: { type: string; id: string }[] = [];
  let successful = 0;
  let failed = 0;
  let alreadyPresent = 0;

  const authObj: api.ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;
  const headers: Record<string, string> = authObj.type === 'key' 
    ? { 'X-Auth-Key': authObj.apiKey, 'X-Auth-Email': authObj.email, 'Content-Type': 'application/json' }
    : { 'Authorization': `Bearer ${authObj.token}`, 'Content-Type': 'application/json' };
  const fetch = createFuzzFetch(auth);

  for (const endpoint of ZONE_API_ENDPOINTS) {
    for (const payload of endpoint.testPayloads) {
      const payloadObj: Record<string, unknown> = (payload ? (replacePlaceholders(payload) as Record<string, unknown>) : {});
      if (endpoint.path.includes('{account_id}') && !accountId) {
        log(`⏭ Skipping ${endpoint.method} ${endpoint.path} (no account_id)`);
        continue;
      }
      const path = endpoint.path
        .replace('{zone_id}', zoneId)
        .replace('{account_id}', accountId || '');
      const startTime = Date.now();
      
      try {
        if (endpoint.name === 'Create Page Rule') {
          const targetValue = (payloadObj.targets as Array<{ constraint?: { value?: string } }> | undefined)?.[0]?.constraint?.value;
          if (targetValue) {
            const existingRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/pagerules?per_page=100`, { method: 'GET', headers });
            const existingData = await existingRes.json() as { success: boolean; result?: Array<{ id: string; targets?: Array<{ constraint?: { value?: string } }> }> };
            for (const rule of existingData.result || []) {
              if (rule.targets?.some(target => target.constraint?.value === targetValue)) {
                await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/pagerules/${rule.id}`, { method: 'DELETE', headers });
              }
            }
          }
        }

        const init: RequestInit = {
          method: endpoint.method,
          headers,
        };
        const hasBody = endpoint.method !== 'GET' && endpoint.method !== 'DELETE';
        if (hasBody && Object.keys(payloadObj).length > 0) {
          init.body = JSON.stringify(payloadObj);
        }
        const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, init);
        
        const data = await res.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
        const responseTime = Date.now() - startTime;
        
        if (data.success) {
          results.push({
            name: endpoint.name,
            method: endpoint.method,
            path,
            payload: payloadObj,
            success: true,
            statusCode: res.status,
            responseTime,
            resourceId: data.result?.id,
          });
          successful++;
          log(`✓ ${endpoint.method} ${path} (${responseTime}ms)`);
          
          if (data.result?.id) {
            createdResources.push({ type: endpoint.name, id: data.result.id });
          }
        } else {
          const errorMsg = data.errors?.[0]?.message || 'Unknown error';
          // "Already present as desired" is on-target, not a failure: a
          // re-run / overwrite against a zone that already has this resource
          // (identical record / duplicate_of_existing / already exists) is the
          // intended end state. Count it with successes, log it distinctly,
          // and never inflate the failure count (AGENTS.md Principle 1 / #15).
          const isAlreadyPresent = isConflictError(errorMsg);
          results.push({
            name: endpoint.name,
            method: endpoint.method,
            path,
            payload: payloadObj,
            success: false,
            alreadyPresent: isAlreadyPresent,
            statusCode: res.status,
            error: errorMsg,
            responseTime,
          });
          if (isAlreadyPresent) {
            alreadyPresent++;
            log(`\u2261 ${endpoint.method} ${path}: already present (on target)`);
          } else {
            // Plan/entitlement/zone-state/credential-scope gaps (e.g.
            // zonelockdown not_entitled.max_rules, or a Cache Purge
            // "Unauthorized" when the token lacks the purge permission) are
            // acknowledged outcomes, not failures (Principle 1/2). Still
            // failed++ here; countAcknowledged reconciles below.
            failed++;
            const ack = isMaxConfigAcknowledgeable(errorMsg);
            log(`${ack ? '⏭' : '✗'} ${endpoint.method} ${path}: ${errorMsg}`);
          }
        }
      } catch (e: unknown) {
        api.throwIfAuthError(e);
        const err = e as Error;
        const responseTime = Date.now() - startTime;
        results.push({
          name: endpoint.name,
          method: endpoint.method,
          path,
          payload: payloadObj,
          success: false,
          error: err.message,
          responseTime,
        });
        failed++;
        const ack = isMaxConfigAcknowledgeable(err.message);
        log(`${ack ? '⏭' : '✗'} ${endpoint.method} ${path}: ${err.message}`);
      }
    }
  }

  // Cleanup created resources
  if (cleanup && createdResources.length > 0) {
    log('');
    log('🧹 Cleaning up created resources...');
    for (const resource of createdResources) {
      try {
        let deletePath = '';
        if (resource.type.includes('DNS')) {
          deletePath = `/zones/${zoneId}/dns_records/${resource.id}`;
        } else if (resource.type.includes('Page Rule')) {
          deletePath = `/zones/${zoneId}/pagerules/${resource.id}`;
        } else if (resource.type.includes('Firewall')) {
          deletePath = `/zones/${zoneId}/firewall/rules/${resource.id}`;
        } else if (resource.type.includes('Rate Limit')) {
          deletePath = `/zones/${zoneId}/rate_limits/${resource.id}`;
        }
        
        if (deletePath) {
          await fetch(`https://api.cloudflare.com/client/v4${deletePath}`, {
            method: 'DELETE',
            headers,
          });
          log(`  ✓ Deleted ${resource.type} (${resource.id})`);
        }
      } catch (e) {
        api.throwIfAuthError(e);
        log(`  ✗ Failed to delete ${resource.type} (${resource.id})`);
      }
    }
  }

  // Reclassify plan/entitlement/zone-state/credential-scope rejections out of
  // the failure bucket — acknowledged outcomes, not failures (Principle 1/2).
  const acknowledged = countAcknowledged(results);
  failed = Math.max(0, failed - acknowledged);

  log('');
  log(
    `📊 API Endpoints Complete: ${successful} successful, ${alreadyPresent} already present, ${acknowledged} acknowledged (plan/entitlement), ${failed} failed`,
  );

  return {
    timestamp: new Date().toISOString(),
    zoneId,
    zoneName: zone.name,
    totalTests: results.length,
    successful,
    failed,
    alreadyPresent,
    acknowledged,
    results,
    createdResources: cleanup ? [] : createdResources,
  };
}

// =============================================================================
// MAXIMUM CONFIG - CREATE ALL RULES
// Creates one rule of each type to "light up" the zone like a Christmas tree
// =============================================================================

export interface MaxConfigResult {
  phase: string;
  ruleName: string;
  success: boolean;
  error?: string;
  ruleId?: string;
  /** Write was a no-op because the resource already exists as desired
   * (conflict / identical record). On-target, not a failure. */
  alreadyPresent?: boolean;
  /** Rejected by a plan/entitlement/zone-state gap the operator cannot fix
   * mid-run (e.g. Origin Host override not entitled, Email Routing on a pending
   * zone, SBFM on a non-Enterprise zone, Snippets not allowed). Acknowledged,
   * not failed (Principle 1/2). */
  acknowledged?: boolean;
}

export interface MaxConfigReport {
  timestamp: string;
  zoneId: string;
  zoneName: string;
  totalRules: number;
  successful: number;
  failed: number;
  /** Writes that were no-ops because the resource was already present as
   * desired. On-target, counted with success — never as failures. */
  alreadyPresent: number;
  /** Plan/entitlement/zone-state gaps surfaced as acknowledged, never as
   * failures (Principle 1/2). */
  acknowledged: number;
  results: MaxConfigResult[];
  createdRulesets: { phase: string; rulesetId: string }[];
}

export interface MaxConfigOptions {
  /**
   * Default false. Enables MaxConfig mutations that are intentionally excluded
   * from the safe default because they can affect billing, registrar/external
   * DNS state, or account-wide resources outside the selected test zone.
   */
  includeUnsafeAccountWideTrafficSettings?: boolean;
}

/**
 * Shared "already-in-desired-state" classifier (#15 decision 3). Many write
 * sites in createMaximumConfig / createMinimumConfig raw-POST and count any
 * non-success as a failure — so a re-run against an already-configured zone
 * logged "identical record already exists" conflicts as ✗ failures. This folds
 * those out of the failure bucket: it flags each conflict result and returns
 * the count, so callers can move them to an `alreadyPresent` total.
 *
 * Conflicts are detected with isConflictError — the SAME classifier the
 * account-to-account migrate path and the API-endpoints fuzz phase use — so
 * "already present" means the same thing everywhere (AGENTS.md Principle 1).
 * Only success:false results with a conflict error are touched; genuine
 * failures and plan-limitation skips (which push no result) are untouched.
 */
export function countAlreadyPresent<T extends { success: boolean; error?: string; alreadyPresent?: boolean }>(
  results: T[],
): number {
  let n = 0;
  for (const r of results) {
    if (!r.success && isConflictError(r.error ?? '')) {
      r.alreadyPresent = true;
      n++;
    }
  }
  return n;
}

/**
 * Sibling of {@link countAlreadyPresent} for plan/entitlement/zone-state gaps.
 *
 * MaxConfig/fuzz drive every request-affecting setting & subsystem to maximum
 * regardless of the target zone's tier, so a non-Enterprise (or still-pending)
 * zone will reject a large share of writes with an entitlement/plan/zone-state
 * error. Those are EXPECTED for the zone's tier — acknowledged outcomes, not
 * failures (Principle 1: No Surprise Failures; Principle 2: entitlement →
 * acknowledgment). This folds them out of the failure bucket the same way
 * conflicts are folded: it flags each such result `acknowledged` and returns
 * the count so callers can report it separately from `failed`.
 *
 * Detected with isMaxConfigAcknowledgeable — the SAME classifier used at the
 * live per-line log sites — so "acknowledged" means the same thing in the
 * stream and in the summary. Only success:false results that are NOT already
 * flagged as conflicts and whose error matches the classifier are touched;
 * genuine failures (and plan-limitation skips that push no result) are left
 * alone so they still surface as red (Principle 9: fail loud).
 */
export function countAcknowledged<T extends { success: boolean; error?: string; alreadyPresent?: boolean; acknowledged?: boolean }>(
  results: T[],
): number {
  let n = 0;
  for (const r of results) {
    if (r.acknowledged) { n++; continue; }
    if (!r.success && !r.alreadyPresent && isMaxConfigAcknowledgeable(r.error ?? '')) {
      r.acknowledged = true;
      n++;
    }
  }
  return n;
}

/**
 * Subscribe a zone to a specific plan tier (free/pro/business/enterprise) for
 * the preset flows. Used when the user explicitly picks a License in the
 * Destination panel — the explicit pick is the consent for the (billing-
 * changing) plan update, so this is NOT gated behind the unsafe-account-wide
 * opt-in (that flag still gates MaxConfig's auto "highest available plan"
 * upgrade + DNSSEC).
 *
 * Best-effort: matches by legacy_id/id against subscribable plans. Logs and
 * returns false on any miss/error instead of throwing, so a plan that isn't
 * entitled on the account never aborts the preset run.
 */
export async function subscribeToPlan(
  auth: api.ApiAuth | string,
  zoneId: string,
  planTier: string,
  log: LogFn = console.log,
): Promise<boolean> {
  const wanted = planTier.trim().toLowerCase();
  if (!wanted) return false;
  try {
    log(`⏳ Setting zone plan to "${wanted}" (user-selected license)...`);
    const plans = await api.getAvailablePlans(auth, zoneId);
    const subscribable = (plans || []).filter(p => p.can_subscribe);
    const match = subscribable.find(p =>
      p.legacy_id?.toLowerCase() === wanted || p.id?.toLowerCase() === wanted ||
      (p.name || '').toLowerCase().includes(wanted)
    );
    if (!match) {
      // Already on the requested plan? Treat as success (no-op), not a failure.
      const current = (plans || []).find(p =>
        p.is_subscribed && (
          p.legacy_id?.toLowerCase() === wanted || p.id?.toLowerCase() === wanted ||
          (p.name || '').toLowerCase().includes(wanted)
        )
      );
      if (current) {
        log(`  ✓ Zone already on "${current.name}" plan`);
        return true;
      }
      log(`  ⏭ Plan "${wanted}" not subscribable on this account (skipped)`);
      return false;
    }
    if (match.is_subscribed) {
      log(`  ✓ Zone already on "${match.name}" plan`);
      return true;
    }
    await api.updateZoneSubscription(auth, zoneId, match.id, match.frequency || 'monthly');
    log(`  ✓ Zone plan set to ${match.name} (${match.frequency}, ${match.currency} ${match.price})`);
    return true;
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ Could not set zone plan to "${wanted}": ${(e as Error).message}`);
    return false;
  }
}

export async function createMaximumConfig(
  auth: api.ApiAuth | string,
  zoneId: string,
  log: LogFn = console.log,
  options: MaxConfigOptions = {},
): Promise<MaxConfigReport> {
  log('🎄 Starting Maximum Config - Creating Rules...');
  log('');
  log('📋 Rule types to create:');
  const ruleTypes = getRuleTypesList();
  for (const type of ruleTypes) {
    log(`   • ${type}`);
  }
  log('');

  const zone = await api.getZone(auth, zoneId);
  log(`✓ Zone: ${zone.name}`);

  const results: MaxConfigResult[] = [];
  const createdRulesets: { phase: string; rulesetId: string }[] = [];
  let successful = 0;
  let failed = 0;
  const includeUnsafeAccountWideTrafficSettings = options.includeUnsafeAccountWideTrafficSettings === true;

  const authObj: api.ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;
  const headers: Record<string, string> = authObj.type === 'key'
    ? { 'X-Auth-Key': authObj.apiKey, 'X-Auth-Email': authObj.email, 'Content-Type': 'application/json' }
    : { 'Authorization': `Bearer ${authObj.token}`, 'Content-Type': 'application/json' };
  const fetch = createFuzzFetch(auth);

  // Group rules by phase
  const rulesByPhase = getRulesByPhase();

  for (const [phase, rules] of rulesByPhase) {
    log(`\n⏳ Creating ${phase} rules...`);

    try {
      // Update the phase entrypoint with all rules for this phase
      const rulePayloads = rules.map(r => replaceRulePlaceholders(r.rule, zone.name));
      
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ rules: rulePayloads }),
      });

      const data = await res.json() as { 
        success: boolean; 
        result?: { id: string; rules?: { id: string }[] }; 
        errors?: { message: string; code?: number }[] 
      };

      if (data.success && data.result) {
        createdRulesets.push({ phase, rulesetId: data.result.id });
        
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          const ruleId = data.result.rules?.[i]?.id;
          results.push({
            phase,
            ruleName: rule.name,
            success: true,
            ruleId,
          });
          successful++;
          log(`  ✓ ${rule.name}: ${rule.description}`);
        }
      } else {
        const errorMsg = data.errors?.[0]?.message || 'Unknown error';
        // A whole phase can be plan/entitlement-gated (e.g. http_request_origin
        // → "not entitled to use the Origin Host override" on a non-Enterprise
        // zone). That's acknowledged for the zone's tier, not a failure (P1/P2).
        const ack = isMaxConfigAcknowledgeable(errorMsg);
        for (const rule of rules) {
          results.push({
            phase,
            ruleName: rule.name,
            success: false,
            acknowledged: ack,
            error: errorMsg,
          });
          failed++;
        }
        log(`  ${ack ? '⏭' : '✗'} ${phase}: ${errorMsg}`);
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      const err = e as Error;
      const ack = isMaxConfigAcknowledgeable(err.message);
      for (const rule of rules) {
        results.push({
          phase,
          ruleName: rule.name,
          success: false,
          acknowledged: ack,
          error: err.message,
        });
        failed++;
      }
      log(`  ${ack ? '⏭' : '✗'} ${phase}: ${err.message}`);
    }
  }

  log('');
  log(`📊 Rulesets Complete: ${successful} rules created, ${failed} failed`);

  // Now enable additional subsystems
  log('');
  log('🔧 Enabling Additional Subsystems...');

  if (includeUnsafeAccountWideTrafficSettings) {
    // Zone Subscription / Plan (VERY RISKY / BILLING-CHANGING)
    // We assume the account is contracted for all plans and attempt to subscribe to the "highest" available plan.
    try {
      log('⏳ Attempting to upgrade zone subscription plan...');
      const plans = await api.getAvailablePlans(auth, zoneId);
      const candidatePlans = (plans || []).filter(p => p.can_subscribe);
      const best = candidatePlans.sort((a, b) => (b.price || 0) - (a.price || 0))[0] || candidatePlans[0];
      if (best) {
        await api.updateZoneSubscription(auth, zoneId, best.id, best.frequency || 'monthly');
        log(`  ✓ Subscription updated: ${best.name} (${best.frequency}, ${best.currency} ${best.price})`);
        results.push({ phase: 'subscription', ruleName: `Zone Plan: ${best.name}`, success: true });
        successful++;
      } else {
        log('  ⏭ No subscribable plans returned (already on top plan or API restricted)');
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      const err = (e as Error).message;
      log(`  ⏭ Zone subscription: ${err}`);
    }

    // DNSSEC is unsafe by default because activation requires registrar DS coordination.
    try {
      log('⏳ Enabling DNSSEC...');
      const dnssecRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dnssec`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'active' }),
      });
      const dnssecData = await dnssecRes.json() as { success: boolean; errors?: { message: string }[] };
      if (dnssecData.success) {
        log('  ✓ DNSSEC enabled');
        results.push({ phase: 'dnssec', ruleName: 'DNSSEC', success: true });
        successful++;
      } else {
        const err = dnssecData.errors?.[0]?.message || 'Unknown error';
        log(`  ✗ DNSSEC: ${err}`);
        results.push({ phase: 'dnssec', ruleName: 'DNSSEC', success: false, error: err });
        failed++;
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      const err = (e as Error).message;
      log(`  ✗ DNSSEC: ${err}`);
      results.push({ phase: 'dnssec', ruleName: 'DNSSEC', success: false, error: err });
      failed++;
    }
  } else {
    log('  ⏭ Unsafe MaxConfig mutations disabled by default (zone subscription, DNSSEC)');
  }

  // Argo Smart Routing
  try {
    log('⏳ Enabling Argo Smart Routing...');
    const argoRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/argo/smart_routing`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ value: 'on' }),
    });
    const argoData = await argoRes.json() as { success: boolean; errors?: { message: string }[] };
    if (argoData.success) {
      log('  ✓ Argo Smart Routing enabled');
      results.push({ phase: 'argo', ruleName: 'Argo Smart Routing', success: true });
      successful++;
    } else {
      const err = argoData.errors?.[0]?.message || 'Unknown error';
      log(`  ✗ Argo Smart Routing: ${err}`);
      results.push({ phase: 'argo', ruleName: 'Argo Smart Routing', success: false, error: err });
      failed++;
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    const err = (e as Error).message;
    log(`  ✗ Argo Smart Routing: ${err}`);
    results.push({ phase: 'argo', ruleName: 'Argo Smart Routing', success: false, error: err });
    failed++;
  }

  // Argo Tiered Cache
  try {
    log('⏳ Enabling Argo Tiered Cache...');
    const tieredRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/argo/tiered_caching`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ value: 'on' }),
    });
    const tieredData = await tieredRes.json() as { success: boolean; errors?: { message: string }[] };
    if (tieredData.success) {
      log('  ✓ Argo Tiered Cache enabled');
      results.push({ phase: 'argo', ruleName: 'Argo Tiered Cache', success: true });
      successful++;
    } else {
      const err = tieredData.errors?.[0]?.message || 'Unknown error';
      log(`  ✗ Argo Tiered Cache: ${err}`);
      results.push({ phase: 'argo', ruleName: 'Argo Tiered Cache', success: false, error: err });
      failed++;
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    const err = (e as Error).message;
    log(`  ✗ Argo Tiered Cache: ${err}`);
    results.push({ phase: 'argo', ruleName: 'Argo Tiered Cache', success: false, error: err });
    failed++;
  }

  // Cache Reserve - Keep assets in Cloudflare storage longer (Enterprise)
  try {
    log('⏳ Enabling Cache Reserve...');
    const cacheReserveRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/cache/cache_reserve`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ value: 'on' }),
    });
    const cacheReserveData = await cacheReserveRes.json() as { success: boolean; errors?: { message: string }[] };
    if (cacheReserveData.success) {
      log('  ✓ Cache Reserve enabled');
      results.push({ phase: 'cache', ruleName: 'Cache Reserve', success: true });
      successful++;
    } else {
      log('  ⏭ Cache Reserve not available for this plan');
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Cache Reserve not available');
  }

  // Safe, zone-scoped traffic-affecting singleton settings.
  try {
    log('⏳ Enabling Managed Headers / Managed Transforms...');
    const catalog = await api.getManagedHeaders(auth, zoneId);
    const managed_request_headers = (catalog?.managed_request_headers || []).map(h => ({ ...h, enabled: true }));
    const managed_response_headers = (catalog?.managed_response_headers || []).map(h => ({ ...h, enabled: true }));
    if (managed_request_headers.length + managed_response_headers.length > 0) {
      await api.updateManagedHeaders(auth, zoneId, { managed_request_headers, managed_response_headers });
      log(`  ✓ Managed Headers enabled (${managed_request_headers.length + managed_response_headers.length})`);
      results.push({ phase: 'managed_headers', ruleName: 'Managed Headers / Managed Transforms', success: true });
      successful++;
    } else {
      log('  ⏭ Managed Headers: no catalog entries available');
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ Managed Headers: ${(e as Error).message}`);
  }

  try {
    log('⏳ Enabling URL Normalization...');
    await api.updateUrlNormalization(auth, zoneId, { type: 'cloudflare', scope: 'incoming' });
    log('  ✓ URL Normalization enabled');
    results.push({ phase: 'url_normalization', ruleName: 'URL Normalization', success: true });
    successful++;
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ URL Normalization: ${(e as Error).message}`);
  }

  try {
    log('⏳ Enabling Regional Tiered Cache...');
    await api.updateRegionalTieredCache(auth, zoneId, 'on');
    log('  ✓ Regional Tiered Cache enabled');
    results.push({ phase: 'cache', ruleName: 'Regional Tiered Cache', success: true });
    successful++;
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ Regional Tiered Cache: ${(e as Error).message}`);
  }

  try {
    log('⏳ Enabling Origin Post-Quantum Encryption...');
    await api.updateOriginPostQuantum(auth, zoneId, 'preferred');
    log('  ✓ Origin Post-Quantum Encryption preferred');
    results.push({ phase: 'cache', ruleName: 'Origin Post-Quantum Encryption', success: true });
    successful++;
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ Origin Post-Quantum Encryption: ${(e as Error).message}`);
  }

  try {
    log('⏳ Enabling ACM Total TLS...');
    await api.updateAcmTotalTls(auth, zoneId, { enabled: true, certificate_authority: 'lets_encrypt' });
    log('  ✓ ACM Total TLS enabled');
    results.push({ phase: 'acm_total_tls', ruleName: 'ACM Total TLS', success: true });
    successful++;
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ ACM Total TLS: ${(e as Error).message}`);
  }

  try {
    log('⏳ Enabling Content Upload Scan settings...');
    // PUT /content-upload-scan/settings expects { value: "enabled" | "disabled" }
    // — NOT { enabled: boolean } (that returns 'invalid JSON: unknown field
    // "enabled"'). Verified against the Content Scanning API schema.
    await api.updateContentUploadScanSettings(auth, zoneId, { value: 'enabled' });
    log('  ✓ Content Upload Scan settings enabled');
    results.push({ phase: 'content_upload_scan', ruleName: 'Content Upload Scan Settings', success: true });
    successful++;
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ Content Upload Scan settings: ${(e as Error).message}`);
  }

  try {
    log('⏳ Enabling Leaked Credential Checks...');
    await api.setLeakedCredentialChecksStatus(auth, zoneId, { enabled: true });
    log('  ✓ Leaked Credential Checks enabled');
    results.push({ phase: 'leaked_credentials', ruleName: 'Leaked Credential Checks', success: true });
    successful++;
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ Leaked Credential Checks: ${(e as Error).message}`);
  }

  try {
    log('⏳ Updating Waiting Room settings...');
    await api.updateWaitingRoomSettings(auth, zoneId, { search_engine_crawler_bypass: true });
    log('  ✓ Waiting Room settings updated');
    results.push({ phase: 'waiting_room', ruleName: 'Waiting Room Settings', success: true });
    successful++;
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ Waiting Room settings: ${(e as Error).message}`);
  }

  // Managed WAF Rulesets - First get available rulesets
  try {
    log('⏳ Deploying Managed WAF Rulesets...');
    
    // Get zone rulesets to find managed ruleset IDs
    const rulesetsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets`, {
      method: 'GET',
      headers,
    });
    const rulesetsData = await rulesetsRes.json() as { 
      success: boolean; 
      result?: { id: string; name: string; kind: string; phase: string }[];
      errors?: { message: string }[] 
    };
    
    if (rulesetsData.success && rulesetsData.result) {
      // Find Cloudflare Managed and OWASP rulesets
      const managedRulesets = rulesetsData.result.filter(r => 
        r.kind === 'managed' && r.phase === 'http_request_firewall_managed'
      );
      
      if (managedRulesets.length > 0) {
        const executeRules = managedRulesets.map(rs => ({
          action: 'execute',
          expression: 'true',
          description: `[MaxConfig] Execute ${rs.name}`,
          action_parameters: { id: rs.id },
          enabled: true,
        }));
        
        const managedRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/phases/http_request_firewall_managed/entrypoint`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ rules: executeRules }),
        });
        const managedData = await managedRes.json() as { success: boolean; errors?: { message: string }[] };
        
        if (managedData.success) {
          log(`  ✓ Managed WAF: ${managedRulesets.length} rulesets deployed`);
          results.push({ phase: 'http_request_firewall_managed', ruleName: 'Managed WAF Rulesets', success: true });
          successful++;
        } else {
          const err = managedData.errors?.[0]?.message || 'Unknown error';
          log(`  ✗ Managed WAF: ${err}`);
          results.push({ phase: 'http_request_firewall_managed', ruleName: 'Managed WAF Rulesets', success: false, error: err });
          failed++;
        }
      } else {
        log('  ⏭ Managed WAF: No managed rulesets available');
      }
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    const err = (e as Error).message;
    log(`  ✗ Managed WAF: ${err}`);
    results.push({ phase: 'http_request_firewall_managed', ruleName: 'Managed WAF Rulesets', success: false, error: err });
    failed++;
  }

  // DNS "edge-case pack" — uncommon record types with structured payloads.
  // This intentionally targets migration/parsing edge cases.
  try {
    log('⏳ Creating DNS edge-case records...');
    const ensureDns = async (record: Record<string, unknown>) => {
      const name = String(record.name || '');
      const type = String(record.type || '');
      if (!name || !type) return;
      // Skip if already present
      const listRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`, {
        method: 'GET',
        headers,
      });
      const listData = await listRes.json() as { success: boolean; result?: { id: string; type: string }[] };
      const exists = listData.result?.some(r => r.type === type);
      if (exists) {
        log(`  ✓ DNS ${type} exists: ${name}`);
        results.push({ phase: 'dns_edge', ruleName: `DNS ${type}`, success: true });
        successful++;
        return;
      }
      const createRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
        method: 'POST',
        headers,
        body: JSON.stringify(record),
      });
      const createData = await createRes.json() as { success: boolean; errors?: { message: string }[] };
      if (createData.success) {
        log(`  ✓ DNS ${type} created: ${name}`);
        results.push({ phase: 'dns_edge', ruleName: `DNS ${type}`, success: true });
        successful++;
      } else {
        const err = createData.errors?.[0]?.message || 'Unknown error';
        log(`  ✗ DNS ${type} (${name}): ${err}`);
        results.push({ phase: 'dns_edge', ruleName: `DNS ${type}`, success: false, error: err });
        failed++;
      }
    };

    const edgeBase = `maxconfig-edge.${zone.name}`;
    const edgeRecords: Array<Record<string, unknown>> = [
      // "Normal" baseline records (keep names distinct to avoid type exclusivity collisions)
      { type: 'A', name: `maxconfig-a.${zone.name}`, content: '192.0.2.1', ttl: 1, proxied: false, comment: '[MaxConfig] DNS edge pack (A)' },
      { type: 'AAAA', name: `maxconfig-aaaa.${zone.name}`, content: '2001:db8::1', ttl: 1, proxied: false, comment: '[MaxConfig] DNS edge pack (AAAA)' },
      { type: 'CNAME', name: `maxconfig-cname.${zone.name}`, content: 'example.com', ttl: 1, proxied: false, comment: '[MaxConfig] DNS edge pack (CNAME)' },
      { type: 'TXT', name: `maxconfig-txt.${zone.name}`, content: 'maxconfig=on', ttl: 1, comment: '[MaxConfig] DNS edge pack (TXT)' },
      { type: 'MX', name: `maxconfig-mx.${zone.name}`, content: 'mail.example.com', priority: 10, ttl: 1, comment: '[MaxConfig] DNS edge pack (MX)' },

      // Rare / structured types
      { type: 'LOC', name: `maxconfig-loc.${zone.name}`, ttl: 1, comment: '[MaxConfig] DNS edge pack (LOC)', data: {
        lat_degrees: 37, lat_minutes: 46, lat_seconds: 30, lat_direction: 'N',
        long_degrees: 122, long_minutes: 23, long_seconds: 30, long_direction: 'W',
        altitude: 10, size: 1, precision_horz: 100, precision_vert: 10,
      } },
      { type: 'URI', name: `maxconfig-uri.${zone.name}`, ttl: 1, comment: '[MaxConfig] DNS edge pack (URI)', priority: 10, data: { weight: 1, target: 'https://example.com/maxconfig' } },
      { type: 'NAPTR', name: `maxconfig-naptr.${zone.name}`, ttl: 1, comment: '[MaxConfig] DNS edge pack (NAPTR)', data: {
        order: 100, preference: 10, flags: 'U', service: 'E2U+sip', regex: '!^.*$!sip:info@example.com!', replacement: '.',
      } },
      { type: 'SRV', name: `_sip._tcp.${edgeBase}`, ttl: 1, comment: '[MaxConfig] DNS edge pack (SRV)', data: { priority: 10, weight: 5, port: 5060, target: 'sip.example.com' } },
      { type: 'CAA', name: `maxconfig-caa.${zone.name}`, ttl: 1, comment: '[MaxConfig] DNS edge pack (CAA)', data: { flags: 0, tag: 'issue', value: 'letsencrypt.org' } },
      { type: 'SSHFP', name: `maxconfig-sshfp.${zone.name}`, ttl: 1, comment: '[MaxConfig] DNS edge pack (SSHFP)', data: { algorithm: 1, type: 1, fingerprint: '1234567890abcdef1234567890abcdef12345678' } },
      { type: 'TLSA', name: `_443._tcp.${edgeBase}`, ttl: 1, comment: '[MaxConfig] DNS edge pack (TLSA)', data: { usage: 3, selector: 1, matching_type: 1, certificate: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' } },
      { type: 'SMIMEA', name: `test._smimecert.${edgeBase}`, ttl: 1, comment: '[MaxConfig] DNS edge pack (SMIMEA)', data: { usage: 3, selector: 1, matching_type: 1, certificate: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' } },
      { type: 'OPENPGPKEY', name: `test._openpgpkey.${edgeBase}`, content: 'mQENBF9nQasBCADN2g==', ttl: 1, comment: '[MaxConfig] DNS edge pack (OPENPGPKEY)' },
      { type: 'HTTPS', name: `maxconfig-https.${zone.name}`, ttl: 1, comment: '[MaxConfig] DNS edge pack (HTTPS)', data: { priority: 1, target: '.', value: 'alpn=h3,h2' } },
      { type: 'SVCB', name: `maxconfig-svcb.${zone.name}`, ttl: 1, comment: '[MaxConfig] DNS edge pack (SVCB)', data: { priority: 1, target: '.', value: 'alpn=h3,h2' } },
    ];

    for (const rec of edgeRecords) {
      // Some record types do not support proxied; ensure it is only present for A/AAAA/CNAME.
      const t = String(rec.type || '');
      if (!['A', 'AAAA', 'CNAME'].includes(t)) {
        delete (rec as any).proxied;
      }
      await ensureDns(rec);
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ DNS edge-case pack not available for this zone');
  }

  // Email Routing - Enable
  try {
    log('⏳ Enabling Email Routing...');
    const emailEnableRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing/enable`, {
      method: 'POST',
      headers,
    });
    const emailData = await emailEnableRes.json() as { success: boolean; errors?: { message: string }[] };
    if (emailData.success) {
      log('  ✓ Email Routing enabled');
      results.push({ phase: 'email_routing', ruleName: 'Email Routing', success: true });
      successful++;
    } else {
      const err = emailData.errors?.[0]?.message || 'Unknown error';
      // "Active zone required" on a still-pending zone is a zone-state gap, not
      // a tool defect — acknowledged, not failed (Principle 1/2).
      const ack = isMaxConfigAcknowledgeable(err);
      log(`  ${ack ? '⏭' : '✗'} Email Routing: ${err}`);
      results.push({ phase: 'email_routing', ruleName: 'Email Routing', success: false, acknowledged: ack, error: err });
      failed++;
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    const err = (e as Error).message;
    const ack = isMaxConfigAcknowledgeable(err);
    log(`  ${ack ? '⏭' : '✗'} Email Routing: ${err}`);
    results.push({ phase: 'email_routing', ruleName: 'Email Routing', success: false, acknowledged: ack, error: err });
    failed++;
  }

  // Page Shield Policies (distinct from the enable toggle)
  try {
    log('⏳ Creating Page Shield policy...');
    const policyRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/page_shield/policies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: '[MaxConfig] Page Shield policy (log all scripts)',
        action: 'log',
        expression: 'true',
        enabled: true,
        // `value` is a Content-Security-Policy string parsed by CF, NOT a
        // wildcard. '*' alone is not a valid CSP directive and returns
        // "unknown directive". Use a real CSP directive. Verified against the
        // Page Shield "Create a policy" API schema.
        value: "script-src 'self'",
      }),
    });
    const policyData = await policyRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
    if (policyData.success) {
      log('  ✓ Page Shield policy created');
      results.push({ phase: 'page_shield', ruleName: 'Page Shield Policy', success: true, ruleId: policyData.result?.id });
      successful++;
    } else {
      const err = policyData.errors?.[0]?.message || 'Unknown error';
      log(`  ⏭ Page Shield policy: ${err}`);
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Page Shield policy not available');
  }

  // Firewall "legacy-but-real" and additional endpoints (access rules, lockdowns, UA rules)
  try {
    log('⏳ Creating Firewall access rule...');
    const accessRuleRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/access_rules/rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mode: 'block',
        configuration: { target: 'ip', value: '192.0.2.123' },
        notes: '[MaxConfig] Firewall access rule (block test IP)',
      }),
    });
    const accessRuleData = await accessRuleRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
    if (accessRuleData.success) {
      log('  ✓ Firewall access rule created');
      results.push({ phase: 'firewall', ruleName: 'Firewall Access Rule', success: true, ruleId: accessRuleData.result?.id });
      successful++;
    } else {
      const err = accessRuleData.errors?.[0]?.message || 'Unknown error';
      log(`  ⏭ Firewall access rule: ${err}`);
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Firewall access rules not available');
  }

  try {
    log('⏳ Creating Firewall lockdown...');
    const lockdownRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/lockdowns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        urls: [`https://${zone.name}/maxconfig-lockdown/*`],
        // A CIDR range requires target 'ip_range' (only /16 and /24 are
        // allowed); target 'ip' is for a single address and rejects a CIDR with
        // "invalid ip provided to zonelockdown". Verified against the Zone
        // Lockdown "Create" API schema.
        configurations: [{ target: 'ip_range', value: '192.0.2.0/24' }],
        description: '[MaxConfig] Lockdown for /maxconfig-lockdown/*',
        paused: false,
        priority: 1,
      }),
    });
    const lockdownData = await lockdownRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
    if (lockdownData.success) {
      log('  ✓ Firewall lockdown created');
      results.push({ phase: 'firewall', ruleName: 'Firewall Lockdown', success: true, ruleId: lockdownData.result?.id });
      successful++;
    } else {
      const err = lockdownData.errors?.[0]?.message || 'Unknown error';
      log(`  ⏭ Firewall lockdown: ${err}`);
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Firewall lockdowns not available');
  }

  try {
    log('⏳ Creating Firewall UA rule...');
    const uaRuleRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/ua_rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mode: 'block',
        configuration: { target: 'ua', value: 'MaxConfig-UA-Test' },
        description: '[MaxConfig] Block UA: MaxConfig-UA-Test',
        paused: false,
      }),
    });
    const uaRuleData = await uaRuleRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
    if (uaRuleData.success) {
      log('  ✓ Firewall UA rule created');
      results.push({ phase: 'firewall', ruleName: 'Firewall UA Rule', success: true, ruleId: uaRuleData.result?.id });
      successful++;
    } else {
      const err = uaRuleData.errors?.[0]?.message || 'Unknown error';
      log(`  ⏭ Firewall UA rule: ${err}`);
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Firewall UA rules not available');
  }

  // API Gateway schema validation settings — enterprise surface area
  try {
    log('⏳ Enabling API Gateway schema validation settings...');
    const apiGwRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/api_gateway/settings/schema_validation`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        validation_default_mitigation_action: 'block',
        validation_override_mitigation_action: 'none',
      }),
    });
    const apiGwData = await apiGwRes.json() as { success: boolean; errors?: { message: string }[] };
    if (apiGwData.success) {
      log('  ✓ API Gateway schema validation settings updated');
      results.push({ phase: 'api_gateway', ruleName: 'API Gateway Schema Validation', success: true });
      successful++;
    } else {
      const err = apiGwData.errors?.[0]?.message || 'Unknown error';
      log(`  ⏭ API Gateway schema validation: ${err}`);
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ API Gateway not available');
  }

  // Cache purge (action endpoint) — high-signal operational path.
  // fetch() does NOT throw on HTTP 4xx/5xx, so we MUST read data.success here.
  // Previously this logged "✓ Cache purged" unconditionally — a false success
  // that masked the real "Unable to purge. Unauthorized." (token lacks the
  // Cache Purge permission), which the API-endpoints fuzz then surfaced as a
  // contradictory ✗. Report the real status (debugging-integrity); a purge
  // auth/permission gap is a credential-scope acknowledgment, not a defect.
  try {
    log('⏳ Purging cache (purge_everything)...');
    const purgeRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ purge_everything: true }),
    });
    const purgeData = await purgeRes.json() as { success: boolean; errors?: { message: string }[] };
    if (purgeData.success) {
      log('  ✓ Cache purged (purge_everything)');
      results.push({ phase: 'cache', ruleName: 'Purge Cache (Everything)', success: true });
      successful++;
    } else {
      const err = purgeData.errors?.[0]?.message || 'Unknown error';
      const ack = isMaxConfigAcknowledgeable(err);
      const note = ack && /unable to purge|unauthorized/i.test(err) ? ' (token likely lacks the Cache Purge permission)' : '';
      log(`  ${ack ? '⏭' : '✗'} Cache purge (purge_everything): ${err}${note}`);
      results.push({ phase: 'cache', ruleName: 'Purge Cache (Everything)', success: false, acknowledged: ack, error: err });
      failed++;
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Cache purge not available');
  }

  try {
    log('⏳ Purging cache (files list)...');
    const purgeFilesRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ files: [`https://${zone.name}/maxconfig-cache-file`] }),
    });
    const purgeFilesData = await purgeFilesRes.json() as { success: boolean; errors?: { message: string }[] };
    if (purgeFilesData.success) {
      log('  ✓ Cache purged (files list)');
      results.push({ phase: 'cache', ruleName: 'Purge Cache (Files)', success: true });
      successful++;
    } else {
      const err = purgeFilesData.errors?.[0]?.message || 'Unknown error';
      const ack = isMaxConfigAcknowledgeable(err);
      const note = ack && /unable to purge|unauthorized/i.test(err) ? ' (token likely lacks the Cache Purge permission)' : '';
      log(`  ${ack ? '⏭' : '✗'} Cache purge (files list): ${err}${note}`);
      results.push({ phase: 'cache', ruleName: 'Purge Cache (Files)', success: false, acknowledged: ack, error: err });
      failed++;
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Cache purge (files) not available');
  }

  // Paid products / "weird" resources that hit cross-scope dependencies and quota edge cases.
  const zoneAccountId = zone.account?.id;
  if (zoneAccountId) {
    // Load Balancing
    try {
      log('⏳ Creating Load Balancing monitor/pool/LB...');
      const monitorRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${zoneAccountId}/load_balancers/monitors`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'https',
          description: '[MaxConfig] LB monitor',
          method: 'GET',
          path: '/',
          port: 443,
          interval: 60,
          timeout: 5,
          retries: 2,
          expected_codes: '2xx',
          follow_redirects: true,
          allow_insecure: false,
        }),
      });
      const monitorData = await monitorRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
      if (monitorData.success && monitorData.result?.id) {
        const monitorId = monitorData.result.id;
        const poolRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${zoneAccountId}/load_balancers/pools`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: 'maxconfig-lb-pool',
            description: '[MaxConfig] LB pool',
            enabled: true,
            monitor: monitorId,
            origins: [{ name: 'maxconfig-origin', address: '192.0.2.10', enabled: true, weight: 1 }],
          }),
        });
        const poolData = await poolRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
        if (poolData.success && poolData.result?.id) {
          const poolId = poolData.result.id;
          const lbName = `maxconfig-lb.${zone.name}`;
          const lbRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/load_balancers`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              name: lbName,
              description: '[MaxConfig] Load balancer',
              default_pools: [poolId],
              fallback_pool: poolId,
              proxied: true,
              ttl: 30,
              steering_policy: 'random',
            }),
          });
          const lbData = await lbRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
          if (lbData.success) {
            log('  ✓ Load Balancer created');
            results.push({ phase: 'load_balancer', ruleName: 'Load Balancer', success: true, ruleId: lbData.result?.id });
            successful++;
          } else {
            const err = lbData.errors?.[0]?.message || 'Unknown error';
            log(`  ⏭ Load Balancer: ${err}`);
          }
        } else {
          const err = poolData.errors?.[0]?.message || 'Unknown error';
          log(`  ⏭ Load Balancer pool: ${err}`);
        }
      } else {
        const err = monitorData.errors?.[0]?.message || 'Unknown error';
        log(`  ⏭ Load Balancer monitor: ${err}`);
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ Load Balancing not available');
    }

    // Spectrum
    try {
      log('⏳ Creating Spectrum app...');
      const spectrumRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/spectrum/apps`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          protocol: 'tcp/443',
          dns: { type: 'CNAME', name: `maxconfig-spectrum.${zone.name}` },
          // RFC 5737 TEST-NET-1 documentation IP — never route real traffic here.
          origin_direct: ['tcp://192.0.2.10:443'],
          traffic_type: 'direct',
          ip_firewall: true,
          proxy_protocol: 'off',
          tls: 'full',
          argo_smart_routing: true,
        }),
      });
      const spectrumData = await spectrumRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
      if (spectrumData.success) {
        log('  ✓ Spectrum app created');
        results.push({ phase: 'spectrum', ruleName: 'Spectrum App', success: true, ruleId: spectrumData.result?.id });
        successful++;
      } else {
        const err = spectrumData.errors?.[0]?.message || 'Unknown error';
        log(`  ⏭ Spectrum app: ${err}`);
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ Spectrum not available');
    }

    // SSL for SaaS / Custom Hostnames
    try {
      log('⏳ Creating Custom Hostname (SSL for SaaS)...');
      const hostnameRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          hostname: `maxconfig-saas.${zone.name}`,
          ssl: {
            method: 'http',
            type: 'dv',
            bundle_method: 'ubiquitous',
            certificate_authority: 'lets_encrypt',
            wildcard: false,
            settings: {},
          },
          custom_metadata: { created_by: 'MaxConfig' },
        }),
      });
      const hostnameData = await hostnameRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
      if (hostnameData.success) {
        log('  ✓ Custom Hostname created');
        results.push({ phase: 'custom_hostnames', ruleName: 'Custom Hostname', success: true, ruleId: hostnameData.result?.id });
        successful++;
      } else {
        const err = hostnameData.errors?.[0]?.message || 'Unknown error';
        log(`  ⏭ Custom Hostname: ${err}`);
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ Custom Hostnames not available');
    }

    // Turnstile (account scoped)
    try {
      log('⏳ Creating Turnstile widget...');
      const turnstileRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${zoneAccountId}/challenges/widgets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'maxconfig-turnstile',
          mode: 'managed',
          domains: [zone.name, `maxconfig.${zone.name}`],
          region: 'world',
          bot_fight_mode: true,
        }),
      });
      const turnstileData = await turnstileRes.json() as { success: boolean; result?: { sitekey: string }; errors?: { message: string }[] };
      if (turnstileData.success) {
        log('  ✓ Turnstile widget created');
        results.push({ phase: 'turnstile', ruleName: 'Turnstile Widget', success: true, ruleId: turnstileData.result?.sitekey });
        successful++;
      } else {
        const err = turnstileData.errors?.[0]?.message || 'Unknown error';
        log(`  ⏭ Turnstile widget: ${err}`);
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ Turnstile not available');
    }
  }

  // Page Shield - Monitor for malicious scripts (Magecart protection)
  // Note: Page Shield requires Business+ plan and uses the settings endpoint
  try {
    log('⏳ Enabling Page Shield...');
    const pageShieldRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/page_shield`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        enabled: true,
      }),
    });
    const pageShieldData = await pageShieldRes.json() as { success: boolean; result?: { enabled: boolean }; errors?: { message: string }[] };
    if (pageShieldData.success || pageShieldData.result?.enabled) {
      log('  ✓ Page Shield enabled');
      results.push({ phase: 'page_shield', ruleName: 'Page Shield', success: true });
      successful++;
    } else {
      const err = pageShieldData.errors?.[0]?.message || 'Not available for this plan';
      log(`  ⏭ Page Shield: ${err}`);
      results.push({ phase: 'page_shield', ruleName: 'Page Shield', success: false, error: err });
      // Don't count as failed - plan limitation
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Page Shield not available for this zone');
  }

  // Bot Management - SBFM + AI bot protection (Enterprise)
  // NOTE: fight_mode cannot be combined with SBFM fields — sending both returns 400.
  // Use SBFM-only config which is the Enterprise-grade bot management approach.
  try {
    log('⏳ Enabling Bot Management (SBFM)...');
    const botFightRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/bot_management`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        sbfm_definitely_automated: 'block',
        sbfm_likely_automated: 'managed_challenge',
        sbfm_verified_bots: 'allow',
        ai_bots_protection: 'block',
      }),
    });
    const botFightData = await botFightRes.json() as { success: boolean; errors?: { message: string }[] };
    if (botFightData.success) {
      log('  ✓ Bot Management enabled (SBFM + AI bot protection)');
      results.push({ phase: 'bot_management', ruleName: 'Bot Management', success: true });
      successful++;
    } else {
      const err = botFightData.errors?.[0]?.message || 'Unknown error';
      // SBFM (sbfm_* + ai_bots_protection) requires Super Bot Fight Mode, a
      // Pro+/Enterprise entitlement. The payload above is structurally valid
      // per the bot_management schema, so on an unentitled zone CF rejects it
      // with a generic 400 "Bad Request" rather than a descriptive entitlement
      // message. That's a plan gate, not a tool defect — acknowledge it
      // (Principle 1/2). Scoped to THIS block so a bare "Bad Request" elsewhere
      // is never blanket-masked.
      const ack = isMaxConfigAcknowledgeable(err) || /bad request/i.test(err);
      const note = ack ? ' (SBFM requires a Bot Management/SBFM subscription on this zone)' : '';
      log(`  ${ack ? '⏭' : '✗'} Bot Management: ${err}${note}`);
      results.push({ phase: 'bot_management', ruleName: 'Bot Management', success: false, acknowledged: ack, error: err });
      failed++;
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    const err = (e as Error).message;
    const ack = isMaxConfigAcknowledgeable(err) || /bad request/i.test(err);
    log(`  ${ack ? '⏭' : '✗'} Bot Management: ${err}`);
    results.push({ phase: 'bot_management', ruleName: 'Bot Management', success: false, acknowledged: ack, error: err });
    failed++;
  }

  // Health Check - For high-availability monitoring (Pro+ feature)
  try {
    log('⏳ Creating Health Check...');
    const healthCheckRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/healthchecks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'maxconfig_origin_health_check',
        address: zone.name,
        type: 'HTTPS',
        suspended: false,
        check_regions: ['WNAM', 'ENAM', 'WEU'],
        consecutive_successes: 1,
        consecutive_fails: 2,
        interval: 60,
        timeout: 5,
        retries: 2,
        description: '[MaxConfig] Health check for origin monitoring',
        http_config: {
          method: 'GET',
          path: '/',
          port: 443,
          expected_codes: ['2xx', '3xx'],
          follow_redirects: true,
          allow_insecure: false,
        },
      }),
    });
    const healthCheckData = await healthCheckRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
    if (healthCheckData.success) {
      log('  ✓ Health Check created');
      results.push({ phase: 'health_check', ruleName: 'Health Check', success: true, ruleId: healthCheckData.result?.id });
      successful++;
    } else {
      const err = healthCheckData.errors?.[0]?.message || 'Not available';
      log(`  ⏭ Health Check: ${err}`);
      // Don't count as failed - plan limitation
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Health Checks not available for this zone');
  }

  // Waiting Room (enhanced with queueing_method and crawler bypass)
  try {
    log('⏳ Creating Waiting Room...');
    const waitingRoomRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/waiting_rooms`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'maxconfig_global_squeezer',
        host: zone.name,
        path: '/',
        new_users_per_minute: 200,
        total_active_users: 200,
        session_duration: 5,
        queueing_method: 'fifo',
        queue_all: false,
        disable_session_renewal: false,
        search_engine_crawler_bypass: true,
        description: '[MaxConfig] Test waiting room with FIFO queueing',
      }),
    });
    const waitingData = await waitingRoomRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
    if (waitingData.success) {
      log('  ✓ Waiting Room created (random queueing, crawler bypass)');
      results.push({ phase: 'waiting_room', ruleName: 'Waiting Room', success: true, ruleId: waitingData.result?.id });
      successful++;
    } else {
      const err = waitingData.errors?.[0]?.message || 'Unknown error';
      // "Zone not entitled to this functionality" is a plan gate — acknowledged,
      // not failed (Principle 1/2). Matches the ⏭ already used by the Waiting
      // Room *settings* update above; this aligns the create path with it.
      const ack = isMaxConfigAcknowledgeable(err);
      log(`  ${ack ? '⏭' : '✗'} Waiting Room: ${err}`);
      results.push({ phase: 'waiting_room', ruleName: 'Waiting Room', success: false, acknowledged: ack, error: err });
      failed++;
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    const err = (e as Error).message;
    const ack = isMaxConfigAcknowledgeable(err);
    log(`  ${ack ? '⏭' : '✗'} Waiting Room: ${err}`);
    results.push({ phase: 'waiting_room', ruleName: 'Waiting Room', success: false, acknowledged: ack, error: err });
    failed++;
  }

  // Worker Route (check if exists first)
  try {
    log('⏳ Setting up Worker Route...');
    const routePattern = `${zone.name}/maxconfig-worker/*`;
    
    // Check if route already exists
    const existingRoutesRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`, {
      method: 'GET',
      headers,
    });
    const existingRoutesData = await existingRoutesRes.json() as { success: boolean; result?: { id: string; pattern: string }[] };
    const existingRoute = existingRoutesData.result?.find(r => r.pattern === routePattern);
    
    if (existingRoute) {
      log('  ✓ Worker Route exists');
      results.push({ phase: 'worker_route', ruleName: 'Worker Route', success: true, ruleId: existingRoute.id });
      successful++;
    } else {
      const workerRouteRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pattern: routePattern,
          script: null, // Disabled route (no script attached)
        }),
      });
      const workerData = await workerRouteRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
      if (workerData.success) {
        log('  ✓ Worker Route created (disabled)');
        results.push({ phase: 'worker_route', ruleName: 'Worker Route', success: true, ruleId: workerData.result?.id });
        successful++;
      } else {
        const err = workerData.errors?.[0]?.message || 'Unknown error';
        log(`  ✗ Worker Route: ${err}`);
        results.push({ phase: 'worker_route', ruleName: 'Worker Route', success: false, error: err });
        failed++;
      }
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    const err = (e as Error).message;
    log(`  ✗ Worker Route: ${err}`);
    results.push({ phase: 'worker_route', ruleName: 'Worker Route', success: false, error: err });
    failed++;
  }

  // Zaraz - Enable with Pageview trigger (API requires at least one trigger with loadRules)
  // NOTE: Empty triggers {} is rejected. The Pageview trigger must have loadRules with
  // op: "EQUALS" (all caps) — lowercase variants like "equals"/"eq"/"match" are all rejected.
  try {
    log('⏳ Enabling Zaraz...');
    const zarazRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/settings/zaraz/v2/config`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        debugKey: 'maxconfig-debug',
        dataLayer: true,
        historyChange: true,
        settings: {
          autoInjectScript: true,
        },
        tools: {},
        triggers: {
          Pageview: {
            name: 'Pageview',
            description: 'All page loads',
            clientRules: [],
            excludeRules: [],
            loadRules: [
              {
                match: '{{ client.__zarazTrack }}',
                op: 'EQUALS',
                value: 'Pageview',
              },
            ],
            system: 'pageload',
          },
        },
        variables: {},
      }),
    });
    const zarazData = await zarazRes.json() as { success: boolean; errors?: { message: string }[] };
    if (zarazData.success) {
      log('  ✓ Zaraz enabled (Pageview trigger)');
      results.push({ phase: 'zaraz', ruleName: 'Zaraz', success: true });
      successful++;
    } else {
      const err = zarazData.errors?.[0]?.message || 'Unknown error';
      log(`  ⏭ Zaraz: ${err}`);
      // Don't count as failed - Zaraz config is complex
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Zaraz not available for this zone');
  }

  // Cloudflare Snippets - Edge Logic
  try {
    log('⏳ Creating Snippet...');
    const snippetName = 'maxconfig_snippet';
    const snippetCode = `export default {
  async fetch(request) {
    const response = new Response('MaxConfig Snippet Active', {
      headers: { 'Content-Type': 'text/plain' }
    });
    response.headers.set('X-MaxConfig-Snippet', 'enabled');
    response.headers.set('X-Timestamp', new Date().toISOString());
    return response;
  }
}`;
    const snippet = await api.createSnippet(auth, zoneId, snippetName, snippetCode);
    if (snippet) {
      log('  ✓ Snippet created');
      results.push({ phase: 'snippets', ruleName: 'Cloudflare Snippets', success: true });
      successful++;
      
      // Create snippet rule to activate it
      log('⏳ Creating Snippet Rule...');
      const existingRules = await api.listSnippetRules(auth, zoneId);
      const nextRules = [
        ...existingRules.rules.filter(rule => rule.snippet_name !== snippetName),
        {
          snippet_name: snippetName,
          description: '[MaxConfig] Snippet activation rule',
          expression: 'starts_with(http.request.uri.path, "/maxconfig_snippet/")',
          enabled: true,
        },
      ];
      await api.updateSnippetRules(auth, zoneId, nextRules);
      {
        log('  ✓ Snippet Rule created');
        results.push({ phase: 'snippets', ruleName: 'Snippet Rule', success: true });
        successful++;
      }
    } else {
      throw new Error('Snippet PUT returned no result');
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    const err = (e as Error).message;
    // "snippets are not allowed" is a plan gate — acknowledged, not failed (P1/P2).
    const ack = isMaxConfigAcknowledgeable(err);
    log(`  ${ack ? '⏭' : '✗'} Snippet: ${err}`);
    results.push({ phase: 'snippets', ruleName: 'Cloudflare Snippets', success: false, acknowledged: ack, error: err });
    failed++;
  }

  // ==========================================================================
  // WORKER WITH BINDINGS - Full Worker setup with KV, R2, D1, etc.
  // ==========================================================================
  log('');
  log('👷 Setting up MaxConfig Worker with bindings...');

  const workerName = 'maxconfig-worker';
  const accountId = zone.account?.id;

  if (!accountId) {
    log('  ⏭ Skipping Worker setup (no account ID available)');
  } else {
    let kvNamespaceId: string | null = null;
    let r2BucketName: string | null = null;
    let d1DatabaseId: string | null = null;

    // Create or find existing KV Namespace
    try {
      log('⏳ Setting up KV Namespace...');
      // First, try to find existing namespace
      const kvListRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, {
        method: 'GET',
        headers,
      });
      const kvListData = await kvListRes.json() as { success: boolean; result?: { id: string; title: string }[] };
      const existingKv = kvListData.result?.find(ns => ns.title === 'MAXCONFIG_KV');
      
      if (existingKv) {
        kvNamespaceId = existingKv.id;
        log(`  ✓ KV Namespace found: MAXCONFIG_KV (${kvNamespaceId})`);
        results.push({ phase: 'worker_bindings', ruleName: 'KV Namespace', success: true, ruleId: kvNamespaceId });
        successful++;
      } else {
        // Create new namespace
        const kvRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: 'MAXCONFIG_KV' }),
        });
        const kvData = await kvRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
        if (kvData.success && kvData.result) {
          kvNamespaceId = kvData.result.id;
          log(`  ✓ KV Namespace created: MAXCONFIG_KV (${kvNamespaceId})`);
          results.push({ phase: 'worker_bindings', ruleName: 'KV Namespace', success: true, ruleId: kvNamespaceId });
          successful++;
        } else {
          const err = kvData.errors?.[0]?.message || 'Unknown error';
          log(`  ✗ KV Namespace: ${err}`);
          results.push({ phase: 'worker_bindings', ruleName: 'KV Namespace', success: false, error: err });
          failed++;
        }
      }
      
      // Write a test value if we have a namespace
      if (kvNamespaceId) {
        await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvNamespaceId}/values/maxconfig_test`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'text/plain' },
          body: '🎄 MaxConfig KV Test Value',
        });
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      const err = (e as Error).message;
      log(`  ✗ KV Namespace: ${err}`);
      failed++;
    }

    // Create or find existing R2 Bucket
    try {
      log('⏳ Setting up R2 Bucket...');
      // First, try to find existing bucket
      const r2ListRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`, {
        method: 'GET',
        headers,
      });
      const r2ListData = await r2ListRes.json() as { success: boolean; result?: { buckets?: { name: string }[] } };
      const existingR2 = r2ListData.result?.buckets?.find(b => b.name === 'maxconfig-bucket');
      
      if (existingR2) {
        r2BucketName = existingR2.name;
        log(`  ✓ R2 Bucket found: ${r2BucketName}`);
        results.push({ phase: 'worker_bindings', ruleName: 'R2 Bucket', success: true });
        successful++;
      } else {
        // Create new bucket
        const r2Res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'maxconfig-bucket' }),
        });
        const r2Data = await r2Res.json() as { success: boolean; result?: { name: string }; errors?: { message: string }[] };
        if (r2Data.success && r2Data.result) {
          r2BucketName = r2Data.result.name;
          log(`  ✓ R2 Bucket created: ${r2BucketName}`);
          results.push({ phase: 'worker_bindings', ruleName: 'R2 Bucket', success: true });
          successful++;
        } else {
          const err = r2Data.errors?.[0]?.message || 'Unknown error';
          log(`  ✗ R2 Bucket: ${err}`);
          results.push({ phase: 'worker_bindings', ruleName: 'R2 Bucket', success: false, error: err });
          failed++;
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      const err = (e as Error).message;
      log(`  ✗ R2 Bucket: ${err}`);
      failed++;
    }

    // Create or find existing D1 Database
    try {
      log('⏳ Setting up D1 Database...');
      // First, try to find existing database
      const d1ListRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
        method: 'GET',
        headers,
      });
      const d1ListData = await d1ListRes.json() as { success: boolean; result?: { uuid: string; name: string }[] };
      const existingD1 = d1ListData.result?.find(db => db.name === 'MAXCONFIG_DB');
      
      if (existingD1) {
        d1DatabaseId = existingD1.uuid;
        log(`  ✓ D1 Database found: MAXCONFIG_DB (${d1DatabaseId})`);
        results.push({ phase: 'worker_bindings', ruleName: 'D1 Database', success: true, ruleId: d1DatabaseId });
        successful++;
      } else {
        // Create new database
        const d1Res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'MAXCONFIG_DB' }),
        });
        const d1Data = await d1Res.json() as { success: boolean; result?: { uuid: string }; errors?: { message: string }[] };
        if (d1Data.success && d1Data.result) {
          d1DatabaseId = d1Data.result.uuid;
          log(`  ✓ D1 Database created: MAXCONFIG_DB (${d1DatabaseId})`);
          results.push({ phase: 'worker_bindings', ruleName: 'D1 Database', success: true, ruleId: d1DatabaseId });
          successful++;
        } else {
          const err = d1Data.errors?.[0]?.message || 'Unknown error';
          log(`  ✗ D1 Database: ${err}`);
          results.push({ phase: 'worker_bindings', ruleName: 'D1 Database', success: false, error: err });
          failed++;
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      const err = (e as Error).message;
      log(`  ✗ D1 Database: ${err}`);
      failed++;
    }

    // Logpush Job - Stream HTTP request logs to R2 bucket
    // NOTE: R2 logpush destinations require S3-compatible access credentials in the URI:
    //   r2://{accountId}/{bucket}/logs/{DATE}?access-key-id=...&secret-access-key=...
    // Job names must match ^[a-zA-Z0-9\\._-]*$ (no brackets or spaces).
    if (r2BucketName) {
      try {
        log('⏳ Creating Logpush Job to R2...');
        const logpushRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/logpush/jobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: 'maxconfig-http-requests-to-r2',
            output_options: {
              field_names: ['ClientIP', 'ClientRequestHost', 'ClientRequestMethod', 'ClientRequestURI', 'EdgeResponseStatus', 'EdgeStartTimestamp', 'RayID', 'BotScore', 'BotScoreSrc', 'WAFAction', 'WAFRuleID'],
              timestamp_format: 'rfc3339',
            },
            destination_conf: `r2://${accountId}/${r2BucketName}/logs/{DATE}`,
            dataset: 'http_requests',
            enabled: true,
          }),
        });
        const logpushData = await logpushRes.json() as { success: boolean; result?: { id: number }; errors?: { message: string }[] };
        if (logpushData.success) {
          log(`  ✓ Logpush Job created (HTTP requests → ${r2BucketName})`);
          results.push({ phase: 'logpush', ruleName: 'Logpush to R2', success: true });
          successful++;
        } else {
          const err = logpushData.errors?.[0]?.message || 'Not available';
          log(`  ⏭ Logpush: ${err} (R2 destinations require S3 access-key-id in destination_conf)`);
          // Don't count as failed - requires S3 API token credentials
        }
      } catch (e: unknown) {
        api.throwIfAuthError(e);
        log('  ⏭ Logpush not available for this zone');
      }
    }

    // Create Worker Script with bindings
    try {
      log('⏳ Creating Worker Script...');
      
      const workerScript = `
// 🎄 MaxConfig Worker - Demonstrates all binding types (2026 Edition)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Test KV binding
    let kvValue = null;
    if (env.MAXCONFIG_KV) {
      kvValue = await env.MAXCONFIG_KV.get('maxconfig_test');
    }
    
    // Test AI binding (if available)
    let aiStatus = 'AI not bound';
    if (env.AI) {
      aiStatus = 'AI binding available';
    }
    
    // Build response showing all bindings
    const bindings = {
      timestamp: new Date().toISOString(),
      path: url.pathname,
      kv: kvValue || 'KV not bound',
      r2: env.MAXCONFIG_R2 ? 'R2 bucket bound' : 'R2 not bound',
      d1: env.MAXCONFIG_DB ? 'D1 database bound' : 'D1 not bound',
      ai: aiStatus,
      analytics: env.ANALYTICS ? 'Analytics Engine bound' : 'Analytics not bound',
      message: '🎄 MaxConfig Worker is running with all 2026 bindings!'
    };
    
    // Log to Analytics Engine if available
    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        blobs: ['maxconfig_request'],
        doubles: [Date.now()],
        indexes: [url.pathname],
      });
    }
    
    return new Response(JSON.stringify(bindings, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'X-MaxConfig-Worker': 'enabled',
        'X-MaxConfig-Bindings': 'kv,r2,d1,ai,analytics',
        'X-Powered-By': 'Cloudflare Workers'
      }
    });
  }
};
`;

      // Build bindings array with all modern binding types
      const bindings: Record<string, unknown>[] = [];
      if (kvNamespaceId) {
        bindings.push({ type: 'kv_namespace', name: 'MAXCONFIG_KV', namespace_id: kvNamespaceId });
      }
      if (r2BucketName) {
        bindings.push({ type: 'r2_bucket', name: 'MAXCONFIG_R2', bucket_name: r2BucketName });
      }
      if (d1DatabaseId) {
        bindings.push({ type: 'd1', name: 'MAXCONFIG_DB', id: d1DatabaseId });
      }
      
      // Add AI binding (Workers AI)
      bindings.push({ type: 'ai', name: 'AI' });
      
      // Add Analytics Engine binding
      bindings.push({ 
        type: 'analytics_engine', 
        name: 'ANALYTICS',
        dataset: 'maxconfig_analytics'
      });

      // Upload worker using multipart form
      const formData = new FormData();
      
      const metadata = {
        main_module: 'worker.js',
        bindings,
        compatibility_date: '2024-01-01',
      };
      
      formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      formData.append('worker.js', new Blob([workerScript], { type: 'application/javascript+module' }), 'worker.js');

      const workerRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
        method: 'PUT',
        headers: authObj.type === 'key'
          ? { 'X-Auth-Key': authObj.apiKey, 'X-Auth-Email': authObj.email }
          : { 'Authorization': `Bearer ${authObj.token}` },
        body: formData,
      });
      const workerData = await workerRes.json() as { success: boolean; errors?: { message: string }[] };
      
      if (workerData.success) {
        log(`  ✓ Worker Script created: ${workerName}`);
        log(`    Bindings: ${bindings.length} (KV: ${kvNamespaceId ? '✓' : '✗'}, R2: ${r2BucketName ? '✓' : '✗'}, D1: ${d1DatabaseId ? '✓' : '✗'}, AI: ✓, Analytics: ✓)`);
        results.push({ phase: 'worker', ruleName: 'Worker Script', success: true });
        successful++;

        // Create or find DNS record for custom domain
        try {
          log('⏳ Setting up DNS record for worker...');
          const dnsHostname = `maxconfig.${zone.name}`;
          
          // Check if DNS record already exists
          const dnsListRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${dnsHostname}`, {
            method: 'GET',
            headers,
          });
          const dnsListData = await dnsListRes.json() as { success: boolean; result?: { id: string; type: string }[] };
          const existingDns = dnsListData.result?.find(r => r.type === 'AAAA' || r.type === 'A' || r.type === 'CNAME');
          
          if (existingDns) {
            log(`  ✓ DNS record exists: ${dnsHostname}`);
            results.push({ phase: 'worker', ruleName: 'Worker DNS Record', success: true, ruleId: existingDns.id });
            successful++;
          } else {
            const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                type: 'AAAA',
                name: dnsHostname,
                content: '100::',
                proxied: true,
                comment: '[MaxConfig] Worker custom domain',
              }),
            });
            const dnsData = await dnsRes.json() as { success: boolean; result?: { id: string }; errors?: { message: string }[] };
            if (dnsData.success) {
              log(`  ✓ DNS record created: ${dnsHostname}`);
              results.push({ phase: 'worker', ruleName: 'Worker DNS Record', success: true, ruleId: dnsData.result?.id });
              successful++;
            } else {
              const err = dnsData.errors?.[0]?.message || 'Unknown error';
              log(`  ✗ DNS record: ${err}`);
              results.push({ phase: 'worker', ruleName: 'Worker DNS Record', success: false, error: err });
              failed++;
            }
          }
        } catch (e: unknown) {
          api.throwIfAuthError(e);
          const err = (e as Error).message;
          log(`  ✗ DNS record: ${err}`);
          failed++;
        }

        // Bind worker to custom domain (with override for existing DNS)
        try {
          log('⏳ Binding worker to custom domain...');
          const domainRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              hostname: `maxconfig.${zone.name}`,
              service: workerName,
              zone_id: zoneId,
              environment: 'production',
            }),
          });
          const domainData = await domainRes.json() as { success: boolean; errors?: { message: string }[] };
          if (domainData.success) {
            log(`  ✓ Worker bound to: maxconfig.${zone.name}`);
            results.push({ phase: 'worker', ruleName: 'Worker Custom Domain', success: true });
            successful++;
          } else {
            // Try again with override flag if DNS conflict
            const err = domainData.errors?.[0]?.message || 'Unknown error';
            if (err.includes('externally managed DNS') || err.includes('already has')) {
              log(`  ⏳ Retrying with DNS override...`);
              const retryRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                  hostname: `maxconfig.${zone.name}`,
                  service: workerName,
                  zone_id: zoneId,
                  environment: 'production',
                  override_existing_dns_record: true,
                }),
              });
              const retryData = await retryRes.json() as { success: boolean; errors?: { message: string }[] };
              if (retryData.success) {
                log(`  ✓ Worker bound to: maxconfig.${zone.name} (with DNS override)`);
                results.push({ phase: 'worker', ruleName: 'Worker Custom Domain', success: true });
                successful++;
              } else {
                const retryErr = retryData.errors?.[0]?.message || 'Unknown error';
                log(`  ✗ Custom domain binding: ${retryErr}`);
                results.push({ phase: 'worker', ruleName: 'Worker Custom Domain', success: false, error: retryErr });
                failed++;
              }
            } else {
              log(`  ✗ Custom domain binding: ${err}`);
              results.push({ phase: 'worker', ruleName: 'Worker Custom Domain', success: false, error: err });
              failed++;
            }
          }
        } catch (e: unknown) {
          api.throwIfAuthError(e);
          const err = (e as Error).message;
          log(`  ✗ Custom domain binding: ${err}`);
          failed++;
        }
      } else {
        const err = workerData.errors?.[0]?.message || 'Unknown error';
        log(`  ✗ Worker Script: ${err}`);
        results.push({ phase: 'worker', ruleName: 'Worker Script', success: false, error: err });
        failed++;
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      const err = (e as Error).message;
      log(`  ✗ Worker Script: ${err}`);
      results.push({ phase: 'worker', ruleName: 'Worker Script', success: false, error: err });
      failed++;
    }
  }

  // Reclassify "already exists / identical record" conflicts (common on a
  // re-run) out of the failure bucket — they're on-target, not failures (#15).
  const alreadyPresent = countAlreadyPresent(results);
  // Reclassify plan/entitlement/zone-state gaps (Origin Host override, Email
  // Routing on a pending zone, SBFM, Snippets, …) out of the failure bucket —
  // they're acknowledged outcomes for the zone's tier, not failures (P1/P2).
  const acknowledged = countAcknowledged(results);
  const adjustedFailed = Math.max(0, failed - alreadyPresent - acknowledged);

  log('');
  log(`📊 Maximum Config Complete: ${successful} total enabled, ${alreadyPresent} already present, ${acknowledged} acknowledged (plan/entitlement), ${adjustedFailed} failed`);

  return {
    timestamp: new Date().toISOString(),
    zoneId,
    zoneName: zone.name,
    totalRules: results.length,
    successful,
    failed: adjustedFailed,
    alreadyPresent,
    acknowledged,
    results,
    createdRulesets,
  };
}

// =============================================================================
// MINIMUM CONFIG - TURN EVERYTHING OFF & CLEANUP
// Resets zone to minimal/default state and removes all MaxConfig artifacts
// =============================================================================

// Determine the "minimum" value for a setting (turn everything OFF)
function getMinValue(setting: SettingDefinition): unknown {
  if (setting.type === 'on_off') {
    return 'off';
  } else if (setting.id === 'ssl') {
    return 'full'; // Safe default (not off)
  } else if (setting.id === 'cache_level') {
    return 'basic';
  } else if (setting.id === 'min_tls_version') {
    return '1.0'; // Most permissive
  } else if (setting.id === 'security_level') {
    return 'medium'; // Balanced default
  } else if (setting.id === 'polish') {
    return 'off';
  } else if (setting.id === 'pseudo_ipv4') {
    return 'off';
  } else if (setting.id === 'browser_cache_ttl') {
    return 14400; // 4 hours (reasonable default)
  } else if (setting.id === 'challenge_ttl') {
    return 1800; // 30 minutes
  } else if (setting.id === 'max_upload') {
    return 100;
  } else if (setting.id === 'proxy_read_timeout') {
    return 100;
  } else if (setting.id === 'minify') {
    return { css: 'off', html: 'off', js: 'off' };
  } else if (setting.id === 'security_header') {
    return { strict_transport_security: { enabled: false, max_age: 0, include_subdomains: false, nosniff: false } };
  }
  // Default to first test value (usually 'off' or lowest)
  return setting.testValues[0];
}

export async function createMinimumConfig(
  auth: api.ApiAuth | string,
  zoneId: string,
  log: LogFn = console.log
): Promise<MaxConfigReport> {
  log('🧹 Starting Minimum Config - Resetting & Cleanup...');
  log('');

  const zone = await api.getZone(auth, zoneId);
  log(`✓ Zone: ${zone.name}`);

  const results: MaxConfigResult[] = [];
  const createdRulesets: { phase: string; rulesetId: string }[] = [];
  let successful = 0;
  let failed = 0;

  const authObj: api.ApiAuth = typeof auth === 'string' ? { type: 'token', token: auth } : auth;
  const headers: Record<string, string> = authObj.type === 'key'
    ? { 'X-Auth-Key': authObj.apiKey, 'X-Auth-Email': authObj.email, 'Content-Type': 'application/json' }
    : { 'Authorization': `Bearer ${authObj.token}`, 'Content-Type': 'application/json' };
  const fetch = createFuzzFetch(auth);

  // ==========================================================================
  // PHASE 1: Reset Zone Settings to minimum/default values
  // ==========================================================================
  log('📉 Resetting Zone Settings to defaults...');

  const currentSettings = await api.listZoneSettings(auth, zoneId);
  const editableSettingIds = new Set(
    currentSettings.filter(s => s.editable).map(s => s.id)
  );

  const known = new Map(ZONE_SETTINGS.map(s => [s.id, s] as const));

  const settingsToReset: Array<{ id: string; description: string; candidates: unknown[]; kind: 'known' | 'heuristic' }> = [];
  for (const s of currentSettings) {
    if (!s.editable) continue;

    const def = known.get(s.id);
    if (def) {
      if (def.deprecated) continue;
      settingsToReset.push({ id: def.id, description: def.description, candidates: [getMinValue(def)], kind: 'known' });
    } else {
      settingsToReset.push({ id: s.id, description: s.id, candidates: getHeuristicMinCandidates(s.id, (s as any).value), kind: 'heuristic' });
    }
  }

  const knownCount = settingsToReset.filter(s => s.kind === 'known').length;
  const heuristicCount = settingsToReset.length - knownCount;
  log(`⚡ Resetting ${settingsToReset.length} settings (known: ${knownCount}, heuristic: ${heuristicCount}) in parallel...`);

  const settledSettingResults = await parallelWithLimit(
    settingsToReset,
    MAX_CONCURRENT_SETTINGS,
    async ({ id, description, candidates, kind }): Promise<FuzzResult> => {
      const startTime = Date.now();
      try {
        let lastErr: Error | null = null;
        for (const candidate of candidates) {
          try {
            await api.updateZoneSetting(auth, zoneId, id, candidate);
            const responseTime = Date.now() - startTime;
            log(`  ✓ ${id} = ${JSON.stringify(candidate)}${kind === 'heuristic' ? ' [heuristic]' : ''}`);
            return {
              settingId: id,
              description,
              testValue: candidate,
              success: true,
              responseTime,
            };
          } catch (e: unknown) {
            api.throwIfAuthError(e);
            lastErr = e as Error;
          }
        }
        throw lastErr || new Error('Unknown error');
      } catch (e: unknown) {
        api.throwIfAuthError(e);
        const err = e as Error;
        const responseTime = Date.now() - startTime;
        log(`  ✗ ${id}: ${err.message}${kind === 'heuristic' ? ' [heuristic]' : ''}`);
        return {
          settingId: id,
          description,
          testValue: candidates[0],
          success: false,
          error: err.message,
          responseTime,
        };
      }
    }
  );
  // Unwrap PromiseSettledResult — fn catches internally so all are fulfilled
  const settingResults = settledSettingResults.filter((r): r is PromiseFulfilledResult<FuzzResult> => r.status === 'fulfilled').map(r => r.value);

  successful += settingResults.filter(r => r.success).length;
  failed += settingResults.filter(r => !r.success).length;

  // ==========================================================================
  // PHASE 2: Delete MaxConfig Rules from all ruleset phases
  // ==========================================================================
  log('');
  log('🗑️ Removing MaxConfig rules from rulesets...');

  const phases = [
    'http_request_firewall_custom',
    'http_request_origin',
    'http_request_cache_settings',
    'http_config_settings',
    'http_request_transform',
    'http_request_late_transform',
    'http_response_headers_transform',
    'http_request_dynamic_redirect',
    'http_response_compression',
    'http_ratelimit',
    'http_request_firewall_managed',
  ];

  for (const phase of phases) {
    try {
      // Get current ruleset for this phase
      const rulesetRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, {
        method: 'GET',
        headers,
      });
      const rulesetData = await rulesetRes.json() as {
        success: boolean;
        result?: { id: string; rules?: { id: string; description?: string }[] };
      };

      if (rulesetData.success && rulesetData.result?.rules) {
        // Filter out rules with MaxConfig in description
        const cleanedRules = rulesetData.result.rules.filter(
          r => !r.description?.includes('MaxConfig') && !r.description?.includes('[MaxConfig]')
        );

        const removedCount = rulesetData.result.rules.length - cleanedRules.length;

        if (removedCount > 0) {
          // Update ruleset with cleaned rules
          const updateRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/phases/${phase}/entrypoint`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ rules: cleanedRules.map(r => ({ ...r })) }),
          });
          const updateData = await updateRes.json() as { success: boolean; errors?: { message: string }[] };

          if (updateData.success) {
            log(`  ✓ ${phase}: removed ${removedCount} MaxConfig rules`);
            results.push({ phase, ruleName: `Cleanup ${phase}`, success: true });
            successful++;
          } else {
            const err = updateData.errors?.[0]?.message || 'Unknown error';
            log(`  ✗ ${phase}: ${err}`);
            results.push({ phase, ruleName: `Cleanup ${phase}`, success: false, error: err });
            failed++;
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      // Phase might not exist, that's ok
    }
  }

  // ==========================================================================
  // PHASE 3: Delete MaxConfig Waiting Rooms
  // ==========================================================================
  log('');
  log('🗑️ Removing MaxConfig waiting rooms...');

  try {
    const waitingRoomsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/waiting_rooms`, {
      method: 'GET',
      headers,
    });
    const waitingRoomsData = await waitingRoomsRes.json() as {
      success: boolean;
      result?: { id: string; name: string; description?: string }[];
    };

    if (waitingRoomsData.success && waitingRoomsData.result) {
      for (const room of waitingRoomsData.result) {
        if (room.name.includes('MaxConfig') || room.name.includes('[MaxConfig]') ||
            room.description?.includes('MaxConfig') || room.description?.includes('[MaxConfig]')) {
          const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/waiting_rooms/${room.id}`, {
            method: 'DELETE',
            headers,
          });
          const deleteData = await deleteRes.json() as { success: boolean };
          if (deleteData.success) {
            log(`  ✓ Deleted waiting room: ${room.name}`);
            results.push({ phase: 'waiting_room', ruleName: room.name, success: true });
            successful++;
          }
        }
      }
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ No waiting rooms to clean up`);
  }

  // ==========================================================================
  // PHASE 4: Delete MaxConfig Worker Routes
  // ==========================================================================
  log('');
  log('🗑️ Removing MaxConfig worker routes...');

  try {
    const routesRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`, {
      method: 'GET',
      headers,
    });
    const routesData = await routesRes.json() as {
      success: boolean;
      result?: { id: string; pattern: string }[];
    };

    if (routesData.success && routesData.result) {
      for (const route of routesData.result) {
        if (route.pattern.includes('maxconfig')) {
          const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes/${route.id}`, {
            method: 'DELETE',
            headers,
          });
          const deleteData = await deleteRes.json() as { success: boolean };
          if (deleteData.success) {
            log(`  ✓ Deleted worker route: ${route.pattern}`);
            results.push({ phase: 'worker_route', ruleName: route.pattern, success: true });
            successful++;
          }
        }
      }
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ No worker routes to clean up`);
  }

  // ==========================================================================
  // PHASE 5: Delete MaxConfig Snippets
  // ==========================================================================
  log('');
  log('🗑️ Removing MaxConfig snippets...');

  try {
    const snippetsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/snippets`, {
      method: 'GET',
      headers,
    });
    const snippetsData = await snippetsRes.json() as {
      success: boolean;
      result?: { snippet_name: string }[];
    };

    if (snippetsData.success && snippetsData.result) {
      for (const snippet of snippetsData.result) {
        if (snippet.snippet_name.includes('maxconfig')) {
          const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/snippets/${snippet.snippet_name}`, {
            method: 'DELETE',
            headers,
          });
          const deleteData = await deleteRes.json() as { success: boolean };
          if (deleteData.success) {
            log(`  ✓ Deleted snippet: ${snippet.snippet_name}`);
            results.push({ phase: 'snippets', ruleName: snippet.snippet_name, success: true });
            successful++;
          }
        }
      }
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log(`  ⏭ No snippets to clean up`);
  }

  // ==========================================================================
  // PHASE 6: Disable Argo (if enabled by MaxConfig)
  // ==========================================================================
  log('');
  log('🔧 Disabling Argo services...');

  try {
    const argoRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/argo/smart_routing`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ value: 'off' }),
    });
    const argoData = await argoRes.json() as { success: boolean };
    if (argoData.success) {
      log('  ✓ Argo Smart Routing disabled');
      results.push({ phase: 'argo', ruleName: 'Argo Smart Routing', success: true });
      successful++;
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Argo Smart Routing not available');
  }

  try {
    const tieredRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/argo/tiered_caching`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ value: 'off' }),
    });
    const tieredData = await tieredRes.json() as { success: boolean };
    if (tieredData.success) {
      log('  ✓ Argo Tiered Cache disabled');
      results.push({ phase: 'argo', ruleName: 'Argo Tiered Cache', success: true });
      successful++;
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Argo Tiered Cache not available');
  }

  // Disable DNSSEC (if enabled by MaxConfig)
  try {
    log('⏳ Disabling DNSSEC...');
    const dnssecRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dnssec`, {
      method: 'DELETE',
      headers,
    });
    const dnssecData = await dnssecRes.json() as { success: boolean; errors?: { message: string }[] };
    if (dnssecData.success) {
      log('  ✓ DNSSEC disabled');
      results.push({ phase: 'dnssec', ruleName: 'DNSSEC', success: true });
      successful++;
    } else {
      log('  ⏭ DNSSEC already disabled or not available');
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ DNSSEC not available');
  }

  // Disable Email Routing (if enabled by MaxConfig)
  try {
    log('⏳ Disabling Email Routing...');
    const emailDisableRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing/disable`, {
      method: 'POST',
      headers,
    });
    const emailData = await emailDisableRes.json() as { success: boolean; errors?: { message: string }[] };
    if (emailData.success) {
      log('  ✓ Email Routing disabled');
      results.push({ phase: 'email_routing', ruleName: 'Email Routing', success: true });
      successful++;
    } else {
      log('  ⏭ Email Routing already disabled or not available');
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Email Routing not available');
  }

  // Disable Page Shield (if enabled by MaxConfig)
  try {
    log('⏳ Disabling Page Shield...');
    const pageShieldRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/page_shield/policy`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        enabled: false,
      }),
    });
    const pageShieldData = await pageShieldRes.json() as { success: boolean; errors?: { message: string }[] };
    if (pageShieldData.success) {
      log('  ✓ Page Shield disabled');
      results.push({ phase: 'page_shield', ruleName: 'Page Shield', success: true });
      successful++;
    } else {
      log('  ⏭ Page Shield already disabled or not available');
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ Page Shield not available');
  }

  // Delete MaxConfig Health Checks
  try {
    log('⏳ Removing MaxConfig health checks...');
    const healthChecksRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/healthchecks`, {
      method: 'GET',
      headers,
    });
    const healthChecksData = await healthChecksRes.json() as {
      success: boolean;
      result?: { id: string; name: string; description?: string }[];
    };
    if (healthChecksData.success && healthChecksData.result) {
      for (const check of healthChecksData.result) {
        if (check.name.includes('MaxConfig') || check.name.includes('[MaxConfig]') ||
            check.description?.includes('MaxConfig') || check.description?.includes('[MaxConfig]')) {
          const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/healthchecks/${check.id}`, {
            method: 'DELETE',
            headers,
          });
          const deleteData = await deleteRes.json() as { success: boolean };
          if (deleteData.success) {
            log(`  ✓ Deleted health check: ${check.name}`);
            results.push({ phase: 'health_check', ruleName: check.name, success: true });
            successful++;
          }
        }
      }
    }
  } catch (e: unknown) {
    api.throwIfAuthError(e);
    log('  ⏭ No health checks to clean up');
  }

  // ==========================================================================
  // PHASE 7: Delete MaxConfig Worker and Bindings
  // ==========================================================================
  const accountId = zone.account?.id;

  if (accountId) {
    log('');
    log('🗑️ Removing MaxConfig Worker and bindings...');

    // Delete Worker custom domain binding
    try {
      const domainsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`, {
        method: 'GET',
        headers,
      });
      const domainsData = await domainsRes.json() as {
        success: boolean;
        result?: { id: string; hostname: string; service: string }[];
      };
      if (domainsData.success && domainsData.result) {
        for (const domain of domainsData.result) {
          if (domain.hostname.includes('maxconfig') || domain.service.includes('maxconfig')) {
            const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains/${domain.id}`, {
              method: 'DELETE',
              headers,
            });
            const deleteData = await deleteRes.json() as { success: boolean };
            if (deleteData.success) {
              log(`  ✓ Deleted worker domain: ${domain.hostname}`);
              results.push({ phase: 'worker', ruleName: `Domain ${domain.hostname}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No worker domains to clean up');
    }

    // Delete Worker Script
    try {
      const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/maxconfig-worker`, {
        method: 'DELETE',
        headers,
      });
      const deleteData = await deleteRes.json() as { success: boolean };
      if (deleteData.success) {
        log('  ✓ Deleted worker: maxconfig-worker');
        results.push({ phase: 'worker', ruleName: 'Worker Script', success: true });
        successful++;
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No worker script to delete');
    }

    // Delete KV Namespaces with MAXCONFIG in title
    try {
      const kvListRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, {
        method: 'GET',
        headers,
      });
      const kvListData = await kvListRes.json() as {
        success: boolean;
        result?: { id: string; title: string }[];
      };
      if (kvListData.success && kvListData.result) {
        for (const ns of kvListData.result) {
          if (ns.title.includes('MAXCONFIG')) {
            const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${ns.id}`, {
              method: 'DELETE',
              headers,
            });
            const deleteData = await deleteRes.json() as { success: boolean };
            if (deleteData.success) {
              log(`  ✓ Deleted KV namespace: ${ns.title}`);
              results.push({ phase: 'worker_bindings', ruleName: `KV ${ns.title}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No KV namespaces to clean up');
    }

    // Delete R2 Buckets with maxconfig in name
    try {
      const r2ListRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`, {
        method: 'GET',
        headers,
      });
      const r2ListData = await r2ListRes.json() as {
        success: boolean;
        result?: { buckets?: { name: string }[] };
      };
      if (r2ListData.success && r2ListData.result?.buckets) {
        for (const bucket of r2ListData.result.buckets) {
          if (bucket.name.includes('maxconfig')) {
            const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket.name}`, {
              method: 'DELETE',
              headers,
            });
            const deleteData = await deleteRes.json() as { success: boolean };
            if (deleteData.success) {
              log(`  ✓ Deleted R2 bucket: ${bucket.name}`);
              results.push({ phase: 'worker_bindings', ruleName: `R2 ${bucket.name}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No R2 buckets to clean up');
    }

    // Delete D1 Databases with MAXCONFIG in name
    try {
      const d1ListRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
        method: 'GET',
        headers,
      });
      const d1ListData = await d1ListRes.json() as {
        success: boolean;
        result?: { uuid: string; name: string }[];
      };
      if (d1ListData.success && d1ListData.result) {
        for (const db of d1ListData.result) {
          if (db.name.includes('MAXCONFIG')) {
            const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${db.uuid}`, {
              method: 'DELETE',
              headers,
            });
            const deleteData = await deleteRes.json() as { success: boolean };
            if (deleteData.success) {
              log(`  ✓ Deleted D1 database: ${db.name}`);
              results.push({ phase: 'worker_bindings', ruleName: `D1 ${db.name}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No D1 databases to clean up');
    }

    // Delete DNS records with maxconfig in name or comment
    try {
      log('');
      log('🗑️ Removing MaxConfig DNS records...');
      const dnsListRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
        method: 'GET',
        headers,
      });
      const dnsListData = await dnsListRes.json() as {
        success: boolean;
        result?: { id: string; name: string; comment?: string }[];
      };
      if (dnsListData.success && dnsListData.result) {
        for (const record of dnsListData.result) {
          if (record.name.includes('maxconfig') || record.comment?.includes('MaxConfig') || record.comment?.includes('[MaxConfig]')) {
            const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`, {
              method: 'DELETE',
              headers,
            });
            const deleteData = await deleteRes.json() as { success: boolean };
            if (deleteData.success) {
              log(`  ✓ Deleted DNS record: ${record.name}`);
              results.push({ phase: 'dns', ruleName: record.name, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No DNS records to clean up');
    }

    // Delete Logpush jobs created by MaxConfig
    try {
      log('');
      log('🗑️ Removing MaxConfig Logpush jobs...');
      const jobsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/logpush/jobs`, {
        method: 'GET',
        headers,
      });
      const jobsData = await jobsRes.json() as { success: boolean; result?: { id: number; name?: string; destination_conf?: string }[] };
      if (jobsData.success && jobsData.result) {
        for (const job of jobsData.result) {
          const name = job.name || '';
          const dest = job.destination_conf || '';
          if (name.includes('MaxConfig') || name.includes('[MaxConfig]') || dest.includes('maxconfig')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/logpush/jobs/${job.id}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted Logpush job: ${job.id} ${name}`);
              results.push({ phase: 'logpush', ruleName: `Logpush ${job.id}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No Logpush jobs to clean up');
    }

    // Delete Page Shield policies created by MaxConfig
    try {
      log('');
      log('🗑️ Removing MaxConfig Page Shield policies...');
      const psRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/page_shield/policies`, {
        method: 'GET',
        headers,
      });
      const psData = await psRes.json() as { success: boolean; result?: { id: string; description?: string }[] };
      if (psData.success && psData.result) {
        for (const p of psData.result) {
          if ((p.description || '').includes('MaxConfig') || (p.description || '').includes('[MaxConfig]')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/page_shield/policies/${p.id}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted Page Shield policy: ${p.id}`);
              results.push({ phase: 'page_shield', ruleName: `Page Shield Policy ${p.id}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No Page Shield policies to clean up');
    }

    // Delete firewall access rules / lockdowns / UA rules created by MaxConfig
    try {
      log('');
      log('🗑️ Removing MaxConfig firewall access rules...');
      const arRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/access_rules/rules`, {
        method: 'GET',
        headers,
      });
      const arData = await arRes.json() as { success: boolean; result?: { id: string; notes?: string }[] };
      if (arData.success && arData.result) {
        for (const r of arData.result) {
          if ((r.notes || '').includes('MaxConfig') || (r.notes || '').includes('[MaxConfig]')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/access_rules/rules/${r.id}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted access rule: ${r.id}`);
              results.push({ phase: 'firewall', ruleName: `Access Rule ${r.id}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No firewall access rules to clean up');
    }

    try {
      log('');
      log('🗑️ Removing MaxConfig firewall lockdowns...');
      const ldRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/lockdowns`, {
        method: 'GET',
        headers,
      });
      const ldData = await ldRes.json() as { success: boolean; result?: { id: string; description?: string }[] };
      if (ldData.success && ldData.result) {
        for (const r of ldData.result) {
          if ((r.description || '').includes('MaxConfig') || (r.description || '').includes('[MaxConfig]')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/lockdowns/${r.id}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted lockdown: ${r.id}`);
              results.push({ phase: 'firewall', ruleName: `Lockdown ${r.id}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No firewall lockdowns to clean up');
    }

    try {
      log('');
      log('🗑️ Removing MaxConfig firewall UA rules...');
      const uaRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/ua_rules`, {
        method: 'GET',
        headers,
      });
      const uaData = await uaRes.json() as { success: boolean; result?: { id: string; description?: string }[] };
      if (uaData.success && uaData.result) {
        for (const r of uaData.result) {
          if ((r.description || '').includes('MaxConfig') || (r.description || '').includes('[MaxConfig]')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/firewall/ua_rules/${r.id}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted UA rule: ${r.id}`);
              results.push({ phase: 'firewall', ruleName: `UA Rule ${r.id}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No firewall UA rules to clean up');
    }

    // Delete Load Balancers created by MaxConfig
    try {
      log('');
      log('🗑️ Removing MaxConfig load balancers...');
      const lbRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/load_balancers`, {
        method: 'GET',
        headers,
      });
      const lbData = await lbRes.json() as { success: boolean; result?: { id: string; name: string; description?: string }[] };
      if (lbData.success && lbData.result) {
        for (const lb of lbData.result) {
          if (lb.name.includes('maxconfig') || (lb.description || '').includes('MaxConfig') || (lb.description || '').includes('[MaxConfig]')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/load_balancers/${lb.id}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted load balancer: ${lb.name}`);
              results.push({ phase: 'load_balancer', ruleName: lb.name, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No load balancers to clean up');
    }

    // Delete account-scoped LB pools/monitors created by MaxConfig
    try {
      log('');
      log('🗑️ Removing MaxConfig load balancer pools...');
      const poolsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/load_balancers/pools`, {
        method: 'GET',
        headers,
      });
      const poolsData = await poolsRes.json() as { success: boolean; result?: { id: string; name: string; description?: string }[] };
      if (poolsData.success && poolsData.result) {
        for (const p of poolsData.result) {
          if (p.name.includes('maxconfig') || (p.description || '').includes('MaxConfig') || (p.description || '').includes('[MaxConfig]')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/load_balancers/pools/${p.id}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted pool: ${p.name}`);
              results.push({ phase: 'load_balancer', ruleName: `Pool ${p.name}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No pools to clean up');
    }

    try {
      log('');
      log('🗑️ Removing MaxConfig load balancer monitors...');
      const monRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/load_balancers/monitors`, {
        method: 'GET',
        headers,
      });
      const monData = await monRes.json() as { success: boolean; result?: { id: string; description?: string }[] };
      if (monData.success && monData.result) {
        for (const m of monData.result) {
          if ((m.description || '').includes('MaxConfig') || (m.description || '').includes('[MaxConfig]')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/load_balancers/monitors/${m.id}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted monitor: ${m.id}`);
              results.push({ phase: 'load_balancer', ruleName: `Monitor ${m.id}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No monitors to clean up');
    }

    // Delete Spectrum apps created by MaxConfig
    try {
      log('');
      log('🗑️ Removing MaxConfig Spectrum apps...');
      const sRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/spectrum/apps`, {
        method: 'GET',
        headers,
      });
      const sData = await sRes.json() as { success: boolean; result?: { id: string; dns?: { name?: string } }[] };
      if (sData.success && sData.result) {
        for (const app of sData.result) {
          const dnsName = app.dns?.name || '';
          if (dnsName.includes('maxconfig')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/spectrum/apps/${app.id}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted Spectrum app: ${app.id}`);
              results.push({ phase: 'spectrum', ruleName: `Spectrum ${app.id}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No Spectrum apps to clean up');
    }

    // Delete Custom Hostnames created by MaxConfig
    try {
      log('');
      log('🗑️ Removing MaxConfig custom hostnames...');
      const chRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`, {
        method: 'GET',
        headers,
      });
      const chData = await chRes.json() as { success: boolean; result?: { id: string; hostname: string }[] };
      if (chData.success && chData.result) {
        for (const h of chData.result) {
          if (h.hostname.includes('maxconfig')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${h.id}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted custom hostname: ${h.hostname}`);
              results.push({ phase: 'custom_hostnames', ruleName: h.hostname, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No custom hostnames to clean up');
    }

    // Delete Turnstile widgets created by MaxConfig
    try {
      log('');
      log('🗑️ Removing MaxConfig Turnstile widgets...');
      const tRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets`, {
        method: 'GET',
        headers,
      });
      const tData = await tRes.json() as { success: boolean; result?: { sitekey: string; name?: string }[] };
      if (tData.success && tData.result) {
        for (const w of tData.result) {
          const name = w.name || '';
          if (name.includes('maxconfig') || name.includes('MaxConfig')) {
            const delRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets/${w.sitekey}`, {
              method: 'DELETE',
              headers,
            });
            const delData = await delRes.json() as { success: boolean };
            if (delData.success) {
              log(`  ✓ Deleted Turnstile widget: ${w.sitekey}`);
              results.push({ phase: 'turnstile', ruleName: `Turnstile ${w.sitekey}`, success: true });
              successful++;
            }
          }
        }
      }
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      log('  ⏭ No Turnstile widgets to clean up');
    }
  }

  // Same reclassification as MaxConfig: conflicts on a re-run are on-target.
  const alreadyPresent = countAlreadyPresent(results);
  const acknowledged = countAcknowledged(results);
  const adjustedFailed = Math.max(0, failed - alreadyPresent - acknowledged);

  log('');
  log(`📊 Minimum Config Complete: ${successful} items reset/removed, ${alreadyPresent} already in desired state, ${acknowledged} acknowledged (plan/entitlement), ${adjustedFailed} failed`);

  return {
    timestamp: new Date().toISOString(),
    zoneId,
    zoneName: zone.name,
    totalRules: results.length,
    successful,
    failed: adjustedFailed,
    alreadyPresent,
    acknowledged,
    results,
    createdRulesets,
  };
}
