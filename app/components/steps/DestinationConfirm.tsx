/**
 * Destination confirmation — the user must explicitly tick the destination
 * they're writing to before the (destructive) Apply action enables.
 *
 * Lives on the Apply step (adjacent to the destructive "Run migration" /
 * "Apply preset" button) for both the normal-migration and preset flows. It
 * used to live inside `ScopeReview`, but with the migration now triggered from
 * the Apply step the confirmation belongs next to the action it gates, not on
 * the earlier select-only steps.
 */
export interface DestinationConfirmProps {
  showAccount?: boolean;
  showZone?: boolean;
  accountName?: string;
  accountId?: string;
  zoneName?: string;
  zoneId?: string;
  accountConfirmed: boolean;
  setAccountConfirmed: (v: boolean) => void;
  zoneConfirmed: boolean;
  setZoneConfirmed: (v: boolean) => void;
}

export function DestinationConfirm({
  showAccount = true,
  showZone = true,
  accountName,
  accountId,
  zoneName,
  zoneId,
  accountConfirmed,
  setAccountConfirmed,
  zoneConfirmed,
  setZoneConfirmed,
}: DestinationConfirmProps) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
        Confirm destination
      </div>
      <div className="space-y-2 text-sm">
        {showAccount && (
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
                {accountName || <span className="text-gray-500 italic font-normal">unnamed account</span>}
              </span>
              {accountId && (
                <span className="font-mono text-xs text-gray-400 break-all">{accountId}</span>
              )}
            </span>
          </label>
        )}
        {showZone && (
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
                {zoneName || <span className="text-gray-500 italic font-normal">unknown</span>}
              </span>
              {zoneId && (
                <span className="font-mono text-xs text-gray-400 break-all">{zoneId}</span>
              )}
            </span>
          </label>
        )}
      </div>
    </div>
  );
}
