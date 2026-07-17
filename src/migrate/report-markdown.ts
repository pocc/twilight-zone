// Copyright 2026 Cloudflare, Inc.
// Licensed under the Apache License, Version 2.0
//
// Markdown report renderer for MigrationReport.
//
// Output is consumed by:
//   • Step 4 of the UI ("Download migration_report.md")
//   • POST /api/migrate and /api/v1/migrate response bodies
//   • CLI scripts in scripts/ that drive migrations programmatically
//
// This module is pure: given a MigrationReport, it returns a single
// Markdown string. Section ordering and formatting are part of the
// product contract — Step 4 reads counts back from the same report
// object, but the markdown is what customers and account teams actually
// share post-migration, so the structure here matters.
//
// Sections are skipped (not rendered as empty headers) when their
// underlying data is empty. The Summary table, Migration Details
// header, and Post-Migration Checklist always render.

import type { MigrationError, MigrationReport } from '../types';

interface ErrorGroup {
  resource: string;
  error: string;
  suggestion?: string;
  names: string[];
}

// Collapse errors that share the same resource + message + suggestion into a
// single group listing every affected item. Without this, a systemic failure
// (e.g. 9 git-backed Pages projects all returning the identical
// "Pages Git installation" error) renders as 9 near-identical blocks — noise
// that buries the signal and violates "be specific, not repetitive"
// (Principle 9). One block per distinct failure, with the affected names
// enumerated, is both shorter and more auditable.
function groupErrors(errors: MigrationError[]): ErrorGroup[] {
  const map = new Map<string, ErrorGroup>();
  for (const e of errors) {
    const key = `${e.resource}\u0000${e.error}\u0000${e.suggestion || ''}`;
    let g = map.get(key);
    if (!g) {
      g = { resource: e.resource, error: e.error, suggestion: e.suggestion, names: [] };
      map.set(key, g);
    }
    if (e.name) g.names.push(e.name);
  }
  return [...map.values()];
}

function renderErrorGroups(
  lines: string[],
  errors: MigrationError[],
  actionLabel: 'Action' | 'Suggestion',
): void {
  for (const g of groupErrors(errors)) {
    const count = g.names.length;
    const heading = count > 1 ? `${g.resource} (${count})` : `${g.resource}: ${g.names[0] || g.resource}`;
    lines.push(`### ${heading}`, '');
    lines.push(`**Error:** ${g.error}`, '');
    if (count > 1) {
      lines.push(`**Affected (${count}):** ${g.names.join(', ')}`, '');
    }
    if (g.suggestion) {
      lines.push(`**${actionLabel}:** ${g.suggestion}`, '');
    }
    lines.push('');
  }
}

