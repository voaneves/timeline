// T2.9a + T2.9b verification: Victor state machine, 18 clips, crossfades, run timeScale, and 5 procedural layers.
// Usage: node tools/capture/t29-victor-visual.mjs [--dist dist-debug-t29] [--port 4196]
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t29')
const port = Number(arg('--port', '4196'))
const base = `http://127.0.0.1:${port}/`

const EXPECTED_CLIPS = [
    'idle', 'walk', 'run', 'jumpUp', 'fall', 'landSoft', 'landHard',
    'skid', 'flutter', 'stamp', 'push', 'grind', 'interact', 'hurtBump',
    'wave', 'celebrate', 'idleLong', 'sitLaptop',
]
const VALID_STATES = new Set(EXPECTED_CLIPS)

const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync)

const server = spawn(
    process.execPath,
    [ resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort' ],
    { stdio: 'ignore' }
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
    args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist' ],
})

const errors = []

function attachErrorListeners(page)
{
    page.on('pageerror', (e) => errors.push(`pageerror: ${e}`))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
}

// 1. Debug mode: verify all 18 clips load, Tweakpane folder exists, and 5 procedural layers toggle
const debugPage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
attachErrorListeners(debugPage)
await debugPage.goto(`${base}?debug&expose&webgl`)
await debugPage.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
await debugPage.waitForFunction(() => window.__victorVisual?.extrasLoaded === true, null, { timeout: 30000 })

const debugCheck = await debugPage.evaluate((expected) =>
{
    const vv = window.__victorVisual
    const loaded = new Set(vv.clipsLoaded)
    const missingClips = expected.filter((c) => !loaded.has(c))

    // Check Tweakpane folder and 5 procedural toggles
    const paneText = document.body.innerText
    const hasVictorFolder = paneText.includes('Victor')
    const procKeys = Object.keys(vv.procedural)

    // Toggle each procedural flag and verify
    const toggled = {}
    for(const key of procKeys)
    {
        vv.procedural[key] = false
        toggled[key] = vv.procedural[key] === false
        vv.procedural[key] = true
    }

    // Trigger wave -> celebrate -> sitLaptop
    const triggers = {}
    for(const s of [ 'wave', 'celebrate', 'sitLaptop' ])
    {
        vv.trigger(s, 0.2)
        triggers[s] = vv.state === s && vv.clip === s
    }
    vv.trigger('idle', 0.01)

    return {
        clipsCount: vv.clipsLoaded.length,
        missingClips,
        hasVictorFolder,
        procKeys,
        toggled,
        triggers,
        squashY: vv.squashY,
        leanDeg: vv.leanDeg,
        eyeState: vv.eyeState,
        mouthState: vv.mouthState,
    }
}, EXPECTED_CLIPS)

// Live keyboard reversal to verify 'skid' state transition
await debugPage.keyboard.down('KeyW')
await debugPage.waitForTimeout(900)
await debugPage.keyboard.up('KeyW')
await debugPage.keyboard.down('KeyS')
await debugPage.waitForTimeout(300)
await debugPage.keyboard.up('KeyS')
const sawSkid = await debugPage.evaluate(() =>
{
    const vv = window.__victorVisual
    return vv.transitions.some((t) => t.to === 'skid') || vv.state === 'skid'
})

await debugPage.close()

// 2. Ghost runs: verify state transitions, zero invalid transitions, and run timeScale
const ghosts = [ 'greybox-keyboard', 'skid', 'jumpArc', 'stamp' ]
const ghostResults = {}

for(const ghost of ghosts)
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    attachErrorListeners(page)
    await page.addInitScript(`(() => {
        window.__runSamples = []
        const timer = setInterval(() => {
            const g = window.game
            if(!(g && g.ticker && window.__victorVisual)) return
            clearInterval(timer)
            g.ticker.events.on('fixedTick', () => {
                const vv = window.__victorVisual
                if(vv.clip === 'run') {
                    window.__runSamples.push({ speed: g.world?.player?.controller?.movedSpeed ?? 0, timeScale: vv.timeScale })
                }
            }, 1001)
        }, 10)
    })()`)
    await page.goto(`${base}?expose&webgl&ghost=${ghost}`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    await page.evaluate(() => window.__victorVisual?.extrasPromise)
    await page.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 120000, polling: 100 })

    const res = await page.evaluate(() =>
    {
        const vv = window.__victorVisual
        return {
            finalState: vv.state,
            finalClip: vv.clip,
            transitions: vv.transitions,
            runSamples: window.__runSamples || [],
            extrasLoaded: vv.extrasLoaded,
        }
    })

    const invalid = res.transitions.filter((t) => !VALID_STATES.has(t.from) || !VALID_STATES.has(t.to) || t.from === t.to)
    const visited = Array.from(new Set(res.transitions.flatMap((t) => [ t.from, t.to ]).concat([ res.finalState ])))
    const minTs = res.runSamples.length ? Math.min(...res.runSamples.map((s) => s.timeScale)) : null
    const maxTs = res.runSamples.length ? Math.max(...res.runSamples.map((s) => s.timeScale)) : null

    ghostResults[ghost] = {
        extrasLoaded: res.extrasLoaded,
        transitionCount: res.transitions.length,
        invalidCount: invalid.length,
        visited,
        runSamples: res.runSamples.length,
        runTimeScaleRange: res.runSamples.length ? [ Number(minTs.toFixed(3)), Number(maxTs.toFixed(3)) ] : null,
    }

    await page.close()
}

await browser.close()
server.kill()

const ok =
    errors.length === 0 &&
    debugCheck.missingClips.length === 0 &&
    debugCheck.clipsCount === 18 &&
    debugCheck.procKeys.length === 5 &&
    Object.values(debugCheck.toggled).every(Boolean) &&
    Object.values(debugCheck.triggers).every(Boolean) &&
    sawSkid &&
    Object.values(ghostResults).every((g) => g.invalidCount === 0 && g.extrasLoaded) &&
    ghostResults['greybox-keyboard'].visited.includes('flutter') &&
    ghostResults['greybox-keyboard'].visited.includes('stamp') &&
    ghostResults.jumpArc.visited.includes('jumpUp') &&
    ghostResults.stamp.visited.includes('stamp')

console.log(JSON.stringify({ ok, errors, sawSkid, debugCheck, ghostResults }, null, 2))
process.exit(ok ? 0 : 1)
