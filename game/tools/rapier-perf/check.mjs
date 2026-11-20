// Check for T0.7 / T0.9: opens the preview in headed system Chrome (real GPU), per backend, reads
// window.__physicsSmoke (?debug=physics) and window.__perf. Usage: node t07-t09-check.mjs <baseUrl> [--seconds 6]
import { createRequire } from 'node:module';
const require = createRequire('D:/GitHub/_kit-clones/timeline/game/package.json');
const { chromium } = require('playwright-core');

const base = process.argv[2] || 'http://127.0.0.1:4173/';
const seconds = +(process.argv[process.argv.indexOf('--seconds') + 1] || 6);
const browser = await chromium.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const out = {};
for (const [name, query] of [['webgpu', '?expose&debug=physics'], ['webgl', '?expose&webgl&debug=physics'], ['webgpu-noDebug', '?expose'], ['webgl-noDebug', '?expose&webgl']]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    const requests = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(base + query);
    await page.waitForFunction(() => window.game?.ready && window.__perf?.count > 5, null, { timeout: 30000 });
    await page.waitForTimeout(seconds * 1000);
    const perf = await page.evaluate(() => window.__perf.snapshot());
    const smoke = query.includes('physics') ? await page.evaluate(async () => { await window.game.physicsSmoke; return window.__physicsSmoke; }) : null;
    out[name] = { perf, smoke, errors, tweakpaneRequests: requests.filter((u) => /tweakpane/i.test(u)).length, hud: await page.evaluate(() => document.querySelector('.perf-hud')?.textContent ?? null) };
    await page.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 2));
