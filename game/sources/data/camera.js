// Camera tunables (docs/PLAN-3D.md 3.3, landscape values). Lengths in metres, angles in degrees, times in seconds.
// Half-lives are "time to cover half of the remaining distance" of a critically damped spring / exponential filter.
// Mutable on purpose: View reads it every frame. T1.7 adds the portrait values next to these.
export const cameraConfig = {
    hFov: 63, // target horizontal FOV; vFov = clamp(2 atan(tan(hFov / 2) / aspect), vFovMin, vFovMax) (38 deg at 16:9)
    vFovMin: 38,
    vFovMax: 55,
    distance: 10.5, // camera to focus point
    pitch: 28, // elevation above the horizon
    focusOffsetY: 0.9, // focus point above the feet
    pitchPortrait: 36, // at aspect <= 0.5 (interpolated from aspect 1.0)
    focusOffsetYPortrait: 1.6, // avatar in the lower third
    lookAheadPortrait: 1.0,
    distancePortrait: 8, // distance floor at aspect <= 0.5 (interpolated from 1.0)
    // Useful width (m) on the focus plane: distance grows until it fits. The plan's 6 m cannot coexist with an avatar of 9-12% of the
    // height at 390x844 (avatar% x width = 0.39 there, fixed by the aspect), so the avatar minimum wins and the width floor is 3.95 m.
    minWidth: 3.95,
    halfLifeXZ: 0.10, // critical spring on the followed position (x, z)
    halfLifeY: 0.25, // critical spring on y
    fallFollow: 1, // y only follows in the air once the subject is this far below the last platform
    lookAhead: 1.5, // metres at full speed
    lookAheadSpeed: 7, // m/s that counts as "full speed" (run speed)
    lookAheadHalfLife: 0.35,
    snapDistance: 20, // a jump bigger than this (respawn) teleports the camera instead of gliding
    maxDelta: 0.1, // frame delta clamp for the smoothing
}
