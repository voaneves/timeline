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
        slopeCompensation: 1, // 0..1: scales the wanted horizontal move by 1/cos(slope) (KCC projects it onto the slope): 1 = keeps cos(slope) of the flat speed (~87% at 30 deg)
        slopeMaxAngle: 40, // deg, measured uphill angles above this are ignored (autostep spikes)
        slopeMaxFactor: 1.3, // clamp of the 1/cos factor
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
    // Jump (plan 3.2): gravity while rising g = 2 h / t^2 (34.6 m/s^2), takeoff speed v0 = 2 h / t (11.8 m/s)
    jump: {
        height: 2.0, // m, apex of a held jump
        apexTime: 0.34, // s to the apex
        fallMultiplier: 1.7, // gravity while falling = 1.7 x the rise gravity (58.8 m/s^2)
        terminal: 20, // m/s
        cutSpeed: 4.5, // releasing while rising caps vy to this (applied once the minimum height is reached)
        minHeight: 0.55, // m, a tap still rises this much (the cut waits for it)
        coyoteTime: 0.10, // s after leaving the ground a jump is still allowed
        bufferTime: 0.12, // s a press before landing is remembered
    },
    // Ribbon glide ("flutter"): 2nd press in the air. NOT a spin double jump.
    glide: {
        impulseHeight: 0.6, // m: vy = max(vy, sqrt(2 g_rise h))
        gravityScale: 0.35, // x gravity while gliding
        maxTime: 0.6, // s of reduced gravity
        requireHold: true, // the reduced gravity lasts while the jump button is held
        minHeight: 0.8, // m above the ground needed to start a glide (below it the press is a buffered jump)
    },
    // Stamp (plan 3.2): in the air, lock, then dive straight down; the impact breaks the crates and emits 'stamp'
    stamp: {
        lockTime: 0.12, // s hanging in the air before the dive
        diveSpeed: 26, // m/s straight down
        minHeight: 0.6, // m above the ground needed to start a stamp (below it the press does nothing)
        breakRadius: 1.0, // m (horizontal, centre to centre) around the impact that breaks crates
        breakDepth: 1.2, // m below the stamped surface still counted
        breakHeight: 0.8, // m above the stamped surface still counted
        ringLife: 1.5, // s the ring mark stays visible (visual only)
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
