// T1.3 check: jump, coyote, buffer, variable height, ribbon glide, head bump, the 4 m gap, slope speed.
// Headed Chrome via playwright-core on a debug build, everything read through page evaluation (no screen recording).
//
//   node tools/capture/t13-jump.mjs [--dist dist-debug-t13] [--port 4183] [--backend webgl|webgpu]
//
// Ghost `jumpArc` (jump pressed at step 60, released at step 180) gives the apex height and time. The other scenarios
// are scripted per fixed step (before the Player update) through Inputs.applyAction, the same path as the keyboard/ghost.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t13')
const backend = arg('--backend', 'webgl')
const port = Number(arg('--port', '4183'))
const base = `http://127.0.0.1:${port}/`
const out = resolve('tools/capture/out')
mkdirSync(out, { recursive: true })

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync)
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => { try { server.kill() } catch {} })
for(let i = 0; i < 60; i++) { try { if((await fetch(base)).ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }

const browser = await chromium.launch({ headless: false, executablePath: chrome, ignoreDefaultArgs: ['--enable-automation'], args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] })
const errors = []

// Installed before the game starts: a per-step trace for the ghost run, and the scripted-step runner
const INIT = `(() => {
    window.__trace = []
    const timer = setInterval(() => {
        const g = window.game
        if(!(g && g.world && g.world.player && g.ticker)) return
        clearInterval(timer)
        const c = g.world.player.controller
        g.ticker.events.on('fixedTick', () => {
            const t = g.world.player.object.physical.body.translation()
            window.__trace.push({ s: g.ghost ? g.ghost.step - 1 : g.physics.steps - 1, speed: c.speed, moved: c.movedSpeed, x: t.x, y: t.y, z: t.z, vy: c.velocity.y, grounded: c.grounded })
        }, 1001)
    }, 0)
    // pre(n): runs at the start of fixed step n (after the ghost injection, before the Player); post(n): after the physics step
    window.__sim = (pre, post, total) => new Promise((resolve) => {
        const g = window.game
        let n = 0
        const a = () => { pre(n) }
        const b = () => { if(post) post(n); n++; if(n >= total) { g.ticker.events.off('fixedTick', a); g.ticker.events.off('fixedTick', b); resolve() } }
        g.ticker.events.on('fixedTick', a, 1)
        g.ticker.events.on('fixedTick', b, 1003)
    })
})()`

async function open(query)
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(m.text()) })
    await page.addInitScript(INIT)
    await page.goto(`${base}?expose${backend === 'webgl' ? '&webgl' : ''}&${query}`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    return page
}

const DT = 1 / 120
const results = {}

// ---- 1. Ghost jumpArc
{
    const page = await open('ghost=jumpArc')
    await page.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 60000, polling: 100 })
    const trace = await page.evaluate(() => window.__trace)
    const PRESS = 60
    const rows = trace.filter((r) => r.s >= 0)
    const y0 = rows.find((r) => r.s === PRESS - 1).y
    const air = rows.filter((r) => r.s >= PRESS && r.s < PRESS + 120)
    const apexRow = air.reduce((best, r) => (r.y > best.y ? r : best), air[0])
    const landed = rows.find((r) => r.s > PRESS + 5 && r.grounded)
    results.jumpArc = {
        takeoffY: y0,
        apexHeight: apexRow.y - y0,
        apexSteps: apexRow.s - PRESS + 1,
        apexSeconds: (apexRow.s - PRESS + 1) * DT,
        airSteps: landed ? landed.s - PRESS + 1 : null,
        airSeconds: landed ? (landed.s - PRESS + 1) * DT : null,
        sample: rows.filter((r) => r.s >= PRESS - 1 && r.s <= PRESS + 4).map((r) => [r.s, +r.y.toFixed(4), +r.vy.toFixed(3)]),
    }
    results.jumpArc.pass = Math.abs(results.jumpArc.apexHeight - 2.0) <= 0.05 && Math.abs(results.jumpArc.apexSeconds - 0.34) <= 0.02
    await page.close()
}

// ---- 2. Scenarios, one page
const page = await open('n=1')
const evalSim = (fn, arg) => page.evaluate(fn, arg)

