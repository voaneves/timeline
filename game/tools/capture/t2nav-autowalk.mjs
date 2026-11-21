// T2.NAV verification against ?era=origens&expose&webgl:
//   node tools/capture/t2nav-autowalk.mjs [--dist dist-debug] [--port 4212]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug')
const port = Number(arg('--port', '4212'))
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
    args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist', '--mute-audio' ],
})

const errors = []
let allPassed = true
const check = (label, ok, detail = '') =>
{
    if(!ok) allPassed = false
    console.log(`${label}: ${ok ? 'PASS' : 'FAIL'}${detail ? ` (${detail})` : ''}`)
}

try
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', (e) => { console.error('[pageerror]', e); errors.push(String(e)) })
    page.on('console', (m) => { if(m.type() === 'error') { console.error('[console.error]', m.text()); errors.push(m.text()) } })

    await page.goto(`${base}?era=origens&expose&webgl`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })

    const apiInfo = await page.evaluate(() => ({
        hasNav: Boolean(window.__nav),
        hasGoTo: typeof window.__nav?.goTo === 'function',
        nodeCount: window.__nav?.nodes?.length ?? 0,
    }))
    check('T2.NAV window.__nav API', apiInfo.hasNav && apiInfo.hasGoTo && apiInfo.nodeCount >= 12, JSON.stringify(apiInfo))

    const runLeg = async (label, milestoneId, refName, timeoutMs = 25000) =>
    {
        const started = await page.evaluate((id) =>
        {
            const ok = window.__nav.goTo(id)
            return {
                ok,
                pathLen: window.__nav.path?.length ?? 0,
                pathIds: (window.__nav.path || []).map((p) => p.id),
            }
        }, milestoneId)

        if(!started.ok)
        {
            check(label, false, `goTo(${milestoneId}) returned false`)
            return
        }

        await page.waitForFunction(() => window.__nav?.arrived === true, null, { timeout: timeoutMs })

        const res = await page.evaluate((rn) =>
        {
            const pos = window.game.world.player.controller.body.translation()
            const ref = window.game.world.references.get(rn)
            const distXZ = ref ? Math.hypot(pos.x - ref.position.x, pos.z - ref.position.z) : null
            const warping = Boolean(window.game.world.origensEra?.gameplay?.warpState)
            return {
                arrived: window.__nav.arrived,
                active: window.__nav.active,
                pos: { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) },
                distXZ: distXZ !== null ? +distXZ.toFixed(2) : null,
                warping,
            }
        }, refName)

        const ok = res.arrived && !res.active && (res.warping || (res.distXZ !== null && res.distXZ <= 1.8))
        check(label, ok, JSON.stringify({ ...started, ...res }))
    }

    await runLeg('T2.NAV Spawn -> 1994', 'e-1994-09', 'refNav02', 15000)
    await runLeg('T2.NAV 1994 -> 2005', 'e-2005-01', 'refNav07', 25000)
    await runLeg('T2.NAV 2005 -> 2011', 'e-2011-12', 'refNav10', 30000)
    await runLeg('T2.NAV 2011 -> Contato (pipeContact)', 'contato', 'refNav03', 25000)

    // Wait for pipe warp to settle if triggered, then test Tab -> Enter cycling
    await page.waitForFunction(() => !window.game.world.origensEra?.gameplay?.warpState, null, { timeout: 10000 })
    await page.click('canvas.experience')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)

    const tabEnter = await page.evaluate(() => ({
        active: window.__nav?.active,
        target: window.__nav?.target,
        pathLen: window.__nav?.path?.length ?? 0,
    }))
    check('T2.NAV Tab -> Enter milestone cycle', Boolean(tabEnter.active && tabEnter.target && tabEnter.pathLen > 0), JSON.stringify(tabEnter))

    check('T2.NAV zero console/page errors', errors.length === 0, errors.join(' | '))
}
finally
{
    await browser.close()
    stopServer()
}

process.exit(allPassed ? 0 : 1)
