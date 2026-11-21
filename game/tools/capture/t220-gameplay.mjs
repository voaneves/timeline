// T2.20a/b/c + T2.21a/b verification against ?era=origens:
//   node tools/capture/t220-gameplay.mjs [--dist dist-debug] [--port 4199]
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug')
const port = Number(arg('--port', '4199'))
const base = `http://127.0.0.1:${port}/`

const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync)

const server = spawn(
    process.execPath,
    [ resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort' ],
    { stdio: 'inherit' }
)
process.on('exit', () => { try { server.kill() } catch {} })

for(let i = 0; i < 60; i++)
{
    try { if((await fetch(base)).ok) break } catch {}
    await new Promise((r) => setTimeout(r, 250))
}

const browser = await chromium.launch({
    headless: false,
    executablePath: chrome,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--mute-audio'],
})

const errors = []
let allPassed = true
const check = (label, ok, detail = '') =>
{
    if(!ok) allPassed = false
    console.log(`${label}: ${ok ? 'PASS' : 'FAIL'}${detail ? ` (${detail})` : ''}`)
}

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => { console.error('[pageerror]', e); errors.push(String(e)) })
page.on('console', (m) => { if(m.type() === 'error') { console.error('[console.error]', m.text()); errors.push(m.text()) } })

await page.goto(`${base}?era=origens&expose&webgl`)
await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })

// --- 1. T2.20a: 20 Instanced Signals + HUD counter
const t20a = await page.evaluate(async () =>
{
    const g = window.game
    const era = g.world.origensEra
    const gp = era?.gameplay
    const c = g.world.player?.controller
    if(!gp || !c) return { ok: false, reason: 'gameplay not wired on origensEra' }

    const initialStats = gp.getStats()
    const visibleBefore = gp.signals.filter((s) => s.revealed).length
    let collectEvent = null
    gp.events.on('signalCollect', (payload) => { collectEvent = payload })

    const sig1 = gp.signals[0]
    c.teleport(sig1.position.x, sig1.position.y + 0.2, sig1.position.z)
    await new Promise((r) => setTimeout(r, 150))

    const hudText = document.querySelector('.js-hud-signals')?.textContent || ''
    return {
        ok: true,
        initialStats,
        visibleBefore,
        afterStats: gp.getStats(),
        collectEvent,
        hudText,
    }
})
check(
    'T2.20a 20 instanced signals + HUD',
    Boolean(
        t20a.ok &&
        t20a.initialStats.signalsTotal === 20 &&
        t20a.initialStats.signalsDrawCalls === 1 &&
        t20a.visibleBefore === 17 &&
        t20a.afterStats.signalsCollected >= 1 &&
        t20a.collectEvent?.index === 1 &&
        /Sinais\s+1\/20/.test(t20a.hudText)
    ),
    JSON.stringify(t20a)
)

// --- 2. T2.20b: Secret Termite Mound + 3 hidden signals + retro console
const t20b = await page.evaluate(async () =>
{
    const g = window.game
    const gp = g.world.origensEra?.gameplay
    const c = g.world.player?.controller
    const ref = g.world.references.get('refSecretTermite')
    if(!gp || !c || !ref) return { ok: false }

    let secretEvent = false
    gp.events.on('secretOpen', () => { secretEvent = true })
    c.teleport(ref.position.x, ref.position.y + 2.4, ref.position.z)
    c.events.trigger('stamp', [ { x: ref.position.x, y: ref.position.y + 1.8, z: ref.position.z, broken: 1, speed: 30 } ])
    await new Promise((r) => setTimeout(r, 120))

    const revealedAfter = gp.signals.filter((s) => s.revealed).length
    return {
        ok: true,
        secretOpened: gp.secretOpened,
        secretEvent,
        revealedAfter,
        consoleVisible: Boolean(gp.retroConsole?.visible),
    }
})
check(
    'T2.20b secret termite mound',
    Boolean(t20b.ok && t20b.secretOpened && t20b.secretEvent && t20b.revealedAfter === 20 && t20b.consoleVisible),
    JSON.stringify(t20b)
)

