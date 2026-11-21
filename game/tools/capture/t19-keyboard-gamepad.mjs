// T1.9 verification: Keyboard & Gamepad full action map, canvas focus gating, manual camera orbit, and greybox keyboard ghost.
// Usage:
//   node tools/capture/t19-keyboard-gamepad.mjs [--dist dist-debug-t19] [--port 4195] [--ghost greybox-keyboard]
//   node tools/capture/t19-keyboard-gamepad.mjs --record --write [--dist dist-debug-t19] [--port 4195]
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t19')
const port = Number(arg('--port', '4195'))
const ghostName = arg('--ghost', 'greybox-keyboard')
const base = `http://127.0.0.1:${port}/`
const ALLOWED_GHOST_ACTIONS = new Set([ 'forward', 'backward', 'left', 'right', 'jump', 'stamp' ])

const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync)

const server = spawn(
    process.execPath,
    [ resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort' ],
    { stdio: 'ignore' }
)
const killServer = () => { try { server.kill() } catch {} }
process.on('exit', killServer)
console.log('server pid', server.pid)

let serverReady = false
for(let i = 0; i < 60; i++)
{
    try
    {
        if((await fetch(base)).ok)
        {
            serverReady = true
            break
        }
    }
    catch {}
    await new Promise((r) => setTimeout(r, 250))
}
if(!serverReady)
{
    console.error('preview server did not start on', base)
    killServer()
    process.exit(1)
}

const browser = await chromium.launch({
    headless: false,
    executablePath: chrome,
    ignoreDefaultArgs: [ '--enable-automation' ],
    args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist' ],
})

const allErrors = []
async function openPage(url, initScript = null)
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors = []
    page.on('pageerror', (e) => { const s = String(e); errors.push(s); allErrors.push(s) })
    page.on('console', (m) => { if(m.type() === 'error') { const s = m.text(); errors.push(s); allErrors.push(s) } })
    page.on('response', (r) => { if(r.status() >= 400) { const s = `http ${r.status()} ${r.url()}`; errors.push(s); allErrors.push(s) } })
    if(initScript)
        await page.addInitScript(initScript)
    await page.goto(url)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    return { page, errors }
}