export function generateReportMarkdown(report: MigrationReport): string {
  const lines: string[] = [
    '# Zone Migration Report',
    '',
    `**Timestamp:** ${report.timestamp}`,
    `**Source Zone:** ${report.sourceZone}`,
    `**Destination Zone:** ${report.destZone}`,
    `**Destination Account:** ${report.destAccountId}`,
    '',
    '## Summary',
    '',
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total Resources | ${report.summary.total} |`,
    `| Successful | ${report.summary.success} |`,
    `| Failed | ${report.summary.failed} |`,
    `| Skipped | ${report.summary.skipped} |`,
    `| Acknowledged | ${report.summary.acknowledged || 0} |`,
    '',
  ];

  // Verification (read-back) summary. The on-screen Results page leads with
  // these numbers (what was confirmed present on the destination), so the
  // downloaded report must include them too — otherwise the .md and the UI
  // disagree on the totals (different reckonings: "attempted" vs "verified").
  // We render BOTH, clearly labelled, rather than reconciling them into one
  // (they legitimately measure different things).
  if (report.validation?.summary) {
    const v = report.validation.summary;
    lines.push(
      '## Verification (read-back from destination)',
      '',
      'Resources read back from the destination via GET to confirm they saved. ' +
        'This is a different reckoning from the migration Summary above: it counts ' +
        'what was *confirmed present*, not what was *attempted*.',
      '',
      `| Metric | Count |`,
      `|--------|-------|`,
      `| Checked | ${v.total} |`,
      `| Verified | ${v.verified} |`,
      `| Missing | ${v.missing} |`,
      `| Mismatched | ${v.mismatched} |`,
      `| Acknowledged | ${v.acknowledged || 0} |`,
      `| Unverified (read-back failed) | ${v.unverified || 0} |`,
      '',
    );
  }

  if (report.newNameservers.length > 0) {
    lines.push('## New Nameservers', '');
    lines.push('Update your domain registrar with these nameservers:', '');
    for (const ns of report.newNameservers) {
      lines.push(`- \`${ns}\``);
    }
    lines.push('');
  }

  lines.push('## Migration Details', '');

  for (const section of report.sections) {
    if (section.total === 0) continue;

    const statusIcon = section.failed > 0 ? '⚠️' : '✅';
    lines.push(`### ${statusIcon} ${section.name}`, '');
    lines.push(`- **Total:** ${section.total}`);
    lines.push(`- **Success:** ${section.success}`);
    lines.push(`- **Failed:** ${section.failed}`);
    lines.push(`- **Skipped:** ${section.skipped}`);
    if (section.acknowledged && section.acknowledged > 0) {
      lines.push(`- **Acknowledged:** ${section.acknowledged}`);
    }
    lines.push('');

    // Render the per-item table whenever there are items. There used to be an
    // upper bound (`<= 50`) that suppressed the ENTIRE table for larger
    // sections — but that hid exactly the detail an auditor needs (Principle 8:
    // show the data, not a summary) and, worse, hid acknowledged/failed rows.
    // Zone Settings routinely exceeds 50 items, so the cap silently dropped the
    // per-setting status (incl. plan-gated 🟡 acknowledged rows like
    // origin_h2_max_streams on a downgrade). The table is wrapped in a collapsed
    // <details>, so size is not a readability problem.
    if (section.items.length > 0) {
      lines.push('<details>', `<summary>View ${section.items.length} items</summary>`, '');
      lines.push('| Resource | Status | Notes |');
      lines.push('|----------|--------|-------|');
      for (const item of section.items) {
        const icon = item.status === 'success' ? '✅'
          : item.status === 'skipped' ? '⏭️'
          : item.status === 'acknowledged' ? '🟡'
          : '❌';
        const note = item.error || '-';
        lines.push(`| ${item.name} | ${icon} ${item.status} | ${note} |`);
      }
      lines.push('', '</details>', '');
    }
  }

  if (report.errors.length > 0) {
    // Group errors by category
    const billingErrors = report.errors.filter(e => e.category === 'billing');
    const manualSetupErrors = report.errors.filter(e => e.category === 'manual_setup');
    const permissionErrors = report.errors.filter(e => e.category === 'permission');
    const otherErrors = report.errors.filter(e => !e.category || e.category === 'api');

    if (billingErrors.length > 0) {
      lines.push('## 💳 Billing/Entitlement Issues', '');
      lines.push('> **Contact Support** if you believe these features should be available on your plan.', '');
      renderErrorGroups(lines, billingErrors, 'Action');
    }

    if (manualSetupErrors.length > 0) {
      lines.push('## 🔧 Manual Setup Required', '');
      lines.push('> These features must be enabled via the Dashboard before migration can proceed.', '');
      renderErrorGroups(lines, manualSetupErrors, 'Action');
    }

    if (permissionErrors.length > 0) {
      lines.push('## 🔐 Permission Errors', '');
      renderErrorGroups(lines, permissionErrors, 'Suggestion');
    }

    if (otherErrors.length > 0) {
      lines.push('## ❌ Other Errors', '');
      renderErrorGroups(lines, otherErrors, 'Suggestion');
    }
  }

  if (report.conflicts && report.conflicts.length > 0) {
    lines.push('## Conflicts (Resource Already Exists)', '');
    lines.push('The following resources already exist at the destination and were skipped:', '');
    for (const conflict of report.conflicts) {
      lines.push(`- **${conflict.resource}: ${conflict.name}**`);
      lines.push(`  - ${conflict.error}`);
    }
    lines.push('');
  }

  if (report.doMigrationResults && report.doMigrationResults.length > 0) {
    lines.push('## Durable Object Migration Results', '');
    lines.push('| Worker | Class | Objects Synced | Failed | Status |');
    lines.push('|--------|-------|----------------|--------|--------|');
    for (const result of report.doMigrationResults) {
      const statusIcon = result.status === 'success' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';
      lines.push(`| ${result.workerName} | ${result.className} | ${result.objectsSynced} | ${result.objectsFailed} | ${statusIcon} ${result.status} |`);
    }
    lines.push('');

    // Add namespace mapping info
    const successfulMigrations = report.doMigrationResults.filter(r => r.destNamespaceId);
    if (successfulMigrations.length > 0) {
      lines.push('### New Namespace IDs', '');
      lines.push('Update any external references to use these new namespace IDs:', '');
      for (const result of successfulMigrations) {
        lines.push(`- **${result.className}**: \`${result.destNamespaceId}\``);
      }
      lines.push('');
    }
  }

  if (report.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const warning of report.warnings) {
      lines.push(`- ⚠️ ${warning}`);
    }
    lines.push('');
  }

  if (report.manualActions.length > 0) {
    lines.push('## Manual Actions Required', '');
    for (const action of report.manualActions) {
      lines.push('```');
      lines.push(action);
      lines.push('```');
      lines.push('');
    }
  }

  lines.push('## Post-Migration Checklist', '');
  lines.push('- [ ] Update nameservers at domain registrar');
  lines.push('- [ ] Wait for DNS propagation (check with `dig NS ' + report.destZone + '`)');
  lines.push('- [ ] Verify SSL certificate is active');
  lines.push('- [ ] Test all worker routes');
  lines.push('- [ ] Test load balancer health checks');
  lines.push('- [ ] Verify firewall rules are working');
  lines.push('- [ ] Test any custom hostnames');
  lines.push('- [ ] Delete source zone only after full verification');
  lines.push('');

  lines.push('---', '');
  lines.push('## Data Collection (Beta)', '');
  lines.push(
    'Twilight Zone is in beta and still has bugs. To help us find and fix them, ' +
    'a non-secret, non-PII summary of this migration is logged for troubleshooting: ' +
    'resource names, per-resource statuses, error messages (with any email addresses ' +
    'and IP addresses removed), and the source/destination zone and account identifiers.',
    '',
  );
  lines.push(
    '**Your credentials are never logged.** API tokens, API keys, worker secrets, ' +
    'and private keys exist only for the duration of each API call and are never ' +
    'stored, logged, or persisted server-side.',
    '',
  );

  return lines.join('\n');
}
