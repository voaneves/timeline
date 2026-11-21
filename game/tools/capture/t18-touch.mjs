// T1.8 check: one-thumb touch controls + WCAG 2.5.7 single-pointer tap-to-walk.
// Headed Chrome via playwright-core in mobile emulation (390x844, hasTouch: true, isMobile: true).
//
//   node tools/capture/t18-touch.mjs [--dist dist-debug-t18] [--port 4197]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(resolve('package.json'))
const { chromium } = require('playwright-core')

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t18')
const port = Number(arg('--port', '4197'))
const base = `http://127.0.0.1:${port}/`
const outDir = resolve('tools/capture/out')
mkdirSync(outDir, { recursive: true })

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
console.log('server pid', server.pid)

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

const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync)

const MOBILE_CONTEXT = {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
}

// Helpers injected inside the page for synthetic multi-touch events
const dispatchTouch = (page, { selector = null, type, id, x, y, activeTouches = null }) => page.evaluate(
    ({ selector: sel, type: evType, id: tid, x: cx, y: cy, activeTouches: others }) =>
    {
        const target = sel ? document.querySelector(sel) : (document.elementFromPoint(cx, cy) || document.querySelector('.js-canvas'))
        if(!target)
            throw new Error(`No touch target for ${sel ?? `${cx},${cy}`}`)

        const makeTouch = (t) => new Touch({
            identifier: t.id,
            target: t.target || target,
            clientX: t.x,
            clientY: t.y,
            pageX: t.x,
            pageY: t.y,
            screenX: t.x,
            screenY: t.y,
            radiusX: 10,
            radiusY: 10,
            force: evType === 'touchend' || evType === 'touchcancel' ? 0 : 1,
        })

        const changed = [ makeTouch({ id: tid, x: cx, y: cy, target }) ]
        let touches
        if(others)
        {
            touches = others.map((o) => makeTouch(o))
        }
        else
        {
            touches = (evType === 'touchend' || evType === 'touchcancel') ? [] : changed
        }

        const event = new TouchEvent(evType, {
            bubbles: true,
            cancelable: true,
            touches,
            targetTouches: touches.filter((t) => t.target === target),
            changedTouches: changed,
        })
        target.dispatchEvent(event)
        return true
    },
    { selector, type, id, x, y, activeTouches }
)

const readPlayerState = (page) => page.evaluate(() =>
{
    const g = window.game
    const p = g.world.player
    const c = p.controller
    const pos = p.object.physical.body.translation()
    const half = p.feel.body.halfHeight + p.feel.body.radius
    return {
        x: pos.x,
        y: pos.y,
        feetY: pos.y - half,
        z: pos.z,
        vx: c.velocity.x,
        vy: c.velocity.y,
        vz: c.velocity.z,
        speed: c.speed,
        grounded: c.grounded,
        gliding: c.gliding,
        stampPhase: c.stamp.phase,
        stamps: c.stamp.count,
        broken: c.stamp.broken,
        walkTarget: p.walkTarget ? { ...p.walkTarget } : null,
        mode: g.inputs.mode,
        joystick: { ...g.inputs.touchControls.joystick },
        canStamp: g.inputs.touchControls.canStamp,
        orbitYaw: g.view.orbit.yaw,
    }
})

// Project a desired world waypoint (or the furthest reachable point along the segment toward it) into the left 60% viewport
const findLeft60TapPoint = (page, targetX, targetY, targetZ) => page.evaluate(({ tx, ty, tz }) =>
{
    const g = window.game
    const cam = g.view.camera
    cam.updateMatrixWorld()
    const V3 = cam.position.constructor
    const rect = g.canvasElement.getBoundingClientRect()
    const p = g.world.player.object.physical.body.translation()

    const project = (wx, wy, wz) =>
    {
        const v = new V3(wx, wy, wz).project(cam)
        if(v.z < -1 || v.z > 1)
            return null
        const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width
        const sy = rect.top + (0.5 - v.y * 0.5) * rect.height
        return { sx, sy }
    }

    // Try direct target first, then interpolate from target back toward player so tap lands in left 60%
    for(const frac of [ 1.0, 0.85, 0.7, 0.55, 0.4, 0.28, 0.18 ])
    {
        const wx = p.x + (tx - p.x) * frac
        const wy = ty
        const wz = p.z + (tz - p.z) * frac
        const pt = project(wx, wy, wz)
        if(pt && pt.sx >= rect.left + 12 && pt.sx <= rect.left + rect.width * 0.59 && pt.sy >= rect.top + 70 && pt.sy <= rect.bottom - 30)
            return { ...pt, frac, wx, wy, wz }
    }

    return null
}, { tx: targetX, ty: targetY, tz: targetZ })

