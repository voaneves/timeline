import * as THREE from 'three/webgpu'
import { attribute, color } from 'three/tsl'
import { Game } from '../Game.js'
import { feel } from '../../data/feel.js'

const MAX_FOOTPRINTS = 128
const STEP_DISTANCE = 0.52
const FOOT_OFFSET = 0.11
const PRINT_LIFETIME = 6.0

/**
 * Instanced footprints ring buffer (T2.21b).
 * Renders up to 128 boot prints in 1 InstancedMesh draw call, fading smoothly over time.
 */
export class Tracks
{
    constructor(options = {})
    {
        this.game = Game.getInstance()
        this.maxInstances = options.maxInstances ?? MAX_FOOTPRINTS
        this.lifetime = options.lifetime ?? PRINT_LIFETIME
        this.stepDistance = options.stepDistance ?? STEP_DISTANCE

        this.slots = Array.from({ length: this.maxInstances }, () => ({
            active: false,
            age: 0,
            x: 0,
            y: 0,
            z: 0,
            yaw: 0,
            scale: 1,
        }))
        this.cursor = 0
        this.footSide = 1
        this.distanceAccum = 0
        this.lastPos = new THREE.Vector3()
        this.hasLastPos = false
        this.dummy = new THREE.Object3D()

        this.fadeArray = new Float32Array(this.maxInstances)
        this.mesh = this.createMesh()
        this.game.scene.add(this.mesh)

        this._boundController = null
        this._onLand = ({ speed }) =>
        {
            const player = this.game.world?.player
            const controller = player?.controller
            if(!controller)
                return

            const pos = controller.body.translation()
            const feetY = pos.y - (feel.body.halfHeight + feel.body.radius)
            const scale = speed > 6 ? 1.2 : 1.0
            this.stampPair(pos.x, feetY, pos.z, controller.yaw, scale)
        }

        this._tickCallback = () =>
        {
            this.update()
        }
        this.game.ticker.events.on('tick', this._tickCallback, 7)
    }

    createBootGeometry()
    {
        // Flat rounded boot-sole silhouette in XZ (Y = 0)
        const w = 0.065
        const l = 0.115
        const positions = new Float32Array([
            -w * 0.7, 0, -l,
             w * 0.7, 0, -l,
             w,       0, -l * 0.25,
             w * 0.85,0,  l * 0.65,
             w * 0.55,0,  l,
            -w * 0.55,0,  l,
            -w * 0.85,0,  l * 0.65,
            -w,       0, -l * 0.25,
        ])
        const normals = new Float32Array(8 * 3)
        for(let i = 0; i < 8; i++)
            normals[i * 3 + 1] = 1

        const indices = [
            0, 1, 2,
            0, 2, 7,
            7, 2, 3,
            7, 3, 6,
            6, 3, 4,
            6, 4, 5,
        ]

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
        geometry.setIndex(indices)

        this.fadeAttr = new THREE.InstancedBufferAttribute(this.fadeArray, 1)
        this.fadeAttr.setUsage(THREE.DynamicDrawUsage)
        geometry.setAttribute('aFade', this.fadeAttr)

        return geometry
    }

