import type { ApiAuth } from './api';
import * as api from './api';
import { OPENAPI_GET_OPERATIONS, type OpenApiGetOperation } from './openapi-manifest.generated';
import type { MigrationConfig, ZoneExport } from './types';
import { exportZone } from './migrate';

export interface OpenApiCallRecord {
  path: string;
  ok: boolean;
  envelope?: unknown;
  error?: string;
}

export interface OpenApiOperationExport {
  method: 'GET';
  path_template: string;
  tags?: string[];
  family?: string;
  path_params: string[];
  query_params: string[];
  calls: OpenApiCallRecord[];
  notes?: string[];
}

export interface OpenApiEverythingExport {
  schema: 'twilight-zone.openapi-everything-export/v1';
  generated_at: string;
  inputs: { zone_id: string; account_id: string };
  zone: unknown;
  curated: ZoneExport;
  openapi: {
    manifest: { get_operations: number };
    operations: Record<string, OpenApiOperationExport>;
    unresolved: Array<{ method: 'GET'; path: string; reason: string; pathParams: string[] }>;
  };
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

function opKey(op: Pick<OpenApiGetOperation, 'method' | 'path'>): string {
  return `${op.method} ${op.path}`;
}

function familyFromPathTemplate(p: string): string | undefined {
  const m = p.match(/^\/zones\/{zone_id\}\/([^\/]+)/);
  return m ? m[1] : undefined;
}

/** Derive a human-friendly label from the last meaningful path segment. */
function labelFromPath(p: string): string {
  // Strip template params and trailing slashes, take last segment
  const segments = p.replace(/\{[^}]+\}/g, '').replace(/\/+$/, '').split('/').filter(Boolean);
  const last = segments[segments.length - 1] || 'resource';
  // Convert snake_case/kebab-case to Title Case
  return last
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Count result items from a set of call records. */
function countResults(calls: OpenApiCallRecord[]): number {
  let total = 0;
  for (const c of calls) {
    if (!c.ok || !c.envelope) continue;
    const result = (c.envelope as any)?.result;
    if (Array.isArray(result)) total += result.length;
    else if (result !== null && result !== undefined) total += 1;
  }
  return total;
}

function resolvePathTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_m, name) => params[name] ?? `{${name}}`);
}

async function fetchPaginatedGet(
  auth: ApiAuth | string,
  op: OpenApiGetOperation,
  resolvedPath: string,
  callLimit: { maxPages: number; perPage: number },
): Promise<OpenApiCallRecord[]> {
  const supportsPagination = op.queryParams.includes('page') && op.queryParams.includes('per_page');
  if (!supportsPagination) {
    try {
      const envelope = await api.cfRequestEnvelope(auth, resolvedPath);
      return [{ path: resolvedPath, ok: (envelope as any)?.success === true, envelope }];
    } catch (e) {
      return [{ path: resolvedPath, ok: false, error: normalizeError(e) }];
    }
  }

  const calls: OpenApiCallRecord[] = [];
  const join = resolvedPath.includes('?') ? '&' : '?';
  const firstPath = `${resolvedPath}${join}page=1&per_page=${callLimit.perPage}`;
  let first: any;
  try {
    first = await api.cfRequestEnvelope(auth, firstPath);
    calls.push({ path: firstPath, ok: first?.success === true, envelope: first });
  } catch (e) {
    calls.push({ path: firstPath, ok: false, error: normalizeError(e) });
    return calls;
  }

  const totalPages = typeof first?.result_info?.total_pages === 'number'
    ? first.result_info.total_pages
    : 1;

  const pageMax = Math.min(totalPages, callLimit.maxPages);
  for (let page = 2; page <= pageMax; page++) {
    const p = `${resolvedPath}${join}page=${page}&per_page=${callLimit.perPage}`;
    try {
      const envelope = await api.cfRequestEnvelope(auth, p);
      calls.push({ path: p, ok: (envelope as any)?.success === true, envelope });
    } catch (e) {
      calls.push({ path: p, ok: false, error: normalizeError(e) });
    }
  }

  if (totalPages > callLimit.maxPages) {
    calls.push({
      path: resolvedPath,
      ok: false,
      error: `Truncated pagination: total_pages=${totalPages} maxPages=${callLimit.maxPages}`,
    });
  }

  return calls;
}

