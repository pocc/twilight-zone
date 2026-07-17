import { describe, it, expect } from 'vitest';
import {
  DEDICATED_RUNTIME_ID_ALIASES,
  dedicatedEndpointId,
} from '../src/migrate/dedicated-settings';
import { curatedSettingsAbsentFromAggregate } from '../src/fuzz';

// Regression guard for the CSAM "false missing" bug (Principle 1 — No Surprise
// Failures). The CF API serves CSAM third-party scanning at
// /zones/{id}/settings/csam_scanner_third_party but returns result.id =
// "csam_scanner". Migrate stores/reports it under the runtime id "csam_scanner",
// while the post-migrate verifier's dedicated-endpoint set is keyed on the
// curated def id "csam_scanner_third_party". The alias bridges the two so the
// GET-back resolves and the setting verifies instead of showing "missing".
describe('dedicated-endpoint runtime-id alias (csam false-missing fix)', () => {
  it('maps the csam runtime id to its dedicated endpoint id', () => {
    expect(dedicatedEndpointId('csam_scanner')).toBe('csam_scanner_third_party');
    expect(DEDICATED_RUNTIME_ID_ALIASES.csam_scanner).toBe('csam_scanner_third_party');
  });

  it('passes through any setting id that has no alias', () => {
    for (const id of ['speed_brain', 'fonts', 'ssl', 'min_tls_version', 'rum']) {
      expect(dedicatedEndpointId(id)).toBe(id);
    }
  });

  // This ties the alias to the actual data shape it compensates for: the curated
  // dedicated-settings list (what drives the verifier's fallback set) contains
  // the ENDPOINT id, not the runtime id. If someone later renames the def to the
  // runtime id, this test fails and points them at the alias to keep in sync.
  it('alias target is a real curated dedicated endpoint; runtime id is not', () => {
    const curatedIds = curatedSettingsAbsentFromAggregate(new Set<string>()).map(d => d.id);
    for (const [runtimeId, endpointId] of Object.entries(DEDICATED_RUNTIME_ID_ALIASES)) {
      expect(curatedIds).toContain(endpointId);     // endpoint id is curated/dedicated
      expect(curatedIds).not.toContain(runtimeId);  // runtime id absent → why the alias exists
    }
  });

  it('migration code uses the endpoint id when PATCHing dedicated settings', () => {
    expect(dedicatedEndpointId('csam_scanner')).toBe('csam_scanner_third_party');
  });
});
