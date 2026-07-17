import React, { useState, useCallback, useRef } from 'react';
import { WarningOctagon } from '@phosphor-icons/react';
import type { AvailablePlan } from '../../lib/api';
import type { ZoneExport } from '../../../src/types';
// Import directly from scope/OverwriteConfirmModal (not via ScopeReview)
// so the Setup bundle doesn't transitively pull in the entire scope
// component when we lazy-load steps from App.tsx.
import { OverwriteConfirmModal } from './scope/OverwriteConfirmModal';
import { ConflictStrategyToggle } from './scope/ConflictStrategyToggle';
import type { ConflictStrategy } from './scope/groups';
import { CreateTokenLink } from './step0/CreateTokenLink';
import { FileDropZone } from './step0/FileDropZone';
import { DestinationSection } from './step0/DestinationSection';
import { useDestZoneExists } from '../../hooks/useDestZoneExists';

// Types moved to ./step0/operationMode.ts so App.tsx can import them
// without taking a static dependency on this component (which would
// prevent React.lazy from code-splitting it). Re-exported here for
// backwards compatibility.
export type { OperationMode, SourceMode, ExportFormat } from './step0/operationMode';
import type { SourceMode } from './step0/operationMode';

const LICENSE_OPTIONS = [
  { id: 'free', label: 'Free' },
  { id: 'pro', label: 'Pro' },
  { id: 'business', label: 'Business' },
  { id: 'enterprise', label: 'Enterprise' },
];

interface Step0Props {
  credentials: {
    useApiKey: boolean;
    apiKey: string;
    apiEmail: string;
    sourceToken: string;
    destToken: string;
    sourceAccountId: string;
    sourceZoneId: string;
    destAccountId: string;
    domainName: string;
  };
  useApiKey: boolean;
  setUseApiKey: (v: boolean) => void;
  apiKey: string; setApiKey: (v: string) => void;
  apiEmail: string; setApiEmail: (v: string) => void;
  destApiKey: string; setDestApiKey: (v: string) => void;
  destApiEmail: string; setDestApiEmail: (v: string) => void;
  sourceToken: string; setSourceToken: (v: string) => void;
  destToken: string; setDestToken: (v: string) => void;
  sourceAccountId: string; setSourceAccountId: (v: string) => void;
  sourceZoneId: string; setSourceZoneId: (v: string) => void;
  destAccountId: string; setDestAccountId: (v: string) => void;
  domainName: string; setDomainName: (v: string) => void;
  accounts: Array<{ id: string; name: string }>;
  sourceZones: Array<{ id: string; name: string; status: string }>;
  accountsLoading: boolean;
  accountsError: string | null;
  zonesLoading: boolean;
  loadZones: (accountId: string) => void;
  /** Destination account context — loaded from DESTINATION auth (see
   *  useAccounts 'dest'). Drives the shared Destination section's account
   *  dropdown for every flow (migration dest + JSON/Terraform/preset target). */
  destAccounts: Array<{ id: string; name: string }>;
  destAccountsLoading: boolean;
  destAccountsError: string | null;
  availablePlans: AvailablePlan[];
  planCounts: Record<string, number>;
  plansLoading: boolean;
  selectedPlan: string | null;
  setSelectedPlan: (plan: string | null) => void;
  blockers: Array<{ type: string; message: string; details?: string }>;
  warnings: Array<{ type: string; message: string; details?: string }>;
  hasBlockers: boolean;
  onPreview: () => void;
  onExportZone: () => void;
  onExportEverything: () => void;
  onExportTerraform: () => void;
  onMaxConfig?: () => void;
  onMinConfig?: () => void;
  sourceMode: SourceMode;
  setSourceMode: (m: SourceMode) => void;
  includeUnsafeAccountWideTrafficSettings: boolean;
  setIncludeUnsafeAccountWideTrafficSettings: (v: boolean) => void;
  /** Conflict strategy for an existing-zone preset (shared with the scope step). */
  conflictStrategy: ConflictStrategy;
  setConflictStrategy: (s: ConflictStrategy) => void;
  importedData: ZoneExport | null;
  onImportJson: (data: ZoneExport) => void;
  onClearImport: () => void;
  /** Show an in-app toast (replaces native alert(); see App.tsx). */
  showToast: (message: string, type?: 'error' | 'success') => void;
}