// ---------------------------------------------------------------------------
// Optional --record mode: closed-loop pilot records tools/capture/ghosts/greybox-keyboard.json
// Uses ONLY keyboard-mapped actions: forward, backward, left, right, jump, stamp.
// Path: spawn (0, 0) -> under blocks -> jump + stamp crate1 (-1.2, -18) ->
//       run to edge (0, -24.5) -> jump + ribbon glide over 4 m gap (-25..-29) ->
//       land on landing slab -> run to (0, -35.5) and settle.
// ---------------------------------------------------------------------------
if(args.includes('--record'))
{
    const { page, errors } = await openPage(`${base}?expose&webgl&ghost=rec`)
    const rec = await page.evaluate(async () =>
    {
        const g = window.game
        const body = g.world.player.object.physical.body
        const c = g.world.player.controller
        const A = (name, value) => g.inputs.applyAction(name, value ? 'start' : 'end', value ? 1 : 0, true)
        const held = { forward: false, backward: false, left: false, right: false, jump: false, stamp: false }
        const set = (name, on) => { if(held[name] !== on) { held[name] = on; A(name, on) } }

        let phase = 0
        let markStep = 0
        let done = false
        const log = []

        const steerToward = (tx, tz) =>
        {
            const t = body.translation()
            const dx = tx - t.x
            const dz = tz - t.z
            const len = Math.hypot(dx, dz)
            if(len < 0.08)
            {
                set('forward', false); set('backward', false); set('left', false); set('right', false)
                return
            }
            const th = g.view.spherical.theta
            const f = (dx * -Math.sin(th) + dz * -Math.cos(th)) / len
            const r = (dx * Math.cos(th) + dz * -Math.sin(th)) / len
            set('forward', f > 0.38)
            set('backward', f < -0.38)
            set('right', r > 0.38)
            set('left', r < -0.38)
        }

        g.ticker.events.on('fixedTick', () =>
        {
            if(done) return
            const step = g.ghost.step
            const t = body.translation()
            if(step % 60 === 0)
                log.push([ step, +t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2), phase, c.grounded ? 1 : 0 ])

            if(phase === 0)
            {
                // Run past blocks toward crate1 line (-1.2, -13.5)
                steerToward(-1.2, -13.5)
                if(Math.hypot(-1.2 - t.x, -13.5 - t.z) < 0.45)
                    phase = 1
            }
            else if(phase === 1)
            {
                // Approach crate1 (-1.2, -18) and jump at z <= -14.1
                steerToward(-1.2, -22.0)
                if(t.z <= -14.1 && c.grounded)
                {
                    set('jump', true)
                    markStep = step
                    phase = 2
                }
            }
            else if(phase === 2)
            {
                // Over crate1: trigger stamp after 36 fixed steps
                steerToward(-1.2, -22.0)
                if(step - markStep >= 36)
                {
                    set('stamp', true)
                    markStep = step
                    phase = 3
                }
            }
            else if(phase === 3)
            {
                steerToward(-1.2, -22.0)
                if(step - markStep >= 6)
                {
                    set('stamp', false)
                    set('jump', false)
                }
                if(c.grounded && step - markStep > 30)
                    phase = 35
            }
            else if(phase === 35)
            {
                // Pass cleanly through the broken crate1 lane (-1.2, -21.5)
                steerToward(-1.2, -21.5)
                if(t.z <= -20.5)
                    phase = 4
            }
            else if(phase === 4)
            {
                // Line up cleanly at x = 0 toward gap edge (z = -25)
                steerToward(0.0, -25.0)
                if(t.z <= -24.2 && c.grounded)
                {
                    set('jump', true)
                    markStep = step
                    phase = 5
                }
            }
            else if(phase === 5)
            {
                // Jump over 4 m gap (-25 -> -29); release jump near apex and tap again for ribbon glide
                steerToward(0.0, -35.5)
                const elapsed = step - markStep
                if(elapsed === 28)
                    set('jump', false)
                else if(elapsed === 36)
                    set('jump', true)
                else if(elapsed >= 80 || (c.grounded && t.z <= -29.2))
                {
                    set('jump', false)
                    if(c.grounded && t.z <= -29.2)
                        phase = 6
                }
            }
            else if(phase === 6)
            {
                // Run well onto landing slab (z <= -35.0)
                steerToward(0.0, -36.0)
                if(t.z <= -35.0 && c.grounded)
                {
                    set('forward', false); set('backward', false); set('left', false); set('right', false)
                    markStep = step
                    phase = 7
                }
            }
            else if(phase === 7)
            {
                if(step - markStep >= 60)
                    done = true
            }

            if(step > 1800)
                done = true
        }, 1)

        while(!done)
            await new Promise((r) => setTimeout(r, 100))

        for(const k of Object.keys(held))
            set(k, false)

        const ghost = g.ghost.stop()
        const finalPos = body.translation()
        return {
            log,
            finalPos: [ +finalPos.x.toFixed(3), +finalPos.y.toFixed(3), +finalPos.z.toFixed(3) ],
            grounded: c.grounded,
            broken: c.stamp.broken,
            stamps: c.stamp.count,
            ghost: { ...ghost, steps: ghost.steps + 30 },
        }
    })
    console.log(JSON.stringify({ ...rec, ghost: { steps: rec.ghost.steps, events: rec.ghost.events.length } }, null, 2))
    if(args.includes('--write'))
    {
        const outPath = resolve(`tools/capture/ghosts/${ghostName}.json`)
        writeFileSync(outPath, JSON.stringify(rec.ghost, null, 1))
        console.log('wrote', outPath)
    }
    await page.close()
    await browser.close()
    killServer()
    process.exit(errors.length === 0 && rec.finalPos[2] <= -32 && rec.grounded ? 0 : 1)
}

