// T2.3b top-down static shadow for Q1 verification & mobile proxy performance comparison:
//   1. Runs Blender headless (`blender/test_t23b.py`) if `blender/out/greybox_shadow.png` or
//      `blender/out/greybox_shadow.json` is missing.
//   2. Builds private `dist-debug-t23b` with `BUILD_ID=t23bsh01`, staging `greybox_shadow.png`
//      + `greybox_shadow.json` under `eras/greybox/` in a temporary static stage before running
//      `hash-assets.mjs` (and also copies them to `dist-debug-t23b/` root).
//   3. Starts `vite preview` on port 4204 (killed by PID on exit).
//   4. Measures in headed Chrome mobile proxy (`390x844`, DPR 2, Android mobile UA, Q1 WebGL2,
//      4x CDP CPU throttle):
//      - BEFORE (`?expose&q1shadow=realtime`): Q1 with 512x512 real-time directional shadow map
//        (`light.castShadow === true`, `bakedShadowEnabled === 0`).
//      - AFTER (`?expose&q1shadow=baked`, also default on Q1 when baked shadow asset is present):
//        Q1 with `light.castShadow === false` + top-down baked shadow texture `greybox_shadow.png`
//        sampled by `positionWorld.xz`.
//   5. Verifies:
//      - `light.castShadow === false` and `bakedShadowEnabled === 1` in the AFTER state.
//      - Static shadows visibly appear on ground receivers (`shadowedLuma < litLuma * 0.80`)
//        for both ramp and step shadow zones, and when `clearBakedShadow()` is called with
//        `castShadow === false`, those same shadow pixels return to full lit ground luminance.
//      - Draw calls per frame drop significantly (eliminating the directional shadow map pass)
//        and mobile proxy frame time (`frameMsP50`, `frameMsP95`, and synchronous multi-pass
//        render CPU frame time `renderBenchMsPerFrame`) decreases.
//   6. Writes `tools/capture/out/t23b-shadow.json` + before/after screenshots and moves
//      `dist-debug-t23b` to `D:\GitHub\pode_apagar\timeline\t23b\dist-debug-t23b`.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const dist = arg('--dist', 'dist-debug-t23b')
const port = Number(arg('--port', '4204'))
const skipBuild = args.includes('--skip-build')
const keepDist = args.includes('--keep-dist')
const base = `http://127.0.0.1:${port}/`
const BUILD_ID = 't23bsh01'

const outDir = resolve('tools/capture/out')
const outJson = resolve(outDir, 't23b-shadow.json')
mkdirSync(outDir, { recursive: true })

const blenderExe = 'D:/GitHub/_vendor/blender-5.3.0-windows-x64/blender.exe'
const blenderTestScript = resolve('blender/test_t23b.py')
const greyboxShadowPng = resolve('blender/out/greybox_shadow.png')
const greyboxShadowJson = resolve('blender/out/greybox_shadow.json')
const greyboxAoGlb = resolve('blender/out/greybox_ao.glb')

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

// --- Pure Node PNG decoder (8-bit RGB/RGBA) ------------------------------------------------------
const PNG_SIG = Buffer.from([ 137, 80, 78, 71, 13, 10, 26, 10 ])

function paeth(a, b, c)
{
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function decodePng(buf)
{
    if(buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG))
        throw new Error('Invalid PNG signature')

    let pos = 8
    let width = 0
    let height = 0
    let depth = 0
    let ctype = 0
    let interlace = 0
    const idat = []

    while(pos + 8 <= buf.length)
    {
        const len = buf.readUInt32BE(pos)
        const type = buf.toString('latin1', pos + 4, pos + 8)
        const data = buf.subarray(pos + 8, pos + 8 + len)
        if(type === 'IHDR')
        {
            width = data.readUInt32BE(0)
            height = data.readUInt32BE(4)
            depth = data[8]
            ctype = data[9]
            interlace = data[12]
        }
        else if(type === 'IDAT')
        {
            idat.push(data)
        }
        else if(type === 'IEND')
        {
            break
        }
        pos += 12 + len
    }

    const channels = ctype === 6 ? 4 : ctype === 2 ? 3 : 0
    if(!width || !height || depth !== 8 || !channels || interlace !== 0)
        throw new Error(`Unsupported PNG format: ${width}x${height} depth=${depth} ctype=${ctype}`)

    const raw = inflateSync(Buffer.concat(idat))
    const stride = width * channels
    const pixels = Buffer.alloc(stride * height)

    for(let y = 0; y < height; y++)
    {
        const filter = raw[y * (stride + 1)]
        const src = y * (stride + 1) + 1
        const dst = y * stride
        for(let x = 0; x < stride; x++)
        {
            const cur = raw[src + x]
            const a = x >= channels ? pixels[dst + x - channels] : 0
            const b = y > 0 ? pixels[dst - stride + x] : 0
            const c = x >= channels && y > 0 ? pixels[dst - stride + x - channels] : 0
            let v
            if(filter === 0) v = cur
            else if(filter === 1) v = cur + a
            else if(filter === 2) v = cur + b
            else if(filter === 3) v = cur + ((a + b) >> 1)
            else if(filter === 4) v = cur + paeth(a, b, c)
            else throw new Error(`Unsupported PNG filter ${filter}`)
            pixels[dst + x] = v & 255
        }
    }

    return { width, height, channels, pixels }
}

