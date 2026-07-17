// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Managed Headers (a.k.a. Managed Transforms) migration helper.
//
// The set of managed-transform rules a zone exposes depends on its
// plan/entitlements. PATCHing /zones/{id}/managed_headers with a rule the
// destination zone doesn't expose fails the ENTIRE request with e.g.:
//
//   rule 'add_true_client_ip_headers' is not found in the phase
//   http_request_late_transform_managed
//
// …which takes the valid rules down with it. To avoid that, we GET the
// destination catalog first and PATCH only the intersection, surfacing
// source rules that were ENABLED but aren't available on the destination
// as acknowledged (Principle 1: No Surprise Failures — the user can't add
// a managed transform their plan doesn't offer).
//
// This module is pure (no I/O) so the partition logic is unit-testable.

import type { ManagedHeader, ManagedHeadersConfig } from '../api';

export interface ManagedHeadersPlan {
  /** Request-header rules present in the dest catalog (safe to PATCH). */
  keptRequest: ManagedHeader[];
  /** Response-header rules present in the dest catalog (safe to PATCH). */
  keptResponse: ManagedHeader[];
  /** Source rules that were ENABLED but the dest doesn't expose. These
   *  represent lost functionality and must be acknowledged. Disabled
   *  source rules missing on the dest are no-ops and excluded here. */
  dropped: ManagedHeader[];
}

/**
 * Partition the source managed-headers config against the destination's
 * available catalog. Only rule IDs present in `destCatalog` can be PATCHed;
 * enabled source rules absent from the catalog are returned in `dropped`.
 */
export function partitionManagedHeaders(
  src: ManagedHeadersConfig,
  destCatalog: ManagedHeadersConfig,
): ManagedHeadersPlan {
  const availReq = new Set((destCatalog.managed_request_headers || []).map(h => h.id));
  const availRes = new Set((destCatalog.managed_response_headers || []).map(h => h.id));

  const srcReq = src.managed_request_headers || [];
  const srcRes = src.managed_response_headers || [];

  const keptRequest = srcReq.filter(h => availReq.has(h.id));
  const keptResponse = srcRes.filter(h => availRes.has(h.id));

  // Only enabled-but-unavailable rules represent lost functionality.
  const dropped = [
    ...srcReq.filter(h => h.enabled && !availReq.has(h.id)),
    ...srcRes.filter(h => h.enabled && !availRes.has(h.id)),
  ];

  return { keptRequest, keptResponse, dropped };
}
