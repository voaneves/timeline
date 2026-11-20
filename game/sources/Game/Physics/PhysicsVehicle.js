// Vehicle locomotion variant (plan T1.10, decision D1 comparison): a grey box cart on Rapier's
// DynamicRayCastVehicleController, spawned instead of the on-foot Player with `?loco=vehicle`.
//
// Quarantine: self-contained. It only uses Game (ticker, inputs, objects, physics, respawns, view); nothing else
// in the engine depends on it, so it can be deleted whole if D1 does not pick the vehicle.
// Controller setup and wheel loop are adapted as code; no upstream assets.
//
// - Input: the same movement actions as the Player (forward / backward / left / right / run + the gamepad left stick).
//   Tank-style: forward/backward = throttle, left/right = steering, run = boost. The actions are registered with the
//   same names, so a Player and a vehicle are never alive together (World picks one).
// - Determinism: everything is driven by 'fixedTick' (order 2, before the Physics step at order 3) with the fixed
//   step as the only time source. No wall clock, no Math.random. The only per-frame code ('tick') is visual
//   (wheel meshes, camera follow).
// - The chassis forward axis is +X in body space (the Rapier default `indexForwardAxis`): the body is spawned
//   yawed so that +X points along the respawn forward (-Z at yaw 0).
import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

// Tunables (metres, kilograms, seconds)
const SETTINGS = {
    chassisHalf: { x: 0.85, y: 0.18, z: 0.5 },
    chassisMass: 60,
    centerOfMass: { x: 0, y: - 0.25, z: 0 },
    wheel: { radius: 0.4, offsetX: 0.6, offsetZ: 0.62, connectionY: - 0.05, restLength: 0.4, maxTravel: 0.5, stiffness: 28, compression: 3.2, relaxation: 2.4, maxForce: 6000, frictionSlip: 1.8, sideFriction: 3 },
    engineForce: 120, // per wheel (4 wheel drive)
    boostMultiplier: 1.6,
    topSpeed: 9,
    topSpeedBoost: 18,
    reverseTopSpeed: 4,
    brake: 3, // per wheel, when stopping
    idleBrake: 0.15,
    steering: 0.5, // rad at standstill
    steeringHighSpeed: 0.2, // rad at top speed
    fallLimit: - 1, // below this height the cart is put back on the respawn (fixed step; Objects' own per-frame reset is at -1.5)
}

