import { describe, it, expect } from 'vitest';
import { validatePingTarget, isPrivateOrSpecialHost, sanitizeMonitorHeaders } from '../src/monitor';

const ZONE = 'enttest.example.com';

describe('validatePingTarget — host-lock to the migrating zone', () => {
  it('allows the zone apex and subdomains over http/https', () => {
    expect(validatePingTarget('https://enttest.example.com/health', ZONE).ok).toBe(true);
    expect(validatePingTarget('https://api.enttest.example.com/v1', ZONE).ok).toBe(true);
    expect(validatePingTarget('http://deep.sub.enttest.example.com/', ZONE).ok).toBe(true);
  });

  it('rejects off-zone hosts', () => {
    expect(validatePingTarget('https://evil.com/', ZONE).ok).toBe(false);
    // suffix-confusion: must not be fooled by the zone appearing as a suffix
    expect(validatePingTarget('https://enttest.example.com.evil.com/', ZONE).ok).toBe(false);
    // prefix-confusion: needs a dot boundary, not just endsWith
    expect(validatePingTarget('https://evil-enttest.example.com/', ZONE).ok).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    expect(validatePingTarget('ftp://enttest.example.com/', ZONE).ok).toBe(false);
    expect(validatePingTarget('file:///etc/passwd', ZONE).ok).toBe(false);
  });

  it('rejects invalid URLs and an empty zone', () => {
    expect(validatePingTarget('not a url', ZONE).ok).toBe(false);
    expect(validatePingTarget('https://enttest.example.com/', '').ok).toBe(false);
  });

  it('rejects private/loopback/metadata even before host-lock', () => {
    // (these would fail host-lock too, but the explicit block is defense-in-depth)
    for (const u of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://[::1]/',
      'http://localhost/',
      'http://foo.internal/',
      'http://metadata.google.internal/',
    ]) {
      expect(validatePingTarget(u, ZONE).ok, u).toBe(false);
    }
  });

  it('normalizes a zone name with a trailing dot / mixed case', () => {
    expect(validatePingTarget('https://ENTTEST.example.com/', 'EntTest.Example.COM.').ok).toBe(true);
  });
});

describe('isPrivateOrSpecialHost', () => {
  it('flags private/loopback/link-local/CGNAT/metadata', () => {
    for (const h of ['127.0.0.1', '0.0.0.0', '10.1.2.3', '192.168.0.1', '172.20.5.5',
      '169.254.169.254', '100.64.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1',
      'localhost', 'a.localhost', 'svc.internal', 'printer.local', 'metadata.google.internal']) {
      expect(isPrivateOrSpecialHost(h), h).toBe(true);
    }
  });
  it('allows ordinary public hosts', () => {
    for (const h of ['enttest.example.com', 'api.example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1']) {
      expect(isPrivateOrSpecialHost(h), h).toBe(false);
    }
  });
});

describe('sanitizeMonitorHeaders', () => {
  it('drops spoofable / hop-by-hop headers, keeps the rest', () => {
    const out = sanitizeMonitorHeaders({
      Host: 'evil.com',
      'X-Forwarded-Host': 'evil.com',
      'content-length': '5',
      Connection: 'keep-alive',
      Authorization: 'Bearer abc',
      'User-Agent': 'mon',
    });
    expect(out).toEqual({ Authorization: 'Bearer abc', 'User-Agent': 'mon' });
  });
});
