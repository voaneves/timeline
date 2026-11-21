import * as THREE from 'three/webgpu'
import CameraControls from 'camera-controls'
import { Game } from './Game.js'
import { clamp, lerp, remap, smallestAngle, smoothstep } from './utilities/maths.js'
import { mix, uniform, vec4, Fn, positionGeometry, attribute } from 'three/tsl'
import gsap from 'gsap'
import { Pointer } from './Inputs/Pointer.js'
import { Inputs } from './Inputs/Inputs.js'
import { alea } from 'seedrandom'
import { cameraConfig } from '../data/camera.js'

CameraControls.install( { THREE: THREE } )

const rng = new alea('speedLines')

const DEG = Math.PI / 180
const LN2_4 = 4 * Math.LN2

// Critically damped spring toward `goal` (exact integration, frame-rate independent). `state` = { x, v }.
function springStep(state, goal, halfLife, dt)
{
    const y = LN2_4 / halfLife / 2
    const x = state.x - goal
    const j1 = state.v + x * y
    const e = Math.exp(- y * dt)
    state.x = goal + e * (x + j1 * dt)
    state.v = e * (state.v - j1 * y * dt)
}

export class View
{
    static MODE_DEFAULT = 1
    static MODE_FREE = 2

    constructor(idealRatio = 1920 / 1080)
    {
        this.game = Game.getInstance()
        
        this.mode = View.MODE_DEFAULT
        this.position = new THREE.Vector3()
        this.delta = new THREE.Vector3()
        this.idealRatio = idealRatio
        this.ratioOverflow = Math.max(1, this.idealRatio / this.game.viewport.ratio) - 1

        if(this.game.debug.active)
        {
            this.debugPanel = this.game.debug.panel.addFolder({
                title: '🎥 View',
                expanded: false,
            })

            this.debugPanel.addBinding(
                this,
                'mode',
                {
                    options:
                    {
                        default: View.MODE_DEFAULT,
                        free: View.MODE_FREE,
                    }
                }
            ).on('change', () => 
            {
                this.setMode(this.mode)
            })
        }

        this.setFraming()
        this.setFocusPoint()
        this.setZoom()
        this.setSpherical()
        this.setManualOrbit()
        this.setRoll()
        this.setCameras()
        this.setOptimalArea()
        this.setFree()
        this.setCinematic()
        this.setSpeedLines()
        this.setMapControls()

        // Control yaw: computed on the fixed step only (before the Player at 2), so the camera-relative input is
        // deterministic. Only the rendering reads the per-frame smoothed state.
        this.game.ticker.events.on('fixedTick', () =>
        {
            this.fixedUpdate()
        }, 1)

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 7)

        this.update()

        this.game.viewport.events.on('change', () =>
        {
            this.resize()
        })

        this.game.viewport.events.on('throttleChange', () =>
        {
            this.throttleResize()
        }, 1)

