import { describe, it, expect } from 'vitest';
import {
  normalizeUrlNormalization,
  normalizeOriginPostQuantumValue,
  normalizeFraudDetectionSettings,
  normalizePageShieldSettings,
  normalizeSchemaValidationSettings,
  normalizeAcmTotalTls,
  normalizeCtAlerting,
  normalizeEmailRoutingSettings,
} from '../src/api';

// Regression for the 2026-06-09 E2E run: six zone-singleton PUT/POSTs replayed
// the raw GET *result* (cfFetch unwraps `data.result`) verbatim, which carries
// read-only envelope fields and can even be an array. The destination rejected
// the malformed bodies as FAILED rows (Principle 1 violation):
//   Fraud Detection:  "json: cannot unmarshal array into ... fraudzones.JSONSettings"
//   Page Shield:      "invalid JSON"
//   Schema Validation:"Bad request"
//   ACM Total TLS:    "Unable to decode the JSON request body"
//   Origin PQE:       "Unable to parse zone setting value"
//   URL Normalization:"invalid JSON: '' cannot be a array"
// The fixtures below are the EXACT captured source shapes from that run
// (test/e2e-migrations/e09-storage-roundtrip/source-state-post-seed/*.json).
// Each normalizer must emit only the documented writable contract.

describe('normalizeFraudDetectionSettings', () => {
  it('keeps only the 3 writable fields from a captured object result', () => {
    expect(normalizeFraudDetectionSettings({ user_profiles: 'disabled', username_expressions: [] }))
      .toEqual({ user_profiles: 'disabled', username_expressions: [] });
  });

  it('never emits an array (the "cannot unmarshal array" root cause)', () => {
    // Unconfigured / no-subscription zones return result: [] — replaying it
    // verbatim is what produced the Go unmarshal error.
    expect(normalizeFraudDetectionSettings([])).toEqual({});
    expect(Array.isArray(normalizeFraudDetectionSettings([{ x: 1 }]))).toBe(false);
  });

  it('drops unknown/read-only fields', () => {
    expect(normalizeFraudDetectionSettings({ user_profiles: 'enabled', bogus: 1, modified_on: 'x' }))
      .toEqual({ user_profiles: 'enabled' });
  });

  it('passes authentication_settings through', () => {
    const auth = { failure_criteria: { kind: 'status_code', status_codes: [401] } };
    expect(normalizeFraudDetectionSettings({ authentication_settings: auth }))
      .toEqual({ authentication_settings: auth });
  });
});

describe('normalizePageShieldSettings', () => {
  it('drops read-only updated_at, keeps the 3 writable booleans', () => {
    expect(normalizePageShieldSettings({
      enabled: false,
      updated_at: '0001-01-01T00:00:00Z',
      use_cloudflare_reporting_endpoint: true,
      use_connection_url_path: false,
    })).toEqual({
      enabled: false,
      use_cloudflare_reporting_endpoint: true,
      use_connection_url_path: false,
    });
  });

  it('coerces a non-object to {}', () => {
    expect(normalizePageShieldSettings(null)).toEqual({});
    expect(normalizePageShieldSettings([])).toEqual({});
  });
});

describe('normalizeSchemaValidationSettings', () => {
  it('omits null validation_override_mitigation_action (the "Bad request" root cause)', () => {
    expect(normalizeSchemaValidationSettings({
      validation_default_mitigation_action: 'none',
      validation_override_mitigation_action: null,
    })).toEqual({ validation_default_mitigation_action: 'none' });
  });

  it('keeps a non-null override', () => {
    expect(normalizeSchemaValidationSettings({
      validation_default_mitigation_action: 'block',
      validation_override_mitigation_action: 'none',
    })).toEqual({
      validation_default_mitigation_action: 'block',
      validation_override_mitigation_action: 'none',
    });
  });
});

describe('normalizeAcmTotalTls', () => {
  it('drops read-only status and an empty certificate_authority (the "Unable to decode" root cause)', () => {
    expect(normalizeAcmTotalTls({ enabled: false, status: '' })).toEqual({ enabled: false });
  });

  it('keeps a valid certificate_authority', () => {
    expect(normalizeAcmTotalTls({ enabled: true, certificate_authority: 'lets_encrypt' }))
      .toEqual({ enabled: true, certificate_authority: 'lets_encrypt' });
  });

  it('drops an invalid certificate_authority', () => {
    expect(normalizeAcmTotalTls({ enabled: true, certificate_authority: 'bogus' }))
      .toEqual({ enabled: true });
  });

  it('coerces a missing enabled to false', () => {
    expect(normalizeAcmTotalTls({})).toEqual({ enabled: false });
  });
});

