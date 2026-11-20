// T1.10 helper: headed Chrome via playwright-core on a debug build (page evaluation only, no recording).
//   node tools/capture/t110-vehicle.mjs --dist dist-debug-t110 --port 4183 [--ghost vehicle]
// Without --ghost: a closed-loop pilot drives the greybox through the same Inputs actions, records them as a ghost
// (?ghost=rec) and writes tools/capture/ghosts/vehicle.json. With --ghost: replays and prints the landmarks passed.
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t110b')
const port = Number(arg('--port', '4183'))
const ghostName = arg('--ghost', null)
const base = `http://127.0.0.1:${port}/`
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync)
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => { try { server.kill() } catch {} })
for(let i = 0; i < 60; i++) { try { if((await fetch(base)).ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }
const browser = await chromium.launch({ headless: false, executablePath: chrome, ignoreDefaultArgs: ['--enable-automation'], args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] })
const errors = []
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if(m.type() === 'error') errors.push(m.text()) })
await page.goto(`${base}?expose&webgl&loco=vehicle&ghost=${ghostName ?? 'rec'}`)
await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 30000 }).catch((e) => { console.log('NOT READY', errors); throw e })
if(ghostName)
{
    await page.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 180000, polling: 100 })
}
else
{
    const { default: pilot, WAYPOINTS } = await import(pathToFileURL(resolve('tools/capture/scripts/vehicle-pilot.mjs')).href)
    const out = await page.evaluate(pilot, WAYPOINTS)
    console.log(JSON.stringify(out.log))
    console.log(JSON.stringify(out.wpLog))
    const ghost = out.ghost
    if(args.includes('--write')) writeFileSync(resolve('tools/capture/ghosts/vehicle.json'), JSON.stringify(ghost, null, 1))
    console.log('events', ghost.events.length, 'steps', ghost.steps)
}
console.log('errors', errors)
await browser.close()
server.kill()
