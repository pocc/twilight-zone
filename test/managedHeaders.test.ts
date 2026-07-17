import { describe, it, expect } from 'vitest';
import { partitionManagedHeaders } from '../src/migrate/managed-headers';
import type { ManagedHeadersConfig } from '../src/api';

describe('partitionManagedHeaders (B7)', () => {
  // The exact regression: a source zone enables a managed transform
  // (add_true_client_ip_headers) the destination plan doesn't expose.
  // Sending it fails the whole PATCH; partitioning keeps it out and
  // flags it as dropped (→ acknowledged at the call site).
  const destCatalog: ManagedHeadersConfig = {
    managed_request_headers: [
      { id: 'add_visitor_location_headers', enabled: false },
      { id: 'add_cf_bot_score_header', enabled: false },
    ],
    managed_response_headers: [
      { id: 'remove_x-powered-by_header', enabled: false },
    ],
  };

  it('drops enabled source rules absent from the dest catalog', () => {
    const src: ManagedHeadersConfig = {
      managed_request_headers: [
        { id: 'add_visitor_location_headers', enabled: true },
        { id: 'add_true_client_ip_headers', enabled: true }, // not on dest
      ],
      managed_response_headers: [
        { id: 'remove_x-powered-by_header', enabled: true },
      ],
    };
    const plan = partitionManagedHeaders(src, destCatalog);
    expect(plan.keptRequest.map(h => h.id)).toEqual(['add_visitor_location_headers']);
    expect(plan.keptResponse.map(h => h.id)).toEqual(['remove_x-powered-by_header']);
    expect(plan.dropped.map(h => h.id)).toEqual(['add_true_client_ip_headers']);
  });

  it('does NOT report disabled unavailable rules as dropped (they are no-ops)', () => {
    const src: ManagedHeadersConfig = {
      managed_request_headers: [
        { id: 'add_true_client_ip_headers', enabled: false }, // unavailable but off
      ],
    };
    const plan = partitionManagedHeaders(src, destCatalog);
    expect(plan.dropped).toEqual([]);
    expect(plan.keptRequest).toEqual([]);
  });

  it('keeps all rules when the dest catalog exposes them all', () => {
    const src: ManagedHeadersConfig = {
      managed_request_headers: [
        { id: 'add_visitor_location_headers', enabled: true },
        { id: 'add_cf_bot_score_header', enabled: true },
      ],
      managed_response_headers: [
        { id: 'remove_x-powered-by_header', enabled: true },
      ],
    };
    const plan = partitionManagedHeaders(src, destCatalog);
    expect(plan.keptRequest).toHaveLength(2);
    expect(plan.keptResponse).toHaveLength(1);
    expect(plan.dropped).toEqual([]);
  });

  it('handles empty/undefined header arrays without throwing', () => {
    expect(partitionManagedHeaders({}, {})).toEqual({
      keptRequest: [], keptResponse: [], dropped: [],
    });
  });
});