// Variable height: apex height for a hold, a tap (released right away) and a release after `n` steps
results.variable = await evalSim(async () =>
{
    const g = window.game
    const c = g.world.player.controller
    const act = (name, down) => g.inputs.applyAction(name, down ? 'start' : 'end', down ? 1 : 0)
    const apex = async (holdSteps) =>
    {
        c.teleport(0, 0.65, 2, 0)
        await window.__sim(() => {}, null, 40)
        const y0 = g.world.player.object.physical.body.translation().y
        let maxY = y0
        await window.__sim((n) => { if(n === 0) act('jump', true); if(n === holdSteps) act('jump', false) }, () => { maxY = Math.max(maxY, g.world.player.object.physical.body.translation().y) }, 80)
        act('jump', false)
        return +(maxY - y0).toFixed(4)
    }
    return { hold: await apex(200), release2steps: await apex(2), release10steps: await apex(10), release20steps: await apex(20) }
})

// Coyote: walk off the end of the run (z = -25), press jump `d` steps after the feet leave the ground
results.coyote = await evalSim(async () =>
{
    const g = window.game
    const c = g.world.player.controller
    const act = (name, down) => g.inputs.applyAction(name, down ? 'start' : 'end', down ? 1 : 0)
    const trial = async (delay) =>
    {
        c.teleport(0, 0.65, -22, 0)
        let jumps = 0, glides = 0, left = null
        const onJump = () => jumps++
        const onGlide = () => glides++
        c.events.on('jump', onJump)
        c.events.on('glide', onGlide)
        await window.__sim((n) =>
        {
            if(n === 30) { act('forward', true); act('right', true) } // 7 m/s toward -Z (camera azimuth 45 deg)
            if(left === null && n > 30 && !c.grounded) left = n
            if(left !== null && n === left + delay) { act('jump', true) }
            if(left !== null && n === left + delay + 1) { act('jump', false) }
        }, null, 140)
        c.events.off('jump', onJump)
        c.events.off('glide', onGlide)
        act('forward', false); act('right', false); act('jump', false)
        return { delay, leftAt: left, jumps, glides }
    }
    return [ await trial(4), await trial(10), await trial(11), await trial(14), await trial(24) ]
})

// Buffer: press `lead` steps before touching the ground; the jump must happen on the landing step
results.buffer = await evalSim(async () =>
{
    const g = window.game
    const c = g.world.player.controller
    const act = (name, down) => g.inputs.applyAction(name, down ? 'start' : 'end', down ? 1 : 0)
    const trial = async (lead) =>
    {
        c.teleport(0, 1.3, 2, 0)
        let jumps = 0, landStep = null, jumpStep = null, pressedAt = null
        const onJump = () => { jumps++; jumpStep = window.__n }
        c.events.on('jump', onJump)
        const onLand = () => { if(landStep === null) landStep = window.__n }
        c.events.on('land', onLand)
        window.__n = 0
        await window.__sim((n) =>
        {
            window.__n = n
            // time to ground from the current state: lead steps ahead, linear estimate on the fall speed
            if(pressedAt === null && !c.grounded && c.velocity.y < 0)
            {
                const feet = c.heightAboveGround(2)
                if(feet / Math.max(- c.velocity.y, 0.01) / DTS <= lead) { pressedAt = n; act('jump', true) }
            }
            if(pressedAt !== null && n === pressedAt + 1) act('jump', false)
        }, null, 100)
        c.events.off('jump', onJump)
        c.events.off('land', onLand)
        act('jump', false)
        return { lead, pressedAt, landStep, jumpStep, jumps }
    }
    const DTS = 1 / 120
    return [ await trial(8), await trial(12), await trial(30) ]
})

// Glide: a held jump with a 2nd press at the apex, vs a plain jump. Also a 2nd press low above the ground (must not glide).
results.glide = await evalSim(async () =>
{
    const g = window.game
    const c = g.world.player.controller
    const act = (name, down) => g.inputs.applyAction(name, down ? 'start' : 'end', down ? 1 : 0)
    const run = async (secondPress, holdSecond) =>
    {
        c.teleport(0, 0.65, 2, 0)
        await window.__sim(() => {}, null, 40)
        const y0 = g.world.player.object.physical.body.translation().y
        let maxY = y0, landed = null, glides = 0
        const onGlide = () => glides++
        c.events.on('glide', onGlide)
        await window.__sim((n) =>
        {
            if(n === 0) act('jump', true)
            if(n === secondPress - 1 && secondPress > 0) act('jump', false) // release so the next press is an edge
            if(n === secondPress && secondPress > 0) act('jump', true)
            if(secondPress > 0 && n === secondPress + holdSecond) act('jump', false)
            if(secondPress === 0 && n === 120) act('jump', false)
        }, (n) => { const y = g.world.player.object.physical.body.translation().y; maxY = Math.max(maxY, y); if(landed === null && n > 20 && c.grounded) landed = n }, 400)
        c.events.off('glide', onGlide)
        act('jump', false)
        return { apex: +(maxY - y0).toFixed(3), airSteps: landed, airSeconds: +(landed / 120).toFixed(3), glides }
    }
    return { plain: await run(0, 0), glideAtApex: await run(41, 100), glideTap: await run(41, 3), glideEarly: await run(10, 72) }
})

