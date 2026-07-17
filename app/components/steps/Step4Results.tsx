import React, { useState, useMemo } from 'react';
import { generateApiCode, getCodeFileExtension, type ApiCall } from '../../lib/codegen';
import type { SourceMode } from './Step0Credentials';
import type {
  ZoneExport, MigrationReport, ReportSection,
  MigrationError, ValidationSection, AnalyticsExport,
} from '../../../src/types';
import { LogPanel } from '../LogPanel';
import { auditEntriesToLogLines } from '../../lib/auditLog';
import { StatusIcon, type Status } from '../StatusIcon';
import { type DashLinkCtx } from '../../lib/dashLinks';
import { Step4IdPTestSection } from '../Step4IdPTestSection';
import { FeedbackCard } from '../FeedbackCard';
import { AnalyticsExportedSection } from '../AnalyticsCharts';
import { appendIdpTestSubsection, type IdpTestResults } from '../../lib/idpTestReport';
import { encryptFile } from '../../lib/crypto';
// Per-section result cards extracted to keep this file focused.
import { SectionCard, ValidationSectionCard, StatBadge } from './step4/SectionCards';

interface Step4Props {
  report: MigrationReport | null;
  reportMarkdown: string;
  /** Zone-phase audit log (zone-scoped API calls). */
  /** Zone-phase audit log — the actual zone-scoped API endpoints hit. */
  auditLog: unknown[];
  /** Account-phase audit log — the actual account-scoped API endpoints hit. */
  accountAuditLog?: unknown[];
  apiCalls: ApiCall[] | null;
  sourceFormat: SourceMode;
  exportData: ZoneExport | null;
  onVerify: () => void;
  onStartNew: () => void;
  /** Dry-run only: re-run the SAME config as a real migration, in place,
   * without reloading the page or re-entering anything. Optional — omitted on
   * the read-only Results step (#19), which renders no execute control. */
  onExecuteReal?: () => void;
  /** Go back to the prior step (Apply). Optional; when omitted the back
   * button is hidden. */
  onBackToConfig?: () => void;
  onExportJson: () => void;
  /** Per-destIdpId user attestations of end-to-end IdP login tests.
   * In-memory only - cleared on page reload. */
  idpTestResults: IdpTestResults;
  setIdpTestResults: React.Dispatch<React.SetStateAction<IdpTestResults>>;
  /** Source-zone analytics capture (spike/analytics-export). Runs in parallel
   * with the migration; offered here as a JSON download. */
  analyticsStatus?: 'idle' | 'running' | 'ready' | 'error';
  analyticsExport?: AnalyticsExport | null;
  analyticsError?: string;
  /** The migrator's auth email (Step 0), forwarded with feedback so the team
   * knows who to follow up with. Empty/undefined for token-auth migrations. */
  migratorEmail?: string;
}

/* Status icons + colours live in StatusIcon.tsx - the shared map keeps
   every status badge in the wizard visually consistent and ensures the
   acknowledged-doesn't-look-like-failure invariant from Principle 1
   stays true across components. */

const CODE_FORMATS = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'curl', label: 'curl' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'terraform', label: 'Terraform' },
] as const;

