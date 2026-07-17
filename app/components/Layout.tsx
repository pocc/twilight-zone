import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTheme } from '../hooks/useTheme';
import { Sun, Moon, Lock, Info, ChartPieSlice } from '@phosphor-icons/react';
import { CoverageTiles } from './CoverageTiles';
import { CoverageStatusLine } from './CoverageStatusLine';
import { TwinkleStarfield } from './TwinkleStarfield';
import { EndlessDoorway } from './EndlessDoorway';
import { InfoModal, ModalSectionHeading } from './InfoModal';
import { MigrationCounter } from './MigrationCounter';
import { RetroTvCabinet } from './layout/RetroTvCabinet';
import { coverageSummary } from '../lib/coverageSummary';
import twilightDoorFrameWebp from '../assets/twilight-door-frame.webp';
import twilightDoorPanelWebp from '../assets/twilight-door-panel.webp';
import tzVortexWebp from '../assets/tz-vortex.webp';
import rossAvatarWebp from '../assets/ross-avatar.webp';

// The door-vanish effect is fixed to "flip": the door panel detaches,
// spins on multiple axes, and grows to fill the screen - bridging into
// the fullscreen starfield + Serling moment.

interface LayoutProps {
  children: React.ReactNode;
  onLogoClick: () => void;
  /** Rendered in the header's right column, below the title/links (e.g.
      the wizard step indicator, so the steps sit to the right of the door). */
  headerAside?: React.ReactNode;
}

const SERLING_NARRATION = `You unlock this door with the key of imagination. Beyond it is another dimension.\n\nA dimension of sound. A dimension of sight. A dimension of mind.\n\nYou're moving into a land of both shadow and substance, of things and ideas.\n\nYou've just crossed over into...\nthe Twilight Zone.`;

// Two coverage numbers surfaced in the header Coverage button label:
//   MIGRATABLE_PCT — green "% of what's migratable" health metric (100%).
//   IN_SCOPE_WRITE_SHARE_PCT — gray informational share: of every in-scope
//     write endpoint, how many Twilight Zone actively calls (~23%). This is
//     neither good nor bad; it just keeps the headline from reading as a
//     flat, fake-looking 100%. Rounded for display; the modal shows the
//     precise per-category numbers.
const OVERALL_COVERAGE_PCT = Math.round(coverageSummary.totals.implementation_rate_pct);
const IN_SCOPE_WRITE_SHARE_PCT = Math.round(coverageSummary.totals.in_scope_write_share_pct);

// Door halo as a small spiral galaxy: stars laid along two logarithmic
// spiral arms plus a central core, each twinkling independently. Rendered
// as an inline SVG (viewBox 0-100) so the stars can animate per-element
// (a background-image tile can't twinkle). Deterministic seed => stable.
type HaloStar = { x: number; y: number; r: number; min: number; max: number; dur: number; delay: number };
const HALO_STARS: HaloStar[] = (() => {
  let s = 20260530;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const f = (n: number) => Math.round(n * 100) / 100;
  const cx = 50, cy = 50;
  const out: HaloStar[] = [];
  const mk = (x: number, y: number, bright: number): HaloStar | null => {
    const r = f(0.4 + bright * 0.9 + rnd() * 0.3);
    // Drop any star whose full circle would reach the viewBox edge, so no
    // star ever renders clipped into a half-moon at the boundary.
    const m = 2.5;
    if (x - r < m || x + r > 100 - m || y - r < m || y + r > 100 - m) return null;
    return {
      x: f(x), y: f(y),
      r,
      min: f(0.12 + rnd() * 0.22),
      max: f(0.7 + rnd() * 0.3),
      dur: f(2.4 + rnd() * 3.2),
      delay: f(rnd() * 5),
    };
  };
  // Two spiral arms (log-ish): r grows, theta winds with r.
  const arms = 2, perArm = 62, twist = 3.1;
  for (let a = 0; a < arms; a++) {
    const base = a * (Math.PI * 2 / arms);
    for (let i = 0; i < perArm; i++) {
      const t = i / perArm;
      const r = 7 + t * 43;
      const theta = base + t * twist * Math.PI + (rnd() - 0.5) * 0.28;
      const rr = r + (rnd() - 0.5) * (5 + t * 9);
      const star = mk(cx + rr * Math.cos(theta), cy + rr * Math.sin(theta), rnd() > 0.9 ? 1 : rnd() * 0.4);
      if (star) out.push(star);
    }
  }
  // Core scatter (denser, brighter near the middle - mostly hidden behind
  // the door but the inner arm bases read as the galactic core).
  for (let i = 0; i < 44; i++) {
    const ang = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.6) * 15;
    const star = mk(cx + rr * Math.cos(ang), cy + rr * Math.sin(ang), 0.2 + rnd() * 0.6);
    if (star) out.push(star);
  }
  return out;
})();

