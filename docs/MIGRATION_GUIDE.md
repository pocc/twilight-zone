# Migration Guide

End-to-end guide for migrating a Cloudflare zone between accounts -
**with** the Twilight Zone tool, **without** it (manual runbook using
`cf-terraforming` / `wrangler` / REST API), or as a "trust but verify"
cross-check after running the tool.

This guide covers:

- Cloudflare's official migration process and zone lifecycle.
- Required entitlements on source and destination accounts.
- Pre-flight blockers and how to clear them.
- The three-phase migration model (Preparation → Cutover → Monitoring).
- Per-resource manual procedures with verification checklists.
- The catalogue of things that cannot be migrated automatically and what to
  do about each.
- Cutover smoke tests and rollback plan.

> **Why is this hard?** A Cloudflare zone is not one portable configuration
> bundle. It is core zone metadata plus product-specific configuration,
> account-scoped dependencies (KV, R2, D1, LB pools, Access apps, custom
> certs, BYOIP), entitlements, internal feature flags, Quicksilver edge
> state, and stateful product data. Some of that is exposed via public APIs
> and can be copied; some can only be re-created by reference; some (private
> keys, secrets, internal state) cannot be exported at all. The official
> customer-facing recommendation is therefore to **stand up the destination
> zone in parallel, validate it, then cut traffic over** - not to "move" the
> zone atomically.

---

## Official Cloudflare migration process

Source: [developers.cloudflare.com/fundamentals/manage-domains/move-domain/](https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/).

### When to move a domain

- Manage multi-user organization with segmented domain access.
- "Cloudflare is already hosting under a different account" error.
- Lost access to email address or Cloudflare account.
- Registered with typo in email.

### Requirements

1. Access to the domain registrar.
2. At least one Cloudflare account associated with the domain.
3. For Cloudflare Registrar domains: manual transfer request required.

### Pre-transfer checklist (Cloudflare's official guidance)

1. **Remove DNSSEC configurations** - DNSSEC is account-specific.
2. **Cancel add-ons/subscriptions** - they don't transfer automatically.
3. **Export DNS records** - import into the new account to avoid 1000 errors.
4. **Copy settings manually** - if you have access to the previous account.
5. **SSL/TLS certificates** - must reissue in the new account.

### Transfer process (Full setup - authoritative DNS at Cloudflare)

1. Create/login to destination Cloudflare account.
2. Add domain (as if adding for the first time).
3. Update nameservers at the registrar to the new Cloudflare nameservers.
4. Re-check Dashboard → Overview.

### Zone lifecycle

| Status (zone) | Duration | Behavior |
|---------------|----------|----------|
| **Pending** (destination, pre-cutover) | Indefinite | Cannot proxy traffic; origin IPs exposed if they appear in DNS records |
| **Active** (destination, post NS change) | Indefinite | Full functionality |
| **Moved Away** (source, post NS change) | 7 days | Domain moved to new account; old account retains read-only view |
| **Deleted** (source, after Moved Away) | ~7 more days | Old zone being cleaned up |
| **Permanently Removed** | After Deleted | Cannot recover |

The 7-day "Moved" grace window is critical: **if the registrar NS change
isn't completed within 7 days of the activation flip, the source zone is
purged and the domain goes offline.**

### SSL/TLS certificate handling

- **Universal SSL** - automatically issued when zone goes Active.
- **Custom Certificates** - delete from old zone, upload to new zone.
- **Advanced Certificates (ACM)** - can order before transfer; deploys when
  zone activates.
- **Holding Deployment** - certificates uploaded while zone is Pending.

### Minimizing downtime

1. Order ACM cert before transfer.
2. Upload custom certs while zone is Pending.
3. Pre-configure DNS records before NS change.
4. Use short TTL on NS records at the registrar 24–48h before cutover.

### What cannot be automated

- Cloudflare Registrar domain transfers (manual request required).
- Nameserver changes at external registrars.
- Subscription cancellation on the source account.

---

## Full vs CNAME/Partial setup

The cutover step differs materially. **The source zone's setup type must
match the destination's** - you cannot migrate Full → CNAME without
re-onboarding.

### Full setup (authoritative DNS at Cloudflare)

1. Add the duplicate zone to the destination account.
2. Ensure all zone settings, DNS records, page rules, rulesets are correct
   on the new pending zone.
3. Update nameservers at the domain registrar to the destination's
   nameservers.
4. Cloudflare detects the NS change; new zone goes Active and old zone moves
   to Moved Away.
5. Both zones remain visible for ~7 days, after which the old zone is
   purged.

### CNAME/Partial setup (Cloudflare as secondary)

1. Confirm you can complete the move within **7 days** of marking the source
   as "Moved" (the activation grace window).
2. Open a Cloudflare support request to mark the source zone as "Moved"
   *(this internal flip is needed because of how CNAME-setup activation
   interacts with TXT records)*.
3. Create the duplicate zone in the destination account and request
   conversion to CNAME setup (requires support/CSM/SE unless the
   `allow cname setup` flag is enabled on the account).
4. Configure the new zone - DNS, page rules, SSL, all settings.
5. Activate by updating the activation TXT record at your authoritative DNS
   provider. **The new TXT must overwrite the old**; keeping both causes
   activation loops.
6. New CNAME zone becomes Active; old zone is purged within 7–14 days.

> **LTZ (Long-Tail Zone / subdomain support) caveat:** if the zone is a
> subdomain support zone, the customer may see downtime during the move.
> Coordinate with Cloudflare support before starting.

---

## Required entitlements

Both source and destination accounts need matching entitlements for products
the zone uses. Engage the Cloudflare account team to provision destination
subscriptions and feature flags **before** importing config.

### Plan & subscription matrix

For the 37 most common products, this table shows the minimum plan and where
the subscription lives (zone / account / add-on).

| Product | Min plan | Type | Notes |
|---|---|---|---|
| Access (Zero Trust) | Free (50 users) | Plan-included | Includes apps + policies |
| API Shield | Pro | Zone entitlement | Requires API Shield subscription |
| Argo Smart Routing | Any + add-on | Zone add-on | $5/mo + $0.10/GB (pay-go), contract-based ENT |
| Argo Tiered Caching | Free | Plan-included | All plans |
| Bot Management | Free (BFM) / Pro (SBFM) / Ent (full) | Plan + add-on | Bot Fight Mode free; Super BFM Pro+; full BM Enterprise + add-on |
| Cache Rules | Free | Plan-included | |
| CDN | Free | Plan-included | |
| Custom Certificates | Business | Plan-included | Business+ zone plan |
| Custom Hostnames | Free | Plan-included | 100 free; more is add-on |
| D1 | Free | Plan-included | |
| DDoS Protection | Free | Plan-included | Auto |
| DNS | Free | Plan-included | |
| Durable Objects | Free (with Workers) | Plan-included | Requires Workers Paid for production |
| Email Routing | Free | Plan-included | |
| Firewall Rules (legacy) | Free | Plan-included | Migrating to Rulesets |
| Cloudflare Images | Any + add-on | Account add-on | $5/mo base + per-100K stored/delivered |
| KV | Free | Plan-included | |
| Load Balancing | Any + add-on | Account add-on | $5/mo + $5/origin + $0.50/500K queries |
| Page Rules | Free (3 rules) | Plan-included | More with higher plans |
| Queues | Free | Plan-included | Requires Workers Paid for production |
| R2 | Free | Plan-included | |
| Rate Limiting | Pro (legacy) / Free (ruleset) | Plan-included | Advanced expressions need Enterprise |
| Rulesets | Free | Plan-included | |
| Spectrum | Pro (limited) / Ent (full) | Plan-included | Full Spectrum is Enterprise-only |
| SSL/TLS | Free | Plan-included | |
| Cloudflare Stream | Any + add-on | Account add-on | $5/mo + per-minute stored/delivered |
| Turnstile | Free | Plan-included | |
| WAF (managed) | Pro | Plan-included | Custom rules free; managed Pro+ |
| Waiting Rooms | Business (1 basic) / Ent (advanced) | Plan-included | 1 basic per BIZ/ENT; advanced is contract |
| Worker Custom Domains | Free | Plan-included | |
| Worker Routes | Free | Plan-included | |
| Workers | Free (100K/day) | Plan-included | Paid plan ($5/mo) recommended for production |
| Zaraz | Free | Plan-included | Needs dashboard config to activate |
| Zero Trust | Free (50 users) | Plan-included | |

