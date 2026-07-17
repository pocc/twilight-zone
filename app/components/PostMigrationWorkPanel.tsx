/**
 * Required Manual post-migration work panel.
 *
 * Surfaces the actionable IMPOSSIBLE_TO_MIGRATE items whose action the
 * user performs THEMSELVES, AFTER the destination zone/resources exist
 * (run wrangler/rclone, update the registrar, re-verify hostnames,
 * re-provision account-tied resources, update consumers with regenerated
 * secrets). These are NOT supplied to the tool, so there is nothing to
 * "acknowledge" before migrating — asking the user to pre-acknowledge work
 * they can only do later is busywork (AGENTS.md Principle 4). Instead this
 * is a collapsible, disclosure-only heads-up: it explains WHAT must be done
 * and WHY, and never gates "Continue to Migration".
 *
 * The same panel is reused in Step 2 (scope — "here's what's coming") and
 * Step 3 (setup — "review before you run it"). The authoritative, real-
 * destination-identifier list of these steps is produced by the migrate
 * engine into report.manualActions and shown on Step 4 (Results).
 *
 * Items rendered here are exactly: detectApplicableImpossibleResources()
 * entries that are `actionable` but have NO inline fix-it form
 * (hasInlineFixIt === false). Fix-it items (worker secrets, cert keys,
 * etc.) stay in the Step 2 gated OutOfScopePanel because the tool consumes
 * them at migrate time.
 */

import React, { useMemo, useState } from 'react';
import { Info, CaretDown, CaretRight } from '@phosphor-icons/react';
import type { ApplicableImpossibleResource } from '../lib/outOfScope';
import type { ImpossibleCategory } from '../../src/types';
import { CliCommandList } from './fixit/CliCommandSnippet';

interface PostMigrationWorkPanelProps {
  /** Actionable-but-no-fix-it IMPOSSIBLE_TO_MIGRATE entries for this migration. */
  items: ApplicableImpossibleResource[];
  /** Start expanded. Defaults to collapsed so it doesn't dominate the page. */
  defaultExpanded?: boolean;
}

/**
 * Per-category "why this matters" copy. Descriptive (what happens / why you
 * must act later), not a pre-acknowledgment prompt.
 */
const CATEGORY_META: Record<
  ImpossibleCategory,
  { label: string; why: string }
> = {
  data_offline: {
    label: 'Bulk data — copy with CLI tooling',
    why: 'Configuration migrates automatically, but the data inside D1/R2/etc. does not. Copy it with the commands below once the destination resources exist — until then the destination serves empty stores.',
  },
  account_tied: {
    label: 'Account-tied resources — re-provision on the destination',
    why: 'These are bound to your source account and cannot cross the account boundary. Re-create them on the destination account after migration; some require Cloudflare account-team involvement.',
  },
  manual_external: {
    label: 'External actions — registrar / verification',
    why: 'These happen outside Cloudflare, after migration or at cutover: update nameservers or DS records at your registrar, verify destinations, complete SSL DCV. Until you do, DNS may not resolve, mail may drop, or certificates may not issue.',
  },
  cryptographic: {
    label: 'Regenerated secrets — update your consumers',
    why: 'These secrets are write-only and are regenerated on the destination. After migration, update whatever consumes them with the new values.',
  },
  // The remaining categories are non-actionable and never reach this panel,
  // but the map must be total over ImpossibleCategory.
  auto_managed: { label: 'Auto-managed', why: 'Cloudflare provisions these automatically.' },
  read_only: { label: 'Read-only', why: 'Server-side immutable.' },
  data_ephemeral: { label: 'Ephemeral data', why: 'Volatile by design.' },
};

export function PostMigrationWorkPanel({ items, defaultExpanded = false }: PostMigrationWorkPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const byCategory = useMemo(() => {
    const map = new Map<ImpossibleCategory, ApplicableImpossibleResource[]>();
    for (const r of items) {
      const existing = map.get(r.category);
      if (existing) existing.push(r);
      else map.set(r.category, [r]);
    }
    return map;
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="bg-blue-900/10 border border-blue-700/40 rounded-lg p-4">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 text-left"
        aria-expanded={expanded}
      >
        <span className="text-lg leading-none mt-0.5" aria-hidden="true">{'\u2139\uFE0F'}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-blue-200">
              Required Manual post-migration work ({items.length})
            </h3>
            {expanded ? (
              <CaretDown size={14} className="text-blue-300/70" aria-hidden="true" />
            ) : (
              <CaretRight size={14} className="text-blue-300/70" aria-hidden="true" />
            )}
          </div>
          <p className="text-xs text-blue-200/70 mt-0.5">
            Steps you&apos;ll complete <span className="font-medium">after</span> the destination zone is
            created — nothing to do here now. The exact commands (with destination
            identifiers) also appear on the Results step when the migration finishes.
          </p>
          <p className="text-xs text-blue-100 font-medium mt-1.5">
            I understand that the migration won&apos;t be complete until I take these
            manual steps after.
          </p>
        </div>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3 pl-8">
          {[...byCategory.entries()].map(([category, catItems]) => {
            const meta = CATEGORY_META[category];
            return (
              <div key={category} className="rounded-md border border-blue-800/40 bg-gray-900/30 p-3">
                <div className="text-xs font-semibold text-blue-200">
                  {meta.label} ({catItems.length})
                </div>
                <div className="text-xs text-blue-200/60 mt-0.5 mb-2 leading-relaxed">
                  <span className="font-medium text-blue-300/80">Why:</span> {meta.why}
                </div>
                <ul className="space-y-2.5 list-disc pl-5 marker:text-blue-300/50">
                  {catItems.map(item => (
                    <li key={item.key} className="text-xs pl-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-gray-200 font-medium">{item.name}</span>
                        {item.count !== undefined && (
                          <span className="text-gray-500">({item.count})</span>
                        )}
                      </div>
                      {item.triggerReason && (
                        <div className="text-gray-400 mt-0.5">{item.triggerReason}</div>
                      )}
                      <div className="text-gray-500 mt-0.5">{item.reason}</div>
                      {item.manualAction && (
                        <div className="text-blue-200/90 mt-1 leading-relaxed">
                          <span className="font-medium">What to do:</span> {item.manualAction}
                        </div>
                      )}
                      {item.cliCommands && item.cliCommands.length > 0 && (
                        <div className="mt-2">
                          <CliCommandList commands={item.cliCommands} />
                        </div>
                      )}
                      {item.docsUrl && (
                        <a
                          href={item.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 mt-1 inline-block"
                        >
                          Cloudflare docs →
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
