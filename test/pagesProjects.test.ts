import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as api from '../src/api';
import { migratePagesProjects } from '../src/migrate/pages-projects';
import type { MigrationReport, ZoneExport, ReportSection } from '../src/types';

function makeReport(): MigrationReport {
  return {
    timestamp: 'now',
    sourceZone: 's',
    destZone: 'd',
    destAccountId: 'acct',
    summary: { total: 0, success: 0, failed: 0, skipped: 0 },
    sections: [],
    errors: [],
    conflicts: [],
    warnings: [],
    manualActions: [],
    newNameservers: [],
  };
}

const deps = {
  destAuth: 'token' as const,
  destAccountId: 'acct',
  log: () => {},
  trackSection: (s: ReportSection) => s,
  onItemDone: () => {},
  resolveConflict: async () => 'skip' as const,
};

const GIT_ERR =
  'There is an internal issue with your Cloudflare Pages Git installation. ' +
  'If this issue persists after reinstalling your installation, contact support: https://cfl.re/3WgEyrH.';

describe('migratePagesProjects — git-backed project on an account without the Git connection', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('acknowledges (not fails) a git-backed project that hits the Pages Git-installation error', async () => {
    vi.spyOn(api, 'createPagesProject').mockRejectedValue(new Error(GIT_ERR));
    const report = makeReport();
    const exportData = {
      pagesProjects: [
        { name: 'ross-gg', source: { type: 'github', config: { owner: 'me', repo_name: 'ross-gg', production_branch: 'main' } } },
      ],
    } as unknown as ZoneExport;

    await migratePagesProjects(exportData, report, deps);

    const sec = report.sections.find(s => s.name === 'Pages Projects')!;
    expect(sec).toBeDefined();
    // Principle 1: this is acknowledged, NOT failed.
    expect(sec.failed).toBe(0);
    expect(sec.acknowledged).toBe(1);
    expect(sec.items[0].status).toBe('acknowledged');
    // No entry in the hard-error list.
    expect(report.errors).toHaveLength(0);
    // A recreate-via-Git manual action is surfaced with the repo reference.
    expect(report.manualActions.some(a => /reconnect|Connect to Git/i.test(a) && a.includes('me/ross-gg'))).toBe(true);
  });

  it('still fails on a genuine unexpected error (no silent downgrade)', async () => {
    vi.spyOn(api, 'createPagesProject').mockRejectedValue(new Error('500 internal server error'));
    const report = makeReport();
    const exportData = {
      pagesProjects: [{ name: 'broken', source: { type: 'github', config: { owner: 'me', repo_name: 'broken' } } }],
    } as unknown as ZoneExport;

    await migratePagesProjects(exportData, report, deps);

    const sec = report.sections.find(s => s.name === 'Pages Projects')!;
    expect(sec.failed).toBe(1);
    expect(sec.acknowledged ?? 0).toBe(0);
    expect(report.errors.length).toBe(1);
  });
});
