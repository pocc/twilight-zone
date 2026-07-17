// The stark white 6-panel door slab, shared by the Endless Doorway (#4)
// and Hypno-Frame (#2) twilight variants. It's the swinging front layer:
// carries .twilight-door-panel so it inherits the hover-swing + flip
// choreography in index.css (left-edge hinge). All greys + a warm-white
// latch seam — no colour, to match the iconic floating-door title card.
export function WhiteDoorPanel() {
  return (
    <svg
      className="twilight-door-panel"
      viewBox="0 0 100 180"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <filter id="tz-seam-glow" x="-200%" y="-100%" width="500%" height="400%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      {/* Door slab. */}
      <rect x="3" y="2.5" width="94" height="175" rx="2.5" fill="#f4f4f6" stroke="#0a0a0c" strokeWidth="1.6" />
      {/* Inner stile/rail frame. */}
      <rect x="8.5" y="8" width="83" height="164" rx="1.5" fill="none" stroke="#c6c6cf" strokeWidth="1" />
      {/* Six raised panels: 2 columns × 3 rows (short / medium / long),
          each an outer recess with a white inner highlight to fake bevel. */}
      {([
        [13, 14, 34, 30],
        [53, 14, 34, 30],
        [13, 52, 34, 52],
        [53, 52, 34, 52],
        [13, 112, 34, 56],
        [53, 112, 34, 56],
      ] as const).map(([x, y, w, h], idx) => (
        <g key={idx}>
          <rect x={x} y={y} width={w} height={h} rx="1.4" fill="#e9e9ef" stroke="#9a9aa4" strokeWidth="0.9" />
          <rect x={x + 3} y={y + 3} width={w - 6} height={h - 6} rx="1" fill="#fbfbfd" stroke="#ffffff" strokeWidth="0.6" />
        </g>
      ))}
      {/* Knob on the latch (right) side. */}
      <circle cx="80" cy="92" r="3.1" fill="#dadae0" stroke="#5f5f68" strokeWidth="0.8" />
      {/* Light-seam leaking from the dimension behind, down the latch edge. */}
      <rect className="tz-seam" x="94.2" y="6" width="1.7" height="168" rx="0.8" fill="#ffffff" filter="url(#tz-seam-glow)" />
    </svg>
  );
}