const errors = []
const report = {
    test1ZeroDrag: {},
    test2Joystick: {},
    test3ControlsUi: {},
    errors,
    pass: false,
}

let browser = null
try
{
    browser = await chromium.launch({
        headless: false,
        executablePath: chrome,
        ignoreDefaultArgs: [ '--enable-automation' ],
        args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist' ],
    })

    const openMobilePage = async (tag) =>
    {
        const context = await browser.newContext(MOBILE_CONTEXT)
        const page = await context.newPage()
        page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e}`))
        page.on('console', (m) => { if(m.type() === 'error') errors.push(`[${tag}] console.error: ${m.text()}`) })
        await page.goto(`${base}?expose&webgl`)
        await page.waitForFunction(() => window.game?.ready === true && window.game.world?.player, null, { timeout: 60000 })
        await page.waitForTimeout(300)
        return { context, page }
    }

    // =========================================================================
    // TEST 1: Zero-drag greybox traversal (WCAG 2.5.7 acceptance)
    // =========================================================================
    {
        const { context, page } = await openMobilePage('test1')
        let touchId = 1
        let tapCount = 0
        let dragCount = 0 // STRICT: zero touchmove events allowed in Test 1

        const singleTap = async (x, y, holdMs = 30, selector = null) =>
        {
            const id = touchId++
            tapCount++
            await dispatchTouch(page, { selector, type: 'touchstart', id, x, y })
            if(holdMs > 0)
                await page.waitForTimeout(holdMs)
            await dispatchTouch(page, { selector, type: 'touchend', id, x, y })
        }

        // Ensure touch mode is active so 44 px camera orbit buttons are available for single-tap framing
        await singleTap(100, 700, 20, '.js-canvas')
        await page.waitForTimeout(80)

        // Helper: find a left-60% tap point for (tx, ty, tz), using single-tap ⟲/⟳ camera orbit (zero drag) if needed
        const getTapPointWithOrbit = async (tx, ty, tz) =>
        {
            let pt = await findLeft60TapPoint(page, tx, ty, tz)
            for(let attempt = 0; !pt && attempt < 2; attempt++)
            {
                const btn = await page.locator('.js-touch-orbit-left').boundingBox()
                if(btn)
                    await singleTap(btn.x + btn.width / 2, btn.y + btn.height / 2, 20, '.js-touch-orbit-left')
                await page.waitForTimeout(50)
                pt = await findLeft60TapPoint(page, tx, ty, tz)
            }
            return pt
        }

        // Helper: walk to within tol of (tx, tz) using ONLY left-60% single taps (and ⟲ single-tap orbit if off-left)
        const tapWalkTo = async (tx, ty, tz, tol = 0.75, maxMs = 12000) =>
        {
            const started = Date.now()
            let lastTap = 0
            while(Date.now() - started < maxMs)
            {
                const st = await readPlayerState(page)
                if(Math.hypot(st.x - tx, st.z - tz) <= tol)
                    return st

                const needsTap = !st.walkTarget || (Date.now() - lastTap > 420 && Math.hypot(st.walkTarget.x - tx, st.walkTarget.z - tz) > 0.6)
                if(needsTap)
                {
                    const pt = await getTapPointWithOrbit(tx, ty, tz)
                    if(pt)
                    {
                        await singleTap(pt.sx, pt.sy, 25, '.js-canvas')
                        lastTap = Date.now()
                    }
                }
                await page.waitForTimeout(50)
            }
            return await readPlayerState(page)
        }

        // 1a. Walk from spawn (0, 0) down the greybox run toward the crate staging spot (-1.2, 0, -14.0)
        await tapWalkTo(-0.8, 0, -6.5, 1.0, 9000)
        const stagePos = await tapWalkTo(-1.2, 0, -14.0, 0.85, 9000)

        // 1b. Tap past crate 1 (-1.2, 0.5, -18) so player sprints straight toward the crate, then jump & tap "Carimbar"
        const runPastCratePt = await getTapPointWithOrbit(-1.2, 0, -22.5)
        if(!runPastCratePt)
            throw new Error(`Could not project run-past-crate point onto left 60% from (${stagePos.x.toFixed(2)}, ${stagePos.z.toFixed(2)})`)
        await singleTap(runPastCratePt.sx, runPastCratePt.sy, 25, '.js-canvas')

        // Wait until player is moving toward the crate around z <= -15.4
        const jumpDeadline = Date.now() + 5000
        while(Date.now() < jumpDeadline)
        {
            const st = await readPlayerState(page)
            if(st.z <= -15.3 && st.grounded)
                break
            await page.waitForTimeout(20)
        }

        // Stationary jump press on right 40% (ZERO drag)
        const jumpId = touchId++
        tapCount++
        await dispatchTouch(page, { selector: '.js-canvas', type: 'touchstart', id: jumpId, x: 320, y: 680 })

        // Wait until player is airborne over crate 1 and contextual "Carimbar" button is visible
        let stampedViaButton = false
        const stampDeadline = Date.now() + 1200
        while(Date.now() < stampDeadline)
        {
            const st = await readPlayerState(page)
            if(st.canStamp && st.z <= -17.3 && st.feetY >= 0.7)
            {
                await dispatchTouch(page, { selector: '.js-canvas', type: 'touchend', id: jumpId, x: 320, y: 680 })
                const box = await page.locator('.js-touch-stamp').boundingBox()
                if(box && box.width >= 64 && box.height >= 64)
                {
                    await singleTap(box.x + box.width / 2, box.y + box.height / 2, 25, '.js-touch-stamp')
                    stampedViaButton = true
                }
                break
            }
            await page.waitForTimeout(16)
        }
        if(!stampedViaButton)
            await dispatchTouch(page, { selector: '.js-canvas', type: 'touchend', id: jumpId, x: 320, y: 680 })

        // Wait for stamp impact & landing
        const landDeadline = Date.now() + 2500
        let afterStamp = await readPlayerState(page)
        while(Date.now() < landDeadline)
        {
            afterStamp = await readPlayerState(page)
            if(afterStamp.grounded && afterStamp.broken >= 1)
                break
            await page.waitForTimeout(30)
        }

        // 1c. Walk to the 4 m gap edge (z = -25) and cross onto the landing slab (z <= -30, grounded)
        await tapWalkTo(-1.2, 0, -22.2, 0.9, 8000)

        // Tap landing slab across the 4 m gap (left 60%) so player sprints straight toward z = -34
        const landingTap = await getTapPointWithOrbit(-1.2, 0, -34.0)
        if(!landingTap)
            throw new Error('Could not project landing slab point onto left 60%')
        await singleTap(landingTap.sx, landingTap.sy, 25, '.js-canvas')

        // Wait until right at the ledge (z <= -24.5)
        const ledgeDeadline = Date.now() + 5000
        while(Date.now() < ledgeDeadline)
        {
            const st = await readPlayerState(page)
            if(st.z <= -24.55)
                break
            await page.waitForTimeout(16)
        }

        // Stationary jump press on right 40% (ZERO drag) + 2nd stationary tap for ribbon glide across the 4 m gap
        await singleTap(320, 680, 320, '.js-canvas')
        await page.waitForTimeout(40)
        await singleTap(320, 680, 420, '.js-canvas')

        // Wait for landing on the landing slab (z <= -30, grounded)
        let afterGap = await readPlayerState(page)
        const gapDeadline = Date.now() + 4000
        while(Date.now() < gapDeadline)
        {
            afterGap = await readPlayerState(page)
            if(afterGap.grounded && afterGap.z <= -30)
                break
            await page.waitForTimeout(30)
        }

        report.test1ZeroDrag = {
            dragCount,
            tapCount,
            stagePos: { x: +stagePos.x.toFixed(2), z: +stagePos.z.toFixed(2) },
            stampedViaButton,
            stamps: afterStamp.stamps,
            broken: afterStamp.broken,
            finalPos: { x: +afterGap.x.toFixed(2), y: +afterGap.feetY.toFixed(2), z: +afterGap.z.toFixed(2) },
            finalGrounded: afterGap.grounded,
            pass: dragCount === 0 && stampedViaButton && afterStamp.broken >= 1 && afterGap.z <= -30 && afterGap.grounded === true,
        }

        await context.close()
    }

    // =========================================================================
    // TEST 2: Left 60% floating joystick (deadzone, full deflection, clean stop)
    // =========================================================================
    {
        const { context, page } = await openMobilePage('test2')
        const startState = await readPlayerState(page)
        const jx = 110
        const jy = 560
        const jid = 100

        // Start touch on left 60%
        await dispatchTouch(page, { selector: '.js-canvas', type: 'touchstart', id: jid, x: jx, y: jy })
        const joystickVisibleOnStart = await page.evaluate(() => document.querySelector('.js-touch-joystick')?.classList.contains('is-active') === true)

        // Move 8 px (< 10 px deadzone) -> expect 0 movement
        await dispatchTouch(page, { selector: '.js-canvas', type: 'touchmove', id: jid, x: jx, y: jy - 8 })
        await page.waitForTimeout(350)
        const deadzoneState = await readPlayerState(page)
        const deadzoneDist = Math.hypot(deadzoneState.x - startState.x, deadzoneState.z - startState.z)

        // Move >= 48 px (dx=+28, dy=-48 => dist 55.6 px >= 48 px, runs down the flat centre runway) -> expect full run speed (7.0 m/s)
        await dispatchTouch(page, { selector: '.js-canvas', type: 'touchmove', id: jid, x: jx + 28, y: jy - 48 })
        await page.waitForTimeout(350)
        const runState = await readPlayerState(page)

        // Release -> expect joystick hidden and speed drops cleanly to 0
        await dispatchTouch(page, { selector: '.js-canvas', type: 'touchend', id: jid, x: jx + 28, y: jy - 48 })
        const joystickHiddenOnEnd = await page.evaluate(() => document.querySelector('.js-touch-joystick')?.classList.contains('is-active') === false)
        await page.waitForTimeout(300)
        const stopState = await readPlayerState(page)

        report.test2Joystick = {
            joystickVisibleOnStart,
            deadzoneJoystickActive: deadzoneState.joystick.active,
            deadzoneMoveM: +deadzoneDist.toFixed(4),
            deadzoneSpeed: +deadzoneState.speed.toFixed(3),
            fullDeflectionRadius: +runState.joystick.radius.toFixed(3),
            fullDeflectionX: +runState.joystick.x.toFixed(3),
            fullDeflectionY: +runState.joystick.y.toFixed(3),
            fullRunSpeed: +runState.speed.toFixed(3),
            joystickHiddenOnEnd,
            releaseSpeed: +stopState.speed.toFixed(4),
            pass:
                joystickVisibleOnStart &&
                deadzoneState.joystick.active === false &&
                deadzoneDist < 0.005 &&
                deadzoneState.speed < 0.001 &&
                runState.joystick.active === true &&
                Math.abs(runState.joystick.radius - 1) < 0.01 &&
                runState.speed >= 6.95 &&
                joystickHiddenOnEnd &&
                stopState.speed < 0.05,
        }

        await context.close()
    }

    // =========================================================================
    // TEST 3: Contextual Carimbar + Jump hint + Camera 44 px buttons
    // =========================================================================
    {
        const { context, page } = await openMobilePage('test3')

        // Enter touch mode with a quick tap in place
        await dispatchTouch(page, { selector: '.js-canvas', type: 'touchstart', id: 200, x: 100, y: 700 })
        await dispatchTouch(page, { selector: '.js-canvas', type: 'touchend', id: 200, x: 100, y: 700 })
        await page.waitForTimeout(100)

        const groundUi = await page.evaluate(() =>
        {
            const rectOf = (sel) =>
            {
                const el = document.querySelector(sel)
                if(!el) return null
                const r = el.getBoundingClientRect()
                const cs = getComputedStyle(el)
                return { width: +r.width.toFixed(1), height: +r.height.toFixed(1), display: cs.display, opacity: +cs.opacity, visible: el.classList.contains('is-visible') }
            }
            return {
                isTouchModeClass: document.documentElement.classList.contains('is-mode-touch'),
                inputsMode: window.game.inputs.mode,
                nippleEnabled: window.game.inputs.nipple.enabled,
                nippleVisible: window.game.inputs.nipple.group.visible,
                jumpHint: rectOf('.js-touch-jump'),
                stamp: rectOf('.js-touch-stamp'),
                orbitLeft: rectOf('.js-touch-orbit-left'),
                orbitRight: rectOf('.js-touch-orbit-right'),
            }
        })

        // Jump via right 40% stationary press so player rises above feel.stamp.minHeight (0.6 m)
        await dispatchTouch(page, { selector: '.js-canvas', type: 'touchstart', id: 201, x: 320, y: 680 })
        let airStampUi = null
        const airDeadline = Date.now() + 900
        while(Date.now() < airDeadline)
        {
            const info = await page.evaluate(() =>
            {
                const el = document.querySelector('.js-touch-stamp')
                const r = el.getBoundingClientRect()
                return {
                    visible: el.classList.contains('is-visible'),
                    display: getComputedStyle(el).display,
                    width: +r.width.toFixed(1),
                    height: +r.height.toFixed(1),
                    grounded: window.game.world.player.controller.grounded,
                }
            })
            if(info.visible && info.width >= 64)
            {
                airStampUi = info
                break
            }
            await page.waitForTimeout(16)
        }
        await dispatchTouch(page, { selector: '.js-canvas', type: 'touchend', id: 201, x: 320, y: 680 })

        // Wait for landing and confirm Carimbar hides again
        const landWait = Date.now() + 1800
        let stampHiddenAfterLand = false
        while(Date.now() < landWait)
        {
            const st = await page.evaluate(() => ({
                grounded: window.game.world.player.controller.grounded,
                visible: document.querySelector('.js-touch-stamp').classList.contains('is-visible'),
            }))
            if(st.grounded && !st.visible)
            {
                stampHiddenAfterLand = true
                break
            }
            await page.waitForTimeout(25)
        }

        // Camera 44 px single-tap orbit (zero drag) + spring return
        const leftBox = await page.locator('.js-touch-orbit-left').boundingBox()
        const rightBox = await page.locator('.js-touch-orbit-right').boundingBox()

        await dispatchTouch(page, { selector: '.js-touch-orbit-left', type: 'touchstart', id: 202, x: leftBox.x + leftBox.width / 2, y: leftBox.y + leftBox.height / 2 })
        await page.waitForTimeout(30)
        await dispatchTouch(page, { selector: '.js-touch-orbit-left', type: 'touchend', id: 202, x: leftBox.x + leftBox.width / 2, y: leftBox.y + leftBox.height / 2 })
        await page.waitForTimeout(50)
        const orbitLeftDeg = await page.evaluate(() => +(window.game.view.orbit.yaw * 180 / Math.PI).toFixed(2))

        // Wait for spring return (~1.2 s)
        await page.waitForTimeout(1450)
        const orbitReturnedDeg = await page.evaluate(() => +(window.game.view.orbit.yaw * 180 / Math.PI).toFixed(2))

        await dispatchTouch(page, { selector: '.js-touch-orbit-right', type: 'touchstart', id: 203, x: rightBox.x + rightBox.width / 2, y: rightBox.y + rightBox.height / 2 })
        await page.waitForTimeout(30)
        await dispatchTouch(page, { selector: '.js-touch-orbit-right', type: 'touchend', id: 203, x: rightBox.x + rightBox.width / 2, y: rightBox.y + rightBox.height / 2 })
        await page.waitForTimeout(50)
        const orbitRightDeg = await page.evaluate(() => +(window.game.view.orbit.yaw * 180 / Math.PI).toFixed(2))

        report.test3ControlsUi = {
            groundUi,
            airStampUi,
            stampHiddenAfterLand,
            orbitLeftDeg,
            orbitReturnedDeg,
            orbitRightDeg,
            pass:
                groundUi.isTouchModeClass &&
                groundUi.inputsMode === 3 &&
                groundUi.nippleEnabled === false &&
                groundUi.nippleVisible === false &&
                groundUi.jumpHint.width >= 76 && groundUi.jumpHint.height >= 76 &&
                groundUi.orbitLeft.width >= 44 && groundUi.orbitLeft.height >= 44 &&
                groundUi.orbitRight.width >= 44 && groundUi.orbitRight.height >= 44 &&
                groundUi.stamp.visible === false && groundUi.stamp.display === 'none' &&
                airStampUi !== null && airStampUi.width >= 64 && airStampUi.height >= 64 &&
                stampHiddenAfterLand &&
                orbitLeftDeg <= -10 &&
                Math.abs(orbitReturnedDeg) < 1.5 &&
                orbitRightDeg >= 10,
        }

        await context.close()
    }

    report.pass =
        report.test1ZeroDrag.pass === true &&
        report.test2Joystick.pass === true &&
        report.test3ControlsUi.pass === true &&
        errors.length === 0

    writeFileSync(resolve(outDir, 't18-touch.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
}
finally
{
    if(browser) await browser.close()
    stopServer()
}

process.exit(report.pass ? 0 : 1)
