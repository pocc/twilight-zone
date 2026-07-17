import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../lib/api';
import type { Credentials } from '../lib/api';

interface Account { id: string; name: string; }
interface Zone { id: string; name: string; status: string; }

/**
 * Loads the account list (and per-account zone list) for one credential
 * context. Instantiated twice in App:
 *   - 'source' (default): authenticates with the source credentials. Drives the
 *     API-source account/zone dropdowns.
 *   - 'dest': authenticates with the destination credentials (which fall back to
 *     the primary ones — see destAuthBody). Drives the destination account
 *     dropdown for migrations AND the JSON/Terraform/preset target, whose only
 *     meaningful credentials ARE the destination's. This is why the dest dropdown
 *     no longer mis-reads the source auth.
 */
export function useAccounts(
  credentials: Credentials,
  hasAuth: boolean,
  authMode: api.AuthMode = 'source',
) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const debounceRef = useRef<number>(0);

  // The account this context auto-loads zones for after the account list
  // arrives (e.g. restored from localStorage on page load).
  const selfAccountId = authMode === 'dest' ? credentials.destAccountId : credentials.sourceAccountId;

  // Auto-load accounts when credentials change
  const loadAccounts = useCallback(async () => {
    if (!hasAuth) return;
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const result = await api.listAccounts(credentials, authMode);
      setAccounts(result.accounts || []);
    } catch (err) {
      setAccountsError((err as Error).message);
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
    // The auth fields that matter differ per mode, but listing the union keeps
    // the dependency array stable and re-fires whenever any relevant cred edits.
  }, [
    credentials.useApiKey, credentials.apiKey, credentials.apiEmail, credentials.sourceToken,
    credentials.destApiKey, credentials.destApiEmail, credentials.destToken,
    authMode, hasAuth,
  ]);

  // Debounced auto-load
  useEffect(() => {
    if (!hasAuth) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(loadAccounts, 500);
    return () => window.clearTimeout(debounceRef.current);
  }, [loadAccounts, hasAuth]);

  // Load zones for a specific account
  const loadZones = useCallback(async (accountId: string) => {
    if (!accountId || !hasAuth) { setZones([]); return; }
    setZonesLoading(true);
    try {
      const result = await api.listZones(credentials, accountId, authMode);
      setZones(result.zones || []);
    } catch {
      setZones([]);
    } finally {
      setZonesLoading(false);
    }
  }, [
    credentials.useApiKey, credentials.apiKey, credentials.apiEmail, credentials.sourceToken,
    credentials.destApiKey, credentials.destApiEmail, credentials.destToken,
    authMode, hasAuth,
  ]);

  // Auto-load zones when accounts finish loading and this context's account is
  // already set (e.g. restored from localStorage on page load).
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (!accountsLoading && accounts.length > 0 && selfAccountId && zones.length === 0) {
      autoLoadedRef.current = true;
      loadZones(selfAccountId);
    }
  }, [accountsLoading, accounts, selfAccountId, zones.length, loadZones]);

  return {
    accounts, accountsLoading, accountsError,
    zones, zonesLoading,
    loadAccounts, loadZones,
  };
}
