import React from 'react';

import type { OAuthRole, OAuthRoleStatus } from '../lib/oauth';

export function OAuthRoleCard({
  role,
  status,
  enabled,
  disabledReason,
  onConnect,
  onClear,
}: {
  role: OAuthRole;
  status: OAuthRoleStatus;
  enabled: boolean;
  disabledReason?: string;
  onConnect: (role: OAuthRole) => void;
  onClear: (role: OAuthRole) => void;
}) {
  const title = role === 'source' ? 'Source authorization' : 'Destination authorization';
  return (
    <div className="rounded-lg border border-gray-600 bg-gray-700/50 p-3 space-y-2 min-w-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-200">{title}</div>
          {status.connected && status.expiresAt ? (
            <div className="text-xs text-green-400">
              Connected until {new Date(status.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          ) : (
            <div className="text-xs text-gray-400">Not connected</div>
          )}
        </div>
        {status.connected ? (
          <button type="button" onClick={() => onClear(role)} className="w-full sm:w-auto rounded-md bg-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-500">
            Disconnect
          </button>
        ) : (
          <button type="button" onClick={() => onConnect(role)} disabled={!enabled} className="w-full sm:w-auto rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-600 disabled:text-gray-400">
            Authorize {role}
          </button>
        )}
      </div>
      {status.scopes && status.scopes.length > 0 && (
        <p className="break-words text-xs text-gray-500">Scopes: {status.scopes.join(', ')}</p>
      )}
      {!enabled && disabledReason && <p className="text-xs text-yellow-400">OAuth unavailable: {disabledReason}. Manual authentication remains available.</p>}
    </div>
  );
}
