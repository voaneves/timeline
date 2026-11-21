// T2.25a/b/c verification: Line Loader byte progress, Pop-up Reveal, cancelable wave,
// default Origens world, Phase 1 greybox ghost compatibility, and 10s/30s storyboard timing.
// Usage:
//   node tools/capture/t225-reveal.mjs [--dist dist-debug-t225] [--port 4215] [--skip-build]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t225')
const port = Number(arg('--port', '4215'))
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

const browser = await chromium.launch({
    headless: false,
    executablePath: chrome,
    ignoreDefaultArgs: [ '--enable-automation' ],
    args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist', '--mute-audio' ],
})

let allPassed = true
const check = (label, ok, detail = '') =>
{
    if(!ok) allPassed = false
    console.log(`${label}: ${ok ? 'PASS' : 'FAIL'}${detail ? ` (${detail})` : ''}`)
}

const errors = []
try
{
    // 1. Default world (Origens) + Line Loader + Reveal + Cancelable Wave
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e}`))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
    page.on('response', (r) => { if(r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`) })

    await page.goto(`${base}?expose&webgl`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })

    const bootState = await page.evaluate(() => ({
        loader: window.__loader,
        reveal: window.__reveal,
        hasOrigens: Boolean(window.game?.world?.origensEra),
        victorState: window.__victorVisual?.state,
        loaderCompleteClass: document.querySelector('.js-loader')?.classList.contains('is-complete'),
    }))

    const controlDelayMs = (bootState.reveal?.controlReadyAtMs ?? Infinity) - (bootState.reveal?.startedAtMs ?? 0)
    check(
        'T2.25a Line Loader (100% on final critical byte)',
        Boolean(
            bootState.loader &&
            bootState.loader.bytesTotal > 0 &&
            bootState.loader.bytesLoaded === bootState.loader.bytesTotal &&
            bootState.loader.pct === 100 &&
            bootState.loader.completedAtMs !== null &&
            bootState.loaderCompleteClass
        ),
        JSON.stringify(bootState.loader)
    )
    check(
        'T2.25b Default world is Origens',
        bootState.hasOrigens,
        `origens=${bootState.hasOrigens}`
    )
    check(
        'T2.25b Reveal control ready <= 800ms',
        controlDelayMs >= 0 && controlDelayMs <= 800,
        `controlDelayMs=${controlDelayMs}`
    )

    // Cancel wave immediately on KeyW input
    await page.click('.js-canvas')
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(100)
    await page.keyboard.up('KeyW')

    const afterInput = await page.evaluate(() => ({
        reveal: window.__reveal,
        victorState: window.__victorVisual?.state,
    }))
    check(
        'T2.25b Cancelable wave on input',
        Boolean(afterInput.reveal?.waveCancelled && afterInput.victorState !== 'wave'),
        JSON.stringify(afterInput)
    )

    // Wait for radial reveal to finish
    await page.waitForFunction(() => window.__reveal?.completedAtMs !== null, null, { timeout: 5000 })
    const revealFinal = await page.evaluate(() => window.__reveal)
    check(
        'T2.25b Radial reveal completed',
        Boolean(revealFinal.completedAtMs && revealFinal.mode === 'radial'),
        JSON.stringify(revealFinal)
    )

    // 2. Storyboard timings: O2 1994 (< 15s) & O3 Contact Pipe -> End-Dot -> Contact card (< 30s)
    const storyboard = await page.evaluate(async () =>
    {
        const g = window.game
        const era = g.world.origensEra
        const gp = era.gameplay
        const sp = era.setPieces
        const c = g.world.player.controller

        const t0 = performance.now()
        // First delight: collect signal 1 (< 5s)
        const sig1 = gp.signals[0]
        c.teleport(sig1.position.x, sig1.position.y + 0.2, sig1.position.z)
        await new Promise((r) => setTimeout(r, 120))
        const firstDelightMs = performance.now() - t0

        // O2 1994 block (< 15s)
        const ref1994 = g.world.references.get('refMilestone1994')
        c.teleport(ref1994.position.x, ref1994.position.y + 0.5, ref1994.position.z)
        sp.trigger1994()
        await new Promise((r) => setTimeout(r, 120))
        const o2Ms = performance.now() - t0
        if(document.querySelector('.js-card-dialog')?.open)
            g.ui.closeCard(true)

        // O3 Contact Pipe -> End-Dot -> Contact card (< 30s)
        const pipeRef = g.world.references.get('refPipeContact')
        const sphereRef = g.world.references.get('refEndDotSphere')
        c.teleport(pipeRef.position.x, pipeRef.position.y + 0.9, pipeRef.position.z)
        await new Promise((r) => setTimeout(r, 1500))
        c.teleport(sphereRef.position.x, sphereRef.position.y + 1.5, sphereRef.position.z)
        await new Promise((r) => setTimeout(r, 700))
        const contactCardOpen = Boolean(document.querySelector('.js-card-dialog')?.open)
        const contactMs = performance.now() - t0
        if(contactCardOpen)
            g.ui.closeCard(true)

        return {
            firstDelightMs: Math.round(firstDelightMs),
            o2Ms: Math.round(o2Ms),
            housePopped: sp.housePopped,
            contactCardOpen,
            contactMs: Math.round(contactMs),
        }
    })
    check(
        'T2.25c 10s Storyboard + Contact30',
        Boolean(
            storyboard.firstDelightMs < 5000 &&
            storyboard.housePopped &&
            storyboard.o2Ms < 15000 &&
            storyboard.contactCardOpen &&
            storyboard.contactMs < 30000
        ),
        JSON.stringify(storyboard)
    )

    await page.close()

    // 3. Phase 1 greybox ghost compatibility (?ghost=skid)
    const ghostPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    ghostPage.on('pageerror', (e) => errors.push(`ghost pageerror: ${e}`))
    await ghostPage.goto(`${base}?ghost=skid&expose&webgl`)
    await ghostPage.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    const hasGreybox = await ghostPage.evaluate(() => Boolean(window.game?.world?.greybox && !window.game?.world?.origensEra))
    check('Phase 1 greybox ghost compatibility (?ghost=skid)', hasGreybox)
    await ghostPage.close()
}
finally
{
    await browser.close()
    killServer()
}

console.log(`Errors: ${errors.length}`)
if(errors.length > 0)
    console.error(errors.join('\n'))
if(errors.length > 0 || !allPassed)
    process.exit(1)
