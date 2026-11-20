// T1.6 check: vertical deviation of the camera focus point while the player is in the air (ghost `jumpArc`).
// Headed system Chrome via playwright-core on a debug build, read through page evaluation (no screen recording).
//
//   node tools/capture/t16-camera.mjs [--url http://127.0.0.1:4195/] [--ghost jumpArc]
//
// Every rendered frame: player body y, grounded, camera focus point y (focusPoint.smoothedPosition - focusOffsetY).
// Acceptance: while airborne (grounded false) the focus y stays within 5 cm of its value at take-off.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(resolve('package.json'))
const { chromium } = require('playwright-core')

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const base = arg('--url', 'http://127.0.0.1:4195/')
const ghost = arg('--ghost', 'jumpArc')
const out = resolve('tools/capture/out')
mkdirSync(out, { recursive: true })

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync)
const browser = await chromium.launch({ headless: false, executablePath: chrome, ignoreDefaultArgs: ['--enable-automation'], args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.addInitScript(() =>
{
    window.__frames = []
    const loop = () =>
    {
        const g = window.game
        if(g?.world?.player && g.view?.follow?.initialized)
        {
            const p = g.world.player
            window.__frames.push({
                y: p.model.position.y,
                grounded: p.controller.grounded,
                focusY: g.view.focusPoint.smoothedPosition.y - 0.9,
                camY: g.view.camera.position.y,
                yaw: g.view.spherical.theta,
            })
        }
        requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
})

await page.goto(`${base}?expose&webgl&ghost=${ghost}`)
await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
await page.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 60000, polling: 100 })
const frames = await page.evaluate(() => window.__frames)
await browser.close()

const rows = frames.map((f, i) => ({ ...f, i }))
const firstGround = rows.find((r) => r.grounded).i
const air = rows.filter((r) => r.i > firstGround && !r.grounded)
const takeoff = air[0]
const ref = rows[Math.max(0, takeoff.i - 1)].focusY
const maxDev = Math.max(...air.map((r) => Math.abs(r.focusY - ref)))
const maxHeight = Math.max(...air.map((r) => r.y)) - rows[takeoff.i - 1].y
const result = {
    ghost,
    frames: rows.length,
    airFrames: air.length,
    jumpApexHeightM: +maxHeight.toFixed(3),
    focusYAtTakeoff: +ref.toFixed(4),
    maxFocusYDeviationInAirCm: +(maxDev * 100).toFixed(3),
    yawRangeDeg: [ +(Math.min(...rows.map((r) => r.yaw)) * 180 / Math.PI).toFixed(2), +(Math.max(...rows.map((r) => r.yaw)) * 180 / Math.PI).toFixed(2) ],
    pass: maxDev <= 0.05,
    errors,
}
result.trace = rows.filter((r) => r.i >= firstGround - 2 && r.i < firstGround + 70).map((r) => [ r.i, +r.y.toFixed(3), r.grounded ? 1 : 0, +r.focusY.toFixed(3) ])
writeFileSync(resolve(out, 't16-camera.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
process.exit(result.pass ? 0 : 1)
