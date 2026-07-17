import { describe, it, expect } from 'vitest';
import { isEmptyEnvelopeEntitlementGap } from '../src/migrate/zone-extras';
import { EmptyEnvelopeError } from '../src/api';

// Regression (#6): the Secondary DNS acknowledge path must treat ONLY a genuine
// unprovisioned-feature signal (a 4xx empty envelope that is NOT auth/perm/rate)
// as an entitlement gap. Auth (401), permission (403), throttling (429), and
// any 5xx must NOT be acknowledged — they are operational failures that must
// stay `failed` so a broken token or outage surfaces instead of being hidden
// behind a calm "Secondary DNS is gated" message.
describe('isEmptyEnvelopeEntitlementGap (#6)', () => {
  it('acknowledges a bare 400 empty envelope (real entitlement gap)', () => {
    expect(isEmptyEnvelopeEntitlementGap(new EmptyEnvelopeError('/x', 400))).toBe(true);
    expect(isEmptyEnvelopeEntitlementGap(new EmptyEnvelopeError('/x', 404))).toBe(true);
  });

  it('does NOT acknowledge 401/403/429 (operational failures to fix)', () => {
    expect(isEmptyEnvelopeEntitlementGap(new EmptyEnvelopeError('/x', 401))).toBe(false);
    expect(isEmptyEnvelopeEntitlementGap(new EmptyEnvelopeError('/x', 403))).toBe(false);
    expect(isEmptyEnvelopeEntitlementGap(new EmptyEnvelopeError('/x', 429))).toBe(false);
  });

  it('does NOT acknowledge 5xx (server/transient failure)', () => {
    expect(isEmptyEnvelopeEntitlementGap(new EmptyEnvelopeError('/x', 500))).toBe(false);
    expect(isEmptyEnvelopeEntitlementGap(new EmptyEnvelopeError('/x', 503))).toBe(false);
  });

  it('does NOT acknowledge a plain Error (only the tagged empty envelope qualifies)', () => {
    expect(isEmptyEnvelopeEntitlementGap(new Error('API request failed after retries'))).toBe(false);
    expect(isEmptyEnvelopeEntitlementGap('boom')).toBe(false);
  });
});
