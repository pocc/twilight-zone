/**
 * Inline fix-it form for the `custom_certificate_keys`
 * IMPOSSIBLE_TO_MIGRATE entry.
 *
 * Custom certificate private keys are not exportable via the
 * Cloudflare API. The user must re-upload cert + key pairs for each
 * custom certificate, otherwise the destination zone will be missing
 * those SSL configurations (TLS will fail on the affected hostnames
 * until the user uploads the keys out-of-band).
 *
 * Mounted inline in Step 2 (OutOfScopePanel). State (`certificates`)
 * lives at the wizard root.
 *
 * Note: source cert metadata is in `exportData.customCertificates`
 * (read-only, used to render which certs need keys). The user's
 * supplied cert+key pairs are stored in `certificates`, parallel-
 * indexed to the source certs. Slots beyond the source count are
 * "additional certs" the user wants to upload that weren't on the
 * source zone - useful when migrating to a higher plan that supports
 * more certs.
 */

import React from 'react';
import type { CFCustomCertificate } from '../../../src/types';

interface CustomCertFixProps {
  /** Source custom certs from the export - drives which slots need keys. */
  sourceCustomCertificates: CFCustomCertificate[];
  /** User-supplied cert + key PEM pairs, parallel-indexed to source. */
  certificates: Array<{ cert: string; key: string }>;
  setCertificates: React.Dispatch<React.SetStateAction<Array<{ cert: string; key: string }>>>;
}

export function CustomCertFix({
  sourceCustomCertificates,
  certificates,
  setCertificates,
}: CustomCertFixProps) {
  if (sourceCustomCertificates.length === 0 && certificates.length === 0) return null;

  function updateCertificate(index: number, field: 'cert' | 'key', value: string) {
    setCertificates((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    );
  }

  function ensureSlot(index: number) {
    setCertificates((prev) => {
      if (prev.length > index) return prev;
      const fill = Array.from(
        { length: index - prev.length + 1 },
        () => ({ cert: '', key: '' }),
      );
      return [...prev, ...fill];
    });
  }

  function addCertificate() {
    setCertificates((prev) => [...prev, { cert: '', key: '' }]);
  }

  function removeCertificate(index: number) {
    setCertificates((prev) => prev.filter((_, i) => i !== index));
  }

  const cardClass = 'bg-gray-800/60 border border-gray-700 rounded-md p-3';

  return (
    <>
      <div className="space-y-4">
        {/* Source certs (parallel-indexed) */}
        {sourceCustomCertificates.map((cert, i) => (
          <div key={`existing-${i}`} className={cardClass}>
            <div className="text-sm text-gray-400 mb-3">
              Hosts: <span className="text-gray-300">{cert.hosts?.join(', ') || 'N/A'}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Certificate PEM</label>
                <textarea
                  value={certificates[i]?.cert || ''}
                  onChange={(e) => {
                    ensureSlot(i);
                    updateCertificate(i, 'cert', e.target.value);
                  }}
                  rows={4}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm font-mono text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50 resize-y"
                  placeholder="-----BEGIN CERTIFICATE-----"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Private Key PEM</label>
                <textarea
                  value={certificates[i]?.key || ''}
                  onChange={(e) => {
                    ensureSlot(i);
                    updateCertificate(i, 'key', e.target.value);
                  }}
                  rows={4}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm font-mono text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50 resize-y"
                  placeholder="Paste private-key PEM here"
                />
              </div>
            </div>
          </div>
        ))}

        {/* Additional user-added certs (beyond the source ones) */}
        {certificates.slice(sourceCustomCertificates.length).map((cert, offset) => {
          const idx = sourceCustomCertificates.length + offset;
          return (
            <div key={`new-${idx}`} className={cardClass}>
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-gray-400">New Certificate</span>
                <button type="button"
                  onClick={() => removeCertificate(idx)}
                  className="text-red-400 hover:text-red-300 text-sm transition"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Certificate PEM</label>
                  <textarea
                    value={cert.cert}
                    onChange={(e) => updateCertificate(idx, 'cert', e.target.value)}
                    rows={4}
                    className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm font-mono text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50 resize-y"
                    placeholder="-----BEGIN CERTIFICATE-----"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Private Key PEM</label>
                  <textarea
                    value={cert.key}
                    onChange={(e) => updateCertificate(idx, 'key', e.target.value)}
                    rows={4}
                    className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm font-mono text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500/50 resize-y"
                    placeholder="Paste private-key PEM here"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button type="button"
        onClick={addCertificate}
        className="mt-3 px-4 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-sm text-gray-300 transition"
      >
        + Add Certificate
      </button>
    </>
  );
}
