import type { ApiAuth } from './api';
import * as api from './api';

export interface TroubleshootingEndpointAttempt {
  method: string;
  path: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface TroubleshootingExport {
  schema: 'twilight-zone.troubleshooting-export/v1';
  generated_at: string;
  zone: {
    id: string;
    name: string;
    status: string;
    plan?: { id?: string; name?: string };
    name_servers?: string[];
  };
  account: {
    id: string;
    name?: string;
  };
  summary: {
    dns_record_count?: number;
    dns_record_types?: Record<string, number>;
    worker_routes_count?: number;
    workers_custom_domains_count?: number;
    page_rules_count?: number;
    rulesets_count?: number;
    load_balancers_count?: number;
    pools_count?: number;
    monitors_count?: number;
    custom_certificates_count?: number;
    custom_hostnames_count?: number;
    waiting_rooms_count?: number;
    logpush_jobs_count?: number;
  };
  sections: Record<string, unknown>;
  endpoints_attempted: TroubleshootingEndpointAttempt[];
  notes: string[];
}

function toAuth(body: {
  sourceToken?: string;
  useApiKey?: boolean;
  apiKey?: string;
  apiEmail?: string;
}): ApiAuth | string {
  if (body.useApiKey && body.apiKey && body.apiEmail) {
    return { type: 'key', apiKey: body.apiKey, email: body.apiEmail };
  }
  return body.sourceToken || '';
}

function normalizeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

function topN<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return items.slice(0, n);
}