// ---------------------------------------------------------------------------
// Test 1: Focus gating (focus outside canvas consumes NO keys)
// ---------------------------------------------------------------------------
async function runTest1FocusGating()
{
    const { page, errors } = await openPage(`${base}?expose&webgl`)
    await page.waitForTimeout(300)

    const before = await page.evaluate(() =>
    {
        const input = document.createElement('input')
        input.id = 'ext-input'
        input.type = 'text'
        input.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;width:200px;height:32px;'
        document.body.appendChild(input)
        input.focus()

        window.__t1Actions = []
        window.game.inputs.events.on('actionStart', (a) => window.__t1Actions.push(a.name))

        const p = window.game.world.player.object.physical.body.translation()
        return {
            activeId: document.activeElement?.id ?? null,
            pos: [ p.x, p.y, p.z ],
        }
    })

    await page.keyboard.down('KeyW')
    await page.waitForTimeout(250)
    await page.keyboard.up('KeyW')
    await page.keyboard.press('Space')
    await page.keyboard.down('ShiftLeft')
    await page.waitForTimeout(80)
    await page.keyboard.up('ShiftLeft')
    await page.keyboard.down('ArrowUp')
    await page.waitForTimeout(150)
    await page.keyboard.up('ArrowUp')
    await page.waitForTimeout(150)

    const after = await page.evaluate(() =>
    {
        const p = window.game.world.player.object.physical.body.translation()
        const input = document.getElementById('ext-input')
        return {
            pos: [ p.x, p.y, p.z ],
            actions: window.__t1Actions,
            inputValue: input ? input.value : '',
            pressedCount: window.game.inputs.keyboard.pressed.length,
            activeId: document.activeElement?.id ?? null,
        }
    })
    await page.close()

    const delta = Math.hypot(after.pos[0] - before.pos[0], after.pos[1] - before.pos[1], after.pos[2] - before.pos[2])
    const pass =
        errors.length === 0 &&
        before.activeId === 'ext-input' &&
        delta < 0.001 &&
        after.actions.length === 0 &&
        after.inputValue.includes('w') &&
        after.inputValue.includes(' ') &&
        after.pressedCount === 0

    return {
        pass,
        deltaM: +delta.toFixed(6),
        actionsActivated: after.actions,
        inputValue: after.inputValue,
        pressedCount: after.pressedCount,
        errors,
    }
}

