// T2.18 check: Line spline + sensor coverage (T2.18a), Grind state + traversal <= 8s + jump +20% boost (T2.18b),
// Grind FX sparks & audio hooks (T2.18c), and Phase 1 ghost determinism (skid, jumpArc).
//   node tools/capture/t218-grind.mjs [--dist dist-debug-t218] [--port 4198]
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t218')
const port = Number(arg('--port', '4198'))
const base = `http://127.0.0.1:${port}/`

const splinePath = resolve('static/eras/origens/origens_line_spline.json')
const splineData = JSON.parse(readFileSync(splinePath, 'utf8'))

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync)
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'inherit' })
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

// --- 1. T2.18a Sensor Coverage + T2.18b/c Full Traversal (ghost=grind)
{
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    page.on('pageerror', (e) => { console.error('[pageerror]', e); errors.push(String(e)) })
    page.on('console', (m) => { if(m.type() === 'error') { console.error('[console.error]', m.text()); errors.push(m.text()) } })

    await page.addInitScript((data) =>
    {
        window.__splineData = data
        window.__grindEvents = []
        window.__grindSamples = []
        window.__sensorCoverage = null

        const timer = setInterval(() =>
        {
            const g = window.game
            if(!(g && g.world && g.world.player && g.ticker)) return
            clearInterval(timer)

            const c = g.world.player.controller
            const Line = c.grind.LineClass
            const line = new Line({ game: g, data: window.__splineData })
            g.world.line = line

            // T2.18a: verify 100/100 airborne sensor coverage along the entire spline
            let hits = 0
            const total = 100
            for(let i = 0; i < total; i++)
            {
                const s = (i / (total - 1)) * line.length
                const sample = line.sampleAt(s)
                const airPos = { x: sample.point.x, y: sample.point.y + 0.5, z: sample.point.z }
                if(line.detect(airPos)) hits++
            }
            window.__sensorCoverage = { hits, total, pct: (hits / total) * 100 }

            // Start Victor airborne just above O2 (s = 0)
            const start = line.sampleAt(0).point
            c.teleport(start.x, start.y + 0.60 + 0.35, start.z, Math.atan2(- line.sampleAt(0).tangent.x, - line.sampleAt(0).tangent.z))

            for(const name of ['grindStart', 'grindEnd', 'milestonePass'])
                c.events.on(name, (e) => window.__grindEvents.push({ ...e, event: name, step: g.ghost ? g.ghost.step : -1 }))

            g.ticker.events.on('fixedTick', () =>
            {
                if(c.grind.active)
                {
                    window.__grindSamples.push({
                        step: g.ghost ? g.ghost.step : -1,
                        s: c.grind.s,
                        speed: c.grind.speed,
                    })
                }
            }, 1001)
        }, 0)
    }, splineData)

    await page.goto(`${base}?expose&webgl&ghost=grind`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    await page.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 120000, polling: 100 })

    const res = await page.evaluate(() => ({
        coverage: window.__sensorCoverage,
        events: window.__grindEvents,
        samples: window.__grindSamples,
        telemetry: window.__grind,
    }))
    await page.close()

    const startEv = res.events.find((e) => e.event === 'grindStart')
    const endEv = res.events.find((e) => e.event === 'grindEnd' && e.reason === 'end')
    const milestones = res.events.filter((e) => e.event === 'milestonePass')
    const speeds = res.samples.map((s) => s.speed)
    const minSpeed = speeds.length ? Math.min(...speeds) : 0
    const maxSpeed = speeds.length ? Math.max(...speeds) : 0
    const traversalTime = (startEv && endEv) ? (endEv.step - startEv.step) / 120 : Infinity

    const covOk = res.coverage?.hits === 100 && res.coverage?.total === 100
    const timeOk = traversalTime <= 8.0 && endEv?.s >= 79.4
    const speedOk = minSpeed >= 9.0 && maxSpeed <= 14.0
    const fxOk = res.telemetry.sparks > 0 && milestones.length >= 3

    console.log(`T2.18a sensor coverage: ${res.coverage.hits}/${res.coverage.total} (${res.coverage.pct.toFixed(1)}%) -> ${covOk ? 'PASS' : 'FAIL'}`)
    console.log(`T2.18b full traversal: ${traversalTime.toFixed(3)} s (end s=${endEv?.s?.toFixed(3)} / ${res.telemetry.length}), speed range [${minSpeed.toFixed(2)}, ${maxSpeed.toFixed(2)}] m/s -> ${timeOk && speedOk ? 'PASS' : 'FAIL'}`)
    console.log(`T2.18c FX & hooks: sparks=${res.telemetry.sparks}, milestones=${milestones.length}, entries=${res.telemetry.entries} -> ${fxOk ? 'PASS' : 'FAIL'}`)

    if(!covOk || !timeOk || !speedOk || !fxOk)
        allPassed = false
}

