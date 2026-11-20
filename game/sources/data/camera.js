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
    halfLifeXZ: 0.10, // critical spring on the followed position (x, z)
    halfLifeY: 0.25, // critical spring on y
    fallFollow: 1, // y only follows in the air once the subject is this far below the last platform
    lookAhead: 1.5, // metres at full speed
    lookAheadSpeed: 7, // m/s that counts as "full speed" (run speed)
    lookAheadHalfLife: 0.35,
    snapDistance: 20, // a jump bigger than this (respawn) teleports the camera instead of gliding
    maxDelta: 0.1, // frame delta clamp for the smoothing
}
