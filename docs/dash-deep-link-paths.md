# Cloudflare Dashboard Deep-Link Paths (verified)

Source of truth for `app/lib/dashLinks.ts`. These slugs were **scraped from
the dashboard's own navigation** (not guessed) on 2026-05-30 by driving an
authenticated `dash.cloudflare.com` session with Playwright and collecting
every `<a href>` under `/<account_id>/...` on a zone-overview page and the
account home. Item-level templates were captured by visiting each list page
and reading the per-row anchors.

Re-run the crawl with `scripts/dash-link-crawl.mjs` (see header there) when
the dashboard IA changes.

## URL form

The dashboard uses an **explicit account-id** URL - unambiguous when the
source and destination live in different accounts (the `?to=/:account/...`
redirect form resolves to whichever account is *currently selected*, which is
wrong for a cross-account migration tool):

- Zone-scoped:    `https://dash.cloudflare.com/<account_id>/<zone_name>/<section>`
- Account-scoped: `https://dash.cloudflare.com/<account_id>/<section>`

## Verified zone-scoped sections

| Resource group key (Step 2)    | Section slug                                  | Item-level template                                              |
|--------------------------------|-----------------------------------------------|------------------------------------------------------------------|
| `dnsRecords`                   | `dns/records`                                 | - (records page lists all; no per-record route)                  |
| `pageRules`                    | `rules/page-rules`                            | -                                                                |
| `rulesets`                     | `security/security-rules`                     | - (phase→subpage mapping not 1:1; section-level)                 |
| `firewallRules`                | `security/security-rules`                     | -                                                                |
| `rateLimits`                   | `security/security-rules/rate-limiting-rules` | `security/security-rules/rate-limiting-rules/<rule_id>`          |
| `zoneWorkers`, `workerRoutes`  | `workers`                                     | `workers/services/view/<script_name>/production` (zoneWorkers)   |
| `emailRules`                   | `email/routing`                               | -                                                                |
| `waitingRooms`                 | `traffic/waiting-rooms`                       | -                                                                |
| `customHostnames`              | `ssl-tls/custom-hostnames`                    | - (row expands inline; no detail route, verified 2026-05-30)     |
| `customCertificates`           | `ssl-tls/edge-certificates`                   | -                                                                |
| `originCaCertificates`         | `ssl-tls/origin`                              | -                                                                |
| `argoTieredCaching`            | `caching/tiered-cache`                        | -                                                                |
| `spectrumApps`                 | `spectrum`                                    | - (zone-scoped in dash despite account-scoped export)            |
| `accessApps`                   | `access`                                      | - (zone Access page)                                             |

## Verified account-scoped sections

| Resource group key (Step 2)         | Section slug              | Item-level template                                     |
|-------------------------------------|---------------------------|---------------------------------------------------------|
| `workers`                           | `workers-and-pages`       | `workers/services/view/<script_name>/production`        |
| `pagesProjects`                     | `workers-and-pages`       | -                                                       |
| `loadBalancers`, `pools`, `monitors`| `load-balancing`          | -                                                       |
| `queues`                            | `workers/queues`          | `workers/queues/<queue_id>`                             |
| `d1Databases`                       | `workers/d1`              | `workers/d1/databases/<uuid>`                           |
| `durableObjects`                    | `workers/durable-objects` | -                                                       |
| `kvNamespaces`                      | `workers/kv/namespaces`   | `workers/kv/namespaces/<namespace_id>`                  |
| `r2Buckets`                         | `r2/overview`             | `r2/default/buckets/<bucket_name>`                      |
| `turnstileWidgets`                  | `turnstile`               | -                                                       |
| `aiGateways`, `aiGatewayCustomProviders` | `ai/ai-gateway`      | -                                                       |
| `zaraz`                             | `tag-management/zaraz`    | - (account-scoped in dash despite zone-scoped export)   |

## Deliberately section-level / overview (no verified feature-exact slug)

To honour "verify, don't guess", these fall back to the **zone overview**
(`https://dash.cloudflare.com/<account_id>/<zone_name>`) rather than a guessed
subpage:

- `settings` (Zone Settings span many pages)
- `argoSmartRouting` (Argo lives under Traffic; no single verified slug)
- `botManagement` (no `security/bots` slug observed in nav)

## Full captured slug inventory

Zone nav (64 slugs) and account nav (116 slugs) are preserved in the crawl
output. Notable ones not yet mapped to a Step 2 group (future work): `web3`,
`versioning`, `analytics/*`, `speed/*`, `dns/settings`, `dns/analytics`,
`caching/cache-rules`, `rules/snippets`, `rules/cloud-connector`,
`security/settings`, `secrets-store`, `pipelines/*`, `tunnels`.
