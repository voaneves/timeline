// T1.2 check: walk/run feel. Headed Chrome via playwright-core on a debug build, everything read through page evaluation
// (no screen recording). Needs a debug build served on --port (see --serve) with the ghost `skid` bundled.
//
//   node tools/capture/t12-walk.mjs [--dist dist-debug-t12] [--port 4182] [--backend webgl|webgpu]
//
// 1. Replays ghost `skid` (hold forward+right+run from step 60 to 180) and logs the speed of every fixed step:
//    0 -> 7 m/s must take 0.14 +- 0.02 s, 7 -> 0 must take 0.10 +- 0.02 s (commanded and achieved speed).
// 2. Scripted live scenarios through Inputs.applyAction (same code path as the keyboard): climbs the 0.3 m steps,
//    climbs the 30 degree ramp, does not climb a wall (the 1.5 m side of step 5).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t12')
const backend = arg('--backend', 'webgl')
const port = Number(arg('--port', '4182'))
const base = `http://127.0.0.1:${port}/`
const out = resolve('tools/capture/out')
mkdirSync(out, { recursive: true })

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync)
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => { try { server.kill() } catch {} })
for(let i = 0; i < 60; i++) { try { if((await fetch(base)).ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }

const browser = await chromium.launch({ headless: false, executablePath: chrome, ignoreDefaultArgs: ['--enable-automation'], args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] })
const errors = []

// Installed before the game starts: logs one row per fixed step, after the physics step and after the ghost counter (order 1001)
const TRACE = `(() => {
    window.__trace = []
    const timer = setInterval(() => {
        const g = window.game
        if(!(g && g.world && g.world.player && g.ticker)) return
        clearInterval(timer)
        const c = g.world.player.controller
        g.ticker.events.on('fixedTick', () => {
            const t = g.world.player.object.physical.body.translation()
            window.__trace.push({ s: g.ghost ? g.ghost.step - 1 : g.physics.steps - 1, speed: c.speed, moved: c.movedSpeed, x: t.x, y: t.y, z: t.z, grounded: c.grounded, slope: c.slopeAngle, yaw: c.yaw, lean: c.lean })
        }, 1001)
    }, 0)
})()`

async function open(query)
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(m.text()) })
    await page.addInitScript(TRACE)
    await page.goto(`${base}?expose${backend === 'webgl' ? '&webgl' : ''}&${query}`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    return page
}

const DT = 1 / 120
const results = {}

// ---- 1. Ghost skid
{
    const page = await open('ghost=skid')
    await page.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 60000, polling: 100 })
    const trace = await page.evaluate(() => window.__trace)
    const PRESS = 60
    const RELEASE = 180
    const rows = trace.filter((r) => r.s >= 0)
    const firstAt = (key, predicate, from) => rows.find((r) => r.s >= from && predicate(r[key]))
    const measure = (key) =>
    {
        const up = firstAt(key, (v) => v >= 7 - 1e-6, PRESS)
        const peak = rows.find((r) => r.s === RELEASE - 1)[key]
        const down = firstAt(key, (v) => v <= 1e-6, RELEASE)
        return { upSteps: up ? up.s - PRESS + 1 : null, upSeconds: up ? (up.s - PRESS + 1) * DT : null, peak, downSteps: down ? down.s - RELEASE + 1 : null, downSeconds: down ? (down.s - RELEASE + 1) * DT : null }
    }
    const half = rows.find((r) => r.s >= PRESS && r.speed >= 3.5)
    results.skid = {
        commanded: measure('speed'),
        achieved: measure('moved'),
        halfSpeedAfterSeconds: half ? (half.s - PRESS + 1) * DT : null,
        samples: rows.filter((r) => r.s >= PRESS - 1 && r.s <= PRESS + 20).map((r) => [r.s, +r.speed.toFixed(4), +r.moved.toFixed(4)]),
        samplesRelease: rows.filter((r) => r.s >= RELEASE - 1 && r.s <= RELEASE + 14).map((r) => [r.s, +r.speed.toFixed(4), +r.moved.toFixed(4)]),
        finalPosition: [rows.at(-1).x, rows.at(-1).y, rows.at(-1).z],
        grounded: rows.at(-1).grounded,
    }
    results.skid.pass =
        Math.abs(results.skid.commanded.upSeconds - 0.14) <= 0.02 && Math.abs(results.skid.commanded.downSeconds - 0.10) <= 0.02 &&
        Math.abs(results.skid.achieved.upSeconds - 0.14) <= 0.02 && Math.abs(results.skid.achieved.downSeconds - 0.10) <= 0.02
    await page.close()
}

