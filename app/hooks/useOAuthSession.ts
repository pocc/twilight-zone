import { useCallback, useEffect, useState } from 'react';

import { clearOAuthNonce, OAuthNonceOwnershipError, type OAuthRole, type OAuthRoles } from '../lib/oauth';
import { browserJsonRequest } from '../lib/request';

const EMPTY_ROLES: OAuthRoles = {
  source: { connected: false },
  destination: { connected: false },
};

export function useOAuthSession() {
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState<string>();
  const [roles, setRoles] = useState<OAuthRoles>(EMPTY_ROLES);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const config = await browserJsonRequest<{ enabled: boolean; reason?: string }>(
        '/api/oauth/config', {}, { authMode: 'oauth' },
      );
      setEnabled(config.enabled);
      setReason(config.reason);
      if (!config.enabled) { setRoles(EMPTY_ROLES); return; }
      const status = await browserJsonRequest<{ roles: OAuthRoles }>(
        '/api/oauth/status', {}, { authMode: 'oauth' },
      );
      setRoles(status.roles);
    } catch (error) {
      if (error instanceof OAuthNonceOwnershipError) {
        setEnabled(false);
        setReason(error.message);
      }
      setRoles(EMPTY_ROLES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = useCallback(async (role: OAuthRole) => {
    const result = await browserJsonRequest<{ authorizationUrl: string }>(
      '/api/oauth/start', { role }, { authMode: 'oauth' },
    );
    window.location.assign(result.authorizationUrl);
  }, []);

  const clearRole = useCallback(async (role: OAuthRole) => {
    try {
      await browserJsonRequest('/api/oauth/clear', { role }, { authMode: 'oauth' });
    } finally {
      setRoles((current) => ({ ...current, [role]: { connected: false } }));
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await browserJsonRequest('/api/oauth/logout', {}, { authMode: 'oauth' });
    } finally {
      clearOAuthNonce();
      setRoles(EMPTY_ROLES);
    }
  }, []);

  return { enabled, reason, roles, loading, refresh, connect, clearRole, logout };
}
