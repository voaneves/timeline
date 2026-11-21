// Phase 2.5 Foundation Verification (F1..F8):
// Captures 5 real game-camera screenshots, runs automated house + perimeter collision checks,
// and measures consecutive-frame luminance diff to verify zero strobing/flicker.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const port = 4183
const base = `http://127.0.0.1:${port}/`
const outDir = resolve('tools/capture/out')
mkdirSync(outDir, { recursive: true })

const chromePath = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((p) => existsSync(p))
if(!chromePath) { console.error('Chrome not found'); process.exit(2) }
if(!existsSync(resolve('dist/index.html'))) { console.error('dist/ missing: run npm run build first'); process.exit(2) }

const viteBin = resolve('node_modules/vite/bin/vite.js')
const server = spawn(process.execPath, [ viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort' ], { stdio: [ 'ignore', 'pipe', 'pipe' ] })
const stopServer = () => { try { server.kill() } catch {} }
process.on('exit', stopServer)

async function waitServer()
{
    for(let i = 0; i < 60; i++)
    {
        try { if((await fetch(base)).ok) return } catch {}
        await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('vite preview failed to start')
}

async function main()
{
    await waitServer()
    const browser = await chromium.launch({
        executablePath: chromePath,
        headless: true,
        args: [ '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1280,720' ],
    })
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await context.newPage()

    const errors = []
    page.on('pageerror', (e) => { console.error('PAGEERROR:', e.message); errors.push(`pageerror: ${e.message}`) })
    page.on('console', (msg) =>
    {
        if(msg.type() === 'error' || msg.type() === 'warning')
            console.log(`BROWSER_${msg.type().toUpperCase()}:`, msg.text())
        if(msg.type() === 'error')
            errors.push(`console.error: ${msg.text()}`)
    })

    await page.goto(`${base}?era=origens&webgl`, { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(window.__perf?.game?.world?.player?.controller && window.__perf.count > 20 && window.__reveal?.completedAtMs), { timeout: 45000 })

    // Dismiss intro/title overlay if present
    const startBtn = page.locator('button:has-text("Começar"), button:has-text("Explorar"), .js-intro-start')
    if(await startBtn.count())
    {
        try { await startBtn.first().click({ timeout: 2000 }) } catch {}
    }
    await page.waitForTimeout(800)
    const diag = await page.evaluate(() =>
    {
        const g = window.__perf.game
        return {
            perf: window.__perf.snapshot(),
            revealDist: g.reveal?.distance?.value,
            camPos: g.view?.camera?.position?.toArray()?.map((n) => +n.toFixed(2)),
        }
    })
    console.log('DIAG_BOOT', JSON.stringify(diag))

    // 1. Capture spawn + road (F1 z-fighting check)
    const shot0 = await page.screenshot({ path: resolve(outDir, 't25_01_spawn_road.png') })

    // 2. Automated flicker check: 3 consecutive frames 180ms apart
    const frameBufs = [ shot0 ]
    for(let i = 1; i <= 3; i++)
    {
        await page.waitForTimeout(180)
        frameBufs.push(await page.screenshot())
    }
    const flickerStats = await page.evaluate(async (b64List) =>
    {
        const decode = async (b64) =>
        {
            const img = new Image()
            img.src = `data:image/png;base64,${b64}`
            await img.decode()
            const c = document.createElement('canvas')
            c.width = 320
            c.height = 180
            const ctx = c.getContext('2d')
            ctx.drawImage(img, 0, 0, 320, 180)
            return ctx.getImageData(0, 0, 320, 180).data
        }
        const frames = []
        for(const b of b64List)
            frames.push(await decode(b))
        let maxMeanDiff = 0
        for(let f = 1; f < frames.length; f++)
        {
            let diffSum = 0
            const a = frames[f - 1]
            const b = frames[f]
            for(let i = 0; i < a.length; i += 4)
            {
                diffSum += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3
            }
            const meanDiff = diffSum / (320 * 180)
            if(meanDiff > maxMeanDiff) maxMeanDiff = meanDiff
        }
        return { maxMeanDiff: Number(maxMeanDiff.toFixed(3)) }
    }, frameBufs.map((b) => b.toString('base64')))
    console.log('FLICKER_CHECK', JSON.stringify(flickerStats))
    if(flickerStats.maxMeanDiff > 12.0)
        throw new Error(`Excessive frame-to-frame flicker detected: ${flickerStats.maxMeanDiff}`)

    // 3. Automated house collision test (F2): walk straight SOUTH (KeyS) into north wall of origensHouse1994 (4.5, -8.95)
    await page.evaluate(() =>
    {
        const g = window.__perf.game
        g.world.player.controller.teleport(4.5, 0.55, -11.8, Math.PI)
    })
    await page.waitForTimeout(350)
    await page.keyboard.down('KeyS')
    await page.waitForTimeout(1000)
    await page.keyboard.up('KeyS')
    await page.waitForTimeout(300)
    const housePos = await page.evaluate(() =>
    {
        const t = window.__perf.game.world.player.controller.body.translation()
        return { x: Number(t.x.toFixed(2)), y: Number(t.y.toFixed(2)), z: Number(t.z.toFixed(2)) }
    })
    console.log('HOUSE_COLLISION_POS', JSON.stringify(housePos))
    await page.screenshot({ path: resolve(outDir, 't25_02_house_1994.png') })
    if(housePos.z > -10.2 && Math.abs(housePos.x - 4.5) < 2.1)
        throw new Error(`Victor walked through 1994 house! pos=${JSON.stringify(housePos)}`)

    // 4. Automated pipe warp check (F3)
    const warpRes = await page.evaluate(() =>
    {
        const w = window.__perf.game.world
        const gp = w.origensEra?.gameplay || w.zoneStreamer?.loaded?.get?.('origens')?.gameplay
        if(!gp) return { ok: false, reason: 'no gameplay' }
        return { ok: gp.startPipeWarp() }
    })
    await page.waitForTimeout(2400)
    const postWarpPos = await page.evaluate(() =>
    {
        const t = window.__perf.game.world.player.controller.body.translation()
        return { x: Number(t.x.toFixed(2)), y: Number(t.y.toFixed(2)), z: Number(t.z.toFixed(2)) }
    })
    console.log('PIPE_WARP_POS', JSON.stringify({ warpRes, postWarpPos }))
    await page.screenshot({ path: resolve(outDir, 't25_03_pipe_warp.png') })
    const distFromPipe = Math.hypot(postWarpPos.x - (-25.15), postWarpPos.z - (-17.65))
    if(!warpRes.ok || distFromPipe < 1.1)
        throw new Error(`Pipe warp failed or landed inside arrival pipe! warp=${JSON.stringify(warpRes)} dist=${distFromPipe.toFixed(2)}`)

    // 5. Automated island border containment + ocean horizon check (F5)
    await page.evaluate(() =>
    {
        window.__perf.game.world.player.controller.teleport(0.0, 0.55, 7.6, Math.PI)
    })
    await page.waitForTimeout(300)
    await page.keyboard.down('KeyS')
    await page.waitForTimeout(1400)
    await page.keyboard.up('KeyS')
    await page.waitForTimeout(300)
    const borderPos = await page.evaluate(() =>
    {
        const t = window.__perf.game.world.player.controller.body.translation()
        return { x: Number(t.x.toFixed(2)), y: Number(t.y.toFixed(2)), z: Number(t.z.toFixed(2)) }
    })
    console.log('BORDER_CONTAINMENT_POS', JSON.stringify(borderPos))
    await page.screenshot({ path: resolve(outDir, 't25_04_border_ocean.png') })
    if(borderPos.y < -0.5 || borderPos.z > 10.2)
        throw new Error(`Victor fell off island border! pos=${JSON.stringify(borderPos)}`)

    // 6. Elevated overview (school terrace / north plateau)
    await page.evaluate(() =>
    {
        window.__perf.game.world.player.controller.teleport(-11.0, 1.4, -17.0, 0)
    })
    await page.waitForTimeout(600)
    await page.screenshot({ path: resolve(outDir, 't25_05_elevated_overview.png') })

    if(errors.length)
        throw new Error(`Runtime errors detected:\n${errors.join('\n')}`)

    await browser.close()
    stopServer()
    console.log('T25_FOUNDATION_VERIFY_OK')
}

main().catch((err) =>
{
    console.error(err)
    stopServer()
    process.exit(1)
})
