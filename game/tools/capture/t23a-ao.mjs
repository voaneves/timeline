// T2.3a vertex Ambient Occlusion (COLOR_0) verification & 10 s capture:
//   1. Runs Blender headless (`blender/test_t23a.py`) if `blender/out/greybox_ao.glb` is missing.
//   2. Builds private `dist-debug-t23a` with `BUILD_ID=t23aao01`, staging `greybox_ao.glb` as
//      `eras/greybox/greybox.glb` inside a temporary static stage before running `hash-assets.mjs`.
//   3. Starts `vite preview` on port 4203 (killed by PID on exit).
//   4. Verifies on both WebGPU and WebGL2 (`?webgl`) that:
//      - Meshes with `COLOR_0` (`geometry.attributes.color`) and meshes without `color`
//        (player capsule/nose + a runtime-stripped mesh) render with 0 console/shader errors.
//      - Corner pixels (step creases / object-floor contacts) are measurably darker than open
//        center pixels AND darker than the same corner pixels rendered with `?ao=0`, while open
//        floor pixels (`COLOR_0 = 1.0`) match `?ao=0`.
//   5. Records a 10 s 60 fps video (`video.mp4` + `sheet.png` + `metrics.json`) via `record.mjs`
//      at `http://127.0.0.1:4203/?expose&ghost=skid`.
//   6. Moves `dist-debug-t23a` to `D:\GitHub\pode_apagar\timeline\t23a\dist-debug-t23a`.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const dist = arg('--dist', 'dist-debug-t23a')
const port = Number(arg('--port', '4203'))
const skipBuild = args.includes('--skip-build')
const skipRecord = args.includes('--skip-record')
const keepDist = args.includes('--keep-dist')
const base = `http://127.0.0.1:${port}/`
const BUILD_ID = 't23aao01'

const outDir = resolve('tools/capture/out')
const runBaseDir = resolve('tools/capture/runs/t23a')
const runDir = resolve(runBaseDir, 't23a-ao')
const outJson = resolve(outDir, 't23a-ao.json')
mkdirSync(outDir, { recursive: true })
mkdirSync(runBaseDir, { recursive: true })

const blenderExe = 'D:/GitHub/_vendor/blender-5.3.0-windows-x64/blender.exe'
const blenderTestScript = resolve('blender/test_t23a.py')
const greyboxAoGlb = resolve('blender/out/greybox_ao.glb')
const blenderReportJson = resolve('blender/out/t23a_ao_report.json')

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

function samplePatchLuma(img, cx, cy, radius = 1)
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

// --- 1. Ensure greybox_ao.glb exists -------------------------------------------------------------
if(!existsSync(greyboxAoGlb) || !existsSync(blenderReportJson))
{
    console.log('[t23a] Baking greybox_ao.glb in Blender 5.3...')
    execFileSync(blenderExe, [ '-b', '-P', blenderTestScript ], { stdio: 'inherit' })
}
const blenderReport = JSON.parse(readFileSync(blenderReportJson, 'utf8'))

// --- 2. Build dist-debug-t23a with staged greybox_ao.glb -----------------------------------------
const viteBin = resolve('node_modules/vite/bin/vite.js')
const distAbs = resolve(dist)
const trashRoot = 'D:/GitHub/pode_apagar/timeline/t23a'
const stagedStatic = join(trashRoot, `static-stage-${Date.now()}`)

if(!skipBuild)
{
    if(existsSync(distAbs))
        moveToTrash(distAbs, join(trashRoot, `prev-${dist}`))

    mkdirSync(stagedStatic, { recursive: true })
    cpSync(resolve('static'), stagedStatic, { recursive: true })
    cpSync(greyboxAoGlb, join(stagedStatic, 'eras/greybox/greybox.glb'))

    console.log(`[t23a] Building debug bundle into ${dist} (BUILD_ID=${BUILD_ID})...`)
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
}

if(!existsSync(resolve(dist, 'index.html')))
{
    console.error(`Missing build directory: ${resolve(dist)}`)
    process.exit(2)
}

// --- 3. Start vite preview on port 4203 ----------------------------------------------------------
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

// --- 4. Verify AO corner darkening & shader safety on WebGPU + WebGL2 ----------------------------
const VIEWPORT = { width: 1280, height: 720 }

