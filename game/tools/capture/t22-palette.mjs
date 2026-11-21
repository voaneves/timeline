// T2.2 palette color calibration check: builds to private dist-debug-t22, starts vite preview
// on port 4202, opens ?debug=palette&expose in headed Chrome (WebGPU and ?webgl), samples the
// rendered center pixel of every named swatch from palette.json, and asserts max CIEDE2000 < 3.0.
//
// Usage:
//   node tools/capture/t22-palette.mjs [--dist dist-debug-t22] [--port 4202] [--skip-build]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const dist = arg('--dist', 'dist-debug-t22')
const port = Number(arg('--port', '4202'))
const skipBuild = args.includes('--skip-build')
const base = `http://127.0.0.1:${port}/`

const outDir = resolve('tools/capture/out')
const outJson = resolve(outDir, 't22-palette.json')
mkdirSync(outDir, { recursive: true })

const paletteJsonPath = resolve('blender/palette/palette.json')
const palettePngPath = resolve('static/palette.png')
const paletteData = JSON.parse(readFileSync(paletteJsonPath, 'utf8'))
const palettePngBytes = statSync(palettePngPath).size

const DELTA_E_LIMIT = 3.0
const VIEWPORT = { width: 1280, height: 720 }

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

// --- Pure Node PNG decoder (8-bit RGB/RGBA, filters 0..4) ----------------------------------------
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
        throw new Error(`Unsupported PNG format: ${width}x${height} depth=${depth} ctype=${ctype} interlace=${interlace}`)

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

function getPixel(img, x, y)
{
    const ix = Math.max(0, Math.min(img.width - 1, Math.round(x)))
    const iy = Math.max(0, Math.min(img.height - 1, Math.round(y)))
    const off = (iy * img.width + ix) * img.channels
    return [ img.pixels[off], img.pixels[off + 1], img.pixels[off + 2] ]
}

// --- CIEDE2000 (Sharma, Wu & Dalal 2005, sRGB D65, kL=kC=kH=1) -----------------------------------
function parseHex(hex)
{
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ]
}

function toHex([ r, g, b ])
{
    return '#' + [ r, g, b ].map((v) => v.toString(16).padStart(2, '0')).join('')
}

function srgbToLinear(c)
{
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function rgbToLab([ r8, g8, b8 ])
{
    const r = srgbToLinear(r8)
    const g = srgbToLinear(g8)
    const b = srgbToLinear(b8)

    const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    const z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041

    const eps = 216 / 24389
    const kappa = 24389 / 27
    const f = (t) => (t > eps ? Math.cbrt(t) : (kappa * t + 16) / 116)

    const fx = f(x / 0.95047)
    const fy = f(y / 1.00000)
    const fz = f(z / 1.08883)

    return [ 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz) ]
}

