// T1.4 check: the stamp breaks the greybox crates. Headed Chrome via playwright-core on a debug build (page evaluation only,
// no screen recording).
//   node tools/capture/t14-stamp.mjs [--dist dist-debug] [--port 4191] [--ghost stamp] [--reps 10] [--trace]
// Replays ghost `stamp` --reps times (fresh page each time) and prints, per run, the crates left, the stamp counters and the
// stamp events seen. --trace prints the player's per-step trace around the stamp (first run only).
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug')
const port = Number(arg('--port', '4191'))
const ghost = arg('--ghost', 'stamp')
const reps = Number(arg('--reps', '10'))
const trace = args.includes('--trace')
const base = `http://127.0.0.1:${port}/`

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync)
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => { try { server.kill() } catch {} })
console.log('server pid', server.pid)
for(let i = 0; i < 60; i++) { try { if((await fetch(base)).ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }

const browser = await chromium.launch({ headless: false, executablePath: chrome, ignoreDefaultArgs: ['--enable-automation'], args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const errors = []
const INIT = `(() => {
    window.__trace = []
    window.__events = []
    const timer = setInterval(() => {
        const g = window.game
        if(!(g && g.world && g.world.player && g.ticker)) return
        clearInterval(timer)
        const c = g.world.player.controller
        for(const name of [ 'stampStart', 'stamp', 'break', 'land' ])
            c.events.on(name, (e) => window.__events.push({ name, step: g.ghost ? g.ghost.step : -1, x: e.x, y: e.y, z: e.z, broken: e.broken }))
        g.ticker.events.on('fixedTick', () => {
            const t = g.world.player.object.physical.body.translation()
            window.__trace.push({ s: g.ghost ? g.ghost.step : -1, x: t.x, y: t.y, z: t.z, vy: c.velocity.y, grounded: c.grounded, phase: c.stamp.phase })
        }, 1001)
    }, 0)
})()`

if(args.includes('--record'))
{
    // Closed-loop pilot -> records ghosts/stamp.json (with --write)
    const { default: pilot } = await import(pathToFileURL(resolve('tools/capture/scripts/stamp-pilot.mjs')).href)
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${base}?expose&webgl&ghost=rec`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    const cfg = { waypoints: [ { x: -1.2, z: -13.5, tol: 0.4 }, { x: -1.2, z: -22 } ], jumpZ: Number(arg('--jumpZ', '-14.1')), stampDelay: Number(arg('--delay', '36')) }
    const out = await page.evaluate(pilot, cfg)
    console.log(JSON.stringify(out.log))
    console.log('broken', out.broken, 'events', out.ghost.events.length, 'steps', out.ghost.steps)
    if(args.includes('--write')) writeFileSync(resolve('tools/capture/ghosts/stamp.json'), JSON.stringify(out.ghost, null, 1))
    console.log('errors', errors)
    await browser.close()
    server.kill()
    process.exit(0)
}

let ok = 0
for(let i = 0; i < reps; i++)
{
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(m.text()) })
    await page.addInitScript(INIT)
    await page.goto(`${base}?expose&webgl&ghost=${ghost}`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    await page.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 120000, polling: 100 })
    const out = await page.evaluate(() => ({
        left: window.game.world.breakables.length,
        total: window.game.world.breakables.length,
        stamps: window.game.world.player.controller.stamp.count,
        broken: window.game.world.player.controller.stamp.broken,
        events: window.__events,
        trace: window.__trace,
        player: (() => { const t = window.game.world.player.object.physical.body.translation(); return [t.x, t.y, t.z] })(),
    }))
    const passed = out.broken >= 1 && out.stamps >= 1
    if(passed) ok++
    console.log(`run ${i + 1}: stamps ${out.stamps}, broken ${out.broken}, crates left ${out.left}, player (${out.player.map((v) => v.toFixed(3)).join(', ')}) ${passed ? 'OK' : 'FAIL'}`)
    if(i === 0)
    {
        console.log('events', JSON.stringify(out.events))
        if(trace)
        {
            const first = out.trace.findIndex((r) => r.phase !== 0)
            const rows = args.includes("--all") ? out.trace.filter((r, k) => k % 10 === 0) : first >= 0 ? out.trace.slice(Math.max(0, first - 3), first + 40) : out.trace.filter((r, k) => k % 10 === 0)
            for(const r of rows) console.log(JSON.stringify({ ...r, x: +r.x.toFixed(3), y: +r.y.toFixed(3), z: +r.z.toFixed(3), vy: +r.vy.toFixed(2) }))
        }
    }
    await page.close()
}
console.log(`passed ${ok}/${reps}, errors`, errors)
await browser.close()
server.kill()
process.exit(ok === reps && errors.length === 0 ? 0 : 1)
