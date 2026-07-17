import * as React from 'react';
import { WarningOctagon } from '@phosphor-icons/react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { useScrollLock } from '../../../hooks/useScrollLock';

// Confirmation modal shown before applying conflict resolution = "overwrite".
// Existing dest resources are replaced; any data on dest that doesn't exist
// on source is lost. We require an explicit acknowledgment because this is
// destructive and cannot be undone.
export function OverwriteConfirmModal({
  onCancel,
  onConfirm,
  zoneName,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  /** Destination zone name being overwritten. When provided, the warning copy
   * names the specific zone so the user knows exactly which zone loses data. */
  zoneName?: string;
}) {
  // This is the destructive confirm — it must contain focus like the other
  // modals (InfoModal/CoverageModal). useFocusTrap traps Tab, handles Escape,
  // and restores focus to the trigger on close; useScrollLock prevents
  // background scroll. The Cancel button has autoFocus so the SAFE action is
  // focused first.
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, dialogRef, onCancel);
  useScrollLock(true);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="overwrite-modal-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-gray-800 border border-red-600/60 rounded-lg p-6 max-w-lg w-full mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="overwrite-modal-title" className="text-lg font-bold text-red-300 mb-3 flex items-center gap-2">
          <WarningOctagon size={20} weight="fill" aria-hidden="true" />
          Overwriting will cause a loss of data
        </h3>
        <p className="text-sm text-gray-300 mb-2">
          Existing resources on the destination zone
          {zoneName ? ' ' : ''}
          {zoneName && <span className="font-semibold text-gray-100">{zoneName}</span>}
          {' '}will be replaced with the source copies.
        </p>
        <p className="text-sm text-gray-300 mb-5">
          Any data on the destination zone
          {zoneName ? ' ' : ''}
          {zoneName && <span className="font-semibold text-gray-100">{zoneName}</span>}
          {' '}that does not exist on the source will be lost. This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button type="button"
            autoFocus
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600 transition cursor-pointer"
          >
            Cancel
          </button>
          <button type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-500 transition cursor-pointer"
          >
            I understand overwriting will cause data loss
          </button>
        </div>
      </div>
    </div>
  );
}
