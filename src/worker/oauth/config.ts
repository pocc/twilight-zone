import { parseCookieKey } from './crypto';
import type { OAuthConfig, OAuthConfigError } from './types';

export type OAuthEnv = {
  OAUTH_ENABLED?: string;
  OAUTH_CLIENT_ID?: string;
  OAUTH_COOKIE_KEY?: string;
  OAUTH_COOKIE_KEY_ID?: string;
  OAUTH_ALLOWED_ORIGIN?: string;
  OAUTH_REDIRECT_URI?: string;
  OAUTH_SOURCE_SCOPES?: string;
  OAUTH_DESTINATION_SCOPES?: string;
  OAUTH_AUTHORIZATION_ENDPOINT?: string;
  OAUTH_TOKEN_ENDPOINT?: string;
  OAUTH_REVOCATION_ENDPOINT?: string;
};

export type OAuthConfigResult =
  | { ok: true; config: OAuthConfig }
  | { ok: false; error: OAuthConfigError };

const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const SCOPE_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
const DEFAULT_PROVIDER_ENDPOINTS = {
  authorizationEndpoint: 'https://dash.cloudflare.com/oauth2/auth',
  tokenEndpoint: 'https://dash.cloudflare.com/oauth2/token',
  revocationEndpoint: 'https://dash.cloudflare.com/oauth2/revoke',
};

const parseScopes = (serialized: string): Set<string> | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  if (!parsed.every((scope) => typeof scope === 'string' && scope === scope.trim() && SCOPE_PATTERN.test(scope))) {
    return undefined;
  }
  const scopes = new Set(parsed as string[]);
  return scopes.size === parsed.length ? scopes : undefined;
};

const parseAllowedOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (
      url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
      || value !== url.origin
    ) return undefined;
    if (url.protocol === 'https:') return value;
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'http:' || !loopback) return undefined;
    if (url.port && (!/^\d{1,5}$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) return undefined;
    return value;
  } catch {
    return undefined;
  }
};

const isValidRedirect = (value: string, allowedOrigin: string): boolean => {
  if (value.includes('?') || value.includes('#')) return false;
  try {
    const url = new URL(value);
    return url.href === value
      && url.origin === allowedOrigin
      && !url.username
      && !url.password
      && url.pathname === '/api/oauth/callback'
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
};

const isLoopbackOrigin = (origin: string): boolean => {
  const url = new URL(origin);
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
};

const parseLocalProviderEndpoint = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (
      url.href !== value
      || url.protocol !== 'http:'
      || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
      || !url.port
      || url.username
      || url.password
      || url.pathname === '/'
      || url.search
      || url.hash
    ) return undefined;
    return value;
  } catch {
    return undefined;
  }
};

export const parseOAuthConfig = async (env: OAuthEnv): Promise<OAuthConfigResult> => {
  if (env.OAUTH_ENABLED !== 'true') return { ok: false, error: 'oauth_disabled' };
  const values = [
    env.OAUTH_CLIENT_ID,
    env.OAUTH_COOKIE_KEY,
    env.OAUTH_COOKIE_KEY_ID,
    env.OAUTH_ALLOWED_ORIGIN,
    env.OAUTH_REDIRECT_URI,
    env.OAUTH_SOURCE_SCOPES,
    env.OAUTH_DESTINATION_SCOPES,
  ];
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    return { ok: false, error: 'oauth_config_missing' };
  }

  const clientId = env.OAUTH_CLIENT_ID as string;
  const cookieKeyText = env.OAUTH_COOKIE_KEY as string;
  const cookieKeyId = env.OAUTH_COOKIE_KEY_ID as string;
  const allowedOriginText = env.OAUTH_ALLOWED_ORIGIN as string;
  const redirectUri = env.OAUTH_REDIRECT_URI as string;
  if (!CLIENT_ID_PATTERN.test(clientId)) return { ok: false, error: 'oauth_config_invalid_client' };
  if (!KEY_ID_PATTERN.test(cookieKeyId)) return { ok: false, error: 'oauth_config_invalid_key' };

  let cookieKey: CryptoKey;
  try {
    cookieKey = await parseCookieKey(cookieKeyText);
  } catch {
    return { ok: false, error: 'oauth_config_invalid_key' };
  }
  const allowedOrigin = parseAllowedOrigin(allowedOriginText);
  if (!allowedOrigin) return { ok: false, error: 'oauth_config_invalid_origin' };
  if (!isValidRedirect(redirectUri, allowedOrigin)) return { ok: false, error: 'oauth_config_invalid_redirect' };

  const sourceScopes = parseScopes(env.OAUTH_SOURCE_SCOPES as string);
  const destinationScopes = parseScopes(env.OAUTH_DESTINATION_SCOPES as string);
  if (!sourceScopes || !destinationScopes) return { ok: false, error: 'oauth_config_invalid_scopes' };

  const providerValues = [
    env.OAUTH_AUTHORIZATION_ENDPOINT,
    env.OAUTH_TOKEN_ENDPOINT,
    env.OAUTH_REVOCATION_ENDPOINT,
  ];
  const hasProviderOverride = providerValues.some((value) => value !== undefined);
  let providerEndpoints = DEFAULT_PROVIDER_ENDPOINTS;
  if (hasProviderOverride) {
    if (!isLoopbackOrigin(allowedOrigin) || !providerValues.every((value) => typeof value === 'string')) {
      return { ok: false, error: 'oauth_config_invalid_provider' };
    }
    const [authorizationEndpoint, tokenEndpoint, revocationEndpoint] = providerValues.map(
      (value) => parseLocalProviderEndpoint(value as string),
    );
    if (!authorizationEndpoint || !tokenEndpoint || !revocationEndpoint) {
      return { ok: false, error: 'oauth_config_invalid_provider' };
    }
    providerEndpoints = { authorizationEndpoint, tokenEndpoint, revocationEndpoint };
  }

  return {
    ok: true,
    config: {
      clientId, cookieKey, cookieKeyId, allowedOrigin, redirectUri,
      ...providerEndpoints,
      sourceScopes, destinationScopes,
    },
  };
};
