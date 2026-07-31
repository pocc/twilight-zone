import { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '../lib/api';
import type { Credentials } from '../lib/api';
import type { OAuthRole } from '../lib/oauth';
import { routeOAuthReauthorization } from '../lib/request';

interface Blocker { type: string; message: string; details?: string; }

export function useBlockerCheck(
  credentials: Credentials,
  hasAuth: boolean,
  onReauthorizationRequired?: (role: OAuthRole) => void,
) {
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [warnings, setWarnings] = useState<Blocker[]>([]);
  const [checking, setChecking] = useState(false);
  const debounceRef = useRef<number>(0);
  const checkIdRef = useRef(0);

  const check = useCallback(async () => {
    const { sourceZoneId, sourceAccountId, destAccountId, domainName } = credentials;
    if (!sourceZoneId || !sourceAccountId || !destAccountId || !hasAuth) {
      setBlockers([]);
      setWarnings([]);
      return;
    }

    const checkId = ++checkIdRef.current;
    setChecking(true);
    try {
      const result = await api.checkBlockers(credentials, sourceZoneId, sourceAccountId, destAccountId, domainName || undefined);
      if (checkId !== checkIdRef.current) return; // stale
      // API returns a flat blockers array with type 'error' or 'warning' - split them
      const all = result.blockers || [];
      setBlockers(all.filter(b => b.type === 'error'));
      setWarnings(all.filter(b => b.type === 'warning'));
    } catch (error) {
      routeOAuthReauthorization(error, onReauthorizationRequired);
      if (checkId !== checkIdRef.current) return;
      setBlockers([]);
      setWarnings([]);
    } finally {
      if (checkId === checkIdRef.current) setChecking(false);
    }
  }, [
    credentials.sourceZoneId, credentials.sourceAccountId,
    credentials.destAccountId, credentials.domainName, hasAuth,
    credentials.authMode, credentials.useApiKey, credentials.apiKey, credentials.apiEmail, credentials.sourceToken,
    credentials.destApiKey, credentials.destApiEmail, credentials.destToken, onReauthorizationRequired,
  ]);

  // Clear stale results immediately when inputs change, then debounce the API call
  useEffect(() => {
    setBlockers([]);
    setWarnings([]);
    clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(check, 500);
    return () => window.clearTimeout(debounceRef.current);
  }, [check]);

  const hasBlockers = blockers.length > 0;

  return { blockers, warnings, checking, hasBlockers, check };
}