export class PhysicsVehicle
{
    constructor()
    {
        this.game = Game.getInstance()
        this.settings = SETTINGS
        this.control = { throttle: 0, steer: 0, boost: false } // last fixed step
        this.speed = 0 // signed forward speed (m/s)
        this.fixedSteps = 0
        this.resets = 0

        this.setActions()
        this.setChassis()
        this.setWheels()

        // Before Physics (3): the wheel rays + forces are applied by the physics step of this same fixed step
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
            { name: 'run', categories, keys: [ 'Keyboard.ShiftLeft' ] },
            { name: 'moveStick', categories, keys: [ 'Gamepad.joystickLeft' ] }, // analog: value { x, y, radius, active }
        ])
    }

    setChassis()
    {
        const respawn = this.game.respawns.getDefault()
        const { chassisHalf: half, wheel } = SETTINGS
        const yaw = (respawn.rotation ?? 0) + Math.PI / 2 // body +X -> world forward (-Z at respawn yaw 0)
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)

        // Visual: grey boxes (no art). Long axis X (forward), a darker nose block on the +X end
        this.model = new THREE.Group()
        this.model.name = 'vehicle'
        const bodyMaterial = new THREE.MeshStandardMaterial({ name: 'greyMarker', color: '#e0e0e0' })
        const darkMaterial = new THREE.MeshStandardMaterial({ name: 'greyDark', color: '#4a4a4a' })
        const body = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), bodyMaterial)
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, half.z * 1.6), bodyMaterial)
        cab.position.set(- 0.2, half.y + 0.15, 0)
        const nose = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, half.z * 2), darkMaterial)
        nose.position.set(half.x - 0.1, half.y + 0.1, 0)
        this.model.add(body, cab, nose)

        this.wheelMeshes = []
        for(let i = 0; i < 4; i++)
        {
            const pivot = new THREE.Group() // steering (Y) then rolling (Z, the axle)
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(wheel.radius, wheel.radius, 0.22, 16), darkMaterial)
            mesh.rotation.x = Math.PI / 2 // cylinder axis Y -> Z
            const mark = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.26), bodyMaterial) // shows the rolling
            mark.position.set(wheel.radius * 0.7, 0, 0)
            const roll = new THREE.Group()
            roll.add(mesh, mark)
            pivot.add(roll)
            pivot.userData.roll = roll
            this.model.add(pivot)
            this.wheelMeshes.push(pivot)
        }

        const centerY = respawn.position.y + wheel.radius + wheel.restLength - wheel.connectionY + 0.05
        const position = { x: respawn.position.x, y: centerY, z: respawn.position.z }
        this.model.position.set(position.x, position.y, position.z)
        this.model.quaternion.copy(rotation)

        this.object = this.game.objects.add(
            { model: this.model },
            {
                type: 'dynamic',
                position,
                rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
                friction: 0.3,
                canSleep: false,
                linearDamping: 0.05,
                angularDamping: 0.6,
                colliders: [
                    { shape: 'cuboid', parameters: [ half.x, half.y, half.z ], mass: SETTINGS.chassisMass, centerOfMass: SETTINGS.centerOfMass },
                    { shape: 'cuboid', parameters: [ 0.35, 0.15, half.z * 0.8 ], position: { x: - 0.2, y: half.y + 0.15, z: 0 }, mass: 0 }, // cab
                ],
            }
        )
        this.body = this.object.physical.body
        this.spawn = { position, rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w } }
    }

    setWheels()
    {
        const { wheel } = SETTINGS
        this.controller = this.game.physics.world.createVehicleController(this.body)

        const positions = [
            [ wheel.offsetX, wheel.connectionY, wheel.offsetZ ], // front right (+X forward, +Z right)
            [ wheel.offsetX, wheel.connectionY, - wheel.offsetZ ], // front left
            [ - wheel.offsetX, wheel.connectionY, wheel.offsetZ ],
            [ - wheel.offsetX, wheel.connectionY, - wheel.offsetZ ],
        ]
        this.wheelPositions = positions
        for(let i = 0; i < 4; i++)
        {
            const [ x, y, z ] = positions[i]
            this.controller.addWheel({ x, y, z }, { x: 0, y: - 1, z: 0 }, { x: 0, y: 0, z: 1 }, wheel.restLength, wheel.radius)
            this.controller.setWheelMaxSuspensionTravel(i, wheel.maxTravel)
            this.controller.setWheelSuspensionStiffness(i, wheel.stiffness)
            this.controller.setWheelSuspensionCompression(i, wheel.compression)
            this.controller.setWheelSuspensionRelaxation(i, wheel.relaxation)
            this.controller.setWheelMaxSuspensionForce(i, wheel.maxForce)
            this.controller.setWheelFrictionSlip(i, wheel.frictionSlip)
            this.controller.setWheelSideFrictionStiffness(i, wheel.sideFriction)
        }
    }

    // Input -> { throttle -1..1, steer -1..1 (+ = left), boost }. Pure function of the action state.
    readInput()
    {
        const actions = this.game.inputs.actions
        let throttle = (actions.get('forward').active ? 1 : 0) - (actions.get('backward').active ? 1 : 0)
        let steer = (actions.get('left').active ? 1 : 0) - (actions.get('right').active ? 1 : 0)

        const stick = actions.get('moveStick').value
        if(stick && typeof stick === 'object' && stick.active)
        {
            if(Math.abs(stick.y) > Math.abs(throttle))
                throttle = - stick.y
            if(Math.abs(stick.x) > Math.abs(steer))
                steer = - stick.x
        }

        this.control.throttle = Math.max(- 1, Math.min(1, throttle))
        this.control.steer = Math.max(- 1, Math.min(1, steer))
        this.control.boost = actions.get('run').active
        return this.control
    }

    fixedUpdate()
    {
        this.fixedSteps++
        const dt = this.game.ticker.fixedDeltaScaled
        const body = this.body

        // Fell off the course: put it back on the respawn (deterministic, fixed-step only)
        if(body.translation().y < SETTINGS.fallLimit)
            this.reset()

        const control = this.readInput()

        // Signed forward speed along the chassis +X axis
        const q = body.rotation()
        const v = body.linvel()
        const fx = 1 - 2 * (q.y * q.y + q.z * q.z)
        const fy = 2 * (q.x * q.y + q.w * q.z)
        const fz = 2 * (q.x * q.z - q.w * q.y)
        this.speed = v.x * fx + v.y * fy + v.z * fz

        const top = control.boost ? SETTINGS.topSpeedBoost : SETTINGS.topSpeed
        let engine = 0
        let brake = 0
        if(control.throttle > 0)
        {
            if(this.speed < - 0.5)
                brake = SETTINGS.brake
            else if(this.speed < top)
                engine = control.throttle * SETTINGS.engineForce * (control.boost ? SETTINGS.boostMultiplier : 1)
        }
        else if(control.throttle < 0)
        {
            if(this.speed > 0.5)
                brake = SETTINGS.brake
            else if(this.speed > - SETTINGS.reverseTopSpeed)
                engine = control.throttle * SETTINGS.engineForce * 0.6
        }
        else
        {
            brake = SETTINGS.idleBrake
        }

        // Less steering lock at speed
        const speedRatio = Math.min(1, Math.abs(this.speed) / SETTINGS.topSpeed)
        const lock = SETTINGS.steering + (SETTINGS.steeringHighSpeed - SETTINGS.steering) * speedRatio
        const steering = control.steer * lock

        this.controller.setWheelSteering(0, steering)
        this.controller.setWheelSteering(1, steering)
        for(let i = 0; i < 4; i++)
        {
            this.controller.setWheelEngineForce(i, engine)
            this.controller.setWheelBrake(i, brake)
        }

        this.controller.updateVehicle(dt)
    }

    reset()
    {
        this.resets++
        const { position, rotation } = this.spawn
        this.body.setTranslation(position, true)
        this.body.setRotation(rotation, true)
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        this.game.objects.snapInterpolation(this.object)
    }

    // Visual pose between the last two physics steps (what the camera follows)
    get position()
    {
        return this.model.position
    }

    // Per frame, visual only
    update()
    {
        const { wheel } = SETTINGS
        for(let i = 0; i < 4; i++)
        {
            const pivot = this.wheelMeshes[i]
            const length = this.controller.wheelSuspensionLength(i) ?? wheel.restLength
            const [ x, y, z ] = this.wheelPositions[i]
            pivot.position.set(x, y - length, z)
            pivot.rotation.y = this.controller.wheelSteering(i) ?? 0
            pivot.userData.roll.rotation.z = - (this.controller.wheelRotation(i) ?? 0)
        }

        // Minimal camera follow (T1.6 replaces it): the view tracks the interpolated visual, not the body
        const tracked = this.game.view.focusPoint.trackedPosition
        tracked.x = this.model.position.x
        tracked.z = this.model.position.z
    }
}