function deltaE2000(rgb1, rgb2)
{
    const [ L1, a1, b1 ] = rgbToLab(rgb1)
    const [ L2, a2, b2 ] = rgbToLab(rgb2)

    const DEG = Math.PI / 180
    const RAD = 180 / Math.PI
    const POW25_7 = Math.pow(25, 7)

    const C1 = Math.hypot(a1, b1)
    const C2 = Math.hypot(a2, b2)
    const Cbar = (C1 + C2) * 0.5
    const Cbar7 = Math.pow(Cbar, 7)
    const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)))

    const a1p = (1 + G) * a1
    const a2p = (1 + G) * a2
    const C1p = Math.hypot(a1p, b1)
    const C2p = Math.hypot(a2p, b2)

    const hueDeg = (bp, ap) =>
    {
        if(ap === 0 && bp === 0)
            return 0
        const h = Math.atan2(bp, ap) * RAD
        return h >= 0 ? h : h + 360
    }
    const h1p = hueDeg(b1, a1p)
    const h2p = hueDeg(b2, a2p)

    const dLp = L2 - L1
    const dCp = C2p - C1p

    let dhp = 0
    if(C1p * C2p !== 0)
    {
        const diff = h2p - h1p
        if(Math.abs(diff) <= 180) dhp = diff
        else if(diff > 180) dhp = diff - 360
        else dhp = diff + 360
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * 0.5 * DEG)

    const LpBar = (L1 + L2) * 0.5
    const CpBar = (C1p + C2p) * 0.5

    let hpBar = h1p + h2p
    if(C1p * C2p !== 0)
    {
        if(Math.abs(h1p - h2p) <= 180) hpBar = (h1p + h2p) * 0.5
        else if(h1p + h2p < 360) hpBar = (h1p + h2p + 360) * 0.5
        else hpBar = (h1p + h2p - 360) * 0.5
    }

    const T = 1
        - 0.17 * Math.cos((hpBar - 30) * DEG)
        + 0.24 * Math.cos((2 * hpBar) * DEG)
        + 0.32 * Math.cos((3 * hpBar + 6) * DEG)
        - 0.20 * Math.cos((4 * hpBar - 63) * DEG)

    const dTheta = 30 * Math.exp(-Math.pow((hpBar - 275) / 25, 2))
    const CpBar7 = Math.pow(CpBar, 7)
    const RC = 2 * Math.sqrt(CpBar7 / (CpBar7 + POW25_7))
    const Lp50Sq = Math.pow(LpBar - 50, 2)
    const SL = 1 + (0.015 * Lp50Sq) / Math.sqrt(20 + Lp50Sq)
    const SC = 1 + 0.045 * CpBar
    const SH = 1 + 0.015 * CpBar * T
    const RT = -Math.sin(2 * dTheta * DEG) * RC

    const termL = dLp / SL
    const termC = dCp / SC
    const termH = dHp / SH
    return Math.sqrt(termL * termL + termC * termC + termH * termH + RT * termC * termH)
}

// --- Build dist-debug-t22 + hash-assets ----------------------------------------------------------
const viteBin = resolve('node_modules/vite/bin/vite.js')

if(!skipBuild)
{
    console.log(`[t22] Building debug bundle into ${dist}...`)
    execFileSync(
        process.execPath,
        [ viteBin, 'build', '--mode', 'debug', '--outDir', `../${dist}` ],
        { stdio: 'inherit' }
    )
    execFileSync(
        process.execPath,
        [ resolve('scripts/hash-assets.mjs'), '--out', dist, '--include-test' ],
        { stdio: 'inherit' }
    )
}

if(!existsSync(resolve(dist, 'index.html')))
{
    console.error(`Missing build directory: ${resolve(dist)}`)
    process.exit(2)
}

// --- Start vite preview on port 4202 -------------------------------------------------------------
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