        // Toggle
        if(this.game.debug.active)
        {
            this.game.inputs.addActions([
                { name: 'viewToggle', categories: [], keys: [ 'Keyboard.KeyV' ] }
            ])

            this.game.inputs.events.on('viewToggle', (action) =>
            {
                if(action.active)
                {
                    this.toggleMode()
                }
            })
        }
    }

    toggleMode()
    {
        this.setMode(this.mode === View.MODE_FREE ? View.MODE_DEFAULT : View.MODE_FREE)
    }

    setMode(mode)
    {
        this.mode = mode

        this.focusPoint.smoothedPosition.copy(this.focusPoint.position)

        this.freeMode.enabled = this.mode === View.MODE_FREE
        this.freeMode.setTarget(this.focusPoint.position.x, this.focusPoint.position.y, this.focusPoint.position.z)
        this.freeMode.setPosition(this.camera.position.x, this.camera.position.y, this.camera.position.z)
    }

    // Landscape framing (T1.6): vFov follows the target horizontal FOV; distance and pitch are the landscape values
    setFraming()
    {
        const cfg = cameraConfig
        this.framing = {}
        this.framing.computeVFov = (aspect) => clamp(2 * Math.atan(Math.tan(cfg.hFov * DEG / 2) / aspect) / DEG, cfg.vFovMin, cfg.vFovMax)

        // Aspect-reactive framing (T1.7): landscape values at aspect >= 1, portrait values at aspect <= 0.5, interpolated between
        this.framing.apply = (aspect) =>
        {
            if(!(aspect > 0) || !Number.isFinite(aspect))
                return
            const portrait = clamp((1 - aspect) / 0.5, 0, 1)
            const vFov = this.framing.computeVFov(aspect)
            const hFovEff = 2 * Math.atan(Math.tan(vFov * DEG / 2) * aspect)
            this.framing.vFov = vFov
            this.framing.distance = Math.max(lerp(cfg.distance, cfg.distancePortrait, portrait), cfg.minWidth / (2 * Math.tan(hFovEff / 2)))
            this.framing.phi = (90 - lerp(cfg.pitch, cfg.pitchPortrait, portrait)) * DEG
            this.framing.focusOffsetY = lerp(cfg.focusOffsetY, cfg.focusOffsetYPortrait, portrait)
            this.framing.lookAhead = lerp(cfg.lookAhead, cfg.lookAheadPortrait, portrait)
            if(this.spherical?.radius)
            {
                this.spherical.phi = this.framing.phi
                this.spherical.radius.edges.min = this.framing.distance
                this.spherical.radius.edges.max = this.framing.distance
                this.spherical.radius.current = this.framing.distance
            }
        }
        this.framing.apply(this.game.viewport.ratio)

        this.controlYaw = Math.PI * 0.25 // what the Player reads (through spherical.theta); changes on the fixed step only
        this.controlYawPrevious = this.controlYaw

        // Smoothed follow state (render only)
        this.follow = {
            initialized: false,
            hasSubject: false,
            x: { x: 0, v: 0 },
            y: { x: 0, v: 0 },
            z: { x: 0, v: 0 },
            lockedY: 0,
            fallFollowing: false,
            lastX: 0,
            lastZ: 0,
            ahead: new THREE.Vector2(),
            velocity: new THREE.Vector2(),
        }
    }

    // The followed thing: the on-foot player or the vehicle (both expose `model` and `object.physical.body`)
    getSubject()
    {
        return this.game.world?.player ?? this.game.world?.vehicle ?? null
    }

    // Authored yaw blend between refCamera1 and refCamera2 (empties with the custom prop `lookAt`), by progress along
    // the segment lookAt1 -> lookAt2 on the ground plane. Returns null while the references are not loaded.
    getAuthoredYaw(x, z)
    {
        if(!this.authored)
        {
            const references = this.game.world?.references
            const a = references?.get('refCamera1')
            const b = references?.get('refCamera2')
            if(!a || !b || !a.userData.lookAt || !b.userData.lookAt)
                return null

            const make = (reference) =>
            {
                const lookAt = reference.userData.lookAt
                // Offset from the target to the camera is (sin theta, cos theta) on x, z (spherical coordinates)
                return { yaw: Math.atan2(reference.position.x - lookAt[0], reference.position.z - lookAt[2]), x: lookAt[0], z: lookAt[2] }
            }
            this.authored = { a: make(a), b: make(b) }
        }

        const { a, b } = this.authored
        const dx = b.x - a.x
        const dz = b.z - a.z
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1)
        const s = t * t * (3 - 2 * t)
        return a.yaw + smallestAngle(a.yaw, b.yaw) * s
    }

    // Fixed step: control yaw from the SIMULATED position (rigid body), never from the interpolated visual or the frame delta
    fixedUpdate()
    {
        this.updateManualOrbit(this.game.ticker.fixedDelta)

        let x = 0
        let z = 0
        const body = this.getSubject()?.object?.physical?.body
        if(body)
        {
            const translation = body.translation()
            x = translation.x
            z = translation.z
        }
        else
        {
            x = this.focusPoint.trackedPosition.x
            z = this.focusPoint.trackedPosition.z
        }

        const yaw = this.getAuthoredYaw(x, z)
        if(yaw === null)
            return

        this.controlYawPrevious = this.controlYaw
        this.controlYaw = yaw
        this.spherical.theta = yaw
    }

    // Per frame: focus point (critical springs, y locked in the air, look-ahead). Writes focusPoint.smoothedPosition/position.
    updateFollow(delta)
    {
        const cfg = cameraConfig
        const follow = this.follow
        const subject = this.getSubject()
        const source = subject?.model?.position ?? this.focusPoint.trackedPosition
        const grounded = subject?.controller?.grounded ?? true

        // Y lock: only follows while grounded, or once it fell more than `fallFollow` below the last platform
        if(!follow.initialized || (subject && !follow.hasSubject) || grounded)
        {
            follow.lockedY = source.y
            follow.fallFollowing = false
        }
        else if(source.y < follow.lockedY - cfg.fallFollow)
        {
            follow.fallFollowing = true
        }
        const targetY = follow.fallFollowing ? source.y : follow.lockedY

        // Velocity (frame based, render only) -> look-ahead
        const k = 1 - Math.pow(0.5, delta / cfg.lookAheadHalfLife)
        if(delta > 0 && follow.initialized)
        {
            follow.velocity.x += ((source.x - follow.lastX) / delta - follow.velocity.x) * k
            follow.velocity.y += ((source.z - follow.lastZ) / delta - follow.velocity.y) * k
        }
        follow.lastX = source.x
        follow.lastZ = source.z

        const speed = follow.velocity.length()
        const scale = speed > 1e-4 ? this.framing.lookAhead * Math.min(speed / cfg.lookAheadSpeed, 1) / speed : 0
        follow.ahead.x += (follow.velocity.x * scale - follow.ahead.x) * k
        follow.ahead.y += (follow.velocity.y * scale - follow.ahead.y) * k

        const subjectAppeared = subject && !follow.hasSubject // the camera was placed on the respawn marker before the subject existed
        follow.hasSubject = !!subject
        const snap = !follow.initialized || subjectAppeared || Math.hypot(source.x - follow.x.x, source.z - follow.z.x) > cfg.snapDistance
        if(snap)
        {
            follow.initialized = true
            follow.x.x = source.x
            follow.x.v = 0
            follow.y.x = targetY
            follow.y.v = 0
            follow.z.x = source.z
            follow.z.v = 0
            follow.ahead.set(0, 0)
            follow.velocity.set(0, 0)
        }
        else
        {
            springStep(follow.x, source.x, cfg.halfLifeXZ, delta)
            springStep(follow.z, source.z, cfg.halfLifeXZ, delta)
            springStep(follow.y, targetY, cfg.halfLifeY, delta)
        }

        this.focusPoint.smoothedPosition.set(follow.x.x + follow.ahead.x, follow.y.x + this.framing.focusOffsetY, follow.z.x + follow.ahead.y)
        this.focusPoint.position.copy(this.focusPoint.smoothedPosition)
    }

    setFocusPoint()
    {
        const defaultRespawn = this.game.respawns.getDefault()
        
        this.focusPoint = {}
        this.focusPoint.trackedPosition = new THREE.Vector3(defaultRespawn.position.x, 0, defaultRespawn.position.z)
        this.focusPoint.isTracking = true
        this.focusPoint.position = this.focusPoint.trackedPosition.clone()
        this.focusPoint.smoothedPosition = this.focusPoint.trackedPosition.clone()
        this.focusPoint.isEased = true
        this.focusPoint.easing = 1
        this.focusPoint.magnet = {}
        this.focusPoint.magnet.active = true
        this.focusPoint.magnet.multiplier = 0.25

        const focusActionsNames = [
            'forward',
            'right',
            'backward',
            'left',
            'boost',
            'brake',
            'respawn',
            'suspensions',
            'suspensionsFront',
            'suspensionsBack',
            'suspensionsRight',
            'suspensionsLeft',
            'suspensionsFrontLeft',
            'suspensionsFrontRight',
            'suspensionsBackRight',
            'suspensionsBackLeft',
            'interact',
            'whisper'
        ]
        this.game.inputs.events.on('actionStart', (action) =>
        {
            if(focusActionsNames.indexOf(action.name) !== -1)
                this.focusPoint.isTracking = true
        })

        this.focusPoint.helper = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 32), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('orange').multiplyScalar(4), wireframe: false }))
        this.focusPoint.helper.visible = false
        this.focusPoint.helper.userData.preventPreRender = true
        this.game.scene.add(this.focusPoint.helper)

        if(this.game.debug.active)
        {
            const zoomDebugPanel = this.debugPanel.addFolder({
                title: 'Magnet',
                expanded: true,
            })
            zoomDebugPanel.addBinding(this.focusPoint.magnet, 'multiplier', { min: 0, max: 1, step: 0.0001 })
        }
    }

    setOptimalArea()
    {
        this.optimalArea = {}
        this.optimalArea.needsUpdate = true
        this.optimalArea.position = new THREE.Vector3()
        this.optimalArea.basePosition = new THREE.Vector3()
        this.optimalArea.nearPosition = new THREE.Vector3()
        this.optimalArea.farPosition = new THREE.Vector3()
        this.optimalArea.nearDistance = null
        this.optimalArea.farDistance = null
        this.optimalArea.radius = 0
        this.optimalArea.raycaster = new THREE.Raycaster()
        this.optimalArea.quad2 = [
            { base: new THREE.Vector2(), offseted: new THREE.Vector2(), helper: null },
            { base: new THREE.Vector2(), offseted: new THREE.Vector2(), helper: null },
            { base: new THREE.Vector2(), offseted: new THREE.Vector2(), helper: null },
            { base: new THREE.Vector2(), offseted: new THREE.Vector2(), helper: null },
        ]

        this.optimalArea.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

        // // Helper
        // this.optimalArea.quad2Helper = {}

        // const geometry = new LineGeometry()
        // geometry.setPositions([
        //     0, 0, 0,
        //     0, 0, 0,
        //     0, 0, 0,
        //     0, 0, 0
        // ])

        // const material = new THREE.Line2NodeMaterial({
        //     color: new THREE.Color('orange').multiplyScalar(4),
        //     linewidth: 10
        // })

        // this.optimalArea.quad2Helper = new Line2(geometry, material)
        // this.optimalArea.quad2Helper.computeLineDistances()
        // this.game.scene.add(this.optimalArea.quad2Helper)

        const OPTIMAL_AREA_MAX_RADIUS = 120

        this.optimalArea.update = () =>
        {
            // Save state
            const savedPosition = this.defaultCamera.position.clone()
            const savedQuaternion = this.defaultCamera.quaternion.clone()

            // Reset with max radius
            let radiusMax = (this.spherical.radius.edges.max + this.ratioOverflow * this.spherical.radius.nonIdealRatioOffset)

            if(this.game.quality.level === 0)
                radiusMax *= 1 - this.zoom.speedAmplitude
            
            const offset = new THREE.Vector3()
            offset.setFromSphericalCoords(radiusMax, this.spherical.phi, this.spherical.theta)

            this.defaultCamera.position.set(0, 0, 0).add(offset)
            this.defaultCamera.lookAt(new THREE.Vector3())
            this.defaultCamera.updateProjectionMatrix()
            this.defaultCamera.updateWorldMatrix()

            const intersectFloor = (ndcX, ndcY, target) =>
            {
                this.optimalArea.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.defaultCamera)
                const hit = this.optimalArea.raycaster.ray.intersectPlane(this.optimalArea.floorPlane, target)
                if(!hit || !Number.isFinite(target.x) || !Number.isFinite(target.z) || target.length() > OPTIMAL_AREA_MAX_RADIUS)
                {
                    const dir = this.optimalArea.raycaster.ray.direction
                    const horizLen = Math.hypot(dir.x, dir.z)
                    if(horizLen > 1e-4)
                        target.set((dir.x / horizLen) * OPTIMAL_AREA_MAX_RADIUS, 0, (dir.z / horizLen) * OPTIMAL_AREA_MAX_RADIUS)
                    else
                        target.set(0, 0, 0)
                }
                return target
            }

            // First near/far diagonal
            intersectFloor(1, -1, this.optimalArea.nearPosition)
            this.optimalArea.quad2[0].base.x = this.optimalArea.nearPosition.x
            this.optimalArea.quad2[0].base.y = this.optimalArea.nearPosition.z

            intersectFloor(-1, 1, this.optimalArea.farPosition)
            this.optimalArea.quad2[2].base.x = this.optimalArea.farPosition.x
            this.optimalArea.quad2[2].base.y = this.optimalArea.farPosition.z

            const centerA = this.optimalArea.nearPosition.clone().lerp(this.optimalArea.farPosition, 0.5)

            // Second near/far diagonal
            intersectFloor(-1, -1, this.optimalArea.nearPosition)
            this.optimalArea.quad2[3].base.x = this.optimalArea.nearPosition.x
            this.optimalArea.quad2[3].base.y = this.optimalArea.nearPosition.z

            intersectFloor(1, 1, this.optimalArea.farPosition)
            this.optimalArea.quad2[1].base.x = this.optimalArea.farPosition.x
            this.optimalArea.quad2[1].base.y = this.optimalArea.farPosition.z

            const centerB = this.optimalArea.nearPosition.clone().lerp(this.optimalArea.farPosition, 0.5)

            // Center between the two diagonal centers
            this.optimalArea.basePosition = centerA.clone().lerp(centerB, 0.5)

            // Radius
            const rawRadius = this.optimalArea.basePosition.distanceTo(this.optimalArea.farPosition)
            this.optimalArea.radius = Number.isFinite(rawRadius) ? clamp(rawRadius, 1, OPTIMAL_AREA_MAX_RADIUS) : OPTIMAL_AREA_MAX_RADIUS

            // Distances
            intersectFloor(0, -1, this.optimalArea.nearPosition)
            intersectFloor(0, 1, this.optimalArea.farPosition)
            
            this.optimalArea.nearDistance = this.defaultCamera.position.distanceTo(this.optimalArea.nearPosition)
            this.optimalArea.farDistance = this.defaultCamera.position.distanceTo(this.optimalArea.farPosition)

            // Put back state
            this.defaultCamera.position.copy(savedPosition)
            this.defaultCamera.quaternion.copy(savedQuaternion)

            // Save
            this.optimalArea.needsUpdate = false
        }
    }

    setZoom()
    {
        this.zoom = {}
        this.zoom.baseRatio = 0.6
        this.zoom.ratio = this.zoom.baseRatio
        this.zoom.smoothedRatio = this.zoom.baseRatio
        this.zoom.speedAmplitude = 0 // T1.6: no speed zoom
        this.zoom.speedEdge = { min: 5, max: 40 }
        this.zoom.sensitivity = 0.05
        this.zoom.toggle = 0
        this.zoom.toggleLast = -1

        this.game.inputs.addActions([
            { name: 'zoom',    categories: [ 'wandering', 'racing' ], keys: [ 'Wheel.roll' ] },
            { name: 'zoomToggle',  categories: [ 'wandering', 'racing' ], keys: [ 'Gamepad.r3' ] },
        ])

        this.game.inputs.events.on('zoom', (action) =>
        {
            this.zoom.baseRatio -= action.value * this.zoom.sensitivity
            this.zoom.baseRatio = clamp(this.zoom.baseRatio, 0, 1)
        })

        this.game.inputs.events.on('zoomToggle', (action) =>
        {
            if(action.active)
            {
                this.zoom.toggle -= this.zoom.toggleLast
                this.zoom.toggleLast = this.zoom.toggle
            }
            else
            {
                this.zoom.toggle = 0
            }
        })

        if(this.game.debug.active)
        {
            const zoomDebugPanel = this.debugPanel.addFolder({
                title: 'Zoom',
                expanded: false,
            })
            zoomDebugPanel.addBinding(this.zoom, 'speedAmplitude', { min: 0, max: 1, step: 0.001 })
            zoomDebugPanel.addBinding(this.zoom, 'speedEdge', { min: 0, max: 100, step: 0.001 })
            zoomDebugPanel.addBinding(this.zoom, 'sensitivity', { min: 0, max: 0.5, step: 0.0001 })
        }
    }

    setSpherical()
    {
        this.spherical = {}
        this.spherical.phi = this.framing.phi
        this.spherical.theta = this.controlYaw // what the Player reads; only changed on the fixed step

        // T1.6: fixed distance (min = max: no wheel zoom, no ratio compensation until T1.7)
        this.spherical.radius = {}
        this.spherical.radius.edges = { min: this.framing.distance, max: this.framing.distance }
        this.spherical.radius.current = this.framing.distance
        this.spherical.radius.nonIdealRatioOffset = 0

        this.spherical.offset = new THREE.Vector3()
        this.spherical.offset.setFromSphericalCoords(this.spherical.radius.current, this.spherical.phi, this.spherical.theta)

        if(this.game.debug.active)
        {
            const sphericalDebugPanel = this.debugPanel.addFolder({
                title: 'Spherical',
                expanded: false,
            })
            sphericalDebugPanel.addBinding(this.spherical, 'phi', { min: 0, max: Math.PI * 0.5, step: 0.001 })
            sphericalDebugPanel.addBinding(this.spherical, 'theta', { min: - Math.PI, max: Math.PI, step: 0.001 })
            sphericalDebugPanel.addBinding(this.spherical.radius, 'edges', { min: 0, max: 100, step: 0.001 })
        }
    }

    // Manual orbit (plan 3.3 & 3.4): Q/E or right analog stick, clamped to +-25 deg yaw and +-8 deg pitch,
    // springs back to 0 within 1.2 s after input stops. Applied on top of the authored yaw without altering controlYaw.
    setManualOrbit()
    {
        this.orbit = {
            yaw: 0,
            yawPrevious: 0,
            pitch: 0,
            pitchPrevious: 0,
            yawSpring: { x: 0, v: 0 },
            pitchSpring: { x: 0, v: 0 },
            maxYaw: 25 * DEG,
            maxPitch: 8 * DEG,
            yawRate: 50 * DEG,
            pitchRate: 24 * DEG,
            nudgeAngle: 15 * DEG,
            nudgeLatch: 0,
            returnDuration: 1.2,
            returnHalfLife: 0.25,
            active: false,
        }

        this.game.inputs.addActions([
            { name: 'cameraOrbitLeft',       categories: [ 'wandering' ], keys: [ 'Keyboard.KeyQ', 'Touch.cameraOrbitLeft' ] },
            { name: 'cameraOrbitRight',      categories: [ 'wandering' ], keys: [ 'Keyboard.KeyE', 'Touch.cameraOrbitRight' ] },
            { name: 'cameraOrbitNudgeLeft',  categories: [ 'wandering' ], keys: [ 'Touch.cameraOrbitNudgeLeft' ] },
            { name: 'cameraOrbitNudgeRight', categories: [ 'wandering' ], keys: [ 'Touch.cameraOrbitNudgeRight' ] },
            { name: 'cameraOrbitStick',      categories: [ 'wandering' ], keys: [ 'Gamepad.joystickRight' ] },
        ])

        this.game.inputs.events.on('cameraOrbitNudgeLeft', (action) =>
        {
            if(action.trigger === 'start')
                this.orbit.nudgeLatch -= this.orbit.nudgeAngle
        })

        this.game.inputs.events.on('cameraOrbitNudgeRight', (action) =>
        {
            if(action.trigger === 'start')
                this.orbit.nudgeLatch += this.orbit.nudgeAngle
        })
    }

    updateManualOrbit(dt)
    {
        const orbit = this.orbit
        orbit.yawPrevious = orbit.yaw
        orbit.pitchPrevious = orbit.pitch

        const actions = this.game.inputs.actions
        const left = actions.get('cameraOrbitLeft')?.active ? 1 : 0
        const right = actions.get('cameraOrbitRight')?.active ? 1 : 0
        let yawInput = right - left
        let pitchInput = 0

        const stick = actions.get('cameraOrbitStick')?.value
        if(stick && typeof stick === 'object' && stick.active)
        {
            if(Math.abs(stick.x) > Math.abs(yawInput))
                yawInput = clamp(stick.x, -1, 1)
            pitchInput = clamp(stick.y, -1, 1)
        }

        let nudged = false
        if(orbit.nudgeLatch !== 0)
        {
            orbit.yawSpring.x = clamp(orbit.yawSpring.x + orbit.nudgeLatch, -orbit.maxYaw, orbit.maxYaw)
            orbit.yawSpring.v = 0
            orbit.nudgeLatch = 0
            nudged = true
        }

        const hasYawInput = Math.abs(yawInput) > 1e-4
        const hasPitchInput = Math.abs(pitchInput) > 1e-4
        orbit.active = hasYawInput || hasPitchInput || nudged

        if(hasYawInput)
        {
            orbit.yawSpring.x = clamp(orbit.yawSpring.x + yawInput * orbit.yawRate * dt, -orbit.maxYaw, orbit.maxYaw)
            orbit.yawSpring.v = 0
        }
        else if(!nudged && (orbit.yawSpring.x !== 0 || orbit.yawSpring.v !== 0))
        {
            springStep(orbit.yawSpring, 0, orbit.returnHalfLife, dt)
            if(Math.abs(orbit.yawSpring.x) < 1e-4 && Math.abs(orbit.yawSpring.v) < 1e-4)
            {
                orbit.yawSpring.x = 0
                orbit.yawSpring.v = 0
            }
        }

        if(hasPitchInput)
        {
            orbit.pitchSpring.x = clamp(orbit.pitchSpring.x + pitchInput * orbit.pitchRate * dt, -orbit.maxPitch, orbit.maxPitch)
            orbit.pitchSpring.v = 0
        }
        else if(orbit.pitchSpring.x !== 0 || orbit.pitchSpring.v !== 0)
        {
            springStep(orbit.pitchSpring, 0, orbit.returnHalfLife, dt)
            if(Math.abs(orbit.pitchSpring.x) < 1e-4 && Math.abs(orbit.pitchSpring.v) < 1e-4)
            {
                orbit.pitchSpring.x = 0
                orbit.pitchSpring.v = 0
            }
        }

        orbit.yaw = clamp(orbit.yawSpring.x, -orbit.maxYaw, orbit.maxYaw)
        orbit.pitch = clamp(orbit.pitchSpring.x, -orbit.maxPitch, orbit.maxPitch)
    }

    setRoll()
    {
        this.roll = {}
        this.roll.value = 0
        this.roll.velocity = 0
        this.roll.speed = 0
        this.roll.damping = 4
        this.roll.pullStrength = 100
        this.roll.kickStrength = 1
        
        this.roll.kick = (strength = 1) =>
        {
            this.roll.speed = strength * this.roll.kickStrength * (Math.random() < 0.5 ? - 1 : 1)
        }

        if(this.game.debug.active)
        {
            const rollDebugPanel = this.debugPanel.addFolder({
                title: 'Roll',
                expanded: false,
            })
            rollDebugPanel
                .addButton({ title: 'kick' })
                .on('click', () =>
                {
                    this.roll.kick()
                })

            rollDebugPanel.addBinding(this.roll, 'damping', { min: 0, max: 20, step: 0.1 })
            rollDebugPanel.addBinding(this.roll, 'pullStrength', { min: 0, max: 400, step: 0.1 })
            rollDebugPanel.addBinding(this.roll, 'kickStrength', { min: 0, max: 10, step: 0.1 })
        }
    }

    setCameras()
    {
        this.camera = new THREE.PerspectiveCamera(this.framing.vFov, this.game.viewport.ratio, 0.1, 200)
        this.camera.position.setFromSphericalCoords(this.spherical.radius.current, this.spherical.phi, this.spherical.theta)

        this.defaultCamera = this.camera.clone()
        this.freeCamera = this.camera.clone()

        this.game.scene.add(this.camera, this.defaultCamera, this.freeCamera)

        this.cameraHelper = new THREE.CameraHelper(this.defaultCamera)
        this.cameraHelper.visible = false
        this.cameraHelper.userData.preventPreRender = true
        this.game.scene.add(this.cameraHelper)

        if(this.game.debug.active)
        {
            this.debugPanel.addBinding(this.cameraHelper, 'visible', { label: 'cameraHelper' })
        }
    }

    setFree()
    {
        this.freeMode = new CameraControls(this.freeCamera, this.game.domElement)
        this.freeMode.enabled = this.mode === View.MODE_FREE
        this.freeMode.smoothTime = 0.075
        this.freeMode.draggingSmoothTime = 0.075
        this.freeMode.dollySpeed = 0.2
    }

    setCinematic()
    {
        this.cinematic = {}
        this.cinematic.active = false
        this.cinematic.progress = 0
        this.cinematic.position = new THREE.Vector3()
        this.cinematic.target = new THREE.Vector3()
        this.cinematic.dummy = this.camera.clone()
        this.cinematic.nonIdealRatioOffset = 10

        // this.cinematic.targetHelper = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicNodeMaterial({ color: '#ff00ff', wireframe: true }))
        // this.cinematic.targetHelper.userData.preventPreRender = true
        // this.game.scene.add(this.cinematic.targetHelper)

        this.cinematic.start = (position, target) =>
        {
            this.cinematic.active = true
            this.cinematic.position = position.clone()
            this.cinematic.target = target.clone()

            this.cinematic.targetHelper?.position.copy(this.cinematic.target)

            if(this.ratioOverflow > 0)
            {
                const delta = this.cinematic.position.clone().sub(this.cinematic.target).setLength(this.ratioOverflow * this.cinematic.nonIdealRatioOffset)
                this.cinematic.position.add(delta)
            }

            gsap.to(this.cinematic, { progress: 1, duration: 1.5, ease: 'power2.inOut', overwrite: true })
            if(this.game.rendering.cheapDOFPass)
                gsap.to(this.game.rendering.cheapDOFPass.strength, { value: 0, duration: 1.5, ease: 'power2.inOut', overwrite: true })
        }

        this.cinematic.end = () =>
        {
            this.cinematic.active = false
            gsap.to(this.cinematic, { progress: 0, duration: 1, ease: 'power2.inOut', overwrite: true })
            if(this.game.rendering.cheapDOFPass)
                gsap.to(this.game.rendering.cheapDOFPass.strength, { value: 1.5, duration: 1.5, ease: 'power2.inOut', overwrite: true })
        }
    }

    setSpeedLines()
    {
        this.speedLines = {}
        this.speedLines.strength = 0
        this.speedLines.smoothedStrength = uniform(this.speedLines.strength)
        this.speedLines.worldTarget = new THREE.Vector3()
        this.speedLines.clipSpaceTarget = uniform(new THREE.Vector3())
        this.speedLines.speed = uniform(12)

        const linesCount = 30
        const positionArray = new Float32Array(linesCount * 3 * 3)
        const timeRandomnessArray = new Float32Array(linesCount * 3)
        const distanceArray = new Float32Array(linesCount * 3)
        const tipnessArray = new Float32Array(linesCount * 3)
        const maxDistance = Math.hypot(1, 1)

        for(let i = 0; i < linesCount; i++)
        {
            const i9 = i * 9
            const i3 = i * 3

            // Base vertex
            const vertexMiddle = new THREE.Vector2(0, 1)
            const angle = Math.PI * 2 * rng()
            vertexMiddle.rotateAround(new THREE.Vector2(), angle)

            // Side vertices 
            const thickness = rng() * 0.01 + 0.002
            const vertexLeft = vertexMiddle.clone().rotateAround(new THREE.Vector2(), thickness)
            const vertexRight = vertexMiddle.clone().rotateAround(new THREE.Vector2(), - thickness)
            
            // Distance to center
            vertexMiddle.multiplyScalar(maxDistance)
            vertexLeft.multiplyScalar(maxDistance)
            vertexRight.multiplyScalar(maxDistance)

            // Position
            positionArray[i9 + 0] = vertexLeft.x
            positionArray[i9 + 1] = vertexLeft.y
            positionArray[i9 + 2] = 0
            
            positionArray[i9 + 3] = vertexMiddle.x
            positionArray[i9 + 4] = vertexMiddle.y
            positionArray[i9 + 5] = 0

            positionArray[i9 + 6] = vertexRight.x
            positionArray[i9 + 7] = vertexRight.y
            positionArray[i9 + 8] = 0

            // Time randomness
            timeRandomnessArray[i3 + 0] = i
            timeRandomnessArray[i3 + 1] = i
            timeRandomnessArray[i3 + 2] = i

            // Distance
            const distance = rng() * 0.4 + 0.4
            distanceArray[i3 + 0] = distance
            distanceArray[i3 + 1] = distance
            distanceArray[i3 + 2] = distance

            // Tipness
            tipnessArray[i3 + 0] = 0
            tipnessArray[i3 + 1] = 1
            tipnessArray[i3 + 2] = 0
        }

        this.speedLines.geometry = new THREE.BufferGeometry()
        this.speedLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionArray, 3))
        this.speedLines.geometry.setAttribute('timeRandomness', new THREE.Float32BufferAttribute(timeRandomnessArray, 1))
        this.speedLines.geometry.setAttribute('distance', new THREE.Float32BufferAttribute(distanceArray, 1))
        this.speedLines.geometry.setAttribute('tipness', new THREE.Float32BufferAttribute(tipnessArray, 1))

        this.speedLines.material = new THREE.MeshBasicNodeMaterial({ wireframe: false, depthWrite: false, depthTest: false })
        this.speedLines.material.vertexNode = Fn(() =>
        {
            const timeRandomness = attribute('timeRandomness')
            const distance = attribute('distance')
            const tipness = attribute('tipness')
            
            const osciliation = this.game.ticker.elapsedScaledUniform.mul(this.speedLines.speed).add(timeRandomness).sin().div(2).add(0.5)
            const newPosition = mix(positionGeometry.xy, this.speedLines.clipSpaceTarget.xy, tipness.mul(osciliation).mul(distance).mul(this.speedLines.smoothedStrength))
            
            return vec4(newPosition, 0, 1)
        })()
        this.speedLines.material.outputNode = vec4(1)

        this.speedLines.mesh = new THREE.Mesh(this.speedLines.geometry, this.speedLines.material)
        this.speedLines.mesh.frustumCulled = false
        this.speedLines.mesh.renderOrder = 10
        this.game.scene.add(this.speedLines.mesh)

        // Debug
        if(this.game.debug.active)
        {
            const folder = this.debugPanel.addFolder({
                title: 'Speed lines',
                expanded: false,
            })
            folder.addBinding(this.speedLines, 'strength', { label: 'strength', min: 0, max: 1, step: 0.001 })
            folder.addBinding(this.speedLines.speed, 'value', { label: 'speed', min: 0, max: 100, step: 0.001 })
        }
    }

    resize()
    {
        const aspect = this.game.viewport.width / this.game.viewport.height
        if(!(aspect > 0) || !Number.isFinite(aspect))
            return

        this.ratioOverflow = Math.max(1, this.idealRatio / aspect) - 1
        this.framing.apply(aspect)
        this.optimalArea.needsUpdate = true

        for(const camera of [ this.camera, this.defaultCamera, this.freeCamera ])
        {
            camera.aspect = aspect
            camera.fov = this.framing.vFov
            camera.updateProjectionMatrix()
        }
    }

    throttleResize()
    {
        this.optimalArea.update()
    }

    setMapControls()
    {
        this.game.inputs.addActions([
            { name: 'viewMapPointer', categories: [ 'intro', 'wandering' ], keys: [ 'Pointer.any' ] },
        ])

        this.game.inputs.events.on('viewMapPointer', (action) =>
        {
            if(this.game.inputs.mode === Inputs.MODE_TOUCH && this.game.inputs.touchControls?.enabled && this.getSubject())
                return

            if(this.mode === View.MODE_DEFAULT)
            {
                // Focus point
                if(action.active)
                {
                    // Map
                    if(this.game.inputs.pointer.mode === Pointer.MODE_MOUSE || this.game.inputs.pointer.touches.length >= 2)
                    {
                        this.focusPoint.isTracking = false
                        
                        const mapMovement = new THREE.Vector2(this.game.inputs.pointer.delta.x, this.game.inputs.pointer.delta.y)                    
                        mapMovement.rotateAround(new THREE.Vector2(), -this.spherical.theta)

                        const smallestSide = Math.min(this.game.viewport.width, this.game.viewport.height)
                        mapMovement.multiplyScalar(10 / smallestSide)
                        
                        this.focusPoint.position.x -= mapMovement.x * 2
                        this.focusPoint.position.z -= mapMovement.y * 2
                    }

                    // Pinch
                    this.zoom.baseRatio += this.game.inputs.pointer.pinch.distanceDelta * 0.005
                    this.zoom.baseRatio = clamp(this.zoom.baseRatio, 0, 1)
                }
            }
        })
    }

    update()
    {
        // Focus point: critical springs, y locked in the air, look-ahead (T1.6)
        this.updateFollow(Math.min(this.game.ticker.delta, cameraConfig.maxDelta))

        // Radius and visual yaw: the control yaw only changes on the fixed step; the render interpolates between steps
        this.spherical.radius.current = this.framing.distance
        const orbitYaw = lerp(this.orbit.yawPrevious, this.orbit.yaw, this.game.ticker.alpha)
        const orbitPitch = lerp(this.orbit.pitchPrevious, this.orbit.pitch, this.game.ticker.alpha)
        const yaw = this.controlYawPrevious + smallestAngle(this.controlYawPrevious, this.controlYaw) * this.game.ticker.alpha + orbitYaw
        const phi = clamp(this.spherical.phi + orbitPitch, 0.15, Math.PI * 0.48)
        this.spherical.offset.setFromSphericalCoords(this.spherical.radius.current, phi, yaw)

        // Position
        this.position.copy(this.focusPoint.smoothedPosition).add(this.spherical.offset)

        // Default camera position
        this.delta = this.position.clone().sub(this.defaultCamera.position)
        this.defaultCamera.position.copy(this.position)

        // Default camera look at and roll
        this.defaultCamera.rotation.set(0, 0, 0)
        this.defaultCamera.lookAt(this.focusPoint.smoothedPosition)

        this.roll.velocity = - this.roll.value * this.roll.pullStrength * this.game.ticker.deltaScaled
        this.roll.speed += this.roll.velocity
        this.roll.value += this.roll.speed * this.game.ticker.deltaScaled
        this.roll.speed *= 1 - this.roll.damping * this.game.ticker.deltaScaled
        this.defaultCamera.rotation.z += this.roll.value

        // Cinematic
        if(this.cinematic.progress > 0)
        {
            this.cinematic.dummy.position.copy(this.cinematic.position)
            this.cinematic.dummy.lookAt(this.cinematic.target)
            this.defaultCamera.position.lerp(this.cinematic.dummy.position, this.cinematic.progress)
            this.defaultCamera.quaternion.slerp(this.cinematic.dummy.quaternion, this.cinematic.progress)
        }

        // Apply to final camera
        if(this.mode === View.MODE_DEFAULT)
        {
            this.camera.position.copy(this.defaultCamera.position)
            this.camera.quaternion.copy(this.defaultCamera.quaternion)
        }
        else if(this.mode === View.MODE_FREE)
        {
            this.freeMode.update(this.game.ticker.delta)
            this.camera.position.copy(this.freeCamera.position)
            this.camera.quaternion.copy(this.freeCamera.quaternion)
        }

        // Cameras matrices
        this.camera.updateMatrixWorld()
        this.defaultCamera.updateMatrixWorld()
        this.freeCamera.updateMatrixWorld()
        
        // Optimal area
        if(this.optimalArea.needsUpdate)
            this.optimalArea.update()
        
        this.optimalArea.position
            .copy(this.optimalArea.basePosition)
            .add(new THREE.Vector3(this.focusPoint.smoothedPosition.x, 0, this.focusPoint.smoothedPosition.z))

        for(const point of this.optimalArea.quad2)
        {
            point.offseted.x = point.base.x + this.focusPoint.position.x
            point.offseted.y = point.base.y + this.focusPoint.position.z
        }

        // Speed lines
        this.speedLines.clipSpaceTarget.value.copy(this.speedLines.worldTarget)
        this.speedLines.clipSpaceTarget.value.project(this.camera)

        this.speedLines.smoothedStrength.value = lerp(this.speedLines.smoothedStrength.value, this.speedLines.strength, this.game.ticker.delta * 2)
    }
}