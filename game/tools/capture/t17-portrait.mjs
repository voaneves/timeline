// T1.7 check: portrait camera FOV, pitch, avatar height (1.2 m capsule projected with the real camera),
// useful width at the focus plane and on the ground plane 4 m ahead, plus live orientation resize
// (1280x720 -> 390x844 -> 844x390). Headed system Chrome via playwright-core, read through page evaluation.
//
//   node tools/capture/t17-portrait.mjs [--port 4192] [--dist dist-debug] [--url http://127.0.0.1:4192/] [--shots]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(resolve('package.json'))
const { chromium } = require('playwright-core')

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const port = Number(arg('--port', '4192'))
const dist = arg('--dist', 'dist-debug')
const providedUrl = args.includes('--url') ? arg('--url') : null
const base = providedUrl ? (providedUrl.endsWith('/') ? providedUrl : `${providedUrl}/`) : `http://127.0.0.1:${port}/`
const shots = args.includes('--shots')
const out = resolve('tools/capture/out')
mkdirSync(out, { recursive: true })

let server = null
const stopServer = () =>
{
    if(server && !server.killed)
    {
        try { server.kill() } catch {}
    }
}
process.on('exit', stopServer)
process.on('SIGINT', () => { stopServer(); process.exit(130) })
process.on('SIGTERM', () => { stopServer(); process.exit(143) })

if(!providedUrl)
{
    const distDir = resolve(dist)
    if(!existsSync(distDir))
    {
        console.error(`Missing build directory: ${distDir}`)
        process.exit(1)
    }
    server = spawn(
        process.execPath,
        [ resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort' ],
        { stdio: 'ignore' }
    )
    let ready = false
    for(let i = 0; i < 60; i++)
    {
        try { if((await fetch(base)).ok) { ready = true; break } } catch {}
        await new Promise((r) => setTimeout(r, 250))
    }
    if(!ready)
    {
        console.error(`Preview server on ${base} did not start in time`)
        stopServer()
        process.exit(1)
    }
}

const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync)

const measurePage = (page) => page.evaluate(() =>
{
    const g = window.game
    const cam = g.view.camera
    const V3 = cam.position.constructor
    const p = g.world.player.model.position
    const projectY = (y) => { const v = new V3(p.x, y, p.z).project(cam); return (1 - v.y) / 2 }
    const top = projectY(p.y + 0.6)
    const bottom = projectY(p.y - 0.6)
    const focus = g.view.focusPoint.smoothedPosition
    const dist = cam.position.distanceTo(focus)
    const hFov = 2 * Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect) * 180 / Math.PI

    // Useful width on the ground plane 4 m ahead of the avatar along the camera's horizontal forward axis
    const fwd = new V3(focus.x - cam.position.x, 0, focus.z - cam.position.z).normalize()
    const right = new V3(-fwd.z, 0, fwd.x)
    const aheadPt = new V3(p.x + fwd.x * 4, p.y - 0.6, p.z + fwd.z * 4)
    const ndcAhead = aheadPt.clone().project(cam)
    const ndcAheadRight = aheadPt.clone().add(right).project(cam)
    const usefulWidthAhead4mM = 2 / Math.abs(ndcAheadRight.x - ndcAhead.x)
    const ahead4mScreenY = ((1 - ndcAhead.y) / 2) * 100

    return {
        viewport: { width: g.viewport.width, height: g.viewport.height },
        aspect: +cam.aspect.toFixed(3),
        vFov: +cam.fov.toFixed(2),
        hFov: +hFov.toFixed(2),
        distance: +dist.toFixed(2),
        sphericalRadiusCurrent: +g.view.spherical.radius.current.toFixed(2),
        sphericalRadiusEdges: {
            min: +g.view.spherical.radius.edges.min.toFixed(2),
            max: +g.view.spherical.radius.edges.max.toFixed(2),
        },
        pitchDeg: +(90 - g.view.spherical.phi * 180 / Math.PI).toFixed(1),
        focusOffsetY: +g.view.framing.focusOffsetY.toFixed(2),
        lookAhead: +g.view.framing.lookAhead.toFixed(2),
        avatarPctOfHeight: +((bottom - top) * 100).toFixed(2),
        avatarCentreY: +(((top + bottom) / 2) * 100).toFixed(1),
        usefulWidthM: +(2 * dist * Math.tan(hFov * Math.PI / 360)).toFixed(2),
        usefulWidthAhead4mM: +usefulWidthAhead4mM.toFixed(2),
        ahead4mScreenY: +ahead4mScreenY.toFixed(1),
        optimalArea: {
            radius: +g.view.optimalArea.radius.toFixed(1),
            near: +g.view.optimalArea.nearDistance.toFixed(1),
            far: +g.view.optimalArea.farDistance.toFixed(1),
        },
    }
})

const VIEWPORTS = [
    [ 'landscape-1280x720', 1280, 720 ],
    [ 'portrait-390x844', 390, 844 ],
    [ 'landscape-844x390', 844, 390 ],
]

const errors = []
const results = { fresh: {}, liveResize: {}, checks: {}, errors, pass: false }
let browser = null

