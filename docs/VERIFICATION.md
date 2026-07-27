# Migration verification

How a Twilight Zone migration is verified — automatically by the tool and its
E2E suite, and manually via the "trust but verify" checklist below.

## Automated zone-settings verification (E2E)

The omnibus E2E test (`e01-everything`, run via
`node scripts/run-playwright-migrations.mjs --only 1`) does more than trust the
tool's own GET-back. After migrating a maximally-configured zone to a separate
account, it **independently** re-reads the destination's settings and
byte-compares them to the source, across all three shapes the Cloudflare API
uses to expose settings:

| Assertion | Covers | How |
|-----------|--------|-----|
| `assertZoneSettingsMatch` | Aggregate editable settings (`GET /zones/{id}/settings`) | source→dest value compare of every `editable`, non-read-only, non-blocked setting |
| `assertDedicatedSettingsMatch` | Object subsystems: DNS settings, Origin mTLS, Fraud Detection, Schema Validation | per-field compare of the exact fields the engine writes |
| `assertDedicatedScalarSettingsMatch` | Dedicated-endpoint scalar settings the aggregate omits (speed_brain, fonts, csam_scanner, origin_h2_max_streams, …) | per-id `GET /settings/<id>` compare, excluding non-editable |

All three are acknowledgment-aware (a difference the migration report flags as a
plan/entitlement gap is allowed, per Principle 2) and **fail on empty evidence**
(an assertion that read nothing cannot prove anything). Each was validated with
positive, negative (injected drift), and empty-evidence controls.

**The one-sentence claim you can make:** *"Our omnibus end-to-end test migrates a
maximally-configured zone to a separate account, then — independently of the
migration engine — reads back every zone setting on the destination (aggregate,
dedicated subsystems, and dedicated-endpoint scalars) and byte-compares it to the
source, failing on any unacknowledged difference."*

**Completeness questions this lets you answer:**
- *All settings, or just seeded ones?* All `editable` settings present on the
  source, not just the test's seeds.
- *What's excluded, and is that defensible?* Read-only (`plan_level`,
  `cname_flattening`, …), blocked/deprecated, and no-op settings — server-side
  immutable or non-migratable by design.
- *Settings the aggregate API hides?* Covered by the dedicated-subsystem and
  dedicated-scalar assertions.
- *Plan downgrade (Enterprise→lower)?* Exercised by `e07-plan-downgrade`, which
  self-provisions an Enterprise source (idempotent `ensureSourceEnterprise`
  preRun) so enterprise-only features (gRPC, ciphers, SBFM, plan-gated settings
  like `origin_h2_max_streams`, …) land as **acknowledged**, not failed. Live
  `e07`: 7 enterprise features acknowledged, all settings verified, test green.

> **Fixed while building this (2026-06-07):** the migration report used to
> suppress the per-item table for any section with >50 items, so Zone Settings
> (57+ items) showed only summary counts — hiding per-setting status, including
> 🟡 acknowledged plan-gated rows like `origin_h2_max_streams`. This briefly
> looked like a migration gap; it was a report-rendering bug (verified before
> fixing). The cap is removed (table always renders, collapsed), so the report
> now shows every setting's status. See [CHANGELOG.md](CHANGELOG.md).

## Manual verification checklist

A post-migration checklist for verifying the most common resource types
Twilight Zone (or any other migration approach) moves between Cloudflare
accounts. Work through each section after the migration completes — if you
used Twilight Zone, the **Results** step already verifies most of these
automatically (via GET-back), so treat this as the manual "trust but verify"
pass.

> **Not exhaustive.** Twilight Zone migrates 65+ feature areas; this checklist
> covers the high-traffic ones. Newer types it also migrates — Snippets, Cloud
> Connector, Managed Transforms, URL Normalization, Page Shield, API Shield,
> Leaked-Credential Checks, Content Upload Scan, Cache Reserve / Tiered Cache,
> Health Checks, Hyperdrive, Secrets Store, Vectorize, Workers Observability,
> Web3 hostnames, Secondary DNS, Email Sending Subdomains, Pages projects, AI
> Gateway, Origin CA certs, Custom Lists, Access sub-resources (groups, service
> tokens, IdPs, tags, bookmarks, custom pages), Authenticated Origin Pulls,
> Notification policies, Logpush jobs, and more — are not individually listed
> here. See [COVERAGE.md](COVERAGE.md) for the authoritative per-endpoint
> matrix.

