import { useCallback, useMemo, useState } from 'react';
import { CaretRight, DownloadSimple } from '@phosphor-icons/react';
import type { AccountCapabilities } from '../../lib/api';
import type { ZoneExport, CFZoneSetting, CFRuleset } from '../../../src/types';
import {
  buildGroups,
  groupPhase,
  type ConflictStrategy,
  type DOConfig,
  type D1Config,
  type WizardPhase,
} from './scope/groups';
import { getItemDetail } from './scope/itemDetail';

/** Resolved view of a group's selected, migrate-able items + their detail. */
type PlanGroup = {
  key: string;
  label: string;
  items: { id: string; label: string; sublabel?: string; raw: unknown }[];
};

function downloadText(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Render the Review Plan as a human-readable Markdown document. Mirrors exactly
 * what the expanded collapsible shows — zone metadata, per-group counts, and the
 * same identifying detail per resource (`getItemDetail`, AGENTS.md Principle 8) —
 * so the downloaded file is an auditable record of precisely what will migrate.
 * Contains only resource metadata; no credentials.
 */
function buildPlanMarkdown(
  zone: ZoneExport['zone'] | undefined,
  planGroups: PlanGroup[],
  totalSelected: number,
): string {
  const lines: string[] = [];
  const zoneName = zone?.name || 'Unknown zone';
  lines.push(`# Migration Plan: ${zoneName}`);
  lines.push('');
  lines.push(`- **Zone:** ${zoneName}`);
  lines.push(`- **Plan:** ${zone?.plan?.name || 'Unknown'}`);
  lines.push(`- **Status:** ${zone?.status || 'Unknown'}`);
  lines.push(`- **Resources to migrate:** ${totalSelected}`);
  lines.push('');

  if (planGroups.length === 0) {
    lines.push('_No resources selected to migrate._');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## Summary');
  lines.push('');
  for (const g of planGroups) lines.push(`- ${g.items.length} ${g.label}`);
  lines.push('');

  lines.push('## Resources');
  lines.push('');
  for (const group of planGroups) {
    lines.push(`### ${group.label} (${group.items.length})`);
    lines.push('');
    for (const item of group.items) {
      const sub = item.sublabel ? ` _(${item.sublabel})_` : '';
      lines.push(`- **${item.label}**${sub}`);
      const detail = getItemDetail(group.key, item.raw);
      for (const f of detail) lines.push(`  - ${f.label}: ${f.value}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export interface PlanSummaryProps {
  exportData: ZoneExport;
  /** Per-group item selection map. Only selected items appear in the plan. */
  selections: Record<string, Record<string, boolean>>;
  capabilities?: AccountCapabilities | null;
  existingTurnstileWidgets?: string[];
  doConfigs?: Record<string, DOConfig>;
  d1Configs?: Record<string, D1Config>;
  conflictStrategy?: ConflictStrategy;
  destAccountName?: string;
  /** Restrict the plan to a single phase's groups (account / zone). Omit to
   * show every group (the unified preset/legacy view). */
  phase?: WizardPhase;
  /** Start expanded. Default false — the user already chose these settings on
   * the prior steps, so the recap is collapsed by default (it's an audit
   * affordance, not the primary content of the Apply step). */
  defaultExpanded?: boolean;
}

/**
 * Read-only "Review Plan" recap, shown collapsed on the Apply step.
 *
 * The selections were already made (and audited in detail) on the Account /
 * Zone steps, so re-rendering the full selectable ScopeReview on Apply is
 * redundant. This component shows the SAME identifying detail
 * (`getItemDetail`, honoring AGENTS.md Principle 8) but read-only: no
 * checkboxes, no Select All, no acknowledgement gates. It lists only the
 * resources that WILL migrate (selected + not disabled), so a user expanding
 * it can still verify nothing is missing or unexpected before they run.
 */
export function PlanSummary({
  exportData,
  selections,
  capabilities,
  existingTurnstileWidgets,
  doConfigs,
  d1Configs,
  conflictStrategy = 'skip',
  destAccountName,
  phase,
  defaultExpanded = false,
}: PlanSummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const groups = useMemo(() => {
    const all = buildGroups(
      exportData,
      capabilities ?? undefined,
      existingTurnstileWidgets,
      doConfigs ?? {},
      d1Configs ?? {},
      conflictStrategy,
      destAccountName,
    );
    return phase ? all.filter(g => groupPhase(g) === phase) : all;
  }, [exportData, capabilities, existingTurnstileWidgets, doConfigs, d1Configs, conflictStrategy, destAccountName, phase]);

  // Only the resources that will actually migrate: selected, not item-disabled,
  // in a group that isn't capability-disabled.
  const planGroups = useMemo(
    () =>
      groups
        .filter(g => !g.disabled)
        .map(g => ({
          ...g,
          items: g.items.filter(it => !it.disabled && selections[g.key]?.[it.id]),
        }))
        .filter(g => g.items.length > 0),
    [groups, selections],
  );

  const totalSelected = useMemo(
    () => planGroups.reduce((n, g) => n + g.items.length, 0),
    [planGroups],
  );

  const zone = exportData?.zone;

  const handleDownloadPlan = useCallback(() => {
    const md = buildPlanMarkdown(zone, planGroups, totalSelected);
    const safeZone = (zone?.name || 'zone').replace(/[^a-zA-Z0-9._-]/g, '_');
    downloadText(md, `migration_plan_${safeZone}.md`);
  }, [zone, planGroups, totalSelected]);

  const resourceCounts = useMemo(() => {
    const counts: { label: string; count: number }[] = [];
    if (exportData.dnsRecords?.length) counts.push({ label: 'DNS Records', count: exportData.dnsRecords.length });
    if (exportData.settings?.filter((s: CFZoneSetting) => s.editable).length) counts.push({ label: 'Settings', count: exportData.settings.filter((s: CFZoneSetting) => s.editable).length });
    if (exportData.rulesets?.filter((r: CFRuleset) => (r.rules?.length ?? 0) > 0).length) counts.push({ label: 'Rulesets', count: exportData.rulesets.filter((r: CFRuleset) => (r.rules?.length ?? 0) > 0).length });
    if (exportData.workers?.length) counts.push({ label: 'Workers', count: exportData.workers.length });
    if (exportData.loadBalancers?.length) counts.push({ label: 'Load Balancers', count: exportData.loadBalancers.length });
    if (exportData.accessApps?.length) counts.push({ label: 'Access Apps', count: exportData.accessApps.length });
    if (exportData.pageRules?.length) counts.push({ label: 'Page Rules', count: exportData.pageRules.length });
    if (exportData.emailRoutingRules?.length) counts.push({ label: 'Email Rules', count: exportData.emailRoutingRules.length });
    if (exportData.waitingRooms?.length) counts.push({ label: 'Waiting Rooms', count: exportData.waitingRooms.length });
    if (exportData.turnstileWidgets?.length) counts.push({ label: 'Turnstile Widgets', count: exportData.turnstileWidgets.length });
    return counts;
  }, [exportData]);

  return (
    <section className="bg-gray-800 border border-gray-700 rounded-lg">
      <div className="w-full flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          <CaretRight
            size={16}
            weight="bold"
            className={`text-gray-400 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span className="text-sm font-semibold text-gray-100 shrink-0">Review Plan</span>
          <span className="text-xs text-gray-400 truncate">
            {zone?.name ? <span className="text-gray-300">{zone.name}</span> : null}
            {' · '}
            <span className="text-orange-400 font-semibold">{totalSelected}</span> resource{totalSelected === 1 ? '' : 's'} to migrate
          </span>
        </button>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleDownloadPlan}
            disabled={totalSelected === 0}
            title="Download this migration plan as Markdown (resource metadata only, no credentials)"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition ${
              totalSelected === 0
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
            }`}
          >
            <DownloadSimple size={14} weight="bold" aria-hidden="true" />
            Download plan
          </button>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
            className="text-xs text-gray-500 hover:text-gray-300 transition"
          >
            {expanded ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-700/70 pt-4">
          {/* Export Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Zone</div>
              <div className="text-sm font-medium text-gray-200 break-all">{zone?.name || 'Unknown'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Plan</div>
              <div className="text-sm font-medium text-gray-200">{zone?.plan?.name || 'Unknown'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Status</div>
              <div className="text-sm font-medium text-gray-200">{zone?.status || 'Unknown'}</div>
            </div>
          </div>
          {resourceCounts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {resourceCounts.map((rc) => (
                <span
                  key={rc.label}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-300"
                >
                  <span className="text-orange-400 font-bold">{rc.count}</span> {rc.label}
                </span>
              ))}
            </div>
          )}

          {/* Per-group read-only resource lists */}
          {planGroups.length === 0 ? (
            <div className="text-sm text-gray-500">No resources selected to migrate.</div>
          ) : (
            <div className="space-y-3">
              {planGroups.map((group) => (
                <div key={group.key}>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                    {group.label}{' '}
                    <span className="text-gray-500 font-normal">({group.items.length})</span>
                  </div>
                  <ul className="space-y-1">
                    {group.items.map((item) => {
                      const detail = getItemDetail(group.key, item.raw);
                      return (
                        <li
                          key={item.id}
                          className="text-xs text-gray-300 bg-gray-900/40 border border-gray-700/60 rounded px-2.5 py-1.5"
                        >
                          <span className="font-medium text-gray-200 break-all">{item.label}</span>
                          {item.sublabel && (
                            <span className="text-gray-500 ml-1.5">{item.sublabel}</span>
                          )}
                          {detail.length > 0 && (
                            <span className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-gray-400">
                              {detail.map((f, i) => (
                                <span key={i}>
                                  <span className="text-gray-500">{f.label}:</span>{' '}
                                  <span className={f.mono ? 'font-mono break-all' : 'break-all'}>{f.value}</span>
                                </span>
                              ))}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