// ---------------------------------------------------------------------------
// Test 2: Canvas-focused keyboard actions, orbit clamp + spring-back, blur release
// ---------------------------------------------------------------------------
async function runTest2CanvasKeyboard()
{
    const { page, errors } = await openPage(`${base}?expose&webgl`)
    await page.waitForTimeout(300)

    // Verify immediate keyboard control BEFORE clicking the canvas (document.activeElement is body)
    const beforeClick = await page.evaluate(() =>
    {
        const p = window.game.world.player.object.physical.body.translation()
        return {
            activeTag: document.activeElement?.tagName ?? null,
            pos: [ p.x, p.y, p.z ],
        }
    })
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(260)
    await page.keyboard.up('KeyW')
    const afterImmediateMove = await page.evaluate(() =>
    {
        const p = window.game.world.player.object.physical.body.translation()
        return { pos: [ p.x, p.y, p.z ] }
    })
    const immediateMovedDist = Math.hypot(
        afterImmediateMove.pos[0] - beforeClick.pos[0],
        afterImmediateMove.pos[2] - beforeClick.pos[2]
    )
    await page.waitForTimeout(350)

    // Verify canvas attributes, pointerdown focus, and NO focus outline ring on mouse click
    await page.mouse.click(640, 360)
    const focusInfo = await page.evaluate(() =>
    {
        const canvas = document.querySelector('.js-canvas')
        const cs = getComputedStyle(canvas)
        window.__t2Actions = []
        window.game.inputs.events.on('actionStart', (a) => window.__t2Actions.push(a.name))
        const p = window.game.world.player.object.physical.body.translation()
        return {
            focused: document.activeElement === canvas,
            outlineStyle: cs.outlineStyle,
            outlineWidth: cs.outlineWidth,
            tabindex: canvas.getAttribute('tabindex'),
            role: canvas.getAttribute('role'),
            ariaLabel: canvas.getAttribute('aria-label'),
            startPos: [ p.x, p.y, p.z ],
        }
    })

    // Hold KeyW (also checks key-repeat deduplication)
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(550)
    const moveCheck = await page.evaluate(() =>
    {
        const p = window.game.world.player.object.physical.body.translation()
        const c = window.game.world.player.controller
        return {
            pos: [ p.x, p.y, p.z ],
            speed: Math.hypot(c.velocity.x, c.velocity.z),
            forwardActive: window.game.inputs.actions.get('forward').active,
            pressedLen: window.game.inputs.keyboard.pressed.length,
        }
    })

    // Blur canvas WHILE KeyW is still held -> must immediately release KeyW & decelerate to 0
    await page.evaluate(() => document.querySelector('.js-canvas').blur())
    const afterBlurImmediate = await page.evaluate(() => ({
        forwardActive: window.game.inputs.actions.get('forward').active,
        pressedLen: window.game.inputs.keyboard.pressed.length,
    }))
    await page.waitForTimeout(400)
    const afterBlurDecel = await page.evaluate(() =>
    {
        const c = window.game.world.player.controller
        return { speed: Math.hypot(c.velocity.x, c.velocity.z) }
    })
    await page.keyboard.up('KeyW')

    // Re-focus canvas and test Space (jump)
    await page.mouse.click(640, 360)
    const baseY = await page.evaluate(() =>
    {
        window.__t2MaxY = window.game.world.player.object.physical.body.translation().y
        window.__t2Poll = setInterval(() =>
        {
            const y = window.game.world.player.object.physical.body.translation().y
            if(y > window.__t2MaxY) window.__t2MaxY = y
        }, 16)
        return window.__t2MaxY
    })
    await page.keyboard.down('Space')
    await page.waitForTimeout(380)
    await page.keyboard.up('Space')
    await page.waitForTimeout(500)
    const jumpHeight = await page.evaluate(() =>
    {
        clearInterval(window.__t2Poll)
        return window.__t2MaxY
    }) - baseY

    // Test manual camera orbit with KeyQ (left) -> clamp within +-25 deg, spring back to 0 within 1.2 s
    await page.keyboard.down('KeyQ')
    await page.waitForTimeout(700)
    const orbitHeldDeg = await page.evaluate(() => window.game.view.orbit.yaw * 180 / Math.PI)
    await page.keyboard.up('KeyQ')
    await page.waitForTimeout(1400)
    const orbitReturnDeg = await page.evaluate(() => window.game.view.orbit.yaw * 180 / Math.PI)

    // Test free isometric mouse click-and-drag orbit (> 40 deg persistent yaw + pitch) + mouse wheel zoom + double-click reset
    const camDistBeforeZoom = await page.evaluate(() => window.game.view.spherical.radius.current)
    await page.mouse.move(640, 360)
    await page.mouse.down({ button: 'left' })
    await page.mouse.move(280, 260, { steps: 12 })
    await page.mouse.up({ button: 'left' })
    await page.waitForTimeout(320)
    const afterMouseDrag = await page.evaluate(() => ({
        dragYawDeg: window.game.view.mouseDragYaw * 180 / Math.PI,
        dragPitchDeg: window.game.view.mouseDragPitch * 180 / Math.PI,
    }))

    // Wheel zoom out (+300 deltaY) and zoom in (-500 deltaY)
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(260)
    const afterWheelOut = await page.evaluate(() => ({
        zoomMultiplier: window.game.view.zoomMultiplier,
        radius: window.game.view.spherical.radius.current,
    }))
    await page.mouse.wheel(0, -500)
    await page.waitForTimeout(260)
    const afterWheelIn = await page.evaluate(() => ({
        zoomMultiplier: window.game.view.zoomMultiplier,
        radius: window.game.view.spherical.radius.current,
    }))

    // Double-click resets mouseDragYaw, mouseDragPitch, and zoomMultiplier to 0 / 1.0
    await page.mouse.dblclick(640, 360)
    await page.waitForTimeout(380)
    const afterDblClickReset = await page.evaluate(() => ({
        dragYawDeg: window.game.view.mouseDragYaw * 180 / Math.PI,
        dragPitchDeg: window.game.view.mouseDragPitch * 180 / Math.PI,
        zoomMultiplier: window.game.view.zoomMultiplier,
    }))

    // Test KeyM (map), Escape (menu), KeyE (cameraOrbitRight ONLY — must NOT increment interactCount)
    await page.keyboard.press('KeyM')
    await page.waitForTimeout(60)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(60)

    const interactBeforeE = await page.evaluate(() => window.game.world.player.interactCount)
    await page.keyboard.down('KeyE')
    await page.waitForTimeout(250)
    const afterE = await page.evaluate(() => ({
        orbitYawDeg: window.game.view.orbit.yaw * 180 / Math.PI,
        interactCount: window.game.world.player.interactCount,
    }))
    await page.keyboard.up('KeyE')
    await page.waitForTimeout(60)

    // Test KeyF (interact) and Enter (interact)
    await page.keyboard.press('KeyF')
    await page.waitForTimeout(60)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)

    const actionSummary = await page.evaluate(() => ({
        actions: [ ...new Set(window.__t2Actions) ],
        interactCount: window.game.world.player.interactCount,
    }))
    await page.close()

    const movedDist = Math.hypot(moveCheck.pos[0] - focusInfo.startPos[0], moveCheck.pos[2] - focusInfo.startPos[2])
    const actionsSet = new Set(actionSummary.actions)
    const keyEOrbitsWithoutInteract = afterE.orbitYawDeg > 2 && afterE.interactCount === interactBeforeE
    const noMouseFocusOutline = focusInfo.outlineStyle === 'none' || focusInfo.outlineWidth === '0px'
    const mouseDragWorked = Math.abs(afterMouseDrag.dragYawDeg) > 40 && Math.abs(afterMouseDrag.dragPitchDeg) > 2
    const wheelZoomWorked = afterWheelOut.radius > camDistBeforeZoom * 1.1 && afterWheelIn.radius < camDistBeforeZoom * 0.95
    const dblClickResetWorked =
        Math.abs(afterDblClickReset.dragYawDeg) < 0.5 &&
        Math.abs(afterDblClickReset.dragPitchDeg) < 0.5 &&
        Math.abs(afterDblClickReset.zoomMultiplier - 1.0) < 0.02

    const pass =
        errors.length === 0 &&
        immediateMovedDist > 0.35 &&
        focusInfo.focused &&
        noMouseFocusOutline &&
        focusInfo.tabindex === '0' &&
        focusInfo.role === 'application' &&
        movedDist > 1.0 &&
        moveCheck.forwardActive &&
        moveCheck.pressedLen <= 2 &&
        !afterBlurImmediate.forwardActive &&
        afterBlurImmediate.pressedLen === 0 &&
        afterBlurDecel.speed < 0.05 &&
        jumpHeight > 0.8 &&
        orbitHeldDeg < -10 &&
        Math.abs(orbitHeldDeg) <= 25.05 &&
        Math.abs(orbitReturnDeg) < 0.5 &&
        mouseDragWorked &&
        wheelZoomWorked &&
        dblClickResetWorked &&
        keyEOrbitsWithoutInteract &&
        actionsSet.has('forward') &&
        actionsSet.has('jump') &&
        actionsSet.has('cameraOrbitLeft') &&
        actionsSet.has('cameraOrbitRight') &&
        actionsSet.has('map') &&
        actionsSet.has('menu') &&
        actionsSet.has('interact') &&
        actionSummary.interactCount >= interactBeforeE + 2

    return {
        pass,
        immediateMovedDistM: +immediateMovedDist.toFixed(3),
        focused: focusInfo.focused,
        noMouseFocusOutline,
        movedDistM: +movedDist.toFixed(3),
        pressedLenWhileHeld: moveCheck.pressedLen,
        blurReleasedImmediately: !afterBlurImmediate.forwardActive && afterBlurImmediate.pressedLen === 0,
        speedAfterBlurMs: +afterBlurDecel.speed.toFixed(4),
        jumpHeightM: +jumpHeight.toFixed(3),
        orbitHeldDeg: +orbitHeldDeg.toFixed(2),
        orbitReturnDeg: +orbitReturnDeg.toFixed(3),
        mouseDragYawDeg: +afterMouseDrag.dragYawDeg.toFixed(2),
        mouseDragPitchDeg: +afterMouseDrag.dragPitchDeg.toFixed(2),
        wheelOutRadiusM: +afterWheelOut.radius.toFixed(3),
        wheelInRadiusM: +afterWheelIn.radius.toFixed(3),
        dblClickResetWorked,
        orbitRightAfterEDeg: +afterE.orbitYawDeg.toFixed(2),
        keyEOrbitsWithoutInteract,
        interactCount: actionSummary.interactCount,
        actions: actionSummary.actions,
        errors,
    }
}