async function verifyBackend(browser, { id, query })
{
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const errors = []

    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`))
    page.on('response', (r) => { if(r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`) })

    await page.bringToFront()
    await page.goto(`${base}${query}`, { waitUntil: 'load' })
    await page.waitForFunction(
        () => window.game?.ready === true && window.__perf?.count > 15,
        null,
        { timeout: 60000 }
    )
    await page.waitForTimeout(300)

    // Inspect meshes with and without COLOR_0 (`geometry.attributes.color`) and project sample points
    const sceneProbe = await page.evaluate(() =>
    {
        const game = window.game
        const cam = game.view.camera
        cam.updateMatrixWorld(true)

        let withColorAttr = 0
        let withoutColorAttr = 0
        const meshDetails = []

        game.scene.traverse((obj) =>
        {
            if(!obj.isMesh || !obj.geometry)
                return
            const colorAttr = obj.geometry.getAttribute('color')
            if(colorAttr)
            {
                withColorAttr++
                let minR = 1
                let maxR = 0
                for(let i = 0; i < colorAttr.count; i++)
                {
                    const r = colorAttr.getX(i)
                    if(r < minR) minR = r
                    if(r > maxR) maxR = r
                }
                meshDetails.push({
                    name: obj.name,
                    count: colorAttr.count,
                    minR: +minR.toFixed(4),
                    maxR: +maxR.toFixed(4),
                })
            }
            else
            {
                withoutColorAttr++
            }
        })

        // Project 3D world points onto 2D viewport pixels
        const projectPoint = (x, y, z) =>
        {
            const v = cam.position.clone().set(x, y, z).project(cam)
            return {
                x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
                y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight),
            }
        }

        // Sample points visible from initial spawn camera:
        // - stepCorner1: inner crease where Step 1 tread (y=0.3) meets Step 2 riser (z=-2.6) at x=-2.5
        // - stepCorner2: inner crease where Step 2 tread (y=0.6) meets Step 3 riser (z=-3.2) at x=-2.5
        // - stepOpenTop: open top face of Step 6 (y=1.8, z=-5.25) at x=-2.5
        // - floorRampContact: floor contact corner where ramp left wall meets ground (x=1.28, y=0.0, z=-2.4)
        // - floorOpenCenter: open center runway floor far from walls (x=0.0, y=0.0, z=-1.2)
        return {
            backend: game.rendering.renderer?.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2',
            withColorAttr,
            withoutColorAttr,
            meshDetails,
            points: {
                stepCorner1: projectPoint(-2.5, 0.31, -2.58),
                stepCorner2: projectPoint(-2.5, 0.61, -3.18),
                stepOpenTop: projectPoint(-2.5, 1.80, -5.25),
                floorRampContact: projectPoint(1.28, 0.01, -2.4),
                floorOpenCenter: projectPoint(0.0, 0.0, -1.2),
            },
        }
    })

    // Screenshot 1: AO enabled (default aoStrength = 1.0)
    const pngAoOnPath = resolve(outDir, `t23a-ao-${id}-on.png`)
    const bufAoOn = await page.screenshot({ path: pngAoOnPath, type: 'png' })

    // Screenshot 2: AO disabled via ?ao=0 at the exact same camera pose
    await page.goto(`${base}${query}&ao=0`, { waitUntil: 'load' })
    await page.waitForFunction(
        () => window.game?.ready === true && window.__perf?.count > 15,
        null,
        { timeout: 60000 }
    )
    await page.waitForTimeout(300)
    const pngAoOffPath = resolve(outDir, `t23a-ao-${id}-off.png`)
    const bufAoOff = await page.screenshot({ path: pngAoOffPath, type: 'png' })

    // Also verify stripping `color` attribute dynamically from a mesh causes 0 errors on next frames
    await page.evaluate(() =>
    {
        window.game.scene.traverse((obj) =>
        {
            if(obj.isMesh && obj.name === 'block1Visual' && obj.geometry?.getAttribute('color'))
            {
                obj.geometry.deleteAttribute('color')
            }
        })
    })
    await page.waitForTimeout(150)

    await context.close()

    const imgOn = decodePng(bufAoOn)
    const imgOff = decodePng(bufAoOff)
    const pts = sceneProbe.points

    const samples = {}
    for(const [ key, pt ] of Object.entries(pts))
    {
        const on = samplePatchLuma(imgOn, pt.x, pt.y, 1)
        const off = samplePatchLuma(imgOff, pt.x, pt.y, 1)
        samples[key] = {
            pixel: pt,
            aoOnLuma: on.luma,
            aoOnRgb: on.rgb,
            aoOffLuma: off.luma,
            aoOffRgb: off.rgb,
            aoRatio: +(on.luma / Math.max(off.luma, 1e-4)).toFixed(4),
        }
    }

    const stepCornerVsOpenRatio = +(samples.stepCorner1.aoOnLuma / Math.max(samples.stepOpenTop.aoOnLuma, 1e-4)).toFixed(4)
    const stepCornerOnVsOffRatio = samples.stepCorner1.aoRatio
    const openFloorOnVsOffDiff = +Math.abs(samples.floorOpenCenter.aoOnLuma - samples.floorOpenCenter.aoOffLuma).toFixed(4)

    const pass = (
        errors.length === 0
        && sceneProbe.withColorAttr >= 15
        && sceneProbe.withoutColorAttr >= 2
        && stepCornerVsOpenRatio < 0.88
        && stepCornerOnVsOffRatio < 0.88
        && openFloorOnVsOffDiff < 0.02
    )

    return {
        id,
        backend: sceneProbe.backend,
        withColorAttr: sceneProbe.withColorAttr,
        withoutColorAttr: sceneProbe.withoutColorAttr,
        screenshots: { aoOn: pngAoOnPath, aoOff: pngAoOffPath },
        samples,
        metrics: {
            stepCornerVsOpenRatio,
            stepCornerOnVsOffRatio,
            openFloorOnVsOffDiff,
        },
        errors,
        pass,
    }
}

