// Capture tool (PLAN-3D 7.2 / T0.8): Playwright HEADED system Chrome + ffmpeg ddagrab screen recording
// + rAF frame-time sampler + window.__perf (optional) -> mp4 (60 fps) + metrics.json + contact sheet.
//
// Usage: node record.mjs --profile desktop|mobile --seconds 10 --url <url> [--start] [--name x] [--out dir]
//                        [--encoder h264_amf|libx264] [--no-sheet] [--script file.mjs]
// --script: ES module, default export async ({ page, cdp, P, seconds, mark, sleep, remaining }) => {}; runs right after
//   recording starts (replaces --start). mark(name) stores ms since navigation + bytes transferred so far in metrics.marks.
// Always collected: CDP Network transfer (sum encodedDataLength) and draw calls (WebGL + WebGPU prototype hooks).
// NOTE: playwright-core is borrowed from D:/GitHub/site until T0.5 adds it as a devDependency of game/.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FFMPEG, makeSheet } from './sheet.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { ({ chromium } = require('D:/GitHub/site/node_modules/playwright-core')); }

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const here = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);

const profileName = opt('profile', 'desktop');
const scriptPath = opt('script');
const seconds = +opt('seconds', 10);
const url = opt('url');
if (!url) { console.error('missing --url'); process.exit(1); }
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const name = opt('name', `${profileName}-${stamp}`);
const outDir = path.resolve(opt('out', path.join(here, 'out')), name);
fs.mkdirSync(outDir, { recursive: true });
const mp4 = path.join(outDir, 'video.mp4');

// Profiles. Screen is 1920x1080; Chrome is made fullscreen via CDP so the page owns (0,0)-(1920,1080).
// Desktop: plan says 2560x1440, this monitor is 1080p, so capture 1920x1080 (real size is written to metrics).
const PROFILES = {
  desktop: { w: 1920, h: 1080, dpr: 1, mobile: false, cpu: 1 },
  mobile: { w: 390, h: 844, dpr: 1, mobile: true, cpu: 4 }, // emulated viewport sits at the top-left of the kiosk window
};
const P = PROFILES[profileName];
if (!P) { console.error('unknown profile ' + profileName); process.exit(1); }

const encoder = opt('encoder', 'h264_amf');
const encArgs = encoder === 'h264_amf'
  ? ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20']
  : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18'];
const vfPre = encoder === 'h264_amf' ? 'hwdownload,format=bgra,format=nv12' : 'hwdownload,format=bgra,format=yuv420p';

const browser = await chromium.launch({
  headless: false,
  executablePath: CHROME,
  ignoreDefaultArgs: ['--enable-automation'],
  args: [
    '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--force-device-scale-factor=1',
    '--disable-features=Translate,TranslateUI', '--lang=pt-BR', '--accept-lang=pt-BR', '--window-position=0,0', '--window-size=1920,1080',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
  ],
});
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
if (P.mobile) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: P.w, height: P.h, deviceScaleFactor: P.dpr, mobile: true, screenWidth: P.w, screenHeight: P.h });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
if (P.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: P.cpu });

// CDP network accounting: sum of encodedDataLength (bytes on the wire, headers included) over finished requests.
let netBytes = 0, netReqs = 0;
await cdp.send('Network.enable');
cdp.on('Network.loadingFinished', (e) => { netBytes += e.encodedDataLength || 0; netReqs++; });

