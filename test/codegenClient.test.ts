import { describe, it, expect } from 'vitest';
import { generateApiCode, getCodeFileExtension, type ApiCall } from '../app/lib/codegen';

// app/lib/codegen.ts powers the Step 2 "Download script" button (#19 Part D)
// and the Step 4 dry-run code export. Because the downloaded file leaves the
// tool, it MUST never embed real credentials — only env-var placeholders and
// the non-secret zone/account identifiers. These tests lock that guarantee for
// every supported language. (The server-side src/codegen.ts is covered
// separately in codegen.test.ts.)

const calls: ApiCall[] = [
  { method: 'POST', endpoint: '/zones', description: 'Create zone', count: 1 },
  { method: 'POST', endpoint: '/zones/:zone_id/dns_records', description: 'Create DNS records', count: 5 },
  { method: 'PUT', endpoint: '/accounts/:account_id/workers/scripts/x', description: 'Upload worker', count: 1 },
];

const ZONE_ID = 'zone-abc-123';
const ACCOUNT_ID = 'acct-xyz-789';
const FORMATS = ['typescript', 'curl', 'python', 'go', 'terraform'] as const;

// The token placeholder each generator is expected to emit (env-var read).
const ENV_PLACEHOLDER: Record<string, string> = {
  typescript: 'process.env.CF_API_TOKEN',
  curl: '$CF_API_TOKEN',
  python: 'os.environ["CF_API_TOKEN"]',
  go: 'os.Getenv("CF_API_TOKEN")',
};

describe('app/lib/codegen generateApiCode', () => {
  it('emits a runnable scaffold for every format', () => {
    for (const fmt of FORMATS) {
      const code = generateApiCode(fmt, calls, ZONE_ID, ACCOUNT_ID);
      expect(code.length, `${fmt} produced empty output`).toBeGreaterThan(0);
    }
  });

  it('reads the token from the environment, never embedding a literal token', () => {
    // A token-shaped secret that must NOT appear in any generated file.
    const fakeToken = 'v1.0-deadbeefcafebabe-SECRETTOKEN';
    for (const fmt of FORMATS) {
      const code = generateApiCode(fmt, calls, ZONE_ID, ACCOUNT_ID);
      // The codegen signature has no token parameter, so a real secret can't
      // even reach it — assert the secret is absent as defence-in-depth.
      expect(code, `${fmt} must not embed a literal token`).not.toContain(fakeToken);
      const placeholder = ENV_PLACEHOLDER[fmt];
      if (placeholder) {
        expect(code, `${fmt} must read CF_API_TOKEN from env`).toContain(placeholder);
      }
      // No format should hard-code a bare "Bearer <hex>" literal.
      expect(code).not.toMatch(/Bearer [0-9a-f]{32,}/);
    }
  });

  it('embeds the non-secret zone and account identifiers', () => {
    // terraform output is a comment-only scaffold and intentionally omits IDs.
    for (const fmt of ['typescript', 'curl', 'python', 'go'] as const) {
      const code = generateApiCode(fmt, calls, ZONE_ID, ACCOUNT_ID);
      expect(code, `${fmt} should include the zone id`).toContain(ZONE_ID);
      expect(code, `${fmt} should include the account id`).toContain(ACCOUNT_ID);
    }
  });

  it('tolerates an empty zone id (pre-run: dest zone not created yet)', () => {
    for (const fmt of FORMATS) {
      expect(() => generateApiCode(fmt, calls, '', ACCOUNT_ID)).not.toThrow();
    }
  });

  it('maps each format to the right file extension', () => {
    expect(getCodeFileExtension('typescript')).toBe('.ts');
    expect(getCodeFileExtension('curl')).toBe('.sh');
    expect(getCodeFileExtension('python')).toBe('.py');
    expect(getCodeFileExtension('go')).toBe('.go');
    expect(getCodeFileExtension('terraform')).toBe('.tf');
    expect(getCodeFileExtension('unknown')).toBe('.txt');
  });

  it('falls back to TypeScript for an unknown format', () => {
    const code = generateApiCode('cobol', calls, ZONE_ID, ACCOUNT_ID);
    expect(code).toContain('process.env.CF_API_TOKEN');
  });
});
