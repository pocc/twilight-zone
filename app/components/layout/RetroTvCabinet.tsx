import { ExitRunIcon } from './ExitRunIcon';

// Retro Sears TV cabinet, drawn as a purely decorative fixed overlay
// (pointer-events: none). It is a FRAME ONLY: wooden cabinet edges, four
// mitred bezel "walls" that give the set its depth/elliptical-bevel look,
// the right-hand control panel (knobs / pilot lamp / speaker grille) and
// the Sears | Solid State badge. The screen window in the middle is left
// completely empty/transparent - NOTHING is painted over it (no
// scanlines, vignette, sheen or tint), so the website content shows
// through exactly as it renders normally. Used to frame the whole app in
// twilight mode and the Serling-narration moment. The --tvc-* custom
// properties keep the frame edges aligned with the content padding.
// US VHF tuner channels (no channel 1) and a sparse UHF set with fine ticks
// between — printed around each dial's rotating rim ring. Each number is
// oriented so it reads upright as it rotates up to the fixed pointer at 12
// o'clock (transform rotate(deg) means the top glyph is upright at rest and
// every other glyph becomes upright when the ring turns it to the top).
const VHF_CHANNELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
// Full pre-1983 UHF band: EVERY channel 14–83 printed around the rim. Densely
// packed and tiny — deliberately hard to read, exactly like the real tuner.
const UHF_CHANNELS = Array.from({ length: 83 - 14 + 1 }, (_, i) => String(14 + i));

