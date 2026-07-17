import React from 'react';
import type { ApplicableImpossibleResource, ItemResolutionState } from '../../lib/outOfScope';
import type { ZoneExport } from '../../../src/types';
import type { OriginCaCsrInput } from '../../lib/types';
import type { AopMtlsBundle } from '../OutOfScopePanel';
import { StateBadge } from './StateBadge';
import { InlineFixItForm } from './InlineFixItForm';

/* ────────────────────────────────────────────────────────────────── */
/* Per-item row inside the actionable block. Handles state badge,     */
/* inline fix-it form (when applicable), and the "skip and            */
/* acknowledge" toggle.                                               */
/* ────────────────────────────────────────────────────────────────── */

interface ActionableItemRowProps {
  item: ApplicableImpossibleResource;
  state: ItemResolutionState;
  onToggleAck: () => void;
  exportData: ZoneExport;
  workerSecrets: Record<string, Record<string, string>>;
  setWorkerSecrets: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  certificates: Array<{ cert: string; key: string }>;
  setCertificates: React.Dispatch<React.SetStateAction<Array<{ cert: string; key: string }>>>;
  originCaCsrs: OriginCaCsrInput[];
  setOriginCaCsrs: React.Dispatch<React.SetStateAction<OriginCaCsrInput[]>>;
  notificationWebhookSecrets: Record<string, string>;
  setNotificationWebhookSecrets: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  identityProviderSecrets: Record<string, string>;
  setIdentityProviderSecrets: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  aopMtlsBundles: AopMtlsBundle[];
  setAopMtlsBundles: React.Dispatch<React.SetStateAction<AopMtlsBundle[]>>;
  aiGatewayProviderApiKeys: Record<string, string>;
  setAiGatewayProviderApiKeys: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function ActionableItemRow({
  item,
  state,
  onToggleAck,
  exportData,
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
}: ActionableItemRowProps) {
  // Invariant: this block only renders actionable items that HAVE an inline
  // fix-it form — the OutOfScopePanel split (actionable && hasInlineFixIt)
  // guarantees it. Actionable items the user performs after zone creation
  // (no fix-it form) live in PostMigrationWorkPanel instead, so the former
  // `!hasFix` branches here were dead and have been removed.
  const isAcked = state === 'acknowledged';
  const isFixed = state === 'fixed';

  // Background tint mirrors the state - fixed = green-ish, acked =
  // amber-ish, unresolved = no tint.
  const bgClass = isFixed
    ? 'bg-emerald-950/20'
    : isAcked
      ? 'bg-amber-950/30'
      : '';

  return (
    <div className={`rounded p-2 transition ${bgClass}`}>
      <div className="flex items-start gap-2">
        <StateBadge state={state} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-gray-200 truncate">
              {item.name}
            </span>
            {item.count !== undefined && (
              <span className="text-xs text-gray-500 flex-shrink-0">
                ({item.count})
              </span>
            )}
          </div>
          {item.triggerReason && (
            <div className="text-xs text-gray-400 mt-0.5">{item.triggerReason}</div>
          )}
          <div className="text-xs text-gray-500 mt-1">{item.reason}</div>
          {item.docsUrl && (
            <a
              href={item.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block"
            >
              Cloudflare docs →
            </a>
          )}
        </div>
      </div>

      {/* Inline fix-it form. The form remains interactive even after
          acknowledgment so the user can change their mind - typing a value
          flips the state back to 'fixed' regardless of the ack box. */}
      <div className="mt-3 pl-6">
        <InlineFixItForm
          itemKey={item.key}
          exportData={exportData}
          workerSecrets={workerSecrets}
          setWorkerSecrets={setWorkerSecrets}
          certificates={certificates}
          setCertificates={setCertificates}
          originCaCsrs={originCaCsrs}
          setOriginCaCsrs={setOriginCaCsrs}
          notificationWebhookSecrets={notificationWebhookSecrets}
          setNotificationWebhookSecrets={setNotificationWebhookSecrets}
          identityProviderSecrets={identityProviderSecrets}
          setIdentityProviderSecrets={setIdentityProviderSecrets}
          aopMtlsBundles={aopMtlsBundles}
          setAopMtlsBundles={setAopMtlsBundles}
          aiGatewayProviderApiKeys={aiGatewayProviderApiKeys}
          setAiGatewayProviderApiKeys={setAiGatewayProviderApiKeys}
        />
      </div>

      {/* "Skip the fix" toggle. Functions as "I'll handle this out of band"
          - explicitly opting out of the inline form. Disabled (visually)
          when the item is already 'fixed' because the ack no longer has any
          effect; the migration will use the supplied values. */}
      <label
        className={`mt-2 flex items-center gap-2 text-xs cursor-pointer select-none ${
          isFixed ? 'opacity-60' : ''
        }`}
      >
        <input
          type="checkbox"
          checked={isAcked}
          onChange={onToggleAck}
          className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500 cursor-pointer"
        />
        <span className="text-gray-400">
          {"Skip the fix above; I'll handle this outside the tool"}
        </span>
        {isFixed && (
          <span className="text-emerald-400/70 italic">
            (already fixed; ack is ignored)
          </span>
        )}
      </label>
    </div>
  );
}
