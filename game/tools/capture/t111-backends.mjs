// T1.11 backend matrix check: desktop (1280x720) & mobile proxy (390x844, DPR 2, Android UA, 4x CPU throttle)
// across default, ?webgpu, and ?webgl query strings in headed Chrome (real GPU).
//
// Usage:
//   node tools/capture/t111-backends.mjs --dist dist-debug-t111 --port 4198
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const dist = arg('--dist', 'dist-debug')
const port = Number(arg('--port', '4198'))
const base = `http://127.0.0.1:${port}/`
const outDir = resolve('tools/capture/out')
const outFile = resolve(outDir, 't111-backends.json')
mkdirSync(outDir, { recursive: true })

const chromePath = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((p) => existsSync(p))

if(!chromePath)
{
    console.error('Chrome executable not found (set CHROME_PATH)')
    process.exit(2)
}

const distDir = resolve(dist)
if(!existsSync(resolve(distDir, 'index.html')))
{
    console.error(`Missing build directory: ${distDir}`)
    process.exit(2)
}

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

const CELLS = [
    {
        id: 'desktop-default',
        profile: 'Desktop 1280x720',
        mobile: false,
        viewport: { width: 1280, height: 720 },
        dpr: 1,
        cpuThrottle: 1,
        query: '?expose',
        expectedBackend: 'webgpu',
        expectedQualityLevel: 0,
    },
    {
        id: 'desktop-webgpu',
        profile: 'Desktop 1280x720',
        mobile: false,
        viewport: { width: 1280, height: 720 },
        dpr: 1,
        cpuThrottle: 1,
        query: '?expose&webgpu',
        expectedBackend: 'webgpu',
        expectedQualityLevel: 0,
    },
    {
        id: 'desktop-webgl',
        profile: 'Desktop 1280x720',
        mobile: false,
        viewport: { width: 1280, height: 720 },
        dpr: 1,
        cpuThrottle: 1,
        query: '?expose&webgl',
        expectedBackend: 'webgl2',
        expectedQualityLevel: 0,
    },
    {
        id: 'mobile-default',
        profile: 'Mobile proxy 390x844 (DPR 2, 4x CPU)',
        mobile: true,
        viewport: { width: 390, height: 844 },
        dpr: 2,
        cpuThrottle: 4,
        query: '?expose',
        expectedBackend: 'webgl2',
        expectedQualityLevel: 1,
    },
    {
        id: 'mobile-webgl',
        profile: 'Mobile proxy 390x844 (DPR 2, 4x CPU)',
        mobile: true,
        viewport: { width: 390, height: 844 },
        dpr: 2,
        cpuThrottle: 4,
        query: '?expose&webgl',
        expectedBackend: 'webgl2',
        expectedQualityLevel: 1,
    },
    {
        id: 'mobile-webgpu',
        profile: 'Mobile proxy 390x844 (DPR 2, 4x CPU)',
        mobile: true,
        viewport: { width: 390, height: 844 },
        dpr: 2,
        cpuThrottle: 4,
        query: '?expose&webgpu',
        expectedBackend: 'webgpu',
        expectedQualityLevel: 1,
    },
]

const WARMUP_MS = 2000
const SAMPLE_MS = 5000
const POLL_MS = 500

