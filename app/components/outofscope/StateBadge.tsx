import { CheckCircle, CircleDashed } from '@phosphor-icons/react';
import type { ItemResolutionState } from '../../lib/outOfScope';

/** Tiny per-item state pill. */
export function StateBadge({ state }: { state: ItemResolutionState }) {
  if (state === 'fixed') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-900/40 text-emerald-300 mt-0.5 flex-shrink-0"
        title="Fixed - you supplied the values; the migration tool will set them on the destination."
      >
        <CheckCircle size={11} weight="fill" aria-hidden="true" />
        FIXED
      </span>
    );
  }
  if (state === 'acknowledged') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-900/40 text-amber-300 mt-0.5 flex-shrink-0"
        title="Acknowledged - you accepted that this will not migrate."
      >
        <CheckCircle size={11} weight="fill" aria-hidden="true" />
        ACK
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-700/60 text-gray-400 mt-0.5 flex-shrink-0"
      title="Unresolved - fix or acknowledge before you can continue."
    >
      <CircleDashed size={11} weight="bold" aria-hidden="true" />
      OPEN
    </span>
  );
}
