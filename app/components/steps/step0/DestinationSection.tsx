import React from 'react';

interface Account { id: string; name: string; }

interface DestinationSectionProps {
  /** Auth UI differs by flow (migration: "same as source"/dest fields; preset:
   *  primary auth toggle + fields), so the parent passes it as a slot. The
   *  shared structure below (account + zone + License + conflict) is identical. */
  authSlot: React.ReactNode;
  accounts: Account[];
  accountsLoading: boolean;
  accountsError?: string | null;
  accountId: string;
  onAccountChange: (accountId: string) => void;
  accountInputId: string;
  accountLabel?: string;
  zoneName: string;
  onZoneChange: (zoneName: string) => void;
  zoneInputId: string;
  zonePlaceholder?: string;
  zoneDisabled?: boolean;
  /** Shared License selector (Free/Pro/Business/Enterprise). */
  license: React.ReactNode;
  /** Optional notice rendered under the zone field (e.g. preset zone-resolution
   *  feedback). */
  belowZone?: React.ReactNode;
  /** Conflict (Skip/Overwrite) toggle — already gated by the caller. */
  conflict?: React.ReactNode;
}

const FIELD_CLASS =
  'w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * The shared Destination/target section used by every flow — API/JSON/Terraform
 * migrations and the MaxConfig/MinConfig presets. It owns the account + zone +
 * License + conflict layout; only the credential entry differs per flow and is
 * supplied via `authSlot`.
 */
export function DestinationSection({
  authSlot,
  accounts,
  accountsLoading,
  accountsError,
  accountId,
  onAccountChange,
  accountInputId,
  accountLabel = 'Destination Account',
  zoneName,
  onZoneChange,
  zoneInputId,
  zonePlaceholder = 'example.com',
  zoneDisabled = false,
  license,
  belowZone,
  conflict,
}: DestinationSectionProps) {
  return (
    <div className="bg-gray-800 rounded-lg p-5">
      <label className="block text-xs text-gray-400 mb-3 uppercase tracking-wide font-medium">Destination</label>

      <div className="space-y-4">
        {authSlot}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={accountInputId} className="block text-xs text-gray-400 mb-1">{accountLabel}</label>
            <select
              id={accountInputId}
              value={accountId}
              onChange={(e) => onAccountChange(e.target.value)}
              disabled={accountsLoading || accounts.length === 0}
              className={FIELD_CLASS}
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
            <label htmlFor={zoneInputId} className="block text-xs text-gray-400 mb-1">Zone</label>
            <input
              id={zoneInputId}
              type="text"
              value={zoneName}
              onChange={(e) => onZoneChange(e.target.value)}
              placeholder={zonePlaceholder}
              disabled={zoneDisabled}
              className={FIELD_CLASS}
            />
          </div>
        </div>

        {belowZone}

        {license}

        {conflict}

        {accountsError && !accountsLoading && (
          <p className="mt-2 text-xs text-red-400">{accountsError}</p>
        )}
      </div>
    </div>
  );
}