// Head bump: jump up under block1 (underside 3.2 m, at x 0, z -8)
results.bump = await evalSim(async () =>
{
    const g = window.game
    const c = g.world.player.controller
    const act = (name, down) => g.inputs.applyAction(name, down ? 'start' : 'end', down ? 1 : 0)
    c.teleport(0, 0.65, -8, 0)
    await window.__sim(() => {}, null, 40)
    const contacts = []
    const onBump = (e) => contacts.push({ step: window.__n, centerY: +e.y.toFixed(4), headY: +(e.y + 0.6).toFixed(4) })
    c.events.on('bump', onBump)
    const before = c.bumps
    let maxY = 0
    window.__n = 0
    await window.__sim((n) => { window.__n = n; if(n === 0) act('jump', true) }, () => { maxY = Math.max(maxY, g.world.player.object.physical.body.translation().y + 0.6) }, 80)
    act('jump', false)
    c.events.off('bump', onBump)
    // same jump in the open (no block) for comparison
    c.teleport(2, 0.65, -8, 0)
    return { bumps: c.bumps - before, contacts, maxHeadY: +maxY.toFixed(4), blockUndersideY: 3.2 }
})

// The 4 m gap (run ends z = -25, landing starts z = -29): run + jump at the edge, with and without glide
results.gap = await evalSim(async () =>
{
    const g = window.game
    const c = g.world.player.controller
    const act = (name, down) => g.inputs.applyAction(name, down ? 'start' : 'end', down ? 1 : 0)
    const trial = async (jumpZ, glide) =>
    {
        c.teleport(0, 0.65, -20, 0)
        let jumped = false, landedZ = null, landedY = null, fell = false, glided = false, apexZ = null
        const onGlide = () => { glided = true }
        c.events.on('glide', onGlide)
        await window.__sim((n) =>
        {
            const z = g.world.player.object.physical.body.translation().z
            if(n === 30) { act('forward', true); act('right', true); act('run', true) }
            if(!jumped && n > 30 && z <= jumpZ) { jumped = true; act('jump', true) }
            if(jumped && n > 0 && c.velocity.y < 0 && glide && !glided && !c.grounded) { act('jump', false); act('jump', true) } // 2nd press once falling
        }, () =>
        {
            const t = g.world.player.object.physical.body.translation()
            if(landedZ === null && jumped && c.grounded && t.z < -25.5) { landedZ = t.z; landedY = t.y }
            if(t.y < -0.9) fell = true
        }, 240)
        c.events.off('glide', onGlide)
        for(const a of [ 'forward', 'right', 'run', 'jump' ]) act(a, false)
        return { jumpZ, glide, jumped, glided, landedZ: landedZ && +landedZ.toFixed(3), landedY: landedY && +landedY.toFixed(3), fell }
    }
    const rows = []
    for(const jumpZ of [ -24.5, -24.8, -25.0, -25.1 ]) rows.push(await trial(jumpZ, false))
    rows.push(await trial(-24.5, true))
    return rows
})

// Slope speed: horizontal speed on the 30 deg ramp vs flat
results.slope = await evalSim(async () =>
{
    const g = window.game
    const c = g.world.player.controller
    const act = (name, down) => g.inputs.applyAction(name, down ? 'start' : 'end', down ? 1 : 0)
    c.teleport(2.5, 0.65, -0.5, 0)
    await window.__sim(() => {}, null, 30)
    const flat = [], ramp = []
    await window.__sim((n) => { if(n === 0) { act('forward', true); act('right', true) } }, () =>
    {
        const t = g.world.player.object.physical.body.translation()
        if(t.z > -1.9 && t.z < -1.2 && c.movedSpeed > 6.5) flat.push(c.movedSpeed)
        if(t.z < -2.8 && t.z > -5.2 && c.grounded && c.slopeAngle > 0.4) ramp.push(c.movedSpeed)
    }, 120)
    act('forward', false); act('right', false)
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
    return { flat: +mean(flat).toFixed(3), ramp: +mean(ramp).toFixed(3), ratio: +(mean(ramp) / mean(flat)).toFixed(3), samples: ramp.length }
})

await browser.close()
server.kill()

writeFileSync(resolve(out, `t13-jump-${backend}.json`), JSON.stringify({ results, errors }, null, 2))
console.log(JSON.stringify({ ...results, errors }, null, 2))