// --- 2. T2.18b Jump-off +20% horizontal speed boost
{
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${base}?expose&webgl`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })

    const jumpRes = await page.evaluate((data) =>
    {
        const g = window.game
        const c = g.world.player.controller
        const Line = c.grind.LineClass
        const line = new Line({ game: g, data })
        g.world.line = line

        const sample = line.sampleAt(20)
        c.teleport(sample.point.x, sample.point.y + 0.60 + 0.25, sample.point.z, 0)

        // Step until grinding
        for(let i = 0; i < 30 && !c.grind.active; i++)
            g.ticker.events.trigger('fixedTick')

        const preSpeed = c.grind.speed
        const wasActive = c.grind.active

        // Trigger jump while grinding
        g.inputs.applyAction('jump', 'start', 1, true)
        g.ticker.events.trigger('fixedTick')
        g.inputs.applyAction('jump', 'end', 0, true)

        const postHoriz = Math.hypot(c.velocity.x, c.velocity.z)
        const postVy = c.velocity.y
        return {
            wasActive,
            nowActive: c.grind.active,
            jumps: c.grind.jumps,
            preSpeed,
            postHoriz,
            ratio: preSpeed > 0 ? postHoriz / preSpeed : 0,
            postVy,
            expectedVy: c.jumpSpeed,
        }
    }, splineData)
    await page.close()

    const boostOk = jumpRes.wasActive && !jumpRes.nowActive && jumpRes.jumps === 1 && jumpRes.ratio >= 1.19 && jumpRes.ratio <= 1.21 && Math.abs(jumpRes.postVy - jumpRes.expectedVy) < 0.01
    console.log(`T2.18b jump boost: pre=${jumpRes.preSpeed.toFixed(2)} m/s -> post=${jumpRes.postHoriz.toFixed(2)} m/s (${jumpRes.ratio.toFixed(3)}x), vy=${jumpRes.postVy.toFixed(2)} m/s -> ${boostOk ? 'PASS' : 'FAIL'}`)
    if(!boostOk)
        allPassed = false
}

await browser.close()

// --- 3. Phase 1 determinism check (skid, jumpArc)
for(const ghostName of ['skid', 'jumpArc'])
{
    console.log(`\nChecking Phase 1 ghost "${ghostName}" determinism...`)
    try
    {
        const out = execFileSync(process.execPath, [
            resolve('tools/capture/ghost-verify.mjs'),
            '--demo', '0',
            '--ghost', ghostName,
            '--runs', '2',
            '--modes', 'native,fps15',
            '--url', base,
        ], { encoding: 'utf8' })
        console.log(out.trim())
    }
    catch(err)
    {
        console.error(`Ghost ${ghostName} FAILED:`, err.stdout || err.message)
        allPassed = false
    }
}

server.kill()
if(errors.length)
{
    console.error('Page errors:', errors)
    allPassed = false
}
if(!allPassed)
    process.exit(1)
console.log('\nALL T2.18 CHECKS PASSED')
