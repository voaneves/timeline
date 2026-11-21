// T2.15a + T2.15b + T2.16 verification:
//   1. Builds debug bundle into `dist-debug-t215` with `BUILD_ID=t215orig`.
//   2. Starts `vite preview` on port 4208 (killed by PID on exit).
//   3. Verifies `?era=origens&expose` on Q0 (`?q=0`) and Q1 (`?q=1`):
//      - 0 console/page errors
//      - Q0 vs Q1 grass instance count ratio <= 0.40 (1200 -> 450, 37.5%)
//      - Draw calls <= 120 on Q1 (with baked top-down shadow active)
//      - Grass `uPlayerPos` tracks player position & bends near player
//      - `EraCycles` origens dawn preset + `setProgress(0.5)` + `setPreset('unicamp')` interpolation
//   4. Writes `tools/capture/out/t215-origens-world.json` + screenshots, and moves
//      `dist-debug-t215` to `D:\GitHub\pode_apagar\timeline\t215\dist-debug-t215`.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const dist = arg('--dist', 'dist-debug-t215')
const port = Number(arg('--port', '4208'))
const skipBuild = args.includes('--skip-build')
const keepDist = args.includes('--keep-dist')
const base = `http://127.0.0.1:${port}/`
const BUILD_ID = 't215orig'

const outDir = resolve('tools/capture/out')
const outJson = resolve(outDir, 't215-origens-world.json')
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

function moveToTrash(srcPath, destPath)
{
    if(!existsSync(srcPath))
        return
    mkdirSync(dirname(destPath), { recursive: true })
    const target = existsSync(destPath) ? `${destPath}-${Date.now()}` : destPath
    try
    {
        renameSync(srcPath, target)
    }
    catch
    {
        cpSync(srcPath, target, { recursive: true })
    }
}

const viteBin = resolve('node_modules/vite/bin/vite.js')
const distAbs = resolve(dist)
const trashRoot = 'D:/GitHub/pode_apagar/timeline/t215'

if(!skipBuild)
{
    if(existsSync(distAbs))
        moveToTrash(distAbs, join(trashRoot, `prev-${dist}`))

    console.log(`[t215] Building debug bundle into ${dist} (BUILD_ID=${BUILD_ID})...`)
    const buildEnv = { ...process.env, BUILD_ID }
    execFileSync(
        process.execPath,
        [ viteBin, 'build', '--mode', 'debug', '--outDir', `../${dist}` ],
        { stdio: 'inherit', env: buildEnv }
    )
    execFileSync(
        process.execPath,
        [ resolve('scripts/hash-assets.mjs'), '--static', 'static', '--out', dist ],
        { stdio: 'inherit', env: buildEnv }
    )
}

if(!existsSync(resolve(dist, 'index.html')))
{
    console.error(`Missing build directory: ${resolve(dist)}`)
    process.exit(2)
}