const viteBin = resolve('node_modules/vite/bin/vite.js')
const server = spawn(
    process.execPath,
    [ viteBin, 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort' ],
    { stdio: [ 'ignore', 'pipe', 'pipe' ] }
)

let serverLog = ''
server.stdout.on('data', (d) => { serverLog += d })
server.stderr.on('data', (d) => { serverLog += d })

const stopServer = () =>
{
    if(server && !server.killed && server.pid)
    {
        try { process.kill(server.pid) } catch {}
    }
}
process.on('exit', stopServer)
process.on('SIGINT', () => { stopServer(); process.exit(130) })
process.on('SIGTERM', () => { stopServer(); process.exit(143) })

async function waitServer()
{
    for(let i = 0; i < 60; i++)
    {
        try
        {
            if((await fetch(base)).ok)
                return
        }
        catch {}
        await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`vite preview did not start on ${base}:\n${serverLog}`)
}

async function runCell(browser, cell)
{
    const contextOptions = {
        viewport: cell.viewport,
        deviceScaleFactor: cell.dpr,
        isMobile: cell.mobile,
        hasTouch: cell.mobile,
    }
    if(cell.mobile)
        contextOptions.userAgent = MOBILE_UA

    const context = await browser.newContext(contextOptions)
    const page = await context.newPage()
    const errors = []

    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`))
    page.on('response', (r) => { if(r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`) })

    await page.bringToFront()
    const cdp = await context.newCDPSession(page)
    if(cell.cpuThrottle > 1)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cell.cpuThrottle })

    await page.goto(`${base}${cell.query}`, { waitUntil: 'load' })
    await page.waitForFunction(
        () => window.game?.ready === true && window.__perf && window.__perf.count > 10,
        null,
        { timeout: 60000 }
    )

    // Warmup
    await page.waitForTimeout(WARMUP_MS)

    // Sample window
    const start = await page.evaluate(() => ({ count: window.__perf.count, t: performance.now() }))
    let maxDrawCalls = 0
    let maxTriangles = 0
    const endAt = Date.now() + SAMPLE_MS
    while(Date.now() < endAt)
    {
        await page.waitForTimeout(Math.min(POLL_MS, Math.max(50, endAt - Date.now())))
        const sample = await page.evaluate(() =>
        {
            const snap = window.__perf.snapshot()
            return { drawCalls: snap.drawCalls ?? 0, triangles: snap.triangles ?? 0 }
        })
        maxDrawCalls = Math.max(maxDrawCalls, sample.drawCalls)
        maxTriangles = Math.max(maxTriangles, sample.triangles)
    }

    const end = await page.evaluate(() =>
    {
        const snap = window.__perf.snapshot()
        return {
            perf: snap,
            count: window.__perf.count,
            t: performance.now(),
            backendName: window.game.rendering.backendName,
            qualityLevel: window.game.quality.level,
            dpr: window.devicePixelRatio,
            viewport: [ window.innerWidth, window.innerHeight ],
        }
    })

    await context.close()

    const elapsedMs = Math.max(1, end.t - start.t)
    const avgFps = ((end.count - start.count) / elapsedMs) * 1000
    const actualBackend = end.backendName ?? end.perf.backend
    const backendMatches = actualBackend === cell.expectedBackend && end.perf.backend === cell.expectedBackend
    const qualityMatches = end.qualityLevel === cell.expectedQualityLevel
    const pass = backendMatches && qualityMatches && errors.length === 0

    return {
        id: cell.id,
        profile: cell.profile,
        query: cell.query,
        expectedBackend: cell.expectedBackend,
        actualBackend,
        perfBackend: end.perf.backend,
        expectedQualityLevel: cell.expectedQualityLevel,
        qualityLevel: end.qualityLevel,
        fps: +avgFps.toFixed(1),
        p50Fps: +end.perf.fps.toFixed(1),
        frameMsP50: +end.perf.frameMsP50.toFixed(2),
        frameMsP95: +end.perf.frameMsP95.toFixed(2),
        drawCalls: maxDrawCalls,
        triangles: maxTriangles,
        programs: end.perf.programs,
        viewport: end.viewport,
        dpr: end.dpr,
        errors,
        pass,
    }
}

let browser = null
const report = {
    dist,
    port,
    warmupMs: WARMUP_MS,
    sampleMs: SAMPLE_MS,
    cells: [],
    pass: false,
}

try
{
    await waitServer()
    browser = await chromium.launch({
        executablePath: chromePath,
        headless: false,
        ignoreDefaultArgs: [ '--enable-automation' ],
        args: [
            '--use-angle=d3d11',
            '--ignore-gpu-blocklist',
            '--enable-unsafe-webgpu',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
        ],
    })

    for(const cell of CELLS)
    {
        const result = await runCell(browser, cell)
        report.cells.push(result)
        const status = result.pass ? 'PASS' : 'FAIL'
        console.log(
            `[${status}] ${result.id.padEnd(16)} query=${result.query.padEnd(15)} backend=${result.actualBackend} (exp ${result.expectedBackend}) Q${result.qualityLevel} fps=${result.fps} p50=${result.frameMsP50}ms p95=${result.frameMsP95}ms draws=${result.drawCalls} tris=${result.triangles} errors=${result.errors.length}`
        )
        if(result.errors.length)
            console.log(`       errors: ${result.errors.join(' | ')}`)
    }

    report.pass = report.cells.length === CELLS.length && report.cells.every((c) => c.pass)
    writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(`\nWrote ${outFile} — overall ${report.pass ? 'PASS' : 'FAIL'}`)
}
catch(error)
{
    console.error('t111-backends error:', error)
    report.error = String(error)
    writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n', 'utf8')
    report.pass = false
}
finally
{
    await browser?.close().catch(() => {})
    stopServer()
}

process.exit(report.pass ? 0 : 1)
