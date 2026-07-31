import { decryptOAuthPayload, fixedDigestEqual, hashValue } from './crypto';
import { OAUTH_COOKIE_NAMES, parseCookieHeader, parseOAuthCookieValue } from './cookies';
import type { OAuthConfig, OAuthGrantPayload, OAuthRole } from './types';

const sameScopes = (actual: string[], expected: Set<string>): boolean =>
  actual.length === expected.size && actual.every((scope) => expected.has(scope));

export const readRoleGrant = async (
  cookieHeader: string | null,
  role: OAuthRole,
  config: OAuthConfig,
): Promise<OAuthGrantPayload | undefined> => {
  const value = parseCookieHeader(cookieHeader).get(OAUTH_COOKIE_NAMES[role].grant);
  if (!value) return undefined;
  const payload = await decryptOAuthPayload(parseOAuthCookieValue(value), config.cookieKey, {
    keyId: config.cookieKeyId,
    role,
    purpose: 'grant',
    origin: config.allowedOrigin,
  });
  if (!('accessToken' in payload)) throw new Error('oauth_invalid_grant');
  const expectedScopes = role === 'source' ? config.sourceScopes : config.destinationScopes;
  if (!sameScopes(payload.scopes, expectedScopes)) throw new Error('oauth_invalid_grant');
  return payload;
};

export const isGrantBoundToNonce = async (grant: OAuthGrantPayload, nonce: string): Promise<boolean> =>
  fixedDigestEqual(grant.nonceDigest, await hashValue(nonce));
