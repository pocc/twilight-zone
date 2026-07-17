// Per-resource-type "curated detail" formatters for the Step 2 Scope view.
//
// AGENTS.md Principle 8 (Scope Must Be Auditable): an admin must be able to
// verify what's migrating by reading the page — not name-only rows, not
// truncated chips, not a raw-JSON dump as the only option. Each formatter
// reads the source API object (`item.raw`) and emits the curated fields that
// define that resource (e.g. DNS: type · name · content · TTL · proxied).
//
// Types without a curated formatter fall back to `genericFields`, which
// surfaces the object's top-level scalar fields — so nothing renders as
// name-only. Keyed on `group.key` (see buildGroups in ./groups.ts).
//
// Pure + dependency-free, so it's unit-testable without React/DOM.

export type DetailField = {
  label: string;
  value: string;
  /** When true the value is rendered in a monospace style (ids, expressions). */
  mono?: boolean;
};

type Raw = Record<string, unknown>;

/** Coerce an unknown to a short display string; '' when not presentable. */
function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Build a field list, dropping empty/falsy entries. Accepts strings (e.g.
 * the `'' ` produced by `str(x) && {...}` guards) and filters them out, so
 * formatters can guard fields with `str(x) && { ... }` without a type error. */
function fields(...entries: (DetailField | string | null | undefined | false)[]): DetailField[] {
  return entries.filter(
    (e): e is DetailField => typeof e === 'object' && e !== null && e.value !== '',
  );
}

const yesNo = (v: unknown): string => (v ? 'Yes' : 'No');
const ttl = (v: unknown): string => (v === 1 || v === '1' ? 'Auto' : str(v));
const date = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 10) : '');

// ── Curated per-type formatters ──────────────────────────────────────────

function fmtDns(r: Raw): DetailField[] {
  return fields(
    { label: 'Type', value: str(r.type), mono: true },
    { label: 'Name', value: str(r.name), mono: true },
    { label: 'Content', value: str(r.content), mono: true },
    r.priority != null && { label: 'Priority', value: str(r.priority) },
    { label: 'TTL', value: ttl(r.ttl) },
    { label: 'Proxied', value: yesNo(r.proxied) },
    str(r.comment) && { label: 'Comment', value: str(r.comment) },
  );
}

function fmtSetting(r: Raw): DetailField[] {
  // Zone settings store the value as anything (string/number/bool/array/obj).
  const v = r.value;
  let value: string;
  if (v == null) value = '';
  else if (typeof v === 'object') value = JSON.stringify(v);
  else value = String(v);
  return fields({ label: str(r.id) || 'value', value, mono: true });
}

function fmtRuleset(r: Raw): DetailField[] {
  const rules = Array.isArray(r.rules) ? (r.rules as Raw[]) : [];
  const base = fields(
    { label: 'Phase', value: str(r.phase), mono: true },
    { label: 'Rules', value: String(rules.length) },
  );
  // Inline each rule's expression + action so the page shows the real logic,
  // not just a count.
  rules.forEach((rule, i) => {
    const action = str(rule.action);
    const expr = str(rule.expression);
    const desc = str(rule.description);
    const value = [expr, action ? `→ ${action}` : '', desc ? `(${desc})` : '']
      .filter(Boolean)
      .join('  ');
    if (value) base.push({ label: `Rule ${i + 1}`, value, mono: true });
  });
  return base;
}

function fmtPageRule(r: Raw): DetailField[] {
  const targets = Array.isArray(r.targets) ? (r.targets as Raw[]) : [];
  const target = targets
    .map((t) => str((t.constraint as Raw | undefined)?.value))
    .filter(Boolean)
    .join(', ');
  const actions = Array.isArray(r.actions) ? (r.actions as Raw[]) : [];
  const actionStr = actions
    .map((a) => {
      const id = str(a.id);
      const val = a.value;
      if (val == null) return id;
      if (typeof val === 'object') return id;
      return `${id}=${String(val)}`;
    })
    .filter(Boolean)
    .join(', ');
  return fields(
    { label: 'Target', value: target, mono: true },
    { label: 'Actions', value: actionStr, mono: true },
    r.priority != null && { label: 'Priority', value: str(r.priority) },
    { label: 'Status', value: str(r.status) },
  );
}

function fmtFirewallRule(r: Raw): DetailField[] {
  const filter = r.filter as Raw | undefined;
  return fields(
    str(r.description) && { label: 'Description', value: str(r.description) },
    { label: 'Expression', value: str(filter?.expression), mono: true },
    { label: 'Action', value: str(r.action) },
    r.paused != null && { label: 'Paused', value: yesNo(r.paused) },
  );
}

