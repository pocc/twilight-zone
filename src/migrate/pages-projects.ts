// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Pages Projects (account-scoped).
//
// Migrates project metadata + env vars + deployment_configs. The actual
// deployment bundles (static assets) are NOT migratable — each deployment
// is an immutable per-bundle upload. The dest project is created empty;
// user must `wrangler pages deploy` to populate it. Custom domains attached
// to the project are migrated as a follow-up step per-project.

import type { MigrationReport, ZoneExport, ReportSection } from '../types';
import type { LogFn } from '../migrate';
import * as api from '../api';
import { migrateItems } from '../migrate';
import { isPagesGitInstallationError } from './errors';

export interface PagesDeps {
  destAuth: api.ApiAuth | string;
  destAccountId: string;
  log: LogFn;
  trackSection: (s: ReportSection) => ReportSection;
  onItemDone: () => void;
  resolveConflict: (cat: string, name: string) => Promise<'overwrite' | 'skip'>;
}

export async function migratePagesProjects(
  exportData: ZoneExport,
  report: MigrationReport,
  deps: PagesDeps,
): Promise<void> {
  const { destAuth, destAccountId, log, trackSection, onItemDone, resolveConflict } = deps;

  if (!Array.isArray(exportData.pagesProjects) || exportData.pagesProjects.length === 0) return;

  log('⏳ Pages Projects...');
  const sec = await migrateItems('Pages Projects', exportData.pagesProjects, async (p) => {
    try {
      await api.createPagesProject(destAuth, destAccountId, p);
    } catch (e: unknown) {
      api.throwIfAuthError(e);
      const msg = (e as Error).message || '';
      if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('name is already taken')) {
        const strategy = await resolveConflict('storage', p.name);
        if (strategy === 'skip') throw e;
        log(`    ✓ Pages project "${p.name}" already exists`);
        return;
      }
      // Git-backed Pages projects can't be recreated via API on an account
      // that lacks the source's Git integration — CF returns the "Pages Git
      // installation" error. This is account-tied and unavoidable, not a
      // transient failure: acknowledge it with a recreate-via-Git manual
      // action (Principle 1) rather than surfacing a red FAILED row.
      if (isPagesGitInstallationError(msg)) {
        const repoRef =
          p.source?.config?.owner && p.source?.config?.repo_name
            ? `${p.source.config.owner}/${p.source.config.repo_name}`
            : p.source?.config?.repo_name;
        const branchRef = p.source?.config?.production_branch || p.production_branch;
        report.manualActions.push(
          `Pages Project "${p.name}" (git-backed) could not be recreated automatically: the destination account does not have the Git (GitHub/GitLab) connection this project depends on. ` +
            `Recreate it on the destination via Dashboard → Workers & Pages → Create → Pages → Connect to Git` +
            (repoRef ? `, selecting repo \`${repoRef}\`` : '') +
            (branchRef ? ` (branch \`${branchRef}\`)` : '') +
            `, then trigger a deployment. Cloudflare rebuilds from source, reproducing static assets AND Pages Functions.`,
        );
        throw new Error(
          `ACKNOWLEDGED: Git-backed project — the destination account lacks the source's Git connection, so it can't be created via API. Reconnect the repo on the destination (see Manual Actions).`,
        );
      }
      throw e;
    }
    // Attach custom domains after project creation.
    if (Array.isArray(p.domains) && p.domains.length > 0) {
      for (const domain of p.domains) {
        try {
          await api.addPagesProjectDomain(destAuth, destAccountId, p.name, domain);
        } catch (e: unknown) {
          api.throwIfAuthError(e);
          const dErr = (e as Error).message || '';
          // Don't fail the project create over a domain conflict.
          if (!dErr.toLowerCase().includes('already')) {
            log(`    ⚠ Pages project "${p.name}" — could not attach domain "${domain}": ${dErr}`);
          }
        }
      }
    }
    // Add a manual action note since deployment bundles must be
    // redeployed by the user. The right instruction depends on whether
    // the project is git-backed (reconnect repo → Cloudflare rebuilds,
    // reproducing Pages Functions too) or direct-upload (re-run
    // `wrangler pages deploy` against the build output). See
    // IMPOSSIBLE_TO_MIGRATE `pages_deployment_data`: the API has no
    // read-path for deployed asset bytes, so neither can be automated.
    const migratedSummary =
      `The project metadata, build config, env vars, and deployment_configs migrated successfully but the static asset bundle did NOT.`;
    const repo =
      p.source?.config?.owner && p.source?.config?.repo_name
        ? `${p.source.config.owner}/${p.source.config.repo_name}`
        : p.source?.config?.repo_name;
    const branch =
      p.source?.config?.production_branch || p.production_branch;
    if (p.source?.type && repo) {
      report.manualActions.push(
        `Pages Project "${p.name}" (git-backed): reconnect repo \`${repo}\`` +
          (branch ? ` branch \`${branch}\`` : '') +
          ` on the destination account via Dashboard → Workers & Pages → Create → Pages → Connect to Git, then trigger a deployment (push a commit or POST /accounts/.../pages/projects/${p.name}/deployments). ` +
          `Cloudflare rebuilds from source, reproducing static assets AND Pages Functions. ${migratedSummary}`,
      );
    } else {
      report.manualActions.push(
        `Pages Project "${p.name}" (direct-upload): run \`wrangler pages deploy <dir> --project-name=${p.name}\` to upload the production deployment. ` +
          migratedSummary,
      );
    }
  }, (p) => p.name, report.errors, log, report, onItemDone, `POST /accounts/${destAccountId}/pages/projects`);
  report.sections.push(trackSection(sec));
}
