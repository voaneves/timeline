// T2.27a/b/c verification: Announcer, Landmarks, Pause (WCAG 2.2.2), Reduced Motion,
// WCAG 2.5.7 Single-Pointer flow, and axe-core 0 violations across HUD, Menu, Lista de marcos, and Milestone cards.
// Usage:
//   node tools/capture/t227-a11y.mjs [--dist dist-debug-t225] [--port 4217] [--skip-build]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t225')
const port = Number(arg('--port', '4217'))
const skipBuild = args.includes('--skip-build')
const base = `http://127.0.0.1:${port}/`

const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync)

if(!chrome)
    throw new Error('Chrome executable not found')

const axePath = [
    resolve('node_modules/axe-core/axe.min.js'),
    resolve('../../site/node_modules/axe-core/axe.min.js'),
    resolve('../../../site/node_modules/axe-core/axe.min.js'),
].find(existsSync)

if(!axePath)
    throw new Error('axe-core/axe.min.js not found')

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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e}`))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
    page.on('response', (r) => { if(r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`) })

    await page.goto(`${base}?expose&webgl`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    await page.waitForFunction(() => window.__reveal?.completedAtMs !== null, null, { timeout: 5000 })
    await page.addScriptTag({ path: axePath })

    const runAxe = async (label) =>
    {
        const res = await page.evaluate(async () =>
        {
            const r = await window.axe.run(document, {
                runOnly: { type: 'tag', values: [ 'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa' ] },
            })
            return {
                violations: r.violations.map((v) => ({
                    id: v.id,
                    impact: v.impact,
                    help: v.help,
                    nodes: v.nodes.map((n) => n.html),
                })),
            }
        })
        check(
            `axe-core (${label})`,
            res.violations.length === 0,
            res.violations.length ? JSON.stringify(res.violations) : '0 violations'
        )
    }

    // 1. Landmarks + Announcer (T2.27a)
    const landmarks = await page.evaluate(() =>
    {
        const main = document.querySelector('main.game')
        const h1 = main?.querySelector('h1')
        const canvas = main?.querySelector('.js-canvas')
        const descId = canvas?.getAttribute('aria-describedby')
        const descEl = descId ? document.getElementById(descId) : null
        const announcer = document.querySelector('.js-announcer')
        return {
            hasMain: Boolean(main),
            hasH1: Boolean(h1 && h1.textContent.trim().length > 0),
            hasAriaDescribedBy: Boolean(descEl && descEl.textContent.trim().length > 0),
            announcerLive: announcer?.getAttribute('aria-live'),
            eraAnnounced: window.game?.ui?.announcer?.lastMessage,
        }
    })
    check(
        'T2.27a Landmarks & era entry announcement',
        Boolean(
            landmarks.hasMain &&
            landmarks.hasH1 &&
            landmarks.hasAriaDescribedBy &&
            landmarks.announcerLive === 'polite' &&
            /Origens,\s*3\s*marcos/i.test(landmarks.eraAnnounced || '')
        ),
        JSON.stringify(landmarks)
    )

    // Proximity announcement throttled 1.5s
    const prox = await page.evaluate(async () =>
    {
        const g = window.game
        const ref1994 = g.world.references.get('refMilestone1994')
        const c = g.world.player.controller
        c.teleport(ref1994.position.x, ref1994.position.y + 0.5, ref1994.position.z)
        await new Promise((r) => setTimeout(r, 120))
        const firstMsg = g.ui.announcer.lastMessage
        const throttledImmediate = g.ui.announcer.announceThrottled('prox-1994', 'Bloco 1994: pressione F', 1500)
        return { firstMsg, throttledImmediate }
    })
    check(
        'T2.27a Proximity announcer (throttled 1.5s)',
        Boolean(/Bloco 1994: pressione F/.test(prox.firstMsg || '') && prox.throttledImmediate === false),
        JSON.stringify(prox)
    )

    await runAxe('HUD')

    // 2. Pause (WCAG 2.2.2) via KeyP and HUD button
    await page.click('.js-canvas')
    await page.keyboard.press('KeyP')
    const pausedSteps1 = await page.evaluate(() => ({
        paused: window.game.paused,
        steps: window.game.ticker.fixedSteps,
        ambientPaused: window.game.world.origensEra.ambientLife.isPaused(),
    }))
    await page.waitForTimeout(250)
    const pausedSteps2 = await page.evaluate(() => window.game.ticker.fixedSteps)
    check(
        'T2.27b Pause via KeyP freezes simulation & ambient',
        Boolean(pausedSteps1.paused && pausedSteps1.ambientPaused && pausedSteps2 === pausedSteps1.steps),
        JSON.stringify({ pausedSteps1, pausedSteps2 })
    )

    // Resume via HUD Pause button (single-pointer)
    await page.click('.js-hud-pause')
    await page.waitForTimeout(150)
    const resumed = await page.evaluate(() => ({
        paused: window.game.paused,
        steps: window.game.ticker.fixedSteps,
    }))
    check(
        'T2.27b Resume via HUD Pause button',
        Boolean(!resumed.paused && resumed.steps > pausedSteps2),
        JSON.stringify(resumed)
    )

    // 3. Single-pointer Menu + Reduced Motion + axe-core
    await page.click('.js-hud-menu')
    await page.waitForSelector('.js-menu-dialog[open]')
    await runAxe('Menu dialog')

    await page.click('.js-opt-reduced-motion')
    const reducedState = await page.evaluate(() => ({
        opt: window.game.ui.options.reducedMotion,
        cls: document.documentElement.classList.contains('is-reduced-motion'),
        dofAmount: window.game.rendering.cheapDOFPass.amount.value,
        rollKick: window.game.view.roll.kickStrength,
        ambientPaused: window.game.world.origensEra.ambientLife.isPaused(),
    }))
    check(
        'T2.27b Reduced motion disables DOF, roll shake, pauses ambient',
        Boolean(
            reducedState.opt &&
            reducedState.cls &&
            reducedState.dofAmount === 0 &&
            reducedState.rollKick === 0 &&
            reducedState.ambientPaused
        ),
        JSON.stringify(reducedState)
    )
    await page.click('.js-opt-reduced-motion')
    await page.keyboard.press('Escape')

    // 4. Single-pointer Lista de marcos + Milestone Card + axe-core
    await page.click('.js-hud-list')
    await page.waitForSelector('.js-list-dialog[open]')
    await runAxe('Lista de marcos dialog')

    await page.click('.js-list-dialog [data-action="open"]')
    await page.waitForSelector('.js-card-dialog[open]')
    const cardAnnounced = await page.evaluate(() => window.game.ui.announcer.lastMessage)
    check(
        'T2.27a Opened milestone title announced',
        Boolean(cardAnnounced && cardAnnounced.length > 0),
        cardAnnounced
    )
    await runAxe('Milestone card dialog')
    await page.click('.js-card-done')

    // 5. WCAG 2.5.7 hit target size check (>= 44x44)
    const minTarget = await page.evaluate(() =>
    {
        const btns = [ ...document.querySelectorAll('.vn-hud-btn') ]
        return btns.map((el) =>
        {
            const r = el.getBoundingClientRect()
            return { text: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }
        })
    })
    const allTargetsOk = minTarget.every((b) => b.w >= 44 && b.h >= 44)
    check('T2.27c HUD single-pointer targets >= 44x44', allTargetsOk, JSON.stringify(minTarget))

    await page.close()
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
