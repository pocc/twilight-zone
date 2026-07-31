export type OAuthRoutePolicyKind =
  | 'public'
  | 'manual-only'
  | 'source'
  | 'destination'
  | 'both'
  | 'migration'
  | 'dynamic'
  | 'prompt'
  | 'status'
  | 'session'
  | 'api-v1-public'
  | 'api-v1-manual'
  | 'method-not-allowed';

export type OAuthRoutePolicy = {
  kind: OAuthRoutePolicyKind;
  budgetMs: number;
};

export type OAuthRoutePolicyDefinition = {
  method: 'GET' | 'POST' | 'ALL';
  path: string;
  policy: OAuthRoutePolicy;
};

const SYNC = 120_000;
const STREAM = 900_000;
const MIGRATION = 1_800_000;
const route = (
  method: OAuthRoutePolicyDefinition['method'],
  path: string,
  kind: OAuthRoutePolicyKind,
  budgetMs = 0,
): OAuthRoutePolicyDefinition => ({ method, path, policy: { kind, budgetMs } });

export const UI_ROUTE_POLICIES: OAuthRoutePolicyDefinition[] = [
  route('GET', '/api/v1', 'api-v1-public'),
  route('ALL', '/api/v1', 'method-not-allowed'),
  route('GET', '/api/v1/', 'api-v1-public'),
  route('ALL', '/api/v1/', 'method-not-allowed'),
  route('GET', '/api/v1/docs', 'api-v1-public'),
  route('ALL', '/api/v1/docs', 'method-not-allowed'),
  route('POST', '/api/v1/*', 'api-v1-manual'),
  route('GET', '/api/version', 'public'),
  route('GET', '/api/stats', 'public'),
  route('GET', '/api/spec-status', 'public'),
  route('ALL', '/api/webhook-sink', 'public'),
  route('POST', '/api/oauth/config', 'public'),
  route('POST', '/api/oauth/start', 'public'),
  route('GET', '/api/oauth/callback', 'public'),
  route('POST', '/api/oauth/status', 'status'),
  route('POST', '/api/oauth/clear', 'session'),
  route('POST', '/api/oauth/logout', 'session'),
  route('POST', '/api/feedback', 'public'),
  route('POST', '/api/migrate/stream', 'migration', STREAM),
  route('POST', '/api/migrate/account-resources', 'migration', MIGRATION),
  route('POST', '/api/migrate/respond', 'prompt', SYNC),
  route('POST', '/api/migrate', 'migration', MIGRATION),
  route('POST', '/api/export/stream', 'dynamic', STREAM),
  route('POST', '/api/export', 'source', SYNC),
  route('POST', '/api/export/troubleshooting/stream', 'source', STREAM),
  route('POST', '/api/export/troubleshooting', 'source', SYNC),
  route('POST', '/api/export/openapi/stream', 'source', STREAM),
  route('POST', '/api/export/openapi', 'source', SYNC),
  route('POST', '/api/analytics/export/stream', 'source', STREAM),
  route('POST', '/api/analytics/export', 'source', SYNC),
  route('POST', '/api/analytics/probe/stream', 'source', STREAM),
  route('POST', '/api/terraform/export', 'source', SYNC),
  route('POST', '/api/terraform/export/stream', 'source', STREAM),
  route('POST', '/api/terraform/import/stream', 'destination', STREAM),
  route('POST', '/api/validate-token', 'manual-only', SYNC),
  route('POST', '/api/check-blockers', 'both', SYNC),
  route('POST', '/api/check-capabilities', 'destination', SYNC),
  route('POST', '/api/monitor/ping', 'source', SYNC),
  route('POST', '/api/email-routing/send-verification', 'destination', SYNC),
  route('POST', '/api/email-routing/check-verification', 'destination', SYNC),
  route('POST', '/api/zones', 'dynamic', SYNC),
  route('POST', '/api/zones/create', 'destination', SYNC),
  route('POST', '/api/accounts', 'dynamic', SYNC),
  route('POST', '/api/rdap', 'public', SYNC),
  route('POST', '/api/available-plans', 'destination', SYNC),
  route('POST', '/api/validate', 'both', SYNC),
  route('POST', '/api/rollback', 'destination', SYNC),
  route('POST', '/api/fuzz/stream', 'destination', STREAM),
  route('POST', '/api/maxconfig/stream', 'destination', STREAM),
  route('POST', '/api/minconfig/stream', 'destination', STREAM),
  route('POST', '/api/diff/stream', 'both', STREAM),
];

export const routePolicyKey = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;

export const UI_ROUTE_POLICY_BY_ROUTE = new Map(
  UI_ROUTE_POLICIES.map(({ method, path, policy }) => [routePolicyKey(method, path), policy]),
);
