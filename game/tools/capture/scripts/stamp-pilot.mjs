// T1.4: closed-loop pilot injected into the page (evaluated by t14-stamp.mjs --record). It runs the greybox to the crates, jumps
// and stamps onto the first crate through the same Inputs actions as the keyboard (applyAction at fixedTick order 1) while
// `?ghost=rec` records them. The recorded ghost (tools/capture/ghosts/stamp.json) is then replayed open-loop.
// Camera-relative keys: the wanted world direction is mapped through the view azimuth (spherical.theta) like the Player does.
export default async function pilot(cfg) {
    const g = window.game
    const body = g.world.player.object.physical.body
    const c = g.world.player.controller
    const A = (name, value) => g.inputs.applyAction(name, value ? 'start' : 'end', value ? 1 : 0, true)
    const held = { forward: false, backward: false, left: false, right: false, jump: false, stamp: false }
    const set = (name, on) => { if(held[name] !== on) { held[name] = on; A(name, on) } }
    let phase = 0, jumpStep = 0, doneStep = 0, done = false
    const log = []
    g.ticker.events.on('fixedTick', () => {
        if(done) return
        const step = g.ghost.step
        const t = body.translation()
        let target = cfg.waypoints[Math.min(phase, cfg.waypoints.length - 1)]
        if(phase === 0 && Math.hypot(target.x - t.x, target.z - t.z) < target.tol) phase = 1
        if(phase === 1 && t.z <= cfg.jumpZ && c.grounded) { phase = 2; jumpStep = step; set('jump', true) }
        if(phase === 2 && step - jumpStep >= cfg.stampDelay) { phase = 3; set('stamp', true); doneStep = step }
        if(phase === 3 && step - doneStep >= 6) { set('stamp', false); set('jump', false); phase = 4 }
        if(phase === 4 && c.grounded && step - doneStep > 40) { phase = 5; doneStep = step }
        if(phase === 5 && step - doneStep > 60) { done = true; return }
        target = cfg.waypoints[Math.min(phase, cfg.waypoints.length - 1)]
        if(step % 60 === 0) log.push([step, +t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2), phase])
        let wantX = 0, wantZ = 0
        if(phase <= 3) { wantX = target.x - t.x; wantZ = target.z - t.z }
        const len = Math.hypot(wantX, wantZ)
        let f = 0, r = 0
        if(len > 0.05 && phase <= 3) {
            const th = g.view.spherical.theta
            f = (wantX * -Math.sin(th) + wantZ * -Math.cos(th)) / len
            r = (wantX * Math.cos(th) + wantZ * -Math.sin(th)) / len
        }
        set('forward', f > 0.38); set('backward', f < -0.38); set('right', r > 0.38); set('left', r < -0.38)
    }, 1)
    while(!done) await new Promise((r) => setTimeout(r, 100))
    for(const n of Object.keys(held)) set(n, false)
    const ghost = g.ghost.stop()
    return { log, ghost: { ...ghost, steps: ghost.steps + 60 }, broken: c.stamp.broken }
}
