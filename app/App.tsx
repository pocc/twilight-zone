import React, { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Layout } from './components/Layout';
import { SpecDriftBanner } from './components/SpecDriftBanner';
import { StepIndicator } from './components/StepIndicator';
import { LogPanel } from './components/LogPanel';
import { Toast } from './components/Toast';
import { UptimeMonitorCard } from './components/UptimeMonitorCard';
import { MonitorHeartbeat } from './components/MonitorHeartbeat';
import { MonitorProvider } from './hooks/MonitorContext';
import { StepFallback } from './components/StepFallback';
import { ErrorBoundary } from './components/ErrorBoundary';
// Each wizard step is its own large component (~400-1800 LOC + dependent
// fix-it widgets). Lazy-loading them via React.lazy means the initial SPA
// bundle ships only the Setup screen, with later steps fetched on demand as the user
// progresses. See ./components/steps/* for the underlying modules.
//
// Type-only imports of OperationMode/SourceMode/ExportFormat come from
// step0/operationMode (a tiny types-only module), NOT Step0Credentials,
// to avoid forcing a static dependency that would defeat the split.
const Step0Credentials = lazy(() =>
  import('./components/steps/Step0Credentials').then(m => ({ default: m.Step0Credentials })),
);
// Account (step 1) and Zone (step 2) are two step components over one shared
// scope view (ScopeReview); see Step1Account.tsx. The preset "Apply" view
// renders ScopeReview directly (phase=undefined, every group).
const Step1Account = lazy(() =>
  import('./components/steps/Step1Account').then(m => ({ default: m.Step1Account })),
);
const Step2Zone = lazy(() =>
  import('./components/steps/Step2Zone').then(m => ({ default: m.Step2Zone })),
);
const ScopeReview = lazy(() =>
  import('./components/steps/ScopeReview').then(m => ({ default: m.ScopeReview })),
);
const Step4Results = lazy(() =>
  import('./components/steps/Step4Results').then(m => ({ default: m.Step4Results })),
);
const Step3Apply = lazy(() =>
  import('./components/steps/Step3Apply').then(m => ({ default: m.Step3Apply })),
);
const PresetApplyStep = lazy(() =>
  import('./components/steps/PresetApplyStep').then(m => ({ default: m.PresetApplyStep })),
);
import type { SourceMode } from './components/steps/step0/operationMode';
import { computeDefaultSelections } from './components/steps/scope/groups';
import { useCredentials } from './hooks/useCredentials';
import { useAccounts } from './hooks/useAccounts';
import { useBlockerCheck } from './hooks/useBlockerCheck';
import { useStreamRequest } from './hooks/useStreamRequest';
import type { LogLine } from './hooks/useStreamRequest';
import type { ZoneExport, MigrationReport, CFWorkerBinding, AnalyticsExport } from '../src/types';
// Leaf import (types-only deps) so we don't pull the whole migrate engine into
// the client bundle.
import { mergeReports } from '../src/migrate/merge-reports';
import { generateReportMarkdown } from '../src/migrate/report-markdown';
import { MIGRATION_STEPS, PRESET_STEPS, PRESET_DISABLED_STEPS } from './components/StepIndicator';
import type { ApiCall } from './lib/codegen';

import { asStreamResult } from './lib/streamResult';
import { generateValidationWarnings } from './lib/validation';
import * as api from './lib/api';
import type { AccountCapabilities, AvailablePlan } from './lib/api';
import type { EmailAddressState } from './components/EmailAddressVerificationCard';
import { reconcileEmailAddressStates } from './components/EmailAddressVerificationCard';
import { buildMaxConfigPreview } from '../src/maxconfig-preview';
import { summarizePresetReports, type PresetReportLike } from '../src/fuzz';
import { useDestDiff } from './hooks/useDestDiff';
import { loadWizardState, saveWizardState, clearWizardState, resolveInitialStep, stepUrl } from './lib/wizardPersistence';

