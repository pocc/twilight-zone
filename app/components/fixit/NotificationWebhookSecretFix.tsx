/**
 * Inline fix-it form for the `notification_webhook_secret`
 * IMPOSSIBLE_TO_MIGRATE entry.
 *
 * Notification webhook signing secrets are write-only - the source
 * account doesn't return their values via GET, so the migrator can't
 * copy them. When this form is filled in, the destination webhook is
 * created with the user-supplied secret on the POST body and the
 * webhook works end-to-end without any post-migration step. When
 * skipped (acknowledged), the webhook is recreated without a secret
 * and the user must paste the secret into the dashboard later.
 *
 * Bucket 2.1 spike (2026-05-25) verified the Cloudflare API at
 * `POST /accounts/{id}/alerting/v3/destinations/webhooks` accepts the
 * `secret` field on create. The value is write-only on subsequent
 * GETs (same security pattern as worker secrets / IdP client secrets).
 *
 * Mounted inline in Step 2 (OutOfScopePanel.tsx) below the panel row
 * for the notification_webhook_secret item.
 *
 * State (`notificationWebhookSecrets`) lives at the wizard root in
 * App.tsx. Keyed by source webhook NAME (source IDs differ from dest
 * IDs after migration; the name is preserved).
 */

import React from 'react';

/** Source webhook shape from `exportData.notificationWebhooks`. Only
 * the user-visible fields needed for rendering are required. */
export interface SourceNotificationWebhook {
  /** Optional - used as a stable identifier for React keys. */
  id?: string;
  /** Webhook NAME - the lookup key for the secret. */
  name: string;
  /** Webhook type (slack, generic, etc.) for display. */
  type?: string;
  /** Destination URL for display. */
  url?: string;
}

interface NotificationWebhookSecretFixProps {
  /** Source webhooks from the export. */
  webhooks: SourceNotificationWebhook[];
  /** notificationWebhookSecrets[webhookName] = user-supplied secret. */
  notificationWebhookSecrets: Record<string, string>;
  /** State setter. */
  setNotificationWebhookSecrets: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
}

export function NotificationWebhookSecretFix({
  webhooks,
  notificationWebhookSecrets,
  setNotificationWebhookSecrets,
}: NotificationWebhookSecretFixProps) {
  if (webhooks.length === 0) return null;

  function updateSecret(name: string, value: string) {
    setNotificationWebhookSecrets((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  const cardClass = 'bg-gray-800/60 border border-gray-700 rounded-md p-3';

  return (
    <div className="space-y-4">
      {webhooks.map((hook) => (
        <div key={hook.id || hook.name} className={cardClass}>
          <div className="mb-3 text-sm">
            <span className="font-medium text-gray-200">{hook.name}</span>
            {hook.type && (
              <span className="ml-2 text-xs text-gray-500 uppercase">{hook.type}</span>
            )}
            {hook.url && (
              <div className="mt-1 text-xs text-gray-400 break-all font-mono">
                {hook.url}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="w-28 text-sm text-gray-400 flex-shrink-0">
              Signing secret
            </label>
            <form className="contents" onSubmit={(e) => e.preventDefault()}>
            <input
              type="password"
              value={notificationWebhookSecrets[hook.name] || ''}
              onChange={(e) => updateSecret(hook.name, e.target.value)}
              className="flex-1 bg-gray-600 border border-gray-500 rounded px-3 py-1.5 text-sm text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
              placeholder="Enter the webhook signing secret"
              autoComplete="new-password"
            />
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}
