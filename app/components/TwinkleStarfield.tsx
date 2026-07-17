// Full-bleed twinkling starfield, rendered as an inline SVG so each star
// can animate independently (a CSS background-image tile cannot twinkle
// per-star). This is the rectangular, screen-filling cousin of the door's
// spiral-galaxy halo (HALO_STARS in Layout.tsx) and reuses the exact same
// `.halo-star` twinkle (opacity + scale pop) defined in app/index.css.
//
// Used for two backdrops:
//   1. the entered-twilight page background (Layout: .twilight-bg-stars)
//   2. the Serling-narration warp field (Layout: .sf-twinkle)
//
// The star set is deterministic (seeded LCG) so it is stable across renders
// and identical between server and client.

import { useMemo } from 'react';

type SfStar = {
  x: number;
  y: number;
  r: number;
  min: number;
  max: number;
  dur: number;
  delay: number;
};

// viewBox dimensions; matches the 1200x800 tile coordinate space used by
// the rest of the starfield CSS. Rendered with preserveAspectRatio slice so
// it fills (and crops to) the viewport at any aspect ratio.
const VB_W = 1200;
const VB_H = 800;

function makeStarfield(seed: number, count: number): SfStar[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const f = (n: number) => Math.round(n * 100) / 100;
  const out: SfStar[] = [];
  for (let i = 0; i < count; i++) {
    // Brightness tiers: a few bright anchor stars, many mid, lots of faint
    // dust - mirrors the hand-authored body::before tile distribution.
    const t = rnd();
    const bright = t > 0.92 ? 1 : t > 0.7 ? 0.55 : 0.25;
    out.push({
      x: f(rnd() * VB_W),
      y: f(rnd() * VB_H),
      // Unit spark (+/-1) scaled to viewBox units; slice scale (~1.2px/unit
      // on a desktop viewport) yields roughly 1.5-5px stars.
      r: f(0.8 + bright * 1.9 + rnd() * 0.5),
      min: f(0.1 + rnd() * 0.18),
      max: f(0.55 + bright * 0.4 + rnd() * 0.05),
      dur: f(2.6 + rnd() * 3.6),
      delay: f(rnd() * 6),
    });
  }
  return out;
}

type TwinkleStarfieldProps = {
  /** Deterministic seed so two fields can differ yet stay stable. */
  seed?: number;
  /** Number of stars to scatter. */
  count?: number;
  /** Unique id for this field's <defs> spark path (must be unique per SVG). */
  sparkId?: string;
  className?: string;
};

export function TwinkleStarfield({
  seed = 20260530,
  count = 240,
  sparkId = 'sf-spark',
  className,
}: TwinkleStarfieldProps) {
  // The star set is a pure function of (seed, count). Layout re-renders on
  // mousemove/trail updates in twilight mode, so regenerating hundreds of
  // stars every render is wasted CPU/GC; memoise on the inputs.
  const stars = useMemo(() => makeStarfield(seed, count), [seed, count]);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        {/* Same concave 4-point sparkle as the door halo: the residual gap
            between four circles in a square. Unit shape, scaled per star. */}
        <path id={sparkId} d="M0 -1 Q0 0 1 0 Q0 0 0 1 Q0 0 -1 0 Q0 0 0 -1 Z" />
      </defs>
      {stars.map((st, i) => (
        // Positioning on the <g>; the twinkle animates the <use> about the
        // shape's own centre (see .halo-star in index.css) so it pulses in
        // place rather than drifting.
        <g key={i} transform={`translate(${st.x} ${st.y}) scale(${st.r})`}>
          <use
            href={`#${sparkId}`}
            className="halo-star"
            style={{
              ['--tw-min' as string]: st.min,
              ['--tw-max' as string]: st.max,
              animationDuration: `${st.dur}s`,
              animationDelay: `${st.delay}s`,
            }}
          />
        </g>
      ))}
    </svg>
  );
}
