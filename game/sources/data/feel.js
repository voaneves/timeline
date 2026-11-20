// Feel tunables (docs/PLAN-3D.md 3.2). Initial values; the final ones are committed here (plan 3.5).
// All times are REAL seconds counted in fixed steps (Ticker.FIXED_DELTA = 1/120 s), all speeds are m/s, angles are
// degrees unless the key says otherwise. The player simulation never reads Time.scale or the frame delta.
//
// Live-tunable in `?debug` (Tweakpane folder "Feel", only created when the debug panel is active). The object is
// mutable on purpose: the controller reads it every step. FEEL_DEFAULTS is a frozen copy for "reset".
export const feel = {
    move: {
        walkSpeed: 3.0, // stick < walkThreshold
        runSpeed: 7.0,
        walkThreshold: 0.5, // input magnitude (0..1) from which the player runs
        keyboardMagnitude: 1, // digital keys count as this deflection (1 = run, as in the plan; < 0.5 = walk)
        accelTime: 0.14, // 0 -> runSpeed on the ground
        accelHalfTime: 0.05, // time to reach 50% of runSpeed (shapes the ease-out: exponent = ln 0.5 / ln(1 - half / time))
        decelTime: 0.10, // runSpeed -> 0 on the ground (linear)
        groundFriction: 60, // m/s^2 removed from the velocity component perpendicular to the wanted direction
        stopSpeed: 0.001, // below this the velocity snaps to zero
    },
    air: {
        accel: 26, // m/s^2 toward the wanted velocity
        decel: 8, // m/s^2 with no input
    },
    turn: {
        yawRate: 900, // deg/s, body yaw slerp toward the heading
        leanMax: 12, // deg, bank into the turn
        leanGain: 1, // 1 = physical bank angle atan(v * yawRate / g)
        leanSmoothing: 15, // 1/s, low-pass on the lean angle
    },
    skid: {
        angle: 135, // reversing by more than this...
        minSpeed: 4.5, // ...above this speed...
        duration: 0.12, // ...brakes for this long ignoring the input (event 'skid' for dust + sound)
    },
    gravity: {
        fall: 58.8, // m/s^2 (1.7 x the 34.6 of the rise, plan 3.2)
        terminal: 20, // m/s
    },
    body: {
        radius: 0.28, // capsule: total height = 2 * halfHeight + 2 * radius = 1.2 m (greybox stand-in)
        halfHeight: 0.32,
        fallLimit: - 1.0, // body centre below this => respawn (before Objects' own reset at water.depthElevation)
    },
    kcc: {
        offset: 0.02,
        maxSlopeClimbAngle: 50, // deg
        minSlopeSlideAngle: 55, // deg
        autostepHeight: 0.35,
        autostepMinWidth: 0.15,
        autostepDynamic: true,
        snapToGround: 0.3,
        characterMass: 60,
        applyImpulsesToDynamicBodies: true,
    },
}

const clone = (value) => JSON.parse(JSON.stringify(value))

export const FEEL_DEFAULTS = Object.freeze(clone(feel))

export function resetFeel()
{
    const defaults = clone(FEEL_DEFAULTS)
    for(const group in defaults)
        Object.assign(feel[group], defaults[group])
}

export default feel
