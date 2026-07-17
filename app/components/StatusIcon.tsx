import React from 'react';
import {
  CheckCircle,
  WarningOctagon,
  XCircle,
  MinusCircle,
  Warning,
  Info,
  Envelope,
  EnvelopeSimple,
  Question,
  Spinner,
  Lock,
  Sparkle,
  Sun,
  Moon,
  Copy,
  CaretDown,
  CaretUp,
} from '@phosphor-icons/react';

/**
 * Status type covers both migration outcomes (success/failed/skipped) and
 * verification outcomes (verified/missing/mismatched/acknowledged). The
 * shared map lives here so the colour + icon pairing is consistent across
 * the wizard - Step 4 summary badges, per-section rows, the email-address
 * card, and anywhere else status is rendered.
 */
export type Status =
  | 'success'
  | 'failed'
  | 'skipped'
  | 'verified'
  | 'missing'
  | 'mismatched'
  | 'acknowledged'
  | 'unverified'
  | 'warning'
  | 'info';

interface StatusIconProps {
  status: Status;
  /** Visual size in pixels (default 16). */
  size?: number;
  /** Tailwind text color override; defaults to the status's canonical color. */
  className?: string;
  /** Accessible label for screen readers. Defaults to the status name. */
  'aria-label'?: string;
  /** When true, marks the icon as decorative (hides from AT). Use when
   *  adjacent text already conveys the status. */
  decorative?: boolean;
}

/**
 * STATUS_META: single source of truth for status presentation. Keep
 * additions here in sync with both the Step4Results categories and the
 * MigrationReport / ValidationSection types in src/types.ts.
 *
 * Colours preserve the historical mapping so users who learned the old
 * emoji palette aren't disoriented:
 *   verified/success  → green   (CheckCircle)
 *   mismatched        → amber   (Warning)
 *   acknowledged      → muted   (MinusCircle, low visual weight per
 *                                Principle 1: not a failure, shouldn't
 *                                draw the eye like one)
 *   failed/missing    → red     (XCircle)
 *   unverified        → blue    (Question — read-back GET failed, so we make
 *                                NO claim about presence. Principle 1: this is
 *                                not a failure; it must not render red.)
 *   skipped           → muted   (MinusCircle)
 *   warning           → orange  (WarningOctagon)
 *   info              → blue    (Info)
 */
const STATUS_META: Record<Status, { Icon: typeof CheckCircle; color: string; label: string }> = {
  success: { Icon: CheckCircle, color: 'text-green-400', label: 'success' },
  verified: { Icon: CheckCircle, color: 'text-green-400', label: 'verified' },
  failed: { Icon: XCircle, color: 'text-red-400', label: 'failed' },
  missing: { Icon: XCircle, color: 'text-red-400', label: 'missing' },
  mismatched: { Icon: Warning, color: 'text-yellow-400', label: 'mismatched' },
  // Acknowledged uses MinusCircle deliberately - Principle 1 says
  // acknowledged items must not look like failures. A muted dash carries
  // less visual weight than a check or X.
  acknowledged: { Icon: MinusCircle, color: 'text-gray-400', label: 'acknowledged' },
  // Unverified: the read-back GET failed, so presence is unknown. Rendered in
  // blue (informational), NOT red — verification did not run, this is not a
  // failure (Principle 1).
  unverified: { Icon: Question, color: 'text-blue-400', label: 'unverified' },
  skipped: { Icon: MinusCircle, color: 'text-gray-400', label: 'skipped' },
  warning: { Icon: WarningOctagon, color: 'text-orange-400', label: 'warning' },
  info: { Icon: Info, color: 'text-blue-400', label: 'info' },
};

export function StatusIcon({
  status,
  size = 16,
  className,
  'aria-label': ariaLabel,
  decorative,
}: StatusIconProps) {
  const meta = STATUS_META[status];
  const Icon = meta.Icon;
  return (
    <Icon
      size={size}
      weight="fill"
      className={className ?? meta.color}
      aria-label={decorative ? undefined : (ariaLabel ?? meta.label)}
      aria-hidden={decorative || undefined}
      role={decorative ? 'presentation' : 'img'}
    />
  );
}

/** Convenience: pure CSS class for a status's canonical text color, for
 *  the cases where the icon and label live in separate spans. */
export function statusColor(status: Status): string {
  return STATUS_META[status].color;
}

// Re-export common icons used outside the status system so callers
// have a single import surface and we can swap the icon library later
// without grepping every component.
export {
  Lock,
  Info,
  Sparkle,
  Sun,
  Moon,
  Copy,
  Envelope,
  EnvelopeSimple,
  Question,
  Spinner,
  Warning,
  CaretDown,
  CaretUp,
};
