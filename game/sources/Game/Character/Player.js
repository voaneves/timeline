// The player (plan T1.2): camera-relative movement from the Inputs actions, driving a CharacterController.
//
// - Input: actions forward / backward / left / right / run (keyboard, d-pad) and `moveStick` (gamepad left stick, analog),
//   registered through the Inputs API. They are read inside 'fixedTick' (order 2, before the physics step at 3), so the
//   ghost injects them exactly like live input and the simulation stays deterministic.
// - Camera-relative: the wanted direction is rotated by the view azimuth (`view.spherical.theta`). T1.6 must keep that
//   value constant or step-driven while a ghost runs (a per-frame orbit would break determinism).
// - Visual: the capsule is a regular Objects entry, so Objects interpolates it between the last two physics steps with
//   `ticker.alpha`. The lean (visual bank) is applied per frame to a child mesh; the View follows the interpolated visual.
// - Debug: folder "Feel" in the Tweakpane (only built when the debug panel is active).
import * as THREE from 'three/webgpu'
import { Events } from '../Events.js'
import { Game } from '../Game.js'
import { CharacterController } from './CharacterController.js'
import { CharacterVisual } from './CharacterVisual.js'
import { feel, resetFeel } from '../../data/feel.js'

const PRESET_KEY = 'timeline.feel.preset'

// Tweakpane ranges: [ min, max, step ]
const RANGES = {
    move: { walkSpeed: [ 0, 12, 0.01 ], runSpeed: [ 0.1, 20, 0.01 ], walkThreshold: [ 0, 1, 0.01 ], keyboardMagnitude: [ 0, 1, 0.01 ], accelTime: [ 0.01, 1, 0.001 ], accelHalfTime: [ 0.001, 0.5, 0.001 ], decelTime: [ 0.01, 1, 0.001 ], groundFriction: [ 0, 200, 0.1 ], stopSpeed: [ 0, 0.1, 0.0001 ], slopeCompensation: [ 0, 1, 0.01 ], slopeMaxAngle: [ 0, 60, 0.5 ], slopeMaxFactor: [ 1, 2, 0.01 ] },
    air: { accel: [ 0, 100, 0.1 ], decel: [ 0, 100, 0.1 ] },
    turn: { yawRate: [ 0, 2000, 1 ], leanMax: [ 0, 45, 0.1 ], leanGain: [ 0, 3, 0.01 ], leanSmoothing: [ 1, 60, 0.1 ] },
    skid: { angle: [ 90, 180, 1 ], minSpeed: [ 0, 15, 0.1 ], duration: [ 0, 1, 0.01 ] },
    jump: { height: [ 0.2, 5, 0.01 ], apexTime: [ 0.1, 1, 0.005 ], fallMultiplier: [ 1, 3, 0.01 ], terminal: [ 1, 60, 0.1 ], cutSpeed: [ 0, 12, 0.1 ], minHeight: [ 0, 2, 0.01 ], coyoteTime: [ 0, 0.5, 0.005 ], bufferTime: [ 0, 0.5, 0.005 ] },
    glide: { impulseHeight: [ 0, 2, 0.01 ], gravityScale: [ 0, 1, 0.01 ], maxTime: [ 0, 3, 0.01 ], minHeight: [ 0, 3, 0.05 ] },
    stamp: { lockTime: [ 0, 1, 0.005 ], diveSpeed: [ 5, 60, 0.5 ], minHeight: [ 0, 3, 0.05 ], breakRadius: [ 0.2, 3, 0.05 ], breakDepth: [ 0, 3, 0.05 ], breakHeight: [ 0, 3, 0.05 ], ringLife: [ 0.1, 5, 0.1 ] },
    kcc: { offset: [ 0.001, 0.1, 0.001 ], maxSlopeClimbAngle: [ 0, 89, 0.5 ], minSlopeSlideAngle: [ 0, 89, 0.5 ], autostepHeight: [ 0, 1, 0.01 ], autostepMinWidth: [ 0, 1, 0.01 ], snapToGround: [ 0, 1, 0.01 ], characterMass: [ 1, 500, 1 ] },
}