### Entitlement gaps trigger acknowledgment (with the tool)

When the destination account is missing an entitlement, Twilight Zone surfaces
the affected resources as **acknowledged** in Step 2 before migration begins.
The user has two paths:

1. **Accept** - "I understand this feature isn't moving over." The migration
   skips those resources cleanly; they appear as acknowledged in the report.
2. **Fix and recheck** - "I'll talk to my account team and have them add the
   entitlement, then re-probe." Step 2 provides a recheck control so the user
   can re-run the capability probe without restarting the wizard.

See [ARCHITECTURE.md § Capability gates](ARCHITECTURE.md#capability-gates) for
how this is implemented.

### Cost summary

| Coverage tier | Estimated monthly | What it unblocks |
|---|---|---|
| **Minimum viable (~90% products)** | ~$45/mo | Source: Pro ($25), Argo ($5), Images ($5). Destination: Workers Paid ($5), Argo ($5). |
| **Full coverage (100% products)** | ~$280/mo | Source: Business ($250), Argo, Images, Stream, LB. Destination: matching plan + add-ons. |
| **Enterprise coverage** | Custom pricing | Custom cipher suites, gRPC, DDoS custom rules, log custom fields, TLS Client Auth, full Bot Management, API Shield Sequence Mitigation / JWT Validation. |

---

## Companion tools

| Tool | Purpose | When to use |
|---|---|---|
| **Twilight Zone (this tool)** | Account-to-account migration via web UI | Fast path when you have cross-account API tokens and Super Admin on both accounts |
| **Twilight Zone (export-only)** | JSON / Terraform snapshot | Discovery / cross-check - Step 2 surfaces resources `cf-terraforming` doesn't cover |
| [`cf-terraforming`](https://github.com/cloudflare/cf-terraforming) | Export existing zone/account config as Terraform HCL | First step for most manual migrations |
| [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) | Workers, KV, R2, D1, Queues, secrets, Pages | Required for Workers + storage data movement |
| Cloudflare REST API + `curl` / `jq` | Anything not covered by Terraform/wrangler | DNS bulk export, Email Routing, Logpush ownership challenges, Turnstile |
| `rclone` (S3 remote) or `wrangler r2 object` | R2 object data | Bucket-to-bucket copy across accounts |

---

## The three-phase model

Manual zone migration is best framed as three phases. **Phase 1 has no effect
on live traffic** - take as long as you need. Phase 2 is the actual cutover.
Phase 3 is monitoring and cleanup.

### Phase 1 - Preparation and export (no traffic impact)

1. Lower DNS TTLs on critical records to 300s **24–48 hours before** the
   planned cutover.
2. Confirm both accounts have the required entitlements. Enterprise
   customers should engage their account team to provision subscriptions on
   the destination *before* importing config.
3. Verify access:
   - Super Admin (or sufficient role) on both source and destination
     accounts.
   - Access to the domain registrar (for nameserver changes at cutover).
   - API tokens with the required scopes on both accounts (see
     [SECURITY.md](SECURITY.md)).
4. Clear pre-flight blockers (see [§ Pre-flight blockers](#pre-flight-blockers)).
5. Export source configuration with `cf-terraforming`, `wrangler`, and the
   API export endpoints (see [§ Tooling cheat sheet](#tooling-cheat-sheet)).
6. Add the zone to the destination account in **Pending** state. **Do not**
   change nameservers at the registrar yet.
7. Apply the exported config to the destination zone. Iterate until the
   destination configuration matches the source.

### Phase 2 - Cutover (minimal downtime)

1. Final review of the destination configuration against the source (this
   guide is the checklist).
2. Pre-issue SSL certificates on the destination while the zone is still
   **Pending** to minimize downtime.
3. **Full setup:** update nameservers at the registrar to the new
   Cloudflare nameservers shown on the destination zone's Overview page.
4. **CNAME/partial setup:** open a Cloudflare support request to mark the
   source zone as "Moved", then activate the destination zone's TXT record.
   The new TXT record **must overwrite** the old value - keeping both will
   cause activation loops.
5. Optionally flush public DNS caches
   ([Google DNS](https://dns.google/cache), [1.1.1.1](https://one.one.one.one/purge-cache/)).

### Phase 3 - Monitoring and cleanup

1. Monitor traffic, analytics, and logs on the destination zone for the
   duration of one full traffic cycle (typically 24–48 hours).
2. Re-enable DNSSEC on the destination and add the new DS record at the
   registrar.
3. Re-enable any subscriptions/add-ons that were cancelled in Phase 1.
4. After verification, delete the source zone (or let it auto-purge after
   the Moved-state grace window).

---

## Pre-flight blockers

Verify all of the following before beginning any Phase 1 work. Skipping any
of these is the most common cause of failed migrations.

### Zone-level

| # | Blocker | Severity | Detection | Resolution |
|---|---|---|---|---|
| 1 | Zone hold | error | `POST /zones` returns hold error | Contact domain owner or Cloudflare Support |
| 2 | Zone already exists in dest | warning | Lookup | Tool detects and migrates into existing zone |
| 3 | Domain not registered | error | `POST /zones` returns "not a registered domain" | Register the domain first |
| 4 | Pending zone deletion | error | `Zone is pending deletion` | Wait up to 24 hours |

### Account-level

| # | Blocker | Severity | Resolution |
|---|---|---|---|
| 5 | Insufficient source permissions | error | Token needs Zone:Read, DNS:Read, etc. |
| 6 | Insufficient destination permissions | error | Token needs Zone:Edit, DNS:Edit, etc. |
| 7 | Account suspended | error | Contact Cloudflare Support |
| 8 | Zone limit reached | error | Upgrade plan or delete unused zones |

### Plan-level

| # | Blocker | Resolution |
|---|---|---|
| 9 | Enterprise features on non-Enterprise destination | Upgrade destination or remove incompatible features (see [§ Required entitlements](#required-entitlements)) |
| 10 | Argo / Tiered Caching mismatch | Enable on destination account |

### DNS-level

| # | Blocker | Resolution |
|---|---|---|
| 11 | DNSSEC enabled | Disable DNSSEC on source, remove DS record at registrar, wait for TTL, migrate, re-enable on destination |
| 12 | Secondary DNS configured | Reconfigure secondary DNS after migration |

### Worker-level

| # | Blocker | Resolution |
|---|---|---|
| 13 | Workers with secrets | User must provide secret values manually (write-only, not exportable) |
| 14 | Workers with Durable Objects | Export/import DO data separately or accept data loss |
| 15 | Workers with KV Namespaces | Use `wrangler` to export/import KV data after the namespace is created |

### Third-party

| # | Blocker | Resolution |
|---|---|---|
| 16 | Cloudflare Registrar domain | Transfer domain registration first ([inter-account transfer](https://developers.cloudflare.com/registrar/account-options/inter-account-transfer/)) |
| 17 | Partner/reseller zone | Contact partner to coordinate migration |

### Pre-flight checklist

- [ ] Both accounts have the same entitlements for products this zone uses
- [ ] Both accounts have a Super Administrator on the user performing the
  migration
- [ ] Zone holds disabled on the source
- [ ] DNSSEC disabled on source and DS record removed at the registrar
- [ ] DS TTL has expired (wait for it)
- [ ] Add-ons / subscriptions cancelled on the source for things that will
  be re-subscribed on the destination
- [ ] TTLs lowered to 300s on critical DNS records, 24–48h before cutover
- [ ] API tokens created on both accounts with the required scopes
- [ ] Registrar access confirmed (you can change nameservers)
- [ ] Rollback plan documented

---

## 0. Migration context (fill in first)

| Field | Value |
|---|---|
| Source account name / ID | |
| Source zone name / ID | |
| Source setup type | Full / CNAME (partial) |
| Destination account name / ID | |
| Destination zone name / ID | |
| Domain registrar | |
| DNS TTL lowered to 300s? Date | |
| DNSSEC disabled? DS removed? Date | |
| Zone holds removed on source? | |
| Entitlement parity confirmed by account team? | |
| Source/dest API tokens provisioned? | |
| Twilight Zone used? (export-only / migrate / no) | |
| Cutover window scheduled | |
| Rollback plan documented? | |

---

## Per-resource migration & verification

### 1. Zone fundamentals

- [ ] Zone exists in destination account with the correct name
- [ ] Zone type matches (Full / Partial / CNAME)
- [ ] Zone status is acceptable (Active, or Pending pre-cutover)
- [ ] Zone plan matches expectation (Free / Pro / Business / Enterprise)
- [ ] All plan-gated features you depend on are available on the destination
  plan
- [ ] Nameservers assigned by Cloudflare are noted (for registrar cutover)
- [ ] DNSSEC: source had it disabled pre-cutover; destination has it
  re-enabled post-cutover with a fresh DS record at the registrar

### 2. DNS records

Lowest-friction path is BIND zone file export/import.

**Export from source:**

```bash
curl "https://api.cloudflare.com/client/v4/zones/$SOURCE_ZONE_ID/dns_records/export" \
  -H "Authorization: Bearer $SOURCE_TOKEN" \
  -o source-zone.bind
```

**Import to destination:**

```bash
curl "https://api.cloudflare.com/client/v4/zones/$DEST_ZONE_ID/dns_records/import" \
  -X POST \
  -H "Authorization: Bearer $DEST_TOKEN" \
  --form "file=@source-zone.bind"
```

> **Limits:** BIND file ≤ 256 KiB. Import endpoint rate-limited to **3 requests
> per minute per user**. Large zones may need to be split or imported via
> [`/batch`](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/batch/).

**Verification:**

- [ ] Total record count roughly matches source (minus intentional skips)
- [ ] Apex records (A / AAAA / CNAME at root) present and correct
- [ ] MX records and priorities match
- [ ] SPF / DKIM / DMARC TXT records match
- [ ] CAA records match
- [ ] SRV / HTTPS / SVCB records match (these use `data` blocks, not
  `content`)
- [ ] DS records match (only if you intentionally migrated DNSSEC config)
- [ ] Proxied vs DNS-only flags match for every record
- [ ] TTL values match where relevant
- [ ] No unintended duplicates (especially TXT validation records)
- [ ] FQDN name rewriting is correct (source zone name → destination zone
  name in record names if migrating between different domains)
- [ ] System-managed records were NOT migrated: `meta.read_only`,
  `meta.email_routing`, `meta.origin_worker_id`

**Spot checks:**

```bash
dig +short NS $DOMAIN
dig +short A $DOMAIN
dig +short A www.$DOMAIN
dig +short MX $DOMAIN
dig +short TXT _dmarc.$DOMAIN
dig +short TXT $DOMAIN  # SPF
```

> See [DNS records import/export](https://developers.cloudflare.com/dns/manage-dns-records/how-to/import-and-export/).

### 3. Zone settings

Use `cf-terraforming generate --resource-type cloudflare_zone_settings_override --zone $SOURCE_ZONE_ID`
and apply the resulting HCL to the destination. The full catalogue is in
[MAXCONFIG.md](MAXCONFIG.md).

**Settings that should match:**

- [ ] SSL/TLS mode (off / flexible / full / full_strict)
- [ ] Minimum TLS version
- [ ] TLS 1.3, 0-RTT
- [ ] HSTS (max-age, includeSubDomains, preload, nosniff)
- [ ] Always Use HTTPS, Automatic HTTPS Rewrites
- [ ] Opportunistic Encryption
- [ ] Brotli / gzip compression
- [ ] Browser Cache TTL, Caching Level
- [ ] Development Mode, Email Obfuscation, Hotlink Protection
- [ ] IP Geolocation, Mirage, Polish, Rocket Loader
- [ ] Security Level, Server Side Excludes
- [ ] Early Hints, HTTP/2, HTTP/3, WebSockets
- [ ] Pseudo IPv4

**Read-only settings (cannot be set via API):**

`advanced_ddos`, `plan_level`, `ssl_status`, `custom_certificate_quota`,
`page_rule_quota`, `cname_flattening`, `orange_to_orange`. These will appear
in exports but cannot be applied to the destination - Cloudflare manages them
server-side.

**Blocked from migration:**

`filter_logs_to_cloudflare`, `log_to_cloudflare` (internal),
`visitor_ip` (Enterprise-only, not user-configurable), `waf` (deprecated -
use rulesets).

**ACM-gated:** `ciphers` - if the destination lacks ACM, this setting will
silently fail to apply. Verify ACM is enabled on the destination if you use
custom cipher suites.

**Enterprise-plan-gated:** `orange_to_orange`, `prefetch_preload`,
`response_buffering`, `true_client_ip_header`. If the destination is not on
Enterprise, accept these will not apply.

### 4. Page rules

Use `cf-terraforming generate --resource-type cloudflare_page_rule --zone $SOURCE_ZONE_ID`.

- [ ] Page rule count matches source
- [ ] Each rule's target URL pattern matches
- [ ] Each rule's actions match (forwarding URL, cache level, SSL, etc.)
- [ ] Priority ordering matches (page rules are order-dependent)
- [ ] Enabled/disabled state matches
- [ ] No conflicts with rulesets that supersede page rules (Cloudflare is
  migrating customers off page rules - verify the destination doesn't
  already have an equivalent ruleset)

### 5. Rulesets (WAF / Transforms / Cache / Redirect)

Use `cf-terraforming generate --resource-type cloudflare_ruleset --zone $SOURCE_ZONE_ID`.
**Filter out managed rulesets** before applying - they're auto-provisioned on
the destination.

- [ ] Custom ruleset count matches source
- [ ] Managed rulesets are excluded (`kind: managed`, names containing
  "Cloudflare", "OWASP", or "DDoS")
- [ ] Each ruleset's phase is correct (see table below)
- [ ] Rules within each ruleset match (expressions, actions,
  `action_parameters`, enabled state, descriptions)
- [ ] If a rule references an **account-level custom ruleset** via
  `execute`, the referenced ruleset must exist on the destination account
  with a known ID, and the `execute` target must be rewritten to the
  destination ID

| Phase | Purpose |
|---|---|
| `http_request_firewall_custom` | WAF custom rules |
| `http_request_transform` | URL rewrite rules |
| `http_request_late_transform` | HTTP request header modification |
| `http_response_headers_transform` | HTTP response header modification |
| `http_request_cache_settings` | Cache rules |
| `http_request_dynamic_redirect` | Dynamic redirect rules |
| `http_config_settings` | Configuration rules |
| `http_request_origin` | Origin rules |
| `http_request_snippets` | Snippets |

**Account-level rulesets** (referenced via `execute` from zone rulesets)
must be migrated to the destination account first, then the zone rules'
execute targets rewritten. `cf-terraforming` can export them with
`--resource-type cloudflare_ruleset --account-id $ACCOUNT_ID`.

### 6. Firewall rules (legacy)

Use `cf-terraforming generate --resource-type cloudflare_filter` and
`--resource-type cloudflare_firewall_rule`. Filters are sub-resources of
firewall rules; migrate them together.

- [ ] Firewall rule count matches source
- [ ] Filter expressions match
- [ ] Actions match (block, challenge, js_challenge, allow, log, bypass)
- [ ] Paused/active state matches
- [ ] Priority ordering matches

> If the source already migrated to `http_request_firewall_custom` rulesets,
> skip this section.

### 7. Rate limiting rules

- [ ] Rate limit count matches
- [ ] Threshold, period, and action match
- [ ] Match criteria (URL patterns, methods, schemes) match
- [ ] Disabled state matches
- [ ] Bypass rules (if any) match

> **Plan note:** advanced rate limiting (custom expressions, complex
> thresholds) requires Enterprise. If downgrading, some rules will not
> apply.

### 8. Workers - scripts, routes, bindings, secrets

Workers cannot be exported via `cf-terraforming` alone - script content
lives behind a separate API. Use `wrangler` or the Workers REST API.

**Export from source:**

```bash
# List
curl "https://api.cloudflare.com/client/v4/accounts/$SOURCE_ACCOUNT_ID/workers/scripts" \
  -H "Authorization: Bearer $SOURCE_TOKEN" | jq .

# Script content
curl "https://api.cloudflare.com/client/v4/accounts/$SOURCE_ACCOUNT_ID/workers/scripts/$SCRIPT_NAME" \
  -H "Authorization: Bearer $SOURCE_TOKEN" \
  -o $SCRIPT_NAME.js

# Bindings
curl "https://api.cloudflare.com/client/v4/accounts/$SOURCE_ACCOUNT_ID/workers/scripts/$SCRIPT_NAME/settings" \
  -H "Authorization: Bearer $SOURCE_TOKEN" | jq .
```

**Upload to destination:** use `wrangler deploy` with a `wrangler.toml` that
references the destination account ID. **All storage bindings (KV, R2, D1,
Queues, DOs) must be created on the destination first** and the binding IDs
updated.

**Verification - scripts:**

- [ ] All expected worker scripts exist on destination
- [ ] ES Module workers detected and uploaded correctly (multipart with
  metadata)
- [ ] Service Worker format scripts uploaded correctly
- [ ] Script content matches source (spot-check)

**Verification - routes:**

- [ ] Route count matches source
- [ ] Route patterns rewritten if zone name changed
- [ ] Each route maps to the correct worker script
- [ ] Orphaned routes (script=null) were excluded
- [ ] Worker custom domains exist and map to correct worker/service/env

**Verification - bindings** (see [WORKER_BINDINGS.md](WORKER_BINDINGS.md) for
per-binding details):

- [ ] KV namespace bindings - `namespace_id` remapped
- [ ] R2 bucket bindings - bucket name correct
- [ ] D1 database bindings - `database_id` remapped
- [ ] Service bindings - referenced workers exist
- [ ] Queue bindings - queue name correct, queue exists
- [ ] Durable Object bindings - class name and script name correct
- [ ] Plain text / JSON bindings - values match
- [ ] Secret text bindings - values provided via `wrangler secret put`
- [ ] Analytics Engine bindings - AE enabled on destination
- [ ] Hyperdrive bindings - new Hyperdrive config created on destination,
  binding ID updated
- [ ] Vectorize bindings - index re-created on destination (same name)
- [ ] Browser Rendering bindings - Browser Rendering enabled on destination
- [ ] Workers AI bindings - Workers AI enabled on destination
- [ ] mTLS Certificate bindings - certificate re-uploaded on destination,
  `cert_id` updated
- [ ] Send Email bindings - destination address verified
- [ ] Static Assets bindings - re-bundled with worker upload
- [ ] Dispatch Namespace (Workers for Platforms) - namespace recreated,
  customer workers re-uploaded
- [ ] Pipeline bindings - Pipeline recreated, binding ID updated
- [ ] Workflow bindings - Workflow recreated
- [ ] Secrets Store bindings - store recreated, secrets re-added, binding
  store ID updated
- [ ] VPC Service bindings - VPC peering re-established, binding ID updated

**Secrets (always manual):**

```bash
wrangler secret put SECRET_NAME --name $SCRIPT_NAME --account-id $DEST_ACCOUNT_ID
# (paste secret value when prompted)
```

- [ ] All `secret_text` bindings have values set
- [ ] Secrets are set for the correct environment
- [ ] Service-binding chain (worker A → service B → service C) intact

**Runtime smoke tests:**

- [ ] Hit each worker route with a real request
- [ ] Check response status, headers, body
- [ ] Check Workers logs for runtime errors
- [ ] Verify KV/D1/R2/Queue operations succeed from worker context

### 9. KV namespaces and data

KV data must be copied key-by-key - there is no bulk transfer API across
accounts.

```bash
wrangler kv namespace create $TITLE --account-id $DEST_ACCOUNT_ID

# Bulk copy
wrangler kv key list --namespace-id $SOURCE_NS_ID --account-id $SOURCE_ACCOUNT_ID > keys.json
# (script the per-key get + put; reference implementation in src/migrate.ts)
```

- [ ] All expected namespaces exist on destination
- [ ] Namespace titles match
- [ ] Key count roughly matches for each namespace
- [ ] Spot-check representative keys and values (encoding, JSON validity,
  binary data)
- [ ] Large namespaces (100k+ keys) - verify pagination completed
- [ ] Worker KV bindings point to the **new destination namespace IDs**
- [ ] Per-key TTLs are preserved during data copy, but **absolute expiry
  timestamps reset** to the time of the copy

### 10. R2 buckets and data

```bash
wrangler r2 bucket create $BUCKET_NAME --account-id $DEST_ACCOUNT_ID

# Large buckets
rclone copy source-r2:$BUCKET_NAME dest-r2:$BUCKET_NAME --transfers 16 --checkers 32

# Small buckets
wrangler r2 object put $BUCKET_NAME/$KEY --file=$FILE --account-id $DEST_ACCOUNT_ID
```

- [ ] All expected buckets exist on destination
- [ ] Bucket names match
- [ ] Bucket location/region is acceptable
- [ ] Object count matches
- [ ] Spot-check critical objects (content, content-type, metadata, ETag)
- [ ] Large objects (multipart uploads) transferred correctly
- [ ] R2 CORS rules, lifecycle rules re-created on destination
- [ ] **R2 event notification subscriptions are NOT exported** - re-create
  via the Event Subscriptions API
- [ ] Worker R2 bindings point to correct bucket names

> See [R2 data migration](https://developers.cloudflare.com/r2/data-migration/).

### 11. D1 databases

```bash
wrangler d1 export $DB_NAME --account-id $SOURCE_ACCOUNT_ID --output schema.sql
wrangler d1 create $DB_NAME --account-id $DEST_ACCOUNT_ID
wrangler d1 execute $DB_NAME --account-id $DEST_ACCOUNT_ID --file schema.sql
```

- [ ] All expected databases exist on destination
- [ ] Database names match
- [ ] Data row counts match for critical tables
- [ ] Worker D1 bindings point to the **new destination database IDs**
- [ ] Migrations / versioning state is correct

> See [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

### 12. Queues

- [ ] All expected queues exist on destination
- [ ] Queue names match
- [ ] Consumer bindings (workers) configured correctly
- [ ] Producer bindings point to correct queue names
- [ ] Publish/consume roundtrip works
- [ ] Dead letter queue configuration matches
- [ ] Retry behavior matches
- [ ] **Messages in flight at migration time are lost** - drain queues
  before cutover if possible

### 13. Durable Objects

DO namespaces are created implicitly when the worker that defines them is
uploaded. DO **state** is not exportable via the Cloudflare API - it must be
migrated by application code.

- [ ] DO namespaces exist on destination (after worker upload)
- [ ] Worker DO bindings have correct `class_name` and `script_name`
- [ ] If you require state continuity: implement a "sandwich" worker pattern
  (Twilight Zone's `src/do-migrate.ts` is a reference implementation) or
  accept state loss
- [ ] Alarms / scheduled operations on DOs are working (if applicable)

### 14. Load Balancers, Pools, and Monitors

LB pools and monitors are **account-scoped**; load balancers are zone-scoped
but reference account-level pool IDs. Migrate in dependency order:
monitors → pools → load balancers, remapping IDs at each step.

**Monitors:**

- [ ] Monitor count matches
- [ ] Type, method, path, port, timeout, retries, interval match
- [ ] Expected codes and expected body match
- [ ] `follow_redirects` and `allow_insecure` match
- [ ] Monitor interval snapped to a valid value:
  `[60, 120, 300, 600, 900, 1800, 3600]`

**Pools:**

- [ ] Pool count matches
- [ ] Pool names match
- [ ] Origins (name, address, enabled, weight) match for each pool
- [ ] Monitor associations correct (monitor IDs remapped)
- [ ] Notification email matches
- [ ] Minimum origins setting matches

**Load Balancers:**

- [ ] LB count matches
- [ ] LB hostnames match
- [ ] Default pool references correct (pool IDs remapped)
- [ ] Fallback pool reference correct
- [ ] Steering policy matches
- [ ] Session affinity and TTL match
- [ ] Proxied flag matches
- [ ] LB rules match
- [ ] Health checks passing and traffic routes correctly

### 15. Spectrum apps

Enterprise-only.

- [ ] Spectrum app count matches
- [ ] Protocol settings match
- [ ] DNS configuration matches
- [ ] Origin DNS/port match
- [ ] TLS, proxy protocol, IP firewall settings match
- [ ] Edge IPs match

### 16. Custom SSL certificates

Private keys are **never** exportable from Cloudflare. You must re-upload
cert+key pairs from your own records.

```bash
curl "https://api.cloudflare.com/client/v4/zones/$DEST_ZONE_ID/custom_certificates" \
  -X POST \
  -H "Authorization: Bearer $DEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data @cert-payload.json
```

- [ ] Custom certificate count matches
- [ ] Host coverage (SANs) matches for each certificate
- [ ] Bundle method matches
- [ ] Certificates active/valid (not pending/expired)

**Authenticated Origin Pulls (AOP):** mTLS certificate bundles include
private keys that are not exportable. The zone-side hostname associations
migrate, but the underlying account-level certificate must be re-uploaded.

- [ ] Re-upload AOP certificate + private key at **Dashboard → SSL/TLS →
  Origin Server → Authenticated Origin Pulls**
- [ ] Recreate hostname associations on the destination zone

**Origin CA Certificates:** if used, regenerate on the destination (private
keys are generated client-side and never stored by Cloudflare).

**Keyless SSL:** if used, reconfigure key servers and re-register them with
the destination account.

### 17. Custom hostnames (Cloudflare for SaaS)

- [ ] Custom hostname count matches
- [ ] Hostnames match
- [ ] SSL method and type match
- [ ] **DCV re-validation completed** on destination for each hostname (the
  DCV token from the source zone is **not valid** on the destination)
- [ ] Custom origin server settings match (if used)
- [ ] Fallback origin is configured (if used)

### 18. Access applications and policies (Zero Trust)

Account-scoped - requires Zero Trust on the destination account.

**Apps:**

- [ ] Access app count matches
- [ ] App names, domains, types match
- [ ] Session duration matches
- [ ] Auto-redirect to identity setting matches
- [ ] Allowed IdPs reference valid IdPs on the destination account

**Policies:**

- [ ] Policy count per app matches
- [ ] Policy names, decisions, precedence match
- [ ] Include/exclude/require rules match
- [ ] Policy evaluation works end-to-end (test login flow)

**Things that don't migrate automatically:**

- [ ] **Identity Provider configurations** - OAuth/SAML client secrets and
  certificates are write-only. Re-create each IdP on the destination and
  re-paste secrets from your IdP's dashboard.
- [ ] **Access Service Tokens** - client secret is shown only once at
  creation. Re-create on destination and update API consumers.
- [ ] **mTLS Root Certificates** - re-upload root certificates to the
  destination Access account.
- [ ] **Gateway lists/rules** referenced by Access policies - recreate on
  destination.
- [ ] **Device posture rules** referenced by Access policies - recreate on
  destination.
- [ ] **Gateway CA** - pinned consumers must re-fetch from the destination
  tenant.
- [ ] **Access Custom Pages binary assets** - HTML migrates via API; binary
  uploads must be re-done out-of-band.

### 19. Email Routing

- [ ] Email routing enabled on destination zone
- [ ] Rule count matches
- [ ] Matchers (type, field, value) match for each rule
- [ ] Actions (type, destination addresses) match for each rule
- [ ] Priority ordering matches
- [ ] Enabled/disabled state matches
- [ ] Catch-all rule matches
- [ ] **Destination addresses verified on destination account** - each
  address must be re-verified by clicking the link in the verification
  email Cloudflare sends. Until verified, forwards will fail.

### 20. Waiting rooms

- [ ] Waiting room count matches
- [ ] Names, host, path match
- [ ] Limits match: `new_users_per_minute`, `total_active_users`,
  `session_duration`
- [ ] `queue_all` setting matches
- [ ] Custom page HTML exists (if used)
- [ ] Cookie settings match (suffix, attributes)
- [ ] Additional routes match
- [ ] Suspended state matches
- [ ] Template language matches

### 21. Turnstile widgets

Account-scoped.

- [ ] Widget count matches
- [ ] Widget names match
- [ ] Domains match
- [ ] Mode matches (managed, non-interactive, invisible)
- [ ] Region matches
- [ ] Bot Fight Mode setting matches
- [ ] **New sitekeys are generated** - frontend code MUST be updated
- [ ] **Secret keys never export** - copy them from the destination
  dashboard
- [ ] Challenge flow tested in production (success and failure paths)

### 22. Zaraz

- [ ] Zaraz config present on destination (if on source)
- [ ] Tools, Triggers, Variables, Consent settings, general settings match

> Singleton config (PUT, not POST). If Zaraz is not available on the
> destination, this section does not apply.

### 23. Argo Smart Routing & Tiered Caching

- [ ] Argo Smart Routing value matches (on/off)
- [ ] Tiered Caching value matches
- [ ] Argo entitlement exists on destination (Argo is an add-on)

### 24. Bot Management / Bot Fight Mode

- [ ] Bot management config matches source
- [ ] Fields: `fight_mode`, `sbfm_definitely_automated`,
  `sbfm_likely_automated`, `sbfm_verified_bots`,
  `sbfm_static_resource_protection`, `enable_js`, `suppress_session_score`,
  `optimize_wordpress`, `using_latest_model`, `auto_update_model`,
  `ai_bots_protection`
- [ ] Bot Management entitlement on destination matches source's tier

### 25. Logpush

Logpush jobs reference dataset entitlements and embed destination credentials
(S3 keys, Splunk HEC tokens, Datadog API keys) in `destination_conf`.

- [ ] Job count matches source
- [ ] Dataset selection valid on destination (Enterprise required for most
  datasets)
- [ ] Filter expressions match
- [ ] `destination_conf` updated with **destination-account credentials**
- [ ] **Ownership challenge completed** on destination for each job (write
  the challenge token to the destination endpoint, then POST it back to
  verify ownership)
- [ ] Buffered batches in flight at migration time are lost - accept this

### 26. Secondary DNS (Enterprise)

**Incoming (Cloudflare as secondary):**

- [ ] Reconfigure incoming zone transfers with the primary DNS provider on
  the destination account
- [ ] Re-issue TSIG keys, ACLs

**Outgoing (Cloudflare as primary):**

- [ ] Re-issue TSIG keys
- [ ] Re-add secondary nameservers to the destination zone's outgoing
  transfer ACL

### 27. Cloudflare Tunnel (cloudflared)

DNS records pointing at `*.cfargotunnel.com` depend on a Cloudflare Tunnel
on the source account. Tunnels cannot be moved between accounts.

- [ ] Create a new tunnel on the destination account
- [ ] Install/run `cloudflared` with the new tunnel token
- [ ] Update affected DNS records to point at
  `<new-tunnel-uuid>.cfargotunnel.com`

### 28. Cloudflare Pages

- [ ] Pages project metadata + build config + env vars exist on destination
  (re-created via API or `wrangler pages`)
- [ ] `wrangler pages deploy <dir> --project-name=<project>
  --account-id $DEST_ACCOUNT_ID` run for each project - deployment bundles
  are immutable per-deployment and not exportable

### 29. Notifications

- [ ] Notification policies recreated on destination (zone IDs in filter
  blocks remapped)
- [ ] Webhook destinations recreated with same name/URL/type
- [ ] **Webhook signing secrets re-pasted** at Dashboard → Notifications →
  Destinations → Webhooks
- [ ] PagerDuty integration reconnected (OAuth tokens don't transfer)

### 30. Worker custom domains

Distinct from worker routes. Account-scoped.

- [ ] Re-configure worker custom domains on destination via
  `GET /accounts/{id}/workers/domains`

### 31. AI Gateway / AI Search / Vectorize / Workflows / Pipelines / Hyperdrive

These products are account-scoped and require per-account state:

- [ ] **AI Gateway** - gateway config + custom providers re-created on
  destination
- [ ] **AI Gateway custom provider API keys** - re-added (write-only)
- [ ] **AI Gateway URLs hardcoded in worker code** - search workers for
  `<SOURCE_ACCOUNT_ID>` URL fragments and replace
- [ ] **AI Search** - instances re-created on destination
- [ ] **Vectorize** - indexes re-created on destination with same names
- [ ] **Workflows** - workflow definitions re-created on destination
- [ ] **Pipelines** - pipelines re-created on destination
- [ ] **Hyperdrive** - configs re-created on destination

---

## What cannot be migrated automatically

`src/types.ts` maintains an authoritative catalogue as
`IMPOSSIBLE_TO_MIGRATE`. For manual migrations, this is the master list of
things you must handle out-of-band.

### Cryptographic (secret material not exportable)

| Resource | Manual action |
|---|---|
| Worker Secrets | `wrangler secret put` per secret per worker |
| Access Service Tokens | Re-create on destination; update API consumers |
| Turnstile Widget Secret Keys | Copy from destination dashboard; update frontend |
| Custom Certificate Private Keys | Re-upload cert+key from your own records |
| Origin CA Certificate Private Keys | Regenerate Origin CA certs |
| Keyless SSL Private Keys | Reconfigure key servers, re-register with destination |
| Access Identity Provider Secrets | Re-paste secrets from IdP dashboard |
| Token Validation Private Keys | Re-upload signing keys if rotated since export |
| Logpush Destination Credentials | Rotate/re-issue per destination type |
| AI Gateway Custom Provider API Keys | Re-add at Dashboard → AI → AI Gateway → Custom Providers |
| Notification Webhook Signing Secrets | Re-paste at Dashboard → Notifications → Destinations → Webhooks |
| AOP mTLS Certificate Bundle | Re-upload cert + private key on destination account |
| Worker mTLS Certificate Bindings | Re-upload cert + key; update binding `cert_id` |
| Worker Secrets Store Bindings | Create store on destination; re-add secrets; update binding |
| Access Gateway CA | Pinned consumers must re-fetch from destination tenant |
| Account API Tokens | Re-issue with equivalent permissions |

### Account-tied (bound to source account/IP/contract)

| Resource | Manual action |
|---|---|
| Cloudflare Registrar | Use [Registrar inter-account transfer](https://developers.cloudflare.com/registrar/account-options/inter-account-transfer/) |
| BYOIP Prefixes | Submit new LoA for destination account |
| Aegis Dedicated Ingress IPs | Contact Cloudflare account team |
| Magic Transit / WAN / Firewall | Re-onboard with Cloudflare network engineering |
| China Network | Apply for China Network access on destination |
| Cloudflare for Government (FedRAMP) | Coordinate FedRAMP onboarding separately |
| Cloudflare Network Interconnect | Establish new interconnect on destination |
| Workers Hyperdrive | Create new Hyperdrive config; update worker binding |
| Workers VPC Service | Re-establish VPC peering; update binding |
| Workers Dispatch Namespace (Workers for Platforms) | Recreate namespace; re-upload customer workers |
| Workers Workflow | Re-create on destination |
| Workers Pipeline | Re-create on destination |
| Workers Browser Rendering | Enable on destination |
| Workers AI | Enable on destination |
| Workers Vectorize | Re-create index with same name |
| Workers Analytics Engine | Enable on destination (historical data does not transfer) |
| Account Logpush Datasets | Verify availability on destination (Enterprise) |
| Access mTLS Root Certificates | Re-upload to destination Access account |
| Account Custom Nameservers Pool | Recreate `ns_set` with same set ID; update registrar glue |
| WAF Content Upload Scanning | Enable on destination (App Sec Advanced bundle) |
| Smart Shield Cache Reserve | Subscribe to Smart Shield on destination |
| Account DNS Views (Enterprise) | Reconfigure DNS Views on destination |
| Event Subscriptions / Event Notifications | Recreate on destination |
| DLP Profiles | Recreate on destination |
| DNS Firewall Cluster Origin | Create new DNS Firewall cluster |
| Email Security (Area 1) MX Ingress | Configure Email Security on destination |
| R2 Catalog (Iceberg) | Recreate on destination |
| R2 Bucket Event Notifications | Re-create event subscriptions |
| AI Gateway URL References in Worker Code | Search for `<SOURCE_ACCOUNT_ID>` and replace |
| AI Search | Recreate instances |
| Cloudflare Tunnel Origin | Create new tunnel on destination; install cloudflared |
| Zero Trust Gateway Dependency | Recreate Gateway lists/rules referenced by Access policies |
| Notification PagerDuty OAuth | Reconnect PagerDuty on destination |
| Account Members / IAM | Re-invite members with appropriate roles |
| Device Posture | Recreate posture rules on destination |
| Workers KV per-key analytics | Internal counters reset on destination |

### Auto-managed (Cloudflare provisions automatically)

| Resource | Notes |
|---|---|
| Universal SSL Certificate Pack | Auto-issued when zone activates |
| Cloudflare Managed Rulesets | Only customer override rules migrate |
| DDoS L3/L4/L7 Managed Rules | Only customer overrides migrate |
| Smart Tiered Caching | Auto-enabled when Tiered Caching is on |
| SSL/TLS Recommender | Advisory; runs automatically |
| WAF Attack Score / ML Detection | Auto-enabled per plan tier |
| Backup Certificates | Auto-provisioned |
| Firewall Filters (legacy) | Sub-resources; created/destroyed with parent rules |
| Custom Hostname Aliases | Derived from `custom_hostnames` |
| Leaked Credential Detection | Auto-enabled with WAF managed rules |
| Worker Static Assets | Bundled with worker upload |

### Read-only (exposed but server-side immutable)

| Resource | Notes |
|---|---|
| CNAME Flattening | Automatic at apex; configurable only via Foundation DNS |
| Plan Level setting | Use subscription API, not settings endpoint |
| Orange-to-Orange | Controlled by Cloudflare for partner zones |
| Advanced DDoS setting | Managed by entitlement |
| Available Plans / Rate Plans | Account-level catalog |
| Zone Subscription ID | Billing-tied; regenerated when destination subscribes |
| Zone Hold | Account-level protection; doesn't copy |

### Data ephemeral (volatile / buffered)

| Resource | Notes |
|---|---|
| Cached Content | Rebuilds on first hit after migration |
| Web Analytics Historical Data | Account-scoped; not transferable |
| Security Events History | Retention-bound to source account |
| Audit Logs | Account-bound |
| Queue Messages In-flight | Cannot be replayed |
| DNS Analytics Historical Data | Account-bound retention window |
| Speed Test / Observatory Results | Reset on destination |
| RayID Lookup Data | Retention-bound to source |
| Security Center Findings | Derived continuously from destination traffic |

### Data offline (data exists but needs CLI/external tool)

| Resource | Tool |
|---|---|
| D1 Schema and Data | `wrangler d1 export/execute` |
| R2 Object Data | `rclone` or `wrangler r2 object` |
| Logpush Buffered Data | Not transferable; accept loss |
| Custom Error Pages HTML | Re-upload via dashboard or `cf_branding` API |
| Access Custom Page Binary Assets | Re-upload out-of-band |
| Pages Deployment Bundles | `wrangler pages deploy` per project |

### Manual external (requires action outside Cloudflare)

| Resource | Action |
|---|---|
| DNSSEC DS Record | Update at registrar after re-enabling DNSSEC on destination |
| Email Routing Destination Verifications | Click verification link in email |
| Nameserver Change at Registrar | Update at registrar to destination's new nameservers |
| Custom Hostname SSL Validation | Re-complete DCV per hostname |
| SSL for SaaS Verification | Re-issue and re-validate per hostname |
| Custom Nameservers Registrar Glue | Update glue records at registrar |
| Logpush Ownership Challenge | Write challenge token to destination endpoint |
| Advanced Certificate Pack DCV | Complete DCV per pack |
| Web3 Gateways | Re-claim slugs on destination |
| Secondary DNS (Incoming) | Coordinate with primary DNS provider |
| Secondary DNS (Outgoing) | Re-issue TSIG keys, ACLs |

---

## Tooling cheat sheet

```bash
# ─── cf-terraforming: export zone resources as Terraform HCL ─────
export CLOUDFLARE_API_TOKEN="$SOURCE_TOKEN"
export CLOUDFLARE_ZONE_ID="$SOURCE_ZONE_ID"
export CLOUDFLARE_ACCOUNT_ID="$SOURCE_ACCOUNT_ID"

cf-terraforming generate --resource-type cloudflare_dns_record               --zone $CLOUDFLARE_ZONE_ID > dns.tf
cf-terraforming generate --resource-type cloudflare_zone_settings_override   --zone $CLOUDFLARE_ZONE_ID > settings.tf
cf-terraforming generate --resource-type cloudflare_page_rule                --zone $CLOUDFLARE_ZONE_ID > page_rules.tf
cf-terraforming generate --resource-type cloudflare_ruleset                  --zone $CLOUDFLARE_ZONE_ID > rulesets.tf
cf-terraforming generate --resource-type cloudflare_load_balancer_pool       --account-id $CLOUDFLARE_ACCOUNT_ID > pools.tf
cf-terraforming generate --resource-type cloudflare_load_balancer_monitor    --account-id $CLOUDFLARE_ACCOUNT_ID > monitors.tf
cf-terraforming generate --resource-type cloudflare_load_balancer            --zone $CLOUDFLARE_ZONE_ID > lbs.tf
cf-terraforming generate --resource-type cloudflare_access_application       --account-id $CLOUDFLARE_ACCOUNT_ID > access.tf
# (full list: github.com/cloudflare/cf-terraforming#supported-resources)

# ─── DNS export/import via BIND ──────────────────────────────────
curl "https://api.cloudflare.com/client/v4/zones/$SOURCE_ZONE_ID/dns_records/export" \
  -H "Authorization: Bearer $SOURCE_TOKEN" -o source.bind
curl "https://api.cloudflare.com/client/v4/zones/$DEST_ZONE_ID/dns_records/import" \
  -X POST -H "Authorization: Bearer $DEST_TOKEN" --form "file=@source.bind"

# ─── Workers & storage ───────────────────────────────────────────
wrangler kv namespace create $TITLE                  --account-id $DEST_ACCOUNT_ID
wrangler r2 bucket create $BUCKET                    --account-id $DEST_ACCOUNT_ID
wrangler d1 create $DB                               --account-id $DEST_ACCOUNT_ID

wrangler d1 export $DB --account-id $SOURCE_ACCOUNT_ID --output schema.sql
wrangler d1 execute $DB --account-id $DEST_ACCOUNT_ID --file schema.sql

wrangler secret put $NAME --name $SCRIPT --account-id $DEST_ACCOUNT_ID

# ─── R2 bulk copy ────────────────────────────────────────────────
rclone copy source-r2:$BUCKET dest-r2:$BUCKET --transfers 16 --checkers 32

# ─── Twilight Zone in export-only mode (discovery aid) ───────────
# Open https://twilight-zone.ross.gg - Step 2 shows every
# resource the tool can see, even if you don't run the migrate step.
# Use as a cross-check against cf-terraforming output.
```

---

## Cutover smoke tests

Before declaring the migration complete:

- [ ] Origin server allowlists include Cloudflare IP ranges for the
  destination
- [ ] Origin certificates / mTLS / Authenticated Origin Pulls configured on
  destination
- [ ] Cache behavior correct (test representative URLs for cache status
  headers)
- [ ] Cache keys produce expected behavior (no cache pollution across zones)
- [ ] Redirects and rewrites do not cause loops
- [ ] API endpoints return expected responses with correct headers/cookies
- [ ] WebSocket connections work
- [ ] gRPC / streaming endpoints work
- [ ] Large file upload/download endpoints work
- [ ] Real User Monitoring / analytics collecting data
- [ ] Error pages (5xx, challenge pages) render correctly
- [ ] Rate limiting does not false-positive on legitimate traffic
- [ ] Bot management does not block legitimate bots (monitoring tools,
  search crawlers)
- [ ] DNSSEC re-enabled on destination, DS record added at registrar
- [ ] All Phase 1 cancelled subscriptions re-subscribed on destination
- [ ] Logging configured (Logpush, log retention)
- [ ] Analytics collecting data
- [ ] Alert and notification policies configured

---

## Post-migration checklist (after using Twilight Zone)

After the tool completes:

1. **Update nameservers** at the domain registrar (shown in results).
2. **Wait for DNS propagation** (typically 24–48 hours).
3. **Verify SSL certificate** is active in destination.
4. **Test critical paths**: worker routes, load balancer health checks.
5. **Monitor traffic** to ensure no 5xx errors.
6. **Rotate API keys** if Global API Key was used.
7. **Delete source zone** only after full verification.

---

## Edge cases

| Edge case | Detection | Handling |
|-----------|-----------|----------|
| Zone already exists in destination | API "zone already exists" | Find existing zone, continue into it; warning in log |
| Worker has secrets | Bindings include `secret_text` | Prompt in Step 3; otherwise added to manual actions |
| Custom cert without private key | Cert exists but key unreadable (always) | Prompt for cert+key paste; skip if not provided |
| Resource creation fails | Non-2xx response | Log + add to report; continue with remaining |
| Rate limited | 429 | Automatic retry with exponential backoff (3 retries) |
| Insufficient permissions | 403 | Log as failure; suggestion to check token permissions |

---

## Rollback plan

If something is wrong post-cutover, the fastest path back is reverting
nameservers at the registrar. **The source zone enters "Moved Away" state on
cutover and remains visible for ~7 days**, so it is recoverable during that
window.

- [ ] Document the source zone's original nameserver values **before**
  Phase 2.
- [ ] If rollback is needed: revert nameservers at the registrar to the
  source values.
- [ ] DNS propagation back to the source may take TTL-dependent time (this
  is why Phase 1 lowers TTLs).
- [ ] Re-enable DNSSEC at the source if you disabled it.
- [ ] If more than 7 days have passed: the source zone is purged. Recovery
  means re-onboarding the zone from scratch.

---

## Error patterns

Common error patterns when applying migrations (full catalogue in
[ARCHITECTURE.md § Error handling](ARCHITECTURE.md#error-handling)):

| Error pattern | Category | Action |
|---|---|---|
| `access.api.error.not_enabled` / `access is not enabled` | manual_setup | Enable Zero Trust on destination |
| `enable r2 through` / R2 `not enabled` | billing | Enable R2 on destination account |
| LB `1002` / `access failed` / `internal error` | billing | Enable Load Balancing add-on |
| `permission` / `forbidden` / `unauthorized` | permission | Check API token scopes |
| `not_entitled` / `upgrade your plan` | billing | Upgrade destination plan |
| `rate limit` / `too many requests` | api | Back off and retry; honor `retry-after` |
| `already exists` / `already taken` / `duplicate` | conflict | Resource already on destination |
| `certificate manager` | acm | Enable ACM on destination |

---

## Escalation

If the migration is large, business-critical, or involves products this
guide doesn't cover, consider engaging:

- A **Cloudflare Partner** with migration experience.
- **Cloudflare Quickstart** Professional Services for a guided
  implementation.
- For Enterprise customers: your **Customer Success Manager** and
  **Solutions Engineer**.

---

## Notes / evidence

| Item | Link / value |
|---|---|
| `cf-terraforming` export bundle | |
| Twilight Zone JSON export (if used) | |
| Generated Terraform file(s) | |
| Twilight Zone migration report (if used) | |
| Known acceptable diffs and why | |
| Rollback plan | |
| Post-cutover monitoring dashboard | |
| Registrar cutover instructions | |
| Account team / partner contacts | |

---

## References

### Public Cloudflare documentation

- [Move a domain between Cloudflare accounts](https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/)
- [Move a Cloudflare Registrar domain registration between accounts](https://developers.cloudflare.com/registrar/account-options/inter-account-transfer/)
- [DNS records import/export](https://developers.cloudflare.com/dns/manage-dns-records/how-to/import-and-export/)
- [DNS best practices - Phase 2: Preparation](https://developers.cloudflare.com/learning-paths/dns-best-practices/concepts/phase-2/)
- [Minimize downtime](https://developers.cloudflare.com/fundamentals/performance/minimize-downtime/)
- [Zone holds](https://developers.cloudflare.com/fundamentals/setup/account/account-security/zone-holds/)
- [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [R2 data migration](https://developers.cloudflare.com/r2/data-migration/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [`cf-terraforming` on GitHub](https://github.com/cloudflare/cf-terraforming)

### In-repo cross-references

- [ARCHITECTURE.md](ARCHITECTURE.md) - system design, dependency
  resolution, error handling, validation flow
- [SECURITY.md](SECURITY.md) - required API token scopes per operation
- [WORKER_BINDINGS.md](WORKER_BINDINGS.md) - every worker binding type and
  how it's handled
- [MAXCONFIG.md](MAXCONFIG.md) - full catalogue of zone settings and
  ruleset payloads
- [EXPORTS.md](EXPORTS.md) - export formats (JSON, Terraform, OpenAPI,
  troubleshooting)
- `src/types.ts` `IMPOSSIBLE_TO_MIGRATE` - authoritative codebase catalogue
  of resources that cannot be migrated automatically