// ---- 2. Scenarios: hold an action set for N steps, read the final pose
// Camera azimuth is 45 deg: forward+right = -Z, forward+left = -X, backward+left = +Z, backward+right = +X.
async function scenario(name, spec)
{
    const page = await open('n=1')
    const data = await page.evaluate(async (spec) =>
    {
        const g = window.game
        const c = g.world.player.controller
        const waitSteps = (n) => new Promise((resolve) => { let i = 0; const l = () => { if(++i >= n) { g.ticker.events.off('fixedTick', l); resolve() } }; g.ticker.events.on('fixedTick', l, 1002) })
        const log = []
        const sample = () => { const t = g.world.player.object.physical.body.translation(); log.push([ +t.x.toFixed(3), +t.y.toFixed(3), +t.z.toFixed(3), +c.speed.toFixed(2), c.grounded, +(c.slopeAngle * 180 / Math.PI).toFixed(1) ]) }
        g.ticker.events.on('fixedTick', sample, 1003)
        if(spec.kcc) { Object.assign(g.world.player.feel.kcc, spec.kcc); c.applySettings() }
        c.teleport(spec.from[0], spec.from[1], spec.from[2], 0)
        await waitSteps(30) // land
        for(const action of spec.hold) g.inputs.applyAction(action, 'start', 1)
        await waitSteps(spec.steps)
        for(const action of spec.hold) g.inputs.applyAction(action, 'end', 0)
        await waitSteps(30)
        const t = g.world.player.object.physical.body.translation()
        return { final: [ t.x, t.y, t.z ], maxY: Math.max(...log.map((r) => r[1])), maxSlope: Math.max(...log.map((r) => r[5])), log: log.filter((_, i) => i % 6 === 0 || (i >= 56 && i <= 78)) }
    }, spec)
    results[name] = data
    await page.close()
}

// Spawn rows: body centre = feet + 0.6 (+0.02 offset). Steps node at (-2.5, 0, -2): treads at z -2.3 ... -5.3 (0.6 each), x -3.7..-1.3
await scenario('steps', { from: [ -2.5, 0.65, -0.5 ], hold: [ 'forward', 'right' ], steps: 150 }) // walks -Z over the 6 steps (top 1.8 m)
await scenario('ramp', { from: [ 2.5, 0.65, -0.5 ], hold: [ 'forward', 'right' ], steps: 130 }) // walks -Z up the 30 degree ramp (rise 2.309 m over 4 m)
await scenario('wall', { from: [ 0, 0.65, -4.7 ], hold: [ 'forward', 'left' ], steps: 100 }) // forward+left = -X: runs into the side of step 5 (x = -1.3, 1.5 m high)
if(args.includes('--explore'))
{
    for(const w of [ 0.15, 0.05, 0.0 ])
        await scenario('stepsW' + w, { from: [ -2.5, 0.65, -0.5 ], hold: [ 'forward', 'right' ], steps: 150, kcc: { autostepMinWidth: w } })
    for(const w of [ 0.15, 0.05, 0.0 ])
        console.log('minWidth', w, JSON.stringify({ final: results['stepsW' + w].final, maxY: results['stepsW' + w].maxY }))
}
await browser.close()
server.kill()

writeFileSync(resolve(out, `t12-walk-${backend}.json`), JSON.stringify({ results, errors }, null, 2))
console.log(JSON.stringify({ skid: results.skid, errors }, null, 2))
console.log('steps', JSON.stringify({ final: results.steps.final, maxY: results.steps.maxY }))
console.log('ramp', JSON.stringify({ final: results.ramp.final, maxY: results.ramp.maxY, maxSlope: results.ramp.maxSlope }))
console.log('wall', JSON.stringify({ final: results.wall.final, maxY: results.wall.maxY }))
