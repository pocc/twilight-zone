import { useState } from 'react';
import type { MigrationReport, ZoneExport } from '../../../src/types';
import type { AccountCapabilities } from '../../lib/api';
import type { LogLine } from '../../hooks/useStreamRequest';
import { LogPanel } from '../LogPanel';
import { auditEntriesToLogLines } from '../../lib/auditLog';
import { PostMigrationWorkPanel } from '../PostMigrationWorkPanel';
import { PlanSummary } from './PlanSummary';
import { DestinationConfirm } from './DestinationConfirm';
import type { ConflictStrategy, DOConfig, D1Config } from './scope/groups';
import { detectApplicableImpossibleResources, isPostMigrationManualItem } from '../../lib/outOfScope';

interface Step3Props {
  /** The merged migration report. null until the migration has run — that's
   * the signal that switches this step from "review & run" to "post-migration
   * checklist". */
  report: MigrationReport | null;
  /** Zone-phase migration log (the full human-readable run log, shown as the
   *  middle section after the run — moved here from the Results step). */
  migrationLogs?: LogLine[];
  /** Account-phase deploy log (re-readable after the run). */
  accountMigrationLogs?: LogLine[];
  /** Account-phase API endpoints hit (audit log: method + path + status). */
  accountApiCalls?: unknown[];
  /** Zone-phase API endpoints hit (audit log: method + path + status). */
  zoneApiCalls?: unknown[];
  exportData: ZoneExport | null;
  /** Resource selection map — drives the read-only Review Plan recap. */
  selections: Record<string, Record<string, boolean>>;
  capabilities?: AccountCapabilities | null;
  existingTurnstileWidgets?: string[];
  doConfigs?: Record<string, DOConfig>;
  d1Configs?: Record<string, D1Config>;
  conflictStrategy?: ConflictStrategy;
  destAccountName?: string;
  /** Destination account id — pins the wrangler `--account-id` on the D1
   * post-migration commands so they target the right account, and labels the
   * destination confirmation. */
  destAccountId?: string;
  /** Run the migration (account phase then zone phase). */
  onRun: () => void;
  /** Re-run the post-migration GET-back verification (feeds Results). */
  onVerify?: () => void;
  verifying?: boolean;
  /** Advance to the read-only Results step. */
  onContinue: () => void;

  // ── Live-run props (so the migration log streams INLINE on this same page,
  //    rather than App swapping the whole step out for a bare log panel). ──
  /** True while either migration phase is streaming. */
  isMigrating?: boolean;
  /** Live log lines for the in-flight phase (account, then zone). */
  liveLogs?: LogLine[];
  /** Live progress for the in-flight phase. */
  liveProgress?: { current: number; total: number };
  /** Stream start time (drives the elapsed timer). */
  liveStartTime?: number | null;
  /** Live log panel title (the current phase's loading text). */
  liveTitle?: string;
  /** Cancel + rollback the in-flight migration. */
  onCancel?: () => void;
}

/**
 * Step 3 — Apply. The single "do it" step. Every part lives on ONE page so the
 * user never loses context as the migration progresses — sections appear,
 * disable, and collapse in place rather than swapping the whole view out:
 *
 *   1. Review Plan — a collapsed, read-only recap of everything selected on the
 *      Account/Zone steps (no checkboxes; the selections are already made).
 *      Stays visible the whole way through.
 *   2. Run the migration — confirm the destination, then deploy account
 *      resources and migrate the zone (the destructive action lives here now,
 *      not at the end of the Zone step). The confirm + Run controls show only
 *      before the run starts.
 *   3. Migration log — streams live (with progress + Cancel) while the run is
 *      in flight, then collapses to a re-readable disclosure once the run
 *      completes. It no longer replaces the rest of the page.
 *   4. Finish the migration — the interactive post-migration checklist
 *      (registrar nameserver change, DNSSEC, email-routing verification,
 *      Turnstile sitekey updates, KV/R2/D1 data copies, worker-secret / cert
 *      reminders), each with a per-item "done" affordance. Appears once the
 *      run completes and a `report` exists.
 *
 * Three states drive which sections render, all within the same container:
 *   • pre-run   = `!report && !isMigrating`
 *   • migrating = `isMigrating`
 *   • done      = `report && !isMigrating`
 */
