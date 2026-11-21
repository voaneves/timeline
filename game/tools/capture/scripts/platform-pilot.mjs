// T1.5: closed-loop pilot injected into the page (evaluated by t15-platform.mjs --record).
// Walks/jumps along the greybox to the moving platform, boards it cleanly, stands idle for >= 10.5 s
// (across multiple travel/pause/reversal cycles), then jumps straight up at full platform speed (2.0 m/s)
// and lands back on the platform. All inputs go through Inputs.applyAction so `?ghost=rec` records
// an exact open-loop ghost (`tools/capture/ghosts/platform.json`).
export default async function pilot(cfg = {}) {
    const g = window.game
    const body = g.world.player.object.physical.body
    const c = g.world.player.controller
    const plat = g.world.movingPlatform
    const A = (name, value) => g.inputs.applyAction(name, value ? 'start' : 'end', value ? 1 : 0, true)
    const held = { forward: false, backward: false, left: false, right: false, jump: false }
    const set = (name, on) => { if(held[name] !== on) { held[name] = on; A(name, on) } }
    const clearMove = () => { set('forward', false); set('backward', false); set('left', false); set('right', false) }

    const idleSteps = cfg.idleSteps ?? 1280 // ~10.67 s (> 10 s across full cycle + reversals)
    const waypoints = [
        { x: 0.0, z: -13.0, tol: 0.6 },
        { x: 2.6, z: -15.5, tol: 0.6 },
        { x: 2.6, z: -20.5, tol: 0.6 },
        { x: 0.0, z: -23.0, tol: 0.6 },
    ]

    let wp = 0
    // Phases:
    //   0: navigate waypoints to gap approach
    //   1: run straight toward -Z and jump the 4 m gap (z = -25 -> -29)
    //   2: move to staging spot on landing slab (0, -38.2)
    //   3: wait for platform near refPlatformPath1 (z > -40.8) and board onto platform centre
    //   4: settle to zero velocity on platform
    //   5: stand completely idle on platform for `idleSteps`
    //   6: wait for platform full speed near middle of travel, then jump straight up
    //   7: wait for jump hold + clean landing back on platform + post-land settle
    let phase = 0
    let jumpStep = 0
    let idleStart = 0
    let platJumpStep = 0
    let landStep = 0
    let done = false
    const log = []

    const steerToward = (tx, tz, deadzone = 0.05) => {
        const t = body.translation()
        const wantX = tx - t.x
        const wantZ = tz - t.z
        const len = Math.hypot(wantX, wantZ)
        if(len <= deadzone) {
            clearMove()
            return len
        }
        const th = g.view.spherical.theta
        const f = (wantX * -Math.sin(th) + wantZ * -Math.cos(th)) / len
        const r = (wantX * Math.cos(th) + wantZ * -Math.sin(th)) / len
        set('forward', f > 0.38)
        set('backward', f < -0.38)
        set('right', r > 0.38)
        set('left', r < -0.38)
        return len
    }

    g.ticker.events.on('fixedTick', () => {
        if(done) return
        const step = g.ghost.step
        const t = body.translation()
        const pt = plat.body.translation()

        if(step % 120 === 0)
            log.push([step, phase, +t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2), +pt.z.toFixed(2), +plat.velocity.z.toFixed(2), c.grounded, Boolean(c.groundPlatform)])

        if(phase === 0) {
            const target = waypoints[wp]
            const dist = steerToward(target.x, target.z)
            if(dist < target.tol) {
                wp++
                if(wp >= waypoints.length) phase = 1
            }
        }
        else if(phase === 1) {
            steerToward(0, -32)
            if(t.z <= -24.5 && c.grounded && jumpStep === 0) {
                jumpStep = step
                set('jump', true)
            }
            if(jumpStep > 0 && step - jumpStep >= 55) set('jump', false)
            if(t.z < -29.5 && c.grounded) {
                set('jump', false)
                phase = 2
            }
        }
        else if(phase === 2) {
            const dist = steerToward(0, -38.1, 0.12)
            if(dist < 0.25 && Math.hypot(c.velocity.x, c.velocity.z) < 0.2) {
                clearMove()
                phase = 3
            }
        }
        else if(phase === 3) {
            // Wait until the platform is near refPlatformPath1 (-40.6) and either paused or moving away slowly enough to board
            if(!c.groundPlatform && pt.z < -41.0) {
                clearMove()
            } else {
                const dist = steerToward(pt.x, pt.z, 0.08)
                if(c.grounded && c.groundPlatform === plat && dist < 0.35) {
                    clearMove()
                    phase = 4
                }
            }
        }
        else if(phase === 4) {
            clearMove()
            if(c.grounded && c.groundPlatform === plat && Math.hypot(c.velocity.x, c.velocity.z) < 1e-4) {
                idleStart = step
                phase = 5
            }
        }
        else if(phase === 5) {
            clearMove()
            if(step - idleStart >= idleSteps) phase = 6
        }
        else if(phase === 6) {
            clearMove()
            // Jump straight up when platform is moving at full speed (2.0 m/s) in the middle of its path
            // so it continues at full speed through takeoff, apex, and landing (~0.6 s = 1.2 m travel)
            const fullSpeed = Math.abs(plat.velocity.z) >= 1.99
            const movingNeg = plat.velocity.z < -1.99 && pt.z < -41.5 && pt.z > -45.5
            const movingPos = plat.velocity.z > 1.99 && pt.z > -46.5 && pt.z < -42.5
            if(fullSpeed && (movingNeg || movingPos) && c.grounded && c.groundPlatform === plat) {
                platJumpStep = step
                set('jump', true)
                phase = 7
            }
        }
        else if(phase === 7) {
            clearMove()
            if(step - platJumpStep >= 45) set('jump', false)
            if(landStep === 0 && step - platJumpStep > 20 && c.grounded) landStep = step
            if(landStep > 0 && step - landStep >= 60) {
                set('jump', false)
                done = true
            }
        }

        // Safety timeout (35 s)
        if(step > 4200) {
            clearMove()
            set('jump', false)
            done = true
        }
    }, 1)

    while(!done) await new Promise((r) => setTimeout(r, 100))
    for(const n of Object.keys(held)) set(n, false)
    const ghost = g.ghost.stop()
    return {
        log,
        phase,
        idleStart,
        platJumpStep,
        landStep,
        ghost: { ...ghost, steps: ghost.steps + 30 },
    }
}
