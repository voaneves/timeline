// Ghost determinism check (PLAN-3D T0.16). Headless Chrome via playwright-core, NO screen capture.
//
// Usage: node tools/capture/ghost-verify.mjs [--demo 0] [--modes native,fps15,jitter,fast] [--url http://127.0.0.1:5199/] [--ghost demo-push] [--runs 3] [--record]
//   Replays the ghost N times per frame-rate mode (native rAF, 15 fps, jittery 5-80 ms, ~240 fps) and compares the
//   final snapshot (window.__ghost.result, taken at the exact final fixed step) across ALL runs: max |delta| <= 1 mm.
//   --record: also records a live keyboard session (?ghost=rec), replays the exported ghost and compares it with the
//   live state at the same step (proves the recorder is exact).
// The server must already run (npm run dev, or vite preview on a debug build, which bundles tools/capture/ghosts).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../package.json'));
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const BASE = opt('url', 'http://127.0.0.1:5199/');
const GHOST = opt('ghost', 'demo-push');
const RUNS = +opt('runs', 3);
const TOL = 0.001; // 1 mm
const DEMO = opt('demo', '1') !== '0'; // --demo 0: the default greybox world (T1.x ghosts); the --record check needs the demo cube
const MODE_NAMES = opt('modes', 'native,fps15,jitter,fast').split(',');

const MODES = {
  native: null,
  fps15: 'return 1000 / 15;',
  jitter: 'return 5 + rnd() * 75;',
  fast: 'return 4;',
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--mute-audio'],
});

async function open(query, mode, route) {
  const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (MODES[mode]) {
    await page.addInitScript(`(() => {
      let s = 123456789; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
      const delay = () => { ${MODES[mode]} };
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), delay());
    })()`);
  }
  if (route) await page.route(route.pattern, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(route.body) }));
  await page.goto(`${BASE}?webgl&expose${DEMO ? '&demo' : ''}&${query}`);
  await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 });
  return { page, context, errors };
}

const flatten = (snap) => snap.bodies.flatMap((b) => [...b.p, ...b.q]);
const maxDelta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

// 1. Replays
const results = [];
for (const mode of MODE_NAMES) {
  for (let run = 1; run <= RUNS; run++) {
    const { page, context, errors } = await open(`ghost=${GHOST}`, mode);
    const t0 = Date.now();
    await page.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 180000, polling: 100 });
    const info = await page.evaluate(() => ({
      result: window.__ghost.result,
      frames: window.__perf?.count ?? null,
      cube: window.game.world.cube ? (() => { const t = window.game.world.cube.physical.body.translation(); return [t.x, t.y, t.z]; })() : null,
    }));
    await context.close();
    results.push({ mode, run, ms: Date.now() - t0, steps: info.result.step, frames: info.frames, p: info.result.bodies.at(DEMO ? 0 : -1).p, flat: flatten(info.result), errors });
    console.log(`${mode.padEnd(7)} run ${run}: ${(Date.now() - t0 + '').padStart(6)} ms, ${info.frames} frames, step ${info.result.step}, ${DEMO ? 'cube' : 'last body (player)'} = (${info.result.bodies.at(DEMO ? 0 : -1).p.map((v) => v.toFixed(5)).join(', ')})${errors.length ? '  ERRORS: ' + errors.join(' | ') : ''}`);
  }
}
const ref = results[0].flat;
const worst = Math.max(...results.map((r) => maxDelta(ref, r.flat)));
const sameFrames = new Set(results.map((r) => r.frames)).size;
console.log(`\nreplays: ${results.length}, max |delta| vs first run over all body components = ${(worst * 1000).toFixed(6)} mm (frame counts differ across modes: ${sameFrames > 1})`);
let ok = worst <= TOL && results.every((r) => r.errors.length === 0);

// 2. Record -> replay equivalence
if (argv.includes('--record')) {
  const { page, context } = await open('ghost=rec', 'native');
  const live = await (async () => {
    // Capture the live state at an exact step boundary (after afterStep, order 1000)
    await page.evaluate(() => {
      window.__liveEnd = null;
      window.game.ticker.events.on('fixedTick', () => {
        if (window.__ghost.running && window.__ghost.step === 900) {
          window.__liveEnd = window.__ghost.snapshot();
          window.__ghostExport = window.__ghost.stop();
        }
      }, 1001);
    });
    const press = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(137); };
    await page.waitForTimeout(500);
    await press('ArrowRight', 900);
    await press('KeyW', 600);
    await press('Space', 90);
    await press('ArrowLeft', 400);
    await page.waitForFunction(() => window.__liveEnd !== null, null, { timeout: 60000 });
    return page.evaluate(() => ({ snap: window.__liveEnd, ghost: window.__ghostExport }));
  })();
  await context.close();
  console.log(`\nrecorded ${live.ghost.events.length} events over ${live.ghost.steps} steps:`, JSON.stringify(live.ghost.events.slice(0, 4)), '...');
  for (const mode of ['native', 'fps15']) {
    const { page: p2, context: c2 } = await open('ghost=rec-test', mode, { pattern: '**/ghosts/rec-test.json', body: live.ghost });
    await p2.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 180000, polling: 100 });
    const replay = await p2.evaluate(() => window.__ghost.result);
    await c2.close();
    const d = maxDelta(flatten(live.snap), flatten(replay));
    console.log(`record->replay (${mode}): live cube (${live.snap.bodies[0].p.map((v) => v.toFixed(5)).join(', ')}) vs replay max |delta| = ${(d * 1000).toFixed(6)} mm`);
    ok = ok && d <= TOL;
  }
}

await browser.close();
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