export function App() {
  // ── Core state ────────────────────────────────────────────────
  const creds = useCredentials();
  const accounts = useAccounts(creds.credentials, creds.hasAuth);
  // Destination-context auth presence (mirrors lib/api destAuthBody selection):
  // API key → dest key/email or primary fallback; token → dest token or source
  // fallback. Drives the destination account list, which every flow's target
  // dropdown (migration dest AND the JSON/Terraform/preset target) reads from.
  const hasDestAuth = creds.useApiKey
    ? !!((creds.destApiKey || creds.apiKey) && (creds.destApiEmail || creds.apiEmail))
    : !!(creds.destToken || creds.sourceToken);
  const destAccounts = useAccounts(creds.credentials, hasDestAuth, 'dest');
  const blockerCheck = useBlockerCheck(creds.credentials, creds.hasAuth);
  const stream = useStreamRequest();

  // Refresh-recovery snapshot, loaded ONCE at mount (see
  // app/lib/wizardPersistence.ts). Seeds the wizard state below via lazy
  // initializers so a hard refresh restores the same step + non-secret data.
  // Secrets/credentials are never in here and must be re-entered.
  const [initialSnapshot] = useState(loadWizardState);

  // Wizard step state. 0 = Setup (landing), 1 = Account, 2 = Zone, 3 = Apply,
  // 4 = Results — the same numbering as the wizard strip (MIGRATION_STEPS),
  // so the StepIndicator needs no offset. Routing is URL-authoritative: the
  // bare apex lands on Setup, and `?step=N` is honored verbatim (see
  // resolveInitialStep). Data-less steps render their own empty state.
  const [step, setStepRaw] = useState(() => resolveInitialStep(initialSnapshot, location.search));
  // Seed the furthest-reached step to at least the resolved initial step so a
  // deep-link (?step=N) has consistent breadcrumb state and back/forward bounds
  // even with no snapshot to back it.
  const [maxStepReached, setMaxStepReached] = useState(() => Math.max(initialSnapshot?.maxStepReached ?? 0, step));
  const setStep = useCallback((s: number) => {
    setStepRaw(s);
    setMaxStepReached(prev => Math.max(prev, s));
  }, []);

  // Idle-prefetch the next step's lazy chunk so the click-to-render time
  // is dominated by the user's reading speed, not network latency. The
  // browser may discard the request if it never becomes idle; that's
  // fine - clicking Next will fall back to the regular lazy fetch.
  useEffect(() => {
    const idle: (cb: () => void) => number =
      (typeof window !== 'undefined' && 'requestIdleCallback' in window
        ? (cb) => (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(cb)
        : (cb) => window.setTimeout(cb, 200));
    const cancelIdle: (h: number) => void =
      (typeof window !== 'undefined' && 'cancelIdleCallback' in window
        ? (h) => (window as unknown as { cancelIdleCallback: (h: number) => void }).cancelIdleCallback(h)
        : (h) => window.clearTimeout(h));
    const handle = idle(() => {
      // Prefetch ALL remaining step bundles so back-and-forth navigation
      // between steps doesn't trigger a chunk fetch each time. The chunks
      // are small enough (~50-150 KB each) that warming them all once is
      // cheaper than juggling per-step heuristics.
      if (step === 0) {
        import('./components/steps/Step1Account');
        import('./components/steps/ScopeReview');
      } else if (step === 1) {
        import('./components/steps/Step2Zone');
        import('./components/steps/ScopeReview');
      } else if (step === 2) {
        import('./components/steps/Step3Apply');
        import('./components/steps/PresetApplyStep');
      } else if (step === 3) {
        import('./components/steps/Step4Results');
      }
    });
    return () => cancelIdle(handle);
  }, [step]);
  // The wizard no longer has an explicit Migrate-vs-Export switch: the
  // Source panel's tabs + inline export buttons cover both flows. `sourceMode`
  // is the single selector for where the source config comes from.
  const [sourceMode, setSourceMode] = useState<SourceMode>(() => initialSnapshot?.sourceMode ?? 'api');
  const [includeUnsafeAccountWideTrafficSettings, setIncludeUnsafeAccountWideTrafficSettings] = useState(false);
  const [importedData, setImportedData] = useState<ZoneExport | null>(null);
  const [exportData, setExportData] = useState<ZoneExport | null>(() => initialSnapshot?.exportData ?? null);
  // [C6] Track when export was fetched to warn if stale before migration
  const [exportTimestamp, setExportTimestamp] = useState<number | null>(() => initialSnapshot?.exportTimestamp ?? null);
  // Saved export logs to display on Setup when user navigates back
  const [exportLogs, setExportLogs] = useState<LogLine[]>([]);
  // True while the Scope Migration export stream is running (log shown inline, not in overlay)
  const [isExporting, setIsExporting] = useState(false);
  // True while the Execute Migration stream is running (log shown inline on Step 3)
  const [isMigrating, setIsMigrating] = useState(false);
  // NOTE: dry-run vs real is passed as an explicit argument to
  // buildMigrateBody/handleRunMigration, NOT held in component state. A previous
  // version stored it in state and the Step 3 buttons did
  // `setDryRun(x); onExecute()` - but onExecute closed over the stale
  // pre-update value, so the first "Dry Run" click could fire a REAL
  // migration. Passing the flag as an argument removes that hazard and
  // lets Step 4 re-run the real migration in place after a dry run.
  // Saved migration logs to display on Step 3 when user navigates back
  const [migrationLogs, setMigrationLogs] = useState<LogLine[]>(() => initialSnapshot?.migrationLogs ?? []);
  // Account-resources (phase 1) deploy log. Captured between the two phases of
  // an Apply-driven run (the zone phase's stream resets the shared log), so the
  // post-migration Apply view can show it alongside the zone log.
  const [accountMigrationLogs, setAccountMigrationLogs] = useState<LogLine[]>([]);
  const [selections, setSelections] = useState<Record<string, Record<string, boolean>>>(() => initialSnapshot?.selections ?? {});
  const [conflictStrategy, setConflictStrategy] = useState<'skip' | 'overwrite'>(() => initialSnapshot?.conflictStrategy ?? 'skip');
  const [workerSecrets, setWorkerSecrets] = useState<Record<string, Record<string, string>>>({});
  const [certificates, setCertificates] = useState<Array<{ cert: string; key: string }>>([]);
  // Origin CA CSRs for re-issuance on the destination. Each entry is
  // a freshly-generated CSR (private key stays client-side) that matches
  // a source-account Origin CA cert by ID.
  const [originCaCsrs, setOriginCaCsrs] = useState<Array<{
    sourceId: string;
    hostnames: string[];
    csr: string;
    request_type: 'origin-rsa' | 'origin-ecc';
    requested_validity: number;
  }>>([]);
  // Notification webhook signing secrets - keyed by source webhook
  // name. Filled in via the scope (Account/Zone) OutOfScopePanel inline fix-it form
  // (or the Step 3 section). When non-empty, the migrator passes the
  // value on the POST body to /alerting/v3/destinations/webhooks.
  const [notificationWebhookSecrets, setNotificationWebhookSecrets] = useState<Record<string, string>>({});
  // Access IdP client_secret values, keyed by source IdP name.
  const [identityProviderSecrets, setIdentityProviderSecrets] = useState<Record<string, string>>({});
  // Bucket 2.3: AOP mTLS cert + private_key bundles.
  const [aopMtlsBundles, setAopMtlsBundles] = useState<Array<{
    name: string;
    certificates: string;
    private_key: string;
    ca?: boolean;
  }>>([]);
  // Bucket 2.4: AI Gateway custom provider API keys, keyed by source slug.
  const [aiGatewayProviderApiKeys, setAiGatewayProviderApiKeys] = useState<Record<string, string>>({});
  // Step 4 optional IdP end-to-end login test attestations, keyed by
  // destination IdP UUID. Values are 'ok' | 'failed'. The user
  // self-attests by clicking the Worked/Failed buttons in the
  // Step4IdPTestSection card after opening the per-IdP Test login
  // link in a new tab. Lives in-memory only - cleared on page reload.
  // Not persisted to localStorage (matches existing wizard state
  // policy).
  const [idpTestResults, setIdpTestResults] = useState<Record<string, 'ok' | 'failed'>>({});
  // Durable Object migration config - keyed by worker name
  const [doConfigs, setDoConfigs] = useState<Record<string, { enabled: boolean; objectNames: string; sourceUrl: string; destUrl: string }>>(() => initialSnapshot?.doConfigs ?? {});
  // D1 migration acknowledgment - keyed by D1 database uuid
  const [d1Configs, setD1Configs] = useState<Record<string, { acknowledged: boolean }>>(() => initialSnapshot?.d1Configs ?? {});
  // Pre-migration acknowledgments (user accepted that certain items won't migrate)
  const [acknowledgments, setAcknowledgments] = useState<Set<string>>(() => new Set(initialSnapshot?.acknowledgments ?? []));

  // R2 S3 credentials for data migration
  const [r2Credentials, setR2Credentials] = useState<{
    source: { accessKeyId: string; secretAccessKey: string };
    dest: { accessKeyId: string; secretAccessKey: string };
  }>({
    source: { accessKeyId: '', secretAccessKey: '' },
    dest: { accessKeyId: '', secretAccessKey: '' },
  });



  // Destination account capabilities (which features are enabled)
  const [capabilities, setCapabilities] = useState<AccountCapabilities | null>(() => initialSnapshot?.capabilities ?? null);
  const [recheckingCapabilities, setRecheckingCapabilities] = useState(false);
  // Existing Turnstile widget names on destination account (for duplicate detection)
  const [existingTurnstileWidgets, setExistingTurnstileWidgets] = useState<string[]>(() => initialSnapshot?.existingTurnstileWidgets ?? []);
  // Per-address verification state for email forwarding addresses (scope gate)
  const [emailAddressStates, setEmailAddressStates] = useState<Record<string, EmailAddressState>>({});

  // Available plans for destination zone
  const [availablePlans, setAvailablePlans] = useState<AvailablePlan[]>([]);
  const [planCounts, setPlanCounts] = useState<Record<string, number>>({});
  const [plansLoading, setPlansLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(() => initialSnapshot?.selectedPlan ?? null);

  // Results state
  const [report, setReport] = useState<MigrationReport | null>(() => initialSnapshot?.report ?? null);
  // #19 two-phase: the Account-step (pre-zone) report, held so the Zone-step
  // report can be merged with it for the read-only Results step.
  const [accountReport, setAccountReport] = useState<MigrationReport | null>(() => initialSnapshot?.accountReport ?? null);
  const [reportMarkdown, setReportMarkdown] = useState(() => initialSnapshot?.reportMarkdown ?? '');
  // Zone-phase audit log (the actual zone-scoped API endpoints hit). The
  // account phase's calls live in `accountAuditLog` below so the zone phase no
  // longer clobbers them — both are shown as collapsed terminals after the run.
  const [auditLog, setAuditLog] = useState<unknown[]>(() => initialSnapshot?.auditLog ?? []);
  const [accountAuditLog, setAccountAuditLog] = useState<unknown[]>(() => initialSnapshot?.accountAuditLog ?? []);
  const [apiCalls, setApiCalls] = useState<ApiCall[] | null>(null);

  // Source-zone analytics capture (spike/analytics-export). Runs in parallel
  // with the migration (non-blocking) and is offered as a JSON download on
  // Step 4. status: 'idle' (never started) | 'running' | 'ready' | 'error'.
  const [analyticsStatus, setAnalyticsStatus] = useState<'idle' | 'running' | 'ready' | 'error'>('idle');
  const [analyticsExport, setAnalyticsExport] = useState<AnalyticsExport | null>(null);
  const [analyticsError, setAnalyticsError] = useState('');
  // Aborts an in-flight analytics capture (e.g. when the user cancels the
  // migration). Held in a ref so handleCancel can reach it without becoming a
  // dependency of the capture callback.
  const analyticsAbortRef = useRef<AbortController | null>(null);
  // Analytics capture config — lives in the Account step's "Archive source analytics"
  // section (replaces the old execute-time modal). Pre-checked (opt-out): the
  // dominant migration motive means losing source access, so default-on, but
  // the user can uncheck. lookbackDays in [1,90]; datasets = per-dataset
  // selection (null = capture every available dataset).
  const [captureAnalytics, setCaptureAnalytics] = useState(true);
  const [analyticsLookbackDays, setAnalyticsLookbackDays] = useState(90);
  const [analyticsDatasets, setAnalyticsDatasets] = useState<string[] | null>(null);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  // Stable callback passed to child steps so they can replace native alert()
  // calls with the in-app Toast component.
  const showToast = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    setToast({ message, type });
  }, []);

  // Created resources for rollback
  const [createdResources, setCreatedResources] = useState<Record<string, unknown>>({
    zoneId: null, workers: [], kvNamespaces: [], r2Buckets: [], d1Databases: [], queues: [],
  });

  // ── Capture export logs when stepping into the Account step ────
  // Also re-capture when `isExporting` flips: with the "advance to Account
  // immediately" flow the export stream completes *while already on the Account
  // step*, so a step-only dependency would snapshot an empty log. Depending on
  // isExporting as well means we re-snapshot the full log the moment the
  // export finishes, which feeds the collapsed "Export Summary" panel.
  useEffect(() => {
    // Snapshot the EXPORT log on the Account step (1) once the export finishes —
    // but not while a migration stream is running on that step (that's the
    // account-deploy log, captured below), or it would clobber the export log.
    if (step === 1 && !isMigrating && stream.logs.length > 0) {
      setExportLogs([...stream.logs]);
    }
    // Snapshot the migration log when a run completes and advances to the
    // Apply (step 3) or Results (step 4) step.
    if ((step === 3 || step === 4) && stream.logs.length > 0) {
      setMigrationLogs([...stream.logs]);
    }
  }, [step, isExporting, isMigrating]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist wizard state for refresh recovery ──────────────────
  // Debounced write of a NON-SECRET snapshot to localStorage (see
  // app/lib/wizardPersistence.ts) so a hard refresh restores the same step +
  // data. Secrets/credentials and the in-flight stream flags are deliberately
  // excluded; the ?step= query param (set by the history effects below) carries
  // the step pointer alongside this data half.
  const persistTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      saveWizardState({
        sourceMode, step, maxStepReached,
        exportData, exportTimestamp, selections, conflictStrategy,
        capabilities, existingTurnstileWidgets, doConfigs, d1Configs,
        acknowledgments: [...acknowledgments], selectedPlan,
        report, accountReport, reportMarkdown, auditLog, accountAuditLog, migrationLogs,
      });
    }, 300);
    return () => { if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current); };
  }, [
    sourceMode, step, maxStepReached, exportData, exportTimestamp, selections,
    conflictStrategy, capabilities, existingTurnstileWidgets, doConfigs, d1Configs,
    acknowledgments, selectedPlan, report, accountReport, reportMarkdown, auditLog, accountAuditLog, migrationLogs,
  ]);

  // ── Default selections (zone-scoped checked, account-scoped unchecked, disabled groups off) ──
  // `allOn` (used by MaxConfig) overrides the zone-vs-account default and selects every
  // non-disabled item - the user opted into the full preset, so making them re-tick
  // account-scoped groups is unnecessary friction.
  //
  // `conflictStrategy` and `d1Configs` MUST match what the live scope view
  // (`buildGroups` call in ScopeReview) will pass, otherwise item-level disable
  // computations diverge: a Turnstile widget that already exists on the dest is
  // disabled under 'skip' but selectable under 'overwrite', and a D1 db is
  // disabled until acknowledged. If init under-computes these (the historical
  // bug: both args defaulted/omitted), `allOn` cannot select the affected items
  // and they render unchecked even though MaxConfig will apply them anyway.
  const initDefaultSelections = useCallback((
    data: ZoneExport,
    caps?: AccountCapabilities | null,
    turnstileWidgets?: string[],
    allOn = false,
    conflictStrategy: 'skip' | 'overwrite' = 'skip',
    d1Configs?: Record<string, { acknowledged: boolean }>,
  ) => {
    setSelections(computeDefaultSelections(data, caps ?? undefined, turnstileWidgets, allOn, conflictStrategy, d1Configs));
  }, []);

  // ── Navigation ────────────────────────────────────────────────
  const goToStep = useCallback((s: number) => {
    if (s >= 0 && s <= 4) setStep(s);
  }, []);

  const goToLanding = useCallback(() => {
    // Starting over: drop the persisted snapshot and the ?step= pointer BEFORE
    // reloading, otherwise the reload would just restore the migration we're
    // trying to leave.
    clearWizardState();
    history.replaceState({ tzStep: 0 }, '', location.pathname);
    location.reload();
  }, []);

  // ── Browser / mouse Back & Forward navigate wizard steps (History API) ──
  // Every step change pushes a history entry whose URL carries `?step=N` (clean
  // path at Setup), so browser/mouse back-forward (both fire `popstate`) move
  // between wizard steps AND a hard refresh restores the same step. The heavy,
  // NON-SECRET data half is persisted to localStorage (see
  // app/lib/wizardPersistence.ts) and re-hydrated at mount via `initialSnapshot`;
  // `resolveInitialStep` is URL-authoritative — the bare apex lands on Setup and
  // `?step=N` is honored verbatim (data-less steps render their own empty state,
  // and in-flight SSE streams can't resume — the worker is stateless).
  // Credentials/secrets are never persisted,
  // so the user re-enters them after a refresh. Forward is bounded by
  // `maxStepReached`; back to Setup is always allowed. While a stream is running
  // (export/migrate) navigation is blocked so a mis-click can't abandon it.
  // Modals are intentionally ignored here (this diverges from the keyboard
  // shortcut path below, which suppresses while a dialog is open — by design).
  const stepRef = useRef(step);
  const maxStepReachedRef = useRef(maxStepReached);
  const navBlockedRef = useRef(false);
  const isPopStateRef = useRef(false);
  const didMountStepRef = useRef(false);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { maxStepReachedRef.current = maxStepReached; }, [maxStepReached]);
  useEffect(() => {
    navBlockedRef.current = stream.loading || isExporting || isMigrating;
  }, [stream.loading, isExporting, isMigrating]);

  // Push a clean history entry on every (non-popstate) step change — including
  // the auto-advance into the Account step — so Back undoes it. The first run
  // seeds the initial Setup (step 0) entry with replaceState instead of pushing.
  useEffect(() => {
    if (!didMountStepRef.current) {
      didMountStepRef.current = true;
      history.replaceState({ tzStep: step }, '', stepUrl(step));
      return;
    }
    if (isPopStateRef.current) { isPopStateRef.current = false; return; }
    history.pushState({ tzStep: step }, '', stepUrl(step));
  }, [step]);

  // Handle back/forward. Registered once; reads live values via refs.
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      // Block while a stream is running: re-assert the current step so the
      // mis-click can't abandon a running export/migration.
      if (navBlockedRef.current) {
        history.pushState({ tzStep: stepRef.current }, '', stepUrl(stepRef.current));
        showToast('Navigation is paused while a migration is in progress.', 'error');
        return;
      }
      const state = e.state as { tzStep?: number } | null;
      const target = typeof state?.tzStep === 'number' ? state.tzStep : 0;
      // Forward is bounded by the furthest step reached; back to Setup (step 0)
      // is always allowed. (Back from Setup falls through to normal browser
      // back — we don't trap the user in the app.)
      const clamped = Math.min(Math.max(target, 0), maxStepReachedRef.current);
      if (clamped === stepRef.current) return;
      // If we had to clamp the target (e.g. a forward entry beyond
      // maxStepReached), realign the URL so ?step= matches the step we actually
      // land on — the push-on-change effect is suppressed during popstate.
      if (clamped !== target) history.replaceState({ tzStep: clamped }, '', stepUrl(clamped));
      // Use setStepRaw (not setStep) so popstate-driven nav never bumps
      // maxStepReached, and flag it so the push-on-change effect doesn't add a
      // duplicate entry while handling this popstate.
      isPopStateRef.current = true;
      setStepRaw(clamped);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [showToast]);

  // ── Fetch destination capabilities ────────────────────────────
  const fetchCapabilities = useCallback(async (): Promise<{ caps: AccountCapabilities; turnstileWidgets: string[] } | null> => {
    const { credentials } = creds;
    if (!credentials.destAccountId) return null;
    try {
      const destAuth = credentials.destToken || credentials.sourceToken;
      if (!destAuth && !credentials.useApiKey) return null;
      const result = await api.checkCapabilities(credentials, credentials.destAccountId);
      const caps = result.capabilities;
      const turnstileWidgets = result.existingTurnstileWidgets || [];
      setCapabilities(caps);
      setExistingTurnstileWidgets(turnstileWidgets);
      return { caps, turnstileWidgets };
    } catch {
      return null; // Non-fatal: assume all features available if check fails
    }
  }, [creds]);

  // Re-check capabilities (user may have enabled features on destination)
  const handleRecheckCapabilities = useCallback(async () => {
    setRecheckingCapabilities(true);
    try {
      const isPreset = sourceMode === 'maxconfig' || sourceMode === 'minconfig';
      if (isPreset) {
        const { credentials } = creds;
        const result = await api.checkCapabilities(credentials, credentials.sourceAccountId);
        setCapabilities(result.capabilities);
        setExistingTurnstileWidgets(result.existingTurnstileWidgets || []);
      } else {
        await fetchCapabilities();
      }
    } finally {
      setRecheckingCapabilities(false);
    }
  }, [creds, sourceMode, fetchCapabilities]);

  // ── Fetch available plans for destination zone ─────────────────
  const fetchAvailablePlans = useCallback(async () => {
    const { credentials } = creds;
    // Plans are read against the DESTINATION account with destination auth for
    // every flow — migrations and presets alike now target the destination.
    if (!credentials.destAccountId) return;
    // Don't fire until auth is actually present. The account id lives in
    // localStorage (survives tab close) but the tokens live in sessionStorage
    // (cleared on tab close), so on a fresh load the account id can be truthy
    // while auth is empty — which would 400 on the server's parseAuth. Mirror
    // destAuthBody's credential selection.
    const hasAuth = credentials.useApiKey
      ? !!((credentials.destApiKey || credentials.apiKey) && (credentials.destApiEmail || credentials.apiEmail))
      : !!(credentials.destToken || credentials.sourceToken);
    if (!hasAuth) return;
    setPlansLoading(true);
    try {
      const domainName = credentials.domainName || undefined;
      const result = await api.getAvailablePlans(credentials, credentials.destAccountId, domainName);
      const plans = result.plans || [];
      const counts = result.planCounts || {};
      setAvailablePlans(plans);
      setPlanCounts(counts);
      // Auto-select the highest-tier plan that has licenses (count > 0)
      const TIER_ORDER = ['enterprise', 'business', 'pro', 'free'];
      for (const tier of TIER_ORDER) {
        if (tier === 'free' || (counts[tier] && counts[tier] > 0)) {
          setSelectedPlan(tier);
          break;
        }
      }
    } catch {
      setAvailablePlans([]);
      setPlanCounts({});
    } finally {
      setPlansLoading(false);
    }
    // Deps are the specific credential fields read above, NOT the whole `creds`
    // object (which is a fresh literal every render — depending on it recreated
    // this callback on every render for no reason). `selectedPlan` was a
    // spurious dep: this callback only *writes* it via setSelectedPlan, never
    // reads it, so including it churned the identity without changing behavior.
    // A stable callback keeps the debounced auto-fetch effect from being
    // re-armed on unrelated renders. React setters (setSelectedPlan et al.) are
    // stable and intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    creds.credentials.destAccountId, creds.credentials.domainName,
    creds.credentials.useApiKey, creds.credentials.destApiKey, creds.credentials.apiKey,
    creds.credentials.destApiEmail, creds.credentials.apiEmail,
    creds.credentials.destToken, creds.credentials.sourceToken,
  ]);

  // ── Auto-fetch plans when the destination account changes ─────
  // Every flow (migrations + presets) targets the destination account with
  // destination auth, so the trigger is uniform.
  //
  // DEBOUNCED (500ms), mirroring useAccounts' loadAccounts. The account id is
  // restored from localStorage on load while the token lives in sessionStorage
  // (cleared on tab close), so `hasDestAuth` flips true the instant the user
  // types the *first* character of their key/token — with the old un-debounced
  // effect that meant one immediate POST /api/available-plans per keystroke,
  // ~40 rejected requests while typing a 40-char token (each an auth failure).
  // Debouncing collapses that to a single call after the user stops typing, so
  // plans load against the COMPLETE credential rather than dozens of partial,
  // guaranteed-to-fail ones.
  const plansDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    const { credentials } = creds;
    // Gate on auth too: on a fresh load the account id is restored from
    // localStorage while tokens (sessionStorage) are gone. Re-firing when auth
    // appears means plans load once the user re-enters their credentials,
    // without a 400 in the meantime. fetchAvailablePlans guards on the same
    // condition; this just avoids a wasted call.
    const c = credentials;
    const hasDestAuth = c.useApiKey
      ? !!((c.destApiKey || c.apiKey) && (c.destApiEmail || c.apiEmail))
      : !!(c.destToken || c.sourceToken);
    if (!(c.destAccountId && hasDestAuth)) return;
    if (plansDebounceRef.current) window.clearTimeout(plansDebounceRef.current);
    plansDebounceRef.current = window.setTimeout(() => { fetchAvailablePlans(); }, 500);
    return () => { if (plansDebounceRef.current) window.clearTimeout(plansDebounceRef.current); };
  }, [ // eslint-disable-line react-hooks/exhaustive-deps
    creds.credentials.destAccountId, creds.credentials.sourceAccountId,
    creds.credentials.domainName, sourceMode,
    creds.credentials.useApiKey, creds.credentials.destToken, creds.credentials.sourceToken,
    creds.credentials.destApiKey, creds.credentials.apiKey,
    creds.credentials.destApiEmail, creds.credentials.apiEmail,
  ]);

  // ── Reconcile email-address verification state when export or caps change ─
  // Builds the per-address state map from forward-rule targets in exportData,
  // intersected with the dest account's known verified-address list from
  // capabilities. Preserves user-driven status (skipped, sent, error) across
  // capability re-checks.
  useEffect(() => {
    if (!exportData) {
      setEmailAddressStates({});
      return;
    }
    setEmailAddressStates(prev =>
      reconcileEmailAddressStates(prev, exportData, capabilities?.emailRouting?.destinationAddresses),
    );
  }, [exportData, capabilities]);

  // ── Reset stale export/preview when the SOURCE changes ─────────
  // If the user already previewed/exported and then edits the source back on
  // Setup (switches tab, re-imports a file, or changes account/zone/auth),
  // the cached export, the saved "Export Summary" log, the resource
  // selections, and the step history all describe the OLD source. Clear them
  // so the user re-runs Preview against the new source instead of seeing a
  // stale Export Summary or jumping forward to a preview that no longer
  // matches their credentials.
  const sourceSignature = [
    sourceMode,
    importedData ? 'imported' : 'none',
    creds.credentials.useApiKey ? 'key' : 'token',
    creds.credentials.sourceToken,
    creds.credentials.apiKey,
    creds.credentials.apiEmail,
    creds.credentials.sourceAccountId,
    creds.credentials.sourceZoneId,
  ].join('|');
  const prevSourceSigRef = useRef(sourceSignature);
  useEffect(() => {
    if (prevSourceSigRef.current === sourceSignature) return;
    prevSourceSigRef.current = sourceSignature;
    // Source edits only happen on Setup (step 0); don't disturb an in-flight flow.
    if (step !== 0) return;
    // Only act once an export/preview actually produced something.
    if (exportData || exportLogs.length > 0 || stream.logs.length > 0) {
      setExportData(null);
      setExportTimestamp(null);
      setExportLogs([]);
      setSelections({});
      setMaxStepReached(0);
      stream.reset();
    }
  }, [sourceSignature, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Setup (step 0) actions ────────────────────────────────────
  const handlePreview = useCallback(async () => {
    const { credentials } = creds;
    const isPreset = sourceMode === 'maxconfig' || sourceMode === 'minconfig';

    // Presets generate their own source and target the DESTINATION account (like
    // JSON/Terraform), named via the destination zone field. If the name matches
    // an existing zone on the destination account we run against it; otherwise we
    // create it fresh at Apply.
    const presetZoneName = credentials.domainName.trim().toLowerCase().replace(/\.$/, '');
    const presetMatchedZone = isPreset && presetZoneName
      ? destAccounts.zones.find(z => z.name.toLowerCase() === presetZoneName)
      : undefined;
    const creatingNewZone = isPreset && !!presetZoneName && !presetMatchedZone;

    // ── Validate required fields before proceeding ──
    if (sourceMode === 'json' || sourceMode === 'terraform') {
      if (!importedData || !credentials.destAccountId || !credentials.domainName) return;
    } else if (isPreset) {
      // Preset modes need a destination account + a zone name (matched or new).
      if (!credentials.destAccountId || !presetZoneName) return;
    } else {
      // API migrate mode
      if (!credentials.sourceAccountId || !credentials.sourceZoneId) return;
      if (!credentials.destAccountId || !credentials.domainName) return;
    }

    // ── Resolve the preset target zone (NO mutation here) ──
    // Scope/preview must never make breaking changes — that's the Apply phase's
    // job. Matched → reuse the existing zone id (carried on the preview's
    // zone.id). New zone → leave it empty; handleApplyPreset provisions +
    // delegates it on the destination account at Apply. This keeps "Scope
    // Migration" instant instead of blocking on createZone.
    const effectiveZoneId = isPreset
      ? (presetMatchedZone?.id || '')
      : credentials.sourceZoneId;

    // Presets target the destination account, so the capability probe + every
    // subsequent call use the destination account + destination auth.
    const capsPromise = isPreset ? (async () => {
      const { credentials } = creds;
      try {
        const result = await api.checkCapabilities(credentials, credentials.destAccountId);
        const caps = result.capabilities;
        const turnstileWidgets = result.existingTurnstileWidgets || [];
        setCapabilities(caps);
        setExistingTurnstileWidgets(turnstileWidgets);
        return { caps, turnstileWidgets };
      } catch { return null; }
    })() : fetchCapabilities();

    if ((sourceMode === 'json' || sourceMode === 'terraform') && importedData) {
      const result = await capsPromise;
      setExportData(importedData);
      setExportTimestamp(Date.now()); // [C6]
      initDefaultSelections(importedData, result?.caps, result?.turnstileWidgets);
      setStep(1);
      return;
    }

    // ── MaxConfig short-circuit ─────────────────────────────────
    // "All Features On" doesn't *export* the source zone - it slams the canned
    // MaxConfig preset onto it. The Step 3 endpoint (/api/maxconfig/stream)
    // builds its payload from `src/fuzz.ts` and ignores any data we'd export
    // here. So we skip the ~28 GET requests and build the scope preview
    // synthetically from the same MaxConfig definitions that the apply path
    // uses, ensuring the preview honestly reflects what's about to be written.
    //
    // Since the source IS the destination in MaxConfig mode, the capability
    // probe has authoritative information about what will actually apply.
    // We pass it to the preview builder so resources gated by missing
    // entitlements (Spectrum, Load Balancing, R2, D1, Queues, etc.) are
    // omitted from the preview entirely - no point asking the user to
    // acknowledge things we already know won't happen.
    if (sourceMode === 'maxconfig') {
      const result = await capsPromise;
      const zoneName = destAccounts.zones.find(z => z.id === effectiveZoneId)?.name || credentials.domainName || 'zone';
      const accountName = destAccounts.accounts.find(a => a.id === credentials.destAccountId)?.name || credentials.destAccountId;
      const preview = buildMaxConfigPreview(effectiveZoneId, zoneName, credentials.destAccountId, accountName, result?.caps ?? undefined);
      setExportData(preview);
      setExportTimestamp(Date.now());
      // MaxConfig is a destructive overwrite preset by design - default the
      // conflict strategy accordingly so existing config gets replaced rather
      // than silently skipped. The user already saw two overwrite warnings:
      // the red banner in Setup and the OverwriteConfirmModal that fired
      // when they clicked "Scope Migration".
      // Honor the user's Skip/Overwrite choice when targeting an EXISTING
      // matched zone (the inline toggle in Setup drives conflictStrategy). For a
      // brand-new zone there's nothing to conflict with, so default to overwrite.
      const presetStrategy: 'skip' | 'overwrite' = presetMatchedZone ? conflictStrategy : 'overwrite';
      setConflictStrategy(presetStrategy);
      // Auto-acknowledge D1 manual-migration gate for every synthetic db.
      // The user opted into MaxConfig wholesale; making them tick a per-db
      // acknowledgment box is meaningless ceremony for a preset that's
      // creating brand-new empty databases.
      const d1Acks: Record<string, { acknowledged: boolean }> = preview.d1Databases?.length
        ? Object.fromEntries(preview.d1Databases.map((d) => [d.uuid, { acknowledged: true }]))
        : {};
      if (preview.d1Databases?.length) {
        setD1Configs(d1Acks);
      }
      // Auto-select everything (allOn=true). MaxConfig applies the whole
      // preset regardless of UI selection, so the scope checkboxes are
      // advisory - defaulting them all on matches user intent. Pass the same
      // 'overwrite' strategy + D1 acknowledgments we just set (state updates are
      // async, so the closure values would be stale) so init's disable
      // computation matches the live scope view - otherwise duplicate Turnstile
      // widgets and unacknowledged-at-init D1 dbs render unchecked.
      initDefaultSelections(preview, result?.caps, result?.turnstileWidgets, true, presetStrategy, d1Acks);
      setStep(1); // preset → Account review, then Zone review, then Apply
      return;
    }

    // ── MinConfig new-zone short-circuit ───────────────────────────
    // MinConfig normally exports the existing zone to show what will be reset.
    // A brand-new zone has nothing to export and doesn't exist yet (creation is
    // deferred to Apply), so build an empty synthetic preview rather than hitting
    // /api/export/stream with a missing zoneId.
    if (sourceMode === 'minconfig' && creatingNewZone) {
      const result = await capsPromise;
      const accountName = destAccounts.accounts.find(a => a.id === credentials.destAccountId)?.name || credentials.destAccountId;
      const preview = {
        zone: {
          id: '', name: credentials.domainName.trim(),
          account: { id: credentials.destAccountId, name: accountName },
          name_servers: [], status: 'pending', plan: { id: 'unknown', name: 'unknown' },
        },
        dnsRecords: [], settings: [], pageRules: [], rulesets: [], workers: [], workerRoutes: [],
        workerCustomDomains: [], loadBalancers: [], pools: [], monitors: [], spectrumApps: [],
        customCertificates: [], customHostnames: [], accessApps: [], accessPolicies: [],
        firewallRules: [], rateLimits: [], emailRoutingRules: [], waitingRooms: [],
        zarazConfig: null, turnstileWidgets: [], kvNamespaces: [], r2Buckets: [], d1Databases: [],
        queues: [], durableObjectNamespaces: [],
      } as unknown as ZoneExport;
      setExportData(preview);
      setExportTimestamp(Date.now());
      initDefaultSelections(preview, result?.caps, result?.turnstileWidgets);
      setStep(1);
      return;
    }

    // MinConfig against an EXISTING destination zone is the only path that reaches
    // here as a preset: export the destination zone (using destination auth) so
    // the scope shows what will be reset. API migration exports the source zone.
    const body: Record<string, any> = isPreset
      ? {
          ...destAuthBody(credentials),
          sourceZoneId: effectiveZoneId,
          sourceAccountId: credentials.destAccountId,
        }
      : {
          sourceToken: credentials.sourceToken,
          sourceZoneId: effectiveZoneId,
          sourceAccountId: credentials.sourceAccountId,
          useApiKey: credentials.useApiKey,
          apiKey: credentials.apiKey,
          apiEmail: credentials.apiEmail,
        };

    // Stash caps result as it resolves so the synchronous beforeDone callback can read it.
    // capsPromise was kicked off above and runs concurrently with the stream.
    let capsResult: { caps: AccountCapabilities; turnstileWidgets: string[] } | null = null;
    capsPromise.then(c => { capsResult = c; });

    setIsExporting(true);
    // Advance immediately so the export stream runs on the review step with its
    // live terminal pinned at the top. Migrations and presets both start with
    // Account review (1); presets then continue through Zone review (2) before
    // the destructive Apply step (3).
    setStep(1);
    await stream.start(
      '/api/export/stream', body, 'Exporting zone configuration...',
      (result) => {
        // beforeDone runs synchronously - must NOT await here
        const data = asStreamResult(result)?.export;
        if (result && data) {
          setExportData(data);
          setExportTimestamp(Date.now()); // [C6]
          initDefaultSelections(data, capsResult?.caps, capsResult?.turnstileWidgets);
        }
        setIsExporting(false);
      },
    );
  }, [creds, sourceMode, importedData, conflictStrategy, stream, initDefaultSelections, fetchCapabilities, fetchAvailablePlans, destAccounts.zones, destAccounts.accounts]); // setConflictStrategy/setD1Configs/setToast are stable React setters

  const handleExportZone = useCallback(async () => {
    const { credentials } = creds;
    const body: Record<string, any> = {
      sourceToken: credentials.sourceToken,
      sourceZoneId: credentials.sourceZoneId,
      sourceAccountId: credentials.sourceAccountId,
      useApiKey: credentials.useApiKey,
      apiKey: credentials.apiKey,
      apiEmail: credentials.apiEmail,
    };

    const result = await stream.start('/api/export/stream', body, 'Exporting zone configuration...');
    const data = asStreamResult(result)?.export;
    if (result && data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const zoneName = data.zone?.name || 'zone';
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `${zoneName}-export-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setToast({ message: 'Zone exported successfully', type: 'success' });
    }
  }, [creds, stream]);

  const handleExportTerraform = useCallback(async () => {
    const { credentials } = creds;
    const body: Record<string, any> = {
      sourceToken: credentials.sourceToken,
      sourceZoneId: credentials.sourceZoneId,
      sourceAccountId: credentials.sourceAccountId,
      useApiKey: credentials.useApiKey,
      apiKey: credentials.apiKey,
      apiEmail: credentials.apiEmail,
    };

    const result = await stream.start('/api/terraform/export/stream', body, 'Generating Terraform files...');
    if (result && asStreamResult(result)?.files) {
      const files = asStreamResult(result)?.files as Array<{ filename: string; content: string }>;
      const content = files.map(f => `# === ${f.filename} ===\n${f.content}`).join('\n\n');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'zone-export.tf';
      a.click();
      URL.revokeObjectURL(url);
      setToast({ message: 'Terraform files exported', type: 'success' });
    }
  }, [creds, stream]);

  const handleExportEverything = useCallback(async () => {
    const { credentials } = creds;
    const body: Record<string, any> = {
      sourceToken: credentials.sourceToken,
      sourceZoneId: credentials.sourceZoneId,
      sourceAccountId: credentials.sourceAccountId,
      useApiKey: credentials.useApiKey,
      apiKey: credentials.apiKey,
      apiEmail: credentials.apiEmail,
    };

    const result = await stream.start('/api/export/openapi/stream', body, 'Open Everything in OpenAPI Spec...');
    const data = asStreamResult(result)?.export;
    if (result && data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // The "everything" export shape can carry a top-level zone or a zoneId
      // identifier (legacy field on older response variants).
      const zoneName = data.zone?.name
        || (data as unknown as { zoneId?: string }).zoneId
        || 'zone';
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `${zoneName}-everything-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setToast({ message: 'Everything JSON exported successfully', type: 'success' });
    }
  }, [creds, stream]);

  // ── Scope export actions (uses already-fetched data) ────────
  const handleDownloadJson = useCallback(() => {
    if (!exportData) return;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const zoneName = exportData.zone?.name || 'zone';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.download = `${zoneName}-export-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast({ message: 'JSON export downloaded', type: 'success' });
  }, [exportData]);

  const handleDownloadTerraform = useCallback(async () => {
    if (!exportData) return;
    const { credentials } = creds;
    const body: Record<string, any> = {
      sourceToken: credentials.sourceToken,
      sourceZoneId: credentials.sourceZoneId,
      sourceAccountId: credentials.sourceAccountId,
      useApiKey: credentials.useApiKey,
      apiKey: credentials.apiKey,
      apiEmail: credentials.apiEmail,
    };
    const result = await stream.start('/api/terraform/export/stream', body, 'Generating Terraform files...');
    if (result && asStreamResult(result)?.files) {
      const files = asStreamResult(result)?.files as Array<{ filename: string; content: string }>;
      const content = files.map(f => `# === ${f.filename} ===\n${f.content}`).join('\n\n');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportData.zone?.name || 'zone'}-export.tf`;
      a.click();
      URL.revokeObjectURL(url);
      setToast({ message: 'Terraform export downloaded', type: 'success' });
    }
  }, [exportData, creds, stream]);



  // ── Source-zone analytics capture (spike/analytics-export) ────
  // Fired (not awaited) from handleRunMigration so it runs concurrently with the
  // migration stream. The result lands on Step 4 as a JSON download. Failures
  // are non-fatal and never block the migration (analytics is data_ephemeral
  // and informational per Principle 4).
  const startAnalyticsCapture = useCallback((lookbackDays: number, datasets?: string[]) => {
    const { credentials } = creds;
    setAnalyticsStatus('running');
    setAnalyticsError('');
    setAnalyticsExport(null);
    const controller = new AbortController();
    analyticsAbortRef.current = controller;
    api.startAnalyticsExport(
      credentials,
      credentials.sourceZoneId,
      credentials.sourceAccountId,
      lookbackDays,
      {
        onLog: () => {/* per-dataset progress isn't surfaced inline; summary shown on Step 4 */},
        onDone: (data) => {
          const exp = (data as { export?: AnalyticsExport }).export ?? null;
          setAnalyticsExport(exp);
          setAnalyticsStatus('ready');
          setToast({ message: 'Source analytics captured - download it on the Results step', type: 'success' });
        },
        onError: (e) => { setAnalyticsError(e); setAnalyticsStatus('error'); },
      },
      controller.signal,
      datasets,
    ).catch((e) => {
      // A user-initiated abort is expected, not an error to surface.
      if (controller.signal.aborted) { setAnalyticsStatus('idle'); return; }
      setAnalyticsError(e instanceof Error ? e.message : String(e));
      setAnalyticsStatus('error');
    });
  }, [creds]);

  // ── Step 3 (Apply) actions ────────────────────────────────────
  // The migration runs from the Apply step now (both flows). The Account and
  // Zone steps are select-only navigation; the destructive writes happen here,
  // adjacent to the destination-confirmation gate (<DestinationConfirm>).

  // Build the /api/migrate request body from the current wizard state. Shared
  // by both phases of a normal migration (account-resources, then zone).
  const buildMigrateBody = useCallback((dryRun: boolean): Record<string, any> => {
    const { credentials } = creds;
    return {
      sourceToken: credentials.sourceToken,
      destToken: credentials.destToken,
      sourceZoneId: credentials.sourceZoneId,
      sourceAccountId: credentials.sourceAccountId,
      destAccountId: credentials.destAccountId,
      domainName: credentials.domainName,
      dryRun,
      useApiKey: credentials.useApiKey,
      apiKey: credentials.apiKey,
      apiEmail: credentials.apiEmail,
      destApiKey: credentials.destApiKey,
      destApiEmail: credentials.destApiEmail,
      selections,
      workerSecrets: Object.keys(workerSecrets).length > 0 ? workerSecrets : undefined,
      // Trim helpers: only include non-empty values; never send an
      // empty object that would override defaults at the worker layer.
      notificationWebhookSecrets: (() => {
        const trimmed: Record<string, string> = {};
        for (const [name, value] of Object.entries(notificationWebhookSecrets)) {
          if (typeof value === 'string' && value.length > 0) trimmed[name] = value;
        }
        return Object.keys(trimmed).length > 0 ? trimmed : undefined;
      })(),
      // Bucket 2.2: IdP client_secret values.
      identityProviderSecrets: (() => {
        const trimmed: Record<string, string> = {};
        for (const [name, value] of Object.entries(identityProviderSecrets)) {
          if (typeof value === 'string' && value.length > 0) trimmed[name] = value;
        }
        return Object.keys(trimmed).length > 0 ? trimmed : undefined;
      })(),
      // Bucket 2.3: AOP mTLS bundles - include only entries with
      // all three required fields non-empty.
      aopMtlsBundles: (() => {
        const valid = aopMtlsBundles.filter(
          b => typeof b.name === 'string' && b.name.length > 0 &&
               typeof b.certificates === 'string' && b.certificates.length > 0 &&
               typeof b.private_key === 'string' && b.private_key.length > 0,
        );
        return valid.length > 0 ? valid : undefined;
      })(),
      // Bucket 2.4: AI Gateway API keys.
      aiGatewayProviderApiKeys: (() => {
        const trimmed: Record<string, string> = {};
        for (const [slug, value] of Object.entries(aiGatewayProviderApiKeys)) {
          if (typeof value === 'string' && value.length > 0) trimmed[slug] = value;
        }
        return Object.keys(trimmed).length > 0 ? trimmed : undefined;
      })(),
      customCertificates: certificates.filter(c => c.cert && c.key),
      // Origin CA CSRs for re-issuance - only include entries with a
      // non-empty CSR (the user may have left some blank to skip them).
      originCaCertificates: originCaCsrs
        .filter(c => c.csr && c.csr.trim() && c.hostnames.length > 0)
        .map(c => ({
          hostnames: c.hostnames,
          csr: c.csr,
          request_type: c.request_type,
          requested_validity: c.requested_validity,
        })),
      targetPlan: selectedPlan || undefined,
      conflictStrategy,
      acknowledgments: acknowledgments.size > 0 ? Array.from(acknowledgments) : undefined,
      // Email forwarding addresses the user explicitly chose to skip in the scope step.
      // Rules forwarding to these addresses will be acknowledged at migrate
      // time (not migrated), with a clear reason in the report.
      skippedEmailAddresses: Object.values(emailAddressStates)
        .filter(s => s.status === 'skipped')
        .map(s => s.email),
      r2Credentials: (r2Credentials.source.accessKeyId && r2Credentials.dest.accessKeyId)
        ? r2Credentials : undefined,
      doMigration: Object.entries(doConfigs)
        .filter(([, c]) => c.enabled && c.objectNames.trim())
        .map(([workerName, c]) => {
          // Find worker in export data to get class names
          const worker = (exportData?.workers || []).find((w) => w.id === workerName);
          const doClasses = worker?.bindings
            ?.filter((b: CFWorkerBinding) => b.type === 'durable_object_namespace')
            .map((b: CFWorkerBinding) => b.class_name || b.name) || [];
          return {
            scriptName: workerName,
            classNames: doClasses,
            objectNames: c.objectNames.split(',').map((s: string) => s.trim()).filter(Boolean),
            sourceWorkerUrl: c.sourceUrl,
            destWorkerUrl: c.destUrl,
          };
        })
        .filter((d) => d.objectNames.length > 0) || undefined,
    };
  }, [creds, selections, workerSecrets, certificates, originCaCsrs, notificationWebhookSecrets, identityProviderSecrets, aopMtlsBundles, aiGatewayProviderApiKeys, selectedPlan, conflictStrategy, acknowledgments, emailAddressStates, r2Credentials, doConfigs, exportData]);

  // Reset any analytics capture from a PRIOR run so Results can never show a
  // stale capture against this migration. Re-armed by startAnalyticsCapture.
  const resetStaleAnalytics = useCallback(() => {
    analyticsAbortRef.current?.abort();
    analyticsAbortRef.current = null;
    setAnalyticsExport(null);
    setAnalyticsError('');
    setAnalyticsStatus('idle');
  }, []);

  // ── Preset (maxconfig/minconfig) apply — runs from the preset Apply step ──
  const handleApplyPreset = useCallback(async () => {
    if (stream.loading || isExporting || isMigrating || !exportData) return;
    const { credentials } = creds;
    resetStaleAnalytics();

    // ── Provision the new zone here, in the APPLY phase (breaking change) ──
    // The preview carried the resolved target zone id on exportData.zone.id (the
    // matched existing destination zone, or '' for a to-be-created zone). When
    // empty, create + delegate it now on the DESTINATION account with destination
    // auth, right before the destructive preset apply (the destination
    // confirmation checkboxes are the user's go-ahead). On failure, abort.
    let zoneId = exportData?.zone?.id || '';
    // Whether this apply provisions a brand-new zone (drives run-log counting).
    const createdNewZone = !zoneId;
    if (!zoneId) {
      const newName = credentials.domainName.trim();
      const newNameLc = newName.toLowerCase().replace(/\.$/, '');
      const parentZone = destAccounts.zones
        .filter(z => newNameLc.endsWith('.' + z.name.toLowerCase()))
        .sort((a, b) => b.name.length - a.name.length)[0];
      setIsMigrating(true);
      try {
        const res = await api.createZone(credentials, credentials.destAccountId, newName, parentZone?.id, 'dest');
        zoneId = res.zone.id;
        destAccounts.loadZones(credentials.destAccountId);
        if (parentZone && res.delegationError) {
          setToast({ message: `Created ${res.zone.name}, but delegation failed: ${res.delegationError}`, type: 'error' });
        } else if (parentZone && res.delegated) {
          setToast({ message: `Created ${res.zone.name} and delegated NS from ${parentZone.name}`, type: 'success' });
        } else {
          setToast({ message: `Created zone ${res.zone.name} (${res.zone.status})`, type: 'success' });
        }
      } catch (e) {
        setIsMigrating(false);
        setToast({ message: `Failed to create zone: ${(e as Error).message}`, type: 'error' });
        return;
      }
    }

    const endpoint = sourceMode === 'maxconfig' ? '/api/maxconfig/stream' : '/api/minconfig/stream';
    const body: Record<string, any> = {
      ...destAuthBody(credentials),
      zoneId,
      // Telemetry only (run-log): the zone name + whether we just created it.
      // A preset counts toward the landing total only when it created a zone.
      zoneName: credentials.domainName.trim() || undefined,
      createdNewZone,
      // The user's explicit License pick is applied to the target zone (the
      // preset subscribes the zone to this plan). An explicit selection is the
      // consent for the billing change — same as the migrate path's targetPlan
      // — so it applies regardless of the "unsafe account-wide" checkbox, which
      // continues to gate the auto "highest available plan" upgrade + DNSSEC.
      targetPlan: selectedPlan || undefined,
      ...(sourceMode === 'maxconfig' ? {
        mode: 'all',
        includeUnsafeAccountWideTrafficSettings,
      } : {}),
    };

    setIsMigrating(true);
    await stream.start(
      endpoint, body,
      sourceMode === 'maxconfig' ? 'Applying Maximum Config...' : 'Applying Minimum Config...',
      (result) => {
        // maxconfig returns { settingsReport, rulesReport, apiReport, auditLog }
        // minconfig returns { report, auditLog }
        // These shapes don't conform to MigrationReport. Fold their per-phase
        // counters into a real header + summary so Step 4 shows the actual
        // zone name and totals instead of an empty header and 0/0/0/0.
        const r = result as Record<string, unknown> | null;
        const presetReports: (PresetReportLike | null | undefined)[] = r
          ? [
              r.settingsReport as PresetReportLike | undefined,
              r.rulesReport as PresetReportLike | undefined,
              r.apiReport as PresetReportLike | undefined,
              r.report as PresetReportLike | undefined,
            ]
          : [];
        setReport(
          result
            ? ({
                ...(result as unknown as MigrationReport),
                ...summarizePresetReports(presetReports),
              } as MigrationReport)
            : null,
        );
        setReportMarkdown('');
        setAuditLog(asStreamResult(result)?.auditLog || []);
        setAccountAuditLog([]); // presets are single-phase (no account phase)
        setApiCalls(null);
        setIsMigrating(false);
        setStep(4); // preset Apply → Results
      },
    );
  }, [creds, sourceMode, selectedPlan, includeUnsafeAccountWideTrafficSettings, stream.loading, stream.start, isExporting, isMigrating, exportData, resetStaleAnalytics, destAccounts.zones, destAccounts.loadZones]);

  // ── Normal migration — account-resources phase, then zone phase ──
  // Both phases run back-to-back from the Apply step (the Account/Zone steps no
  // longer trigger writes). The account-phase log is snapshotted between the two
  // (the zone phase's stream resets the shared log) so the post-migration view
  // can show both. Analytics capture (api mode) fires once, in parallel.
  const handleRunMigration = useCallback(async () => {
    if (stream.loading || isExporting || isMigrating || !exportData) return;
    resetStaleAnalytics();
    const body = buildMigrateBody(false);
    setIsMigrating(true);
    setAccountAuditLog([]); // clear any prior run's account-phase endpoints
    if (sourceMode === 'api' && captureAnalytics) {
      startAnalyticsCapture(analyticsLookbackDays, analyticsDatasets ?? undefined);
    }

    // ── Account phase (pre-zone): deploy account-scoped resources. ──
    let acctReport: MigrationReport | null = null;
    const acctRes = await stream.start(
      '/api/migrate/account-resources', body,
      'Deploying account resources...',
      (result) => {
        acctReport = asStreamResult(result)?.report || null;
        setAccountReport(acctReport);
        // Account-phase endpoints — kept separate so the zone phase (which also
        // emits `auditLog`) doesn't overwrite them. Both render as collapsed
        // terminals on the Apply/Results steps.
        setAccountAuditLog(asStreamResult(result)?.auditLog || []);
      },
    );
    // Account phase errored (stream resolves null on error): surface the log and
    // stop — don't create the zone on top of a failed account-resource deploy.
    if (!acctRes) { setIsMigrating(false); return; }
    setAccountMigrationLogs(stream.getLogs());

    // ── Zone phase: create the dest zone + migrate zone-scoped resources,
    //    skipping the account resources already deployed. Merge the two phase
    //    reports for the read-only Results step. ──
    await stream.start(
      '/api/migrate/stream', { ...body, skipAccountResources: true },
      'Creating zone & migrating...',
      (result) => {
        const zoneReport = asStreamResult(result)?.report || null;
        const merged = mergeReports(acctReport, zoneReport);
        setReport(merged);
        // Regenerate the downloadable markdown from the MERGED report so the
        // downloaded file matches the Results summary (the zone-phase stream
        // only returns markdown for its own phase).
        setReportMarkdown(merged ? generateReportMarkdown(merged) : (asStreamResult(result)?.reportMarkdown || ''));
        setAuditLog(asStreamResult(result)?.auditLog || []);
        setApiCalls(asStreamResult(result)?.apiCalls || null);
      },
    );
    setIsMigrating(false);
    // Stay on the Apply step (3): with `report` now set, Step3Apply switches
    // from its review/run view to the post-migration checklist.
  }, [stream.loading, stream.start, stream.getLogs, isExporting, isMigrating, exportData, resetStaleAnalytics, buildMigrateBody, sourceMode, captureAnalytics, startAnalyticsCapture, analyticsLookbackDays, analyticsDatasets]);

  const handleCancel = useCallback(async () => {
    stream.cancel();
    // Stop the parallel analytics capture too: it runs on source credentials
    // and would otherwise keep going (and surface a stale download) after the
    // user has cancelled the migration.
    analyticsAbortRef.current?.abort();
    analyticsAbortRef.current = null;
    if (Object.values(createdResources).some(v => v && (Array.isArray(v) ? v.length > 0 : true))) {
      try {
        await api.rollback(creds.credentials, creds.credentials.destAccountId, createdResources);
        setToast({ message: 'Migration cancelled and rolled back', type: 'success' });
      } catch {
        setToast({ message: 'Cancellation succeeded but rollback may be incomplete', type: 'error' });
      }
    }
  }, [stream, createdResources, creds]);

  // ── Verification (post-migration) ─────────────────────────────
  const handleVerifyMigration = useCallback(async () => {
    const { credentials } = creds;
    // Prefer destZoneId (set for created AND reused zones); fall back to the
    // created-only id for older reports. Reused-zone migrations (e.g. TF
    // imports) only populate destZoneId, so verification must read it first.
    const destZoneId = report?.destZoneId || report?.createdResources?.zoneId;
    if (!destZoneId) {
      setToast({ message: 'No destination zone ID found in report', type: 'error' });
      return;
    }

    // Export from destination zone - use dest-specific auth if available
    const body: Record<string, any> = {
      sourceToken: credentials.destToken || credentials.sourceToken,
      sourceZoneId: destZoneId,
      sourceAccountId: credentials.destAccountId,
      useApiKey: credentials.useApiKey,
      apiKey: credentials.destApiKey || credentials.apiKey,
      apiEmail: credentials.destApiEmail || credentials.apiEmail,
    };

    const result = await stream.start('/api/export/stream', body, 'Exporting destination zone for verification...');
    if (result && asStreamResult(result)?.export) {
      const destExport = asStreamResult(result)?.export;

      // Run diff between source export and destination export
      const diffBody: Record<string, any> = {
        sourceExport: exportData,
        destExport,
        useApiKey: credentials.useApiKey,
        apiKey: credentials.apiKey,
        apiEmail: credentials.apiEmail,
      };

      const diffResult = await stream.start('/api/diff/stream', diffBody, 'Comparing source and destination...');
      if (diffResult) {
        setReport((prev) => prev ? ({
          ...prev,
          verification: {
            destExport,
            diff: diffResult,
            timestamp: new Date().toISOString(),
          },
        } as MigrationReport) : prev);
        setToast({ message: 'Verification complete - see discrepancies below', type: 'success' });
      }
    }
  }, [creds, report, exportData, stream]);

  // ── Validation warnings ───────────────────────────────────────
  // MaxConfig already filters its preview by capabilities (see
  // buildMaxConfigPreview), so the warnings pipeline would only fire on a
  // synthetic preset the user explicitly opted into. Suppress it: the
  // remaining "you'll lose data" message is already covered by the Setup
  // OverwriteConfirmModal + the red banner in the All Features On tab.
  // Memoized: generateValidationWarnings iterates every worker+binding,
  // setting, DNS record and ruleset. It previously ran on EVERY App render —
  // i.e. once/second while the uptime monitor's heartbeat ticks — on the full
  // export. Recompute only when its inputs actually change.
  const validationWarnings = useMemo(
    () => (exportData && sourceMode !== 'maxconfig')
      ? generateValidationWarnings(exportData, capabilities)
      : [],
    [exportData, capabilities, sourceMode],
  );

  // ── Account step "already identical on destination" diff (#15 decision 6) ──
  // Only runs in overwrite mode on a real migration; resolves to an empty set
  // (no extra work) when the destination zone doesn't already exist.
  const { identicalSet: destIdenticalSet } = useDestDiff({
    enabled: step === 1 && sourceMode === 'api' && conflictStrategy === 'overwrite',
    creds: creds.credentials,
    destAccountId: creds.destAccountId,
    zoneName: exportData?.zone?.name ?? '',
    sourceExport: exportData,
  });

  // ── Wizard render helpers ─────────────────────────────────────
  const isPresetMode = sourceMode === 'maxconfig' || sourceMode === 'minconfig';
  // For presets the source IS the destination; for migrations it's the dest account.
  // Every flow targets the destination account now (presets included).
  const effectiveDestAccountId = creds.destAccountId;
  const effectiveDestAccountName = destAccounts.accounts.find(a => a.id === effectiveDestAccountId)?.name;

  // ── Pre-cutover uptime monitor (api mode only) ────────────────
  // Lifted to App level so the once-per-second ping loop survives the move from
  // the Zone step through Apply and Results, and can drive the header heartbeat.
  // zoneName is resolved from the authenticated account's zone list (never stale
  // persisted state) so the server-side host-lock claim is provably truthful.
  const monitorZoneName = accounts.zones.find(z => z.id === creds.sourceZoneId)?.name || '';
  const monitorAvailable = sourceMode === 'api' && creds.hasAuth && !!monitorZoneName;
  // The monitor's once-per-second state lives in <MonitorProvider> (wrapping the
  // return below), NOT here — so beats re-render only the heartbeat/card consumers,
  // not App and the active wizard step. See app/hooks/MonitorContext.tsx.
  // The export terminal applies to the streaming export paths (api migrate +
  // minconfig). Shown above the scope while exporting, then collapsed.
  const showExportTerminal = (sourceMode === 'api' || sourceMode === 'minconfig') && (isExporting || exportLogs.length > 0);
  // Live log shown in place of the scope while a phase stream is running.
  const renderMigratingLog = () => (
    <LogPanel
      logs={stream.logs}
      title={stream.loadingText || 'Working…'}
      isLive
      progress={stream.progress}
      startTime={stream.startTime}
      onCancel={handleCancel}
    />
  );
  // Shared scope render. Account (step 1) and Zone (step 2) are two step
  // components over one shared scope view; presets reuse the same view at the
  // Apply step (3) with phase=undefined. `phase` filters the resource groups
  // ('account' / 'zone'); undefined shows every group. The analytics-archive
  // add-on only appears on the account phase of a live api migration.
  const renderScope = (
    phase: 'account' | 'zone' | undefined,
    primaryLabel: string,
    onNext: () => void,
    onBack: () => void,
  ) => {
    const scopeProps = {
      exportData: exportData!,
      selections,
      setSelections,
      validationWarnings,
      capabilities,
      existingTurnstileWidgets,
      conflictStrategy,
      identicalSet: destIdenticalSet,
      doConfigs,
      setDoConfigs,
      d1Configs,
      setD1Configs,
      r2Credentials,
      setR2Credentials,
      isPreset: sourceMode === 'maxconfig' || sourceMode === 'minconfig',
      destAccountName: effectiveDestAccountName,
      destAccountId: effectiveDestAccountId,
      // Zone tag is only known when the destination zone already exists. For
      // presets the source IS the destination, so the exported zone id is the
      // dest zone tag. A real migration creates the zone during Apply, so we
      // have no pre-existing tag to show (the card shows the name only).
      destZoneId: isPresetMode ? exportData?.zone?.id : undefined,
      selectedPlan,
      primaryLabel,
      // The script captures the FULL planned set of WRITE calls, so it is only
      // meaningful once every setting is finalized. That happens on the Zone
      // step (the last review before Apply) — and for presets/legacy where a
      // single ScopeReview (phase undefined) is the finalize point. Offering it
      // at the end of the Account step (phase === 'account') is premature, since
      // zone-scoped settings haven't been reviewed yet. Mirrors the isZonePhase
      // gate ScopeReview uses for the Email Routing card.
      downloadScriptInputs: phase !== 'account' ? {
        // Presets target the destination zone/account; the resolved dest zone id
        // rides on the preview's zone.id (matched zone, or '' for a new zone).
        sourceZoneId: isPresetMode ? (exportData?.zone?.id || '') : creds.sourceZoneId,
        sourceAccountId: isPresetMode ? effectiveDestAccountId : creds.sourceAccountId,
        destAccountId: effectiveDestAccountId,
        domainName: creds.domainName,
      } : undefined,
      analytics: phase !== 'zone' && sourceMode === 'api' ? {
        creds: creds.credentials,
        sourceZoneId: creds.sourceZoneId,
        sourceAccountId: creds.sourceAccountId,
        zoneName: creds.domainName,
        capture: captureAnalytics,
        setCapture: setCaptureAnalytics,
        lookbackDays: analyticsLookbackDays,
        setLookbackDays: setAnalyticsLookbackDays,
        selectedDatasets: analyticsDatasets,
        setSelectedDatasets: setAnalyticsDatasets,
      } : undefined,
      onRecheckCapabilities: handleRecheckCapabilities,
      recheckingCapabilities,
      acknowledgments,
      setAcknowledgments,
      creds: creds.credentials,
      emailAddressStates,
      setEmailAddressStates,
      onBack,
      onNext,
      // The migration runs from the Apply step now, so the Account/Zone steps
      // are select-only navigation — the destination confirmation lives on
      // Apply (<DestinationConfirm>), not here.
      requireDestConfirm: false,
      showToast,
      workerSecrets,
      setWorkerSecrets,
      certificates,
      setCertificates,
      originCaCsrs,
      setOriginCaCsrs,
      notificationWebhookSecrets,
      setNotificationWebhookSecrets,
      identityProviderSecrets,
      setIdentityProviderSecrets,
      aopMtlsBundles,
      setAopMtlsBundles,
      aiGatewayProviderApiKeys,
      setAiGatewayProviderApiKeys,
    };
    return (
      <Suspense fallback={<StepFallback />}>
        {phase === 'account' ? (
          <Step1Account {...scopeProps} />
        ) : phase === 'zone' ? (
          <Step2Zone {...scopeProps} />
        ) : (
          <ScopeReview {...scopeProps} phase={undefined} />
        )}
      </Suspense>
    );
  };
  const exportFailedState = (
    <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 space-y-3">
      <div className="text-sm text-red-300 font-semibold">Export failed</div>
      <p className="text-xs text-red-400/80">
        The zone export did not complete — see the log above for the specific
        error. Check your source credentials and try again.
      </p>
      <button
        type="button"
        onClick={() => setStep(0)}
        className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-700 text-gray-200 hover:bg-gray-600 transition"
      >
        ← Back to credentials
      </button>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────
  return (
    <MonitorProvider
      creds={creds.credentials}
      hasAuth={creds.hasAuth}
      sourceZoneId={creds.sourceZoneId}
      zoneName={monitorZoneName}
      enabled={monitorAvailable}
    >
    <Layout
      onLogoClick={goToLanding}
      headerAside={
        /* The indicator shows the four numbered wizard steps (Account · Zone ·
           Apply · Results = 1–4). Setup is the landing page = step 0, not a
           numbered step. App's `step` state uses the SAME numbering (0 = Setup,
           1 = Account … 4 = Results), so the indicator needs no offset: on the
           landing screen step is 0, which matches no numbered step (1–4) so none
           is active, visited, or clickable. The first step (Account) lights up
           once the user starts the flow and advances to step 1. */
        <div className="flex flex-col items-center gap-2">
          {/* No "Back to Setup" button — the header logo navigates back to Setup
              (step 0), and the breadcrumb step pills handle the rest. */}
          <StepIndicator
            currentStep={step}
            maxStepReached={maxStepReached}
            onStepClick={(s) => s <= maxStepReached && goToStep(s)}
            steps={isPresetMode ? PRESET_STEPS : MIGRATION_STEPS}
            disabledSteps={isPresetMode ? PRESET_DISABLED_STEPS : undefined}
          />
          {/* Live pre-cutover heartbeat — beats once/sec between the wizard
              sections while the monitor runs, all the way through Apply and
              Results. Renders nothing when the monitor isn't running. */}
          <MonitorHeartbeat onManage={() => goToStep(3)} />
        </div>
      }
    >
      {/* Spec-drift monitor note. Coverage drift is surfaced quietly by the
          header CoverageStatusLine fraction + modal (no loud banner — it's a
          maintainer signal, not a user-actionable alarm); this only renders for
          a genuine monitor error. Top of content. */}
      <SpecDriftBanner />
      {/* Catch lazy-chunk load failures (e.g. stale chunk hashes after a new
          deploy) and step render errors so they surface as an actionable
          Reload card instead of a black screen. Keyed by `step` so navigating
          to a different (working) step via the header breadcrumb clears a
          non-chunk render error without a full reload. */}
      <ErrorBoundary key={step}>
      {/* ── Setup / landing (step 0; not a numbered wizard step) ── */}
      {step === 0 && (
        <Suspense fallback={<StepFallback />}>
        <Step0Credentials
          credentials={creds.credentials}
          useApiKey={creds.useApiKey} setUseApiKey={creds.setUseApiKey}
          apiKey={creds.apiKey} setApiKey={creds.setApiKey}
          apiEmail={creds.apiEmail} setApiEmail={creds.setApiEmail}
          sourceToken={creds.sourceToken} setSourceToken={creds.setSourceToken}
           destToken={creds.destToken} setDestToken={creds.setDestToken}
           destApiKey={creds.destApiKey} setDestApiKey={creds.setDestApiKey}
           destApiEmail={creds.destApiEmail} setDestApiEmail={creds.setDestApiEmail}
          sourceAccountId={creds.sourceAccountId} setSourceAccountId={(id) => { creds.setSourceAccountId(id); accounts.loadZones(id); }}
          sourceZoneId={creds.sourceZoneId} setSourceZoneId={creds.setSourceZoneId}
          destAccountId={creds.destAccountId} setDestAccountId={(id) => { creds.setDestAccountId(id); destAccounts.loadZones(id); }}
          domainName={creds.domainName} setDomainName={creds.setDomainName}
          accounts={accounts.accounts}
          sourceZones={accounts.zones}
          accountsLoading={accounts.accountsLoading}
          accountsError={accounts.accountsError}
          zonesLoading={accounts.zonesLoading}
           loadZones={accounts.loadZones}
          destAccounts={destAccounts.accounts}
          destAccountsLoading={destAccounts.accountsLoading}
          destAccountsError={destAccounts.accountsError}
           availablePlans={availablePlans}
           planCounts={planCounts}
           plansLoading={plansLoading}
           selectedPlan={selectedPlan}
           setSelectedPlan={setSelectedPlan}
           blockers={blockerCheck.blockers}
           warnings={blockerCheck.warnings}
           hasBlockers={blockerCheck.hasBlockers}
          onPreview={handlePreview}
          onExportZone={handleExportZone}
          onExportEverything={handleExportEverything}
          onExportTerraform={handleExportTerraform}
          onMaxConfig={() => {}} // Legacy prop - preset modes now use onPreview flow
          onMinConfig={() => {}} // Legacy prop - preset modes now use onPreview flow
          sourceMode={sourceMode}
          setSourceMode={setSourceMode}
          includeUnsafeAccountWideTrafficSettings={includeUnsafeAccountWideTrafficSettings}
          setIncludeUnsafeAccountWideTrafficSettings={setIncludeUnsafeAccountWideTrafficSettings}
          conflictStrategy={conflictStrategy}
          setConflictStrategy={setConflictStrategy}
            importedData={importedData}
          onImportJson={setImportedData}
          onClearImport={() => setImportedData(null)}
          showToast={showToast}
        />
        </Suspense>
      )}

       {/* ── Account (step 1): pre-zone resources + account-scoped secrets ── */}
       {step === 1 && (
         <>
           {showExportTerminal && (
             <div className="mb-6">
               {isExporting ? (
                 <LogPanel logs={stream.logs} title="Exporting zone configuration..." isLive progress={stream.progress} startTime={stream.startTime} />
               ) : (
                  <LogPanel logs={exportLogs} title="Export Log" collapsible />
                )}
              </div>
            )}
            {isMigrating
             ? renderMigratingLog()
             : exportData
                ? isPresetMode
                  ? renderScope('account', 'Review zone resources \u2192', () => goToStep(2), () => goToStep(0))
                  : renderScope('account', 'Continue to Zone \u2192', () => goToStep(2), () => goToStep(0))
               : isExporting
                 ? (
                   <div className="text-center py-12 text-gray-400 text-sm">
                     Exporting zone configuration… the scope will appear here when the export completes.
                   </div>
                 )
                 : exportFailedState}
         </>
       )}

       {/* ── Zone (step 2): zone creation + zone-scoped resources + zone secrets ── */}
        {step === 2 && (
          exportData ? (
            /* Both flows are select-only navigation here; the migration runs
               from the Apply step (3), where the pre-cutover uptime monitor
               now also lives. */
            renderScope('zone', 'Continue to Apply \u2192', () => goToStep(3), () => goToStep(1))
          ) : exportFailedState
        )}

       {/* ── Apply (step 3): review plan → run migration → post-migration ── */}
       {step === 3 && (
         exportData ? (
            isPresetMode ? (
              /* Presets keep the swap-to-log behavior — PresetApplyStep has its
                 own pre/post views and doesn't yet render the live log inline. */
              isMigrating ? (
                renderMigratingLog()
              ) : (
                <div className="space-y-6">
                  {monitorAvailable && (
                    <UptimeMonitorCard zoneName={monitorZoneName} />
                  )}
                  {showExportTerminal && (
                    <div className="mb-6">
                      {isExporting ? (
                        <LogPanel logs={stream.logs} title="Exporting zone configuration..." isLive progress={stream.progress} startTime={stream.startTime} />
                      ) : (
                        <LogPanel logs={exportLogs} title="Export Log" collapsible />
                      )}
                    </div>
                  )}
                  <Suspense fallback={<StepFallback />}>
                    <PresetApplyStep
                      exportData={exportData}
                      selections={selections}
                      capabilities={capabilities}
                      existingTurnstileWidgets={existingTurnstileWidgets}
                      doConfigs={doConfigs}
                      d1Configs={d1Configs}
                      conflictStrategy={conflictStrategy}
                      destAccountName={effectiveDestAccountName}
                      destAccountId={effectiveDestAccountId}
                      destZoneId={isPresetMode ? exportData?.zone?.id : undefined}
                      primaryLabel={sourceMode === 'maxconfig' ? 'Apply MaxConfig \u2192' : 'Apply MinConfig \u2192'}
                      onApply={handleApplyPreset}
                    />
                  </Suspense>
                </div>
              )
            ) : (
              /* Normal migration: ONE page. The migration log streams inline
                 (passed below) while running, then collapses — the review plan
                 and post-migration checklist never disappear. */
              <div className="space-y-6">
                {/* Pre-cutover uptime monitor — configure/start it before the run;
                    it keeps beating through the run and Results via the header
                    heartbeat. api mode only. Hidden once the run starts. */}
                {monitorAvailable && !isMigrating && !report && (
                  <UptimeMonitorCard zoneName={monitorZoneName} />
                )}
                <Suspense fallback={<StepFallback />}>
                  <Step3Apply
                    report={report}
                    migrationLogs={migrationLogs}
                    accountMigrationLogs={accountMigrationLogs}
                    accountApiCalls={accountAuditLog}
                    zoneApiCalls={auditLog}
                    exportData={exportData}
                    selections={selections}
                    capabilities={capabilities}
                    existingTurnstileWidgets={existingTurnstileWidgets}
                    doConfigs={doConfigs}
                    d1Configs={d1Configs}
                    conflictStrategy={conflictStrategy}
                    destAccountName={effectiveDestAccountName}
                    destAccountId={effectiveDestAccountId}
                    onRun={handleRunMigration}
                    onVerify={handleVerifyMigration}
                    onContinue={() => goToStep(4)}
                    isMigrating={isMigrating}
                    liveLogs={stream.logs}
                    liveProgress={stream.progress}
                    liveStartTime={stream.startTime}
                    liveTitle={stream.loadingText}
                    onCancel={handleCancel}
                  />
                </Suspense>
              </div>
            )
          ) : exportFailedState
        )}

      {/* ── Results (step 4): read-only verification + report ── */}
      {step === 4 && (
        <Suspense fallback={<StepFallback />}>
        <Step4Results
          report={report}
          reportMarkdown={reportMarkdown}
          auditLog={auditLog}
          accountAuditLog={accountAuditLog}
          apiCalls={apiCalls}
          sourceFormat={sourceMode}
          exportData={exportData}
          onVerify={handleVerifyMigration}
          onStartNew={goToLanding}
          onBackToConfig={() => setStep(3)}
          onExportJson={handleDownloadJson}
          idpTestResults={idpTestResults}
          setIdpTestResults={setIdpTestResults}
          analyticsStatus={analyticsStatus}
          analyticsExport={analyticsExport}
          analyticsError={analyticsError}
          migratorEmail={creds.credentials.apiEmail || creds.credentials.destApiEmail || undefined}
        />
        </Suspense>
      )}
      </ErrorBoundary>

      {stream.loading && !isExporting && !isMigrating && (
        <LogPanel
          logs={stream.logs}
          title={stream.loadingText}
          isLive
          progress={stream.progress}
          startTime={stream.startTime}
          onCancel={handleCancel}
          maxHeight="300px"
        />
      )}

      <Toast
        message={toast?.message || null}
        type={toast?.type || 'error'}
        onClose={() => setToast(null)}
      />
    </Layout>
    </MonitorProvider>
  );
}

function authBody(creds: { useApiKey: boolean; apiKey: string; apiEmail: string; sourceToken: string }): Record<string, string | boolean> {
  if (creds.useApiKey) {
    return { useApiKey: true, apiKey: creds.apiKey, apiEmail: creds.apiEmail };
  }
  return { token: creds.sourceToken };
}

// Destination-context auth (matches lib/api destAuthBody): prefers destination
// credentials, falling back to the primary ones so an API-key migration with
// "use same as source" still authenticates. Used for preset apply (presets
// target the destination) and any other dest-facing stream.
function destAuthBody(creds: {
  useApiKey: boolean; apiKey: string; apiEmail: string;
  destApiKey: string; destApiEmail: string; destToken: string; sourceToken: string;
}): Record<string, string | boolean> {
  if (creds.useApiKey) {
    return { useApiKey: true, apiKey: creds.destApiKey || creds.apiKey, apiEmail: creds.destApiEmail || creds.apiEmail };
  }
  return { token: creds.destToken || creds.sourceToken };
}
