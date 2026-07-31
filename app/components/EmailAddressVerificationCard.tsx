import React, { useState, useCallback, useMemo } from 'react';
import {
  CheckCircle, Envelope, MinusCircle, Spinner, EnvelopeSimple, Warning,
} from '@phosphor-icons/react';
import * as api from '../lib/api';
import type { Credentials } from '../lib/api';
import type { ZoneExport, CFEmailRoutingRule } from '../../src/types';
import { routeOAuthReauthorization } from '../lib/request';
import type { OAuthRole } from '../lib/oauth';

/**
 * Per-address verification state. Lives in App.tsx so it survives back-nav.
 *
 *   unverified - initial state, address exists in source rules but not yet
 *                verified on dest account. User must Send or Skip.
 *   sending    - verification email POST in flight.
 *   sent       - verification email sent; waiting for user to click the link.
 *                Status changes to `verified` when "Check status" returns true.
 *   checking   - currently polling status.
 *   verified   - confirmed verified on dest account. Address can be used.
 *   skipped    - user explicitly chose to skip. Rules using this address will
 *                be acknowledged at migrate time (not failed, not silently
 *                missing).
 *   error      - API error during send or check. User can retry.
 */
export type EmailAddressStatus =
  | 'unverified'
  | 'sending'
  | 'sent'
  | 'checking'
  | 'verified'
  | 'skipped'
  | 'error';

export interface EmailAddressState {
  email: string;
  status: EmailAddressStatus;
  /** Last error message if status is 'error'. */
  error?: string;
  /** Number of rules in the export that forward to this address. Informational. */
  ruleCount: number;
}

interface Props {
  /** All forward-target addresses extracted from source rules, keyed by lowercased email. */
  states: Record<string, EmailAddressState>;
  setStates: React.Dispatch<React.SetStateAction<Record<string, EmailAddressState>>>;
  creds: Partial<Credentials>;
  destAccountId: string;
  destAccountName?: string;
  onReauthorizationRequired?: (role: OAuthRole) => void;
}

