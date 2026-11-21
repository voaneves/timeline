// WCAG 2.3.1 Flash Check (T2.27b): verifies <= 3 large-area luminance transitions/sec
// across Origens gameplay and the End-Dot Contact stamp using ffmpeg `signalstats` (YAVG).
// Usage:
//   node tools/capture/flash-check.mjs [--dist dist-debug-t225] [--port 4219] [--skip-build]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t225')
const port = Number(arg('--port', '4219'))
const skipBuild = args.includes('--skip-build')
const base = `http://127.0.0.1:${port}/`

const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync)

if(!chrome)
    throw new Error('Chrome executable not found')

const viteBin = resolve('node_modules/vite/bin/vite.js')
if(!skipBuild)
{
    console.log(`building ${dist}...`)
    execFileSync(process.execPath, [ viteBin, 'build', '--mode', 'debug', '--outDir', `../${dist}` ], { stdio: 'inherit' })
    execFileSync(process.execPath, [ resolve('scripts/hash-assets.mjs'), '--out', dist, '--include-test' ], { stdio: 'inherit' })
}

const server = spawn(
    process.execPath,
    [ viteBin, 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort' ],
    { stdio: 'ignore' }
)
const killServer = () => { try { server.kill() } catch {} }
process.on('exit', killServer)

let serverReady = false
for(let i = 0; i < 60; i++)
{
    try
    {
        if((await fetch(base)).ok)
        {
            serverReady = true
            break
        }
    }
    catch {}
    await new Promise((r) => setTimeout(r, 250))
}
if(!serverReady)
{
    killServer()
    throw new Error(`vite preview did not start on ${base}`)
}

const outDir = resolve('tools/capture/out/flash-check')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
    headless: false,
    executablePath: chrome,
    ignoreDefaultArgs: [ '--enable-automation' ],
    args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist', '--mute-audio' ],
})

let videoPath = null
try
{
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
    })
    const page = await context.newPage()

    await page.goto(`${base}?expose&webgl`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    await page.waitForFunction(() => window.__reveal?.completedAtMs !== null, null, { timeout: 5000 })

    // 1. ~5s Origens gameplay (walk + jump + 1994 pop-up)
    await page.click('.js-canvas')
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(1500)
    await page.keyboard.press('Space')
    await page.waitForTimeout(1500)
    await page.keyboard.up('KeyW')

    await page.evaluate(() =>
    {
        const g = window.game
        const ref1994 = g.world.references.get('refMilestone1994')
        g.world.player.controller.teleport(ref1994.position.x, ref1994.position.y + 0.5, ref1994.position.z)
        g.world.origensEra.setPieces.trigger1994()
    })
    await page.waitForTimeout(1200)
    await page.evaluate(() =>
    {
        if(document.querySelector('.js-card-dialog')?.open)
            window.game.ui.closeCard(true)
    })

    // 2. ~4s Contact pipe -> End-Dot stamp -> Contact card
    await page.evaluate(async () =>
    {
        const g = window.game
        const c = g.world.player.controller
        const pipeRef = g.world.references.get('refPipeContact')
        c.teleport(pipeRef.position.x, pipeRef.position.y + 0.9, pipeRef.position.z)
    })
    await page.waitForTimeout(1700)
    await page.evaluate(() =>
    {
        const g = window.game
        const c = g.world.player.controller
        const sphereRef = g.world.references.get('refEndDotSphere')
        c.teleport(sphereRef.position.x, sphereRef.position.y + 1.5, sphereRef.position.z)
    })
    await page.waitForTimeout(1500)

    const video = page.video()
    await context.close()
    videoPath = await video.path()
}
finally
{
    await browser.close()
    killServer()
}

const ffmpegOut = execFileSync(
    'ffmpeg',
    [ '-i', videoPath, '-vf', 'fps=30,signalstats,metadata=print:file=-', '-f', 'null', '-' ],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
)

const yavgs = []
for(const line of ffmpegOut.split(/\r?\n/))
{
    const m = line.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/)
    if(m)
        yavgs.push(Number(m[1]))
}

// A large-area (>= 25% screen) luminance flash >= 10% corresponds to >= ~20 YAVG delta between frames
const FLASH_DELTA_THRESHOLD = 20
const WINDOW_FRAMES = 30 // 1 second at 30 fps
const transitions = []
for(let i = 1; i < yavgs.length; i++)
{
    const delta = Math.abs(yavgs[i] - yavgs[i - 1])
    if(delta >= FLASH_DELTA_THRESHOLD)
        transitions.push({ frame: i, delta: Math.round(delta * 100) / 100 })
}

let maxFlashesPerSec = 0
for(let start = 0; start < yavgs.length; start++)
{
    const end = start + WINDOW_FRAMES
    const count = transitions.filter((t) => t.frame >= start && t.frame < end).length
    if(count > maxFlashesPerSec)
        maxFlashesPerSec = count
}

// Move recorded video to pode_apagar so out/ stays clean
const trashDir = resolve('..', '..', 'pode_apagar', 'timeline', 'flash-check')
mkdirSync(trashDir, { recursive: true })
try
{
    renameSync(videoPath, join(trashDir, `flash-check-${Date.now()}.webm`))
}
catch {}

console.log(`flash-check: frames=${yavgs.length}, transitions(>=${FLASH_DELTA_THRESHOLD})=${transitions.length}, maxFlashesPerSec=${maxFlashesPerSec}`)
if(yavgs.length < 30 || maxFlashesPerSec > 3)
{
    console.error('flash-check: FAIL', { transitions })
    process.exit(1)
}
console.log('flash-check: PASS (<= 3 large-area luminance transitions/sec)')
