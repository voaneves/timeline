// Phase 3 Full-Ring verification against ?era=origens&expose&webgl:
//   node tools/capture/t3-ring-verify.mjs [--dist dist-debug-t3] [--port 4222]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t3')
const port = Number(arg('--port', '4222'))
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
    if(a === null || b === null) return true
    if(a === 0 && b === 0) return true
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

    const ringInfo = await page.evaluate(() => ({
        hasRing: Boolean(window.__ring),
        eras: window.__ring?.eras || [],
        currentEra: window.__ring?.currentEra || null,
        hasTransitions: Boolean(window.game?.transitions),
    }))
    check(
        'T3.X2 window.__ring API',
        ringInfo.hasRing && ringInfo.eras.length === 7 && ringInfo.currentEra === 'origens' && ringInfo.hasTransitions,
        JSON.stringify(ringInfo)
    )

    // 1. Test skippable Transitions.transitionTo with Space key (origens -> unicamp)
    const skipStart = Date.now()
    const transitionPromise = page.evaluate(() => window.game.transitions.transitionTo('unicamp'))
    await page.waitForTimeout(250)
    await page.keyboard.press('Space')
    await transitionPromise
    const skipElapsed = Date.now() - skipStart
    const afterSkipEra = await page.evaluate(() => window.__ring.currentEra)
    check(
        'T3.X1 skippable transition (origens -> unicamp)',
        afterSkipEra === 'unicamp' && skipElapsed < 2500,
        `era=${afterSkipEra}, elapsed=${skipElapsed}ms`
    )

    // 2. Verify all 15 milestones + 6 projects + Backstage MIT credits + 6m Hub End-Dot
    const contentChecks = await page.evaluate(async () =>
    {
        const ui = window.game.ui
        const ring = window.__ring
        const results = {
            milestonesOk: [],
            milestonesFail: [],
            projectsOk: [],
            projectsFail: [],
            secretsOk: [],
            backstageOk: false,
            endDotOk: false,
            erasVisited: [ 'origens', 'unicamp' ],
        }

        const testMilestone = (id) =>
        {
            ui.openMilestone(id)
            const open = Boolean(document.querySelector('.js-card-dialog')?.open)
            ui.closeCard(false)
            if(open) results.milestonesOk.push(id)
            else results.milestonesFail.push(id)
        }

        // Origens (3)
        for(const id of [ 'e-1994-09', 'e-2005-01', 'e-2011-12' ])
            testMilestone(id)

        // Unicamp (4) + SecretLab
        for(const id of [ 'e-2012-01', 'e-2012-07', 'e-2012-12', 'e-2014-07' ])
        {
            ring.triggerSetPiece('milestone', id)
            const open = Boolean(document.querySelector('.js-card-dialog')?.open)
            ui.closeCard(false)
            if(open) results.milestonesOk.push(id)
            else results.milestonesFail.push(id)
        }
        if(ring.triggerSetPiece('secret')) results.secretsOk.push('unicamp')

        // Industria (3) + SecretVault
        await ring.goToEra('industria', { preloadNeighbor: false })
        results.erasVisited.push(ring.currentEra)
        for(const id of [ 'e-2017-01', 'e-2018-07', 'e-2019-01' ])
        {
            ring.triggerSetPiece('milestone', id)
            const open = Boolean(document.querySelector('.js-card-dialog')?.open)
            ui.closeCard(false)
            if(open) results.milestonesOk.push(id)
            else results.milestonesFail.push(id)
        }
        if(ring.triggerSetPiece('secret')) results.secretsOk.push('industria')

        // Alemanha
        await ring.goToEra('alemanha', { preloadNeighbor: false })
        results.erasVisited.push(ring.currentEra)
        ring.triggerSetPiece('milestone', '2018-07')
        const alemanhaOpen = Boolean(document.querySelector('.js-card-dialog')?.open)
        ui.closeCard(false)
        if(!alemanhaOpen) results.milestonesFail.push('alemanha-2018-07')

        // Dados (2) + SecretMatrix
        await ring.goToEra('dados', { preloadNeighbor: false })
        results.erasVisited.push(ring.currentEra)
        for(const id of [ 'e-2019-10', 'e-2021-06' ])
        {
            ring.triggerSetPiece('milestone', id)
            const open = Boolean(document.querySelector('.js-card-dialog')?.open)
            ui.closeCard(false)
            if(open) results.milestonesOk.push(id)
            else results.milestonesFail.push(id)
        }
        if(ring.triggerSetPiece('secret')) results.secretsOk.push('dados')

        // Transformacao (3) + 6 projects + Backstage
        await ring.goToEra('transformacao', { preloadNeighbor: false })
        results.erasVisited.push(ring.currentEra)
        for(const id of [ 'e-2022-01', 'e-2022-09-a', 'e-2022-09-b' ])
        {
            ring.triggerSetPiece('milestone', id)
            const open = Boolean(document.querySelector('.js-card-dialog')?.open)
            ui.closeCard(false)
            if(open) results.milestonesOk.push(id)
            else results.milestonesFail.push(id)
        }
        for(let i = 1; i <= 6; i++)
        {
            ring.triggerSetPiece('project', i)
            const open = Boolean(document.querySelector('.js-card-dialog')?.open)
            ui.closeCard(false)
            if(open) results.projectsOk.push(i)
            else results.projectsFail.push(i)
        }

        // Hub: Backstage MIT credits + 6m End-Dot
        await ring.goToEra('hub', { preloadNeighbor: false })
        results.erasVisited.push(ring.currentEra)
        ring.triggerSetPiece('backstage')
        const creditsDialog = document.querySelector('.js-backstage-credits')
        results.backstageOk = Boolean(creditsDialog?.open && /MIT/i.test(creditsDialog.textContent || ''))
        creditsDialog?.close?.()

        ring.triggerSetPiece('enddot')
        await new Promise((r) => setTimeout(r, 850))
        const contactOpen = Boolean(document.querySelector('.js-card-dialog')?.open)
        results.endDotOk = contactOpen
        ui.closeCard(false)

        return results
    })

    check('T3 7 eras visited', contentChecks.erasVisited.length === 7, contentChecks.erasVisited.join(' -> '))
    check('T3 15 milestones', contentChecks.milestonesOk.length === 15 && contentChecks.milestonesFail.length === 0, `${contentChecks.milestonesOk.length}/15`)
    check('T3 6 projects', contentChecks.projectsOk.length === 6 && contentChecks.projectsFail.length === 0, `${contentChecks.projectsOk.length}/6`)
    check('T3 Backstage MIT credits', contentChecks.backstageOk)
    check('T3 Hub 6m End-Dot -> Contact', contentChecks.endDotOk)

    // 3. 3 full ring laps (c1 -> c3) leak check
    const lapsResult = await page.evaluate(async () =>
    {
        const ring = window.__ring
        const settle = async () =>
        {
            await new Promise((r) => setTimeout(r, 350))
            for(let i = 0; i < 4; i++)
            {
                if(typeof window.gc === 'function')
                    window.gc()
                await new Promise((r) => requestAnimationFrame(r))
            }
        }

        const order = [ 'unicamp', 'industria', 'alemanha', 'dados', 'transformacao', 'hub', 'origens' ]
        await ring.goToEra('origens', { preloadNeighbor: false })
        // 1 warmup lap to settle V8 JIT / shader caches before c1 -> c3 measurement
        for(const era of order)
            await ring.goToEra(era, { preloadNeighbor: false })
        await settle()
        const baseline = ring.stats()
        const laps = []

        for(let lap = 1; lap <= 3; lap++)
        {
            for(const era of order)
                await ring.goToEra(era, { preloadNeighbor: false })
            await settle()
            laps.push({ lap, stats: ring.stats() })
        }

        return { baseline, laps }
    })

    const c1 = lapsResult.laps[0].stats
    const c2 = lapsResult.laps[1].stats
    const c3 = lapsResult.laps[2].stats
    const bodiesZeroLeak = c1.bodies === c3.bodies && lapsResult.baseline.bodies === c3.bodies
    const collidersZeroLeak = c1.colliders === c3.colliders && lapsResult.baseline.colliders === c3.colliders
    const heapOk = withinPct(c1.jsHeapMB, c3.jsHeapMB, 0.05)

    check(
        'T3 3-lap Rapier bodies ±0 leak',
        bodiesZeroLeak,
        `base=${lapsResult.baseline.bodies}, c1=${c1.bodies}, c2=${c2.bodies}, c3=${c3.bodies}`
    )
    check(
        'T3 3-lap Rapier colliders ±0 leak',
        collidersZeroLeak,
        `base=${lapsResult.baseline.colliders}, c1=${c1.colliders}, c2=${c2.colliders}, c3=${c3.colliders}`
    )
    check(
        'T3 3-lap JS heap within ±5%',
        heapOk,
        `base=${lapsResult.baseline.jsHeapMB}MB, c1=${c1.jsHeapMB}MB (g=${c1.geometries},t=${c1.textures},p=${c1.programs}), c2=${c2.jsHeapMB}MB, c3=${c3.jsHeapMB}MB (g=${c3.geometries},t=${c3.textures},p=${c3.programs})`
    )
    check('T3 0 console/page errors', errors.length === 0, `errors=${errors.length}`)
}
finally
{
    await browser.close().catch(() => {})
    stopServer()
}

process.exit(allPassed ? 0 : 1)