function extractIdsFromEnvelope(envelope: unknown, idParamName: string): string[] {
  const env: any = envelope;
  const result = env?.result;
  if (!Array.isArray(result)) return [];
  const ids: string[] = [];
  for (const item of result) {
    if (!item || typeof item !== 'object') continue;
    const anyItem: any = item;
    const direct = anyItem[idParamName];
    const generic = anyItem.id;
    const chosen = typeof direct === 'string' ? direct : (typeof generic === 'string' ? generic : null);
    if (chosen) ids.push(chosen);
  }
  return [...new Set(ids)];
}

export async function exportZoneOpenApiEverything(
  body: {
    sourceToken?: string;
    sourceZoneId: string;
    sourceAccountId: string;
    useApiKey?: boolean;
    apiKey?: string;
    apiEmail?: string;
    limits?: { maxPages?: number; perPage?: number; maxDetailItems?: number; concurrency?: number };
  },
  log: (message: string) => void = () => {},
): Promise<OpenApiEverythingExport> {
  const auth = toAuth(body);
  const zoneId = body.sourceZoneId;
  const accountId = body.sourceAccountId;

  const maxPages = Math.max(1, Math.min(body.limits?.maxPages ?? 200, 1000));
  const perPage = Math.max(5, Math.min(body.limits?.perPage ?? 100, 1000));
  const maxDetailItems = Math.max(1, Math.min(body.limits?.maxDetailItems ?? 5000, 50_000));
  const concurrency = Math.max(1, Math.min(body.limits?.concurrency ?? 8, 20));

  log('📦 Exporting curated ZoneExport (migration shape)...');
  const curatedConfig: MigrationConfig = {
    sourceToken: body.sourceToken || '',
    destToken: '',
    sourceZoneId: zoneId,
    sourceAccountId: accountId,
    destAccountId: '',
    dryRun: true,
    useApiKey: body.useApiKey,
    apiKey: body.apiKey,
    apiEmail: body.apiEmail,
  };
  const curated = await exportZone(curatedConfig, (m) => log(m));

  log('🔎 Exporting OpenAPI GET surface (everything)...');
  const zone = await api.getZone(auth, zoneId);

  const operations: Record<string, OpenApiOperationExport> = {};
  const unresolved: Array<{ method: 'GET'; path: string; reason: string; pathParams: string[] }> = [];

  const getOps = OPENAPI_GET_OPERATIONS
    .filter(op => op.pathParams.includes('zone_id') || op.pathParams.includes('account_id'));

  const directOps = getOps.filter(op => op.pathParams.every(p => p === 'zone_id' || p === 'account_id'));
  const paramOps = getOps.filter(op => !op.pathParams.every(p => p === 'zone_id' || p === 'account_id'));

  const resolvedBaseParams: Record<string, string> = {
    zone_id: zoneId,
    account_id: accountId,
  };

  // Pass 1: direct calls (no extra path params)
  log(`⏳ Direct GET operations: ${directOps.length}`);
  await api.batchWithConcurrency(
    directOps,
    async (op) => {
      const resolvedPath = resolvePathTemplate(op.path, resolvedBaseParams);
      const calls = await fetchPaginatedGet(auth, op, resolvedPath, { maxPages, perPage });
      const ok = calls.some(c => c.ok);
      const label = labelFromPath(op.path);
      const count = countResults(calls);
      if (ok) {
        log(`✓ ${label}: ${count}`);
      } else {
        log(`✗ ${label}: failed`);
      }
      operations[opKey(op)] = {
        method: 'GET',
        path_template: op.path,
        tags: op.tags,
        family: familyFromPathTemplate(op.path),
        path_params: op.pathParams,
        query_params: op.queryParams,
        calls,
      };
      return true;
    },
    concurrency,
  );

  // Pass 2: best-effort resolve for single trailing path param detail endpoints.
  // Example: /zones/{zone_id}/dns_records/{dns_record_id}
  const opByPath = new Map<string, OpenApiGetOperation>();
  for (const op of getOps) opByPath.set(op.path, op);

  log(`⏳ Parameterized GET operations: ${paramOps.length}`);
  for (const op of paramOps) {
    const extraParams = op.pathParams.filter(p => p !== 'zone_id' && p !== 'account_id');
    const key = opKey(op);

    // Only handle the common "detail" shape with one trailing param.
    if (extraParams.length !== 1 || !op.path.endsWith(`/{${extraParams[0]}}`)) {
      unresolved.push({ method: 'GET', path: op.path, reason: 'Unsupported path params shape (needs discovery graph)', pathParams: op.pathParams });
      continue;
    }

    const idParam = extraParams[0];
    const parentPath = op.path.slice(0, op.path.length - (`/{${idParam}}`).length);
    const parentOp = opByPath.get(parentPath);
    if (!parentOp) {
      unresolved.push({ method: 'GET', path: op.path, reason: `No parent list endpoint found (${parentPath})`, pathParams: op.pathParams });
      continue;
    }

    const parentKey = opKey(parentOp);
    const parentExport = operations[parentKey];
    if (!parentExport || parentExport.calls.length === 0) {
      unresolved.push({ method: 'GET', path: op.path, reason: `Parent list endpoint not fetched (${parentPath})`, pathParams: op.pathParams });
      continue;
    }

    // Collect IDs from *successful* pages.
    const parentIds: string[] = [];
    for (const c of parentExport.calls) {
      if (!c.ok || !c.envelope) continue;
      parentIds.push(...extractIdsFromEnvelope(c.envelope, idParam));
    }
    const ids = [...new Set(parentIds)].slice(0, maxDetailItems);
    if (ids.length === 0) {
      unresolved.push({ method: 'GET', path: op.path, reason: `No IDs discovered from parent endpoint (${parentPath})`, pathParams: op.pathParams });
      continue;
    }

    if (parentIds.length > ids.length) {
      // record truncation as a synthetic call record
      // (keeps export append-only and easy to scan)
    }

    const calls: OpenApiCallRecord[] = [];
    await api.batchWithConcurrency(
      ids,
      async (id) => {
        const resolvedPath = resolvePathTemplate(op.path, { ...resolvedBaseParams, [idParam]: id });
        try {
          const envelope = await api.cfRequestEnvelope(auth, resolvedPath);
          calls.push({ path: resolvedPath, ok: (envelope as any)?.success === true, envelope });
        } catch (e) {
          calls.push({ path: resolvedPath, ok: false, error: normalizeError(e) });
        }
        return true;
      },
      concurrency,
    );

    operations[key] = {
      method: 'GET',
      path_template: op.path,
      tags: op.tags,
      family: familyFromPathTemplate(op.path),
      path_params: op.pathParams,
      query_params: op.queryParams,
      calls,
      notes: parentIds.length > ids.length ? [`Truncated detail fetch: discovered=${parentIds.length} fetched=${ids.length} maxDetailItems=${maxDetailItems}`] : undefined,
    };
    const detailOk = calls.some(c => c.ok);
    const detailLabel = labelFromPath(op.path);
    if (detailOk) {
      log(`✓ ${detailLabel}: ${calls.filter(c => c.ok).length} of ${ids.length}`);
    } else {
      log(`✗ ${detailLabel}: failed`);
    }
  }

  const totalCalls = Object.values(operations).reduce((n, o) => n + o.calls.length, 0);
  log(`✅ OpenAPI export complete: ${Object.keys(operations).length} operations, ${totalCalls} API calls, ${unresolved.length} unresolved`);

  return {
    schema: 'twilight-zone.openapi-everything-export/v1',
    generated_at: new Date().toISOString(),
    inputs: { zone_id: zoneId, account_id: accountId },
    zone,
    curated,
    openapi: {
      manifest: { get_operations: OPENAPI_GET_OPERATIONS.length },
      operations,
      unresolved,
    },
  };
}
