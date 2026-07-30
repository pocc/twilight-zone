import { describe, it, expect } from 'vitest';
import { parseAuth, isAuthError, isValidCfId, isValidDomain, isValidEmail, isBodySizeValid, validateIds, validateDomains, safeError, sendSafeError, deriveErrorStatus, isSafePathSegment } from '../src/utils';
import { AuthError, EmptyEnvelopeError } from '../src/api';

describe('utils.ts', () => {
  describe('isSafePathSegment (F-2: rollback path-traversal guard)', () => {
    it('accepts legitimate CF identifiers and resource names', () => {
      expect(isSafePathSegment('a'.repeat(32))).toBe(true);            // 32-hex zone/account id
      expect(isSafePathSegment('11111111-2222-3333-4444-555555555555')).toBe(true); // D1 UUID
      expect(isSafePathSegment('my-worker_name')).toBe(true);          // worker script name
      expect(isSafePathSegment('prod-assets-bucket')).toBe(true);      // r2 bucket name
    });
    it('rejects path-traversal and separator characters', () => {
      expect(isSafePathSegment('../../../zones/abc/settings')).toBe(false);
      expect(isSafePathSegment('..')).toBe(false);
      expect(isSafePathSegment('foo/bar')).toBe(false);
      expect(isSafePathSegment('foo\\bar')).toBe(false);
    });
    it('rejects empty, whitespace, control chars, and over-long values', () => {
      expect(isSafePathSegment('')).toBe(false);
      expect(isSafePathSegment(undefined)).toBe(false);
      expect(isSafePathSegment('has space')).toBe(false);
      expect(isSafePathSegment('bell\x07')).toBe(false);
      expect(isSafePathSegment('x'.repeat(257))).toBe(false);
    });
  });

  describe('parseAuth', () => {
    it('returns key auth when useApiKey, apiKey, and apiEmail provided', () => {
      const result = parseAuth({
        useApiKey: true,
        apiKey: 'my-api-key',
        apiEmail: 'user@example.com',
      });
      
      expect(isAuthError(result)).toBe(false);
      if (!isAuthError(result) && result.type === 'key') {
        expect(result.apiKey).toBe('my-api-key');
        expect(result.email).toBe('user@example.com');
      }
    });

    it('trims whitespace from apiKey and email', () => {
      const result = parseAuth({
        useApiKey: true,
        apiKey: '  my-api-key  ',
        apiEmail: '  user@example.com  ',
      });
      
      if (!isAuthError(result) && result.type === 'key') {
        expect(result.apiKey).toBe('my-api-key');
        expect(result.email).toBe('user@example.com');
      }
    });

    it('returns token auth when valid token provided', () => {
      const result = parseAuth({
        token: 'my-valid-token-12345',
      });
      
      expect(isAuthError(result)).toBe(false);
      if (!isAuthError(result) && result.type === 'token') {
        expect(result.token).toBe('my-valid-token-12345');
      }
    });

    it('trims whitespace from token', () => {
      const result = parseAuth({
        token: '  my-valid-token-12345  ',
      });
      
      if (!isAuthError(result) && result.type === 'token') {
        expect(result.token).toBe('my-valid-token-12345');
      }
    });

    it('returns error when token is too short', () => {
      const result = parseAuth({
        token: 'short',
      });
      
      expect(isAuthError(result)).toBe(true);
      if (isAuthError(result)) {
        expect(result.error).toContain('Valid API token required');
      }
    });

    it('returns error when no auth provided', () => {
      const result = parseAuth({});
      
      expect(isAuthError(result)).toBe(true);
      if (isAuthError(result)) {
        expect(result.error).toContain('Token or API key');
      }
    });

    it('returns error when useApiKey is true but apiKey missing', () => {
      const result = parseAuth({
        useApiKey: true,
        apiEmail: 'user@example.com',
      });
      
      expect(isAuthError(result)).toBe(true);
    });

    it('returns error when useApiKey is true but apiEmail missing', () => {
      const result = parseAuth({
        useApiKey: true,
        apiKey: 'my-api-key',
      });
      
      expect(isAuthError(result)).toBe(true);
    });

    it('prefers key auth over token when both provided', () => {
      const result = parseAuth({
        useApiKey: true,
        apiKey: 'my-api-key',
        apiEmail: 'user@example.com',
        token: 'my-token-12345',
      });
      
      if (!isAuthError(result)) {
        expect(result.type).toBe('key');
      }
    });
  });

  describe('isAuthError', () => {
    it('returns true for error objects', () => {
      expect(isAuthError({ error: 'Some error' })).toBe(true);
    });

    it('returns false for token auth', () => {
      expect(isAuthError({ type: 'token', token: 'abc' })).toBe(false);
    });

    it('returns false for key auth', () => {
      expect(isAuthError({ type: 'key', apiKey: 'key', email: 'email' })).toBe(false);
    });
  });

  describe('isValidCfId', () => {
    it('accepts valid 32-char hex zone/account IDs', () => {
      expect(isValidCfId('abc123def456abc123def456abc12345')).toBe(true);
      expect(isValidCfId('ABCDEF0123456789ABCDEF0123456789')).toBe(true);
      expect(isValidCfId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(true);
    });

    it('rejects IDs that are too short', () => {
      expect(isValidCfId('abc123')).toBe(false);
      expect(isValidCfId('f30cf3f66dd69bc06cb8e67daedec2c')).toBe(false); // 31 chars
    });

    it('rejects IDs that are too long', () => {
      expect(isValidCfId('abc123def456abc123def456abc123456')).toBe(false); // 33 chars
    });

    it('rejects IDs with invalid characters', () => {
      expect(isValidCfId('xyz123def456abc123def456abc12345')).toBe(false); // 'x', 'y', 'z' not hex
      expect(isValidCfId('abc123-ef456abc123def456abc1234')).toBe(false); // hyphen
      expect(isValidCfId('abc123 ef456abc123def456abc1234')).toBe(false); // space
    });

    it('rejects undefined and empty strings', () => {
      expect(isValidCfId(undefined)).toBe(false);
      expect(isValidCfId('')).toBe(false);
    });

    it('trims whitespace before validation', () => {
      expect(isValidCfId('  a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4  ')).toBe(true);
    });
  });

  describe('isValidDomain', () => {
    it('accepts valid domain names', () => {
      expect(isValidDomain('example.com')).toBe(true);
      expect(isValidDomain('sub.example.com')).toBe(true);
      expect(isValidDomain('deep.nested.sub.example.com')).toBe(true);
      expect(isValidDomain('example-site.com')).toBe(true);
      expect(isValidDomain('123.example.com')).toBe(true);
    });

    it('accepts single-label domains', () => {
      expect(isValidDomain('localhost')).toBe(true);
    });

    it('rejects invalid domain names', () => {
      expect(isValidDomain('-example.com')).toBe(false); // starts with hyphen
      expect(isValidDomain('example-.com')).toBe(false); // ends with hyphen
      expect(isValidDomain('exam ple.com')).toBe(false); // space
      expect(isValidDomain('example..com')).toBe(false); // double dot
    });

    it('rejects domains that are too long', () => {
      const longDomain = 'a'.repeat(254) + '.com';
      expect(isValidDomain(longDomain)).toBe(false);
    });

    it('rejects undefined and empty strings', () => {
      expect(isValidDomain(undefined)).toBe(false);
      expect(isValidDomain('')).toBe(false);
    });

    it('trims whitespace before validation', () => {
      expect(isValidDomain('  example.com  ')).toBe(true);
    });
  });

  describe('isBodySizeValid', () => {
    it('accepts null content-length (no limit)', () => {
      expect(isBodySizeValid(null)).toBe(true);
    });

    it('accepts body sizes under 10MB', () => {
      expect(isBodySizeValid('1000')).toBe(true);
      expect(isBodySizeValid('1048576')).toBe(true); // 1MB
      expect(isBodySizeValid('5242880')).toBe(true); // 5MB
      expect(isBodySizeValid('10485760')).toBe(true); // exactly 10MB
    });

    it('rejects body sizes over 10MB', () => {
      expect(isBodySizeValid('10485761')).toBe(false); // 10MB + 1 byte
      expect(isBodySizeValid('20971520')).toBe(false); // 20MB
      expect(isBodySizeValid('104857600')).toBe(false); // 100MB
    });

    it('handles non-numeric content-length', () => {
      expect(isBodySizeValid('invalid')).toBe(false);
      // Note: parseInt('12abc') returns 12, so this is considered valid (12 bytes)
      // This matches JS behavior - Content-Length headers are always numeric in practice
      expect(isBodySizeValid('12abc')).toBe(true);
    });

    it('accepts zero-length bodies', () => {
      expect(isBodySizeValid('0')).toBe(true);
    });
  });

  describe('isValidEmail', () => {
    it('accepts simple addresses', () => {
      expect(isValidEmail('a@b.co')).toBe(true);
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('first.last+tag@sub.example.com')).toBe(true);
    });
    it('rejects malformed addresses', () => {
      expect(isValidEmail(undefined)).toBe(false);
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('no-at-sign')).toBe(false);
      expect(isValidEmail('two@@signs.com')).toBe(false);
      expect(isValidEmail('@nolocal.com')).toBe(false);
      expect(isValidEmail('nolocal@')).toBe(false);
      expect(isValidEmail('spaces in@email.com')).toBe(false);
    });
  });

  describe('validateIds', () => {
    it('returns null when all IDs are valid hex', () => {
      const result = validateIds({
        sourceZoneId: 'abc123def456abc123def456abc12345',
        destAccountId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      }, { required: true });
      expect(result).toBeNull();
    });
    it('rejects non-hex IDs', () => {
      const result = validateIds({
        sourceZoneId: 'not-a-valid-hex-id',
      }, { required: true });
      expect(result).not.toBeNull();
      expect(result?.field).toBe('sourceZoneId');
      expect(result?.message).toMatch(/32-character/);
    });
    it('skips undefined fields by default', () => {
      const result = validateIds({ sourceZoneId: undefined });
      expect(result).toBeNull();
    });
    it('requires presence when opts.required is true', () => {
      const result = validateIds({ sourceZoneId: undefined }, { required: true });
      expect(result?.field).toBe('sourceZoneId');
      expect(result?.message).toMatch(/required/);
    });
    it('treats empty string as missing', () => {
      const result = validateIds({ destAccountId: '' }, { required: true });
      expect(result?.message).toMatch(/required/);
    });
  });

  describe('validateDomains', () => {
    it('accepts valid domains', () => {
      expect(validateDomains({ domainName: 'example.com' })).toBeNull();
      expect(validateDomains({ d: 'a.b.c.d.example.com' })).toBeNull();
    });
    it('rejects garbage', () => {
      const result = validateDomains({ domainName: 'not a domain' });
      expect(result?.field).toBe('domainName');
    });
  });

  describe('safeError', () => {
    it('passes through "already exists" messages', () => {
      const result = safeError(new Error('Zone already exists in this account'), { log: false });
      expect(result.error).toMatch(/already exists/);
    });
    it('passes through validation messages', () => {
      const result = safeError(new Error('expected_codes is required'), { log: false });
      expect(result.error).toMatch(/required/);
    });
    it('passes through "not found" messages', () => {
      const result = safeError(new Error('Worker script not found'), { log: false });
      expect(result.error).toMatch(/not found/);
    });
    it('replaces unknown errors with generic message', () => {
      const result = safeError(new Error('TypeError: Cannot read property foo of undefined'), { log: false });
      expect(result.error).toBe('Internal error. Check worker logs.');
    });
    it('strips stack traces from passed-through messages', () => {
      const result = safeError(new Error('Validation failed\n    at handler (/Users/secret/path/file.ts:42:13)'), { log: false });
      expect(result.error).not.toContain('/Users/secret');
      expect(result.error).not.toContain('handler');
    });
    it('strips internal Cloudflare network hostnames from passed-through errors', () => {
      const result = safeError(new Error('Failed to reach internal-service.cloudflare.net timeout'), { log: false });
      expect(result.error).not.toContain('cloudflare.net');
      expect(result.error).toMatch(/internal-host/);
    });
    it('respects prefix option', () => {
      const result = safeError(new Error('zone not found'), { prefix: 'Export failed:', log: false });
      expect(result.error).toMatch(/^Export failed:/);
    });
    it('non-Error throws are stringified safely', () => {
      const result = safeError('a raw string', { log: false });
      // 'a raw string' doesn't match any safe pattern → generic
      expect(result.error).toBe('Internal error. Check worker logs.');
    });
  });

  // Regression: a rejected/malformed API token was surfacing as HTTP 500 from
  // /api/available-plans, /api/accounts, /api/zones, etc. A bad credential is a
  // client error, not a server error — the honest status is 401/4xx.
  describe('deriveErrorStatus', () => {
    it('maps AuthError to 401', () => {
      expect(deriveErrorStatus(new AuthError('Invalid API token: Cloudflare rejected this token.'))).toBe(401);
    });
    it('maps an EmptyEnvelopeError carrying a 4xx upstream status to that status', () => {
      expect(deriveErrorStatus(new EmptyEnvelopeError('/accounts', 403))).toBe(403);
      expect(deriveErrorStatus(new EmptyEnvelopeError('/zones/x/settings', 404))).toBe(404);
    });
    it('keeps 500 for an EmptyEnvelopeError with a 5xx upstream status', () => {
      expect(deriveErrorStatus(new EmptyEnvelopeError('/x', 503))).toBe(500);
    });
    it('keeps 500 for a generic Error', () => {
      expect(deriveErrorStatus(new Error('TypeError: cannot read foo'))).toBe(500);
    });
    it('keeps 500 for a non-Error throw', () => {
      expect(deriveErrorStatus('boom')).toBe(500);
    });
    it('classifies structurally by _tag (no instanceof coupling across module realms)', () => {
      expect(deriveErrorStatus({ _tag: 'AuthError', message: 'x' })).toBe(401);
      expect(deriveErrorStatus({ _tag: 'EmptyEnvelopeError', status: 400 })).toBe(400);
    });
  });

  describe('sendSafeError status classification', () => {
    it('returns 401 for an AuthError (client credential failure, not a 500)', () => {
      const res = sendSafeError(new AuthError('Invalid API token: Cloudflare rejected this token.'), { log: false });
      expect(res.status).toBe(401);
    });
    it('surfaces the humanized auth message in the body', async () => {
      const res = sendSafeError(new AuthError('Invalid API token: Cloudflare rejected this token.'), { log: false });
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/Invalid API token/);
    });
    it('returns 403 for a 403 EmptyEnvelopeError', () => {
      const res = sendSafeError(new EmptyEnvelopeError('/accounts', 403), { log: false });
      expect(res.status).toBe(403);
    });
    it('still returns 500 for an unclassified error', () => {
      const res = sendSafeError(new Error('boom'), { log: false });
      expect(res.status).toBe(500);
    });
    it('honors an explicit opts.status override', () => {
      const res = sendSafeError(new AuthError('x'), { status: 400, log: false });
      expect(res.status).toBe(400);
    });
  });
});
