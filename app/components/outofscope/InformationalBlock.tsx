import { useMemo, useState } from 'react';
import { Info, CaretDown, CaretRight } from '@phosphor-icons/react';
import type { ApplicableImpossibleResource } from '../../lib/outOfScope';
import type { ImpossibleCategory } from '../../../src/types';

/**
 * Metadata for informational categories - shown as compact disclosure
 * rows, never gating the Continue button. Phrasing is descriptive ("X
 * happens automatically") rather than prescriptive ("you must X").
 */
const INFO_CATEGORY_META: Record<
  Extract<ImpossibleCategory, 'auto_managed' | 'read_only' | 'data_ephemeral'>,
  { label: string; description: string; color: string }
> = {
  auto_managed: {
    label: 'Auto-managed by Cloudflare',
    description: 'Cloudflare provisions these on the destination zone automatically. No action required.',
    color: 'text-emerald-300',
  },
  read_only: {
    label: 'Read-only settings',
    description: 'Server-side immutable. The destination zone gets its own value based on its plan and account.',
    color: 'text-gray-300',
  },
  data_ephemeral: {
    label: 'Ephemeral data',
    description: 'Cache, analytics history, in-flight queue messages. Volatile by design - resets on the new zone.',
    color: 'text-gray-400',
  },
};

/* ────────────────────────────────────────────────────────────────── */
/* Informational block - disclosure-only, never gates Continue        */
/* ────────────────────────────────────────────────────────────────── */

interface InformationalBlockProps {
  items: ApplicableImpossibleResource[];
}

export function InformationalBlock({ items }: InformationalBlockProps) {
  // Collapsed by default - these are informational and shouldn't
  // dominate the page. The user can expand for full detail if curious.
  const [expanded, setExpanded] = useState(false);

  const byCategory = useMemo(() => {
    const map = new Map<ImpossibleCategory, ApplicableImpossibleResource[]>();
    for (const r of items) {
      const existing = map.get(r.category);
      if (existing) existing.push(r);
      else map.set(r.category, [r]);
    }
    return map;
  }, [items]);

  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 text-left"
        aria-expanded={expanded}
      >
        <Info size={20} className="text-gray-400 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-200">
              Other notes about this migration ({items.length})
            </h3>
            {expanded ? (
              <CaretDown size={14} className="text-gray-500" aria-hidden="true" />
            ) : (
              <CaretRight size={14} className="text-gray-500" aria-hidden="true" />
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Informational - Cloudflare handles these automatically, or they are
            properties of the destination that you cannot change. No action required.
          </p>
        </div>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3 pl-8">
          {[...byCategory.entries()].map(([category, catItems]) => {
            const meta = INFO_CATEGORY_META[category as keyof typeof INFO_CATEGORY_META];
            if (!meta) return null;
            return (
              <div key={category} className="rounded-md border border-gray-700/60 bg-gray-900/30 p-3">
                <div className={`text-xs font-semibold ${meta.color}`}>
                  {meta.label} ({catItems.length})
                </div>
                <div className="text-xs text-gray-500 mt-0.5 mb-2">{meta.description}</div>
                <ul className="space-y-1.5 list-disc pl-5 marker:text-gray-600">
                  {catItems.map(item => (
                    <li key={item.key} className="text-xs text-gray-400">
                      <span className="text-gray-300 font-medium">{item.name}</span>
                      {item.count !== undefined && (
                        <span className="text-gray-500"> ({item.count})</span>
                      )}
                      <span className="text-gray-500"> - {item.reason}</span>
                      {item.docsUrl && (
                        <>
                          {' '}
                          <a
                            href={item.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300"
                          >
                            docs →
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
