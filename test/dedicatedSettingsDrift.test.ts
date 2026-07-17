import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ZONE_SETTINGS } from '../src/fuzz';

// Gap 2 guard — dedicated zone-setting drift, enforced OFFLINE in CI.
//
// Most zone settings are migrated dynamically (whatever the aggregate
// GET /zones/{id}/settings returns), so they self-heal. But some settings live
// ONLY behind their own dedicated endpoint — `PATCH /zones/{id}/settings/<id>` —
// and are NOT in the aggregate response (csam_scanner_third_party, speed_brain,
// fonts, rum, …). Those are migrated only if they have an entry in the
// ZONE_SETTINGS catalog (src/fuzz.ts). If Cloudflare ships a NEW dedicated
// setting and nobody adds it to ZONE_SETTINGS, the migration silently drops it
// (this is exactly the CSAM incident — see the comment at src/fuzz.ts).
//
// The live, runtime defense is the daily spec-drift monitor
// (src/worker/spec-monitor.ts), which pings Google Chat when a new write
// endpoint appears. THIS test is the offline, deterministic CI complement: it
// diffs the COMMITTED OpenAPI write manifest (regenerated via
// `npm run generate:openapi-manifest`) against ZONE_SETTINGS and fails the build
// when the manifest exposes a dedicated `/settings/<id>` endpoint that is
// neither catalogued nor explicitly exempted. So the moment someone regenerates
// the manifest and picks up a new dedicated setting, `npm test` goes red until
// they add it to ZONE_SETTINGS (or exempt it here) — not a silent gap.

// Dedicated `/settings/<id>` endpoints that intentionally have NO ZONE_SETTINGS
// entry, with the reason. Each must still be present in the manifest (the
// "no stale exemptions" test below keeps this list honest).
const EXEMPT: Record<string, string> = {
  // Aegis Dedicated Ingress IPs — account-tied, provisioned per-account by
  // Cloudflare. Catalogued in IMPOSSIBLE_TO_MIGRATE (key: aegis_ips), not a
  // migrate-able zone setting.
  aegis: 'account-tied (Aegis Dedicated Ingress IPs — IMPOSSIBLE_TO_MIGRATE.aegis_ips)',
  // Auto Origin TLS Key Exchange — its PATCH body is { enabled }, NOT the
  // standard { value } the settings loop sends, so it is migrated as its own
  // singleton (api.updateAutoOriginTlsKex, zone-extras.ts) rather than via
  // ZONE_SETTINGS. The dedicated getter/setter give it a literal cfFetch path
  // so coverage counts it implemented.
  auto_origin_tls_kex: 'singleton with { enabled } body (not the { value } settings-loop shape) — migrated via api.updateAutoOriginTlsKex',
};

type WriteOp = { method?: string; path?: string; shape?: string };

function manifestDedicatedSettingIds(): string[] {
  const p = fileURLToPath(new URL('../src/openapi-writes.generated.json', import.meta.url));
  const manifest = JSON.parse(readFileSync(p, 'utf8')) as { operations?: WriteOp[] };
  const ops = Array.isArray(manifest.operations) ? manifest.operations : [];
  const ids = new Set<string>();
  for (const op of ops) {
    const pathStr = op.path || op.shape || '';
    // Literal trailing segment only (not the templated /settings/{setting_id}).
    const m = /\/zones\/\{[^}]*\}\/settings\/([a-z0-9_]+)$/.exec(pathStr);
    if (m) ids.add(m[1]);
  }
  return [...ids].sort();
}

describe('dedicated zone-setting drift (manifest vs ZONE_SETTINGS)', () => {
  const catalog = new Set(ZONE_SETTINGS.map(s => s.id));
  const manifestIds = manifestDedicatedSettingIds();

  it('parses at least the known dedicated settings (guard against a vacuous pass)', () => {
    // If this drops to ~0, the manifest shape changed and the regex below is
    // silently matching nothing — which would make the drift test meaningless.
    expect(manifestIds.length).toBeGreaterThanOrEqual(5);
    expect(manifestIds).toContain('csam_scanner_third_party');
  });

  it('every dedicated /settings/<id> endpoint is catalogued in ZONE_SETTINGS or explicitly exempted', () => {
    const undeclared = manifestIds.filter(id => !catalog.has(id) && !(id in EXEMPT));
    expect(
      undeclared,
      `New dedicated zone setting(s) in the OpenAPI manifest are missing from ZONE_SETTINGS ` +
        `(src/fuzz.ts) and not exempted: ${undeclared.join(', ')}. ` +
        `These will be SILENTLY DROPPED during migration (the aggregate GET does not return them). ` +
        `Add a ZONE_SETTINGS entry for each migrate-able one, or add it to EXEMPT in this test with a reason.`,
    ).toEqual([]);
  });

  it('has no stale exemptions (every EXEMPT id still exists in the manifest)', () => {
    const stale = Object.keys(EXEMPT).filter(id => !manifestIds.includes(id));
    expect(
      stale,
      `EXEMPT lists dedicated setting(s) no longer present in the OpenAPI manifest: ${stale.join(', ')}. ` +
        `Remove them from EXEMPT to keep the exemption list honest.`,
    ).toEqual([]);
  });
});
