/**
 * Inline fix-it form for the `aop_mtls_certificate_bundle`
 * IMPOSSIBLE_TO_MIGRATE entry.
 *
 * Authenticated Origin Pulls (AOP) uses a per-account mTLS certificate
 * bundle (cert + private key) to authenticate Cloudflare → origin
 * traffic. The private key is not exportable. The user must supply
 * cert + key here; the migrator uploads each bundle to
 * /accounts/{id}/mtls_certificates and uses the returned cert ID to
 * recreate the hostname association on dest.
 *
 * Bucket 2.3 spike (2026-05-25) verified:
 *   - POST accepts `certificates` + `private_key` + `name` + `ca`.
 *   - For self-signed CA certs, set `ca: true` and ensure the cert
 *     has the required basicConstraints + keyUsage extensions.
 *   - The API may return a HTTP 400 "Unable to decode the JSON
 *     request body" while the upload actually succeeded - the
 *     migrate code handles this via list-by-name fallback.
 *
 * State (`aopMtlsBundles`) lives at the wizard root in App.tsx.
 */

import React from 'react';

interface AopMtlsBundle {
  /** Display name + dedup key. */
  name: string;
  /** PEM-encoded cert (or chain). */
  certificates: string;
  /** PEM-encoded private key. */
  private_key: string;
  /** Default false. Set true for CA-style bundles. */
  ca?: boolean;
}

interface AopMtlsFixProps {
  /** Bundles the user has supplied. The form always renders at
   * least one editable bundle row. The user can add more or remove
   * via the controls. */
  aopMtlsBundles: AopMtlsBundle[];
  setAopMtlsBundles: React.Dispatch<React.SetStateAction<AopMtlsBundle[]>>;
  /** Affected hostnames from the source export, displayed for
   * orientation so the user knows what the cert needs to cover. */
  affectedHostnames?: string[];
}

export function AopMtlsFix({
  aopMtlsBundles,
  setAopMtlsBundles,
  affectedHostnames,
}: AopMtlsFixProps) {
  function updateBundle(index: number, patch: Partial<AopMtlsBundle>) {
    setAopMtlsBundles((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    );
  }

  function addBundle() {
    setAopMtlsBundles((prev) => [
      ...prev,
      { name: `aop-bundle-${prev.length + 1}`, certificates: '', private_key: '', ca: false },
    ]);
  }

  function removeBundle(index: number) {
    setAopMtlsBundles((prev) => prev.filter((_, i) => i !== index));
  }

  const cardClass = 'bg-gray-800/60 border border-gray-700 rounded-md p-3';

  // Ensure at least one editable bundle is rendered so the user
  // sees the input fields without having to click "Add".
  const displayBundles = aopMtlsBundles.length > 0
    ? aopMtlsBundles
    : [{ name: 'aop-bundle-1', certificates: '', private_key: '', ca: false } as AopMtlsBundle];
  const isEmpty = aopMtlsBundles.length === 0;

  return (
    <>
      {affectedHostnames && affectedHostnames.length > 0 && (
        <div className="mb-3 text-xs text-gray-400">
          Hostnames using AOP:{' '}
          <span className="text-gray-300 font-mono">
            {affectedHostnames.slice(0, 5).join(', ')}
            {affectedHostnames.length > 5 ? `, +${affectedHostnames.length - 5} more` : ''}
          </span>
        </div>
      )}
      <div className="bg-blue-900/20 border border-blue-700/50 rounded p-3 mb-4 text-xs text-blue-200">
        Generate or locate your AOP client cert + key:<br />
        <span className="font-mono text-blue-100">
          openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj &quot;/CN=your-origin&quot;
        </span>
        <br />
        Then paste both PEM files into the fields below. For a self-signed CA
        cert (signing client certs), also tick &quot;CA cert&quot;.
      </div>
      <div className="space-y-4">
        {displayBundles.map((bundle, i) => (
          <div key={i} className={cardClass}>
            <div className="flex justify-between items-center mb-3">
              <input
                type="text"
                value={bundle.name}
                onChange={(e) => !isEmpty && updateBundle(i, { name: e.target.value })}
                onFocus={() => isEmpty && setAopMtlsBundles([bundle])}
                className="flex-1 bg-gray-600 border border-gray-500 rounded px-3 py-1 text-sm text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50 mr-3"
                placeholder="Bundle name (e.g. origin-mtls)"
              />
              <label className="flex items-center gap-2 text-xs text-gray-400 mr-3">
                <input
                  type="checkbox"
                  checked={bundle.ca === true}
                  onChange={(e) => {
                    if (isEmpty) setAopMtlsBundles([{ ...bundle, ca: e.target.checked }]);
                    else updateBundle(i, { ca: e.target.checked });
                  }}
                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-700 text-orange-500 focus:ring-orange-500"
                />
                CA cert
              </label>
              {!isEmpty && aopMtlsBundles.length > 1 && (
                <button type="button"
                  onClick={() => removeBundle(i)}
                  className="text-red-400 hover:text-red-300 text-sm transition"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Certificate PEM</label>
                <textarea
                  value={bundle.certificates}
                  onChange={(e) => {
                    if (isEmpty) setAopMtlsBundles([{ ...bundle, certificates: e.target.value }]);
                    else updateBundle(i, { certificates: e.target.value });
                  }}
                  rows={4}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm font-mono text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50 resize-y"
                  placeholder="-----BEGIN CERTIFICATE-----"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Private Key PEM</label>
                <textarea
                  value={bundle.private_key}
                  onChange={(e) => {
                    if (isEmpty) setAopMtlsBundles([{ ...bundle, private_key: e.target.value }]);
                    else updateBundle(i, { private_key: e.target.value });
                  }}
                  rows={4}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm font-mono text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50 resize-y"
                  placeholder="-----BEGIN PRIVATE KEY-----"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      {!isEmpty && (
        <button type="button"
          onClick={addBundle}
          className="mt-3 px-4 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-sm text-gray-300 transition"
        >
          + Add Another Bundle
        </button>
      )}
    </>
  );
}
