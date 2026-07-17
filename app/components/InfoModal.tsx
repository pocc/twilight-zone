import { useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useScrollLock } from '../hooks/useScrollLock';

/**
 * Generic centered modal used for About, Security, and any future
 * informational dialogs. Matches the visual language of CoverageModal.
 *
 * Keyboard:
 *   - Esc closes
 *   - click outside the card also closes
 *
 * Renders into the React tree at its parent's location (no portal). The
 * fixed positioning means it overlays the entire viewport regardless.
 */
type InfoModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional small label above the title (e.g. "Privacy & security"). */
  eyebrow?: string;
  children: React.ReactNode;
  /** Optional footer content rendered with a divider above. */
  footer?: React.ReactNode;
};

export function InfoModal({ open, onClose, title, eyebrow, children, footer }: InfoModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(open, dialogRef, onClose);

  // Lock background scroll while open. Locks both `body` (base) and the
  // `.tvc-host--page` scroll box (twilight) — see useScrollLock.
  useScrollLock(open);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-modal-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-start justify-between p-5 border-b border-gray-700">
          <div>
            {eyebrow && (
              <div className="text-[10px] uppercase tracking-wide text-orange-400 font-semibold mb-1">
                {eyebrow}
              </div>
            )}
            <h2 id="info-modal-title" className="text-xl font-bold text-gray-100">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-orange-400 transition cursor-pointer rounded"
            aria-label="Close"
          >
            <X size={20} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4 text-sm text-gray-300 space-y-4 leading-relaxed">
          {children}
        </div>

        {footer && (
          <div className="px-5 py-3 border-t border-gray-700 text-xs text-gray-500">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Visual section heading inside an InfoModal. Matches the orange-accent
 * uppercase tracking-wide style used throughout the app.
 */
export function ModalSectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-orange-400 uppercase tracking-wide mt-1 mb-2 first:mt-0">
      {children}
    </h3>
  );
}
