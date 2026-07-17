/**
 * Small "open in dashboard" external-link icon. Renders nothing when no URL
 * can be built (unmapped group or missing account/zone context), so callers
 * can drop it next to any resource row unconditionally.
 *
 * Used in Step 2 to link each source-zone element into the source account's
 * dashboard, and reusable in Step 4 for destination links. See
 * app/lib/dashLinks.ts for URL construction.
 */

import { ArrowSquareOut } from '@phosphor-icons/react';
import { buildDashLink, type DashLinkCtx, type DashLinkItem } from '../lib/dashLinks';

interface DashLinkProps {
  groupKey: string;
  item?: DashLinkItem | null;
  ctx: DashLinkCtx;
  /** Accessible label, e.g. "Open DNS Records in the source dashboard". */
  title: string;
  /** Extra classes for spacing only. The link's own typography is fixed
   * (tiny, uppercase, muted gray → orange on hover) to match the Step 4
   * dashboard links and stay quiet next to the resource title — do not pass a
   * font-size here, the link is intentionally small everywhere. */
  className?: string;
}

export function DashLink({ groupKey, item = null, ctx, title, className = '' }: DashLinkProps) {
  const href = buildDashLink(groupKey, item, ctx);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide text-gray-500 hover:text-orange-400 transition-colors flex-shrink-0 ${className}`}
    >
      open
      <ArrowSquareOut size={11} weight="bold" aria-hidden="true" />
    </a>
  );
}
