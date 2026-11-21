// T2.24 verification:
//   - Audio assets (.mp3) are NOT fetched before `game.ready === true` (critical-path isolation)
//   - Audio bank loads post-reveal (`bankLoaded === true`)
//   - Footstep stride + anti-repeat: 0 triples in `window.__audioLog`
//   - All 5 interaction event types trigger in `window.__audioLog`
//   - Card-open ducking measures -8.0 dB +/- 0.3 dB and restores to 0.0 dB on close
//   - HUD "Som" button toggles mute/unmute cleanly
// Usage: node tools/capture/t224-audio.mjs [--dist dist-debug-t224] [--port 4199]
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t224')
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
    ignoreDefaultArgs: [ '--enable-automation' ],
    args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist', '--mute-audio' ],
})

const errors = []
let allPassed = true

try
{
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    page.on('pageerror', (e) => { console.error('[pageerror]', e); errors.push(String(e)) })
    page.on('console', (m) => { if(m.type() === 'error') { console.error('[console.error]', m.text()); errors.push(m.text()) } })

    const mp3Requests = []

    await page.addInitScript(() =>
    {
        window.__mp3Fetches = []
        const origFetch = window.fetch.bind(window)
        window.fetch = (...fetchArgs) =>
        {
            const url = typeof fetchArgs[0] === 'string' ? fetchArgs[0] : fetchArgs[0]?.url || ''
            if(/\.mp3(\?|$)/i.test(url))
                window.__mp3Fetches.push({ url, gameReady: Boolean(window.game?.ready) })
            return origFetch(...fetchArgs)
        }
    })

    page.on('request', (req) =>
    {
        const url = req.url()
        if(/\.mp3(\?|$)/i.test(url))
            mp3Requests.push(url)
    })

    await page.goto(`${base}?era=origens&expose&webgl`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })

    // Wait for post-reveal audio bank to finish loading
    await page.waitForFunction(() => window.__audioState?.bankLoaded === true, null, { timeout: 30000 })

    // User gesture to unlock AudioContext
    await page.mouse.click(480, 270)

    // Walk Victor forward to generate real stride footsteps
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(2200)
    await page.keyboard.up('KeyW')

    // Jump + land
    await page.keyboard.down('Space')
    await page.waitForTimeout(120)
    await page.keyboard.up('Space')
    await page.waitForTimeout(900)

    // Trigger interactions (stamp, blockBump, grindStart/Tick/End, milestonePass, signalCollect)
    await page.evaluate(() =>
    {
        const g = window.game
        const c = g.world.player.controller
        c.events.trigger('stampStart', [ {} ])
        c.events.trigger('stamp', [ { x: 0, y: 0, z: 0 } ])
        g.audio.playBlockBump()
        g.audio.playSignalCollect()
        c.events.trigger('grindStart', [ { speed: 12.5 } ])
        c.events.trigger('grindTick', [ { speed: 13.5 } ])
        c.events.trigger('milestonePass', [ { index: 0 } ])
        c.events.trigger('grindEnd', [ {} ])
    })

    // Test card-open -8 dB ducking and restore on close
    await page.evaluate(() =>
    {
        const firstId = window.game.cards.milestones?.[0]?.id
        window.game.ui.openMilestone(firstId)
    })
    await page.waitForTimeout(250)
    const duckedState = await page.evaluate(() => window.__audioState)

    await page.evaluate(() => window.game.ui.closeCard(false))
    await page.waitForTimeout(250)
    const restoredState = await page.evaluate(() => window.__audioState)

    // Test HUD "Som" mute/unmute toggle
    await page.click('.js-hud-sound')
    const mutedState = await page.evaluate(() => window.__audioState)
    await page.click('.js-hud-sound')
    const unmutedState = await page.evaluate(() => window.__audioState)

    const log = await page.evaluate(() => window.__audioLog || [])
    const footsteps = log.filter((e) => e.event === 'footstep')

    // Anti-repeat check: 0 triples of identical (file, rate, volume) and 0 triples of identical file
    let exactTriples = 0
    let fileTriples = 0
    for(let i = 2; i < footsteps.length; i++)
    {
        const a = footsteps[i - 2]
        const b = footsteps[i - 1]
        const c = footsteps[i]
        if(a.file === b.file && b.file === c.file)
        {
            fileTriples++
            if(a.rate === b.rate && b.rate === c.rate && a.volume === b.volume && b.volume === c.volume)
                exactTriples++
        }
    }

    const eventsSeen = new Set(log.map((e) => e.event))
    const requiredEvents = [ 'footstep', 'jump', 'stamp', 'cardOpen', 'blockBump', 'grindStart', 'milestonePass' ]
    const missingEvents = requiredEvents.filter((ev) => !eventsSeen.has(ev))

    const mp3Fetches = await page.evaluate(() => window.__mp3Fetches || [])
    const mp3BeforeReady = mp3Fetches.filter((f) => !f.gameReady)
    const mp3AfterReady = mp3Fetches.filter((f) => f.gameReady)

    const duckDbOk = duckedState.ducked === true && duckedState.duckDb >= -8.3 && duckedState.duckDb <= -7.7
    const restoreOk = restoredState.ducked === false && Math.abs(restoredState.duckDb) < 0.05
    const criticalIsolated = mp3BeforeReady.length === 0
    const postRevealLoaded = mp3AfterReady.length >= 30 && mp3Requests.length >= 30 && restoredState.buffersCount >= 32
    const antiRepeatOk = footsteps.length >= 4 && exactTriples === 0 && fileTriples === 0
    const interactionsOk = missingEvents.length === 0
    const hudToggleOk = mutedState.muted === true && unmutedState.muted === false

    console.log(JSON.stringify({
        mp3BeforeReadyCount: mp3BeforeReady.length,
        mp3AfterReadyCount: mp3AfterReady.length,
        mp3NetworkRequestsCount: mp3Requests.length,
        buffersCount: restoredState.buffersCount,
        footstepsCount: footsteps.length,
        exactTriples,
        fileTriples,
        eventsSeen: [ ...eventsSeen ],
        missingEvents,
        duckedState,
        restoredState,
        hudToggleOk,
        errorsCount: errors.length,
    }, null, 2))

    if(!criticalIsolated || !postRevealLoaded || !antiRepeatOk || !interactionsOk || !duckDbOk || !restoreOk || !hudToggleOk || errors.length > 0)
        allPassed = false
}
finally
{
    await browser.close()
    server.kill()
}

if(!allPassed)
{
    console.error('T2.24 audio verification FAILED')
    process.exit(1)
}
console.log('T2.24 audio verification PASSED')
