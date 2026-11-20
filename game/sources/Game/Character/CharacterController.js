// Platformer character controller on top of Rapier's KinematicCharacterController (plan T1.2, docs/PLAN-3D.md 3.1/3.2).
//
// The body is a kinematic capsule (radius 0.28 m, total height 1.2 m: the greybox stand-in). The platformer is OUR layer:
// wanted velocity -> `computeColliderMovement` -> `computedMovement` -> `setNextKinematicTranslation`. The world gravity
// is not used: gravity, jump (coyote, buffer, variable height) and the ribbon glide (T1.3) live in `step()`.
//
// Determinism: `step()` is called from 'fixedTick' only, with dt = Ticker.FIXED_DELTA (REAL seconds, independent of
// Time.scale and of the frame delta). No Date.now / performance.now / Math.random in here. Tunables: data/feel.js.
//
// Render interpolation is NOT done here: the body is created through Objects.add(), whose capture()/update() already
// interpolate every non-fixed body between the last two physics steps with `ticker.alpha`.
import { Game } from '../Game.js'
import { Events } from '../Events.js'
import { feel } from '../../data/feel.js'

const DEG = Math.PI / 180
const GRAVITY_FOR_LEAN = 9.81

// Ease-out exponent so that the 0 -> runSpeed curve `1 - (1 - t / T)^p` is at 50% after `accelHalfTime`
function accelExponent(move)
{
    const ratio = Math.min(Math.max(move.accelHalfTime / move.accelTime, 1e-3), 0.999)
    return Math.log(0.5) / Math.log(1 - ratio)
}

export class CharacterController
{
    // `object`: the result of game.objects.add() with a kinematicPositionBased physical (no collider yet)
    constructor(object, yaw = 0)
    {
        this.game = Game.getInstance()
        this.events = new Events() // 'skid'
        this.object = object
        this.body = object.physical.body

        const RAPIER = this.game.RAPIER
        const world = this.game.physics.world

        // Capsule collider. Collision groups: same as a "floor" (interacts with the level and with 'object' bodies)
        const description = RAPIER.ColliderDesc
            .capsule(feel.body.halfHeight, feel.body.radius)
            .setFriction(0)
            .setCollisionGroups(this.game.physics.categories.floor)
        this.collider = world.createCollider(description, this.body)
        object.physical.colliders.push(this.collider)

        this.controller = world.createCharacterController(feel.kcc.offset)
        this.controller.setUp({ x: 0, y: 1, z: 0 })
        this.controller.setSlideEnabled(true)
        this.applySettings()

        // Simulation state
        this.velocity = { x: 0, y: 0, z: 0 } // m/s (x, z: horizontal)
        this.grounded = false
        this.yaw = yaw // rad, 0 faces -Z
        this.lean = 0 // rad, visual bank (read by the Player every frame)
        this.skidTimer = 0 // s left of the skid brake
        this.speed = 0 // horizontal speed commanded this step (m/s)
        this.movedSpeed = 0 // horizontal speed actually achieved this step (m/s, from the computed movement)
        this.slopeAngle = 0 // rad of the ground under the feet (0 when airborne)
        this.steps = 0

        // Jump state
        this.coyoteTimer = 0 // s left to still jump after leaving the ground
        this.bufferTimer = 0 // s left of a remembered jump press
        this.jumping = false // rising from a jump that has not been cut yet
        this.jumpStartY = 0
        this.gliding = false
        this.glideTimer = 0
        this.glideUsed = false
        this.bumps = 0 // head hits (ceiling) since the start
        this.lastLandSpeed = 0 // m/s downward speed of the last landing

        const translation = this.body.translation()
        this.spawn = { x: translation.x, y: translation.y, z: translation.z, yaw }
        this.next = { x: translation.x, y: translation.y, z: translation.z }
        this.body.setNextKinematicRotation(this.yawQuaternion())
    }

    // KCC parameters are cheap setters: re-applied when a value changes in the debug panel
    applySettings()
    {
        const kcc = feel.kcc
        const controller = this.controller
        controller.setOffset(kcc.offset)
        controller.setMaxSlopeClimbAngle(kcc.maxSlopeClimbAngle * DEG)
        controller.setMinSlopeSlideAngle(kcc.minSlopeSlideAngle * DEG)
        controller.enableAutostep(kcc.autostepHeight, kcc.autostepMinWidth, kcc.autostepDynamic)
        controller.enableSnapToGround(kcc.snapToGround)
        controller.setCharacterMass(kcc.characterMass)
        controller.setApplyImpulsesToDynamicBodies(kcc.applyImpulsesToDynamicBodies)
    }

