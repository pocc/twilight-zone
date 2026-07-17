import { describe, it, expect } from 'vitest';
import {
  identicalKey,
  buildIdenticalSet,
  isItemIdentical,
} from '../app/components/steps/scope/identicalItems';

describe('identicalItems (Step 2 graying matching layer)', () => {
  describe('buildIdenticalSet', () => {
    it('builds keys and tolerates null/garbage entries', () => {
      const set = buildIdenticalSet([
        { resource: 'DNS Record', name: 'A www' },
        // @ts-expect-error - exercise runtime guard
        { resource: 'Zone Setting' },
        // @ts-expect-error - exercise runtime guard
        null,
      ]);
      expect(set.has(identicalKey('DNS Record', 'A www'))).toBe(true);
      expect(set.size).toBe(1);
    });

    it('returns an empty set for undefined input', () => {
      expect(buildIdenticalSet(undefined).size).toBe(0);
    });
  });

  describe('isItemIdentical', () => {
    const set = buildIdenticalSet([
      { resource: 'DNS Record', name: 'A www.example.com' },
      { resource: 'Zone Setting', name: 'ssl' },
      { resource: 'Page Rule', name: 'example.com/*' },
      { resource: 'Worker Route', name: 'example.com/api/*' },
    ]);

    it('matches a DNS record by type + name', () => {
      expect(isItemIdentical(set, 'dnsRecords', { type: 'A', name: 'www.example.com' })).toBe(true);
      expect(isItemIdentical(set, 'dnsRecords', { type: 'A', name: 'other.example.com' })).toBe(false);
    });

    it('matches a zone setting by id', () => {
      expect(isItemIdentical(set, 'settings', { id: 'ssl', value: 'full' })).toBe(true);
      expect(isItemIdentical(set, 'settings', { id: 'min_tls_version' })).toBe(false);
    });

    it('matches a page rule by first target constraint value', () => {
      expect(isItemIdentical(set, 'pageRules', { targets: [{ constraint: { value: 'example.com/*' } }] })).toBe(true);
    });

    it('matches a worker route by pattern', () => {
      expect(isItemIdentical(set, 'workerRoutes', { pattern: 'example.com/api/*' })).toBe(true);
    });

    it('never matches groups diff.ts does not compare', () => {
      expect(isItemIdentical(set, 'workers', { id: 'ssl' })).toBe(false);
      expect(isItemIdentical(set, 'loadBalancers', { name: 'ssl' })).toBe(false);
    });

    it('returns false for an empty identical set without inspecting raw', () => {
      expect(isItemIdentical(new Set(), 'dnsRecords', { type: 'A', name: 'www.example.com' })).toBe(false);
    });

    it('tolerates malformed raw without throwing', () => {
      expect(isItemIdentical(set, 'dnsRecords', null)).toBe(false);
      expect(isItemIdentical(set, 'dnsRecords', { type: 'A' })).toBe(false);
      expect(isItemIdentical(set, 'pageRules', { targets: [] })).toBe(false);
    });
  });
});
