/**
 * Inline fix-it form for the `ai_gateway_custom_provider_api_keys`
 * IMPOSSIBLE_TO_MIGRATE entry.
 *
 * AI Gateway custom providers are migrated end-to-end (name, slug,
 * base_url, etc.) but their authentication credentials are NOT -
 * the API key lives in Cloudflare Secrets Store under the
 * `ai_gateway` scope, NOT on the provider object itself.
 *
 * When the user supplies an API key here, the migrator creates a
 * Secrets Store secret on dest named `ai_gateway_<slug>` with
 * `scopes: ["ai_gateway"]`. User code that references AI Gateway
 * custom providers via `cf-aig-authorization` headers can then point
 * at the new secret name (the migrator emits a manual-action message
 * about this, since the tool can't update worker source code).
 *
 * Bucket 2.4 spike (2026-05-25) verified:
 *   - The custom-provider create call accepts no API key field; the
 *     key is a separate Secrets Store create.
 *   - Default Secrets Store auto-created per account; the migrator
 *     uses the first store it finds.
 *   - Secret value is write-only on GET.
 *
 * State (`aiGatewayProviderApiKeys`) lives at the wizard root in
 * App.tsx.
 */

import React from 'react';

/** Source provider shape from `exportData.aiGatewayCustomProviders`. */
export interface SourceAiGatewayCustomProvider {
  /** Provider SLUG - the lookup key for the API key. */
  slug: string;
  name?: string;
  base_url?: string;
}

interface AiGatewayProviderApiKeyFixProps {
  providers: SourceAiGatewayCustomProvider[];
  aiGatewayProviderApiKeys: Record<string, string>;
  setAiGatewayProviderApiKeys: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
}

export function AiGatewayProviderApiKeyFix({
  providers,
  aiGatewayProviderApiKeys,
  setAiGatewayProviderApiKeys,
}: AiGatewayProviderApiKeyFixProps) {
  if (providers.length === 0) return null;

  function updateKey(slug: string, value: string) {
    setAiGatewayProviderApiKeys((prev) => ({
      ...prev,
      [slug]: value,
    }));
  }

  const cardClass = 'bg-gray-800/60 border border-gray-700 rounded-md p-3';

  return (
    <>
      <div className="mb-3 text-xs text-gray-400 leading-relaxed">
        The API key for each provider is stored in Cloudflare Secrets Store
        on the destination account (scope <code className="text-gray-300 font-mono">ai_gateway</code>)
        with secret name <code className="text-gray-300 font-mono">ai_gateway_&lt;slug&gt;</code>.
        Worker code referencing the previous provider's auth via{' '}
        <code className="text-gray-300 font-mono">cf-aig-authorization</code>{' '}
        headers may need to be updated to use the new secret name.
      </div>
      <div className="space-y-4">
        {providers.map((p) => (
          <div key={p.slug} className={cardClass}>
            <div className="mb-3 text-sm">
              <span className="font-medium text-gray-200">{p.name || p.slug}</span>
              <span className="ml-2 text-xs text-gray-500 font-mono">{p.slug}</span>
              {p.base_url && (
                <div className="mt-1 text-xs text-gray-400 break-all font-mono">
                  {p.base_url}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="w-28 text-sm text-gray-400 flex-shrink-0">
                API key
              </label>
              <form className="contents" onSubmit={(e) => e.preventDefault()}>
              <input
                type="password"
                value={aiGatewayProviderApiKeys[p.slug] || ''}
                onChange={(e) => updateKey(p.slug, e.target.value)}
                className="flex-1 bg-gray-600 border border-gray-500 rounded px-3 py-1.5 text-sm text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                placeholder="Enter the upstream provider API key"
                autoComplete="new-password"
              />
              </form>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
