// T1.5 check: kinematic moving platform carry (<= 2 cm drift over >= 10 s idle) + jump takeoff velocity inheritance (±5%).
// Headed Chrome via playwright-core on a debug build (page evaluation only, no screen recording).
//
//   node tools/capture/t15-platform.mjs --dist dist-debug-t15 --port 4194 [--ghost platform]
//   node tools/capture/t15-platform.mjs --dist dist-debug-t15 --port 4194 --record --write
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t15')
const port = Number(arg('--port', '4194'))
const ghost = arg('--ghost', 'platform')
const base = `http://127.0.0.1:${port}/`
const DT = 1 / 120

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync)
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
const cleanup = () => { try { server.kill() } catch {} }
process.on('exit', cleanup)
console.log('server pid', server.pid)
for(let i = 0; i < 60; i++) { try { if((await fetch(base)).ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }

const browser = await chromium.launch({ headless: false, executablePath: chrome, ignoreDefaultArgs: ['--enable-automation'], args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const errors = []

if(args.includes('--record'))
{
    const { default: pilot } = await import(pathToFileURL(resolve('tools/capture/scripts/platform-pilot.mjs')).href)
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(m.text()) })
    await page.goto(`${base}?expose&webgl&ghost=rec`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    const out = await page.evaluate(pilot, { idleSteps: Number(arg('--idle', '1280')) })
    console.log('pilot log:', JSON.stringify(out.log))
    console.log('phase:', out.phase, 'idleStart:', out.idleStart, 'platJumpStep:', out.platJumpStep, 'landStep:', out.landStep, 'events:', out.ghost.events.length, 'steps:', out.ghost.steps)
    if(args.includes('--write'))
        writeFileSync(resolve('tools/capture/ghosts/platform.json'), JSON.stringify(out.ghost, null, 1))
    console.log('errors:', errors)
    await browser.close()
    cleanup()
    process.exit(out.phase === 7 && errors.length === 0 ? 0 : 1)
}

const INIT = `(() => {
    window.__trace = []
    window.__jumps = []
    const timer = setInterval(() => {
        const g = window.game
        if(!(g && g.world && g.world.player && g.world.movingPlatform && g.ticker)) return
        clearInterval(timer)
        const c = g.world.player.controller
        const p = g.world.player
        const plat = g.world.movingPlatform
        let jumpedThisStep = false
        c.events.on('jump', () => {
            jumpedThisStep = true
            window.__jumps.push({
                step: g.ghost ? g.ghost.step : g.physics.steps,
                vx: c.velocity.x,
                vy: c.velocity.y,
                vz: c.velocity.z,
                mvx: plat.velocity.x,
                mvy: plat.velocity.y,
                mvz: plat.velocity.z,
            })
        })
        g.ticker.events.on('fixedTick', () => {
            const pt = p.object.physical.body.translation()
            const mt = plat.body.translation()
            window.__trace.push({
                s: g.ghost ? g.ghost.step - 1 : g.physics.steps - 1,
                px: pt.x, py: pt.y, pz: pt.z,
                mx: mt.x, my: mt.y, mz: mt.z,
                vx: c.velocity.x, vy: c.velocity.y, vz: c.velocity.z,
                mvx: plat.velocity.x, mvy: plat.velocity.y, mvz: plat.velocity.z,
                grounded: c.grounded,
                onPlatform: c.groundPlatform === plat,
                hasInput: p.input.speed > 0,
                jumped: jumpedThisStep,
            })
            jumpedThisStep = false
        }, 1001)
    }, 0)
})()`

const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if(m.type() === 'error') errors.push(m.text()) })
await page.addInitScript(INIT)
await page.goto(`${base}?expose&webgl&ghost=${ghost}`)
await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
await page.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 180000, polling: 100 })

const { trace, jumps } = await page.evaluate(() => ({ trace: window.__trace, jumps: window.__jumps }))
await page.close()
await browser.close()
cleanup()

// 1. Find longest contiguous idle-standing-on-platform span
let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0
for(let i = 0; i < trace.length; i++)
{
    const r = trace[i]
    const idleOnPlat = r.grounded && r.onPlatform && !r.hasInput && Math.hypot(r.vx, r.vz) < 1e-4
    if(idleOnPlat)
    {
        if(curStart < 0) curStart = i
        curLen++
        if(curLen > bestLen) { bestStart = curStart; bestLen = curLen }
    }
    else
    {
        curStart = -1
        curLen = 0
    }
}

