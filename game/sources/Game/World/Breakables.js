import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

const BREAKABLE_NAME_RE = /^(crate|platCrate|fence|cerca|breakable)/i
const MAX_SHATTER_PARTICLES = 64

/**
 * Generic breakable crates/fences manager (T2.21a).
 * Discovers dynamic breakables, hooks Stamp shatter FX (1 InstancedMesh draw call),
 * and provides deterministic reset across repeated runs without floor tunneling.
 */
export class Breakables
{
    constructor(world, options = {})
    {
        this.game = Game.getInstance()
        this.world = world
        this.items = []
        this.itemSet = new Set()
        this.resetCount = 0
        this.minY = options.minY ?? -6

        this.world.breakables = this.world.breakables || []
        this.world.initialBreakables = this.world.initialBreakables || []

        this.particles = []
        this.dummy = new THREE.Object3D()
        this.shatterMesh = this.createShatterMesh()

        this.bindEvents()
    }

    createShatterMesh()
    {
        const geometry = new THREE.BoxGeometry(0.16, 0.08, 0.12)
        const material = new THREE.MeshStandardMaterial({
            name: 'breakableShatter',
            color: '#9c6b3f',
            roughness: 0.85,
            metalness: 0.05,
        })
        const mesh = new THREE.InstancedMesh(geometry, material, MAX_SHATTER_PARTICLES)
        mesh.name = 'breakableShatterPool'
        mesh.count = 0
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.frustumCulled = false
        this.game.scene.add(mesh)
        return mesh
    }

    bindEvents()
    {
        this._boundController = null
        this._onBreak = ({ x, y, z }) =>
        {
            this.spawnShatter(x, y, z)
        }

        this.game.ticker.events.on('fixedTick', () =>
        {
            this.fixedUpdate()
        }, 5)

        this.game.ticker.events.on('tick', () =>
        {
            this.updateVisuals()
        }, 6)
    }

    attachController(controller)
    {
        if(!controller || this._boundController === controller)
            return
        this._boundController = controller
        controller.events.on('break', this._onBreak)
    }

    isBreakableObject(object)
    {
        if(!object?.physical || object.physical.type !== 'dynamic')
            return false

        const name = object.visual?.object3D?.name || ''
        const userData = object.visual?.object3D?.userData || {}
        return Boolean(userData.breakable || BREAKABLE_NAME_RE.test(name))
    }

    register(object)
    {
        if(!object?.physical || this.itemSet.has(object))
            return false

        object.managedReset = true
        this.itemSet.add(object)
        this.items.push(object)

        if(!this.world.initialBreakables.includes(object))
            this.world.initialBreakables.push(object)
        if(object.physical.body.isEnabled() && !this.world.breakables.includes(object))
            this.world.breakables.push(object)

        return true
    }

    scan(objects = [])
    {
        let added = 0
        for(const object of objects)
        {
            if(this.isBreakableObject(object) && this.register(object))
                added++
        }
        return added
    }

    spawnShatter(x, y, z)
    {
        const count = 8
        for(let i = 0; i < count; i++)
        {
            if(this.particles.length >= MAX_SHATTER_PARTICLES)
                this.particles.shift()

            const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.35
            const speed = 2.0 + (i % 3) * 0.9
            this.particles.push({
                x,
                y: y + 0.15,
                z,
                vx: Math.cos(angle) * speed,
                vy: 2.6 + (i % 3) * 0.7,
                vz: Math.sin(angle) * speed,
                rx: i * 0.7,
                ry: i * 1.1,
                age: 0,
                life: 0.55,
            })
        }
    }

    fixedUpdate()
    {
        if(!this._boundController && this.game.world?.player?.controller)
            this.attachController(this.game.world.player.controller)

        const waterY = this.game.water?.depthElevation ?? this.minY
        const floorLimit = Math.max(this.minY, waterY)

        for(const object of this.items)
        {
            const body = object.physical?.body
            if(!body || !body.isEnabled() || object.reseting)
                continue

            const pos = body.translation()
            if(pos.y < floorLimit)
                this.resetObject(object)
        }
    }

    resetObject(object)
    {
        if(!object?.physical)
            return

        this.game.objects.cancelPendingReset(object)

        const body = object.physical.body
        const init = object.physical.initialState

        object.reseting = true
        this.game.objects.snapInterpolation(object)

        body.setEnabled(false)
        body.setTranslation(init.position, false)
        body.setRotation(init.rotation, false)
        body.setLinvel({ x: 0, y: 0, z: 0 }, false)
        body.setAngvel({ x: 0, y: 0, z: 0 }, false)
        body.resetForces()
        body.resetTorques()

        if(object.visual)
        {
            if(object.visual.parent && object.visual.parent !== object.visual.object3D.parent)
                object.visual.parent.add(object.visual.object3D)
            object.visual.object3D.position.copy(init.position)
            object.visual.object3D.quaternion.copy(init.rotation)
        }

        if(!this.world.breakables.includes(object))
            this.world.breakables.push(object)

        // Re-enable deterministically after 1 fixed step so Rapier broadphase settles cleanly
        this.game.objects.pendingResets.push({
            object,
            isEnabled: true,
            stepsLeft: 1,
        })
    }

    resetAll()
    {
        this.resetCount++
        for(const object of this.items)
            this.resetObject(object)

        if(this.game.physics?.world)
            this.game.physics.world.propagateModifiedBodyPositionsToColliders()
    }

    updateVisuals()
    {
        if(this.particles.length === 0)
        {
            this.shatterMesh.count = 0
            return
        }

        const dt = this.game.ticker.delta
        let write = 0

        for(let i = 0; i < this.particles.length; i++)
        {
            const p = this.particles[i]
            p.age += dt
            if(p.age >= p.life)
                continue

            p.vy -= 12.0 * dt
            p.x += p.vx * dt
            p.y += p.vy * dt
            p.z += p.vz * dt
            p.rx += 5.0 * dt
            p.ry += 4.0 * dt

            const scale = Math.max(0.01, 1 - p.age / p.life)
            this.dummy.position.set(p.x, p.y, p.z)
            this.dummy.rotation.set(p.rx, p.ry, 0)
            this.dummy.scale.setScalar(scale)
            this.dummy.updateMatrix()
            this.shatterMesh.setMatrixAt(write, this.dummy.matrix)

            this.particles[write] = p
            write++
        }

        this.particles.length = write
        this.shatterMesh.count = write
        if(write > 0)
            this.shatterMesh.instanceMatrix.needsUpdate = true
    }

    getStats()
    {
        let intact = 0
        for(const object of this.items)
        {
            if(object.physical?.body?.isEnabled() || object.reseting)
                intact++
        }
        return {
            total: this.items.length,
            intact,
            broken: this.items.length - intact,
            resets: this.resetCount,
            drawCalls: this.shatterMesh.count > 0 ? 1 : 0,
        }
    }

    dispose()
    {
        if(this._boundController)
            this._boundController.events.off('break', this._onBreak)
        this.shatterMesh.removeFromParent()
        this.shatterMesh.geometry.dispose()
        this.shatterMesh.material.dispose()
    }
}
