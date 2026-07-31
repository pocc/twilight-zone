import type { OAuthEnvelope, OAuthRole } from './types';

const MAX_SET_COOKIE_BYTES = 3800;
export const MAX_OAUTH_COOKIE_HEADER_BYTES = 12_000;

export const OAUTH_COOKIE_NAMES = {
  source: {
    transaction: '__Host-tz-oauth-source-transaction',
    grant: '__Host-tz-oauth-source-grant',
  },
  destination: {
    transaction: '__Host-tz-oauth-destination-transaction',
    grant: '__Host-tz-oauth-destination-grant',
  },
} as const;

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export const serializeOAuthCookieValue = (envelope: OAuthEnvelope): string =>
  encodeURIComponent(JSON.stringify(envelope));

export const parseOAuthCookieValue = (value: string): OAuthEnvelope => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(value));
  } catch {
    throw new Error('oauth_invalid_cookie');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('oauth_invalid_cookie');
  }
  return parsed as OAuthEnvelope;
};

export const parseCookieHeader = (header: string | null): Map<string, string> => {
  if (!header) return new Map();
  const cookies = new Map<string, string>();
  const oauthNames = new Set(allOAuthCookieNames());
  let oauthBytes = 0;
  let hasOAuthCookie = false;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (oauthNames.has(name)) {
      oauthBytes += byteLength(part) + (hasOAuthCookie ? byteLength(';') : 0);
      hasOAuthCookie = true;
      if (oauthBytes > MAX_OAUTH_COOKIE_HEADER_BYTES) throw new Error('oauth_cookie_header_too_large');
    }
    if (!cookies.has(name)) cookies.set(name, part.slice(separator + 1).trim());
  }
  return cookies;
};

const checked = (value: string): string => {
  if (byteLength(value) > MAX_SET_COOKIE_BYTES) throw new Error('oauth_cookie_too_large');
  return value;
};

export const createTransactionCookie = (role: OAuthRole, envelope: OAuthEnvelope): string => checked(
  `${OAUTH_COOKIE_NAMES[role].transaction}=${serializeOAuthCookieValue(envelope)}; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax`,
);

export const createGrantCookie = (role: OAuthRole, envelope: OAuthEnvelope): string => checked(
  `${OAUTH_COOKIE_NAMES[role].grant}=${serializeOAuthCookieValue(envelope)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
);

export const clearOAuthCookie = (name: string): string =>
  `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

export const allOAuthCookieNames = (): string[] => Object.values(OAUTH_COOKIE_NAMES)
  .flatMap(({ transaction, grant }) => [transaction, grant]);
