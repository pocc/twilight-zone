// Endless Doorway (#4) — the weathered Twilight Zone door floating in the
// void, backed by a receding hall of fainter doors converging on a bright
// vanishing-point light. "A dimension of mind" — infinite recursion.
//
// Layers (back → front):
//   1. .twilight-door-tunnel — the receding corridor (z-index 1), seen once
//      the front door swings open on hover.
//   2. .tz-crack-glow        — cold light bleeding from the dimension behind,
//      leaking through the door's ragged, distressed paint edges (z-index 1,
//      painted above the tunnel's black backing via DOM order).
//   3. .tz-rattle > <img>    — the swinging front door (z-index 2). The
//      hand-inked scary-door art carries .twilight-door-panel, so it reuses
//      the hover-swing + flip choreography in index.css (left-edge hinge,
//      matching the drawn hinges). .tz-rattle adds an on-hover tremble that
//      composes UNDER the panel's rotateY swing (separate element, so the
//      two transforms never collide).
import scaryDoorWebp from '../assets/scary-door.webp';

// Receding doors, largest (closest) first. Each is centred on the vanishing
// point, scaled by a constant ratio, AND rotated +15° from the previous one,
// so the outlines spiral inward like a vortex of nested rectangles.
// Deterministic — no RNG.
const VP_X = 50;
const VP_Y = 84; // vanishing point sits slightly above geometric centre (90)
const W0 = 70;
const H0 = 150;
const STEP_DEG = 15; // each rectangle rotates this much past the previous
const STEP_RAD = (STEP_DEG * Math.PI) / 180;
// Largest uniform scale at which a rectangle rotated STEP_DEG about its centre
// still fits inside its same-aspect parent — so each successive rotated
// rectangle nests cleanly without its border crossing the previous one. The
// tall side leans into the x-axis under rotation, so that constraint binds.
const FIT = Math.min(
  1 / (Math.cos(STEP_RAD) + (H0 / W0) * Math.sin(STEP_RAD)),
  1 / ((W0 / H0) * Math.sin(STEP_RAD) + Math.cos(STEP_RAD)),
);
const STEP_SCALE = FIT * 0.9; // 10% margin → a visible gap between rings
const TUNNEL_DOORS = Array.from({ length: 7 }, (_, i) => {
  const scale = Math.pow(STEP_SCALE, i);
  const w = W0 * scale;
  const h = H0 * scale;
  return {
    i,
    x: VP_X - w / 2,
    y: VP_Y - h / 2,
    w,
    h,
    rot: i * STEP_DEG,
    rx: 1.6 * scale,
    opacity: Math.max(0.12, 0.9 - i * 0.12),
    stroke: Math.max(0.8, 2.6 * scale),
  };
});

export function EndlessDoorway() {
  return (
    // Tilt wrapper: fills the hero box (so the layers' % positioning is
    // unchanged) and rotates the whole door 15° so it floats askew in the
    // void. The front-door swing (rotateY on the panel) composes under this.
    <div className="twilight-door-tilt">
      <div className="twilight-door-tunnel" aria-hidden="true">
        <svg viewBox="0 0 100 180" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="tz-core-glow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
          </defs>
          <rect x="0" y="0" width="100" height="180" fill="#050506" />
          {TUNNEL_DOORS.map((d) => (
            <rect
              key={d.i}
              x={d.x}
              y={d.y}
              width={d.w}
              height={d.h}
              rx={d.rx}
              transform={`rotate(${d.rot} ${VP_X} ${VP_Y})`}
              fill="#0b0b0f"
              stroke="#e9e9f1"
              strokeWidth={d.stroke}
              opacity={d.opacity}
            />
          ))}
          {/* The light at the end of the corridor (gently pulsing). */}
          <g className="tz-core">
            <ellipse cx={VP_X} cy={VP_Y} rx="5.5" ry="9" fill="#ffffff" filter="url(#tz-core-glow)" />
            <ellipse cx={VP_X} cy={VP_Y} rx="2.2" ry="5" fill="#ffffff" />
          </g>
        </svg>
      </div>

      {/* Cold light from the dimension behind, leaking through the door's
          ragged transparent paint edges (and flooding out once it opens). */}
      <div className="tz-crack-glow" aria-hidden="true" />

      {/* Rattle wrapper: trembles on hover (something on the other side),
          then the slab swings open. */}
      <div className="tz-rattle">
        {/* Door slab carries the hinge-swing (.twilight-door-panel). The header
            sign is now the explicit exit control, so this door stays text-free. */}
        <div className="twilight-door-panel tz-scary-door tz-door-slab">
          <img
            className="tz-scary-door-img"
            src={scaryDoorWebp}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
