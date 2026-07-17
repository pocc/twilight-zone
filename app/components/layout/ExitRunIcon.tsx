// Original, trivially-simple exit glyph: a bold arrow pointing through a
// half-open doorway. Hand-built here (not derived from any stock/licensed art)
// and chosen over a figure because a solid arrow stays instantly legible at the
// tiny knob size. Single-colour via currentColor so the knob's hover-glow rules
// (.tvc-power-icon) drive both the door strokes and the filled arrow.
export function ExitRunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 256 256" aria-hidden="true">
      {/* Mirrored left↔right (reflected over the vertical axis): door on the
          left, arrow pointing left into it. */}
      <g transform="translate(256 0) scale(-1 1)">
        {/* Doorway frame + door swung half-open (hinged at the jamb). */}
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M158 230 V26 H232 V230" strokeWidth="14" />
          <path d="M232 26 L188 54 V202 L232 230" strokeWidth="12" />
        </g>
        {/* Bold arrow pointing into the doorway. */}
        <path fill="currentColor" d="M28 102 H104 V70 L156 128 L104 186 V154 H28 Z" />
      </g>
    </svg>
  );
}
