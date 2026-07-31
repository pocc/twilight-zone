import type {
  OAuthEnvelope,
  OAuthEnvelopeContext,
  OAuthGrantPayload,
  OAuthPayload,
  OAuthTransactionPayload,
} from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const DIGEST_BYTES = 32;

const toArrayBuffer = (value: Uint8Array): ArrayBuffer => new Uint8Array(value).buffer;

const randomBase64Url = (bytes: number): string => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64UrlEncode(value);
};

const hasExactKeys = (value: Record<string, unknown>, keys: string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRole = (value: unknown): value is OAuthTransactionPayload['role'] =>
  value === 'source' || value === 'destination';

const isCanonicalDigest = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return base64UrlDecode(value).byteLength === DIGEST_BYTES;
  } catch {
    return false;
  }
};

const isCanonicalId = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return base64UrlDecode(value).byteLength === 16;
  } catch {
    return false;
  }
};

const isCodeVerifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

const isScopeArray = (value: unknown): value is string[] =>
  Array.isArray(value)
  && value.length > 0
  && value.every((scope) => typeof scope === 'string' && scope.length > 0)
  && new Set(value).size === value.length;

const parseTransaction = (value: Record<string, unknown>, role: OAuthEnvelopeContext['role']): OAuthTransactionPayload => {
  if (
    !hasExactKeys(value, ['version', 'role', 'stateDigest', 'nonceDigest', 'codeVerifier', 'issuedAt'])
    || value.version !== 1
    || !isRole(value.role)
    || value.role !== role
    || !isCanonicalDigest(value.stateDigest)
    || !isCanonicalDigest(value.nonceDigest)
    || !isCodeVerifier(value.codeVerifier)
    || !Number.isSafeInteger(value.issuedAt)
    || (value.issuedAt as number) < 0
  ) throw new Error('oauth_invalid_payload');
  return value as OAuthTransactionPayload;
};

const parseGrant = (value: Record<string, unknown>, role: OAuthEnvelopeContext['role']): OAuthGrantPayload => {
  if (
    !hasExactKeys(value, ['version', 'role', 'accessToken', 'tokenType', 'expiresAt', 'scopes', 'nonceDigest', 'grantId'])
    || value.version !== 1
    || !isRole(value.role)
    || value.role !== role
    || typeof value.accessToken !== 'string'
    || value.accessToken.length === 0
    || value.tokenType !== 'Bearer'
    || !Number.isSafeInteger(value.expiresAt)
    || (value.expiresAt as number) <= 0
    || !isScopeArray(value.scopes)
    || !isCanonicalDigest(value.nonceDigest)
    || !isCanonicalId(value.grantId)
  ) throw new Error('oauth_invalid_payload');
  return value as OAuthGrantPayload;
};

const additionalData = (context: OAuthEnvelopeContext): ArrayBuffer => toArrayBuffer(encoder.encode(JSON.stringify({
  version: 1,
  keyId: context.keyId,
  role: context.role,
  purpose: context.purpose,
  origin: context.origin,
})));

export const base64UrlEncode = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
};

export const base64UrlDecode = (value: string): Uint8Array => {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) throw new Error('oauth_invalid_base64url');
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    const decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (base64UrlEncode(decoded) !== value) throw new Error('oauth_invalid_base64url');
    return decoded;
  } catch {
    throw new Error('oauth_invalid_base64url');
  }
};

export const parseCookieKey = async (value: string): Promise<CryptoKey> => {
  try {
    const raw = base64UrlDecode(value);
    if (raw.byteLength !== 32) throw new Error('invalid length');
    return await crypto.subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    throw new Error('oauth_config_invalid_key');
  }
};

export const generateState = (): string => randomBase64Url(32);
export const generatePkceVerifier = (): string => randomBase64Url(32);
export const generateGrantId = (): string => randomBase64Url(16);
export const generateMigrationId = (): string => randomBase64Url(16);

export const createPkceChallenge = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
};

export const hashValue = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return base64UrlEncode(new Uint8Array(digest));
};

export const fixedDigestEqual = (left: string, right: string): boolean => {
  let leftBytes: Uint8Array;
  let rightBytes: Uint8Array;
  try {
    leftBytes = base64UrlDecode(left);
    rightBytes = base64UrlDecode(right);
  } catch {
    return false;
  }
  if (leftBytes.byteLength !== DIGEST_BYTES || rightBytes.byteLength !== DIGEST_BYTES) return false;
  let difference = 0;
  for (let index = 0; index < DIGEST_BYTES; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
};

export const encryptOAuthPayload = async (
  payload: OAuthPayload,
  key: CryptoKey,
  context: OAuthEnvelopeContext,
): Promise<OAuthEnvelope> => {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: additionalData(context), tagLength: 128 },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    version: 1,
    keyId: context.keyId,
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  };
};

export const decryptOAuthPayload = async (
  envelope: OAuthEnvelope,
  key: CryptoKey,
  context: OAuthEnvelopeContext,
): Promise<OAuthPayload> => {
  let plaintext: ArrayBuffer;
  try {
    if (
      !isRecord(envelope)
      || !hasExactKeys(envelope, ['version', 'keyId', 'iv', 'ciphertext'])
      || envelope.version !== 1
      || envelope.keyId !== context.keyId
      || typeof envelope.iv !== 'string'
      || typeof envelope.ciphertext !== 'string'
    ) throw new Error('invalid envelope');
    const iv = base64UrlDecode(envelope.iv);
    if (iv.byteLength !== 12) throw new Error('invalid IV');
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: additionalData(context), tagLength: 128 },
      key,
      toArrayBuffer(base64UrlDecode(envelope.ciphertext)),
    );
  } catch {
    throw new Error('oauth_invalid_envelope');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error('oauth_invalid_payload');
  }
  if (!isRecord(parsed)) throw new Error('oauth_invalid_payload');
  return context.purpose === 'transaction' ? parseTransaction(parsed, context.role) : parseGrant(parsed, context.role);
};
