// T2.28 ZoneStreamer verification against ?era=origens&expose&webgl:
//   node tools/capture/t228-streamer.mjs [--dist dist-debug] [--port 4213]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug')
const port = Number(arg('--port', '4213'))
const base = `http://127.0.0.1:${port}/`

const chrome = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find(existsSync)

if(!chrome)
{
    console.error('Chrome executable not found')
    process.exit(2)
}

const server = spawn(
    process.execPath,
    [ resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort' ],
    { stdio: 'ignore' }
)

const stopServer = () =>
{
    if(server.pid)
    {
        try
        {
            if(process.platform === 'win32')
                execFileSync('taskkill', [ '/PID', String(server.pid), '/T', '/F' ], { stdio: 'ignore' })
            else
                server.kill('SIGTERM')
        }
        catch {}
    }
}
process.on('exit', stopServer)

for(let i = 0; i < 60; i++)
{
    try { if((await fetch(base)).ok) break } catch {}
    await new Promise((r) => setTimeout(r, 250))
}

const browser = await chromium.launch({
    headless: false,
    executablePath: chrome,
    ignoreDefaultArgs: [ '--enable-automation' ],
    args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist', '--mute-audio', '--js-flags=--expose-gc' ],
})

const errors = []
let allPassed = true
const check = (label, ok, detail = '') =>
{
    if(!ok) allPassed = false
    console.log(`${label}: ${ok ? 'PASS' : 'FAIL'}${detail ? ` (${detail})` : ''}`)
}

const withinPct = (a, b, pct = 0.05) =>
{
    if(a === 0 && b === 0) return true
    if(a === null || b === null) return true
    const baseVal = Math.max(1, Math.abs(a))
    return Math.abs(b - a) / baseVal <= pct
}

try
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', (e) => { console.error('[pageerror]', e); errors.push(String(e)) })
    page.on('console', (m) => { if(m.type() === 'error') { console.error('[console.error]', m.text()); errors.push(m.text()) } })

    await page.goto(`${base}?era=origens&expose&webgl`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    await page.waitForTimeout(300)

    const apiCheck = await page.evaluate(() => ({
        hasStreamer: Boolean(window.__streamer),
        loadedEras: window.__streamer?.loadedEras || [],
        stats: window.__streamer?.stats?.() || null,
    }))
    check(
        'T2.28 window.__streamer API',
        apiCheck.hasStreamer && apiCheck.loadedEras.includes('origens') && typeof apiCheck.stats?.bodies === 'number',
        JSON.stringify(apiCheck)
    )

    const result = await page.evaluate(async () =>
    {
        const s = window.__streamer
        const settle = async () =>
        {
            await new Promise((r) => setTimeout(r, 250))
            if(typeof window.gc === 'function')
            {
                window.gc()
                await new Promise((r) => setTimeout(r, 50))
                window.gc()
            }
        }

        await settle()
        const baselineLoaded = s.stats()
        const cycles = []

        for(let i = 1; i <= 3; i++)
        {
            const unloaded = s.unloadEra('origens')
            await settle()
            const unloadedStats = s.stats()

            await s.loadEra('origens')
            await settle()
            const reloadedStats = s.stats()

            cycles.push({
                cycle: i,
                unloaded,
                loadedEras: [ ...s.loadedEras ],
                unloadedStats,
                reloadedStats,
            })
        }

        return {
            baselineLoaded,
            cycleCount: s.cycleCount,
            cycles,
        }
    })

    const finalLoaded = result.cycles[2].reloadedStats
    const cycle1Loaded = result.cycles[0].reloadedStats
    const cycle2Loaded = result.cycles[1].reloadedStats
    const unloaded0 = result.cycles[0].unloadedStats
    const unloaded2 = result.cycles[2].unloadedStats

    const bodiesExactLoaded = result.baselineLoaded.bodies === finalLoaded.bodies
    const collidersExactLoaded = result.baselineLoaded.colliders === finalLoaded.colliders
    const bodiesExactUnloaded = unloaded0.bodies === unloaded2.bodies
    const collidersExactUnloaded = unloaded0.colliders === unloaded2.colliders
    const geometriesOk = withinPct(result.baselineLoaded.geometries, finalLoaded.geometries, 0.05)
    const texturesOk = withinPct(result.baselineLoaded.textures, finalLoaded.textures, 0.05)
    const heapOk = withinPct(cycle1Loaded.jsHeapMB, finalLoaded.jsHeapMB, 0.05)

    check('T2.28 3 cycles completed', result.cycleCount === 3, `cycleCount=${result.cycleCount}`)
    check(
        'T2.28 Rapier bodies/colliders exact (+-0 leak)',
        bodiesExactLoaded && collidersExactLoaded && bodiesExactUnloaded && collidersExactUnloaded,
        `loaded baseline=${result.baselineLoaded.bodies}/${result.baselineLoaded.colliders} final=${finalLoaded.bodies}/${finalLoaded.colliders}; unloaded c1=${unloaded0.bodies}/${unloaded0.colliders} c3=${unloaded2.bodies}/${unloaded2.colliders}`
    )
    check(
        'T2.28 geometries/textures within +-5%',
        geometriesOk && texturesOk,
        `geom baseline=${result.baselineLoaded.geometries} final=${finalLoaded.geometries}; tex baseline=${result.baselineLoaded.textures} final=${finalLoaded.textures}`
    )
    check(
        'T2.28 JS heap within +-5% across cycles',
        heapOk,
        `baseline=${result.baselineLoaded.jsHeapMB}MB c1=${cycle1Loaded.jsHeapMB}MB c2=${cycle2Loaded.jsHeapMB}MB c3=${finalLoaded.jsHeapMB}MB`
    )
    check('T2.28 zero console/page errors', errors.length === 0, errors.join(' | '))
}
finally
{
    await browser.close()
    stopServer()
}

process.exit(allPassed ? 0 : 1)