describe('normalizeUrlNormalization', () => {
  it('keeps {scope, type} from a captured result', () => {
    expect(normalizeUrlNormalization({ scope: 'incoming', type: 'cloudflare' }))
      .toEqual({ scope: 'incoming', type: 'cloudflare' });
  });

  it('strips extra/envelope fields that cause "\'\' cannot be a array"', () => {
    expect(normalizeUrlNormalization({
      scope: 'both', type: 'rfc3986', errors: [], messages: [], success: true,
    })).toEqual({ scope: 'both', type: 'rfc3986' });
  });

  it('falls back to CF defaults when fields are missing/empty', () => {
    expect(normalizeUrlNormalization({})).toEqual({ scope: 'incoming', type: 'cloudflare' });
    expect(normalizeUrlNormalization({ scope: '', type: '' })).toEqual({ scope: 'incoming', type: 'cloudflare' });
  });
});

describe('normalizeOriginPostQuantumValue', () => {
  it('accepts a bare valid enum', () => {
    expect(normalizeOriginPostQuantumValue('supported')).toBe('supported');
    expect(normalizeOriginPostQuantumValue('preferred')).toBe('preferred');
    expect(normalizeOriginPostQuantumValue('off')).toBe('off');
  });

  it('extracts value from the full GET result object', () => {
    expect(normalizeOriginPostQuantumValue({ editable: true, id: 'origin_pqe', value: 'supported' }))
      .toBe('supported');
  });

  it('returns null for missing/invalid value so the caller skips (no surprise failed row)', () => {
    expect(normalizeOriginPostQuantumValue(undefined)).toBeNull();
    expect(normalizeOriginPostQuantumValue('')).toBeNull();
    expect(normalizeOriginPostQuantumValue('garbage')).toBeNull();
    expect(normalizeOriginPostQuantumValue({})).toBeNull();
  });
});

describe('normalizeCtAlerting', () => {
  // PATCH /zones/{}/ct/alerting is additionalProperties:false with `enabled`
  // required. The GET result carries the same two fields, but replaying any
  // extra/read-only envelope key would yield a Bad Request (Principle 1).
  it('keeps enabled + non-empty emails from a captured subscription', () => {
    expect(normalizeCtAlerting({ enabled: true, emails: ['security@example.com', 'admin@example.com'] }))
      .toEqual({ enabled: true, emails: ['security@example.com', 'admin@example.com'] });
  });

  it('omits emails when absent or empty (Free/Pro zones have no recipient list)', () => {
    expect(normalizeCtAlerting({ enabled: true })).toEqual({ enabled: true });
    expect(normalizeCtAlerting({ enabled: false, emails: [] })).toEqual({ enabled: false });
  });

  it('drops unknown/read-only fields and coerces a missing enabled to false', () => {
    expect(normalizeCtAlerting({ enabled: true, success: true, errors: [], messages: [] }))
      .toEqual({ enabled: true });
    expect(normalizeCtAlerting({})).toEqual({ enabled: false });
  });

  it('never emits an array and filters non-string/empty emails', () => {
    expect(normalizeCtAlerting([])).toEqual({ enabled: false });
    expect(normalizeCtAlerting({ enabled: true, emails: ['ok@example.com', '', 42, null] }))
      .toEqual({ enabled: true, emails: ['ok@example.com'] });
  });
});

describe('normalizeEmailRoutingSettings', () => {
  // PATCH /zones/{}/email/routing accepts only { enabled?, skip_wizard?,
  // support_subaddress? }. The GET result carries read-only envelope fields
  // (id, name, status, created, modified, tag) that the PATCH rejects.
  it('keeps only the three writable booleans from a captured GET result', () => {
    expect(normalizeEmailRoutingSettings({
      id: 'abc', name: 'example.com', status: 'ready', tag: 'x',
      created: '2026-01-01', modified: '2026-01-02',
      enabled: true, skip_wizard: false, support_subaddress: true,
    })).toEqual({ enabled: true, skip_wizard: false, support_subaddress: true });
  });

  it('omits flags that are absent or non-boolean', () => {
    expect(normalizeEmailRoutingSettings({ support_subaddress: true })).toEqual({ support_subaddress: true });
    expect(normalizeEmailRoutingSettings({ support_subaddress: 'yes', skip_wizard: 1 })).toEqual({});
  });

  it('coerces a non-object (array / null) to {}', () => {
    expect(normalizeEmailRoutingSettings([])).toEqual({});
    expect(normalizeEmailRoutingSettings(null)).toEqual({});
  });
});
