/**
 * Inline fix-it form for the `origin_ca_keys` IMPOSSIBLE_TO_MIGRATE
 * entry.
 *
 * Origin CA private keys are generated client-side and never stored
 * by Cloudflare. To re-issue these certs on the destination account,
 * the user generates a fresh CSR locally and pastes it here. The new
 * private key stays on the user's machine; Cloudflare issues a new
 * origin cert against the supplied CSR.
 *
 * Mounted inline in Step 2 (OutOfScopePanel). State (`originCaCsrs`)
 * lives at the wizard root.
 */

import React from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import type { OriginCaCsrInput } from '../../lib/types';

/** Source Origin CA cert shape from `exportData.originCaCertificates`. */
export interface SourceOriginCaCert {
  id: string;
  hostnames: string[];
  request_type: 'origin-rsa' | 'origin-ecc';
  requested_validity: number;
  expires_on: string;
}

interface OriginCaFixProps {
  sourceOriginCaCertificates: SourceOriginCaCert[];
  originCaCsrs: OriginCaCsrInput[];
  setOriginCaCsrs: React.Dispatch<React.SetStateAction<OriginCaCsrInput[]>>;
}

export function OriginCaFix({
  sourceOriginCaCertificates,
  originCaCsrs,
  setOriginCaCsrs,
}: OriginCaFixProps) {
  if (sourceOriginCaCertificates.length === 0) return null;

  const cardClass = 'bg-gray-800/60 border border-gray-700 rounded-md p-3';

  return (
    <>
      <div className="bg-blue-900/20 border border-blue-700/50 rounded p-3 mb-4 text-xs text-blue-200 font-mono">
        Generate a CSR locally:<br />
        <span className="text-blue-100">
          openssl req -new -newkey rsa:2048 -nodes -keyout origin-privkey.pem -out origin-csr.pem -subj &quot;/CN=example.com&quot;
        </span>
        <br />
        Then paste the contents of <span className="font-bold">origin-csr.pem</span> below.
      </div>
      <div className="space-y-4">
        {sourceOriginCaCertificates.map((cert) => {
          const input = originCaCsrs.find(c => c.sourceId === cert.id);
          const csr = input?.csr || '';
          return (
            <div key={cert.id} className={cardClass}>
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-sm">
                  <span className="text-gray-400">Hostnames:</span>{' '}
                  <span className="text-gray-200">{(cert.hostnames || []).join(', ') || 'N/A'}</span>
                  <span className="text-xs text-gray-500 ml-3">
                    {cert.request_type} · {cert.requested_validity}d validity · expires {cert.expires_on?.slice(0, 10) || 'N/A'}
                  </span>
                </div>
                {csr && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-400">
                    <CheckCircle size={12} weight="fill" aria-hidden="true" />
                    CSR provided
                  </span>
                )}
              </div>
              <label className="block text-xs text-gray-400 mb-1">
                New CSR for re-issuance (leave blank to skip this cert)
              </label>
              <textarea
                value={csr}
                onChange={(e) => {
                  const newCsr = e.target.value;
                  setOriginCaCsrs((prev) => {
                    const existing = prev.findIndex(c => c.sourceId === cert.id);
                    if (existing >= 0) {
                      // Update existing entry; remove if CSR is now empty.
                      if (!newCsr.trim()) {
                        return prev.filter((_, idx) => idx !== existing);
                      }
                      return prev.map((c, idx) => idx === existing ? { ...c, csr: newCsr } : c);
                    }
                    // Add a new entry if CSR isn't empty.
                    if (!newCsr.trim()) return prev;
                    return [...prev, {
                      sourceId: cert.id,
                      hostnames: cert.hostnames,
                      csr: newCsr,
                      request_type: cert.request_type,
                      requested_validity: cert.requested_validity,
                    }];
                  });
                }}
                rows={6}
                className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm font-mono text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50 resize-y"
                placeholder={'-----BEGIN CERTIFICATE REQUEST-----\n... (paste contents of origin-csr.pem) ...\n-----END CERTIFICATE REQUEST-----'}
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-gray-500 mt-3">
        Certs without a CSR will be skipped (acknowledged in the migration report). You can re-issue
        them manually later via <code className="text-gray-400">POST /certificates</code> with a fresh CSR.
      </p>
    </>
  );
}
