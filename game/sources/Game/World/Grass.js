// Adapted from dgreenheck/tidewater (MIT, (c) 2026 DRG Software Solutions LLC)
import * as THREE from 'three/webgpu'
import { attribute, color, cos, float, length, mix, positionLocal, sin, smoothstep, uniform, uv, vec3 } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

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

const DEFAULT_BOUNDS = {
    minX: -37.3,
    maxX: 37.3,
    minZ: -49,
    maxZ: 24,
}

/**
 * Stylized Tidewater-tech instanced cerrado grass with 3-tier LOD width compensation
 * (single InstancedMesh draw call, strictly masked to dry terrain in origens_terrain.png).
 */
export class Grass
{
    constructor(options = {})
    {
        this.game = Game.getInstance()
        this.uTime = uniform(0)
        this.uPlayerPos = uniform(new THREE.Vector3())
        this.uCamPos = uniform(new THREE.Vector3())
        this.uBendRadius = uniform(1.35)
        this.uBendStrength = uniform(0.75)

        this.bounds = options.bounds || DEFAULT_BOUNDS
        this.terrainTexture = options.terrainTexture || null

        const tier = this.game.quality?.tier || 'Q0'
        this.targetCount = tier === 'Q0' ? 2400 : (tier === 'Q1' ? 520 : 320)
        this.instances = this.sampleInstances(this.targetCount)
        this.mesh = this.createMesh(this.instances)

        this.game.scene.add(this.mesh)

        this._onTick = () => this.update()
        this.game.ticker.events.on('tick', this._onTick, 6)
    }

    extractTerrainPixels()
    {
        const img = this.terrainTexture?.image
        if(!img || !img.width || !img.height || typeof document === 'undefined')
            return null

        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if(!ctx)
            return null

        ctx.drawImage(img, 0, 0)
        try
        {
            return ctx.getImageData(0, 0, img.width, img.height)
        }
        catch
        {
            return null
        }
    }

    sampleInstances(targetCount)
    {
        const pixels = this.extractTerrainPixels()
        if(!pixels)
            return []

        const rand = mulberry32(20250412)
        const list = []
        const spanX = this.bounds.maxX - this.bounds.minX
        const spanZ = this.bounds.maxZ - this.bounds.minZ
        const maxAttempts = targetCount * 24

        for(let i = 0; i < maxAttempts && list.length < targetCount; i++)
        {
            const u = rand()
            const v = rand()
            const px = Math.min(pixels.width - 1, Math.floor(u * pixels.width))
            const py = Math.min(pixels.height - 1, Math.floor(v * pixels.height))
            const idx = (py * pixels.width + px) * 4
            const maskR = pixels.data[idx]
            const maskG = pixels.data[idx + 1]
            const maskB = pixels.data[idx + 2]
            const elevA = pixels.data[idx + 3]

            // Strictly dry cerrado grass zones only: G >= 128, no water (B), no laterite road (R), inside terrain (A > 0)
            if(maskG < 128 || maskB >= 32 || maskR >= 32 || elevA === 0)
                continue

            const x = this.bounds.minX + u * spanX
            const z = this.bounds.minZ + v * spanZ
            const y = (elevA / 255) * 3.2 - 0.6
            const scale = 0.72 + rand() * 0.55
            const angle = rand() * Math.PI * 2
            const tierRoll = rand()
            const lodTier = tierRoll < 0.30 ? 0 : (tierRoll < 0.65 ? 1 : 2)

            list.push({ x, y, z, scale, angle, lodTier })
        }

        return list
    }

    createBladeGeometry(instances)
    {
        // Three crossed 3-segment tapered cerrado grass blades per clump
        const positions = []
        const normals = []
        const uvs = []
        const indices = []

        const bladeAngles = [ 0, Math.PI / 3, (2 * Math.PI) / 3 ]
        const segments = 3
        const baseHalfWidth = 0.052
        const height = 0.48

        let vertOffset = 0
        for(let b = 0; b < bladeAngles.length; b++)
        {
            const rot = bladeAngles[b]
            const ca = Math.cos(rot)
            const sa = Math.sin(rot)
            const ox = Math.cos(rot + 1.1) * 0.045
            const oz = Math.sin(rot + 1.1) * 0.045
            for(let s = 0; s <= segments; s++)
            {
                const t = s / segments
                const w = baseHalfWidth * (1 - t * 0.88)
                const y = t * height
                const bendBack = t * t * 0.065

                positions.push(
                    (-w) * ca - bendBack * sa + ox, y, (-w) * sa + bendBack * ca + oz,
                    w * ca - bendBack * sa + ox, y, w * sa + bendBack * ca + oz
                )
                normals.push(0, 1, 0, 0, 1, 0)
                uvs.push(0, t, 1, t)
            }

            for(let s = 0; s < segments; s++)
            {
                const a = vertOffset + s * 2
                const bIdx = a + 1
                const c = a + 2
                const d = a + 3
                indices.push(a, bIdx, c, bIdx, d, c)
            }
            vertOffset += (segments + 1) * 2
        }

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
        geometry.setIndex(indices)

        const count = Math.max(1, instances.length)
        const rootPositions = new Float32Array(count * 3)
        const bladeAnglesAttr = new Float32Array(count)
        const bladeTiersAttr = new Float32Array(count)

        for(let i = 0; i < instances.length; i++)
        {
            const inst = instances[i]
            rootPositions[i * 3] = inst.x
            rootPositions[i * 3 + 1] = inst.y
            rootPositions[i * 3 + 2] = inst.z
            bladeAnglesAttr[i] = inst.angle
            bladeTiersAttr[i] = inst.lodTier
        }

        geometry.setAttribute('aRootPos', new THREE.InstancedBufferAttribute(rootPositions, 3))
        geometry.setAttribute('aBladeAngle', new THREE.InstancedBufferAttribute(bladeAnglesAttr, 1))
        geometry.setAttribute('aBladeTier', new THREE.InstancedBufferAttribute(bladeTiersAttr, 1))
        return geometry
    }

