// Kinematic moving platform (plan T1.5, docs/PLAN-3D.md 8 T1.5): shuttles a kinematicPositionBased body
// deterministically between two reference points on `fixedTick` (order 2, before Player and Physics).
//
// Determinism: advances by `steps * fixedDelta` (never Date.now / performance.now / frame delta). Exposes this step's
// `delta` and `velocity` so CharacterController carries the player and inherits platform velocity on jump takeoff.
import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

export class MovingPlatform
{
    constructor({ object, start, end, speed = 2, pause = 0.5, userData = {} })
    {
        this.game = Game.getInstance()
        this.object = object
        this.object.managedReset = true
        this.body = object.physical.body
        this.bodyHandle = this.body.handle
        this.colliderHandles = new Set(object.physical.colliders.map((collider) => collider.handle))
        this.userData = { ...userData }

        this.start = start.clone()
        this.end = end.clone()
        this.speed = speed
        this.pause = pause
        this.distance = this.start.distanceTo(this.end)
        this.travel = this.speed > 0 && this.distance > 0 ? this.distance / this.speed : 0
        this.period = 2 * (this.travel + this.pause)
        this.steps = 0

        const initial = this.body.translation()
        this.previousPosition = { x: initial.x, y: initial.y, z: initial.z }
        this.currentPosition = { x: initial.x, y: initial.y, z: initial.z }
        this.delta = { x: 0, y: 0, z: 0 }
        this.velocity = { x: 0, y: 0, z: 0 }
        this.tempPosition = new THREE.Vector3()

        // Order 2, registered before Player: updates delta/velocity before CharacterController.step() reads them,
        // and schedules setNextKinematicTranslation before Physics (order 3) steps Rapier.
        this.game.ticker.events.on('fixedTick', () =>
        {
            this.fixedUpdate(this.game.ticker.fixedDelta)
        }, 2)
    }

    positionAt(time, target = this.tempPosition)
    {
        if(this.period <= 0 || this.travel <= 0)
            return target.copy(this.start)

        const t = ((time % this.period) + this.period) % this.period
        let ratio = 0
        if(t < this.pause)
            ratio = 0
        else if(t < this.pause + this.travel)
            ratio = (t - this.pause) / this.travel
        else if(t < 2 * this.pause + this.travel)
            ratio = 1
        else
            ratio = 1 - (t - 2 * this.pause - this.travel) / this.travel
        return target.lerpVectors(this.start, this.end, ratio)
    }

    ownsCollider(collider)
    {
        if(!collider)
            return false
        if(this.colliderHandles.has(collider.handle))
            return true
        const parent = collider.parent?.()
        return parent ? parent.handle === this.bodyHandle : false
    }

    fixedUpdate(dt)
    {
        this.steps++
        const target = this.positionAt(this.steps * dt)

        this.previousPosition.x = this.currentPosition.x
        this.previousPosition.y = this.currentPosition.y
        this.previousPosition.z = this.currentPosition.z

        this.currentPosition.x = target.x
        this.currentPosition.y = target.y
        this.currentPosition.z = target.z

        this.delta.x = this.currentPosition.x - this.previousPosition.x
        this.delta.y = this.currentPosition.y - this.previousPosition.y
        this.delta.z = this.currentPosition.z - this.previousPosition.z

        this.velocity.x = this.delta.x / dt
        this.velocity.y = this.delta.y / dt
        this.velocity.z = this.delta.z / dt

        this.body.setNextKinematicTranslation({ x: target.x, y: target.y, z: target.z })
    }

    reset()
    {
        this.steps = 0
        this.previousPosition.x = this.start.x
        this.previousPosition.y = this.start.y
        this.previousPosition.z = this.start.z
        this.currentPosition.x = this.start.x
        this.currentPosition.y = this.start.y
        this.currentPosition.z = this.start.z
        this.delta.x = this.delta.y = this.delta.z = 0
        this.velocity.x = this.velocity.y = this.velocity.z = 0

        const pose = { x: this.start.x, y: this.start.y, z: this.start.z }
        this.body.setTranslation(pose, true)
        this.body.setNextKinematicTranslation(pose)
        if(this.object.visual)
            this.object.visual.object3D.position.copy(this.start)
        this.object.needsUpdate = true
        this.game.objects.snapInterpolation(this.object)
    }
}