// ---------------------------------------------------------------------------
// Test 3: Gamepad mock (standard mapping)
// Drives joystickLeft, cross, circle, square, joystickRight, start, select
// ---------------------------------------------------------------------------
async function runTest3Gamepad()
{
    const mockScript = `(() => {
        const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }))
        const axes = [ 0, 0, 0, 0 ]
        window.__mockGamepad = {
            id: 'Mock Standard Gamepad (STANDARD GAMEPAD)',
            index: 0,
            connected: true,
            mapping: 'standard',
            timestamp: 0,
            buttons,
            axes,
        }
        window.__gpList = () => [ null, window.__mockGamepad, null ]
        navigator.getGamepads = () => window.__gpList()
    })()`

    const { page, errors } = await openPage(`${base}?expose&webgl`, mockScript)
    await page.waitForTimeout(250)

    const p0 = await page.evaluate(() =>
    {
        window.__gpStarted = new Set()
        window.__gpChanged = new Set()
        window.game.inputs.events.on('actionStart', (a) => window.__gpStarted.add(a.name))
        window.game.inputs.events.on('actionChange', (a) => window.__gpChanged.add(a.name))
        const p = window.game.world.player.object.physical.body.translation()
        return [ p.x, p.y, p.z ]
    })

    // 1) joystickLeft: move forward
    await page.evaluate(() => { window.__mockGamepad.axes[1] = -0.9 })
    await page.waitForTimeout(450)
    const afterStickMove = await page.evaluate(() =>
    {
        const p = window.game.world.player.object.physical.body.translation()
        const stick = window.game.inputs.actions.get('moveStick')
        return {
            pos: [ p.x, p.y, p.z ],
            moveStickActive: stick.active && stick.value.active,
            mode: window.game.inputs.mode,
        }
    })
    // Deadzone test (inside 0.2 -> inactive)
    await page.evaluate(() => { window.__mockGamepad.axes[1] = -0.1 })
    await page.waitForTimeout(120)
    const deadzoneInactive = await page.evaluate(() => !window.game.inputs.actions.get('moveStick').value.active)
    await page.evaluate(() => { window.__mockGamepad.axes[1] = 0 })
    await page.waitForTimeout(300)

    // 2) cross (button 0 -> jump) + circle (button 1 -> stamp while airborne)
    const baseY = await page.evaluate(() =>
    {
        window.__gpMaxY = window.game.world.player.object.physical.body.translation().y
        window.__gpPoll = setInterval(() =>
        {
            const y = window.game.world.player.object.physical.body.translation().y
            if(y > window.__gpMaxY) window.__gpMaxY = y
        }, 16)
        return window.__gpMaxY
    })
    await page.evaluate(() => { window.__mockGamepad.buttons[0] = { pressed: true, touched: true, value: 1 } })
    await page.waitForTimeout(260)
    await page.evaluate(() => { window.__mockGamepad.buttons[1] = { pressed: true, touched: true, value: 1 } })
    await page.waitForTimeout(120)
    await page.evaluate(() =>
    {
        window.__mockGamepad.buttons[0] = { pressed: false, touched: false, value: 0 }
        window.__mockGamepad.buttons[1] = { pressed: false, touched: false, value: 0 }
    })
    await page.waitForTimeout(600)
    const jumpStamp = await page.evaluate(() =>
    {
        clearInterval(window.__gpPoll)
        return {
            maxY: window.__gpMaxY,
            stampCount: window.game.world.player.controller.stamp.count,
        }
    })

    // 3) square (button 2 -> interact), start (button 9 -> menu), select (button 8 -> map)
    for(const idx of [ 2, 9, 8 ])
    {
        await page.evaluate((i) => { window.__mockGamepad.buttons[i] = { pressed: true, touched: true, value: 1 } }, idx)
        await page.waitForTimeout(80)
        await page.evaluate((i) => { window.__mockGamepad.buttons[i] = { pressed: false, touched: false, value: 0 } }, idx)
        await page.waitForTimeout(80)
    }

    // 4) joystickRight: orbit yaw (+X) & pitch (+Y), clamp to +-25 / +-8 deg, spring back to 0
    await page.evaluate(() => { window.__mockGamepad.axes[2] = 0.95; window.__mockGamepad.axes[3] = 0.95 })
    await page.waitForTimeout(700)
    const orbitHeld = await page.evaluate(() => ({
        yawDeg: window.game.view.orbit.yaw * 180 / Math.PI,
        pitchDeg: window.game.view.orbit.pitch * 180 / Math.PI,
        stickActive: window.game.inputs.actions.get('cameraOrbitStick').active,
    }))
    await page.evaluate(() => { window.__mockGamepad.axes[2] = 0; window.__mockGamepad.axes[3] = 0 })
    await page.waitForTimeout(1400)
    const orbitReturned = await page.evaluate(() => ({
        yawDeg: window.game.view.orbit.yaw * 180 / Math.PI,
        pitchDeg: window.game.view.orbit.pitch * 180 / Math.PI,
    }))

    // 5) Disconnect safety: hold start then disconnect -> menu must release
    await page.evaluate(() => { window.__mockGamepad.buttons[9] = { pressed: true, touched: true, value: 1 } })
    await page.waitForTimeout(80)
    const menuHeldBeforeDisconnect = await page.evaluate(() => window.game.inputs.actions.get('menu').active)
    await page.evaluate(() => { window.__mockGamepad = null })
    await page.waitForTimeout(80)
    const menuAfterDisconnect = await page.evaluate(() => window.game.inputs.actions.get('menu').active)

    const summary = await page.evaluate(() => ({
        started: [ ...window.__gpStarted ],
        changed: [ ...window.__gpChanged ],
        interactCount: window.game.world.player.interactCount,
    }))
    await page.close()

    const movedDist = Math.hypot(afterStickMove.pos[0] - p0[0], afterStickMove.pos[2] - p0[2])
    const jumpHeight = jumpStamp.maxY - baseY
    const started = new Set(summary.started)
    const changed = new Set(summary.changed)
    const pass =
        errors.length === 0 &&
        afterStickMove.moveStickActive &&
        afterStickMove.mode === 2 &&
        movedDist > 1.0 &&
        deadzoneInactive &&
        jumpHeight > 0.6 &&
        jumpStamp.stampCount >= 1 &&
        started.has('jump') &&
        started.has('stamp') &&
        started.has('interact') &&
        started.has('menu') &&
        started.has('map') &&
        changed.has('moveStick') &&
        changed.has('cameraOrbitStick') &&
        summary.interactCount >= 1 &&
        orbitHeld.stickActive &&
        orbitHeld.yawDeg > 10 && orbitHeld.yawDeg <= 25.05 &&
        orbitHeld.pitchDeg > 3 && orbitHeld.pitchDeg <= 8.05 &&
        Math.abs(orbitReturned.yawDeg) < 0.5 &&
        Math.abs(orbitReturned.pitchDeg) < 0.5 &&
        menuHeldBeforeDisconnect &&
        !menuAfterDisconnect

    return {
        pass,
        movedDistM: +movedDist.toFixed(3),
        deadzoneInactive,
        jumpHeightM: +jumpHeight.toFixed(3),
        stampCount: jumpStamp.stampCount,
        interactCount: summary.interactCount,
        orbitHeldYawDeg: +orbitHeld.yawDeg.toFixed(2),
        orbitHeldPitchDeg: +orbitHeld.pitchDeg.toFixed(2),
        orbitReturnedYawDeg: +orbitReturned.yawDeg.toFixed(3),
        orbitReturnedPitchDeg: +orbitReturned.pitchDeg.toFixed(3),
        disconnectReleasedMenu: menuHeldBeforeDisconnect && !menuAfterDisconnect,
        started: summary.started,
        changed: summary.changed,
        errors,
    }
}