const server = spawn(
    process.execPath,
    [ viteBin, 'preview', '--outDir', `../${dist}`, '--port', String(port), '--strictPort', '--host', '127.0.0.1' ],
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

let browser = null
try
{
    // Wait for preview server
    let serverReady = false
    const deadline = Date.now() + 15000
    while(Date.now() < deadline)
    {
        try
        {
            const r = await fetch(base)
            if(r.ok)
            {
                serverReady = true
                break
            }
        }
        catch {}
        await new Promise((r) => setTimeout(r, 200))
    }
    if(!serverReady)
        throw new Error(`Preview server did not start on ${base}`)

    browser = await chromium.launch({
        executablePath: chromePath,
        headless: true,
        args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--no-sandbox',
        ],
    })

    const errors = []

    // --- Pass 1: Q0 ---
    const pageQ0 = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    pageQ0.on('pageerror', (e) => { console.error('[Q0 pageerror]', e.message); errors.push(`Q0 pageerror: ${e.message}`) })
    pageQ0.on('console', (m) => { if(m.type() === 'error') { console.error('[Q0 console.error]', m.text()); errors.push(`Q0 console.error: ${m.text()}`) } })

    await pageQ0.goto(`${base}?era=origens&expose&q=0`, { waitUntil: 'domcontentloaded' })
    await pageQ0.waitForFunction(() => Boolean(window.game?.ready && window.__perf?.count >= 10), { timeout: 60000 })

    // Move player forward briefly to verify grass uPlayerPos tracking
    await pageQ0.keyboard.down('KeyW')
    await pageQ0.waitForTimeout(400)
    await pageQ0.keyboard.up('KeyW')
    await pageQ0.waitForTimeout(200)

    const q0Data = await pageQ0.evaluate(() =>
    {
        const game = window.game
        const era = game.world.origensEra
        const grass = era.grass
        const cycles = game.eraCycles
        const origensSnap = cycles.getSnapshot()

        cycles.setProgress(0.5)
        const midSnap = cycles.getSnapshot()

        cycles.setPreset('unicamp')
        const unicampSnap = cycles.getSnapshot()

        cycles.setPreset('origens')

        return {
            qualityLevel: game.quality.level,
            drawCalls: window.__perf.drawCalls,
            triangles: window.__perf.triangles,
            grassCount: grass.getInstanceCount(),
            uPlayerPos: grass.uPlayerPos.value.toArray().map((n) => +n.toFixed(3)),
            playerPos: game.world.player.position.toArray().map((n) => +n.toFixed(3)),
            refsCount: game.world.references.size,
            dynamicObjectsCount: era.dynamicObjects.length,
            landmarkMeshesCount: era.landmarkMeshes.size,
            eraCycles: {
                origens: origensSnap,
                mid: midSnap,
                unicamp: unicampSnap,
            },
        }
    })
    await pageQ0.screenshot({ path: join(outDir, 't215-origens-q0.png') })
    await pageQ0.close()

    // --- Pass 2: Q1 ---
    const pageQ1 = await browser.newPage({ viewport: { width: 390, height: 844 } })
    pageQ1.on('pageerror', (e) => errors.push(`Q1 pageerror: ${e.message}`))
    pageQ1.on('console', (m) => { if(m.type() === 'error') errors.push(`Q1 console.error: ${m.text()}`) })

    await pageQ1.goto(`${base}?era=origens&expose&q=1`, { waitUntil: 'domcontentloaded' })
    await pageQ1.waitForFunction(() => Boolean(window.game?.ready && window.__perf?.count >= 10), { timeout: 60000 })

    const q1Data = await pageQ1.evaluate(() =>
    {
        const game = window.game
        const era = game.world.origensEra
        return {
            qualityLevel: game.quality.level,
            drawCalls: window.__perf.drawCalls,
            triangles: window.__perf.triangles,
            grassCount: era.grass.getInstanceCount(),
            castShadow: game.lighting.light.castShadow,
            bakedShadowActive: game.lighting.staticBakedShadowActive,
        }
    })
    await pageQ1.screenshot({ path: join(outDir, 't215-origens-q1.png') })
    await pageQ1.close()

    const grassRatio = q0Data.grassCount > 0 ? +(q1Data.grassCount / q0Data.grassCount).toFixed(4) : 1
    const checks = {
        noErrors: errors.length === 0,
        grassRatioLeq040: grassRatio <= 0.4,
        drawCallsQ1Leq120: q1Data.drawCalls <= 120,
        bakedShadowOnQ1: q1Data.bakedShadowActive === true && q1Data.castShadow === false,
        eraCyclesOrigensDawn: q0Data.eraCycles.origens.skyTop === '#6fa8dc'
            && q0Data.eraCycles.origens.skyBottom === '#ffd9a8'
            && q0Data.eraCycles.origens.lightColor === '#ffe2b8'
            && Math.abs(q0Data.eraCycles.origens.lightIntensity - 1.05) < 1e-4
            && q0Data.eraCycles.origens.shadowColor === '#6a3d5c'
            && q0Data.eraCycles.origens.fogColor === '#f2c9a0',
        eraCyclesUnicampPreset: q0Data.eraCycles.unicamp.skyTop === '#5fb3f0'
            && q0Data.eraCycles.unicamp.skyBottom === '#e3f4ff',
        eraCyclesMidInterpolates: q0Data.eraCycles.mid.skyTop !== q0Data.eraCycles.origens.skyTop
            && q0Data.eraCycles.mid.skyTop !== q0Data.eraCycles.unicamp.skyTop,
        grassTracksPlayer: Math.hypot(
            q0Data.uPlayerPos[0] - q0Data.playerPos[0],
            q0Data.uPlayerPos[2] - q0Data.playerPos[2]
        ) < 0.25,
    }

    const report = {
        checks,
        grassRatio,
        q0: q0Data,
        q1: q1Data,
        errors,
    }

    writeFileSync(outJson, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))

    const allPassed = Object.values(checks).every(Boolean)
    if(!allPassed)
        process.exitCode = 1
}
finally
{
    if(browser)
        await browser.close()
    stopServer()
    if(!keepDist && existsSync(distAbs))
        moveToTrash(distAbs, join(trashRoot, dist))
}
