/**
 * Cloudflare dashboard deep-link builder.
 *
 * Maps a Step 2 resource group key (+ optional item) to a canonical
 * `dash.cloudflare.com` URL so users can open any element we reference in the
 * source zone - and any migrated element on the destination - straight in the
 * dashboard to eyeball it.
 *
 * The section slugs and item-level templates here are NOT hand-guessed: they
 * were scraped from the dashboard's own navigation (see
 * docs/dash-deep-link-paths.md and scripts/dash-link-crawl.mjs). Where the
 * dashboard has no verified feature-exact slug, the group falls back to the
 * zone/account overview rather than a guessed subpage - a valid, never-broken
 * link, per the "verify, don't guess" rule.
 *
 * URL form is the explicit account-id path
 * (`/<account_id>/<zone_name>/<section>`) rather than the `?to=/:account/...`
 * redirect, because the redirect resolves to whichever account is *currently
 * selected* in the dash - wrong for a cross-account migration tool where the
 * source and destination are different accounts.
 */

const DASH_BASE = 'https://dash.cloudflare.com';

export interface DashLinkCtx {
  /** Account that owns the resource (source account for Step 2, dest for Step 4). */
  accountId?: string | null;
  /** Zone name (e.g. "example.com"). Required for zone-scoped links. */
  zoneName?: string | null;
}

export interface DashLinkItem {
  id?: string;
  raw?: unknown;
}

type DashScope = 'zone' | 'account';

interface DashSection {
  /** Dashboard scope of the SECTION - independent of the export scope of the
   * group. e.g. Zaraz is exported per-zone but lives at an account-level dash
   * route; Spectrum/Access are the reverse. */
  scope: DashScope;
  /** Path under the base. '' means the zone/account overview. */
  section: string;
  /** Optional item-level path (relative to the account, no leading slash).
   * Return null to fall back to `section`. */
  item?: (item: DashLinkItem) => string | null;
}

const enc = encodeURIComponent;

/**
 * Group key → verified dashboard section. Keys match
 * app/components/steps/scope/groups.ts. See docs/dash-deep-link-paths.md.
 */
const GROUP_DASH: Record<string, DashSection> = {
  // ── Zone-scoped ─────────────────────────────────────────────
  dnsRecords: { scope: 'zone', section: 'dns/records' },
  pageRules: { scope: 'zone', section: 'rules/page-rules' },
  rulesets: { scope: 'zone', section: 'security/security-rules' },
  firewallRules: { scope: 'zone', section: 'security/security-rules' },
  rateLimits: {
    scope: 'zone',
    section: 'security/security-rules/rate-limiting-rules',
    item: ({ id }) => (id ? `security/security-rules/rate-limiting-rules/${enc(id)}` : null),
  },
  zoneWorkers: {
    scope: 'zone',
    section: 'workers',
    item: ({ id }) => (id ? `workers/services/view/${enc(id)}/production` : null),
  },
  workerRoutes: { scope: 'zone', section: 'workers' },
  emailRules: { scope: 'zone', section: 'email/routing' },
  waitingRooms: { scope: 'zone', section: 'traffic/waiting-rooms' },
  customHostnames: { scope: 'zone', section: 'ssl-tls/custom-hostnames' },
  customCertificates: { scope: 'zone', section: 'ssl-tls/edge-certificates' },
  originCaCertificates: { scope: 'zone', section: 'ssl-tls/origin' },
  argoTieredCaching: { scope: 'zone', section: 'caching/tiered-cache' },
  spectrumApps: { scope: 'zone', section: 'spectrum' },
  accessApps: { scope: 'zone', section: 'access' },

  // Verified slug exists but not feature-exact → zone overview fallback.
  settings: { scope: 'zone', section: '' },
  argoSmartRouting: { scope: 'zone', section: '' },
  botManagement: { scope: 'zone', section: '' },

  // ── Account-scoped ──────────────────────────────────────────
  workers: {
    scope: 'account',
    section: 'workers-and-pages',
    item: ({ id }) => (id ? `workers/services/view/${enc(id)}/production` : null),
  },
  pagesProjects: { scope: 'account', section: 'workers-and-pages' },
  loadBalancers: { scope: 'account', section: 'load-balancing' },
  pools: { scope: 'account', section: 'load-balancing' },
  monitors: { scope: 'account', section: 'load-balancing' },
  queues: {
    scope: 'account',
    section: 'workers/queues',
    item: ({ id }) => (id ? `workers/queues/${enc(id)}` : null),
  },
  d1Databases: {
    scope: 'account',
    section: 'workers/d1',
    item: ({ id }) => (id ? `workers/d1/databases/${enc(id)}` : null),
  },
  durableObjects: { scope: 'account', section: 'workers/durable-objects' },
  kvNamespaces: {
    scope: 'account',
    section: 'workers/kv/namespaces',
    item: ({ id }) => (id ? `workers/kv/namespaces/${enc(id)}` : null),
  },
  r2Buckets: {
    scope: 'account',
    section: 'r2/overview',
    item: ({ id }) => (id ? `r2/default/buckets/${enc(id)}` : null),
  },
  turnstileWidgets: { scope: 'account', section: 'turnstile' },
  aiGateways: { scope: 'account', section: 'ai/ai-gateway' },
  aiGatewayCustomProviders: { scope: 'account', section: 'ai/ai-gateway' },
  zaraz: { scope: 'account', section: 'tag-management/zaraz' },
};

/** True when we have a dashboard mapping for this group key. */
export function hasDashLink(groupKey: string): boolean {
  return groupKey in GROUP_DASH;
}

/**
 * Build a dashboard URL for a resource group (optionally a specific item).
 * Returns null when the group is unmapped, or when required context (account
 * id, or zone name for zone-scoped sections) is missing - callers should
 * simply not render a link in that case.
 */
export function buildDashLink(
  groupKey: string,
  item: DashLinkItem | null,
  ctx: DashLinkCtx,
): string | null {
  const def = GROUP_DASH[groupKey];
  if (!def) return null;
  if (!ctx.accountId) return null;
  if (def.scope === 'zone' && !ctx.zoneName) return null;

  let path = def.section;
  if (def.item && item) {
    const itemPath = def.item(item);
    if (itemPath) path = itemPath;
  }

  const prefix =
    def.scope === 'zone'
      ? `${DASH_BASE}/${ctx.accountId}/${ctx.zoneName}`
      : `${DASH_BASE}/${ctx.accountId}`;

  return path ? `${prefix}/${path}` : prefix;
}
