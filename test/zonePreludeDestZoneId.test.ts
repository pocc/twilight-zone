import { describe, expect, it, vi } from 'vitest';

// createOrFindDestZone makes two API calls: createZone (happy path) and, on
// failure, listZones (existing-zone fallback). Mock both so we can exercise
// each branch without touching the network.
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    createZone: vi.fn(),
    listZones: vi.fn(),
  };
});

import * as api from '../src/api';
import { createOrFindDestZone } from '../src/migrate/zone-prelude';
import { createEmptyReport } from '../src/migrate/setup';

const ZONE_NAME = 'dest.example.com';
const DEST_ACCOUNT = 'dest-account';

function zone(id: string) {
  return {
    id,
    name: ZONE_NAME,
    name_servers: ['ns1.example.net', 'ns2.example.net'],
    status: 'active',
    account: { id: DEST_ACCOUNT, name: 'Dest' },
    plan: { id: 'free', name: 'Free' },
  };
}

function freshReport() {
  return createEmptyReport({ zone: { name: 'source.example.com' } }, ZONE_NAME, DEST_ACCOUNT);
}

describe('createOrFindDestZone — destZoneId is always recorded', () => {
  it('sets BOTH destZoneId and createdResources.zoneId when the zone is created', async () => {
    vi.mocked(api.createZone).mockResolvedValue(zone('new-zone') as never);
    const report = freshReport();

    const { newZone, zoneWasCreated } = await createOrFindDestZone(
      'dest-token', DEST_ACCOUNT, ZONE_NAME, report, () => undefined,
    );

    expect(zoneWasCreated).toBe(true);
    expect(newZone.id).toBe('new-zone');
    expect(report.destZoneId).toBe('new-zone');
    // We created it, so the rollback/stats-scoped id is also set.
    expect(report.createdResources!.zoneId).toBe('new-zone');
  });

  it('sets destZoneId — but NOT createdResources.zoneId — when an existing zone is reused', async () => {
    // Creation fails (e.g. "already exists" / rate limit), then we find the
    // existing destination-account zone. This is the Terraform-import case that
    // previously left destZoneId unset and wrongly disabled "Verify Now".
    vi.mocked(api.createZone).mockRejectedValue(new Error('zone already exists'));
    vi.mocked(api.listZones).mockResolvedValue([zone('existing-zone')] as never);
    const report = freshReport();

    const { newZone, zoneWasCreated } = await createOrFindDestZone(
      'dest-token', DEST_ACCOUNT, ZONE_NAME, report, () => undefined,
    );

    expect(zoneWasCreated).toBe(false);
    expect(newZone.id).toBe('existing-zone');
    // Regression guard: verification keys off destZoneId, so it MUST be set for
    // a reused zone.
    expect(report.destZoneId).toBe('existing-zone');
    // But we did NOT create it — rollback must not delete a pre-existing zone
    // and the "zones migrated" counter must not count it.
    expect(report.createdResources!.zoneId).toBeUndefined();
  });
});