    createMesh()
    {
        const geometry = this.createBootGeometry()
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        })
        material.colorNode = color('#3a2115')
        material.opacityNode = attribute('aFade', 'float').mul(0.55)

        const mesh = new THREE.InstancedMesh(geometry, material, this.maxInstances)
        mesh.name = 'origensFootprints'
        mesh.count = this.maxInstances
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.frustumCulled = false

        this.dummy.scale.set(0, 0, 0)
        this.dummy.updateMatrix()
        for(let i = 0; i < this.maxInstances; i++)
            mesh.setMatrixAt(i, this.dummy.matrix)
        mesh.instanceMatrix.needsUpdate = true

        return mesh
    }

    attachController(controller)
    {
        if(!controller || this._boundController === controller)
            return
        this._boundController = controller
        controller.events.on('land', this._onLand)
    }

    stamp(x, y, z, yaw, scale = 1)
    {
        const waterY = this.game.water?.depthElevation ?? -10
        if(y < waterY + 0.02)
            return

        const slot = this.slots[this.cursor]
        slot.active = true
        slot.age = 0
        slot.x = x
        slot.y = y + 0.015
        slot.z = z
        slot.yaw = yaw
        slot.scale = scale

        this.cursor = (this.cursor + 1) % this.maxInstances
    }

    stampPair(x, y, z, yaw, scale = 1)
    {
        const rightX = Math.cos(yaw) * FOOT_OFFSET
        const rightZ = -Math.sin(yaw) * FOOT_OFFSET
        this.stamp(x + rightX, y, z + rightZ, yaw, scale)
        this.stamp(x - rightX, y, z - rightZ, yaw, scale)
    }

    update()
    {
        const player = this.game.world?.player
        const controller = player?.controller
        if(controller)
        {
            if(this._boundController !== controller)
                this.attachController(controller)

            const visualPos = player.model?.position
            if(visualPos)
            {
                const feetY = visualPos.y - (feel.body.halfHeight + feel.body.radius)
                if(!this.hasLastPos)
                {
                    this.lastPos.set(visualPos.x, feetY, visualPos.z)
                    this.hasLastPos = true
                }
                else if(controller.grounded && !controller.grind?.active)
                {
                    const dx = visualPos.x - this.lastPos.x
                    const dz = visualPos.z - this.lastPos.z
                    const dist = Math.hypot(dx, dz)

                    if(dist > 2.5)
                    {
                        // Teleported: reset distance accumulator
                        this.distanceAccum = 0
                    }
                    else
                    {
                        this.distanceAccum += dist
                        if(this.distanceAccum >= this.stepDistance && controller.movedSpeed > 0.35)
                        {
                            this.distanceAccum = 0
                            this.footSide *= -1
                            const rightX = Math.cos(controller.yaw) * FOOT_OFFSET * this.footSide
                            const rightZ = -Math.sin(controller.yaw) * FOOT_OFFSET * this.footSide
                            this.stamp(visualPos.x + rightX, feetY, visualPos.z + rightZ, controller.yaw, 1)
                        }
                    }
                    this.lastPos.set(visualPos.x, feetY, visualPos.z)
                }
                else
                {
                    this.lastPos.set(visualPos.x, feetY, visualPos.z)
                }
            }
        }

        const dt = this.game.ticker.delta
        let dirtyMatrix = false
        let dirtyFade = false

        for(let i = 0; i < this.maxInstances; i++)
        {
            const slot = this.slots[i]
            if(!slot.active)
                continue

            slot.age += dt
            if(slot.age >= this.lifetime)
            {
                slot.active = false
                this.fadeArray[i] = 0
                this.dummy.scale.set(0, 0, 0)
                this.dummy.updateMatrix()
                this.mesh.setMatrixAt(i, this.dummy.matrix)
                dirtyMatrix = true
                dirtyFade = true
                continue
            }

            const t = slot.age / this.lifetime
            const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4
            this.fadeArray[i] = Math.max(0, fade)

            this.dummy.position.set(slot.x, slot.y, slot.z)
            this.dummy.rotation.set(0, slot.yaw, 0)
            this.dummy.scale.setScalar(slot.scale)
            this.dummy.updateMatrix()
            this.mesh.setMatrixAt(i, this.dummy.matrix)
            dirtyMatrix = true
            dirtyFade = true
        }

        if(dirtyMatrix)
            this.mesh.instanceMatrix.needsUpdate = true
        if(dirtyFade)
            this.fadeAttr.needsUpdate = true
    }

    getStats()
    {
        let active = 0
        for(const slot of this.slots)
        {
            if(slot.active)
                active++
        }
        return {
            capacity: this.maxInstances,
            active,
            drawCalls: 1,
        }
    }

    dispose()
    {
        if(this._tickCallback && this.game?.ticker?.events)
        {
            this.game.ticker.events.off('tick', this._tickCallback)
            this._tickCallback = null
        }
        if(this._boundController)
            this._boundController.events.off('land', this._onLand)
        this.mesh.removeFromParent()
        this.mesh.geometry.dispose()
        this.mesh.material.dispose()
    }
}
