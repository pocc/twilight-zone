import { describe, expect, it } from 'vitest';

import {
  base64UrlDecode,
  base64UrlEncode,
  createPkceChallenge,
  decryptOAuthPayload,
  encryptOAuthPayload,
  fixedDigestEqual,
  generateGrantId,
  generateMigrationId,
  generatePkceVerifier,
  generateState,
  hashValue,
  parseCookieKey,
} from '../src/worker/oauth/crypto';
import type {
  OAuthEnvelope,
  OAuthEnvelopeContext,
  OAuthGrantPayload,
  OAuthTransactionPayload,
} from '../src/worker/oauth/types';

const keyText = base64UrlEncode(Uint8Array.from({ length: 32 }, (_, index) => index));

describe('OAuth cryptographic core', () => {
  it('matches the RFC 7636 S256 challenge vector', async () => {
    await expect(createPkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .resolves.toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('generates canonical high-entropy state, verifier, and independent IDs', () => {
    const values = [generateState(), generatePkceVerifier(), generateGrantId(), generateMigrationId()];
    expect(values[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(values[1]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(values[2]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(values[3]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new Set(values)).toHaveLength(values.length);
  });

  it('accepts only a canonical unpadded 32-byte base64url cookie key', async () => {
    await expect(parseCookieKey(keyText)).resolves.toBeInstanceOf(CryptoKey);
    await expect(parseCookieKey(`${keyText}=`)).rejects.toThrow('oauth_config_invalid_key');
    await expect(parseCookieKey(base64UrlEncode(new Uint8Array(31)))).rejects.toThrow('oauth_config_invalid_key');
    expect(() => base64UrlDecode('AB')).toThrow('oauth_invalid_base64url');
  });

  it('round-trips strictly validated transaction and grant payloads', async () => {
    const key = await parseCookieKey(keyText);
    const transaction: OAuthTransactionPayload = {
      version: 1,
      role: 'source',
      stateDigest: await hashValue('state'),
      nonceDigest: await hashValue('nonce'),
      codeVerifier: generatePkceVerifier(),
      issuedAt: 1_700_000_000_000,
    };
    const grant: OAuthGrantPayload = {
      version: 1,
      role: 'destination',
      accessToken: 'token-value',
      tokenType: 'Bearer',
      expiresAt: 1_700_003_600_000,
      scopes: ['account:read', 'zone:edit'],
      nonceDigest: await hashValue('nonce'),
      grantId: generateGrantId(),
    };

    const transactionEnvelope = await encryptOAuthPayload(transaction, key, {
      keyId: 'key_1', role: 'source', purpose: 'transaction', origin: 'https://twilight-zone.ross.gg',
    });
    const grantEnvelope = await encryptOAuthPayload(grant, key, {
      keyId: 'key_1', role: 'destination', purpose: 'grant', origin: 'https://twilight-zone.ross.gg',
    });

    await expect(decryptOAuthPayload(transactionEnvelope, key, {
      keyId: 'key_1', role: 'source', purpose: 'transaction', origin: 'https://twilight-zone.ross.gg',
    })).resolves.toEqual(transaction);
    await expect(decryptOAuthPayload(grantEnvelope, key, {
      keyId: 'key_1', role: 'destination', purpose: 'grant', origin: 'https://twilight-zone.ross.gg',
    })).resolves.toEqual(grant);
  });

  it('rejects altered ciphertext, authenticated context, and malformed payloads', async () => {
    const key = await parseCookieKey(keyText);
    const context = {
      keyId: 'key_1', role: 'source' as const, purpose: 'transaction' as const, origin: 'https://twilight-zone.ross.gg',
    };
    const payload: OAuthTransactionPayload = {
      version: 1,
      role: 'source',
      stateDigest: await hashValue('state'),
      nonceDigest: await hashValue('nonce'),
      codeVerifier: generatePkceVerifier(),
      issuedAt: 1,
    };
    const envelope = await encryptOAuthPayload(payload, key, context);
    const ciphertext = base64UrlDecode(envelope.ciphertext);
    ciphertext[0] ^= 1;

    await expect(decryptOAuthPayload({ ...envelope, ciphertext: base64UrlEncode(ciphertext) }, key, context))
      .rejects.toThrow('oauth_invalid_envelope');
    await expect(decryptOAuthPayload(envelope, key, { ...context, origin: 'https://example.com' }))
      .rejects.toThrow('oauth_invalid_envelope');

    const malformed = await encryptOAuthPayload({ ...payload, unexpected: true } as OAuthTransactionPayload, key, context);
    await expect(decryptOAuthPayload(malformed, key, context)).rejects.toThrow('oauth_invalid_payload');
  });

  it('rejects a wrong AES key and every altered authenticated-data field', async () => {
    const key = await parseCookieKey(keyText);
    const wrongKey = await parseCookieKey(base64UrlEncode(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)));
    const context: OAuthEnvelopeContext = {
      keyId: 'key_1', role: 'source', purpose: 'transaction', origin: 'https://twilight-zone.ross.gg',
    };
    const payload: OAuthTransactionPayload = {
      version: 1,
      role: 'source',
      stateDigest: await hashValue('state'),
      nonceDigest: await hashValue('nonce'),
      codeVerifier: generatePkceVerifier(),
      issuedAt: 1,
    };
    const envelope = await encryptOAuthPayload(payload, key, context);

    await expect(decryptOAuthPayload(envelope, wrongKey, context)).rejects.toThrow('oauth_invalid_envelope');

    const alteredCases: { envelope: OAuthEnvelope; context: OAuthEnvelopeContext }[] = [
      { envelope: { ...envelope, keyId: 'key_2' }, context: { ...context, keyId: 'key_2' } },
      { envelope, context: { ...context, role: 'destination' } },
      { envelope, context: { ...context, purpose: 'grant' } },
      { envelope: { ...envelope, version: 2 } as unknown as OAuthEnvelope, context },
      { envelope, context: { ...context, origin: 'https://example.com' } },
    ];
    for (const altered of alteredCases) {
      await expect(decryptOAuthPayload(altered.envelope, key, altered.context))
        .rejects.toThrow('oauth_invalid_envelope');
    }
  });

  it('uses a unique 96-bit IV for every encryption', async () => {
    const key = await parseCookieKey(keyText);
    const context = {
      keyId: 'key_1', role: 'source' as const, purpose: 'transaction' as const, origin: 'https://twilight-zone.ross.gg',
    };
    const payload: OAuthTransactionPayload = {
      version: 1,
      role: 'source',
      stateDigest: await hashValue('state'),
      nonceDigest: await hashValue('nonce'),
      codeVerifier: generatePkceVerifier(),
      issuedAt: 1,
    };
    const envelopes = await Promise.all(Array.from({ length: 64 }, () => encryptOAuthPayload(payload, key, context)));
    expect(new Set(envelopes.map(({ iv }) => iv))).toHaveLength(64);
    expect(envelopes.every(({ iv }) => base64UrlDecode(iv).byteLength === 12)).toBe(true);
  });

  it('compares every changed position of fixed-length digests as unequal', async () => {
    const digest = await hashValue('constant-time-input');
    expect(fixedDigestEqual(digest, digest)).toBe(true);

    const original = base64UrlDecode(digest);
    for (let index = 0; index < original.length; index += 1) {
      const changed = original.slice();
      changed[index] ^= 1;
      expect(fixedDigestEqual(digest, base64UrlEncode(changed))).toBe(false);
    }
    expect(fixedDigestEqual(digest, base64UrlEncode(new Uint8Array(31)))).toBe(false);
  });
});
