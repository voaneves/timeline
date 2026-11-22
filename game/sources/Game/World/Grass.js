// Adapted from dgreenheck/tidewater & mesqme/infinite-terrain (MIT)
import * as THREE from 'three/webgpu'
import { attribute, color, cos, float, mix, positionLocal, sin, smoothstep, step, uniform, uv, vec3 } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'
import { sampleIslandSurface } from './TerrainHeight.js'

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
 * Exact dry-terrace ground elevation for Origens so zero blades ever float on edges, stairs, houses, or water.
 * Returns null when (x, z) is near a cliff edge, staircase, road, house footprint, or water.
 */
function sampleExactTerraceY(x, z)
{
    if(Math.abs(x) > 27.5 || z < -43.0 || z > 1.2)
        return null

    // Exclude laterite street strip & sidewalk curb
    if(x > -19.5 && x < 17.5 && z > 1.2 && z < 6.4)
        return null

    // Exclude background neighbor houses
    if(x > -18.5 && x < -12.5 && z > 3.2 && z < 7.8)
        return null
    if(x > 13.2 && x < 19.8 && z > 2.8 && z < 7.8)
        return null

    // Exclude O2 1994 house + porch footprint
    if(x > 1.8 && x < 7.2 && z > -11.0 && z < -5.5)
        return null

    // CRT Hill (Blender X [7.5..23.5], Y [16.5..29.5] -> Three.js Z [-29.5..-16.5], Y = 2.40)
    if(x >= 8.4 && x <= 22.6 && z >= -28.6 && z <= -17.4)
        return 2.40
    if(x >= 6.8 && x <= 24.2 && z >= -30.2 && z <= -15.8)
        return null // Margin around CRT cliff & steps

    // North Plateau (Blender X [-24..20], Y [26..47] -> Three.js Z [-47..-26], Y = 1.60)
    if(x >= -23.0 && x <= 19.0 && z >= -45.5 && z <= -27.0)
        return 1.60
    if(x >= -24.8 && x <= 20.8 && z >= -47.5 && z <= -24.0)
        return null // Margin around North cliff & stairs

    // School Terrace (Blender X [-24..-4], Y [10..27] -> Three.js Z [-27..-10], Y = 0.80)
    if(x >= -23.0 && x <= -5.0 && z >= -26.0 && z <= -11.0)
        return 0.80
    if(x >= -24.8 && x <= -3.2 && z >= -27.8 && z <= -6.2)
        return null // Margin around School cliff & approach steps

    // Exclude central North staircase corridor (X [-3.5..6.5], Z [-26..-19])
    if(x >= -3.5 && x <= 6.5 && z >= -26.0 && z <= -19.0)
        return null

    return 0.0
}

