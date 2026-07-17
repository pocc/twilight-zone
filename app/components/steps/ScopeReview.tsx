import React, { useState, useMemo, useCallback } from 'react';
import type { AccountCapabilities, Credentials } from '../../lib/api';
import type {
  ZoneExport, CFZoneSetting, CFRuleset,
} from '../../../src/types';
import { EmailAddressVerificationCard, type EmailAddressState } from '../EmailAddressVerificationCard';
import { OutOfScopePanel } from '../OutOfScopePanel';
import { PostMigrationWorkPanel } from '../PostMigrationWorkPanel';
import { AnalyticsArchiveSection, type AnalyticsArchiveConfig } from '../AnalyticsArchiveSection';
import { DownloadScriptButton } from '../DownloadScriptButton';
import {
  detectApplicableImpossibleResources,
  deriveItemState,
  hasInlineFixIt,
  impossibleResourcePhase,
  isPostMigrationManualItem,
  type FixItState,
} from '../../lib/outOfScope';
import type { OriginCaCsrInput } from '../../lib/types';
import { OverwriteConfirmModal } from './scope/OverwriteConfirmModal';
import { CollapsibleGroup } from './scope/CollapsibleGroup';
import { detectPreMigrationActions, PreMigrationActionCard } from './scope/preMigrationActions';
import {
  buildGroups,
  CAPABILITY_GROUP_MAP,
  GROUP_TO_CAPABILITY,
  groupPhase,
  type WizardPhase,
  type ConflictStrategy,
  type DOConfig,
  type D1Config,
  type ResourceItem,
  type ResourceGroup,
} from './scope/groups';

// Backwards-compat re-exports. App.tsx now imports buildGroups + types
// directly from ./scope/groups, but other callers may still pull them from
// here. Keep these as pure re-exports so they don't pull in ScopeReview's
// large component when only the helpers/types are needed.
export { OverwriteConfirmModal, buildGroups };
export type { ConflictStrategy, DOConfig, D1Config };

