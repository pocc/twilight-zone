import { useState } from 'react';
import type { ZoneExport } from '../../../src/types';
import type { AccountCapabilities } from '../../lib/api';
import { PlanSummary } from './PlanSummary';
import { DestinationConfirm } from './DestinationConfirm';
import type { ConflictStrategy, DOConfig, D1Config } from './scope/groups';

interface PresetApplyStepProps {
  exportData: ZoneExport;
  selections: Record<string, Record<string, boolean>>;
  capabilities?: AccountCapabilities | null;
  existingTurnstileWidgets?: string[];
  doConfigs?: Record<string, DOConfig>;
  d1Configs?: Record<string, D1Config>;
  conflictStrategy?: ConflictStrategy;
  /** For presets the source IS the destination, so this is the source account. */
  destAccountName?: string;
  destAccountId?: string;
  /** Destination zone tag (known for presets — source is the destination). */
  destZoneId?: string;
  /** "Apply MaxConfig →" / "Apply MinConfig →". */
  primaryLabel: string;
  onApply: () => void;
}

/**
 * Preset (MaxConfig/MinConfig) Apply step. Presets aren't migrations — they
 * slam a canned config onto one zone — but the user already reviewed the
 * account- and zone-scoped changes on steps 1 and 2, so re-rendering the full
 * selectable ScopeReview here was redundant. This shows the collapsed read-only
 * Review Plan, a destination confirmation, and the apply button.
 */
export function PresetApplyStep({
  exportData,
  selections,
  capabilities,
  existingTurnstileWidgets,
  doConfigs,
  d1Configs,
  conflictStrategy,
  destAccountName,
  destAccountId,
  destZoneId,
  primaryLabel,
  onApply,
}: PresetApplyStepProps) {
  const [accountConfirmed, setAccountConfirmed] = useState(false);
  const [zoneConfirmed, setZoneConfirmed] = useState(false);
  const destConfirmed = accountConfirmed && zoneConfirmed;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-100 pt-2">Apply &mdash; review &amp; apply the preset</h2>
        <p className="text-sm text-gray-400">
          You&apos;ve already reviewed the account- and zone-scoped changes.
          Expand the plan to re-check it, confirm the target, then apply. This
          overwrites the target zone&apos;s configuration.
        </p>
      </div>

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

      <DestinationConfirm
        showAccount
        showZone
        accountName={destAccountName}
        accountId={destAccountId}
        zoneName={exportData?.zone?.name}
        zoneId={destZoneId}
        accountConfirmed={accountConfirmed}
        setAccountConfirmed={setAccountConfirmed}
        zoneConfirmed={zoneConfirmed}
        setZoneConfirmed={setZoneConfirmed}
      />

      {/* Back-nav is handled by the header breadcrumb step pills. */}
      <div className="flex items-center justify-end pt-2 border-t border-gray-700">
        <button
          type="button"
          onClick={onApply}
          disabled={!destConfirmed}
          className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition shadow-lg ${
            destConfirmed
              ? 'bg-orange-500 hover:bg-orange-400 text-white shadow-orange-500/25'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed shadow-none'
          }`}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}
