import React from 'react';

/* ── FileDropZone helper ── */
export function FileDropZone({
  dragOver,
  setDragOver,
  onDrop,
  onClick,
  icon,
  label,
}: {
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
  icon: string;
  label: React.ReactNode;
}) {
  return (
    // Rendered as a <button> so the import path is keyboard-operable (Enter/
    // Space) and screen-reader announced — the hidden <input type=file> is
    // display:none and the drop affordance is mouse-only, so without this a
    // keyboard/SR user could not import JSON/Terraform at all (WCAG 2.1.1).
    <button
      type="button"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={onClick}
      className={`w-full border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
        dragOver
          ? 'border-orange-500 bg-orange-500/10'
          : 'border-gray-600 hover:border-gray-500'
      }`}
    >
      <div className="text-gray-400 text-3xl mb-2" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon }} />
      <p className="text-sm text-gray-300">{label}</p>
      <p className="text-xs text-gray-500 mt-1">or click to browse</p>
    </button>
  );
}