    yawQuaternion()
    {
        return { x: 0, y: Math.sin(this.yaw / 2), z: 0, w: Math.cos(this.yaw / 2) }
    }

    // Teleport (spawn, fall): no interpolation across the jump
    teleport(x, y, z, yaw = this.yaw)
    {
        this.yaw = yaw
        this.velocity.x = this.velocity.y = this.velocity.z = 0
        this.skidTimer = 0
        this.lean = 0
        this.grounded = false
        this.coyoteTimer = this.bufferTimer = this.glideTimer = 0
        this.jumping = this.gliding = this.glideUsed = false
        this.body.setTranslation({ x, y, z }, true)
        this.body.setRotation(this.yawQuaternion(), true)
        this.body.setNextKinematicTranslation({ x, y, z })
        this.body.setNextKinematicRotation(this.yawQuaternion())
        this.game.physics.world.propagateModifiedBodyPositionsToColliders() // the KCC queries the collider, which would lag a step
        this.next.x = x
        this.next.y = y
        this.next.z = z
        this.game.objects.snapInterpolation(this.object)
    }

    respawn()
    {
        this.teleport(this.spawn.x, this.spawn.y, this.spawn.z, this.spawn.yaw)
    }

    // Advance the ground speed along the wanted direction on the ease-out curve (state-free: the curve position is
    // recovered from the current speed, so any starting speed, walk -> run included, follows the same curve)
    advanceCurve(speed, dt)
    {
        const move = feel.move
        const exponent = accelExponent(move)
        const top = move.runSpeed
        const ratio = Math.min(Math.max(speed / top, 0), 1)
        const progress = 1 - Math.pow(1 - ratio, 1 / exponent)
        const advanced = Math.min(progress + dt / move.accelTime, 1)
        return top * (1 - Math.pow(1 - advanced, exponent))
    }

    get riseGravity()
    {
        return 2 * feel.jump.height / (feel.jump.apexTime * feel.jump.apexTime)
    }

    get jumpSpeed()
    {
        return 2 * feel.jump.height / feel.jump.apexTime
    }

    // Distance from the feet to the ground below (Infinity beyond `max`)
    heightAboveGround(max)
    {
        const origin = this.body.translation()
        const half = feel.body.halfHeight + feel.body.radius
        const ray = new this.game.RAPIER.Ray(origin, { x: 0, y: - 1, z: 0 })
        const hit = this.game.physics.world.castRay(ray, max + half, true, undefined, undefined, undefined, this.body)
        return hit ? hit.timeOfImpact - half : Infinity
    }

