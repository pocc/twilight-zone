import type { OAuthConfig, OAuthProviderError } from './types';

const PROVIDER_TIMEOUT_MS = 10_000;

export type OAuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ProviderResult<T = undefined> = T extends undefined
  ? { ok: true } | { ok: false; error: OAuthProviderError }
  : { ok: true; token: T } | { ok: false; error: OAuthProviderError };

export type OAuthToken = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scopes: Set<string>;
};

const formHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };

const sameSet = (left: Set<string>, right: Set<string>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value));

const parseReturnedScopes = (value: unknown): Set<string> | undefined => {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const scopes = value.split(' ');
  if (scopes.some((scope) => scope.length === 0)) return undefined;
  const unique = new Set(scopes);
  return unique.size === scopes.length ? unique : undefined;
};

const providerFetch = async (
  fetchImpl: OAuthFetch,
  endpoint: string,
  body: URLSearchParams,
): Promise<{ ok: true; response: Response } | { ok: false; error: OAuthProviderError }> => {
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: formHeaders,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return { ok: true, response };
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return { ok: false, error: 'oauth_provider_timeout' };
    }
    return { ok: false, error: 'oauth_provider_unavailable' };
  }
};

export const buildAuthorizationUrl = (
  config: OAuthConfig,
  input: { scopes: Set<string>; state: string; codeChallenge: string },
): URL => {
  const url = new URL(config.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: [...input.scopes].join(' '),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url;
};

export const exchangeAuthorizationCode = async (
  config: OAuthConfig,
  input: { code: string; codeVerifier: string; scopes: Set<string> },
  fetchImpl: OAuthFetch = fetch,
): Promise<ProviderResult<OAuthToken>> => {
  const fetched = await providerFetch(fetchImpl, config.tokenEndpoint, new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code: input.code,
    redirect_uri: config.redirectUri,
    code_verifier: input.codeVerifier,
  }));
  if (!fetched.ok) return fetched;
  if (!fetched.response.ok) return { ok: false, error: 'oauth_provider_rejected' };

  let value: unknown;
  try {
    value = JSON.parse(await fetched.response.text());
  } catch {
    return { ok: false, error: 'oauth_provider_invalid_response' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'oauth_provider_invalid_response' };
  }
  const response = value as Record<string, unknown>;
  const scopes = parseReturnedScopes(response.scope);
  if (
    typeof response.access_token !== 'string'
    || response.access_token.length === 0
    || typeof response.token_type !== 'string'
    || response.token_type.toLowerCase() !== 'bearer'
    || !Number.isSafeInteger(response.expires_in)
    || (response.expires_in as number) <= 0
    || !scopes
    || !sameSet(scopes, input.scopes)
    || 'refresh_token' in response
  ) return { ok: false, error: 'oauth_provider_invalid_token' };

  return {
    ok: true,
    token: {
      accessToken: response.access_token,
      tokenType: 'Bearer',
      expiresIn: response.expires_in as number,
      scopes,
    },
  };
};

export const revokeAccessToken = async (
  config: OAuthConfig,
  token: string,
  fetchImpl: OAuthFetch = fetch,
): Promise<ProviderResult> => {
  const fetched = await providerFetch(fetchImpl, config.revocationEndpoint, new URLSearchParams({
    client_id: config.clientId,
    token,
    token_type_hint: 'access_token',
  }));
  if (!fetched.ok) return fetched;
  return fetched.response.ok ? { ok: true } : { ok: false, error: 'oauth_provider_rejected' };
};