export interface ScopeReviewProps {
  exportData: ZoneExport;
  selections: Record<string, Record<string, boolean>>;
  setSelections: React.Dispatch<React.SetStateAction<Record<string, Record<string, boolean>>>>;
  validationWarnings: Array<{ type: string; title: string; details: string; group?: string }>;
  capabilities?: AccountCapabilities | null;
  existingTurnstileWidgets?: string[];
  conflictStrategy: ConflictStrategy;
  /** Keys of resources already identical on the destination (overwrite mode);
   * matching rows render an advisory "already identical" badge. */
  identicalSet?: Set<string>;
  doConfigs: Record<string, DOConfig>;
  setDoConfigs: React.Dispatch<React.SetStateAction<Record<string, DOConfig>>>;
  d1Configs: Record<string, D1Config>;
  setD1Configs: React.Dispatch<React.SetStateAction<Record<string, D1Config>>>;
   r2Credentials: { source: { accessKeyId: string; secretAccessKey: string }; dest: { accessKeyId: string; secretAccessKey: string } };
  setR2Credentials: React.Dispatch<React.SetStateAction<{ source: { accessKeyId: string; secretAccessKey: string }; dest: { accessKeyId: string; secretAccessKey: string } }>>;
  /** MaxConfig/MinConfig preset apply (source IS destination — see App.tsx).
   * In a preset there is no second account to copy R2 object data from, so the
   * R2 group is treated like any other account resource (buckets are just
   * created) and the cross-account "R2 Data Migration" credentials card is
   * suppressed. Defaults to false (real source→dest migration). */
  isPreset?: boolean;
  destAccountName?: string;
  destAccountId?: string;
  /** Destination zone tag — only known when the destination zone already
   * exists (e.g. presets, where source IS the destination). Omitted for a
   * fresh migration where the zone is created during Apply, so the
   * confirmation card shows the zone name without a (nonexistent) tag. */
  destZoneId?: string;
  /** The destination plan (legacy_id, e.g. 'enterprise'/'business'/'pro'/'free')
   * the user picked in Step 1. Drives the enterprise-settings acknowledgment
   * gate: when it's a known non-Enterprise plan, source-enabled enterprise
   * settings can't apply on the destination and must be acknowledged. */
  selectedPlan?: string | null;
  /** "Archive source analytics" add-on config. Provided only for a live API
   * source (presets/imports have no source zone to probe/capture); when
   * undefined the section is hidden. */
  analytics?: AnalyticsArchiveConfig;
  onBack: () => void;
  onNext: () => void;
  /** #19 two-phase split: when set, render ONLY this phase's resource groups
   * (account-scoped in the Account step, zone-scoped in the Zone step). When
   * undefined (presets / legacy), render every group. */
  phase?: WizardPhase;
  /** Label for the primary action button (e.g. "Continue to Zone →",
   * "Continue to Apply →"). Defaults to the legacy "Continue to Migration". */
  primaryLabel?: string;
  /** Whether the destination-confirmation block gates the primary button.
   * The migration now runs from the Apply step, so the Account/Zone steps are
   * select-only navigation and pass `false` (the confirmation lives on Apply
   * via <DestinationConfirm>). Defaults to true for back-compat. */
  requireDestConfirm?: boolean;
  /** #19 Part D: when set (Account step only), render the "Download planned API
   * calls as a script" control next to the primary action, behind the same gate. */
  downloadScriptInputs?: { sourceZoneId: string; sourceAccountId: string; destAccountId: string; domainName?: string };
  /** Re-check destination account capabilities (user may have enabled features) */
  onRecheckCapabilities?: () => Promise<void>;
  /** Whether a capability re-check is in progress */
  recheckingCapabilities?: boolean;
  /** Pre-migration acknowledgments - set of warning keys the user has accepted */
  acknowledgments?: Set<string>;
  /** Setter for acknowledgments */
  setAcknowledgments?: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Credentials - needed by the email-address verification card to call /api/email-routing/* */
  creds?: Partial<Credentials>;
  /** Per-address verification state for email forwarding addresses */
  emailAddressStates?: Record<string, EmailAddressState>;
  setEmailAddressStates?: React.Dispatch<React.SetStateAction<Record<string, EmailAddressState>>>;
  /** Show an in-app toast (replaces native alert(); see App.tsx). */
  showToast?: (message: string, type?: 'error' | 'success') => void;
  /* ─ Inline fix-it state shared with Step 3. When provided, the OutOfScopePanel
     renders inline fix-it forms for worker_secrets /
     custom_certificate_keys / origin_ca_keys items. State lives at
     the wizard root in App.tsx so values entered here persist to
     Step 3 (and vice versa). All four are optional so the component
     remains usable from preset / preview contexts that don't drive a
     real migration. */
  workerSecrets?: Record<string, Record<string, string>>;
  setWorkerSecrets?: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  certificates?: Array<{ cert: string; key: string }>;
  setCertificates?: React.Dispatch<React.SetStateAction<Array<{ cert: string; key: string }>>>;
  originCaCsrs?: OriginCaCsrInput[];
  setOriginCaCsrs?: React.Dispatch<React.SetStateAction<OriginCaCsrInput[]>>;
  /** Bucket 2.1: notification webhook signing secrets, keyed by source
   * webhook name. */
  notificationWebhookSecrets?: Record<string, string>;
  setNotificationWebhookSecrets?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Bucket 2.2: Access IdP client_secret values, keyed by source IdP name. */
  identityProviderSecrets?: Record<string, string>;
  setIdentityProviderSecrets?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Bucket 2.3: AOP mTLS cert+key bundles. */
  aopMtlsBundles?: Array<{ name: string; certificates: string; private_key: string; ca?: boolean }>;
  setAopMtlsBundles?: React.Dispatch<React.SetStateAction<Array<{ name: string; certificates: string; private_key: string; ca?: boolean }>>>;
  /** Bucket 2.4: AI Gateway provider API keys, keyed by source slug. */
  aiGatewayProviderApiKeys?: Record<string, string>;
  setAiGatewayProviderApiKeys?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function ScopeReview({
  exportData,
  selections,
  setSelections,
  validationWarnings,
  capabilities,
  existingTurnstileWidgets,
  conflictStrategy,
  identicalSet,
  doConfigs,
  setDoConfigs,
  d1Configs,
  setD1Configs,
  r2Credentials,
  setR2Credentials,
  isPreset = false,
  destAccountName,
  destAccountId,
  destZoneId,
  selectedPlan,
  analytics,
  onBack,
  onNext,
  phase,
  primaryLabel,
  requireDestConfirm = true,
  downloadScriptInputs,
  onRecheckCapabilities,
  recheckingCapabilities = false,
  acknowledgments = new Set<string>(),
  setAcknowledgments,
  creds,
  emailAddressStates,
  setEmailAddressStates,
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
}: ScopeReviewProps) {
  // Build a human-readable account label: "Name (abc123...)" or just the ID
  const destAccountLabel = destAccountName
    ? `${destAccountName} (${(destAccountId || '').slice(0, 8)}...)`
    : destAccountId || undefined;
  const groups = useMemo(() => {
    const all = buildGroups(exportData, capabilities ?? undefined, existingTurnstileWidgets, doConfigs, d1Configs, conflictStrategy, destAccountLabel);
    // #19 two-phase split: the Account step shows only account-phase groups,
    // the Zone step only zone-phase groups. Presets / legacy (phase undefined)
    // show everything.
    return phase ? all.filter(g => groupPhase(g) === phase) : all;
  }, [exportData, capabilities, existingTurnstileWidgets, doConfigs, d1Configs, conflictStrategy, destAccountLabel, phase]);
  // Out-of-scope acknowledgments: read IMPOSSIBLE_TO_MIGRATE and surface
  // every entry applicable to this export. Detection is pure - see
  // app/lib/outOfScope.ts.
  // #19 two-phase split: the Account step reviews/gates ONLY account-phase
  // impossible-to-migrate items, the Zone step ONLY zone-phase items. Filtering
  // here scopes everything downstream in one place — the acknowledgment gate
  // (actionableImpossibleResources), the post-migration list, and the
  // OutOfScopePanel secret fix-it forms. Presets / legacy (phase undefined)
  // see the full list.
  const impossibleResources = useMemo(() => {
    const all = detectApplicableImpossibleResources(exportData, destAccountId);
    return phase ? all.filter(r => impossibleResourcePhase(r) === phase) : all;
  }, [exportData, phase, destAccountId]);
  // A group is relocated out of the resource list into the consolidated
  // "Requires your acknowledgement" section (above Continue) when it needs a
  // forced acknowledgement to be migrated — so the resource never appears in
  // two places. Two cases:
  //   1. Capability-gated and disabled (entitlement missing on the dest) — the
  //      group carries the "include them anyway" acknowledgement.
  //   2. D1 databases — each item carries the manual schema/data migration
  //      acknowledgement. (Durable Objects stay in the resource list: they
  //      need *configuration*, not an acknowledgement.)
  const groupNeedsAck = useCallback(
    (g: ResourceGroup) =>
      (!!g.disabled && !!GROUP_TO_CAPABILITY[g.key]) || g.key === 'd1Databases',
    [],
  );
  const zoneGroups = useMemo(() => groups.filter(g => g.scope === 'zone' && !groupNeedsAck(g)), [groups, groupNeedsAck]);
  const accountGroups = useMemo(() => groups.filter(g => g.scope === 'account' && !groupNeedsAck(g)), [groups, groupNeedsAck]);
  const showZoneResourceSection = !phase || phase === 'zone';
  const showAccountResourceSection = !phase || phase === 'account';
  // Groups relocated into the acknowledgement section (zone order preserved).
  const ackGroups = useMemo(() => groups.filter(groupNeedsAck), [groups, groupNeedsAck]);

  // All groups (zone first, then account - already sorted by buildGroups).
  // Selection, counters and the Continue-gate all iterate this full set, so
  // relocating a group's *render position* (above) never changes which items
  // are counted, selectable, or required — only where they appear on screen.
  const allGroups = groups;

  // Destination confirmation. The user must explicitly tick the destination
  // they're writing to before the (destructive) action button enables. Split by
  // phase: the Account step confirms the account; the Zone step confirms the
  // zone; presets/legacy (phase undefined) confirm both at the single apply.
  const showAccountConfirm = phase === 'account' || phase === undefined;
  const showZoneConfirm = phase === 'zone' || phase === undefined;
  const [accountConfirmed, setAccountConfirmed] = useState(false);
  const [zoneConfirmed, setZoneConfirmed] = useState(false);
  // When the confirmation isn't required here (select-only Account/Zone steps;
  // the real confirmation happens on the Apply step), treat the destination as
  // confirmed so the primary "Continue" button isn't gated on it.
  const destConfirmed = !requireDestConfirm
    ? true
    : (!showAccountConfirm || accountConfirmed) && (!showZoneConfirm || zoneConfirmed);

  const { totalItems, selectedItems, capabilityDisabledItems, itemDisabledCount, capabilityDisabledDetails } = useMemo(() => {
    let total = 0;
    let selected = 0;
    let capDisabled = 0;  // Items in capability-gated groups (dest account lacks feature)
    let itemSkipped = 0;  // Individual items disabled (AE workers, Turnstile duplicates, etc.)
    const disabledDetails: Array<{ groupKey: string; groupName: string; reason?: string; items: string[] }> = [];
    for (const group of allGroups) {
      if (group.disabled) {
        disabledDetails.push({
          groupKey: group.key,
          groupName: group.label,
          reason: group.disabledReason,
          items: group.items.map(item => item.label),
        });
      }
      // A group that is disabled but acknowledged is treated as selectable
      const capKey = GROUP_TO_CAPABILITY[group.key];
      const groupAcknowledged = !!group.disabled && !!capKey && acknowledgments.has(capKey);
      for (const item of group.items) {
        if (group.disabled && !groupAcknowledged) {
          capDisabled++;
        } else if (item.disabled) {
          itemSkipped++;
        } else {
          total++;
          if (selections[group.key]?.[item.id]) selected++;
        }
      }
    }
    return { totalItems: total, selectedItems: selected, capabilityDisabledItems: capDisabled, itemDisabledCount: itemSkipped, capabilityDisabledDetails: disabledDetails };
  }, [allGroups, selections, acknowledgments]);





  const handleToggleAll = useCallback(
    (groupKey: string, value: boolean) => {
      setSelections((prev) => {
        const group = groups.find((g) => g.key === groupKey);
        if (!group) return prev;
        // Allow toggle if group is not disabled, OR if it's disabled but acknowledged
        const capKey = GROUP_TO_CAPABILITY[group.key];
        const isGroupAcknowledged = !!group.disabled && !!capKey && acknowledgments.has(capKey);
        if (group.disabled && !isGroupAcknowledged) return prev;
        const next = { ...prev };
        const groupSelections: Record<string, boolean> = { ...prev[groupKey] };
        for (const item of group.items) {
          if (item.disabled) continue; // Skip per-item disabled items
          groupSelections[item.id] = value;
        }
        next[groupKey] = groupSelections;
        return next;
      });
    },
    [groups, setSelections, acknowledgments],
  );

  const handleToggleItem = useCallback(
    (groupKey: string, itemId: string, value: boolean) => {
      setSelections((prev) => ({
        ...prev,
        [groupKey]: {
          ...prev[groupKey],
          [itemId]: value,
        },
      }));
    },
    [setSelections],
  );

  const handleSelectAll = useCallback(() => {
    setSelections((prev) => {
      const next = { ...prev };
      for (const group of allGroups) {
        // Skip groups that are disabled AND not acknowledged
        const capKey = GROUP_TO_CAPABILITY[group.key];
        const isGroupAcknowledged = !!group.disabled && !!capKey && acknowledgments.has(capKey);
        if (group.disabled && !isGroupAcknowledged) continue;
        const groupSelections: Record<string, boolean> = { ...prev[group.key] };
        for (const item of group.items) {
          if (item.disabled) continue; // Skip per-item disabled items
          groupSelections[item.id] = true;
        }
        next[group.key] = groupSelections;
      }
      return next;
    });
  }, [allGroups, setSelections, acknowledgments]);

  const handleDeselectAll = useCallback(() => {
    setSelections((prev) => {
      const next = { ...prev };
      for (const group of allGroups) {
        const groupSelections: Record<string, boolean> = {};
        for (const item of group.items) {
          groupSelections[item.id] = false;
        }
        next[group.key] = groupSelections;
      }
      return next;
    });
  }, [allGroups, setSelections]);

  // Pre-migration action detection (D1, R2, DO, certs, secrets, AE)
  const allGroupKeys = useMemo(() => new Set(allGroups.map(g => g.key)), [allGroups]);
  const preMigrationActions = useMemo(
    () => detectPreMigrationActions(exportData, selections, capabilities, exportData?.sourceAccountId || exportData?.zone?.account?.id, destAccountId, selectedPlan)
      .filter(a => a.affected.some(af => allGroupKeys.has(af.groupKey))),
    [exportData, selections, capabilities, allGroupKeys, destAccountId, selectedPlan],
  );

  // Track which pre-migration actions the user has acknowledged ("I have run these commands")
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const handleAcknowledge = useCallback((id: string, value: boolean) => {
    setAcknowledged(prev => ({ ...prev, [id]: value }));
  }, []);

  const handleDeselectAction = useCallback(
    (affected: { groupKey: string; itemIds: string[] }[]) => {
      setSelections((prev) => {
        const next = { ...prev };
        for (const { groupKey, itemIds } of affected) {
          const groupSel = { ...next[groupKey] };
          for (const id of itemIds) {
            groupSel[id] = false;
          }
          next[groupKey] = groupSel;
        }
        return next;
      });
    },
    [setSelections],
  );

  const zone = exportData?.zone;

  // Resource counts for the summary
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

  const disabledGroupCount = allGroups.filter(g => g.disabled).length;

  // Email-routing forward addresses must be verified or explicitly skipped
  // before the user can proceed. Count un-resolved entries so we can disable
  // the Continue button with a clear reason. Email Routing is zone-scoped, so
  // this only gates the Zone step (and presets/legacy) — never the Account step
  // (#19 two-phase split).
  const isZonePhase = !phase || phase === 'zone';
  const unresolvedEmailAddresses = useMemo(() => {
    if (!emailAddressStates) return [] as string[];
    return Object.values(emailAddressStates)
      .filter(s => s.status !== 'verified' && s.status !== 'skipped')
      .map(s => s.email);
  }, [emailAddressStates]);
  const emailBlocked = isZonePhase && unresolvedEmailAddresses.length > 0;

  // Out-of-scope blocker - every *actionable* IMPOSSIBLE_TO_MIGRATE
  // entry must be acknowledged before the user can proceed. This
  // enforces AGENTS.md Principle 1 (No Surprise Failures): the user
  // explicitly accepts what won't migrate, so the Results page never
  // shows a surprise.
  //
  // Per Principle 4 (Never Ask the User to Acknowledge Things They
  // Cannot Change), informational entries (auto_managed, read_only,
  // data_ephemeral) are disclosure-only and never contribute to the
  // gate - even when they appear in impossibleResources.
  //
  // Each actionable item
  // resolves to 'fixed' (user supplied values inline; migration tool
  // will set them), 'acknowledged' (user explicitly opted to skip
  // the fix), or 'unresolved' (default; blocks Continue). Both
  // 'fixed' and 'acknowledged' unblock the Continue button.
  // Only fix-it-bearing actionable items gate Continue — the tool consumes
  // those values at migrate time. Actionable items the user performs AFTER
  // zone creation (no fix-it form) are NOT gated; they're disclosed in the
  // PostMigrationWorkPanel and asked for real on the Results step.
  const actionableImpossibleResources = useMemo(
    () => impossibleResources.filter(r => r.actionable && hasInlineFixIt(r.key)),
    [impossibleResources],
  );
  const postMigrationManualResources = useMemo(
    () => impossibleResources.filter(isPostMigrationManualItem),
    [impossibleResources],
  );
  const fixState: FixItState = useMemo(() => ({
    workerSecrets: workerSecrets ?? {},
    certificates: certificates ?? [],
    originCaCsrs: originCaCsrs ?? [],
    notificationWebhookSecrets: notificationWebhookSecrets ?? {},
    identityProviderSecrets: identityProviderSecrets ?? {},
    aopMtlsBundles: aopMtlsBundles ?? [],
    aiGatewayProviderApiKeys: aiGatewayProviderApiKeys ?? {},
    sourceWorkers: exportData?.workers,
    sourceCustomCertificates: exportData?.customCertificates,
    sourceOriginCaCertificates: exportData?.originCaCertificates,
    sourceNotificationWebhooks: exportData?.notificationWebhooks,
    sourceIdentityProviders: exportData?.identityProviders,
    sourceAiGatewayCustomProviders: exportData?.aiGatewayCustomProviders,
    sourceAopHostnameAssociations: exportData?.hostnameAssociations,
  }), [
    workerSecrets, certificates, originCaCsrs,
    notificationWebhookSecrets, identityProviderSecrets,
    aopMtlsBundles, aiGatewayProviderApiKeys,
    exportData,
  ]);
  const unresolvedActionableCount = useMemo(
    () =>
      actionableImpossibleResources.filter(
        r => deriveItemState(r, fixState, acknowledgments) === 'unresolved',
      ).length,
    [actionableImpossibleResources, fixState, acknowledgments],
  );
  const outOfScopeBlocked = unresolvedActionableCount > 0;

  // Pre-migration actions flagged requiresAck gate Continue until the user
  // ticks their checkbox (or resolves them by deselecting / selecting the
  // missing resource, which removes the action from preMigrationActions).
  // AGENTS.md Principle 3: irreversible decisions are made before migration.
  const unacknowledgedRequiredActions = useMemo(
    () => preMigrationActions.filter(a => a.requiresAck && !acknowledged[a.id]),
    [preMigrationActions, acknowledged],
  );
  const preMigrationActionsBlocked = unacknowledgedRequiredActions.length > 0;
  /** True when the panel can render inline fix-it forms - requires both
   * the ack setter (so the user can toggle skip) AND the fix-it state
   * setters (so the user can type values). When any required setter is
   * missing (e.g. preset/preview contexts), we fall back to the read-
   * only / no-fix-it path: the panel still renders but inline fix-it
   * forms are hidden. */
  const canShowFixItPanel =
    !!setAcknowledgments &&
    !!setWorkerSecrets &&
    !!setCertificates &&
    !!setOriginCaCsrs &&
    !!setNotificationWebhookSecrets &&
    !!setIdentityProviderSecrets &&
    !!setAopMtlsBundles &&
    !!setAiGatewayProviderApiKeys;

  return (
    <div className="space-y-6">
      {/* Zone Summary */}
      {(
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-5">
          <h2 className="text-lg font-semibold text-gray-100 mb-3">Export Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Zone</div>
              <div className="text-sm font-medium text-gray-200">{zone?.name || 'Unknown'}</div>
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
            <div className="mt-4 flex flex-wrap gap-2">
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
        </div>
      )}

      {/* Validation notices - split into 3 categories */}
      {(() => {
        // The legacy 'warning' tier was removed: its items were either
        // factually stale or genuinely informational/licensing, so they were
        // reclassified (see app/lib/validation.ts). Notices now fall into
        // Errors / Licensing / Information only.
        const errors = validationWarnings.filter(w => w.type === 'error');
        const licensing: Array<{ type: string; title: string; details: string; group?: string }> = validationWarnings.filter(w => w.type === 'licensing');
        const infos = validationWarnings.filter(w => w.type === 'info');

        // Helper: group items by their `group` field.
        // Returns an ordered list of { groupKey, displayName, items }.
        // Ungrouped items get groupKey = null and appear individually.
        type WarnItem = { type: string; title: string; details: string; group?: string; capabilityKey?: string };
        type GroupedEntry = { groupKey: string | null; displayName: string; items: WarnItem[] };
        const groupItems = (list: WarnItem[]): GroupedEntry[] => {
          const result: GroupedEntry[] = [];
          const groupMap = new Map<string, GroupedEntry>();
          for (const item of list) {
            if (item.group) {
              let entry = groupMap.get(item.group);
              if (!entry) {
                // "worker:maxconfig-worker" → "maxconfig-worker", "spectrum" → "Spectrum", etc.
                const groupDisplayNames: Record<string, string> = {
                  spectrum: 'Spectrum', loadbalancing: 'Load Balancing',
                };
                const displayName = item.group.startsWith('worker:')
                  ? item.group.slice(7)
                  : (groupDisplayNames[item.group] || item.group);
                entry = { groupKey: item.group, displayName, items: [] };
                groupMap.set(item.group, entry);
                result.push(entry);
              }
              entry.items.push(item);
            } else {
              result.push({ groupKey: null, displayName: '', items: [item] });
            }
          }
          return result;
        };

        // Helper: does this warning get a re-check button?
        const hasRecheck = (w: WarnItem) =>
          w.title.includes('not available on destination');

        const groupedErrors = groupItems(errors);
        const groupedLicensing = groupItems(licensing);
        const groupedInfos = groupItems(infos);

        return (
          <div className="space-y-4">
            {/* ── Errors ── */}
            <div>
              <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-1.5">Errors</h3>
              {errors.length === 0 ? (
                <div className="text-xs text-gray-500">0 errors found</div>
              ) : (
                <div className="space-y-2">
                  {groupedErrors.map((entry, gi) => entry.groupKey ? (
                    /* Grouped error card */
                    <div key={`g-${gi}`} className="border rounded-lg p-3 bg-red-900/20 border-red-700/50">
                      <div className="flex items-start gap-2">
                        <span className="text-sm mt-0.5">{'\u274C'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-red-200 mb-1">{entry.displayName}</div>
                          <ul className="space-y-0.5">
                            {entry.items.map((w, i) => (
                              <li key={i} className="text-xs text-gray-400 flex items-baseline gap-1.5">
                                <span className="text-red-400/70 shrink-0">&bull;</span>
                                <span><span className="text-red-300">{w.title}</span> &mdash; {w.details}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Ungrouped error card */
                    <div key={`u-${gi}`} className="border rounded-lg p-3 bg-red-900/20 border-red-700/50">
                      <div className="flex items-start gap-2">
                        <span className="text-sm mt-0.5">{'\u274C'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-red-300">{entry.items[0].title}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{entry.items[0].details}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Licensing ── */}
            <div>
              <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wide mb-1.5">Licensing</h3>
              {licensing.length === 0 ? (
                <div className="text-xs text-gray-500">No licensing issues found</div>
              ) : (
                <div className="space-y-2">
                  {groupedLicensing.map((entry, gi) => {
                    // Use capabilityKey as ackKey when available - this matches ACK_SECTION_MAP in migrate.ts
                    // Falls back to groupKey, then index-based key for entries without capability info
                    const ackKey = entry.items[0]?.capabilityKey || entry.groupKey || `licensing-${gi}`;
                    const isAcked = acknowledgments.has(ackKey);
                    const ackCheckbox = setAcknowledgments && (
                      <label className="flex items-center gap-2 mt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isAcked}
                          onChange={(e) => {
                            setAcknowledgments(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(ackKey);
                              else next.delete(ackKey);
                              return next;
                            });
                          }}
                          className="rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500/50"
                        />
                        <span className="text-xs text-gray-400">I acknowledge these items won&apos;t migrate</span>
                      </label>
                    );
                    const recheckBtn = entry.items.some(hasRecheck) && onRecheckCapabilities && (
                      <button
                        type="button"
                        onClick={onRecheckCapabilities}
                        disabled={recheckingCapabilities}
                        className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-md bg-purple-800/40 text-purple-300 hover:bg-purple-800/70 disabled:opacity-50 disabled:cursor-not-allowed transition"
                      >
                        {recheckingCapabilities ? 'Checking...' : 'Re-check'}
                      </button>
                    );

                    if (entry.groupKey) {
                      return (
                        <div key={`g-${gi}`} className={`border rounded-lg p-3 ${isAcked ? 'bg-gray-800/50 border-gray-700/50' : 'bg-purple-900/15 border-purple-700/40'}`}>
                          <div className="flex items-start gap-2">
                            <span className="text-sm mt-0.5">{isAcked ? '\u2611' : '\uD83D\uDCCB'}</span>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-semibold mb-1 ${isAcked ? 'text-gray-400 line-through' : 'text-purple-200'}`}>{entry.displayName}</div>
                              <ul className="space-y-0.5">
                                {entry.items.map((w, i) => (
                                  <li key={i} className="text-xs text-gray-400 flex items-baseline gap-1.5">
                                    <span className="text-purple-400/70 shrink-0">&bull;</span>
                                    <span><span className={isAcked ? 'text-gray-500' : 'text-purple-300'}>{w.title}</span> &mdash; {w.details}</span>
                                  </li>
                                ))}
                              </ul>
                              {ackCheckbox}
                            </div>
                            {recheckBtn}
                          </div>
                        </div>
                      );
                    }

                    // Ungrouped licensing card
                    const w = entry.items[0];
                    const relatedGroupKeys = w.capabilityKey
                      ? (CAPABILITY_GROUP_MAP[w.capabilityKey as keyof typeof CAPABILITY_GROUP_MAP] || [])
                      : [];
                    const itemsToShow = relatedGroupKeys.length > 0
                      ? capabilityDisabledDetails.filter(g => relatedGroupKeys.includes(g.groupKey))
                      : [];

                    return (
                      <div key={`u-${gi}`} className={`border rounded-lg p-3 ${isAcked ? 'bg-gray-800/50 border-gray-700/50' : 'bg-purple-900/15 border-purple-700/40'}`}>
                        <div className="flex items-start gap-2">
                          <span className="text-sm mt-0.5">{isAcked ? '\u2611' : '\uD83D\uDCCB'}</span>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium ${isAcked ? 'text-gray-400 line-through' : 'text-purple-300'}`}>{w.title}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{w.details}</div>
                            {itemsToShow.length > 0 && (
                              <div className="mt-2 max-h-[200px] overflow-y-auto border border-purple-700/30 rounded-md bg-gray-900/50">
                                <ul className="py-1.5 px-2.5 space-y-0">
                                  {itemsToShow.flatMap(g => g.items).map((item, iIdx) => (
                                    <li key={iIdx} className="text-xs text-gray-400 flex items-baseline gap-1.5">
                                      <span className="text-purple-400/50 shrink-0">&bull;</span>
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {ackCheckbox}
                          </div>
                          {recheckBtn}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Information ── */}
            <div>
              <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-1.5">Information</h3>
              {infos.length === 0 ? (
                <div className="text-xs text-gray-500">0 informational notices found</div>
              ) : (
                <div className="space-y-2">
                  {groupedInfos.map((entry, gi) => entry.groupKey ? (
                    /* Grouped info card */
                    <div key={`g-${gi}`} className="border rounded-lg p-3 bg-blue-900/15 border-blue-700/40">
                      <div className="flex items-start gap-2">
                        <span className="text-sm mt-0.5 text-blue-400">{'\u2139\uFE0F'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-blue-200 mb-1">{entry.displayName}</div>
                          <ul className="space-y-0.5">
                            {entry.items.map((w, i) => (
                              <li key={i} className="text-xs text-gray-400 flex items-baseline gap-1.5">
                                <span className="text-blue-400/70 shrink-0">&bull;</span>
                                <span><span className="text-gray-300">{w.title}</span> &mdash; {w.details}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Ungrouped info - simple bullet item */
                    <div key={`u-${gi}`} className="text-xs text-gray-400 flex items-baseline gap-1.5">
                      <span className="text-blue-400/70 shrink-0">&bull;</span>
                      <span><span className="text-gray-300">{entry.items[0].title}</span> &mdash; {entry.items[0].details}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Email Routing destination-address verification -
         Blocks "Continue to Migration" until every forward-target address is
         either verified on the dest account or explicitly skipped. Email
         Routing is zone-scoped, so the card only appears on the Zone step
         (and presets/legacy), never the Account step (#19 two-phase split). */}
      {isZonePhase && emailAddressStates && setEmailAddressStates && creds && destAccountId && Object.keys(emailAddressStates).length > 0 && (
        <EmailAddressVerificationCard
          states={emailAddressStates}
          setStates={setEmailAddressStates}
          creds={creds}
          destAccountId={destAccountId}
          destAccountName={destAccountName}
        />
      )}

      {/* Section header + selection controls */}
      <div className="flex items-center justify-between gap-4 pt-2 pb-2">
        <h2 className="text-lg font-bold text-gray-100">Resources</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            <span className="text-orange-400 font-semibold">{selectedItems}</span>
            {' / '}<span className="font-semibold">{totalItems}</span> selected
            {capabilityDisabledItems > 0 && <span className="text-red-400/70 ml-1">({capabilityDisabledItems} unavailable)</span>}
            {itemDisabledCount > 0 && <span className="text-yellow-400/70 ml-1">({itemDisabledCount} skipped)</span>}
          </span>
          <div className="flex gap-2">
            <button onClick={handleSelectAll} className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-gray-100 transition">
              Select All
            </button>
            <button onClick={handleDeselectAll} className="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-gray-100 transition">
              Deselect All
            </button>
          </div>
        </div>
      </div>

      {/* Resource Groups - zone groups first, then account groups */}
      <div className="space-y-6">
        {showZoneResourceSection && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Zone Resources</h3>
            {zoneGroups.length === 0 ? (
              <div className="text-center py-4 text-gray-500 text-sm">No zone-level resources found.</div>
            ) : zoneGroups.map((group) => (
              <CollapsibleGroup
                key={group.key}
                group={group}
                selected={selections[group.key] || {}}
                onToggleAll={handleToggleAll}
                onToggleItem={handleToggleItem}
                defaultExpanded={false}
                sourceAccountId={exportData?.sourceAccountId || exportData?.zone?.account?.id}
                sourceZoneName={exportData?.zone?.name}
                destAccountId={destAccountId}
                acknowledgments={acknowledgments}
                setAcknowledgments={setAcknowledgments}
                showToast={showToast}
                identicalSet={identicalSet}
              />
            ))}
          </div>
        )}

        {showAccountResourceSection && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Account Resources</h3>
            {accountGroups.length === 0 ? (
              <div className="text-center py-4 text-gray-500 text-sm">No account-level resources found.</div>
            ) : accountGroups.map((group) => (
              <CollapsibleGroup
                key={group.key}
                group={group}
                selected={selections[group.key] || {}}
                onToggleAll={handleToggleAll}
                onToggleItem={handleToggleItem}
                defaultExpanded={false}
                doConfigs={group.key === 'durableObjects' ? doConfigs : undefined}
                setDoConfigs={group.key === 'durableObjects' ? setDoConfigs : undefined}
                r2Credentials={group.key === 'r2Buckets' && !isPreset ? r2Credentials : undefined}
                setR2Credentials={group.key === 'r2Buckets' && !isPreset ? setR2Credentials : undefined}
                sourceAccountId={exportData?.sourceAccountId || exportData?.zone?.account?.id}
                sourceZoneName={exportData?.zone?.name}
                destAccountId={destAccountId}
                acknowledgments={acknowledgments}
                setAcknowledgments={setAcknowledgments}
                showToast={showToast}
                identicalSet={identicalSet}
              />
            ))}
          </div>
        )}
      </div>

      {/* Conflict strategy (Skip / Overwrite) moved to the Setup step — it is
          only shown there when the destination zone already exists, so the
          decision is made once, before any review. See Step0Credentials. */}

      {/* Archive source analytics — pre-checked, opt-out parallel add-on
         (config lives here, not in an execute-time modal). Shown only for a
         live API source (App passes `analytics` undefined otherwise). */}
      {analytics && <AnalyticsArchiveSection {...analytics} />}

      {/* ── Requires your acknowledgement (consolidated) ──
         Single section, just above Continue (AGENTS.md Principle 4: the
         acknowledgement block is the last thing before the gate it controls).
         Everything that needs a forced acknowledgement lives ONLY here — never
         duplicated in the resource list above:
           1. Capability-gated groups (entitlement missing) + the D1 group,
              relocated from the resource list via `ackGroups` ("include them
              anyway" / manual schema+data acknowledgements).
           2. Pre-migration action cards (missing-storage-deps,
              enterprise-plan-settings, …) that require a caveat acknowledgement.
           3. Out-of-scope IMPOSSIBLE_TO_MIGRATE items (actionable ones gate
              Continue; informational ones are disclosure-only — see
              OutOfScopePanel / AGENTS.md Principle 1 & 4).
         These remain forced (they still gate Continue) — this only relocates
         where they render; Principle 3 is unchanged. */}
      {(ackGroups.length > 0 || preMigrationActions.length > 0 || (canShowFixItPanel && impossibleResources.length > 0)) && (
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-gray-100">Requires your acknowledgement</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              These items need a decision before you can continue: features the
              destination can&apos;t migrate as-is, resources that need manual
              data steps, and items that won&apos;t migrate automatically.
              Acknowledge or resolve each one below.
            </p>
          </div>

          {/* Capability-gated + D1 groups relocated from the resource list. */}
          {ackGroups.map((group) => (
            <CollapsibleGroup
              key={group.key}
              group={group}
              selected={selections[group.key] || {}}
              onToggleAll={handleToggleAll}
              onToggleItem={handleToggleItem}
              defaultExpanded={false}
              doConfigs={group.key === 'durableObjects' ? doConfigs : undefined}
              setDoConfigs={group.key === 'durableObjects' ? setDoConfigs : undefined}
              r2Credentials={group.key === 'r2Buckets' && !isPreset ? r2Credentials : undefined}
              setR2Credentials={group.key === 'r2Buckets' && !isPreset ? setR2Credentials : undefined}
              sourceAccountId={exportData?.sourceAccountId || exportData?.zone?.account?.id}
              sourceZoneName={exportData?.zone?.name}
              destAccountId={destAccountId}
              acknowledgments={acknowledgments}
              setAcknowledgments={setAcknowledgments}
              showToast={showToast}
              identicalSet={identicalSet}
            />
          ))}

          {/* Pre-migration action cards (manual-action caveat acknowledgements). */}
          {preMigrationActions.map((action) => (
            <PreMigrationActionCard
              key={action.id}
              action={action}
              acknowledged={!!acknowledged[action.id]}
              onAcknowledge={handleAcknowledge}
              onDeselect={handleDeselectAction}
            />
          ))}

          {/* Out-of-scope IMPOSSIBLE_TO_MIGRATE items (actionable gate Continue;
              informational are disclosure-only). */}
          {canShowFixItPanel && impossibleResources.length > 0 && (
            <OutOfScopePanel
              resources={impossibleResources}
              acknowledgments={acknowledgments}
              setAcknowledgments={setAcknowledgments!}
              exportData={exportData}
              workerSecrets={workerSecrets!}
              setWorkerSecrets={setWorkerSecrets!}
              certificates={certificates!}
              setCertificates={setCertificates!}
              originCaCsrs={originCaCsrs!}
              setOriginCaCsrs={setOriginCaCsrs!}
              notificationWebhookSecrets={notificationWebhookSecrets!}
              setNotificationWebhookSecrets={setNotificationWebhookSecrets!}
              identityProviderSecrets={identityProviderSecrets!}
              setIdentityProviderSecrets={setIdentityProviderSecrets!}
              aopMtlsBundles={aopMtlsBundles!}
              setAopMtlsBundles={setAopMtlsBundles!}
              aiGatewayProviderApiKeys={aiGatewayProviderApiKeys!}
              setAiGatewayProviderApiKeys={setAiGatewayProviderApiKeys!}
            />
          )}
        </div>
      )}

      {/* Required manual post-migration work — disclosure only (no gate).
          The user performs these AFTER the destination zone exists, so they
          are not pre-acknowledged here (Principle 4). Reused in Step 3; the
          authoritative list appears on Step 4 via report.manualActions. */}
      <PostMigrationWorkPanel items={postMigrationManualResources} />

      {/* Navigation / Primary Action */}
      <div className="space-y-3 pt-4 border-t border-gray-700">
        {emailBlocked && (
          <div className="text-xs font-bold text-red-400 text-center">
            ⏸ Cannot continue: {unresolvedEmailAddresses.length} email forwarding address
            {unresolvedEmailAddresses.length === 1 ? '' : 'es'} still need
            {unresolvedEmailAddresses.length === 1 ? 's' : ''} verification or skip
            (see card above)
          </div>
        )}
        {outOfScopeBlocked && (
          <div className="text-xs font-bold text-red-400 text-center">
            ⏸ Cannot continue: {unresolvedActionableCount} actionable
            item{unresolvedActionableCount === 1 ? '' : 's'}
            {' '}still need{unresolvedActionableCount === 1 ? 's' : ''} attention
            - fix inline or check &quot;Skip and acknowledge&quot;
            (see &quot;Will Not Migrate&quot; panel above)
          </div>
        )}
        {preMigrationActionsBlocked && (
          <div className="text-xs font-bold text-red-400 text-center">
            ⏸ Cannot continue: {unacknowledgedRequiredActions.length} manual-action
            item{unacknowledgedRequiredActions.length === 1 ? '' : 's'}
            {' '}still need{unacknowledgedRequiredActions.length === 1 ? 's' : ''} acknowledgement
            - tick the box, deselect the workers, or select the missing resources
            (see &quot;Requires Manual Action&quot; above)
          </div>
        )}
        {/* Destination confirmation — only when this step is the destructive
            apply point (requireDestConfirm). With the migration triggered from
            the Apply step, the Account/Zone steps pass requireDestConfirm=false
            and the confirmation renders on Apply instead (<DestinationConfirm>). */}
        {requireDestConfirm && (
        <div className="rounded-lg border border-gray-700 bg-gray-800/60 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Confirm destination
          </div>
          <div className="space-y-2 text-sm">
            {showAccountConfirm && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Confirm destination account"
                  checked={accountConfirmed}
                  onChange={(e) => setAccountConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-gray-600 bg-gray-900 text-orange-500 focus:ring-orange-500"
                />
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-gray-500 w-14 shrink-0">Account</span>
                  <span className="text-gray-100 font-medium break-all">
                    {destAccountName || <span className="text-gray-500 italic font-normal">unnamed account</span>}
                  </span>
                  {destAccountId && (
                    <span className="font-mono text-xs text-gray-400 break-all">{destAccountId}</span>
                  )}
                </span>
              </label>
            )}
            {showZoneConfirm && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Confirm destination zone"
                  checked={zoneConfirmed}
                  onChange={(e) => setZoneConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-gray-600 bg-gray-900 text-orange-500 focus:ring-orange-500"
                />
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-gray-500 w-14 shrink-0">Zone</span>
                  <span className="text-gray-100 font-medium break-all">
                    {zone?.name || <span className="text-gray-500 italic font-normal">unknown</span>}
                  </span>
                  {destZoneId && (
                    <span className="font-mono text-xs text-gray-400 break-all">{destZoneId}</span>
                  )}
                </span>
              </label>
            )}
          </div>
        </div>
        )}
        <button type="button"
          onClick={onNext}
          disabled={emailBlocked || outOfScopeBlocked || preMigrationActionsBlocked || !destConfirmed}
          className={`w-full py-3 rounded-lg font-semibold text-lg transition shadow-lg ${
            (emailBlocked || outOfScopeBlocked || preMigrationActionsBlocked || !destConfirmed)
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed shadow-none'
              : 'bg-orange-500 text-white hover:bg-orange-400 shadow-orange-500/25'
          }`}
        >
          {primaryLabel ?? 'Continue to Migration \u2192'}
        </button>
        {downloadScriptInputs && creds && (
          <div className="flex justify-end pt-1">
            <DownloadScriptButton
              creds={creds}
              sourceZoneId={downloadScriptInputs.sourceZoneId}
              sourceAccountId={downloadScriptInputs.sourceAccountId}
              destAccountId={downloadScriptInputs.destAccountId}
              domainName={downloadScriptInputs.domainName}
              disabled={emailBlocked || outOfScopeBlocked || preMigrationActionsBlocked}
            />
          </div>
        )}
      </div>
    </div>
  );
}