    // One fixed step. input: { x, z } unit vector in world space (or zero), `speed` wanted speed in m/s (0 = no input),
    // `jumpPressed` (edge, latched by the Player) and `jumpHeld`.
    step(input, dt)
    {
        const move = feel.move
        const air = feel.air
        const velocity = this.velocity
        const hasInput = input.speed > 0 && (input.x !== 0 || input.z !== 0)
        const decelRate = move.runSpeed / move.decelTime

        // --- Jump / glide decisions (before the horizontal model: a takeoff step already uses the air control)
        const jump = feel.jump
        const startedGrounded = this.grounded
        this.coyoteTimer = this.grounded ? jump.coyoteTime : Math.max(0, this.coyoteTimer - dt)
        this.bufferTimer = input.jumpPressed ? jump.bufferTime : Math.max(0, this.bufferTimer - dt)

        if(this.bufferTimer > 0 && (this.grounded || this.coyoteTimer > 0))
        {
            this.bufferTimer = 0
            this.coyoteTimer = 0
            this.grounded = false
            this.jumping = true
            this.gliding = false
            this.glideUsed = false
            this.jumpStartY = this.body.translation().y
            velocity.y = this.jumpSpeed
            this.events.trigger('jump', [ { speed: this.jumpSpeed } ])
        }
        else if(input.jumpPressed && !this.grounded && !this.glideUsed && this.heightAboveGround(feel.glide.minHeight) >= feel.glide.minHeight)
        {
            // 2nd press in the air: the ribbon opens like a kite (small lift, then reduced gravity while held)
            this.bufferTimer = 0
            this.glideUsed = true
            this.gliding = true
            this.glideTimer = 0
            this.jumping = false
            velocity.y = Math.max(velocity.y, Math.sqrt(2 * this.riseGravity * feel.glide.impulseHeight))
            this.events.trigger('glide', [ {} ])
        }

        // --- Skid: reversing hard at speed brakes for a moment and ignores the input
        let speed = Math.hypot(velocity.x, velocity.z)
        if(this.skidTimer > 0)
            this.skidTimer = Math.max(0, this.skidTimer - dt)
        else if(hasInput && this.grounded && speed > feel.skid.minSpeed)
        {
            const cosine = (velocity.x * input.x + velocity.z * input.z) / speed
            if(cosine < Math.cos(feel.skid.angle * DEG))
            {
                this.skidTimer = feel.skid.duration
                this.events.trigger('skid', [ { x: velocity.x / speed, z: velocity.z / speed, speed } ])
            }
        }
        const braking = this.skidTimer > 0

        // --- Horizontal velocity
        if(this.grounded)
        {
            if(!hasInput || braking)
            {
                speed = Math.max(0, speed - decelRate * dt)
                const scale = speed > 0 ? speed / Math.hypot(velocity.x, velocity.z) : 0
                velocity.x *= scale
                velocity.z *= scale
            }
            else
            {
                let along = velocity.x * input.x + velocity.z * input.z
                let perpX = velocity.x - along * input.x
                let perpZ = velocity.z - along * input.z

                // Friction on the sideways component (turning without sliding)
                const perp = Math.hypot(perpX, perpZ)
                if(perp > 0)
                {
                    const kept = Math.max(0, perp - move.groundFriction * dt) / perp
                    perpX *= kept
                    perpZ *= kept
                }

                if(along < 0)
                    along = Math.min(along + decelRate * dt, 0) // brake first when reversing below the skid threshold
                else if(along < input.speed)
                    along = Math.min(this.advanceCurve(along, dt), input.speed)
                else
                    along = Math.max(input.speed, along - decelRate * dt)

                velocity.x = input.x * along + perpX
                velocity.z = input.z * along + perpZ
            }
        }
        else
        {
            // Air control: accelerate toward the wanted velocity, decelerate with no input
            if(hasInput)
            {
                const dx = input.x * input.speed - velocity.x
                const dz = input.z * input.speed - velocity.z
                const length = Math.hypot(dx, dz)
                const maxDelta = air.accel * dt
                const scale = length > maxDelta ? maxDelta / length : 1
                velocity.x += dx * scale
                velocity.z += dz * scale
            }
            else
            {
                speed = Math.max(0, speed - air.decel * dt)
                const current = Math.hypot(velocity.x, velocity.z)
                const scale = current > 0 ? speed / current : 0
                velocity.x *= scale
                velocity.z *= scale
            }
        }

        if(Math.hypot(velocity.x, velocity.z) < move.stopSpeed)
            velocity.x = velocity.z = 0

        // --- Vertical velocity: own gravity (rise g, fall 1.7 g), variable height, glide. Velocity-Verlet: the position
        // follows the exact parabola at every step boundary.
        let verticalStep = 0
        if(this.grounded)
            velocity.y = 0
        else
        {
            // Release while rising: cap the speed, but only once the minimum height has been gained
            if(this.jumping && velocity.y > 0 && !input.jumpHeld)
            {
                const gRise = this.riseGravity
                const deferHeight = Math.max(0, jump.minHeight - jump.cutSpeed * jump.cutSpeed / (2 * gRise))
                if(velocity.y > jump.cutSpeed && this.body.translation().y - this.jumpStartY >= deferHeight)
                {
                    velocity.y = jump.cutSpeed
                    this.jumping = false
                }
            }

            let scale = 1
            if(this.gliding)
            {
                // The lift is the impulse (+0.6 m); the reduced gravity only slows the DESCENT (the ribbon floats)
                if(this.glideTimer < feel.glide.maxTime && (input.jumpHeld || !feel.glide.requireHold))
                {
                    if(velocity.y <= 0)
                    {
                        scale = feel.glide.gravityScale
                        this.glideTimer += dt
                    }
                }
                else
                    this.gliding = false
            }

            const gravity = this.riseGravity * (velocity.y > 0 ? 1 : jump.fallMultiplier) * scale
            const before = velocity.y
            velocity.y = Math.max(before - gravity * dt, - jump.terminal)
            verticalStep = (before + velocity.y) / 2 * dt
        }

        this.speed = Math.hypot(velocity.x, velocity.z)

        // --- Move through the KCC
        // Uphill the KCC projects the wanted move onto the slope (it keeps cos(slope) of it along the slope, cos^2 horizontally):
        // scale it by 1/cos so the horizontal speed keeps ~cos(slope) of the flat speed (87% at 30 deg).
        let slopeFactor = 1
        if(startedGrounded && this.grounded && this.slopeAngle > 0.01 && this.slopeAngle <= move.slopeMaxAngle * DEG)
            slopeFactor = 1 + (Math.min(1 / Math.cos(this.slopeAngle), move.slopeMaxFactor) - 1) * move.slopeCompensation

        const desired = { x: velocity.x * dt * slopeFactor, y: verticalStep, z: velocity.z * dt * slopeFactor }

        // Snap-to-ground would glue the character to the floor on takeoff
        if(velocity.y > 0)
            this.controller.disableSnapToGround()
        else
            this.controller.enableSnapToGround(feel.kcc.snapToGround)

        this.controller.computeColliderMovement(this.collider, desired)
        const movement = this.controller.computedMovement()
        const wasAirborne = !this.grounded
        const fallSpeed = - velocity.y
        this.grounded = this.controller.computedGrounded() && velocity.y <= 0

        const current = this.body.translation()
        this.next.x = current.x + movement.x
        this.next.y = current.y + movement.y
        this.next.z = current.z + movement.z

        // Blocked (wall, corner): the velocity follows what was actually achieved, so no speed is stored "into" the wall.
        // Not while climbing (slope or step): the KCC projects the move onto the slope and a climb is progress, not a block.
        const desiredLength = Math.hypot(desired.x, desired.z)
        const movedLength = Math.hypot(movement.x, movement.z)
        this.movedSpeed = movedLength / dt
        if(desiredLength > 0 && (!startedGrounded || movement.y <= 1e-4) && movedLength < desiredLength * 0.9)
        {
            velocity.x = movement.x / dt
            velocity.z = movement.z / dt
        }
        this.slopeAngle = 0
        if(startedGrounded && this.grounded && movedLength > 1e-6)
            this.slopeAngle = Math.atan2(movement.y, movedLength)

        // Head hit (ceiling): rising stops
        if(desired.y > 0 && movement.y < desired.y - 1e-4)
        {
            velocity.y = 0
            this.jumping = false
            this.bumps++
            this.events.trigger('bump', [ { y: current.y + movement.y } ])
        }

        // Landing
        if(this.grounded && wasAirborne)
        {
            this.lastLandSpeed = fallSpeed
            this.jumping = false
            this.gliding = false
            this.glideUsed = false
            this.events.trigger('land', [ { speed: fallSpeed } ])
        }

        // --- Body yaw (slerp toward the heading) and visual lean
        let heading = null
        if(hasInput && !braking)
            heading = Math.atan2(- input.x, - input.z)
        else if(this.speed > 0.5)
            heading = Math.atan2(- velocity.x, - velocity.z)

        let yawDelta = 0
        if(heading !== null)
        {
            let difference = heading - this.yaw
            difference = Math.atan2(Math.sin(difference), Math.cos(difference)) // shortest signed angle
            const maxStep = feel.turn.yawRate * DEG * dt
            yawDelta = Math.max(- maxStep, Math.min(maxStep, difference))
            this.yaw += yawDelta
            this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw))
        }

        // Bank angle of a physical turn: atan(v * omega / g), clamped
        const leanMax = feel.turn.leanMax * DEG
        const yawRate = yawDelta / dt
        const target = Math.max(- leanMax, Math.min(leanMax, Math.atan(this.speed * yawRate / GRAVITY_FOR_LEAN) * feel.turn.leanGain))
        this.lean += (target - this.lean) * Math.min(1, feel.turn.leanSmoothing * dt)

        this.body.setNextKinematicTranslation(this.next)
        this.body.setNextKinematicRotation(this.yawQuaternion())
        this.steps++

        // Fell off the world
        if(this.next.y < feel.body.fallLimit)
            this.respawn()
    }
}
