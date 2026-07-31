import type { ApiAuth } from '../../api';
import { base64UrlDecode, fixedDigestEqual, hashValue } from './crypto';
import { OAUTH_COOKIE_NAMES } from './cookies';
import { parseOAuthConfig, type OAuthEnv } from './config';
import { readRoleGrant } from './grants';
import type { OAuthRoutePolicy } from './route-policy';
import type { OAuthGrantPayload, OAuthRole } from './types';

const AUTH_HEADER = 'X-Twilight-Auth';
const NONCE_HEADER = 'X-Twilight-OAuth-Nonce';
const EXPIRY_SAFETY_MS = 300_000;

type ResolvedRoleAuth = {
  auth: ApiAuth;
  grant: OAuthGrantPayload;
};

export type ResolvedOAuthContext = {
  nonceDigest: string;
  source?: ResolvedRoleAuth;
  destination?: ResolvedRoleAuth;
};

type OAuthFailure = {
  ok: false;
  status: 400 | 401 | 403 | 503;
  error: string;
  clearCookies: string[];
  role?: OAuthRole;
};

export type ResolveOAuthResult =
  | { ok: true; mode: 'manual'; body: Record<string, unknown> }
  | { ok: true; mode: 'oauth'; body: Record<string, unknown>; context: ResolvedOAuthContext }
  | OAuthFailure;

const failure = (status: OAuthFailure['status'], error: string, clearCookies: string[] = [], role?: OAuthRole): OAuthFailure =>
  ({ ok: false, status, error, clearCookies, ...(role ? { role } : {}) });

const hasManualCredentials = (body: Record<string, unknown>): boolean => [
  'token', 'sourceToken', 'destToken', 'apiKey', 'apiEmail', 'sourceApiKey', 'sourceApiEmail', 'destApiKey', 'destApiEmail',
].some((key) => typeof body[key] === 'string' && body[key] !== '');

const isNonce = (value: string | null): value is string => {
  if (!value) return false;
  try {
    return base64UrlDecode(value).byteLength === 32;
  } catch {
    return false;
  }
};

const requiredRoles = (policy: OAuthRoutePolicy, body: Record<string, unknown>): OAuthRole[] | undefined => {
  if (policy.kind === 'source') return ['source'];
  if (policy.kind === 'destination') return ['destination'];
  if (policy.kind === 'migration') {
    return body.sourceMode === 'json' || body.sourceMode === 'terraform'
      ? ['destination']
      : ['source', 'destination'];
  }
  if (policy.kind === 'both') return ['source', 'destination'];
  if (policy.kind === 'prompt') {
    const roles = body.oauthRoles;
    if (!Array.isArray(roles)) return undefined;
    if (roles.length === 1 && (roles[0] === 'source' || roles[0] === 'destination')) return [roles[0]];
    if (roles.length === 2 && roles[0] === 'source' && roles[1] === 'destination') return ['source', 'destination'];
    return undefined;
  }
  if (policy.kind === 'dynamic') {
    return body.oauthRole === 'source' || body.oauthRole === 'destination' ? [body.oauthRole] : undefined;
  }
  return [];
};

export const resolveOAuthAuth = async (
  request: Request,
  env: OAuthEnv,
  policy: OAuthRoutePolicy,
  body: Record<string, unknown>,
  options: { now?: () => number } = {},
): Promise<ResolveOAuthResult> => {
  const oauthSelected = request.headers.get(AUTH_HEADER) === 'oauth';
  if (!oauthSelected) return { ok: true, mode: 'manual', body };
  if (policy.kind === 'manual-only') return failure(403, 'oauth_not_supported');
  if (policy.kind === 'public') return { ok: true, mode: 'oauth', body, context: { nonceDigest: '' } };
  if (hasManualCredentials(body)) return failure(400, 'oauth_manual_credentials_forbidden');
  if (Array.isArray(body.doMigration) && body.doMigration.length > 0) {
    return failure(400, 'oauth_do_state_copy_unavailable');
  }

  const configResult = await parseOAuthConfig(env);
  if (!configResult.ok) return failure(503, configResult.error);
  const config = configResult.config;
  if (request.headers.get('Origin') !== new URL(request.url).origin || new URL(request.url).origin !== config.allowedOrigin) {
    return failure(403, 'oauth_origin_mismatch');
  }
  const roles = requiredRoles(policy, body);
  if (!roles) return failure(400, 'oauth_role_required');
  const nonce = request.headers.get(NONCE_HEADER);
  if (!isNonce(nonce)) return failure(401, 'oauth_reauthorization_required', [], roles.length === 1 ? roles[0] : undefined);

  const now = options.now?.() ?? Date.now();
  const context: ResolvedOAuthContext = { nonceDigest: await hashValue(nonce) };
  const adapted: Record<string, unknown> = { ...body, useApiKey: false };
  for (const role of roles) {
    let grant: OAuthGrantPayload | undefined;
    try {
      grant = await readRoleGrant(request.headers.get('Cookie'), role, config);
    } catch {
      return failure(401, 'oauth_reauthorization_required', [OAUTH_COOKIE_NAMES[role].grant], role);
    }
    if (!grant || !fixedDigestEqual(grant.nonceDigest, context.nonceDigest)) {
      return failure(401, 'oauth_reauthorization_required', [], role);
    }
    if (grant.expiresAt - now < policy.budgetMs + EXPIRY_SAFETY_MS) {
      return failure(401, 'oauth_reauthorization_required', [OAUTH_COOKIE_NAMES[role].grant], role);
    }
    const resolved = { auth: { type: 'token' as const, token: grant.accessToken }, grant };
    context[role] = resolved;
    if (role === 'source') {
      adapted.token = grant.accessToken;
      adapted.sourceToken = grant.accessToken;
    } else {
      if (roles.length === 1) adapted.token = grant.accessToken;
      adapted.destToken = grant.accessToken;
    }
  }
  return { ok: true, mode: 'oauth', body: adapted, context };
};
