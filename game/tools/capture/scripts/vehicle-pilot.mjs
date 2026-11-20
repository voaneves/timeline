// T1.10: closed-loop pilot injected into the page (a function, evaluated in the page by t110-vehicle.mjs). Steers the vehicle to a list of
// waypoints through the same Inputs actions as the keyboard (applyAction at fixedTick order 1, i.e. before the vehicle's
// step at order 2: identical to what the ghost replay does at the start of a step) while `?ghost=rec` records them.
export const WAYPOINTS = [
    // { x, z, boost, tol, max (m/s, optional), rev (reverse straight) }
    { x: 0, z: 3.5, rev: true, tol: 0.4 },
    { x: 2.5, z: -0.5, tol: 0.7, max: 8, boost: true },
    { x: 2.5, z: -5.5, tol: 1, boost: true },
    { x: 1.5, z: -13, tol: 1.2, boost: true },
    { x: 2.6, z: -22, tol: 1.2, boost: true },
    { x: 2.2, z: -33, tol: 1.5, boost: true }, // lands past the 4 m gap
]
export default async function pilot(WAYPOINTS) {
    const g = window.game
    const v = g.world.vehicle
    const A = (name, value) => g.inputs.applyAction(name, value ? 'start' : 'end', value ? 1 : 0, true)
    const held = { forward: false, backward: false, left: false, right: false, run: false }
    const set = (name, on) => { if(held[name] !== on) { held[name] = on; A(name, on) } }
    const log = []
    let i = 0, sinceWp = 0, done = false
    const wpLog = []
    g.ticker.events.on('fixedTick', () => {
        if(done) return
        const step = g.ghost.step
        const t = v.body.translation()
        const q = v.body.rotation()
        const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y)
        const w = WAYPOINTS[i]
        sinceWp++
        if(step % 120 === 0) log.push([step / 120, +t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2), +v.speed.toFixed(1), v.resets])
        if(w)
        {
            const dx = w.x - t.x, dz = w.z - t.z
            if(Math.hypot(dx, dz) < w.tol || (!w.rev && t.z < w.z && Math.abs(dz) > 1) || (w.rev && t.z > w.z)) { wpLog.push({ wp: i, step, x: +t.x.toFixed(2), y: +t.y.toFixed(2), z: +t.z.toFixed(2) }); i++; sinceWp = 0 }
            else if(sinceWp > 120 * 8) { wpLog.push({ wp: i, step, timeout: true, x: +t.x.toFixed(2), y: +t.y.toFixed(2), z: +t.z.toFixed(2) }); i++; sinceWp = 0 }
        }
        const target = WAYPOINTS[i]
        if(!target) { done = true; return }
        if(target.rev && v.speed < -3) {} 
        const dx = target.x - t.x, dz = target.z - t.z
        const err = Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz) // + = target on the left
        const max = target.max ?? (target.boost ? 99 : 8)
        set('forward', !target.rev && v.speed < max)
        set('backward', !!target.rev || v.speed > max + 2)
        set('run', !!target.boost)
        set('left', !target.rev && err > 0.07)
        set('right', !target.rev && err < -0.07)
    }, 1)
    while(!done) await new Promise((r) => setTimeout(r, 200))
    // hold a short rest then export
    for(const n of Object.keys(held)) set(n, false)
    await new Promise((r) => setTimeout(r, 800))
    const ghost = g.ghost.stop()
    return { log, wpLog, ghost: { ...ghost, steps: ghost.steps + 60 } }
}