export class Player
{
    constructor()
    {
        this.game = Game.getInstance()
        this.events = new Events()
        this.feel = feel // tunables, reachable from tests (window.game.world.player.feel)
        this.stampLatch = false // same, for the stamp
        this.jumpLatch = false // a press since the last fixed step (a tap shorter than a frame is never lost)
        this.interactCount = 0 // Phase 2 interactive hook counter
        this.walkTarget = null // WCAG 2.5.7 single-pointer tap-to-walk target { x, y, z }
        this.walkTargetStuckSteps = 0
        this.walkTargetLastDist = Infinity
        this.input = { x: 0, z: 0, speed: 0, jumpPressed: false, jumpHeld: false, stampPressed: false } // world-space wanted direction (unit) and speed, last fixed step

        this.setActions()
        this.setBody()
        this.setWalkTargetVisual()
        this.setDebug()

        // Before Physics (3): the KCC move is applied by the physics step of this same fixed step
        this.game.ticker.events.on('fixedTick', () =>
        {
            this.fixedUpdate()
        }, 2)

        // After Objects.update (4), before View.update (7)
        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 5)
    }

    setActions()
    {
        const categories = [ 'wandering' ]
        this.game.inputs.addActions([
            { name: 'forward', categories, keys: [ 'Keyboard.KeyW', 'Keyboard.ArrowUp', 'Gamepad.up' ] },
            { name: 'backward', categories, keys: [ 'Keyboard.KeyS', 'Keyboard.ArrowDown', 'Gamepad.down' ] },
            { name: 'left', categories, keys: [ 'Keyboard.KeyA', 'Keyboard.ArrowLeft', 'Gamepad.left' ] },
            { name: 'right', categories, keys: [ 'Keyboard.KeyD', 'Keyboard.ArrowRight', 'Gamepad.right' ] },
            { name: 'run', categories, keys: [] }, // forces a run whatever the deflection (no default key: Shift is the stamp; ghosts inject it by name)
            { name: 'jump', categories, keys: [ 'Keyboard.Space', 'Gamepad.cross', 'Touch.jump' ] }, // press = jump (buffered), in the air = ribbon glide
            { name: 'stamp', categories, keys: [ 'Keyboard.ShiftLeft', 'Keyboard.ShiftRight', 'Keyboard.KeyC', 'Gamepad.circle', 'Touch.stamp' ] }, // in the air: lock, dive, mark the ground
            { name: 'interact', categories, keys: [ 'Keyboard.KeyF', 'Keyboard.Enter', 'Gamepad.square', 'Touch.interact' ] }, // Phase 2 interactive hook
            { name: 'moveStick', categories, keys: [ 'Gamepad.joystickLeft', 'Touch.joystick' ] }, // analog: value { x, y, radius, active }
        ])

        this.game.inputs.events.on('jump', (action) =>
        {
            if(action.active)
                this.jumpLatch = true
        })
        this.game.inputs.events.on('stamp', (action) =>
        {
            if(action.active)
                this.stampLatch = true
        })
        this.game.inputs.events.on('interact', (action) =>
        {
            if(action.active)
            {
                this.interactCount++
                this.events.trigger('interact', [ action ])
            }
        })
    }

    setBody()
    {
        const respawn = this.game.respawns.getDefault()
        const { radius, halfHeight } = feel.body

        // Visual container: CharacterVisual attaches the rigged Victor model inside `this.mesh`
        this.model = new THREE.Group()
        this.model.name = 'player'
        this.mesh = new THREE.Group()
        this.model.add(this.mesh)

        // The body origin is the capsule centre: feet = centre - (halfHeight + radius)
        const centerY = respawn.position.y + halfHeight + radius + feel.kcc.offset
        const yaw = respawn.rotation ?? 0
        this.object = this.game.objects.add(
            { model: this.model },
            {
                type: 'kinematicPositionBased',
                position: { x: respawn.position.x, y: centerY, z: respawn.position.z },
                rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
                canSleep: false,
                colliders: [], // the capsule is created by the controller (Physics.getPhysical has no capsule shape)
            }
        )
        this.object.managedReset = true
        this.controller = new CharacterController(this.object, yaw)
        this.controller.events.on('teleport', () => this.clearWalkTarget())
        this.controller.stamp.attachVisual(this.mesh)

        this.visual = new CharacterVisual(this)
        this.mesh.add(this.visual.root)

        // The first capture() (order 4) records this pose as previous and current: no interpolation from the origin
        this.model.position.set(respawn.position.x, centerY, respawn.position.z)
        this.model.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2))
    }

    // Subtle ground target ring for single-pointer tap-to-walk (visual only)
    setWalkTargetVisual()
    {
        this.walkTargetRing = new THREE.Group()
        this.walkTargetRing.name = 'walkTargetRing'
        this.walkTargetRing.visible = false

        const outer = new THREE.Mesh(
            new THREE.RingGeometry(0.32, 0.42, 32),
            new THREE.MeshBasicMaterial({ name: 'walkTargetInk', color: '#0a0a0a', transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide })
        )
        outer.rotation.x = - Math.PI / 2

        const inner = new THREE.Mesh(
            new THREE.RingGeometry(0.14, 0.22, 24),
            new THREE.MeshBasicMaterial({ name: 'walkTargetSignal', color: '#f50000', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
        )
        inner.rotation.x = - Math.PI / 2
        inner.position.y = 0.005

        this.walkTargetRing.add(outer, inner)
        this.game.scene.add(this.walkTargetRing)
    }

    setWalkTarget(x, y, z)
    {
        if(this.game.inputs.locked)
            return

        this.walkTarget = { x, y, z }
        this.walkTargetStuckSteps = 0
        this.walkTargetLastDist = Infinity
        if(this.walkTargetRing)
        {
            this.walkTargetRing.position.set(x, y + 0.03, z)
            this.walkTargetRing.visible = true
        }
    }

    clearWalkTarget()
    {
        this.walkTarget = null
        this.walkTargetStuckSteps = 0
        this.walkTargetLastDist = Infinity
        if(this.walkTargetRing)
            this.walkTargetRing.visible = false
    }

    // Visual pose between the last two physics steps (what the camera follows)
    get position()
    {
        return this.model.position
    }

    // Input -> world-space wanted direction + speed. Pure function of the action state and the view azimuth.
    readInput()
    {
        const actions = this.game.inputs.actions
        const move = feel.move

        let right = (actions.get('right').active ? 1 : 0) - (actions.get('left').active ? 1 : 0)
        let forward = (actions.get('forward').active ? 1 : 0) - (actions.get('backward').active ? 1 : 0)
        let magnitude = 0

        if(right !== 0 || forward !== 0)
        {
            const length = Math.hypot(right, forward)
            magnitude = move.keyboardMagnitude
            right /= length
            forward /= length
        }

        // Analog stick (values are raw axes, y down)
        const stick = actions.get('moveStick').value
        if(stick && typeof stick === 'object' && stick.active)
        {
            const stickMagnitude = Math.min(1, Math.hypot(stick.x, stick.y))
            if(stickMagnitude > magnitude)
            {
                magnitude = stickMagnitude
                right = stick.x / Math.hypot(stick.x, stick.y)
                forward = - stick.y / Math.hypot(stick.x, stick.y)
            }
        }

        if(magnitude > 0)
        {
            // Any manual directional input cancels tap-to-walk
            this.clearWalkTarget()
        }
        else if(this.walkTarget)
        {
            if(this.controller.stamp.active)
            {
                this.clearWalkTarget()
                this.input.x = this.input.z = this.input.speed = 0
                return this.input
            }

            // Deterministic fixed-step steering from simulated rigid body position
            const pos = this.object.physical.body.translation()
            const dx = this.walkTarget.x - pos.x
            const dz = this.walkTarget.z - pos.z
            const dist = Math.hypot(dx, dz)

            if(dist <= 0.35)
            {
                this.clearWalkTarget()
                this.input.x = this.input.z = this.input.speed = 0
                return this.input
            }

            this.input.x = dx / dist
            this.input.z = dz / dist
            this.input.speed = (dist < 0.9 && this.controller.grounded) ? move.walkSpeed : move.runSpeed
            return this.input
        }
        else
        {
            this.input.x = this.input.z = this.input.speed = 0
            return this.input
        }

        if(actions.get('run').active)
            magnitude = 1

        // View azimuth: include orbit yaw + mouseDragYaw so movement stays camera-relative when orbiting
        const view = this.game.view
        const theta = view.spherical.theta + (view.orbit?.yaw ?? 0) + (view.orbit?.mouseDragYaw ?? 0)
        const forwardX = - Math.sin(theta)
        const forwardZ = - Math.cos(theta)
        const rightX = Math.cos(theta)
        const rightZ = - Math.sin(theta)

        let x = rightX * right + forwardX * forward
        let z = rightZ * right + forwardZ * forward
        const length = Math.hypot(x, z)
        this.input.x = x / length
        this.input.z = z / length
        this.input.speed = magnitude >= move.walkThreshold ? move.runSpeed : move.walkSpeed
        return this.input
    }

    fixedUpdate()
    {
        const input = this.readInput()
        input.jumpPressed = this.jumpLatch
        input.jumpHeld = this.game.inputs.actions.get('jump').active
        input.stampPressed = this.stampLatch
        this.jumpLatch = false
        this.stampLatch = false
        this.controller.step(input, this.game.ticker.fixedDelta)

        if(this.walkTarget)
        {
            if(this.controller.stamp.active)
            {
                this.clearWalkTarget()
            }
            else
            {
                const pos = this.controller.next
                const dist = Math.hypot(this.walkTarget.x - pos.x, this.walkTarget.z - pos.z)
                const progress = this.walkTargetLastDist - dist
                this.walkTargetLastDist = dist

                if(this.controller.movedSpeed < 0.25 || progress <= 0.002)
                    this.walkTargetStuckSteps++
                else
                    this.walkTargetStuckSteps = 0

                if(this.walkTargetStuckSteps >= 30)
                    this.clearWalkTarget()
            }
        }

        this.visual?.fixedUpdate(this.game.ticker.fixedDelta)
    }

    // Per frame, visual only
    update()
    {
        this.visual?.update(this.game.ticker.delta)

        if(this.walkTargetRing)
        {
            if(this.walkTarget)
            {
                this.walkTargetRing.visible = true
                this.walkTargetRing.position.set(this.walkTarget.x, this.walkTarget.y + 0.03, this.walkTarget.z)
                const pulse = 1 + 0.08 * Math.sin(this.game.ticker.elapsed * 6)
                this.walkTargetRing.scale.set(pulse, 1, pulse)
            }
            else
            {
                this.walkTargetRing.visible = false
            }
        }

        // Minimal camera follow (T1.6 replaces it): the view tracks the interpolated visual, not the body
        const tracked = this.game.view.focusPoint.trackedPosition
        tracked.x = this.model.position.x
        tracked.z = this.model.position.z
    }

    setDebug()
    {
        if(!this.game.debug.active)
            return

        const debug = this.game.debug
        const folder = this.debugPanel = debug.panel.addFolder({ title: '🏃 Feel', expanded: true })

        for(const groupName in RANGES)
        {
            const group = folder.addFolder({ title: groupName, expanded: groupName === 'move' })
            for(const key in RANGES[groupName])
            {
                const [ min, max, step ] = RANGES[groupName][key]
                group.addBinding(feel[groupName], key, { min, max, step })
            }
        }
        folder.on('change', () => this.controller.applySettings())

        const refresh = () => { folder.refresh(); this.controller.applySettings() }
        debug.addButtons(folder, {
            save: () =>
            {
                try { localStorage.setItem(PRESET_KEY, JSON.stringify(feel)) } catch(error) { console.warn('[feel] preset not saved', error) }
            },
            load: () =>
            {
                try
                {
                    const saved = JSON.parse(localStorage.getItem(PRESET_KEY))
                    if(saved)
                        for(const groupName in saved)
                            if(feel[groupName])
                                Object.assign(feel[groupName], saved[groupName])
                }
                catch(error) { console.warn('[feel] preset not loaded', error) }
                refresh()
            },
            reset: () => { resetFeel(); refresh() },
            copyJSON: () => { navigator.clipboard?.writeText(JSON.stringify(feel, null, 4)) },
        }, 'preset')
    }
}