function fmtRateLimit(r: Raw): DetailField[] {
  const match = r.match as Raw | undefined;
  const url = str((match?.request as Raw | undefined)?.url);
  const action = (r.action as Raw | undefined)?.mode;
  return fields(
    str(r.description) && { label: 'Description', value: str(r.description) },
    url && { label: 'URL', value: url, mono: true },
    { label: 'Threshold', value: r.threshold != null ? `${str(r.threshold)} req` : '' },
    { label: 'Period', value: r.period != null ? `${str(r.period)}s` : '' },
    { label: 'Action', value: str(action) },
    r.disabled != null && { label: 'Disabled', value: yesNo(r.disabled) },
  );
}

function fmtWorkerRoute(r: Raw): DetailField[] {
  return fields(
    { label: 'Pattern', value: str(r.pattern), mono: true },
    { label: 'Worker', value: str(r.script), mono: true },
  );
}

function fmtWorker(r: Raw): DetailField[] {
  const bindings = Array.isArray(r.bindings) ? (r.bindings as Raw[]) : [];
  const byType = new Map<string, number>();
  for (const b of bindings) {
    const t = str(b.type) || 'unknown';
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  const bindingSummary = [...byType.entries()]
    .map(([t, n]) => (n > 1 ? `${t}×${n}` : t))
    .join(', ');
  return fields(
    { label: 'Script', value: str(r.id), mono: true },
    str(r.usage_model) && { label: 'Usage model', value: str(r.usage_model) },
    { label: 'Bindings', value: bindings.length ? `${bindings.length} — ${bindingSummary}` : '0' },
  );
}

function fmtEmailRule(r: Raw): DetailField[] {
  const matchers = Array.isArray(r.matchers) ? (r.matchers as Raw[]) : [];
  const actions = Array.isArray(r.actions) ? (r.actions as Raw[]) : [];
  const isCatchAll = matchers.length === 1 && str(matchers[0].type) === 'all';
  const matchStr = isCatchAll
    ? 'all (catch-all)'
    : matchers.map((m) => `${str(m.field)}=${str(m.value)}`.replace(/^=/, '')).filter(Boolean).join(', ');
  const actionStr = actions
    .map((a) => {
      const type = str(a.type);
      const vals = Array.isArray(a.value) ? (a.value as unknown[]).map(str).filter(Boolean).join(', ') : '';
      return vals ? `${type} → ${vals}` : type;
    })
    .filter(Boolean)
    .join('; ');
  return fields(
    { label: 'Match', value: matchStr, mono: true },
    { label: 'Action', value: actionStr, mono: true },
    r.priority != null && { label: 'Priority', value: str(r.priority) },
    { label: 'Enabled', value: yesNo(r.enabled !== false) },
  );
}

function fmtWaitingRoom(r: Raw): DetailField[] {
  return fields(
    { label: 'Host', value: str(r.host), mono: true },
    { label: 'Path', value: str(r.path), mono: true },
    r.total_active_users != null && { label: 'Total active users', value: str(r.total_active_users) },
    r.new_users_per_minute != null && { label: 'New users/min', value: str(r.new_users_per_minute) },
    str(r.queueing_method) && { label: 'Queueing', value: str(r.queueing_method) },
  );
}

function fmtCustomHostname(r: Raw): DetailField[] {
  const ssl = r.ssl as Raw | undefined;
  return fields(
    { label: 'Hostname', value: str(r.hostname), mono: true },
    { label: 'SSL method', value: str(ssl?.method) },
    { label: 'SSL type', value: str(ssl?.type) },
    { label: 'SSL status', value: str(ssl?.status) },
  );
}

function fmtCustomCert(r: Raw): DetailField[] {
  const hosts = Array.isArray(r.hosts) ? (r.hosts as unknown[]).map(str).filter(Boolean) : [];
  return fields(
    { label: 'Hosts', value: hosts.join(', '), mono: true },
    str(r.bundle_method) && { label: 'Bundle method', value: str(r.bundle_method) },
    { label: 'Expires', value: date(r.expires_on) },
  );
}

function fmtLoadBalancer(r: Raw): DetailField[] {
  const defaultPools = Array.isArray(r.default_pools) ? (r.default_pools as unknown[]).length : 0;
  return fields(
    { label: 'Hostname', value: str(r.name), mono: true },
    { label: 'Steering', value: str(r.steering_policy) || 'off' },
    { label: 'Default pools', value: String(defaultPools) },
    str(r.fallback_pool) && { label: 'Fallback pool', value: str(r.fallback_pool), mono: true },
    r.proxied != null && { label: 'Proxied', value: yesNo(r.proxied) },
    r.enabled != null && { label: 'Enabled', value: yesNo(r.enabled) },
  );
}

function fmtPool(r: Raw): DetailField[] {
  const origins = Array.isArray(r.origins) ? (r.origins as Raw[]) : [];
  const originStr = origins
    .map((o) => {
      const addr = str(o.address);
      const name = str(o.name);
      return addr ? `${name || 'origin'} (${addr})` : name;
    })
    .filter(Boolean)
    .join(', ');
  return fields(
    { label: 'Origins', value: originStr || String(origins.length), mono: true },
    str(r.monitor) && { label: 'Monitor', value: str(r.monitor), mono: true },
    r.enabled != null && { label: 'Enabled', value: yesNo(r.enabled) },
  );
}

function fmtMonitor(r: Raw): DetailField[] {
  return fields(
    { label: 'Type', value: str(r.type), mono: true },
    str(r.method) && { label: 'Method', value: str(r.method) },
    str(r.path) && { label: 'Path', value: str(r.path), mono: true },
    { label: 'Interval', value: r.interval != null ? `${str(r.interval)}s` : '' },
    str(r.expected_codes) && { label: 'Expected codes', value: str(r.expected_codes) },
  );
}

function fmtAccessApp(r: Raw): DetailField[] {
  const domains = Array.isArray(r.self_hosted_domains)
    ? (r.self_hosted_domains as unknown[]).map(str).filter(Boolean)
    : [];
  return fields(
    { label: 'Type', value: str(r.type) },
    { label: 'Domain', value: str(r.domain) || domains.join(', '), mono: true },
    domains.length > 1 && { label: 'Self-hosted domains', value: domains.join(', '), mono: true },
    str(r.session_duration) && { label: 'Session', value: str(r.session_duration) },
  );
}

function fmtSpectrum(r: Raw): DetailField[] {
  const dns = r.dns as Raw | undefined;
  const originDns = r.origin_dns as Raw | undefined;
  const originDirect = Array.isArray(r.origin_direct)
    ? (r.origin_direct as unknown[]).map(str).filter(Boolean)
    : [];
  const origin = originDirect[0] || str(originDns?.name);
  return fields(
    { label: 'DNS name', value: str(dns?.name), mono: true },
    { label: 'Protocol', value: str(r.protocol), mono: true },
    origin && { label: 'Origin', value: origin, mono: true },
    r.origin_port != null && { label: 'Origin port', value: str(r.origin_port) },
  );
}

function fmtQueue(r: Raw): DetailField[] {
  const producers = Array.isArray(r.producers) ? (r.producers as unknown[]).length : 0;
  const consumers = Array.isArray(r.consumers) ? (r.consumers as unknown[]).length : 0;
  return fields(
    { label: 'Name', value: str(r.queue_name), mono: true },
    { label: 'Producers', value: String(producers) },
    { label: 'Consumers', value: String(consumers) },
  );
}

function fmtTurnstile(r: Raw): DetailField[] {
  const domains = Array.isArray(r.domains) ? (r.domains as unknown[]).map(str).filter(Boolean) : [];
  return fields(
    { label: 'Name', value: str(r.name) },
    { label: 'Mode', value: str(r.mode) },
    { label: 'Domains', value: domains.join(', ') || 'All', mono: true },
    { label: 'Sitekey', value: str(r.sitekey), mono: true },
  );
}

function fmtKv(r: Raw): DetailField[] {
  return fields(
    { label: 'Title', value: str(r.title), mono: true },
    { label: 'Namespace ID', value: str(r.id), mono: true },
  );
}

function fmtR2(r: Raw): DetailField[] {
  return fields(
    { label: 'Name', value: str(r.name), mono: true },
    str(r.location) && { label: 'Location', value: str(r.location) },
    { label: 'Created', value: date(r.creation_date) },
  );
}

function fmtPages(r: Raw): DetailField[] {
  return fields(
    { label: 'Name', value: str(r.name), mono: true },
    str(r.production_branch) && { label: 'Production branch', value: str(r.production_branch), mono: true },
    str(r.subdomain) && { label: 'Subdomain', value: str(r.subdomain), mono: true },
  );
}

function fmtAiGateway(r: Raw): DetailField[] {
  return fields(
    { label: 'Gateway', value: str(r.id), mono: true },
    r.cache_ttl != null && { label: 'Cache TTL', value: `${str(r.cache_ttl)}s` },
    r.rate_limiting_limit != null && {
      label: 'Rate limit',
      value: `${str(r.rate_limiting_limit)}/${str(r.rate_limiting_interval)}s`,
    },
    r.authentication != null && { label: 'Auth', value: yesNo(r.authentication) },
  );
}

function fmtAiProvider(r: Raw): DetailField[] {
  return fields(
    { label: 'Name', value: str(r.name) || str(r.slug) },
    { label: 'Slug', value: str(r.slug), mono: true },
    { label: 'Base URL', value: str(r.base_url), mono: true },
  );
}

function fmtOriginCa(r: Raw): DetailField[] {
  const hostnames = Array.isArray(r.hostnames) ? (r.hostnames as unknown[]).map(str).filter(Boolean) : [];
  return fields(
    { label: 'Hostnames', value: hostnames.join(', '), mono: true },
    { label: 'Request type', value: str(r.request_type) },
    r.requested_validity != null && { label: 'Validity', value: `${str(r.requested_validity)}d` },
    { label: 'Expires', value: date(r.expires_on) },
  );
}

function fmtD1(r: Raw): DetailField[] {
  return fields(
    { label: 'Name', value: str(r.name), mono: true },
    r.num_tables != null && { label: 'Tables', value: str(r.num_tables) },
    str(r.version) && { label: 'Version', value: str(r.version) },
  );
}

function fmtDurableObjects(raw: unknown): DetailField[] {
  // DO items carry an array of namespace objects (grouped by script).
  const namespaces = Array.isArray(raw) ? (raw as Raw[]) : [];
  const classes = namespaces.map((n) => str(n.class) || str(n.name) || str(n.id)).filter(Boolean);
  return fields(
    { label: 'Classes', value: classes.join(', '), mono: true },
    { label: 'Namespaces', value: String(namespaces.length) },
  );
}

// ── Generic fallback ──────────────────────────────────────────────────────

const GENERIC_SKIP_KEYS = new Set([
  'id', 'created_on', 'modified_on', 'created_at', 'modified_at',
  'createdOn', 'modifiedOn', 'zone_id', 'zone_name', 'account_id',
]);

/**
 * Fallback for any type without a curated formatter: surface the object's
 * top-level scalar fields (string/number/boolean) so the row still shows real,
 * identifying data rather than name-only. Skips noisy id/timestamp keys, long
 * blobs, and nested objects/arrays (those remain visible via the raw-JSON
 * expander). Capped so a giant object doesn't flood the row.
 */
export function genericFields(raw: unknown, max = 8): DetailField[] {
  if (raw == null || typeof raw !== 'object') {
    return raw == null ? [] : fields({ label: 'value', value: str(raw) });
  }
  if (Array.isArray(raw)) {
    return fields({ label: 'Items', value: String(raw.length) });
  }
  const out: DetailField[] = [];
  for (const [k, v] of Object.entries(raw as Raw)) {
    if (out.length >= max) break;
    if (GENERIC_SKIP_KEYS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === 'object') continue; // nested — leave to raw expander
    const value = str(v);
    if (!value || value.length > 200) continue;
    out.push({
      label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      value,
      mono: typeof v !== 'boolean',
    });
  }
  return out;
}

const FORMATTERS: Record<string, (raw: Raw) => DetailField[]> = {
  dnsRecords: fmtDns,
  settings: fmtSetting,
  rulesets: fmtRuleset,
  pageRules: fmtPageRule,
  firewallRules: fmtFirewallRule,
  rateLimits: fmtRateLimit,
  workerRoutes: fmtWorkerRoute,
  zoneWorkers: fmtWorker,
  workers: fmtWorker,
  emailRules: fmtEmailRule,
  waitingRooms: fmtWaitingRoom,
  customHostnames: fmtCustomHostname,
  customCertificates: fmtCustomCert,
  loadBalancers: fmtLoadBalancer,
  pools: fmtPool,
  monitors: fmtMonitor,
  accessApps: fmtAccessApp,
  spectrumApps: fmtSpectrum,
  queues: fmtQueue,
  turnstileWidgets: fmtTurnstile,
  kvNamespaces: fmtKv,
  r2Buckets: fmtR2,
  pagesProjects: fmtPages,
  aiGateways: fmtAiGateway,
  aiGatewayCustomProviders: fmtAiProvider,
  originCaCertificates: fmtOriginCa,
  d1Databases: fmtD1,
};

/**
 * Curated identifying detail for a Step 2 resource item. Returns the fields
 * that define the resource for the given group; falls back to genericFields
 * for any type without a curated formatter (so nothing is ever name-only).
 */
export function getItemDetail(groupKey: string, raw: unknown): DetailField[] {
  if (groupKey === 'durableObjects') return fmtDurableObjects(raw);
  const f = FORMATTERS[groupKey];
  if (f && raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const detail = f(raw as Raw);
    if (detail.length > 0) return detail;
  }
  return genericFields(raw);
}
