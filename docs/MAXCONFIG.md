# MaxConfig / MinConfig Reference

Catalogue of every zone setting, ruleset rule, and subsystem the MaxConfig
("All Features On") and MinConfig ("All Features Off / cleanup") presets
touch. Used by `src/fuzz.ts` and the developer-tools panel in Step 1.

See also: [SECURITY.md § API token permissions](SECURITY.md#api-token-permissions)
for the elevated permissions MaxConfig needs. For the OpenAPI-derived
coverage matrix (what's migrated vs captured vs acknowledged across the
full Cloudflare API surface), run `node scripts/coverage-report.mjs
--write-md` to regenerate `coverage/api-surface.md`.

For the safety model, see the "MaxConfig safety model" section in
`AGENTS.md`.

---

## Overview

Maximum Config aims to apply the maximum possible persistent configuration that
can affect requests to the selected zone. That includes zone settings, rulesets,
zone-scoped products, and account-level resources only when they are attached to
the selected zone's traffic path.

The default is intentionally safer than "mutate everything": it protects other
zones in the same account and avoids registrar/external-DNS, billing-changing,
account-wide traffic, and private-key-dependent mutations. Unsafe mutations are
available only through the explicit `includeUnsafeAccountWideTrafficSettings`
option on `/api/maxconfig/stream`, which defaults to `false`.

Many calls may still fail due to validation, quota, entitlement, or product
prerequisites; entitlement failures are expected and logged as skipped rather
than treated as fatal MaxConfig failures.

## Execution Layers

When you click **All Features On** (sourceMode=`maxconfig`), the worker streams results for three layers:

1. Zone settings fuzz (API-driven: applies best-effort "max" values to all editable settings returned by `GET /zones/{zone_id}/settings`).
2. Ruleset rules across phases (`PUT /zones/{zone_id}/rulesets/phases/{phase}/entrypoint`).
3. "Weird-shaped" resources + paid products + action endpoints (DNS edge-case record types, firewall legacy endpoints, API Gateway settings, cache purge, load balancing, spectrum, custom hostnames, turnstile, etc.).

Additionally, MaxConfig runs the API endpoints fuzz pass (`fuzzZoneApiEndpoints(...)`) without cleanup and includes an `apiReport` in the stream `done` payload.

---

## Zone Settings

Zone settings are updated via:
```
PATCH /zones/{zone_id}/settings/{setting_id}
```

Implementation note:

- MaxConfig no longer relies exclusively on the hardcoded `ZONE_SETTINGS` list.
- It enumerates all settings returned by `GET /zones/{zone_id}/settings` and attempts to set every `editable=true` setting.
- Known settings use curated max values; unknown settings use heuristics (and may fail).

### On/Off Toggle Settings

| Setting ID | Description | Max Value | Plan Required |
|------------|-------------|-----------|---------------|
| `0rtt` | 0-RTT session resumption | `on` | Free |
| `always_online` | Always Online (serve stale) | `on` | Free |
| `always_use_https` | Always Use HTTPS | `on` | Free |
| `automatic_https_rewrites` | Automatic HTTPS Rewrites | `on` | Free |
| `brotli` | Brotli compression | `on` | Free |
| `browser_check` | Browser Integrity Check | `on` | Free |
| `development_mode` | Development Mode | `on` | Free |
| `early_hints` | Early Hints (103) | `on` | Free |
| `email_obfuscation` | Email Obfuscation | `on` | Free |
| `hotlink_protection` | Hotlink Protection | `on` | Free |
| `http2` | HTTP/2 | `on` | Free |
| `http3` | HTTP/3 (QUIC) | `on` | Free |
| `ip_geolocation` | IP Geolocation | `on` | Free |
| `ipv6` | IPv6 Compatibility | `on` | Free |
| `opportunistic_encryption` | Opportunistic Encryption | `on` | Free |
| `opportunistic_onion` | Onion Routing | `on` | Free |
| `origin_error_page_pass_thru` | Origin Error Page Pass-through | `on` | Enterprise |
| `prefetch_preload` | Prefetch URLs | `on` | Enterprise |
| `privacy_pass` | Privacy Pass | `on` | Free |
| `response_buffering` | Response Buffering | `on` | Enterprise |
| `rocket_loader` | Rocket Loader | `on` | Free |
| `server_side_exclude` | Server Side Excludes | `on` | Free |
| `sort_query_string_for_cache` | Query String Sort | `on` | Enterprise |
| `tls_1_3` | TLS 1.3 | `on` | Free |
| `tls_client_auth` | TLS Client Auth | `on` | Enterprise |
| `true_client_ip_header` | True Client IP Header | `on` | Enterprise |
| `websockets` | WebSockets | `on` | Free |
| `webp` | WebP | `off` | Pro (requires Polish) |
| `ech` | Encrypted Client Hello | `on` | Free |
| `fonts` | Cloudflare Fonts | `on` | Free |
| `h2_prioritization` | HTTP/2 Edge Prioritization | `on` | Pro |
| `replace_insecure_js` | Replace Insecure JS | `on` | Free |
| `mirage` | Mirage Image Optimization | `on` | Pro |
| `orange_to_orange` | Orange to Orange (O2O) | `on` | Enterprise |
| `speed_brain` | Speed Brain | `on` | Free |
| `advanced_ddos` | Advanced DDoS Protection | `on` | Business |
| `sha1_support` | SHA-1 Certificate Support | `on` | Free |
| `visitor_ip` | Visitor IP Header | `on` | Free |

### String/Enum Settings

| Setting ID | Description | Max Value | Plan Required |
|------------|-------------|-----------|---------------|
| `ssl` | SSL mode | `strict` | Free |
| `cache_level` | Caching Level | `aggressive` | Free |
| `min_tls_version` | Minimum TLS Version | `1.2` | Free |
| `security_level` | Security Level | `high` | Free |
| `polish` | Polish (image optimization) | `lossy` | Pro |
| `pseudo_ipv4` | Pseudo IPv4 | `add_header` | Free |
| `image_resizing` | Image Resizing | `on` | Business |
| `origin_max_http_version` | Origin Max HTTP Version | `2` | Free |
| `origin_dns_name` | Origin DNS Name | `` | Enterprise |

### Number Settings

| Setting ID | Description | Max Value | Plan Required |
|------------|-------------|-----------|---------------|
| `browser_cache_ttl` | Browser Cache TTL | `31536000` (1 year) | Free |
| `challenge_ttl` | Challenge TTL | `31536000` (1 year) | Free |
| `max_upload` | Max Upload Size (MB) | `100` | Free |
| `edge_cache_ttl` | Edge Cache TTL | `7200` (plan limit) | Free |
| `proxy_read_timeout` | Proxy Read Timeout | `100` | Enterprise |

### Object Settings

| Setting ID | Description | Max Value | Plan Required |
|------------|-------------|-----------|---------------|
| `minify` | Auto Minify | `{css:"on",html:"on",js:"on"}` | Free |
| `mobile_redirect` | Mobile Redirect | `{status:"off"}` | Free |
| `nel` | Network Error Logging | `{enabled:true}` | Free |
| `security_header` | Security Headers (HSTS) | `{strict_transport_security:{...}}` | Free |

### Array Settings

| Setting ID | Description | Max Value | Plan Required |
|------------|-------------|-----------|---------------|
| `ciphers` | Cipher Suites | `[]` (default) | Enterprise |

### Deprecated Settings (Skipped)

| Setting ID | Description | Reason |
|------------|-------------|--------|
| `waf` | Web Application Firewall | Use Zone WAF rulesets instead |
| `auto_minify` | Auto Minify | Use `minify` object instead |

---

## Ruleset Rules

All ruleset rules are created via:
```
PUT /zones/{zone_id}/rulesets/phases/{phase}/entrypoint
```

## Additional Subsystems and Resources

MaxConfig also attempts the following (best-effort; failures are logged but do not abort):

- Zone plan/subscription mutation (billing-changing): `PUT /zones/{zone_id}/subscription` only when `includeUnsafeAccountWideTrafficSettings: true`
- DNSSEC activation: `PATCH /zones/{zone_id}/dnssec` only when `includeUnsafeAccountWideTrafficSettings: true`
- Managed Headers / Managed Transforms: `GET` + `PATCH /zones/{zone_id}/managed_headers`
- URL Normalization: `PUT /zones/{zone_id}/url_normalization`
- Regional Tiered Cache: `PATCH /zones/{zone_id}/cache/regional_tiered_cache`
- Origin Post-Quantum Encryption: `PUT /zones/{zone_id}/cache/origin_post_quantum_encryption`
- ACM Total TLS: `POST /zones/{zone_id}/acm/total_tls`
- Content Upload Scan settings: `PUT /zones/{zone_id}/content-upload-scan/settings`
- Leaked Credential Checks: `POST /zones/{zone_id}/leaked-credential-checks`
- Waiting Room settings: `PUT /zones/{zone_id}/waiting_rooms/settings`
- DNS edge-case record types: `POST /zones/{zone_id}/dns_records` (LOC, URI, NAPTR, SRV, CAA, SSHFP, TLSA, SMIMEA, OPENPGPKEY, HTTPS, SVCB)
- Firewall surfaces: `POST /zones/{zone_id}/firewall/access_rules/rules`, `POST /zones/{zone_id}/firewall/lockdowns`, `POST /zones/{zone_id}/firewall/ua_rules`
- Page Shield policies: `POST /zones/{zone_id}/page_shield/policies`
- API Gateway schema validation settings: `PATCH /zones/{zone_id}/api_gateway/settings/schema_validation`
- Cache purge action endpoints: `POST /zones/{zone_id}/purge_cache`
- Load Balancing: `POST /accounts/{account_id}/load_balancers/monitors`, `POST /accounts/{account_id}/load_balancers/pools`, `POST /zones/{zone_id}/load_balancers`
- Spectrum: `POST /zones/{zone_id}/spectrum/apps`
- SSL for SaaS / Custom Hostnames: `POST /zones/{zone_id}/custom_hostnames`
- Turnstile: `POST /accounts/{account_id}/challenges/widgets`

### Custom Rules (WAF)

**Phase**: `http_request_firewall_custom`

| Rule | Action | Expression |
|------|--------|------------|
| Block test IP | `block` | `(ip.src eq 192.0.2.1)` |
| Challenge admin path | `managed_challenge` | `(http.request.uri.path contains "/maxconfig-admin")` |

### Origin Rules

**Phase**: `http_request_origin`

| Rule | Action | Expression |
|------|--------|------------|
| Route API to origin | `route` | `starts_with(http.request.uri.path, "/maxconfig-api/")` |

**Action Parameters**:
```json
{
  "origin": {
    "host": "api-origin.example.com",
    "port": 443
  }
}
```

### Cache Rules

**Phase**: `http_request_cache_settings`

| Rule | Action | Expression |
|------|--------|------------|
| Cache static assets | `set_cache_settings` | `(http.request.uri.path.extension in {"js" "css" "png" "jpg" "gif" "webp"})` |
| Bypass cache for API | `set_cache_settings` | `starts_with(http.request.uri.path, "/maxconfig-nocache/")` |

**Action Parameters** (cache):
```json
{
  "cache": true,
  "edge_ttl": { "mode": "override_origin", "default": 86400 },
  "browser_ttl": { "mode": "override_origin", "default": 3600 }
}
```

### Config Rules

**Phase**: `http_config_settings`

| Rule | Action | Expression |
|------|--------|------------|
| Optimized config | `set_config` | `starts_with(http.request.uri.path, "/maxconfig-optimized/")` |

**Action Parameters**:
```json
{
  "bic": true,
  "mirage": true,
  "rocket_loader": true,
  "polish": "lossy"
}
```

### Transform Rules (URL Rewrite)

**Phase**: `http_request_transform`

| Rule | Action | Expression |
|------|--------|------------|
| URL rewrite | `rewrite` | `(http.request.uri.path eq "/maxconfig-old-path")` |

**Action Parameters**:
```json
{
  "uri": {
    "path": { "value": "/maxconfig-new-path" }
  }
}
```

### Transform Rules (Request Headers)

**Phase**: `http_request_late_transform`

| Rule | Action | Expression |
|------|--------|------------|
| Add request header | `rewrite` | `starts_with(http.request.uri.path, "/maxconfig/")` |

**Action Parameters**:
```json
{
  "headers": {
    "X-MaxConfig-Request": {
      "operation": "set",
      "value": "enabled"
    }
  }
}
```

### Transform Rules (Response Headers)

**Phase**: `http_response_headers_transform`

| Rule | Action | Expression |
|------|--------|------------|
| Add response header | `rewrite` | `starts_with(http.request.uri.path, "/maxconfig/")` |

**Action Parameters**:
```json
{
  "headers": {
    "X-MaxConfig-Response": {
      "operation": "set",
      "value": "enabled"
    }
  }
}
```

### Redirect Rules

**Phase**: `http_request_dynamic_redirect`

| Rule | Action | Expression |
|------|--------|------------|
| Test redirect | `redirect` | `(http.request.uri.path eq "/maxconfig-redirect-me")` |

**Action Parameters**:
```json
{
  "from_value": {
    "status_code": 302,
    "target_url": { "value": "/maxconfig-redirected" },
    "preserve_query_string": true
  }
}
```

### Compression Rules

**Phase**: `http_response_compression`

| Rule | Action | Expression |
|------|--------|------------|
| Enable compression | `compress_response` | `starts_with(http.request.uri.path, "/maxconfig-compress/")` |

**Action Parameters**:
```json
{
  "algorithms": [
    { "name": "gzip" },
    { "name": "brotli" }
  ]
}
```

### Rate Limiting Rules

**Phase**: `http_ratelimit`

| Rule | Action | Expression |
|------|--------|------------|
| Rate limit API | `block` | `starts_with(http.request.uri.path, "/maxconfig-api/")` |

**Ratelimit Parameters**:
```json
{
  "characteristics": ["ip.src"],
  "period": 60,
  "requests_per_period": 100,
  "mitigation_timeout": 60
}
```

### DDoS Custom Rules

**Phase**: `ddos_l7`

| Rule | Action | Expression |
|------|--------|------------|
| DDoS protection | `ddos_dynamic` | `true` |

**Action Parameters**:
```json
{
  "overrides": {
    "sensitivity_level": "high"
  }
}
```

### Super Bot Fight Mode

**Phase**: `http_request_sbfm`

| Rule | Action | Expression |
|------|--------|------------|
| Challenge low-score bots | `managed_challenge` | `(cf.bot_management.score lt 30)` |

### Managed Headers (Request)

**Phase**: `http_request_sanitize`

| Rule | Action | Expression |
|------|--------|------------|
| Add managed headers | `rewrite` | `true` |

**Action Parameters**:
```json
{
  "headers": {
    "X-MaxConfig-Sanitized": {
      "operation": "set",
      "value": "true"
    }
  }
}
```

### Custom Error Rules

**Phase**: `http_custom_errors`

| Rule | Action | Expression |
|------|--------|------------|
| Custom 404 page | `serve_error` | `(http.response.code eq 404)` |

**Action Parameters**:
```json
{
  "content": "<!DOCTYPE html><html>...</html>",
  "content_type": "text/html",
  "status_code": 404
}
```

### Log Custom Fields

**Phase**: `http_log_custom_fields`

| Rule | Action | Expression |
|------|--------|------------|
| Log custom field | `log_custom_field` | `true` |

**Action Parameters**:
```json
{
  "cookie_fields": [{ "name": "maxconfig_test" }],
  "request_fields": [{ "name": "X-MaxConfig-Request" }],
  "response_fields": [{ "name": "X-MaxConfig-Response" }]
}
```

---

## Additional Subsystems

These are major features that live outside standard settings and rulesets.

### DNSSEC

**Endpoint**: `PATCH /zones/{zone_id}/dnssec`

**Payload**:
```json
{
  "status": "active"
}
```

### Argo Smart Routing

**Endpoint**: `PATCH /zones/{zone_id}/argo/smart_routing`

**Payload**:
```json
{
  "value": "on"
}
```

**Note**: Argo requires a paid add-on. May fail on free plans.

### Argo Tiered Cache

**Endpoint**: `PATCH /zones/{zone_id}/argo/tiered_caching`

**Payload**:
```json
{
  "value": "on"
}
```

### Managed WAF Rulesets (OWASP, Cloudflare Managed)

**Endpoint**: `PUT /zones/{zone_id}/rulesets/phases/http_request_firewall_managed/entrypoint`

First, fetch available managed rulesets:
```
GET /zones/{zone_id}/rulesets
```

Then deploy them:
```json
{
  "rules": [
    {
      "action": "execute",
      "expression": "true",
      "description": "[MaxConfig] Execute Cloudflare Managed Ruleset",
      "action_parameters": {
        "id": "{managed_ruleset_id}"
      },
      "enabled": true
    }
  ]
}
```

### Email Routing

**Enable Endpoint**: `POST /zones/{zone_id}/email/routing/enable`

**Create Rule Endpoint**: `POST /zones/{zone_id}/email/routing/rules`

**Payload** (rule):
```json
{
  "matchers": [
    { "type": "literal", "field": "to", "value": "test@example.com" }
  ],
  "actions": [
    { "type": "forward", "value": ["destination@example.com"] }
  ],
  "enabled": true
}
```

### Waiting Rooms

**Endpoint**: `POST /zones/{zone_id}/waiting_rooms`

| Parameter | Max Value | Description |
|-----------|-----------|-------------|
| `name` | `[MaxConfig] Global Squeezer` | Identifier for fuzz test |
| `host` | `example.com` | Primary zone hostname |
| `new_users_per_minute` | `10` | Low limit to force queueing |
| `total_active_users` | `50` | Low limit to trigger queue |
| `queueing_method` | `random` | Max complexity for randomization |
| `json_response_enabled` | `true` | JSON queueing for non-browser traffic |
| `search_engine_crawler_bypass` | `true` | Allow search engines through |

**Payload**:
```json
{
  "name": "[MaxConfig] Global Squeezer",
  "host": "example.com",
  "path": "/",
  "new_users_per_minute": 10,
  "total_active_users": 50,
  "session_duration": 5,
  "queueing_method": "random",
  "queue_all": false,
  "disable_session_renewal": false,
  "json_response_enabled": true,
  "search_engine_crawler_bypass": true,
  "description": "[MaxConfig] Test waiting room with random queueing"
}
```

### Worker Routes

**Endpoint**: `POST /zones/{zone_id}/workers/routes`

**Payload**:
```json
{
  "pattern": "example.com/maxconfig-worker/*",
  "script": "my-worker-script"
}
```

**Note**: MaxConfig creates a disabled route (script: null) since it requires an existing worker script.

### Zaraz (Third-Party Logic)

**Config Endpoint**: `PUT /zones/{zone_id}/settings/zaraz/v2/config`

| Setting | Max Value | Description |
|---------|-----------|-------------|
| `dataLayer` | `true` | GTM-style data layer compatibility |
| `autoInjectScript` | `true` | Force Zaraz script on all pages |
| `historyChange` | `true` | Support Single Page Apps (SPA) |
| `contextEnricher` | `true` | Enhanced context data |
| `removeURLParams` | `true` | Max privacy: strips PII from query strings |
| `trimIPAddresses` | `true` | Privacy: truncate IP addresses |

**Payload**:
```json
{
  "debugKey": "maxconfig-debug",
  "dataLayer": true,
  "settings": {
    "autoInjectScript": true,
    "injectScript": true,
    "historyChange": true,
    "contextEnricher": true,
    "privacy": {
      "removeURLParams": true,
      "trimIPAddresses": true
    }
  },
  "tools": {
    "maxconfig_logger": {
      "name": "[MaxConfig] Edge Logger",
      "component": "custom-html",
      "enabled": true,
      "settings": {
        "html": "<script>console.log('🎄 MaxConfig Zaraz Loaded');</script>"
      }
    }
  },
  "triggers": {},
  "variables": {}
}
```

### Cloudflare Snippets (Edge Logic)

Snippets are the successor to many simple Page Rules. Use for header manipulation and edge logic.

**Create Snippet**: `PUT /zones/{zone_id}/snippets/{snippet_name}`

**Payload**:
```json
{
  "files": {
    "main.js": "export default { async fetch(request) { const response = new Response('🎄 MaxConfig Snippet Active', { headers: { 'Content-Type': 'text/plain' } }); response.headers.set('X-MaxConfig-Snippet', 'enabled'); response.headers.set('X-Timestamp', new Date().toISOString()); return response; } }"
  },
  "metadata": {
    "main_module": "main.js"
  }
}
```

**Create Snippet Rule**: `PUT /zones/{zone_id}/snippets/{snippet_name}/rules`

**Payload**:
```json
{
  "rules": [{
    "description": "[MaxConfig] Snippet activation rule",
    "expression": "starts_with(http.request.uri.path, \"/maxconfig-snippet/\")",
    "enabled": true
  }]
}
```

### Worker with Bindings

MaxConfig creates a full Worker setup with KV, R2, and D1 bindings, bound to a custom domain.

**Worker Name**: `maxconfig-worker`
**Custom Domain**: `maxconfig.{zone_name}`

#### Created Resources

| Resource | Name | Endpoint |
|----------|------|----------|
| KV Namespace | `MAXCONFIG_KV` | `POST /accounts/{id}/storage/kv/namespaces` |
| R2 Bucket | `maxconfig-bucket` | `POST /accounts/{id}/r2/buckets` |
| D1 Database | `MAXCONFIG_DB` | `POST /accounts/{id}/d1/database` |
| Worker Script | `maxconfig-worker` | `PUT /accounts/{id}/workers/scripts/{name}` |
| DNS Record | `maxconfig.{zone}` | `POST /zones/{id}/dns_records` |
| Custom Domain | `maxconfig.{zone}` | `PUT /accounts/{id}/workers/domains` |

#### Worker Script

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Test KV binding
    let kvValue = null;
    if (env.MAXCONFIG_KV) {
      kvValue = await env.MAXCONFIG_KV.get('maxconfig_test');
    }
    
    // Build response showing all bindings
    const bindings = {
      timestamp: new Date().toISOString(),
      path: url.pathname,
      kv: kvValue || 'KV not bound',
      r2: env.MAXCONFIG_R2 ? 'R2 bucket bound' : 'R2 not bound',
      d1: env.MAXCONFIG_DB ? 'D1 database bound' : 'D1 not bound',
      message: '🎄 MaxConfig Worker is running!'
    };
    
    return new Response(JSON.stringify(bindings, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'X-MaxConfig-Worker': 'enabled'
      }
    });
  }
};
```

#### Worker Bindings

```json
{
  "bindings": [
    { "type": "kv_namespace", "name": "MAXCONFIG_KV", "namespace_id": "{kv_id}" },
    { "type": "r2_bucket", "name": "MAXCONFIG_R2", "bucket_name": "maxconfig-bucket" },
    { "type": "d1", "name": "MAXCONFIG_DB", "id": "{d1_uuid}" }
  ]
}
```

### Load Balancers

Load Balancers require creating monitors, pools, then the LB itself.

**Create Monitor**: `POST /accounts/{account_id}/load_balancers/monitors`
```json
{
  "type": "http",
  "description": "[MaxConfig] Health monitor",
  "method": "GET",
  "path": "/health",
  "expected_codes": "200",
  "timeout": 5,
  "interval": 60
}
```

**Create Pool**: `POST /accounts/{account_id}/load_balancers/pools`
```json
{
  "name": "maxconfig-pool",
  "origins": [
    { "name": "primary", "address": "origin.example.com", "enabled": true }
  ],
  "monitor": "{monitor_id}"
}
```

**Create Load Balancer**: `POST /zones/{zone_id}/load_balancers`
```json
{
  "name": "lb.example.com",
  "default_pools": ["{pool_id}"],
  "fallback_pool": "{pool_id}",
  "proxied": true
}
```

**Note**: Load Balancers are not auto-created by MaxConfig because they require account-level API access and origin configuration.

---

## API Endpoints Summary

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Get Zone | GET | `/zones/{zone_id}` |
| List Zone Settings | GET | `/zones/{zone_id}/settings` |
| Update Zone Setting | PATCH | `/zones/{zone_id}/settings/{setting_id}` |
| Update Ruleset Phase | PUT | `/zones/{zone_id}/rulesets/phases/{phase}/entrypoint` |
| Enable DNSSEC | PATCH | `/zones/{zone_id}/dnssec` |
| Argo Smart Routing | PATCH | `/zones/{zone_id}/argo/smart_routing` |
| Argo Tiered Cache | PATCH | `/zones/{zone_id}/argo/tiered_caching` |
| List Rulesets | GET | `/zones/{zone_id}/rulesets` |
| Deploy Managed WAF | PUT | `/zones/{zone_id}/rulesets/phases/http_request_firewall_managed/entrypoint` |
| Enable Email Routing | POST | `/zones/{zone_id}/email/routing/enable` |
| Create Email Rule | POST | `/zones/{zone_id}/email/routing/rules` |
| Create Waiting Room | POST | `/zones/{zone_id}/waiting_rooms` |
| Create Worker Route | POST | `/zones/{zone_id}/workers/routes` |
| Configure Zaraz | PUT | `/zones/{zone_id}/settings/zaraz/v2/config` |
| Create Snippet | PUT | `/zones/{zone_id}/snippets/{snippet_name}` |
| Create Snippet Rule | PUT | `/zones/{zone_id}/snippets/{snippet_name}/rules` |
| Create Monitor | POST | `/accounts/{account_id}/load_balancers/monitors` |
| Create Pool | POST | `/accounts/{account_id}/load_balancers/pools` |
| Create Load Balancer | POST | `/zones/{zone_id}/load_balancers` |

---

## Required Permissions

To run Maximum Config, your API token needs:

| Permission | Scope | Purpose |
|------------|-------|---------|
| Zone:Read | Zone | Get zone info |
| Zone:Edit | Zone | DNSSEC, Argo |
| Zone Settings:Edit | Zone | Update all settings |
| Zone WAF:Edit | Zone | Create ruleset rules, Managed WAF |
| DNS:Edit | Zone | DNSSEC DS records |
| Email Routing Rules:Edit | Zone | Email routing |
| Waiting Room:Edit | Zone | Waiting rooms |
| Workers Routes:Edit | Zone | Worker routes |
| Zaraz:Edit | Zone | Zaraz configuration |
| Snippets:Edit | Zone | Edge logic snippets |
| Workers Scripts:Edit | Account | Worker scripts |
| Workers KV Storage:Edit | Account | KV namespaces |
| Workers R2 Storage:Edit | Account | R2 buckets |
| D1:Edit | Account | D1 databases |
| Load Balancers:Edit | Zone | Load balancers (optional) |
| Load Balancing: Monitors And Pools:Edit | Account | Monitors/pools (optional) |

---

## Minimum Config (Cleanup)

The **🧹 Minimum Config** button does the opposite of Maximum Config:

### What it does

1. **Resets Zone Settings** - All toggle settings set to `off`, safe defaults for SSL/security
2. **Deletes MaxConfig Rules** - Removes all rules with "MaxConfig" or "[MaxConfig]" in description from all 16 ruleset phases
3. **Deletes MaxConfig Waiting Rooms** - Removes waiting rooms with "MaxConfig" in name/description
4. **Deletes MaxConfig Worker Routes** - Removes routes with "maxconfig" in pattern
5. **Deletes MaxConfig Snippets** - Removes snippets with "maxconfig" in name
6. **Disables Argo** - Turns off Smart Routing and Tiered Cache
7. **Deletes MaxConfig Worker** - Removes `maxconfig-worker` script and custom domain binding
8. **Deletes MaxConfig KV** - Removes KV namespaces with "MAXCONFIG" in title
9. **Deletes MaxConfig R2** - Removes R2 buckets with "maxconfig" in name
10. **Deletes MaxConfig D1** - Removes D1 databases with "MAXCONFIG" in name
11. **Deletes MaxConfig DNS** - Removes DNS records with "maxconfig" in name or "[MaxConfig]" in comment

### API Endpoint

```
POST /api/minconfig/stream
```

**Payload**:
```json
{
  "token": "your-api-token",
  "zoneId": "zone-id"
}
```

### Setting Reset Values

| Setting | Min Value | Reason |
|---------|-----------|--------|
| All on/off toggles | `off` | Disable features |
| `ssl` | `full` | Safe default (not off) |
| `cache_level` | `basic` | Minimal caching |
| `min_tls_version` | `1.0` | Most permissive |
| `security_level` | `medium` | Balanced default |
| `browser_cache_ttl` | `14400` | 4 hours |
| `challenge_ttl` | `1800` | 30 minutes |
| `minify` | `{css:"off",html:"off",js:"off"}` | Disable |
| `security_header` | HSTS disabled | No forced HTTPS |

---

## Usage

```javascript
// From the UI
Click "🎄 Maximum Config" button in Step 2 to enable everything
Click "🧹 Minimum Config" button in Step 2 to reset and cleanup

// From API (internal)
POST /api/maxconfig/stream
{
  "token": "your-api-token",
  "zoneId": "zone-id",
  "mode": "all"  // "settings", "rules", or "all"
}
```

---

## Cleanup

MaxConfig creates rules with `[MaxConfig]` prefix in their descriptions. To remove:

1. Go to Cloudflare Dashboard → Security → WAF
2. Find rules with `[MaxConfig]` in description
3. Delete or disable as needed

Settings changes persist until manually reverted.
