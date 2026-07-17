import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

describe('UI regression guards', () => {
  test('applies the persisted theme before loading the React app', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');

    const prepaintScript = html.indexOf('tz-theme-prepaint');
    const appScript = html.indexOf('/app/main.tsx');

    expect(prepaintScript).toBeGreaterThan(-1);
    expect(appScript).toBeGreaterThan(-1);
    expect(prepaintScript).toBeLessThan(appScript);
    expect(html).toContain('tz_theme');
    expect(html).toContain('tz_twilightTheme');
    expect(html).toContain('light-theme');
    expect(html).toContain('twilight-theme');
  });

  test('the Zone step renders a fallback instead of a blank page when export data is absent', () => {
    const app = readFileSync(join(root, 'app', 'App.tsx'), 'utf8');

    expect(app).toMatch(/step === 3 && \(/);
    expect(app).toMatch(/exportData\s*\?\s*\(/);
    expect(app).toMatch(/\)\s*:\s*exportFailedState/);
  });

  test('does not register or advertise wizard-wide keyboard shortcuts', () => {
    const app = readFileSync(join(root, 'app', 'App.tsx'), 'utf8');
    const layout = readFileSync(join(root, 'app', 'components', 'Layout.tsx'), 'utf8');

    expect(app).not.toContain("e.key === 'Enter'");
    expect(app).not.toContain("e.key === 'Escape' && e.shiftKey");
    expect(layout).not.toContain('Keyboard shortcuts');
    expect(layout).not.toContain('Shift+Esc');
  });

  test('twilight exit lives on the TV power knob, with an sr-only accessible control', () => {
    const layout = readFileSync(join(root, 'app', 'components', 'Layout.tsx'), 'utf8');
    const cabinet = readFileSync(join(root, 'app', 'components', 'layout', 'RetroTvCabinet.tsx'), 'utf8');

    // The visible EXIT sign is gone — the power knob is the visible exit.
    expect(layout).not.toContain('twilight-exit-control');
    // The page cabinet wires the power knob to the twilight exit handler...
    expect(layout).toContain('onPower={isTwilight ? exitTwilight : undefined}');
    // ...and the knob shows the running-figure exit glyph when it's the live exit.
    expect(cabinet).toContain('ExitRunIcon');
    expect(cabinet).toContain('tvc-power-icon');
    // Accessibility is preserved: a focusable, announced sr-only exit control.
    expect(layout).toContain('aria-label="Exit Twilight Mode"');
    expect(layout).toMatch(/className="sr-only"[\s\S]{0,120}aria-label="Exit Twilight Mode"/);
  });

  test('twilight door stays decorative now that the header has an exit sign', () => {
    const layout = readFileSync(join(root, 'app', 'components', 'Layout.tsx'), 'utf8');
    const endlessDoorway = readFileSync(join(root, 'app', 'components', 'EndlessDoorway.tsx'), 'utf8');

    expect(endlessDoorway).not.toContain('tz-door-exit');
    expect(endlessDoorway).not.toMatch(/>\s*EXIT\s*<\/span>/);
    expect(layout).not.toContain('HOVER_EXIT_MS');
    expect(layout).not.toContain('setTwilightDoorAjar(true)');
  });

  test('conflict (Skip/Overwrite) toggle lives in Setup only, gated on an existing dest zone', () => {
    const scope = readFileSync(join(root, 'app', 'components', 'steps', 'ScopeReview.tsx'), 'utf8');
    const step0 = readFileSync(join(root, 'app', 'components', 'steps', 'Step0Credentials.tsx'), 'utf8');

    // The toggle and its destructive-overwrite modal are gone from the
    // Account/Zone/preset-Apply review view…
    expect(scope).not.toContain('If a resource already exists on the destination');
    expect(scope).not.toContain('ConflictStrategyToggle');
    expect(scope).not.toContain('setShowOverwriteModal');
    // …but conflictStrategy is still consumed there to gray identical rows.
    expect(scope).toContain('conflictStrategy');

    // Setup renders the shared toggle, and the migration copy is gated on a
    // live "destination zone already exists" probe. The gate is expressed as a
    // ternary (`destZoneExists ? <ConflictStrategyToggle/> : null`) passed to the
    // shared DestinationSection's `conflict` slot — accept `&&` or `?` so a
    // future inline/slot refactor doesn't trip the guard while the gate holds.
    expect(step0).toContain('ConflictStrategyToggle');
    expect(step0).toContain('useDestZoneExists');
    expect(step0).toMatch(/destZoneExists\s*(?:&&|\?)\s*\(?\s*[\s\S]{0,160}ConflictStrategyToggle/);
  });

  test('non-Setup wizard steps return to Setup via the header logo (dedicated button removed)', () => {
    const app = readFileSync(join(root, 'app', 'App.tsx'), 'utf8');

    // The standalone "Back to Setup" button was removed; return-to-Setup is now
    // owned by the header logo (see the logo-reset test below). Guard that the
    // dedicated button markup didn't sneak back in and that the documented
    // replacement (logo → goToLanding) is wired.
    expect(app).not.toMatch(/onClick=\{\(\) => goToStep\(0\)\}/);
    expect(app).toContain('onLogoClick={goToLanding}');
  });

  test('Twilight Zone logo resets progress through the landing reset handler', () => {
    const app = readFileSync(join(root, 'app', 'App.tsx'), 'utf8');
    const layout = readFileSync(join(root, 'app', 'components', 'Layout.tsx'), 'utf8');

    expect(app).toContain('onLogoClick={goToLanding}');
    expect(app).toContain('clearWizardState();');
    expect(app).toContain('location.reload();');
    expect(layout).toContain('aria-label="Twilight Zone — return to start and dark mode"');
    expect(layout).toMatch(/const handleTitleClick = useCallback\(\(\) => \{[\s\S]{0,80}onLogoClick\(\);/);
  });
});