async function runBackend(browser, { id, query, expectedBackend })
{
    const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
    })
    const page = await context.newPage()
    const errors = []

    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`))
    page.on('response', (r) => { if(r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`) })

    await page.bringToFront()
    await page.goto(`${base}${query}`, { waitUntil: 'load' })
    await page.waitForFunction(
        () => window.game?.ready === true
            && window.__paletteCalibration?.ready === true
            && window.__perf?.count > 10,
        null,
        { timeout: 60000 }
    )
    // Wait a few frames for layout settle
    await page.waitForTimeout(300)

    const meta = await page.evaluate(() => ({
        backend: window.__paletteCalibration.backend,
        toneMapping: window.__paletteCalibration.toneMapping,
        toneMappingValue: window.__paletteCalibration.toneMappingValue,
        outputColorSpace: window.__paletteCalibration.outputColorSpace,
        uvConvention: window.__paletteCalibration.uvConvention,
        sampleRects: window.__paletteCalibration.sampleRects,
    }))

    const pngPath = resolve(outDir, `t22-palette-${id}.png`)
    const pngBuf = await page.screenshot({ path: pngPath, type: 'png' })
    await context.close()

    const img = decodePng(pngBuf)
    const swatchNames = Object.keys(paletteData.swatches)
    const results = []
    let maxDeltaE = 0
    let worstSwatch = null
    let nonUniformCount = 0

    for(const name of swatchNames)
    {
        const spec = paletteData.swatches[name]
        const rect = meta.sampleRects[name]
        if(!rect)
            throw new Error(`Missing sampleRect for swatch ${name}`)

        const expectedRgb = parseHex(spec.hex)
        const measuredRgb = getPixel(img, rect.centerX, rect.centerY)

        // Verify a 3x3 patch around center is uniform (confirms solid quad interior)
        let uniform = true
        for(let dy = -1; dy <= 1; dy++)
        {
            for(let dx = -1; dx <= 1; dx++)
            {
                const p = getPixel(img, rect.centerX + dx, rect.centerY + dy)
                if(p[0] !== measuredRgb[0] || p[1] !== measuredRgb[1] || p[2] !== measuredRgb[2])
                    uniform = false
            }
        }
        if(!uniform)
            nonUniformCount++

        const dE = deltaE2000(expectedRgb, measuredRgb)
        if(dE >= maxDeltaE)
        {
            maxDeltaE = dE
            worstSwatch = name
        }

        results.push({
            name,
            col: spec.col,
            row: spec.row,
            group: spec.group,
            expectedHex: spec.hex,
            measuredHex: toHex(measuredRgb),
            expectedRgb,
            measuredRgb,
            deltaE2000: +dE.toFixed(4),
            uniform3x3: uniform,
        })
    }

    const meanDeltaE = results.reduce((acc, r) => acc + r.deltaE2000, 0) / results.length
    const backendMatches = meta.backend === expectedBackend
    const pass = backendMatches && errors.length === 0 && maxDeltaE < DELTA_E_LIMIT && nonUniformCount === 0

    return {
        id,
        query,
        expectedBackend,
        actualBackend: meta.backend,
        toneMapping: meta.toneMapping,
        toneMappingValue: meta.toneMappingValue,
        outputColorSpace: meta.outputColorSpace,
        screenshot: pngPath,
        swatchCount: results.length,
        maxDeltaE2000: +maxDeltaE.toFixed(4),
        meanDeltaE2000: +meanDeltaE.toFixed(4),
        worstSwatch,
        nonUniformCount,
        errors,
        pass,
        swatches: results,
    }
}

const BACKENDS = [
    { id: 'webgpu', query: '?debug=palette&expose', expectedBackend: 'webgpu' },
    { id: 'webgl2', query: '?debug=palette&expose&webgl', expectedBackend: 'webgl2' },
]

let browser = null
const report = {
    dist,
    port,
    palettePngBytes,
    swatchCount: Object.keys(paletteData.swatches).length,
    deltaELimit: DELTA_E_LIMIT,
    backends: [],
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

    for(const spec of BACKENDS)
    {
        const res = await runBackend(browser, spec)
        report.backends.push(res)

        console.log(`\n=== ${res.id.toUpperCase()} (${res.actualBackend}) | toneMapping=${res.toneMapping} | colorSpace=${res.outputColorSpace} ===`)
        console.log('swatch            pos     expected  measured  dE2000   uniform')
        for(const s of res.swatches)
        {
            const pos = `(${String(s.col).padStart(2)},${String(s.row).padStart(2)})`
            console.log(
                `${s.name.padEnd(17)} ${pos}  ${s.expectedHex}   ${s.measuredHex}   ${s.deltaE2000.toFixed(4).padStart(6)}   ${s.uniform3x3 ? 'ok' : 'FAIL'}`
            )
        }
        console.log(
            `[${res.pass ? 'PASS' : 'FAIL'}] ${res.id}: ${res.swatchCount} swatches | max dE2000 = ${res.maxDeltaE2000.toFixed(4)} (${res.worstSwatch}) | mean = ${res.meanDeltaE2000.toFixed(4)} | nonUniform=${res.nonUniformCount} | errors=${res.errors.length}`
        )
        if(res.errors.length)
            console.log(`       errors: ${res.errors.join(' | ')}`)
    }

    report.pass = report.backends.length === BACKENDS.length && report.backends.every((b) => b.pass)
    writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(`\nWrote ${outJson} | palette.png=${palettePngBytes} B | overall ${report.pass ? 'PASS' : 'FAIL'}`)
}
catch(error)
{
    console.error('t22-palette error:', error)
    report.error = String(error)
    writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n', 'utf8')
    report.pass = false
}
finally
{
    await browser?.close().catch(() => {})
    stopServer()
}

process.exit(report.pass ? 0 : 1)