### 1. Zone Fundamentals
- [ ] Zone exists in destination account with the correct name
- [ ] Zone type matches (full / partial / CNAME setup)
- [ ] Zone status is acceptable (active / pending)
- [ ] Zone plan matches expectation (Free / Pro / Business / Enterprise)
- [ ] All plan-gated features available on destination plan
- [ ] Nameservers noted for registrar cutover
- [ ] DNSSEC status matches

### 2. DNS Records
- [ ] Record count roughly matches source
- [ ] Apex records (A/AAAA/CNAME at root) correct
- [ ] MX records and priorities match
- [ ] SPF/DKIM/DMARC TXT records match
- [ ] CAA records match
- [ ] SRV/HTTPS/SVCB records match
- [ ] Proxied vs DNS-only flags match
- [ ] TTL values match
- [ ] No unintended duplicates
- [ ] FQDN name rewriting correct
- [ ] System-managed records excluded

### 3. Zone Settings
- [ ] SSL/TLS mode matches
- [ ] Minimum TLS version matches
- [ ] TLS 1.3 / 0-RTT matches
- [ ] HSTS settings match
- [ ] Always Use HTTPS matches
- [ ] Automatic HTTPS Rewrites matches
- [ ] Compression (Brotli/gzip) matches
- [ ] Browser Cache TTL matches
- [ ] Caching Level matches
- [ ] Security Level matches
- [ ] Early Hints / HTTP2 / HTTP3 match
- [ ] WebSockets matches
- [ ] Custom cipher suites + ACM verified
- [ ] Enterprise settings (orange_to_orange, etc.) checked

### 4. Page Rules
- [ ] Page rule count matches
- [ ] Target URL patterns match
- [ ] Actions match
- [ ] Priority ordering matches
- [ ] Enabled/disabled state matches

### 5. Rulesets
- [ ] Custom ruleset count matches
- [ ] Managed rulesets excluded
- [ ] Each ruleset phase is correct
- [ ] Rules match (expressions, actions, parameters)
- [ ] Rules deduplicated correctly
- [ ] Phase entrypoint merging verified

### 6. Firewall Rules
- [ ] Rule count matches
- [ ] Filter expressions match
- [ ] Actions match
- [ ] Paused/active state matches
- [ ] Priority ordering matches

### 7. Rate Limits
- [ ] Rate limit count matches
- [ ] Threshold, period, and action match
- [ ] Match criteria match
- [ ] Disabled state matches

### 8. Workers
- [ ] All worker scripts exist
- [ ] ES Module / Service Worker format correct
- [ ] Script content matches (spot-check)
- [ ] Route count and patterns match
- [ ] KV bindings remapped correctly
- [ ] R2 bindings correct
- [ ] D1 bindings remapped correctly
- [ ] Service bindings present
- [ ] Queue bindings correct
- [ ] DO bindings correct
- [ ] Secret text bindings set
- [ ] Analytics Engine bindings handled
- [ ] Service binding dependency chain complete
- [ ] Runtime smoke tests pass

### 9. KV Namespaces
- [ ] All namespaces exist
- [ ] Titles match
- [ ] Key counts roughly match
- [ ] Spot-check keys/values
- [ ] Worker bindings point to NEW namespace IDs
- [ ] Expiration TTLs acknowledged as lost

### 10. R2 Buckets
- [ ] All buckets exist
- [ ] Names match
- [ ] Data copied (if S3 credentials provided)
- [ ] Worker R2 bindings correct
- [ ] CORS / lifecycle / managed-domain / custom-domain rules migrated (automatic)

### 11. D1 Databases
- [ ] All databases exist
- [ ] Names match
- [ ] Schema manually applied
- [ ] Data row counts match
- [ ] Worker D1 bindings point to NEW database IDs

### 12. Queues
- [ ] All queues exist
- [ ] Names match
- [ ] Consumer/producer bindings correct
- [ ] Publish/consume roundtrip works
- [ ] DLQ / retry config matches

