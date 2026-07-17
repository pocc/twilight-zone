import { describe, it, expect } from 'vitest';
import { parseCurl, tokenizeCurl } from '../app/lib/parseCurl';

describe('tokenizeCurl', () => {
  it('honors single and double quotes and line continuations', () => {
    expect(tokenizeCurl("curl 'https://a.b/c' -H \"X: y z\"")).toEqual(['curl', 'https://a.b/c', '-H', 'X: y z']);
    expect(tokenizeCurl('curl https://a.b \\\n  -X POST')).toEqual(['curl', 'https://a.b', '-X', 'POST']);
  });
});

describe('parseCurl', () => {
  it('parses a bare GET', () => {
    expect(parseCurl("curl 'https://enttest.example.com/health'")).toEqual({
      url: 'https://enttest.example.com/health', method: 'GET', headers: {},
    });
  });

  it('parses method, headers, and body', () => {
    const r = parseCurl(`curl -X POST -H 'Authorization: Bearer x' -H 'Content-Type: application/json' -d '{"a":1}' https://api.enttest.example.com/v1`);
    expect(r).toEqual({
      url: 'https://api.enttest.example.com/v1',
      method: 'POST',
      headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
  });

  it('defaults to POST when a body is present and no -X given', () => {
    expect(parseCurl("curl -d 'x=1' https://enttest.example.com/f")?.method).toBe('POST');
  });

  it('handles --url, -A, -b, -e', () => {
    const r = parseCurl("curl --url https://enttest.example.com/ -A 'Mozilla/5' -b 'k=v' -e 'https://ref'");
    expect(r?.url).toBe('https://enttest.example.com/');
    expect(r?.headers['User-Agent']).toBe('Mozilla/5');
    expect(r?.headers['Cookie']).toBe('k=v');
    expect(r?.headers['Referer']).toBe('https://ref');
  });

  it('ignores unknown boolean flags and still finds the positional URL', () => {
    const r = parseCurl("curl -sSL --compressed -k https://enttest.example.com/x -H 'A: b'");
    expect(r?.url).toBe('https://enttest.example.com/x');
    expect(r?.headers).toEqual({ A: 'b' });
    expect(r?.method).toBe('GET');
  });

  it('returns null when no URL is present', () => {
    expect(parseCurl("curl -X GET -H 'A: b'")).toBeNull();
  });
});
