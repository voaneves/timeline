// Perf gate (plan T0.14, section 7.4): serves dist/ with `vite preview`, opens headed Chrome on the real GPU
// (D3D11 ANGLE, no blocklist), runs desktop + mobile-throttled profiles for `durationSec` each, reads window.__perf
// (T0.9) through page evaluation (no screen recording) and compares with budgets.json "perf".
// CLI: node scripts/perf-gate.mjs [--budgets budgets.json] [--port 4179] [--profile desktop|mobile] [--headless]
// Env: CHROME_PATH overrides the Chrome executable.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const budgets = JSON.parse(readFileSync(resolve(arg('--budgets', process.env.BUDGETS ?? 'budgets.json')), 'utf8')).perf
const port = Number(arg('--port', '4179'))
const only = arg('--profile', null)
const headless = args.includes('--headless')
const base = `http://127.0.0.1:${port}/`

const chromePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
    .filter(Boolean).find((p) => existsSync(p))
if(!chromePath) { console.error('Chrome not found (set CHROME_PATH)'); process.exit(2) }
if(!existsSync(resolve('dist/index.html'))) { console.error('dist/ missing: run "npm run build" first'); process.exit(2) }

// vite preview on a dedicated port (the "preview" script pins 4173)
const viteBin = resolve('node_modules/vite/bin/vite.js')
const server = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', (d) => { serverLog += d })
server.stderr.on('data', (d) => { serverLog += d })
const stopServer = () => { try { server.kill() } catch {} }
process.on('exit', stopServer)

async function waitServer()
{
    for(let i = 0; i < 60; i++)
    {
        try { if((await fetch(base)).ok) return } catch {}
        await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`vite preview did not start:\n${serverLog}`)
}

async function runProfile(browser, name, p)
{
    const context = await browser.newContext({
        viewport: { width: p.viewport[0], height: p.viewport[1] },
        deviceScaleFactor: p.dpr ?? 1,
        isMobile: name === 'mobile',
        hasTouch: name === 'mobile',
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.bringToFront()
    const cdp = await context.newCDPSession(page)
    if(p.cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpuThrottle })

    await page.goto(`${base}${p.query ?? ''}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__perf && window.__perf.count > 30, null, { timeout: 60000 })
    await page.waitForTimeout((budgets.warmupSec ?? 3) * 1000)

    const t0 = await page.evaluate(() => ({ count: window.__perf.count, t: performance.now() }))
    await page.waitForTimeout(budgets.durationSec * 1000)
    const snap = await page.evaluate(() => ({ ...window.__perf.snapshot(), count: window.__perf.count, t: performance.now(), dpr: devicePixelRatio, size: [innerWidth, innerHeight] }))
    await context.close()

    const avgFps = ((snap.count - t0.count) / (snap.t - t0.t)) * 1000
    return { name, errors, avgFps, snap }
}

function judge(name, p, r)
{
    const checks = [
        ['avg fps', r.avgFps, '>=', p.minFps],
        ['p50 fps', r.snap.fps, '>=', p.minFps],
        ['frame p95 ms', r.snap.frameMsP95, '<=', p.maxP95Ms],
        ['draw calls', r.snap.drawCalls, '<=', p.maxDrawCalls],
        ['triangles', r.snap.triangles, '<=', p.maxTriangles],
    ]
    let ok = true
    console.log(`\n[${name}] backend=${r.snap.backend} viewport=${r.snap.size.join('x')} dpr=${r.snap.dpr} gpuMs=${typeof r.snap.gpuMs === 'number' ? r.snap.gpuMs.toFixed(2) : r.snap.gpuMs} programs=${r.snap.programs}`)
    for(const [label, value, op, limit] of checks)
    {
        const pass = op === '>=' ? value >= limit : value <= limit
        if(!pass) ok = false
        console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label.padEnd(13)} ${Number(value).toFixed(2).padStart(10)} ${op} ${limit}`)
    }
    if(r.errors.length) { ok = false; console.log('  FAIL page errors:', r.errors.join(' | ')) }
    return ok
}

let allOk = true
let browser
try
{
    await waitServer()
    browser = await chromium.launch({
        executablePath: chromePath,
        headless,
        args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
    })
    for(const name of ['desktop', 'mobile'])
    {
        if(only && only !== name) continue
        const r = await runProfile(browser, name, budgets[name])
        if(!judge(name, budgets[name], r)) allOk = false
    }
}
catch(error)
{
    console.error('perf gate error:', error.message)
    allOk = false
}
finally
{
    await browser?.close().catch(() => {})
    stopServer()
}

console.log(allOk ? '\nperf gate passed' : '\nperf gate FAILED')
process.exit(allOk ? 0 : 1)