// --- 3. T2.20c: Contact Pipe (~1.2s warp) -> End-Dot Sphere -> Stamp + Contact Card
const t20c = await page.evaluate(async () =>
{
    const g = window.game
    const gp = g.world.origensEra?.gameplay
    const c = g.world.player?.controller
    const pipeRef = g.world.references.get('refPipeContact')
    const sphereRef = g.world.references.get('refEndDotSphere')
    if(!gp || !c || !pipeRef || !sphereRef) return { ok: false }

    let warpComplete = false
    gp.events.on('pipeWarpComplete', () => { warpComplete = true })
    c.teleport(pipeRef.position.x, pipeRef.position.y + 0.9, pipeRef.position.z)
    await new Promise((r) => setTimeout(r, 1550))

    const afterWarpPos = c.body.translation()
    const distToIsland = Math.hypot(afterWarpPos.x - gp.endDotArrivalPos.x, afterWarpPos.z - gp.endDotArrivalPos.z)

    // Touch End-Dot Sphere
    c.teleport(sphereRef.position.x, sphereRef.position.y + 1.5, sphereRef.position.z)
    await new Promise((r) => setTimeout(r, 700))

    const cardOpen = Boolean(document.querySelector('.js-card-dialog')?.open)
    if(cardOpen) g.ui.closeCard(true)

    return {
        ok: true,
        warpComplete,
        distToIsland,
        endDotTriggered: gp.endDotTriggered,
        cardOpen,
    }
})
check(
    'T2.20c contact pipe + end-dot stamp + card',
    Boolean(t20c.ok && t20c.warpComplete && t20c.distToIsland < 2.0 && t20c.endDotTriggered && t20c.cardOpen),
    JSON.stringify(t20c)
)

// --- 4. T2.21a: Breakables 10 deterministic reset repetitions without floor tunneling
const t21a = await page.evaluate(async () =>
{
    const g = window.game
    const bm = g.world.origensEra?.breakables
    if(!bm || bm.items.length === 0) return { ok: false, reason: 'no breakables registered' }

    let minDeltaY = Infinity
    for(let rep = 0; rep < 10; rep++)
    {
        // Break first crate & push second crate
        const first = bm.items[0]
        if(first) g.objects.disable(first)
        const second = bm.items[1]
        if(second?.physical?.body)
        {
            second.physical.body.setEnabled(true)
            second.physical.body.applyImpulse({ x: 3, y: 2, z: 0 }, true)
        }
        await new Promise((r) => setTimeout(r, 60))

        bm.resetAll()
        await new Promise((r) => setTimeout(r, 120))

        for(const item of bm.items)
        {
            const y = item.physical.body.translation().y
            const initY = item.physical.initialState.position.y
            minDeltaY = Math.min(minDeltaY, y - initY)
        }
    }

    return {
        ok: true,
        stats: bm.getStats(),
        minDeltaY,
    }
})
check(
    'T2.21a breakables 10x deterministic reset',
    Boolean(t21a.ok && t21a.stats.resets >= 10 && t21a.stats.intact === t21a.stats.total && t21a.minDeltaY >= -0.15),
    JSON.stringify(t21a)
)

// --- 5. T2.21b: Tracks (footprints) + AmbientLife (Seriema & butterflies)
const t21b = await page.evaluate(async () =>
{
    const g = window.game
    const tracks = g.world.origensEra?.tracks
    const ambient = g.world.origensEra?.ambientLife
    const c = g.world.player?.controller
    if(!tracks || !ambient || !c) return { ok: false }

    // Trigger landing footprints
    c.events.trigger('land', [ { speed: 7 } ])
    const tracksStats = tracks.getStats()

    // Approach Seriema to test flee
    const sp = ambient.seriemaState.position
    c.teleport(sp.x + 1.0, sp.y + 0.9, sp.z)
    await new Promise((r) => setTimeout(r, 200))
    const fleeing = ambient.seriemaState.fleeing
    const ambientStats = ambient.getStats()

    // Toggle reducedMotion -> ambient pauses
    g.ui.hud.setOption('reducedMotion', true)
    const pausedWhenReduced = ambient.isPaused()
    g.ui.hud.setOption('reducedMotion', false)

    return {
        ok: true,
        tracksStats,
        fleeing,
        ambientStats,
        pausedWhenReduced,
    }
})
check(
    'T2.21b tracks + ambient life',
    Boolean(
        t21b.ok &&
        t21b.tracksStats.drawCalls === 1 &&
        t21b.tracksStats.capacity <= 128 &&
        t21b.tracksStats.active >= 2 &&
        t21b.ambientStats.drawCalls <= 3 &&
        t21b.fleeing &&
        t21b.pausedWhenReduced
    ),
    JSON.stringify(t21b)
)

await page.close()
await browser.close()
server.kill()

console.log(`Errors: ${errors.length}`)
if(errors.length > 0 || !allPassed)
    process.exit(1)