try
{
    browser = await chromium.launch({
        headless: false,
        executablePath: chrome,
        ignoreDefaultArgs: [ '--enable-automation' ],
        args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist' ],
    })

    const attachErrors = (page, tag) =>
    {
        page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e}`))
        page.on('console', (m) => { if(m.type() === 'error') errors.push(`[${tag}] console.error: ${m.text()}`) })
    }

    // 1. Fresh-page measurements for each viewport
    for(const [ name, w, h ] of VIEWPORTS)
    {
        const page = await browser.newPage({ viewport: { width: w, height: h } })
        attachErrors(page, `fresh:${name}`)
        await page.goto(`${base}?expose&webgl`)
        await page.waitForFunction(() => window.game?.ready === true && window.game.world?.player, null, { timeout: 60000 })
        await page.waitForTimeout(2500)
        results.fresh[name] = await measurePage(page)
        if(shots) await page.screenshot({ path: resolve(out, `t17-${name}.png`) })
        await page.close()
    }

    // 2. Live resize sequence on a single page: 1280x720 -> 390x844 -> 844x390
    const livePage = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    attachErrors(livePage, 'liveResize')
    await livePage.goto(`${base}?expose&webgl`)
    await livePage.waitForFunction(() => window.game?.ready === true && window.game.world?.player, null, { timeout: 60000 })
    await livePage.waitForTimeout(2500)
    results.liveResize['landscape-1280x720'] = await measurePage(livePage)

    for(const [ name, w, h ] of VIEWPORTS.slice(1))
    {
        await livePage.setViewportSize({ width: w, height: h })
        await livePage.waitForFunction(
            ([ ew, eh ]) => window.game?.viewport?.width === ew && window.game?.viewport?.height === eh,
            [ w, h ],
            { timeout: 10000 }
        )
        // Wait past the 400 ms throttleResize timer and several render ticks
        await livePage.waitForTimeout(800)
        results.liveResize[name] = await measurePage(livePage)
    }
    await livePage.close()

    // 3. Acceptance checks
    const near = (a, b, tol) => Math.abs(a - b) <= tol
    const checkSet = (m, key) =>
    {
        if(key === 'landscape-1280x720')
        {
            return {
                vFovOk: near(m.vFov, 38.04, 0.1),
                pitchOk: near(m.pitchDeg, 28, 0.1),
                distanceOk: near(m.distance, 10.5, 0.05) && near(m.sphericalRadiusCurrent, 10.5, 0.05),
                focusOffsetYOk: near(m.focusOffsetY, 0.9, 0.01),
                lookAheadOk: near(m.lookAhead, 1.5, 0.01),
            }
        }
        if(key === 'portrait-390x844')
        {
            return {
                vFovOk: near(m.vFov, 55, 0.1),
                pitchOk: near(m.pitchDeg, 36, 0.1),
                distanceOk: near(m.distance, m.sphericalRadiusCurrent, 0.05) && m.sphericalRadiusEdges.min === m.sphericalRadiusEdges.max,
                focusOffsetYOk: near(m.focusOffsetY, 1.6, 0.01),
                lookAheadOk: near(m.lookAhead, 1.0, 0.01),
                avatarPctIn9To12: m.avatarPctOfHeight >= 9 && m.avatarPctOfHeight <= 12,
                avatarLowerThird: m.avatarCentreY >= 58 && m.avatarCentreY <= 72,
                usefulWidthAhead4mGe6: m.usefulWidthAhead4mM >= 6.0 && m.ahead4mScreenY > 0 && m.ahead4mScreenY < 100,
            }
        }
        return {
            vFovOk: near(m.vFov, 38, 0.1),
            pitchOk: near(m.pitchDeg, 28, 0.1),
            distanceOk: near(m.distance, 10.5, 0.05) && near(m.sphericalRadiusCurrent, 10.5, 0.05),
            focusOffsetYOk: near(m.focusOffsetY, 0.9, 0.01),
            lookAheadOk: near(m.lookAhead, 1.5, 0.01),
        }
    }

    for(const [ name ] of VIEWPORTS)
    {
        results.checks[`fresh:${name}`] = checkSet(results.fresh[name], name)
        results.checks[`liveResize:${name}`] = checkSet(results.liveResize[name], name)
        const f = results.fresh[name]
        const l = results.liveResize[name]
        results.checks[`match:${name}`] = {
            vFov: near(f.vFov, l.vFov, 0.05),
            pitchDeg: near(f.pitchDeg, l.pitchDeg, 0.1),
            distance: near(f.distance, l.distance, 0.05),
            sphericalRadiusCurrent: near(f.sphericalRadiusCurrent, l.sphericalRadiusCurrent, 0.05),
            avatarPctOfHeight: near(f.avatarPctOfHeight, l.avatarPctOfHeight, 0.15),
            usefulWidthM: near(f.usefulWidthM, l.usefulWidthM, 0.05),
            usefulWidthAhead4mM: near(f.usefulWidthAhead4mM, l.usefulWidthAhead4mM, 0.1),
            optimalAreaRadius: near(f.optimalArea.radius, l.optimalArea.radius, 0.2),
        }
    }
    results.checks.zeroErrors = errors.length === 0

    const allChecksPass = Object.values(results.checks).every((v) =>
        typeof v === 'boolean' ? v : Object.values(v).every(Boolean)
    )
    results.pass = allChecksPass

    writeFileSync(resolve(out, 't17-portrait.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify(results, null, 2))
}
finally
{
    if(browser) await browser.close()
    stopServer()
}

process.exit(results.pass ? 0 : 1)
