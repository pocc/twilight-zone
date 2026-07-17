/**
 * Inline fix-it form for the `worker_secrets` IMPOSSIBLE_TO_MIGRATE
 * entry.
 *
 * Worker secrets are write-only in the Cloudflare API - the source
 * account doesn't expose their values, so the migrator cannot copy
 * them. The user must either supply the values here (the destination
 * worker gets the same secret name → value pairs at deploy time) or
 * acknowledge that the workers will deploy with missing secrets and
 * fix the values out-of-band via `wrangler secret put`.
 *
 * Mounted inline in Step 2 (OutOfScopePanel.tsx) below the panel row
 * for the worker_secrets item, so the user can fix the issue as soon
 * as they see it. Per AGENTS.md Principle 4 (Never Ask the User to
 * Acknowledge Things They Cannot Change): when there's a textbox-shaped
 * fix available, surface it instead of forcing a content-free
 * acknowledgment click.
 *
 * State (`workerSecrets`) lives at the wizard root in App.tsx and
 * persists across navigation.
 */

import React from 'react';
import type { CFWorkerScript, CFWorkerBinding } from '../../../src/types';

interface WorkerSecretsFixProps {
  /** Workers from the source export. Only those with secret_text
   * bindings are rendered. */
  workers: CFWorkerScript[];
  /** workerSecrets[workerName][secretName] = user-supplied value. */
  workerSecrets: Record<string, Record<string, string>>;
  /** State setter. */
  setWorkerSecrets: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
}

export function WorkerSecretsFix({
  workers,
  workerSecrets,
  setWorkerSecrets,
}: WorkerSecretsFixProps) {
  // Distil to {workerName, secretNames[]} rows; skip workers without
  // any secret_text bindings.
  const rows = workers
    .filter((w: CFWorkerScript) => w.bindings?.some((b: CFWorkerBinding) => b.type === 'secret_text'))
    .map((w: CFWorkerScript) => ({
      name: w.id,
      secrets: (w.bindings ?? [])
        .filter((b: CFWorkerBinding) => b.type === 'secret_text')
        .map((b: CFWorkerBinding) => b.name),
    }));

  if (rows.length === 0) return null;

  function updateSecret(workerName: string, secretName: string, value: string) {
    setWorkerSecrets((prev) => ({
      ...prev,
      [workerName]: {
        ...(prev[workerName] || {}),
        [secretName]: value,
      },
    }));
  }

  // Tight card to fit inside the OutOfScopePanel item row.
  const cardClass = 'bg-gray-800/60 border border-gray-700 rounded-md p-3';

  return (
    <div className="space-y-4">
      {rows.map((worker) => (
        <div key={worker.name} className={cardClass}>
          <h4 className="text-sm font-medium text-gray-200 mb-3">{worker.name}</h4>
          <div className="space-y-2">
            {worker.secrets.map((secretName) => (
              <div key={secretName} className="flex items-center gap-3">
                <label className="w-36 text-sm text-gray-400 truncate" title={secretName}>
                  {secretName}
                </label>
                <form className="contents" onSubmit={(e) => e.preventDefault()}>
                <input
                  type="password"
                  value={workerSecrets[worker.name]?.[secretName] || ''}
                  onChange={(e) => updateSecret(worker.name, secretName, e.target.value)}
                  className="flex-1 bg-gray-600 border border-gray-500 rounded px-3 py-1.5 text-sm text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                  placeholder="Enter secret value"
                  autoComplete="new-password"
                />
                </form>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