    createMaterial()
    {
        const oliveBase = color('#5a7a2c')
        const goldTip = color('#c4ae42')
        const grassColor = mix(oliveBase, goldTip, uv().y.pow(0.85))

        const material = new MeshDefaultMaterial({
            colorNode: grassColor,
            side: THREE.DoubleSide,
            hasCoreShadows: true,
            hasDropShadows: false,
            hasLightBounce: false,
            hasVertexAo: false,
            hasWater: false,
            hasFog: true,
            hasReveal: true,
        })

        const rootPos = attribute('aRootPos', 'vec3')
        const bladeAngle = attribute('aBladeAngle', 'float')
        const bladeTier = attribute('aBladeTier', 'float')

        const camDist = length(this.uCamPos.xz.sub(rootPos.xz))
        // 3-tier Tidewater LOD taper: T2 fades [16..24], T1 fades [28..40], T0 fades [50..68]
        const fadeT2 = float(1).sub(smoothstep(float(16.0), float(24.0), camDist))
        const fadeT1 = float(1).sub(smoothstep(float(28.0), float(40.0), camDist))
        const fadeT0 = float(1).sub(smoothstep(float(50.0), float(68.0), camDist))
        const isT0 = float(1).sub(smoothstep(float(0.0), float(0.5), bladeTier))
        const isT2 = smoothstep(float(1.5), float(2.0), bladeTier)
        const isT1 = float(1).sub(isT0).sub(isT2)
        const lodScale = fadeT0.mul(isT0).add(fadeT1.mul(isT1)).add(fadeT2.mul(isT2))
        const widthComp = float(1).add(smoothstep(float(16.0), float(48.0), camDist).mul(0.45))

        const ca = cos(bladeAngle)
        const sa = sin(bladeAngle)
        const px = positionLocal.x.mul(widthComp).mul(lodScale)
        const pz = positionLocal.z.mul(widthComp).mul(lodScale)
        const rotX = px.mul(ca).sub(pz.mul(sa))
        const rotZ = px.mul(sa).add(pz.mul(ca))

        const tipWeight = uv().y.pow(1.5)
        const toBlade = rootPos.xz.sub(this.uPlayerPos.xz)
        const dist = toBlade.length().max(0.001)
        const pushDir = toBlade.div(dist)
        const bendFactor = float(1).sub(dist.div(this.uBendRadius).clamp(0, 1)).pow(2)

        const windX = sin(this.uTime.mul(0.95).add(rootPos.x.mul(0.35)).add(rootPos.z.mul(0.25))).mul(0.05).mul(tipWeight)
        const windZ = cos(this.uTime.mul(0.8).add(rootPos.z.mul(0.32))).mul(0.04).mul(tipWeight)

        const bendXZ = pushDir.mul(bendFactor.mul(this.uBendStrength).mul(tipWeight))
        const bendY = bendFactor.mul(0.20).mul(tipWeight)

        material.positionNode = vec3(
            rotX.add(windX).add(bendXZ.x).mul(lodScale),
            positionLocal.y.sub(bendY).mul(lodScale),
            rotZ.add(windZ).add(bendXZ.y).mul(lodScale)
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
        mesh.count = instances.length
        mesh.instanceMatrix.needsUpdate = true
        mesh.userData.preventMaterialOverride = true

        return mesh
    }

    update()
    {
        this.uTime.value = this.game.ticker.elapsed
        const camPos = this.game.view?.camera?.position
        if(camPos)
            this.uCamPos.value.copy(camPos)
        const pos = this.game.player?.controller?.body?.translation()
        if(pos)
            this.uPlayerPos.value.set(pos.x, pos.y, pos.z)
    }

    dispose()
    {
        this.game?.ticker?.events?.off?.('tick', this._onTick)
        if(this.mesh)
        {
            this.mesh.removeFromParent()
            this.mesh.geometry?.dispose()
            this.mesh.material?.dispose()
            this.mesh = null
        }
    }
}
