/** Shared client-side types used across multiple components/hooks. */

/** User-provided Origin CA cert re-issuance input. CSR encodes a fresh
 * private key that stays client-side. */
export interface OriginCaCsrInput {
  /** Source cert ID this input replaces - empty string for a brand-new cert. */
  sourceId: string;
  hostnames: string[];
  csr: string;
  request_type: 'origin-rsa' | 'origin-ecc';
  requested_validity: number;
}
