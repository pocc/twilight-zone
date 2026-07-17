import React, { useMemo, useState } from 'react';
import { WarningOctagon, CheckCircle, CaretDown } from '@phosphor-icons/react';
import {
  deriveItemState,
  type ApplicableImpossibleResource,
  type FixItState,
  type ItemResolutionState,
} from '../../lib/outOfScope';
import type { ImpossibleCategory, ZoneExport } from '../../../src/types';
import type { OriginCaCsrInput } from '../../lib/types';
import type { AopMtlsBundle } from '../OutOfScopePanel';
import { ActionableItemRow } from './ActionableItemRow';

/**
 * Human-readable metadata per category. The `consequence` field is the
 * *honest* description of what breaks if the user does NOT take the
 * required action - surfaced prominently for actionable categories so
 * the user understands they are accepting responsibility for a
 * known-broken outcome, not just clicking a polite "I read it" box.
 */
const ACTIONABLE_CATEGORY_META: Record<
  Extract<ImpossibleCategory, 'cryptographic' | 'account_tied' | 'data_offline' | 'manual_external'>,
  { label: string; consequence: string; color: string }
> = {
  cryptographic: {
    label: 'Secrets & Private Keys - you must re-supply',
    consequence:
      'Until you re-upload these values on the destination, workers will run with missing secrets, SSL will not terminate on custom certificates, and Access tokens will not authenticate. Auth and TLS WILL break.',
    color: 'text-purple-300',
  },
  account_tied: {
    label: 'Account-tied resources - must be re-provisioned on the destination',
    consequence:
      'These resources are bound to your source account. Workers with bindings pointing at them will deploy successfully but fail at runtime until you create equivalent resources on the destination account. Some require Cloudflare account-team involvement.',
    color: 'text-amber-300',
  },
  data_offline: {
    label: 'Bulk data - needs CLI tooling to copy',
    consequence:
      'Configuration migrates automatically but the actual data inside KV/R2/D1 does not. Until you copy the data, the destination will serve empty stores - applications reading from them will see missing data or 404s.',
    color: 'text-blue-300',
  },
  manual_external: {
    label: 'External actions - registrar / verification',
    consequence:
      'Requires action outside Cloudflare: update nameservers or DS records at your registrar, verify email forwarding destinations, complete SSL DCV. Until you do this, DNS will not resolve, mail will be dropped, or certificates will not issue.',
    color: 'text-orange-300',
  },
};

/* ────────────────────────────────────────────────────────────────── */
/* Actionable block - gated, must-resolve UX                          */
/*                                                                    */
/* Each item resolves to one of three states: 'fixed' (user supplied  */
/* values inline), 'acknowledged' (user toggled the skip checkbox),   */
/* or 'unresolved' (default; blocks Continue). State derivation is    */
/* pure (see deriveItemState in app/lib/outOfScope.ts).               */
/* ────────────────────────────────────────────────────────────────── */