function dnsTypeCounts(records: Array<{ type?: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    const t = (r.type || 'UNKNOWN').toUpperCase();
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}

export async function exportZoneTroubleshooting(
  body: {
    sourceToken?: string;
    sourceZoneId: string;
    sourceAccountId: string;
    useApiKey?: boolean;
    apiKey?: string;
    apiEmail?: string;
  },
  log: (message: string) => void = () => {},
): Promise<TroubleshootingExport> {
  const auth = toAuth(body);
  const zoneId = body.sourceZoneId;
  const accountId = body.sourceAccountId;

  const endpoints: TroubleshootingEndpointAttempt[] = [];
  const notes: string[] = [];

  async function attempt<T>(method: string, path: string, fn: () => Promise<T>): Promise<T | null> {
    const start = Date.now();
    try {
      const res = await fn();
      const maybeEnvelope = res as any;
      if (maybeEnvelope && typeof maybeEnvelope === 'object' && typeof maybeEnvelope.success === 'boolean') {
        if (maybeEnvelope.success === false) {
          const errMsg = maybeEnvelope.errors?.[0]?.message || 'API returned success=false';
          endpoints.push({ method, path, ok: false, error: errMsg });
          log(`  ⚠ ${method} ${path}: ${errMsg}`);
          return res;
        }
      }

      endpoints.push({ method, path, ok: true });
      log(`  ✓ ${method} ${path} (${Date.now() - start}ms)`);
      return res;
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      endpoints.push({ method, path, ok: false, error: normalizeError(e) });
      log(`  ⚠ ${method} ${path}: ${normalizeError(e)}`);
      return null;
    }
  }

  log('🩺 Exporting troubleshooting snapshot...');

  const zone = await api.getZone(auth, zoneId);

  // Core read-only fetches (parallel).
  const [
    settings,
    dnsRecordsEnvelope,
    pageRules,
    rulesets,
    workerRoutes,
    workersCustomDomains,
    loadBalancers,
    pools,
    monitors,
    customCertificates,
    customHostnames,
    waitingRooms,
    logpushJobs,
    dnssec,
    dnsSettings,
    subscription,
  ] = await Promise.all([
    attempt('GET', `/zones/${zoneId}/settings`, () => api.listZoneSettings(auth, zoneId)),
    attempt('GET', `/zones/${zoneId}/dns_records?per_page=200&page=1`, () => api.cfRequestEnvelope<any>(auth, `/zones/${zoneId}/dns_records?per_page=200&page=1`)),
    attempt('GET', `/zones/${zoneId}/pagerules`, () => api.listPageRules(auth, zoneId)),
    attempt('GET', `/zones/${zoneId}/rulesets`, () => api.listRulesets(auth, zoneId)),
    attempt('GET', `/zones/${zoneId}/workers/routes`, () => api.listWorkerRoutes(auth, zoneId)),
    attempt('GET', `/accounts/${accountId}/workers/domains`, () => api.listWorkerCustomDomains(auth, accountId)),
    attempt('GET', `/zones/${zoneId}/load_balancers`, () => api.listLoadBalancers(auth, zoneId)),
    attempt('GET', `/accounts/${accountId}/load_balancers/pools`, () => api.listPools(auth, accountId)),
    attempt('GET', `/accounts/${accountId}/load_balancers/monitors`, () => api.listMonitors(auth, accountId)),
    attempt('GET', `/zones/${zoneId}/custom_certificates`, () => api.listCustomCertificates(auth, zoneId)),
    attempt('GET', `/zones/${zoneId}/custom_hostnames`, () => api.listCustomHostnames(auth, zoneId)),
    attempt('GET', `/zones/${zoneId}/waiting_rooms`, () => api.listWaitingRooms(auth, zoneId)),
    attempt('GET', `/zones/${zoneId}/logpush/jobs`, () => api.cfRequestEnvelope<any>(auth, `/zones/${zoneId}/logpush/jobs`)),
    attempt('GET', `/zones/${zoneId}/dnssec`, () => api.cfRequestEnvelope<any>(auth, `/zones/${zoneId}/dnssec`)),
    attempt('GET', `/zones/${zoneId}/dns_settings`, () => api.cfRequestEnvelope<any>(auth, `/zones/${zoneId}/dns_settings`)),
    attempt('GET', `/zones/${zoneId}/subscription`, () => api.getZoneSubscription(auth, zoneId)),
  ]);

  const dnsRecords = (dnsRecordsEnvelope && (dnsRecordsEnvelope as any).result && Array.isArray((dnsRecordsEnvelope as any).result))
    ? ((dnsRecordsEnvelope as any).result as any[])
    : [];
  const dnsTruncated = dnsRecordsEnvelope && (dnsRecordsEnvelope as any).result_info
    ? true
    : dnsRecords.length >= 200;

  if (dnsTruncated) {
    notes.push('DNS records are sampled (first page only) to keep this export LLM-friendly.');
  }

  // Filter custom domains to zone-related only (when zone_id present).
  const workersCustomDomainsForZone = (workersCustomDomains || []).filter(cd => (cd as any).zone_id === zoneId);

  const settingsMap: Record<string, { value: unknown; editable: boolean }>
    = {};
  for (const s of settings || []) {
    settingsMap[s.id] = { value: s.value, editable: s.editable };
  }

  const dnsSamples = topN(dnsRecords, 50).map(r => ({
    id: r.id,
    type: r.type,
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    proxied: r.proxied,
    priority: r.priority,
    data: r.data,
    comment: (r as any).comment,
    tags: (r as any).tags,
  }));

  const rulesetSamples = topN(rulesets || [], 25).map(rs => ({
    id: rs.id,
    name: rs.name,
    kind: rs.kind,
    phase: rs.phase,
    description: rs.description,
    rules_count: Array.isArray(rs.rules) ? rs.rules.length : 0,
    rules_sample: topN(rs.rules || [], 5).map(r => ({
      action: r.action,
      expression: r.expression,
      enabled: r.enabled,
      description: r.description,
    })),
  }));

  const workerRouteSamples = topN(workerRoutes || [], 50).map(r => ({
    id: r.id,
    pattern: r.pattern,
    script: r.script,
  }));

  const workersCustomDomainSamples = topN(workersCustomDomainsForZone || [], 50).map(cd => ({
    id: cd.id,
    hostname: cd.hostname,
    service: cd.service,
    environment: cd.environment,
  }));

  const logpushJobsResult = (logpushJobs && (logpushJobs as any).success && Array.isArray((logpushJobs as any).result))
    ? ((logpushJobs as any).result as any[])
    : [];

  const logpushJobSamples = topN(logpushJobsResult, 50).map(j => ({
    id: j.id,
    name: j.name,
    enabled: j.enabled,
    dataset: j.dataset,
    destination_conf: j.destination_conf,
    frequency: j.frequency,
    last_complete: j.last_complete,
    logpull_options: j.logpull_options,
  }));

  const summary: TroubleshootingExport['summary'] = {
    dns_record_count: dnsRecords.length,
    dns_record_types: dnsTypeCounts(dnsRecords),
    worker_routes_count: (workerRoutes || []).length,
    workers_custom_domains_count: workersCustomDomainsForZone.length,
    page_rules_count: (pageRules || []).length,
    rulesets_count: (rulesets || []).length,
    load_balancers_count: (loadBalancers || []).length,
    pools_count: (pools || []).length,
    monitors_count: (monitors || []).length,
    custom_certificates_count: (customCertificates || []).length,
    custom_hostnames_count: (customHostnames || []).length,
    waiting_rooms_count: (waitingRooms || []).length,
    logpush_jobs_count: logpushJobsResult.length,
  };

  const sections: TroubleshootingExport['sections'] = {
    zone_overview: {
      zone_id: zone.id,
      zone_name: zone.name,
      status: zone.status,
      plan: zone.plan,
      name_servers: zone.name_servers,
      account: zone.account,
    },

    zone_settings: {
      // LLM-friendly: key/value map
      settings: settingsMap,
      // Commonly-troubleshot derived views
      highlights: {
        ssl: settingsMap.ssl?.value,
        always_use_https: settingsMap.always_use_https?.value,
        automatic_https_rewrites: settingsMap.automatic_https_rewrites?.value,
        min_tls_version: settingsMap.min_tls_version?.value,
        tls_1_3: settingsMap.tls_1_3?.value,
        opportunistic_encryption: settingsMap.opportunistic_encryption?.value,
        websockets: settingsMap.websockets?.value,
        http3: settingsMap.http3?.value,
        brotli: settingsMap.brotli?.value,
        ipv6: settingsMap.ipv6?.value,
        pseudo_ipv4: settingsMap.pseudo_ipv4?.value,
        security_level: settingsMap.security_level?.value,
        challenge_ttl: settingsMap.challenge_ttl?.value,
        browser_cache_ttl: settingsMap.browser_cache_ttl?.value,
        cache_level: settingsMap.cache_level?.value,
      },
    },

    dns: {
      sampled: dnsTruncated,
      records_sample: dnsSamples,
      type_counts: summary.dns_record_types,
    },

    workers_routing: {
      routes_sample: workerRouteSamples,
      custom_domains_sample: workersCustomDomainSamples,
      notes: [
        'This export does not fetch worker script code or bindings by default.',
        'Use the migratable export for full worker code/bindings capture.',
      ],
    },

    rules: {
      page_rules_sample: topN(pageRules || [], 20),
      rulesets_sample: rulesetSamples,
      notes: [
        'Rulesets in this export are sampled from list endpoints; per-ruleset detail endpoints are not fetched here.',
      ],
    },

    load_balancing: {
      load_balancers_sample: topN(loadBalancers || [], 25),
      pools_sample: topN(pools || [], 25),
      monitors_sample: topN(monitors || [], 25),
    },

    ssl_tls: {
      custom_certificates_sample: topN(customCertificates || [], 25),
      custom_hostnames_sample: topN(customHostnames || [], 25),
      dnssec: dnssec || null,
      dns_settings: dnsSettings || null,
      subscription: subscription || null,
    },

    waiting_rooms: {
      waiting_rooms_sample: topN(waitingRooms || [], 25),
    },

    logpush: {
      jobs_sample: logpushJobSamples,
    },
  };

  return {
    schema: 'twilight-zone.troubleshooting-export/v1',
    generated_at: new Date().toISOString(),
    zone: {
      id: zone.id,
      name: zone.name,
      status: zone.status,
      plan: zone.plan,
      name_servers: zone.name_servers,
    },
    account: {
      id: zone.account?.id || accountId,
      name: zone.account?.name,
    },
    summary,
    sections,
    endpoints_attempted: endpoints,
    notes,
  };
}
