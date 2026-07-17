// Wizard refresh-recovery persistence.
//
// Persists a NON-SECRET snapshot of the wizard to localStorage so a hard
// refresh restores the same step and migration data. The step pointer also
// lives in the URL as `?step=N` (set by App's history effects) — this module
// owns the heavy data half and the clamp logic.
//
// SECURITY: this snapshot intentionally EXCLUDES every credential / secret —
// API tokens/keys (those live in sessionStorage via useCredentials), worker
// secrets, custom-cert private keys, Origin CA CSRs, notification-webhook
// secrets, Access IdP client secrets, AOP mTLS bundles, AI Gateway keys, and
// R2 S3 credentials. Those are never written to localStorage; the user re-enters
// them after a refresh (same policy as the in-memory token model).
//
// In-flight SSE streams cannot resume (the worker is stateless between
// requests), so we never persist the `isExporting`/`isMigrating` runtime flags.
// Step routing is URL-authoritative (see `resolveInitialStep`): the bare apex
// always lands on Setup, and `?step=N` is honored verbatim — data-less steps
// render a graceful empty state rather than being redirected elsewhere.

import type { ZoneExport, MigrationReport } from '../../src/types';
import type { AccountCapabilities } from './api';
import type { SourceMode } from '../components/steps/Step0Credentials';
import type { LogLine } from '../hooks/useStreamRequest';

const STORAGE_KEY = 'tz-wizard-state-v1';
const SCHEMA_VERSION = 1;

export interface WizardSnapshot {
  v: number;
  sourceMode: SourceMode;
  step: number;
  maxStepReached: number;
  exportData: ZoneExport | null;
  exportTimestamp: number | null;
  selections: Record<string, Record<string, boolean>>;
  conflictStrategy: 'skip' | 'overwrite';
  capabilities: AccountCapabilities | null;
  existingTurnstileWidgets: string[];
  doConfigs: Record<string, { enabled: boolean; objectNames: string; sourceUrl: string; destUrl: string }>;
  d1Configs: Record<string, { acknowledged: boolean }>;
  /** Set<string> serialized as an array. */
  acknowledgments: string[];
  selectedPlan: string | null;
  report: MigrationReport | null;
  accountReport: MigrationReport | null;
  reportMarkdown: string;
  /** Zone-phase audit log (zone-scoped API calls). */
  auditLog: unknown[];
  /** Account-phase audit log (account-scoped API calls), kept separate so the
   *  zone phase no longer clobbers the account phase's recorded calls. */
  accountAuditLog: unknown[];
  migrationLogs: LogLine[];
}

/** Fields the caller supplies; `v` is stamped internally by saveWizardState. */
export type WizardSnapshotInput = Omit<WizardSnapshot, 'v'>;

export function loadWizardState(): WizardSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as WizardSnapshot;
    if (!snap || snap.v !== SCHEMA_VERSION) return null;
    return snap;
  } catch {
    return null;
  }
}

export function saveWizardState(input: WizardSnapshotInput): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, ...input }));
  } catch {
    // QuotaExceededError (very large export + logs) or a serialization issue:
    // drop the key rather than leave a partial/stale snapshot. A subsequent
    // refresh then cleanly resets to Setup instead of restoring corrupt data.
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

export function clearWizardState(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/**
 * Resolve the step to land on at mount. The URL is authoritative — we never
 * silently redirect to a different step than the one the URL names:
 *
 *   - No `?step=` param (the bare apex `/`) ALWAYS lands on Setup (step 0). We
 *     do NOT auto-restore the snapshot's numbered step: typing the bare domain
 *     takes you home, not back into a half-finished migration. (A hard refresh
 *     mid-flow still resumes the right step because the live URL carries
 *     `?step=N`, set by App's history effects.)
 *   - `?step=N` lands on exactly step N, bounded only to the valid wizard range
 *     (0–4). There is NO data/`maxStepReached` clamp: deep-linking is honored
 *     verbatim. Steps that need data the snapshot can't provide render a
 *     graceful state on their own (the Setup-failed panel for steps 1–3, an
 *     empty Results view for step 4) instead of being bounced elsewhere.
 *
 * The snapshot is intentionally not consulted here anymore; its heavy data is
 * re-hydrated separately by the App and each step degrades when it's absent.
 */
export function resolveInitialStep(_snap: WizardSnapshot | null, search: string): number {
  const params = new URLSearchParams(search);
  if (!params.has('step')) return 0;
  const parsed = parseInt(params.get('step') ?? '', 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(parsed, 4));
}

/** Build the URL for a step: clean path at Setup (0), `?step=N` otherwise. */
export function stepUrl(step: number): string {
  return step <= 0 ? location.pathname : `${location.pathname}?step=${step}`;
}
