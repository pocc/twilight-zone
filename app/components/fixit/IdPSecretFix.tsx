/**
 * Inline fix-it form for the `identity_provider_secrets`
 * IMPOSSIBLE_TO_MIGRATE entry.
 *
 * Access IdP OAuth `client_secret` values are write-only on
 * source GET. When the user supplies a value, the migrator merges it
 * with the export-captured `config` and POSTs a fully-functional IdP
 * to /access/identity_providers on dest. Without a value, the IdP
 * falls back to the acknowledgment-only path and the user must
 * recreate the IdP manually on dest.
 *
 * Bucket 2.2 spike (2026-05-25) verified the Cloudflare API at
 * `POST /accounts/{id}/access/identity_providers` accepts
 * `config.client_secret` on create. The value is write-only on
 * subsequent GETs (same security pattern as worker secrets).
 *
 * IdP types filtered out (no input rendered):
 *   - `onetimepin` - Cloudflare auto-provisions one per account and
 *     it doesn't take a user secret.
 *   - `saml` - SAML's trust model is cert-based (`idp_public_certs`
 *     + signed assertions), not shared-secret-based. SAML IdPs
 *     auto-migrate end-to-end from the captured `config` alone (the
 *     export preserves `idp_public_certs` because it's public
 *     certificate material - see SECRET_LIKE_CONFIG_FIELDS in
 *     src/migrate/export-zone.ts). They DO still appear in the
 *     Step 4 "Test Configuration" workflow because SAML logins can
 *     fail for other reasons (wrong sso_target_url, expired certs,
 *     issuer mismatch).
 *
 * State (`identityProviderSecrets`) lives at the wizard root in
 * App.tsx.
 *
 * Input shape validation:
 *   - Trim whitespace on write - paste-truncation is the #1 typing
 *     failure mode.
 *   - Show a gentle length hint if the value is suspiciously short
 *     (under 8 chars). Does not block; the user can ignore.
 */

import React from 'react';

/** Source IdP shape from `exportData.identityProviders`. */
export interface SourceIdentityProvider {
  id?: string;
  /** Source IdP NAME - the lookup key for the secret. */
  name: string;
  /** IdP type (oidc, saml, google-apps, etc.) for display. */
  type?: string;
}

interface IdPSecretFixProps {
  /** Source IdPs from the export. The component filters out
   * `onetimepin` automatically. */
  identityProviders: SourceIdentityProvider[];
  /** identityProviderSecrets[idpName] = user-supplied client_secret. */
  identityProviderSecrets: Record<string, string>;
  /** State setter. */
  setIdentityProviderSecrets: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
}

/**
 * IdP types that do NOT take a user-supplied client_secret. SAML
 * uses cert-based trust; onetimepin is auto-provisioned. This must
 * stay in sync with the filter in `isItemFixed` for the
 * `identity_provider_secrets` key (app/lib/outOfScope.ts).
 */
const IDP_TYPES_WITHOUT_SECRET = new Set(['onetimepin', 'saml']);

/** Below this length, the value is too short to be a real OAuth
 * client_secret. We warn but do not block. */
const SUSPICIOUSLY_SHORT_LENGTH = 8;

export function IdPSecretFix({
  identityProviders,
  identityProviderSecrets,
  setIdentityProviderSecrets,
}: IdPSecretFixProps) {
  const migratable = identityProviders.filter(
    idp => !IDP_TYPES_WITHOUT_SECRET.has(idp.type ?? ''),
  );
  if (migratable.length === 0) return null;

  function updateSecret(name: string, value: string) {
    // Trim leading/trailing whitespace on every keystroke. The most
    // common paste failure is a trailing newline or space, which the
    // user cannot see and which Cloudflare will silently accept and
    // store as part of the secret - leading to a "the password I
    // pasted does not match" mystery at first login.
    const trimmed = value.trim();
    setIdentityProviderSecrets((prev) => ({
      ...prev,
      [name]: trimmed,
    }));
  }

  const cardClass = 'bg-gray-800/60 border border-gray-700 rounded-md p-3';

  return (
    <div className="space-y-4">
      {migratable.map((idp) => {
        const value = identityProviderSecrets[idp.name] || '';
        const isShort = value.length > 0 && value.length < SUSPICIOUSLY_SHORT_LENGTH;
        return (
          <div key={idp.id || idp.name} className={cardClass}>
            <div className="mb-3 text-sm">
              <span className="font-medium text-gray-200">{idp.name || 'Identity Provider'}</span>
              {idp.type && (
                <span className="ml-2 text-xs text-gray-500 uppercase">{idp.type}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="w-28 text-sm text-gray-400 flex-shrink-0">
                client_secret
              </label>
              <form className="contents" onSubmit={(e) => e.preventDefault()}>
              <input
                type="password"
                value={value}
                onChange={(e) => updateSecret(idp.name, e.target.value)}
                className="flex-1 bg-gray-600 border border-gray-500 rounded px-3 py-1.5 text-sm text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                placeholder="Enter the OAuth client_secret"
                autoComplete="new-password"
                aria-describedby={isShort ? `idp-hint-${idp.name}` : undefined}
              />
              </form>
            </div>
            {isShort && (
              <p
                id={`idp-hint-${idp.name}`}
                className="mt-2 ml-[7.5rem] text-xs text-yellow-400"
                role="alert"
              >
                This looks short for an OAuth client_secret - double-check you copied the full value.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
