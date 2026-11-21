import * as THREE from 'three/webgpu'
import { attribute, color, cos, float, mix, positionLocal, sin, uniform, uv, vec2, vec3 } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

const DEFAULT_BOUNDS = {
    minX: -37.3,
    maxX: 37.3,
    minZ: -49.0,
    maxZ: 24.0,
}

function mulberry32(seed)
{
    let a = seed >>> 0
    return () =>
    {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * Instanced cerrado grass scattered from `origens_terrain.png` (G = mask, A = elevation).
 * Renders in 1 draw call via InstancedMesh and bends away from `uPlayerPos` in TSL.
 */
export class Grass
{
    constructor(options = {})
    {
        this.game = Game.getInstance()
        this.terrainTexture = options.terrainTexture || null
        this.bounds = options.bounds || DEFAULT_BOUNDS
        this.q0Count = options.q0Count ?? 1200
        this.q1Count = options.q1Count ?? 450 // 37.5% of Q0 (<= 40%)
        this.q2Count = options.q2Count ?? 300

        this.uPlayerPos = uniform(new THREE.Vector3(0, 0, 0))
        this.uTime = uniform(0)
        this.uBendStrength = uniform(0.65)
        this.uBendRadius = uniform(2.0)

        this.instances = this.sampleInstances(this.q0Count)
        this.mesh = this.createMesh(this.instances)
        this.applyQualityCount(this.game.quality.level)

        this.game.scene.add(this.mesh)

        this.game.quality.events.on('change', (level) =>
        {
            this.applyQualityCount(level)
        })

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 7)
    }

    getTargetCount(level)
    {
        if(level === 0)
            return Math.min(this.q0Count, this.instances.length)
        if(level === 1)
            return Math.min(this.q1Count, this.instances.length)
        return Math.min(this.q2Count, this.instances.length)
    }

    applyQualityCount(level)
    {
        if(this.mesh)
            this.mesh.count = this.getTargetCount(level)
    }

    getInstanceCount()
    {
        return this.mesh ? this.mesh.count : 0
    }

    extractTerrainPixels()
    {
        const img = this.terrainTexture?.image
        if(!img || !img.width || !img.height)
            return null

        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, img.width, img.height)
        return {
            width: img.width,
            height: img.height,
            data: imageData.data,
        }
    }

    sampleInstances(targetCount)
    {
        const pixels = this.extractTerrainPixels()
        const rand = mulberry32(20250412)
        const list = []
        const spanX = this.bounds.maxX - this.bounds.minX
        const spanZ = this.bounds.maxZ - this.bounds.minZ
        const maxAttempts = targetCount * 20

        for(let i = 0; i < maxAttempts && list.length < targetCount; i++)
        {
            const u = rand()
            const v = rand()
            let maskG = 255
            let elevA = 48

            if(pixels)
            {
                const px = Math.min(pixels.width - 1, Math.floor(u * pixels.width))
                const py = Math.min(pixels.height - 1, Math.floor(v * pixels.height))
                const idx = (py * pixels.width + px) * 4
                maskG = pixels.data[idx + 1]
                elevA = pixels.data[idx + 3]
            }

            // Green channel >= 128 marks grass zones
            if(maskG < 128)
                continue

            // Alpha channel encodes normalized terrain elevation
            const x = this.bounds.minX + u * spanX
            const z = this.bounds.minZ + v * spanZ
            const y = (elevA / 255) * 3.5 - 0.65
            const scale = 0.75 + rand() * 0.55
            const angle = rand() * Math.PI * 2

            list.push({ x, y, z, scale, angle })
        }

        return list
    }

    createBladeGeometry(instances)
    {
        // Two crossed tapered 3-segment cerrado grass blades per tuft
        const positions = []
        const normals = []
        const uvs = []
        const indices = []

        const bladeAngles = [ 0, Math.PI * 0.5 ]
        const segments = 3
        const baseHalfWidth = 0.055
        const height = 0.52

        let vertOffset = 0
        for(const rot of bladeAngles)
        {
            const ca = Math.cos(rot)
            const sa = Math.sin(rot)
            for(let s = 0; s <= segments; s++)
            {
                const t = s / segments
                const w = baseHalfWidth * (1 - t * 0.88)
                const y = t * height
                const bendBack = t * t * 0.06

                const lx0 = -w
                const lx1 = w
                const lz = bendBack

                positions.push(
                    lx0 * ca - lz * sa, y, lx0 * sa + lz * ca,
                    lx1 * ca - lz * sa, y, lx1 * sa + lz * ca
                )
                normals.push(0, 1, 0, 0, 1, 0)
                uvs.push(0, t, 1, t)
            }

            for(let s = 0; s < segments; s++)
            {
                const a = vertOffset + s * 2
                const b = a + 1
                const c = a + 2
                const d = a + 3
                indices.push(a, b, c, b, d, c)
            }
            vertOffset += (segments + 1) * 2
        }

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
        geometry.setIndex(indices)

        const rootPositions = new Float32Array(instances.length * 3)
        const angles = new Float32Array(instances.length)
        for(let i = 0; i < instances.length; i++)
        {
            rootPositions[i * 3] = instances[i].x
            rootPositions[i * 3 + 1] = instances[i].y
            rootPositions[i * 3 + 2] = instances[i].z
            angles[i] = instances[i].angle
        }
        geometry.setAttribute('aRootPos', new THREE.InstancedBufferAttribute(rootPositions, 3))
        geometry.setAttribute('aBladeAngle', new THREE.InstancedBufferAttribute(angles, 1))

        return geometry
    }

    createMaterial()
    {
        const rootColor = color('#789e4a')
        const tipColor = color('#c4b454')
        const bladeColor = mix(rootColor, tipColor, uv().y)

        const material = new MeshDefaultMaterial({
            colorNode: bladeColor,
            side: THREE.DoubleSide,
            hasCoreShadows: true,
            hasDropShadows: true,
            hasLightBounce: false,
            hasVertexAo: false,
            hasWater: false,
            hasFog: true,
            hasReveal: true,
        })

        const rootPos = attribute('aRootPos', 'vec3')
        const bladeAngle = attribute('aBladeAngle', 'float')

        const ca = cos(bladeAngle)
        const sa = sin(bladeAngle)
        const rotX = positionLocal.x.mul(ca).sub(positionLocal.z.mul(sa))
        const rotZ = positionLocal.x.mul(sa).add(positionLocal.z.mul(ca))

        const tipWeight = uv().y.pow(1.5)
        const toBlade = rootPos.xz.sub(this.uPlayerPos.xz)
        const dist = toBlade.length().max(0.001)
        const pushDir = toBlade.div(dist)
        const bendFactor = float(1).sub(dist.div(this.uBendRadius).clamp(0, 1)).pow(2)

        const windX = sin(this.uTime.mul(1.8).add(rootPos.x.mul(0.35)).add(rootPos.z.mul(0.25))).mul(0.08).mul(tipWeight)
        const windZ = cos(this.uTime.mul(1.5).add(rootPos.z.mul(0.32))).mul(0.06).mul(tipWeight)

        const bendXZ = pushDir.mul(bendFactor.mul(this.uBendStrength).mul(tipWeight))
        const bendY = bendFactor.mul(0.22).mul(tipWeight)

        material.positionNode = vec3(
            rotX.add(windX).add(bendXZ.x),
            positionLocal.y.sub(bendY),
            rotZ.add(windZ).add(bendXZ.y)
        )

        return material
    }

    createMesh(instances)
    {
        const geometry = this.createBladeGeometry(instances)
        const material = this.createMaterial()
        const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, instances.length))
        mesh.name = 'OrigensGrassInstanced'
        mesh.castShadow = false
        mesh.receiveShadow = true
        mesh.frustumCulled = false

        const dummy = new THREE.Object3D()
        for(let i = 0; i < instances.length; i++)
        {
            const inst = instances[i]
            dummy.position.set(inst.x, inst.y, inst.z)
            dummy.rotation.set(0, 0, 0)
            dummy.scale.setScalar(inst.scale)
            dummy.updateMatrix()
            mesh.setMatrixAt(i, dummy.matrix)
        }
        mesh.instanceMatrix.needsUpdate = true
        return mesh
    }

    update()
    {
        this.uTime.value = this.game.time?.elapsed ?? 0

        const player = this.game.world?.player
        const playerPos = player?.position || player?.model?.position
        if(playerPos)
            this.uPlayerPos.value.copy(playerPos)
    }

    dispose()
    {
        if(this.mesh)
        {
            this.mesh.removeFromParent()
            this.mesh.geometry?.dispose()
            this.mesh.material?.dispose()
            this.mesh = null
        }
    }
}