### 13. Durable Objects
- [ ] DO namespaces exist
- [ ] Worker DO bindings correct
- [ ] DO data migrated (if applicable)
- [ ] Alarms/scheduled operations working

### 14. Load Balancers
- [ ] Monitor count, settings, and intervals match
- [ ] Pool count, origins, and monitor refs match
- [ ] LB count, hostnames, and pool refs match
- [ ] Steering policy and session affinity match
- [ ] Health checks passing

### 15. Spectrum Apps
- [ ] App count matches
- [ ] Protocol and DNS config match
- [ ] Origin DNS/port match

### 16. Custom SSL Certificates
- [ ] Certificate count matches
- [ ] Host coverage (SANs) matches
- [ ] Private keys provided and certs active
- [ ] Bundle method matches

### 17. Custom Hostnames
- [ ] Hostname count matches
- [ ] SSL method/type/status match
- [ ] Custom origin server settings match

### 18. Access (Zero Trust)
- [ ] Access app count and settings match
- [ ] Policy count, decisions, and rules match
- [ ] IdP references valid on destination
- [ ] End-to-end auth flow works

### 19. Email Routing
- [ ] Email routing enabled
- [ ] Rule count and matchers match
- [ ] Actions and priorities match
- [ ] Catch-all rule matches
- [ ] Destination addresses verified

### 20. Waiting Rooms
- [ ] Room count and names match
- [ ] Host/path match
- [ ] Limits match
- [ ] Custom page HTML present

### 21. Turnstile
- [ ] Widget count and names match
- [ ] Domains and mode match
- [ ] NEW sitekeys updated in frontend code
- [ ] Challenge flow verified

### 22. Zaraz
- [ ] Config present on destination
- [ ] Tools/triggers/variables match

### 23. Argo Smart Routing
- [ ] Value matches (on/off)
- [ ] Entitlement exists on destination

### 24. Argo Tiered Caching
- [ ] Value matches

### 25. Bot Management
- [ ] Config matches source
- [ ] All fields checked
- [ ] Plan availability confirmed

### 26. Worker Custom Domains
- [ ] Manually configured on destination

### 27. Never-Migrate Items
- [ ] Billing/subscriptions handled
- [ ] API tokens created separately
- [ ] Account-level (org-wide) settings configured
- [ ] Analytics / log *retention* windows and buffered Logpush batches (the Logpush **jobs** themselves DO migrate; only buffered/historical data is lost)
- [ ] Tunnel (cloudflared) configurations set up
- [ ] Dashboard/SSO IdPs for account login (note: **Access** IdPs DO migrate — see §18 — with re-supplied secrets)

> Note: **Notification policies**, **Logpush jobs**, and **Access IdPs** are NOT
> never-migrate items — Twilight Zone migrates them. Verify them where their
> data lives (notification policies + webhooks on the dest account; Logpush jobs
> per zone; Access IdPs in §18).

### 28. Conflict Strategy
- [ ] Skip/Overwrite behavior verified for all resource types

### 29. Dependency Chain
- [ ] No resources failed due to missing dependencies

### 30. ID Remapping
- [ ] KV namespace IDs remapped
- [ ] D1 database IDs remapped
- [ ] LB monitor IDs remapped
- [ ] LB pool IDs remapped
- [ ] Access app IDs remapped

### 31. Observability
- [ ] Logging configured
- [ ] Analytics collecting
- [ ] Alert policies configured
- [ ] Audit log reviewed
- [ ] Rollback plan documented
- [ ] Monitoring dashboards ready

### 32. Final Cutover
- [ ] Origin allowlists updated
- [ ] Origin certs / mTLS configured
- [ ] Cache behavior verified
- [ ] Redirects/rewrites no loops
- [ ] API endpoints working
- [ ] WebSocket/gRPC/streaming verified
- [ ] Error pages render correctly
- [ ] Rate limiting / bot management not false-positive
- [ ] Update nameservers at your domain registrar
- [ ] Wait for DNS propagation (`dig NS yourdomain.com`)
- [ ] Delete source zone only after full verification