export function Step3Apply({
  report,
  migrationLogs = [],
  accountMigrationLogs = [],
  accountApiCalls = [],
  zoneApiCalls = [],
  exportData,
  selections,
  capabilities,
  existingTurnstileWidgets,
  doConfigs,
  d1Configs,
  conflictStrategy,
  destAccountName,
  destAccountId,
  onRun,
  onVerify,
  verifying = false,
  onContinue,
  isMigrating = false,
  liveLogs = [],
  liveProgress,
  liveStartTime,
  liveTitle,
  onCancel,
}: Step3Props) {
  // Per-item "done" state (local to this step; advisory — does not gate
  // Continue, since the user may legitimately defer some manual work).
  const [done, setDone] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setDone(prev => ({ ...prev, [key]: !prev[key] }));

  // Destination confirmation — gates the destructive "Run migration" button.
  const [accountConfirmed, setAccountConfirmed] = useState(false);
  const [zoneConfirmed, setZoneConfirmed] = useState(false);
  const destConfirmed = accountConfirmed && zoneConfirmed;

  // Three single-page states (mutually exclusive). `isMigrating` dominates the
  // brief window where the zone-phase report is set but the run hasn't fully
  // wound down, so the checklist only appears once the stream is truly idle.
  const isDone = !!report && !isMigrating;
  const isPreRun = !report && !isMigrating;

  const manualActions = report?.manualActions ?? [];
  const newNameservers = report?.newNameservers ?? [];
  const postMigrationResources = exportData
    ? detectApplicableImpossibleResources(exportData, destAccountId).filter(isPostMigrationManualItem)
    : [];
  const doneCount = manualActions.filter((_, i) => done[`ma-${i}`]).length;

  // Actual API endpoints hit, per phase, rendered as collapsed terminals once
  // the run completes (the live progress log streams above while running).
  const accountCallLines = auditEntriesToLogLines(accountApiCalls);
  const zoneCallLines = auditEntriesToLogLines(zoneApiCalls);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-100 pt-2">
          {isDone
            ? 'Apply \u2014 finish the migration'
            : isMigrating
              ? 'Apply \u2014 running the migration'
              : 'Apply \u2014 review & run the migration'}
        </h2>
        <p className="text-sm text-gray-400">
          {isDone ? (
            <>The destination zone is created and its configuration migrated.
            Complete the manual steps below to make it live, then continue to the
            read-only results. The migration isn&apos;t finished until these are
            done.</>
          ) : isMigrating ? (
            <>Deploying account resources, then creating &amp; migrating the zone.
            Watch the live log below — the plan and post-migration steps stay on
            this page.</>
          ) : (
            <>You&apos;ve already chosen what to migrate on the Account and Zone
            steps. Expand the plan to re-check it, confirm the destination, then
            run the migration. This deploys the account resources and creates &amp;
            migrates the zone.</>
          )}
        </p>
      </div>

      {/* New nameservers — the headline cutover action (done only). */}
      {isDone && newNameservers.length > 0 && (
        <section className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-yellow-300 mb-1">Update your registrar&apos;s nameservers</h3>
          <p className="text-xs text-gray-400 mb-2">
            Point your domain at the destination account&apos;s nameservers to activate the zone:
          </p>
          <ul className="space-y-1">
            {newNameservers.map((ns) => (
              <li key={ns} className="font-mono text-sm text-gray-200">{ns}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Review Plan recap — always visible (collapsed, read-only). */}
      {exportData && (
        <PlanSummary
          exportData={exportData}
          selections={selections}
          capabilities={capabilities}
          existingTurnstileWidgets={existingTurnstileWidgets}
          doConfigs={doConfigs}
          d1Configs={d1Configs}
          conflictStrategy={conflictStrategy}
          destAccountName={destAccountName}
        />
      )}

      {/* Destination confirm + Run — pre-run only. */}
      {isPreRun && (
        <>
          <DestinationConfirm
            showAccount
            showZone
            accountName={destAccountName}
            accountId={destAccountId}
            zoneName={exportData?.zone?.name}
            accountConfirmed={accountConfirmed}
            setAccountConfirmed={setAccountConfirmed}
            zoneConfirmed={zoneConfirmed}
            setZoneConfirmed={setZoneConfirmed}
          />

          {/* Single primary action. Navigating back to a prior step is handled
              by the breadcrumb step pills in the header, so no back button. */}
          <div className="flex items-center justify-end pt-2 border-t border-gray-700">
            <button
              type="button"
              onClick={onRun}
              disabled={!destConfirmed}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition shadow-lg ${
                destConfirmed
                  ? 'bg-orange-500 hover:bg-orange-400 text-white shadow-orange-500/25'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed shadow-none'
              }`}
            >
              Run migration &rarr;
            </button>
          </div>
        </>
      )}

      {/* Live migration log — streams inline while migrating. The account-phase
          log (captured once that phase finishes) collapses above the live zone
          log. */}
      {isMigrating && (
        <>
          {accountMigrationLogs.length > 0 && (
            <LogPanel logs={accountMigrationLogs} title="Account resources — deploy log" collapsible />
          )}
          <LogPanel
            logs={liveLogs}
            title={liveTitle || 'Working…'}
            isLive
            progress={liveProgress}
            startTime={liveStartTime}
            onCancel={onCancel}
          />
        </>
      )}

      {/* Post-migration checklist — done only. */}
      {isDone && (
        <>
          {/* Migration log — the full run log, the middle section's headline
              (moved here from the Results step). Expanded by default; the
              per-phase API-call terminals below collapse the endpoint detail. */}
          {migrationLogs.length > 0 && (
            <LogPanel logs={migrationLogs} title="Migration Log" collapsible defaultExpanded maxHeight="400px" />
          )}

          {/* Manual actions emitted by the engine (report.manualActions). */}
          {manualActions.length > 0 && (
            <section className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-200">Manual actions required</h3>
                <span className="text-xs text-gray-400">{doneCount}/{manualActions.length} done</span>
              </div>
              <ul className="space-y-2">
                {manualActions.map((action, i) => {
                  const key = `ma-${i}`;
                  return (
                    <li key={key} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={!!done[key]}
                        onChange={() => toggle(key)}
                        className="mt-0.5 accent-orange-500"
                        id={key}
                      />
                      <label htmlFor={key} className={`text-sm ${done[key] ? 'text-gray-500 line-through' : 'text-gray-300'}`}>
                        {action}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Actionable IMPOSSIBLE_TO_MIGRATE items (registrar/DNSSEC/data copies). */}
          <PostMigrationWorkPanel items={postMigrationResources} />

          {/* The actual API endpoints hit, per phase, re-readable (collapsed). */}
          {accountCallLines.length > 0 && (
            <LogPanel logs={accountCallLines} title={`Account API calls (${accountCallLines.length})`} collapsible />
          )}
          {zoneCallLines.length > 0 && (
            <LogPanel logs={zoneCallLines} title={`Zone API calls (${zoneCallLines.length})`} collapsible />
          )}

          {/* Back-nav is handled by the header breadcrumb step pills. */}
          <div className="flex items-center justify-end pt-2 border-t border-gray-700">
            <div className="flex items-center gap-3">
              {onVerify && (
                <button
                  type="button"
                  onClick={onVerify}
                  disabled={verifying}
                  className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600 rounded-lg text-sm font-medium transition disabled:opacity-50"
                >
                  {verifying ? 'Re-verifying…' : 'Re-verify'}
                </button>
              )}
              <button
                type="button"
                onClick={onContinue}
                className="px-6 py-2.5 bg-orange-500 hover:bg-orange-400 text-white rounded-lg text-sm font-medium transition shadow-lg shadow-orange-500/25"
              >
                Continue to Results &rarr;
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
