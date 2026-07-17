import { describe, it, expect } from 'vitest';
import { getItemDetail, genericFields } from '../app/components/steps/scope/itemDetail';

/** Helper: turn a DetailField[] into a "Label=Value" lookup for assertions. */
function asMap(fields: { label: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.label, f.value]));
}

describe('getItemDetail — curated formatters', () => {
  it('DNS record shows type, name, content, TTL, proxied', () => {
    const m = asMap(getItemDetail('dnsRecords', {
      id: 'r1', type: 'A', name: 'www.example.com', content: '1.2.3.4', ttl: 1, proxied: true,
    }));
    expect(m).toMatchObject({ Type: 'A', Name: 'www.example.com', Content: '1.2.3.4', TTL: 'Auto', Proxied: 'Yes' });
  });

  it('DNS record renders a numeric TTL and unproxied flag', () => {
    const m = asMap(getItemDetail('dnsRecords', {
      type: 'MX', name: 'example.com', content: 'mail.example.com', ttl: 3600, proxied: false, priority: 10,
    }));
    expect(m.TTL).toBe('3600');
    expect(m.Proxied).toBe('No');
    expect(m.Priority).toBe('10');
  });

  it('zone setting renders id = value', () => {
    const fields = getItemDetail('settings', { id: 'ssl', value: 'flexible', editable: true });
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ label: 'ssl', value: 'flexible' });
  });

  it('zone setting stringifies object/array values', () => {
    const fields = getItemDetail('settings', { id: 'ciphers', value: ['AES128', 'AES256'] });
    expect(fields[0].value).toBe('["AES128","AES256"]');
  });

  it('ruleset shows phase and inlines each rule expression + action', () => {
    const fields = getItemDetail('rulesets', {
      phase: 'http_request_firewall_custom',
      rules: [
        { expression: 'ip.src eq 1.1.1.1', action: 'block' },
        { expression: 'http.host eq "a.com"', action: 'skip', description: 'allow a.com' },
      ],
    });
    const m = asMap(fields);
    expect(m.Phase).toBe('http_request_firewall_custom');
    expect(m.Rules).toBe('2');
    expect(m['Rule 1']).toContain('ip.src eq 1.1.1.1');
    expect(m['Rule 1']).toContain('→ block');
    expect(m['Rule 2']).toContain('allow a.com');
  });

  it('page rule shows target and actions', () => {
    const m = asMap(getItemDetail('pageRules', {
      targets: [{ constraint: { value: '*example.com/*' } }],
      actions: [{ id: 'always_use_https' }, { id: 'cache_level', value: 'aggressive' }],
      priority: 1, status: 'active',
    }));
    expect(m.Target).toBe('*example.com/*');
    expect(m.Actions).toContain('always_use_https');
    expect(m.Actions).toContain('cache_level=aggressive');
    expect(m.Status).toBe('active');
  });

  it('LB pool lists origins with addresses + monitor', () => {
    const m = asMap(getItemDetail('pools', {
      origins: [{ name: 'o1', address: '10.0.0.1' }, { name: 'o2', address: '10.0.0.2' }],
      monitor: 'mon-123', enabled: true,
    }));
    expect(m.Origins).toContain('o1 (10.0.0.1)');
    expect(m.Origins).toContain('o2 (10.0.0.2)');
    expect(m.Monitor).toBe('mon-123');
    expect(m.Enabled).toBe('Yes');
  });

  it('worker summarizes binding types', () => {
    const m = asMap(getItemDetail('workers', {
      id: 'my-worker',
      bindings: [{ type: 'kv_namespace' }, { type: 'kv_namespace' }, { type: 'r2_bucket' }],
    }));
    expect(m.Script).toBe('my-worker');
    expect(m.Bindings).toContain('3');
    expect(m.Bindings).toContain('kv_namespace×2');
    expect(m.Bindings).toContain('r2_bucket');
  });
});

describe('getItemDetail — durable objects (array raw)', () => {
  it('summarizes classes and namespace count from the grouped array', () => {
    const m = asMap(getItemDetail('durableObjects', [
      { class: 'Counter', script: 'w', name: 'n1', id: 'i1' },
      { class: 'Room', script: 'w', name: 'n2', id: 'i2' },
    ]));
    expect(m.Classes).toBe('Counter, Room');
    expect(m.Namespaces).toBe('2');
  });
});

describe('genericFields — fallback', () => {
  it('surfaces scalar fields for an unknown group key', () => {
    const m = asMap(getItemDetail('someFutureType', { name: 'thing', count: 5, active: true, id: 'skip-me' }));
    expect(m.Name).toBe('thing');
    expect(m.Count).toBe('5');
    expect(m.Active).toBe('true');
    // id is in the skip list
    expect(m.Id).toBeUndefined();
  });

  it('skips nested objects/arrays and long blobs, caps field count', () => {
    const big: Record<string, unknown> = { nested: { a: 1 }, list: [1, 2], blob: 'x'.repeat(500) };
    for (let i = 0; i < 20; i++) big[`f${i}`] = `v${i}`;
    const fields = genericFields(big);
    expect(fields.length).toBeLessThanOrEqual(8);
    expect(fields.find((f) => f.label === 'Nested')).toBeUndefined();
    expect(fields.find((f) => f.label === 'Blob')).toBeUndefined();
  });

  it('handles null/empty raw without throwing', () => {
    expect(getItemDetail('dnsRecords', null)).toEqual([]);
    expect(getItemDetail('settings', undefined)).toEqual([]);
    expect(genericFields(null)).toEqual([]);
  });
});