/**
 * Stylized cerrado grass & wildflower tufts (inspired by Tidewater + infinite-terrain).
 * Strictly grounded on flat dry terraces, clustered organically, zero floating blades.
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

        const level = this.game.quality?.level ?? 0
        this.isQ0 = level === 0
        this.targetCount = this.isQ0 ? 3200 : (level === 1 ? 380 : 220)
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
        const rand = mulberry32(20260412)
        const list = []
        const maxAttempts = targetCount * 36

        for(let i = 0; i < maxAttempts && list.length < targetCount; i++)
        {
            const x = -34.0 + rand() * 68.0
            const z = -43.0 + rand() * 64.0
            const surf = sampleIslandSurface(x, z)
            if(!surf.isGrass)
                continue

            // Organic meadow patch clustering
            const patch = 0.5 + 0.5 * Math.sin(x * 0.22 + z * 0.16) * Math.cos(x * 0.14 - z * 0.26)
            if(patch < 0.30 && rand() > 0.14)
                continue

            const scale = (0.55 + rand() * 0.65) * (0.85 + patch * 0.30)
            const angle = rand() * Math.PI * 2
            const tierRoll = rand()
            const lodTier = tierRoll < 0.35 ? 0 : (tierRoll < 0.70 ? 1 : 2)
            const isFlower = rand() < 0.16 ? 1.0 : 0.0

            list.push({ x, y: surf.y - 0.025, z, scale, angle, lodTier, isFlower })
        }

        return list
    }

    createBladeGeometry(instances)
    {
        // Fan of 3-4 gracefully curved tapered grass blades per tuft (inspired by infinite-terrain)
        const positions = []
        const normals = []
        const uvs = []
        const indices = []

        const bladeSpecs = this.isQ0
            ? [
                { rot: 0.0, lean: 0.13, ox: 0.0, oz: 0.0, h: 1.0 },
                { rot: 1.15, lean: 0.16, ox: 0.05, oz: -0.03, h: 0.86 },
                { rot: 2.35, lean: 0.14, ox: -0.04, oz: 0.05, h: 0.78 },
                { rot: 3.85, lean: 0.17, ox: 0.03, oz: 0.04, h: 0.92 },
            ]
            : [
                { rot: 0.0, lean: 0.14, ox: 0.0, oz: 0.0, h: 1.0 },
                { rot: 1.7, lean: 0.15, ox: 0.04, oz: 0.03, h: 0.85 },
            ]
        const segments = 3
        const baseHalfWidth = 0.046
        const height = 0.48

        let vertOffset = 0
        for(const spec of bladeSpecs)
        {
            const ca = Math.cos(spec.rot)
            const sa = Math.sin(spec.rot)
            const hBlade = height * spec.h
            for(let s = 0; s <= segments; s++)
            {
                const t = s / segments
                const w = baseHalfWidth * (1 - t * 0.92)
                const y = t * hBlade
                const bendBack = t * t * spec.lean

                positions.push(
                    (-w) * ca - bendBack * sa + spec.ox, y, (-w) * sa + bendBack * ca + spec.oz,
                    w * ca - bendBack * sa + spec.ox, y, w * sa + bendBack * ca + spec.oz
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
        const flowerMaskAttr = new Float32Array(count)

        for(let i = 0; i < instances.length; i++)
        {
            const inst = instances[i]
            rootPositions[i * 3] = inst.x
            rootPositions[i * 3 + 1] = inst.y
            rootPositions[i * 3 + 2] = inst.z
            bladeAnglesAttr[i] = inst.angle
            bladeTiersAttr[i] = inst.lodTier
            flowerMaskAttr[i] = inst.isFlower
        }

        geometry.setAttribute('aRootPos', new THREE.InstancedBufferAttribute(rootPositions, 3))
        geometry.setAttribute('aBladeAngle', new THREE.InstancedBufferAttribute(bladeAnglesAttr, 1))
        geometry.setAttribute('aBladeTier', new THREE.InstancedBufferAttribute(bladeTiersAttr, 1))
        geometry.setAttribute('aFlower', new THREE.InstancedBufferAttribute(flowerMaskAttr, 1))
        return geometry
    }

    createMaterial()
    {
        const oliveBase = color('#486822')
        const meadowMid = color('#6f9134')
        const goldTip = color('#c6b446')
        const flowerTip = color('#f7c531')

        const h = uv().y.clamp(0.0, 1.0)
        const bladeGrad = mix(oliveBase, mix(meadowMid, goldTip, smoothstep(float(0.35), float(1.0), h)), smoothstep(float(0.0), float(0.65), h))
        const isFlower = attribute('aFlower', 'float')
        const flowerBlend = isFlower.mul(step(float(0.78), h))
        const grassColor = mix(bladeGrad, flowerTip, flowerBlend)

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

        const camDiff = this.uCamPos.xz.sub(rootPos.xz)
        const camDist = camDiff.x.mul(camDiff.x).add(camDiff.y.mul(camDiff.y)).add(0.001).sqrt()
        // Far-field LOD only (beyond visible gameplay area so grass stays planted and never moves with player)
        const fadeT2 = float(1).sub(smoothstep(float(38.0), float(50.0), camDist))
        const fadeT1 = float(1).sub(smoothstep(float(52.0), float(66.0), camDist))
        const fadeT0 = float(1).sub(smoothstep(float(68.0), float(86.0), camDist))
        const isT0 = float(1).sub(smoothstep(float(0.0), float(0.5), bladeTier))
        const isT2 = smoothstep(float(1.5), float(2.0), bladeTier)
        const isT1 = float(1).sub(isT0).sub(isT2).clamp(0, 1)
        const lodScale = fadeT0.mul(isT0).add(fadeT1.mul(isT1)).add(fadeT2.mul(isT2)).clamp(0, 1)

        const safeScale = lodScale.max(0.05)
        const sinkY = float(1).sub(smoothstep(float(0.02), float(0.08), lodScale)).mul(2.5)

        const ca = cos(bladeAngle)
        const sa = sin(bladeAngle)
        const px = positionLocal.x.mul(safeScale)
        const pz = positionLocal.z.mul(safeScale)
        const rotX = px.mul(ca).sub(pz.mul(sa))
        const rotZ = px.mul(sa).add(pz.mul(ca))

        const tipWeight = uv().y.clamp(0, 1)
        const toBlade = rootPos.xz.sub(this.uPlayerPos.xz)
        const dist = toBlade.x.mul(toBlade.x).add(toBlade.y.mul(toBlade.y)).add(0.001).sqrt()
        const pushDir = toBlade.div(dist)
        const bendFactor = float(1).sub(dist.div(this.uBendRadius).clamp(0, 1))
        const bendSq = bendFactor.mul(bendFactor)

        const windX = sin(this.uTime.mul(0.85).add(rootPos.x.mul(0.28)).add(rootPos.z.mul(0.22))).mul(0.045).mul(tipWeight)
        const windZ = cos(this.uTime.mul(0.7).add(rootPos.z.mul(0.26))).mul(0.035).mul(tipWeight)

        const bendXZ = pushDir.mul(bendSq.mul(this.uBendStrength).mul(tipWeight))
        const bendY = bendSq.mul(0.18).mul(tipWeight)

        material.positionNode = vec3(
            rotX.add(windX).add(bendXZ.x),
            positionLocal.y.mul(safeScale).sub(bendY).sub(sinkY),
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