interface ActionableBlockProps {
  items: ApplicableImpossibleResource[];
  acknowledgments: Set<string>;
  setAcknowledgments: React.Dispatch<React.SetStateAction<Set<string>>>;
  fixState: FixItState;
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

export function ActionableBlock({
  items,
  acknowledgments,
  setAcknowledgments,
  fixState,
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
}: ActionableBlockProps) {
  // Group actionable items by category in the sort order already
  // produced by detectApplicableImpossibleResources.
  const byCategory = useMemo(() => {
    const map = new Map<ImpossibleCategory, ApplicableImpossibleResource[]>();
    for (const r of items) {
      const existing = map.get(r.category);
      if (existing) existing.push(r);
      else map.set(r.category, [r]);
    }
    return map;
  }, [items]);

  // Per-item resolution state (memo'd so we don't recompute during
  // every per-row render).
  const stateByKey = useMemo(() => {
    const map = new Map<string, ItemResolutionState>();
    for (const item of items) {
      map.set(item.key, deriveItemState(item, fixState, acknowledgments));
    }
    return map;
  }, [items, fixState, acknowledgments]);

  const resolvedCount = useMemo(
    () => items.filter(r => stateByKey.get(r.key) !== 'unresolved').length,
    [items, stateByKey],
  );
  const allResolved = items.length > 0 && resolvedCount === items.length;
  const noneResolved = resolvedCount === 0;

  // When everything is resolved the loud "you must act" panel is just noise
  // and its height pushes the Continue button off-screen, hiding the next
  // step. Collapse to a compact green bar by default; the user can expand to
  // review or change any choice. While anything is unresolved the panel is
  // always fully shown (the user genuinely must act).
  const [showResolvedDetails, setShowResolvedDetails] = useState(false);
  const collapsed = allResolved && !showResolvedDetails;

  const toggle = (key: string): void => {
    setAcknowledgments(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /**
   * "Accept all" - acknowledge every actionable item that is not
   * already resolved. Items already 'fixed' don't need an ack;
   * items already 'acknowledged' stay so. Toggling when all are
   * resolved un-acks every item (so the user can revert) - but
   * note that 'fixed' items will stay fixed regardless because
   * their resolution comes from the supplied values, not the ack
   * set.
   */
  const toggleAll = (): void => {
    setAcknowledgments(prev => {
      const next = new Set(prev);
      if (allResolved) {
        // Un-ack everything; fixed items remain fixed but
        // acknowledged-only items revert to unresolved.
        for (const item of items) next.delete(item.key);
      } else {
        // Ack everything that isn't already fixed.
        for (const item of items) {
          if (stateByKey.get(item.key) !== 'fixed') next.add(item.key);
        }
      }
      return next;
    });
  };

  const toggleCategory = (category: ImpossibleCategory): void => {
    const catItems = byCategory.get(category) ?? [];
    const catResolved = catItems.every(r => stateByKey.get(r.key) !== 'unresolved');
    setAcknowledgments(prev => {
      const next = new Set(prev);
      if (catResolved) {
        for (const r of catItems) next.delete(r.key);
      } else {
        for (const r of catItems) {
          if (stateByKey.get(r.key) !== 'fixed') next.add(r.key);
        }
      }
      return next;
    });
  };

  return (
    <div
      className={`bg-gray-800 border-2 rounded-lg p-5 ${
        allResolved ? 'border-green-700/60' : 'border-amber-700'
      }`}
    >
      <div className="flex items-start gap-3 mb-3">
        {allResolved ? (
          <CheckCircle
            size={32}
            weight="fill"
            className="text-green-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
        ) : (
          <WarningOctagon
            size={32}
            weight="fill"
            className="text-amber-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
        )}
        <div className="flex-1">
          <h2 className={`text-lg font-bold ${allResolved ? 'text-green-100' : 'text-amber-100'}`}>
            {allResolved
              ? `Resolved \u2014 ${items.length} item${items.length === 1 ? '' : 's'} fixed or acknowledged`
              : `Will Not Migrate - You Must Act (${items.length})`}
          </h2>
          {allResolved ? (
            <p className="text-sm text-green-200/90 mt-1.5">
              Nothing else is required here.{' '}
              <strong>Scroll down and press Continue</strong> to proceed.{' '}
              <button
                type="button"
                onClick={() => setShowResolvedDetails(v => !v)}
                className="inline-flex items-center gap-1 text-green-300 hover:text-green-200 underline underline-offset-2"
              >
                {collapsed ? 'Review or change my choices' : 'Hide details'}
                <CaretDown
                  size={12}
                  weight="bold"
                  className={`transition-transform ${collapsed ? '' : 'rotate-180'}`}
                  aria-hidden="true"
                />
              </button>
            </p>
          ) : (
            <p className="text-sm text-amber-200/90 mt-1.5">
              The destination zone <strong>will be broken</strong> until you fix or
              acknowledge each item below. Where possible, supply the missing values inline
              and the migration tool will set them on the destination. Otherwise, check the
              &quot;Skip and acknowledge&quot; box to accept the broken outcome.
            </p>
          )}
        </div>
      </div>

      {!collapsed && (
      <>{/* full detail body — always shown while unresolved, optional once resolved */}

      {/* Master "resolve all unresolved" toggle */}
      <label
        className={`mb-4 pb-3 border-b flex items-center gap-3 cursor-pointer ${
          allResolved ? 'border-green-900/40' : 'border-amber-900/40'
        }`}
      >
        <input
          type="checkbox"
          checked={allResolved}
          ref={el => {
            if (el) el.indeterminate = !allResolved && !noneResolved;
          }}
          onChange={toggleAll}
          className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500 cursor-pointer"
        />
        <span className="text-sm font-medium text-gray-200">
          Skip and acknowledge all remaining items
        </span>
        <span className="ml-auto text-xs text-gray-400">
          {resolvedCount} / {items.length} resolved
        </span>
      </label>

      <div className="space-y-4">
        {[...byCategory.entries()].map(([category, catItems]) => {
          const meta = ACTIONABLE_CATEGORY_META[category as keyof typeof ACTIONABLE_CATEGORY_META];
          // Safety net - if somehow an unknown category is marked
          // actionable, render with a generic fallback rather than crash.
          if (!meta) return null;
          const catResolvedCount = catItems.filter(r => stateByKey.get(r.key) !== 'unresolved').length;
          const catAllResolved = catResolvedCount === catItems.length;
          const catSomeResolved = catResolvedCount > 0;

          return (
            <div key={category} className="rounded-md border border-amber-900/40 bg-gray-900/40 p-3">
              <div className="flex items-start gap-3 pb-2 mb-2 border-b border-amber-900/30">
                <input
                  type="checkbox"
                  checked={catAllResolved}
                  ref={el => {
                    if (el) el.indeterminate = !catAllResolved && catSomeResolved;
                  }}
                  onChange={() => toggleCategory(category)}
                  className="h-4 w-4 mt-0.5 rounded border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500 cursor-pointer"
                />
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${meta.color}`}>{meta.label}</div>
                  {catAllResolved ? (
                    <div className="text-xs text-green-300/80 mt-1 leading-relaxed">
                      Resolved — {catItems.length} item{catItems.length === 1 ? '' : 's'} in
                      this group fixed or acknowledged.
                    </div>
                  ) : (
                    <div className="text-xs text-amber-200/70 mt-1 leading-relaxed">
                      <span className="font-medium text-amber-300">Consequence if you do nothing:</span>{' '}
                      {meta.consequence}
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {catResolvedCount} / {catItems.length}
                </span>
              </div>

              <div className="space-y-3 pl-7">
                {catItems.map(item => (
                  <ActionableItemRow
                    key={item.key}
                    item={item}
                    state={stateByKey.get(item.key) ?? 'unresolved'}
                    onToggleAck={() => toggle(item.key)}
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
                ))}
              </div>
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