const BACKENDS = [
    { id: 'webgpu', query: '?expose' },
    { id: 'webgl2', query: '?expose&webgl' },
]

const report = {
    dist,
    port,
    buildId: BUILD_ID,
    blender: {
        glb: blenderReport.out_glb,
        bytes: blenderReport.bytes,
        triangles: blenderReport.triangles,
        min_ao: blenderReport.glb_color0.min_ao,
        max_ao: blenderReport.glb_color0.max_ao,
        mean_ao: blenderReport.bake.mean_ao,
        per_object: blenderReport.bake.per_object,
    },
    backends: [],
    recording: null,
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

    for(const spec of BACKENDS)
    {
        const res = await verifyBackend(browser, spec)
        report.backends.push(res)
        console.log(
            `[${res.pass ? 'PASS' : 'FAIL'}] ${res.id} (${res.backend}): ` +
            `withColor=${res.withColorAttr} withoutColor=${res.withoutColorAttr} | ` +
            `stepCorner/openTop=${res.metrics.stepCornerVsOpenRatio} | ` +
            `stepCorner(aoOn/aoOff)=${res.metrics.stepCornerOnVsOffRatio} | ` +
            `openFloorDiff=${res.metrics.openFloorOnVsOffDiff} | errors=${res.errors.length}`
        )
        if(res.errors.length)
            console.log(`       errors: ${res.errors.join(' | ')}`)
    }

    await browser.close()
    browser = null

    // --- 5. Record 10 s 60 fps video via record.mjs ----------------------------------------------
    if(!skipRecord)
    {
        console.log('[t23a] Recording 10 s video via record.mjs...')
        execFileSync(
            process.execPath,
            [
                resolve('tools/capture/record.mjs'),
                '--profile', 'desktop',
                '--seconds', '10',
                '--capture', 'cdp',
                '--encoder', 'libx264',
                '--name', 't23a-ao',
                '--out', runBaseDir,
                '--url', `${base}?expose&ghost=skid`,
            ],
            { stdio: 'inherit' }
        )
    }

    const videoPath = join(runDir, 'video.mp4')
    const sheetPath = join(runDir, 'sheet.png')
    const metricsPath = join(runDir, 'metrics.json')
    const recMetrics = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, 'utf8')) : null

    report.recording = {
        video: videoPath,
        videoBytes: existsSync(videoPath) ? statSync(videoPath).size : 0,
        sheet: sheetPath,
        sheetExists: existsSync(sheetPath),
        metrics: metricsPath,
        fpsAvg: recMetrics?.avgFps ?? recMetrics?.fps?.avg ?? null,
        fpsP95: recMetrics?.frameTimeMs?.p95 ?? recMetrics?.fps?.p95_frame_ms ?? null,
    }

    report.pass = (
        report.backends.length === BACKENDS.length
        && report.backends.every((b) => b.pass)
        && report.recording.videoBytes > 10000
        && report.recording.sheetExists
    )
    writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(`\nWrote ${outJson} | overall ${report.pass ? 'PASS' : 'FAIL'}`)
}
catch(error)
{
    console.error('[t23a] error:', error)
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