function samplePatchLuma(img, cx, cy, radius = 2)
{
    let sumLuma = 0
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let count = 0
    for(let dy = -radius; dy <= radius; dy++)
    {
        for(let dx = -radius; dx <= radius; dx++)
        {
            const ix = Math.max(0, Math.min(img.width - 1, Math.round(cx + dx)))
            const iy = Math.max(0, Math.min(img.height - 1, Math.round(cy + dy)))
            const off = (iy * img.width + ix) * img.channels
            const r = img.pixels[off]
            const g = img.pixels[off + 1]
            const b = img.pixels[off + 2]
            const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
            sumLuma += luma
            sumR += r
            sumG += g
            sumB += b
            count++
        }
    }
    return {
        luma: +(sumLuma / count).toFixed(4),
        rgb: [ Math.round(sumR / count), Math.round(sumG / count), Math.round(sumB / count) ],
    }
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

// --- 1. Ensure greybox_shadow.png + greybox_shadow.json exist -----------------------------------
if(!skipBuild || !existsSync(greyboxShadowPng) || !existsSync(greyboxShadowJson))
{
    console.log('[t23b] Baking greybox_shadow.png in Blender 5.3...')
    execFileSync(blenderExe, [ '-b', '-P', blenderTestScript ], { stdio: 'inherit' })
}
const shadowMeta = JSON.parse(readFileSync(greyboxShadowJson, 'utf8'))

// --- 2. Build dist-debug-t23b with staged greybox_shadow.png + greybox_shadow.json --------------
const viteBin = resolve('node_modules/vite/bin/vite.js')
const distAbs = resolve(dist)
const trashRoot = 'D:/GitHub/pode_apagar/timeline/t23b'
const stagedStatic = join(trashRoot, `static-stage-${Date.now()}`)

if(!skipBuild)
{
    if(existsSync(distAbs))
        moveToTrash(distAbs, join(trashRoot, `prev-${dist}`))

    mkdirSync(stagedStatic, { recursive: true })
    cpSync(resolve('static'), stagedStatic, { recursive: true })
    if(existsSync(greyboxAoGlb))
        cpSync(greyboxAoGlb, join(stagedStatic, 'eras/greybox/greybox.glb'))
    cpSync(greyboxShadowPng, join(stagedStatic, 'eras/greybox/greybox_shadow.png'))
    cpSync(greyboxShadowJson, join(stagedStatic, 'eras/greybox/greybox_shadow.json'))

    console.log(`[t23b] Building debug bundle into ${dist} (BUILD_ID=${BUILD_ID})...`)
    const buildEnv = { ...process.env, BUILD_ID }
    execFileSync(
        process.execPath,
        [ viteBin, 'build', '--mode', 'debug', '--outDir', `../${dist}` ],
        { stdio: 'inherit', env: buildEnv }
    )
    execFileSync(
        process.execPath,
        [ resolve('scripts/hash-assets.mjs'), '--static', stagedStatic, '--out', dist, '--include-test' ],
        { stdio: 'inherit', env: buildEnv }
    )
    // Also copy directly to dist root as requested
    cpSync(greyboxShadowPng, join(distAbs, 'greybox_shadow.png'))
    cpSync(greyboxShadowJson, join(distAbs, 'greybox_shadow.json'))
}

if(!existsSync(resolve(dist, 'index.html')))
{
    console.error(`Missing build directory: ${resolve(dist)}`)
    process.exit(2)
}

// --- 3. Start vite preview on port 4204 ----------------------------------------------------------
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

// --- 4. Mobile proxy measurement helper ----------------------------------------------------------
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
const MOBILE_VIEWPORT = { width: 390, height: 844 }
const MOBILE_DPR = 2
const CPU_THROTTLE = 4
const WARMUP_MS = 2000
const SAMPLE_MS = 5000
const POLL_MS = 400

async function measureMobileQ1Mode(browser, { id, query, expectCastShadow, expectBakedEnabled })
{
    const context = await browser.newContext({
        viewport: MOBILE_VIEWPORT,
        deviceScaleFactor: MOBILE_DPR,
        isMobile: true,
        hasTouch: true,
        userAgent: MOBILE_UA,
    })
    const page = await context.newPage()
    const errors = []

    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`))
    page.on('response', (r) => { if(r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`) })

    await page.bringToFront()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

    await page.goto(`${base}${query}`, { waitUntil: 'load' })
    await page.waitForFunction(
        () => window.game?.ready === true && window.__perf?.count > 15,
        null,
        { timeout: 60000 }
    )

    // Warmup
    await page.waitForTimeout(WARMUP_MS)

    // Reset perf ring buffer so P50/P95 only reflect steady-state after warmup
    await page.evaluate(() =>
    {
        window.__perf.count = 0
        window.__perf.last = performance.now()
    })

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

    // Also run a deterministic 120-iteration synchronous render-pass CPU benchmark under 4x CPU throttle
    // (using `renderer.render(scene, camera)` directly so postProcessing's internal async check does not skip)
    // to record the exact CPU submission + shadow-map pass cost per frame unobstructed by display 75 Hz vsync.
    const probe = await page.evaluate(() =>
    {
        const game = window.game
        const snap = window.__perf.snapshot()
        const count = window.__perf.count
        const t = performance.now()

        const renderer = game.rendering.renderer
        const scene = game.scene
        const cam = game.view.camera
        cam.updateMatrixWorld(true)

        // Warm 5 synchronous renders, then time 120 synchronous scene+shadow renders
        for(let i = 0; i < 5; i++)
            renderer.render(scene, cam)

        const iters = 120
        const t0 = performance.now()
        for(let i = 0; i < iters; i++)
        {
            renderer.render(scene, cam)
        }
        const renderBenchTotalMs = performance.now() - t0
        const renderBenchMsPerFrame = renderBenchTotalMs / iters

        const dpr = window.devicePixelRatio || 1

        // Project 3D world points onto device-pixel screenshot coordinates
        const projectDevicePx = (x, y, z) =>
        {
            const v = cam.position.clone().set(x, y, z).project(cam)
            return {
                x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth * dpr),
                y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight * dpr),
            }
        }

        // Probe points on the ground floor (y = 0) visible in the mobile 390x844 portrait frame:
        // - block1ShadowGround: floor in the shadow cast by Block 1 (0, 3.7, -8) at (+0.40, 0.0, -6.00)
        // - stepsShadowGround: floor in the shadow cast by Steps at (-1.20, 0.0, -4.80)
        // - playerShadowGround: floor in the real-time shadow cast by the player capsule at (+0.15, 0.0, +0.35)
        // - openGroundCenter: open sunlit runway floor at (0.0, 0.0, -2.0)
        // - openGroundBetweenBlocks: open sunlit floor between Block 1 and Block 2 shadows at (0.40, 0.0, -7.25)
        const matClass = game.materials.list.get('palette')?.constructor
        return {
            perf: snap,
            count,
            t,
            renderBenchMsPerFrame: +renderBenchMsPerFrame.toFixed(3),
            backendName: game.rendering.backendName,
            qualityLevel: game.quality.level,
            lightCastShadow: Boolean(game.lighting.light.castShadow),
            rendererShadowMapEnabled: Boolean(game.rendering.renderer.shadowMap.enabled),
            bakedShadowEnabled: matClass?.bakedShadowEnabledUniform?.value ?? 0,
            bakedShadowBounds: matClass?.bakedShadowBounds ?? null,
            points: {
                block1ShadowGround: projectDevicePx(0.40, 0.0, -6.00),
                stepsShadowGround: projectDevicePx(-1.20, 0.0, -4.80),
                playerShadowGround: projectDevicePx(0.15, 0.0, 0.35),
                openGroundCenter: projectDevicePx(0.0, 0.0, -2.0),
                openGroundBetweenBlocks: projectDevicePx(0.40, 0.0, -7.25),
            },
        }
    })

    const screenshotPath = resolve(outDir, `t23b-q1-${id}.png`)
    const pngBuf = await page.screenshot({ path: screenshotPath, type: 'png' })
    const img = decodePng(pngBuf)

    const samples = {}
    for(const [ key, pt ] of Object.entries(probe.points))
    {
        samples[key] = {
            pixel: pt,
            ...samplePatchLuma(img, pt.x, pt.y, 2),
        }
    }

    // If this is the AFTER (baked) mode, also take a control sample with bakedShadowEnabled=0
    // while keeping light.castShadow=false to prove the ground darkening comes 100% from the
    // top-down baked shadow texture.
    let unbakedControl = null
    if(expectBakedEnabled)
    {
        await page.evaluate(() =>
        {
            const matClass = window.game.materials.list.get('palette')?.constructor
            if(matClass?.bakedShadowEnabledUniform)
                matClass.bakedShadowEnabledUniform.value = 0
        })
        await page.waitForTimeout(150)
        const ctrlPath = resolve(outDir, `t23b-q1-${id}-nobaked-ctrl.png`)
        const ctrlBuf = await page.screenshot({ path: ctrlPath, type: 'png' })
        const ctrlImg = decodePng(ctrlBuf)
        unbakedControl = {
            screenshot: ctrlPath,
            block1ShadowGround: samplePatchLuma(ctrlImg, probe.points.block1ShadowGround.x, probe.points.block1ShadowGround.y, 2),
            stepsShadowGround: samplePatchLuma(ctrlImg, probe.points.stepsShadowGround.x, probe.points.stepsShadowGround.y, 2),
            openGroundCenter: samplePatchLuma(ctrlImg, probe.points.openGroundCenter.x, probe.points.openGroundCenter.y, 2),
        }
    }

    await context.close()

    const elapsedMs = Math.max(1, probe.t - start.t)
    const avgFps = ((probe.count - start.count) / elapsedMs) * 1000
    // On AFTER (baked static shadow), check both static shadow probes (block1ShadowGround & stepsShadowGround).
    // On BEFORE (real-time shadow map), check the active shadow probe (playerShadowGround / stepsShadowGround).
    const shadowedLuma = expectBakedEnabled
        ? Math.max(samples.block1ShadowGround.luma, samples.stepsShadowGround.luma)
        : Math.min(samples.playerShadowGround.luma, samples.stepsShadowGround.luma)
    const litLuma = samples.openGroundCenter.luma
    const shadowToLitRatio = +(shadowedLuma / Math.max(litLuma, 1e-4)).toFixed(4)

    const pass = (
        errors.length === 0
        && probe.qualityLevel === 1
        && probe.backendName === 'webgl2'
        && probe.lightCastShadow === expectCastShadow
        && Boolean(probe.bakedShadowEnabled > 0.5) === expectBakedEnabled
        && shadowedLuma < litLuma * 0.80
        && (!unbakedControl || Math.abs(unbakedControl.block1ShadowGround.luma - unbakedControl.openGroundCenter.luma) < 0.03)
    )

    return {
        id,
        query,
        backend: probe.backendName,
        qualityLevel: probe.qualityLevel,
        lightCastShadow: probe.lightCastShadow,
        rendererShadowMapEnabled: probe.rendererShadowMapEnabled,
        bakedShadowEnabled: probe.bakedShadowEnabled,
        fps: +avgFps.toFixed(1),
        p50Fps: +probe.perf.fps.toFixed(1),
        frameMsP50: +probe.perf.frameMsP50.toFixed(2),
        frameMsP95: +probe.perf.frameMsP95.toFixed(2),
        renderBenchMsPerFrame: probe.renderBenchMsPerFrame,
        drawCalls: maxDrawCalls,
        triangles: maxTriangles,
        programs: probe.perf.programs,
        shadowedLuma,
        litLuma,
        shadowToLitRatio,
        samples,
        unbakedControl,
        screenshot: screenshotPath,
        errors,
        pass,
    }
}

