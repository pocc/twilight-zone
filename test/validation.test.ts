import { describe, it, expect } from 'vitest';
import { generateValidationWarnings } from '../app/lib/validation';
import type { ZoneExport, CFDNSRecord } from '../src/types';

// generateValidationWarnings only reads a handful of optional-chained fields, so
// a partial fixture cast to ZoneExport is sufficient and keeps these tests focused
// on the in-zone self-reference detection rather than the full export shape.
function makeExport(zoneName: string, dnsRecords: Partial<CFDNSRecord>[]): ZoneExport {
  return {
    zone: { name: zoneName },
    dnsRecords: dnsRecords.map((r, i) => ({
      id: `rec-${i}`, type: 'CNAME', name: `r${i}.${zoneName}`,
      content: '', ttl: 1, ...r,
    })),
  } as unknown as ZoneExport;
}

function selfRefWarning(warnings: ReturnType<typeof generateValidationWarnings>) {
  return warnings.find(w => w.group === 'dns-selfref');
}

describe('generateValidationWarnings — in-zone DNS self-references', () => {
  it('emits an info warning listing records whose target points inside the zone', () => {
    const data = makeExport('source.com', [
      { type: 'CNAME', name: 'www.source.com', content: 'app.source.com' },
    ]);
    const w = selfRefWarning(generateValidationWarnings(data));
    expect(w).toBeDefined();
    expect(w!.type).toBe('info');
    expect(w!.title).toContain('1 DNS record');
    expect(w!.details).toContain('CNAME www.source.com → app.source.com');
  });

  it('does NOT warn when every target is external (the common, safe case)', () => {
    const data = makeExport('source.com', [
      { type: 'CNAME', name: 'www.source.com', content: 'd111.cloudfront.net' },
      { type: 'MX', name: 'source.com', content: 'aspmx.l.google.com', priority: 1 },
      { type: 'A', name: 'source.com', content: '192.0.2.1' },
    ]);
    expect(selfRefWarning(generateValidationWarnings(data))).toBeUndefined();
  });

  it('counts multiple matches and truncates the sample past 10 with "+N more"', () => {
    const recs = Array.from({ length: 12 }, (_, i) => ({
      type: 'CNAME', name: `a${i}.source.com`, content: 'apex.source.com',
    }));
    const w = selfRefWarning(generateValidationWarnings(makeExport('source.com', recs)));
    expect(w).toBeDefined();
    expect(w!.title).toContain('12 DNS record');
    expect(w!.details).toContain('+2 more');
  });

  it('does not crash or false-positive when the zone name is missing', () => {
    const data = makeExport('', [{ type: 'CNAME', name: 'www', content: 'app' }]);
    expect(selfRefWarning(generateValidationWarnings(data))).toBeUndefined();
  });
});