// One tuner dial face: an inline-SVG numbered rim ring (glyphs + tick marks
// placed around a circle via per-glyph rotate/translate, crisper than CSS
// rotated spans at ~10px). Rendered INSIDE .tvc-dial-rotor so the ring spins
// with the knob cap under the fixed housing pointer.
function TvDial({ band }: { band: 'vhf' | 'uhf' }) {
  const labels = band === 'vhf' ? VHF_CHANNELS : UHF_CHANNELS;
  const n = labels.length;
  const cx = 50, cy = 50;
  // UHF has ~70 glyphs, so seat them a touch further out toward the rim than
  // the 12 VHF glyphs to win back a sliver of spacing.
  const rNum = band === 'vhf' ? 39 : 42;
  const numClass = band === 'vhf' ? 'tvc-dial-num tvc-dial-num--vhf' : 'tvc-dial-num tvc-dial-num--uhf';
  const polar = (r: number, deg: number): [number, number] => {
    const a = ((deg - 90) * Math.PI) / 180; // -90 → 0deg is straight up
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  // Channel numbers oriented RADIALLY (rotated by their angular position so
  // each glyph's base faces the centre, like a real tuner) — upright only at
  // the 12-o'clock pointer, tilting/inverting around the rim. No tick marks.
  return (
    <svg className="tvc-dial-svg" viewBox="0 0 100 100" aria-hidden="true">
      {labels.map((ch, i) => {
        const deg = (i / n) * 360;
        const [nx, ny] = polar(rNum, deg);
        return (
          <text
            key={ch}
            className={numClass}
            x={nx}
            y={ny}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(${deg} ${nx} ${ny})`}
          >
            {ch}
          </text>
        );
      })}
    </svg>
  );
}

// Negative animation-delay that freezes a paused rotor at `angleDeg`. Keeps the
// keyframe animation attached (so hover still spins from this rest angle); the
// delay just shifts where "paused" sits. Dir matches the keyframe: top dial
// spins CW (tvc-knob-cw 0→360), bottom CCW (tvc-knob-ccw 0→-360), period 3.6s.
function freezeDelay(angleDeg: number, dir: 'cw' | 'ccw'): string {
  const period = 3.6;
  const signed = dir === 'cw' ? angleDeg : -angleDeg;
  const frac = (((signed % 360) + 360) % 360) / 360;
  return `-${(frac * period).toFixed(3)}s`;
}

export function RetroTvCabinet({ variant, entering = false, onPower, powerOn = true, dialFreeze = null }: { variant: 'page' | 'serling'; entering?: boolean; onPower?: () => void; powerOn?: boolean; dialFreeze?: { top: number; bottom: number } | null }) {
  return (
    <div className={`tvc-frame tvc-frame--${variant}${entering ? ' tvc-frame--entering' : ''}`} aria-hidden="true">
      {/* Outer faux-wood cabinet: one masked grain ring (rounded inner + outer
          corners, grain retained). Then a single seamless beige plastic bezel
          inside it (rounded corners). */}
      <div className="tvc-wood-frame" />
      <div className="tvc-beige-frame" />
      <div className="tvc-screen-frame">
        {/* Recessed "tube" funnel: four bevel walls that slope from the flat
            beige plastic down to the CRT glass. Filled in MID-GRAY (light at
            the plastic edge → mid → darker gray at the glass, but never black)
            so the recess clearly reads as a physical bezel — distinct from the
            near-black app background showing through the glass. The per-wall
            directional gradients give the depth; the 4 corner diagonals are
            feathered (tvcSoftSeam) so they read as mitre joints, not creases.
            preserveAspectRatio="none" stretches the 1000x1000 viewBox to the
            screen window; the aperture is never filled so the app shows. */}
        <svg className="tvc-bezel-vector" viewBox="0 0 1000 1000" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`tvcBezelTop-${variant}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#c6bfb0" />
              <stop offset="0.54" stopColor="#867f72" />
              <stop offset="1" stopColor="#403c34" />
            </linearGradient>
            <linearGradient id={`tvcBezelRight-${variant}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#403c34" />
              <stop offset="0.42" stopColor="#867f72" />
              <stop offset="1" stopColor="#c6bfb0" />
            </linearGradient>
            <linearGradient id={`tvcBezelBottom-${variant}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#403c34" />
              <stop offset="0.42" stopColor="#867f72" />
              <stop offset="1" stopColor="#c6bfb0" />
            </linearGradient>
            <linearGradient id={`tvcBezelLeft-${variant}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#c6bfb0" />
              <stop offset="0.54" stopColor="#867f72" />
              <stop offset="1" stopColor="#403c34" />
            </linearGradient>
            <filter id={`tvcSoftSeam-${variant}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <path d="M 0,0 L 1000,0 L 932,92 C 790,50 210,52 68,92 Z" fill={`url(#tvcBezelTop-${variant})`} />
          <path d="M 1000,0 L 1000,1000 L 932,908 C 974,810 972,190 932,92 Z" fill={`url(#tvcBezelRight-${variant})`} />
          <path d="M 1000,1000 L 0,1000 L 68,908 C 230,956 770,958 932,908 Z" fill={`url(#tvcBezelBottom-${variant})`} />
          <path d="M 0,1000 L 0,0 L 68,92 C 28,190 28,810 68,908 Z" fill={`url(#tvcBezelLeft-${variant})`} />
          <path d="M 68,92 C 210,52 790,50 932,92" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="3" />
          <path d="M 68,908 C 230,956 770,958 932,908" fill="none" stroke="rgba(0,0,0,0.42)" strokeWidth="3" />
          <path d="M 68,92 C 28,190 28,810 68,908" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="5" />
          <path d="M 932,92 C 972,190 974,810 932,908" fill="none" stroke="rgba(0,0,0,0.42)" strokeWidth="4" />
          {/* glass edge: a crisp dark line where the gray bevel meets the screen */}
          <path d="M 68,92 C 210,52 790,50 932,92 C 972,190 974,810 932,908 C 770,958 230,956 68,908 C 28,810 28,190 68,92 Z" fill="none" stroke="rgba(0,0,0,0.85)" strokeWidth="4" />
          <g filter={`url(#tvcSoftSeam-${variant})`} opacity="0.4">
            <line x1="0" y1="0" x2="68" y2="92" stroke="rgba(255,255,255,0.4)" strokeWidth="4" />
            <line x1="1000" y1="0" x2="932" y2="92" stroke="rgba(0,0,0,0.5)" strokeWidth="5" />
            <line x1="1000" y1="1000" x2="932" y2="908" stroke="rgba(255,255,255,0.45)" strokeWidth="4" />
            <line x1="0" y1="1000" x2="68" y2="908" stroke="rgba(0,0,0,0.45)" strokeWidth="5" />
          </g>
        </svg>
      </div>
      {/* Right control/tuner panel — Sears Solid State: a black panel whose top
          deck pairs a control strip (pilot lamp / AVC switch / power knob) with
          the two stacked numbered tuner dials (VHF top, UHF bottom) on its
          right, over a wood-slat speaker grille filling the rest. Portrait
          re-flows the same parts into a bottom band (a dial in each corner,
          speaker + strip in the middle) — see the .tvc-* rules in index.css.
          Each dial is a fixed pointer on the housing plus a rotating rim-ring +
          knob cap (.tvc-dial-rotor) that spins on hover. */}
      <aside className="tvc-panel">
        <div className="tvc-knobs">
          <div className="tvc-dial-cell">
            <div className="tvc-knob-housing">
              {/* Static clock-face channel numbers on the black dial. */}
              <TvDial band="vhf" />
              {/* Only the selector rotates — its top end sweeps past the fixed
                  numbers to select a channel. The chrome "stadium" sits on top
                  of a wider, raised black-plastic finger-grip ridge. */}
              <div
                className="tvc-dial-rotor tvc-dial-rotor--top"
                style={dialFreeze ? { animationDelay: freezeDelay(dialFreeze.top, 'cw') } : undefined}
              >
                <span className="tvc-dial-ridge" />
                <span className="tvc-dial-pointer" />
              </div>
            </div>
            <span className="tvc-dial-label">VHF</span>
          </div>
          <div className="tvc-dial-cell">
            <div className="tvc-knob-housing">
              <TvDial band="uhf" />
              <div
                className="tvc-dial-rotor tvc-dial-rotor--bottom"
                style={dialFreeze ? { animationDelay: freezeDelay(dialFreeze.bottom, 'ccw') } : undefined}
              >
                <span className="tvc-dial-ridge" />
                <span className="tvc-dial-pointer" />
              </div>
            </div>
            <span className="tvc-dial-label">UHF</span>
          </div>
        </div>
        <div className="tvc-mesh">
          {/* Pilot lamp doubles as the power indicator (no text label — older
              sets just had a coloured lamp): green when the TV is ON, red when
              OFF. */}
          <span className={`tvc-pilot ${powerOn ? 'is-on' : 'is-off'}`} />
          <span className="tvc-control-label tvc-control-label--afc">AFC</span>
          {/* AVC ("Automatic Volume Control") — a small recessed black slide
              switch, purely decorative, sitting between the pilot lamp and the
              power knob like the reference set. */}
          <span className="tvc-avc" aria-hidden="true" />
          <span className="tvc-control-label tvc-control-label--volume">PULL ON<br />VOLUME</span>
          {/* Power: a circular metallic knob.
              - Page cabinet (TV already on): turning it OFF fires the same CRT
                power-off transition as the door/title exit (exitTwilight).
              - Serling cabinet: the knob turns itself ON during the intro.
              Decorative duplicate of the accessible door/title controls, so it's
              kept out of the a11y tree (the subtree is aria-hidden anyway). */}
          <button
            type="button"
            className={`tvc-power tvc-power--${powerOn ? 'on' : 'off'}${onPower ? ' tvc-power--live' : ''}`}
            onClick={onPower ? (e) => { e.stopPropagation(); onPower(); } : undefined}
            tabIndex={-1}
            aria-hidden="true"
            title={onPower ? 'Exit twilight mode' : (powerOn ? 'Power — turn the TV off' : 'Power — turn the TV on')}
          >
            {/* When this knob is the live exit control (page cabinet in
                twilight), show the exit glyph on the knob face; otherwise it's a
                plain power knob with the chrome pointer notch. The accessible
                exit lives in the header (sr-only) since this cabinet subtree is
                aria-hidden. */}
            {onPower
              ? <ExitRunIcon className="tvc-power-icon" />
              : <span className="tvc-power-ind" />}
          </button>
        </div>
        <div className="tvc-speaker" />
      </aside>
      <div className="tvc-brand"><span>Sears</span><span>Solid State</span></div>
    </div>
  );
}