export function Layout({ children, onLogoClick, headerAside }: LayoutProps) {
  const { isDark, toggle, isTwilight, toggleTwilight, goDark } = useTheme();
  // Halo: the intro reveal turn plays from +1s to +2s after load; enable
  // the hover spin only after that (2s) so the two rotations don't overlap.
  const [haloReady, setHaloReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setHaloReady(true), 2000);
    return () => clearTimeout(t);
  }, []);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);

  // ── CRT Easter Egg ──────────────────────────────────────────
  const [crtActive, setCrtActive] = useState(false);
  const [crtText, setCrtText] = useState('');
  const [crtPowerOff, setCrtPowerOff] = useState(false);
  const [crtStatic, setCrtStatic] = useState(true);
  // The TV "powers on" as part of the intro. powerOnSpiral shows a STATIC
  // Twilight-Zone spiral on the screen, started at the very beginning of the
  // intro (the door flip) — not when the Serling screen lights up — so it's
  // already present (no pop-in) when the screen is revealed, then it fades to
  // the starfield. serlingOn drives the power knob OFF→ON at the Serling reveal.
  const [powerOnSpiral, setPowerOnSpiral] = useState(false);
  const [serlingOn, setSerlingOn] = useState(false);
  // Angle (deg) each Serling dial reached when the narration was dismissed, so
  // the twilight (page) cabinet's dials stay at that rotated channel instead of
  // snapping back to the default 2/14 rest position.
  const [dialFreeze, setDialFreeze] = useState<{ top: number; bottom: number } | null>(null);
  // The "[ CLICK ANYWHERE TO EXIT ]" hint appears 200ms AFTER the Serling
  // narration finishes typing, so it doesn't pop in the instant the last
  // character lands. Gated separately from crtText completion.
  const [exitHintReady, setExitHintReady] = useState(false);
  // Exit animation: a blurred white door spins back from screen center to
  // the header door position (the inverse of the intro flip). returnStyle
  // carries the measured geometry (fixed box + --ret-* transform vars).
  const [doorReturning, setDoorReturning] = useState(false);
  const [returnStyle, setReturnStyle] = useState<React.CSSProperties>({});
  // Exit transition: a CRT power-off (TV turn-off) - the screen collapses
  // to a bright horizontal line then a point, revealing the base version
  // underneath (twilight -> base).
  const [exitPowerOff, setExitPowerOff] = useState(false);
  const crtTimerRef = useRef<number | null>(null);
  // Intro setTimeout ids, tracked so a click mid-animation can cancel them.
  const introTimersRef = useRef<number[]>([]);
  // Guards the "finish entering twilight" path so a click and the click's
  // own pointerdown (or a rapid double-click) can't run it twice and end up
  // toggling twilight back off. Reset at the start of each fresh enter.
  const introResolvedRef = useRef(false);

  // While the fullscreen Serling/CRT overlay is up, lock document scroll. The
  // tall app underneath would otherwise show a scrollbar at the viewport edge
  // (outside the TV, breaking immersion), and the narration page never needs
  // to scroll. Restored on dismiss.
  useEffect(() => {
    if (!crtActive) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [crtActive]);

  // #4 (improvement): door briefly swings open on click before the CRT
  // overlay appears. Visual transition between the steady-state pulse
  // and the Serling narration: 1800ms of rotateY hinge-rotation on the
  // panel layer (frame stays put, galaxy is revealed behind), then the
  // CRT static fades in over the open door.
  const [doorSwinging, setDoorSwinging] = useState(false);

  // Ref to the panel <img> - needed so the "flip" effect can measure
  // the panel's on-screen position at click time and compute the
  // translate + scale needed to grow it to fullscreen-center. We can't
  // hardcode this because the panel's position in the header shifts
  // with viewport width.
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ── Morphing starfield (door halo → fullscreen → back) ──────────
  // heroRef measures the door's on-screen rect at click time so the
  // warp field can start scaled down onto the door and grow to fill the
  // viewport (and shrink back on exit). warpVisible mounts the field;
  // warpFull toggles the identity transform that drives the morph.
  const heroRef = useRef<HTMLButtonElement | null>(null);
  const [warpVisible, setWarpVisible] = useState(false);
  const [warpFull, setWarpFull] = useState(false);
  const [warpFading, setWarpFading] = useState(false);
  const [warpStyle, setWarpStyle] = useState<React.CSSProperties>({});
  const warpHideTimerRef = useRef<number | null>(null);
  // `entering` spans the intro (door flip): while true, the starfield AND the
  // TV cabinet fade in together with a wavy/spooky materialize (see the
  // `.spooky-in` / `.tvc-frame--entering` CSS) — instead of the starfield
  // geometrically expanding from the door. The flipping door panel sits above
  // both (z 9999 > 9998), so it keeps z-precedence through the whole fade.
  const [entering, setEntering] = useState(false);
  // Dwell-to-enter: hovering the door for 5s triggers the same transition
  // as a click. Timer is armed on mouse-enter and cancelled on leave.
  const hoverTimerRef = useRef<number | null>(null);

  // The starfield no longer geometrically expands out of the door. It now
  // mounts already at fullscreen (identity transform) and FADES in with a
  // wavy/spooky materialize, alongside the TV cabinet (see `.spooky-in`). So
  // this just pins the --sf-* vars to identity (the base rule's default
  // --sf-scale is 0.18, which would re-introduce the grow — hence the
  // explicit 1 here).
  const computeWarpStart = useCallback((): React.CSSProperties => {
    return {
      ['--sf-tx' as string]: '0px',
      ['--sf-ty' as string]: '0px',
      ['--sf-scale' as string]: '1',
    } as React.CSSProperties;
  }, []);

  // Measure the live door panel's on-screen box and compute the geometry
  // for the exit "returning door": it starts scaled-up at viewport center
  // and flies back to sit exactly on the header panel. Mirrors the intro
  // flip's measure-rect technique (computeWarpStart / the --flip-* vars).
  const computeReturnGeometry = useCallback((): React.CSSProperties | null => {
    // Measure the DOOR BUTTON (heroRef), not the base-door <img> (panelRef):
    // the exit transition always lands in twilight, where panelRef has
    // unmounted (EndlessDoorway replaces it) AND the TV cabinet has reflowed
    // the header into the screen window. heroRef is present in every mode and
    // reflects that final framed position, so the returning door lands on the
    // actual on-screen exit door instead of where it used to sit.
    const hero = heroRef.current;
    if (!hero) return null;
    const hr = hero.getBoundingClientRect();
    if (hr.width === 0 || hr.height === 0) return null;
    // The twilight (exit) white door occupies this sub-rect of the hero box
    // (see `.twilight-door-hero.is-active svg.twilight-door-panel`: left 21%,
    // top 2.5%, width 58%; the panel svg is 100x180, so height = width*1.8).
    const w = hr.width * 0.58;
    const h = w * (180 / 100);
    const left = hr.left + hr.width * 0.21;
    const top = hr.top + hr.height * 0.025;
    const cx = left + w / 2;
    const cy = top + h / 2;
    // Delta to move the door's center to the viewport center (start pose).
    const tx = window.innerWidth / 2 - cx;
    const ty = window.innerHeight / 2 - cy;
    // Cover the viewport from center, capped (same logic/cap as the intro
    // flip) so the texture doesn't blow up to mush on huge displays.
    const viewportDiag = Math.hypot(window.innerWidth, window.innerHeight);
    const scale = Math.min(10, (viewportDiag * 1.1) / w);
    return {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: `${w}px`,
      height: `${h}px`,
      ['--ret-tx' as string]: `${tx}px`,
      ['--ret-ty' as string]: `${ty}px`,
      ['--ret-scale' as string]: `${scale}`,
    } as React.CSSProperties;
  }, []);

  // Leave the Twilight Zone with a 2s CRT power-off transition (instead of
  // an instant theme snap). Switch to base immediately so it renders behind
  // the covering power-off layer, which collapses to a line then a point
  // (2000ms, see .twilight-exit-poweroff) to reveal the base version. Shared
  // by every exit path (door click, header EXIT sign, Escape). Guarded so it
  // can't stack.
  const exitTwilight = useCallback(() => {
    if (exitPowerOff) return;
    setExitPowerOff(true);
    if (isTwilight) toggleTwilight();
    window.setTimeout(() => setExitPowerOff(false), 2050);
  }, [exitPowerOff, isTwilight, toggleTwilight]);

  // Title (h1) click: return to start AND normalize the view to base-dark
  // mode from any other mode. Twilight exits via the graceful CRT power-off
  // (exitTwilight); light base mode flips to dark. goDark fires alongside the
  // twilight exit too, so the base revealed underneath the power-off is dark.
  const handleTitleClick = useCallback(() => {
    onLogoClick();
    if (!isDark) goDark();
    if (isTwilight) exitTwilight();
  }, [onLogoClick, isDark, isTwilight, goDark, exitTwilight]);

  const handleEnterTwilight = useCallback(() => {
    // Cancel any armed hover-dwell timer. Without this, hovering the door
    // (which arms a 5s enter/exit timer) and THEN clicking before it fires
    // leaves the stale timer live — it would later fire and kick off a second
    // enter/exit transition on top of the one the click already started.
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    if (isTwilight) {
      // Already in twilight - leave with the rotating transition.
      exitTwilight();
      return;
    }
    // Fresh enter: arm the resolve guard so a click during the intro can
    // skip straight to the twilight version exactly once.
    introResolvedRef.current = false;
    setSerlingOn(false);
    setDialFreeze(null);
    // Power-on spiral starts NOW — at the very beginning of the door flip — so
    // it's already on the screen (no pop-in) by the time the flip reveals it,
    // then fades to the starfield. Static (no rotation). Tracked in the intro
    // timer list so a mid-flip skip cancels it.
    setPowerOnSpiral(true);
    introTimersRef.current.push(window.setTimeout(() => setPowerOnSpiral(false), 1800));
    // 0. Starfield + TV: mount the warp field fullscreen and the TV cabinet,
    //    then fade BOTH in together with a wavy/spooky materialize (the
    //    `entering` flag drives `.spooky-in` on the warp and
    //    `.tvc-frame--entering` on the cabinet). No geometric expand from the
    //    door anymore. `.full` is still toggled so the live star-warp twinkle
    //    loop runs; with --sf-scale pinned to 1 it no longer animates size.
    if (warpHideTimerRef.current) { clearTimeout(warpHideTimerRef.current); warpHideTimerRef.current = null; }
    setWarpStyle(computeWarpStart());
    setEntering(true);
    setWarpVisible(true);
    setWarpFull(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setWarpFull(true)));

    // 1. Intro: the door flips/rotates into the screen and the starfield
    //    expands to fullscreen over INTRO_MS; then the CRT static takes
    //    over for the Serling narration. Matches the flip + warp durations.
    const INTRO_MS = 1100;

    // For the "flip" effect: measure the panel's current viewport
    // position so the keyframe can translate it to viewport center
    // and scale it up to fill the screen. We write the deltas as CSS
    // custom properties on the panel element itself, then the
    // animation references var(--flip-tx) etc. The numbers are
    // pixel-exact and computed at click-time, so the effect works at
    // any viewport size without responsive guesswork in CSS.
    //
    // We start the CRT fade-in slightly BEFORE the flip ends (400ms
    // before) so the panel-shrinking-to-nothing and the CRT-static-
    // fading-in overlap - a continuous handoff rather than a hard cut.
    if (panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      const panelCx = rect.left + rect.width / 2;
      const panelCy = rect.top + rect.height / 2;
      const viewportCx = window.innerWidth / 2;
      const viewportCy = window.innerHeight / 2;
      const tx = viewportCx - panelCx;
      const ty = viewportCy - panelCy;
      // Cover the viewport diagonal at peak, with headroom. Use the
      // panel's CURRENT rendered width (not the natural 468px) so
      // we account for the clamp(120px, 28vw, 220px) the header
      // applies. Cap the scale so the texture doesn't blow up to
      // mush on huge displays.
      const viewportDiag = Math.hypot(window.innerWidth, window.innerHeight);
      const targetScale = Math.min(10, (viewportDiag * 1.1) / rect.width);
      panelRef.current.style.setProperty('--flip-tx', `${tx}px`);
      panelRef.current.style.setProperty('--flip-ty', `${ty}px`);
      panelRef.current.style.setProperty('--flip-scale', `${targetScale}`);
    }

    setDoorSwinging(true);
    // The starfield reaches fullscreen and the CRT static takes over at
    // INTRO_MS; a short beat later the Serling narration starts typing.
    // Timer ids are tracked so a click mid-animation can cancel them.
    introTimersRef.current.push(window.setTimeout(() => {
      setCrtActive(true);
      setCrtText('');
      setCrtPowerOff(false);
      // No static flash before the narration - go straight from the warp
      // hand-off into the typed Serling text on a clean dark screen.
      setCrtStatic(false);
      setExitHintReady(false);
    }, INTRO_MS));
    introTimersRef.current.push(window.setTimeout(() => {
      setDoorSwinging(false);

      introTimersRef.current.push(window.setTimeout(() => {
        setCrtStatic(false);
        let i = 0;
        const tick = () => {
          if (i <= SERLING_NARRATION.length) {
            setCrtText(SERLING_NARRATION.slice(0, i));
            i++;
            crtTimerRef.current = window.setTimeout(tick, 25);
          } else {
            // Narration done - wait 200ms before revealing the exit hint.
            crtTimerRef.current = window.setTimeout(() => setExitHintReady(true), 200);
          }
        };
        tick();
      }, 150));
    }, INTRO_MS));
  }, [isTwilight, exitTwilight, computeWarpStart]);

  // Finish entering the ethereal twilight version from ANY point in the
  // intro - whether the door is still flipping (doorSwinging) or the CRT
  // narration is showing. Clicking the door, clicking anywhere during the
  // flip, clicking the CRT overlay, or pressing Escape all route here, so
  // the transition always resolves INTO twilight - it never aborts back to
  // the normal interface and never restarts the flip. Guarded by
  // introResolvedRef so a click + its own pointerdown (or a double-click)
  // can't run it twice and toggle twilight straight back off.
  const dismissCrt = useCallback(() => {
    if (introResolvedRef.current) return;
    introResolvedRef.current = true;
    // Capture the angle each spinning Serling dial reached RIGHT NOW (the
    // overlay is still mounted), so the twilight cabinet's dials freeze at that
    // rotated channel instead of resetting to the default rest position.
    const readDialAngle = (sel: string): number => {
      const el = document.querySelector(sel);
      if (!el) return 0;
      const m = getComputedStyle(el).transform.match(/matrix\(([^)]+)\)/);
      if (!m) return 0;
      const [a, b] = m[1].split(',').map(Number);
      return (Math.atan2(b, a) * 180) / Math.PI;
    };
    setDialFreeze({
      top: readDialAngle('.crt-overlay .tvc-dial-rotor--top'),
      bottom: readDialAngle('.crt-overlay .tvc-dial-rotor--bottom'),
    });
    // Cancel pending intro/narration timers so the scripted sequence can't
    // keep firing (e.g. popping the CRT overlay) after we've jumped to the
    // end state.
    introTimersRef.current.forEach(clearTimeout);
    introTimersRef.current = [];
    if (crtTimerRef.current) { clearTimeout(crtTimerRef.current); crtTimerRef.current = null; }
    // Clear the power-on spiral (its auto-off timer was just cancelled above).
    setPowerOnSpiral(false);
    setDoorSwinging(false);
    // Starfield: fade the fullscreen field out into the interface (stays
    // fullscreen - it no longer retracts back to the door). Keeping the
    // .full transform means only opacity animates; unmount after the fade.
    setWarpFading(true);
    if (warpHideTimerRef.current) clearTimeout(warpHideTimerRef.current);
    warpHideTimerRef.current = window.setTimeout(() => {
      setWarpVisible(false);
      setWarpFading(false);
      setWarpFull(false);
    }, 700);
    // Enable twilight theme BEFORE the CRT overlay is removed so the
    // starfield is already painted underneath - no flash of the plain
    // dark-mode background when the overlay disappears.
    if (!isTwilight) toggleTwilight();
    // Intro fade is done; the steady-state twilight TV cabinet (gated on
    // isTwilight) now owns the frame, so drop the entering-phase cabinet.
    setEntering(false);
    setCrtPowerOff(true);
    // Exit animation: launch the inverse-flip "returning door" - a blurred
    // white door spins back from screen center to the header door position
    // - and fade the CRT screen out underneath it. We defer the launch by
    // two animation frames so the page TV cabinet (mounted the instant
    // isTwilight flips true) has reflowed the header into the screen window
    // FIRST; otherwise computeReturnGeometry() measures the door at its old,
    // un-framed position and the door lands in the wrong place.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const geo = computeReturnGeometry();
      if (geo) {
        setReturnStyle(geo);
        setDoorReturning(true);
        window.setTimeout(() => setDoorReturning(false), 1000);
      }
    }));
    window.setTimeout(() => {
      setCrtActive(false);
      setCrtPowerOff(false);
      setCrtStatic(true);
      setCrtText('');
      setExitHintReady(false);
    }, 1050);
  }, [isTwilight, toggleTwilight, computeReturnGeometry]);

  // Auto power-on: the instant the Serling screen lights up (crtActive), play a
  // short snow burst — the set "warming up" — then turn the power knob from OFF
  // to ON. This is the visible "turning on" beat of the door-flip intro; no
  // manual knob click is needed. Cleared when the overlay goes away.
  useEffect(() => {
    if (!crtActive) { setSerlingOn(false); return; }
    setSerlingOn(false);
    const tOn = window.setTimeout(() => setSerlingOn(true), 520);
    return () => clearTimeout(tOn);
  }, [crtActive]);

  // Door click: if the intro is mid-flight, skip straight to the twilight
  // version; otherwise start the enter (or exit, if already in twilight).
  const handleDoorClick = useCallback(() => {
    if (doorSwinging || crtActive) { dismissCrt(); return; }
    handleEnterTwilight();
  }, [doorSwinging, crtActive, dismissCrt, handleEnterTwilight]);

  // While the door is flipping, a pointerdown ANYWHERE skips the rest of
  // the intro and enters the twilight version (instead of aborting it or
  // restarting the flip).
  useEffect(() => {
    if (!doorSwinging) return;
    const onAnyClick = () => dismissCrt();
    window.addEventListener('pointerdown', onAnyClick);
    return () => window.removeEventListener('pointerdown', onAnyClick);
  }, [doorSwinging, dismissCrt]);

  // Hovering the base door for 5s ENTERS the Twilight Zone (same as a click).
  // Once inside, the header EXIT sign is the explicit exit control, so hovering
  // the scary door no longer starts a hidden exit timer.
  const HOVER_ENTER_MS = 5000;
  const handleDoorMouseEnter = useCallback(() => {
    if (crtActive || doorSwinging) return;
    if (isTwilight) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      handleEnterTwilight();
    }, HOVER_ENTER_MS);
  }, [isTwilight, crtActive, doorSwinging, handleEnterTwilight]);
  const handleDoorMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
  }, []);

  // Escape: during the intro (door flip or CRT narration) it skips straight
  // into the twilight version; once already in twilight it exits back to the
  // normal interface.
  useEffect(() => {
    const inTransition = doorSwinging || crtActive;
    if (!isTwilight && !inTransition) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.shiftKey) {
        if (inTransition) dismissCrt();
        else if (isTwilight) exitTwilight();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTwilight, doorSwinging, crtActive, dismissCrt, exitTwilight]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (crtTimerRef.current) clearTimeout(crtTimerRef.current);
      if (warpHideTimerRef.current) clearTimeout(warpHideTimerRef.current);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      introTimersRef.current.forEach(clearTimeout);
    };
  }, []);



  return (
    <>
      {/* Entered-twilight page background: full-bleed twinkling starfield
          (same per-star shimmer as the door halo). Mounted only in twilight
          so the normal page isn't running hundreds of idle animations. */}
      {isTwilight && (
        <div className="twilight-bg-stars" aria-hidden="true">
          <TwinkleStarfield seed={31337} count={300} sparkId="sf-spark-bg" />
        </div>
      )}
      {/* Morphing starfield: grows from the door's halo to fullscreen on
          enter, then fades into the interface on exit. Rendered as a
          root-level sibling (the door hero has perspective, which would
          trap a fixed descendant) and sits just behind the transparent
          CRT overlay as its backdrop. */}
      {warpVisible && (
        <div
          className={`twilight-starfield-warp ${warpFull ? 'full' : ''} ${warpFading ? 'fading' : ''} ${entering ? 'spooky-in' : ''}`}
          style={warpStyle}
          aria-hidden="true"
        >
          <div className="sf-tile" />
          {/* Twinkling overlay: same per-star opacity+scale-pop as the door
              halo. Two copies (offset 10s via CSS) ride the SAME star-warp
              zoom as the tile layers, so the twinkling stars travel outward
              with the warp instead of sitting static over it. Same seed =>
              identical positions => seamless cross-fade. */}
          <div className="sf-twinkle-layer">
            <TwinkleStarfield seed={70113} count={180} sparkId="sf-spark-warp-a" />
          </div>
          <div className="sf-twinkle-layer sf-twinkle-layer-b">
            <TwinkleStarfield seed={70113} count={180} sparkId="sf-spark-warp-b" />
          </div>
        </div>
      )}

      {/* Returning door (exit): inverse of the intro flip. A blurred white
          door spins back from screen center to the header door position.
          Root-level fixed sibling so the hero's perspective doesn't trap
          it; sits above the CRT overlay (which fades out beneath it). */}
      {doorReturning && (
        <div className="twilight-door-return" style={returnStyle} aria-hidden="true">
          {/* White rectangle fanned 15deg behind the door */}
          <div className="twilight-door-return-rect" />
          {/* White door silhouette in front */}
          <img
            src={twilightDoorPanelWebp}
            alt=""
            className="twilight-door-return-panel"
            draggable={false}
          />
        </div>
      )}

      {/* Exit transition: CRT power-off (TV turn-off) - collapses to a
          bright horizontal line then a point, revealing the base version
          (already toggled on) underneath. Topmost layer during the
          twilight -> base switch. */}
      {exitPowerOff && <div className="twilight-exit-poweroff" aria-hidden="true" />}

      {/* Power-on spiral: a STATIC Twilight-Zone swirl on the TV screen, shown
          from the very start of the intro (the door flip) so it's already
          present when the flip reveals the screen — then it fades to the
          starfield. Root-level + fixed, clipped to the screen window (NOT the
          whole viewport); sits behind the transparent CRT overlay (z 9998 <
          9999) so it shows through both the entering cabinet and the Serling
          screen, beneath the narration glass. */}
          {powerOnSpiral && (
            <div className="crt-spiral" aria-hidden="true">
              <img className="crt-spiral-img" src={tzVortexWebp} alt="" draggable={false} />
            </div>
          )}

      {/* CRT Overlay */}
      {crtActive && (
        <div className={`crt-overlay tvc-host tvc-host--serling ${crtPowerOff ? 'powering-off' : ''}`} onClick={dismissCrt}>
          {crtStatic && <div className="crt-static" />}
          <div className="crt-scanlines" />
          <RetroTvCabinet variant="serling" powerOn={serlingOn} />
          <div className="crt-screen">
            <div className="crt-scanlines" />
            {/* minHeight reserves the FINAL height up front - exactly the
                full narration PLUS the "[ CLICK ANYWHERE TO EXIT ]" button
                block (measured content bottom = 379px in layout coords) - so
                the panel neither grows when the exit hint appears (the
                reported bump) nor leaves a dead line below it. */}
            <div className="crt-text crt-typewriter" style={{ minHeight: '380px' }}>
              {crtText}
              {crtText.length < SERLING_NARRATION.length && (
                <span className="inline-block w-2 h-4 bg-gray-400 ml-0.5 align-middle" style={{ animation: 'crt-flicker 0.5s steps(1) infinite' }} />
              )}
              {crtText.length >= SERLING_NARRATION.length && exitHintReady && (
                <button
                  type="button"
                  onClick={dismissCrt}
                  className="mt-6 block px-4 py-2 text-sm font-mono text-gray-400 border border-gray-600 rounded hover:text-white hover:border-gray-400 transition relative z-10 cursor-pointer"
                >
                  [ CLICK ANYWHERE TO EXIT ]
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Skip-to-main-content link: invisible until keyboard-focused.
          Lets keyboard / screen-reader users bypass the header (logo,
          theme toggles, about/security disclosures) and jump straight
          to the wizard content. CSS in app/index.css. */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Retro TV cabinet around the live app. Gated on isTwilight ALONE
          (not !crtActive) so that during the Serling -> twilight exit the
          page cabinet is already mounted underneath the fading CRT overlay
          (z 9991 vs 9999) - the two identical cabinets overlap, so the TV
          outline stays continuous through the white-door exit animation
          instead of dropping for the ~1s the overlay takes to fade.
          Decorative + pointer-events:none, so the app stays interactive. */}
      {(isTwilight || entering) && <RetroTvCabinet variant="page" entering={entering && !isTwilight} onPower={isTwilight ? exitTwilight : undefined} dialFreeze={dialFreeze} />}

      <div className={`min-h-screen flex flex-col ${isTwilight ? 'tvc-host tvc-host--page' : ''}`}>
      <div className="container mx-auto px-4 py-8 max-w-4xl flex-1">
        <header className="twilight-header mb-8 relative">
          {/* Light/dark theme toggle, parked top-right of the header. Hidden
              in twilight mode, where light/dark is irrelevant (the twilight
              theme overrides both). */}
          {!isTwilight && (
            <div className="absolute right-0 top-0 flex items-center gap-1 z-20">
              <button
                type="button"
                onClick={toggle}
                className="p-2 text-gray-400 hover:text-orange-500 transition cursor-pointer"
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark
                  ? <Moon size={20} weight="fill" aria-hidden="true" />
                  : <Sun size={20} weight="fill" aria-hidden="true" />}
              </button>
            </div>
          )}
          {/* The visible twilight exit affordance is the TV power knob (it
              shows a phosphor exit glyph and fires exitTwilight). The cabinet
              subtree is aria-hidden/decorative, so this sr-only button keeps a
              focusable, announced "Exit Twilight Mode" control for keyboard and
              screen-reader users (Escape also exits). */}
          {isTwilight && (
            <button
              type="button"
              onClick={exitTwilight}
              className="sr-only"
              aria-label="Exit Twilight Mode"
            >
              Exit Twilight Mode
            </button>
          )}
          {/* Door + galaxy artwork on the left; title block on the right.
              The entire image is a clickable hotspot that enters twilight
              mode (also armed by hovering the door for 5s). A rotating
              star halo orbits the door behind the art layers. */}
          <button
            ref={heroRef}
            type="button"
            onClick={handleDoorClick}
            onMouseEnter={handleDoorMouseEnter}
            onMouseLeave={handleDoorMouseLeave}
            className={`twilight-door-hero effect-flip ${isTwilight ? 'is-active' : ''} ${doorSwinging ? 'is-swinging' : ''}`}
            aria-label={isTwilight ? 'Exit the Twilight Zone' : 'Enter the Twilight Zone'}
            title={isTwilight ? 'Exit the Twilight Zone' : 'Entering the Twilight Zone...'}
          >
            {/* Spiral-galaxy star halo behind the art. Outer div does the
                one-shot intro reveal turn; inner .twilight-door-halo-spin
                does the on-hover spin (enabled only once .halo-ready is set
                ~2s after load, so the two don't overlap). Each star
                twinkles independently. */}
            <div className="twilight-door-halo" aria-hidden="true">
              <div className={`twilight-door-halo-spin ${haloReady ? 'halo-ready' : ''}`}>
                <svg className="twilight-door-halo-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
                  <defs>
                    {/* Sparkle/twinkle shape: the concave 4-point star formed
                        as the residual gap between four circles in a square -
                        points on the axes (±1), edges pinched toward center
                        on the diagonals. Unit shape, scaled per star. */}
                    <path id="halo-spark" d="M0 -1 Q0 0 1 0 Q0 0 0 1 Q0 0 -1 0 Q0 0 0 -1 Z" />
                  </defs>
                  {HALO_STARS.map((st, i) => (
                    /* Positioning on the <g>; the twinkle (opacity + scale
                       pop) animates the <use> about the shape's own centre
                       so it pulses in place. */
                    <g key={i} transform={`translate(${st.x} ${st.y}) scale(${st.r})`}>
                      <use
                        href="#halo-spark"
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
              </div>
            </div>
            {/* Door artwork swaps by version:
                - Pre-entry (base/light/dark): the ornate fantasy composite
                  (galaxy back, swinging panel middle, stone frame front).
                  The flip-to-fullscreen intro animates THIS panel.
                - Entered twilight (.is-active): the stark black-and-white
                  Endless Doorway (Twilight Zone title-card door + a
                  receding hall of doors revealed when it swings open). */}
            {isTwilight ? (
              <EndlessDoorway />
            ) : (
              <>
                {/* 2-layer composite: panel middle (animates) + frame front.
                    Both absolutely positioned; the frame img drives the layout
                    box-size. (Behind the door is the rotating star halo, not a
                    galaxy image.)

                    The panel is a div (not a bare img) so the door art AND the
                    live "ENTER" word live inside it and swing/flip together —
                    mirroring the EXIT slab in EndlessDoorway. The baked grey
                    "ENTER" plate was dropped from the art; the word is now live
                    white Metamorphous text centered on the door's lock rail. */}
                <div
                  ref={panelRef}
                  className="twilight-door-panel"
                  aria-hidden="true"
                >
                  <img
                    src={twilightDoorPanelWebp}
                    alt=""
                    aria-hidden="true"
                    className="tz-door-panel-img"
                    draggable={false}
                  />
                  <span className="tz-door-enter" aria-hidden="true">ENTER</span>
                </div>
                <img
                  src={twilightDoorFrameWebp}
                  alt=""
                  aria-hidden="true"
                  className="twilight-door-frame"
                  draggable={false}
                />
              </>
            )}
          </button>
          <div className="twilight-header-text">
            {/* Italic Playfair (fantastical-title) only in twilight; regular
                mode keeps the plain bold Cloudflare-orange sans-serif. */}
            <h1
              onClick={handleTitleClick}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTitleClick(); } }}
              role="button"
              tabIndex={0}
              aria-label="Twilight Zone — return to start and dark mode"
              className={`cursor-pointer transition ${
                isTwilight
                  ? 'fantastical-title text-violet-300 hover:text-violet-200'
                  : 'text-5xl font-bold text-orange-500 hover:text-orange-400'
              }`}
            >
              Twilight Zone
            </h1>
            <p className="text-gray-400 mt-2">
              Cloudflare Zone Migration Tool <span className="text-gray-400">v1.0.0</span>
              <MigrationCounter />
            </p>
            {/* Links on their own line below the subtitle. */}
            <p className="mt-1 text-gray-400">
              <button
                type="button"
                onClick={() => { setAboutOpen(true); setSecurityOpen(false); setCoverageOpen(false); }}
                className="inline-flex items-center gap-1 text-orange-400/70 hover:text-orange-400 transition underline underline-offset-2 cursor-pointer"
                aria-haspopup="dialog"
              >
                <Info size={20} weight="fill" aria-hidden="true" />
                About
              </button>
              <span className="mx-1.5">&middot;</span>
              <button
                type="button"
                onClick={() => { setSecurityOpen(true); setAboutOpen(false); setCoverageOpen(false); }}
                className="inline-flex items-center gap-1 text-orange-400/70 hover:text-orange-400 transition underline underline-offset-2 cursor-pointer"
                aria-haspopup="dialog"
              >
                <Lock size={20} weight="fill" aria-hidden="true" />
                Security
              </button>
              <span className="mx-1.5">&middot;</span>
              <button
                type="button"
                onClick={() => { setCoverageOpen(true); setAboutOpen(false); setSecurityOpen(false); }}
                className="inline-flex items-center gap-1 text-orange-400/70 hover:text-orange-400 transition underline underline-offset-2 cursor-pointer"
                aria-haspopup="dialog"
                aria-label={`Coverage by category - ${OVERALL_COVERAGE_PCT}% of migratable zone resources implemented; ${IN_SCOPE_WRITE_SHARE_PCT}% of all in-scope write endpoints. Opens a modal with per-category detail.`}
              >
                <ChartPieSlice size={20} weight="fill" aria-hidden="true" />
                Coverage
              </button>
              <span className="mx-1.5">&middot;</span>
              {/* Maker's mark — small avatar + name, inline with the
                  About/Security/Coverage links (à la Clear Skies). Links to
                  user.com; no email, no absolute-positioned card. */}
              <a
                href="https://user.com/about/"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-1 text-orange-400/70 hover:text-orange-400 transition underline underline-offset-2 cursor-pointer"
                title="Made by the maintainer — user.com"
              >
                {/* Avatar photo in every theme, including twilight (no longer
                    swapped for the UserCircle phosphor icon). */}
                <img
                  src={rossAvatarWebp}
                  alt=""
                  width={20}
                  height={20}
                  className="h-5 w-5 rounded-full object-cover ring-1 ring-gray-700 group-hover:ring-orange-400 transition"
                  draggable={false}
                />
                the maintainer
              </a>
            </p>
            {/* Always-visible coverage status (static % fallback, enriched by
                the live spec-drift monitor). Sits directly under the links. */}
            <CoverageStatusLine />
            {/* Wizard steps sit to the right of the door image. The text
                column is stretched to the door's height and distributes its
                children top-to-bottom (`.twilight-header-steps { margin-top:
                auto }`), so the steps land at the bottom-right beside the door
                rather than tucked up under the links. Shown on every screen
                including the landing/Setup page, where App renders them with
                nothing selected (all four steps greyed) until the migration
                starts. */}
            {headerAside && <div className="twilight-header-steps">{headerAside}</div>}
          </div>
        </header>

        <InfoModal
          open={aboutOpen}
          onClose={() => setAboutOpen(false)}
          title="About Twilight Zone"
          eyebrow="What is this?"
          footer={
            <div className="flex items-center justify-between">
              <span>No installation required - open the URL and go.</span>
              <span>v1.0.0</span>
            </div>
          }
        >
          <p>
            Twilight Zone automates Cloudflare zone migrations between accounts. It exports DNS
            records, zone settings, rulesets, workers, load balancers, access policies, and 30+
            other resource types from a source zone and recreates them in a destination account:
            real-time streaming progress, dependency-aware ordering, and a detailed migration report.
          </p>

          <ModalSectionHeading>Why this exists</ModalSectionHeading>
          <p>
            Moving a zone from one Cloudflare account to another is otherwise a slow, manual,
            error-prone slog - there is no &quot;move zone between accounts&quot; button. This tool is built
            for Cloudflare Customer Solutions Engineers and customers handling mergers, reorgs,
            billing changes, and partner-managed &rarr; customer-owned handoffs, so an account-to-account
            migration becomes a reviewable, repeatable wizard instead of a hand-run checklist.
          </p>

          <ModalSectionHeading>How it works</ModalSectionHeading>
          <ol className="list-decimal list-inside space-y-1 text-gray-300">
            <li><span className="text-gray-400 font-medium">Setup</span> - Enter API credentials for source and destination accounts.</li>
            <li><span className="text-gray-400 font-medium">Scope</span> - Select and review every resource, provide any secrets and certificates the API can&apos;t export, then start the migration.</li>
            <li><span className="text-gray-400 font-medium">Migrate</span> - Watch the migration stream in real time, then work through any manual post-migration steps.</li>
            <li><span className="text-gray-400 font-medium">Results</span> - Review the read-only verification results and download a full report.</li>
          </ol>

          <ModalSectionHeading>What migrates</ModalSectionHeading>
          <p>
            DNS records, zone settings (50+), page rules, WAF/cache/redirect/transform rulesets,
            workers (scripts + bindings), KV namespaces, R2 buckets, D1 databases, queues, load
            balancers (monitors, pools, LBs), spectrum apps, custom hostnames, access apps + policies,
            firewall rules, rate limits, email routing, waiting rooms, turnstile widgets, Zaraz config,
            Argo Smart Routing, Tiered Caching, and Bot Fight Mode.
          </p>
          <p className="text-gray-400 text-xs">
            <span className="font-medium">Requires manual steps:</span> KV/R2/D1 data, Durable Object data
            (namespaces/databases are created empty - the exact commands are listed in the Migrate
            step&apos;s post-migration actions and in the migration report).{' '}
            <span className="font-medium">Not migrated:</span> analytics, API tokens, billing.
          </p>
          <p className="text-gray-400 text-xs">
            For the full per-endpoint coverage matrix, open the category tiles on the landing page
            or the &quot;Coverage&quot; panel in the header.
          </p>

          {/* User-facing restatement of the product principles. KEEP IN SYNC
              with AGENTS.md §5 "Product principles" - if a principle is added,
              removed, or reworded there, update this list (and vice versa). */}
          <ModalSectionHeading>Our principles</ModalSectionHeading>
          <ul className="space-y-1.5 text-gray-300 text-xs">
            <li><span className="text-gray-400 font-medium">No surprise failures.</span> Every item on the Results page is one you were told about - nothing fails out of nowhere.</li>
            <li><span className="text-gray-400 font-medium">Missing features are acknowledged, not failed.</span> If your destination is missing an entitlement (R2, Load Balancing, &hellip;), we flag it up front and skip it cleanly.</li>
            <li><span className="text-gray-400 font-medium">We ask before we write.</span> Anything that can&apos;t migrate is detected and acknowledged before the migration touches the destination.</li>
            <li><span className="text-gray-400 font-medium">We never ask you to acknowledge what you can&apos;t change.</span> Purely informational outcomes are shown, not turned into busywork checkboxes.</li>
            <li><span className="text-gray-400 font-medium">Verification matches migration.</span> We confirm each resource on the destination using the same identifiers we migrated it with.</li>
            <li><span className="text-gray-400 font-medium">One source of truth for what can&apos;t migrate.</span> A single catalog drives every &quot;cannot migrate via API&quot; notice you see.</li>
            <li><span className="text-gray-400 font-medium">The &quot;would I lose functionality?&quot; test.</span> If you&apos;d notice a feature missing after migrating, it&apos;s in scope.</li>
            <li><span className="text-gray-400 font-medium">Scope is auditable - we show the data, not a summary.</span> The Scope step shows the real, identifying detail of every resource so you can spot anything missing or wrong.</li>
            <li><span className="text-gray-400 font-medium">Problems surface as early as possible.</span> The moment we know something will or did go wrong, you see it live - not in a batch at the end.</li>
          </ul>

          <ModalSectionHeading>Beta &amp; data</ModalSectionHeading>
          <p className="text-gray-400 text-xs">
            Twilight Zone is in beta and still has bugs. To help fix them, an anonymized,
            credential-free summary of each completed migration (resource names, per-resource
            statuses, redacted error messages, and the zone/account identifiers) is logged
            server-side for 90 days. <span className="font-medium">Your credentials are never
            logged</span> - tokens, keys, worker secrets, and private keys exist only for the
            duration of each API call. Full configuration (DNS records, etc.) is not logged, only the
            outcome. See the{' '}
            <button
              type="button"
              onClick={() => { setAboutOpen(false); setSecurityOpen(true); }}
              className="text-orange-400 underline hover:text-orange-300 cursor-pointer"
            >
              Privacy &amp; security
            </button>
            {' '}panel for the full allowlist and retention details.
          </p>

          <ModalSectionHeading>Time estimates</ModalSectionHeading>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-200 tabular-nums">15–30s</div>
              <div className="text-xs text-gray-400 mt-0.5">&lt; 50 resources</div>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-200 tabular-nums">30–60s</div>
              <div className="text-xs text-gray-400 mt-0.5">50–200 resources</div>
            </div>
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-200 tabular-nums">1–3 min</div>
              <div className="text-xs text-gray-400 mt-0.5">200+ resources</div>
            </div>
          </div>
        </InfoModal>

        <InfoModal
          open={securityOpen}
          onClose={() => setSecurityOpen(false)}
          title="Privacy & security"
          eyebrow="How credentials are handled"
          footer={
            <span>Use &ldquo;Clear localStorage + sessionStorage&rdquo; in the Browser storage section to wipe everything.</span>
          }
        >
          <ModalSectionHeading>Credentials</ModalSectionHeading>
          <p>
            The Cloudflare API does not support browser-direct requests (CORS), so your tokens are
            sent through this Worker as a stateless proxy. <strong>API Keys, API Tokens, worker
            secrets, and private keys exist only for the duration of each API call and are never
            stored, logged, or persisted server-side.</strong> This is a hard guarantee: credentials
            never touch our migration run logs.
          </p>

          <ModalSectionHeading>Browser storage</ModalSectionHeading>
          <p>
            Non-sensitive values (account IDs, zone names) are saved to <code className="text-orange-400/80 text-xs">localStorage</code> so
            you don&apos;t need to re-enter them between visits. Sensitive tokens are kept in <code className="text-orange-400/80 text-xs">sessionStorage</code> only
            and are cleared when you close the tab.
          </p>
          <p>
            <button
              type="button"
              onClick={() => {
                Object.keys(localStorage).filter(k => k.startsWith('tz_')).forEach(k => localStorage.removeItem(k));
                Object.keys(sessionStorage).filter(k => k.startsWith('tz_')).forEach(k => sessionStorage.removeItem(k));
                location.reload();
              }}
              className="text-red-400 hover:text-red-300 underline cursor-pointer"
            >
              Clear localStorage + sessionStorage
            </button>
          </p>

          <ModalSectionHeading>Network</ModalSectionHeading>
          <p>
            All requests go directly to <code className="text-orange-400/80 text-xs">api.cloudflare.com</code>. The
            Worker forwards the request body and response unchanged. No third-party analytics and no
            cross-site tracking.
          </p>

          <ModalSectionHeading>Migration run logging (beta)</ModalSectionHeading>
          <p>
            While Twilight Zone is in beta, we log a non-secret, non-PII summary of each completed
            migration so we can find and fix bugs: resource names, per-resource statuses, error
            messages (with email addresses and IP addresses removed), and the source/destination
            zone and account identifiers. We do <strong>not</strong> log your credentials, secrets,
            or the contents of your DNS/zone configuration. Run logs are retained for 90 days. The
            landing-page counter is an aggregate count derived from these logs.
          </p>

          <ModalSectionHeading>Worker bundle integrity</ModalSectionHeading>
          <p className="text-xs text-gray-400">
            The deployed Worker is built from the public source tree. Every dependency is pinned in
            <code className="text-orange-400/80 text-xs mx-1">package-lock.json</code>; CI verifies
            typecheck, unit tests, and API coverage invariants before any deploy. The project&apos;s
            SECURITY.md documents the full SI-2 / NIST 800-53 gap analysis and required API token
            permissions.
          </p>
        </InfoModal>

        <InfoModal
          open={coverageOpen}
          onClose={() => setCoverageOpen(false)}
          title="Coverage by category"
          eyebrow={`${OVERALL_COVERAGE_PCT}% of migratable zone resources covered · ${IN_SCOPE_WRITE_SHARE_PCT}% of all in-scope write endpoints`}
          footer={
            <div className="flex items-center justify-between">
              <span>
                {coverageSummary.totals.implemented} of {coverageSummary.totals.implemented + coverageSummary.totals.gap} migratable writes implemented
                {' · '}
                <span className="text-gray-500">
                  {coverageSummary.totals.implemented} of {coverageSummary.totals.in_scope_writes} in-scope writes ({IN_SCOPE_WRITE_SHARE_PCT}%)
                </span>
                {' · '}
                {coverageSummary.totals.excluded} excluded
              </span>
            </div>
          }
        >
          <p className="text-xs text-gray-400">
            The big green number is migration completeness - the share of
            <em> migratable</em> zone resources Twilight Zone actually moves
            (real gaps are the only thing that lowers it). The smaller gray
            number in parentheses is the share of <em>all</em> in-scope write
            endpoints (POST/PATCH/PUT) the tool calls; the rest are
            deliberately excluded - data-plane operations, imperative actions,
            and redundant variants. It is neither good nor bad, just context.
            Click any tile for the per-endpoint breakdown.
          </p>
          <CoverageTiles compact={true} />
        </InfoModal>

        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      </div>
    </>
  );
}