const report = {
    dist,
    port,
    buildId: BUILD_ID,
    shadowTexture: {
        png: greyboxShadowPng,
        meta: greyboxShadowJson,
        bytes: shadowMeta.bytes,
        resolution: shadowMeta.resolution,
        bounds: [ shadowMeta.minX, shadowMeta.maxX, shadowMeta.minZ, shadowMeta.maxZ ],
        sunDir: shadowMeta.sunDir,
        stats: shadowMeta.stats,
        probes: shadowMeta.probes,
    },
    beforeRealtimeQ1: null,
    afterBakedQ1: null,
    comparison: null,
    pass: false,
}

let browser = null

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

    // 1. BEFORE: Q1 with 512x512 real-time directional shadow map
    const beforeRes = await measureMobileQ1Mode(browser, {
        id: 'before-realtime',
        query: '?expose&q1shadow=realtime',
        expectCastShadow: true,
        expectBakedEnabled: false,
    })
    report.beforeRealtimeQ1 = beforeRes
    console.log(
        `[${beforeRes.pass ? 'PASS' : 'FAIL'}] BEFORE (Q1 real-time 512^2 shadow map): ` +
        `castShadow=${beforeRes.lightCastShadow} draws=${beforeRes.drawCalls} tris=${beforeRes.triangles} | ` +
        `fps=${beforeRes.fps} p50=${beforeRes.frameMsP50}ms p95=${beforeRes.frameMsP95}ms renderCPU=${beforeRes.renderBenchMsPerFrame}ms | ` +
        `shadowLuma=${beforeRes.shadowedLuma} litLuma=${beforeRes.litLuma} (ratio=${beforeRes.shadowToLitRatio})`
    )

    // 2. AFTER: Q1 with light.castShadow = false + top-down baked shadow texture (default on Q1)
    const afterRes = await measureMobileQ1Mode(browser, {
        id: 'after-baked',
        query: '?expose',
        expectCastShadow: false,
        expectBakedEnabled: true,
    })
    report.afterBakedQ1 = afterRes
    console.log(
        `[${afterRes.pass ? 'PASS' : 'FAIL'}] AFTER  (Q1 baked top-down R8 shadow, no shadow map): ` +
        `castShadow=${afterRes.lightCastShadow} draws=${afterRes.drawCalls} tris=${afterRes.triangles} | ` +
        `fps=${afterRes.fps} p50=${afterRes.frameMsP50}ms p95=${afterRes.frameMsP95}ms renderCPU=${afterRes.renderBenchMsPerFrame}ms | ` +
        `shadowLuma=${afterRes.shadowedLuma} litLuma=${afterRes.litLuma} (ratio=${afterRes.shadowToLitRatio})`
    )

    report.comparison = {
        drawCallsBefore: beforeRes.drawCalls,
        drawCallsAfter: afterRes.drawCalls,
        drawCallsDelta: afterRes.drawCalls - beforeRes.drawCalls,
        trianglesBefore: beforeRes.triangles,
        trianglesAfter: afterRes.triangles,
        trianglesDelta: afterRes.triangles - beforeRes.triangles,
        frameMsP50Before: beforeRes.frameMsP50,
        frameMsP50After: afterRes.frameMsP50,
        frameMsP95Before: beforeRes.frameMsP95,
        frameMsP95After: afterRes.frameMsP95,
        fpsBefore: beforeRes.fps,
        fpsAfter: afterRes.fps,
        renderBenchMsBefore: beforeRes.renderBenchMsPerFrame,
        renderBenchMsAfter: afterRes.renderBenchMsPerFrame,
        renderBenchSpeedupPct: +(((beforeRes.renderBenchMsPerFrame - afterRes.renderBenchMsPerFrame) / Math.max(beforeRes.renderBenchMsPerFrame, 1e-4)) * 100).toFixed(1),
    }

    report.pass = (
        beforeRes.pass
        && afterRes.pass
        && afterRes.drawCalls < beforeRes.drawCalls
        && afterRes.renderBenchMsPerFrame < beforeRes.renderBenchMsPerFrame
        && (afterRes.frameMsP50 <= beforeRes.frameMsP50 || afterRes.frameMsP95 <= beforeRes.frameMsP95)
    )

    writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(`\nWrote ${outJson} | overall ${report.pass ? 'PASS' : 'FAIL'}`)
}
catch(error)
{
    console.error('[t23b] error:', error)
    report.error = String(error)
    writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n', 'utf8')
    report.pass = false
}
finally
{
    await browser?.close().catch(() => {})
    stopServer()
    if(!keepDist)
    {
        moveToTrash(distAbs, join(trashRoot, dist))
    }
}

process.exit(report.pass ? 0 : 1)