export function EmailAddressVerificationCard({ states, setStates, creds, destAccountId, destAccountName, onReauthorizationRequired }: Props) {
  const entries = useMemo(() => Object.values(states), [states]);
  const blocking = useMemo(
    () => entries.filter(e => e.status !== 'verified' && e.status !== 'skipped'),
    [entries],
  );

  if (entries.length === 0) return null;

  const allResolved = blocking.length === 0;

  return (
    <div className={`rounded-lg border p-4 ${allResolved ? 'border-green-700/50 bg-green-900/10' : 'border-amber-700/50 bg-amber-900/10'}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`mt-0.5 ${allResolved ? 'text-green-400' : 'text-amber-400'}`}>
          {allResolved
            ? <CheckCircle size={28} weight="fill" aria-hidden="true" />
            : <Envelope size={28} weight="fill" aria-hidden="true" />}
        </div>
        <div className="flex-1">
          <div className={`text-sm font-semibold ${allResolved ? 'text-green-300' : 'text-amber-300'}`}>
            {allResolved
              ? 'Email forwarding addresses ready'
              : `${blocking.length} email forwarding address${blocking.length === 1 ? '' : 'es'} need attention`}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Email Routing rules forward to addresses that must be verified on the destination account
            {destAccountName ? ` (${destAccountName})` : ''} before delivery works.
            Verification happens by clicking a link sent to each address. You can{' '}
            <strong className="text-gray-200">verify</strong> each address now or{' '}
            <strong className="text-gray-200">skip</strong>, in which case rules using that address
            will be acknowledged but not migrated.
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {entries.map(state => (
          <AddressRow
            key={state.email.toLowerCase()}
            state={state}
            creds={creds}
            destAccountId={destAccountId}
            setStates={setStates}
            onReauthorizationRequired={onReauthorizationRequired}
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  state: EmailAddressState;
  creds: Partial<Credentials>;
  destAccountId: string;
  setStates: React.Dispatch<React.SetStateAction<Record<string, EmailAddressState>>>;
  onReauthorizationRequired?: (role: OAuthRole) => void;
}

function AddressRow({ state, creds, destAccountId, setStates, onReauthorizationRequired }: RowProps) {
  const update = useCallback(
    (patch: Partial<EmailAddressState>) => {
      setStates(prev => ({
        ...prev,
        [state.email.toLowerCase()]: { ...prev[state.email.toLowerCase()], ...patch },
      }));
    },
    [setStates, state.email],
  );

  const send = useCallback(async () => {
    update({ status: 'sending', error: undefined });
    try {
      const r = await api.sendEmailRoutingVerification(creds, destAccountId, state.email);
      if (r.verified) {
        update({ status: 'verified' });
      } else {
        update({ status: 'sent' });
      }
    } catch (e) {
      if (routeOAuthReauthorization(e, onReauthorizationRequired)) {
        update({ status: 'unverified' });
        return;
      }
      update({ status: 'error', error: (e as Error).message });
    }
  }, [creds, destAccountId, state.email, update, onReauthorizationRequired]);

  const check = useCallback(async () => {
    update({ status: 'checking', error: undefined });
    try {
      const r = await api.checkEmailRoutingVerification(creds, destAccountId, state.email);
      if (r.verified) {
        update({ status: 'verified' });
      } else {
        update({ status: 'sent' });
      }
    } catch (e) {
      if (routeOAuthReauthorization(e, onReauthorizationRequired)) {
        update({ status: 'sent' });
        return;
      }
      update({ status: 'error', error: (e as Error).message });
    }
  }, [creds, destAccountId, state.email, update, onReauthorizationRequired]);

  const skip = useCallback(() => {
    update({ status: 'skipped', error: undefined });
  }, [update]);

  const unskip = useCallback(() => {
    update({ status: 'unverified', error: undefined });
  }, [update]);

  const isBusy = state.status === 'sending' || state.status === 'checking';

  // Badge: icon + label pair. Icons match the StatusIcon palette where
  // applicable; sending/checking use a spinner so screen-reader users
  // hear "sending" while sighted users see motion.
  const badge = (() => {
    switch (state.status) {
      case 'verified': return {
        text: 'verified',
        icon: <CheckCircle size={12} weight="fill" aria-hidden="true" />,
        cls: 'text-green-400 bg-green-900/30',
      };
      case 'skipped': return {
        text: 'skipped',
        icon: <MinusCircle size={12} weight="fill" aria-hidden="true" />,
        cls: 'text-gray-400 bg-gray-700/30',
      };
      case 'sending': return {
        text: 'sending…',
        icon: <Spinner size={12} className="animate-spin" aria-hidden="true" />,
        cls: 'text-blue-400 bg-blue-900/30',
      };
      case 'sent': return {
        text: 'awaiting click',
        icon: <EnvelopeSimple size={12} weight="fill" aria-hidden="true" />,
        cls: 'text-amber-400 bg-amber-900/30',
      };
      case 'checking': return {
        text: 'checking…',
        icon: <Spinner size={12} className="animate-spin" aria-hidden="true" />,
        cls: 'text-blue-400 bg-blue-900/30',
      };
      case 'error': return {
        text: 'error',
        icon: <Warning size={12} weight="fill" aria-hidden="true" />,
        cls: 'text-red-400 bg-red-900/30',
      };
      default: return {
        text: 'not verified',
        icon: null,
        cls: 'text-amber-400 bg-amber-900/30',
      };
    }
  })();

  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-md px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-sm text-gray-200 truncate">{state.email}</code>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${badge.cls}`}>
              {badge.icon}
              {badge.text}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Used by {state.ruleCount} rule{state.ruleCount === 1 ? '' : 's'}
          </div>
          {state.error && (
            <div className="text-xs text-red-400 mt-1">{state.error}</div>
          )}
          {state.status === 'sent' && (
            <div className="text-xs text-amber-300/80 mt-1">
              Check the inbox at <code>{state.email}</code> and click the verification link.
              Then click <strong>Check status</strong> below.
            </div>
          )}
          {state.status === 'skipped' && (
            <div className="text-xs text-gray-400 mt-1">
              {state.ruleCount} rule{state.ruleCount === 1 ? '' : 's'} forwarding to this address will be
              acknowledged at migrate time (not migrated).
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {state.status === 'skipped' ? (
            <button type="button"
              onClick={unskip}
              className="text-xs px-3 py-1 rounded border border-gray-600 text-gray-300 hover:bg-gray-700 cursor-pointer"
            >
              Unskip
            </button>
          ) : state.status === 'verified' ? null : (
            <>
              {(state.status === 'unverified' || state.status === 'error') && (
                <button type="button"
                  onClick={send}
                  disabled={isBusy}
                  className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  Send verification email
                </button>
              )}
              {(state.status === 'sent' || state.status === 'sending') && (
                <button type="button"
                  onClick={check}
                  disabled={isBusy}
                  className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  Check status
                </button>
              )}
              <button type="button"
                onClick={skip}
                disabled={isBusy}
                className="text-xs px-3 py-1 rounded border border-gray-600 text-gray-400 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Skip
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Extract the set of forward-target email addresses from the export data,
 * along with the rule count for each. Catch-all rules with `forward` actions
 * are included; `drop` and `worker` actions are NOT (those don't need
 * destination address verification).
 */
export function extractForwardAddresses(exportData: ZoneExport): Map<string, number> {
  const counts = new Map<string, number>();
  const rules: CFEmailRoutingRule[] = Array.isArray(exportData?.emailRoutingRules) ? exportData.emailRoutingRules : [];
  for (const rule of rules) {
    if (!Array.isArray(rule.actions)) continue;
    for (const action of rule.actions) {
      if (action.type !== 'forward') continue;
      const values: string[] = Array.isArray(action.value) ? action.value : [];
      for (const raw of values) {
        const email = String(raw).toLowerCase().trim();
        if (!email) continue;
        counts.set(email, (counts.get(email) || 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Reconcile per-address state with (a) the addresses extracted from the
 * current export and (b) the dest account's known verified-address list.
 * Adds missing entries (defaulting to 'verified' if already verified on dest,
 * else 'unverified') and removes stale entries no longer in the export.
 */
export function reconcileEmailAddressStates(
  current: Record<string, EmailAddressState>,
  exportData: ZoneExport,
  knownAddresses: { email: string; verified: boolean }[] | undefined,
): Record<string, EmailAddressState> {
  const wanted = extractForwardAddresses(exportData);
  const verifiedSet = new Set(
    (knownAddresses || []).filter(a => a.verified).map(a => a.email.toLowerCase()),
  );
  const next: Record<string, EmailAddressState> = {};
  for (const [email, ruleCount] of wanted.entries()) {
    const existing = current[email];
    if (existing) {
      // Preserve user-driven state (skipped, sent, error). But if dest has
      // since reported the address as verified, upgrade silently.
      if (existing.status !== 'verified' && verifiedSet.has(email)) {
        next[email] = { ...existing, status: 'verified', ruleCount };
      } else {
        next[email] = { ...existing, ruleCount };
      }
      continue;
    }
    next[email] = {
      email,
      ruleCount,
      status: verifiedSet.has(email) ? 'verified' : 'unverified',
    };
  }
  return next;
}