const SOURCE_MODES = [
  { key: 'api' as const, label: 'API' },
  { key: 'json' as const, label: 'JSON' },
  { key: 'terraform' as const, label: 'Terraform' },
  { key: 'maxconfig' as const, label: 'All Features On' },
  { key: 'minconfig' as const, label: 'All Features Off' },
];

/** Source modes that need API credentials + zone selection */
const API_MODES: SourceMode[] = ['api', 'maxconfig', 'minconfig'];

export function Step0Credentials(props: Step0Props) {
  const {
    useApiKey, setUseApiKey,
    apiKey, setApiKey,
    apiEmail, setApiEmail,
    sourceToken, setSourceToken,
    destToken, setDestToken,
    destApiKey, setDestApiKey,
    destApiEmail, setDestApiEmail,
    sourceAccountId, setSourceAccountId,
    sourceZoneId, setSourceZoneId,
    destAccountId, setDestAccountId,
    domainName, setDomainName,
    accounts, sourceZones,
    accountsLoading, accountsError, zonesLoading,
    loadZones,
    destAccounts, destAccountsLoading, destAccountsError,
    planCounts, selectedPlan, setSelectedPlan,
    blockers, warnings, hasBlockers,
    onPreview,
    onExportZone, onExportEverything, onExportTerraform,
    sourceMode, setSourceMode,
    includeUnsafeAccountWideTrafficSettings, setIncludeUnsafeAccountWideTrafficSettings,
    conflictStrategy, setConflictStrategy,
    importedData, onImportJson, onClearImport,
    showToast,
  } = props;

  const [dragOver, setDragOver] = useState(false);
  const [useSeparateAuth, setUseSeparateAuth] = useState(false);
  // MaxConfig is a destructive overwrite preset. The red banner in the
  // tab description is one warning; this modal is the second - fires when
  // the user clicks "Scope Migration" so they confirm before the apply
  // sequence ever starts. (Then Step 3 still requires another explicit
  // click to actually run.)
  const [showMaxConfigOverwriteModal, setShowMaxConfigOverwriteModal] = useState(false);
  // Skip→Overwrite confirmation for the inline conflict toggle shown when a
  // preset targets an EXISTING zone (mirrors the toggle in the scope step).
  const [showConflictOverwriteModal, setShowConflictOverwriteModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPresetMode = sourceMode === 'maxconfig' || sourceMode === 'minconfig';

  // Preset modes target the DESTINATION account (like JSON/Terraform), naming the
  // zone via the destination zone field (bound to domainName). Whether the typed
  // name already exists on the destination account is answered by the live
  // destZoneExists probe below (same as migrations); a non-existent name is
  // created + delegated at Apply.
  const normalizedZoneName = domainName.trim().toLowerCase().replace(/\.$/, '');

  const handleSourceAccountChange = useCallback((accountId: string) => {
    setSourceAccountId(accountId);
    setSourceZoneId('');
    if (accountId) {
      loadZones(accountId);
    }
  }, [setSourceAccountId, setSourceZoneId, loadZones]);

  const handleFileRead = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        onImportJson(data);
      } catch {
        showToast('Invalid JSON file', 'error');
      }
    };
    reader.readAsText(file);
  }, [onImportJson, showToast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileRead(file);
    }
  }, [handleFileRead]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileRead(file);
    }
  }, [handleFileRead]);

  // Destination Zone License selector. Shared between the migration Destination
  // panel and the preset (maxconfig/minconfig) Destination panel — presets
  // generate their own source, so the License lives on the destination/target
  // section exactly like the API/JSON/Terraform flows.
  const licenseSelector = (
    <div>
      <label className="block text-xs text-gray-400 mb-1">License</label>
      <div className="flex bg-gray-700 rounded-lg p-0.5">
        {LICENSE_OPTIONS.map((opt) => {
          const isFree = opt.id === 'free';
          const count = planCounts[opt.id] ?? 0;
          const disabled = !isFree && count === 0;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => !disabled && setSelectedPlan(opt.id)}
              disabled={disabled}
              title={disabled ? `No ${opt.label} licenses in the destination account` : undefined}
              className={`flex-1 px-2 py-2 text-xs font-medium rounded-md transition whitespace-nowrap ${
                disabled
                  ? 'text-gray-600 cursor-not-allowed'
                  : selectedPlan === opt.id
                    ? 'bg-orange-500 text-white'
                    : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {opt.label}({isFree ? '\u221e' : count})
            </button>
          );
        })}
      </div>
    </div>
  );

  // Check if authentication credentials are filled in
  const hasSourceAuth = useApiKey
    ? !!(apiKey && apiEmail)
    : !!sourceToken;

  // Only the API source migration has a real source to reuse credentials from.
  // For JSON/Terraform/preset there's no source, so the Destination section
  // carries its own credentials directly (no "same as source").
  const hasRealSource = sourceMode === 'api';
  // API tokens are account-scoped, so the destination always needs its own
  // token. Only API keys (which work across all of a user's accounts) may be
  // reused for the destination via "Use same credentials as source".
  const reuseSourceForDest = hasRealSource && useApiKey && !useSeparateAuth;
  // Destination credentials present? Mirrors destAuthBody's selection: reuse the
  // source (api + same-as-source), else the destination fields directly.
  const hasDestAuth = reuseSourceForDest
    ? hasSourceAuth
    : (useApiKey ? !!(destApiKey && destApiEmail) : !!destToken);

  // ── Does the destination zone already exist? ──
  // The conflict (Skip/Overwrite) toggle is only meaningful when there's an
  // existing dest zone to overwrite. Every flow now resolves this the same way:
  // a live /api/zones lookup against the destination account + destination auth
  // (presets included — they target the destination like JSON/Terraform).
  const { exists: destZoneExists } = useDestZoneExists({
    enabled: hasDestAuth && !!destAccountId && !!normalizedZoneName,
    creds: { useApiKey, apiKey, apiEmail, destApiKey, destApiEmail, destToken, sourceToken },
    destAccountId,
    zoneName: normalizedZoneName,
  });

  // Validate sourceZoneId actually exists in the loaded zones list.
  // A stale ID from localStorage shouldn't count if the zone isn't in the dropdown.
  const hasValidSourceZone = !!sourceZoneId && sourceZones.length > 0
    && sourceZones.some(z => z.id === sourceZoneId);

  // Source auth is considered "verified" once the user has supplied
  // credentials AND picked an account + zone — the account/zone dropdowns
  // only populate when the credentials successfully hit the API, so a valid
  // selection is proof the auth works. Gates the inline export buttons.
  const canExport = hasSourceAuth && !!sourceAccountId && hasValidSourceZone;

  const canProceed = (() => {
    if (sourceMode === 'json' || sourceMode === 'terraform') {
      // Import modes: need imported data + dest auth + dest account + dest zone
      return !!importedData && hasDestAuth && !!destAccountId && !!domainName;
    }
    if (isPresetMode) {
      // Preset modes target the destination account, named via the dest zone
      // field. A matched existing zone is reused; an unmatched name is created
      // fresh. Either way we need dest auth + dest account + a non-empty zone.
      return hasDestAuth && !!destAccountId && !!normalizedZoneName;
    }
    // API migrate: need all fields
    return hasSourceAuth && !!sourceAccountId && hasValidSourceZone
      && hasDestAuth && !!destAccountId && !!domainName;
  })();

  const handlePrimaryAction = () => {
    // MaxConfig: confirm overwrite before kicking off the preview/apply flow.
    // The user already saw the red banner under the tab; this is the second
    // and final blunt warning before we touch anything. Skip it when we're
    // creating a brand-new zone — there's no existing data to overwrite (the
    // live destination-zone probe tells us whether the named zone exists).
    if (sourceMode === 'maxconfig' && destZoneExists) {
      setShowMaxConfigOverwriteModal(true);
      return;
    }
    // All other modes (and new-zone MaxConfig) go straight through the same
    // export → preview → execute flow.
    onPreview();
  };

  const primaryDisabled = (isPresetMode ? !canProceed : hasBlockers || !canProceed);

  const primaryLabel = (() => {
    if (hasBlockers && !isPresetMode) return 'Resolve Blockers to Continue';
    return 'Scope Migration';
  })();

  const exportBtnClass = (enabled: boolean) =>
    `flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition ${
      enabled
        ? 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20'
        : 'bg-gray-700 text-gray-500 cursor-not-allowed'
    }`;

  // ── Source credentials fields (auth toggle + key/token + account/zone) ──
  // Rendered inside the Source panel for API and preset modes. No "Source
  // Credentials" heading: the enclosing panel is already titled "Source",
  // mirroring how the Destination panel carries its fields without a
  // separate "Destination Credentials" sub-heading.
  const credentialsFields = (
    <>
      {/* Auth Type Toggle: API Key vs API Token */}
      <div className="flex items-center justify-between">
        <label className="text-xs text-gray-400">Authentication</label>
        <div className="flex bg-gray-700 rounded-lg p-0.5">
          <button type="button"
            onClick={() => setUseApiKey(false)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition ${
              !useApiKey ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            API Token
          </button>
          <button type="button"
            onClick={() => setUseApiKey(true)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition ${
              useApiKey ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            API Key
          </button>
        </div>
      </div>

      {/* API Key fields */}
      {useApiKey && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="source-api-email" className="block text-xs text-gray-400 mb-1">{useSeparateAuth ? 'Source Email' : 'Account Email'}</label>
            <input
              id="source-api-email"
              type="email"
              autoComplete="email"
              value={apiEmail}
              onChange={(e) => setApiEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label htmlFor="source-api-key" className="block text-xs text-gray-400 mb-1">{useSeparateAuth ? 'Source API Key' : 'API Key'}</label>
            <form className="contents" onSubmit={(e) => e.preventDefault()}>
            <input
              id="source-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={useSeparateAuth ? 'Source API Key' : 'Your API Key'}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
            </form>
          </div>
        </div>
      )}

      {/* API Token field. Tokens are account-scoped: for a migration
          this is the SOURCE token only (the destination supplies its
          own token below). Presets write to the single target zone. */}
      {!useApiKey && (
        <div>
          <label htmlFor="source-api-token" className="block text-xs text-gray-400 mb-1">{sourceMode === 'api' ? 'Source API Token' : 'API Token'}</label>
          <form className="contents" onSubmit={(e) => e.preventDefault()}>
          <input
            id="source-api-token"
            type="password"
            autoComplete="off"
            value={sourceToken}
            onChange={(e) => setSourceToken(e.target.value)}
            placeholder={sourceMode === 'api' ? 'Source account API token' : isPresetMode ? 'API token with zone edit access' : 'API token with zone read access'}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
          />
          </form>
          <CreateTokenLink variant={isPresetMode ? 'write' : 'read'} />
        </div>
      )}

      {/* Account & Zone dropdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="source-account" className="block text-xs text-gray-400 mb-1">Account</label>
          <select
            id="source-account"
            value={sourceAccountId}
            onChange={(e) => handleSourceAccountChange(e.target.value)}
            disabled={accountsLoading || accounts.length === 0}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">
              {accountsLoading ? 'Loading accounts...' : 'Select an account'}
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="source-zone" className="block text-xs text-gray-400 mb-1">Zone</label>
          <select
            id="source-zone"
            value={sourceZoneId}
            onChange={(e) => {
              const zoneId = e.target.value;
              setSourceZoneId(zoneId);
              const zone = sourceZones.find(z => z.id === zoneId);
              if (zone && !domainName) {
                setDomainName(zone.name);
              }
            }}
            disabled={zonesLoading || sourceZones.length === 0}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">
              {zonesLoading ? 'Loading zones...' : 'Select a zone'}
            </option>
            {sourceZones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name} ({z.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Credential failure feedback. Without this, a bad token/key silently
          left the account dropdown empty with no explanation. The message is
          the humanized, auth-mode-correct text from the API layer
          (humanizeAuthError), so it tells the user exactly what to fix. */}
      {accountsError && !accountsLoading && (
        <p className="mt-2 text-xs text-red-400">{accountsError}</p>
      )}
     </>
  );

  // ── Auth slot for the migration Destination section (api/json/terraform) ──
  // API Key: the same key works across accounts, so offer to reuse the source
  // credentials (prechecked); unchecking reveals a separate dest key/email.
  // API Token: tokens are account-scoped, so the dest always needs its own.
  const migrationAuthSlot = (
    <>
      {useApiKey && (
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={!useSeparateAuth}
            onChange={(e) => setUseSeparateAuth(!e.target.checked)}
            className="text-orange-500"
          />
          Use same email and API key as source
        </label>
      )}

      {useApiKey && useSeparateAuth && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="dest-api-email" className="block text-xs text-gray-400 mb-1">Destination Email</label>
            <input
              id="dest-api-email"
              type="email"
              autoComplete="email"
              value={destApiEmail}
              onChange={(e) => setDestApiEmail(e.target.value)}
              placeholder="dest@example.com"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label htmlFor="dest-api-key" className="block text-xs text-gray-400 mb-1">Destination API Key</label>
            <form className="contents" onSubmit={(e) => e.preventDefault()}>
            <input
              id="dest-api-key"
              type="password"
              autoComplete="off"
              value={destApiKey}
              onChange={(e) => setDestApiKey(e.target.value)}
              placeholder="Destination API Key"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
            </form>
          </div>
        </div>
      )}

      {!useApiKey && (
        <div>
          <label htmlFor="dest-api-token" className="block text-xs text-gray-400 mb-1">Destination API Token</label>
          <form className="contents" onSubmit={(e) => e.preventDefault()}>
          <input
            id="dest-api-token"
            type="password"
            autoComplete="off"
            value={destToken}
            onChange={(e) => setDestToken(e.target.value)}
            placeholder="Destination account API token"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
          />
          </form>
          <p className="text-xs text-gray-500 mt-1">API tokens are account-scoped, so the destination needs its own token.</p>
          <CreateTokenLink variant="write" />
        </div>
      )}
    </>
  );

  // ── Standalone destination auth slot (json/terraform/maxconfig/minconfig) ──
  // These flows have no real source, so the Destination section carries its OWN
  // credentials directly (no "same as source"). They bind to the dest fields,
  // which is what destAuthBody — and therefore the destination account list,
  // zone create, capability probe, and preset apply — authenticates with. This
  // is the fix for the JSON/Terraform auth gap (their dest dropdown previously
  // read the non-existent source auth). The token needs write/edit access.
  const standaloneDestAuthSlot = (
    <>
      <div className="flex items-center justify-between">
        <label className="text-xs text-gray-400">Authentication</label>
        <div className="flex bg-gray-700 rounded-lg p-0.5">
          <button type="button"
            onClick={() => setUseApiKey(false)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition ${
              !useApiKey ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            API Token
          </button>
          <button type="button"
            onClick={() => setUseApiKey(true)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition ${
              useApiKey ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            API Key
          </button>
        </div>
      </div>

      {useApiKey ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="dest-api-email" className="block text-xs text-gray-400 mb-1">Account Email</label>
            <input
              id="dest-api-email"
              type="email"
              autoComplete="email"
              value={destApiEmail}
              onChange={(e) => setDestApiEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label htmlFor="dest-api-key" className="block text-xs text-gray-400 mb-1">API Key</label>
            <form className="contents" onSubmit={(e) => e.preventDefault()}>
            <input
              id="dest-api-key"
              type="password"
              autoComplete="off"
              value={destApiKey}
              onChange={(e) => setDestApiKey(e.target.value)}
              placeholder="Your API Key"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
            </form>
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor="dest-api-token" className="block text-xs text-gray-400 mb-1">API Token</label>
          <form className="contents" onSubmit={(e) => e.preventDefault()}>
          <input
            id="dest-api-token"
            type="password"
            autoComplete="off"
            value={destToken}
            onChange={(e) => setDestToken(e.target.value)}
            placeholder="API token with zone edit access"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
          />
          </form>
          <CreateTokenLink variant="write" />
        </div>
      )}
    </>
  );

  // Conflict (Skip/Overwrite) toggle, shown for ANY flow when the destination
  // zone already exists (live probe). For MaxConfig it's only meaningful as
  // replace-vs-preserve; MinConfig just resets.
  const destConflict = destZoneExists && !(isPresetMode && sourceMode === 'minconfig') ? (
    <ConflictStrategyToggle
      conflictStrategy={conflictStrategy}
      onSkip={() => setConflictStrategy('skip')}
      onRequestOverwrite={() => setShowConflictOverwriteModal(true)}
    />
  ) : null;

  return (
    <div className="space-y-6">
      {/* ── Source ──────────────────────────────────────────────────
          The single entry point for every flow. The tab picks where the
          source config comes from; the API tab carries the source
          credentials inline (no separate "Source Credentials" card) plus
          one-click export buttons, JSON/Terraform tabs take a file import,
          and the preset tabs apply a canned config to the selected zone. */}
      <div className="bg-gray-800 rounded-lg p-5">
        <label className="block text-xs text-gray-400 mb-3 uppercase tracking-wide font-medium">
          Source
        </label>

        {/* Source Mode Tabs */}
        <div className="flex bg-gray-700 rounded-lg p-0.5 mb-4">
          {SOURCE_MODES.map((mode) => (
            <button type="button"
              key={mode.key}
              onClick={() => {
                setSourceMode(mode.key);
                if (!API_MODES.includes(mode.key)) onClearImport();
              }}
              className={`flex-1 px-2 py-2 text-xs font-medium rounded-md transition whitespace-nowrap ${
                sourceMode === mode.key
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* ── API Source: credentials + inline export buttons ── */}
        {sourceMode === 'api' && (
          <div className="space-y-4">
            {credentialsFields}

            {/* Export buttons: read-only operations on the source zone.
                Grayed out until the source auth is verified (credentials
                entered + account/zone selected), then active. */}
            <div>
              <label className="block text-xs text-gray-400 mb-2">Export source zone</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="button"
                  onClick={onExportZone}
                  disabled={!canExport}
                  title={canExport ? undefined : 'Enter credentials and select a zone to export'}
                  className={exportBtnClass(canExport)}
                >
                  Export Curated JSON
                </button>
                <button type="button"
                  onClick={onExportEverything}
                  disabled={!canExport}
                  title={canExport ? undefined : 'Enter credentials and select a zone to export'}
                  className={exportBtnClass(canExport)}
                >
                  Export Everything JSON
                </button>
                <button type="button"
                  onClick={onExportTerraform}
                  disabled={!canExport}
                  title={canExport ? undefined : 'Enter credentials and select a zone to export'}
                  className={exportBtnClass(canExport)}
                >
                  Export Terraform v5.17
                </button>
              </div>
              {!canExport && (
                <p className="text-xs text-gray-500 mt-1.5">
                  Enter source credentials and select a zone to enable export.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Preset Mode Description + credentials ── */}
        {sourceMode === 'maxconfig' && (
          <div className="space-y-4">
            <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-4">
              <div className="bg-red-900/40 border border-red-600/60 rounded px-3 py-2 mb-3 flex items-start gap-2">
                <WarningOctagon size={14} weight="fill" className="text-red-300 mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-xs font-bold uppercase tracking-wide text-red-300">
                  Warning: using this option will overwrite the existing
                  configuration of this zone and cause the loss of any data or
                  settings that conflict with the preset. Do not run against a
                  production zone.
                </p>
              </div>
              <h4 className="text-sm font-semibold text-blue-400 mb-1">All Features On</h4>
              <p className="text-xs text-gray-400">
                Best-effort maximum configuration for request-affecting settings on the selected zone: apply &ldquo;max&rdquo; values to editable zone settings,
                create rules across ruleset phases, and attempt a wide surface of zone-scoped products/resources. Account-scoped resources are limited
                to MaxConfig-owned objects attached to this zone by default.
              </p>
              <label className="mt-3 flex items-start gap-2 rounded border border-red-700/50 bg-red-950/30 p-3 text-xs text-red-100">
                <input
                  type="checkbox"
                  checked={includeUnsafeAccountWideTrafficSettings}
                  onChange={(event) => setIncludeUnsafeAccountWideTrafficSettings(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-red-500 bg-gray-900 text-red-500 focus:ring-red-500"
                />
                <span>
                  <span className="block font-semibold text-red-200">Include unsafe account-wide or external-risk mutations</span>
                  <span className="block text-red-200/80">
                    Default off. Allows billing-changing zone plan updates and DNSSEC activation. Only use on isolated test accounts/zones after registrar and billing impact are understood.
                  </span>
                </span>
              </label>
            </div>
          </div>
        )}

        {sourceMode === 'minconfig' && (
          <div className="space-y-4">
            <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-4">
              <div className="bg-red-900/40 border border-red-600/60 rounded px-3 py-2 mb-3 flex items-start gap-2">
                <WarningOctagon size={14} weight="fill" className="text-red-300 mt-0.5 shrink-0" aria-hidden="true" />
                <p className="text-xs font-bold uppercase tracking-wide text-red-300">
                  Warning: using this option will reset all settings and
                  delete test resources on this zone. Any data or configuration
                  that depended on them will be lost. Do not run against a
                  production zone.
                </p>
              </div>
              <h4 className="text-sm font-semibold text-blue-400 mb-1">All Features Off</h4>
              <p className="text-xs text-gray-400">
                Reset all settings to defaults, remove resources with &ldquo;MaxConfig&rdquo; in the name,
                and return the zone to a clean baseline state.
              </p>
            </div>
          </div>
        )}

        {/* ── JSON File Source ── */}
        {sourceMode === 'json' && (
          <div className="space-y-4">
            {importedData ? (
              <div className="bg-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-green-400 font-medium">JSON imported successfully</span>
                  <button type="button"
                    onClick={onClearImport}
                    className="text-xs text-red-400 hover:text-red-300 transition"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  {Object.keys(importedData).length} top-level keys loaded
                </p>
              </div>
            ) : (
              <FileDropZone
                dragOver={dragOver}
                setDragOver={setDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                icon="&#128194;"
                label={<>Drop a <span className="text-orange-400 font-medium">.json</span> export file here</>}
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileInput}
              className="hidden"
            />
          </div>
        )}

        {/* ── Terraform Source ── */}
        {sourceMode === 'terraform' && (
          <div className="space-y-4">
            {importedData ? (
              <div className="bg-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-green-400 font-medium">Terraform config imported</span>
                  <button type="button"
                    onClick={onClearImport}
                    className="text-xs text-red-400 hover:text-red-300 transition"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  Configuration loaded from Terraform state
                </p>
              </div>
            ) : (
              <FileDropZone
                dragOver={dragOver}
                setDragOver={setDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                icon="&#128196;"
                label={<>Drop a Terraform <span className="text-orange-400 font-medium">.json</span> export here</>}
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.tf"
              onChange={handleFileInput}
              className="hidden"
            />
          </div>
        )}
      </div>

      {/* ── Destination — one shared section for EVERY flow ──
          API migration: auth offers "use same as source". JSON/Terraform/preset:
          standalone destination auth (they have no source). All bind to the
          destination account context (destAccounts, loaded from destination
          auth), so the account dropdown is correct in every mode. */}
      <DestinationSection
        authSlot={hasRealSource ? migrationAuthSlot : standaloneDestAuthSlot}
        accounts={destAccounts}
        accountsLoading={destAccountsLoading}
        accountsError={hasRealSource ? undefined : destAccountsError}
        accountId={destAccountId}
        onAccountChange={setDestAccountId}
        accountInputId="dest-account"
        accountLabel="Destination Account"
        zoneName={domainName}
        onZoneChange={setDomainName}
        zoneInputId="dest-domain"
        zonePlaceholder={isPresetMode ? 'twilight-test.example.com' : 'example.com'}
        license={licenseSelector}
        conflict={destConflict}
      />

      {/* Migration blockers, warnings, and the primary action button. The
          export terminal / summary now lives at the top of Step 2 (the export
          runs there after the wizard advances on "Scope Migration"). */}
      <>
          {/* Migration Blockers (non-preset only) */}
          {!isPresetMode && blockers.length > 0 && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
              <h3 className="text-red-400 font-semibold text-sm mb-3 flex items-center gap-2">
                <span>&#9940;</span> Migration Blockers
              </h3>
              <ul className="space-y-2">
                {blockers.map((b, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-red-400 mt-0.5 text-xs">&#9679;</span>
                      <div>
                        <span className="text-red-300">{b.message}</span>
                        {b.details && (
                          <p className="text-red-400/60 text-xs mt-0.5">{b.details}</p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings (non-preset only) */}
          {!isPresetMode && warnings.length > 0 && (
            <div className="bg-yellow-900/20 border border-yellow-800 rounded-lg p-4">
              <h3 className="text-yellow-400 font-semibold text-sm mb-3 flex items-center gap-2">
                <span>&#9888;</span> Warnings
              </h3>
              <ul className="space-y-2">
                {warnings.map((w, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-yellow-400 mt-0.5 text-xs">&#9679;</span>
                      <div>
                        <span className="text-yellow-300">{w.message}</span>
                        {w.details && (
                          <p className="text-yellow-400/60 text-xs mt-0.5">{w.details}</p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Primary Action Button */}
          <button type="button"
            onClick={handlePrimaryAction}
            disabled={primaryDisabled}
            className={`w-full py-3 px-6 rounded-lg text-sm font-semibold transition ${
              primaryDisabled
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/25'
            }`}
          >
            {primaryLabel}
          </button>
        </>

      {/* MaxConfig destructive-overwrite confirmation modal - same component
          as the Step 2 conflict-strategy modal. Fires whenever the user
          clicks Scope Migration in maxconfig mode. */}
      {showMaxConfigOverwriteModal && (
        <OverwriteConfirmModal
          zoneName={domainName || undefined}
          onCancel={() => setShowMaxConfigOverwriteModal(false)}
          onConfirm={() => {
            setShowMaxConfigOverwriteModal(false);
            onPreview();
          }}
        />
      )}

      {/* Confirm switching the inline conflict toggle Skip → Overwrite for an
          existing destination zone (destructive). Going Overwrite → Skip is safe
          and does not prompt. */}
      {showConflictOverwriteModal && (
        <OverwriteConfirmModal
          zoneName={domainName.trim() || undefined}
          onCancel={() => setShowConflictOverwriteModal(false)}
          onConfirm={() => {
            setShowConflictOverwriteModal(false);
            setConflictStrategy('overwrite');
          }}
        />
      )}
    </div>
  );
}
