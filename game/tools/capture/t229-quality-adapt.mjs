// T2.29 / T2.30a / T2.30b verification:
//   node tools/capture/t229-quality-adapt.mjs [--dist dist-debug-t229] [--port 4218]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t229')
const port = Number(arg('--port', '4218'))
const base = `http://127.0.0.1:${port}/`

const chrome = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find(existsSync)

if(!chrome)
{
    console.error('Chrome executable not found')
    process.exit(2)
}

const server = spawn(
    process.execPath,
    [ resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort' ],
    { stdio: 'ignore' }
)

const stopServer = () =>
{
    if(server.pid)
    {
        try
        {
            if(process.platform === 'win32')
                execFileSync('taskkill', [ '/PID', String(server.pid), '/T', '/F' ], { stdio: 'ignore' })
            else
                server.kill('SIGTERM')
        }
        catch {}
    }
}
process.on('exit', stopServer)

for(let i = 0; i < 60; i++)
{
    try { if((await fetch(base)).ok) break } catch {}
    await new Promise((r) => setTimeout(r, 250))
}

const browser = await chromium.launch({
    headless: false,
    executablePath: chrome,
    ignoreDefaultArgs: [ '--enable-automation' ],
    args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--disable-renderer-backgrounding', '--disable-background-timer-throttling' ],
})

const errors = []
let allPassed = true
const check = (label, ok, detail = '') =>
{
    if(!ok) allPassed = false
    console.log(`${label}: ${ok ? 'PASS' : 'FAIL'}${detail ? ` (${detail})` : ''}`)
}

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

try
{
    // 1. Desktop Q0 -> Q1 -> Q2 auto-adaptation + Hud manual selector
    const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await desktopCtx.newPage()
    page.on('pageerror', (e) => { console.error('[pageerror]', e); errors.push(String(e)) })
    page.on('console', (m) => { if(m.type() === 'error') { console.error('[console.error]', m.text()); errors.push(m.text()) } })
    await page.bringToFront()

    await page.goto(`${base}?era=origens&expose`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.game?.ready === true && window.__reveal?.completedAtMs !== null, null, { timeout: 60000 })
    await page.waitForTimeout(400)

    const q0Init = await page.evaluate(() => ({
        level: window.game.quality.level,
        mode: window.game.quality.mode,
        backend: window.game.rendering.backendName,
        renderScale: window.game.rendering.renderScale,
        perf: window.__perf.snapshot(),
    }))
    check('Desktop initial Q0', q0Init.level === 0 && q0Init.mode === 'auto' && q0Init.renderScale === 1, JSON.stringify({ level: q0Init.level, backend: q0Init.backend, drawCalls: q0Init.perf.drawCalls, tris: q0Init.perf.triangles }))

    // Inject synthetic slow frame (> 18 ms) and wait for 3s window -> Q1
    await page.evaluate(() => window.game.quality.injectSyntheticFrameMs(25))
    await page.waitForFunction(() => window.game.quality.level === 1, null, { timeout: 10000 })
    const afterQ1 = await page.evaluate(() => ({
        level: window.game.quality.level,
        lastP90Ms: window.game.quality.lastP90Ms,
        adaptationCount: window.game.quality.adaptationCount,
        renderScale: window.game.rendering.renderScale,
    }))
    check('Auto-adapt Q0 -> Q1 (3s p90 > 18ms)', afterQ1.level === 1 && afterQ1.lastP90Ms > 18, JSON.stringify(afterQ1))

    // Wait another 3s window -> Q2 + dynamic resolution scale drop
    await page.waitForFunction(() => window.game.quality.level === 2, null, { timeout: 10000 })
    const afterQ2 = await page.evaluate(() => ({
        level: window.game.quality.level,
        lastP90Ms: window.game.quality.lastP90Ms,
        adaptationCount: window.game.quality.adaptationCount,
        renderScale: window.game.rendering.renderScale,
    }))
    check(
        'Auto-adapt Q1 -> Q2 + renderScale',
        afterQ2.level === 2 && afterQ2.renderScale >= 0.60 && afterQ2.renderScale <= 0.85,
        JSON.stringify(afterQ2)
    )

    // Clear synthetic slow frames and test Hud Menu manual override
    await page.evaluate(() => window.game.quality.injectSyntheticFrameMs(null))
    const hudManual = await page.evaluate(() =>
    {
        const hud = window.game.hud
        hud.openMenu()
        hud.qualitySelect.value = '0'
        hud.qualitySelect.dispatchEvent(new Event('change'))
        const afterSet0 = { mode: window.game.quality.mode, level: window.game.quality.level, renderScale: window.game.rendering.renderScale }

        hud.qualitySelect.value = 'auto'
        hud.qualitySelect.dispatchEvent(new Event('change'))
        const afterSetAuto = { mode: window.game.quality.mode, level: window.game.quality.level }
        hud.closeMenu(false)
        return { afterSet0, afterSetAuto }
    })
    check(
        'Hud Menu Quality.setManualLevel',
        hudManual.afterSet0.mode === 'manual' && hudManual.afterSet0.level === 0 && hudManual.afterSetAuto.mode === 'auto' && hudManual.afterSetAuto.level === 0,
        JSON.stringify(hudManual)
    )
    await desktopCtx.close()

    // 2. Mobile proxy Q1 Origens sweep (390x844, DPR 2, WebGL2, 4x CPU throttle)
    const mobileCtx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: MOBILE_UA,
    })
    const mPage = await mobileCtx.newPage()
    mPage.on('pageerror', (e) => { console.error('[mobile pageerror]', e); errors.push(String(e)) })
    mPage.on('console', (m) => { if(m.type() === 'error') { console.error('[mobile console.error]', m.text()); errors.push(m.text()) } })
    await mPage.bringToFront()
    const cdp = await mobileCtx.newCDPSession(mPage)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

    await mPage.goto(`${base}?era=origens&expose`, { waitUntil: 'load' })
    await mPage.waitForFunction(() => window.game?.ready === true && window.__reveal?.completedAtMs !== null, null, { timeout: 60000 })
    await mPage.waitForTimeout(1000)

    const mobileInit = await mPage.evaluate(() => ({
        backend: window.game.rendering.backendName,
        level: window.game.quality.level,
        renderScale: window.game.rendering.renderScale,
    }))
    check('Mobile proxy WebGL2 + Q1 default', mobileInit.backend === 'webgl2' && mobileInit.level === 1, JSON.stringify(mobileInit))

    const sweepStops = [
        { name: 'spawn', pos: [ 0, 1.5, 0 ] },
        { name: 'milestone_1994', pos: [ -12, 1.5, -18 ] },
        { name: 'milestone_2005', pos: [ 12, 2.0, -45 ] },
        { name: 'milestone_2011', pos: [ 0, 2.5, -72 ] },
        { name: 'garden_west', pos: [ -22, 1.5, -35 ] },
        { name: 'garden_east', pos: [ 22, 1.5, -55 ] },
    ]

    const samples = []
    for(const stop of sweepStops)
    {
        await mPage.evaluate(([ x, y, z ]) =>
        {
            const body = window.game.world?.player?.controller?.body
            if(body)
            {
                body.setTranslation({ x, y, z }, true)
                body.setLinvel({ x: 0, y: 0, z: 0 }, true)
            }
        }, stop.pos)
        await mPage.waitForTimeout(800)
        const s = await mPage.evaluate(() =>
        {
            const perf = window.__perf.snapshot()
            const info = window.game.rendering.renderer.info
            return {
                drawCalls: perf.drawCalls,
                triangles: perf.triangles,
                fps: perf.fps,
                frameMsP50: perf.frameMsP50,
                frameMsP95: perf.frameMsP95,
                geometries: info.memory.geometries,
                textures: info.memory.textures,
                programs: perf.programs,
                renderScale: window.game.rendering.renderScale,
            }
        })
        samples.push({ stop: stop.name, ...s })
    }

    const maxDrawCalls = Math.max(...samples.map((s) => s.drawCalls))
    const maxTriangles = Math.max(...samples.map((s) => s.triangles))
    const maxP95Ms = Math.max(...samples.map((s) => s.frameMsP95))
    const minFps = Math.min(...samples.map((s) => s.fps))
    const lastMem = samples[samples.length - 1]

    console.log('Mobile Q1 Origens sweep samples:', JSON.stringify(samples, null, 2))
    check('Mobile Q1 max drawCalls <= 120', maxDrawCalls <= 120, `max=${maxDrawCalls}`)
    check('Mobile Q1 max triangles <= 250000', maxTriangles <= 250000, `max=${maxTriangles}`)
    check('Mobile Q1 min p50 fps >= 50', minFps >= 50, `min=${minFps.toFixed(1)}, maxP95=${maxP95Ms.toFixed(1)}ms, geom=${lastMem.geometries}, tex=${lastMem.textures}`)

    await mobileCtx.close()
}
catch(err)
{
    console.error('Error:', err)
    allPassed = false
}
finally
{
    await browser.close().catch(() => {})
    stopServer()
}

check('Zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ') : '')
console.log(allPassed ? '\nALL T2.29/T2.30 CHECKS PASSED' : '\nSOME CHECKS FAILED')
process.exit(allPassed ? 0 : 1)