function downloadBlob(content: string, filename: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Mirror of src/api.ts AuditLogEntry (loose — crosses the SSE boundary as JSON).
type AuditEntry = {
  timestamp?: string;
  method?: string;
  path?: string;
  status?: string;
  statusCode?: number;
  error?: string;
  duration?: number;
};

function buildAuditCsv(auditLog: unknown[]): string {
  const header = 'timestamp,method,path,status,statusCode,duration_ms,error';
  const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = auditLog.map((rawEntry) => {
    const entry = (rawEntry ?? {}) as AuditEntry;
    return [
      csv(entry.timestamp || ''),
      csv(entry.method || ''),
      csv(entry.path || ''),
      csv(entry.status || ''),
      csv(entry.statusCode != null ? String(entry.statusCode) : ''),
      csv(entry.duration != null ? String(entry.duration) : ''),
      csv(entry.error || ''),
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

export function Step4Results({
  report,
  reportMarkdown,
  auditLog,
  accountAuditLog = [],
  apiCalls,
  sourceFormat,
  exportData,
  onVerify,
  onStartNew,
  onExecuteReal,
  onBackToConfig,
  onExportJson,
  idpTestResults,
  setIdpTestResults,
  analyticsStatus = 'idle',
  analyticsExport = null,
  analyticsError = '',
  migratorEmail,
}: Step4Props) {
  const [codeFormat, setCodeFormat] = useState('typescript');
  const [copied, setCopied] = useState(false);

  // Optional password protection for every download on this page (SC-28).
  // Default off; when on, a password is required and each file is written as an
  // AES-256-GCM envelope (.enc) instead of plaintext. See app/lib/crypto.ts.
  const [encryptDownloads, setEncryptDownloads] = useState(false);
  const [downloadPassword, setDownloadPassword] = useState('');
  const [encryptError, setEncryptError] = useState('');

  // Single gate every download routes through. When encryption is on we never
  // fall back to plaintext: a missing password aborts with an inline message
  // rather than silently emitting the file unencrypted (the user asked for
  // protection — honour it or fail loudly, never downgrade).
  const emit = async (content: string, filename: string, mime = 'text/plain') => {
    if (encryptDownloads) {
      if (!downloadPassword) {
        setEncryptError('Enter a password to encrypt downloads.');
        return;
      }
      try {
        const envelope = await encryptFile(content, filename, downloadPassword);
        downloadBlob(envelope, `${filename}.enc`, 'application/json');
        setEncryptError('');
      } catch (e) {
        setEncryptError((e as Error)?.message || 'Encryption failed.');
      }
      return;
    }
    downloadBlob(content, filename, mime);
  };

  const handleDownloadAnalytics = () => {
    if (!analyticsExport) return;
    const zone = analyticsExport.meta.zoneName || 'zone';
    const date = new Date().toISOString().slice(0, 10);
    void emit(
      JSON.stringify(analyticsExport, null, 2),
      `${zone}-analytics-${date}.json`,
      'application/json',
    );
  };

  const isDryRun = apiCalls !== null;
  // Actual API endpoints hit, per phase (collapsed terminals below the report).
  const accountCallLines = auditEntriesToLogLines(accountAuditLog);
  const zoneCallLines = auditEntriesToLogLines(auditLog);
  const hasVerification = !!report?.verification;
  const hasValidation = !!report?.validation;

  const summary = report?.summary;
  const total = summary?.total ?? 0;
  const success = summary?.success ?? 0;
  const failed = summary?.failed ?? 0;
  const skipped = summary?.skipped ?? 0;

  // Validation summary (from automated post-migration GET-back)
  const valSummary = report?.validation?.summary;
  const valTotal = valSummary?.total ?? 0;
  const valVerified = valSummary?.verified ?? 0;
  const valMissing = valSummary?.missing ?? 0;
  const valMismatched = valSummary?.mismatched ?? 0;
  const valAcknowledged = valSummary?.acknowledged ?? 0;
  const valUnverified = valSummary?.unverified ?? 0;
  const acknowledged = summary?.acknowledged ?? 0;

  // Destination zone id. Prefer `destZoneId` (always set — created OR reused);
  // fall back to createdResources.zoneId for older reports that predate it.
  // Without the fallback-to-reused id, verification was wrongly disabled
  // whenever the destination zone already existed (e.g. Terraform imports).
  const destZoneId = report?.destZoneId || report?.createdResources?.zoneId;
  const canVerify = !!destZoneId && !!exportData;

  // Contexts for per-row dashboard deep links (source vs destination account).
  const sourceDashCtx: DashLinkCtx = {
    accountId: exportData?.sourceAccountId || exportData?.zone?.account?.id,
    zoneName: exportData?.zone?.name,
  };
  const destDashCtx: DashLinkCtx = {
    accountId: report?.destAccountId,
    zoneName: report?.destZone,
  };

  const generatedCode = isDryRun
    ? generateApiCode(
        codeFormat,
        apiCalls,
        destZoneId || '',
        report?.destAccountId || '',
      )
    : '';

  // Split sections into non-empty ones with items, and separate by status
  const { sectionsWithItems, emptySections } = useMemo(() => {
    const sections = report?.sections || [];
    const withItems: ReportSection[] = [];
    const empty: string[] = [];
    for (const s of sections) {
      if (s.items && s.items.length > 0) withItems.push(s);
      else empty.push(s.name);
    }
    return { sectionsWithItems: withItems, emptySections: empty };
  }, [report]);

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCode = () => {
    const ext = getCodeFileExtension(codeFormat);
    void emit(generatedCode, `migration-api-calls${ext}`);
  };

  const handleDownloadCsv = () => {
    // Step 4 is the merged account⊕zone view, so the audit CSV covers both
    // migration phases (account-scoped calls first, then zone-scoped).
    void emit(buildAuditCsv([...accountAuditLog, ...auditLog]), 'migration-audit-log.csv', 'text/csv');
  };

  const handleDownloadReport = () => {
    // Append the optional IdP login-test subsection at download time
    // so user-attested test outcomes (entered in the Step4IdPTestSection
    // card after migration completed) flow into the .md file. If the
    // user clicked zero test buttons, this is a no-op and the original
    // server-generated markdown is downloaded unchanged.
    const finalMarkdown = appendIdpTestSubsection(reportMarkdown, report, idpTestResults);
    void emit(finalMarkdown, 'migration-report.md', 'text/markdown');
  };

  // Curated JSON export: when encryption is off, keep delegating to App's handler
  // (preserves its filename + success toast). When on, serialize the in-hand
  // export locally so it flows through the same encrypt gate as every other file.
  const handleExportJson = () => {
    if (encryptDownloads) {
      const zoneName = exportData?.zone?.name || 'zone';
      const date = new Date().toISOString().slice(0, 10);
      void emit(JSON.stringify(exportData, null, 2), `${zoneName}-export-${date}.json`, 'application/json');
      return;
    }
    onExportJson();
  };

  return (
    <div className="space-y-6">
      {/* ── Summary ── */}
      <h2 className="text-xl font-bold text-gray-100">Summary</h2>
      {/* ── Analytics data exported (before validations; graphs if captured) ── */}
      <AnalyticsExportedSection
        status={analyticsStatus}
        analyticsExport={analyticsExport}
        error={analyticsError}
        onDownload={handleDownloadAnalytics}
      />

      {/* ── Summary (real migration) ── */}
      {!isDryRun && (
        <div className="space-y-5">
          {/* Stats header */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-5 space-y-4">
            {report?.destZone && (
              <div className="text-center">
                <span className="text-xs uppercase tracking-wide text-gray-500">Target Zone</span>
                <h2 className="text-xl font-bold text-orange-400">{report.destZone}</h2>
              </div>
            )}

            {/* Validation stats (preferred when available) */}
            {hasValidation ? (
              <>
                <div className={`grid grid-cols-2 gap-3 text-center ${
                  failed > 0 && valAcknowledged > 0 ? 'sm:grid-cols-6' :
                  failed > 0 || valAcknowledged > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
                }`}>
                  <StatBadge label="Total" value={valTotal + failed} color="text-gray-100" bg="bg-gray-700" />
                  <StatBadge label="Verified" value={valVerified} color="text-green-400" bg="bg-green-900/30" />
                  <StatBadge label="Missing" value={valMissing} color="text-red-400" bg="bg-red-900/30" />
                  <StatBadge label="Mismatched" value={valMismatched} color="text-yellow-400" bg="bg-yellow-900/30" />
                  {failed > 0 && (
                    <StatBadge label="Failed" value={failed} color="text-red-400" bg="bg-red-900/30" />
                  )}
                  {valAcknowledged > 0 && (
                    <StatBadge label="Acknowledged" value={valAcknowledged} color="text-gray-400" bg="bg-gray-700/50" />
                  )}
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-700/30">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Validated via GET
                  </span>
                  <span>Resources read back from destination to confirm they saved</span>
                </div>
              </>
            ) : (
              <div className={`grid grid-cols-2 ${acknowledged > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-3 text-center`}>
                <StatBadge label="Total" value={total} color="text-gray-100" bg="bg-gray-700" />
                <StatBadge label="Success" value={success} color="text-green-400" bg="bg-green-900/30" />
                <StatBadge label="Failed" value={failed} color="text-red-400" bg="bg-red-900/30" />
                <StatBadge label="Skipped" value={skipped} color="text-gray-400" bg="bg-gray-700/50" />
                {acknowledged > 0 && (
                  <StatBadge label="Acknowledged" value={acknowledged} color="text-gray-400" bg="bg-gray-700/50" />
                )}
              </div>
            )}

            {/* Status banner */}
            {(() => {
              if (hasValidation) {
                // A "clean" run has nothing missing/mismatched/unverified/failed.
                // But "clean" is NOT the same as "all verified": when items were
                // acknowledged (deselected, entitlement-gapped, manual), the
                // majority of resources may be acknowledged rather than verified.
                // Claiming "All resources verified!" in that case is dishonest
                // (verification-honesty: never overstate success). Only call it
                // "all verified" when there are zero acknowledged items.
                const cleanVerified = valMissing === 0 && valMismatched === 0 && valUnverified === 0 && valVerified > 0 && failed === 0;
                const allVerified = cleanVerified && valAcknowledged === 0;
                const anyMissing = valMissing > 0;
                const anyMismatched = valMismatched > 0;
                const anyUnverified = valUnverified > 0;
                const anyFailed = failed > 0;
                const ackNote = valAcknowledged > 0 ? ` (${valAcknowledged} acknowledged)` : '';
                // Unverified rows are NOT failures (the read-back GET errored,
                // so presence is unknown) — surfaced as a separate, neutral
                // note rather than folded into missing/mismatched (Principle 1).
                const unverifiedNote = anyUnverified
                  ? ` ${valUnverified} could not be verified (read-back from destination failed).`
                  : '';

                // Failed items take priority in status display
                if (anyFailed) {
                  return (
                    <div className="bg-red-900/20 border-red-600/40 border rounded-lg p-4 text-center">
                      <span className="text-3xl">{'\u26A0\uFE0F'}</span>
                      <p className="text-sm font-semibold text-red-400 mt-1">
                        {failed} resource{failed !== 1 ? 's' : ''} failed to migrate.{ackNote}
                        {valVerified > 0 ? ` ${valVerified} verified on destination.` : ''}
                        {unverifiedNote}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Review errors below for details
                      </p>
                    </div>
                  );
                }

                // Unverified-only (no missing/mismatched/failed): neutral blue
                // info banner — we make no claim about these resources because
                // the read-back GET failed; they are not failures.
                const unverifiedOnly = !anyMissing && !anyMismatched && anyUnverified;
                // Clean run WITH acknowledgments: honest headline that leads
                // with what was actually verified and separately states what
                // was acknowledged (not migrated) — never "all verified".
                const cleanWithAcks = cleanVerified && valAcknowledged > 0;
                const emoji = allVerified ? '\uD83C\uDF89'
                  : anyMissing ? '\u274C'
                  : anyMismatched ? '\u26A0\uFE0F'
                  : unverifiedOnly ? '\u2754'
                  : '\u2705';
                const message = allVerified
                  ? `All resources verified on destination!`
                  : cleanWithAcks
                    ? `${valVerified} verified on destination · ${valAcknowledged} acknowledged (not migrated).`
                    : anyMissing && anyMismatched
                      ? `${valMissing} missing, ${valMismatched} mismatched.${ackNote}${unverifiedNote} Review details below.`
                      : anyMissing
                        ? `${valMissing} resource${valMissing !== 1 ? 's' : ''} not found on destination.${ackNote}${unverifiedNote}`
                        : anyMismatched
                          ? `${valMismatched} resource${valMismatched !== 1 ? 's' : ''} saved with different values.${ackNote}${unverifiedNote}`
                          : `${valVerified} verified.${ackNote}${unverifiedNote} The unverified items may still have migrated — re-run verification or check the destination dashboard.`;
                const bg = (allVerified || cleanWithAcks) ? 'bg-green-900/20 border-green-600/40'
                  : anyMissing ? 'bg-red-900/20 border-red-600/40'
                  : anyMismatched ? 'bg-yellow-900/20 border-yellow-600/40'
                  : 'bg-blue-900/20 border-blue-600/40';
                const textColor = (allVerified || cleanWithAcks) ? 'text-green-400'
                  : anyMissing ? 'text-red-400' : anyMismatched ? 'text-yellow-400' : 'text-blue-400';
                return (
                  <div className={`${bg} border rounded-lg p-4 text-center`}>
                    <span className="text-3xl">{emoji}</span>
                    <p className={`text-sm font-semibold ${textColor} mt-1`}>{message}</p>
                    {(allVerified || cleanWithAcks) && (
                      <p className="text-xs text-gray-500 mt-1">
                        {valVerified}/{valTotal} resources confirmed via GET requests to destination
                      </p>
                    )}
                  </div>
                );
              }

              // Fallback: migration output banner (no validation available)
              if (total === 0) return null;
              const successRate = total > 0 ? Math.min(1, success / total) : 0;
              const allPerfect = failed === 0 && skipped === 0 && success > 0;
              const allFailed = success === 0 && failed > 0;
              const hasFailures = failed > 0;

              const emoji = allPerfect ? '\uD83C\uDF89' : allFailed ? '\u274C' : hasFailures ? '\u26A0\uFE0F' : '\u2705';
              const message = allPerfect
                ? 'Migration Complete - all resources migrated successfully!'
                : allFailed
                  ? 'Migration Failed - no resources were migrated.'
                  : hasFailures
                    ? `Migration completed with ${failed} failure${failed !== 1 ? 's' : ''}. Review errors below.`
                    : `Migration Complete - ${success} of ${total} resources migrated.`;
              const bg = allPerfect
                ? 'bg-green-900/20 border-green-600/40'
                : allFailed
                  ? 'bg-red-900/20 border-red-600/40'
                  : hasFailures
                    ? 'bg-yellow-900/20 border-yellow-600/40'
                    : 'bg-green-900/20 border-green-600/40';
              const textColor = allPerfect
                ? 'text-green-400'
                : allFailed
                  ? 'text-red-400'
                  : hasFailures
                    ? 'text-yellow-400'
                    : 'text-green-400';

              return (
                <div className={`${bg} border rounded-lg p-4 text-center`}>
                  <span className="text-3xl">{emoji}</span>
                  <p className={`text-sm font-semibold ${textColor} mt-1`}>{message}</p>
                  {allPerfect && (
                    <p className="text-xs text-gray-500 mt-1">
                      {Math.round(successRate * 100)}% success rate across {total} resources
                    </p>
                  )}
                </div>
              );
            })()}

            {/* New nameservers */}
            {report?.newNameservers && report.newNameservers.length > 0 && (
              <div className="bg-orange-900/20 border border-orange-600/40 rounded-md p-4">
                <h4 className="text-sm font-semibold text-orange-400 mb-2">
                  Update Your Nameservers
                </h4>
                <ul className="space-y-1">
                  {report.newNameservers.map((ns: string, i: number) => (
                    <li key={i} className="font-mono text-sm text-orange-300">
                      {ns}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Errors callout (if any) */}
          {report?.errors && report.errors.length > 0 && (
            <div className="bg-red-900/20 border border-red-600/40 rounded-md p-4">
              <h3 className="text-sm font-semibold text-red-400 mb-2">
                Errors ({report.errors.length})
              </h3>
              <ul className="space-y-1">
                {report.errors.map((err: MigrationError, i: number) => (
                  <li key={i} className="text-sm text-red-300">
                    {typeof err === 'string'
                      ? err
                      : `${err.resource || err.name || 'Unknown'}: ${err.error || JSON.stringify(err)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Manual actions callout */}
          {report?.manualActions && report.manualActions.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-md p-4">
              <h3 className="text-sm font-semibold text-yellow-400 mb-2">
                Manual Actions Required ({report.manualActions.length})
              </h3>
              <ul className="list-disc list-inside space-y-1">
                {report.manualActions.map((action: string, i: number) => (
                  <li key={i} className="text-sm text-yellow-300 whitespace-pre-line">
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Validation section cards (preferred when available) */}
          {hasValidation && report.validation && report.validation.sections.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {report.validation.sections.map((section: ValidationSection, si: number) => (
                <ValidationSectionCard key={si} section={section} sourceCtx={sourceDashCtx} destCtx={destDashCtx} />
              ))}
            </div>
          )}

          {/* Migration section cards (fallback when no validation) */}
          {!hasValidation && sectionsWithItems.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sectionsWithItems.map((section: ReportSection, si: number) => (
                <SectionCard key={si} section={section} sourceCtx={sourceDashCtx} destCtx={destDashCtx} />
              ))}
            </div>
          )}

          {/* Collapsed empty sections */}
          {emptySections.length > 0 && (
            <div className="text-xs text-gray-600 px-1">
              <span className="font-medium text-gray-500">No items:</span>{' '}
              {emptySections.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* ── API endpoints hit (actuals), per phase ── */}
      {accountCallLines.length > 0 && (
        <LogPanel logs={accountCallLines} title={`Account API calls (${accountCallLines.length})`} collapsible maxHeight="400px" />
      )}
      {zoneCallLines.length > 0 && (
        <LogPanel logs={zoneCallLines} title={`Zone API calls (${zoneCallLines.length})`} collapsible maxHeight="400px" />
      )}

      {/* ── Dry Run Results ── */}
      {isDryRun && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-lg font-semibold text-gray-100">Dry Run &mdash; API Call Preview</h3>
            <div className="flex items-center gap-2">
              {CODE_FORMATS.map((fmt) => (
                <button type="button"
                  key={fmt.value}
                  onClick={() => setCodeFormat(fmt.value)}
                  className={`px-3 py-1 text-xs rounded font-medium transition ${
                    codeFormat === fmt.value
                      ? 'bg-orange-500 text-white'
                      : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {fmt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <pre className="bg-[#0d1117] text-[#c9d1d9] p-4 rounded-md text-xs font-mono overflow-x-auto max-h-[400px] overflow-y-auto border border-[#30363d] leading-relaxed">
              {generatedCode}
            </pre>

            <div className="absolute top-2 right-2 flex gap-1">
              <button type="button"
                onClick={handleCopyCode}
                className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button type="button"
                onClick={handleDownloadCode}
                className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition"
              >
                Download
              </button>
            </div>
          </div>

          {(onBackToConfig || onExecuteReal) && (
            <div className="flex items-center gap-3">
              {onBackToConfig && (
                <button type="button"
                  onClick={onBackToConfig}
                  className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition whitespace-nowrap"
                >
                  &larr; Back to Apply
                </button>
              )}
              {onExecuteReal && (
                <button type="button"
                  onClick={onExecuteReal}
                  className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-400 text-white font-semibold rounded-lg transition"
                >
                  Execute for Real
                </button>
              )}
            </div>
          )}
          {onExecuteReal && (
            <p className="text-xs text-gray-500 text-center">
              Runs the migration with the configuration you already entered &mdash; nothing is re-entered.
            </p>
          )}
        </div>
      )}

      {/* ── Verify ── */}
      {!isDryRun && (
        <>
        <h2 className="text-xl font-bold text-gray-100">Verify</h2>
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-100">Verify Migration</h3>
              <p className="text-xs text-gray-400 mt-1">
                Export the destination zone and compare with the source to find discrepancies.
                {sourceFormat !== 'api' && (
                  <span className="ml-1">
                    Source was imported from {sourceFormat === 'json' ? 'JSON' : 'Terraform'} - comparison will show any differences.
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button"
                onClick={onVerify}
                disabled={!canVerify}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition whitespace-nowrap ${
                  canVerify
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {hasVerification ? 'Re-verify' : 'Verify Now'}
              </button>
            </div>
          </div>

          {/* Verification Results */}
          {hasVerification && report.verification && (
            <div className="border-t border-gray-700 pt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-green-400 font-bold">{'\u2713'}</span>
                <span className="text-gray-300">
                  Verification completed at {new Date(report.verification.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {report.verification.diff?.discrepancies && report.verification.diff.discrepancies.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-yellow-400">
                    Discrepancies Found ({report.verification.diff.discrepancies.length})
                  </h4>
                  <div className="max-h-[300px] overflow-y-auto space-y-2">
                    {report.verification.diff.discrepancies.map((d, i: number) => (
                      <div key={i} className="bg-gray-700/50 rounded-md p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-200">{d.resource || d.path}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            d.type === 'missing' ? 'bg-red-900/40 text-red-400'
                              : d.type === 'extra' ? 'bg-blue-900/40 text-blue-400'
                              : 'bg-yellow-900/40 text-yellow-400'
                          }`}>
                            {d.type === 'missing' ? 'Missing in dest' : d.type === 'extra' ? 'Extra in dest' : 'Different'}
                          </span>
                        </div>
                        {d.reason && (
                          <p className="text-xs text-gray-400">{d.reason}</p>
                        )}
                        {d.source !== undefined && d.dest !== undefined && (
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono">
                            <div>
                              <span className="text-gray-500">Source:</span>
                              <pre className="text-red-300 mt-0.5 whitespace-pre-wrap">{typeof d.source === 'string' ? d.source : JSON.stringify(d.source, null, 2)}</pre>
                            </div>
                            <div>
                              <span className="text-gray-500">Dest:</span>
                              <pre className="text-green-300 mt-0.5 whitespace-pre-wrap">{typeof d.dest === 'string' ? d.dest : JSON.stringify(d.dest, null, 2)}</pre>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-green-900/20 border border-green-600/40 rounded-md p-4">
                  <p className="text-sm text-green-400 font-medium">
                    No discrepancies found - destination matches source configuration.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        </>
      )}

      {/* ── Optional IdP login test card ── */}
      {!isDryRun && (
        <Step4IdPTestSection
          report={report}
          idpTestResults={idpTestResults}
          setIdpTestResults={setIdpTestResults}
        />
      )}

      {/* ── Download ── */}
      <div className="space-y-3 pt-2">
        <h2 className="text-xl font-bold text-gray-100">Download</h2>
        {/* Optional password protection for every download below (SC-28). */}
        <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-3">
          <label className="flex items-center gap-2 text-sm text-gray-200 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={encryptDownloads}
              onChange={(e) => {
                setEncryptDownloads(e.target.checked);
                setEncryptError('');
                if (!e.target.checked) setDownloadPassword('');
              }}
              className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-orange-500 focus:ring-orange-500"
            />
            Password-protect downloaded files
            <span className="text-xs text-gray-500">(AES-256-GCM · applies to every download below)</span>
          </label>
          {encryptDownloads && (
            <div className="mt-2 pl-6">
              <label htmlFor="tz-download-password" className="sr-only">Encryption password (required)</label>
              <input
                id="tz-download-password"
                type="password"
                required
                autoComplete="new-password"
                value={downloadPassword}
                onChange={(e) => { setDownloadPassword(e.target.value); if (e.target.value) setEncryptError(''); }}
                placeholder="Password (required)"
                aria-invalid={!downloadPassword}
                className="w-full max-w-xs px-3 py-1.5 text-sm rounded-md bg-gray-900 border border-gray-600 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Files download as a <code className="text-gray-400">.enc</code> envelope. Keep this password — it cannot be recovered.
              </p>
              {encryptError && <p className="mt-1 text-xs text-red-400">{encryptError}</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button"
            onClick={handleExportJson}
            className="px-4 py-2 border border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-100 text-sm font-medium rounded-lg transition"
          >
            Curated LLM-Friendly JSON
          </button>
          <button type="button"
            onClick={handleDownloadCsv}
            className="px-4 py-2 border border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-100 text-sm font-medium rounded-lg transition"
          >
            API Call Log (.csv)
          </button>
          <button type="button"
            onClick={handleDownloadReport}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium rounded-lg transition"
          >
            Migration Report (.md)
          </button>
        </div>
      </div>

      {/* ── Next Steps ── */}
      <div className="space-y-3 pt-2">
        <h2 className="text-xl font-bold text-gray-100">Next Steps</h2>
        <FeedbackCard email={migratorEmail} />
        <div className="flex flex-wrap gap-2">
          <button type="button"
            onClick={onStartNew}
            className="px-5 py-2 border border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-100 text-sm font-medium rounded-lg transition"
          >
            Start New Migration
          </button>
          <a
            href="https://dash.cloudflare.com/profile/api-tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 border border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-100 text-sm font-medium rounded-lg transition inline-flex items-center gap-1"
          >
            Rotate API Keys
          </a>
        </div>
      </div>
    </div>
  );
}