// ---------------------------------------------------------------------------
// Test 4: Greybox keyboard ghost traversal + 3x determinism
// ---------------------------------------------------------------------------
async function runTest4GhostDeterminism()
{
    const ghostPath = resolve(`tools/capture/ghosts/${ghostName}.json`)
    const ghostData = JSON.parse(readFileSync(ghostPath, 'utf8'))
    const usedActions = [ ...new Set(ghostData.events.map((e) => e.action)) ]
    const onlyKeyboardActions = usedActions.every((a) => ALLOWED_GHOST_ACTIONS.has(a))

    const flatten = (snap) => snap.bodies.flatMap((b) => [ ...b.p, ...b.q ])
    const maxDelta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))

    const runs = []
    for(let i = 0; i < 3; i++)
    {
        const { page, errors } = await openPage(`${base}?expose&webgl&ghost=${ghostName}`)
        await page.waitForFunction(() => window.__ghost?.finished === true, null, { timeout: 120000, polling: 100 })
        const info = await page.evaluate(() =>
        {
            const p = window.game.world.player.object.physical.body.translation()
            const c = window.game.world.player.controller
            return {
                result: window.__ghost.result,
                pos: [ p.x, p.y, p.z ],
                grounded: c.grounded,
                stamps: c.stamp.count,
                broken: c.stamp.broken,
                canvasFocused: document.activeElement === document.querySelector('.js-canvas'),
            }
        })
        await page.close()
        runs.push({ ...info, flat: flatten(info.result), errors })
    }

    const ref = runs[0].flat
    const worstM = Math.max(...runs.map((r) => maxDelta(ref, r.flat)))
    const worstMm = worstM * 1000
    const finalPos = runs[0].pos
    const pass =
        onlyKeyboardActions &&
        runs.every((r) => r.errors.length === 0) &&
        finalPos[2] <= -30 &&
        finalPos[1] > 0 &&
        runs[0].grounded &&
        worstM <= 0.001

    return {
        pass,
        ghost: ghostName,
        steps: runs[0].result.step,
        events: ghostData.events.length,
        usedActions,
        onlyKeyboardActions,
        finalPos: finalPos.map((v) => +v.toFixed(4)),
        grounded: runs[0].grounded,
        stamps: runs[0].stamps,
        brokenCrates: runs[0].broken,
        replayedWithoutCanvasFocus: runs.every((r) => !r.canvasFocused),
        maxDeltaMm: +worstMm.toFixed(6),
    }
}

// ---------------------------------------------------------------------------
// Run all 4 tests
// ---------------------------------------------------------------------------
const results = {
    test1FocusGating: await runTest1FocusGating(),
    test2CanvasKeyboard: await runTest2CanvasKeyboard(),
    test3Gamepad: await runTest3Gamepad(),
    test4GhostDeterminism: await runTest4GhostDeterminism(),
    totalErrors: allErrors.length,
    errors: allErrors,
}
results.pass =
    results.test1FocusGating.pass &&
    results.test2CanvasKeyboard.pass &&
    results.test3Gamepad.pass &&
    results.test4GhostDeterminism.pass &&
    allErrors.length === 0

console.log(JSON.stringify(results, null, 2))
await browser.close()
killServer()
process.exit(results.pass ? 0 : 1)
