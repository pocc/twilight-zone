import { spawn } from 'node:child_process';

import { chromium } from '@playwright/test';

const PORT = 4180;
const URL = `http://127.0.0.1:${PORT}`;

const VIEWPORTS = [
  { name: 'mid-1280x1080', width: 1280, height: 1080, layout: 'mid-landscape' },
  { name: 'desktop-1920x1080', width: 1920, height: 1080, layout: 'mid-landscape' },
  { name: 'laptop-1600x900', width: 1600, height: 900, layout: 'mid-landscape' },
  { name: 'laptop-1440x900', width: 1440, height: 900, layout: 'mid-landscape' },
  { name: 'laptop-1366x768', width: 1366, height: 768, layout: 'side-landscape' },
  { name: 'zoom150-1600x900', width: Math.round(1600 / 1.5), height: Math.round(900 / 1.5), layout: 'side-landscape' },
  { name: 'zoom150-1366x768', width: Math.round(1366 / 1.5), height: Math.round(768 / 1.5), layout: 'side-landscape' },
  { name: 'portrait-390x844', width: 390, height: 844, layout: 'portrait' },
  { name: 'tall-1600x1900', width: 1600, height: 1900, layout: 'portrait' },
];

const EXPECTED_AREAS = {
  'mid-landscape': '"knobs" "ctrl" "speaker"',
  'side-landscape': '"ctrl knobs" "speaker speaker"',
  portrait: '"dleft speaker dright" "dleft mesh dright"',
};

const intersects = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const describeBox = (box) => `${Math.round(box.width)}x${Math.round(box.height)}@${Math.round(box.left)},${Math.round(box.top)}`;

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(URL);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${URL}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  server.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  server.stderr.on('data', (chunk) => logs.push(chunk.toString()));

  try {
    await waitForServer();
    const browser = await chromium.launch({ headless: true });
    try {
      for (const viewport of VIEWPORTS) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
        await page.addInitScript(() => localStorage.setItem('tz_twilightTheme', 'on'));
        await page.goto(URL, { waitUntil: 'networkidle' });
        await page.waitForSelector('.tvc-panel', { timeout: 10_000 });
        const result = await page.evaluate(() => {
          const rect = (element) => {
            const r = element.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
          };
          const panel = rect(document.querySelector('.tvc-panel'));
          const knobs = rect(document.querySelector('.tvc-knobs'));
          const mesh = rect(document.querySelector('.tvc-mesh'));
          const speaker = rect(document.querySelector('.tvc-speaker'));
          const housings = [...document.querySelectorAll('.tvc-knob-housing')].map(rect);
          const labels = [...document.querySelectorAll('.tvc-dial-label')].map((element) => ({ text: element.textContent, ...rect(element) }));
          const gridTemplateAreas = getComputedStyle(document.querySelector('.tvc-panel')).gridTemplateAreas.replace(/\n/g, ' ');
          return { panel, knobs, mesh, speaker, housings, labels, gridTemplateAreas, viewport: { width: window.innerWidth, height: window.innerHeight } };
        });
        await page.close();

        const expectedAreas = EXPECTED_AREAS[viewport.layout];
        assert(
          result.gridTemplateAreas === expectedAreas,
          `${viewport.name}: expected grid areas ${expectedAreas}, got ${result.gridTemplateAreas}`,
        );

        for (const [name, box] of Object.entries({ panel: result.panel, mesh: result.mesh, speaker: result.speaker })) {
          assert(box.left >= -1 && box.top >= -1 && box.right <= result.viewport.width + 1 && box.bottom <= result.viewport.height + 1,
            `${viewport.name}: ${name} overflows viewport (${describeBox(box)})`);
        }

        const dialVisuals = result.housings.map((housing) => {
          const halo = housing.width * 0.13;
          return { left: housing.left - halo, top: housing.top - halo, right: housing.right + halo, bottom: housing.bottom + halo, width: housing.width + 2 * halo, height: housing.height + 2 * halo };
        });

        for (const [index, visual] of dialVisuals.entries()) {
          assert(
            visual.left >= result.panel.left - 1 && visual.top >= result.panel.top - 1 && visual.right <= result.panel.right + 1 && visual.bottom <= result.panel.bottom + 1,
            `${viewport.name}: dial ${index + 1} visual ring overflows panel (${describeBox(visual)})`,
          );
        }

        if (dialVisuals.length >= 2) {
          assert(!intersects(dialVisuals[0], dialVisuals[1]), `${viewport.name}: dial chrome rings overlap`);
        }

        for (const label of result.labels) {
          assert(label.width >= 12 && label.height >= 8, `${viewport.name}: ${label.text} label is not visibly sized (${describeBox(label)})`);
          for (const [index, visual] of dialVisuals.entries()) {
            assert(!intersects(label, visual), `${viewport.name}: ${label.text} label overlaps dial ${index + 1} visual ring`);
          }
        }

        if (viewport.layout === 'portrait') {
          assert(result.speaker.width > result.speaker.height * 1.15, `${viewport.name}: portrait speaker should fill as a wide rectangle (${describeBox(result.speaker)})`);
        } else {
          assert(Math.abs(result.speaker.width - result.speaker.height) <= 1, `${viewport.name}: landscape speaker should be square (${describeBox(result.speaker)})`);
        }

        console.log(`${viewport.name}: ok`);
      }
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error(logs.join(''));
    throw error;
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