// rAF sampler + draw-call counters (WebGL2/WebGL1 draw* and WebGPU render-pass draw*), installed before any page script.
// d = draws since the previous rAF tick; dpf holds the per-frame counts while recording. Reset right when recording starts.
await page.addInitScript(() => {
  const s = (window.__cap = { t: [], dpf: [], on: false, d: 0, total: 0 });
  const wrap = (proto, names) => {
    if (!proto) return;
    for (const n of names) {
      const o = proto[n];
      if (typeof o !== 'function') continue;
      proto[n] = function (...a) { s.d++; return o.apply(this, a); };
    }
  };
  const gl = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
  wrap(window.WebGL2RenderingContext?.prototype, gl);
  wrap(window.WebGLRenderingContext?.prototype, gl.slice(0, 2));
  const gpu = ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect'];
  wrap(window.GPURenderPassEncoder?.prototype, gpu);
  wrap(window.GPURenderBundleEncoder?.prototype, gpu);
  const tick = (now) => { if (s.on) { s.t.push(now); s.dpf.push(s.d); s.total += s.d; } s.d = 0; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

// Real fullscreen via CDP so the page owns the whole screen (no tab strip / URL bar in the capture).
try {
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
} catch (e) { console.warn('[record] fullscreen failed:', e.message); }
await page.waitForTimeout(800);

const navStart = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500); // let the loader settle before recording
await page.bringToFront();
console.log(`[record] profile=${profileName} ${P.w}x${P.h} cpu x${P.cpu} loaded in ${Date.now() - navStart} ms`);

// ffmpeg screen capture (Desktop Duplication). Crop = page region at the screen origin.
const ff = spawn(FFMPEG, [
  '-y', '-hide_banner', '-loglevel', 'warning',
  '-f', 'lavfi', '-i', `ddagrab=output_idx=0:framerate=60:video_size=${P.w}x${P.h}:offset_x=0:offset_y=0`,
  '-vf', vfPre, '-fps_mode', 'cfr', '-r', '60', ...encArgs, '-t', String(seconds + 1), mp4,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = new Promise((res) => ff.on('close', res));
await page.waitForTimeout(1000); // encoder warm-up

await page.evaluate(() => { window.__cap.t.length = 0; window.__cap.dpf.length = 0; window.__cap.total = 0; window.__cap.on = true; });
const t0 = Date.now();
const marks = [];
const mark = (n) => { marks.push({ name: n, msSinceNav: Date.now() - navStart, msSinceRecStart: Date.now() - t0, bytes: netBytes }); console.log('[record] mark', n); };
const sleep = (ms) => page.waitForTimeout(ms);
const remaining = () => seconds * 1000 - (Date.now() - t0);
let scriptRun = Promise.resolve();
if (scriptPath) {
  const mod = await import(pathToFileURL(path.resolve(scriptPath)).href);
  scriptRun = Promise.resolve(mod.default({ page, cdp, P, seconds, mark, sleep, remaining })).catch((e) => console.warn('[record] script error:', e.message));
} else if (flag('start')) {
  await page.keyboard.press('Enter');
  if (P.mobile) await page.touchscreen.tap(P.w / 2, P.h / 2).catch(() => {});
}
await page.waitForTimeout(seconds * 1000);
await Promise.race([scriptRun, sleep(2000)]);
const elapsed = (Date.now() - t0) / 1000;

const capAll = await page.evaluate(() => { window.__cap.on = false; return { t: window.__cap.t, dpf: window.__cap.dpf }; });
const cap = capAll.t;
const dpf = capAll.dpf;
const perf = await page.evaluate(() => { try { return window.__perf ? JSON.parse(JSON.stringify(window.__perf)) : null; } catch { return { error: 'unserializable' }; } });

try { ff.stdin.write('q'); } catch {}
await Promise.race([ffDone, new Promise((r) => setTimeout(r, 8000))]);
if (ff.exitCode === null) ff.kill();
await browser.close();

const dts = [];
for (let i = 1; i < cap.length; i++) dts.push(cap[i] - cap[i - 1]);
const sorted = [...dts].sort((a, b) => a - b);
const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
const span = cap.length > 1 ? (cap[cap.length - 1] - cap[0]) / 1000 : 0;
const r2 = (v) => (v == null ? null : +v.toFixed(2));
const metrics = {
  profile: profileName, url, capture: { w: P.w, h: P.h, cpuThrottle: P.cpu, mobileEmulation: P.mobile },
  durationSec: r2(elapsed), frames: cap.length,
  avgFps: span ? r2((cap.length - 1) / span) : null,
  frameTimeMs: { p50: r2(pct(0.5)), p95: r2(pct(0.95)), p99: r2(pct(0.99)), max: r2(sorted[sorted.length - 1] ?? null) },
  transfer: { bytes: netBytes, requests: netReqs, mb: r2(netBytes / 1048576) },
  drawCalls: dpf.length && dpf.some((v) => v > 0)
    ? { avg: r2(dpf.reduce((a, b) => a + b, 0) / dpf.length), max: Math.max(...dpf), note: 'GL draw* / GPURenderPassEncoder draw* per rAF frame; executeBundles not expanded' }
    : 'n/a (no draw calls seen via GL/WebGPU hooks)',
  marks,
  perf: perf ?? 'window.__perf absent',
  video: 'video.mp4',
};
fs.writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2));

let sheet = null;
if (fs.existsSync(mp4) && !flag('no-sheet')) sheet = makeSheet(mp4, { out: path.join(outDir, 'sheet.png') });
console.log(JSON.stringify({ outDir, mp4, metrics: path.join(outDir, 'metrics.json'), sheet, avgFps: metrics.avgFps, p95: metrics.frameTimeMs.p95 }, null, 2));