const idleSpan = bestStart >= 0 ? trace.slice(bestStart, bestStart + bestLen) : []
const idleSeconds = idleSpan.length * DT
let maxDriftXZ = 0, maxDriftY = 0, maxDrift3D = 0
let sawNegSpeed = false, sawPosSpeed = false, sawPause = false
if(idleSpan.length > 0)
{
    const refDx = idleSpan[0].px - idleSpan[0].mx
    const refDy = idleSpan[0].py - idleSpan[0].my
    const refDz = idleSpan[0].pz - idleSpan[0].mz
    for(const r of idleSpan)
    {
        const dx = (r.px - r.mx) - refDx
        const dy = (r.py - r.my) - refDy
        const dz = (r.pz - r.mz) - refDz
        const dXZ = Math.hypot(dx, dz)
        const dY = Math.abs(dy)
        const d3 = Math.hypot(dx, dy, dz)
        if(dXZ > maxDriftXZ) maxDriftXZ = dXZ
        if(dY > maxDriftY) maxDriftY = dY
        if(d3 > maxDrift3D) maxDrift3D = d3
        if(r.mvz <= -1.99) sawNegSpeed = true
        if(r.mvz >= 1.99) sawPosSpeed = true
        if(Math.abs(r.mvz) < 0.01) sawPause = true
    }
}

// 2. Find platform jump after the idle span
const idleEndStep = idleSpan.length > 0 ? idleSpan[idleSpan.length - 1].s : -1
const platJump = jumps.find((j) => j.step >= idleEndStep && Math.hypot(j.mvx, j.mvz) >= 1.9)
let jumpMetrics = null
if(platJump)
{
    const idx = trace.findIndex((r) => r.s === platJump.step)
    const r0 = trace[idx]
    const r1 = trace[idx + 1]
    const r2 = trace[idx + 2]
    const rPrev = trace[idx - 1]
    const platSpeed = Math.hypot(platJump.mvx, platJump.mvz)
    const takeoffVecErr = Math.hypot(platJump.vx - platJump.mvx, platJump.vz - platJump.mvz) / platSpeed
    const step0VecErr = r0 ? Math.hypot(r0.vx - platJump.mvx, r0.vz - platJump.mvz) / platSpeed : Infinity
    const step2VecErr = r2 ? Math.hypot(r2.vx - platJump.mvx, r2.vz - platJump.mvz) / platSpeed : Infinity
    const dispVx = (r2 && rPrev) ? (r2.px - rPrev.px) / (3 * DT) : 0
    const dispVz = (r2 && rPrev) ? (r2.pz - rPrev.pz) / (3 * DT) : 0
    const dispVecErr = Math.hypot(dispVx - platJump.mvx, dispVz - platJump.mvz) / platSpeed
    const landRow = trace.find((r, k) => k > idx + 10 && r.grounded)
    const relBefore = rPrev ? { x: rPrev.px - rPrev.mx, z: rPrev.pz - rPrev.mz } : null
    const relAfter = landRow ? { x: landRow.px - landRow.mx, z: landRow.pz - landRow.mz } : null
    const landRelDrift = (relBefore && relAfter) ? Math.hypot(relAfter.x - relBefore.x, relAfter.z - relBefore.z) : null

    jumpMetrics = {
        step: platJump.step,
        platformVel: [ +platJump.mvx.toFixed(4), +platJump.mvz.toFixed(4) ],
        takeoffVel: [ +platJump.vx.toFixed(4), +platJump.vz.toFixed(4) ],
        step0Vel: r0 ? [ +r0.vx.toFixed(4), +r0.vz.toFixed(4) ] : null,
        step2Vel: r2 ? [ +r2.vx.toFixed(4), +r2.vz.toFixed(4) ] : null,
        dispVel3Steps: [ +dispVx.toFixed(4), +dispVz.toFixed(4) ],
        takeoffErrPct: +(takeoffVecErr * 100).toFixed(3),
        step0ErrPct: +(step0VecErr * 100).toFixed(3),
        step2ErrPct: +(step2VecErr * 100).toFixed(3),
        dispErrPct: +(dispVecErr * 100).toFixed(3),
        airSteps: landRow ? landRow.s - platJump.step : null,
        landedOnPlatform: Boolean(landRow?.onPlatform),
        landRelDriftM: landRelDrift !== null ? +landRelDrift.toFixed(5) : null,
    }
}

const idlePass = idleSpan.length >= 1200 && maxDrift3D <= 0.02 && sawNegSpeed && sawPosSpeed && sawPause
const jumpPass = Boolean(
    jumpMetrics &&
    jumpMetrics.takeoffErrPct <= 5 &&
    jumpMetrics.step0ErrPct <= 5 &&
    jumpMetrics.step2ErrPct <= 5 &&
    jumpMetrics.dispErrPct <= 5 &&
    jumpMetrics.landedOnPlatform
)
const pass = idlePass && jumpPass && errors.length === 0

const report = {
    idle: {
        steps: idleSpan.length,
        seconds: +idleSeconds.toFixed(3),
        maxDriftXZ_cm: +(maxDriftXZ * 100).toFixed(4),
        maxDriftY_cm: +(maxDriftY * 100).toFixed(4),
        maxDrift3D_cm: +(maxDrift3D * 100).toFixed(4),
        sawNegSpeed,
        sawPosSpeed,
        sawPause,
        pass: idlePass,
    },
    jump: jumpMetrics ? { ...jumpMetrics, pass: jumpPass } : { pass: false, reason: 'no platform jump found' },
    errors,
    pass,
}

console.log(JSON.stringify(report, null, 2))
process.exit(pass ? 0 : 1)
